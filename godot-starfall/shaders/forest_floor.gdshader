shader_type spatial;
render_mode cull_back;
varying vec3 world;
float hash(vec2 p) {return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p) {
    vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
void vertex(){world=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz;}
void fragment(){
    vec2 p=world.xz;
    float patch=noise(p*.75)*.7+noise(p*2.4)*.3;
    float grain=hash(floor(p*48.0));
    vec3 soil=vec3(.060,.047,.028);
    vec3 moss=vec3(.047,.071,.028);
    ALBEDO=mix(soil,moss,smoothstep(.32,.70,patch))*(.72+.5*grain);
    float pebbles=step(.992,hash(floor(p*20.0)));
    ALBEDO=mix(ALBEDO,vec3(.14,.13,.09),pebbles*.7);
    ROUGHNESS=.94;
    NORMAL_MAP=vec3(.5+(grain-.5)*.18,.5+(patch-.5)*.14,1.0);
}
