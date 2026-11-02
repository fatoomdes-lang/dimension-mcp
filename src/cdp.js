// Minimal Chrome DevTools Protocol client for Dimension's renderer (Electron 1.x / Chrome 49).
// Chrome 49 has no async/await, so code is lowered to ES2015 generators. It also has no
// Runtime.awaitPromise, so async results are parked on window and polled.

import { transform } from "esbuild";

export const DEFAULT_PORT = Number(process.env.DIMENSION_DEBUG_PORT || 9222);
const HOST = "127.0.0.1";

export class DimensionNotReachable extends Error {}

export async function listPages(port = DEFAULT_PORT) {
  let res;
  try {
    res = await fetch(`http://${HOST}:${port}/json`, { signal: AbortSignal.timeout(2000) });
  } catch {
    throw new DimensionNotReachable(
      `Dimension is not reachable on ${HOST}:${port}. Start it with the dimension_launch tool.`,
    );
  }
  return res.json();
}

export class Session {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      const waiter = msg.id && this.pending.get(msg.id);
      if (waiter) {
        this.pending.delete(msg.id);
        waiter(msg);
      }
    });
    ws.addEventListener("close", () => {
      for (const waiter of this.pending.values()) waiter({ error: { message: "Debug connection closed" } });
      this.pending.clear();
      this.closed = true;
    });
  }

  static async open(port = DEFAULT_PORT) {
    const pages = await listPages(port);
    const page = pages.find((p) => p.url.endsWith("/main.html"));
    if (!page) throw new DimensionNotReachable("Dimension is starting up: its main window is not ready yet.");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new DimensionNotReachable("Could not open the debug connection.")), { once: true });
    });
    return new Session(ws);
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // Evaluate a synchronous expression and return its JSON value.
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true });
    if (r.wasThrown) throw new Error(r.result?.description || r.exceptionDetails?.text || "Evaluation failed");
    return r.result?.value;
  }

  // Run modern JS (async/await allowed) in the page and wait for its result.
  async run(code, { timeoutMs = 120000 } = {}) {
    const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const program = `window.__dmcpJobs = window.__dmcpJobs || {};
window.__dmcpJobs[${JSON.stringify(id)}] = async function () {\n${code}\n};`;
    const { code: lowered } = await transform(program, { target: "es2015", loader: "js" })
      .catch((e) => {
        throw new Error(`Code does not parse: ${e.message}`);
      });
    await this.evaluate(lowered.replace(/^export\s*\{\s*\};?\s*$/m, ""));

    const start = `(function () {
  var id = ${JSON.stringify(id)};
  window.__dmcpResults = window.__dmcpResults || {};
  var done = function (r) { window.__dmcpResults[id] = r; delete window.__dmcpJobs[id]; };
  try {
    Promise.resolve(window.__dmcpJobs[id]()).then(
      function (v) { done({ ok: true, value: window.__dmcp ? window.__dmcp.toJSON(v) : v }); },
      function (e) { done({ ok: false, error: String((e && e.stack) || e) }); });
  } catch (e) { done({ ok: false, error: String((e && e.stack) || e) }); }
  return id;
})()`;
    await this.evaluate(start);

    const deadline = Date.now() + timeoutMs;
    const read = `(function () { var r = window.__dmcpResults && window.__dmcpResults[${JSON.stringify(id)}];
  if (r) delete window.__dmcpResults[${JSON.stringify(id)}]; return r || null; })()`;
    while (Date.now() < deadline) {
      const r = await this.evaluate(read);
      if (r) {
        if (!r.ok) throw new Error(r.error);
        return r.value;
      }
      await new Promise((res) => setTimeout(res, 150));
    }
    throw new Error(`Timed out after ${timeoutMs} ms. The operation may still be running in Dimension.`);
  }

  async screenshot() {
    const r = await this.send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    return r.data;
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}
