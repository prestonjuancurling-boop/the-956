#!/usr/bin/env node
/**
 * The 956 — automated content updater.
 *
 * Regenerates the data/*.json files by running Claude Code headless
 * (`claude -p`) with web search, then validating the JSON before writing.
 * The site itself never changes — it just renders whatever is in data/.
 *
 * Usage:
 *   node scripts/update-content.mjs news          # daily
 *   node scripts/update-content.mjs events        # weekly (Mondays)
 *   node scripts/update-content.mjs restaurants   # weekly
 *   node scripts/update-content.mjs rankings      # weekly
 *   node scripts/update-content.mjs all
 *
 * Requires: Claude Code CLI installed and logged in (`claude --version`).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");

const today = new Date().toLocaleDateString("en-US", {
  weekday: "long", year: "numeric", month: "long", day: "numeric",
});

const COMMON = `
You are the content editor for "The 956", a friendly local digest website for
the Rio Grande Valley, Texas (McAllen, Edinburg, Mission, Pharr, Harlingen,
Weslaco, Brownsville, South Padre Island and surrounding cities).
Today is ${today}. Use web search to find real, current information from local
sources (KRGV, ValleyCentral/KVEO, MyRGV/The Monitor, Texas Border Business,
city event pages, local blogs). Tone: warm, upbeat, for locals — light Spanish
flavor is welcome ("el Valle"). Never invent events, restaurants, or news.
If you can't verify something, leave it out.
Respond with ONLY valid JSON — no markdown fences, no commentary.`;

const JOBS = {
  events: {
    file: "events.json",
    validate: (d) => Array.isArray(d.events) && d.events.length === 5,
    prompt: `${COMMON}
Find the 5 biggest events happening across the Rio Grande Valley THIS WEEK
and produce JSON with this exact shape (keep field names identical):
{"section_note": "...", "events": [{"rank": 1, "title": "...", "city": "...",
"venue": "...", "date": "Sat, July 4", "time": "...", "price": "Free",
"tag": "...", "blurb": "1-2 sentences", "url": "source url"}],
"also_happening": "one sentence about a bonus event, or empty string"}
Exactly 5 events, ranked biggest first, spread across different cities when possible.`,
  },

  news: {
    file: "news.json",
    validate: (d) => Array.isArray(d.items) && d.items.length >= 3,
    prompt: `${COMMON}
Find 4-5 current local news stories from the last 1-2 days. Prefer civic,
community, business and quality-of-life stories over crime and tragedy —
this is a "nice place for locals", not a police blotter. Produce JSON:
{"section_note": "...", "items": [{"headline": "...", "summary": "1-2 sentences",
"source": "KRGV", "topic": "Transportation", "published": "Jul 1",
"url": "source url"}]}`,
  },

  restaurants: {
    file: "new-restaurants.json",
    validate: (d) => Array.isArray(d.restaurants) && d.restaurants.length >= 3,
    prompt: `${COMMON}
Find restaurants that recently opened or were just announced in the RGV
(check Texas Border Business, local blogs, Coming Soon RGV coverage). JSON:
{"section_note": "...", "restaurants": [{"name": "...", "city": "...",
"cuisine": "...", "status": "Now open" or "Opening soon",
"blurb": "1-2 sentences", "emoji": "one fitting emoji"}]}
4-6 restaurants. Only include places you can verify from a source.`,
  },

  rankings: {
    file: "top-eats.json",
    validate: (d) => Array.isArray(d.spots) && d.spots.length === 5,
    prompt: `${COMMON}
Rank the 5 most-talked-about RGV food spots right now, based on how often
they're mentioned in local blogs, "best of RGV" roundups, r/RioGrandeValley
threads and recent reviews you find via search. Estimate a relative mention
count per spot from what you find (higher = more buzz). Compare with the
previous ranking to set each trend. Previous ranking for reference:
${readFileSync(join(dataDir, "top-eats.json"), "utf8")}
Produce JSON: {"section_note": "...", "disclaimer": "Buzz scores are estimated
from public mentions, not an exact count.", "spots": [{"rank": 1, "name": "...",
"city": "...", "known_for": "...", "mentions": 214, "trend": "up"|"down"|"steady"}]}
Exactly 5 spots.`,
  },
};

function runClaude(prompt) {
  return execFileSync("claude", [
    "-p", prompt,
    "--allowedTools", "WebSearch,WebFetch",
    "--output-format", "text",
  ], { encoding: "utf8", timeout: 10 * 60 * 1000, shell: process.platform === "win32" });
}

function extractJSON(text) {
  // Tolerate stray prose or markdown fences around the JSON object.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in response");
  return JSON.parse(text.slice(start, end + 1));
}

function updateMeta() {
  const metaPath = join(dataDir, "meta.json");
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d, opts) => d.toLocaleDateString("en-US", opts);
  meta.week_of = `${fmt(monday, { month: "long", day: "numeric" })} – ${fmt(sunday, { month: "long", day: "numeric", year: "numeric" })}`;
  meta.generated_at = now.toISOString();
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
}

const arg = process.argv[2] || "all";
const targets = arg === "all" ? Object.keys(JOBS) : [arg];

for (const name of targets) {
  const job = JOBS[name];
  if (!job) {
    console.error(`Unknown target "${name}". Options: ${Object.keys(JOBS).join(", ")}, all`);
    process.exit(1);
  }
  console.log(`Updating ${name}…`);
  try {
    const data = extractJSON(runClaude(job.prompt));
    if (!job.validate(data)) throw new Error("Response failed shape validation");
    writeFileSync(join(dataDir, job.file), JSON.stringify(data, null, 2) + "\n");
    console.log(`  ✔ wrote data/${job.file}`);
  } catch (err) {
    console.error(`  ✖ ${name} failed: ${err.message} — keeping previous data`);
  }
}

updateMeta();
console.log("Done. Refresh the site to see updates.");
