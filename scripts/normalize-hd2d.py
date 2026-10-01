"""Pack an AI strip by alpha-connected sprites before fixed-slot normalization.

This is geometric asset normalization only: no new poses or painted pixels.
Requires Pillow. Output is a padded equal-slot strip for normalize_sprite_strip.py.
"""
import argparse
from collections import deque
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--input', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--frames-dir', help='Also export six shared-scale, bottom-anchored 256px frames')
args = parser.parse_args()
source = Image.open(args.input).convert('RGBA')
width, height = source.size
alpha = source.getchannel('A')
pending = bytearray(value > 32 for value in alpha.tobytes())
components = []
for start in range(width * height):
    if not pending[start]:
        continue
    pending[start] = 0
    queue = deque([start])
    pixels = []
    while queue:
        index = queue.popleft()
        pixels.append(index)
        x, y = index % width, index // width
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < width and 0 <= ny < height:
                neighbor = ny * width + nx
                if pending[neighbor]:
                    pending[neighbor] = 0
                    queue.append(neighbor)
    if len(pixels) > 8:
        components.append(pixels)

components.sort(key=len, reverse=True)
primary = components[:6]
if len(primary) != 6 or min(map(len, primary)) < 1000:
    raise SystemExit('Six isolated sprites could not be found; inspect source before shipping.')
centers = [sum(index % width for index in pixels) / len(pixels) for pixels in primary]
groups = [list(pixels) for pixels in primary]
for pixels in components[6:]:
    center = sum(index % width for index in pixels) / len(pixels)
    nearest = min(range(6), key=lambda i: abs(centers[i] - center))
    groups[nearest].extend(pixels)
frames = []
for index in sorted(range(6), key=lambda i: centers[i]):
    mask = bytearray(width * height)
    original_alpha = alpha.tobytes()
    for pixel in groups[index]:
        mask[pixel] = original_alpha[pixel]
    layer = source.copy()
    layer.putalpha(Image.frombytes('L', source.size, bytes(mask)))
    frames.append(layer.crop(layer.getbbox()))
slot = max(max(frame.size) for frame in frames) + 16
strip = Image.new('RGBA', (slot * 6, slot))
for index, frame in enumerate(frames):
    strip.alpha_composite(frame, (slot * index + (slot - frame.width) // 2, slot - frame.height - 8))
Path(args.output).parent.mkdir(parents=True, exist_ok=True)
strip.save(args.output)
if args.frames_dir:
    destination = Path(args.frames_dir)
    destination.mkdir(parents=True, exist_ok=True)
    scale = 256 / max(max(frame.size) for frame in frames)
    preview = Image.new('RGBA', (256 * 6, 256), '#162735')
    for index, frame in enumerate(frames):
        resized = frame.resize((round(frame.width * scale), round(frame.height * scale)), Image.Resampling.NEAREST)
        canvas = Image.new('RGBA', (256, 256))
        canvas.alpha_composite(resized, ((256 - resized.width) // 2, 256 - resized.height))
        canvas.save(destination / f'{index + 1:02}.png')
        preview.alpha_composite(canvas, (index * 256, 0))
    preview.save(Path(args.output).with_name(Path(args.output).stem + '-preview.png'))
print(args.input, '→', [frame.size for frame in frames])
