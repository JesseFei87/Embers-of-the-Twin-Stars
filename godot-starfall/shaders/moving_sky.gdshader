shader_type sky;

uniform float cloud_time = 0.0;
uniform float night_blend : hint_range(0.0,1.0) = 0.0;
uniform vec3 sun_direction = vec3(-0.562,0.781,-0.273);
uniform vec2 wind = vec2(0.018,0.006);

float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){
    return noise(p)*.53+noise(p*2.03+17.1)*.27+noise(p*4.07+8.3)*.13+noise(p*8.17)*.07;
}
void sky(){
    vec3 ray=normalize(EYEDIR);
    float height=max(0.0,ray.y);
    vec3 horizon=mix(vec3(.36,.53,.62),vec3(.033,.055,.092),night_blend);
    vec3 zenith=mix(vec3(.035,.15,.34),vec3(.007,.016,.042),night_blend);
    vec3 base=mix(horizon,zenith,pow(height,.45));
    float sun_dot=max(0.0,dot(ray,normalize(sun_direction)));
    base+=vec3(1.0,.69,.33)*pow(sun_dot,18.0)*.5*(1.0-night_blend);
    base+=vec3(5.0,3.9,2.2)*smoothstep(.9995,.99985,sun_dot)*(1.0-night_blend);
    if(ray.y>0.005){
        vec2 p=ray.xz/(ray.y+.12)*2.3+wind*cloud_time;
        float body=fbm(p);
        float veil=fbm(p*.52+vec2(12.0,-7.0)+wind*cloud_time*.3);
        float cloud=smoothstep(.45,.66,body+veil*.10)*smoothstep(.005,.12,ray.y);
        float shade=clamp((fbm(p+vec2(-.12,-.08))-body)*3.5+.45,0.0,1.0);
        float edge=smoothstep(.44,.58,body)-smoothstep(.58,.72,body);
        vec3 shadow=mix(vec3(.33,.43,.49),vec3(.035,.050,.079),night_blend);
        vec3 lit=mix(vec3(.94,.89,.73),vec3(.11,.15,.21),night_blend);
        vec3 cloud_color=mix(shadow,lit,shade*.65+smoothstep(.47,.71,body)*.35);
        cloud_color+=vec3(.28,.19,.08)*edge*pow(sun_dot,5.0)*(1.0-night_blend);
        base=mix(base,cloud_color,cloud*.93);
    }
    // A cheap smooth cubemap keeps moving clouds from making noisy reflections.
    COLOR=AT_CUBEMAP_PASS ? mix(horizon,zenith,pow(height,.45)) : base;
}
