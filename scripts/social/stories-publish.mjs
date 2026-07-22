#!/usr/bin/env node
/**
 * Publish a single image to @the956rgv's Instagram Story.
 *
 * Usage:
 *   node scripts/social/stories-publish.mjs <folder> <file.png>
 *
 * <folder>  social/output/<date>/ directory containing the PNG
 * <file>    filename (relative to <folder>) of the story image (1080x1920)
 *
 * Requires ~/.the956-ig-token (long-lived token; see README-social.md).
 * Stories have no future-scheduling on Instagram's API and no caption field
 * (any text must already be baked into the image) — this script PUBLISHES
 * LIVE the moment it completes. Only run it after explicit approval.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hostImages } from "./host-images.mjs";

const [folder, file] = process.argv.slice(2);
if (!folder || !file) {
  console.error("Usage: node stories-publish.mjs <folder> <file.png>");
  process.exit(1);
}

const { access_token: token } = JSON.parse(readFileSync(join(homedir(), ".the956-ig-token"), "utf8"));

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
console.log("Hosting image publicly...");
const [url] = await hostImages(folder, [file], `story-${slug}-${Date.now()}`);

console.log("Creating story container...");
const container = await igCall(`${IG_USER_ID}/media`, {
  image_url: url,
  media_type: "STORIES",
  access_token: token,
});
console.log("Waiting for processing...");
await waitForContainer(container.id);

console.log("Publishing...");
const published = await igCall(`${IG_USER_ID}/media_publish`, {
  creation_id: container.id,
  access_token: token,
});
console.log("PUBLISHED to Stories. Media ID:", published.id);
