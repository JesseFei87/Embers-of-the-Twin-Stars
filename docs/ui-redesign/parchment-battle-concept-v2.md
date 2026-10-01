# 羊皮纸战场重设计 V2

状态：图像概念稿，尚未接入游戏。使用内置 image_gen；工具未暴露模型版本选择，未声称调用 image2.5。

设计图：parchment-battle-concept-v2.png。一个视觉方向，展示角色选中、战场总览、战场菜单三种状态。

参考：用户本轮三张现状截图，以及 public/assets/chronicle/replica/formation-plate.png 和 hud-overlay.png。前者用于功能和场景结构，后两者用于美术材质语言。

生成提示词：

```text
Use case: ui-mockup. Create ONE cohesive, high-fidelity art-directed redesign presentation for the deployed battle UI of the Chinese fantasy tactical RPG 双星余烬, titled “星落桥 · 战场界面”. This is ONE visual design direction with three states, not three alternative concepts. Target canvas 3200 x 3200, razor-sharp readable Chinese, no device frame or browser chrome.

REFERENCE ROLES (all attached):
Images 1,2,3 are current rejected in-game interfaces: preserve their gameplay functionality and recognizable scene, NOT their weak beige rounded-card visual styling. Image 1 idle battlefield. Image 2 selected character. Image 3 battle menu.
Image 4 formation-plate.png is the AUTHORITATIVE art/style reference. Image 5 hud-overlay.png is the AUTHORITATIVE material/ornament reference. Match their real aged parchment fibers, irregular browned edges, curled paper corners, antique brass sculpted filigree, tiny metal fasteners, navy woven banner accents, compass-star insignia, restrained red wax seals. Do not copy their huge full-screen frame. Translate their crafted physical fantasy materials into small, elegant edge-attached battle UI.
This must look painted and produced by a senior fantasy game UI artist, NOT CSS gradients, rounded rectangular cards, dashboard widgets, shiny beige bevels or gold-outline web buttons.

PRESENTATION:
A dark midnight-blue editorial design board with quiet tiny headings. Upper ~65%: one very large complete 16:10 game screen in SELECTED CHARACTER state. Beneath, two smaller complete 16:10 game screens side-by-side, clearly labeled “战场总览” and “战场菜单”. All three are the SAME visual language and SAME moonlit Starfall Bridge map. No external lengthy explanation or color swatches. Minimal board margins. Rich detail, readable text. Do not surround game screens with ornamental giant borders.

MAIN SELECTED SCREEN:
Retain the isometric forest battle map with stone path, central wooden bridge over turquoise river, warm lantern cottage to northwest, ruined arch north, softly luminous blue crystal shrine south, and small tactical character sprites. Atmospheric soft moonlight and glimpses of stars, cool blue-green forest with warm amber lights. Central 75% of battlefield entirely playable and unoccluded. Do not turn the scene into a cinematic illustration with huge characters in the middle.
Top left: compact horizontal parchment objective scroll with irregular curled edge held by small brass star brooch and a short navy ribbon. Elegant Chinese serif title “星落桥”. Below, concise “击败蚀月骑士 / 凯尔抵达北岸”. About 19% screen width and 11% height, no oversized quest board.
Top right: small connected antique navigator cluster; brass-rim moon medallion, narrow parchment round label “第 1 回合” / “我方阶段”; below, enlarged circular compass minimap showing recognizable bridge, stream, roads, 3 cyan ally dots and red enemy dots, fine subtle tactical grid (not a crude colored spreadsheet). Attach a small engraved rotation icon tab and “旋转视角”. This cluster stays inside rightmost 15% screen width.
Bottom left: character bust of dark-haired knight 凯尔 in navy cloak, silver armor and fur collar, matching reference 2. Character portrait on FAR LEFT of the information/actions, compact and integrated into layered navy fabric and worn parchment, not floating with a straight crop. Height at most 24% of screen. To its right a slim parchment status strip “凯尔” “Lv.1 · 剑士”, refined green enamel HP line “HP 24/24”, subtle “攻 14　防 4　速 8”. Immediately below, two small tactile engraved buttons “详情” and “待机”; primary “结束回合” uses a restrained navy leather tab in brass casing with a tiny star emblem. All this uses at most bottom-left 31% width x 22% height. No huge opaque character panel.
Bottom right: small closed leather field journal clasp/button marked “菜单”, brass book glyph. Bottom center only a very small, unobtrusive paper slip “选择移动位置”, no full-width toolbar.
Movement overlay must be subtle thin cyan cell outlines and low-opacity fill, NOT the current giant solid turquoise carpet.

LOWER LEFT SCREEN — idle:
Identical scene and edge UI but selected character portrait/info/actions are completely absent; only small bottom-left “结束回合” control remains. Keep middle clear. This communicates contextual UI.

LOWER RIGHT SCREEN — menu overlay:
Same scene dimmed/defocused behind a centered compact open parchment field journal, approximately 48% screen width, ornate but restrained brass corners, dark navy cloth spine, warm textured paper pages with soft stains and fine constellation watermark. Title “战场菜单”. Six menu actions as elegant ink-illustrated rows across two facing pages: “地图与演出”, “查看编队”, “队伍道具”, “当前任务”, “存档信息”, “系统设置”. Small consistent pen-and-ink icons (map, banner, satchel, scroll, quill, cog). Selected row gets a narrow navy ribbon indicator. Footer “返回战场” on a slim brass-bound leather tab. Avoid a grid of six large raised beige buttons. Do not add unavailable features.

Visual hierarchy: rich small-scale handcrafted materials, crisp dark umber text on lighter parchment, burnished gold not chrome yellow, navy restrained. Preserve all state differences. Do not include code, debug values, lorem ipsum, English promotional copy, invented quest content, full-screen inventory panels, bulky borders, or browser UI. This is a REVIEWABLE DESIGN IMAGE, not a claim of implemented game UI.
```

