shader_type spatial;
render_mode unshaded, cull_disabled, shadows_disabled, blend_add, depth_draw_never;
varying float brightness;
void vertex() {
    float seed = INSTANCE_CUSTOM.r * 60.0;
    VERTEX.x += sin(TIME * 0.26 + seed) * 0.24;
    VERTEX.y += sin(TIME * 0.4 + seed * 1.7) * 0.22;
    VERTEX.z += cos(TIME * 0.3 + seed) * 0.18;
    brightness = 0.35 + 0.65 * pow(max(0.0, sin(TIME * 0.8 + seed)), 2.0);
}
void fragment() {
    float radius = length(UV - vec2(0.5));
    ALBEDO = vec3(1.0, 0.72, 0.24);
    EMISSION = vec3(1.0, 0.58, 0.12) * 1.8;
    ALPHA = smoothstep(0.5, 0.0, radius) * brightness;
}
