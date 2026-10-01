# 北境诸国 · 图片世界地图

## 已实现

- 直接使用用户指定的 1672×941 原图 `public/assets/world-map/northern-realms.png`，等比显示村庄、古桥、神殿、雪岭和灰烬城堡。
- 大地图使用图片与 DOM 节点、像素角色；不再加载旧大地图 GLB、WebGL 渲染器、环视或旋转控件。减少动态设置停止像素角色动画与敌方巡动。
- 羊皮纸标题、旅行栏、地点旅记与操作按钮；仅桌面鼠标键盘。
- `layout.json` 的逻辑道路驱动寻路，`image` / `imagePoints` 映射到图片坐标，旧存档坐标保持不变。点击节点沿道路自动行走；WASD/方向键在道路端点选择下一段；Esc 停步。旧自由移动存档会投影到最近道路，不清空队伍或主线进度。
- 两处低难度、无前置、可重复支线：苔灯林地（苔灯灵×3）与潮汐浅湾（潮壳蟹×3）。均使用独立 Blender 三维战场、正常回合战斗与经验系统。
- 支线胜利保留战斗经验并恢复全队生命；单独累计 encounterWins，不改 completedChapterIds，不解锁主线、不重复发放主线奖励。3 名 Lv.1–2 魔物，目标全灭，限时 30 回合。

## 文件

- 大地图原图：`public/assets/world-map/northern-realms.png`
- 旧大地图源文件仅保留历史资料，不继续修改：`world-map/source/northern-realms.blend`
- 支线源文件：`world-map/source/moss-hollow.blend`、`tide-cove.blend`
- 可复现 Blender 脚本：`world-map/source/build_world.py`
- 导出模型、道路高度、烟囱发射点：`public/assets/world3d/`
- 道路唯一逻辑来源：`src/game/world/layout.json`
- 寻路：`src/game/world/RoadNetwork.ts`
- 世界渲染：`src/game/world/WorldMapView.ts`
- 地图 UI/流程：`src/game/WorldScene.ts`、`src/world-map.css`
- 自动验证：`node scripts/verify-world-map.mjs`（已加入 npm test）

历史模型重建命令（图片大地图不需要运行）：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python-exit-code 1 --python world-map/source/build_world.py
```

世界 UI 共用既有 paper-grain、battle-v2/action-button 素材。当前大地图直接使用指定原图作为背景，保留可交互节点和沿路移动。

## 原创魔物素材

使用内置 image_gen 生成两行六帧透明像素图集，原图保留于 `world-map/source/sprites/monsters-original.png`。利用 sprite-pipeline 的 shared-scale/bottom-center normalization 保留 alpha，输出 `public/assets/starfall/animations/{mossling,tidecrab}/01..06.png` 与 `public/assets/hd2d/{mossling,tidecrab}/01..06.png`。六帧依次为待机、走路左/右、攻击、受击、呼吸待机。未调用付费外部素材服务。

生成提示词摘要（内置工具）：Production pixel-art sprite atlas, 6 columns × 2 rows, transparent RGBA. Row 1 original moss lantern spirit with leaf hood, root feet, amber eyes and glowing bud; row 2 original blue-teal tide shell crab with ivory spiral shell and asymmetric amber pincers. Same identity, palette, scale, bottom-center anchor and 3/4 right-facing direction across each row. Six poses: idle, walking left/right, attack, hurt, breathing idle. Crisp JRPG pixel clusters; no scenery, labels, ground shadows or frames.

## 验收范围

- 所有地点两两寻路、旧存档投影、键盘与暂停始终在道路上。
- 每处支线连续结算两次，经验跨存档保留，主线解锁/背包无变化。
- 原有战斗、存档、星落桥/月影峡道模型和规则回归。
- 桌面浏览器实际节点行走、整备、出征、魔物攻击、经验结算、返回与再次进入。

完整生成提示词：`world-map/source/sprites/prompt.txt`。实机截图和记录见 `docs/world-map-evidence/`。本机均衡画质短时采样约 58 FPS（非所有硬件保证）；验收使用隔离的 localhost 存档，未改动用户 127.0.0.1 存档。
