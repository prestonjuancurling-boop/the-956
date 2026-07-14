#!/usr/bin/env node
/**
 * Publish a carousel post to @the956rgv on Instagram.
 *
 * Usage:
 *   node scripts/social/ig-publish.mjs <folder> <caption-file> <file1.png> <file2.png> ...
 *
 * <folder>       social/output/<date>/ directory containing the PNGs
 * <caption-file> path to a text file with the post caption
 * fileN.png      filenames (relative to <folder>) in the order they should
 *                appear in the carousel — first is the cover.
 *
 * Requires ~/.the956-ig-token (long-lived token; see README-social.md).
 * This script PUBLISHES LIVE the moment it completes — only run it after
 * the user has explicitly approved this exact post.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hostImages } from "./host-images.mjs";

const [folder, captionFile, ...files] = process.argv.slice(2);
if (!folder || !captionFile || files.length < 2) {
  console.error("Usage: node ig-publish.mjs <folder> <caption-file> <file1> <file2> ...");
  console.error("(Instagram carousels need at least 2 images.)");
  process.exit(1);
}

const { access_token: token } = JSON.parse(readFileSync(join(homedir(), ".the956-ig-token"), "utf8"));
const caption = readFileSync(captionFile, "utf8").trim();

const IG_USER_ID = "me"; // resolves against the token's own account

async function igCall(path, params, method = "POST") {
  const url = new URL(`https://graph.instagram.com/v21.0/${path}`);
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) throw new Error(`IG API ${path} failed: ${JSON.stringify(body)}`);
    return body;
  }
  url.searchParams.set("access_token", token);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`IG API ${path} failed: ${JSON.stringify(body)}`);
  return body;
}

async function waitForContainer(id) {
  for (let i = 0; i < 20; i++) {
    const status = await igCall(id, { fields: "status_code", access_token: token }, "GET");
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR") throw new Error(`Container ${id} errored`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Container ${id} never finished processing`);
}

const slug = folder.replace(/[\\/]/g, "-").replace(/^-+|-+$/g, "");
console.log(`Hosting ${files.length} image(s) publicly...`);
const urls = await hostImages(folder, files, `ig-${slug}-${Date.now()}`);

console.log("Creating carousel item containers...");
const childIds = [];
for (const url of urls) {
  const item = await igCall(`${IG_USER_ID}/media`, {
    image_url: url,
    is_carousel_item: true,
    access_token: token,
  });
  childIds.push(item.id);
  console.log("  container:", item.id);
}

console.log("Creating parent carousel container...");
const parent = await igCall(`${IG_USER_ID}/media`, {
  media_type: "CAROUSEL",
  children: childIds.join(","),
  caption,
  access_token: token,
});
console.log("Waiting for processing...");
await waitForContainer(parent.id);

console.log("Publishing...");
const published = await igCall(`${IG_USER_ID}/media_publish`, {
  creation_id: parent.id,
  access_token: token,
});
console.log("PUBLISHED. Media ID:", published.id);
