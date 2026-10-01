# 艾琳半身像与月影峡道视角修订

2026-09-19。

## 变更

- 月影峡道水平旋转由 ±0.06 扩大至 ±0.45 弧度（左右各约 26°），俯视角约 30°–57°，默认由约 46°降低至约 37°。
- 像素人物通过独立朝向节点同时跟随相机俯仰和水平角度，保留原始宽高比；地面阴影、阵营环和棋格脚底位置不随贴片倾斜。攻击倾身与受击偏移继续在人物本地执行。
- 为扩大旋转后的陡俯视补充左右外侧岩脊，复用原峡壁网格和材质，覆盖可见地板边缘，不改棋盘和通行规则。
- 艾琳重绘为头至腰带的透明半身像，保留赤褐长辫、雀斑、白披肩、银甲、蓝腰带及单手剑；编队、战场和详情共用新文件 `public/assets/chronicle/battle-v2/eileen-bust-refined.png`。
- 新人物半身构图、画风参考、真实 Alpha 和两处 UI 验收要求已写入 `AGENTS.md`。

## 验收

`npm test` 与 `npm run build` 通过。新增视角范围断言，并检验 6 种角色在 9 组俯仰/旋转角下屏幕宽高比、脚底锚点与地面环不倾斜。实机检查 1280×720、1440×810、1920×1080、1074×909，左右旋转、俯仰极值和近景，修补外侧地板边缘后复查。最大俯视和旋转下完成 (4,6) → (5,6) 移动及战斗，角色动作结束恢复 roll=0、scale=(1,1,1)，浏览器无错误。战场选中艾琳与招募后的编队界面使用同一张 1205×1305 新立绘，截图见 `moonlit-camera-portrait-evidence/`。

## 生成记录

使用内置 image_gen，未使用 CLI/API 回退。以旧艾琳为身份参考，米菈和凯尔为画风及构图参考。输出为 1205×1305 RGBA，Alpha 覆盖 0–255，轮廓外真实透明；未用程序抠图或绘画修改生成结果。

最终提示词：

Use case: style-transfer. Redraw Eileen as a production Japanese fantasy RPG HALF-BODY transparent cutout portrait. Image 1 is Eileen identity reference ONLY: preserve young adult woman, warm amber eyes, light freckles, auburn/copper red hair in one long thick braid, ivory white shoulder cape, restrained silver plate armor, sapphire clasp, blue waist sash, one-handed sword. Image 2 Mira and image 3 Kael are the EXACT STYLE AND FRAMING REFERENCES: polished detailed painted anime game character art, crisp confident linework, refined face, layered rich fabric, hand-painted metal, natural proportions. Make Eileen consistent with those two protagonists. Composition head to WAIST ONLY, like image 2 and 3: large readable face, complete hair top and both shoulders, lower crop at the belt, no thighs or legs. Three-quarter relaxed confident pose, braid draped over her shoulder to waist, gloved hand resting on sword hilt near waist, white cape draped naturally. Character fills canvas with clean expressive silhouette. True RGBA TRANSPARENT background, fully transparent outside silhouette including gaps; NO black/brown backdrop, NO gradient, NO glow halo, no scene, no card, no border, no lettering, no cast background shadow. Deliver one high-quality transparent portrait PNG approximately 1200x1300, not a tall full-body character card.
