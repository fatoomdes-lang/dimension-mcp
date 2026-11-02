// Injected into Dimension's renderer as window.__dmcp.
// Written as modern JS; src/index.js lowers it to ES2015 (which Chrome 49 runs) with esbuild.
// Everything here calls Dimension's own controllers, so edits go through the app's normal
// code paths (history, UI refresh, saving).

(() => {
  const VERSION = "__DMCP_VERSION__";
  if (window.__dmcp && window.__dmcp.version === VERSION) return;

  const dc = window.debugController;
  if (!dc || !dc.app) throw new Error("Dimension is still loading. Try again in a few seconds.");
  const app = dc.app;
  const sg = () => app.sceneGraphController;
  const cache = () => dc.appNodeCache;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const dispatch = (type, data) => {
    if (!(type in dc.dispatcher.actionTypes)) throw new Error(`Unknown action type ${type}`);
    return dc.dispatcher.dispatch({ type, data, typeinfo: {} });
  };

  // JSON-safe copy of app objects (they are full of cycles and remote proxies).
  const toJSON = (value, depth = 0, seen = []) => {
    if (value === null || value === undefined) return value;
    const t = typeof value;
    if (t === "string" || t === "number" || t === "boolean") return value;
    if (t === "function") return undefined;
    if (ArrayBuffer.isView(value)) return Array.prototype.slice.call(value, 0, 64);
    if (seen.indexOf(value) !== -1) return "[circular]";
    if (depth > 12) return `[${(value.constructor && value.constructor.name) || "object"}]`;
    seen = seen.concat([value]);
    if (Array.isArray(value)) return value.slice(0, 200).map((v) => toJSON(v, depth + 1, seen));
    const out = {};
    const ctor = value.constructor && value.constructor.name;
    if (ctor && ctor !== "Object") out.__class = ctor;
    Object.keys(value).slice(0, 80).forEach((k) => {
      if (k === "parent" || k === "_port") return;
      const v = toJSON(value[k], depth + 1, seen);
      if (v !== undefined) out[k] = v;
    });
    return out;
  };

  const labelOf = (item) => item.label || (item.path || "").split("/").pop();

  const flatten = (item = sg().treeRoot, out = []) => {
    if (!item) return out;
    out.push(item);
    (item.children || []).forEach((c) => {
      if (c !== item && c.path !== item.path) flatten(c, out);
    });
    return out;
  };

  const tree = (maxDepth = 8) => {
    const walk = (item, depth) => {
      const node = { label: labelOf(item), type: item.type, path: item.path };
      if (item.isVisible === false) node.hidden = true;
      if (item.isLocked) node.locked = true;
      if (item.isSelected) node.selected = true;
      const kids = (item.children || []).filter((c) => c.path !== item.path);
      if (kids.length && depth < maxDepth) node.children = kids.map((c) => walk(c, depth + 1));
      return node;
    };
    return walk(sg().treeRoot, 0);
  };

  const findItem = (pathOrLabel) => {
    const items = flatten();
    const exact = items.find((i) => i.path === pathOrLabel);
    if (exact) return exact;
    const q = String(pathOrLabel).toLowerCase();
    const byLabel = items.filter((i) => labelOf(i).toLowerCase() === q);
    if (byLabel.length === 1) return byLabel[0];
    if (byLabel.length > 1) throw new Error(`"${pathOrLabel}" matches ${byLabel.length} items: ${byLabel.map((i) => i.path).join(", ")}`);
    throw new Error(`No scene item with path or label "${pathOrLabel}"`);
  };

  const selected = () => (sg().selectionController.selectedTreeItems || []).map((i) => i.path);
  const select = async (paths) => {
    await sg().selectionController.select([].concat(paths).map((p) => findItem(p).path));
    return selected();
  };

  // Scene objects: everything under /scenes/scene except materials and cameras
  // (types include GROUP, MESH, PROCEDURAL_MESH, TEXT_MESH and lights).
  const objectPaths = () =>
    flatten()
      .filter((i) => (i.path || "").indexOf("/scenes/scene/") === 0 && !/^(MATERIAL|MATERIAL_LAYER|CAMERA)$/.test(i.type))
      .map((i) => i.path);

  // Wait for new scene objects to appear after an asynchronous add.
  const waitForNewObjects = async (before, timeoutMs = 60000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sleep(250);
      const added = objectPaths().filter((p) => before.indexOf(p) === -1);
      if (added.length) {
        await sleep(500);
        return objectPaths().filter((p) => before.indexOf(p) === -1);
      }
    }
    throw new Error("Nothing was added to the scene in time.");
  };

  // ---------- starter assets ----------
  const assetList = () => app.assetController.assets || [];
  const assets = ({ query = "", type = "", limit = 60 } = {}) => {
    const q = query.toLowerCase();
    return assetList()
      .filter((a) => (!type || a.type === type.toUpperCase()) && (!q || String(a.name).toLowerCase().indexOf(q) !== -1))
      .slice(0, limit)
      .map((a) => ({ name: a.name, type: a.type, ext: a.ext, group: a.subgroup || undefined }));
  };
  const findAsset = (name) => {
    const list = assetList();
    const exact = list.filter((a) => a.name === name);
    if (exact.length) return exact[0];
    const q = name.toLowerCase();
    const loose = list.filter((a) => String(a.name).toLowerCase().indexOf(q) !== -1);
    if (loose.length === 1) return loose[0];
    if (loose.length > 1) throw new Error(`"${name}" matches several assets: ${loose.slice(0, 15).map((a) => a.name).join(", ")}`);
    throw new Error(`No starter asset named "${name}". Use dimension_assets to search.`);
  };

  const addAsset = async (name) => {
    const asset = findAsset(name);
    if (asset.type === "MATERIAL") {
      dispatch("MATERIAL_ADD", { asset, isAddOnly: false });
      await sleep(1500);
      return { assigned: asset.name, to: selected() };
    }
    const before = objectPaths();
    dispatch("SCENE_ADD_MODEL_OR_SCENE", { asset, isDropped: false });
    return { added: await waitForNewObjects(before) };
  };

  const importModel = async (filepath) => {
    const before = objectPaths();
    await sg().addModels([filepath], false);
    return { added: await waitForNewObjects(before) };
  };

  // ---------- materials ----------
  // Base materials of a model/mesh. Once a decal is added, a material's proxyPath points at a
  // layer stack; editing item.path keeps changes on the base surface. Decal layers
  // (MATERIAL_LAYER) are only returned when asked for directly.
  const materialPathsOf = (pathOrLabel) => {
    const item = findItem(pathOrLabel);
    if (item.type === "MATERIAL" || item.type === "MATERIAL_LAYER") return [item.path];
    const found = [];
    flatten(item).forEach((i) => {
      if (i.type === "MATERIAL" && found.indexOf(i.path) === -1) found.push(i.path);
    });
    return found;
  };

  const materialModel = async (materialPath) =>
    app.materialController.createMaterial(await cache().fetch(materialPath), true);

  const describeValue = (p) => {
    const v = p.value;
    if (v === null || v === undefined) return v;
    if (typeof v !== "object") return v;
    const out = {};
    if ("_texture" in v) out.texture = v._texture || null;
    ["color", "rgba", "strength", "_strength", "value"].forEach((k) => {
      let x;
      try { x = v[k]; } catch (e) { return; }
      if (x === undefined) return;
      if (x && typeof x === "object") {
        if (Array.isArray(x.rgba)) x = x.rgba;
        else if (x.value !== undefined && typeof x.value !== "object") x = x.value;
        else if (x.cachedValue !== undefined) x = x.cachedValue;
        else return;
      }
      out[k.replace(/^_/, "")] = x;
    });
    if (v.cachedValue !== undefined) out.value = v.cachedValue;
    return out;
  };

  // Plain values (float, int, bool, string) are remote properties: ask the core for them.
  const readRemote = async (v) => {
    if (!v || typeof v.getValue !== "function") return undefined;
    const got = await Promise.race([v.getValue(), sleep(800).then(() => undefined)]).catch(() => undefined);
    return got === null || typeof got !== "object" ? got : undefined;
  };

  const materialInfo = async (pathOrLabel, { all = false } = {}) => {
    const result = [];
    for (const mp of materialPathsOf(pathOrLabel)) {
      const m = await materialModel(mp);
      const props = [];
      for (const p of (m.properties || []).filter((x) => all || !x.hidden)) {
        let value = describeValue(p);
        if (/^(float|int|bool|string)$/.test(p.type)) {
          const plain = await readRemote(p.value);
          if (plain !== undefined) value = plain;
        } else if (value && typeof value === "object" && value.strength === undefined && p.value && p.value._strength) {
          const s = await readRemote(p.value._strength);
          if (s !== undefined) value.strength = s;
        }
        props.push({ name: p.propertyName, type: p.type, label: p.displayName, group: p.inGroup, value });
      }
      result.push({ material: mp, name: m.name, properties: props });
    }
    return result;
  };

  // Colors go in as "#rrggbb", [r,g,b] 0-1 floats, [r,g,b] 0-255 or {r,g,b} 0-255.
  // Dimension's color models (what the UI edits) take rgba as [0-255, 0-255, 0-255, 0-1].
  const normalizeColor = (value) => {
    if (typeof value === "string" && /^#?[0-9a-f]{6}$/i.test(value)) {
      const h = value.replace("#", "");
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
    }
    if (Array.isArray(value)) {
      const scale = value.slice(0, 3).every((n) => n <= 1) ? 255 : 1;
      return [value[0] * scale, value[1] * scale, value[2] * scale, value[3] === undefined ? 1 : value[3]];
    }
    if (value && typeof value === "object" && "r" in value) return [value.r, value.g, value.b, value.a === undefined ? 1 : value.a];
    throw new Error(`Not a color: ${JSON.stringify(value)}`);
  };

  const setMaterial = async (pathOrLabel, property, value) => {
    const done = [];
    for (const mp of materialPathsOf(pathOrLabel)) {
      const m = await materialModel(mp);
      const p = (m.properties || []).find((x) => x.propertyName === property);
      if (!p) throw new Error(`Material ${mp} has no property "${property}". Use dimension_material to list them.`);
      const isFile = typeof value === "string" && /[\\/]/.test(value);
      if (isFile) {
        await m.setValue("texture", value, property);
      } else if (p.type === "textureColor" || p.type === "color") {
        // Same path as the app's color picker (ColorController.changeColor): set rgba on the color model.
        const rgba = normalizeColor(value);
        const model = p.value && (p.value.color || p.value);
        if (p.value && p.value.texture) await m.setValue("texture", undefined, property);
        if (model && "rgba" in model) model.rgba = rgba;
        else throw new Error(`Cannot set color on ${property} (${p.type})`);
        await sleep(300);
      } else if (p.type === "texture" && m.samplers && m.samplers[property]) {
        await m.setValue("strength", value, property);
      } else {
        await m.setValue(property, value);
      }
      done.push(mp);
    }
    return { updated: done, property, value };
  };

  // ---------- decals, background, match image ----------
  const addDecal = async (pathOrLabel, imagePath) => {
    let item = findItem(pathOrLabel);
    if (item.type === "GROUP") {
      const mesh = flatten(item).find((i) => i.type === "MESH");
      if (!mesh) throw new Error(`${item.path} has no mesh to put a decal on`);
      item = mesh;
    }
    await sg().addDecal(item, imagePath);
    return { target: item.path, decal: selected() };
  };

  const placeImage = async (imagePath) => {
    await sg().placeImage(imagePath);
    await sleep(1000);
    return { selected: selected() };
  };

  const setBackground = async (imagePath) => {
    app.assetController.importBackgroundImage(imagePath);
    await sleep(2500);
    return { background: imagePath };
  };

  const matchImage = async ({ resize = true, perspective = true, lighting = true, aspectOnly = false } = {}) => {
    await app.matchImageController.matchImage({
      shouldResizeCanvas: resize,
      shouldMatchPerspective: perspective,
      shouldMatchLighting: lighting,
      canvasSizeOption: aspectOnly ? "aspect" : "size",
    });
    return { matched: { resize, perspective, lighting } };
  };

  // ---------- transforms and properties ----------
  // Same path as the Properties panel (SceneTransformable): select, then send UI values to the
  // scene inside a selection interaction. Units are the document's (cm by default), angles in degrees.
  const UI_KEYS = {
    position: ["uiPositionX", "uiPositionY", "uiPositionZ"],
    rotation: ["uiEulerAnglesXDegrees", "uiEulerAnglesYDegrees", "uiEulerAnglesZDegrees"],
    scale: ["uiScaleX", "uiScaleY", "uiScaleZ"],
    size: ["uiSizeX", "uiSizeY", "uiSizeZ"],
  };
  const readTransform = (v) => {
    const out = {};
    Object.keys(UI_KEYS).forEach((k) => { out[k] = UI_KEYS[k].map((key) => v[key]); });
    return out;
  };
  const getTransform = async (pathOrLabel) => {
    await select([pathOrLabel]);
    const scene = await cache().fetch("/scenes/scene");
    return readTransform(await scene.getSceneTransformableUIValues());
  };
  const setTransform = async (pathOrLabel, changes = {}) => {
    await select([pathOrLabel]);
    const scene = await cache().fetch("/scenes/scene");
    const v = Object.assign({}, await scene.getSceneTransformableUIValues());
    // When both are given, size wins over scale (they describe the same thing).
    ["position", "rotation", "scale", "size"].forEach((k) => {
      const want = changes[k];
      if (!want) return;
      UI_KEYS[k].forEach((key, i) => { if (want[i] !== undefined && want[i] !== null) v[key] = want[i]; });
      if (k === "size") UI_KEYS.scale.forEach((key) => delete v[key]);
    });
    ["X", "Y", "Z"].forEach((a) => {
      v[`localTranslationDelta${a}`] = 0;
      v[`localEulerAnglesDelta${a}Degrees`] = 0;
      v[`localScaleDelta${a}`] = 1;
    });
    await scene.beginSelectionInteraction();
    await scene.continueSelectionInteractionWithUIValues(v);
    await scene.endSelectionInteraction();
    await sleep(300);
    return readTransform(await scene.getSceneTransformableUIValues());
  };

  const nodeProperties = async (pathOrLabel) => {
    const node = await cache().fetch(findItem(pathOrLabel).path);
    return Object.keys(node.properties || {});
  };

  const setNodeProperty = async (pathOrLabel, propertyName, value) => {
    const path = findItem(pathOrLabel).path;
    await sg().setPropertyValue(path, propertyName, value);
    return { path, propertyName, value };
  };

  // ---------- output and documents ----------
  // The interactive renderer refines progressively and lags behind scene/camera edits,
  // so give it time to catch up before grabbing the frame.
  const snapshot = async (filepath, settleMs = 2500) => {
    if ("RENDER_FORCE_INTERACTIVE_RENDERER_UPDATE" in dc.dispatcher.actionTypes) dispatch("RENDER_FORCE_INTERACTIVE_RENDERER_UPDATE");
    await sleep(settleMs);
    await app.renderController.saveSnapshot(filepath, "png");
    return { saved: filepath };
  };

  // Preset camera views, as in View > Camera Views (FRONT, LEFT, TOP, FRONT_RIGHT_TOP, ...).
  const CameraView = () => window.Core.Types.geometry.CameraView;
  const setView = async (name) => {
    const views = CameraView();
    const key = String(name).toUpperCase();
    if (!(key in views)) throw new Error(`Unknown view ${name}. Use one of ${Object.keys(views).join(", ")}`);
    await app.cameraController.activeCamera.setToView(views[key], false);
    await sleep(500);
    return { view: key };
  };

  // Frame the camera on everything (or on the selection) the way the app's "frame" button does.
  // Calls ViewportController.centerGeometryInView directly: the CAMERA_CENTER_GEOMETRY_IN_VIEW
  // action is ignored while an earlier camera animation promise is pending, and those can get stuck.
  const frame = async ({ selection = false } = {}) => {
    const vc = app.activeViewportController;
    if (vc.cameraAnimationPromise) {
      try { vc.cameraAnimationPromise.resolve(); } catch (e) {}
      delete vc.cameraAnimationPromise;
    }
    await vc.centerGeometryInView(selection, false, false, false);
    await sleep(800);
    return { framed: selection ? selected() : "all" };
  };

  // Final render, as the Render tab does it: switch to Render mode, check the active camera,
  // start the queue, wait, then go back to Design mode.
  const render = async ({ folder, name, timeoutMs = 30 * 60 * 1000 } = {}) => {
    const rc = app.renderController;
    const modeBefore = app.appModeController.appMode;
    if (modeBefore !== "RENDER") {
      dispatch("APP_CHANGE_MODE", "RENDER");
      await sleep(1500);
    }
    if (folder) rc.parameters.location = folder;
    if (name) rc.parameters.exportName = name;
    rc.parameters.format = "png";
    if (!(rc.selectedRenderItems || []).length) rc.setDefaultSelectedRenderItem();
    if (!(rc.selectedRenderItems || []).length) throw new Error("No camera is selected for rendering");
    rc.isRenderSaved = true; // skips the "start a new render?" prompt the button would show
    dispatch("RENDER_START", 0);
    const start = Date.now();
    await sleep(2000);
    while (Date.now() - start < timeoutMs && (rc.isRendering || rc.isRenderingQueue)) await sleep(1000);
    const seconds = Math.round((Date.now() - start) / 1000);
    if (modeBefore !== "RENDER") dispatch("APP_CHANGE_MODE", modeBefore);
    // Dimension appends the camera name when the document has several cameras (name-Camera.png).
    const fs = window.require("fs");
    const dir = rc.parameters.location;
    const files = fs.readdirSync(dir)
      .filter((f) => f.indexOf(rc.parameters.exportName) === 0 && /\.(png|psd)$/i.test(f))
      .map((f) => ({ f: `${dir}/${f}`, t: fs.statSync(`${dir}/${f}`).mtime.getTime() }))
      .filter((x) => x.t >= start - 5000)
      .sort((a, b) => b.t - a.t)
      .map((x) => x.f);
    return { files, seconds, status: rc.lastRendererStatus };
  };

  const documentInfo = () => {
    const d = app.documentController;
    const pick = {};
    ["filepath", "filePath", "documentPath", "isDirty", "isModified", "documentName", "name"].forEach((k) => {
      try {
        const v = d[k];
        if (v !== undefined && typeof v !== "object" && typeof v !== "function") pick[k] = v;
      } catch (e) {}
    });
    return pick;
  };

  const save = async (filepath) => {
    await app.documentController.save(filepath);
    return { saved: filepath };
  };
  const open = async (filepath) => {
    await app.documentController.load(filepath);
    await sleep(1000);
    return { opened: filepath };
  };
  const newDocument = async () => {
    await app.documentController.createDocument();
    await sleep(1000);
    return { created: true };
  };

  // ---------- discovery ----------
  const actionTypes = (filter = "") =>
    Object.keys(dc.dispatcher.actionTypes).filter((t) => !filter || t.indexOf(filter.toUpperCase()) !== -1);
  const methodsOf = (obj) => {
    const names = [];
    let p = obj;
    while (p && p !== Object.prototype) {
      Object.getOwnPropertyNames(p).forEach((n) => {
        if (n !== "constructor" && n[0] !== "_" && names.indexOf(n) === -1) names.push(n);
      });
      p = Object.getPrototypeOf(p);
    }
    return names;
  };
  const controllers = () => Object.keys(app).filter((k) => /Controller$/.test(k) && app[k]);

  window.__dmcp = {
    version: VERSION,
    app, dc, sg, cache, dispatch, sleep, toJSON,
    tree, flatten, findItem, labelOf, selected, select,
    assets, findAsset, addAsset, importModel,
    materialPathsOf, materialModel, materialInfo, setMaterial,
    addDecal, placeImage, setBackground, matchImage,
    nodeProperties, setNodeProperty, getTransform, setTransform,
    snapshot, frame, setView, render, documentInfo, save, open, newDocument,
    actionTypes, methodsOf, controllers,
  };
})();
