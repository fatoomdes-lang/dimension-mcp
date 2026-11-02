#!/usr/bin/env node
// dimension-mcp: lets Claude Code drive Adobe Dimension.
// Dimension is an Electron app; started with --remote-debugging-port it exposes its renderer,
// where window.debugController.app is the app's own controller tree. We inject helpers
// (src/prelude.browser.js) and call Dimension's controllers and actions directly.

import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { transform } from "esbuild";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { DEFAULT_PORT, DimensionNotReachable, Session, listPages } from "./cdp.js";
import { appPaths, readSource, searchSource } from "./source.js";

const VERSION = "0.1.0";
const here = path.dirname(fileURLToPath(import.meta.url));
const exec = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- connection ----------

let session = null;
let preludeCode = null;

// Tagging the injected helpers with a hash of their source makes an edited prelude replace a stale one.
const preludeSource = fs.readFileSync(path.join(here, "prelude.browser.js"), "utf8");
const PRELUDE_ID = `${VERSION}-${createHash("sha1").update(preludeSource).digest("hex").slice(0, 8)}`;

async function loadPrelude() {
  if (preludeCode) return preludeCode;
  const src = preludeSource.replace("__DMCP_VERSION__", PRELUDE_ID);
  preludeCode = (await transform(src, { target: "es2015", loader: "js" })).code;
  return preludeCode;
}

async function connect() {
  if (session && !session.closed) {
    try {
      const ok = await session.evaluate(`!!(window.__dmcp && window.__dmcp.version === ${JSON.stringify(PRELUDE_ID)})`);
      if (ok) return session;
    } catch {
      session.close();
      session = null;
    }
  }
  if (!session || session.closed) session = await Session.open(DEFAULT_PORT);
  // The prelude is lost whenever Dimension reloads its window, so check every time.
  for (let attempt = 0; attempt < 20; attempt++) {
    const ready = await session.evaluate("!!(window.debugController && window.debugController.app && window.debugController.app.sceneGraphController)");
    if (ready) break;
    await sleep(1000);
  }
  await session.evaluate(await loadPrelude());
  return session;
}

async function run(code, timeoutMs) {
  const s = await connect();
  return s.run(code, { timeoutMs });
}

// Call one prelude helper with JSON arguments.
function call(fn, ...args) {
  return run(`const d = window.__dmcp; return d.toJSON(await d.${fn}(${args.map((a) => JSON.stringify(a)).join(", ")}));`);
}

// ---------- launching ----------

async function dimensionRunning() {
  if (process.platform === "win32") {
    const { stdout } = await exec("tasklist", ["/FI", "IMAGENAME eq Adobe Dimension.exe"]).catch(() => ({ stdout: "" }));
    return /Adobe Dimension\.exe/i.test(stdout);
  }
  const { stdout } = await exec("pgrep", ["-f", "Adobe Dimension.app/Contents/MacOS/Adobe Dimension"]).catch(() => ({ stdout: "" }));
  return stdout.trim().length > 0;
}

async function debugPortOpen() {
  try {
    await listPages(DEFAULT_PORT);
    return true;
  } catch {
    return false;
  }
}

async function launch({ restart = false } = {}) {
  if (await debugPortOpen()) {
    await connect();
    return "Dimension is already running with the debug port open. Connected.";
  }
  if (await dimensionRunning()) {
    if (!restart) {
      throw new Error(
        "Dimension is open but was not started by this tool, so it cannot be controlled. " +
          "Ask the user to save their work, then call dimension_launch with restart: true " +
          "(Dimension will ask about unsaved changes before it quits).",
      );
    }
    if (process.platform === "darwin") {
      await exec("osascript", ["-e", 'tell application "Adobe Dimension" to quit']).catch(() => {});
    } else {
      await exec("taskkill", ["/IM", "Adobe Dimension.exe"]).catch(() => {});
    }
    for (let i = 0; i < 60 && (await dimensionRunning()); i++) await sleep(1000);
    if (await dimensionRunning()) throw new Error("Dimension did not quit (maybe an unsaved-changes dialog is open). Ask the user to close it.");
  }
  const flag = `--remote-debugging-port=${DEFAULT_PORT}`;
  const { app } = appPaths();
  if (process.platform === "darwin") {
    await exec("open", ["-a", app, "--args", flag]);
  } else {
    spawn(app, [flag], { detached: true, stdio: "ignore" }).unref();
  }
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    if (!(await debugPortOpen())) continue;
    try {
      await connect();
      return "Dimension started and connected.";
    } catch (e) {
      if (!(e instanceof DimensionNotReachable) && !/loading/.test(e.message)) throw e;
    }
  }
  throw new Error("Dimension did not become ready within two minutes.");
}

// ---------- images ----------

async function shrinkImage(file, maxEdge = 1280) {
  if (process.platform !== "darwin") return file;
  const out = path.join(os.tmpdir(), `dmcp-view-${Date.now()}.jpg`);
  await exec("sips", ["-Z", String(maxEdge), "-s", "format", "jpeg", file, "--out", out]).catch(() => null);
  return fs.existsSync(out) ? out : file;
}

async function view({ target = "viewport", save_to } = {}) {
  const s = await connect();
  if (target === "window") {
    const data = await s.screenshot();
    if (save_to) fs.writeFileSync(save_to, Buffer.from(data, "base64"));
    return [{ type: "image", data, mimeType: "image/jpeg" }];
  }
  const file = save_to || path.join(os.tmpdir(), `dmcp-snapshot-${Date.now()}.png`);
  await call("snapshot", file);
  for (let i = 0; i < 40 && !fs.existsSync(file); i++) await sleep(250);
  const small = await shrinkImage(file);
  const mimeType = small.endsWith(".jpg") ? "image/jpeg" : "image/png";
  return [
    { type: "image", data: fs.readFileSync(small).toString("base64"), mimeType },
    { type: "text", text: `Snapshot saved to ${file}` },
  ];
}

// ---------- tools ----------

const pathArg = { type: "string", description: "Scene item path (from dimension_scene) or its exact label" };

const tools = [
  {
    name: "dimension_launch",
    description:
      "Start Adobe Dimension so it can be controlled (opens a local-only debug port), or connect if it is already started that way. " +
      "If Dimension is already open normally, this fails unless restart is true; ask the user to save first, since restarting closes their document.",
    inputSchema: { type: "object", properties: { restart: { type: "boolean", description: "Quit the running Dimension and relaunch it" } } },
    handler: async (a) => text(await launch(a)),
  },
  {
    name: "dimension_status",
    description: "Check the connection and show the open document and a short scene summary.",
    inputSchema: { type: "object", properties: {} },
    handler: async () =>
      json(await run(`const d = window.__dmcp; const t = d.tree(1);
        return { document: d.documentInfo(), selected: d.selected(), topLevel: (t.children || []).map(c => c.type + " " + c.path) };`)),
  },
  {
    name: "dimension_scene",
    description: "Scene tree: models, groups, meshes, materials, decals, cameras, lights, environment. Paths from here are used by the other tools.",
    inputSchema: { type: "object", properties: { max_depth: { type: "number", description: "Default 8" } } },
    handler: async (a) => json(await call("tree", a.max_depth || 8)),
  },
  {
    name: "dimension_view",
    description:
      "See the result. target 'viewport' renders the current camera view to a PNG (what the scene looks like); " +
      "'window' screenshots the whole Dimension window including panels and dialogs.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", enum: ["viewport", "window"] },
        save_to: { type: "string", description: "Optional absolute path to also keep the image" },
      },
    },
    handler: async (a) => ({ content: await view(a) }),
  },
  {
    name: "dimension_assets",
    description: "Search Dimension's built-in starter assets (models such as cream_tube, bottle_round, cube, sphere; materials; lights; environments).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        type: { type: "string", description: "MODEL, MATERIAL, LIGHT, IMAGE, ..." },
        limit: { type: "number" },
      },
    },
    handler: async (a) => json(await call("assets", a)),
  },
  {
    name: "dimension_add",
    description:
      "Add to the scene: a starter asset by name (asset), or a 3D file from disk (file: .obj, .fbx, .glb, .gltf, .stl, .skp, .dn). " +
      "Adding a MATERIAL asset assigns it to the current selection. Returns the new scene paths.",
    inputSchema: {
      type: "object",
      properties: { asset: { type: "string" }, file: { type: "string", description: "Absolute path" } },
    },
    handler: async (a) => {
      if (a.file) return json(await call("importModel", a.file));
      if (a.asset) return json(await call("addAsset", a.asset));
      throw new Error("Give asset or file");
    },
  },
  {
    name: "dimension_select",
    description: "Select scene items (paths or labels). Several Dimension actions work on the selection.",
    inputSchema: { type: "object", properties: { items: { type: "array", items: { type: "string" } } }, required: ["items"] },
    handler: async (a) => json(await call("select", a.items)),
  },
  {
    name: "dimension_camera",
    description:
      "Point the camera: an optional preset view (FRONT, BACK, LEFT, RIGHT, TOP, BOTTOM, FRONT_RIGHT_TOP, FRONT_LEFT_TOP, FRONT_RIGHT, FRONT_LEFT, ...), " +
      "then frame everything, or only the given items. Check the result with dimension_view.",
    inputSchema: {
      type: "object",
      properties: {
        view: { type: "string" },
        frame: { type: "boolean", description: "Default true" },
        items: { type: "array", items: { type: "string" }, description: "Frame only these (paths or labels)" },
      },
    },
    handler: async (a) => {
      const out = {};
      if (a.view) out.view = await call("setView", a.view);
      if (a.frame !== false) {
        if (a.items && a.items.length) await call("select", a.items);
        out.frame = await call("frame", { selection: !!(a.items && a.items.length) });
      }
      return json(out);
    },
  },
  {
    name: "dimension_transform",
    description:
      "Read or set an object's position, rotation (degrees, X/Y/Z), scale, or size (document units, cm by default). " +
      "Without set, returns the current values. Each set field is [x, y, z]; use null to keep an axis.",
    inputSchema: {
      type: "object",
      properties: {
        target: pathArg,
        set: {
          type: "object",
          properties: {
            position: { type: "array", items: { type: ["number", "null"] } },
            rotation: { type: "array", items: { type: ["number", "null"] } },
            scale: { type: "array", items: { type: ["number", "null"] } },
            size: { type: "array", items: { type: ["number", "null"] } },
          },
        },
      },
      required: ["target"],
    },
    handler: async (a) => json(a.set ? await call("setTransform", a.target, a.set) : await call("getTransform", a.target)),
  },
  {
    name: "dimension_material",
    description:
      "Read or change the material(s) of a model, mesh or material path. Without set, lists properties (base_color, roughness, metallic, opacity, emission, ...). " +
      "With set: {property, value}. Colors: '#rrggbb', [r,g,b] 0-1 or {r,g,b} 0-255. Numbers for sliders. An absolute image path sets that channel's texture.",
    inputSchema: {
      type: "object",
      properties: {
        target: pathArg,
        set: { type: "object", properties: { property: { type: "string" }, value: {} }, required: ["property", "value"] },
        all: { type: "boolean", description: "Include hidden properties when listing" },
      },
      required: ["target"],
    },
    handler: async (a) =>
      json(a.set ? await call("setMaterial", a.target, a.set.property, a.set.value) : await call("materialInfo", a.target, { all: !!a.all })),
  },
  {
    name: "dimension_decal",
    description: "Place an image (logo, label, artwork) as a decal on a model or mesh. Use dimension_run afterwards to adjust its placement if needed.",
    inputSchema: {
      type: "object",
      properties: { target: pathArg, image: { type: "string", description: "Absolute path to a PNG/JPG/SVG/PSD/AI" } },
      required: ["target", "image"],
    },
    handler: async (a) => json(await call("addDecal", a.target, a.image)),
  },
  {
    name: "dimension_background",
    description:
      "Use a reference photo as the scene background, and optionally run Dimension's Match Image so the camera perspective, lighting and canvas size match the photo.",
    inputSchema: {
      type: "object",
      properties: {
        image: { type: "string", description: "Absolute path to the photo" },
        match: {
          type: "object",
          properties: { resize: { type: "boolean" }, perspective: { type: "boolean" }, lighting: { type: "boolean" } },
          description: "Omit to only set the background",
        },
      },
      required: ["image"],
    },
    handler: async (a) => {
      const out = { background: await call("setBackground", a.image) };
      if (a.match) out.match = await call("matchImage", a.match);
      return json(out);
    },
  },
  {
    name: "dimension_render",
    description: "Final (photoreal) render of the current camera to PNG. Can take minutes. For a quick look use dimension_view instead.",
    inputSchema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Absolute output folder" },
        name: { type: "string", description: "File name without extension" },
      },
      required: ["folder", "name"],
    },
    handler: async (a) => json(await run(`return window.__dmcp.toJSON(await window.__dmcp.render(${JSON.stringify(a)}));`, 31 * 60 * 1000)),
  },
  {
    name: "dimension_document",
    description:
      "Document actions: info, save (to path), open (path), new. open and new replace the current document; " +
      "only use them after the user's work is saved or they agreed to discard it (set confirm_discard).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["info", "save", "open", "new"] },
        path: { type: "string", description: "Absolute .dn path for save/open" },
        confirm_discard: { type: "boolean" },
      },
      required: ["action"],
    },
    handler: async (a) => {
      if (a.action === "info") return json(await call("documentInfo"));
      if (a.action === "save") return json(await call("save", req(a.path, "path")));
      if (!a.confirm_discard) throw new Error(`${a.action} replaces the current document. Save first or set confirm_discard after the user agrees.`);
      if (a.action === "open") return json(await call("open", req(a.path, "path")));
      return json(await call("newDocument"));
    },
  },
  {
    name: "dimension_run",
    description:
      "Run JavaScript inside Dimension for anything the other tools do not cover (full control). async/await is allowed; `return` a value to see it. " +
      "Helpers on window.__dmcp (alias d): d.app (all controllers: sceneGraphController, materialController, cameraController, " +
      "lightSetController, environmentController, renderController, documentController, matchImageController, assetController, ...), " +
      "d.dispatch(ACTION_TYPE, data), d.actionTypes(filter), d.methodsOf(obj), d.controllers(), d.tree(), d.findItem(pathOrLabel), " +
      "d.select(paths), d.cache().fetch(nodePath) (node.properties[name].getValue/setValue), d.materialModel(path), d.setNodeProperty(path, name, value), d.sleep(ms), d.toJSON(x). " +
      "Use dimension_source to learn how a feature is implemented before calling it.",
    inputSchema: {
      type: "object",
      properties: { code: { type: "string" }, timeout_ms: { type: "number" } },
      required: ["code"],
    },
    handler: async (a) => json(await run(`const d = window.__dmcp;\n${a.code}`, a.timeout_ms || 120000)),
  },
  {
    name: "dimension_source",
    description:
      "Search or read Dimension's own app source (unpacked locally from the installed app the first time) to learn its controllers, actions and data formats. " +
      "Give pattern (regex) to search, or file (+ from/to lines) to read.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        file: { type: "string" },
        from: { type: "number" },
        to: { type: "number" },
      },
    },
    handler: async (a) => {
      if (a.file) return text(readSource(a.file, a.from || 1, a.to || (a.from || 1) + 120));
      if (a.pattern) return text(searchSource(a.pattern).join("\n\n") || "No matches");
      throw new Error("Give pattern or file");
    },
  },
];

function req(v, name) {
  if (!v) throw new Error(`${name} is required`);
  return v;
}
function text(t) {
  return { content: [{ type: "text", text: String(t) }] };
}
function json(v) {
  return text(JSON.stringify(v, null, 2));
}

const server = new Server(
  { name: "dimension-mcp", version: VERSION },
  {
    capabilities: { tools: {} },
    instructions:
      "Controls Adobe Dimension. Start with dimension_launch, then dimension_scene. After meaningful edits, call dimension_view to check the result. " +
      "Never open or create a document over unsaved user work without asking. Paths come from dimension_scene.",
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools.find((t) => t.name === request.params.name);
  if (!tool) return { isError: true, content: [{ type: "text", text: `Unknown tool ${request.params.name}` }] };
  try {
    return await tool.handler(request.params.arguments || {});
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: e.message || String(e) }] };
  }
});

await server.connect(new StdioServerTransport());
