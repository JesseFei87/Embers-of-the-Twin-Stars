# 月影峡道角色区分（2026-09-19）

- 艾琳 c2recruit：剑士 → 勇者，赤褐长辫、白披肩、蓝腰带、单手剑；招募后称号“誓月剑士”。保留莱拉在第 12 回合前交谈招募。
- 祭坛术士 c2e5：术士，金赭兜帽、覆面、深灰金边长袍、琥珀法杖；星火，1–2 格魔法，施法消耗 1 HP，不可招募。
- 米菈仍为绿披风长枪枪卫。两名敌人使用独立的 ID 视觉映射，招募或晋升不更换身份。
- 同步 Godot 场景、网页 Three.js/Phaser、经典战斗演出、编队和战场透明立绘。
- 旧枪卫存档迁移保留等级、经验、HP、坐标、阵营、行动状态及回合；祭坛术士不会被复活。
- 两套 6 帧动作来自内置 imagegen；透明原图存于 public/assets/starfall/animations/{eileen,altar-mage}/sheet.png。
- 归一化沿用 scripts/normalize-starfall-animation.py：共享缩放、脚底中心锚点，地图站高 52 像素、经典演出 92 像素；Godot 使用相同 idle 的透明裁切。生成完整帧后验收，不借用米菈素材。
- 透明半身像：public/assets/chronicle/battle-v2/eileen-bust.png、altar-mage-bust.png。
- 验证：npm test、npm run build、Godot --verify、--capture-characters。实景位于 godot-starfall/evidence/moonlit/characters/。

## 使用的生成提示词

### 艾琳像素图
Use case: stylized-concept. Production asset for an HD-2D Japanese fantasy tactical RPG. Create a complete SIX FRAME pixel-art sprite atlas of ONE adult woman character, Eileen, on a genuinely transparent alpha background. Wide 1536x1024 sheet, exact 3 columns x 2 rows equal slots, one separate whole character per slot, generous clear gaps, no labels, no scenery, no ground shadow. All frames SAME identity/outfit, same 3/4 facing screen right, same pixel scale and head/body proportions (~3.5 heads tall), crisp visible square pixel clusters, restrained detailed 64-pixel-tall game sprite look, NOT smooth illustration.
Identity: auburn/copper RED-BROWN thick long braided ponytail, exposed freckled face, no hood or helmet; ivory-white short asymmetrical shoulder cape with a small blue clasp, steel breastplate and forearm guards, royal-blue waist sash, charcoal fitted trousers, brown boots, elegant SINGLE-HANDED STRAIGHT SWORD. Small copper braid tie. No spear, no green clothing, no giant shield, no magic. A recognizable named recruitable heroine distinct from generic soldiers.
Exact frames reading left to right top to bottom: (1) relaxed combat-ready idle sword angled down to right, upright feet apart; (2) walking step left foot forward sword kept low; (3) alternate walking step right foot forward; (4) sword raised back in attack preparation knees bent; (5) forward sword slash/lunge, keep blade within slot, no energy trails; (6) flinching recoil with sword held defensively across torso. Preserve outfit, hair and face consistently across all six. Fully visible weapons and boots, none clipped. Real transparency, no baked checkerboard.

修正第 5 帧：保留其余五帧，把过长横向刺击改为紧凑的斜下挥剑，避免经典演出画布裁切，保持统一身体比例。

### 祭坛术士像素图
Use case: stylized-concept. Production transparent pixel sprite atlas for HD-2D Japanese fantasy tactical RPG. Exactly SIX full-body poses of ONE generic enemy altar occultist, 3 columns x 2 rows equal slots, landscape1536x1024. TRUE transparent alpha background, no background, no scenery, no labels, no ground, no shadow. Crisp visible square pixel clusters, detailed 64px-tall game sprite aesthetic with ~3.5 heads proportions, not a smooth large illustration. All six same character, palette, scale and three-quarter facing SCREEN RIGHT.
Character: anonymous intimidating masked ritual mage, face covered by pale bronze beakless narrow vertical mask, ochre/gold angular cowl, charcoal ankle-length split robe with muted gold geometric trim, dark gloves, brown boots visible, bronze bracers; short crooked wooden staff with an amber crystal held near shoulder height, small closed spellbook at belt. No green clothing, no spear, no exposed female longhair, no purple robes, no pointy wizard hat, no large magic effects. Broad triangular cloaked silhouette entirely different from a slender armored sword heroine.
Exact frames reading left-to-right then next row: 1 idle standing staff upright slightly inclined; 2 walking first step; 3 walking opposite step; 4 casting windup staff pulled back hand raised; 5 spell release staff thrust outward, other palm out, tiny amber sparkle only; 6 hurt recoil hunched defensive staff across front. Match pixel density, outfit and proportions in every pose. Separate silhouettes with generous transparent margins, boots and weapon never clipped.

### 艾琳透明半身像
Edit reference character portrait for the same named woman Eileen in an HD-2D Japanese fantasy RPG. Preserve this woman's face, warm brown eyes, auburn long braid, freckles and adult age. Replace outfit to match her redesigned SWORDSMAN identity: ivory-white short shoulder cape with small blue clasp, fitted steel breastplate, steel forearm guards, royal-blue waist sash, brown leather belt; a single-handed straight steel sword angled down along one side. Remove spear and all green garments. Refined detailed Japanese fantasy painted half-body portrait, visible head down through hips and gloved hands, natural anatomy, delicate linework and rich fabric/metal shading. NO pixel art for this portrait. Remove the entire decorative card, frame and background, no emblems behind head. GENUINELY TRANSPARENT ALPHA background, loose clean silhouette, no backdrop, no cast ground shadow. Center character with breathing room around braid and cape, no clipped head. Keep personal identity of reference, only outfit and weapon change.

### 祭坛术士透明半身像
Create a refined detailed Japanese fantasy painted half-body character portrait for a tactical RPG: anonymous enemy altar occultist, pale bronze narrow expressionless full mask with dark eye slits, ochre gold angular cowl, charcoal black layered robe with muted gold geometric embroidered trim, bronze bracers, dark gloves, short crooked wooden staff topped with amber crystal in one hand, small spellbook on belt. Show head through hips, broad triangular robe silhouette. Real transparent alpha background, absolutely NO backdrop, no decorative frame, no card, no floor, no smoky glow. Delicate linework, rich fabric and metal rendering, restrained HD-2D RPG portrait aesthetic; no green outfit, no spear, no exposed hair, no beak or feathers, no purple. Entire hood and staff head fit in canvas.

