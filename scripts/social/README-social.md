# Social publishing

Scripts to actually post The 956's weekly carousels to Instagram (@the956rgv)
and Facebook (the956 Page) via their real APIs, instead of manual upload.

## Credentials

Two long-lived tokens live **outside this repo**, never committed:

- `~/.the956-ig-token` — Instagram long-lived user token. Expires in 60 days;
  `refresh-ig-token.mjs` extends it (safe to run anytime after the first 24h).
- `~/.the956-fb-page-token` — Facebook Page access token. Derived from a
  long-lived user token, effectively non-expiring as long as the granting
  user (Preston) stays an admin and doesn't revoke the app.

If either file is ever lost, they must be regenerated via the full OAuth
consent flow (dashboard-generated tokens are NOT eligible for the long-lived
exchange — this was the whole fight to get working on 2026-07-13). See the
Meta app "Claude" (App ID 1563544178720675 for Facebook, Instagram App ID
1592789142570445) — both already have the redirect URI
`https://the956.com/oauth-callback.html` registered.

## Scripts

- `host-images.mjs` — shared helper. Both APIs require images at a public
  HTTPS URL, not local files, so this copies the chosen PNGs into
  `assets/social-posts/<slug>/`, commits, pushes, and waits for the Pages
  deploy before returning the live URLs.
- `ig-publish.mjs <folder> <caption-file> <file1> <file2> ...` — publishes
  an Instagram carousel (2+ images) immediately. Instagram's API has no
  future-scheduling — this always posts live the moment it runs.
- `fb-publish.mjs <folder> <caption-file> <when> <file1> [file2 ...]` —
  posts (or genuinely schedules, via `<when>` as an ISO datetime at least
  10 minutes out, or `"now"`) a multi-photo post to the Facebook Page.
- `refresh-ig-token.mjs` — extends the Instagram token; call periodically
  (the monthly category-rotation task does this each run, a safe ~30-day
  cadence well inside the 60-day window).
- `stories-publish.mjs <folder> <file.png>` — publishes a single image to
  @the956rgv's Instagram Story. No caption field (bake text into the image);
  no future-scheduling (Instagram Stories always publish immediately, and
  expire after 24h).
- `make-tiktok-video.mjs <folder> <out.mp4> <file1> [file2 ...] [--duration=N]`
  — stitches carousel/story PNGs into a 1080x1920 slideshow video (each
  image padded onto a blurred copy of itself so any source aspect ratio
  fills the frame). Requires ffmpeg on PATH. Does NOT publish anywhere —
  TikTok's Content Posting API needs app review before public posting is
  allowed, so this just produces the .mp4 for manual upload for now.

## The approval model — important

**Nothing here runs unattended.** These scripts are never called from an
autonomous scheduled task. The weekly flow is:

1. Monday morning, `the956-monday-publish` renders the week's carousels and
   reports them in chat (as it already did before this existed).
2. The user reviews and replies with something like "post these."
3. Only then does a live session actually invoke `ig-publish.mjs` /
   `fb-publish.mjs` for that specific, just-approved content.

This is deliberate: posting to a public account on the user's behalf always
gets a specific go-ahead first, not a standing blanket approval.
