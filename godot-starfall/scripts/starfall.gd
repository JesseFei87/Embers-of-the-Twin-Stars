@tool
extends Node3D
## Scene presentation only: existing TypeScript combat and saves remain in the browser game.
@onready var camera: Camera3D = $DioramaCamera
@onready var atmosphere: WorldEnvironment = $Atmosphere
@onready var sun: DirectionalLight3D = $AfternoonSun
var target := Vector3(0,0.8,-1.2)
var camera_offset := Vector3(10,17.2,26.2)
var zoom := 1.0
var night := false
var moving := false
var photo_mode := false
var hud: CanvasLayer
var status: Label
var elapsed := 0.0
var frame_times: Array[float] = []
var clouds_paused := false
var cloud_time := 0.0
var view_index := 1

func _ready() -> void:
    configure_materials()
    if Engine.is_editor_hint(): return
    make_hud()
    set_view(1)
    if "--capture" in OS.get_cmdline_user_args(): call_deferred("capture_views")
    if "--capture-sky" in OS.get_cmdline_user_args(): call_deferred("capture_weather")
    if "--verify" in OS.get_cmdline_user_args(): call_deferred("verify_scene")

func configure_materials() -> void:
    for instance in find_children("*","MeshInstance3D",true,false):
        if instance.name=="Ground fern tufts":
            instance.visible=false
            continue
        for surface in range(instance.mesh.get_surface_count()):
            var source_mat = instance.mesh.surface_get_material(surface)
            if not source_mat is StandardMaterial3D: continue
            var mat := source_mat.duplicate() as StandardMaterial3D
            if "moss_earth" in mat.resource_name and ("Terrain" in instance.name or "riverbank" in instance.name):
                var floor_mat := ShaderMaterial.new()
                floor_mat.shader = load("res://shaders/forest_floor.gdshader")
                instance.set_surface_override_material(surface,floor_mat)
                continue
            if "limestone" in mat.resource_name:
                var stone_mat := ShaderMaterial.new()
                stone_mat.shader = load("res://shaders/mossy_stone.gdshader")
                stone_mat.set_shader_parameter("stone_tint",Color("85877b") if "Star shrine" in instance.name else Color("7f8274"))
                instance.set_surface_override_material(surface,stone_mat)
                continue
            elif "river_slate" in mat.resource_name:
                var stone_mat := ShaderMaterial.new()
                stone_mat.shader=load("res://shaders/mossy_stone.gdshader")
                stone_mat.set_shader_parameter("stone_tint",Color("5f6a66"))
                instance.set_surface_override_material(surface,stone_mat)
                continue
            elif "aged_oak" in mat.resource_name or "slate_roof" in mat.resource_name:
                var surface_mat := ShaderMaterial.new()
                surface_mat.shader=load("res://shaders/aged_surfaces.gdshader")
                surface_mat.set_shader_parameter("roof", "slate_roof" in mat.resource_name)
                instance.set_surface_override_material(surface,surface_mat)
                continue
            elif "bough" in mat.resource_name:
                mat.albedo_color = Color(0.78,0.85,0.92)
                mat.roughness = 0.93
            instance.set_surface_override_material(surface,mat)

func make_hud() -> void:
    hud = CanvasLayer.new()
    hud.name = "SceneHUD"
    add_child(hud)
    var title := Label.new()
    title.text = "双星余烬  /  星落桥"
    title.position = Vector2(38,30)
    title.add_theme_font_size_override("font_size",28)
    title.add_theme_color_override("font_color",Color("f0e3bc"))
    title.add_theme_color_override("font_shadow_color",Color(0.02,0.06,0.07,0.9))
    title.add_theme_constant_override("shadow_offset_x",2)
    title.add_theme_constant_override("shadow_offset_y",2)
    hud.add_child(title)
    var subtitle := Label.new()
    subtitle.text = "STARFALL BRIDGE     ·     THE NORTHERN REALMS"
    subtitle.position = Vector2(40,70)
    subtitle.add_theme_font_size_override("font_size",12)
    subtitle.add_theme_color_override("font_color",Color("b7cbb4"))
    hud.add_child(subtitle)
    var bottom := PanelContainer.new()
    bottom.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
    bottom.offset_top = -51
    var style := StyleBoxFlat.new()
    style.bg_color = Color(0.015,0.04,0.045,0.73)
    style.content_margin_left=28
    style.content_margin_top=14
    style.content_margin_bottom=14
    bottom.add_theme_stylebox_override("panel",style)
    bottom.visible = false
    hud.add_child(bottom)
    status = Label.new()
    status.text = "1 全景   2 古桥   3 祭坛   4 天空   C 云层暂停   ·   拖动 / WASD 平移   滚轮缩放   ·   N 昼夜   G 原始网格   F 景深   H 隐藏界面"
    status.add_theme_font_size_override("font_size",14)
    status.add_theme_color_override("font_color",Color("d6ddbd"))
    bottom.add_child(status)

func set_view(index: int) -> void:
    zoom=1.0
    view_index=index
    camera.fov=52.0 if index==4 else 32.0
    if index==1:
        target=Vector3(0,0.8,-1.2)
        camera_offset=Vector3(10,17.2,26.2)
    elif index==2:
        target=Vector3(0,0.8,-1)
        camera_offset=Vector3(8.8,8.8,13.0)
    elif index==3:
        target=Vector3(-0.5,0.8,5.3)
        camera_offset=Vector3(4.8,5.8,10.8)
    else:
        target=Vector3(0,11,-10)
        camera_offset=Vector3(10,-1,34)
    update_camera()

func update_camera() -> void:
    camera.position=target+camera_offset*zoom
    camera.look_at(target)
    var distance := camera_offset.length()*zoom
    var attr := camera.attributes as CameraAttributesPractical
    attr.dof_blur_far_distance=180.0 if view_index==4 else distance+3.5
    attr.dof_blur_far_transition=9.0
    attr.dof_blur_near_distance=1.0 if view_index==4 else maxf(1.0,distance-8.5)
    attr.dof_blur_near_transition=6.0

func toggle_night() -> void:
    night=not night
    sun.light_color=Color("9cc6df") if night else Color("ffdfa1")
    sun.light_energy=0.52 if night else 2.8
    var env := atmosphere.environment
    env.ambient_light_color=Color("587e99") if night else Color("7897b0")
    env.ambient_light_energy=0.36 if night else 0.43
    env.background_color=Color("101f30") if night else Color("203c48")
    env.fog_light_color=Color("294758") if night else Color("809caa")
    env.volumetric_fog_albedo=Color("6a8d9e") if night else Color("85b7c4")
    $Fireflies.visible=true
    $LanternLights/CanopySunshaft0.visible=not night
    $LanternLights/CanopySunshaft1.visible=not night
    $LanternLights/CanopySunshaft2.visible=not night
    $SunlitCanopyMist.visible=not night
    atmosphere.environment.sky.sky_material.set_shader_parameter("night_blend",1.0 if night else 0.0)

func _unhandled_input(event: InputEvent) -> void:
    if event is InputEventMouseButton:
        if event.button_index==MOUSE_BUTTON_LEFT: moving=event.pressed
        if event.pressed and event.button_index==MOUSE_BUTTON_WHEEL_UP: zoom=clampf(zoom*.91,.60,1.7);update_camera()
        if event.pressed and event.button_index==MOUSE_BUTTON_WHEEL_DOWN: zoom=clampf(zoom*1.10,.60,1.7);update_camera()
    if event is InputEventMouseMotion and moving:
        target.x-=event.relative.x*.016*zoom
        target.z-=event.relative.y*.023*zoom
        update_camera()
    if event is InputEventKey and event.pressed and not event.echo:
        match event.keycode:
            KEY_1: set_view(1)
            KEY_2: set_view(2)
            KEY_3: set_view(3)
            KEY_4: set_view(4)
            KEY_C: clouds_paused=not clouds_paused
            KEY_N: toggle_night()
            KEY_G: $OriginalGrid.visible=not $OriginalGrid.visible
            KEY_F:
                var attr := camera.attributes as CameraAttributesPractical
                attr.dof_blur_far_enabled=not attr.dof_blur_far_enabled
                attr.dof_blur_near_enabled=attr.dof_blur_far_enabled
            KEY_H: hud.visible=not hud.visible
            KEY_TAB: status.get_parent().visible=not status.get_parent().visible
            KEY_ESCAPE: set_view(1)

func _process(delta: float) -> void:
    if Engine.is_editor_hint(): return
    elapsed+=delta
    if not clouds_paused:
        cloud_time+=delta
        atmosphere.environment.sky.sky_material.set_shader_parameter("cloud_time",cloud_time)
    if frame_times.size()<10000: frame_times.append(delta*1000.0)
    var direction := Vector3.ZERO
    if Input.is_physical_key_pressed(KEY_A): direction.x-=1
    if Input.is_physical_key_pressed(KEY_D): direction.x+=1
    if Input.is_physical_key_pressed(KEY_W): direction.z-=1
    if Input.is_physical_key_pressed(KEY_S): direction.z+=1
    if direction.length_squared()>0:
        target+=direction.normalized()*delta*7.0*zoom
        target.x=clampf(target.x,-12,12)
        target.z=clampf(target.z,-10,10)
        update_camera()

func capture_views() -> void:
    await get_tree().create_timer(3.0).timeout
    for entry in [[1,"01-starfall-day"],[2,"02-bridge-detail"],[3,"03-star-shrine"],[1,"04-starfall-night"]]:
        set_view(entry[0])
        if entry[1]=="04-starfall-night": toggle_night()
        await get_tree().create_timer(1.5).timeout
        await RenderingServer.frame_post_draw
        var path := "res://evidence/%s.png" % entry[1]
        var error := get_viewport().get_texture().get_image().save_png(path)
        print("CAPTURE ",path," result=",error)
    var data := {"engine":Engine.get_version_info().string,"renderer":RenderingServer.get_current_rendering_method(),"adapter":RenderingServer.get_video_adapter_name(),"viewport":str(get_viewport().get_visible_rect().size),"frames":frame_times.size(),"draw_calls":Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),"primitives":Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME)}
    frame_times.sort()
    data["frame_ms_p95"]=frame_times[int(frame_times.size()*.95)]
    FileAccess.open("res://evidence/godot-runtime.json",FileAccess.WRITE).store_string(JSON.stringify(data,"  "))
    print("CAPTURE_COMPLETE ",data)
    get_tree().quit()

func verify_scene() -> void:
    await get_tree().process_frame
    assert($BlenderEnvironment.get_child_count()>0)
    assert($PixelCharacters.get_child_count()==16)
    assert($LanternLights.get_child_count()==10)
    for actor in $PixelCharacters.get_children():
        if actor is Sprite3D:
            assert(actor.texture.get_height()<=64)
            assert(actor.texture_filter==BaseMaterial3D.TEXTURE_FILTER_NEAREST)
            assert(actor.texture.get_image().detect_alpha()!=Image.ALPHA_NONE)
    assert(not $OriginalGrid.visible)
    assert(($DioramaCamera.attributes as CameraAttributesPractical).dof_blur_far_enabled)
    assert($MeadowDetail.get_node("MeadowFerns").multimesh.instance_count>1000)
    assert($DistantForest.get_child_count()==3)
    assert($MeadowDetail.get_node("MeadowGrasses").multimesh.instance_count>4000)
    assert(atmosphere.environment.background_mode==Environment.BG_SKY)
    assert($SunlitCanopyMist.material.density>0.0)
    var sky_material := atmosphere.environment.sky.sky_material as ShaderMaterial
    var time_before := cloud_time
    await get_tree().create_timer(.1).timeout
    assert(cloud_time>time_before)
    assert(is_equal_approx(sky_material.get_shader_parameter("cloud_time"),cloud_time))
    clouds_paused=true
    time_before=cloud_time
    await get_tree().create_timer(.1).timeout
    assert(is_equal_approx(time_before,cloud_time))
    clouds_paused=false
    set_view(4)
    assert(camera.fov==52.0)
    set_view(1)
    var start := camera.position
    var day_color := atmosphere.environment.background_color
    var day_ambient := atmosphere.environment.ambient_light_energy
    set_view(2)
    assert(camera.position.distance_to(start)>1)
    set_view(1)
    assert(camera.position.is_equal_approx(start))
    toggle_night()
    assert(sun.light_energy<1.0)
    assert(not $SunlitCanopyMist.visible and not $LanternLights/CanopySunshaft2.visible)
    assert(sky_material.get_shader_parameter("night_blend")==1.0)
    toggle_night()
    assert(sun.light_energy>1.0)
    assert($SunlitCanopyMist.visible and $LanternLights/CanopySunshaft2.visible)
    assert(sky_material.get_shader_parameter("night_blend")==0.0)
    assert(atmosphere.environment.background_color.is_equal_approx(day_color))
    assert(is_equal_approx(atmosphere.environment.ambient_light_energy,day_ambient))
    var layout: Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://assets/layout.json"))
    assert(layout.rows.size()==8 and layout.rows[0].length()==10)
    print("PASS: 10x8 original layout, imported Blender scene, 8 pixel actors, 10 local lights, animated sky, cloud pause, volumetric sunshafts, camera presets and day/night state.")
    get_tree().quit()

func capture_weather() -> void:
    DirAccess.make_dir_recursive_absolute("res://evidence/sky-motion")
    await get_tree().create_timer(3.0).timeout
    set_view(1)
    await get_tree().create_timer(1.5).timeout
    await RenderingServer.frame_post_draw
    get_viewport().get_texture().get_image().save_png("res://evidence/05-sunshafts-day.png")
    set_view(4)
    await get_tree().create_timer(2.0).timeout
    for i in range(25):
        await RenderingServer.frame_post_draw
        var error := get_viewport().get_texture().get_image().save_png("res://evidence/sky-motion/frame-%03d.png" % i)
        print("SKY_FRAME ",i," time=",cloud_time," result=",error)
        await get_tree().create_timer(.4).timeout
    toggle_night()
    await get_tree().create_timer(1.5).timeout
    await RenderingServer.frame_post_draw
    get_viewport().get_texture().get_image().save_png("res://evidence/06-sky-night.png")
    print("WEATHER_CAPTURE_COMPLETE")
    get_tree().quit()
