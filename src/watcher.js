import puppeteer from "puppeteer";
import { CHECK_INTERVAL_MS, EXPAND_COMMENTS, POSTS } from "./config.js";
import { expandAllComments, extractCommentsData, getCommentCount } from "./fb/comments.js";
import { loadCookies, saveCookies } from "./fb/cookies.js";
import { checkIfLogged, fbLogin } from "./fb/login.js";
import { sendWebhook } from "./webhook.js";

const lastCounts = new Map();
const knownComments = new Set();

async function startWatcher() {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-notifications",
    ],
  });

  const page = await browser.newPage();
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
    await fbLogin(page);
    await saveCookies(page);
  } else {
    console.log("[FB] Użyto istniejącej sesji FB (cookies).");
  }

  console.log(
    "[Watcher] Monitoring startuje. Sprawdzanie co",
    (CHECK_INTERVAL_MS / 1000).toFixed(0),
    "sekund."
  );

  /* ========================================================
     ===================== GŁÓWNA PĘTLA =====================
     ======================================================== */

  const loop = async () => {
    for (const post of POSTS) {
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

          // sort DOM-top → bottom
          allComments = allComments.sort((a, b) => {
            const pa = typeof a.pos === "number" ? a.pos : 999999999;
            const pb = typeof b.pos === "number" ? b.pos : 999999999;
            return pa - pb;
          });

          let maxPos = 0;
          for (const c of allComments) {
            if (c.id) knownComments.add(c.id);
            if (typeof c.pos === "number" && c.pos > maxPos) {
              maxPos = c.pos;
            }
          }

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

          // wzrost liczby komentarzy
          if (count > prev) {
            let newComments = [];

            if (EXPAND_COMMENTS) {
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

              // normalne wyszukiwanie nowych komentarzy po ID
              for (const c of snapshot) {
                if (!c.id) continue;
                if (!knownComments.has(c.id)) {
                  knownComments.add(c.id);
                  newComments.push(c);
                }
              }

              // filtracja śmieci
              newComments = newComments.filter((c) => {
                const idOk = c.id && c.id.trim();
                const textOk = c.text && c.text.trim();
                const authorOk = c.author && c.author.trim();
                const linkOk = c.permalink && c.permalink.trim();
                return idOk || textOk || authorOk || linkOk;
              });

              // FALLBACK gdy FB nie da ID
              if (newComments.length === 0) {
                const diff = Math.max(1, count - prev);

                const cleaned = snapshot.filter((c) => {
                  const textOk = c.text && c.text.trim();
                  const idOk = c.id && c.id.trim();
                  const linkOk = c.permalink && c.permalink.trim();
                  return textOk || idOk || linkOk;
                });

                const tail = cleaned.slice(-diff);

                for (const c of tail) {
                  if (c.id) knownComments.add(c.id);
                }

                newComments = tail;

                console.log(
                  `[Watcher] Post ${post.id}: Fallback — brak ID, biorę ostatnie ${diff} komentarzy jako nowe.`
                );
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
        }

        /* ------------------ BEZ ZMIAN ------------------ */
        else {
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

    const delay = CHECK_INTERVAL_MS + Math.floor(Math.random() * 5000);
    setTimeout(loop, delay);
  };

  loop();
}

export { startWatcher };
