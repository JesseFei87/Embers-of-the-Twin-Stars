extends SceneTree

var scene_root: Node3D
func add(node: Node, name_: String, parent: Node = null) -> Node:
    if parent == null: parent = scene_root
    node.name = name_
    parent.add_child(node)
    node.owner = scene_root
    return node

func ground_height(x: float, z: float) -> float:
    var north := -z
    return 0.32 + clampf((north - 2.0) / 3.0, 0.0, 1.0) * 1.3 + 0.05 * sin(x * 0.7) * cos(north * 0.6)

func _initialize() -> void:
    call_deferred("build")

func build() -> void:
    scene_root = Node3D.new()
    scene_root.name = "StarfallBridge"
    get_root().add_child(scene_root)
    var landscape: Node3D = load("res://assets/models/starfall_environment.glb").instantiate()
    add(landscape, "BlenderEnvironment")
    var meadow := Node3D.new()
    meadow.set_script(load("res://scripts/meadow_detail.gd"))
    add(meadow,"MeadowDetail")
    var backdrop := Node3D.new()
    add(backdrop,"DistantForest")
    for original in landscape.find_children("Pine forest*","MeshInstance3D",true,false):
        var trees := MeshInstance3D.new()
        trees.mesh=original.mesh
        trees.transform=original.transform
        trees.position+=Vector3(2,3,-22)
        trees.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
        add(trees,String(original.name),backdrop)
    var world := WorldEnvironment.new()
    var env := Environment.new()
    env.background_mode = Environment.BG_SKY
    var sky := Sky.new()
    sky.process_mode = Sky.PROCESS_MODE_REALTIME
    sky.radiance_size = Sky.RADIANCE_SIZE_256
    var sky_material := ShaderMaterial.new()
    sky_material.shader = load("res://shaders/moving_sky.gdshader")
    sky.sky_material = sky_material
    env.sky = sky
    env.background_color = Color("203c48")
    env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
    env.ambient_light_color = Color("7897b0")
    env.ambient_light_energy = 0.43
    env.tonemap_mode = Environment.TONE_MAPPER_ACES
    env.tonemap_exposure = 1.0
    env.fog_enabled = true
    env.fog_light_color = Color("809caa")
    env.fog_density = 0.00015
    env.fog_sky_affect = 0.5
    env.volumetric_fog_enabled = true
    env.volumetric_fog_density = 0.002
    env.volumetric_fog_anisotropy = 0.35
    env.volumetric_fog_albedo = Color("85b7c4")
    env.volumetric_fog_emission = Color("172931")
    env.volumetric_fog_emission_energy = 0.0
    env.volumetric_fog_length = 75.0
    env.ssao_enabled = true
    env.ssao_radius = 0.7
    env.ssao_intensity = 1.2
    env.ssil_enabled = true
    env.ssil_intensity = 1.0
    env.glow_enabled = true
    env.glow_intensity = 0.4
    env.glow_hdr_threshold = 2.0
    world.environment = env
    add(world, "Atmosphere")
    var sun := DirectionalLight3D.new()
    sun.position = Vector3(-18,25,-8.75)
    sun.light_color = Color("ffdfa1")
    sun.light_energy = 2.8
    sun.light_angular_distance = 3.0
    sun.shadow_enabled = true
    sun.directional_shadow_max_distance = 95.0
    sun.shadow_bias = 0.04
    sun.shadow_normal_bias = 0.3
    add(sun,"AfternoonSun")
    sun.look_at(sun.position+Vector3(.72,-1,.35))
    sky_material.set_shader_parameter("sun_direction",sun.global_basis.z)
    var mist := FogVolume.new()
    mist.shape = RenderingServer.FOG_VOLUME_SHAPE_ELLIPSOID
    mist.size = Vector3(23,16,22)
    mist.position = Vector3(-8,7,-4)
    var fog_material := FogMaterial.new()
    fog_material.density = .016
    fog_material.albedo = Color("f1e4cb")
    fog_material.edge_fade = .65
    mist.material = fog_material
    add(mist,"SunlitCanopyMist")
    var rim := DirectionalLight3D.new()
    rim.rotation_degrees = Vector3(-28, 135, 0)
    rim.light_color = Color("7fbcc5")
    rim.light_energy = 0.28
    add(rim,"CoolForestFill")
    var layout: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://assets/layout.json"))
    var lamps := Node3D.new()
    add(lamps,"LanternLights")
    for i in layout.lamps.size():
        var light := OmniLight3D.new()
        light.position = Vector3(layout.lamps[i][0], layout.lamps[i][1], layout.lamps[i][2])
        light.light_color = Color("ffae52")
        light.light_energy = 3.3
        light.omni_range = 4.0
        light.omni_attenuation = 1.3
        add(light,"WarmLantern%02d" % i,lamps)
    var window_light := OmniLight3D.new()
    window_light.position = Vector3(-5.9,2.8,-4.0)
    window_light.light_color = Color("ffad46")
    window_light.light_energy = 2.2
    window_light.omni_range = 4.5
    add(window_light,"LodgeWindowLight",lamps)
    var star := OmniLight3D.new()
    star.position = Vector3(0,1.4,7)
    star.light_color = Color("68ffe3")
    star.light_energy = 1.5
    star.omni_range = 3.0
    add(star,"ShrineLight",lamps)
    for i in range(3):
        var shaft := SpotLight3D.new()
        shaft.position=Vector3(-17+i*3.0,16,-9+i*3.5)
        shaft.light_color=Color("ffe0a4")
        shaft.light_energy=5.0
        shaft.light_volumetric_fog_energy=16.0
        shaft.spot_range=33.0
        shaft.spot_angle=7.0+i*1.5
        shaft.spot_angle_attenuation=1.3
        shaft.shadow_enabled=true
        shaft.shadow_bias=.025
        shaft.shadow_normal_bias=.1
        add(shaft,"CanopySunshaft%d" % i,lamps)
        shaft.look_at(shaft.position+Vector3(.72,-1,.35))
    var river := MeshInstance3D.new()
    var plane := PlaneMesh.new()
    plane.size = Vector2(60,2.4)
    plane.subdivide_width = 90
    plane.subdivide_depth = 12
    river.mesh = plane
    river.position = Vector3(0,0.075,-1)
    var water := ShaderMaterial.new()
    water.shader = load("res://shaders/river.gdshader")
    water.set_shader_parameter("detail",load("res://assets/textures/moss_earth_albedo.png"))
    river.material_override = water
    river.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
    add(river,"FlowingRiver")
    var camera := Camera3D.new()
    camera.position = Vector3(10,18.0,25)
    camera.fov = 32.0
    camera.near = 0.1
    camera.far = 130.0
    camera.current = true
    var attributes := CameraAttributesPractical.new()
    attributes.dof_blur_far_enabled = true
    attributes.dof_blur_far_distance = 42.0
    attributes.dof_blur_far_transition = 12.0
    attributes.dof_blur_near_enabled = true
    attributes.dof_blur_near_distance = 23.0
    attributes.dof_blur_near_transition = 9.0
    attributes.dof_blur_amount = 0.18
    camera.attributes = attributes
    add(camera,"DioramaCamera")
    camera.look_at(Vector3(0,0.8,-1.2))
    # Existing pixel artwork, original locations. Visual scene only; no combat logic duplicated.
    var actors := Node3D.new()
    add(actors,"PixelCharacters")
    var cast := [["Kael","sword",3,7],["Lyra","cavalry",4,7],["Mira","lancer",5,7],["EclipseKnight","knight",4,1],["Nox","mage",1,2],["Raider","raider",8,2],["GuardWest","knight",3,4],["GuardEast","knight",6,4]]
    for row in cast:
        var sprite := Sprite3D.new()
        sprite.texture = load("res://assets/sprites-hd2d/%s.png" % row[1])
        sprite.pixel_size = 0.027
        sprite.offset = Vector2(0,sprite.texture.get_height()/2.0)
        sprite.billboard = BaseMaterial3D.BILLBOARD_ENABLED
        sprite.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
        sprite.shaded = false
        sprite.modulate = Color(0.88,0.86,0.81,1.0)
        sprite.alpha_cut = SpriteBase3D.ALPHA_CUT_DISCARD
        sprite.alpha_scissor_threshold = 0.4
        sprite.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
        var x: float = (row[2]-4.5)*2.0
        var z: float = row[3]*2.0-7.0
        var feet := ground_height(x,z)+0.07
        if z==7.0 and absf(x)<1.16: feet=0.74
        sprite.position = Vector3(x,feet,z)
        add(sprite,row[0],actors)
        var shadow := MeshInstance3D.new()
        var disc := CylinderMesh.new()
        disc.top_radius = 0.31
        disc.bottom_radius = 0.31
        disc.height = 0.008
        shadow.mesh = disc
        var sm := StandardMaterial3D.new()
        sm.albedo_color = Color(0.025,0.055,0.045,0.35)
        sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
        sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
        shadow.material_override = sm
        shadow.position = Vector3(x,feet-0.03,z)
        shadow.scale.z = 0.65
        add(shadow,str(row[0])+"ContactShadow",actors)
    var motes := MultiMeshInstance3D.new()
    var mm := MultiMesh.new()
    mm.transform_format = MultiMesh.TRANSFORM_3D
    mm.use_custom_data = true
    var quad := SphereMesh.new()
    quad.radius = 0.025
    quad.height = 0.05
    quad.radial_segments = 6
    quad.rings = 3
    mm.mesh = quad
    mm.instance_count = 100
    var random := RandomNumberGenerator.new()
    random.seed = 17093
    for i in range(100):
        mm.set_instance_transform(i,Transform3D(Basis.IDENTITY,Vector3(random.randf_range(-10,10),random.randf_range(0.5,3.8),random.randf_range(-7,8))))
        mm.set_instance_custom_data(i,Color(random.randf(),0,0,1))
    motes.multimesh = mm
    var mote_material := ShaderMaterial.new()
    mote_material.shader = load("res://shaders/fireflies.gdshader")
    motes.material_override = mote_material
    motes.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
    add(motes,"Fireflies")
    var grid := MeshInstance3D.new()
    var lines := ImmediateMesh.new()
    var gm := StandardMaterial3D.new()
    gm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
    gm.albedo_color = Color(0.73,0.82,0.60,0.4)
    gm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    lines.surface_begin(Mesh.PRIMITIVE_LINES,gm)
    for r in range(8):
        for c in range(10):
            for edge in [[Vector2(c*2-10,r*2-8),Vector2(c*2-8,r*2-8)],[Vector2(c*2-10,r*2-8),Vector2(c*2-10,r*2-6)]]:
                for p in edge:
                    var y := ground_height(p.x,p.y)+0.12
                    if r==3: y=0.81 if c==4 or c==5 else 0.11
                    lines.surface_add_vertex(Vector3(p.x,y,p.y))
    lines.surface_end()
    grid.mesh = lines
    grid.visible = false
    add(grid,"OriginalGrid")
    # Root children are editable; the imported Blender scene retains its external source.
    scene_root.set_script(load("res://scripts/starfall.gd"))
    var packed := PackedScene.new()
    var err := packed.pack(scene_root)
    if err == OK: err = ResourceSaver.save(packed,"res://scenes/starfall_bridge.tscn")
    print("STARFALL_SCENE_BUILD ",err," children=",scene_root.get_child_count())
    quit(err)
