shader_type spatial;
render_mode cull_disabled, depth_draw_never, shadows_disabled;

uniform float motion_time = 0.0;
uniform bool splash = false;

float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p) {
    vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);
}

void fragment() {
    float brightness;
    float opacity;
    if (splash) {
        vec2 p=(UV-vec2(.5))*2.0;
        float radius=length(p);
        float edge=1.0-smoothstep(.35,.96,radius);
        float foam=noise(vec2(UV.x*12.0,UV.y*10.0-motion_time*.35));
        float rings=pow(.5+.5*sin(radius*22.0-motion_time*3.0),6.0);
        brightness=.20+foam*.38+rings*.12;
        opacity=edge*(.10+foam*.24+rings*.10);
    } else {
        // Quad UV.y grows downwards: features travel down instead of sliding
        // a square noise texture over an opaque panel. Stream edges stay still.
        float y=UV.y;
        float fringe=.055+.012*sin(y*14.0)+.010*sin(y*31.0);
        float edge=smoothstep(fringe,fringe+.12,UV.x)*(1.0-smoothstep(1.0-fringe-.12,1.0-fringe,UV.x));
        edge*=smoothstep(0.0,.075,y)*(1.0-smoothstep(.80,1.0,y));
        float bend=.42*sin(y*7.0)+.22*sin(y*17.0);
        float strands=noise(vec2(UV.x*38.0+bend,y*2.5-motion_time*.5));
        float fine=noise(vec2(UV.x*105.0,y*3.0-motion_time*1.15));
        float rivulets=smoothstep(.38,.79,strands);
        float glints=pow(.5+.5*sin(y*40.0-motion_time*23.0+UV.x*19.0),10.0)*fine;
        brightness=.14+rivulets*.46+fine*.10+glints*.10;
        opacity=edge*(.12+rivulets*.42+fine*.10);
    }
    ALBEDO=mix(vec3(.035,.11,.16),vec3(.39,.58,.66),brightness);
    ROUGHNESS=.34;
    SPECULAR=.16;
    EMISSION=ALBEDO*.025;
    ALPHA=opacity;
}
