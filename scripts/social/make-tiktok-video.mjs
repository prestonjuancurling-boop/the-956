#!/usr/bin/env node
/**
 * Turn a set of still images into a vertical (1080x1920) slideshow video,
 * suitable for TikTok/Reels/Shorts. Each image is padded onto a blurred
 * copy of itself so any aspect ratio (feed slides at 1080x1350, story
 * graphics already at 1080x1920, etc.) fills the frame without cropping
 * the design.
 *
 * Usage:
 *   node scripts/social/make-tiktok-video.mjs <folder> <outfile.mp4> <file1> [file2 ...] [--duration=3]
 *
 * Does NOT publish anywhere — TikTok's Content Posting API requires app
 * review before it can publish publicly, so for now this just produces the
 * .mp4 for manual upload via the TikTok app.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

function findFfmpeg() {
  const candidates = [
    "ffmpeg",
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    join(
      process.env.LOCALAPPDATA || "",
      "Microsoft",
      "WinGet",
      "Packages",
      "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
      "ffmpeg-8.1.2-full_build",
      "bin",
      "ffmpeg.exe"
    ),
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ["-version"], { stdio: "ignore" });
      return c;
    } catch {}
  }
  throw new Error("ffmpeg not found. Install it (e.g. `winget install Gyan.FFmpeg`) and retry.");
}

const rawArgs = process.argv.slice(2);
let duration = 3;
const args = [];
for (const a of rawArgs) {
  const m = a.match(/^--duration=(\d+(\.\d+)?)$/);
  if (m) duration = parseFloat(m[1]);
  else args.push(a);
}
const [folder, outfile, ...files] = args;
if (!folder || !outfile || files.length < 1) {
  console.error("Usage: node make-tiktok-video.mjs <folder> <outfile.mp4> <file1> [file2 ...] [--duration=3]");
  process.exit(1);
}

const ffmpeg = findFfmpeg();
const work = mkdtempSync(join(tmpdir(), "the956-tiktok-"));

try {
  const segments = [];
  files.forEach((file, i) => {
    const input = resolve(folder, file);
    if (!existsSync(input)) throw new Error(`Missing file: ${input}`);
    const segment = join(work, `seg-${String(i).padStart(2, "0")}.mp4`);
    console.log(`Rendering segment ${i + 1}/${files.length}: ${file}`);
    execFileSync(ffmpeg, [
      "-y",
      "-loop", "1",
      "-i", input,
      "-t", String(duration),
      "-filter_complex",
      "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:20[bg];" +
      "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg];" +
      "[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]",
      "-map", "[v]",
      "-r", "30",
      segment,
    ], { stdio: "inherit" });
    segments.push(segment);
  });

  const listFile = join(work, "list.txt");
  writeFileSync(listFile, segments.map((s) => `file '${s.replace(/\\/g, "/")}'`).join("\n"));

  console.log("Concatenating segments...");
  execFileSync(ffmpeg, [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listFile,
    "-c", "copy",
    resolve(outfile),
  ], { stdio: "inherit" });

  console.log("DONE:", resolve(outfile));
} finally {
  rmSync(work, { recursive: true, force: true });
}
