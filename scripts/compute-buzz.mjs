#!/usr/bin/env node
/**
 * The 956 — data-driven Power Rankings.
 *
 * Measures real buzz for every spot in data/watchlist.json and ranks the
 * top 5 with context, not just raw counts:
 *
 *   1. Reddit mentions — posts in r/RioGrandeValley over the past week.
 *   2. Size-relative review velocity — new Google reviews this week divided
 *      by sqrt(total reviews), so a newcomer gaining 40 reviews on a base of
 *      100 outranks an institution gaining 40 on a base of 8,000.
 *   3. Newcomer boost — spots with a recent `opened` date in the watchlist
 *      get ×1.2 (<120 days) or ×1.1 (<240 days).
 *   4. Quality factor — small multiplier from Google rating so a spot going
 *      viral for the wrong reasons can't take #1.
 *   5. Momentum smoothing — final score is an EMA (60% this week, 40%
 *      running score) so rankings reward sustained heat over one-off spikes.
 *
 * Also emits story badges (new entry, biggest mover, #1 streak) and an
 * "on the bubble" list (ranks 6-8), and keeps per-spot state in
 * data/buzz-history.json.
 *
 * If a run produces zero signal (first run, or every source failed), it
 * seeds the history baseline and leaves the published rankings untouched.
 *
 * Credentials (env vars, both optional but at least one needed for signal):
 *   REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET — free "script" app from
 *     https://www.reddit.com/prefs/apps
 *   GOOGLE_PLACES_API_KEY — from Google Cloud console (Places API New)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const UA = "the-956-buzz/1.0 (RGV local digest; the956.com)";

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

// ————— scoring —————

function daysSince(yyyyMm) {
  if (!yyyyMm) return Infinity;
  return (Date.now() - new Date(`${yyyyMm}-01`)) / 86400000;
}

function newcomerBoost(spot) {
  const age = daysSince(spot.opened);
  if (age < 120) return 1.2;
  if (age < 240) return 1.1;
  return 1.0;
}

function qualityFactor(rating) {
  if (rating == null) return 1.0;
  return Math.min(1.12, Math.max(0.85, 1 + (rating - 4.2) * 0.2));
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

  // Size-relative velocity: same delta means much more on a small base.
  const relVelocity =
    reviewDelta != null && places?.reviewCount
      ? reviewDelta / Math.sqrt(Math.max(places.reviewCount, 30))
      : 0;

  const rawBuzz =
    ((reddit ?? 0) * 10 + relVelocity * 60) *
    newcomerBoost(spot) *
    qualityFactor(places?.rating);

  const ema = prev?.ema != null ? 0.6 * rawBuzz + 0.4 * prev.ema : rawBuzz;

  history[spot.name] = {
    reviewCount: places?.reviewCount ?? prev?.reviewCount ?? null,
    rating: places?.rating ?? prev?.rating ?? null,
    ema,
    date: new Date().toISOString().slice(0, 10),
  };

  results.push({
    spot,
    reddit,
    reviewDelta,
    rating: places?.rating ?? null,
    score: Math.round(ema),
  });
  console.log(
    `  reddit: ${reddit ?? "n/a"} · reviews: ${places?.reviewCount ?? "n/a"}` +
      ` (Δ ${reviewDelta ?? "n/a"}) · relVel: ${relVelocity.toFixed(2)} · score: ${Math.round(ema)}`
  );
}

writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");

const totalSignal = results.reduce((s, r) => s + (r.reddit ?? 0) + (r.reviewDelta ?? 0), 0);
if (totalSignal === 0) {
  console.log(
    "✔ No signal yet (baseline run) — seeded data/buzz-history.json, rankings left untouched."
  );
} else {
  results.sort((a, b) => b.score - a.score);
  const top5 = results.slice(0, 5);
  const bubble = results.slice(5, 8).map((r) => ({ name: r.spot.name, city: r.spot.display_city }));

  const prevRank = Object.fromEntries((prevEats.spots ?? []).map((s) => [s.name, s.rank]));
  const prevStreak = prevEats.spots?.[0]?.streak_weeks ?? 1;

  // Biggest positive rank jump (needs to have been ranked before, jump ≥ 2).
  let moverName = null, moverJump = 1;
  for (let i = 0; i < top5.length; i++) {
    const was = prevRank[top5[i].spot.name];
    if (was != null && was - (i + 1) > moverJump) {
      moverJump = was - (i + 1);
      moverName = top5[i].spot.name;
    }
  }

  const sources = [
    hasReddit && "Reddit chatter in r/" + watchlist.subreddit,
    hasPlaces && "Google review velocity (scaled to each spot's size)",
  ].filter(Boolean).join(" + ");
  const sourcesEs = [
    hasReddit && "menciones en r/" + watchlist.subreddit,
    hasPlaces && "velocidad de reseñas de Google (ajustada al tamaño de cada lugar)",
  ].filter(Boolean).join(" + ");

  writeFileSync(join(dataDir, "top-eats.json"), JSON.stringify({
    section_note: `The Valley's most-talked-about food spots, ranked by real data: ${sources}.`,
    section_note_es: `Los lugares de comida más mencionados del Valle, con datos reales: ${sourcesEs}.`,
    disclaimer:
      "Scores blend this week's buzz with running momentum, size-relative review velocity, a newcomer boost, and a small quality factor — computed automatically, no opinions.",
    disclaimer_es:
      "Los puntajes combinan el buzz de la semana con el impulso acumulado, la velocidad de reseñas relativa al tamaño, un empujón para los recién abiertos y un pequeño factor de calidad — todo automático, sin opiniones.",
    spots: top5.map((r, i) => {
      const rank = i + 1;
      const was = prevRank[r.spot.name];
      const badges = [];
      if (was == null) badges.push("new_entry");
      if (r.spot.name === moverName) badges.push("biggest_mover");
      const entry = {
        rank,
        name: r.spot.name,
        city: r.spot.display_city,
        known_for: r.spot.known_for,
        known_for_es: r.spot.known_for_es,
        mentions: r.score,
        reddit_mentions: r.reddit,
        review_delta: r.reviewDelta,
        rating: r.rating,
        trend: was == null ? "steady" : was > rank ? "up" : was < rank ? "down" : "steady",
        badges,
      };
      if (rank === 1) {
        entry.streak_weeks = prevEats.spots?.[0]?.name === r.spot.name ? prevStreak + 1 : 1;
      }
      return entry;
    }),
    bubble,
  }, null, 2) + "\n");
  console.log("✔ Wrote data/top-eats.json");
}

// ————— bonus: real photos for the Fresh Plates cards —————
// Photos are downloaded as local site assets. Never store the API-keyed
// media URL in a data file — this repo is public and the URL embeds the key.

if (hasPlaces) {
  const { mkdirSync } = await import("node:fs");
  const photoDir = join(dataDir, "..", "assets", "photos");
  mkdirSync(photoDir, { recursive: true });
  const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const restoPath = join(dataDir, "new-restaurants.json");
  const restos = JSON.parse(readFileSync(restoPath, "utf8"));
  let added = 0;
  for (const r of restos.restaurants) {
    if (r.photo) continue;
    const found = await placesLookup({
      name: r.name,
      places_query: `${r.name} restaurant ${r.city === "RGV" ? "Rio Grande Valley" : r.city} TX`,
    });
    if (!found?.photo) continue;
    const imgRes = await fetch(found.photo);
    if (!imgRes.ok) {
      console.warn(`  photo download failed for ${r.name}: ${imgRes.status}`);
      continue;
    }
    const rel = `assets/photos/${slugify(r.name)}.jpg`;
    writeFileSync(join(dataDir, "..", rel), Buffer.from(await imgRes.arrayBuffer()));
    r.photo = rel;
    added++;
    console.log(`  📷 saved ${rel}`);
  }
  if (added) {
    writeFileSync(restoPath, JSON.stringify(restos, null, 2) + "\n");
    console.log(`✔ Added ${added} restaurant photo(s) to data/new-restaurants.json`);
  }
}
