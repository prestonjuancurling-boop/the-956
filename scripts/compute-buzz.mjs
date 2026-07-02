#!/usr/bin/env node
/**
 * The 956 — data-driven Power Rankings.
 *
 * Measures real buzz for every spot in data/watchlist.json:
 *   1. Reddit mentions — posts in r/RioGrandeValley over the past week that
 *      mention the spot (Reddit OAuth, free tier).
 *   2. Google review velocity — how many new Google reviews the spot gained
 *      since the last run (Places API, free tier), tracked in
 *      data/buzz-history.json.
 *
 * Score = reddit_mentions × 10 + review_delta × 3. Top 5 become
 * data/top-eats.json. Restaurant photos come from the Places API when
 * available. Both sources are optional — with no credentials the script
 * exits without touching anything, so the site never breaks.
 *
 * Credentials (env vars):
 *   REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET — free "script" app from
 *     https://www.reddit.com/prefs/apps
 *   GOOGLE_PLACES_API_KEY — from Google Cloud console (Places API New)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const UA = "the-956-buzz/1.0 (RGV local digest; github.com/the-956)";

const watchlist = JSON.parse(readFileSync(join(dataDir, "watchlist.json"), "utf8"));
const historyPath = join(dataDir, "buzz-history.json");
const history = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, "utf8")) : {};
const prevEats = JSON.parse(readFileSync(join(dataDir, "top-eats.json"), "utf8"));

const hasReddit = !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
const hasPlaces = !!process.env.GOOGLE_PLACES_API_KEY;

if (!hasReddit && !hasPlaces) {
  console.log("No REDDIT_* or GOOGLE_PLACES_API_KEY credentials — leaving rankings untouched.");
  process.exit(0);
}

// ————— Reddit: posts this week mentioning each spot —————

async function redditToken() {
  const basic = Buffer.from(
    `${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`
  ).toString("base64");
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Reddit token failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function redditMentions(token, spot) {
  const ids = new Set();
  for (const alias of spot.aliases) {
    const url = new URL(`https://oauth.reddit.com/r/${watchlist.subreddit}/search`);
    url.searchParams.set("q", `"${alias}"`);
    url.searchParams.set("restrict_sr", "on");
    url.searchParams.set("t", "week");
    url.searchParams.set("limit", "100");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": UA },
    });
    if (!res.ok) {
      console.warn(`  Reddit search failed for "${alias}": ${res.status}`);
      continue;
    }
    const json = await res.json();
    for (const child of json.data?.children ?? []) ids.add(child.data.id);
    await new Promise((r) => setTimeout(r, 1100)); // stay well under rate limits
  }
  return ids.size;
}

// ————— Google Places: review counts + photos —————

async function placesLookup(spot) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.userRatingCount,places.rating,places.photos",
    },
    body: JSON.stringify({ textQuery: spot.places_query, maxResultCount: 1 }),
  });
  if (!res.ok) {
    console.warn(`  Places lookup failed for ${spot.name}: ${res.status}`);
    return null;
  }
  const place = (await res.json()).places?.[0];
  if (!place) return null;
  const photoName = place.photos?.[0]?.name;
  return {
    reviewCount: place.userRatingCount ?? null,
    rating: place.rating ?? null,
    photo: photoName
      ? `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${process.env.GOOGLE_PLACES_API_KEY}`
      : null,
  };
}

// ————— main —————

const token = hasReddit ? await redditToken() : null;
const results = [];

for (const spot of watchlist.spots) {
  console.log(`Measuring ${spot.name}…`);
  const reddit = token ? await redditMentions(token, spot) : null;
  const places = hasPlaces ? await placesLookup(spot) : null;

  const prev = history[spot.name];
  const reviewDelta =
    places?.reviewCount != null && prev?.reviewCount != null
      ? Math.max(0, places.reviewCount - prev.reviewCount)
      : null;

  if (places?.reviewCount != null) {
    history[spot.name] = {
      reviewCount: places.reviewCount,
      rating: places.rating,
      date: new Date().toISOString().slice(0, 10),
    };
  }

  const score = (reddit ?? 0) * 10 + (reviewDelta ?? 0) * 3;
  results.push({ spot, reddit, reviewDelta, rating: places?.rating ?? null, score });
  console.log(
    `  reddit: ${reddit ?? "n/a"} · reviews: ${places?.reviewCount ?? "n/a"}` +
      ` (Δ ${reviewDelta ?? "n/a"}) · score: ${score}`
  );
}

results.sort((a, b) => b.score - a.score);
const top5 = results.slice(0, 5);

const prevRank = Object.fromEntries((prevEats.spots ?? []).map((s) => [s.name, s.rank]));

const sources = [
  hasReddit && `mentions in r/${watchlist.subreddit} this week`,
  hasPlaces && "new Google reviews since last week",
].filter(Boolean).join(" and ");

writeFileSync(join(dataDir, "top-eats.json"), JSON.stringify({
  section_note: `The Valley's most-talked-about food spots, ranked by real data: ${sources}.`,
  disclaimer: "Computed automatically from public data — no opinions, just counts. Rankings refresh weekly.",
  spots: top5.map((r, i) => {
    const rank = i + 1;
    const was = prevRank[r.spot.name];
    return {
      rank,
      name: r.spot.name,
      city: r.spot.display_city,
      known_for: r.spot.known_for,
      mentions: r.score,
      reddit_mentions: r.reddit,
      review_delta: r.reviewDelta,
      rating: r.rating,
      trend: was == null ? "steady" : was > rank ? "up" : was < rank ? "down" : "steady",
    };
  }),
}, null, 2) + "\n");

writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");
console.log("✔ Wrote data/top-eats.json and data/buzz-history.json");

// ————— bonus: real photos for the Fresh Plates cards —————

if (hasPlaces) {
  const restoPath = join(dataDir, "new-restaurants.json");
  const restos = JSON.parse(readFileSync(restoPath, "utf8"));
  let added = 0;
  for (const r of restos.restaurants) {
    if (r.photo) continue;
    const found = await placesLookup({
      name: r.name,
      places_query: `${r.name} restaurant ${r.city === "RGV" ? "Rio Grande Valley" : r.city} TX`,
    });
    if (found?.photo) {
      r.photo = found.photo;
      added++;
      console.log(`  📷 photo found for ${r.name}`);
    }
  }
  if (added) {
    writeFileSync(restoPath, JSON.stringify(restos, null, 2) + "\n");
    console.log(`✔ Added ${added} restaurant photo(s) to data/new-restaurants.json`);
  }
}
