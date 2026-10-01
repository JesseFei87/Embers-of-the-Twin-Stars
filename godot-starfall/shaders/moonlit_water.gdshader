shader_type spatial;
render_mode cull_disabled;
uniform float motion_time = 0.0;
varying vec3 world_pos;
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p) {
 vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
 return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);
}
void vertex() {
 world_pos=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz;
 VERTEX.y+=sin(world_pos.x*2.5+motion_time*1.8)*.026+sin(world_pos.z*3.5-motion_time*2.0)*.018;
}
void fragment() {
 vec2 p=world_pos.xz+vec2(-motion_time*.8,motion_time*.13);
 float n=noise(p*5.0);
 float ripple=sin(p.x*15.0+sin(p.y*7.0)*2.5+n*2.0);
 float sparkle=smoothstep(.96,.995,ripple)*smoothstep(.69,.88,n);
 float banks=1.0-smoothstep(.0,.55,min(abs(world_pos.z+2.6),abs(world_pos.z-.55)));
 float foam=smoothstep(.67,.85,noise(p*vec2(2.4,5.0)))*banks;
 vec3 deep=vec3(.025,.12,.23), light=vec3(.12,.37,.55);
 ALBEDO=mix(deep,light,n*.55)+vec3(.44,.66,.8)*sparkle*.40;
 ALBEDO=mix(ALBEDO,vec3(.40,.63,.73),foam*.75);
 METALLIC=0.0; ROUGHNESS=.43; SPECULAR=.28;
 NORMAL_MAP=vec3(.5+sin(p.x*8.0+p.y*4.0+n*9.0)*.035,.5+cos(p.y*9.0+n*7.0)*.035,1.0);
 EMISSION=ALBEDO*.09+vec3(.06,.10,.14)*sparkle;
}
