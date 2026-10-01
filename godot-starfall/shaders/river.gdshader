shader_type spatial;
render_mode cull_disabled;
uniform vec4 deep_color : source_color = vec4(0.055,0.27,0.31,1.0);
uniform vec4 shallow_color : source_color = vec4(0.15,0.46,0.48,1.0);
uniform sampler2D detail : filter_linear_mipmap, repeat_enable;
uniform float flow_speed = 0.38;
varying vec3 world;
float hash(vec2 p) {return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p) {
    vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
void vertex() {
    world=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz;
    VERTEX.y+=sin(world.x*3.0+TIME*2.0)*0.016+cos(world.z*5.0+TIME)*0.012;
}
void fragment() {
    vec2 p=world.xz+vec2(-TIME*flow_speed,0.0);
    float n=noise(p*vec2(2.2,7.0));
    float small=noise(p*vec2(7.0,18.0));
    float ribbon=abs(sin(p.y*19.0+p.x*2.3+n*6.0));
    float bank=smoothstep(0.62,1.12,abs(world.z+1.0));
    float foam=smoothstep(0.84,0.97,n)*bank;
    foam=max(foam,(1.0-smoothstep(0.03,0.22,ribbon))*smoothstep(0.42,0.70,small));
    float spark=pow(max(0.0,sin(p.x*36.0+sin(p.y*42.0))),24.0)*smoothstep(0.76,0.94,small);
    ALBEDO=mix(mix(deep_color.rgb,shallow_color.rgb,n*0.55+bank*0.25),vec3(0.72,0.88,0.81),foam*0.92);
    EMISSION=vec3(0.65,0.87,0.83)*(foam*0.30+spark*1.1);
    ROUGHNESS=0.18+foam*0.5;
    METALLIC=0.05;
    NORMAL_MAP=vec3(0.5+sin(p.x*8.0+p.y*3.0)*0.1,0.5+cos(p.y*14.0+n*4.0)*0.09,1.0);
    NORMAL_MAP_DEPTH=0.8;
}
