shader_type sky;
uniform float cloud_time=0.0;
uniform vec3 moon_direction=vec3(-.6,-.3,-.7);
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
float cloud_hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float cloud_noise(vec3 p){
 vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
 return mix(mix(mix(cloud_hash(i),cloud_hash(i+vec3(1,0,0)),f.x),mix(cloud_hash(i+vec3(0,1,0)),cloud_hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(cloud_hash(i+vec3(0,0,1)),cloud_hash(i+vec3(1,0,1)),f.x),mix(cloud_hash(i+vec3(0,1,1)),cloud_hash(i+vec3(1)),f.x),f.y),f.z);
}
void sky(){
 vec3 ray=normalize(EYEDIR);
 vec2 sphere=vec2(atan(ray.z,ray.x),asin(ray.y));
 float nebula=noise(sphere*8.0)*.6+noise(sphere*21.0)*.4;
 vec3 color=mix(vec3(.002,.006,.017),vec3(.012,.027,.065),nebula);
 // Sparse stars of different magnitudes, fixed in world sky directions.
 vec2 grid=sphere*vec2(320.0,260.0),cell=floor(grid),f=fract(grid);
 vec2 center=vec2(hash(cell+13.0),hash(cell+49.0))*.64+.18;
 float seed=hash(cell+97.0);
 float star=(1.0-smoothstep(.008,.07,length(f-center)))*step(.91,seed);
 color+=mix(vec3(.35,.51,.83),vec3(.85,.87,.73),hash(cell))*star*(.45+seed);
 vec3 direction=normalize(moon_direction);
 vec3 right=normalize(cross(direction,vec3(0,1,0)));
 vec3 up=normalize(cross(right,direction));
 vec2 uv=vec2(dot(ray,right),dot(ray,up));
 float facing=step(.9,dot(ray,direction));
 float outer=1.0-smoothstep(.016,.0166,length(uv));
 float eclipse=smoothstep(.0156,.0163,length(uv-vec2(.008,.004)));
 float crescent=outer*eclipse*facing;
 float dust=.86+.14*noise(uv*1400.0);
 color+=vec3(.62,.76,1.0)*crescent*dust*1.6;
 color+=vec3(.075,.13,.24)*exp(-length(uv)*70.0)*facing*.35;
 // World-direction noise avoids the longitude seam and never sticks to the camera.
 vec3 drift=vec3(cloud_time*.010,0.0,cloud_time*.004);
 vec3 cloud_p=ray*vec3(4.5,10.0,4.5)+drift;
 float cloud_field=cloud_noise(cloud_p)*.58+cloud_noise(cloud_p*2.07)*.28+cloud_noise(cloud_p*4.19)*.14;
 float cloud=smoothstep(.47,.72,cloud_field)*.66;
 vec3 cloud_color=mix(vec3(.025,.04,.075),vec3(.12,.17,.25),cloud_field);
 color=mix(color,cloud_color,cloud);
 COLOR=color;
}
