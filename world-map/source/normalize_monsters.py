"""Shared sprite-pipeline scale and bottom-center anchor, preserving generated alpha."""
from PIL import Image
from pathlib import Path
import importlib.util
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('normalizer','/Users/jessefei/.codex/plugins/cache/openai-curated-remote/game-studio/0.1.2/scripts/normalize_sprite_strip.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
atlas=Image.open(ROOT/'world-map/source/sprites/monsters-original.png').convert('RGBA')
assert atlas.getchannel('A').getextrema()[0]==0,'Atlas must have genuine transparent pixels'
for row,name in enumerate(['mossling','tidecrab']):
 strip=atlas.crop((0,round(atlas.height*row/2),atlas.width,round(atlas.height*(row+1)/2)))
 contents=[m.crop_to_content(frame,8) for frame in m.split_strip(strip,6)]
 w,h=m.max_content_size(contents)
 for i,content in enumerate(contents):
  for folder,size in [('starfall/animations',52),('hd2d',92)]:
   normalized=m.compose_frame(content,size,min(size/w,size/h))
   canvas=Image.new('RGBA',(128,128));canvas.alpha_composite(normalized,((128-size)//2,128-size))
   out=ROOT/'public/assets'/folder/name;out.mkdir(parents=True,exist_ok=True);canvas.save(out/f'{i+1:02}.png')
print('Two original monsters: 6 poses each, alpha preserved, 52px/92px scale on 128px canvas.')
