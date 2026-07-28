#!/usr/bin/env node
/**
 * Render a data-driven carousel HTML template (social/*-carousel.html) into
 * numbered PNG slides, by serving the repo over a throwaway local HTTP
 * server and screenshotting each ?slide=N with headless Chrome.
 *
 * file:// won't work here — these templates fetch() their data JSON, and
 * Chrome blocks fetch() from file:// origins (CORS). Hence the local server.
 *
 * Usage:
 *   node scripts/social/render-carousel.mjs <template.html> <outDir> <prefix> <count> [name1 name2 ...]
 *
 * <template.html> path to the carousel HTML, relative to social/ (e.g. big5-carousel.html)
 * <outDir>        directory to write PNGs into (e.g. social/output/2026-07-27)
 * <prefix>        numeric filename prefix for slide 0 (e.g. 30 -> 30-<name0>.png, 31-<name1>.png, ...)
 * <count>         total number of slides (cover + N items)
 * nameN           optional slug per slide (defaults to "slide-N"); first name is the cover
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// NOTE: must use async spawn, not execFileSync — the local HTTP server below
// runs in this same process, and execFileSync blocks the event loop, which
// would deadlock the server against the very Chrome request it's waiting on.
function run(cmd, args, { timeoutMs = 30000 } = {}) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rej(new Error(`Timed out after ${timeoutMs}ms: ${cmd}`));
    }, timeoutMs);
    child.on("error", (err) => { clearTimeout(timer); rej(err); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) res();
      else rej(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../..");

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
};

function findChrome() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error("No Chrome/Edge install found in standard locations.");
}

const [template, outDir, prefix, countStr, ...names] = process.argv.slice(2);
if (!template || !outDir || !prefix || !countStr) {
  console.error("Usage: node render-carousel.mjs <template.html> <outDir> <prefix> <count> [name0 name1 ...]");
  process.exit(1);
}
const count = parseInt(countStr, 10);
const chrome = findChrome();

const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split("?")[0]);
  const filePath = join(REPO_ROOT, path);
  try {
    const st = statSync(filePath);
    if (st.isFile()) {
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
      createReadStream(filePath).pipe(res);
      return;
    }
  } catch {}
  res.writeHead(404);
  res.end("not found");
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const profileDir = mkdtempSync(join(tmpdir(), "the956-render-"));

try {
  for (let i = 0; i < count; i++) {
    const slug = names[i] || `slide-${i}`;
    const num = (parseInt(prefix, 10) + i).toString();
    const outFile = resolve(outDir, `${num}-${slug}.png`);
    const url = `http://127.0.0.1:${port}/social/${template}?slide=${i}`;
    console.log(`Rendering slide ${i + 1}/${count}: ${outFile}`);
    await run(chrome, [
      "--headless=new",
      "--disable-gpu",
      `--user-data-dir=${profileDir}`,
      "--window-size=1080,1350",
      "--hide-scrollbars",
      "--virtual-time-budget=3000",
      `--screenshot=${outFile}`,
      url,
    ]);
    if (!existsSync(outFile)) throw new Error(`Chrome did not produce ${outFile}`);
  }
  console.log(`DONE: ${count} slide(s) written to ${outDir}`);
} finally {
  server.close();
  rmSync(profileDir, { recursive: true, force: true });
}
