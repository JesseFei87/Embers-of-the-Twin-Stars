@tool
extends Node3D
## Visual level only. Terrain metadata remains the browser game's source of truth.
@onready var camera: Camera3D=$DioramaCamera
var target := Vector3(0,.8,1)
var camera_offset := Vector3(1,29,28)
var zoom := 1.0
var dragging := false
var elapsed := 0.0
var view_index := 1
var frame_times: Array[float]=[]
var help_panel: PanelContainer
var hud: CanvasLayer
var animated_materials: Array[ShaderMaterial]=[]

func _ready() -> void:
    configure_materials()
    if Engine.is_editor_hint(): return
    get_tree().root.content_scale_size=Vector2i(1600,900)
    DisplayServer.window_set_title("双星余烬 · 月影峡道")
    for root in [$MovingWater,$LivingFlames]:
        for mesh in root.get_children():
            animated_materials.append(mesh.material_override)
    make_hud()
    set_view(1)
    var screen_size=get_viewport().get_visible_rect().size
    $Atmosphere.environment.sky.sky_material.set_shader_parameter("moon_direction",camera.project_ray_normal(Vector2(screen_size.x*.075,screen_size.y*.044)))
    if "--verify" in OS.get_cmdline_user_args(): call_deferred("verify_scene")
    elif "--capture-characters" in OS.get_cmdline_user_args(): call_deferred("capture_characters")
    elif "--capture-waterfall" in OS.get_cmdline_user_args(): call_deferred("capture_waterfall")
    elif "--capture-depth" in OS.get_cmdline_user_args(): call_deferred("capture_depth")
    elif "--capture-moonlit" in OS.get_cmdline_user_args(): call_deferred("capture_views")

func configure_materials() -> void:
    for instance in $BlenderEnvironment.find_children("*","MeshInstance3D",true,false):
        for surface in range(instance.mesh.get_surface_count()):
            var original=instance.mesh.surface_get_material(surface)
            if not original is StandardMaterial3D: continue
            var label: String=original.resource_name
            var shader_material := ShaderMaterial.new()
            if label.begins_with("distant_panorama_"):
                shader_material.shader=load("res://shaders/distant_panorama.gdshader")
                shader_material.set_shader_parameter("mountain_texture",original.albedo_texture)
                var layer: int=int(label.trim_prefix("distant_panorama_"))
                shader_material.set_shader_parameter("haze",[0.30,0.56,0.76][layer])
                instance.set_surface_override_material(surface,shader_material)
                instance.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
            elif "moonlit_basalt" in label:
                shader_material.shader=load("res://shaders/moonlit_cliff.gdshader")
                instance.set_surface_override_material(surface,shader_material)
            elif "limestone" in label or "river_slate" in label:
                shader_material.shader=load("res://shaders/mossy_stone.gdshader")
                shader_material.set_shader_parameter("stone_tint",Color("626a74") if "limestone" in label else Color("53606e"))
                instance.set_surface_override_material(surface,shader_material)
            elif "aged_oak" in label:
                shader_material.shader=load("res://shaders/aged_surfaces.gdshader")
                instance.set_surface_override_material(surface,shader_material)
            elif "moss_earth" in label:
                shader_material.shader=load("res://shaders/forest_floor.gdshader")
                instance.set_surface_override_material(surface,shader_material)

func make_hud() -> void:
    hud=CanvasLayer.new()
    hud.name="InspectionHUD"
    add_child(hud)
    var button := Button.new()
    button.text="H · 操作"
    button.position=Vector2(20,20)
    button.modulate=Color(.7,.79,.94,.68)
    button.focus_mode=Control.FOCUS_NONE
    button.pressed.connect(func(): help_panel.visible=not help_panel.visible)
    hud.add_child(button)
    help_panel=PanelContainer.new()
    help_panel.position=Vector2(20,62)
    var style := StyleBoxFlat.new()
    style.bg_color=Color(.014,.024,.045,.86)
    style.content_margin_left=18
    style.content_margin_right=18
    style.content_margin_top=14
    style.content_margin_bottom=14
    help_panel.add_theme_stylebox_override("panel",style)
    var label := Label.new()
    label.text="月影峡道\n\n1  总览    2  木桥    3  祭坛    4  峡壁\nW A S D / 鼠标右键拖动 · 平移视角\n鼠标滚轮 · 缩放\nG  地形格    H  操作说明    R  复位"
    label.add_theme_font_size_override("font_size",16)
    label.add_theme_color_override("font_color",Color("b9c8e0"))
    help_panel.add_child(label)
    help_panel.visible=false
    hud.add_child(help_panel)

func set_view(index: int) -> void:
    view_index=index
    zoom=1.0
    camera.fov=39.0
    match index:
        1:
            target=Vector3(0,.8,1)
            camera_offset=Vector3(1,29,28)
        2:
            target=Vector3(-1,-.1,-1)
            camera_offset=Vector3(5,10,15)
        3:
            target=Vector3(7,2,-7)
            camera_offset=Vector3(5,7.5,12.5)
        4:
            target=Vector3(-12.5,3.0,-1)
            camera_offset=Vector3(10,5,11)
    update_camera()

func update_camera() -> void:
    camera.position=target+camera_offset*zoom
    camera.look_at(target)
    var distance := camera_offset.length()*zoom
    var attr := camera.attributes as CameraAttributesPractical
    attr.dof_blur_far_distance=distance+18.0
    attr.dof_blur_far_transition=15.0
    attr.dof_blur_near_distance=maxf(1.0,distance-25.0)
    attr.dof_blur_near_transition=8.0

func _unhandled_input(event: InputEvent) -> void:
    if event is InputEventMouseButton:
        if event.button_index==MOUSE_BUTTON_RIGHT: dragging=event.pressed
        if event.pressed and event.button_index==MOUSE_BUTTON_WHEEL_UP:
            zoom=clampf(zoom*.91,.82,1.06)
            update_camera()
        elif event.pressed and event.button_index==MOUSE_BUTTON_WHEEL_DOWN:
            zoom=clampf(zoom*1.10,.82,1.06)
            update_camera()
    elif event is InputEventMouseMotion and dragging:
        var right := camera.global_basis.x
        var forward := Vector3(camera.global_basis.z.x,0,camera.global_basis.z.z).normalized()
        target-=(right*event.relative.x+forward*event.relative.y)*.025*zoom
        clamp_target()
        update_camera()
    elif event is InputEventKey and event.pressed and not event.echo:
        match event.keycode:
            KEY_1: set_view(1)
            KEY_2: set_view(2)
            KEY_3: set_view(3)
            KEY_4: set_view(4)
            KEY_R: set_view(1)
            KEY_G: $OriginalGrid.visible=not $OriginalGrid.visible
            KEY_H: help_panel.visible=not help_panel.visible

func clamp_target() -> void:
    var centers := [Vector3(0,.8,1),Vector3(-1,-.1,-1),Vector3(7,2,-7),Vector3(-12.5,3,-1)]
    var center: Vector3=centers[view_index-1]
    var reach := 1.0
    target.x=clampf(target.x,center.x-reach,center.x+reach)
    target.z=clampf(target.z,center.z-reach,center.z+reach)

func _process(delta: float) -> void:
    if Engine.is_editor_hint(): return
    elapsed+=delta
    $Atmosphere.environment.sky.sky_material.set_shader_parameter("cloud_time",elapsed)
    if frame_times.size()<10000: frame_times.append(delta*1000)
    for mat in animated_materials: mat.set_shader_parameter("motion_time",elapsed)
    for i in $BrazierLights.get_child_count():
        $BrazierLights.get_child(i).light_energy=4.0+sin(elapsed*9+i*1.73)*.24+sin(elapsed*17+i)*.12
    var direction := Vector3.ZERO
    if Input.is_physical_key_pressed(KEY_A): direction.x-=1
    if Input.is_physical_key_pressed(KEY_D): direction.x+=1
    if Input.is_physical_key_pressed(KEY_W): direction.z-=1
    if Input.is_physical_key_pressed(KEY_S): direction.z+=1
    if direction.length_squared()>0:
        target+=direction.normalized()*delta*8.0*zoom
        clamp_target()
        update_camera()

func verify_scene() -> void:
    await get_tree().process_frame
    var layout: Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://assets/moonlit-layout.json"))
    var expected: Array=layout.rows
    assert(expected.size()==12 and expected[0].length()==12,"Expanded terrain must be 12x12")
    assert(layout.layoutVersion==2)
    assert($TerrainSurface.get_meta("source")=="src/game/data/chapters.ts: moonlit-pass")
    assert($TerrainSurface.get_meta("rows")==expected)
    await get_tree().physics_frame
    var space := get_world_3d().direct_space_state
    var walkable_count := 0
    for row in range(expected.size()):
        for col in range(expected[0].length()):
            var x := (col-float(layout.origin[0]))*2
            var z := (row-float(layout.origin[1]))*2
            var query := PhysicsRayQueryParameters3D.create(Vector3(x,30,z),Vector3(x,-10,z),1)
            var hit := space.intersect_ray(query)
            if expected[row][col]=="w":
                assert(hit.is_empty(),"River cells must not gain a walkable floor")
                continue
            walkable_count+=1
            var body: StaticBody3D=$TerrainSurface.get_node("Cell_%d_%d" % [col,row])
            assert(not hit.is_empty(),"Missing terrain collision")
            assert(hit.collider==body)
            assert(absf(hit.position.y-float(body.get_meta("surface_height")))<.001)
            assert(body.get_meta("terrain")==expected[row][col])
    assert($TerrainSurface.get_child_count()==walkable_count)
    assert($BlenderEnvironment.get_child_count()>0,"Empty imported environment")
    assert($PixelCharacters.get_child_count()==22,"Expected eleven sprites and contact shadows")
    assert(layout.actors.size()==11)
    assert($BrazierLights.get_child_count()==layout.lamps.size())
    assert($LivingFlames.get_child_count()==layout.lamps.size())
    assert($MovingWater.get_child_count()==2+layout.waterfalls.size()*2)
    assert(layout.waterfalls.size()>0)
    for entry in layout.actors:
        var actor: Sprite3D=$PixelCharacters.get_node(NodePath(entry.name))
        assert(actor.texture.get_height()<=64)
        assert(actor.texture_filter==BaseMaterial3D.TEXTURE_FILTER_NEAREST)
        assert(actor.texture.get_image().detect_alpha()!=Image.ALPHA_NONE)
        if entry.has("sprite"):
            assert(actor.get_meta("sprite")==entry.sprite)
            assert(actor.texture.resource_path=="res://assets/sprites-hd2d/%s.png" % entry.sprite)
            assert(actor.get_meta("class")!="lancer","Moonlit enemies must not reuse Mira's lancer identity")
        assert(actor.position.is_equal_approx(Vector3((entry.col-float(layout.origin[0]))*2,entry.height+.045,(entry.row-float(layout.origin[1]))*2)))
        if entry.name=="诺克斯" or entry.name.to_lower().contains("nox"):
            assert(actor.get_meta("class")=="nox","Nox must retain his unique scout artwork")
            assert(actor.get_meta("source_art")=="public/assets/starfall/animations/nox/sheet.png")
    var party_positions := []
    for entry in layout.actors:
        if int(entry.row)==11: party_positions.append(int(entry.col))
    party_positions.sort()
    assert(party_positions==[4,5,6,7],"Party must start two cells further south")
    assert(not $OriginalGrid.visible)
    assert($OriginalGrid.mesh.get_surface_count()==1,"Expanded grid must survive scene serialization")
    assert(camera.projection==Camera3D.PROJECTION_PERSPECTIVE)
    assert(not ($DioramaCamera.attributes as CameraAttributesPractical).dof_blur_far_enabled)
    assert(($DioramaCamera.attributes as CameraAttributesPractical).dof_blur_near_enabled)
    assert($Atmosphere.environment.volumetric_fog_density<.003)
    assert($RavineMist.get_child_count()==4)
    assert($Moonbeams.get_child_count()==3)
    assert($Moonbeams/Moonshaft0.shadow_enabled)
    assert($Moonbeams/Moonshaft0.light_volumetric_fog_energy>0)
    assert($Atmosphere.environment.sky.sky_material.get_shader_parameter("moon_direction").length()>.99)
    assert(is_equal_approx($MovingWater/MainRiver.position.y,-1.25))
    var start := camera.position
    set_view(2)
    assert(camera.position.distance_to(start)>5)
    set_view(3)
    assert(target.distance_to(Vector3(7,2,-7))<.01)
    set_view(4)
    assert(target.is_equal_approx(Vector3(-12.5,3,-1)))
    set_view(1)
    assert(camera.position.is_equal_approx(start))
    var before := elapsed
    await get_tree().create_timer(.12).timeout
    assert(elapsed>before)
    assert(is_equal_approx(float($Atmosphere.environment.sky.sky_material.get_shader_parameter("cloud_time")),elapsed))
    for mat in animated_materials: assert(is_equal_approx(float(mat.get_shader_parameter("motion_time")),elapsed))
    print("PASS MOONLIT: expanded 12x12 terrain, ray-verified walkable cells and river exclusions, eleven grounded pixel actors, four deployment cells, animated river/waterfalls/fire, localized mist, four cameras, continuous cliffs, crescent starfield and volumetric moonbeams.")
    get_tree().quit()

func capture_characters() -> void:
    hud.visible=false
    DirAccess.make_dir_recursive_absolute("res://evidence/moonlit/characters")
    await get_tree().create_timer(2).timeout
    for actor_name in ["艾琳","祭坛术士","米菈"]:
        var actor: Sprite3D=$PixelCharacters.get_node(NodePath(actor_name))
        target=actor.position+Vector3(0,.65,0)
        camera_offset=Vector3(1,4,7)
        camera.fov=26.0
        zoom=1.0
        update_camera()
        await get_tree().create_timer(.6).timeout
        RenderingServer.force_draw(false)
        var path := "res://evidence/moonlit/characters/%s.png" % actor_name
        assert(get_viewport().get_texture().get_image().save_png(path)==OK)
        print("CHARACTER_CAPTURE ",path)
    get_tree().quit()

func capture_views() -> void:
    if DisplayServer.get_name()=="headless":
        push_error("Capture needs a native renderer; use --verify for headless assertions.")
        get_tree().quit(1)
        return
    hud.visible=false
    DirAccess.make_dir_recursive_absolute("res://evidence/moonlit")
    await get_tree().create_timer(3).timeout
    var views: Array[Dictionary]=[]
    for entry in [[1,"overview"],[2,"bridge"],[3,"altar"],[4,"cliff-detail"]]:
        set_view(entry[0])
        await get_tree().create_timer(1.5).timeout
        RenderingServer.force_draw(false)
        var path := "res://evidence/moonlit/%s.png" % entry[1]
        var error := get_viewport().get_texture().get_image().save_png(path)
        assert(error==OK,"Capture failed: "+path)
        views.append({"name":entry[1],"camera_position":[camera.position.x,camera.position.y,camera.position.z],"target":[target.x,target.y,target.z],"fov":camera.fov,"file":path})
        print("MOONLIT_CAPTURE ",path)
    set_view(1)
    $OriginalGrid.visible=true
    await get_tree().create_timer(.3).timeout
    RenderingServer.force_draw(false)
    assert(get_viewport().get_texture().get_image().save_png("res://evidence/moonlit/expanded-grid.png")==OK)
    $OriginalGrid.visible=false
    var data := {"scene":"res://scenes/moonlit_pass.tscn","engine":Engine.get_version_info().string,"renderer":RenderingServer.get_current_rendering_method(),"adapter":RenderingServer.get_video_adapter_name(),"viewport":str(get_viewport().get_visible_rect().size),"frames":frame_times.size(),"elapsed":elapsed,"views":views,"draw_calls":Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),"primitives":Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),"terrain_columns":12,"terrain_rows":12,"actors":11,"waterfalls":($MovingWater.get_child_count()-2)/2,"boundary":"Visual scene only; no duplicate combat or saves"}
    frame_times.sort()
    data["frame_ms_p95"]=frame_times[mini(frame_times.size()-1,int(frame_times.size()*.95))]
    FileAccess.open("res://evidence/moonlit/runtime.json",FileAccess.WRITE).store_string(JSON.stringify(data,"  "))
    print("MOONLIT_CAPTURE_COMPLETE ",JSON.stringify(data))
    get_tree().quit()

func capture_depth() -> void:
    hud.visible=false
    var window_size := DisplayServer.window_get_size()
    var folder := "res://evidence/moonlit/depth/%dx%d" % [window_size.x,window_size.y]
    DirAccess.make_dir_recursive_absolute(folder)
    await get_tree().create_timer(2).timeout
    for index in range(1,5):
        for corner in [Vector2(-1,-1),Vector2(-1,1),Vector2(1,-1),Vector2(1,1)]:
            for distance in [.82,1.06]:
                set_view(index)
                target+=Vector3(corner.x*100,0,corner.y*100)
                clamp_target()
                zoom=distance
                update_camera()
                await get_tree().create_timer(.3).timeout
                RenderingServer.force_draw(false)
                var file := folder+"/view-%d-%d-%d-zoom-%.2f.png" % [index,int(corner.x),int(corner.y),zoom]
                assert(get_viewport().get_texture().get_image().save_png(file)==OK)
    set_view(1)
    set_process(false)
    for moment in [0.0,60.0]:
        $Atmosphere.environment.sky.sky_material.set_shader_parameter("cloud_time",moment)
        await get_tree().create_timer(.8).timeout
        RenderingServer.force_draw(false)
        assert(get_viewport().get_texture().get_image().save_png(folder+"/clouds-%d.png" % int(moment))==OK)
    print("MOONLIT_DEPTH_CAPTURE_COMPLETE")
    get_tree().quit()

func capture_waterfall() -> void:
    hud.visible=false
    set_process(false)
    camera.position=Vector3(-10.2,3.8,-5.2)
    camera.look_at(Vector3(-14,.9,-11))
    camera.fov=35.0
    camera.attributes.dof_blur_near_enabled=false
    DirAccess.make_dir_recursive_absolute("res://evidence/moonlit/waterfall")
    for moment in [0.0,1.0]:
        for mat in animated_materials: mat.set_shader_parameter("motion_time",moment)
        await get_tree().create_timer(.5).timeout
        RenderingServer.force_draw(false)
        assert(get_viewport().get_texture().get_image().save_png("res://evidence/moonlit/waterfall/time-%d.png" % int(moment))==OK)
    print("MOONLIT_WATERFALL_CAPTURE_COMPLETE")
    get_tree().quit()
