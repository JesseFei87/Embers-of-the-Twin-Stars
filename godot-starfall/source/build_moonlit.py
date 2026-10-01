"""Moonlit Pass: original Blender environment matching the approved HD-2D concept.
Run with Blender --background --factory-startup --python source/build_moonlit.py.
Reuses packed Starfall materials and its original pine construction function.
World: metres, +Y north, Z up. glTF performs the Godot axis conversion.
"""
import ast, bpy, math, random, json, struct
import numpy as np
from pathlib import Path
from mathutils import Vector, Matrix
ROOT = Path(__file__).resolve().parents[1]
rng = random.Random(260917)
MAP=['gggggggggggg', 'ggfgggrggggg', 'ggfffggggsgg', 'ggffmggffggg', 'gggmmgrffggg', 'wwwwbbbrwwww', 'ggggrrgggggg', 'ggffrrgmfggg', 'ggggrrfffggg', 'ggggrrgggggg', 'gggssssssggg', 'gggssssssggg']
OUT=ROOT/'evidence/moonlit'; OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
# Append the real source materials, including packed texture images, without copying Starfall terrain.
with bpy.data.libraries.load(str(ROOT/'source/Starfall_Bridge.blend'),link=False) as (src,dst):
    dst.materials=list(src.materials)
stone=bpy.data.materials['weathered_limestone'];darkstone=bpy.data.materials['river_slate']
wood=bpy.data.materials['aged_oak'];bark=bpy.data.materials['pine_bark'];ground=bpy.data.materials['moss_earth']
grassmat=bpy.data.materials['fern_green'];leaf=bpy.data.materials['pine_needles'];bough=bpy.data.materials['Pine bough alpha cutout']
metal=bpy.data.materials['oxidized_bronze'];flower=bpy.data.materials['ivory_wildflowers'];goldflower=bpy.data.materials['golden_meadow_flowers']
# Import only reusable function definitions. Never execute the Starfall world builder.
source=ast.parse((ROOT/'source/build_starfall.py').read_text())
collections={}
for node in source.body:
    if isinstance(node,ast.FunctionDef) and node.name in {'group','finish','uv_project','mesh','box','cylinder','beam','pine','plain'}:
        exec(compile(ast.Module(body=[node],type_ignores=[]),'<starfall shared geometry>','exec'))

def height(x,y):
    return max(0,min(1,(y-2)/4))*.45+.045*math.sin(x*.7)*math.cos(y*.6)

# Batched chamfered geometry keeps the source editable by architectural component.
batches={}
def put(name,vs,fs,mat):
    key=(name,mat.name)
    if key not in batches:batches[key]=[[],[],mat]
    v,f,_=batches[key];offset=len(v);v.extend(vs);f.extend([tuple(i+offset for i in face) for face in fs])
bpy.ops.mesh.primitive_cube_add(size=1)
proto=bpy.context.object
mod=proto.modifiers.new('Chipped bevel','BEVEL');mod.width=.065;mod.segments=1
bpy.context.view_layer.objects.active=proto;bpy.ops.object.modifier_apply(modifier=mod.name)
CUBE_V=[tuple(v.co) for v in proto.data.vertices];CUBE_F=[tuple(p.vertices) for p in proto.data.polygons]
bpy.data.objects.remove(proto,do_unlink=True)
def block(name,loc,size,mat,rot=0):
    ca,sa=math.cos(rot),math.sin(rot);vs=[]
    for vx,vy,vz in CUBE_V:
        x,y=vx*size[0],vy*size[1]
        vs.append((loc[0]+x*ca-y*sa,loc[1]+x*sa+y*ca,loc[2]+vz*size[2]))
    put(name,vs,CUBE_F,mat)
def rod(name,a,b,r,mat,n=8,r2=None):
    a,b=Vector(a),Vector(b);axis=(b-a).normalized();u=axis.cross(Vector((0,0,1)))
    if u.length<.01:u=Vector((1,0,0))
    u.normalize();v=axis.cross(u);vs=[]
    for center,rr in [(a,r),(b,r if r2 is None else r2)]:
        for j in range(n):vs.append(center+(u*math.cos(j*math.tau/n)+v*math.sin(j*math.tau/n))*rr)
    fs=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]
    fs += [(j,(j+1)%n,(j+1)%n+n,j+n) for j in range(n)]
    put(name,vs,fs,mat)
def ring(name,cx,cy,z,inner,outer,depth,mat,segments=48,start=0,end=math.tau):
    for j in range(segments):
        a=start+(end-start)*j/segments+.006;b=start+(end-start)*(j+1)/segments-.006
        vs=[(cx+r*math.cos(t),cy+r*math.sin(t),zz) for zz in (z-depth,z) for r,t in [(inner,a),(outer,a),(outer,b),(inner,b)]]
        put(name,vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat)
# New basalt has original granular pixel maps, not a painted scene or baked lighting.
def basalt_material(name,tint):
    n=256;nr=np.random.default_rng(sum(map(ord,name)));yy,xx=np.mgrid[:n,:n]
    grain=np.repeat(np.repeat(nr.random((64,64)),4,0),4,1)
    layers=.5+.15*np.sin(yy*.11+np.sin(xx*.037)*1.4)+.25*grain
    pits=(nr.random((n,n))>.98)*.23
    albedo=np.ones((n,n,4),dtype=np.float32);albedo[:,:,:3]=np.array(tint)[None,None,:]*(.73+layers[:,:,None]*.42-pits[:,:,None])
    mat=plain(name,tint);bs=mat.node_tree.nodes.get('Principled BSDF')
    for suffix,arr,noncolor in [('albedo',albedo,False)]:
        im=bpy.data.images.new(name+'_'+suffix,width=n,height=n,alpha=True);im.pixels.foreach_set(arr.ravel());im.filepath_raw=str(ROOT/'assets/textures'/f'{name}_{suffix}.png');im.file_format='PNG';im.save();im.pack()
        tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=im;tex.interpolation='Closest';mat.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
    return mat
cliffs=[basalt_material('moonlit_basalt_'+str(i),(.28+i*.025,.315+i*.025,.365+i*.025)) for i in range(4)]
silver=plain('moon_silver_inlay',(.23,.28,.34))
violet=plain('moonlit_amethyst',(.29,.055,.52),1.2)
coal=plain('brazier_coals',(.85,.17,.013),3.2)
moonflower=plain('moonlit_white_petals',(.28,.32,.36))

def rock_noise(u,v):
    from mathutils import noise
    return (.70*noise.noise(Vector((u,v,7.31)),noise_basis='PERLIN_ORIGINAL')
            +.30*noise.noise(Vector((u*2.13,v*2.13,3.17)),noise_basis='PERLIN_ORIGINAL'))

def column(x,y,bottom,top,r=.5,name='Canyon basalt',mat=None):
    # One unbroken eroded monolith, never stacked rings or separate stone courses.
    mat=mat or cliffs[1];n=9;levels=12;phase=rng.random()*math.tau;vs=[]
    for k in range(levels+1):
        t=k/levels;zz=bottom+(top-bottom)*t
        for j in range(n):
            a=phase+j*math.tau/n
            radius=r*(1+.19*rock_noise(j*.7+x,t*4+y)+.1*math.sin(t*5))
            vs.append((x+radius*math.cos(a),y+radius*math.sin(a),zz+(.035*math.sin(j*2.7) if k==levels else 0)))
    fs=[tuple(range(n-1,-1,-1)),tuple(range(levels*n,(levels+1)*n))]
    fs.extend((k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j) for k in range(levels) for j in range(n))
    put(name,vs,fs,mat)

def cliff_wall(name,axis,start,end,baseline,facing,top_height,bottom=-4.1):
    # Closed continuous massif: deep vertical joints, inclined bedding and overhangs.
    nu=int((end-start)*4);nv=24 if bottom<-10 else 48;vs=[];fs=[];tops=[]
    joints=[]
    joint=start+1.3
    while joint<end:
        joints.append(joint);joint+=rng.uniform(3.4,6.0)
    for i in range(nu+1):
        u=start+(end-start)*i/nu
        top=top_height(u)+.85*rock_noise(u*.65,2.7)
        tops.append(top)
        for k in range(nv+1):
            t=k/nv;z=bottom+(top-bottom)*t
            broad=1.25*rock_noise(u*.45,z*.32)+.34*rock_noise(u*1.8,z*1.3)
            groove=0.0
            for joint in joints:
                d=abs(u-joint-.10*z-.17*math.sin(z*.8))
                groove+=(.70*math.exp(-d*d/.035)+.35*math.exp(-d*d/.30))*(.6+.4*rock_noise(u*.4,z*.7))
            bedding=.22*math.tanh(rock_noise(u*.23+z*.3,z*1.5)*5)
            overhang=.48*math.exp(-((t-.72)/.16)**2)
            cross=baseline+facing*(broad-groove+bedding+overhang)
            vs.append((cross,u,z) if axis=='y' else (u,cross,z))
    for i in range(nu):
        for k in range(nv):
            a=i*(nv+1)+k;b=a+nv+1
            fs.extend([(a,b,b+1),(a,b+1,a+1)])
    # Rear perimeter closes the solid without dozens of tiny caps on its crest.
    front_count=len(vs)
    for i in range(nu+1):
        u=start+(end-start)*i/nu;cross=baseline-facing*(8.0 if axis=='y' else 4.0)
        vs.extend([(cross,u,bottom),(cross,u,tops[i]-.28)] if axis=='y' else [(u,cross,bottom),(u,cross,tops[i]-.28)])
    top_rows=[]
    cap_steps=24 if axis=='y' else 9
    for i in range(nu+1):
        front=Vector(vs[i*(nv+1)+nv]);back=Vector(vs[front_count+i*2+1])
        row=[i*(nv+1)+nv]
        for k in range(1,cap_steps):
            t=k/cap_steps;p=front.lerp(back,t)
            if axis=='y':
                p.z+=t+math.sin(math.pi*t)*(.8+1.4*rock_noise(p.x*.65,p.y*.6))
            else:p.z+=math.sin(math.pi*t)*(.35+.70*rock_noise(p.x*.8,p.y*.8))
            row.append(len(vs));vs.append(tuple(p))
        row.append(front_count+i*2+1);top_rows.append(row)
    for i in range(nu):
        a=i*(nv+1);b=a+nv+1;c=front_count+i*2;d=c+2
        fs.extend([(a,c,d,b),(c,c+1,d+1,d)])
        for k in range(cap_steps):fs.append((top_rows[i][k],top_rows[i+1][k],top_rows[i+1][k+1],top_rows[i][k+1]))
    fs.append(tuple(list(range(nv+1))+top_rows[0][1:]+[front_count]))
    fs.append(tuple([nu*(nv+1)+k for k in range(nv+1)]+top_rows[-1][1:]+[front_count+nu*2]))
    # Orient all faces consistently after assembling the closed ribbon.
    o=mesh(name,vs,fs,cliffs[1],name,.8)
    import bmesh
    bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
    return [(baseline-facing*1.1,start+(end-start)*i/nu,tops[i]-.08) if axis=='y'
            else (start+(end-start)*i/nu,baseline-facing*1.1,tops[i]-.08) for i in range(0,nu+1,16)]

def fallen_rock(x,y,z,scale):
    # Angular talus from uneven tetrahedral wedges, not beveled cubes.
    vs=[(x+dx*scale,y+dy*scale,z+dz*scale) for dx,dy,dz in
        [(-.7,-.5,-.1),(.65,-.4,-.1),(.55,.6,-.1),(-.6,.5,-.1),(-.3,-.2,.63),(.45,.15,.42),(-.3,.35,.51)]]
    put('Cliff foot angular scree',vs,[(0,3,2,1),(0,1,5,4),(1,2,5),(2,3,6,5),(3,0,4,6),(4,5,6)],cliffs[2])

def terrain(name,x0,x1,y0,y1,zfunc):
    nx=int((x1-x0)*2);ny=int((y1-y0)*2);vs=[];fs=[]
    for j in range(ny+1):
        y=y0+(y1-y0)*j/ny
        for i in range(nx+1):
            x=x0+(x1-x0)*i/nx;vs.append((x,y,zfunc(x,y)))
    for j in range(ny):
        for i in range(nx):
            k=j*(nx+1)+i
            fs.append((k,k+1,k+nx+2,k+nx+1))
    put(name,vs,fs,ground)
terrain('South walkable bank',-12,12,-15,-.42,height)
terrain('North walkable bank',-12,12,2.42,13,height)
terrain('South canyon continuation',-55,55,-65,-14.8,lambda x,y:height(x,y)-.12)
for side in [-1,1]:
    x0,x1=(-55,-10.3) if side<0 else (10.3,55)
    terrain('Outer southern terraces',x0,x1,-65,-.5,lambda x,y:height(x,y)-.2)
    terrain('Outer northern terraces',max(x0,-14),min(x1,14),2.45,13,lambda x,y:height(x,y)-.2)
# The playable bank ends here. The north is a deep ravine, not a flat continuation.
cliff_wall('Northern precipice','x',-19,19,16,1,lambda u:height(u,16)-.10,bottom=-36)
# Bedrock supports form a canyon instead of a floating board. Each shore has deep vertical faces.
for y in [-.55,2.6]:
    for i in range(48):
        x=-17+i*.72
        # Keep the river visible while the main land remains a continuous walk surface.
        z=height(x,y)
        column(x,y,-3.8,z,.52,'Riverbank fractured ledges')
for side in [-1,1]:
    for j in range(26):
        y=-12+j*.93
        if -.7<y<2.8:continue
        x=side*(12.2+.45*math.sin(y*.6))
        column(x,y,-4,height(x,y)+rng.uniform(.05,.30),.62,'Outer bank cliffs')
# Tall continuous cliff faces, with a descending west ridge opening onto the night sky.
cliff_wall('West canyon wall','y',-65,18,-15,1,
           lambda u:max(1.8,8.8+1.4*math.sin(u*.31)-max(0,u-3)*.62))
cliff_wall('East canyon wall','y',-65,19,14.9,-1,
           lambda u:max(1.8,9.0+1.7*math.sin(u*.26+1)-max(0,u-17)*.28))
for side in [-1,1]:
    for i in range(115):
        y=rng.uniform(-13,15);x=side*rng.uniform(12.8,14.4)
        fallen_rock(x,y,height(x,y)-.10,rng.uniform(.12,.68))
# Three world-space matte ranges sit across the ravine, with real parallax.
# Their alpha skyline contains fine rocky peaks and rooted pine forests; outer
# ends curve away and remain outside every supported camera frustum.
mountain_image=bpy.data.images.load(str(ROOT/'assets/textures/moonlit_distant_mountains.png'));mountain_image.pack()
# Lift the further ranges proportionally so the forest band clears the cliff
# in the overview, while retaining the lower western skyline around the moon.
for layer,(cy,half_width,top,high) in enumerate([(42,110,37,73),(78,165,40,110),(125,240,47,160)]):
    mat=plain('distant_panorama_'+str(layer),(.2,.3,.4));bs=mat.node_tree.nodes.get('Principled BSDF')
    tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=mountain_image;tex.extension='EXTEND'
    mat.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
    mat.node_tree.links.new(tex.outputs['Alpha'],bs.inputs['Alpha'])
    mat.surface_render_method='DITHERED';mat.use_backface_culling=False
    vs=[];fs=[];segments=80
    for i in range(segments+1):
        x=-half_width+2*half_width*i/segments
        y=cy+.002*x*x
        skyline_top=top-[41,44,47][layer]*max(0,min(1,(-x-5)/45))
        vs.extend([(x,y,-220),(x,y,skyline_top-high),(x,y,skyline_top)])
    for i in range(segments):
        for row in range(2):fs.append((i*3+row,i*3+3+row,i*3+4+row,i*3+1+row))
    obj=mesh('Distant mountain panorama '+str(layer),vs,fs,mat,'Distant mountain panorama '+str(layer))
    for face in obj.data.polygons:
        for loop in face.loop_indices:
            vertex=obj.data.loops[loop].vertex_index
            u=(vertex//3)/segments
            if layer==1:u=1-u
            obj.data.uv_layers.active.data[loop].uv=(u,1 if vertex%3==2 else 0)
# North-west scout terrace; a slope on its eastern side keeps the mountain tiles traversable.
terrain('Scout terrace slope',-7,-2.8,2.7,6,lambda x,y:height(x,y)+.95*max(0,min(1,(-x-2.8)/2)))
for x in np.arange(-7,-3.3,.66):column(float(x),2.6,-2.5,height(x,2.6)+.85,.47,'Scout terrace escarpment')
# Main broad stone road follows original terrain through to the altar.
def pave(name,cx,cy,width,length,zfunc,angle=0,step=.42):
    nx=max(1,int(width/.46));ny=max(1,int(length/step));ca,sa=math.cos(angle),math.sin(angle)
    for j in range(ny):
        for i in range(nx):
            xx=(i-(nx-1)/2)*width/nx+(j%2)*.08;yy=(j-(ny-1)/2)*length/ny
            x=cx+xx*ca-yy*sa;y=cy+xx*sa+yy*ca;z=zfunc(x,y)
            block(name,(x+rng.uniform(-.025,.025),y+rng.uniform(-.025,.025),z),(rng.uniform(.37,.45),rng.uniform(.30,.37),rng.uniform(.075,.12)),stone,rng.uniform(-.085,.085)+angle)
pave('South cobbled causeway',-1,-5.8,3.9,10.1,lambda x,y:height(x,y)+.055)
pave('North cobbled causeway',.3,4.0,3.4,3.5,lambda x,y:height(x,y)+.055)
pave('Altar approach paving',4.0,5.7,2.7,6.8,lambda x,y:height(x,y)+.055,angle=-1.05)
# Original road cell (6,3) is a rock shelf beside the bridge, never an invisible floor.
for y in np.arange(-.6,2.7,.55):
    for x in [2.6,3.35]:column(x,float(y),-3.7,height(x,y)-.015,.48,'East crossing rock shelf')
pave('East crossing stone apron',3,1,1.9,3.4,lambda x,y:height(x,y)+.055)
# Central timber bridge: all three original b tiles across, no overhead obstacle.
for x in [-3.55,-2.3,-1,.3,1.55]:block('Bridge oak bearers',(x,1,-.23),(.28,3.9,.47),wood)
for j in range(19):
    y=-.56+j*.18
    block('Bridge individual planks',(-1,y,.055),(6.05+rng.uniform(-.1,.1),.165,.15),wood,rng.uniform(-.006,.006))
    for x in [-3.65,1.65]:rod('Bridge forged nails',(x,y,.125),(x,y,.145),.025,metal,n=6)
for x in [-4.1,2.1]:
    for y in [-.58,2.58]:
        for j in range(4):block('Bridge abutments',(x,y,-.8+j*.32),(.63,.69,.30),stone)
        block('Bridge abutment coping',(x,y,.39),(.85,.9,.17),stone)
    # Low rails at the outer edge only, keeping unit silhouettes readable.
    for y in [.0,1.0,2.0]:block('Bridge railing posts',(x,y,.43),(.13,.13,.75),wood)
    block('Bridge handrails',(x,1,.8),(.14,3.3,.12),wood)
    rod('Bridge diagonal braces',(x,-.4,-1.2),(x,2.4,-.3),.09,wood)
# Foreground crescent platform: broad squared terrace with ancient circular inlay.
block('Moon terrace foundation',(0,-11.75,-.17),(9.7,4.4,.65),darkstone)
pave('Moon terrace paving',0,-11.65,9.6,4.2,lambda x,y:.195,step=.47)
ring('Moon terrace mosaic rim',0,-12.25,.261,1.19,1.37,.045,darkstone,48)
# A true crescent silhouette from two intersecting circular arcs, lying in the pavement.
def crescent(name,center,r,thickness,mat,vertical=False):
    # Two arcs share their horns. Outer arc wraps left, inner arc curves right of the left rim.
    pts=[]
    for j in range(49):
        a=math.radians(55)+(math.radians(305)-math.radians(55))*j/48
        pts.append((r*math.cos(a),r*math.sin(a)))
    top=(r*math.cos(math.radians(55)),r*math.sin(math.radians(55)))
    bottom=(top[0],-top[1]);cx=r*.58;ri=math.hypot(top[0]-cx,top[1]);a0=math.atan2(bottom[1],bottom[0]-cx)
    for j in range(1,48):
        a=a0-(math.tau-2*abs(a0))*j/48
        pts.append((cx+ri*math.cos(a),ri*math.sin(a)))
    vs=[]
    for d in [-thickness/2,thickness/2]:
        for x,y in pts:vs.append((center[0]+x,center[1]+d,center[2]+y) if vertical else (center[0]+x,center[1]+y,center[2]+d))
    n=len(pts);fs=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]+[(j,(j+1)%n,(j+1)%n+n,j+n) for j in range(n)]
    put(name,vs,[tuple(reversed(f)) for f in fs] if vertical else fs,mat)
crescent('Southern silver crescent',(0,-12.25,.28),1.0,.04,silver)
for j in range(5):block('South entrance steps',(0,-14.2-j*.31,.13-j*.14),(4.5,.36,.25),stone)
for side in [-1,1]:
    for i in range(5):block('Terrace parapet',(side*(2.8+i*.49),-13.5,.43),(.44,.50,.60),stone)
# Northern ritual dais: concentric individually cut masonry and stairs, weathered arch, moon hanging in aperture.
for outer,z in [(3.05,.62),(2.79,.83),(2.53,1.04),(2.27,1.28)]:
    ring('Altar concentric steps',7,7,z,.02,outer,.23,stone,32)
ring('Altar dark ritual ring',7,7,1.306,1.46,1.70,.035,darkstone,40)
ring('Altar silver runic circle',7,7,1.327,1.48,1.53,.018,silver,40)
for j in range(12):
    a=j*math.tau/12
    block('Altar radial rune',(7+1.88*math.cos(a),7+1.88*math.sin(a),1.32),(.045,.24,.022),silver,a)
for x in [5.16,8.84]:
    for j in range(7):block('Moon gate upright',(x,8.35,1.45+j*.38),(.54,.60,.35),stone,rot=rng.uniform(-.015,.015))
    block('Moon gate capitals',(x,8.35,4.02),(.78,.78,.20),stone)
for j in range(14):
    # Leave the upper keystone missing, an unmistakable broken arch.
    if j in [6,7]:continue
    a=j*math.pi/14+.01;b=(j+1)*math.pi/14-.01
    vs=[(7+r*math.cos(t),yy,3.93+r*math.sin(t)) for yy in [8.02,8.68] for r,t in [(1.62,a),(2.05,a),(2.05,b),(1.62,b)]]
    put('Broken moon gate arch',vs,[(1,2,3,0),(7,6,5,4),(4,5,1,0),(5,6,2,1),(6,7,3,2),(7,4,0,3)],stone)
crescent('Suspended ritual crescent',(7,8.26,3.83),.91,.14,silver,vertical=True)
for x in [4.3,9.7]:
    block('Altar obelisk bases',(x,8.25,.75),(.83,.8,.40),darkstone)
    rod('Altar broken obelisks',(x,8.25,.9),(x,8.25,3.45),.30,darkstone,n=4,r2=.20)
    for j in range(6):
        block('Obelisk amethyst glyphs',(x,7.998,1.25+j*.30),(.08,.012,.17),violet,rot=.12*j)
    rod('Altar amethyst crown',(x,8.25,3.42),(x,8.25,3.80),.16,violet,n=5,r2=0)
# Ruined fluted columns establish scale and repeat the architecture in the concept.
def ruin(x,y,h,col='Ruined roadside columns'):
    z=height(x,y)
    block(col+' plinth',(x,y,z+.19),(.9,.9,.38),stone)
    rod(col,(x,y,z+.35),(x,y,z+h),.31,stone,n=10,r2=.27)
    for j in range(8):
        a=j*math.tau/8;rod(col+' fluting',(x+.295*math.cos(a),y+.295*math.sin(a),z+.50),(x+.27*math.cos(a),y+.27*math.sin(a),z+h-.1),.026,darkstone,n=5)
    block(col+' fractured cap',(x+.04,y,z+h),(.68,.65,.20),stone,rot=.10)
for x,y,h in [(-4.35,-11.2,2.1),(4.7,-11.3,2.6),(-3.7,-3.4,1.5),(3.7,-3,1.7),(-5.8,5.4,1.6),(-3.2,5.5,1.2),(9.5,3.5,1.5)]:ruin(x,y,h)
# Braziers share Starfall stone/bronze, new open geometry supports animated Godot flames.
lamps=[]
for x,y,z in [(-4.1,-.6,.45),(2.1,-.6,.45),(-4.1,2.6,.50),(2.1,2.6,.50),(-3.5,-12.2,.25),(3.5,-12.2,.25),(4.2,5.35,.65),(9.8,5.35,.65)]:
    rod('Brazier stone shafts',(x,y,z),(x,y,z+.65),.21,stone,n=8)
    rod('Bronze fire bowls',(x,y,z+.65),(x,y,z+.86),.19,metal,n=10,r2=.33)
    rod('Glowing coals',(x,y,z+.85),(x,y,z+.89),.28,coal,n=9)
    for j in range(5):
        a=j*math.tau/5;rod('Brazier basket prongs',(x+.30*math.cos(a),y+.30*math.sin(a),z+.79),(x+.34*math.cos(a),y+.34*math.sin(a),z+1.04),.025,metal,n=5)
    lamps.append([x,z+1.05,-y])
# Distant west viaduct across the waterfall cleft, scenery only.
for x in [-19,-16.5,-14,-11.5]:
    for j in range(8):block('Distant abandoned viaduct',(x,12.8,-1+j*.42),(.62,.95,.39),darkstone)
    block('Distant viaduct battlement',(x,12.8,2.6),(.85,1.2,.36),stone)
for cx in [-17.75,-15.25,-12.75]:
    for j in range(12):
        a=j*math.pi/12+.012;b=(j+1)*math.pi/12-.012
        vs=[(cx+r*math.cos(t),y,.50+r*math.sin(t)) for y in [12.3,13.3] for r,t in [(1.02,a),(1.38,a),(1.38,b),(1.02,b)]]
        put('Distant viaduct arches',vs,[(1,2,3,0),(7,6,5,4),(4,5,1,0),(5,6,2,1),(6,7,3,2),(7,4,0,3)],stone)
    block('Distant viaduct deck',(cx,12.8,2.2),(2.55,1.1,.40),darkstone)
# Scattered fractured rocks and roots, larger masses first, then fine debris.
for i in range(380):
    x=rng.uniform(-11,11);y=rng.uniform(-10,12)
    if -.9<y<3 or (abs(x+1)<2.2 and y<2) or (x>3 and y>4):continue
    block('Loose canyon stones',(x,y,height(x,y)+.05),(rng.uniform(.15,.65),rng.uniform(.12,.52),rng.uniform(.10,.27)),rng.choice(cliffs),rng.random()*math.tau)
# Reuse the actual multi-tier needle-spray pine construction from Starfall.
for x,y,s in [(-8,-4,.88),(-6.5,-6,.85),(6,-4,1.0),(8.1,-2,.95),(-8,4,1.02),(-7,8,1.0),(-4.7,8.3,1.03),(2.0,7.8,.78),(7.3,4.3,.65),(9.6,9.8,1.17),(10.7,5,1.05),(3.1,9.8,1.12),(-8.8,11,1.3),(-1.5,11,1.1),(1,12,1.15)]:pine(x,y,s,'Midground fir grove')
# Foreground trees sit outside the four-deployment silhouette corridor.
for x,y,s in [(-8.5,-10.5,1.45),(-10,-7.5,1.35),(9,-9.7,1.45),(11,-6.2,1.5),(-7,-14,1.75),(8,-14,1.8),(-12,-13,1.6),(12,-13,1.7)]:pine(x,y,s,'Foreground framing pines')
# Meadow detail: individual flowers and grass, excluding road, altar and river.
for i in range(12500):
    x=rng.uniform(-10.8,11);y=rng.uniform(-10,12)
    if -.65<y<2.65 or (abs(x+1)<2.1 and y<5.4) or (abs(x)<4.9 and y<-5.5) or ((x-7)**2+(y-7)**2<10):continue
    if 2<x<7 and abs(y-(4.2+.4*x))<1.15:continue
    z=height(x,y)
    if -7<x<-2.8 and 2.7<y<6:z+=.95*max(0,min(1,(-x-2.8)/2))
    a=rng.random()*math.tau;h=rng.uniform(.08,.25);w=.035
    put('Meadow grass',[(x-w,y,z),(x+w,y,z),(x+math.cos(a)*h*.5,y+math.sin(a)*h*.5,z+h)],[(0,1,2)],grassmat)
    if i%3==0:
        h=rng.uniform(.14,.36);vs=[(x,y,z+h+.018)]
        for j in range(8):
            rr=.018 if j%2 else .039;a=j*math.tau/8;vs.append((x+rr*math.cos(a),y+rr*math.sin(a),z+h))
        put('Moonlit wildflower meadows',vs,[(0,j+1,(j+1)%8+1) for j in range(8)],moonflower if i%4 else goldflower)
# Fern fronds break up the floor with a fine, organic silhouette.
for i in range(1250):
    x=rng.uniform(-11,11);y=rng.uniform(-12,14)
    if -.7<y<2.7 or (abs(x+1)<2.2 and y<5.5) or (abs(x)<5 and y<-5.4) or ((x-7)**2+(y-7)**2<11):continue
    z=height(x,y);angle=rng.random()*math.tau
    for frond in range(4):
        a=angle+frond*1.8;length=rng.uniform(.25,.48)
        for k in range(1,7):
            t=k/7;cx=x+math.cos(a)*length*t;cy=y+math.sin(a)*length*t;cz=z+.32*math.sin(t*1.9)
            for side in [-1,1]:
                width=.13*(1-t*.75);dx=math.cos(a+side*1.05)*width;dy=math.sin(a+side*1.05)*width
                put('Canyon fern beds',[(cx,cy,cz),(cx+dx,cy+dy,cz+.03),(cx+math.cos(a)*.06,cy+math.sin(a)*.06,cz+.015)],[(0,1,2)],grassmat)
# Flush batches as named, editable scene meshes with metric UVs.
for (name,matname),(vs,fs,mat) in batches.items():
    mesh(name,vs,fs,mat,name,.8)
# Consolidate only same material in same semantic collection (trees become three meshes per grove).
for cname,col in list(collections.items()):
    bymat={}
    for o in list(col.objects):
        if o.type=='MESH':bymat.setdefault(o.data.materials[0].name,[]).append(o)
    for mat,objs in bymat.items():
        if len(objs)<2:continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:o.select_set(True)
        bpy.context.view_layer.objects.active=objs[0];bpy.ops.object.join();objs[0].name=cname+' '+mat
# Authoring scene includes the same moonlight and warm local lights for Blender inspection.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32
bpy.ops.object.camera_add(location=(1,-29,29.8));cam=bpy.context.object;cam.name='Moonlit reference composition';cam.rotation_euler=(Vector((0,-1,.8))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='PERSP';cam.data.lens=28.65;scene.camera=cam
bpy.ops.object.light_add(type='SUN',location=(-15,-6,25));sun=bpy.context.object;sun.name='Cold moonlight';sun.data.energy=2.0;sun.data.color=(.51,.66,1);sun.rotation_euler=(.42,-.45,-.5);sun.data.angle=.08
for x,z,ny in lamps:
    bpy.ops.object.light_add(type='POINT',location=(x,-ny,z+.15));o=bpy.context.object;o.name='Amber brazier light';o.data.energy=95;o.data.color=(1,.36,.06);o.data.shadow_soft_size=.22
scene.world.color=(.09,.13,.23);scene.render.resolution_x=1600;scene.render.resolution_y=900;scene.render.resolution_percentage=100
# GLB excludes cameras/lights; Godot adds effects and inspection controls.
for im in bpy.data.images:
    if im.has_data:
        im.pack()
        if im.filepath:im.filepath=bpy.path.relpath(im.filepath,start=str(ROOT/'source'))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source/Moonlit_Pass.blend'))
path=ROOT/'assets/models/moonlit_environment.glb'
bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_cameras=False,export_lights=False,export_apply=True)
# Explicit alpha-cut foliage, matching existing Starfall glTF convention.
raw=path.read_bytes();length,kind=struct.unpack_from('<II',raw,12);doc=json.loads(raw[20:20+length])
for mat in doc['materials']:
    if mat['name']=='Pine bough alpha cutout' or mat['name'].startswith('distant_panorama_'):mat['alphaMode']='MASK';mat['alphaCutoff']=.45;mat['doubleSided']=True
payload=json.dumps(doc,separators=(',',':')).encode();payload+=b' '*((-len(payload))%4);binary=raw[20+length:]
path.write_bytes(struct.pack('<III',0x46546C67,2,20+len(payload)+len(binary))+struct.pack('<II',len(payload),0x4E4F534A)+payload+binary)
actors=[]
for name,cls,c,r,h in [('凯尔','sword',4,11,.25),('莱拉','cavalry',5,11,.25),('米菈','lancer',6,11,.25),('诺克斯','raider',7,11,.25),('赛勒涅','mage',9,2,1.35),('艾琳','sword',6,4,0),('峡道重甲','knight',5,5,.15),('暮鸦西','raider',3,4,1),('暮鸦东','raider',8,4,0),('北坡斥候','raider',2,0,0),('祭坛术士','mage',5,1,0)]:
    actors.append({'name':name,'class':cls,'col':c,'row':r,'height':h})
    if name in ['艾琳','祭坛术士']:actors[-1]['sprite']={'艾琳':'eileen','祭坛术士':'altar-mage'}[name]
layout={'mapId':'moonlit-pass','tileSize':2,'rows':MAP,'layoutVersion':2,'origin':[5.5,5.5],'deployment':[[4,11],[5,11],[6,11],[7,11]],'objective':[9,2],'lamps':lamps,'actors':actors,'waterfalls':[{'x':-13.1,'z':-7.5,'top':.15,'bottom':-1.25,'width':1.7},{'x':-14,'z':-11,'top':2.0,'bottom':.15,'width':1.3}], 'reused':['Starfall packed limestone, slate, oak, bark, earth, fern, bronze and pine-needle textures','Original Starfall multi-tier pine geometry function'],'new':['Stratified basalt cliff modules and granular textures','Three-lane timber bridge and abutments','Crescent entry terrace, ruined columns','Circular ritual altar, broken arch, crescent sculpture, glyph obelisks','Bronze braziers, distant viaduct, canyon roots and meadow dressing']}
# Cell-center elevations are presentation data consumed by Godot picking/collision.
cell_heights=[]
for r,row in enumerate(MAP):
    values=[]
    for c,t in enumerate(row):
        x=(c-5.5)*2;y=(5.5-r)*2;h=height(x,y)+.06
        if -7<=x<=-2.8 and 2.7<=y<=6:h+=.95*max(0,min(1,(-x-2.8)/2))
        if t=='w':h=-2.4
        if t=='b':h=.13
        if abs(x)<=4.8 and -13.8<=y<=-9.6:h=.245
        dist=math.hypot(x-7,y-7)
        for radius,level in [(3.05,.62),(2.79,.83),(2.53,1.04),(2.27,1.28)]:
            if dist<radius:h=level
        values.append(round(h,4))
    cell_heights.append(values)
layout['cell_heights']=cell_heights
for actor in layout['actors']:actor['height']=cell_heights[actor['row']][actor['col']]
(ROOT/'assets/moonlit-layout.json').write_text(json.dumps(layout,ensure_ascii=False,indent=2))
report={'objects':len([o for o in scene.objects if o.type=='MESH']),'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in scene.objects if o.type=='MESH'),'materials':len(doc['materials']),'packedImages':len(doc.get('images',[])),'seed':260917,'glbBytes':path.stat().st_size}
(OUT/'asset-build.json').write_text(json.dumps(report,indent=2));print('MOONLIT_ASSETS_COMPLETE',report)
