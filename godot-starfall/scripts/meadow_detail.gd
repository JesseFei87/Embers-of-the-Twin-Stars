@tool
extends Node3D
## Small three-dimensional fern fronds share one mesh and one draw submission.
func _ready() -> void:
    if get_child_count()>0: return
    var mesh := ArrayMesh.new()
    var vertices := PackedVector3Array()
    var normals := PackedVector3Array()
    for frond in range(7):
        var angle := frond*TAU/7.0
        var along := Vector3(cos(angle),0,sin(angle))
        var across := Vector3(-sin(angle),0,cos(angle))
        for leaf in range(6):
            var t := float(leaf+1)/7.0
            var center := along*t*.38+Vector3.UP*(sin(t*PI)*.20+.045)
            for side in [-1,1]:
                var tip: Vector3 = center+across*side*(1.0-t)*.16+along*.07+Vector3.UP*.02
                var points := [center-along*.026,center+along*.032,tip]
                for p in points:
                    vertices.append(p)
                    normals.append(Vector3.UP)
    var arrays := []
    arrays.resize(Mesh.ARRAY_MAX)
    arrays[Mesh.ARRAY_VERTEX]=vertices
    arrays[Mesh.ARRAY_NORMAL]=normals
    mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
    var material := StandardMaterial3D.new()
    material.albedo_color=Color("536e45")
    material.vertex_color_use_as_albedo=true
    material.vertex_color_is_srgb=true
    material.cull_mode=BaseMaterial3D.CULL_DISABLED
    material.roughness=1.0
    mesh.surface_set_material(0,material)
    var random := RandomNumberGenerator.new()
    random.seed=87211
    var transforms: Array[Transform3D]=[]
    for i in range(6000):
        var x := random.randf_range(-14,14)
        var z := random.randf_range(-11,12)
        if -2.7<z and z<.65: continue
        if absf(x)<2.2 and z>-.5: continue
        if -9<x and x<-4.8 and -7.5<z and z<-3.2: continue
        if sin(x*1.4)+cos(z*1.6)<-1.1: continue
        var y := .32+clampf((-z-2.0)/3.0,0,1)*1.3+.05*sin(x*.7)*cos(z*.6)
        var scale_ := random.randf_range(.65,1.35)
        var basis := Basis(Vector3.UP,random.randf()*TAU).scaled(Vector3.ONE*scale_)
        transforms.append(Transform3D(basis,Vector3(x,y+.03,z)))
    var mm := MultiMesh.new()
    mm.transform_format=MultiMesh.TRANSFORM_3D
    mm.use_colors=true
    mm.mesh=mesh
    mm.instance_count=transforms.size()
    for i in transforms.size():
        mm.set_instance_transform(i,transforms[i])
        mm.set_instance_color(i,Color(random.randf_range(.6,.95),random.randf_range(.75,1.0),random.randf_range(.65,.85)))
    var plants := MultiMeshInstance3D.new()
    plants.name="MeadowFerns"
    plants.multimesh=mm
    plants.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
    add_child(plants)
    add_grass()

func add_grass() -> void:
    var vertices := PackedVector3Array()
    var normals := PackedVector3Array()
    var colors := PackedColorArray()
    var random := RandomNumberGenerator.new()
    random.seed=34517
    for blade in range(11):
        var angle := random.randf()*TAU
        var along := Vector3(cos(angle),0,sin(angle))
        var across := Vector3(-sin(angle),0,cos(angle))
        var base := along*random.randf_range(.01,.12)
        var height := random.randf_range(.20,.48)
        var width := random.randf_range(.014,.027)
        var mid := base+along*height*.24+Vector3.UP*height*.62
        var tip := base+along*height*.65+Vector3.UP*height
        var points := [base-across*width,base+across*width,mid+across*width*.65,base-across*width,mid+across*width*.65,mid-across*width*.65,mid-across*width*.65,mid+across*width*.65,tip]
        for point in points:
            vertices.append(point)
            normals.append((Vector3.UP+along*.35).normalized())
            colors.append(Color("637748") if point.y>height*.5 else Color("425537"))
    var arrays := []
    arrays.resize(Mesh.ARRAY_MAX)
    arrays[Mesh.ARRAY_VERTEX]=vertices
    arrays[Mesh.ARRAY_NORMAL]=normals
    arrays[Mesh.ARRAY_COLOR]=colors
    var mesh := ArrayMesh.new()
    mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
    var material := StandardMaterial3D.new()
    material.vertex_color_use_as_albedo=true
    material.vertex_color_is_srgb=true
    material.cull_mode=BaseMaterial3D.CULL_DISABLED
    material.roughness=.95
    mesh.surface_set_material(0,material)
    var transforms: Array[Transform3D]=[]
    for i in range(14500):
        var x := random.randf_range(-17,17)
        var z := random.randf_range(-15,15)
        if -2.55<z and z<.42: continue
        if absf(x)<1.98 and z>-.5: continue
        if -8.6<x and x<-4.8 and -7.2<z and z<-3.4: continue
        var patch := sin(x*.9+sin(z*.8))*cos(z*1.2)
        if patch<-.4 and random.randf()<.82: continue
        var y := .32+clampf((-z-2.0)/3.0,0,1)*1.3+.05*sin(x*.7)*cos(z*.6)
        var scale_ := random.randf_range(.50,1.25)
        transforms.append(Transform3D(Basis(Vector3.UP,random.randf()*TAU).scaled(Vector3.ONE*scale_),Vector3(x,y+.02,z)))
    var mm := MultiMesh.new()
    mm.transform_format=MultiMesh.TRANSFORM_3D
    mm.use_colors=true
    mm.mesh=mesh
    mm.instance_count=transforms.size()
    for i in transforms.size():
        mm.set_instance_transform(i,transforms[i])
        mm.set_instance_color(i,Color(random.randf_range(.7,1),random.randf_range(.8,1),random.randf_range(.7,.95)))
    var grasses := MultiMeshInstance3D.new()
    grasses.name="MeadowGrasses"
    grasses.multimesh=mm
    grasses.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
    add_child(grasses)
