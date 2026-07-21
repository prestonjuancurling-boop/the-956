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
 *   5. Size factor — an explicit extra weight by absolute review count
 *      (×1.35 under 150 reviews down to ×0.6 over 4,000), on top of #2's
 *      relative velocity, so a big chain's larger absolute foot traffic
 *      doesn't out-earn small independents even after size-adjusting.
 *   6. Momentum smoothing — final score is an EMA (60% this week, 40%
 *      running score) so rankings reward sustained heat over one-off spikes
 *      — except a reigning #1's carried-forward 40% tapers further each
 *      extra week they hold the top spot (floor 25%), so stale momentum
 *      from an old lead doesn't lock out challengers indefinitely.
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

// Reddit/review counts alone still favor whoever has the biggest customer
// base, even after size-relative velocity — a 5,000-review institution
// picks up more raw new reviews per week than a 100-review stand ever
// could, just from foot traffic. This tiers an explicit extra weight by
// absolute size, on top of relative velocity, so small independent spots
// get real variety-of-winners rather than the biggest name always coasting.
function sizeFactor(reviewCount) {
  if (reviewCount == null) return 1.0;
  if (reviewCount < 150) return 1.35;
  if (reviewCount < 500) return 1.15;
  if (reviewCount < 1500) return 1.0;
  if (reviewCount < 4000) return 0.8;
  return 0.6;
}

// A long-reigning #1's carried-forward momentum tapers a bit more each
// extra week on top, so a strong week from a challenger has a real shot at
// overtaking stale momentum instead of the same leader coasting on an old
// lead indefinitely. Only kicks in once a spot has already held #1 for 2+
// weeks; a fresh win isn't penalized.
function emaCarryWeight(isDefendingChamp, streakWeeks) {
  if (!isDefendingChamp || streakWeeks < 2) return 0.4;
  return Math.max(0.25, 0.4 - (streakWeeks - 1) * 0.05);
}

// ————— main —————

// Network hiccups on one source or one spot must never kill the whole run —
// history still gets written and the zero-signal/threshold guards handle the gap.
async function tryOrNull(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`  ${label} failed: ${err.message}`);
    return null;
  }
}

const token = hasReddit ? await tryOrNull("Reddit auth", redditToken) : null;
const results = [];

// Captured before the loop mutates anything — who's currently defending #1
// and for how long, so their EMA carry-forward can be tapered.
const prevChampName = prevEats.spots?.[0]?.name ?? null;
const prevChampStreak = prevEats.spots?.[0]?.streak_weeks ?? 1;

for (const spot of watchlist.spots) {
  console.log(`Measuring ${spot.name}…`);
  const reddit = token ? await tryOrNull("Reddit search", () => redditMentions(token, spot)) : null;
  const places = hasPlaces ? await tryOrNull("Places lookup", () => placesLookup(spot)) : null;

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
    qualityFactor(places?.rating) *
    sizeFactor(places?.reviewCount);

  const isDefendingChamp = spot.name === prevChampName;
  const carryWeight = emaCarryWeight(isDefendingChamp, prevChampStreak);
  const ema = prev?.ema != null ? 0.6 * rawBuzz + carryWeight * prev.ema : rawBuzz;

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

// Below this, a couple of stray reviews would decide #1 — not a ranking,
// noise. Keep measuring until the data actually says something.
const MIN_SIGNAL = 8;

const totalSignal = results.reduce((s, r) => s + (r.reddit ?? 0) + (r.reviewDelta ?? 0), 0);
if (totalSignal < MIN_SIGNAL) {
  console.log(
    `✔ Signal too thin to publish (${totalSignal} < ${MIN_SIGNAL}) — history updated, published rankings left untouched.`
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
      "Scores blend this week's buzz with running momentum, size-relative review velocity, a newcomer boost, a small quality factor, and an extra weight favoring small independent spots over big chains — computed automatically, no opinions.",
    disclaimer_es:
      "Los puntajes combinan el buzz de la semana con el impulso acumulado, la velocidad de reseñas relativa al tamaño, un empujón para los recién abiertos, un pequeño factor de calidad, y un peso extra a favor de los negocios pequeños e independientes sobre las cadenas grandes — todo automático, sin opiniones.",
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
        // Signed places moved since last week (null = wasn't ranked last week).
        // Drives the "▲2" movement chips on the site and carousels.
        moved: was == null ? null : was - rank,
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

// ————— monthly micro-ranking (data/category.json) —————
// Same engine, smaller arena. History keys are prefixed "cat:" so a spot can
// appear in both pools without colliding.

const categoryPath = join(dataDir, "category.json");
if (existsSync(categoryPath)) {
  const cat = JSON.parse(readFileSync(categoryPath, "utf8"));
  const catResults = [];
  const prevCatChamp = cat.spots?.find((s) => s.rank === 1) ?? null;
  const prevCatChampName = prevCatChamp?.name ?? null;
  const prevCatChampStreak = prevCatChamp?.streak_weeks ?? 1;
  for (const spot of cat.spots) {
    console.log(`Measuring [${cat.title}] ${spot.name}…`);
    const reddit = token ? await tryOrNull("Reddit search", () => redditMentions(token, spot)) : null;
    const places = hasPlaces ? await tryOrNull("Places lookup", () => placesLookup(spot)) : null;
    const key = "cat:" + spot.name;
    const prev = history[key];
    const delta =
      places?.reviewCount != null && prev?.reviewCount != null
        ? Math.max(0, places.reviewCount - prev.reviewCount)
        : null;
    const relV =
      delta != null && places?.reviewCount
        ? delta / Math.sqrt(Math.max(places.reviewCount, 30))
        : 0;
    const raw = ((reddit ?? 0) * 10 + relV * 60) * qualityFactor(places?.rating) * sizeFactor(places?.reviewCount);
    const isDefendingCatChamp = spot.name === prevCatChampName;
    const catCarryWeight = emaCarryWeight(isDefendingCatChamp, prevCatChampStreak);
    const ema = prev?.ema != null ? 0.6 * raw + catCarryWeight * prev.ema : raw;
    history[key] = {
      reviewCount: places?.reviewCount ?? prev?.reviewCount ?? null,
      rating: places?.rating ?? prev?.rating ?? null,
      ema,
      date: new Date().toISOString().slice(0, 10),
    };
    catResults.push({ spot, reddit, delta, rating: places?.rating ?? null, score: Math.round(ema) });
    console.log(`  reddit: ${reddit ?? "n/a"} · reviews: ${places?.reviewCount ?? "n/a"} (Δ ${delta ?? "n/a"}) · score: ${Math.round(ema)}`);
  }
  if (!cat.baseline_date) cat.baseline_date = new Date().toISOString().slice(0, 10);
  const daysMeasured = (Date.now() - new Date(cat.baseline_date)) / 86400000;
  const catSignal = catResults.reduce((s, r) => s + (r.reddit ?? 0) + (r.delta ?? 0), 0);
  // Publish only after a real measuring window, so one stray review on day
  // one can't crown a winner before the announced reveal.
  if (catSignal > 0 && daysMeasured >= 3) {
    const prevCatRanks = Object.fromEntries(
      (cat.spots ?? []).filter((s) => s.rank != null).map((s) => [s.name, s.rank])
    );
    catResults.sort((a, b) => b.score - a.score);
    cat.status = "ranked";
    cat.spots = catResults.map((r, i) => {
      const rank = i + 1;
      const was = prevCatRanks[r.spot.name];
      const entry = {
        ...r.spot,
        rank,
        mentions: r.score,
        reddit_mentions: r.reddit,
        review_delta: r.delta,
        rating: r.rating,
        moved: was == null ? null : was - rank,
      };
      if (rank === 1) {
        entry.streak_weeks = prevCatChampName === r.spot.name ? prevCatChampStreak + 1 : 1;
      } else {
        // ...r.spot spreads last week's fields; a dethroned champ must not
        // keep a stale streak_weeks on its new, lower-ranked entry.
        delete entry.streak_weeks;
      }
      return entry;
    });
    console.log(`✔ Ranked category "${cat.title}"`);
  } else if (cat.status !== "ranked") {
    // Only pre-publication runs may hold the category in "measuring".
    // A quiet week must never un-publish an already-ranked category
    // (a same-day double run did exactly that on 2026-07-06).
    cat.status = "measuring";
    console.log(`✔ Category "${cat.title}" baseline seeded — still measuring`);
  } else {
    console.log(`✔ Category "${cat.title}" quiet this run — keeping published ranking`);
  }
  writeFileSync(categoryPath, JSON.stringify(cat, null, 2) + "\n");
  writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");
}

// ————— bonus: real photos for Fresh Plates, Power Rankings and the —————
// ————— monthly category cards. Photos are downloaded as local site  —————
// ————— assets. Never store the API-keyed media URL in a data file — —————
// ————— this repo is public and the URL embeds the key.              —————
//
// Every downloaded photo is saved under the same filename in BOTH
// assets/photos/ (the live site) and social/photos/ (Instagram carousel
// templates, which are data-driven and expect a matching local file) —
// that keeps the carousels from ever needing a manual photo-copy step.

if (hasPlaces) {
  const { mkdirSync } = await import("node:fs");
  const assetsPhotoDir = join(dataDir, "..", "assets", "photos");
  const socialPhotoDir = join(dataDir, "..", "social", "photos");
  mkdirSync(assetsPhotoDir, { recursive: true });
  mkdirSync(socialPhotoDir, { recursive: true });
  const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  async function fillMissingPhotos(list, queryFor) {
    let added = 0;
    for (const item of list) {
      if (item.photo) continue;
      const filename = `${slugify(item.name)}.jpg`;
      const saved = await tryOrNull(`photo for ${item.name}`, async () => {
        const found = await placesLookup({ name: item.name, places_query: queryFor(item) });
        if (!found?.photo) return null;
        const imgRes = await fetch(found.photo);
        if (!imgRes.ok) throw new Error(`download HTTP ${imgRes.status}`);
        const bytes = Buffer.from(await imgRes.arrayBuffer());
        writeFileSync(join(assetsPhotoDir, filename), bytes);
        writeFileSync(join(socialPhotoDir, filename), bytes);
        return filename;
      });
      if (!saved) continue;
      item.photo = saved;
      added++;
      console.log(`  📷 saved ${saved}`);
    }
    return added;
  }

  const restoPath = join(dataDir, "new-restaurants.json");
  const restos = JSON.parse(readFileSync(restoPath, "utf8"));
  const restoAdded = await fillMissingPhotos(restos.restaurants, (r) =>
    `${r.name} restaurant ${r.city === "RGV" ? "Rio Grande Valley" : r.city} TX`
  );
  if (restoAdded) {
    writeFileSync(restoPath, JSON.stringify(restos, null, 2) + "\n");
    console.log(`✔ Added ${restoAdded} restaurant photo(s) to data/new-restaurants.json`);
  }

  const topEatsPath = join(dataDir, "top-eats.json");
  const topEats = JSON.parse(readFileSync(topEatsPath, "utf8"));
  const topAdded = await fillMissingPhotos(topEats.spots, (s) =>
    `${s.name} ${s.city === "Valley-wide" ? "Rio Grande Valley" : s.city} TX`
  );
  if (topAdded) {
    writeFileSync(topEatsPath, JSON.stringify(topEats, null, 2) + "\n");
    console.log(`✔ Added ${topAdded} Power Rankings photo(s) to data/top-eats.json`);
  }

  const catForPhotos = JSON.parse(readFileSync(categoryPath, "utf8"));
  const catAdded = await fillMissingPhotos(catForPhotos.spots, (s) => s.places_query);
  if (catAdded) {
    writeFileSync(categoryPath, JSON.stringify(catForPhotos, null, 2) + "\n");
    console.log(`✔ Added ${catAdded} category photo(s) to data/category.json`);
  }
}
