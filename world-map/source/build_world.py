"""Blender-authored Northern Realms. Run blender --background --python this_file.
Shared road layout drives both baked roads and game navigation. Z-up source -> Y-up GLB.
"""
import bpy, math, random, json, sys
import numpy as np
from pathlib import Path
from mathutils import Vector
random.seed(4107)
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/world3d'; OUT.mkdir(parents=True,exist_ok=True)
layout=json.loads((ROOT/'src/game/world/layout.json').read_text())
bpy.context.preferences.filepaths.save_version=0
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
batches={}; mats={}; bough_uvs=[]
def shader(material):
 return next((n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None) or material.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
def mat(name,color):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 bs=shader(m);output=next((n for n in m.node_tree.nodes if n.type=='OUTPUT_MATERIAL'),None) or m.node_tree.nodes.new('ShaderNodeOutputMaterial');m.node_tree.links.new(bs.outputs['BSDF'],output.inputs['Surface']);bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=.9
 mats[name]=m;return m
for n,c in {'grass':(.18,.23,.075),'meadow':(.235,.28,.10),'earth':(.25,.23,.14),'rock':(.29,.32,.32),'rockLight':(.42,.45,.43),'snow':(.59,.66,.68),'pine':(.055,.15,.115),'pineLight':(.12,.23,.14),'trunk':(.18,.115,.065),'road':(.60,.48,.28),'roadEdge':(.35,.29,.17),'stone':(.52,.48,.36),'plaster':(.71,.58,.36),'roof':(.32,.095,.06),'roofGold':(.49,.22,.085),'wood':(.23,.13,.06),'gold':(.67,.46,.17),'window':(1,.55,.13),'dark':(.095,.09,.105),'lava':(.7,.12,.025),'shrine':(.66,.70,.54)}.items():mat(n,c)
mat('bough',(.08,.19,.12))
bough_image=bpy.data.images.load(str(ROOT/'godot-starfall/assets/textures/pine_bough_cutout.png'));bough_image.pack()
bough_node=mats['bough'].node_tree.nodes.new('ShaderNodeTexImage');bough_node.image=bough_image
bough_shader=shader(mats['bough'])
mats['bough'].node_tree.links.new(bough_node.outputs['Color'],bough_shader.inputs['Base Color']);mats['bough'].node_tree.links.new(bough_node.outputs['Alpha'],bough_shader.inputs['Alpha'])
mats['bough'].use_backface_culling=False
for n in ['window','lava']:

 b=shader(mats[n]);b.inputs['Emission Color'].default_value=mats[n].diffuse_color;b.inputs['Emission Strength'].default_value=1.5

def mesh(name,vs,fs):
 if not fs:return
 used=sorted({i for f in fs for i in f}); remap={v:i for i,v in enumerate(used)};vs=[vs[i] for i in used];fs=[tuple(remap[i] for i in f) for f in fs]
 b=batches.setdefault(name,[[],[]]);off=len(b[0]);b[0].extend(vs);b[1].extend(tuple(i+off for i in f) for f in fs)
def box(n,x,y,z,sx,sy,sz):
 vs=[(x+i*sx/2,y+j*sy/2,z+k*sz/2) for k in [-1,1] for j in [-1,1] for i in [-1,1]]
 mesh(n,vs,[(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)])
def cone(n,x,y,z,r,h,segments=8,top=0,phase=0):
 vs=[(x+r*math.cos(i*math.tau/segments+phase),y+r*math.sin(i*math.tau/segments+phase),z) for i in range(segments)]
 vs += [(x+top*math.cos(i*math.tau/segments+phase),y+top*math.sin(i*math.tau/segments+phase),z+h) for i in range(segments)]
 fs=[tuple(reversed(range(segments))),tuple(range(segments,segments*2))]+[(i,(i+1)%segments,(i+1)%segments+segments,i+segments) for i in range(segments)]
 mesh(n,vs,fs)
def point(x,y):return ((x-480)/22,(320-y)/22)
roadSegments=[]
for r in layout['roads']:
 ps=[point(*p) for p in r['points']];roadSegments.extend(zip(ps,ps[1:]))
def roadDist(x,y):
 d=1e4
 for a,b in roadSegments:
  dx,dy=b[0]-a[0],b[1]-a[1];t=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)))
  d=min(d,math.hypot(x-a[0]-t*dx,y-a[1]-t*dy))
 return d
# Full island coastline, shared by shore foam baking. All terrain closes below sea level.
def coast(x,y):
 u=(x*.81+y*.59-1)/24;v=(-x*.59+y*.81+1)/12.5
 return (1-u*u-v*v)*6 + .40*math.sin(x*.91+y*.4)+.25*math.cos(y*1.8-x*.2)+.20*math.sin(y*2.6+x*1.3)
def river_distance(x,y):
 return abs(x-(1.8+.65*math.sin((y+3.64)*.57))) - (.55+max(0,-y-7)*.14)
def baseheight(x,y):
 ridge=max(h*max(0,1-math.sqrt((x-cx)**2/rx**2+(y-cy)**2/ry**2))**.82 for cx,cy,h,rx,ry in [(5,8,8.3,4.8,5),(8,7,7.7,4.6,5),(3,6,5.5,4,4),(9,4,5.8,3,5),(-9,-5,.7,5,4),(-5,1,1.5,5,3)])
 flatten=min(1,roadDist(x,y)/1.35)
 ridge*=.22+.78*flatten
 rough=.13*math.sin(x*2.7+y*.7)+.08*math.cos(y*3.1-x*1.4)+.055*math.sin(x*7+y*4)
 z=1.75+ridge*(1+.15*math.sin(x*1.45+y*.6)+.10*math.sin(y*2.1-x*.65)) + .13*math.sin(x*.7)*math.cos(y*.9)+rough*min(1,roadDist(x,y)/.6)
 # Broad volcanic cone with an actual recessed crater, lava lies inside the bowl.
 r=math.hypot(x-15.1,(y-12.3)*1.12)
 volcanic=max(0,1-r/5.5)*8.5*(1+.05*math.sin(math.atan2(y-12.3,x-15.1)*13)*min(1,r/1.5))
 if r<1.13:volcanic=6.75+.22*(r/1.13)**2
 if volcanic>0:z=max(z,1.75+volcanic+rough*.65)
 return z
def height(x,y):
 c=coast(x,y)
 if c<0:return -1.1+max(-1,c*.25)
 z=baseheight(x,y)
 # Deep river below the bridge, with continuous sea connections; roads have authored decks.
 if -19<y<1 and river_distance(x,y)<0:return -.6
 return -1.1+(z+1.1)*min(1,c/.43)
def roadheight(x,y):
 if -19<y<1 and river_distance(x,y)<.18:return baseheight(x,y)+.10
 return height(x,y)+.055
# Continuous closed land mass. Dense, faceted ridges retain cliff breaks from every bearing.
N=246;M=212;verts=[]
for j in range(M+1):
 for i in range(N+1):
  x=-27+54*i/N;y=-22+46*j/M;verts.append((x,y,height(x,y)))
faces={n:[] for n in ['grass','meadow','earth','rock','rockLight','snow','dark']}
for j in range(M):
 for i in range(N):
  k=j*(N+1)+i;x,y,z=verts[k];c=coast(x,y)
  for f in [(k,k+1,k+N+2),(k,k+N+2,k+N+1)]:
   normal=(Vector(verts[f[1]])-Vector(verts[f[0]])).cross(Vector(verts[f[2]])-Vector(verts[f[0]])).normalized()
   volcanic=math.hypot(x-15.1,(y-12.3)*1.12)<5.4
   n='dark' if volcanic else 'snow' if z>6.2+.55*math.sin(x*2.1+y*1.6) else 'rockLight' if z>3.6 else 'rock' if c<.65 or normal.z<.72 else 'meadow' if math.sin(x*.7+y*.9)>.4 else 'grass'
   faces[n].append(f)
for n,fs in faces.items():mesh(n,verts,fs)
# Perimeter and bottom beneath the ocean prevent backside / underside holes.
box('rock',0,1,-2.5,54,46,1.1)
# Geological outcrops: crooked rings, asymmetric column faces, strata seams and grass caps.
def crag(x,y,r,h,z=-.6):
 sides=7;phase=random.random()*6;rad=[r*random.uniform(.75,1.2) for _ in range(sides)];vs=[]
 leanx=random.uniform(-.2,.2)*r;leany=random.uniform(-.2,.2)*r
 for level,shrink in [(0,1.1),(.36,1),(.7,.91),(1,.76)]:
  for i in range(sides):
   a=phase+i*math.tau/sides;rr=rad[i]*shrink*(1+random.uniform(-.09,.09));vs.append((x+math.cos(a)*rr+leanx*level,y+math.sin(a)*rr+leany*level,z+h*level+random.uniform(-.04,.04)*h))
 fs=[tuple(reversed(range(sides)))]
 for ring in range(3):
  for i in range(sides):fs.append((ring*sides+i,ring*sides+(i+1)%sides,(ring+1)*sides+(i+1)%sides,(ring+1)*sides+i))
 mesh(random.choice(['rock','rockLight','rock']),vs,fs)
 mesh('grass' if h>1.5 and random.random()>.3 else 'rockLight',vs,[tuple(range(3*sides,4*sides))])
for i in range(6500):
 x=random.uniform(-25,25);y=random.uniform(-20,22);c=coast(x,y)
 if -.55<c<.68 and roadDist(x,y)>.55:
  crag(x,y,random.uniform(.13,.46),random.uniform(.75,2.5))
# Offshore sea stacks and broken islands are modeled on all sides.
for x,y,r,h in [(-20,-7,.8,2.5),(-18,-12,.45,1.8),(-14,-17,.9,2.7),(-4,-17,.5,1.9),(7,-13,.9,3),(13,-7,.8,3.2),(18,-3,.8,2.5),(21,4,.6,2),(22,12,.7,2.9),(-4,15,.8,3.2),(-10,9,.8,2.2)]:
 if coast(x,y)<0:crag(x,y,r,h)
# Road ribbons sampled from the same polylines used by navigation.
roadMeta=[]
for r in layout['roads']:
 samples=[]
 for a,b in zip(r['points'],r['points'][1:]):
  count=max(2,int(math.dist(a,b)/2))
  for i in range(count):samples.append([a[0]+(b[0]-a[0])*i/count,a[1]+(b[1]-a[1])*i/count])
 samples.append(r['points'][-1]);roadMeta.append({**r,'samples':[[p[0],p[1],roadheight(*point(*p))+.04] for p in samples]})
 for a,b in zip(samples,samples[1:]):
  x,y=point(*a);xx,yy=point(*b);d=math.hypot(xx-x,yy-y);nx,ny=-(yy-y)/d,(xx-x)/d
  width=.22 if r['to'] in ['tide-cove','moss-hollow'] else .31
  vs=[(px+nx*s*width,py+ny*s*width,roadheight(px,py)+.035) for px,py in [(x,y),(xx,yy)] for s in [-1,1]]
  mesh('road',vs,[(0,2,3,1)])
  if random.random()<.33:
   s=random.choice([-1,1]);px=x+nx*s*(width+.055);py=y+ny*s*(width+.055);box('roadEdge',px,py,roadheight(x,y)+.06,.10,.12,.08)
def tree(x,y,s=1,snow=False):
 z=height(x,y);cone('trunk',x,y,z,.045*s,1.28*s,5,top=.012*s)
 phase=random.random()*math.tau
 for layer in range(8):
  radius=(.43*(1-layer/8)**.85+.025)*s;level=z+(.20+layer*.14)*s;phase+=2.4
  for branch in range(7):
   angle=phase+branch*math.tau/7;along=Vector((math.cos(angle),math.sin(angle),0));across=Vector((-math.sin(angle),math.cos(angle),0));origin=Vector((x,y,level))
   length=radius*random.uniform(.83,1.15);width=length*.34;vs=[]
   for t,side,lift in [(0,-1,0),(0,0,.025),(0,1,0),(1,-.30,-.10),(1,0,-.075),(1,.30,-.10)]:
    vs.append(tuple(origin+along*length*t+across*width*side+Vector((0,0,lift*s))))
   mesh('bough',vs,[(0,3,4,1),(1,4,5,2)])
   bough_uvs.extend([[(0,0),(0,1),(.5,1),(.5,0)],[(.5,0),(.5,1),(1,1),(1,0)]])

landNodes=[point(n['x'],n['y']) for n in layout['nodes']]
# Grove density follows valleys and leaves landmark plazas and every route readable.
for i in range(2900):
 x=random.uniform(-22,21);y=random.uniform(-17,19);c=coast(x,y);h=height(x,y)
 if c>.9 and 1.3<h<4.7 and roadDist(x,y)>.78 and all(math.hypot(x-a,y-b)>(2.7 if layout['nodes'][idx].get('enemy') else 2.1) for idx,(a,b) in enumerate(landNodes)) and not(x>11 and y>6) and not(x<-8 and y<-5):
  tree(x,y,random.uniform(.65,1.5))
smoke=[]
def house(x,y,s=1):
 z=height(x,y);w=.47*s;d=.64*s;h=.5*s
 box('stone',x,y,z+.09*s,w*1.1,d*1.1,.18*s);box('plaster',x,y,z+h/2+.08*s,w,d,h)
 for side in [-1,1]:
  for t in [-.2,.2]:box('wood',x+t*s,y+side*(d/2+.006),z+h/2,.035*s,.025,h)
  box('wood',x,y+side*(d/2+.014),z+.16*s,.13*s,.024,.26*s)
  for dx in [-.15,.15]:box('window',x+dx*s,y+side*(d/2+.023),z+.35*s,.07*s,.025,.1*s)
  box('wood',x+side*w/2,y,z+.28*s,.025,d,.04*s)
  for dy in [-.17,.17]:box('window',x+side*(w/2+.008),y+dy*s,z+.35*s,.025,.09*s,.10*s)
 vs=[(x-w*.63,y-d*.61,z+h),(x+w*.63,y-d*.61,z+h),(x,y-d*.61,z+h+.37*s),(x-w*.63,y+d*.61,z+h),(x+w*.63,y+d*.61,z+h),(x,y+d*.61,z+h+.37*s)]
 mesh(random.choice(['roof','roofGold']),vs,[(0,3,5,2),(1,2,5,4),(0,2,1),(3,4,5),(0,1,4,3)])
 box('stone',x+.13*s,y+.15*s,z+h+.27*s,.095*s,.105*s,.48*s)
 if random.random()<.65:smoke.append([x+.13*s,z+h+.53*s,-y-.15*s])
vx,vy=landNodes[0]
for i in range(82):
 a=i*2.399;r=.6+math.sqrt(i)*.29;x=vx+math.cos(a)*r;y=vy+math.sin(a)*r
 if roadDist(x,y)>.44 and coast(x,y)>1:house(x,y,random.uniform(.75,1.18))
z=height(vx-1.5,vy+.7);box('stone',vx-1.5,vy+.7,z+1,.6,.7,2);cone('roof',vx-1.5,vy+.7,z+2,.52,1.2,4,phase=math.pi/4)
# Cultivated strips, orchard trees, low fences around the settlement.
for fx,fy in [(vx+3.1,vy+.5),(vx+3.1,vy+2.1),(vx+1.4,vy+3.3),(vx-1.4,vy+3.5)]:
 for i in range(12):
  xx=fx-.65+i*.12
  for j in range(11):
   yy=fy-.45+j*.095
   if coast(xx,yy)>.6 and roadDist(xx,yy)>.45:box('roadEdge' if i%3==0 else 'meadow',xx,yy,height(xx,yy)+.035,.055,.085,.04)
 for i in range(8):
  xx=fx-.8+i*.22;yy=fy-.65
  if roadDist(xx,yy)>.5:cone('wood',xx,yy,height(xx,yy),.025,.22,5,top=.02)
# Grand bridge: stone voussoirs make open arches under the traversable road deck.
bx,by=landNodes[1];bz=roadheight(bx,by)
# The road crosses the river obliquely; align to its precise local tangent.
a,b=layout['roads'][1]['points'][-2:];ax,ay=point(*a);angle=math.atan2(by-ay,bx-ax);ux,uy=math.cos(angle),math.sin(angle)
def bridgepoint(u,v,z):return (bx+u*ux-v*uy,by+u*uy+v*ux,z)
for side in [-1,1]:
 for span in [-1.12,0,1.12]:
  for step in range(9):
   aa=step*math.pi/9;bb=(step+1)*math.pi/9
   vs=[bridgepoint(span+math.cos(t)*r,side*.43+q,bz-.62+math.sin(t)*r) for q in [-.11,.11] for t,r in [(aa,.47),(bb,.47),(bb,.63),(aa,.63)]]
   mesh('stone',vs,[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)])
 for u in [-1.7,-.56,.56,1.7]:
  x,y,_=bridgepoint(u,side*.43,0);box('stone',x,y,(bz-.45)/2,.22,.22,bz+.55)
 for i in range(31):
  x,y,_=bridgepoint(-1.75+i*.116,side*.5,0);box('stone',x,y,bz+.24,.12,.13,.37)
vs=[bridgepoint(u,v,z) for z in [bz-.12,bz+.02] for v in [-.47,.47] for u in [-1.82,1.82]]
mesh('stone',vs,[(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)])
# Marble sanctuary: tiered court, slender towers and gold spires.
sx,sy=landNodes[2];sz=height(sx,sy)
for r,h in [(1.8,.10),(1.55,.22),(1.3,.34)]:cone('shrine',sx,sy,sz,r,h,24,top=r)
for i in range(10):
 a=i*math.tau/10;x=sx+math.cos(a)*1.0;y=sy+math.sin(a)*1.0;hh=1.5+(.7 if i%2==0 else 0)
 cone('shrine',x,y,sz+.3,.13,hh,10,top=.10);cone('gold',x,y,sz+.3+hh,.17,.65,8)
 box('gold',x,y,sz+.5,.26,.26,.045)
cone('shrine',sx,sy,sz+.3,.4,2.9,12,top=.29);cone('gold',sx,sy,sz+3.2,.35,1.3,10)
for i in range(4):
 a=i*math.tau/4;x=sx+math.cos(a)*.5;y=sy+math.sin(a)*.5
 cone('shrine',x,y,sz+.3,.2,2.3,8,top=.12);cone('gold',x,y,sz+2.6,.22,.8,8)
# Mountain gate and a fortified frontier behind the snow range.
gx,gy=landNodes[3];gz=height(gx,gy)
for dx in [-.65,.65]:box('stone',gx+dx,gy,gz+.8,.38,.6,1.6);cone('snow',gx+dx,gy,gz+1.6,.36,.3,4,phase=.785)
box('stone',gx,gy,gz+1.7,1.8,.6,.25)
cx,cy=landNodes[4];cz=height(cx,cy)
box('dark',cx,cy,cz+.8,2.4,1.9,1.6)
for dx,dy,hh in [(-1,-.8,2.5),(1,-.8,2.8),(-1,.8,3),(1,.8,2.6),(0,.4,4.3),(0,-.6,3.4)]:
 cone('dark',cx+dx,cy+dy,cz,.32,hh,8,top=.27);cone('dark',cx+dx,cy+dy,cz+hh,.41,1.25,8)
 for side in [-1,1]:
  for k in range(4):box('window',cx+dx,cy+dy+side*.285,cz+.5+k*.58,.075,.035,.24)
for i in range(11):
 for side in [-1,1]:box('dark',cx-1.2+i*.24,cy+side*.95,cz+1.68,.14,.18,.28)
# Molten crater and lava channels follow the actual volcano surface.
cone('lava',15.1,12.3,8.49,.84,.035,28,top=.84)
for a in [.25,2.2,3.9,5.2]:
 last=None
 for i in range(43):
  r=1.06+i*.088;aa=a+.06*math.sin(i*.43);x=15.1+math.cos(aa)*r;y=12.3+math.sin(aa)*r/1.12;z=height(x,y)+.04;w=.045+(.014*math.sin(i))
  pair=[(x-math.sin(aa)*w,y+math.cos(aa)*w,z),(x+math.sin(aa)*w,y-math.cos(aa)*w,z)]
  if last:mesh('lava',last+pair,[(0,1,3,2)])
  last=pair
for idx in [5,6]:
 x,y=landNodes[idx]
 for i in range(8):
  a=i*math.tau/8;px=x+math.cos(a)*.85;py=y+math.sin(a)*.85
  cone('stone' if idx==5 else 'rockLight',px,py,height(px,py),.13,.46 if idx==5 else .18,6,top=.07)
# Harbor follows the south-west coast: modeled retaining quay and timber piers.
harbor=(-14.6,-10.3)
for x,y in [(-18.0,-11.5),(-16.7,-13.4),(-14.9,-15.2)]:
 for j in range(17):
  yy=y-j*.12;box('wood',x,yy,.62,.65,.108,.085)
  if j%5==0:
   for dx in [-.28,.28]:cone('wood',x+dx,yy,-.65,.045,1.55,7,top=.04)
# Shore mask is generated from this exact terrain coastline + river, not a separate approximation.
size=512;rgba=np.ones((size,size,4),dtype=np.float32)
for j in range(size):
 for i in range(size):
  x=(i/(size-1)-.5)*64;y=(j/(size-1)-.5)*64;c=coast(x,y)
  if -19<y<1:c=min(c,river_distance(x,y))
  rgba[j,i,:3]=max(0,min(1,.5+c/8))
image=bpy.data.images.new('ShoreDistance',width=size,height=size,alpha=True);image.pixels.foreach_set(rgba.ravel());image.filepath_raw=str(OUT/'shore-mask.png');image.file_format='PNG';image.save();bpy.data.images.remove(image)
# Small authored surface textures are embedded in GLB, shared by all geometry of that material.
rng=np.random.default_rng(4107)
for name,material in mats.items():
 if name in ['window','lava','gold','bough']:continue
 size=128;yy,xx=np.mgrid[:size,:size];grain=rng.random((size,size))
 broad=(np.sin(xx*.13)*np.sin(yy*.17)+np.sin(xx*.39+yy*.23))*.5
 factor=.72+grain*.35+broad*.10
 if name in ['rock','rockLight','stone','shrine']:factor*=.86+.14*(np.sin(yy*.5+np.sin(xx*.06)*2)>-.6)
 if name in ['grass','meadow','earth']:factor+=rng.random((size,size))*.15
 color=np.array(material.diffuse_color[:3]);rgba=np.ones((size,size,4),dtype=np.float32);rgba[:,:,:3]=np.clip(color[None,None,:]**(1/2.2)*factor[:,:,None],0,1)
 image=bpy.data.images.new('Surface_'+name,width=size,height=size,alpha=True);image.pixels.foreach_set(rgba.ravel());image.pack()
 tex=material.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;tex.interpolation='Linear';material.node_tree.links.new(tex.outputs['Color'],shader(material).inputs['Base Color'])

for source,names in [('coastal-granite.png',['rock','rockLight','dark']),('coastal-meadow.png',['grass','meadow'])]:
 image=bpy.data.images.load(str(ROOT/'world-map/source/textures'/source));image.pack()
 for name in names:
  material=mats[name];tex=material.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
  bs=shader(material);material.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
  if name=='dark':bs.inputs['Base Color'].default_value=(.07,.065,.07,1)
  if name=='dark':
   mix=material.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=(.18,.15,.16,1)
   material.node_tree.links.new(tex.outputs['Color'],mix.inputs[1]);material.node_tree.links.new(mix.outputs[0],bs.inputs['Base Color'])

def add_uv(me):
 uv=me.uv_layers.new(name='SurfaceUV')
 if me.materials[0].name=='bough':
  for poly,coords in zip(me.polygons,bough_uvs):
   for li,coord in zip(poly.loop_indices,coords):uv.data[li].uv=coord
  return
 for poly in me.polygons:
  normal=poly.normal
  for loop in poly.loop_indices:
   co=me.vertices[me.loops[loop].vertex_index].co
   scale=.23 if me.materials[0].name in ['rock','rockLight','dark'] else .5
   uv.data[loop].uv=(co.x*scale,co.y*scale) if abs(normal.z)>.55 else (co.x*scale if abs(normal.y)>abs(normal.x) else co.y*scale,co.z*scale)


def flush(prefix,parent=None):
 for name,(vs,fs) in batches.items():
  if not fs:continue
  me=bpy.data.meshes.new(prefix+'_'+name);me.from_pydata(vs,[],fs);me.materials.append(mats[name]);me.update();add_uv(me)
  ob=bpy.data.objects.new(prefix+'_'+name,me);bpy.context.collection.objects.link(ob);ob.parent=parent
flush('Realm')
# Named, locally authored ships animate as whole objects, including sails, mast and hull.
ships=[]
for idx,(x,y,a,scale) in enumerate([(-18.4,-14.1,.3,1.15),(-20.1,-11.4,1.1,1.0),(-15.7,-17.2,-.45,1.2),(14,-9,.4,1.0)]):
 batches={};bough_uvs=[]
 root=bpy.data.objects.new('Ship_'+str(idx),None);bpy.context.collection.objects.link(root);root.location=(x,y,.24);root.rotation_euler.z=a;root.scale=(scale,scale,scale)
 vs=[(-.16,-.75,-.15),(.16,-.75,-.15),(-.21,.48,-.15),(.21,.48,-.15),(-.35,-.65,.18),(.35,-.65,.18),(-.32,.48,.18),(.32,.48,.18),(0,.94,.18),(0,.6,-.12)]
 mesh('wood',vs,[(0,1,3,9,2),(0,4,5,1),(0,2,6,4),(1,5,7,3),(2,9,8,6),(9,3,7,8),(4,6,8,7,5)])
 box('roofGold',0,0,.2,.60,1.10,.08);cone('wood',0,.05,.2,.035,1.65,8,top=.02)
 box('wood',0,.05,1.59,1.05,.035,.035)
 # A curved double-sided cloth, not a single flat rectangle.
 vs=[]
 for j in range(6):
  for i in range(7):
   u=i/6;v=j/5;vs.append(((u-.5)*.96,.05+.20*math.sin(u*math.pi)*math.sin(v*math.pi),.54+v*1.04))
 fs=[]
 for j in range(5):
  for i in range(6):k=j*7+i;fs.extend([(k,k+1,k+8,k+7),(k+7,k+8,k+1,k)])
 mesh('plaster',vs,fs);cone('gold',0,.05,1.85,.055,.11,6)
 flush('ShipPart'+str(idx),root);ships.append(root.name)
# Blender source includes a useful native preview rig.
bpy.ops.object.light_add(type='SUN',location=(-10,-10,20));bpy.context.object.rotation_euler=(.4,-.5,-.3);bpy.context.object.data.energy=2
bpy.ops.object.camera_add(location=(-5,-38,32));cam=bpy.context.object;cam.rotation_euler=(Vector((0,1,1))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=52;bpy.context.scene.camera=cam
bpy.context.scene.render.engine='CYCLES';bpy.context.scene.cycles.samples=16
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'world-map/source/northern-realms.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'northern-realms.glb'),export_format='GLB',export_cameras=False,export_lights=False,export_yup=True)
metadata={'version':2,'roads':roadMeta,'nodes':[{**n,'height':roadheight(*point(n['x'],n['y']))+.08} for n in layout['nodes']],'smoke':smoke,'scale':22,'ships':ships,'volcano':[15.1,8.8,-12.3],'camera':{'target':[0,1.5,0],'radius':29},'shoreMaskExtent':64}
(OUT/'world-meta.json').write_text(json.dumps(metadata))
print('WORLD_EXPORT_COMPLETE',len(bpy.data.objects),sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type=='MESH'))
if '--encounters' not in sys.argv:sys.exit(0)
# Two small Blender-authored encounter arenas share the world's materials and trees.
for arena in ['moss-hollow','tide-cove']:
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);batches={};bough_uvs=[]
 def height(x,y):return .08
 for i in range(100):
  for j in range(100):
   x=(i-50)*.35;y=(j-50)*.35;z=.08 if abs(x)<4.5 and abs(y)<4.5 else .08+.06*math.sin(x)*math.cos(y)
   n='grass' if arena=='moss-hollow' else 'road'
   if arena=='tide-cove' and x>5.8+math.sin(y*.3):z=-.45;n='rockLight'
   mesh(n,[(px,py,.08 if abs(px)<4.5 and abs(py)<4.5 else -.45 if arena=='tide-cove' and px>5.8+math.sin(py*.3) else .08+.06*math.sin(px)*math.cos(py)) for px,py in [(x,y),(x+.35,y),(x+.35,y+.35),(x,y+.35)]],[(0,1,2),(0,2,3)])
 box('grass' if arena=='moss-hollow' else 'road',0,0,-.38,200,200,.2)
 for i in range(240):
  x=random.uniform(-14,14);y=random.uniform(-13,14)
  if (abs(x)>5.5 or y>5.5) and (arena=='moss-hollow' or x<3):tree(x,y,random.uniform(1.1,2.4))
 for x,y in [(-1.5,3.5),(1.5,3.5),(-3.5,1.5),(3.5,1.5)]:tree(x+.3,y+.28,.95)
 for i in range(450):
  x=random.uniform(-13,13);y=random.uniform(-12,14)
  if abs(x)<3 and abs(y)<4:continue
  if arena=='tide-cove' and x>5.5+math.sin(y*.3):continue
  cone('rockLight' if i%3==0 else 'meadow',x,y,.08,random.uniform(.04,.15),random.uniform(.08,.2),5,top=.02)
 for i in range(12):
  x=(-1)**i*random.uniform(4.4,5.3);y=random.uniform(-4,5)
  cone('stone',x,y,.08,.23,.6,6,top=.17)
 for name,(vs,fs) in batches.items():
  if not fs:continue
  me=bpy.data.meshes.new(arena+'_'+name);me.from_pydata(vs,[],fs);me.materials.append(mats[name]);me.update();add_uv(me)
  ob=bpy.data.objects.new(arena+'_'+name,me);bpy.context.collection.objects.link(ob)
 bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/f'world-map/source/{arena}.blend'))
 bpy.ops.export_scene.gltf(filepath=str(OUT/f'{arena}.glb'),export_format='GLB',export_yup=True)
