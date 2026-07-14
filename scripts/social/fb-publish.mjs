#!/usr/bin/env node
/**
 * Publish a multi-photo post to the "the956" Facebook Page — optionally
 * scheduled for a future time (Facebook natively supports this; no need
 * for the script to be running again later).
 *
 * Usage:
 *   node scripts/social/fb-publish.mjs <folder> <caption-file> <ISO-datetime-or-"now"> <file1.png> <file2.png> ...
 *
 * Requires ~/.the956-fb-page-token (see README-social.md).
 * This script PUBLISHES/SCHEDULES LIVE the moment it completes — only run
 * it after the user has explicitly approved this exact post.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hostImages } from "./host-images.mjs";

const [folder, captionFile, when, ...files] = process.argv.slice(2);
if (!folder || !captionFile || !when || files.length < 1) {
  console.error('Usage: node fb-publish.mjs <folder> <caption-file> <ISO-datetime-or-"now"> <file1> [file2 ...]');
  process.exit(1);
}

const { page_id: pageId, access_token: token } = JSON.parse(
  readFileSync(join(homedir(), ".the956-fb-page-token"), "utf8")
);
const caption = readFileSync(captionFile, "utf8").trim();

const slug = folder.replace(/[\\/]/g, "-").replace(/^-+|-+$/g, "");
console.log(`Hosting ${files.length} image(s) publicly...`);
const urls = await hostImages(folder, files, `fb-${slug}-${Date.now()}`);

console.log("Uploading unpublished photos...");
const photoIds = [];
for (const url of urls) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, published: false, access_token: token }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`FB photo upload failed: ${JSON.stringify(body)}`);
  photoIds.push(body.id);
  console.log("  uploaded photo:", body.id);
}

const feedParams = {
  message: caption,
  attached_media: JSON.stringify(photoIds.map((id) => ({ media_fbid: id }))),
  access_token: token,
};

if (when !== "now") {
  const ts = Math.floor(new Date(when).getTime() / 1000);
  const minFuture = Math.floor(Date.now() / 1000) + 600; // FB requires >=10 min out
  if (ts < minFuture) throw new Error("Scheduled time must be at least 10 minutes in the future.");
  feedParams.published = false;
  feedParams.scheduled_publish_time = ts;
}

console.log(when === "now" ? "Publishing now..." : `Scheduling for ${when}...`);
const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/feed`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(feedParams),
});
const body = await res.json();
if (!res.ok) throw new Error(`FB feed post failed: ${JSON.stringify(body)}`);
console.log(when === "now" ? "PUBLISHED." : "SCHEDULED.", "Post ID:", body.id);
