# dimension-mcp

**Let Claude Code, Codex, or any MCP client drive Adobe Dimension.** Build product mockups and 3D scenes by describing them: add models, set materials and colors, put labels and logos on products, match a background photo, frame the camera, render, and save.

[العربية](README.ar.md)

> Unofficial, community project. Not affiliated with or endorsed by Adobe. "Adobe" and "Adobe Dimension" are trademarks of Adobe Inc.

## Why

Adobe Dimension has no scripting API and no official AI connector. But it is an Electron app, and Electron apps can be started with a local debug port. Through that port this server reaches Dimension's own controllers (scene graph, materials, decals, cameras, lights, render, documents), so every edit goes through the app's normal code paths and stays undoable with Cmd/Ctrl+Z.

## What it can do

| Tool | What it does |
|---|---|
| `dimension_launch` | Start Dimension in control mode, or connect if it already is |
| `dimension_status` / `dimension_scene` | Current document and the scene tree with paths |
| `dimension_view` | See the result: render-camera snapshot, or the whole window |
| `dimension_assets` / `dimension_add` | Search the 570+ starter assets and add them, or import OBJ / FBX / GLB / GLTF / STL / SKP / DN |
| `dimension_transform` | Position, rotation, scale, size (cm, degrees) |
| `dimension_material` | Read or set base color, roughness, metallic, opacity, emission, or a texture image |
| `dimension_decal` | Put a label, logo, or artwork on a mesh |
| `dimension_background` | Use a photo as the background and run Match Image (perspective, lighting, canvas) |
| `dimension_camera` | Preset views (FRONT, TOP, FRONT_RIGHT_TOP, …) and framing |
| `dimension_render` | Final photoreal render to PNG |
| `dimension_document` | Info, save, open, new |
| `dimension_run` | Run JavaScript inside Dimension — full control for anything else |
| `dimension_source` | Search Dimension's own source (unpacked locally from your install) to learn how a feature works |

It pairs well with Illustrator, Photoshop, and Blender MCP servers: design a label in Illustrator, build a missing shape in Blender, then stage and render it in Dimension.

## Requirements

- Adobe Dimension 4.x (tested on 4.1.9, macOS)
- Node.js 20 or newer
- An MCP client: Claude Code, Codex, Claude Desktop, Cursor, …

## Install

The server runs straight from this GitHub repository with `npx`: nothing to clone or build. Node.js must be installed (`node -v` should print 20 or higher).

| | macOS | Windows |
|---|---|---|
| Claude Code | tested | expected to work, not tested yet |
| Codex | expected to work | expected to work, not tested yet |

### Claude Code: macOS

```bash
claude mcp add dimension --scope user -- npx -y github:fatoomdes-lang/dimension-mcp
```

### Claude Code: Windows (PowerShell or Command Prompt)

On Windows, `npx` has to be started through `cmd /c`:

```bash
claude mcp add dimension --scope user -- cmd /c npx -y github:fatoomdes-lang/dimension-mcp
```

### Codex: macOS

```bash
codex mcp add dimension -- npx -y github:fatoomdes-lang/dimension-mcp
```

### Codex: Windows

```bash
codex mcp add dimension -- cmd /c npx -y github:fatoomdes-lang/dimension-mcp
```

Or add it to `~/.codex/config.toml` (on Windows use `command = "cmd"` and put `"/c", "npx"` first in `args`):

```toml
[mcp_servers.dimension]
command = "npx"
args = ["-y", "github:fatoomdes-lang/dimension-mcp"]
```

### Other clients (Claude Desktop, Cursor, …)

```json
{
  "mcpServers": {
    "dimension": { "command": "npx", "args": ["-y", "github:fatoomdes-lang/dimension-mcp"] }
  }
}
```

### Optional: the skill (Claude Code)

It teaches Claude the best workflow in Dimension. Codex reads `AGENTS.md` from this repo instead.

macOS:

```bash
mkdir -p ~/.claude/skills/dimension && curl -fsSL https://raw.githubusercontent.com/fatoomdes-lang/dimension-mcp/main/skills/dimension/SKILL.md -o ~/.claude/skills/dimension/SKILL.md
```

Windows (PowerShell):

```powershell
New-Item -ItemType Directory -Force "$HOME\.claude\skills\dimension" | Out-Null; Invoke-WebRequest https://raw.githubusercontent.com/fatoomdes-lang/dimension-mcp/main/skills/dimension/SKILL.md -OutFile "$HOME\.claude\skills\dimension\SKILL.md"
```

Start a new session after adding it — MCP tools load when a session starts.

## Use

Ask in plain words, for example:

> Open Dimension. Add a cream tube, make it navy and glossy, put ~/Desktop/logo.png on the body, use ~/Desktop/cafe.jpg as the background and match it, then render to the Desktop.

The agent calls `dimension_launch` first. If Dimension is already open the normal way, it asks you to save, then restarts it in control mode.

## How it works

1. Dimension is launched with `--remote-debugging-port=9222` (localhost only).
2. The server connects over the Chrome DevTools Protocol to Dimension's main window.
3. It injects a small helper library (`src/prelude.browser.js`) that wraps Dimension's controllers: `window.debugController.app` is the app's own controller tree.
4. Dimension runs Chrome 49, so code sent by the agent is lowered to ES2015 with esbuild before it runs.

## Security

While Dimension runs in control mode, any program on the same computer can control it through the debug port (it listens on `127.0.0.1` only; nothing is reachable from the network). Quit Dimension when you are done; a normal launch turns the port off.

`dimension_source` unpacks Dimension's source map from **your own installation** into `~/.dimension-mcp/source` so the agent can read it. No Adobe code is included in this repository.

## Limitations

- Undocumented internal APIs: they may change if Adobe updates Dimension (development is paused, so this is unlikely).
- One debug connection at a time: only one agent session can control Dimension at once.
- Windows should work the same way but is not tested yet. Set `DIMENSION_APP` to the path of `Adobe Dimension.exe` if it is not in the default location. Reports welcome.
- `DIMENSION_DEBUG_PORT` changes the port (default 9222).

## Development

```bash
git clone https://github.com/fatoomdes-lang/dimension-mcp.git
cd dimension-mcp && npm install
npm run smoke   # read-only checks against a running Dimension
```

Point your client at `node /absolute/path/to/dimension-mcp/src/index.js` while developing.

## License

MIT © Fatimah Almehmadi
