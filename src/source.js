// Dimension ships its own source map inside app.asar. We unpack the app's (non node_modules)
// sources once, on this machine, so Claude can look up how a feature works before scripting it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CACHE_DIR = path.join(os.homedir(), ".dimension-mcp", "source");

export function appPaths() {
  if (process.env.DIMENSION_APP) return { app: process.env.DIMENSION_APP };
  if (process.platform === "win32") {
    const base = process.env.ProgramFiles || "C:\\Program Files";
    return { app: path.join(base, "Adobe", "Adobe Dimension", "Adobe Dimension.exe") };
  }
  return { app: "/Applications/Adobe Dimension/Adobe Dimension.app" };
}

function asarPath() {
  const { app } = appPaths();
  const candidates = [
    path.join(app, "Contents", "Resources", "app.asar"),
    path.join(path.dirname(app), "resources", "app.asar"),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`Could not find Dimension's app.asar (looked in ${candidates.join(", ")}). Set DIMENSION_APP.`);
  return found;
}

function readAsarFile(file, name) {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const headerSize = head.readUInt32LE(4);
    const jsonLen = head.readUInt32LE(12);
    const jsonBuf = Buffer.alloc(jsonLen);
    fs.readSync(fd, jsonBuf, 0, jsonLen, 16);
    const header = JSON.parse(jsonBuf.toString("utf8"));
    const entry = header.files[name];
    if (!entry) throw new Error(`${name} not found in app.asar`);
    const buf = Buffer.alloc(entry.size);
    fs.readSync(fd, buf, 0, entry.size, 8 + headerSize + Number(entry.offset));
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

export function ensureSources() {
  const marker = path.join(CACHE_DIR, ".complete");
  if (fs.existsSync(marker)) return CACHE_DIR;
  const map = JSON.parse(readAsarFile(asarPath(), "main.js.map").toString("utf8"));
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  map.sources.forEach((name, i) => {
    const code = map.sourcesContent && map.sourcesContent[i];
    if (!code || name.includes("/~/")) return;
    const rel = name.replace(/^webpack:\/\/\//, "").replace(/\?[0-9a-f]+\*?$/, "").replace(/^\.\//, "");
    if (rel.includes("..")) return;
    const out = path.join(CACHE_DIR, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, code);
  });
  fs.writeFileSync(marker, new Date().toISOString());
  return CACHE_DIR;
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(p));
    else if (!entry.name.startsWith(".")) out.push(p);
  }
  return out;
}

export function searchSource(pattern, { maxResults = 60, context = 1 } = {}) {
  const dir = ensureSources();
  const re = new RegExp(pattern, "i");
  const results = [];
  for (const file of listFiles(dir)) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (results.length >= maxResults || !re.test(line)) return;
      const from = Math.max(0, i - context);
      const snippet = lines.slice(from, i + context + 1).join("\n");
      results.push(`${path.relative(dir, file)}:${i + 1}\n${snippet}`);
    });
    if (results.length >= maxResults) break;
  }
  return results;
}

export function readSource(file, from = 1, to = from + 120) {
  const dir = ensureSources();
  const full = path.resolve(dir, file);
  if (!full.startsWith(dir)) throw new Error("Path is outside the source folder");
  const lines = fs.readFileSync(full, "utf8").split("\n");
  return lines
    .slice(Math.max(0, from - 1), to)
    .map((l, i) => `${from + i}\t${l}`)
    .join("\n");
}
