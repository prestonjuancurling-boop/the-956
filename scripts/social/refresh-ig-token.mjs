#!/usr/bin/env node
/**
 * Refreshes the long-lived Instagram token before it expires. Instagram
 * long-lived tokens last 60 days and can be refreshed any time after the
 * first 24 hours — refresh well before expiry (this repo's monthly
 * category-rotation task calls this each run, which is a safe ~30-day
 * cadence, comfortably inside the 60-day window).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const tokenPath = join(homedir(), ".the956-ig-token");
const { access_token } = JSON.parse(readFileSync(tokenPath, "utf8"));

const url = new URL("https://graph.instagram.com/refresh_access_token");
url.searchParams.set("grant_type", "ig_refresh_token");
url.searchParams.set("access_token", access_token);

const res = await fetch(url);
const body = await res.json();
if (!res.ok || !body.access_token) {
  console.error("Refresh failed:", JSON.stringify(body));
  console.error("The token may have already expired — it will need to be regenerated via the full OAuth flow.");
  process.exit(1);
}

writeFileSync(
  tokenPath,
  JSON.stringify({ access_token: body.access_token, obtained_at: new Date().toISOString(), expires_in: body.expires_in }, null, 2)
);
console.log(`Refreshed. New token valid for ~${Math.round(body.expires_in / 86400)} days.`);
