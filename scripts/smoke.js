// Read-only smoke test: starts the MCP server over stdio and calls tools that do not change the scene.
// Usage: node scripts/smoke.js [tool-name '{"json":"args"}']

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, "src/index.js")] });
const client = new Client({ name: "smoke", version: "0" });
await client.connect(transport);

const show = async (name, args = {}) => {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  console.log(`== ${name} (${Date.now() - t0} ms)${r.isError ? " ERROR" : ""}`);
  for (const c of r.content) {
    if (c.type === "text") console.log(c.text.slice(0, 3000));
    else {
      const out = path.join(root, `smoke-${name}.${c.mimeType.split("/")[1]}`);
      fs.writeFileSync(out, Buffer.from(c.data, "base64"));
      console.log(`[image saved to ${out}]`);
    }
  }
};

if (process.argv[2]) {
  await show(process.argv[2], JSON.parse(process.argv[3] || "{}"));
} else {
  const { tools } = await client.listTools();
  console.log(`${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
  await show("dimension_launch");
  await show("dimension_status");
  await show("dimension_scene", { max_depth: 3 });
  await show("dimension_assets", { query: "bottle" });
  await show("dimension_view", { target: "viewport" });
}
await client.close();
