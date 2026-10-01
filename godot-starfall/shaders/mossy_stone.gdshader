shader_type spatial;
uniform vec4 stone_tint : source_color = vec4(.50,.51,.46,1.0);
varying vec3 world;
varying vec3 world_normal;
float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise(vec3 p){
    vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
void vertex(){world=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz;world_normal=normalize(MODEL_NORMAL_MATRIX*NORMAL);}
void fragment(){
    float patches=noise(world*3.7);
    float speckle=hash(floor(world*65.0));
    float moss=smoothstep(.59,.78,patches)*smoothstep(-.2,.65,world_normal.y);
    vec3 limestone=stone_tint.rgb*(.70+.48*noise(world*8.0));
    float pits=smoothstep(.88,.98,speckle);
    limestone*=1.0-pits*.22;
    ALBEDO=mix(limestone,vec3(.060,.090,.026),moss)*(.94+.12*speckle);
    ROUGHNESS=.91;
    NORMAL_MAP=vec3(.5+(speckle-.5)*.14,.5+(patches-.5)*.12,1.0);
}
