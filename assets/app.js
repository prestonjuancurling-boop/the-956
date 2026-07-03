/* The 956 — bilingual renderer. All content comes from data/*.json; any
   text field may have a `_es` twin, and the renderer falls back to English
   when one is missing, so partial translations never break the page.
   The automation pipeline only ever rewrites the JSON files. */

const $ = (sel) => document.querySelector(sel);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

let DATA = null;
let LANG = localStorage.getItem("the956-lang") || "en";

// Pick the Spanish twin of a field when available, else the English value.
const t = (obj, key) =>
  LANG === "es" && obj?.[key + "_es"] ? obj[key + "_es"] : obj?.[key];

const UI = {
  en: {
    "nav-events": "The Big 5",
    "nav-news": "Daily Rundown",
    "nav-fresh": "Fresh Plates",
    "nav-rank": "Power Rankings",
    "ov-events": "This week in el Valle",
    "h-events": "The Big <em>5</em>",
    "ov-news": "Fresh off the wire",
    "h-news": "The Daily Rundown",
    "ov-fresh": "New in town",
    "h-fresh": "Fresh Plates",
    "ov-rank": "Most-mentioned eats",
    "h-rank": "The 956 Power Rankings",
    "ov-micro": "This month's micro-ranking",
    microDrops: (d) => `⏳ Measuring this week — the first ranking drops ${d}`,
    "footer-curated": 'Curated from local sources including <a href="https://www.krgv.com/news" target="_blank" rel="noopener">KRGV</a>, <a href="https://www.valleycentral.com/" target="_blank" rel="noopener">ValleyCentral</a> and <a href="https://myrgv.com/" target="_blank" rel="noopener">MyRGV</a>.',
    "footer-updated": "Content refreshes automatically — last updated",
    weekPrefix: "Week of",
    free: "Free",
    statusOpen: "Now open",
    statusSoon: "Opening soon",
    bubble: "On the bubble",
    badge_new_entry: "🆕 New entry",
    badge_biggest_mover: "🔥 Biggest mover",
    streak: (n) => `👑 ${n} weeks at #1`,
    redditLabel: (n) => `${n} Reddit mention${n === 1 ? "" : "s"}`,
    reviewsLabel: (n) => `+${n} Google reviews`,
    mentionsLabel: (n) => `${n} mentions this month`,
    locale: "en-US",
  },
  es: {
    "nav-events": "Los 5 Grandes",
    "nav-news": "El Resumen",
    "nav-fresh": "Platos Nuevos",
    "nav-rank": "El Ranking",
    "ov-events": "Esta semana en el Valle",
    "h-events": "Los <em>5</em> Grandes",
    "ov-news": "Las últimas noticias",
    "h-news": "El Resumen del Día",
    "ov-fresh": "Recién llegados",
    "h-fresh": "Platos Nuevos",
    "ov-rank": "Los más mencionados",
    "h-rank": "El Ranking del 956",
    "ov-micro": "El micro-ranking del mes",
    microDrops: (d) => `⏳ Midiendo esta semana — el primer ranking sale el ${d}`,
    "footer-curated": 'Curado de fuentes locales como <a href="https://www.krgv.com/news" target="_blank" rel="noopener">KRGV</a>, <a href="https://www.valleycentral.com/" target="_blank" rel="noopener">ValleyCentral</a> y <a href="https://myrgv.com/" target="_blank" rel="noopener">MyRGV</a>.',
    "footer-updated": "El contenido se actualiza solo — última actualización",
    weekPrefix: "Semana del",
    free: "Gratis",
    statusOpen: "Ya abrió",
    statusSoon: "Próximamente",
    bubble: "A punto de entrar",
    badge_new_entry: "🆕 Nuevo en la lista",
    badge_biggest_mover: "🔥 El que más subió",
    streak: (n) => `👑 ${n} semanas en el #1`,
    redditLabel: (n) => `${n} mención${n === 1 ? "" : "es"} en Reddit`,
    reviewsLabel: (n) => `+${n} reseñas en Google`,
    mentionsLabel: (n) => `${n} menciones este mes`,
    locale: "es-MX",
  },
};

const ui = (k) => UI[LANG][k] ?? UI.en[k];

async function loadJSON(name) {
  const res = await fetch(`data/${name}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${name}.json (${res.status})`);
  return res.json();
}

function applyStatic() {
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-ui]").forEach((el) => {
    el.innerHTML = ui(el.dataset.ui);
  });
  document.querySelectorAll("#lang-toggle button").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === LANG);
  });
}

function renderMeta(meta) {
  $("#edition").textContent = meta.edition;
  $("#week-of").textContent = `${ui("weekPrefix")} ${t(meta, "week_of")}`;
  $("#tagline").textContent = t(meta, "tagline");

  const updated = new Date(meta.generated_at);
  $("#updated-at").textContent = updated.toLocaleString(ui("locale"), {
    weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });

  // Duplicate the ticker items so the loop never shows a gap.
  const items = [...t(meta, "ticker"), ...t(meta, "ticker")]
    .map((x) => `<span>${esc(x)}</span>`).join("");
  $("#ticker-track").innerHTML = items;
}

function renderEvents(data) {
  $('[data-note="events"]').textContent = t(data, "section_note");
  $("#event-list").innerHTML = data.events.map((e) => `
    <li class="event-card">
      <div class="event-num">${e.rank}</div>
      <div class="event-body">
        <h3>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}</h3>
        <div class="event-meta">
          <span class="chip date">${esc(t(e, "date"))}</span>
          <span class="chip city">${esc(e.city)}</span>
          <span class="chip">${esc(t(e, "time"))}</span>
          ${e.price ? `<span class="chip free">${esc(e.price === "Free" ? ui("free") : t(e, "price"))}</span>` : ""}
          ${e.tag ? `<span class="chip">${esc(t(e, "tag"))}</span>` : ""}
        </div>
        <p>${esc(t(e, "blurb"))}</p>
        <p class="event-venue">📍 ${esc(e.venue)}</p>
      </div>
    </li>`).join("");
  $("#also-happening").textContent = t(data, "also_happening") || "";
}

function renderNews(data) {
  $('[data-note="news"]').textContent = t(data, "section_note");
  $("#news-list").innerHTML = data.items.map((n) => `
    <article class="news-item">
      <div class="news-top">
        <span class="news-source">${esc(n.source)}</span>
        <span class="news-topic">${esc(t(n, "topic"))}</span>
        <span class="news-date">${esc(n.published)}</span>
      </div>
      <h3>${esc(t(n, "headline"))}</h3>
      <p>${esc(t(n, "summary"))}</p>
    </article>`).join("");
}

function renderRestaurants(data) {
  $('[data-note="restaurants"]').textContent = t(data, "section_note");
  $("#resto-grid").innerHTML = data.restaurants.map((r) => `
    <div class="resto-card${r.photo ? " has-photo" : ""}">
      ${r.photo ? `<div class="resto-photo"><img src="${esc(r.photo)}" alt="${esc(r.name)}" loading="lazy"></div>` : ""}
      <div class="resto-top">
        <div class="resto-emoji">${esc(r.emoji || "🍽️")}</div>
        <div>
          <div class="resto-name">${esc(r.name)}</div>
          <div class="resto-sub">${esc(t(r, "cuisine"))} · ${esc(r.city)}</div>
        </div>
      </div>
      <span class="badge ${r.status === "Now open" ? "open" : "soon"}">${esc(r.status === "Now open" ? ui("statusOpen") : ui("statusSoon"))}</span>
      <p>${esc(t(r, "blurb"))}</p>
    </div>`).join("");
}

function renderRankings(data) {
  $('[data-note="rankings"]').textContent = t(data, "section_note");
  const max = Math.max(...data.spots.map((s) => s.mentions));
  const arrows = { up: "▲", down: "▼", steady: "—" };
  const buzzLabel = (s) => {
    const parts = [];
    if (s.reddit_mentions != null) parts.push(ui("redditLabel")(s.reddit_mentions));
    if (s.review_delta != null) parts.push(ui("reviewsLabel")(s.review_delta));
    return parts.length ? parts.join(" · ") : ui("mentionsLabel")(s.mentions);
  };
  const badgesFor = (s) => {
    const chips = (s.badges ?? []).map((b) => ui("badge_" + b)).filter(Boolean);
    if (s.streak_weeks >= 2) chips.push(ui("streak")(s.streak_weeks));
    return chips.map((c) => `<span class="rank-badge">${esc(c)}</span>`).join("");
  };
  $("#rank-list").innerHTML = data.spots.map((s) => `
    <div class="rank-row">
      <div class="rank-pos">${s.rank}</div>
      <div>
        <div class="rank-name">${esc(s.name)} ${badgesFor(s)}</div>
        <div class="rank-city">${esc(s.city)}</div>
        <div class="rank-known">${esc(t(s, "known_for"))}</div>
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
        <span class="bubble-label">${esc(ui("bubble"))}</span>
        ${data.bubble.map((b) => esc(b.name)).join(" · ")}
      </div>`);
  }
  $("#rank-disclaimer").textContent = t(data, "disclaimer") || "";
}

function renderMicro(cat) {
  const section = $("#micro");
  if (!cat) { section.style.display = "none"; return; }
  section.style.display = "";
  $("#micro-title").textContent = t(cat, "title");
  $('[data-note="micro"]').textContent = t(cat, "note");

  if (cat.status === "measuring") {
    // The weekly scoring run lands on Mondays — show the real drop date.
    const next = new Date();
    next.setDate(next.getDate() + ((8 - next.getDay()) % 7 || 7));
    const dropDay = next.toLocaleDateString(ui("locale"), {
      weekday: "long", month: "long", day: "numeric",
    });
    $("#micro-card").innerHTML = `
      <div class="micro-status">${esc(ui("microDrops")(dropDay))}</div>
      <div class="micro-contenders">
        ${cat.spots.map((s) => `
          <div class="micro-contender">
            <div class="micro-q">?</div>
            <div>
              <div class="micro-name">${esc(s.name)}</div>
              <div class="micro-city">📍 ${esc(s.display_city)}</div>
              <div class="micro-known">${esc(t(s, "known_for"))}</div>
            </div>
          </div>`).join("")}
      </div>`;
  } else {
    const max = Math.max(...cat.spots.map((s) => s.mentions || 1));
    $("#micro-card").innerHTML = cat.spots.map((s) => `
      <div class="rank-row">
        <div class="rank-pos">${s.rank}</div>
        <div>
          <div class="rank-name">${esc(s.name)}</div>
          <div class="rank-city">${esc(s.display_city)}</div>
          <div class="rank-known">${esc(t(s, "known_for"))}</div>
        </div>
        <div class="buzz">
          <div class="buzz-bar"><div class="buzz-fill" style="width:${Math.round(((s.mentions || 0) / max) * 100)}%"></div></div>
        </div>
        <div class="trend steady"></div>
      </div>`).join("");
  }
}

function renderAll() {
  if (!DATA) return;
  applyStatic();
  renderMeta(DATA.meta);
  renderEvents(DATA.events);
  renderNews(DATA.news);
  renderRestaurants(DATA.restos);
  renderRankings(DATA.eats);
  renderMicro(DATA.category);
}

document.querySelectorAll("#lang-toggle button").forEach((b) => {
  b.addEventListener("click", () => {
    if (b.dataset.lang === LANG) return;
    LANG = b.dataset.lang;
    localStorage.setItem("the956-lang", LANG);
    renderAll();
  });
});

async function init() {
  try {
    const [meta, events, news, restos, eats, category] = await Promise.all([
      loadJSON("meta"), loadJSON("events"), loadJSON("news"),
      loadJSON("new-restaurants"), loadJSON("top-eats"),
      loadJSON("category").catch(() => null),
    ]);
    DATA = { meta, events, news, restos, eats, category };
    renderAll();
  } catch (err) {
    document.querySelector("main").innerHTML =
      `<p style="padding:48px 0;text-align:center;color:#a4610d">
        Couldn't load content (${esc(err.message)}). If you opened index.html directly,
        serve the folder instead — e.g. <code>npx serve</code> — so the data files can load.
      </p>`;
  }
}

init();
