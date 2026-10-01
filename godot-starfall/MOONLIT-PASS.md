# 月影峡道 · Godot / Blender

本关以 `../docs/moonlit-pass-visual-v1/moonlit-pass-hd2d-key-visual.png` 为视觉基准，独立场景保存在同一 Godot 工程，复用星落桥资源。项目默认启动的星落桥不变。

## 打开

双击 `Open-Moonlit.command`，或在 Godot 中打开 `project.godot`，打开 `scenes/moonlit_pass.tscn` 后按 F6 运行当前场景。Blender 源文件为 `source/Moonlit_Pass.blend`；纹理已内嵌打包。

鼠标滚轮缩放、右键拖动 / WASD 平移；1 总览、2 木桥、3 祭坛、4 峡壁近景；R 复位、G 查看原始地形格、H 显示操作说明。仅支持桌面键鼠。

## 场景结构

- `BlenderEnvironment`：真实立体岩壁、两岸、木桥、道路、祭坛、月纹平台、断柱、松林与花草。按建筑构件和材质分组，能在 Blender 中编辑网格，Godot 引用 GLB。
- `TerrainSurface`：原 10×8 地形逐格碰撞与地形类型元数据；仅水格无可站立地面。森林、山地保留通行语义。
- `PixelCharacters`：九个透明像素精灵与脚底接触阴影。角色朝向镜头，原部署与敌方格位不变。
- `MovingWater`、`LivingFlames`、`BrazierLights`、`RavineMist`：独立的水流、瀑布、火焰、暖光与局部低雾。
- `DioramaCamera`：四组可切换镜头；保留近景景深，远处星空和月牙保持清晰。

这是可编辑、可运行的关卡场景制作交付。浏览器项目的回合规则、招募、任务和存档仍由现有 TypeScript 实现；此场景没有重复实现战斗系统。

## 素材来源

复用星落桥 `.blend` 内的石灰岩、河床岩、旧橡木、树皮、松针、土地、草叶、铜质材料与贴图；松树沿用原针叶枝片建模函数，并重新布局。没有从参考图裁剪场景贴在背景上。

新建：分层玄武岩峡壁与像素颗粒纹理、三格宽木桥与桥墩、月纹出发平台、同心石阶祭坛、断裂门拱与悬挂月牙、符文方尖碑、破损石柱、火盆、远处废弃拱桥、地表碎石及蕨草细节。远景拱桥是装饰，不增加原地图路线。

坐标单位为米，每格 2 m。水面在 Y=−1.25 m，河床格位数据为 −2.4 m；河流无可站立碰撞。Godot 格心 X=(列−4.5)×2，Z=(行−3.5)×2，Y 向上；Blender +Y 为北、Z 向上。glTF 自动转换轴向。`assets/moonlit-layout.json` 记录地形、每格站立高度、角色、火盆与瀑布位置。

## 重建与验证

在本目录运行：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python source/build_moonlit.py
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --log-file /tmp/moonlit-import.log --editor --import
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --log-file /tmp/moonlit-build.log --script res://scripts/build_moonlit_scene.gd
python3 source/verify_moonlit.py
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --log-file /tmp/moonlit-verify.log res://scenes/moonlit_pass.tscn -- --verify
/Applications/Godot.app/Contents/MacOS/Godot --path . --log-file /tmp/moonlit-capture.log --rendering-driver metal --resolution 1600x900 res://scenes/moonlit_pass.tscn -- --capture-moonlit
```

截图与运行数据在 `evidence/moonlit/`。导出资产报告为 `asset-build.json`，引擎截图为 `overview.png`、`bridge.png`、`altar.png`、`cliff-detail.png`，实际渲染统计为 `runtime.json`。

## 峡壁与月夜修订（2026-09-18）

两侧与后方峡壁改为闭合的连续岩体：Perlin 多尺度侵蚀、深纵向断裂、不规则岩顶、悬挑岩面、崖脚角砾。Godot 使用独立的世界坐标岩石材质叠加细裂纹、颗粒、苔痕与近水湿润变化，避免把岩壁绘制成砖石。

左上方打开远景山隙，天空着色器生成固定世界方向的星点和月牙。两束带阴影的冷色聚光配合局部体积雾，产生洒向林间与道路的月光。取消远景景深以保证星点和月牙清晰，保留前景景深。地形格位与通行碰撞不变。

`source/verify_moonlit.py` 额外检查西壁、东壁和后方岩壁的三角边闭合及朝外体积。新版总览和峡壁近景可与 `evidence/moonlit/cliff-v2/before.png` 对照。
