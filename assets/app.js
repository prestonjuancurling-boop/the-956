/* The 956 — renders all sections from data/*.json.
   The automation pipeline only ever rewrites the JSON files;
   this file and the HTML/CSS never need to change. */

const $ = (sel) => document.querySelector(sel);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

async function loadJSON(name) {
  const res = await fetch(`data/${name}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${name}.json (${res.status})`);
  return res.json();
}

function renderMeta(meta) {
  $("#edition").textContent = meta.edition;
  $("#week-of").textContent = `Week of ${meta.week_of}`;
  $("#tagline").textContent = meta.tagline;

  const updated = new Date(meta.generated_at);
  $("#updated-at").textContent = updated.toLocaleString("en-US", {
    weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });

  // Duplicate the ticker items so the loop never shows a gap.
  const items = [...meta.ticker, ...meta.ticker]
    .map((t) => `<span>${esc(t)}</span>`).join("");
  $("#ticker-track").innerHTML = items;
}

function renderEvents(data) {
  $('[data-note="events"]').textContent = data.section_note;
  $("#event-list").innerHTML = data.events.map((e) => `
    <li class="event-card">
      <div class="event-num">${e.rank}</div>
      <div class="event-body">
        <h3>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}</h3>
        <div class="event-meta">
          <span class="chip date">${esc(e.date)}</span>
          <span class="chip city">${esc(e.city)}</span>
          <span class="chip">${esc(e.time)}</span>
          ${e.price ? `<span class="chip free">${esc(e.price)}</span>` : ""}
          ${e.tag ? `<span class="chip">${esc(e.tag)}</span>` : ""}
        </div>
        <p>${esc(e.blurb)}</p>
        <p class="event-venue">📍 ${esc(e.venue)}</p>
      </div>
    </li>`).join("");
  $("#also-happening").textContent = data.also_happening || "";
}

function renderNews(data) {
  $('[data-note="news"]').textContent = data.section_note;
  $("#news-list").innerHTML = data.items.map((n) => `
    <article class="news-item">
      <div class="news-top">
        <span class="news-source">${esc(n.source)}</span>
        <span class="news-topic">${esc(n.topic)}</span>
        <span class="news-date">${esc(n.published)}</span>
      </div>
      <h3>${esc(n.headline)}</h3>
      <p>${esc(n.summary)}</p>
    </article>`).join("");
}

function renderRestaurants(data) {
  $('[data-note="restaurants"]').textContent = data.section_note;
  $("#resto-grid").innerHTML = data.restaurants.map((r) => `
    <div class="resto-card${r.photo ? " has-photo" : ""}">
      ${r.photo ? `<div class="resto-photo"><img src="${esc(r.photo)}" alt="${esc(r.name)}" loading="lazy"></div>` : ""}
      <div class="resto-top">
        <div class="resto-emoji">${esc(r.emoji || "🍽️")}</div>
        <div>
          <div class="resto-name">${esc(r.name)}</div>
          <div class="resto-sub">${esc(r.cuisine)} · ${esc(r.city)}</div>
        </div>
      </div>
      <span class="badge ${r.status === "Now open" ? "open" : "soon"}">${esc(r.status)}</span>
      <p>${esc(r.blurb)}</p>
    </div>`).join("");
}

function renderRankings(data) {
  $('[data-note="rankings"]').textContent = data.section_note;
  const max = Math.max(...data.spots.map((s) => s.mentions));
  const arrows = { up: "▲", down: "▼", steady: "—" };
  const buzzLabel = (s) => {
    const parts = [];
    if (s.reddit_mentions != null) parts.push(`${s.reddit_mentions} Reddit mention${s.reddit_mentions === 1 ? "" : "s"}`);
    if (s.review_delta != null) parts.push(`+${s.review_delta} Google reviews`);
    return parts.length ? parts.join(" · ") : `${s.mentions} mentions this month`;
  };
  const badgeLabels = { new_entry: "🆕 New entry", biggest_mover: "🔥 Biggest mover" };
  const badgesFor = (s) => {
    const chips = (s.badges ?? []).map((b) => badgeLabels[b]).filter(Boolean);
    if (s.streak_weeks >= 2) chips.push(`👑 ${s.streak_weeks} weeks at #1`);
    return chips.map((c) => `<span class="rank-badge">${esc(c)}</span>`).join("");
  };
  $("#rank-list").innerHTML = data.spots.map((s) => `
    <div class="rank-row">
      <div class="rank-pos">${s.rank}</div>
      <div>
        <div class="rank-name">${esc(s.name)} ${badgesFor(s)}</div>
        <div class="rank-city">${esc(s.city)}</div>
        <div class="rank-known">${esc(s.known_for)}</div>
      </div>
      <div class="buzz">
        <div class="buzz-bar"><div class="buzz-fill" style="width:${Math.round((s.mentions / max) * 100)}%"></div></div>
        <div class="buzz-label">${esc(buzzLabel(s))}</div>
      </div>
      <div class="trend ${esc(s.trend)}">${arrows[s.trend] || "—"}</div>
    </div>`).join("");
  if (data.bubble?.length) {
    $("#rank-list").insertAdjacentHTML("beforeend", `
      <div class="bubble-row">
        <span class="bubble-label">On the bubble</span>
        ${data.bubble.map((b) => esc(b.name)).join(" · ")}
      </div>`);
  }
  $("#rank-disclaimer").textContent = data.disclaimer || "";
}

async function init() {
  try {
    const [meta, events, news, restos, eats] = await Promise.all([
      loadJSON("meta"), loadJSON("events"), loadJSON("news"),
      loadJSON("new-restaurants"), loadJSON("top-eats"),
    ]);
    renderMeta(meta);
    renderEvents(events);
    renderNews(news);
    renderRestaurants(restos);
    renderRankings(eats);
  } catch (err) {
    document.querySelector("main").innerHTML =
      `<p style="padding:48px 0;text-align:center;color:#a4610d">
        Couldn't load content (${esc(err.message)}). If you opened index.html directly,
        serve the folder instead — e.g. <code>npx serve</code> — so the data files can load.
      </p>`;
  }
}

init();
