#!/usr/bin/env node
/**
 * Downloads real Google Places photos for each restaurant in
 * data/new-restaurants.json into social/photos/<slug>.jpg, for the
 * Fresh Plates Instagram carousel.
 *
 * Usage: GOOGLE_PLACES_API_KEY=... node scripts/fetch-fresh-plates-photos.mjs
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

const restaurants = JSON.parse(
  readFileSync(join(root, "data", "new-restaurants.json"), "utf8")
).restaurants;

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

async function fetchPhotoFor(query, slug) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.photos",
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
  });
  if (!res.ok) {
    console.warn(`  lookup failed: ${res.status} ${await res.text()}`);
    return null;
  }
  const place = (await res.json()).places?.[0];
  const photoName = place?.photos?.[0]?.name;
  if (!photoName) {
    console.warn(`  no photo found`);
    return null;
  }
  const photoRes = await fetch(
    `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=1080&key=${key}`
  );
  if (!photoRes.ok) {
    console.warn(`  photo download failed: ${photoRes.status}`);
    return null;
  }
  const buf = Buffer.from(await photoRes.arrayBuffer());
  const outPath = join(photosDir, `${slug}.jpg`);
  writeFileSync(outPath, buf);
  console.log(`  saved ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`);
  return outPath;
}

for (const r of restaurants) {
  const query = `${r.name} restaurant ${r.city === "RGV" ? "Rio Grande Valley" : r.city} TX`;
  console.log(`Fetching photo for ${r.name}...`);
  await fetchPhotoFor(query, slugify(r.name));
}

console.log("Done.");
