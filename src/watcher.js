// src/watcher.js
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import {
  EXPAND_COMMENTS,
  CHECK_INTERVAL_MS,
  POSTS_SHEET_URL,
  POSTS_REFRESH_MS,
  FAST_MODE,
  FAST_MAX_AGE_MIN,
  POSTS_API_URL,
  POSTS_API_TOKEN,
} from "./config.js";

import {
  prepare,
  getCommentCount,
  loadAllComments,
  extractCommentsData,
  switchCommentsFilterToNewest,
} from "./fb/comments.js";

import { loadCookies, saveCookies } from "./fb/cookies.js";
import { checkIfLogged, fbLogin } from "./fb/login.js";
import { sendWebhook, parseFbRelativeTime, filterByAge } from "./webhook.js";
import { loadCache, saveCache } from "./db/cache.js";
import { sendTelegramLeads } from "./telegram.js";

/**
 * ŹRÓDŁO POSTÓW (PRIMARY): panel => data/posts.json
 * Fallback: Google Sheets CSV (POSTS_SHEET_URL)
 *
 * Możesz nadpisać ścieżkę:
 * POSTS_FILE=/opt/fb-watcher/data/posts.json
 */
const POSTS_FILE =
  process.env.POSTS_FILE || path.join(process.cwd(), "data", "posts.json");

/**
 * CACHE DYSKOWY:
 * {
 *   "<url>": { lastCount: 29, knownIds: ["123","456"] }
 * }
 */
const commentsCache = loadCache();
const lastCounts = new Map(); // url -> lastCount
const knownCommentsPerPost = new Map(); // url -> Set(knownIds)

for (const [url, entry] of Object.entries(commentsCache)) {
  if (typeof entry?.lastCount === "number") lastCounts.set(url, entry.lastCount);
  if (Array.isArray(entry?.knownIds))
    knownCommentsPerPost.set(url, new Set(entry.knownIds));
}

let currentPosts = [];
let lastRefreshAny = 0;

let navErrorCount = 0;
const MAX_NAV_ERRORS = 5;

function isNavigationError(err) {
  if (!err) return false;
  const msg = String(err.message || err).toLowerCase();
  return (
    msg.includes("safegoto-failed") ||
    msg.includes("navigation timeout") ||
    msg.includes("net::err_connection_timed_out") ||
    msg.includes("net::err_timed_out")
  );
}

function envBool(name, def = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (raw === "") return def;
  return ["1", "true", "yes", "y", "tak", "on"].includes(raw);
}

// ================== FAST_MODE HELPER ==================
function getCommentAgeMinutes(timeStr) {
  if (!timeStr) return null;
  const abs = parseFbRelativeTime(timeStr);
  if (!abs) return null;
  return (Date.now() - abs.getTime()) / 60000;
}

// ================== TELEGRAM (FILTER AGE + AGE LOG) ==================
async function sendTelegramIfFresh(post, comments, ctx = "normal") {
  const list = Array.isArray(comments) ? comments : [];
  if (list.length === 0) return;

  const now = Date.now();

  const normalized = list.map((c) => {
    const rel = String(c?.fb_time_raw || c?.time || "").trim();
    const abs = parseFbRelativeTime(rel);
    const iso = abs ? abs.toISOString() : (c?.fb_time_iso || null);
    const ageMin = abs ? Math.round(((now - abs.getTime()) / 60000) * 10) / 10 : null;

    return {
      ...c,
      fb_time_raw: rel || null,
      fb_time_iso: iso,
      _ageMin: ageMin,
    };
  });

  // log wieku KAŻDEGO komentarza (szybki debug)
  for (const c of normalized) {
    console.log("[TG][AGE]", {
      ctx,
      id: c?.id || null,
      author: c?.author || c?.name || null,
      rel: c?.fb_time_raw || null,
      iso: c?.fb_time_iso || null,
      ageMin: c?._ageMin,
    });
  }

  const fresh = filterByAge(normalized);

  console.log("[TG] Filtr wieku komentarzy:", {
    ctx,
    before: normalized.length,
    after: fresh.length,
    maxAgeMin: Number(process.env.WEBHOOK_MAX_AGE_MIN || 60),
  });

  if (fresh.length > 0) {
    await sendTelegramLeads(post, fresh);
  } else {
    console.log("[TG] Brak świeżych komentarzy – nic nie wysyłam.");
  }
}
// =====================================================================

/* ============================================================
   ===============   STEALTH / UKRYWANIE BOTA   ===============
   ============================================================ */

async function applyStealth(page) {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    // @ts-ignore
    window.chrome = window.chrome || { runtime: {} };
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, "languages", { get: () => ["pl-PL", "pl"] });

    const permissions = window.navigator.permissions;
    if (permissions && permissions.query) {
      const originalQuery = permissions.query.bind(permissions);
      permissions.query = (parameters) => {
        if (
          parameters &&
          parameters.name === "notifications" &&
          window.Notification
        ) {
          return Promise.resolve({ state: window.Notification.permission });
        }
        return originalQuery(parameters);
      };
    }
  });
}

/* ============================================================
   ===============   PANEL POSTS (data/posts.json)   ===========
   ============================================================ */

function safeJsonParse(s) {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch (e) {
    return { ok: false, error: e?.message || "Invalid JSON" };
  }
}

function normalizeUrl(u) {

function makePostKey(url) {
  try {
    const u = new URL(String(url || "").trim());
    for (const k of Array.from(u.searchParams.keys())) {
      if (k.startsWith("__") || ["ref","notif_id","notif_t","refid"].includes(k)) {
        u.searchParams.delete(k);
      }
    }
    if (u.pathname.includes("permalink.php")) {
      const s = u.searchParams.get("story_fbid");
      const id = u.searchParams.get("id");
      if (s && id) return `permalink:${id}:${s}`;
    }
    if (u.pathname.includes("story.php")) {
      const s = u.searchParams.get("story_fbid");
      const id = u.searchParams.get("id");
      if (s && id) return `story:${id}:${s}`;
    }
    const mPosts = u.pathname.match(/\/posts\/([^/?#]+)/i);
    if (mPosts?.[1]) return `posts:${mPosts[1]}`;
    const v = u.searchParams.get("v");
    if (u.pathname.includes("/watch") && v) return `watch:${v}`;
    const mVid = u.pathname.match(/\/videos\/([^/?#]+)/i);
    if (mVid?.[1]) return `videos:${mVid[1]}`;
    const q = u.searchParams.toString();
    return `url:${u.host}${u.pathname}${q ? "?" + q : ""}`;
  } catch {
    return `url:${String(url || "").trim()}`;
  }
}

  if (!u) return "";
  const x = String(u).trim();
  if (!/^https?:\/\/.+/i.test(x)) return "";
  return x;
}

function readPanelPosts() {
  try {
    if (!fs.existsSync(POSTS_FILE)) {
      return { ok: false, error: "posts.json nie istnieje", posts: [], path: POSTS_FILE };
    }
    const raw = fs.readFileSync(POSTS_FILE, "utf8").trim();
    if (!raw) {
      return { ok: false, error: "posts.json jest pusty", posts: [], path: POSTS_FILE };
    }

    const parsed = safeJsonParse(raw);
    if (!parsed.ok || !Array.isArray(parsed.value)) {
      return { ok: false, error: "posts.json ma zły format (expected array)", posts: [], path: POSTS_FILE };
    }

    const posts = parsed.value
      .map((p) => {
        const url = normalizeUrl(p?.url);
        const active = Boolean(p?.active);
        if (!url) return null;
        return {
          id: String(p?.id || url),
          url,
          active,
          name: p?.name ? String(p.name) : "",
          image: p?.image ? String(p.image) : "",
          description: p?.description ? String(p.description) : "",
        };
      })
      .filter(Boolean);

    const activePosts = posts.filter((p) => p.active);
    return { ok: true, posts: activePosts, total: posts.length, path: POSTS_FILE };
  } catch (e) {
    return { ok: false, error: e?.message || "Błąd czytania posts.json", posts: [], path: POSTS_FILE };
  }
}

/* ============================================================
   ===============   GOOGLE SHEETS – PARSOWANIE   =============
   ============================================================ */

function parseSheetCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (!lines.length) {
    console.warn("[Sheet] Pusty CSV z arkusza.");
    return [];
  }

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());

  const idxUrl = header.findIndex((h) => h === "url");
  const idxActive = header.findIndex((h) => h === "active");

  const idxName = header.findIndex((h) => h === "name" || h === "nazwa");
  const idxImage = header.findIndex(
    (h) => h === "image" || h === "img" || h === "photo" || h === "zdjecie"
  );
  const idxDesc = header.findIndex(
    (h) => h === "description" || h === "desc" || h === "opis"
  );

  if (idxUrl === -1) {
    console.error('[Sheet] Brak kolumny "url" w arkuszu.');
    return [];
  }

  const posts = [];

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(",");
    const rawUrl = (row[idxUrl] || "").trim();
    if (!rawUrl) continue;

    const activeRaw = idxActive !== -1 ? (row[idxActive] || "").trim() : "";
    const activeNorm = activeRaw.toLowerCase();
    const isActive =
      idxActive === -1
        ? true
        : ["true", "1", "yes", "tak", "y"].includes(activeNorm);

    if (!isActive) continue;

    const name = idxName !== -1 ? (row[idxName] || "").trim() : "";
    const image = idxImage !== -1 ? (row[idxImage] || "").trim() : "";
    const description = idxDesc !== -1 ? (row[idxDesc] || "").trim() : "";

    posts.push({
      id: `sheet-${i}`,
      url: rawUrl,
      name,
      image,
      description,
    });
  }

  return posts;
}

/* ============================================================
   ===============   POSTS FROM REMOTE API   ====================
   ============================================================ */

async function fetchPostsFromApi() {
  if (!POSTS_API_URL) return { ok: false, reason: "no-url" };

  console.log(`[API] Pobieram posty z: ${POSTS_API_URL}`);

  try {
    const headers = { "Content-Type": "application/json" };
    if (POSTS_API_TOKEN) {
      headers["Authorization"] = `Bearer ${POSTS_API_TOKEN}`;
    }

    const res = await fetch(POSTS_API_URL, {
      method: "GET",
      headers,
      timeout: 10000,
    });

    if (!res.ok) {
      console.error(`[API] Błąd HTTP: ${res.status} ${res.statusText}`);
      return { ok: false, reason: "http-error", status: res.status };
    }

    const data = await res.json();

    if (!data.ok || !Array.isArray(data.posts)) {
      console.error("[API] Nieprawidłowa odpowiedź (brak ok/posts):", data);
      return { ok: false, reason: "invalid-response" };
    }

    // Filtruj tylko aktywne posty i normalizuj
    const posts = data.posts
      .filter((p) => p.active !== false)
      .map((p) => ({
        id: String(p.id || "").trim(),
        url: String(p.url || "").trim(),
        active: true,
        name: String(p.name || "").trim(),
        image: String(p.image || "").trim(),
        description: String(p.description || "").trim(),
      }))
      .filter((p) => p.url);

    return { ok: true, posts, total: data.posts.length };
  } catch (err) {
    console.error("[API] Błąd pobierania postów:", err.message);
    return { ok: false, reason: "fetch-error", error: err.message };
  }
}

/* ============================================================
   ===============   POSTS REFRESH (API -> PANEL -> SHEETS)   ==
   ============================================================ */

async function refreshPostsIfNeeded(force = false) {
  const now = Date.now();
  if (!force && now - lastRefreshAny < POSTS_REFRESH_MS) return;
  lastRefreshAny = now;

  // 1) PRIMARY: Remote API (panel na serwerze)
  if (POSTS_API_URL) {
    const api = await fetchPostsFromApi();
    if (api.ok && api.posts.length > 0) {
      const newPosts = api.posts;

      const oldJson = JSON.stringify(currentPosts);
      const newJson = JSON.stringify(newPosts);

      if (oldJson !== newJson) {
        console.log(
          `[Posts] Źródło: API (${POSTS_API_URL}) → aktywne: ${newPosts.length} (łącznie: ${api.total})`
        );
        currentPosts = newPosts;
      } else {
        console.log(`[Posts] API bez zmian (${newPosts.length} aktywnych).`);
      }
      return;
    }

    console.log(`[Posts] API nie dało postów (${api.reason || "unknown"}) → fallback: lokalny plik`);
  }

  // 2) SECONDARY: lokalny panel posts.json
  const panel = readPanelPosts();
  if (panel.ok && panel.posts.length > 0) {
    const newPosts = panel.posts;

    const oldJson = JSON.stringify(currentPosts);
    const newJson = JSON.stringify(newPosts);

    if (oldJson !== newJson) {
      console.log(
        `[Posts] Źródło: PANEL (${panel.path}) → aktywne: ${newPosts.length} (łącznie w pliku: ${panel.total})`
      );
      currentPosts = newPosts;
    } else {
      console.log(`[Posts] PANEL bez zmian (${newPosts.length} aktywnych).`);
    }
    return;
  }

  console.log(
    `[Posts] PANEL nie dał aktywnych postów (${panel.path}) → fallback: Sheets`
  );

  // 3) FALLBACK: Sheets
  if (!POSTS_SHEET_URL) {
    console.warn("[Sheet] POSTS_SHEET_URL nie ustawiony – brak źródła postów z arkusza.");
    currentPosts = [];
    return;
  }

  console.log("[Sheet] Odświeżam listę postów z Google Sheets...");

  try {
    const res = await fetch(POSTS_SHEET_URL);
    if (!res.ok) {
      console.error("[Sheet] Błąd HTTP przy pobieraniu CSV:", res.status, res.statusText);
      currentPosts = [];
      return;
    }

    const csvText = await res.text();
    const newPosts = parseSheetCsv(csvText);

    if (!newPosts.length) {
      console.warn("[Sheet] Arkusz nie zwrócił żadnych AKTYWNYCH postów (sprawdź active / TRUE).");
      currentPosts = [];
      return;
    }

    const oldJson = JSON.stringify(currentPosts);
    const newJson = JSON.stringify(newPosts);

    if (oldJson !== newJson) {
      console.log(`[Sheet] Lista postów zmieniona – było ${currentPosts.length}, teraz ${newPosts.length}.`);
      currentPosts = newPosts;
    } else {
      console.log("[Sheet] Lista postów bez zmian.");
    }
  } catch (err) {
    console.error("[Sheet] Błąd przy pobieraniu/parsowaniu CSV:", err.message);
    currentPosts = [];
  }
}

/* ============================================================
   =====================   CACHE HELPERS   =====================
   ============================================================ */

function getCacheKey(post) {
  return post.url;
}

function getKnownSetForPost(cacheKey) {
  let set = knownCommentsPerPost.get(cacheKey);
  if (!set) {
    const entry = commentsCache[cacheKey];
    set =
      entry && Array.isArray(entry.knownIds) ? new Set(entry.knownIds) : new Set();
    knownCommentsPerPost.set(cacheKey, set);
  }
  return set;
}

function flushCacheToDisk() {
  const out = { ...commentsCache };

  for (const [cacheKey, count] of lastCounts.entries()) {
    if (!out[cacheKey]) out[cacheKey] = { lastCount: 0, knownIds: [] };
    out[cacheKey].lastCount = count;
  }

  for (const [cacheKey, set] of knownCommentsPerPost.entries()) {
    if (!out[cacheKey]) out[cacheKey] = { lastCount: 0, knownIds: [] };
    out[cacheKey].knownIds = Array.from(set);
  }

  Object.keys(commentsCache).forEach((k) => delete commentsCache[k]);
  Object.assign(commentsCache, out);
  saveCache(out);
}

/* ============================================================
   =====================   GŁÓWNY WATCHER   ===================
   ============================================================ */

const isDev = process.env.NODE_ENV !== "production";

function getExecutablePath() {
  const p =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROME_PATH ||
    process.env.CHROMIUM_PATH ||
    "";
  return String(p || "").trim() || undefined;
}

async function startWatcher() {
  console.log(
    "[Watcher] Monitoring startuje. Sprawdzanie co",
    Math.round(CHECK_INTERVAL_MS / 1000),
    "sekund."
  );

  const loop = async () => {
    let browser = null;
    let page = null;
    let hadNavErrorThisRound = false;

    try {
      console.log("[Watcher] ==== Nowy cykl watchera – startuję świeżą przeglądarkę ====");

      const wantHeadless = envBool("HEADLESS_BROWSER", true);
      const headlessMode = wantHeadless ? (isDev ? true : "new") : false;

      const linux = process.platform === "linux";
      const executablePath = getExecutablePath();

      const args = [
        "--disable-notifications",
        "--disable-blink-features=AutomationControlled",
      ];

      if (linux) {
        args.push("--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage");
      }

      browser = await puppeteer.launch({
        headless: headlessMode,
        defaultViewport: null,
        executablePath,
        args,
        ignoreDefaultArgs: ["--enable-automation"],
      });

      page = await browser.newPage();
      await applyStealth(page);

      page.setDefaultNavigationTimeout(90000);
      page.setDefaultTimeout(90000);

      await page.setViewport({ width: 1280, height: 720 });

      // cookies + login
      await loadCookies(page);
      await page.goto("https://www.facebook.com/", { waitUntil: "load", timeout: 60000 }).catch(() => {});

      let loggedIn = await checkIfLogged(page);
      if (!loggedIn) {
        console.log("[FB] Brak aktywnej sesji – logowanie...");
        await fbLogin(page);
        loggedIn = await checkIfLogged(page);

        if (loggedIn) {
          console.log("[FB] Logowanie udane – zapisuję cookies.");
          await saveCookies(page);
        } else {
          console.error("[FB] Logowanie NIEUDANE – nie zapisuję cookies (prawdopodobnie 2FA nieukończone).");
        }
      } else {
        console.log("[FB] Użyto istniejącej sesji FB (cookies).");
      }

      // posts
      await refreshPostsIfNeeded(true);

      if (!currentPosts.length) {
        console.log("[Watcher] Brak aktywnych postów do monitorowania.");
      } else {
        for (const post of currentPosts) {
          const cacheKey = getCacheKey(post);

          try {
            await prepare(page, post.url);

            // ==================== FAST_MODE BRANCH ====================
            if (FAST_MODE) {
              const knownSet = getKnownSetForPost(cacheKey);
              const isFirstRun = !lastCounts.has(cacheKey);

              // 1. Próba przełączenia na "Najnowsze"
              const switchResult = await switchCommentsFilterToNewest(page, post.url).catch(() => ({ ok: false }));

              if (!switchResult.ok) {
                // FALLBACK: kontynuuj z normalnym flow dla tego posta
                console.log(`[FAST_MODE] Post ${post.id}: Fallback do normalnego trybu (switch failed: ${switchResult.reason || "unknown"})`);
                // nie robimy continue - przepada do normalnego flow poniżej
              } else {
                // 2. Czekaj na przeładowanie komentarzy po zmianie sortowania
                await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));

                // 3. Ekstrakcja BEZ loadAllComments - tylko co widać
                const snapshot = await extractCommentsData(page, post.url).catch(() => []);
                const sample = snapshot.slice(0, 30); // max 30 komentarzy

                console.log(`[FAST_MODE] Post ${post.id}: Pobrano ${sample.length} komentarzy (sort=Najnowsze)`);

                // 4. Pierwszy cykl - inicjalizacja cache
                if (isFirstRun) {
                  lastCounts.set(cacheKey, sample.length);
                  for (const c of sample) if (c?.id) knownSet.add(c.id);
                  console.log(`[FAST_MODE] Post ${post.id}: Inicjalizacja - zapamiętano ${sample.length} komentarzy.`);
                  continue;
                }

                // 5. Early skip - sprawdź najnowszy komentarz
                if (sample.length > 0) {
                  const newestTime = sample[0]?.time || sample[0]?.fb_time_raw;
                  const newestAge = getCommentAgeMinutes(newestTime);

                  if (newestAge !== null && newestAge > FAST_MAX_AGE_MIN) {
                    console.log(`[FAST_MODE] Post ${post.id}: SKIP - najnowszy komentarz ma ${Math.round(newestAge)} min (limit: ${FAST_MAX_AGE_MIN})`);
                    continue;
                  }
                }

                // 6. Dedup (TEN SAM mechanizm co normalny tryb)
                const newComments = [];
                for (const c of sample) {
                  if (!c?.id) continue;
                  if (!knownSet.has(c.id)) {
                    knownSet.add(c.id);
                    newComments.push(c);
                    c.__postId = post.id;
                    c.__postUrl = post.url;
                  }
                }

                // 7. Wysyłka (używa istniejących funkcji z filtrem wieku)
                if (newComments.length > 0) {
                  console.log(`[FAST_MODE] Post ${post.id}: ${newComments.length} nowych komentarzy`);
                  await sendWebhook(post, newComments, null, null);

                  const safeComments = newComments.filter((c) => c.__postId === post.id);
                  if (safeComments.length !== newComments.length) {
                    console.warn("[FAST_MODE][GUARD] Odfiltrowano komentarze spoza posta", {
                      postId: post.id,
                      before: newComments.length,
                      after: safeComments.length,
                    });
                  }
                  await sendTelegramIfFresh(post, safeComments, "fast");
                } else {
                  console.log(`[FAST_MODE] Post ${post.id}: Brak nowych komentarzy.`);
                }

                continue; // następny post (FAST_MODE zakończył przetwarzanie)
              }
            }
            // ==================== KONIEC FAST_MODE ====================

            const count = await getCommentCount(page, post.url);
            const hasCount = typeof count === "number" && Number.isFinite(count);

            if (!hasCount) {
              console.log(`[Watcher] Post ${post.id}: Nie udało się odczytać licznika -> tryb awaryjny (jadę po ID).`);
            }

            const prev = lastCounts.has(cacheKey) ? lastCounts.get(cacheKey) : null;
            const knownSet = getKnownSetForPost(cacheKey);

            // pierwsze wejście: zapamiętaj stan, nie wysyłaj
            if (prev === null) {
              const initialCount = hasCount ? count : 0;
              lastCounts.set(cacheKey, initialCount);

              console.log(
                hasCount
                  ? `[Watcher] Post ${post.id}: Startowa liczba komentarzy = ${initialCount}`
                  : `[Watcher] Post ${post.id}: Start (bez licznika) -> initialCount=0, zapamiętuję ID istniejących.`
              );

              if (EXPAND_COMMENTS) {
                await loadAllComments(page, { expectedTotal: hasCount ? count : undefined }, post.url).catch(() => {});
                const snap = await extractCommentsData(page, post.url).catch(() => []);
                for (const c of snap) if (c?.id) knownSet.add(c.id);
                console.log(`[Watcher] Post ${post.id}: Zapamiętano ${snap.length} istniejących komentarzy.`);
              } else {
                console.log(`[Watcher] Post ${post.id}: EXPAND_COMMENTS=false – pomijam ekstrakcję.`);
              }

              continue;
            }

            if (hasCount) {
              if (count !== prev) {
                console.log(`[Watcher] Post ${post.id}: Zmiana liczby komentarzy ${prev} -> ${count}`);
                lastCounts.set(cacheKey, count);
              } else {
                console.log(`[Watcher] Post ${post.id}: Bez zmian (${count} komentarzy).`);
              }
            } else {
              console.log(`[Watcher] Post ${post.id}: Brak licznika -> pomijam porównanie count, lecę po ID.`);
            }

            if (!EXPAND_COMMENTS) continue;

            await loadAllComments(page, { expectedTotal: hasCount ? count : undefined }).catch(() => {});
            const snapshot = await extractCommentsData(page, post.url).catch(() => []);

            const newComments = [];
            for (const c of snapshot) {
              if (!c?.id) continue;
              if (!knownSet.has(c.id)) {
                knownSet.add(c.id);
                newComments.push(c);
      c.__postId = post.id;
      c.__postUrl = post.url;
              }
            }

            
            // ===== DEBUG: sanity-check skąd są komentarze =====
            console.log("[DBG][POST_CTX]", {
              postId: post?.id || null,
              postUrl: post?.url || null,
              snapshotLen: Array.isArray(snapshot) ? snapshot.length : null,
              newLen: Array.isArray(newComments) ? newComments.length : null,
              sample: (Array.isArray(newComments) ? newComments.slice(0, 3) : []).map((c) => ({
                id: c?.id || null,
                author: c?.author || c?.name || null,
                time: c?.fb_time_raw || c?.time || null,
                // poniższe pola mogą istnieć albo nie — ale jak istnieją, to nam powiedzą prawdę:
                link: c?.link || c?.permalink || c?.url || null,
                postRef: c?.postUrl || c?.post_url || c?.post || null,
              })),
            });
            // ================================================
if (hasCount && newComments.length === 0 && count > prev) {
              const diff = Math.max(1, count - prev);
              const tail = snapshot.slice(-diff);
              for (const c of tail) if (c?.id) knownSet.add(c.id);

              console.log(`[Watcher] Post ${post.id}: Fallback — brak nowych ID, biorę ostatnie ${diff} jako nowe.`);
              await sendWebhook(post, tail, count, prev);

              await sendTelegramIfFresh(post, tail, "fallback");

              continue;
            }

            if (newComments.length > 0) {
              console.log(`[Watcher] Post ${post.id}: Znaleziono ${newComments.length} NOWYCH komentarzy.`);
              await sendWebhook(post, newComments, hasCount ? count : null, hasCount ? prev : null);




    const safeComments = newComments.filter(c => c.__postId === post.id);
    if (safeComments.length !== newComments.length) {
      console.warn("[WATCHER][GUARD] Odfiltrowano komentarze spoza posta", {
        postId: post.id,
        before: newComments.length,
        after: safeComments.length
      });
    }
                await sendTelegramIfFresh(post, safeComments, "normal");
            }
          } catch (err) {
            console.error(`[Watcher] Błąd przy sprawdzaniu ${post.id}:`, err?.message || err);
            if (err?.stack) console.error("[Watcher] Stack:", err.stack);

            if (isNavigationError(err)) {
              hadNavErrorThisRound = true;
              navErrorCount++;
              console.log(`[Watcher] Kolejny błąd nawigacji: ${navErrorCount}/${MAX_NAV_ERRORS}`);
            }
          }
        }
      }
    } catch (err) {
      console.error("[Watcher] Błąd w cyklu watchera:", err);
    } finally {
      flushCacheToDisk();

      if (!hadNavErrorThisRound && navErrorCount > 0) {
        console.log(`[Watcher] Runda bez błędów nawigacji – reset licznika (było ${navErrorCount}).`);
        navErrorCount = 0;
      }

      if (browser) {
        try {
          await browser.close();
          console.log("[Watcher] Zamknięto przeglądarkę po zakończeniu cyklu.");
        } catch (e) {
          console.log("[Watcher] Błąd zamykania przeglądarki:", e?.message || e);
        }
      }

      if (navErrorCount >= MAX_NAV_ERRORS) {
        console.error("[Watcher] Za dużo błędów nawigacji z rzędu – kończę proces.");
        process.exit(1);
      }

      const jitter = Math.floor(Math.random() * 5000);
      const delay = CHECK_INTERVAL_MS + jitter;
      console.log(`[Watcher] Kolejny cykl za około ${Math.round(delay / 1000)} sekund.`);
      setTimeout(loop, delay);
    }
  };

  loop();
}

export { startWatcher };
