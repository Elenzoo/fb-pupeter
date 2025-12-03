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

/**
 * Mapa: postId -> ostatnio znany licznik komentarzy.
 */
const lastCounts = new Map();
/**
 * Zestaw znanych ID komentarzy (żeby odróżniać stare od nowych).
 */
const knownComments = new Set();
/**
 * Mapa: postId -> ostatnie maxPos z DOM (do bezpiecznego fallbacku).
 */
const lastMaxPos = new Map();

/**
 * Aktualna lista postów (z arkusza).
 * Każdy element: { id, url }
 */
let currentPosts = [];
let lastSheetFetch = 0;

/* ============================================================
   ===============   STEALTH / UKRYWANIE BOTA   ===============
   ============================================================ */

async function applyStealth(page) {
  await page.evaluateOnNewDocument(() => {
    // 1) navigator.webdriver = false
    // // w środku page.evaluateOnNewDocument(() => { ...tu... });
window.__fb_isElementVisible = function (el) {
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return true;
};
    Object.defineProperty(navigator, "webdriver", {
      get: () => false,
    });

    // 2) window.chrome – szkielet
    // @ts-ignore
    window.chrome = window.chrome || { runtime: {} };

    // 3) sztuczne pluginy
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3],
    });

    // 4) języki przeglądarki
    Object.defineProperty(navigator, "languages", {
      get: () => ["pl-PL", "pl"],
    });

    // 5) permissions query (np. powiadomienia)
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
  const idxUrl = header.findIndex(
    (h) => h.trim().toLowerCase() === "url"
  );
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

    // 🔥 ZASADA:
    // - jeśli kolumna "active" istnieje → aktywne TYLKO gdy:
    //   TRUE / true / 1 / yes / tak
    // - jeśli kolumny nie ma → traktujemy wszystkie wiersze jako aktywne
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
 * Jeśli lista się zmieni → czyścimy lastCounts + knownComments + lastMaxPos.
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
    return; // za wcześnie na kolejne odświeżenie
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
      lastCounts.clear();
      knownComments.clear();
      lastMaxPos.clear();
      return;
    }

    const oldJson = JSON.stringify(currentPosts);
    const newJson = JSON.stringify(newPosts);

    if (oldJson !== newJson) {
      console.log(
        `[Sheet] Lista postów zmieniona – było ${currentPosts.length}, teraz ${newPosts.length}. Resetuję cache komentarzy.`
      );
      currentPosts = newPosts;
      lastCounts.clear();
      knownComments.clear();
      lastMaxPos.clear();
    } else {
      console.log("[Sheet] Lista postów bez zmian.");
    }
  } catch (err) {
    console.error("[Sheet] Błąd przy pobieraniu/parsowaniu CSV:", err.message);
  }
}

/* ============================================================
   =====================   GŁÓWNY WATCHER   ===================
   ============================================================ */

async function startWatcher() {
  const browser = await puppeteer.launch({
    headless: "new", // ważne: musi być headless na serwerze
    defaultViewport: null, // pełne okno, jak lokalnie
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-notifications",
      "--disable-blink-features=AutomationControlled",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const page = await browser.newPage();

  await applyStealth(page);

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

  const loggedIn = await checkIfLogged(page);
  if (!loggedIn) {
    console.log("[FB] Brak aktywnej sesji – spróbuję się zalogować...");
    try {
      await fbLogin(page);
      await saveCookies(page);
    } catch (err) {
      console.error("[FB] Logowanie nie powiodło się:", err.message);
      console.error(
        "[FB] Zatrzymuję watcher. Sprawdź dane logowania / 2FA albo zaloguj się ręcznie inną metodą."
      );
      await browser.close();
      return;
    }
  } else {
    console.log("[FB] Użyto istniejącej sesji FB (cookies).");
  }


  // Na start – pierwszy odczyt arkusza (wymuszony)
  await refreshPostsIfNeeded(true);

  console.log(
    "[Watcher] Monitoring startuje. Sprawdzanie co",
    (CHECK_INTERVAL_MS / 1000).toFixed(0),
    "sekund."
  );

  const loop = async () => {
    // przy każdej iteracji – sprawdzamy, czy nie minęło POSTS_REFRESH_MS
    await refreshPostsIfNeeded(false);

    if (!currentPosts.length) {
      console.log(
        "[Watcher] Brak aktywnych postów do monitorowania (arkusz pusty lub same FALSE)."
      );
    } else {
      for (const post of currentPosts) {
        try {
          const count = await getCommentCount(page, post.url);

          if (count == null) {
            console.log(
              `[Watcher] Post ${post.id}: Nie udało się odczytać licznika.`
            );
            continue;
          }

          const prev = lastCounts.get(post.id) ?? null;

          /* ------------------ PIERWSZE ODCZYTANIE ------------------ */
          if (prev === null) {
            lastCounts.set(post.id, count);

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

            allComments = allComments.sort((a, b) => {
              const pa = typeof a.pos === "number" ? a.pos : 999999999;
              const pb = typeof b.pos === "number" ? b.pos : 999999999;
              return pa - pb;
            });

            let maxPos = -Infinity;
            for (const c of allComments) {
              if (c.id) knownComments.add(c.id);
              if (typeof c.pos === "number" && c.pos > maxPos) {
                maxPos = c.pos;
              }
            }

            if (!Number.isFinite(maxPos)) {
              maxPos = -Infinity;
            }

            lastMaxPos.set(post.id, maxPos);

            console.log(
              `[Watcher] Post ${post.id}: Zapamiętano ${allComments.length} istniejących komentarzy (maxPos=${maxPos}).`
            );

            continue;
          }

          /* ------------------ ZMIANA LICZNIKA ------------------ */
          if (count !== prev) {
            console.log(
              `[Watcher] Post ${post.id}: Zmiana liczby komentarzy ${prev} -> ${count}`
            );

            lastCounts.set(post.id, count);

            if (count > prev) {
              let newComments = [];

              if (EXPAND_COMMENTS) {
                const prevMaxPos = lastMaxPos.get(post.id) ?? -Infinity;

                await expandAllComments(page);
                let snapshot = await extractCommentsData(page);

                snapshot = snapshot.sort((a, b) => {
                  const pa = typeof a.pos === "number" ? a.pos : 999999999;
                  const pb = typeof b.pos === "number" ? b.pos : 999999999;
                  return pa - pb;
                });

                console.log(
                  `[DBG] extractCommentsData – snapshot = ${snapshot.length}`
                );
                console.dir(snapshot.slice(0, 5), { depth: null });

                // zaktualizuj maxPos na podstawie snapshotu
                let maxPosNow = prevMaxPos;
                for (const c of snapshot) {
                  if (typeof c.pos === "number" && c.pos > maxPosNow) {
                    maxPosNow = c.pos;
                  }
                }
                if (!Number.isFinite(maxPosNow)) {
                  maxPosNow = prevMaxPos;
                }
                lastMaxPos.set(post.id, maxPosNow);

                // 1) normalna ścieżka – po ID
                for (const c of snapshot) {
                  if (!c.id) continue;
                  if (!knownComments.has(c.id)) {
                    knownComments.add(c.id);
                    newComments.push(c);
                  }
                }

                newComments = newComments.filter((c) => {
                  const idOk = c.id && c.id.trim();
                  const textOk = c.text && c.text.trim();
                  const authorOk = c.author && c.author.trim();
                  const linkOk = c.permalink && c.permalink.trim();
                  return idOk || textOk || authorOk || linkOk;
                });

                // 2) fallback, gdy z jakiegoś powodu nie złapaliśmy nowych ID
                if (newComments.length === 0) {
                  const diff = Math.max(1, count - prev);

                  const cleaned = snapshot.filter((c) => {
                    const textOk = c.text && c.text.trim();
                    const idOk = c.id && c.id.trim();
                    const linkOk = c.permalink && c.permalink.trim();
                    return textOk || idOk || linkOk;
                  });

                  // spróbuj najpierw użyć pos > prevMaxPos (bezpieczniejszy fallback)
                  const candidatesByPos = cleaned.filter(
                    (c) =>
                      typeof c.pos === "number" && c.pos > prevMaxPos
                  );

                  if (candidatesByPos.length >= diff) {
                    const sortedByPos = candidatesByPos
                      .slice()
                      .sort((a, b) => {
                        const pa =
                          typeof a.pos === "number" ? a.pos : 999999999;
                        const pb =
                          typeof b.pos === "number" ? b.pos : 999999999;
                        return pa - pb;
                      });

                    const tailByPos = sortedByPos.slice(-diff);
                    for (const c of tailByPos) {
                      if (c.id) knownComments.add(c.id);
                    }
                    newComments = tailByPos;

                    console.log(
                      `[Watcher] Post ${post.id}: Fallback-pos — używam pos > ${prevMaxPos}, kandydatów=${candidatesByPos.length}, wysyłam=${newComments.length}.`
                    );
                  } else {
                    // twardy awaryjny fallback – jak wcześniej
                    const tail = cleaned.slice(-diff);

                    for (const c of tail) {
                      if (c.id) knownComments.add(c.id);
                    }

                    newComments = tail;

                    console.log(
                      `[Watcher] Post ${post.id}: HARD fallback — brak ID i brak sensownych pos>prevMaxPos (kandydatów=${candidatesByPos.length}), biorę ostatnie ${diff} komentarzy jako nowe.`
                    );
                  }
                }

                console.log(
                  `[Watcher] Post ${post.id}: Znaleziono ${newComments.length} NOWYCH komentarzy.`
                );
              }

              await sendWebhook(post, newComments, count, prev);
            } else {
              console.log(
                `[Watcher] Post ${post.id}: Komentarzy mniej (${prev} -> ${count}).`
              );
            }
          } else {
            console.log(
              `[Watcher] Post ${post.id}: Bez zmian (${count} komentarzy).`
            );
          }
        } catch (err) {
          console.error(
            `[Watcher] Błąd przy sprawdzaniu ${post.id}:`,
            err.message
          );
        }
      }
    }

    const jitter = Math.floor(Math.random() * 5000);
    const delay = CHECK_INTERVAL_MS + jitter;
    setTimeout(loop, delay);
  };

  loop();
}

export { startWatcher };
