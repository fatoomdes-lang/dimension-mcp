# Working with Adobe Dimension (for Codex and other agents)

This repository is an MCP server for Adobe Dimension. When the `dimension` MCP tools are available, follow this guide.


## Start
1. `dimension_launch`. If Dimension is already open normally it refuses: ask the user to save, then call it with `restart: true`.
2. `dimension_status`, then `dimension_scene` to learn paths. Every other tool takes a scene path (or an exact label).
3. Never use `dimension_document` open/new over unsaved work without the user's OK.

## Build a scene
- Models: `dimension_assets` (query e.g. "bottle", "box", "can", "tube"; type MODEL) → `dimension_add {asset}`. Basic shapes are `cube`, `sphere`, `cylinder`, `cone`, `plane`, `torus`; `text` adds 3D text. A file from disk: `dimension_add {file}` (OBJ, FBX, GLB/GLTF, STL, SKP, DN).
- Custom shapes the library lacks: build them in Blender (blender MCP) or generate them, export GLB, then `dimension_add {file}`.
- Materials: `dimension_material {target}` lists properties; `set: {property, value}`.
  - Colors: `base_color` with "#rrggbb" or [r,g,b]. Finish: `roughness` 0 (glossy) – 1 (matte), `metallic` 0–1, `opacity`, `emission`.
  - An image path as the value sets that channel's texture.
  - Library materials: `dimension_select` the object, then `dimension_add {asset: "<material name>"}`.
- Logos and labels: `dimension_decal {target: mesh path, image}`. Use the mesh that should carry it (e.g. the tube body, not the cap).
- Reference image composition: look at the user's image, then `dimension_background {image, match: {resize, perspective, lighting}}`, then arrange objects to match (see transforms below) and check with `dimension_view`.
- Place objects: `dimension_transform {target, set: {position, rotation, scale | size}}` (cm, degrees). A `plane` starts 20×20 cm lying flat; `rotation: [90, 0, 0]` stands it up facing the FRONT camera.
- Camera: `dimension_camera {view: "FRONT", items: [path]}` sets a preset view and frames those items (or everything).

## Artwork from Illustrator, Photoshop or other apps
Design the artwork in its app, export a PNG (high resolution), then use it here:
- On a product: `dimension_decal {target: mesh, image}`.
- As a poster, print, screen or sign: add a `plane`, size it to the print (e.g. `scale: [2.5, 1, 3.5]` = 50×70 cm), stand it up, and set `dimension_material {target: plane, set: {property: "base_color", value: "/abs/art.png"}}`. Add a second, larger plane behind it as the wall and one as the floor; library materials such as "Oak Wood" go on with select + `dimension_add {asset}`.
- Illustrator MCP and Arabic: its `run` tool garbles non-ASCII text (and \u escapes). Build strings with `String.fromCharCode(0x62f, 0x648, ...)`, set `paragraphDirection = ParagraphDirectionType.RIGHT_TO_LEFT_DIRECTION` and `composerEngine = ComposerEngineType.optycaComposer`, and use an Arabic font (e.g. GeezaPro-Bold).

## Check your work
- `dimension_view` (viewport) = what the render camera sees. Use it after every meaningful change and compare with the request or the reference image.
- `dimension_view {target: "window"}` shows the whole app, including dialogs that may be blocking.
- Framing: `dimension_camera` (preset view + frame), or in `dimension_run`: `await d.setView("FRONT_RIGHT_TOP"); await d.frame()`.

## Output
- `dimension_render {folder, name}` → PNG(s); the result lists the files (Dimension may append the camera name).
- `dimension_document {action: "save", path: "/abs/file.dn"}`.

## Anything else: `dimension_run`
Modern JS with async/await; `d` = helpers, `d.app` = Dimension's AppController.
- Discover: `d.controllers()`, `d.methodsOf(d.app.cameraController)`, `d.actionTypes("CAMERA")`.
- Learn before calling: `dimension_source {pattern}` / `{file, from, to}` reads Dimension's own source (controllers in `*Controller.js6`, actions in `*Actions.js6`, handlers in `onDispatch`).
- Dispatch app actions: `d.dispatch("ACTION_TYPE", data)` with the data shape the handler destructures.
- Node properties: `const n = await d.cache().fetch(path); Object.keys(n.properties)`; values are remote: `await n.properties.x.getValue()`; write with `d.setNodeProperty(path, name, value)`.
- Undo is Cmd+Z in Dimension; every change goes through the app's history.

## Gotchas
- Dimension's old Chrome accepts one debug connection at a time. If tools fail with "main window is not ready" while Dimension is open, another Claude session (or a test script) is connected: close it.
- The snapshot lags behind edits; `dimension_view` already waits ~2.5 s. Take another if it looks stale.
- After a decal, a material becomes a layer stack; `dimension_material` edits the base material. To change the decal itself, target its MATERIAL_LAYER path.
- Dimension's Chrome is version 49: avoid APIs newer than 2016 inside `dimension_run` beyond what esbuild lowers (syntax is fine; e.g. `Array.prototype.includes` exists, `Object.entries` does not).
