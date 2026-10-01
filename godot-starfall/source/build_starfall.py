"""Original Starfall Bridge environment. Blender 4.5; deterministic, no external assets.
Run: Blender --background --factory-startup --python source/build_starfall.py
Coordinates: Blender Z up; north +Y. Export glTF -> Godot Y up, north -Z.
"""
import bpy, math, random, json
import numpy as np
from pathlib import Path
from mathutils import Vector
ROOT = Path(__file__).resolve().parents[1]
rng = random.Random(17093)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for d in list(bpy.data.materials): bpy.data.materials.remove(d)
MAP = ['ggggffffgg','gggffmffgg','ggggmmfggg','wwwwbbwwww','ggggrrgggg','gffgrrggfg','ggggrrffgg','ggggssgggg']
# All new images are original repeatable procedural texture assets, not painted lighting.
def image(name, values, data=False):
    n=values.shape[0]; im=bpy.data.images.new(name,width=n,height=n,alpha=True)
    if data: im.colorspace_settings.name='Non-Color'
    im.pixels.foreach_set(values.astype(np.float32).ravel()); im.filepath_raw=str(ROOT/'assets/textures'/f'{name}.png'); im.file_format='PNG'; im.save(); return im

def material(name, base, kind='stone', rough=.85):
    n=256; y,x=np.mgrid[0:n,0:n]; nr=np.random.default_rng(sum(map(ord,name)))
    grain=nr.random((n//4,n//4)); grain=np.repeat(np.repeat(grain,4,0),4,1)
    h=.45+.18*grain+.06*np.sin(x*.19)*np.cos(y*.17)
    if kind=='stone':
        seam=(y%64<3)|((x+(y//64%2)*32)%64<3); h[seam]=.12
    elif kind=='wood':
        h=.45+.15*np.sin(x*.24+np.sin(y*.055))+.1*grain; h[x%64<3]=.1
    elif kind=='bark': h=.35+.2*np.sin(x*.37+np.sin(y*.04)*2)+.2*grain
    elif kind=='grass': h=.32+.30*grain+.20*np.sin(x*.037+np.sin(y*.055))*np.cos(y*.061)
    elif kind=='leaf': h=.3+.3*grain+.1*np.sin(x*.5+y*.4)
    rgba=np.ones((n,n,4)); rgba[:,:,:3]=np.array(base)[None,None,:]*(.70+h[:,:,None]*.52)
    rgba[:,:,:3]=np.clip(rgba[:,:,:3],0,1)**1.6
    col=image(name+'_albedo',rgba)
    dy,dx=np.gradient(h); normals=np.stack((-dx*1.7,-dy*1.7,np.ones_like(h)),axis=2); normals/=np.linalg.norm(normals,axis=2)[:,:,None]
    rgba[:,:,:3]=normals*.5+.5; norm=image(name+'_normal',rgba,True)
    rgba[:,:,:3]=np.clip(rough+(grain[:,:,None]-.5)*.12,0,1); rm=image(name+'_roughness',rgba,True)
    m=bpy.data.materials.new(name); m.use_nodes=True; m.diffuse_color=(*base,1)
    nodes=m.node_tree.nodes; bs=nodes.get('Principled BSDF'); bs.inputs['Roughness'].default_value=rough
    for texture,target,space in [(col,'Base Color',False),(rm,'Roughness',False),(norm,'Normal',True)]:
        t=nodes.new('ShaderNodeTexImage'); t.image=texture; t.interpolation='Closest'
        if space:
            normal=nodes.new('ShaderNodeNormalMap'); normal.inputs['Strength'].default_value=.65
            m.node_tree.links.new(t.outputs['Color'],normal.inputs['Color']); m.node_tree.links.new(normal.outputs[0],bs.inputs[target])
        else: m.node_tree.links.new(t.outputs['Color'],bs.inputs[target])
    return m
stone=material('weathered_limestone',(.52,.50,.40))
darkstone=material('river_slate',(.32,.36,.33),'stone')
wood=material('aged_oak',(.32,.19,.09),'wood')
bark=material('pine_bark',(.23,.16,.11),'bark')
ground=material('moss_earth',(.29,.30,.15),'grass')
grassmat=material('fern_green',(.34,.40,.12),'grass')
leaf=material('pine_needles',(.13,.27,.20),'leaf')
leaflight=material('pine_sun_tips',(.25,.34,.19),'leaf')
roof=material('slate_roof',(.16,.24,.25),'stone')
plaster=material('old_plaster',(.65,.59,.40),'grass')
metal=material('oxidized_bronze',(.38,.32,.16),'stone',.42)

def plain(name,color,emission=0):
    m=bpy.data.materials.new(name); m.use_nodes=True;m.diffuse_color=(*color,1);bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=.85
    if emission: bs.inputs['Emission Color'].default_value=(*color,1);bs.inputs['Emission Strength'].default_value=emission
    return m
warm=plain('lantern_glass',(1,.43,.065),4.2)
crystal=plain('star_crystal',(.04,.40,.50),1.2)
crystal_edge=plain('crystal_facet_edges',(.26,.85,.91),2.6)
flower=plain('ivory_wildflowers',(.92,.86,.62))
goldflower=plain('golden_meadow_flowers',(.88,.48,.055))
violetflower=plain('violet_foxgloves',(.40,.33,.67))

# Original alpha-cut pine bough texture: pixel clusters and needle sprigs.
n=128;yy,xx=np.mgrid[0:n,0:n];rgba=np.zeros((n,n,4),dtype=float)
def needle_line(a,b,width,color):
    ax,ay=a;bx,by=b;dx=bx-ax;dy=by-ay
    t=np.clip(((xx-ax)*dx+(yy-ay)*dy)/(dx*dx+dy*dy),0,1)
    mask=(xx-ax-t*dx)**2+(yy-ay-t*dy)**2<width*width
    rgba[mask,:3]=color;rgba[mask,3]=1
needle_line((64,4),(64,121),1.4,(.12,.19,.08))
for j in range(17):
    y=9+j*6.3;width=49*(1-j/20)
    for side in (-1,1):
        end=(64+side*width,y+12)
        needle_line((64,y-5),end,1.3,(.055,.17,.11))
        for k in range(7):
            t=(k+1)/8;bx=64+side*width*t;by=y-5+17*t
            length=8*(1-t*.25)
            for sign in (-1,1):
                col=(.12+.10*t,.21+.12*t,.205+.11*t)
                needle_line((bx,by),(bx+side*length,by+sign*4+6),1.15,col)
rgba[:,:,:3] = np.clip(rgba[:,:,:3] * np.array([.9, 1.0, .98]), 0, 1)
bough_image=image('pine_bough_cutout',rgba)
bough=bpy.data.materials.new('Pine bough alpha cutout');bough.use_nodes=True;bough.diffuse_color=(.09,.24,.13,1)
bs=bough.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.94
tex=bough.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bough_image;tex.interpolation='Closest'
bough.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color']);bough.node_tree.links.new(tex.outputs['Alpha'],bs.inputs['Alpha'])
bough.use_backface_culling=False

# Groups remain named and editable in the .blend, grouped by composition role.
collections={}
def group(name):
    if name not in collections:
        col=bpy.data.collections.new(name);bpy.context.scene.collection.children.link(col);collections[name]=col
    return collections[name]
def finish(obj,name,mat,col='Landscape'):
    obj.name=name
    if mat: obj.data.materials.append(mat)
    for c in list(obj.users_collection):c.objects.unlink(obj)
    group(col).objects.link(obj)
    return obj

def uv_project(obj,scale=1):
    uv=obj.data.uv_layers.new(name='UVMap')
    for p in obj.data.polygons:
        axis=max(range(3),key=lambda i:abs(p.normal[i]));axes=[i for i in range(3) if i!=axis]
        for loop in p.loop_indices:
            v=obj.data.vertices[obj.data.loops[loop].vertex_index].co
            uv.data[loop].uv=(v[axes[0]]*scale,v[axes[1]]*scale)

def mesh(name,verts,faces,mat,col='Landscape',scale=1):
    m=bpy.data.meshes.new(name);m.from_pydata(verts,[],faces);m.update();o=bpy.data.objects.new(name,m);group(col).objects.link(o);m.materials.append(mat);uv_project(o,scale);return o

def box(name,loc,size,mat,col='Landscape',bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    finish(o,name,mat,col)
    # One shared geometric vocabulary; tiny bevel catches afternoon light.
    if bevel:
        mod=o.modifiers.new('Worn edges','BEVEL');mod.width=bevel;mod.segments=1
        bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
    return o

def cylinder(name,loc,radius,depth,mat,col='Props',vertices=8):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc);return finish(bpy.context.object,name,mat,col)

def beam(name,a,b,radius,mat,col='Props'):
    mid=(Vector(a)+Vector(b))/2;o=cylinder(name,mid,radius,(Vector(b)-Vector(a)).length,mat,col)
    o.rotation_euler=(Vector(b)-Vector(a)).to_track_quat('Z','Y').to_euler();return o

def height(x,y):
    return .32+max(0,min(1,(y-2)/3))*1.3+.05*math.sin(x*.7)*math.cos(y*.6)
# Single continuous bank surfaces, no disconnected elevated gameplay tiles.
for a,b,name in [(-24,0,'South riverbank'),(2,27,'North riverbank')]:
    verts=[];faces=[];nx=80;ny=int((b-a)*2)
    for j in range(ny+1):
        y=a+(b-a)*j/ny
        for i in range(nx+1):
            x=-26+i*52/nx;z=height(x,y)
            z+=max(0,abs(x)-10)*.10+max(0,y-9)*.08
            verts.append((x,y,z))
    for j in range(ny):
        for i in range(nx):
            k=j*(nx+1)+i;faces.append((k,k+1,k+nx+2,k+nx+1))
    mesh(name,verts,faces,ground,'Terrain',.8)
    for y in (a,b):mesh(name+' cliff', [(-26,y,-2),(26,y,-2),(26,y,height(26,y)),(-26,y,height(-26,y))],[(0,1,2,3)],darkstone,'Terrain')
box('Riverbed',(0,1,-.6),(60,3.2,.6),darkstone,'Terrain')
# Masonry at water edge and layered, eroded cliff outcrops.
for y in (-.1,2.15):
    for i in range(53):
        x=-18+i*.69
        if abs(x)<2.05:continue
        box('Bank dressed stone',(x,y,height(x,y)-.22),(.65,.4,.48+rng.random()*.18),darkstone,'Riverbank',.045)
        if i%3==0:box('Moss coping',(x,y+.12,.35+height(x,y)),(.67,.4,.09),ground,'Riverbank',.02)

def rock(x,y,z,s,col='Rocks'):
    # Fractured strata make a rock silhouette, rather than a smooth round lump.
    vs=[];fs=[];phase=rng.random()*math.tau
    radial=[rng.uniform(.80,1.13) for _ in range(7)]
    for level,zz in enumerate([-.35,.16,.63]):
        for i in range(7):
            angle=phase+i*math.tau/7
            radius=radial[i]*(.74 if level==2 else 1)
            vs.append((math.cos(angle)*radius,math.sin(angle)*radius*.72,zz+rng.uniform(-.09,.09)))
    fs.append(tuple(range(6,-1,-1)));fs.append(tuple(range(14,21)))
    for level in range(2):
        for i in range(7):
            j=(i+1)%7;fs.append((level*7+i,level*7+j,(level+1)*7+j,(level+1)*7+i))
    o=mesh('Fractured shale',vs,fs,darkstone,col,.8);o.location=(x,y,z);o.scale=(s,s,s)
    return o
for r,row in enumerate(MAP):
    for c,k in enumerate(row):
        if k=='m':
            for i in range(3):
                side=-1 if c<4.5 else 1
                xx=side*(2.25+i*.4)+rng.uniform(-.2,.2);yy=7-r*2+rng.uniform(-.55,.55)
                rock(xx,yy,height(xx,yy)+.10,.8-i*.08)
for i in range(70):
    x=rng.uniform(-17,17);y=rng.choice([-.35,2.35])+rng.uniform(-.12,.12)
    if abs(x)>2.3:rock(x,y,-.04,rng.uniform(.22,.6),'Riverbank')
for i in range(18):
    x=-20+i*2.5; y=rng.uniform(14,19);rock(x,y,2,rng.uniform(2.4,4.7),'Distant ridge')
for y in (-.18,2.23):
    for i in range(47):
        x=-16+i*.7
        if abs(x)<2.1:continue
        box('Irregular bank coping',(x,y,height(x,y)+.08),(.65+rng.uniform(-.08,.04),.53,.22),stone,'Riverbank',.055)
        if i%2==0:
            rock(x,y+.28,height(x,y)+.17,rng.uniform(.16,.3),'Riverbank')
# Arch bridge: voussoirs are real wedge meshes around a visible river opening.
for x in (-1.92,1.92):
    for i in range(13):
        t0=math.pi*i/13;t1=math.pi*(i+1)/13
        verts=[]
        for xx in (x-.17,x+.17):
            for radius,t in [(1.26,t0),(1.26,t1),(1.57,t1),(1.57,t0)]:verts.append((xx,1+math.cos(t)*radius,-.25+math.sin(t)*radius*.42))
        mesh('Bridge arch voussoir',verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],stone,'Bridge')
for j in range(16):
    y=-.7+j*.22; z=.42+.20*math.sin(j/15*math.pi)
    box('Bridge oak deck',(rng.uniform(-.025,.025),y,z),(3.7,.20,.20),wood,'Bridge',.025)
    for x in (-1.38,1.38):cylinder('Iron deck pin',(x,y,z+.106),.023,.015,metal,'Bridge')
for x in (-2,2):
    for y in (-.6,.45,1.5,2.6):
        z=.55
        box('Parapet pillar',(x,y,z+.43),(.40,.40,.95),stone,'Bridge',.04)
        box('Carved pillar cap',(x,y,z+.94),(.52,.52,.12),stone,'Bridge',.025)
    for y in (-.03,1.04,2.06):
        box('Oak bridge handrail',(x,y,1.32),(.19,.96,.16),wood,'Bridge',.02)
        for course in range(2):
            for section in range(2):
                box('Low stone parapet',(x,y+(section-.5)*.47,.76+course*.24),(.33,.445,.22),stone,'Bridge',.035)
# Stone track on southern two-column road; individual uneven cobbles catch shadows.
for j in range(43):
    y=-13.58+j*.31
    for i in range(8):
        x=-1.7+i*.48+(j%2)*.12;z=height(x,y)+.02+rng.uniform(-.012,.012)
        box('Road cobble',(x+rng.uniform(-.025,.025),y,z),(.42+rng.uniform(-.045,.025),.265+rng.uniform(-.02,.012),.07),stone,'Causeway',.025)
        bpy.context.object.rotation_euler.z=rng.uniform(-.07,.07)
for j in range(10):
    y=2.7+j*.48
    for x in (-1.25,-.4,.45,1.3):
        if y>4.0 and y<6:continue
        box('North path cobble',(x,y,height(x,y)+.025),(.79,.4,.10),stone,'Causeway',.035)
# Dense multi-tier pines: asymmetric radial boughs, bark trunk and sunlit tip geometry.
def pine(x,y,scale=1,col='Pine forest'):
    z=height(x,y)
    cylinder('Pine trunk',(x,y,z+1.85*scale),.10*scale,3.7*scale,bark,col)
    verts=[];faces=[];uvs=[]
    def spray(center,angle,length,width,droop):
        along=Vector((math.cos(angle),math.sin(angle),0))
        across=Vector((-math.sin(angle),math.cos(angle),0))
        base=Vector(center);k=len(verts)
        # Fold each needle spray along its spine so it catches light in volume.
        for t,side,lift in [(0,-1,0),(0,0,.075),(0,1,0),(1,-.30,-droop),(1,0,-droop+.045),(1,.30,-droop)]:
            verts.append(base+along*length*t+across*width*side+Vector((0,0,lift*scale)))
        faces.extend([(k,k+3,k+4,k+1),(k+1,k+4,k+5,k+2)])
        uvs.extend([[(0,0),(0,1),(.5,1),(.5,0)],[(.5,0),(.5,1),(1,1),(1,0)]])
    phase=rng.random()*math.tau
    for layer in range(11):
        t=layer/11;radius=(1.25*(1-t)**.85+.08)*scale
        level=z+(.62+layer*.30)*scale
        phase+=2.4
        for k in range(8):
            angle=phase+k*math.tau/8+rng.uniform(-.12,.12)
            length=radius*rng.uniform(.78,1.16)
            direction=Vector((math.cos(angle),math.sin(angle),0))
            origin=Vector((x,y,level+rng.uniform(-.08,.08)*scale))
            spray(origin,angle,length,.22*length,.22)
            for j in range(1,4):
                center=origin+direction*(length*j*.22)-Vector((0,0,j*.045*scale))
                for side in (-1,1):
                    spray(center,angle+side*.65,length*(.57-j*.075),length*(.24-j*.025),.16+rng.random()*.13)
    o=mesh('Needle cutout branches',verts,faces,bough,col)
    for poly,coords in zip(o.data.polygons,uvs):
        for li,uv in zip(poly.loop_indices,coords):o.data.uv_layers.active.data[li].uv=uv
    # Small clustered leader keeps the crown irregular all the way to the tip.
    bpy.ops.mesh.primitive_cone_add(vertices=7,radius1=.035*scale,radius2=0,depth=.25*scale,location=(x,y,z+3.84*scale))
    finish(bpy.context.object,'Pine leader',leaf,col)
positions=[]
for r,row in enumerate(MAP):
    for c,k in enumerate(row):
        if k=='f':positions.append(((c-4.5)*2+rng.uniform(-.3,.3),7-r*2+rng.uniform(-.35,.35),rng.uniform(.72,1.04)))
for i in range(205):
    x=rng.uniform(-23,23);y=rng.uniform(-16,23)
    if abs(x)<10 and y<9:continue
    if -.9<y<3:continue
    positions.append((x,y,rng.uniform(1.0,1.9)))
# Additional irregular forest masses frame the path without hiding the cast.
for x,y,s in [(-10,1,1.45),(-10,-3,1.3),(-7,-2,1.05),(-7,-5,.95),(-9,-8,1.2),(6,-3,.8),(8,-4,1.05),(10,-8,1.2),(-11,8,1.4),(-4,7,1.12),(5.5,7,.85),(7,6,1.15),(-2,12,1.6),(3,13,1.7),(-8,13,1.7)]: positions.append((x,y,s))
# Avoid geometry poking through the lodge or hiding the gate opening.
positions=[(x,y,s*.80 if y<0 else s) for x,y,s in positions if not (-9.5<x<-5.2 and 3.6<y<7.4) and not (abs(x)<3.2 and 6.5<y<11.0) and not (1.5<x<4.5 and y<-.5)]
# Foreground trees create the close, softly focused forest frame of the reference.
positions.extend([(-10,-10,1.6),(-7.8,-12,1.4),(8.5,-11,1.5),(11,-7,1.65),(-8,10,1.55)])
for x,y,s in positions:pine(x,y,s)
# Ground dressing, batched fern blades instead of thousands of draw calls.
verts=[];faces=[]
for i in range(12500):
    x=rng.uniform(-17,17);y=rng.uniform(-11,14)
    if -.6<y<2.6 or abs(x)<2.2 and y<0:continue
    if abs(x)<3 and y>4 and y<9:continue
    z=height(x,y)+.03
    for j in range(3):
        angle=rng.random()*math.tau;w=.035+rng.random()*.055;h=.09+rng.random()*.18;start=len(verts)
        verts.extend([(x-w*math.cos(angle),y-w*math.sin(angle),z),(x+w*math.cos(angle),y+w*math.sin(angle),z),(x+math.cos(angle)*h*.45,y+math.sin(angle)*h*.45,z+h)])
        faces.append((start,start+1,start+2))
mesh('Ground fern tufts',verts,faces,grassmat,'Undergrowth')
for i in range(75):
    x=rng.choice([-1,1])*rng.uniform(2.5,9);y=rng.uniform(-8,-.8);z=height(x,y)
    if i%3==0:rock(x,y,z,.2,'Undergrowth')
    else:cylinder('Wildflower',(x,y,z+.22),.05,.04,flower,'Undergrowth',5)
# Dense clustered meadow with readable petals, stalks and leaves.
for material_,count in [(flower,1700),(goldflower,2200),(violetflower,550)]:
    vs=[];fs=[];stems=[];stem_faces=[]
    for i in range(count):
        x=rng.uniform(-13,13);y=rng.uniform(-11,12)
        if -.65<y<2.65 or (abs(x)<2.05 and y<0) or (-8.8<x<-4.8 and 3.5<y<7.5):continue
        # Irregular patches rather than evenly scattered dots.
        if math.sin(x*1.7+math.sin(y*1.1))+math.cos(y*1.9)<-.25:continue
        z=height(x,y);h=rng.uniform(.20,.48)
        if material_==violetflower:h*=1.9
        k=len(stems)
        stems.extend([(x-.009,y,z),(x+.009,y,z),(x+.004,y,z+h),(x-.004,y,z+h)])
        stem_faces.append((k,k+1,k+2,k+3))
        for side in (-1,1):
            k=len(stems)
            stems.extend([(x,y,z+h*.3),(x+side*.1,y+.025,z+h*.6),(x+side*.06,y-.025,z+h*.4)])
            stem_faces.append((k,k+1,k+2))
        for level in range(3 if material_==violetflower else 1):
            zz=z+h-level*.10;r=.067 if material_==violetflower else rng.uniform(.05,.085)
            k=len(vs);vs.append((x,y,zz+.016))
            for j in range(8):
                a=j*math.tau/8;rr=r*(1 if j%2==0 else .42);vs.append((x+rr*math.cos(a),y+rr*math.sin(a),zz))
            for j in range(8):fs.append((k,k+1+j,k+1+(j+1)%8))
    mesh('Flower clusters '+material_.name,vs,fs,material_,'Flower meadows')
    mesh('Wildflower stems',stems,stem_faces,grassmat,'Flower meadows')
# Small uneven earth and moss stones break the flat ground at path margins.
for i in range(240):
    x=rng.choice([-1,1])*rng.uniform(2.15,11);y=rng.uniform(-10,11)
    if -.65<y<2.65:continue
    rock(x,y,height(x,y)-.035,rng.uniform(.07,.24),'Meadow stones')
# Northern gate ruin and small caretaker's house are original architecture.
def house(x,y):
    z=height(x,y);w=3.2;d=2.6
    box('Lodge stone foundation',(x,y,z+.25),(w+.25,d+.25,.5),stone,'Bridgekeepers lodge',.07)
    box('Limewashed lodge',(x,y,z+1.45),(w,d,2.1),plaster,'Bridgekeepers lodge',.025)
    for xx in (x-w/2+.1,x,x+w/2-.1):box('Exposed oak frame',(xx,y-d/2-.03,z+1.5),(.14,.12,2.3),wood,'Bridgekeepers lodge')
    for zz in (.5,1.5,2.5):box('Wall crossbeam',(x,y-d/2-.07,z+zz),(w,.16,.13),wood,'Bridgekeepers lodge')
    box('Lodge door',(x-.55,y-d/2-.12,z+.94),(.72,.12,1.38),wood,'Bridgekeepers lodge',.015)
    for xx in (x+.6,x+1.15):
        box('Amber window',(xx,y-d/2-.14,z+1.62),(.43,.08,.65),warm,'Bridgekeepers lodge')
        box('Window mullion',(xx,y-d/2-.2,z+1.62),(.045,.06,.7),wood,'Bridgekeepers lodge')
    # Stone infill is individual chipped masonry between the timber frame.
    for row in range(6):
        for col in range(7):
            xx=x-1.36+col*.43+(row%2)*.10
            zz=z+.67+row*.29
            if abs(xx-(x-.55))<.47 and zz<z+1.7:continue
            if xx>x+.31 and z+1.23<zz<z+2.04:continue
            box('Lodge stone infill',(xx,y-d/2-.045,zz),(.39,.12,.255),stone,'Bridgekeepers lodge',.023)
    for row in range(4):
        for col in range(2):
            box('Chimney masonry',(x+.9+(col-.5)*.25,y+.65,z+2.75+row*.4),(.235,.52,.37),stone,'Bridgekeepers lodge',.022)
    beam('Gable left verge',(x-1.85,y-1.59,z+2.4),(x,y-1.59,z+3.67),.08,wood,'Bridgekeepers lodge')
    beam('Gable right verge',(x,y-1.59,z+3.67),(x+1.85,y-1.59,z+2.4),.08,wood,'Bridgekeepers lodge')
    # Rows of individually raised roof shingles, ridge along Y.
    for side in (-1,1):
        for row in range(6):
            xx=x+side*(.18+row*.32);zz=z+3.5-row*.20
            for j in range(8):
                o=box('Overlapping slate shingle',(xx,y-1.5+j*.43,zz),(.39,.42,.12),roof,'Bridgekeepers lodge',.025);o.rotation_euler.y=side*.55
    for xx in (x-w/2,x+w/2):
        for yy in (y-d/2,y,y+d/2):box('Side wall timber',(xx,yy,z+1.5),(.14,.14,2.2),wood,'Bridgekeepers lodge')
    for yy in (y-.6,y+.35):
        box('Side amber window',(x+w/2+.02,yy,z+1.65),(.06,.65,.73),warm,'Bridgekeepers lodge')
        for dz in (-.42,0,.42):box('Side window crossbar',(x+w/2+.07,yy,z+1.65+dz),(.08,.78,.065),wood,'Bridgekeepers lodge')
        box('Side window mullion',(x+w/2+.07,yy,z+1.65),(.08,.055,.8),wood,'Bridgekeepers lodge')
    mesh('Lodge front gable',[(x-w/2,y-d/2,z+2.5),(x+w/2,y-d/2,z+2.5),(x,y-d/2,z+3.6)],[(0,1,2)],plaster,'Bridgekeepers lodge')
    beam('Gable oak ridge',(x,y-d/2-.06,z+2.5),(x,y-d/2-.06,z+3.55),.08,wood,'Bridgekeepers lodge')
    box('Stone chimney',(x+.9,y+.65,z+3.3),(.48,.48,1.75),stone,'Bridgekeepers lodge',.04)
    for j in range(3):box('Doorstep',(x-.55,y-1.53-j*.25,z+.22-j*.06),(.95,.3,.16),stone,'Bridgekeepers lodge',.03)
house(-6.7,5.6)
for side in (-1,1):
    x=side*2.5;y=9.6;z=height(x,y)
    for j in range(7):
        for k in range(2):box('Ruined gate masonry',(x+(k-.5)*.61,y,z+.25+j*.48),(.58,.9,.45),stone,'North gate',.035)
    box('Gate capital',(x,y,z+3.55),(1.52,1.24,.24),stone,'North gate',.035)
for j in range(9):
    theta=math.pi*j/9+.013;theta2=math.pi*(j+1)/9-.013;verts=[]
    for yy in (9.1,10.1):
        for radius,t in [(2.02,theta),(2.02,theta2),(2.48,theta2),(2.48,theta)]:verts.append((math.cos(t)*radius,yy,3.7+math.sin(t)*radius*.65))
    arch=mesh('Broken star gate arch',verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],stone,'North gate')
    bpy.context.view_layer.objects.active=arch
    bevel=arch.modifiers.new('Chipped arch edges','BEVEL');bevel.width=.045;bevel.segments=1
    bpy.ops.object.modifier_apply(modifier=bevel.name)
# Star altar at the original southern shrine cells, with a bronze inlaid eight-point star.
for radius,z,depth in [(1.4,.46,.25),(1.15,.64,.15),(.70,.81,.20)]:
    for segment in range(8):
        a=segment*math.tau/8+.008;b=(segment+1)*math.tau/8-.008
        points=[(0,-7,z-depth/2),(radius*math.cos(a),-7+radius*math.sin(a),z-depth/2),(radius*math.cos(b),-7+radius*math.sin(b),z-depth/2)]
        points+=[(x,y,zz+depth) for x,y,zz in points]
        o=mesh('Segmented shrine step',points,[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],stone,'Star shrine')
        bpy.context.view_layer.objects.active=o
        mod=o.modifiers.new('Worn step edges','BEVEL');mod.width=.025;mod.segments=1
        bpy.ops.object.modifier_apply(modifier=mod.name)
for i in range(8):
    a=i*math.pi/4;beam('Bronze star inlay',(math.cos(a)*.3,-7+math.sin(a)*.3,.93),(math.cos(a)*1.0,-7+math.sin(a)*1.0,.93),.025,metal,'Star shrine')
verts=[(0,-7,1.98),(0,-7,.94)]
for zz,rr in [(1.66,.29),(1.13,.25)]:
    for i in range(6):
        a=i*math.tau/6;verts.append((math.cos(a)*rr,-7+math.sin(a)*rr,zz))
faces=[]
for i in range(6):
    j=(i+1)%6;faces.extend([(0,2+i,2+j),(2+i,8+i,8+j,2+j),(1,8+j,8+i)])
mesh('Faceted star crystal',verts,faces,crystal,'Star shrine')
for i in range(6):
    j=(i+1)%6
    for a,b in [(0,2+i),(2+i,2+j),(2+i,8+i),(8+i,8+j),(8+i,1)]:
        beam('Luminous crystal edge',verts[a],verts[b],.010,crystal_edge,'Star shrine')
# Human-scale details: weathered fence, stacked firewood, crates, and ivy on stone.
for y in [3.6,4.8,6.0,7.2]:
    x=-10.0;z=height(x,y);box('Lodge fence post',(x,y,z+.5),(.13,.13,1.0),wood,'Lodge details',.015)
    if y<7: 
        for zz in (.35,.8):box('Lodge fence rail',(x,y+.6,z+zz),(.08,1.16,.09),wood,'Lodge details')
for j in range(6):
    x=-9.45+(j%3)*.26;y=5.1;z=height(x,y)+.17+(j//3)*.22
    beam('Stored firewood',(x,y-.48,z),(x,y+.48,z),.13,bark,'Lodge details')
for x,y in [(-5.6,5.1),(-5.2,5.7)]:
    z=height(x,y);box('Supply crate',(x,y,z+.3),(.6,.6,.6),wood,'Lodge details',.03)
    for h in (.08,.5):box('Crate iron strap',(x,y-.31,z+h),(.62,.035,.045),metal,'Lodge details')
for i in range(100):
    x=rng.choice([-2.5,2.5])+rng.uniform(-.55,.55);y=9.07;z=height(x,y)+rng.uniform(.2,3.6)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=rng.uniform(.09,.18),location=(x,y,z));o=bpy.context.object;o.scale=(1,.3,.75);finish(o,'Gate ivy',grassmat,'North gate ivy')
# Lanterns exported with emissive glass, local illumination added in Godot.
lamps=[]
for x,y in [(-2.5,-1),(2.5,2.9),(-6.0,4),(-3.0,-6),(3.1,8.6)]:
    z=height(x,y);cylinder('Lantern pedestal',(x,y,z+.24),.22,.5,stone,'Lanterns')
    beam('Forged lamp post',(x,y,z+.4),(x,y,z+2.45),.045,metal,'Lanterns')
    box('Warm lantern glass',(x,y,z+2.32),(.26,.26,.4),warm,'Lanterns',.01)
    for dz in (-.23,.23):box('Lantern copper cap',(x,y,z+2.32+dz),(.38,.38,.075),metal,'Lanterns',.015)
    for dx in (-.14,.14):
        for dy in (-.14,.14):beam('Lantern cage',(x+dx,y+dy,z+2.1),(x+dx,y+dy,z+2.54),.018,metal,'Lanterns')
    lamps.append([x,z+2.3,-y])
# Export data describes visual placement only; it is not a replacement rules database.
(ROOT/'assets/layout.json').write_text(json.dumps({'mapId':'starfall-bridge','tileSize':2,'rows':MAP,'lamps':lamps,'origin':'existing chapters.ts; presentation only'},indent=2))
# Merge repeated props within each semantic collection by material, preserving named groups.
for cname,col in list(collections.items()):
    bymat={}
    for o in list(col.objects):
        if o.type=='MESH':bymat.setdefault(o.data.materials[0].name,[]).append(o)
    for mat,objs in bymat.items():
        if len(objs)<2:continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:o.select_set(True)
        bpy.context.view_layer.objects.active=objs[0];bpy.ops.object.join();objs[0].name=cname+' — '+mat
# Scene retained in .blend with an authoring camera and daylight setup.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=48
bpy.ops.object.camera_add(location=(13,-25,21));cam=bpy.context.object;cam.name='Composition — Starfall';cam.rotation_euler=(Vector((0,2,.7))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='PERSP';cam.data.lens=46;scene.camera=cam
bpy.ops.object.light_add(type='SUN',location=(-6,-8,15));sun=bpy.context.object;sun.name='Amber afternoon sun';sun.rotation_euler=(.45,-.5,-.5);sun.data.energy=2.3;sun.data.angle=.07;sun.data.color=(1,.79,.53)
scene.world.color=(.13,.20,.25);scene.render.resolution_x=1600;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
for im in bpy.data.images:
    if im.source=='FILE' or im.filepath:
        im.pack()
        if im.filepath: im.filepath=bpy.path.relpath(im.filepath,start=str(ROOT/'source'))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source/Starfall_Bridge.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'assets/models/starfall_environment.glb'),export_format='GLB',export_cameras=False,export_lights=False,export_apply=True)
import struct
path=ROOT/'assets/models/starfall_environment.glb'
raw=path.read_bytes();length,kind=struct.unpack_from('<II',raw,12);doc=json.loads(raw[20:20+length])
for mat in doc['materials']:
    if mat['name']=='Pine bough alpha cutout': mat['alphaMode']='MASK';mat['alphaCutoff']=.45;mat['doubleSided']=True
payload=json.dumps(doc,separators=(',',':')).encode();payload+=b' '*((-len(payload))%4)
binary=raw[20+length:];path.write_bytes(struct.pack('<III',0x46546C67,2,20+len(payload)+len(binary))+struct.pack('<II',len(payload),0x4E4F534A)+payload+binary)
report={'objects' :len([o for o in scene.objects if o.type=='MESH']),'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in scene.objects if o.type=='MESH'),'materials':len(bpy.data.materials),'textures':len(list((ROOT/'assets/textures').glob('*.png'))),'seed':17093}
(ROOT/'evidence/asset-build.json').write_text(json.dumps(report,indent=2));print('STARFALL_ASSETS_COMPLETE',report)
