shader_type spatial;
// World-space weathering on continuous rock geometry; masonry keeps its own material.
varying vec3 world;
varying vec3 slope;
float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise(vec3 p){
 vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
 return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float detail(vec3 p){return noise(p)*.58+noise(p*2.13)*.27+noise(p*4.51)*.15;}
void vertex(){world=(MODEL_MATRIX*vec4(VERTEX,1)).xyz;slope=normalize(MODEL_NORMAL_MATRIX*NORMAL);}
void fragment(){
 vec3 p=world;
 float broad=detail(p*vec3(.65,.42,.65));
 float grain=hash(floor(p*80.0));
 float warp=noise(p*.53);
 float joints=abs(sin((p.x+p.z*.77)*2.3+noise(p*1.2)*1.5+p.y*.17));
 float fissure=(1.0-smoothstep(.018,.078,joints))*smoothstep(.36,.69,noise(p*2.1));
 float layers=noise(vec3(p.x*.35,p.y*8.0+warp*9.0,p.z*.35));
 vec3 rock=mix(vec3(.11,.135,.17),vec3(.25,.28,.32),broad);
 rock*=.88+.06*layers+.09*grain;
 rock*=1.0-fissure*.58;
 float damp=(1.0-smoothstep(-2.0,1.2,p.y))*.35;
 float moss=smoothstep(.58,.76,noise(p*1.7))*smoothstep(.45,.86,slope.y);
 ALBEDO=mix(rock,vec3(.045,.067,.036),moss*.60)*(1.0-damp);
 ROUGHNESS=.91-damp*.55;
 float dx=detail((p+vec3(.035,0,.01))*14.0)-detail(p*14.0);
 float dy=detail((p+vec3(0,.035,.01))*14.0)-detail(p*14.0);
 NORMAL_MAP=normalize(vec3(-dx*1.2,-dy*1.2,1.0))*.5+.5;
 NORMAL_MAP_DEPTH=.8;
}
