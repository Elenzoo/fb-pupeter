// src/watcher.js
import puppeteer from "puppeteer";
import {
  EXPAND_COMMENTS,
  CHECK_INTERVAL_MS,
  POSTS_SHEET_URL,
  POSTS_REFRESH_MS,
} from "./config.js";

import {
  prepare,
  getCommentCount,
  loadAllComments,
  extractCommentsData,
} from "./fb/comments.js";

import { loadCookies, saveCookies } from "./fb/cookies.js";
import { checkIfLogged, fbLogin } from "./fb/login.js";
import { sendWebhook } from "./webhook.js";
import { loadCache, saveCache } from "./db/cache.js";

/**
 * CACHE DYSKOWY:
 * {
 *   "<url>": { lastCount: 29, knownIds: ["123","456"] }
 * }
 */
const commentsCache = loadCache();
const lastCounts = new Map();                // url -> lastCount
const knownCommentsPerPost = new Map();      // url -> Set(knownIds)

for (const [url, entry] of Object.entries(commentsCache)) {
  if (typeof entry?.lastCount === "number") lastCounts.set(url, entry.lastCount);
  if (Array.isArray(entry?.knownIds)) knownCommentsPerPost.set(url, new Set(entry.knownIds));
}

let currentPosts = [];
let lastSheetFetch = 0;

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
        if (parameters && parameters.name === "notifications" && window.Notification) {
          return Promise.resolve({ state: window.Notification.permission });
        }
        return originalQuery(parameters);
      };
    }
  });
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

  const header = lines[0].split(",");
  const idxUrl = header.findIndex((h) => h.trim().toLowerCase() === "url");
  const idxActive = header.findIndex((h) => h.trim().toLowerCase() === "active");

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
    const isActive = idxActive === -1 ? true : ["true", "1", "yes", "tak", "y"].includes(activeNorm);

    console.log(`[Sheet] Wiersz ${i}: url=${rawUrl}, activeRaw="${activeRaw}", isActive=${isActive}`);

    if (!isActive) continue;
    posts.push({ id: `sheet-${i}`, url: rawUrl });
  }

  return posts;
}

async function refreshPostsIfNeeded(force = false) {
  if (!POSTS_SHEET_URL) {
    console.warn("[Sheet] POSTS_SHEET_URL nie ustawiony – brak źródła postów z arkusza.");
    return;
  }

  const now = Date.now();
  if (!force && now - lastSheetFetch < POSTS_REFRESH_MS) return;

  lastSheetFetch = now;
  console.log("[Sheet] Odświeżam listę postów z Google Sheets...");

  try {
    const res = await fetch(POSTS_SHEET_URL);
    if (!res.ok) {
      console.error("[Sheet] Błąd HTTP przy pobieraniu CSV:", res.status, res.statusText);
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

async function startWatcher() {
  console.log("[Watcher] Monitoring startuje. Sprawdzanie co", Math.round(CHECK_INTERVAL_MS / 1000), "sekund.");

  const loop = async () => {
    let browser = null;
    let page = null;
    let hadNavErrorThisRound = false;

    try {
      console.log("[Watcher] ==== Nowy cykl watchera – startuję świeżą przeglądarkę ====");

      browser = await puppeteer.launch({
        headless: isDev ? true : "new",
        defaultViewport: null,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-notifications",
          "--disable-blink-features=AutomationControlled",
        ],
        ignoreDefaultArgs: ["--enable-automation"],
      });

      page = await browser.newPage();
      await applyStealth(page);

      page.setDefaultNavigationTimeout(90000);
      page.setDefaultTimeout(90000);

      await page.setViewport({ width: 1280, height: 720 });
// DISABLED UA // cookies + login
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
            // 🔥 KLUCZ: zawsze prepare przed liczeniem/scrollowaniem/ekstrakcją
            await prepare(page, post.url);

            const count = await getCommentCount(page, post.url);
            const hasCount = typeof count === "number" && Number.isFinite(count);

            if (!hasCount) {
              console.log(`[Watcher] Post ${post.id}: Nie udało się odczytać licznika -> tryb awaryjny (jadę po ID).`);
            }

            const prev = lastCounts.has(cacheKey) ? lastCounts.get(cacheKey) : null;
            const knownSet = getKnownSetForPost(cacheKey);

            // pierwsze wejście na posta: zapamiętaj stan, nie wysyłaj
            if (prev === null) {
              // jeśli nie mamy licznika: zapisujemy 0 jako "punkt startu" tylko po to,
              // żeby nie wchodzić w "prev === null" za każdym razem.
              const initialCount = hasCount ? count : 0;
              lastCounts.set(cacheKey, initialCount);

              console.log(
                hasCount
                  ? `[Watcher] Post ${post.id}: Startowa liczba komentarzy = ${initialCount}`
                  : `[Watcher] Post ${post.id}: Start (bez licznika) -> initialCount=0, zapamiętuję ID istniejących.`
              );

              if (EXPAND_COMMENTS) {
                await loadAllComments(
                  page,
                  { expectedTotal: hasCount ? count : undefined },
                  post.url
                ).catch(() => {});

                const snap = await extractCommentsData(page, post.url).catch(() => []);
                for (const c of snap) if (c?.id) knownSet.add(c.id);
                console.log(`[Watcher] Post ${post.id}: Zapamiętano ${snap.length} istniejących komentarzy.`);
              } else {
                console.log(`[Watcher] Post ${post.id}: EXPAND_COMMENTS=false – pomijam ekstrakcję.`);
              }

              continue;
            }

            // licznik: aktualizuj tylko jeśli mamy twarde dane
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

            await loadAllComments(
              page,
              { expectedTotal: hasCount ? count : undefined }
            ).catch(() => {});

            let snapshot = await extractCommentsData(page, post.url).catch(() => []);

            console.log(`[DBG] extractCommentsData – snapshot = ${snapshot.length}`);
            console.dir(snapshot.slice(0, 5), { depth: null });

            // nowe ID
            const newComments = [];
            for (const c of snapshot) {
              if (!c?.id) continue;
              if (!knownSet.has(c.id)) {
                knownSet.add(c.id);
                newComments.push(c);
              }
            }

            // fallback "tail" tylko jeśli mamy wiarygodny licznik i wzrost
            if (hasCount && newComments.length === 0 && count > prev) {
              const diff = Math.max(1, count - prev);
              const tail = snapshot.slice(-diff);
              for (const c of tail) if (c?.id) knownSet.add(c.id);

              console.log(`[Watcher] Post ${post.id}: Fallback — brak nowych ID, biorę ostatnie ${diff} jako nowe.`);
              await sendWebhook(post, tail, count, prev);
              continue;
            }

            if (newComments.length > 0) {
              console.log(`[Watcher] Post ${post.id}: Znaleziono ${newComments.length} NOWYCH komentarzy.`);
              // parametry webhooka: jeśli brak licznika, wysyłamy null (czytelne po stronie Make)
              await sendWebhook(post, newComments, hasCount ? count : null, hasCount ? prev : null);
            } else {
              console.log(`[Watcher] Post ${post.id}: Brak nowych komentarzy (po ID i fallbacku).`);
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
