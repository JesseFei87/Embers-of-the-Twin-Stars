"""Validate exported Moonlit assets with Python's standard library.

Run: python3 godot-starfall/source/verify_moonlit.py
Writes evidence/moonlit/asset-verification.json; exits nonzero on failure.
This checks the exported geometry itself, independently of Godot colliders.
"""
import ast
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import sys
import zlib

ROOT = Path(__file__).resolve().parents[1]
SOLIDS = ("Southern silver crescent", "Suspended ritual crescent",
          "Broken moon gate arch", "Distant viaduct arches",
          "West canyon wall", "East canyon wall", "Northern precipice")
LANDMARKS = SOLIDS + ("Bridge individual planks", "Moon terrace foundation",
                     "Altar concentric steps", "Moon gate upright",
                     "East crossing stone apron", "Scout terrace slope",
                     "Distant mountain panorama 0", "Distant mountain panorama 1", "Distant mountain panorama 2")


def require(condition, message):
    if not condition:
        raise ValueError(message)


class GLB:
    def __init__(self, path):
        self.raw = path.read_bytes()
        magic, version, length = struct.unpack_from("<III", self.raw)
        require((magic, version, length) == (0x46546C67, 2, len(self.raw)), "Invalid GLB header")
        chunks = {}
        offset = 12
        while offset < length:
            size, kind = struct.unpack_from("<II", self.raw, offset)
            require(size % 4 == 0 and offset + 8 + size <= length, "Invalid GLB chunk bounds")
            chunks[kind] = self.raw[offset + 8:offset + 8 + size]
            offset += 8 + size
        self.doc = json.loads(chunks[0x4E4F534A])
        self.binary = chunks[0x004E4942]
        require(len(self.doc["buffers"]) == 1 and "uri" not in self.doc["buffers"][0], "External geometry buffer")
        require(self.doc["buffers"][0]["byteLength"] <= len(self.binary), "Truncated binary buffer")
        self.meshes = {mesh["name"]: mesh for mesh in self.doc["meshes"]}
        self.cache = {}

    def view(self, index):
        view = self.doc["bufferViews"][index]
        start = view.get("byteOffset", 0)
        require(view.get("buffer", 0) == 0 and start + view["byteLength"] <= len(self.binary), "Buffer view outside BIN chunk")
        return self.binary[start:start + view["byteLength"]]

    def accessor(self, index):
        if index in self.cache:
            return self.cache[index]
        item = self.doc["accessors"][index]
        require("sparse" not in item, "Sparse accessor requires explicit verifier support")
        fmt = {5121: "B", 5123: "H", 5125: "I", 5126: "f"}[item["componentType"]]
        count = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[item["type"]]
        size = struct.calcsize("<" + fmt * count)
        view = self.doc["bufferViews"][item["bufferView"]]
        data = self.view(item["bufferView"])
        start = item.get("byteOffset", 0)
        stride = view.get("byteStride", size)
        require(start + (item["count"] - 1) * stride + size <= len(data), "Accessor outside buffer view")
        values = [struct.unpack_from("<" + fmt * count, data, start + i * stride) for i in range(item["count"])]
        require(all(math.isfinite(value) for row in values for value in row), "Nonfinite accessor values")
        self.cache[index] = values
        return values

    def triangles(self, name):
        for primitive in self.meshes[name]["primitives"]:
            require(primitive.get("mode", 4) == 4, "Expected triangle primitive")
            vertices = self.accessor(primitive["attributes"]["POSITION"])
            indices = [row[0] for row in self.accessor(primitive["indices"])]
            require(len(indices) % 3 == 0 and max(indices) < len(vertices), "Invalid triangle indices")
            for i in range(0, len(indices), 3):
                yield tuple(vertices[index] for index in indices[i:i + 3])


def png_alpha_range(data):
    """Decode the exported 8-bit RGBA PNG, including all five PNG row filters."""
    require(data[:8] == b"\x89PNG\r\n\x1a\n", "Foliage image is not PNG")
    width, height, bits, color, compression, filtering, interlace = struct.unpack_from(">IIBBBBB", data, 16)
    require((bits, color, compression, filtering, interlace) == (8, 6, 0, 0, 0), "Expected noninterlaced RGBA8 foliage PNG")
    compressed = bytearray()
    offset = 8
    while offset < len(data):
        size = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + size]
        require(zlib.crc32(kind + payload) == struct.unpack_from(">I", data, offset + 8 + size)[0], "PNG CRC mismatch")
        if kind == b"IDAT":
            compressed.extend(payload)
        offset += size + 12
    raw = zlib.decompress(compressed)
    stride = width * 4
    require(len(raw) == height * (stride + 1), "PNG decoded length mismatch")
    previous = bytearray(stride)
    alpha = []
    for y in range(height):
        start = y * (stride + 1)
        method = raw[start]
        require(method <= 4, "Unknown PNG row filter")
        row = bytearray(raw[start + 1:start + 1 + stride])
        for x in range(stride):
            a, b, c = (row[x - 4] if x >= 4 else 0), previous[x], (previous[x - 4] if x >= 4 else 0)
            p = a + b - c
            paeth = min((a, b, c), key=lambda v: abs(p - v))
            row[x] = (row[x] + (0, a, b, (a + b) // 2, paeth)[method]) % 256
        alpha.extend(row[3::4])
        previous = row
    return min(alpha), max(alpha)


def surface_height(triangles, x, z):
    hits = []
    for a, b, c in triangles:
        denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2])
        if abs(denominator) < 1e-10:
            continue
        u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator
        v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator
        if min(u, v, 1 - u - v) >= -1e-6:
            hits.append(u * a[1] + v * b[1] + (1 - u - v) * c[1])
    return max(hits) if hits else None


def verify(report):
    glb = GLB(ROOT / "assets/models/moonlit_environment.glb")
    report["glb_sha256"] = hashlib.sha256(glb.raw).hexdigest()
    for index in range(len(glb.doc["bufferViews"])):
        glb.view(index)
    for name in glb.meshes:
        for _ in glb.triangles(name):
            pass
    for name in LANDMARKS:
        require(name in glb.meshes, "Missing landmark: " + name)
    require("Distant basalt towers" not in glb.meshes, "Rear wall must be removed")
    require("Back canyon earth" not in glb.meshes, "Flat northern continuation remains")
    for layer in range(3):
        panorama = next(m for m in glb.doc["materials"] if m["name"] == "distant_panorama_"+str(layer))
        texture = glb.doc["textures"][panorama["pbrMetallicRoughness"]["baseColorTexture"]["index"]]
        sampler = glb.doc["samplers"][texture["sampler"]]
        require(sampler.get("wrapS") == 33071 and sampler.get("wrapT") == 33071, "Distant texture edges must clamp, not repeat into the sky")
        image = glb.doc["images"][texture["source"]]
        require(png_alpha_range(glb.view(image["bufferView"])) == (0,255), "Distant skyline must have actual transparency")
    report["landmarks"] = list(LANDMARKS)
    for image in glb.doc["images"]:
        require("uri" not in image and "bufferView" in image, "External image: " + image.get("name", ""))
        require(len(glb.view(image["bufferView"])) > 32, "Empty packed image")
    report["packed_images"] = len(glb.doc["images"])
    foliage = next(m for m in glb.doc["materials"] if m["name"] == "Pine bough alpha cutout")
    require(foliage.get("alphaMode") == "MASK" and foliage.get("doubleSided") is True, "Incorrect foliage alpha material")
    texture = glb.doc["textures"][foliage["pbrMetallicRoughness"]["baseColorTexture"]["index"]]
    image = glb.doc["images"][texture["source"]]
    alpha = png_alpha_range(glb.view(image["bufferView"]))
    require(alpha == (0, 255) and 0 < foliage.get("alphaCutoff", .5) < 1, "Foliage has no actual transparent and opaque pixels")
    report["foliage_alpha_range"] = alpha
    volumes = {}
    for name in SOLIDS:
        volume = 0
        edges = {}
        for a, b, c in glb.triangles(name):
            volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
            points = [tuple(round(v, 5) for v in p) for p in (a, b, c)]
            for i in range(3):
                edge = tuple(sorted((points[i], points[(i + 1) % 3])))
                edges[edge] = edges.get(edge, 0) + 1
        require(volume > 0 and all(count == 2 for count in edges.values()), "Inverted or nonclosed solid: " + name)
        volumes[name] = round(volume, 6)
    report["closed_solid_signed_volumes_m3"] = volumes
    layout = json.loads((ROOT / "assets/moonlit-layout.json").read_text())
    require(layout["mapId"] == "moonlit-pass" and layout["tileSize"] == 2, "Map identity or scale changed")
    source = (ROOT.parent / "src/game/data/chapters.ts").read_text()
    chapter = source.split("'moonlit-pass': {", 1)[1]
    rows = re.findall(r"'([gfmwrbs]+)'", re.search(r"map: map\((.*?)\)", chapter).group(1))
    require(len(rows) == 12 and all(len(row) == 12 for row in rows), "Unexpected source terrain dimensions")
    tree = ast.parse((ROOT / "source/build_moonlit.py").read_text())
    builder_rows = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "MAP" for t in n.targets))
    require(layout["rows"] == builder_rows == rows, "Terrain differs from original chapter")
    design = json.loads((ROOT.parent / "docs/moonlit-pass-layout-v2.json").read_text())
    require(rows == design["grid"]["rowsNorthToSouth"], "Terrain differs from approved layout")
    require(layout["deployment"] == [[p["x"], p["y"]] for p in design["deployment"]], "Deployment changed")
    require(layout["objective"] == [9, 2], "Altar objective moved")
    require(len(layout["actors"]) == 11, "Expected eleven actors")
    actor_cells = {(a["col"], a["row"]) for a in layout["actors"]}
    require(len(actor_cells)==11, "Actors overlap")
    surfaces = [name for name in glb.meshes if any(part in name for part in ("walkable bank", "Scout terrace slope", "causeway", "approach paving", "Moon terrace paving", "Moon terrace foundation", "Altar concentric steps", "Bridge individual planks", "East crossing"))]
    checked_meshes = {glb.doc["meshes"].index(glb.meshes[name]) for name in surfaces}
    require(all(not any(k in node for k in ("translation", "rotation", "scale", "matrix")) for node in glb.doc["nodes"] if node.get("mesh") in checked_meshes), "Surface node transforms require world-space verification")
    triangles = [triangle for name in surfaces for triangle in glb.triangles(name)]
    ground_triangles = [triangle for name in glb.meshes if "walkable bank" in name for triangle in glb.triangles(name)]
    supported = 0
    for row, cells in enumerate(rows):
        for col, terrain in enumerate(cells):
            if terrain == 'w': continue
            x, z = (col-layout['origin'][0])*2, (row-layout['origin'][1])*2
            require(surface_height(triangles,x,z) is not None, f"Walkable cell {col},{row} has no rendered surface")
            supported += 1
    require(surface_height(ground_triangles,-7,-11) is not None, "Northwest cutout remains")
    report['supported_walkable_cells'] = supported
    placements = []
    for actor in layout["actors"]:
        col, row = actor["col"], actor["row"]
        require(actor["height"] == layout["cell_heights"][row][col], "Actor/cell elevation mismatch: " + actor["name"])
        x, z = (col - layout["origin"][0]) * 2, (row - layout["origin"][1]) * 2
        # Probe a small foot area: a single ray can fall inside a masonry joint.
        probes = [(0, 0)] + [(.08 * math.cos(.3 + i * math.tau / 8), .08 * math.sin(.3 + i * math.tau / 8)) for i in range(8)]
        heights = [surface_height(triangles, x + dx, z + dz) for dx, dz in probes]
        heights = [h for h in heights if h is not None]
        require(heights, "Actor has no exported ground: " + actor["name"])
        surface = max(heights)
        gap = actor["height"] + .045 - surface
        require(-.025 <= gap <= .18, "Actor baseline penetrates or floats above mesh: " + actor["name"])
        placements.append({"name": actor["name"], "cell": [col, row], "mesh_surface": round(surface, 4), "baseline_gap_m": round(gap, 4)})
    report["actor_surface_probes"] = placements
    apron = [t for name in glb.meshes if name.startswith("East crossing") for t in glb.triangles(name)]
    road_height = surface_height(apron, 3, -1)
    require(road_height is not None and abs(road_height - layout["cell_heights"][5][7]) < .15, "Road cell (7,5) lacks visible crossing")
    report["road_cell_7_5_mesh_height"] = round(road_height, 4)
    report["terrain_rows"] = rows
    report["scope"] = "Exported geometry, packed foliage, source terrain and actor support; native visual review and Godot runtime validation remain separate."


if __name__ == "__main__":
    report = {"passed": False}
    try:
        verify(report)
        report["passed"] = True
    except (ValueError, KeyError, IndexError, StopIteration, struct.error, OSError) as error:
        report["error"] = str(error) or type(error).__name__
    output = ROOT / "evidence/moonlit/asset-verification.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    sys.exit(0 if report["passed"] else 1)
