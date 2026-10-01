shader_type spatial;
render_mode unshaded, cull_disabled;

uniform sampler2D mountain_texture : source_color, filter_linear_mipmap, repeat_disable;
uniform float haze = 0.12;

void fragment() {
    vec4 mountain = texture(mountain_texture, UV);
    // Atmospheric perspective keeps distant forests quiet and silhouettes legible.
    ALBEDO = mix(mountain.rgb * 0.64, vec3(0.024, 0.047, 0.087), haze);
    ALPHA = mountain.a;
    ALPHA_SCISSOR_THRESHOLD = 0.40;
}
