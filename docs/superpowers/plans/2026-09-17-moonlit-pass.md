# Moonlit Pass Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent implementation and review.

**Goal:** Deliver an editable Blender environment and runnable Godot HD-2D Moonlit Pass map matching the approved concept.

**Architecture:** Add a sibling level to godot-starfall. Blender supplies original modular environment geometry and reused Starfall materials/pines; Godot supplies moving water, fog, fire, pixel cast, inspection cameras and terrain metadata. Existing browser rules remain the source of terrain semantics.

**Tech Stack:** Blender 4.5 Python; glTF; Godot 4.6 Forward+ / Metal; GDScript.

**Spec:** docs/moonlit-pass-visual-v1/README.md and moonlit-pass-hd2d-key-visual.png.

## Global Constraints
- Desktop only; keep Starfall and browser battle unchanged.
- Retain 10×8 cells, cell size 2 m, north = Godot −Z / Blender +Y.
- Main banks y=0 in Godot; north bank rises gradually to .45; riverbed y=−2.4, visible water y=−1.25. Bridge center X=−1, Z=−1, deck Y=.12. Southern shrine center (0,.18,7). Altar center (7,1.35,−7).
- Reuse Starfall materials and original pine generator. Create cliffs, timber bridge, ruined pillars, moon shrine/altar and braziers.

### Task 1: Blender environment
- [x] Create source/build_moonlit.py. Read Starfall .blend material datablocks; use original pine helper definitions without running Starfall world generation. Build banks, stratified cliffs, cobbled route, bridge, altar, broken arch, crescent relief, ruins, flowers, roots and foreground trees.
- [x] Export source/Moonlit_Pass.blend, assets/models/moonlit_environment.glb, assets/moonlit-layout.json with rows, lamps, actor heights, asset provenance.
- [x] Verify exported GLB structure, material alpha and packed images, nonempty scene, exact terrain/deployment metadata.

### Task 2: Godot assembly
- [x] Create scripts/build_moonlit_scene.gd and scripts/moonlit_pass.gd, shaders/moonlit_water.gdshader and needed effect shaders. Consume imported GLB and layout JSON, reuse sprites-hd2d.
- [x] Save scenes/moonlit_pass.tscn; add independent Open-Moonlit.command. Real 3D perspective/high-angle camera (wide composition), blue moonlight, amber braziers, purple altar, localized river mist, animated water/fire/waterfalls.
- [x] Add desktop camera controls, three focus presets and hidden terrain grid. Implement --verify and --capture-moonlit, writing evidence/moonlit/overview.png, bridge.png, altar.png and runtime.json.

### Task 3: Visual and runtime verification
- [x] Run Blender build, Godot headless import/build and --verify; fix failures.
- [x] Run actual Metal renderer at 1600×900, inspect all three captures against concept; fix composition/lighting/occlusion discrepancies.
- [x] Document launch/rebuild, reused/new assets, editable geometry and production boundaries. Report actual verification results with screenshot.

Ruling: Work in the authorized existing workspace because all existing project files are untracked; a new git worktree would omit the source assets. Do not commit unrelated files.

Validation: source/verify_moonlit.py and native Godot --verify pass. Final Metal captures reviewed at 1600×900. Source/output paths documented in godot-starfall/MOONLIT-PASS.md.
