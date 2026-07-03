#!/usr/bin/env node
/**
 * Downloads real Google Places photos for the current micro-ranking
 * category spots (data/category.json) into social/photos/<slug>.jpg,
 * for use in category social carousels.
 *
 * Usage: GOOGLE_PLACES_API_KEY=... node scripts/fetch-category-photos.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const photosDir = join(root, "social", "photos");

const key = process.env.GOOGLE_PLACES_API_KEY;
if (!key) {
  console.error("Set GOOGLE_PLACES_API_KEY first.");
  process.exit(1);
}

const cat = JSON.parse(readFileSync(join(root, "data", "category.json"), "utf8"));
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

for (const spot of cat.spots) {
  console.log(`Fetching photo for ${spot.name}...`);
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.photos",
    },
    body: JSON.stringify({ textQuery: spot.places_query, maxResultCount: 1 }),
  });
  if (!res.ok) {
    console.warn(`  lookup failed: ${res.status}`);
    continue;
  }
  const place = (await res.json()).places?.[0];
  const photoName = place?.photos?.[0]?.name;
  if (!photoName) {
    console.warn(`  no photo found`);
    continue;
  }
  const photoRes = await fetch(
    `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=1080&key=${key}`
  );
  if (!photoRes.ok) {
    console.warn(`  download failed: ${photoRes.status}`);
    continue;
  }
  const outPath = join(photosDir, `${slugify(spot.name)}.jpg`);
  writeFileSync(outPath, Buffer.from(await photoRes.arrayBuffer()));
  console.log(`  saved ${outPath}`);
}
console.log("Done.");
