"""Geometric extraction of generated six-pose sheets; never paints new poses.

Requires Pillow. Isolates alpha-connected characters, keeps a shared pixel scale,
anchors boot/hoof centers, and locks idle to the original shipped sprite.
"""
import argparse
import hashlib
import json
from collections import deque
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--key', required=True)
parser.add_argument('--input', required=True)
parser.add_argument('--keep-generated-idle', action='store_true', help='Use revised character identity in idle as well')
parser.add_argument('--height', type=int, help='Standing height for a new identity without a shipped seed')
parser.add_argument('--output-root', default='public/assets/starfall/animations')
args = parser.parse_args()
source = Image.open(args.input).convert('RGBA')
w, h = source.size
alpha = source.getchannel('A').tobytes()
pending = bytearray(a >= 114 for a in alpha)
components = []
for start in range(w*h):
    if not pending[start]:
        continue
    pending[start] = 0
    queue, pixels = deque([start]), []
    while queue:
        index = queue.popleft()
        pixels.append(index)
        x, y = index % w, index // w
        for dx, dy in ((-1,0),(1,0),(0,-1),(0,1)):
            nx, ny = x+dx, y+dy
            if 0 <= nx < w and 0 <= ny < h:
                neighbor = ny*w+nx
                if pending[neighbor]:
                    pending[neighbor] = 0
                    queue.append(neighbor)
    if len(pixels) > 8:
        components.append(pixels)
components.sort(key=len, reverse=True)
primary = components[:6]
assert len(primary) == 6 and min(map(len,primary)) > 1000, 'Inspect sheet: six separate figures required'
centers = [(sum(p%w for p in c)/len(c),sum(p//w for p in c)/len(c)) for c in primary]
bounds = [(min(p%w for p in c),min(p//w for p in c),max(p%w for p in c),max(p//w for p in c)) for c in primary]
groups = [list(c) for c in primary]
for component in components[6:]:
    cx, cy = sum(p%w for p in component)/len(component), sum(p//w for p in component)/len(component)
    nearest = min(range(6),key=lambda i:max(bounds[i][0]-cx,0,cx-bounds[i][2])**2+max(bounds[i][1]-cy,0,cy-bounds[i][3])**2)
    groups[nearest].extend(component)
order = sorted(range(6),key=lambda i:(int(centers[i][1] >= h/2),centers[i][0]))
frames = []
for i in order:
    mask = bytearray(w*h)
    for p in groups[i]:
        mask[p] = alpha[p]
    layer=source.copy()
    layer.putalpha(Image.frombytes('L',source.size,bytes(mask)))
    frames.append(layer.crop(layer.getbbox()))
assert not args.height or args.keep_generated_idle, '--height requires --keep-generated-idle'
seed=None if args.height else Image.open(f'public/assets/starfall/sprites/{args.key}.png').convert('RGBA')
scale=(args.height if args.height else seed.height)/frames[0].height
size=128
out=Path(args.output_root)/args.key
out.mkdir(parents=True,exist_ok=True)
preview=Image.new('RGBA',(size*6,size),'#233641')
manifest={'source':Path(args.input).name,'sharedScale':scale,'frameSize':size,'anchor':[64,128],'frames':[]}
for index,frame in enumerate(frames):
    canvas=Image.new('RGBA',(size,size))
    if index == 0 and not args.keep_generated_idle:
        canvas.alpha_composite(seed,((size-seed.width)//2,size-seed.height))
    else:
        frame=frame.resize((round(frame.width*scale),round(frame.height*scale)),Image.Resampling.NEAREST)
        # Boots/hooves, rather than a swinging weapon, determine horizontal placement.
        band=frame.crop((0,max(0,frame.height-6),frame.width,frame.height)).getchannel('A')
        bbox=band.getbbox()
        foot_x=(bbox[0]+bbox[2])/2
        offset=(round(size/2-foot_x),size-frame.height)
        assert offset[0]>=0 and offset[0]+frame.width<=size and offset[1]>=0, f'Frame {index+1} would be clipped: size={frame.size}, offset={offset}, source sizes={[f.size for f in frames]}'
        canvas.alpha_composite(frame,offset)
    path=out/f'{index+1:02}.png'
    canvas.save(path)
    preview.alpha_composite(canvas,(size*index,0))
    manifest['frames'].append({'file':path.name,'bbox':canvas.getbbox(),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
assert len({f['sha256'] for f in manifest['frames']})==6, 'Repeated pose bitmap'
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
evidence=Path('docs/starfall-animation-evidence');evidence.mkdir(parents=True,exist_ok=True)
preview_name=f'{args.key}-{args.height}-preview.png' if args.height else f'{args.key}-preview.png'
preview.resize((size*6*3,size*3),Image.Resampling.NEAREST).save(evidence/preview_name)
print(args.key, 'shared scale',scale, 'source sizes',[f.size for f in frames])
