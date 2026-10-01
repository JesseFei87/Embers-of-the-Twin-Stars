extends SceneTree
## Rebuilds a separate editable level; never changes project.godot's main scene.
var scene_root: Node3D
var layout: Dictionary

func add(node: Node, label: String, parent: Node = null) -> Node:
    if parent == null: parent=scene_root
    node.name=label
    parent.add_child(node)
    node.owner=scene_root
    return node

func material(shader_path: String) -> ShaderMaterial:
    var result := ShaderMaterial.new()
    result.shader=load(shader_path)
    return result

func ground_height(x: float, z: float) -> float:
    return .045*sin(x*.7)*cos(-z*.6)+clampf((-z-2.0)/4.0,0.0,1.0)*.45

func _initialize() -> void:
    call_deferred("build")

func build() -> void:
    if not ResourceLoader.exists("res://assets/models/moonlit_environment.glb") or not FileAccess.file_exists("res://assets/moonlit-layout.json"):
        push_error("Moonlit assets missing. Build source/build_moonlit.py, then import the Godot project first.")
        quit(1)
        return
    layout=JSON.parse_string(FileAccess.get_file_as_string("res://assets/moonlit-layout.json"))
    scene_root=Node3D.new()
    scene_root.name="MoonlitPass"
    get_root().add_child(scene_root)
    var landscape: Node3D=load("res://assets/models/moonlit_environment.glb").instantiate()
    add(landscape,"BlenderEnvironment")
    var world := WorldEnvironment.new()
    var env := Environment.new()
    env.background_mode=Environment.BG_SKY
    var sky := Sky.new()
    sky.sky_material=material("res://shaders/moonlit_sky.gdshader")
    env.sky=sky
    env.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR
    env.ambient_light_color=Color("a2b0c4")
    env.ambient_light_energy=.45
    env.tonemap_mode=Environment.TONE_MAPPER_ACES
    env.tonemap_exposure=1.0
    env.ssao_enabled=true
    env.ssao_radius=.8
    env.ssao_intensity=1.1
    env.ssil_enabled=true
    env.ssil_intensity=.65
    env.glow_enabled=true
    env.glow_intensity=.48
    env.glow_hdr_threshold=1.8
    env.volumetric_fog_enabled=true
    env.volumetric_fog_density=.0009
    env.volumetric_fog_albedo=Color("637b9e")
    env.volumetric_fog_length=100.0
    env.volumetric_fog_anisotropy=.25
    world.environment=env
    add(world,"Atmosphere")
    var moon := DirectionalLight3D.new()
    moon.position=Vector3(-15,26,-15)
    moon.light_color=Color("d3dded")
    moon.light_energy=1.2
    moon.light_angular_distance=2.2
    moon.shadow_enabled=true
    moon.directional_shadow_max_distance=110
    moon.shadow_bias=.035
    moon.shadow_normal_bias=.35
    add(moon,"Moonlight")
    moon.look_at(Vector3(1,0,3))
    var fill := DirectionalLight3D.new()
    fill.rotation_degrees=Vector3(-40,145,0)
    fill.light_color=Color("a6b7d1")
    fill.light_energy=.3
    add(fill,"FrontFill")
    var mist_root := Node3D.new()
    add(mist_root,"RavineMist")
    for entry in [[Vector3(-14,.5,-18),Vector3(14,7,46),.065],[Vector3(13,-1,-2),Vector3(6,3,12),.035],[Vector3(0,-1.7,-1),Vector3(24,1.6,6),.02],[Vector3(0,-22,-43),Vector3(160,32,55),.018]]:
        var volume := FogVolume.new()
        volume.shape=RenderingServer.FOG_VOLUME_SHAPE_ELLIPSOID
        volume.position=entry[0]
        volume.size=entry[1]
        var fog := FogMaterial.new()
        fog.density=entry[2]
        fog.albedo=Color("7790b6")
        fog.edge_fade=.65
        volume.material=fog
        add(volume,"Mist%d" % mist_root.get_child_count(),mist_root)
    # Moonbeams come from actual shadowed volumetric lights above the west cleft.
    var moonbeams := Node3D.new()
    add(moonbeams,"Moonbeams")
    for i in range(2):
        var shaft := SpotLight3D.new()
        shaft.position=Vector3(-11.5+i*1.7,16.5,-9)
        shaft.light_color=Color("abcaff")
        shaft.light_energy=3.0
        shaft.light_volumetric_fog_energy=2.0
        shaft.spot_range=39.0
        shaft.spot_angle=10.0+i*3.0
        shaft.spot_angle_attenuation=1.4
        shaft.shadow_enabled=true
        shaft.shadow_bias=.025
        add(shaft,"Moonshaft%d" % i,moonbeams)
        shaft.look_at(Vector3(-2+i*3,0,3+i*2))
    var moon_haze := FogVolume.new()
    moon_haze.position=Vector3(-4.5,6,-1)
    moon_haze.size=Vector3(23,18,20)
    moon_haze.shape=RenderingServer.FOG_VOLUME_SHAPE_ELLIPSOID
    var haze := FogMaterial.new()
    haze.density=.021
    haze.albedo=Color("7395c1")
    haze.edge_fade=.9
    moon_haze.material=haze
    add(moon_haze,"MoonlitAir",moonbeams)
    var water_root := Node3D.new()
    add(water_root,"MovingWater")
    water_plane("MainRiver",Vector3(0,-1.25,-1),Vector2(32,8),water_root)
    water_plane("WestRavine",Vector3(-14,-1.3,-4),Vector2(9,17),water_root)
    for i in range(layout.waterfalls.size()):
        var entry: Dictionary=layout.waterfalls[i]
        var fall := MeshInstance3D.new()
        var quad := QuadMesh.new()
        quad.size=Vector2(entry.width,entry.top-entry.bottom)
        fall.mesh=quad
        fall.position=Vector3(entry.x,(entry.top+entry.bottom)*.5,entry.z)
        var wm := material("res://shaders/moonlit_waterfall.gdshader")
        fall.material_override=wm
        fall.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
        add(fall,"Waterfall%d" % i,water_root)
        water_plane("FallFoam%d" % i,Vector3(entry.x,entry.bottom+.05,entry.z+.35),Vector2(entry.width*1.6,1.15),water_root,true)
    var lamps := Node3D.new()
    add(lamps,"BrazierLights")
    var flames := Node3D.new()
    add(flames,"LivingFlames")
    for i in range(layout.lamps.size()):
        var entry: Array=layout.lamps[i]
        var position := Vector3(entry[0],entry[1],entry[2])
        var light := OmniLight3D.new()
        light.position=position+Vector3(0,.2,0)
        light.light_color=Color("ffa041")
        light.light_energy=4.0
        light.omni_range=4.3
        light.omni_attenuation=1.55
        add(light,"Brazier%02d" % i,lamps)
        var flame := MeshInstance3D.new()
        var quad := QuadMesh.new()
        quad.size=Vector2(.52,.88)
        flame.mesh=quad
        flame.position=position+Vector3(0,.33,0)
        var fm := material("res://shaders/moonlit_fire.gdshader")
        fm.set_shader_parameter("seed",float(i)*1.73)
        flame.material_override=fm
        flame.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
        add(flame,"Flame%02d" % i,flames)
    var altar_light := OmniLight3D.new()
    altar_light.position=Vector3(7,2.1,-7)
    altar_light.light_color=Color("a674ff")
    altar_light.light_energy=1.15
    altar_light.omni_range=5.3
    add(altar_light,"AltarViolet")
    var actors := Node3D.new()
    add(actors,"PixelCharacters")
    var nox_texture := make_nox_texture()
    for entry in layout.actors:
        var sprite := Sprite3D.new()
        var is_nox: bool=entry.name=="诺克斯" or entry.name.to_lower()=="nox"
        sprite.texture=nox_texture if is_nox else load("res://assets/sprites-hd2d/%s.png" % entry.get("sprite",entry["class"]))
        sprite.pixel_size=.029
        sprite.offset=Vector2(0,sprite.texture.get_height()/2.0)
        if is_nox:
            sprite.offset.x=sprite.texture.get_width()/2.0-176.0*52.0/389.0
            sprite.set_meta("source_art","public/assets/starfall/animations/nox/sheet.png")
        sprite.billboard=BaseMaterial3D.BILLBOARD_ENABLED
        sprite.texture_filter=BaseMaterial3D.TEXTURE_FILTER_NEAREST
        sprite.shaded=false
        sprite.modulate=Color(.78,.84,1.0,1.0)
        sprite.alpha_cut=SpriteBase3D.ALPHA_CUT_DISCARD
        sprite.alpha_scissor_threshold=.4
        sprite.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
        sprite.position=Vector3((entry.col-float(layout.origin[0]))*2,entry.height+.045,(entry.row-float(layout.origin[1]))*2)
        sprite.set_meta("class","nox" if is_nox else entry["class"])
        if entry.has("sprite"): sprite.set_meta("sprite",entry.sprite)
        sprite.set_meta("col",entry.col)
        sprite.set_meta("row",entry.row)
        add(sprite,entry.name,actors)
        var shadow := MeshInstance3D.new()
        var disc := CylinderMesh.new()
        disc.top_radius=.36
        disc.bottom_radius=.36
        disc.height=.007
        shadow.mesh=disc
        var sm := StandardMaterial3D.new()
        sm.albedo_color=Color(.01,.018,.035,.48)
        sm.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA
        sm.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED
        shadow.material_override=sm
        shadow.position=sprite.position-Vector3(0,.022,0)
        shadow.scale.z=.65
        add(shadow,str(entry.name)+"ContactShadow",actors)
    make_terrain_collision()
    make_grid()
    var camera := Camera3D.new()
    camera.position=Vector3(1,29.8,29)
    camera.fov=39.0
    camera.near=.1
    camera.far=450
    camera.current=true
    var attributes := CameraAttributesPractical.new()
    attributes.dof_blur_far_enabled=false
    attributes.dof_blur_far_distance=58.0
    attributes.dof_blur_far_transition=15.0
    attributes.dof_blur_near_enabled=true
    attributes.dof_blur_near_distance=15.0
    attributes.dof_blur_near_transition=8.0
    attributes.dof_blur_amount=.12
    camera.attributes=attributes
    add(camera,"DioramaCamera")
    camera.look_at(Vector3(0,.8,1))
    scene_root.set_script(load("res://scripts/moonlit_pass.gd"))
    var packed := PackedScene.new()
    var error := packed.pack(scene_root)
    if error==OK: error=ResourceSaver.save(packed,"res://scenes/moonlit_pass.tscn")
    print("MOONLIT_SCENE_BUILD ",error," children=",scene_root.get_child_count())
    quit(error)

func water_plane(label: String, position: Vector3, size: Vector2, parent: Node, foam: bool=false) -> void:
    var mesh := MeshInstance3D.new()
    var plane := PlaneMesh.new()
    plane.size=size
    plane.subdivide_width=50
    plane.subdivide_depth=18
    mesh.mesh=plane
    mesh.position=position
    mesh.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
    var wm := material("res://shaders/moonlit_waterfall.gdshader" if foam else "res://shaders/moonlit_water.gdshader")
    if foam: wm.set_shader_parameter("splash",true)
    mesh.material_override=wm
    add(mesh,label,parent)

func make_nox_texture() -> ImageTexture:
    var source := Image.load_from_file(ProjectSettings.globalize_path("res://../public/assets/starfall/animations/nox/sheet.png"))
    assert(source!=null,"Original red-haired Nox artwork is required")
    var image := source.get_region(Rect2i(79,104,343,389))
    image.resize(46,52,Image.INTERPOLATE_NEAREST)
    assert(image.detect_alpha()!=Image.ALPHA_NONE)
    var error := image.save_png("res://assets/sprites-hd2d/nox.png")
    assert(error==OK)
    return ImageTexture.create_from_image(image)

func terrain_height(col: int, row: int) -> float:
    return float(layout.cell_heights[row][col])

func make_terrain_collision() -> void:
    var terrain := Node3D.new()
    add(terrain,"TerrainSurface")
    terrain.set_meta("source","src/game/data/chapters.ts: moonlit-pass")
    terrain.set_meta("rows",layout.rows)
    for row in range(layout.rows.size()):
        for col in range(layout.rows[0].length()):
            var type: String=layout.rows[row][col]
            if type=="w": continue
            var body := StaticBody3D.new()
            body.position=Vector3((col-float(layout.origin[0]))*2,terrain_height(col,row)-.10,(row-float(layout.origin[1]))*2)
            body.collision_layer=1
            body.collision_mask=0
            body.set_meta("col",col)
            body.set_meta("row",row)
            body.set_meta("terrain",type)
            body.set_meta("surface_height",terrain_height(col,row))
            add(body,"Cell_%d_%d" % [col,row],terrain)
            var collision := CollisionShape3D.new()
            var box := BoxShape3D.new()
            box.size=Vector3(2,.20,2)
            collision.shape=box
            add(collision,"WalkableSurface",body)

func make_grid() -> void:
    var grid := MeshInstance3D.new()
    var lines := ArrayMesh.new()
    var points := PackedVector3Array()
    var gm := StandardMaterial3D.new()
    gm.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED
    gm.albedo_color=Color(.48,.75,1,.5)
    gm.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA
    for r in range(layout.rows.size()):
        for c in range(layout.rows[0].length()):
            var terrain: String=layout.rows[r][c]
            var height := terrain_height(c,r)+.12
            if terrain=="w": height=-1.13
            var x := (c-float(layout.origin[0]))*2.0-1.0
            var z := (r-float(layout.origin[1]))*2.0-1.0
            for p in [Vector2(x,z),Vector2(x+2,z),Vector2(x+2,z),Vector2(x+2,z+2),Vector2(x+2,z+2),Vector2(x,z+2),Vector2(x,z+2),Vector2(x,z)]:
                points.append(Vector3(p.x,height,p.y))
    var arrays := []
    arrays.resize(Mesh.ARRAY_MAX)
    arrays[Mesh.ARRAY_VERTEX]=points
    lines.add_surface_from_arrays(Mesh.PRIMITIVE_LINES,arrays)
    lines.surface_set_material(0,gm)
    grid.mesh=lines
    grid.visible=false
    add(grid,"OriginalGrid")
