// src/watcher.js
import puppeteer from "puppeteer";
import {
  EXPAND_COMMENTS,
  CHECK_INTERVAL_MS,
  POSTS_SHEET_URL,
  POSTS_REFRESH_MS,
} from "./config.js";
import {
  expandAllComments,
  extractCommentsData,
  getCommentCount,
} from "./fb/comments.js";
import { loadCookies, saveCookies } from "./fb/cookies.js";
import { checkIfLogged, fbLogin } from "./fb/login.js";
import { sendWebhook } from "./webhook.js";
import { loadCache, saveCache } from "./db/cache.js";

/**
 * CACHE DYSKOWY
 * Struktura w pliku:
 * {
 *   "https://facebook.com/link1": { lastCount: 29, knownIds: ["123","456"] },
 *   "https://facebook.com/link2": { lastCount: 57, knownIds: ["abc","def"] }
 * }
 */
const commentsCache = loadCache();

/**
 * Mapa: cacheKey (URL) -> ostatnio znany licznik komentarzy.
 */
const lastCounts = new Map();
/**
 * Mapa: cacheKey (URL) -> zestaw znanych ID komentarzy (żeby odróżniać stare od nowych).
 */
const knownCommentsPerPost = new Map();

/**
 * Na starcie ładujemy do map to, co jest w JSON-ie.
 */
for (const [url, entry] of Object.entries(commentsCache)) {
  if (typeof entry.lastCount === "number") {
    lastCounts.set(url, entry.lastCount);
  }
  if (Array.isArray(entry.knownIds)) {
    knownCommentsPerPost.set(url, new Set(entry.knownIds));
  }
}

/**
 * Aktualna lista postów (z arkusza).
 * Każdy element: { id, url }
 */
let currentPosts = [];
let lastSheetFetch = 0;

// Licznik błędów nawigacji – jak coś się mocno przytnie, wywalamy proces
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
    Object.defineProperty(navigator, "webdriver", {
      get: () => false,
    });

    // @ts-ignore
    window.chrome = window.chrome || { runtime: {} };

    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3],
    });

    Object.defineProperty(navigator, "languages", {
      get: () => ["pl-PL", "pl"],
    });

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
   ===============   GOOGLE SHEETS – PARSOWANIE   =============
   ============================================================ */

/**
 * Parsuje CSV z Google Sheets.
 * Wymagane kolumny:
 *  - "url"
 *  - "active" (TRUE/FALSE) – aktywny jest TYLKO wiersz z TRUE
 */
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
  const idxActive = header.findIndex(
    (h) => h.trim().toLowerCase() === "active"
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

    let activeRaw = "";
    if (idxActive !== -1) {
      activeRaw = (row[idxActive] || "").trim();
    }

    const activeNorm = activeRaw.toLowerCase();

    const isActive =
      idxActive === -1
        ? true
        : ["true", "1", "yes", "tak", "y"].includes(activeNorm);

    console.log(
      `[Sheet] Wiersz ${i}: url=${rawUrl}, activeRaw="${activeRaw}", isActive=${isActive}`
    );

    if (!isActive) continue;

    posts.push({
      id: `sheet-${i}`,
      url: rawUrl,
    });
  }

  return posts;
}

/**
 * Odświeża listę postów z Google Sheets co POSTS_REFRESH_MS.
 * Jeśli lista się zmieni → zerujemy TYLKO mapy w pamięci.
 * JSON na dysku zostaje – pamięta historię.
 */
async function refreshPostsIfNeeded(force = false) {
  if (!POSTS_SHEET_URL) {
    console.warn(
      "[Sheet] POSTS_SHEET_URL nie ustawiony – brak źródła postów z arkusza."
    );
    return;
  }

  const now = Date.now();
  if (!force && now - lastSheetFetch < POSTS_REFRESH_MS) {
    return;
  }

  lastSheetFetch = now;

  console.log("[Sheet] Odświeżam listę postów z Google Sheets...");

  try {
    const res = await fetch(POSTS_SHEET_URL);
    if (!res.ok) {
      console.error(
        "[Sheet] Błąd HTTP przy pobieraniu CSV:",
        res.status,
        res.statusText
      );
      return;
    }

    const csvText = await res.text();
    const newPosts = parseSheetCsv(csvText);

    if (!newPosts.length) {
      console.warn(
        "[Sheet] Arkusz nie zwrócił żadnych AKTYWNYCH postów (sprawdź kolumnę active / TRUE)."
      );
      currentPosts = [];
      // ważne: NIE czyścimy commentsCache na dysku
      lastCounts.clear();
      knownCommentsPerPost.clear();
      return;
    }

    const oldJson = JSON.stringify(currentPosts);
    const newJson = JSON.stringify(newPosts);

    if (oldJson !== newJson) {
      console.log(
        `[Sheet] Lista postów zmieniona – było ${currentPosts.length}, teraz ${newPosts.length}. Resetuję mapy w pamięci.`
      );
      currentPosts = newPosts;
      lastCounts.clear();
      knownCommentsPerPost.clear();

      // po wyczyszczeniu map wczytujemy ponownie z JSON-a
      for (const [url, entry] of Object.entries(commentsCache)) {
        if (typeof entry.lastCount === "number") {
          lastCounts.set(url, entry.lastCount);
        }
        if (Array.isArray(entry.knownIds)) {
          knownCommentsPerPost.set(url, new Set(entry.knownIds));
        }
      }
    } else {
      console.log("[Sheet] Lista postów bez zmian.");
    }
  } catch (err) {
    console.error("[Sheet] Błąd przy pobieraniu/parsowaniu CSV:", err.message);
  }
}

/* ============================================================
   =====================   POMOCNICZE MAPY   ==================
   ============================================================ */

/**
 * Zwraca klucz cache dla posta – używamy **URL**, żeby przetrwać zmiany arkusza.
 */
function getCacheKey(post) {
  return post.url;
}

/**
 * Zwraca (i ewentualnie tworzy) Set znanych komentarzy dla danego posta.
 * Najpierw próbuje załadować z commentsCache (JSON).
 */
function getKnownSetForPost(cacheKey) {
  let set = knownCommentsPerPost.get(cacheKey);
  if (!set) {
    const entry = commentsCache[cacheKey];
    if (entry && Array.isArray(entry.knownIds)) {
      set = new Set(entry.knownIds);
    } else {
      set = new Set();
    }
    knownCommentsPerPost.set(cacheKey, set);
  }
  return set;
}

/**
 * Synchronizuje mapy (lastCounts, knownCommentsPerPost) z obiektem commentsCache
 * i zapisuje wszystko na dysk.
 */
function flushCacheToDisk() {
  // startujemy od starego cache – nie kasujemy historii dla nieobecnych postów
  const out = { ...commentsCache };

  for (const [cacheKey, count] of lastCounts.entries()) {
    if (!out[cacheKey]) out[cacheKey] = { lastCount: 0, knownIds: [] };
    out[cacheKey].lastCount = count;
  }

  for (const [cacheKey, set] of knownCommentsPerPost.entries()) {
    if (!out[cacheKey]) out[cacheKey] = { lastCount: 0, knownIds: [] };
    out[cacheKey].knownIds = Array.from(set);
  }

  // podmieniamy w pamięci, żeby kolejne rundy bazowały na świeżym obiekcie
  Object.keys(commentsCache).forEach((k) => delete commentsCache[k]);
  Object.assign(commentsCache, out);

  saveCache(out);
}

/* ============================================================
   =====================   GŁÓWNY WATCHER   ===================
   ============================================================ */

const isDev = process.env.NODE_ENV !== "production"; // lokalnie będzie true

async function startWatcher() {
  console.log(
    "[Watcher] Monitoring startuje. Sprawdzanie co",
    (CHECK_INTERVAL_MS / 1000).toFixed(0),
    "sekund."
  );

  const loop = async () => {
    let browser = null;
    let page = null;
    let hadNavErrorThisRound = false;

    try {
      console.log(
        "[Watcher] ==== Nowy cykl watchera – startuję świeżą przeglądarkę ===="
      );

      browser = await puppeteer.launch({
        headless: isDev ? false : "new",
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

      // bardziej tolerancyjne timeouty na serwerze
      page.setDefaultNavigationTimeout(90000);
      page.setDefaultTimeout(90000);

      await page.setViewport({ width: 1280, height: 720 });

      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      /* ==== LOGOWANIE / COOKIES ==== */
      await loadCookies(page);

      await page
        .goto("https://www.facebook.com/", {
          waitUntil: "load",
          timeout: 60000,
        })
        .catch(() => {});

      let loggedIn = await checkIfLogged(page);

      if (!loggedIn) {
        console.log("[FB] Brak aktywnej sesji – logowanie...");
        await fbLogin(page); // tutaj robimy login + ewentualne 2FA

        // po fbLogin sprawdzamy JESZCZE RAZ, czy faktycznie jesteśmy w środku
        loggedIn = await checkIfLogged(page);

        if (loggedIn) {
          console.log("[FB] Logowanie udane – zapisuję cookies.");
          await saveCookies(page);
        } else {
          console.error(
            "[FB] Logowanie NIEUDANE – nie zapisuję cookies (prawdopodobnie 2FA nieukończone)."
          );
        }
      } else {
        console.log("[FB] Użyto istniejącej sesji FB (cookies).");
      }

      // Na początku cyklu – odczyt arkusza (wymuszony)
      await refreshPostsIfNeeded(true);

      if (!currentPosts.length) {
        console.log(
          "[Watcher] Brak aktywnych postów do monitorowania (arkusz pusty lub same FALSE)."
        );
      } else {
        for (const post of currentPosts) {
          const cacheKey = getCacheKey(post);

          try {
            const count = await getCommentCount(page, post.url);
            if (count == null) {
              console.log(
                `[Watcher] Post ${post.id}: Nie udało się odczytać licznika.`
              );
              continue;
            }

            const prev = lastCounts.has(cacheKey)
              ? lastCounts.get(cacheKey)
              : null;
            const knownSet = getKnownSetForPost(cacheKey);

            /* ------------------ PIERWSZE ODCZYTANIE ------------------ */
            if (prev === null) {
              lastCounts.set(cacheKey, count);

              console.log(
                `[Watcher] Post ${post.id}: Startowa liczba komentarzy = ${count}`
              );

              if (!EXPAND_COMMENTS) {
                console.log(
                  `[Watcher] Post ${post.id}: EXPAND_COMMENTS=false – pomijam wczytywanie istniejących.`
                );
                continue;
              }

              await expandAllComments(page);
              let allComments = await extractCommentsData(page);

              // --- FILTR: komentarze tylko z tego posta (po story_fbid + id) ---
              try {
                const postUrlObj = new URL(post.url);
                const baseStory = postUrlObj.searchParams.get("story_fbid");
                const baseId = postUrlObj.searchParams.get("id");

                if (baseStory || baseId) {
                  allComments = allComments.filter((c) => {
                    if (!c.permalink) return false;
                    try {
                      const cUrl = new URL(c.permalink);
                      const cStory = cUrl.searchParams.get("story_fbid");
                      const cId = cUrl.searchParams.get("id");

                      if (baseStory && baseId) {
                        return cStory === baseStory && cId === baseId;
                      }
                      if (baseStory && cStory) return cStory === baseStory;
                      if (baseId && cId) return cId === baseId;

                      return false;
                    } catch {
                      return false;
                    }
                  });
                }

                console.log(
                  `[FB] Po filtrze URL (start) – komentarze z tego posta: ${allComments.length}`
                );
              } catch (e) {
                console.warn(
                  "[FB] Błąd filtrowania po URL posta (start):",
                  e.message
                );
              }

              allComments = allComments.sort((a, b) => {
                const pa = typeof a.pos === "number" ? a.pos : 999999999;
                const pb = typeof b.pos === "number" ? b.pos : 999999999;
                return pa - pb;
              });

              let maxPos = 0;
              for (const c of allComments) {
                if (c.id) knownSet.add(c.id);
                if (typeof c.pos === "number" && c.pos > maxPos) {
                  maxPos = c.pos;
                }
              }

              console.log(
                `[Watcher] Post ${post.id}: Zapamiętano ${allComments.length} istniejących komentarzy (maxPos=${maxPos}).`
              );

              continue;
            }

            /* ------------------ KOLEJNE ODCZYTY ------------------ */

            if (count !== prev) {
              console.log(
                `[Watcher] Post ${post.id}: Zmiana liczby komentarzy ${prev} -> ${count}`
              );
              lastCounts.set(cacheKey, count);
            } else {
              console.log(
                `[Watcher] Post ${post.id}: Bez zmian (${count} komentarzy).`
              );
            }

            if (!EXPAND_COMMENTS) {
              continue;
            }

            await expandAllComments(page);
            let snapshot = await extractCommentsData(page);

            // --- FILTR: komentarze tylko z tego posta (po story_fbid + id) ---
            try {
              const postUrlObj = new URL(post.url);
              const baseStory = postUrlObj.searchParams.get("story_fbid");
              const baseId = postUrlObj.searchParams.get("id");

              if (baseStory || baseId) {
                snapshot = snapshot.filter((c) => {
                  if (!c.permalink) return false;
                  try {
                    const cUrl = new URL(c.permalink);
                    const cStory = cUrl.searchParams.get("story_fbid");
                    const cId = cUrl.searchParams.get("id");

                    if (baseStory && baseId) {
                      return cStory === baseStory && cId === baseId;
                    }
                    if (baseStory && cStory) return cStory === baseStory;
                    if (baseId && cId) return cId === baseId;

                    return false;
                  } catch {
                    return false;
                  }
                });
              }

              console.log(
                `[FB] Po filtrze URL – komentarze z tego posta: ${snapshot.length}`
              );
            } catch (e) {
              console.warn(
                "[FB] Błąd filtrowania po URL posta:",
                e.message
              );
            }

            snapshot = snapshot.sort((a, b) => {
              const pa = typeof a.pos === "number" ? a.pos : 999999999;
              const pb = typeof b.pos === "number" ? b.pos : 999999999;
              return pa - pb;
            });

            console.log(
              `[DBG] extractCommentsData – snapshot = ${snapshot.length}`
            );
            console.dir(snapshot.slice(0, 5), { depth: null });

            let newComments = [];

            // 1) nowe ID względem knownSet
            for (const c of snapshot) {
              if (!c.id) continue;
              if (!knownSet.has(c.id)) {
                knownSet.add(c.id);
                newComments.push(c);
              }
            }

            // 2) fallback, gdy licznik FB wzrósł, a po ID nic nie ma
            if (newComments.length === 0 && count > prev) {
              const diff = Math.max(1, count - prev);

              const cleaned = snapshot.filter((c) => {
                const textOk = c.text && c.text.trim();
                const idOk = c.id && c.id.trim();
                const linkOk = c.permalink && c.permalink.trim();
                return textOk || idOk || linkOk;
              });

              const tail = cleaned.slice(-diff);

              for (const c of tail) {
                if (c.id) knownSet.add(c.id);
              }

              newComments = tail;

              console.log(
                `[Watcher] Post ${post.id}: Fallback — brak nowych ID, biorę ostatnie ${diff} komentarzy jako nowe.`
              );
            }

            if (newComments.length > 0) {
              console.log(
                `[Watcher] Post ${post.id}: Znaleziono ${newComments.length} NOWYCH komentarzy.`
              );

              await sendWebhook(post, newComments, count, prev);
            } else {
              console.log(
                `[Watcher] Post ${post.id}: Brak nowych komentarzy (po ID i fallbacku).`
              );
            }
          } catch (err) {
  console.error(
    `[Watcher] Błąd przy sprawdzaniu ${post.id}:`,
    err && err.message ? err.message : err
  );
  if (err && err.stack) {
    console.error("[Watcher] Stack błędu:", err.stack);
  }

  if (isNavigationError(err)) {
    hadNavErrorThisRound = true;
    navErrorCount++;
    console.log(
      `[Watcher] Kolejny błąd nawigacji: ${navErrorCount}/${MAX_NAV_ERRORS}`
    );
  }
}

        }
      }
    } catch (err) {
      console.error("[Watcher] Błąd w cyklu watchera:", err);
    } finally {
      // 🔥 KONIEC RUNDY → zapisujemy cache na dysk
      flushCacheToDisk();

      // jeśli cała runda przeszła bez błędów nawigacji – resetujemy licznik
      if (!hadNavErrorThisRound && navErrorCount > 0) {
        console.log(
          `[Watcher] Runda bez błędów nawigacji – reset licznika (było ${navErrorCount}).`
        );
        navErrorCount = 0;
      }

      if (browser) {
        try {
          await browser.close();
          console.log(
            "[Watcher] Zamknięto przeglądarkę po zakończeniu cyklu."
          );
        } catch (closeErr) {
          console.log(
            "[Watcher] Błąd podczas zamykania przeglądarki:",
            closeErr?.message || closeErr
          );
        }
      }

      if (navErrorCount >= MAX_NAV_ERRORS) {
        console.error(
          "[Watcher] Za dużo błędów nawigacji z rzędu – kończę proces, niech PM2/menedżer odpali go od nowa."
        );
        process.exit(1);
      }

      const jitter = Math.floor(Math.random() * 5000);
      const delay = CHECK_INTERVAL_MS + jitter;
      console.log(
        `[Watcher] Kolejny cykl za około ${Math.round(delay / 1000)} sekund.`
      );
      setTimeout(loop, delay);
    }
  };

  // start pierwszego cyklu
  loop();
}

export { startWatcher };
