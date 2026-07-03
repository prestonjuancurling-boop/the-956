#!/usr/bin/env node
/**
 * Downloads real Google Places photos for the current top-eats.json spots
 * into social/photos/<slug>.jpg, for use in the Instagram rankings carousel.
 * Keeps the API key out of any committed file — images are fetched once
 * and saved as plain static files.
 *
 * Usage: GOOGLE_PLACES_API_KEY=... node scripts/fetch-ranking-photos.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const photosDir = join(root, "social", "photos");

const key = process.env.GOOGLE_PLACES_API_KEY;
if (!key) {
  console.error("Set GOOGLE_PLACES_API_KEY first.");
  process.exit(1);
}

const watchlist = JSON.parse(readFileSync(join(dataDir, "watchlist.json"), "utf8"));
const topEats = JSON.parse(readFileSync(join(dataDir, "top-eats.json"), "utf8"));

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

async function fetchPhotoFor(spot) {
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
    console.warn(`  lookup failed for ${spot.name}: ${res.status} ${await res.text()}`);
    return null;
  }
  const place = (await res.json()).places?.[0];
  const photoName = place?.photos?.[0]?.name;
  if (!photoName) {
    console.warn(`  no photo found for ${spot.name}`);
    return null;
  }
  const photoRes = await fetch(
    `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=1080&key=${key}`
  );
  if (!photoRes.ok) {
    console.warn(`  photo download failed for ${spot.name}: ${photoRes.status}`);
    return null;
  }
  const buf = Buffer.from(await photoRes.arrayBuffer());
  const outPath = join(photosDir, `${slugify(spot.name)}.jpg`);
  writeFileSync(outPath, buf);
  console.log(`  saved ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`);
  return outPath;
}

for (const entry of topEats.spots) {
  const spot = watchlist.spots.find((w) => w.name === entry.name);
  if (!spot) {
    console.warn(`No watchlist entry for ${entry.name}, skipping.`);
    continue;
  }
  console.log(`Fetching photo for ${spot.name}...`);
  await fetchPhotoFor(spot);
}

console.log("Done.");
