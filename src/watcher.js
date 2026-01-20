// src/watcher.js
import puppeteer from "puppeteer-extra";
import RecaptchaPlugin from "puppeteer-extra-plugin-recaptcha";
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
  CAPTCHA_API_KEY,
  CAPTCHA_ENABLED,
  REMOTE_DEBUG_PORT,
} from "./config.js";

// Konfiguracja captcha solver (2Captcha)
if (CAPTCHA_ENABLED && CAPTCHA_API_KEY) {
  puppeteer.use(
    RecaptchaPlugin({
      provider: {
        id: "2captcha",
        token: CAPTCHA_API_KEY,
      },
      visualFeedback: true,
    })
  );
  console.log("[CAPTCHA] 2Captcha solver włączony");
}

import {
  prepare,
  getCommentCount,
  loadAllComments,
  extractCommentsData,
  switchCommentsFilterToNewest,
} from "./fb/comments.js";

import { loadCookies, saveCookies } from "./fb/cookies.js";
import { checkIfLogged, fbLogin, solveCaptchaIfPresent } from "./fb/login.js";
import { isCheckpoint, getCheckpointType } from "./fb/checkpoint.js";
import { parseFbRelativeTime, filterByAge } from "./utils/time.js";
import { loadCache, saveCache, getCacheSize, getCacheEntryCount } from "./db/cache.js";
import { sendTelegramLeads, sendOwnerAlert } from "./telegram.js";
import log from "./utils/logger.js";

/**
 * ŹRÓDŁO POSTÓW (PRIMARY): panel => data/posts.json
 * Fallback: Google Sheets CSV (POSTS_SHEET_URL)
 */
const POSTS_FILE =
  process.env.POSTS_FILE || path.join(process.cwd(), "data", "posts.json");

/**
 * CACHE DYSKOWY
 */
const commentsCache = loadCache();
const lastCounts = new Map();
const knownCommentsPerPost = new Map();

// Limity dla knownIds - zapobiega memory leak
const MAX_KNOWN_IDS_PER_POST = 1000;  // max komentarzy na post w pamięci
const KNOWN_IDS_TRIM_TO = 800;        // do ilu przycinać gdy przekroczy limit

for (const [url, entry] of Object.entries(commentsCache)) {
  if (typeof entry?.lastCount === "number") lastCounts.set(url, entry.lastCount);
  if (Array.isArray(entry?.knownIds)) {
    // Przytnij podczas ładowania jeśli za dużo
    const ids = entry.knownIds.slice(-MAX_KNOWN_IDS_PER_POST);
    knownCommentsPerPost.set(url, new Set(ids));
  }
}

let currentPosts = [];
let lastRefreshAny = 0;
let cycleNumber = 0;

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

// ================== TELEGRAM (FILTER AGE) ==================
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

  // log wieku komentarzy (tylko DEBUG)
  for (const c of normalized) {
    log.debug("TELEGRAM", `Komentarz ${c?.id}`, {
      ctx,
      author: c?.author || c?.name,
      rel: c?.fb_time_raw,
      ageMin: c?._ageMin,
    });
  }

  const fresh = filterByAge(normalized);
  const maxAge = Number(process.env.WEBHOOK_MAX_AGE_MIN || 60);

  log.dev("TELEGRAM", `Filtr wieku: ${normalized.length} → ${fresh.length}`, { ctx, maxAge });

  if (fresh.length > 0) {
    await sendTelegramLeads(post, fresh);
  } else {
    log.dev("TELEGRAM", "Brak świeżych komentarzy - nic nie wysyłam");
  }
}

/* ============================================================
   ===============   STEALTH / UKRYWANIE BOTA   ===============
   ============================================================ */

async function applyStealth(page) {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    window.chrome = window.chrome || { runtime: {} };
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, "languages", { get: () => ["pl-PL", "pl"] });

    const permissions = window.navigator.permissions;
    if (permissions && permissions.query) {
      const originalQuery = permissions.query.bind(permissions);
      permissions.query = (parameters) => {
        if (parameters && parameters.name === "notifications" && window.Notification) {
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
  if (!u) return "";
  const x = String(u).trim();
  if (!/^https?:\/\/.+/i.test(x)) return "";
  return x;
}

function makePostKey(url) {
  try {
    const u = new URL(String(url || "").trim());
    for (const k of Array.from(u.searchParams.keys())) {
      if (k.startsWith("__") || ["ref", "notif_id", "notif_t", "refid"].includes(k)) {
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
      return { ok: false, error: "posts.json ma zły format", posts: [], path: POSTS_FILE };
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
    log.warn("SHEET", "Pusty CSV z arkusza");
    return [];
  }

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idxUrl = header.findIndex((h) => h === "url");
  const idxActive = header.findIndex((h) => h === "active");
  const idxName = header.findIndex((h) => h === "name" || h === "nazwa");
  const idxImage = header.findIndex((h) => h === "image" || h === "img" || h === "photo" || h === "zdjecie");
  const idxDesc = header.findIndex((h) => h === "description" || h === "desc" || h === "opis");

  if (idxUrl === -1) {
    log.error("SHEET", "Brak kolumny 'url' w arkuszu");
    return [];
  }

  const posts = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(",");
    const rawUrl = (row[idxUrl] || "").trim();
    if (!rawUrl) continue;

    const activeRaw = idxActive !== -1 ? (row[idxActive] || "").trim() : "";
    const activeNorm = activeRaw.toLowerCase();
    const isActive = idxActive === -1 ? true : ["true", "1", "yes", "tak", "y"].includes(activeNorm);

    if (!isActive) continue;

    posts.push({
      id: `sheet-${i}`,
      url: rawUrl,
      name: idxName !== -1 ? (row[idxName] || "").trim() : "",
      image: idxImage !== -1 ? (row[idxImage] || "").trim() : "",
      description: idxDesc !== -1 ? (row[idxDesc] || "").trim() : "",
    });
  }

  return posts;
}

/* ============================================================
   ===============   POSTS FROM REMOTE API   ====================
   ============================================================ */

async function fetchPostsFromApi() {
  if (!POSTS_API_URL) return { ok: false, reason: "no-url" };

  log.dev("API", `Pobieram posty z: ${POSTS_API_URL}`);

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
      log.error("API", `Błąd HTTP: ${res.status} ${res.statusText}`);
      return { ok: false, reason: "http-error", status: res.status };
    }

    const data = await res.json();

    if (!data.ok || !Array.isArray(data.posts)) {
      log.error("API", "Nieprawidłowa odpowiedź (brak ok/posts)");
      return { ok: false, reason: "invalid-response" };
    }

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
    log.error("API", `Błąd pobierania postów: ${err.message}`);
    return { ok: false, reason: "fetch-error", error: err.message };
  }
}

/* ============================================================
   ===============   POSTS REFRESH   ===========================
   ============================================================ */

async function refreshPostsIfNeeded(force = false) {
  const now = Date.now();
  if (!force && now - lastRefreshAny < POSTS_REFRESH_MS) return;
  lastRefreshAny = now;

  // 1) PRIMARY: Remote API
  if (POSTS_API_URL) {
    const api = await fetchPostsFromApi();
    if (api.ok && api.posts.length > 0) {
      const newPosts = api.posts;
      const oldJson = JSON.stringify(currentPosts);
      const newJson = JSON.stringify(newPosts);

      if (oldJson !== newJson) {
        log.prod("API", `Załadowano ${newPosts.length} postów`, { total: api.total });
        currentPosts = newPosts;
      } else {
        log.dev("API", `Bez zmian (${newPosts.length} aktywnych)`);
      }
      return;
    }

    log.dev("API", `Fallback do lokalnego pliku (${api.reason || "unknown"})`);
  }

  // 2) SECONDARY: lokalny panel posts.json
  const panel = readPanelPosts();
  if (panel.ok && panel.posts.length > 0) {
    const newPosts = panel.posts;
    const oldJson = JSON.stringify(currentPosts);
    const newJson = JSON.stringify(newPosts);

    if (oldJson !== newJson) {
      log.prod("POSTS", `Załadowano ${newPosts.length} postów z pliku`, { total: panel.total });
      currentPosts = newPosts;
    } else {
      log.dev("POSTS", `Bez zmian (${newPosts.length} aktywnych)`);
    }
    return;
  }

  log.dev("POSTS", "Panel bez postów → fallback: Sheets");

  // 3) FALLBACK: Sheets
  if (!POSTS_SHEET_URL) {
    log.warn("SHEET", "POSTS_SHEET_URL nie ustawiony – brak źródła postów");
    currentPosts = [];
    return;
  }

  log.dev("SHEET", "Odświeżam listę postów z Google Sheets...");

  try {
    const res = await fetch(POSTS_SHEET_URL);
    if (!res.ok) {
      log.error("SHEET", `Błąd HTTP: ${res.status} ${res.statusText}`);
      currentPosts = [];
      return;
    }

    const csvText = await res.text();
    const newPosts = parseSheetCsv(csvText);

    if (!newPosts.length) {
      log.warn("SHEET", "Arkusz nie zwrócił aktywnych postów");
      currentPosts = [];
      return;
    }

    const oldJson = JSON.stringify(currentPosts);
    const newJson = JSON.stringify(newPosts);

    if (oldJson !== newJson) {
      log.prod("SHEET", `Załadowano ${newPosts.length} postów`);
      currentPosts = newPosts;
    } else {
      log.dev("SHEET", "Bez zmian");
    }
  } catch (err) {
    log.error("SHEET", `Błąd pobierania CSV: ${err.message}`);
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
    set = entry && Array.isArray(entry.knownIds) ? new Set(entry.knownIds) : new Set();
    knownCommentsPerPost.set(cacheKey, set);
  }
  return set;
}

/**
 * Przycina Set knownIds gdy przekroczy limit (FIFO - usuwa najstarsze).
 * Zapobiega memory leak przy długim działaniu.
 */
function cleanupKnownIds(set) {
  if (set.size <= MAX_KNOWN_IDS_PER_POST) return;

  const arr = Array.from(set);
  const toRemove = arr.slice(0, arr.length - KNOWN_IDS_TRIM_TO);
  for (const id of toRemove) {
    set.delete(id);
  }

  log.debug("CACHE", `Przycięto knownIds: ${arr.length} → ${set.size}`);
}


/**
 * Zwraca całkowitą liczbę knownIds w pamięci (dla monitoringu)
 */
function getTotalKnownIdsCount() {
  let total = 0;
  for (const set of knownCommentsPerPost.values()) {
    total += set.size;
  }
  return total;
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
  log.header("FB Comment Watcher");
  log.prod("WATCHER", `Start - interwał: ${Math.round(CHECK_INTERVAL_MS / 1000)}s`, {
    fastMode: FAST_MODE,
    logLevel: log.level,
  });

  const loop = async () => {
    let browser = null;
    let page = null;
    let hadNavErrorThisRound = false;
    const cycleStart = Date.now();
    cycleNumber++;
    let newCommentsTotal = 0;
    let errorsCount = 0;

    try {
      log.prod("WATCHER", `Cykl #${cycleNumber} start`, { posts: currentPosts.length });

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

      // Remote debugging - pozwala podłączyć się przez chrome://inspect
      if (REMOTE_DEBUG_PORT > 0) {
        args.push(`--remote-debugging-port=${REMOTE_DEBUG_PORT}`);
        args.push("--remote-debugging-address=127.0.0.1");
        log.prod("DEBUG", `Remote debugging na porcie ${REMOTE_DEBUG_PORT} - połącz przez: ssh -L ${REMOTE_DEBUG_PORT}:localhost:${REMOTE_DEBUG_PORT} user@server`);
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

      // === CHECKPOINT DETECTION (tylko alert) ===
      const checkpoint = await isCheckpoint(page);
      if (checkpoint) {
        const checkpointType = await getCheckpointType(page);
        log.warn("CHECKPOINT", `Wykryto checkpoint: ${checkpointType}`);

        // Próba rozwiązania captcha (jeśli to captcha, nie 2FA)
        if (CAPTCHA_ENABLED) {
          const captchaResult = await solveCaptchaIfPresent(page);
          if (captchaResult.solved) {
            log.success("CAPTCHA", "Captcha rozwiązana!");
            await new Promise(r => setTimeout(r, 2000));
            loggedIn = await checkIfLogged(page);
            if (!loggedIn) {
              await fbLogin(page);
              loggedIn = await checkIfLogged(page);
            }
          }
        }

        // Jeśli nadal nie zalogowany - alert i stop (lub czekaj przy remote debug)
        if (!loggedIn) {
          await sendOwnerAlert(
            "CHECKPOINT - Wymagana interwencja",
            `Facebook wymaga weryfikacji tożsamości.\n\n` +
            `Typ: ${checkpointType}\n\n` +
            `Wymagane działanie:\n` +
            `1. Zaloguj się ręcznie i zaktualizuj cookies.json\n` +
            `2. Zmień dane logowania w .env jeśli potrzeba\n` +
            `3. PM2 automatycznie wznowi pracę`
          );

          // Gdy remote debug - czekaj na ręczną interwencję zamiast wychodzić
          if (REMOTE_DEBUG_PORT > 0) {
            log.warn("CHECKPOINT", "=== REMOTE DEBUG MODE ===");
            log.warn("CHECKPOINT", "Przeglądarka czeka na ręczną interwencję.");
            log.warn("CHECKPOINT", "Zrób 2FA/checkpoint w chrome://inspect, potem naciśnij Ctrl+C i uruchom ponownie.");
            log.warn("CHECKPOINT", "Sprawdzam co 30s czy jesteś zalogowany...");

            // Czekaj w pętli aż użytkownik ręcznie rozwiąże checkpoint
            while (true) {
              await new Promise(r => setTimeout(r, 30000));
              const nowLogged = await checkIfLogged(page).catch(() => false);
              if (nowLogged) {
                log.success("CHECKPOINT", "Wykryto sesję! Zapisuję cookies i kontynuuję...");
                await saveCookies(page);
                loggedIn = true;
                break;
              }
              log.dev("CHECKPOINT", "Nadal brak sesji - czekam...");
            }
          } else {
            log.error("CHECKPOINT", "Wymagana interwencja - zatrzymuję proces");
            process.exit(1);
          }
        }
      }
      // === KONIEC CHECKPOINT DETECTION ===

      if (!loggedIn) {
        log.dev("LOGIN", "Brak sesji – logowanie...");
        await fbLogin(page);
        loggedIn = await checkIfLogged(page);

        // Sprawdź checkpoint po próbie logowania
        const checkpointAfterLogin = await isCheckpoint(page);
        if (checkpointAfterLogin) {
          const checkpointType = await getCheckpointType(page);
          log.warn("CHECKPOINT", `Checkpoint po logowaniu: ${checkpointType}`);

          await sendOwnerAlert(
            "CHECKPOINT po logowaniu",
            `Facebook wymaga weryfikacji po próbie logowania.\n\nTyp: ${checkpointType}`
          );

          // Gdy remote debug - czekaj na ręczną interwencję
          if (REMOTE_DEBUG_PORT > 0) {
            log.warn("CHECKPOINT", "=== REMOTE DEBUG MODE ===");
            log.warn("CHECKPOINT", "Zrób 2FA/checkpoint w chrome://inspect. Sprawdzam co 30s...");

            while (true) {
              await new Promise(r => setTimeout(r, 30000));
              const nowLogged = await checkIfLogged(page).catch(() => false);
              if (nowLogged) {
                log.success("CHECKPOINT", "Wykryto sesję! Zapisuję cookies i kontynuuję...");
                await saveCookies(page);
                loggedIn = true;
                break;
              }
              log.dev("CHECKPOINT", "Nadal brak sesji - czekam...");
            }
          } else {
            process.exit(1);
          }
        }

        if (loggedIn) {
          log.success("LOGIN", "Zalogowano pomyślnie");
          await saveCookies(page);
        } else {
          log.error("LOGIN", "Logowanie nieudane");
        }
      } else {
        log.dev("LOGIN", "Użyto istniejącej sesji");
      }

      // posts
      await refreshPostsIfNeeded(true);

      if (!currentPosts.length) {
        log.warn("WATCHER", "Brak aktywnych postów do monitorowania");
      } else {
        for (const post of currentPosts) {
          const cacheKey = getCacheKey(post);
          const postLabel = post.name || post.id.slice(0, 8);

          try {
            log.dev("NAV", `→ ${postLabel}`);
            await prepare(page, post.url);

            // ==================== FAST_MODE BRANCH ====================
            if (FAST_MODE) {
              const knownSet = getKnownSetForPost(cacheKey);
              const isFirstRun = !lastCounts.has(cacheKey);

              // 1. Przełącz na "Najnowsze"
              const switchResult = await switchCommentsFilterToNewest(page, post.url).catch(() => ({ ok: false }));

              if (!switchResult.ok) {
                log.dev("FAST", `${postLabel}: Fallback do normalnego trybu`, { reason: switchResult.reason });
              } else {
                await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));

                const snapshot = await extractCommentsData(page, post.url).catch(() => []);
                const sample = snapshot.slice(0, 30);

                log.dev("FAST", `${postLabel}: ${sample.length} komentarzy (sort=Najnowsze)`);

                // Inicjalizacja
                if (isFirstRun) {
                  lastCounts.set(cacheKey, sample.length);
                  for (const c of sample) if (c?.id) knownSet.add(c.id);
                  log.dev("FAST", `${postLabel}: Inicjalizacja - zapamiętano ${sample.length}`);
                  continue;
                }

                // Early skip
                if (sample.length > 0) {
                  const newestTime = sample[0]?.time || sample[0]?.fb_time_raw;
                  const newestAge = getCommentAgeMinutes(newestTime);

                  if (newestAge !== null && newestAge > FAST_MAX_AGE_MIN) {
                    log.dev("FAST", `${postLabel}: SKIP - najnowszy ${Math.round(newestAge)} min`, { limit: FAST_MAX_AGE_MIN });
                    continue;
                  }
                }

                // Dedup
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

                // Cleanup knownIds jeśli za dużo (zapobiega memory leak)
                cleanupKnownIds(knownSet);

                // Wysyłka
                if (newComments.length > 0) {
                  log.success("FAST", `${postLabel}: +${newComments.length} nowych`);
                  newCommentsTotal += newComments.length;

                  const safeComments = newComments.filter((c) => c.__postId === post.id);
                  if (safeComments.length !== newComments.length) {
                    log.warn("FAST", "Odfiltrowano komentarze spoza posta", {
                      before: newComments.length,
                      after: safeComments.length,
                    });
                  }
                  await sendTelegramIfFresh(post, safeComments, "fast");
                } else {
                  log.dev("FAST", `${postLabel}: Brak nowych`);
                }

                continue;
              }
            }
            // ==================== KONIEC FAST_MODE ====================

            const count = await getCommentCount(page, post.url);
            const hasCount = typeof count === "number" && Number.isFinite(count);

            if (!hasCount) {
              log.dev("WATCHER", `${postLabel}: Brak licznika - tryb awaryjny`);
            }

            const prev = lastCounts.has(cacheKey) ? lastCounts.get(cacheKey) : null;
            const knownSet = getKnownSetForPost(cacheKey);

            // Pierwsze wejście
            if (prev === null) {
              const initialCount = hasCount ? count : 0;
              lastCounts.set(cacheKey, initialCount);

              log.dev("WATCHER", `${postLabel}: Inicjalizacja (${initialCount} komentarzy)`);

              if (EXPAND_COMMENTS) {
                await loadAllComments(page, { expectedTotal: hasCount ? count : undefined }, post.url).catch(() => {});
                const snap = await extractCommentsData(page, post.url).catch(() => []);
                for (const c of snap) if (c?.id) knownSet.add(c.id);
                log.dev("WATCHER", `${postLabel}: Zapamiętano ${snap.length} istniejących`);
              }

              continue;
            }

            if (hasCount) {
              if (count !== prev) {
                log.dev("WATCHER", `${postLabel}: Zmiana ${prev} → ${count}`);
                lastCounts.set(cacheKey, count);
              } else {
                log.dev("WATCHER", `${postLabel}: Bez zmian (${count})`);
              }
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

            // Cleanup knownIds jeśli za dużo (zapobiega memory leak)
            cleanupKnownIds(knownSet);

            log.debug("DEDUP", `${postLabel}: context`, {
              snapshotLen: snapshot.length,
              newLen: newComments.length,
            });

            // Fallback
            if (hasCount && newComments.length === 0 && count > prev) {
              const diff = Math.max(1, count - prev);
              const tail = snapshot.slice(-diff);
              for (const c of tail) if (c?.id) knownSet.add(c.id);

              log.dev("WATCHER", `${postLabel}: Fallback - biorę ostatnie ${diff}`);
              await sendTelegramIfFresh(post, tail, "fallback");
              newCommentsTotal += tail.length;
              continue;
            }

            if (newComments.length > 0) {
              log.success("WATCHER", `${postLabel}: +${newComments.length} nowych`);
              newCommentsTotal += newComments.length;

              const safeComments = newComments.filter((c) => c.__postId === post.id);
              if (safeComments.length !== newComments.length) {
                log.warn("WATCHER", "Odfiltrowano komentarze spoza posta", {
                  before: newComments.length,
                  after: safeComments.length,
                });
              }
              await sendTelegramIfFresh(post, safeComments, "normal");
            }
          } catch (err) {
            errorsCount++;
            log.error("WATCHER", `Błąd przy ${postLabel}: ${err?.message || err}`);
            log.debug("WATCHER", "Stack", { stack: err?.stack });

            if (isNavigationError(err)) {
              hadNavErrorThisRound = true;
              navErrorCount++;
              log.warn("WATCHER", `Błąd nawigacji: ${navErrorCount}/${MAX_NAV_ERRORS}`);
            }
          }
        }
      }
    } catch (err) {
      errorsCount++;
      log.error("WATCHER", `Błąd w cyklu: ${err?.message || err}`);
    } finally {
      flushCacheToDisk();

      if (!hadNavErrorThisRound && navErrorCount > 0) {
        log.dev("WATCHER", `Reset licznika błędów nawigacji (było ${navErrorCount})`);
        navErrorCount = 0;
      }

      if (browser) {
        try {
          await browser.close();
          log.dev("WATCHER", "Zamknięto przeglądarkę");
        } catch (e) {
          log.warn("WATCHER", `Błąd zamykania przeglądarki: ${e?.message}`);
        }
      }

      const duration = Date.now() - cycleStart;
      const cacheSize = getCacheSize();
      const cacheEntries = getCacheEntryCount();
      const totalKnownIds = getTotalKnownIdsCount();

      log.cycleSummary({
        cycle: cycleNumber,
        posts: currentPosts.length,
        newComments: newCommentsTotal,
        duration,
        errors: errorsCount,
        cacheSize,
        cacheEntries,
        totalKnownIds,
      });

      // Alert jeśli cache przekroczył 10MB
      if (cacheSize > 10 * 1024 * 1024) {
        log.warn("CACHE", `Rozmiar cache przekroczył 10MB: ${Math.round(cacheSize / 1024 / 1024)}MB`);
      }

      if (navErrorCount >= MAX_NAV_ERRORS) {
        log.error("WATCHER", "Za dużo błędów nawigacji – kończę proces");
        process.exit(1);
      }

      const jitter = Math.floor(Math.random() * 5000);
      const delay = CHECK_INTERVAL_MS + jitter;
      log.dev("WATCHER", `Następny cykl za ${Math.round(delay / 1000)}s`);
      setTimeout(loop, delay);
    }
  };

  loop();
}

export { startWatcher };
