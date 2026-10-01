# HD-2D 美术清单与最终提示词规格

生成方式：内置 ImageGen，未调用付费 API / CLI 后备路径。选中的素材均已复制到本项目；精灵仅做透明连通区域分割、统一比例缩放及底部锚点归一化，不用程序重绘人物。透明失败的法师候选没有用于游戏。

以下记录交付版的提示词规格，便于后续一致性再生成；不是所有逐次重试调用的原始日志。

## 交付路径

| 文件或目录 | 使用位置 |
| --- | --- |
| `public/assets/world-atlas-v4.png` | 世界地图、标题及面板背景 |
| `public/assets/hd2d/village.png` | 晨雾村场景 |
| `public/assets/hd2d/battle.png` | 战斗舞台；第二章叠加冷月光色调 |
| `public/assets/hd2d/terrain.png` | 4×2 地形图集 |
| `public/assets/hd2d/props.png` | 4×2 透明景物图集 |
| `public/assets/hd2d/portraits.png` | 4×2 手绘肖像图集 |
| `public/assets/hd2d/{sword,lancer,cavalry,knight,raider,mage}/01.png` … `06.png` | 六套兵种，每套六张 256×256 透明精灵 |

场景分辨率主要为 1536×1024；肖像与地形图集为 1774×887。游戏加载公共目录内的文件，不依赖生成工具默认保存目录。

## 场景提示词

共同要求：原创剑与魔法世界，高品质 2D 绘画与精细像素场景统一；柔和空气透视、暖金与青蓝光影、清晰可玩的前景。不得包含文字、UI、网格线、水印，不采用塑料质感 3D 人物。

**世界地图**：Wide illustrated fantasy overworld for an original tactical RPG. Northern valleys, winding river, old stone crossing, village in the lower-left, ancient star sanctuary in the middle-right, snowy mountain pass toward the upper-right, distant frontier. Rich painterly geography with clear landmarks and usable space for a small walking hero and node overlays. No baked-in UI or text.

**村庄**：HD-2D fantasy village environment, elevated game camera, warm late-afternoon atmosphere. Timber-and-stone cottages, shrine-like chapel, riverside details, lanterns, flowers and lush foliage. Keep the central stone plaza and path to the bottom entrance open for a player sprite; buildings frame the plaza rather than obstruct it. No people, no text, no interface.

**战斗**：Cinematic 2D fantasy battlefield backdrop. Grand ruined stone arches, distant castle and aqueduct, cascading river, misty mountains, warm rim light. Wide side-view staging with a continuous flat ground strip near the bottom for two opposing fighters. Strong depth and hand-painted detail, quiet central negative space; no fighters, text or UI.

**地形**：Eight detailed HD-2D terrain tiles in a strict four-column, two-row atlas. Row one: meadow, forest floor/trees, rocky small hill, turquoise river water. Row two: wooden bridge, worn cobbled road, star sanctuary, village house. Consistent elevated game camera, dense natural texture, aligned tile cells, no labels or grid borders. Grass, water and cobble must read as repeatable ground surfaces.

**透明景物**：Eight isolated HD-2D scenery objects in a four-column, two-row layout on genuine transparent alpha. First row: pine tree, golden deciduous tree, leafy shrub, rocky mound. Second row: timber cottage, ancient shrine, boulder, ivy-covered stone wall with lantern. Consistent elevated view, refined pixel clusters, detailed plants and weathered stone. Entire objects including branches and roofs must remain inside their cells. No white background, no drawn checkerboard, no labels.

## 肖像提示词

Modern premium hand-painted 2D fantasy JRPG portraits, expressive eyes, sophisticated anatomy, detailed fabric and metal, atmospheric backgrounds and subtle rim light. Eight independent square portraits in a strict 4×2 grid, same visual finish, head-and-shoulders framing, no borders, captions, text or watermark. Original identities, not copies of existing game characters.

画面顺序与人物约束：

1. 凯尔：深蓝黑发、年轻剑士、蓝色披风与星纹护甲，沉稳、坚定、重视同伴。
2. 米菈：深色长发、绿色披风与枪卫护甲，坚毅、冷静、可靠。
3. 莱拉：浅色长发、白金骑士装束、圣职气质，温柔但勇敢。
4. 诺克斯：可爱但机敏的年轻女性斥候，独立女性面孔，轻甲与兜帽元素，不与普通敌兵共脸。
5. 艾琳：年轻守关女枪兵，苍月色系铠甲，克制、正直、决心保护他人。
6. 赛勒涅：冷峻骄傲的月蚀女巫，深紫长发与暗色华服，神秘而危险。
7. 蚀月重甲：封闭式黑紫金属头盔，冷硬、无名的敌军形象。
8. 通用法师：独立男性术士，法袍和魔法光晕，与主要女性角色区分。

旧编号由 `src/game/ui/portraits.ts` 和 `src/ui-theme.css` 映射，不修改角色规则数据。

## 六姿态精灵提示词

Generate one continuous six-frame animation strip for an original HD-2D tactical RPG unit. Refined pixel-art character, crisp clustered pixels, strong readable silhouette, rich costume detail, consistent anatomy and equipment, never a glossy 3D render. All six poses face RIGHT, use the same camera, body size and bottom-center ground anchor. Full body and complete weapon visible in every pose with generous separation. Genuine transparent alpha background; no floor, labels, border, contact shadow or drawn checkerboard. Frames left to right: 1 idle ready, 2 walking left foot forward, 3 walking right foot forward, 4 attack/cast wind-up, 5 weapon extension or spell release, 6 recovery back toward ready. Preserve identity across all six poses; keep motion readable and suitable for smooth travel interpolation.

兵种主题替换：

- `sword`：年轻深蓝发剑士、蓝披风、银色护甲、长剑；蓄剑、出剑、收剑。
- `lancer`：深发女枪卫、苍绿色披风、轻型金属甲、长枪；后撤蓄力、水平突刺、回收。
- `cavalry`：浅发白金女骑士骑白马、红色披风细节、长柄武器；六格都包含完整坐骑，骑手身份及马匹体型一致。
- `knight`：黑紫重甲、金属金边、大盾和剑；重心下沉、盾剑推进、恢复架势。
- `raider`：暗红兜帽轻甲斥候、轻巧双刃；交错步行、蓄势、快速双刃伸展。
- `mage`：紫发月蚀女巫、深紫金纹法袍、紫晶法杖；两步行走、举杖、向前释法、收势。光效不得把背景变成不透明图案。

原始选中精灵条带位于忽略提交的 `work/hd2d/`。本地 `scripts/normalize-hd2d.py` 提供共同缩放与锚点导出，切勿逐帧独立缩放，否则行走时会忽大忽小。
