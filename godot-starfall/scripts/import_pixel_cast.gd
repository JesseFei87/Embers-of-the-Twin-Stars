extends SceneTree
## Convert the generated atlas into small, bottom-aligned runtime sprite textures.
## Flood from the cell boundary so pale armor and the white horse remain enclosed.
func _initialize() -> void:
    var atlas := Image.load_from_file("res://assets/sprites-hd2d/source-atlas.png")
    var roles := ["sword", "cavalry", "lancer", "knight", "mage", "raider"]
    var report := {}
    for index in range(6):
        var cell := atlas.get_region(Rect2i((index % 3)*512, (index / 3)*512, 512, 512))
        cell.convert(Image.FORMAT_RGBA8)
        var visited := PackedByteArray()
        visited.resize(512*512)
        var queue := PackedInt32Array()
        for n in range(512):
            queue.append(n)
            queue.append(511*512+n)
            queue.append(n*512)
            queue.append(n*512+511)
        var cursor := 0
        while cursor < queue.size():
            var p := queue[cursor]
            cursor += 1
            if visited[p]: continue
            visited[p] = 1
            var x := p % 512
            var y := p / 512
            var c := cell.get_pixel(x,y)
            var lo := minf(c.r,minf(c.g,c.b))
            var hi := maxf(c.r,maxf(c.g,c.b))
            if lo < 0.57 or hi-lo > 0.12: continue
            cell.set_pixel(x,y,Color.TRANSPARENT)
            if x>0: queue.append(p-1)
            if x<511: queue.append(p+1)
            if y>0: queue.append(p-512)
            if y<511: queue.append(p+512)
        var bounds := cell.get_used_rect()
        var cropped := cell.get_region(bounds)
        var height := 64 if index==1 or index==2 else 52
        var width := roundi(float(bounds.size.x)*height/bounds.size.y)
        cropped.resize(width,height,Image.INTERPOLATE_NEAREST)
        for y in range(height):
            for x in range(width):
                var c := cropped.get_pixel(x,y)
                if c.a>0.0:
                    c.r=roundf(c.r*23)/23.0
                    c.g=roundf(c.g*23)/23.0
                    c.b=roundf(c.b*23)/23.0
                    cropped.set_pixel(x,y,c)
        assert(cropped.save_png("res://assets/sprites-hd2d/%s.png" % roles[index])==OK)
        report[roles[index]]={"width":width,"height":height,"transparent_corner":cropped.get_pixel(0,0).a==0}
    FileAccess.open("res://evidence/pixel-cast-import.json",FileAccess.WRITE).store_string(JSON.stringify(report,"  "))
    print("PIXEL_CAST_IMPORT ",report)
    quit()
