#!/usr/bin/env node
/**
 * The 956 Friday Night Rankings — Elo engine.
 *
 * Recomputes every team's rating from scratch off the full game log in
 * data/football.json, so it is deterministic and safe to re-run anytime:
 * fixing a mistyped score and re-running produces the correct season state.
 *
 * The model, in plain English:
 *   - Every team starts at a seed rating based on classification only
 *     (bigger schools start slightly higher; the games take over from there).
 *   - After each game, rating points move from loser to winner. Beating a
 *     stronger team moves more points than beating a weaker one.
 *   - Margin of victory matters, with diminishing returns (a 50-point
 *     blowout is not 10x a 5-point win), using the log-margin curve
 *     popularized by FiveThirtyEight's NFL Elo.
 *   - Home field is worth 65 rating points (set neutral: true on a game
 *     to disable it).
 *
 * The published Top 10 includes RGV teams only; non-RGV district opponents
 * (Corpus Christi, Laredo, etc.) are rated so wins against them count, but
 * they never appear in the ranking.
 *
 * No network access, no credentials — pure math over the JSON.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Optional path argument makes the engine testable against a scratch copy:
//   node scripts/compute-football.mjs /tmp/football-test.json
const path = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..", "data", "football.json");
const data = JSON.parse(readFileSync(path, "utf8"));

// Seed ratings by classification — a size prior, nothing more.
const SEEDS = { "6A": 1550, "5A DI": 1520, "5A DII": 1490, "4A DI": 1460, "4A DII": 1430 };
const K = 32;
const HOME_ADVANTAGE = 65;

const districtById = Object.fromEntries(data.districts.map((d) => [d.id, d]));
const teams = new Map();
for (const t of data.teams) {
  const cls = districtById[t.district]?.classification;
  if (!cls || !(cls in SEEDS)) {
    console.error(`Team ${t.id} has unknown district/classification: ${t.district}`);
    process.exit(1);
  }
  teams.set(t.id, { ...t, rating: SEEDS[cls], wins: 0, losses: 0 });
}

// ————— replay the season —————

const played = (data.games ?? []).filter(
  (g) => Number.isInteger(g.home_score) && Number.isInteger(g.away_score)
);
played.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

let bad = 0;
for (const g of played) {
  const home = teams.get(g.home);
  const away = teams.get(g.away);
  if (!home || !away) {
    console.warn(`Skipping game with unknown team id: ${g.home} vs ${g.away} (${g.date})`);
    bad++;
    continue;
  }
  if (g.home_score === g.away_score) {
    console.warn(`Skipping tie score ${g.home} ${g.home_score}-${g.away_score} ${g.away} — varsity games can't tie; check the entry.`);
    bad++;
    continue;
  }

  const hfa = g.neutral ? 0 : HOME_ADVANTAGE;
  const expectedHome = 1 / (1 + 10 ** ((away.rating - (home.rating + hfa)) / 400));
  const homeWon = g.home_score > g.away_score;
  const margin = Math.abs(g.home_score - g.away_score);
  const winnerElo = homeWon ? home.rating + hfa : away.rating;
  const loserElo = homeWon ? away.rating : home.rating + hfa;
  // Log-margin multiplier with a brake when the favorite wins big (autocorrelation guard).
  const mov = Math.log(margin + 1) * (2.2 / ((winnerElo - loserElo) * 0.001 + 2.2));

  const delta = K * mov * ((homeWon ? 1 : 0) - expectedHome);
  home.rating += delta;
  away.rating -= delta;
  (homeWon ? home : away).wins++;
  (homeWon ? away : home).losses++;
}

console.log(`Replayed ${played.length - bad} completed games (${bad} skipped).`);

// ————— publish —————

if (played.length - bad === 0) {
  console.log("No completed games — season not started; leaving rankings untouched (preseason).");
  process.exit(0);
}

const prevRank = Object.fromEntries((data.rankings ?? []).map((r) => [r.id, r.rank]));
const prevStreak = data.rankings?.[0]?.streak_weeks ?? 0;
const prevTopId = data.rankings?.[0]?.id;
const prevWeek = data.week ?? 0;
const newWeek = Math.max(0, ...played.map((g) => g.week ?? 0));

const ranked = [...teams.values()]
  .filter((t) => t.rgv && t.wins + t.losses > 0) // must have taken the field to be ranked
  .sort((a, b) => b.rating - a.rating)
  .slice(0, 10);

// Biggest positive rank jump among returning teams (≥ 2 spots).
let moverId = null, moverJump = 1;
ranked.forEach((t, i) => {
  const was = prevRank[t.id];
  if (was != null && was - (i + 1) > moverJump) {
    moverJump = was - (i + 1);
    moverId = t.id;
  }
});

data.rankings = ranked.map((t, i) => {
  const rank = i + 1;
  const was = prevRank[t.id];
  const badges = [];
  if (was == null && Object.keys(prevRank).length > 0) badges.push("new_entry");
  if (t.id === moverId) badges.push("biggest_mover");
  const entry = {
    rank,
    id: t.id,
    name: t.name,
    short: t.short,
    district: t.district,
    classification: districtById[t.district].classification,
    record: `${t.wins}-${t.losses}`,
    rating: Math.round(t.rating),
    trend: was == null ? "steady" : was > rank ? "up" : was < rank ? "down" : "steady",
    badges,
  };
  if (rank === 1) {
    // Streak advances only when the week advances — a same-week re-run
    // (e.g. correcting a typo'd score) must not inflate it.
    entry.streak_weeks =
      prevTopId === t.id ? (newWeek > prevWeek ? prevStreak + 1 : Math.max(prevStreak, 1)) : 1;
  }
  return entry;
});

data.status = "live";
data.week = newWeek;
data.computed_at = new Date().toISOString();

writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
console.log(`✔ Published Week ${data.week} rankings — #1 is ${data.rankings[0].name} (${data.rankings[0].record}, ${data.rankings[0].rating})`);
