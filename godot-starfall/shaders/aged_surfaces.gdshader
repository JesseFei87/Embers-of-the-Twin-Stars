shader_type spatial;
uniform bool roof = false;
varying vec3 world;
float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
void vertex(){world=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz;}
void fragment(){
    float grain=hash(floor(world*100.0));
    if(roof){
        float tile=hash(floor(world*vec3(2.7,2.0,2.3)));
        ALBEDO=mix(vec3(.050,.058,.062),vec3(.12,.12,.115),tile)*(.9+grain*.2);
        NORMAL_MAP=vec3(.5+(grain-.5)*.18,.5+(tile-.5)*.1,1.0);
        ROUGHNESS=.83;
    }else{
        float board=hash(vec3(0.0,floor(world.y*4.0),floor(world.z*4.5)));
        float streak=sin(world.z*230.0+sin(world.x*7.0)*2.4+sin(world.x*1.7)*4.0);
        float pores=pow(max(0.0,streak),12.0)*.18;
        ALBEDO=mix(vec3(.09,.043,.018),vec3(.24,.13,.056),board)*(.9+grain*.18-pores);
        NORMAL_MAP=vec3(.5+(grain-.5)*.08,.5+streak*.09,1.0);
        ROUGHNESS=.88;
    }
}
