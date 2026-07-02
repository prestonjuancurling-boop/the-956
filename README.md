# The 956 — El Valle's Weekly Digest

A local digest site for the Rio Grande Valley with four sections:

1. **The Big 5** — the week's biggest events
2. **The Daily Rundown** — local news
3. **Fresh Plates** — new & upcoming restaurants
4. **The 956 Power Rankings** — most-mentioned food spots

## How it works

The site is fully static. All content lives in `data/*.json`; the page
(`index.html` + `assets/app.js`) just renders whatever those files contain.
To update the site you only ever rewrite JSON — no code changes.

```
the-956/
├── index.html            # page shell
├── assets/
│   ├── style.css         # design
│   └── app.js            # fetches data/*.json and renders sections
├── data/
│   ├── meta.json         # edition, week range, ticker headlines
│   ├── events.json       # Big 5 events
│   ├── news.json         # daily rundown
│   ├── new-restaurants.json
│   └── top-eats.json     # power rankings
└── scripts/
    └── update-content.mjs  # the automation
```

## Run it locally

```
npx serve the-956
```

(or any static file server — it just needs to serve the folder over HTTP so
the JSON files can load.)

## Automating updates

`scripts/update-content.mjs` regenerates any section by running Claude Code
headless with web search, validating the JSON shape, and writing the file.
If a run fails validation, the previous data is kept — the site never breaks.

```
node scripts/update-content.mjs news          # daily
node scripts/update-content.mjs events        # weekly
node scripts/update-content.mjs restaurants   # weekly
node scripts/update-content.mjs rankings      # weekly
node scripts/update-content.mjs all
```

### Scheduling options

**A. Windows Task Scheduler (runs on this PC)**

```powershell
schtasks /Create /TN "The956-Daily"  /SC DAILY  /ST 06:30 /TR "node C:\path\to\the-956\scripts\update-content.mjs news"
schtasks /Create /TN "The956-Weekly" /SC WEEKLY /D MON /ST 06:00 /TR "node C:\path\to\the-956\scripts\update-content.mjs all"
```

**B. Claude Code scheduled tasks / routines** — ask Claude to "schedule a
daily task that updates the-956 news section" and it runs in the cloud
without your PC on.

**C. GitHub Actions + GitHub Pages (recommended for a public site)** — push
this folder to a repo, host it free on Pages, and add a workflow with
`schedule: cron` that runs the updater (via the Claude Agent SDK with an API
key) and commits the new JSON. Fully hands-off: the site updates itself
daily/weekly with no computer involved.

### Making it more deterministic later

The LLM-with-web-search approach is the fastest way to automate all four
sections. For higher reliability you can swap individual sections to
structured sources without touching the site:

- **Events** — Eventbrite/Ticketmaster APIs + city parks & rec calendars
- **News** — RSS feeds (KRGV, ValleyCentral, MyRGV) summarized per item
- **Restaurants** — Google Places API "newly opened" queries
- **Rankings** — Google Places / Yelp APIs for review-count deltas, plus
  Reddit API mention counts for real "times mentioned" data
