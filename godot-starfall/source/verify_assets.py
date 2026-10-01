"""Structural asset checks; uses Python standard library, does not run gameplay."""
import json, struct, re
from pathlib import Path
root=Path(__file__).resolve().parents[1]
raw=(root/'assets/models/starfall_environment.glb').read_bytes()
magic,version,length=struct.unpack_from('<III',raw)
assert magic==0x46546C67 and version==2 and length==len(raw)
chunk_length=struct.unpack_from('<I',raw,12)[0]
gltf=json.loads(raw[20:20+chunk_length])
assert all('bufferView' in image for image in gltf['images']), 'GLB textures must be embedded'
assert any(mat.get('alphaMode')=='MASK' and 'bough' in mat['name'] for mat in gltf['materials'])
assert all('TEXCOORD_0' in prim['attributes'] for mesh in gltf['meshes'] for prim in mesh['primitives'])
layout=json.loads((root/'assets/layout.json').read_text())
chapter=(root.parent/'src/game/data/chapters.ts').read_text()
original=re.search(r"map: map\((.*?)\)",chapter).group(1)
assert layout['rows']==re.findall(r"'([^']+)'",original)
assert len(layout['lamps'])==5
for p in (root/'assets/textures').glob('*.png'):
    data=p.read_bytes(); assert data[:8]==b'\x89PNG\r\n\x1a\n'
    w,h=struct.unpack_from('>II',data,16);assert w==h and w in (128,256)
scene=(root/'scenes/starfall_bridge.tscn').read_text()
for path in re.findall(r'path="res://([^"]+)"',scene):assert (root/path).exists(),path
assert (root/'source/Starfall_Bridge.blend').stat().st_size>1_000_000
result={'status':'PASS','meshes':len(gltf['meshes']),'embedded_images':len(gltf['images']),'source_textures':len(list((root/'assets/textures').glob('*.png'))),'layout_matches_original':True,'uv_complete':True,'alpha_mask_foliage':True,'scene_external_resources_present':True}
(root/'evidence/asset-verification.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
