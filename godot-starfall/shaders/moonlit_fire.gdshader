shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, shadows_disabled;
uniform float motion_time=0.0;
uniform float seed=0.0;
uniform vec4 flame_color: source_color=vec4(1.0,.25,.015,1.0);
void vertex() {
 MODELVIEW_MATRIX=VIEW_MATRIX*mat4(INV_VIEW_MATRIX[0],INV_VIEW_MATRIX[1],INV_VIEW_MATRIX[2],MODEL_MATRIX[3]);
}
void fragment() {
 float h=1.0-UV.y;
 float sway=sin(h*9.0-motion_time*7.0+seed)*.055*h+sin(h*17.0-motion_time*12.0)*.025;
 float width=(1.0-h)*.37+.025;
 float shape=1.0-smoothstep(width*.55,width,abs(UV.x-.5+sway));
 float tip=1.0-smoothstep(.77+sin(motion_time*9.0+seed)*.055,1.0,h);
 float alpha=shape*tip*smoothstep(0.0,.08,h);
 ALBEDO=mix(flame_color.rgb,vec3(1.0,.89,.38),pow(1.0-h,2.0));
 EMISSION=ALBEDO*4.2;
 ALPHA=alpha;
}
