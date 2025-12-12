// src/fb/comments.js
import { EXPAND_COMMENTS } from "../config.js";
import { sleepRandom } from "../utils/sleep.js";
import { scrollPost } from "./scroll.js";
import { acceptCookies, saveCookies } from "./cookies.js";
import { ensureLoggedInOnPostOverlay, fbLogin, checkIfLogged } from "./login.js";
import { clickOneExpandButton } from "./expandButtons.js";
import { safeGoto } from "../utils/navigation.js";
import { getUiCommentInfo } from "./uiCommentInfo.js";


const NAV_TIMEOUT_MS = process.env.NAV_TIMEOUT_MS
  ? Number(process.env.NAV_TIMEOUT_MS)
  : 90000; // było 60000, podbijamy do 90s

let firstPostPauseDone = false;
/* ============================================================
   =======  PRZEŁĄCZANIE FILTRA „WSZYSTKIE KOMENTARZE”  ========
   ============================================================ */

/**
 * Próbuje ustawić filtr komentarzy na "Wszystkie komentarze".
 * Zasada:
 *  - jeśli już jest "Wszystkie komentarze" → zwraca true, nic nie klika
 *  - jeśli znajdzie filtr → otwiera menu i wybiera "Wszystkie komentarze"
 *  - jeśli nie znajdzie ani filtra, ani opcji → false
 */
async function switchCommentsFilterToAll(page) {
  console.log("[FB][filter] Próba przełączenia filtra komentarzy…");

  // 1) jeśli menu już jest otwarte – nie klikamy ponownie, tylko próbujemy
  //    wybrać opcję "Wszystkie komentarze" z istniejącego menu
  const menuAlreadyOpen = await page.evaluate(() => {
    return !!document.querySelector("div[role='menu']");
  });

  if (menuAlreadyOpen) {
    console.log("[FB][filter] Menu filtra już otwarte – próbuję wybrać opcję.");
    const menuResult = await clickAllCommentsInMenu(page);
    if (menuResult.clicked) {
      console.log("[FB][filter] Wybrano 'Wszystkie komentarze' z otwartego menu.");
      return true;
    }
    console.log("[FB][filter] Menu otwarte, ale nie ma opcji 'Wszystkie komentarze'.");
    return false;
  }

  // 2) spróbuj znaleźć bieżący przycisk filtra i sprawdzić, co jest ustawione
  const pre = await page.evaluate(() => {
    const els = Array.from(
      document.querySelectorAll("div[role='button'], span[role='button']")
    );

    let filterEl = null;
    let labelText = "";

    for (const el of els) {
      const t = (el.textContent || "").trim();
      if (!t) continue;
      const low = t.toLowerCase();

      if (
        low === "najtrafniejsze" ||
        low === "most relevant" ||
        low === "wszystkie komentarze" ||
        low === "all comments"
      ) {
        filterEl = el;
        labelText = low;
        break;
      }
    }

    if (!filterEl) {
      return { state: "not-found" };
    }

    // Jeśli label już jest "wszystkie komentarze" → nic nie robimy
    if (labelText === "wszystkie komentarze" || labelText === "all comments") {
      return { state: "already-all" };
    }

    // W innym wypadku klikamy w filtr, żeby otworzyć menu
    filterEl.click();
    return { state: "clicked-filter" };
  });

  if (pre.state === "not-found") {
    console.log("[FB][filter] Nie znaleziono przycisku filtra komentarzy.");
    return false;
  }

  if (pre.state === "already-all") {
    console.log("[FB][filter] Filtr już ustawiony na 'Wszystkie komentarze' – pomijam.");
    return true;
  }

  // 3) po kliknięciu filtra – czekamy aż pojawi się menu
  if (pre.state === "clicked-filter") {
    await sleepRandom(400, 800);

    const menuResult = await clickAllCommentsInMenu(page);

    if (!menuResult.clicked && menuResult.noMenu) {
      // fallback: może filtr przełącza się bez menu – sprawdzamy label jeszcze raz
      const afterLabelIsAll = await page.evaluate(() => {
        const els = Array.from(
          document.querySelectorAll("div[role='button'], span[role='button']")
        );
        const btn = els.find((el) => {
          const t = (el.textContent || "").trim().toLowerCase();
          return t === "wszystkie komentarze" || t === "all comments";
        });
        return !!btn;
      });

      if (afterLabelIsAll) {
        console.log(
          "[FB][filter] Po kliknięciu filtr przełączył się bez menu na 'Wszystkie komentarze'."
        );
        return true;
      }

      console.log(
        "[FB][filter] Kliknięto filtr, ale nie pojawiło się menu i label nie jest 'Wszystkie komentarze'."
      );
      return false;
    }

    if (!menuResult.clicked && !menuResult.noMenu) {
      console.log("[FB][filter] Menu filtra jest, ale brak opcji 'Wszystkie komentarze'.");
      return false;
    }

    console.log("[FB][filter] Filtr komentarzy ustawiony na: 'Wszystkie komentarze'.");
    return true;
  }

  // Fallback – nie powinno się zdarzyć, ale niech będzie jawnie
  console.log("[FB][filter] Nieoczekiwany stan w switchCommentsFilterToAll:", pre);
  return false;
}

async function clickShowAllCommentsIfPresent(page) {
  console.log("[FB][show-all] Próba kliknięcia 'Pokaż wszystkie' (aria-label)…");

  try {
    const clicked = await page.evaluate(() => {
      // Jeśli filtr już jest, to znaczy że "Pokaż wszystkie" zostało kliknięte / niepotrzebne
      const bodyText = (document.body.innerText || "").toLowerCase();
      if (
        bodyText.includes("najtrafniejsze") ||
        bodyText.includes("najnowsze") ||
        bodyText.includes("wszystkie komentarze") ||
        bodyText.includes("all comments") ||
        bodyText.includes("ukryj komentarze") ||
        bodyText.includes("hide comments")
      ) {
        return false;
      }

      const selectors = [
        "div[aria-label='Pokaż wszystkie'][role='button']",
        "div[aria-label='Wyświetl wszystkie'][role='button']",
        "div[aria-label='Show all'][role='button']",
        "div[aria-label='View all'][role='button']",
      ];

      let el = null;
      for (const sel of selectors) {
        el = document.querySelector(sel);
        if (el) break;
      }
      if (!el) return false;

      try {
        el.scrollIntoView({ block: "center", inline: "nearest" });
      } catch (e) {
        // scrollIntoView nie musi się udać
      }

      // zwykły JS – bez TypeScripta
      if (typeof el.click === "function") {
        el.click();
        return true;
      }

      return false;
    });

    if (!clicked) {
      console.log(
        "[FB][show-all] Nie znaleziono aria-label='Pokaż wszystkie' albo filtr już widoczny – pomijam."
      );
      return false;
    }

    console.log("[FB][show-all] Kliknięto 'Pokaż wszystkie' (aria-label).");
    await sleepRandom(900, 1600);
    return true;
  } catch (err) {
    console.log(
      "[FB][show-all] Błąd podczas klikania 'Pokaż wszystkie':",
      err?.message || err
    );
    return false;
  }
}




/**
 * Próbuje kliknąć opcję "Wszystkie komentarze / All comments" w otwartym menu.
 * Zwraca: { clicked: boolean, noMenu: boolean }
 */
async function clickAllCommentsInMenu(page) {
  const result = await page.evaluate(() => {
    const menu =
      document.querySelector("div[role='menu']") ||
      document.querySelector("div[role='dialog']");

    if (!menu) {
      return { clicked: false, noMenu: true };
    }

    const items = Array.from(
      menu.querySelectorAll("div[role='menuitem'], div[role='menuitemradio']")
    );

    const opt = items.find((el) => {
      const t = (el.textContent || "").trim().toLowerCase();
      return (
        t.startsWith("wszystkie komentarze") ||
        t.startsWith("all comments")
      );
    });

    if (!opt) {
      return { clicked: false, noMenu: false };
    }

    opt.click();

    // wymuszamy zamknięcie dropdownu kliknięciem w body
    setTimeout(() => {
      try {
        document.body.click();
      } catch {}
    }, 50);

    return { clicked: true, noMenu: false };
  });

  if (result.clicked) {
    await sleepRandom(300, 600);
    // czekamy aż dropdown zniknie, ale bez rzucania błędem
    await page
      .waitForFunction(() => !document.querySelector("div[role='menu']"), {
        timeout: 2000,
      })
      .catch(() => {});
  }

  return result;
}

/* ============================================================
   =========== POST ROOT (DIALOG / MAIN / FALLBACK) ============
   ============================================================ */

function postRootScript() {
  return `
    function getPostRoot() {
      const dialogs = Array.from(document.querySelectorAll("div[role='dialog']"));

      const postDialog = dialogs.find((dlg) => {
        const text = (dlg.innerText || dlg.textContent || "").toLowerCase();
        if (!text) return false;

        const hasCommentWord =
          text.includes("komentarz") || text.includes("comment");
        const hasActions =
          text.includes("lubię to") ||
          text.includes("komentarz") ||
          text.includes("udostępnij") ||
          text.includes("napisz komentarz") ||
          text.includes("comment");

        const looksLikeNotifications =
          text.startsWith("powiadomienia") &&
          text.includes("wszystkie") &&
          text.includes("nieprzeczytane");

        return !looksLikeNotifications && hasCommentWord && hasActions;
      });

      if (postDialog) return postDialog;

      const main = document.querySelector("div[role='main']");
      if (main) {
        const article = main.querySelector("article");
        return article || main;
      }

      return document.body;
    }
  `;
}

/* ============================================================
   ===== POMOCNICZE: LICZENIE ID KOMENTARZY ====================
   ============================================================ */

async function getCurrentCommentAnchorCount(page) {
  const count = await page.evaluate(() => {
    const anchors = Array.from(
      document.querySelectorAll(
        "a[href*='comment_id'], a[href*='reply_comment_id']"
      )
    );
    const ids = new Set();

    for (const a of anchors) {
      try {
        const url = new URL(a.href);
        const cid = url.searchParams.get("comment_id");
        const rid = url.searchParams.get("reply_comment_id");
        let raw = rid || cid;
        if (!raw) continue;

        if (!/^\d+$/.test(raw)) {
          try {
            const dec = atob(raw);
            const m = dec.match(/:(\d+)_([0-9]+)/);
            if (m) raw = m[2];
          } catch {}
        }

        if (raw) ids.add(raw);
      } catch {}
    }

    return ids.size;
  });

  return count || 0;
}

/**
 * Scrolluje w obrębie posta (panel komentarzy, dialog, itp.).
 * Jeśli nie znajdzie sensownego kontenera – może zwrócić xxx-no-scroll.
 *
 * factor > 0  → w dół
 * factor < 0  → w górę
 */
async function scrollWithinPost(page, label, factor = 0.3) {
  const info = await page.evaluate(
    (factorArg, labelArg, postRootCode) => {
      const href = location.href;
      const isPhotoView = /[?&]fbid=|\/photo\.php|\/photo\?fbid=|\/photo\/\d/i.test(
        href
      );
      const isVideoView = /\/watch\/|\/videos\/|[\?&]v=/i.test(href);

      // wstrzykujemy funkcję getPostRoot
      // eslint-disable-next-line no-eval
      eval(postRootCode);
      // @ts-ignore
      const rootFn =
        typeof getPostRoot === "function" ? getPostRoot : () => document.body;

      function pushIfScrollable(list, el, labelName) {
        if (!el) return;
        const style = window.getComputedStyle(el);
        if (!style) return;

        const oy = style.overflowY;
        const clientH = el.clientHeight || 0;
        const scrollH = el.scrollHeight || 0;
        const delta = scrollH - clientH;

        if (
          clientH > 0 &&
          delta > 10 &&
          (oy === "auto" ||
            oy === "scroll" ||
            oy === "overlay" ||
            oy === "hidden")
        ) {
          list.push({ el, label: labelName, delta });
        }
      }

      let container = null;
      let containerType = null;

      // 0) Najpierw spróbuj użyć zapamiętanego kontenera komentarzy
      const cached = document.querySelector("[data-fbwatcher-comments='1']");
      if (cached) {
        container = cached;
        containerType = "cached-comments";
      }

      // ===== PHOTO / VIDEO – najpierw próbujemy "oficjalny" panel komentarzy =====
      if (!container && (isPhotoView || isVideoView)) {
        const moreCommentsBtn = Array.from(
          document.querySelectorAll(
            "button, div[role='button'], span[role='button']"
          )
        ).find((el) => {
          const t = (el.textContent || "").toLowerCase();
          return (
            t.includes("wyświetl więcej komentarzy") ||
            t.includes("zobacz więcej komentarzy") ||
            t.includes("view more comments") ||
            t.includes("view previous comments")
          );
        });

        if (moreCommentsBtn) {
          let p = moreCommentsBtn.parentElement;
          while (p && p !== document.body && p !== document.documentElement) {
            const style = window.getComputedStyle(p);
            const oy = style.overflowY;
            const ch = p.clientHeight || 0;
            const sh = p.scrollHeight || 0;
            const delta = sh - ch;

            if (
              ch > 0 &&
              delta > 10 &&
              (oy === "auto" ||
                oy === "scroll" ||
                oy === "overlay" ||
                oy === "hidden")
            ) {
              container = p;
              containerType = isPhotoView ? "photo-comments" : "video-comments";
              break;
            }
            p = p.parentElement;
          }
        }

        // VIDEO – dodatkowa próba: po nagłówku "Komentarze / Najtrafniejsze"
        if (!container && isVideoView) {
          const commentsHeader = Array.from(
            document.querySelectorAll("div, span")
          ).find((el) => {
            const t = (el.textContent || "").toLowerCase();
            return (
              (t.includes("komentarze") && t.includes("najtrafniejsze")) ||
              (t.includes("comments") && t.includes("most relevant")) ||
              t.trim() === "komentarze" ||
              t.trim() === "comments"
            );
          });

          if (commentsHeader) {
            let p = commentsHeader.parentElement;
            while (p && p !== document.body && p !== document.documentElement) {
              const style = window.getComputedStyle(p);
              const oy = style.overflowY;
              const ch = p.clientHeight || 0;
              const sh = p.scrollHeight || 0;
              const delta = sh - ch;

              if (
                ch > 0 &&
                delta > 10 &&
                (oy === "auto" ||
                  oy === "scroll" ||
                  oy === "overlay" ||
                  oy === "hidden")
              ) {
                container = p;
                containerType = "video-comments-header";
                break;
              }
              p = p.parentElement;
            }
          }
        }

        // dodatkowy fallback na VIDEO – po polu "Napisz komentarz..."
        if (!container && isVideoView) {
          const commentBox = Array.from(
            document.querySelectorAll("div[role='textbox'], textarea")
          ).find((el) => {
            const label = (el.getAttribute("aria-label") || "").toLowerCase();
            const ph = (el.getAttribute("placeholder") || "").toLowerCase();
            const txt = (el.textContent || "").toLowerCase();

            const needles = [
              "napisz komentarz",
              "write a comment",
              "escribe un comentario",
              "schreibe einen kommentar",
            ];

            return needles.some((n) =>
              label.includes(n) || ph.includes(n) || txt.includes(n)
            );
          });

          if (commentBox) {
            let p = commentBox.parentElement;
            while (p && p !== document.body && p !== document.documentElement) {
              const style = window.getComputedStyle(p);
              const oy = style.overflowY;
              const ch = p.clientHeight || 0;
              const sh = p.scrollHeight || 0;
              const delta = sh - ch;

              if (
                ch > 0 &&
                delta > 10 &&
                (oy === "auto" ||
                  oy === "scroll" ||
                  oy === "overlay" ||
                  oy === "hidden")
              ) {
                container = p;
                containerType = "video-comments-textbox";
                break;
              }
              p = p.parentElement;
            }
          }
        }

        // jeśli na watch nic sensownego nie znaleźliśmy – nie ruszamy okna
        if (isVideoView && !container) {
          const cur = window.scrollY || 0;
          return {
            before: cur,
            after: cur,
            container: "video-no-scroll",
            label: labelArg,
          };
        }
      }

      // ===== Standardowa heurystyka (permalink / photo fallback) =====
      if (!container) {
        const root = rootFn() || document.body;
        const candidates = [];

        pushIfScrollable(candidates, root, "root");

        const dialog =
          root.closest("div[role='dialog']") ||
          document.querySelector("div[role='dialog']");
        if (dialog) {
          pushIfScrollable(candidates, dialog, "dialog");
        }

        const scope = dialog || root;
        const blocks = Array.from(
          scope.querySelectorAll("div, section, main, article")
        );
        for (const el of blocks) {
          pushIfScrollable(candidates, el, "auto");
        }

        let best = null;
        for (const c of candidates) {
          if (!best || c.delta > best.delta) best = c;
        }

        if (best) {
          container = best.el;
          containerType = best.label;
        } else {
          container =
            document.scrollingElement ||
            document.documentElement ||
            document.body;
          const delta =
            (container.scrollHeight || 0) - (container.clientHeight || 0);
          if (delta <= 0) {
            const cur = container.scrollTop || window.scrollY || 0;
            return {
              before: cur,
              after: cur,
              container: "window-no-scroll",
              label: labelArg,
            };
          }
          containerType = "window";
        }
      }

      // Zapamiętujemy kontener komentarzy (żeby kolejne wywołania go użyły)
      if (container) {
        const isRootContainer =
          container === document.body ||
          container === document.documentElement ||
          container === document.scrollingElement;

        if (!isRootContainer) {
          try {
            container.setAttribute("data-fbwatcher-comments", "1");
          } catch {}
        }
      }

      const isWindowContainer =
        container === document.body ||
        container === document.documentElement ||
        container === document.scrollingElement;

      // na watch nie scrollujemy okna, tylko panel komentarzy
      if (isVideoView && isWindowContainer) {
        const cur = window.scrollY || 0;
        return {
          before: cur,
          after: cur,
          container: "video-window-blocked",
          label: labelArg,
        };
      }

      const before = isWindowContainer
        ? window.scrollY || 0
        : container.scrollTop || 0;

      const maxScroll =
        (container.scrollHeight || 0) - (container.clientHeight || 0);

      if (maxScroll <= 0) {
        return {
          before,
          after: before,
          container: (containerType || "unknown") + "-no-scroll",
          label: labelArg,
        };
      }

      const factor = factorArg || 0.3;
      const sign = factor < 0 ? -1 : 1;
      const magnitude = Math.min(Math.abs(factor), 1);

      const baseStep =
        (container.clientHeight || window.innerHeight || 600) * magnitude;

      // na VIDEO robimy mniejszy krok, żeby nie przeskakiwać przycisków
      let step = Math.max(30, Math.min(baseStep, isVideoView ? 180 : 220));

      let target;
      if (sign < 0) {
        target = Math.max(0, before - step);
      } else {
        target = Math.min(maxScroll, before + step);
      }

      if (isWindowContainer) {
        window.scrollTo(0, target);
      } else {
        container.scrollTop = target;
      }

      const after = isWindowContainer
        ? window.scrollY || 0
        : container.scrollTop || 0;

      return {
        before,
        after,
        container: containerType || "unknown",
        label: labelArg,
      };
    },
    factor,
    label,
    postRootScript()
  );

  return info;
}


/**
 * Dociągnięcie do ABSOLUTNEGO dołu panelu komentarzy.
 * Robi wewnętrzną pętlę w przeglądarce aż scroll przestanie się zmieniać.
 */
async function scrollToAbsoluteBottom(page, label = "bottom") {
  const info = await page.evaluate(
    (labelArg, postRootCode) => {
      const href = location.href;
      const isPhotoView = /[?&]fbid=|\/photo\.php|\/photo\?fbid=|\/photo\/\d/i.test(
        href
      );
      const isVideoView = /\/watch\/|\/videos\/|[\?&]v=/i.test(href);

      // wstrzykujemy funkcję getPostRoot
      // eslint-disable-next-line no-eval
      eval(postRootCode);
      // @ts-ignore
      const rootFn =
        typeof getPostRoot === "function" ? getPostRoot : () => document.body;

      function pushIfScrollable(list, el, labelName) {
        if (!el) return;
        const style = window.getComputedStyle(el);
        if (!style) return;

        const oy = style.overflowY;
        const clientH = el.clientHeight || 0;
        const scrollH = el.scrollHeight || 0;
        const delta = scrollH - clientH;

        if (
          clientH > 0 &&
          delta > 10 &&
          (oy === "auto" ||
            oy === "scroll" ||
            oy === "overlay" ||
            oy === "hidden")
        ) {
          list.push({ el, label: labelName, delta });
        }
      }

      let container = null;
      let containerType = null;

      // 0) Najpierw spróbuj użyć zapamiętanego kontenera komentarzy
      const cached = document.querySelector("[data-fbwatcher-comments='1']");
      if (cached) {
        container = cached;
        containerType = "cached-comments";
      }

      // PHOTO / VIDEO – najpierw próbujemy znaleźć panel komentarzy
      if (!container && (isPhotoView || isVideoView)) {
        const moreCommentsBtn = Array.from(
          document.querySelectorAll(
            "button, div[role='button'], span[role='button']"
          )
        ).find((el) => {
          const t = (el.textContent || "").toLowerCase();
          return (
            t.includes("wyświetl więcej komentarzy") ||
            t.includes("zobacz więcej komentarzy") ||
            t.includes("view more comments") ||
            t.includes("view previous comments")
          );
        });

        if (moreCommentsBtn) {
          let p = moreCommentsBtn.parentElement;
          while (p && p !== document.body && p !== document.documentElement) {
            const style = window.getComputedStyle(p);
            const oy = style.overflowY;
            const ch = p.clientHeight || 0;
            const sh = p.scrollHeight || 0;
            const delta = sh - ch;

            if (
              ch > 0 &&
              delta > 10 &&
              (oy === "auto" ||
                oy === "scroll" ||
                oy === "overlay" ||
                oy === "hidden")
            ) {
              container = p;
              containerType = isPhotoView ? "photo-comments" : "video-comments";
              break;
            }
            p = p.parentElement;
          }
        }

        // dodatkowa próba po nagłówku "Komentarze / Najtrafniejsze"
        if (!container && isVideoView) {
          const commentsHeader = Array.from(
            document.querySelectorAll("div, span")
          ).find((el) => {
            const t = (el.textContent || "").toLowerCase();
            return (
              (t.includes("komentarze") && t.includes("najtrafniejsze")) ||
              (t.includes("comments") && t.includes("most relevant")) ||
              t.trim() === "komentarze" ||
              t.trim() === "comments"
            );
          });

          if (commentsHeader) {
            let p = commentsHeader.parentElement;
            while (p && p !== document.body && p !== document.documentElement) {
              const style = window.getComputedStyle(p);
              const oy = style.overflowY;
              const ch = p.clientHeight || 0;
              const sh = p.scrollHeight || 0;
              const delta = sh - ch;

              if (
                ch > 0 &&
                delta > 10 &&
                (oy === "auto" ||
                  oy === "scroll" ||
                  oy === "overlay" ||
                  oy === "hidden")
              ) {
                container = p;
                containerType = "video-comments-header";
                break;
              }
              p = p.parentElement;
            }
          }
        }

        // NOWY FALLBACK – po polu "Napisz komentarz..."
        if (!container) {
          const commentBox = Array.from(
            document.querySelectorAll("div[role='textbox'], textarea")
          ).find((el) => {
            const label = (el.getAttribute("aria-label") || "").toLowerCase();
            const ph = (el.getAttribute("placeholder") || "").toLowerCase();
            const txt = (el.textContent || "").toLowerCase();

            const needles = [
              "napisz komentarz",
              "write a comment",
              "escribe un comentario",
              "schreibe einen kommentar",
            ];

            return needles.some((n) =>
              label.includes(n) || ph.includes(n) || txt.includes(n)
            );
          });

          if (commentBox) {
            let p = commentBox.parentElement;
            while (p && p !== document.body && p !== document.documentElement) {
              const style = window.getComputedStyle(p);
              const oy = style.overflowY;
              const ch = p.clientHeight || 0;
              const sh = p.scrollHeight || 0;
              const delta = sh - ch;

              if (
                ch > 0 &&
                delta > 10 &&
                (oy === "auto" ||
                  oy === "scroll" ||
                  oy === "overlay" ||
                  oy === "hidden")
              ) {
                container = p;
                containerType = isPhotoView
                  ? "photo-comments-textbox"
                  : "video-comments-textbox";
                break;
              }
              p = p.parentElement;
            }
          }
        }

        // jeśli na watch nic sensownego nie znaleźliśmy – dajemy spokój
        if (isVideoView && !container) {
          const cur = window.scrollY || 0;
          return {
            label: labelArg,
            container: "video-no-scroll",
            steps: 0,
            final: cur,
            maxScroll: 0,
            atBottom: true,
          };
        }
      }

      // Standardowa heurystyka (permalink / photo fallback)
      if (!container) {
        const root = rootFn() || document.body;
        const candidates = [];

        pushIfScrollable(candidates, root, "root");

        const dialog =
          root.closest("div[role='dialog']") ||
          document.querySelector("div[role='dialog']");
        if (dialog) {
          pushIfScrollable(candidates, dialog, "dialog");
        }

        const scope = dialog || root;
        const blocks = Array.from(
          scope.querySelectorAll("div, section, main, article")
        );
        for (const el of blocks) {
          pushIfScrollable(candidates, el, "auto");
        }

        let best = null;
        for (const c of candidates) {
          if (!best || c.delta > best.delta) {
            best = c;
          }
        }

        if (best) {
          container = best.el;
          containerType = best.label;
        } else {
          container =
            document.scrollingElement ||
            document.documentElement ||
            document.body;
          containerType = "window";
        }
      }

      // Zapamiętaj kontener komentarzy (jeśli to nie jest globalne okno)
      if (container) {
        const isRootContainer =
          container === document.body ||
          container === document.documentElement ||
          container === document.scrollingElement;

        if (!isRootContainer) {
          try {
            container.setAttribute("data-fbwatcher-comments", "1");
          } catch {}
        }
      }

      const isWindowContainer =
        container === document.body ||
        container === document.documentElement ||
        container === document.scrollingElement;

      // na watch nie ruszamy globalnego scrolla jeśli nie mamy innego kontenera
      if (isVideoView && isWindowContainer) {
        const cur = window.scrollY || 0;
        return {
          label: labelArg,
          container: "video-window-blocked",
          steps: 0,
          final: cur,
          maxScroll: 0,
          atBottom: true,
        };
      }

      let steps = 0;
      const maxSteps = 160;
      let lastPos = isWindowContainer
        ? window.scrollY || 0
        : container.scrollTop || 0;

      while (steps < maxSteps) {
        steps++;

        const maxScroll =
          (container.scrollHeight || 0) - (container.clientHeight || 0);
        const pos = isWindowContainer
          ? window.scrollY || 0
          : container.scrollTop || 0;

        // już na dole
        if (maxScroll <= 0 || pos >= maxScroll - 2) {
          return {
            label: labelArg,
            container: containerType || "unknown",
            steps,
            final: pos,
            maxScroll,
            atBottom: true,
          };
        }

        const baseStep =
          (container.clientHeight || window.innerHeight || 600) * 0.9;
        const step = Math.max(60, Math.min(baseStep, maxScroll - pos));

        if (isWindowContainer) {
          window.scrollTo(0, pos + step);
        } else {
          container.scrollTop = pos + step;
        }

        const afterPos = isWindowContainer
          ? window.scrollY || 0
          : container.scrollTop || 0;

        // brak ruchu mimo próby – uznajemy że jesteśmy na dole
        if (afterPos === lastPos) {
          return {
            label: labelArg,
            container: containerType || "unknown",
            steps,
            final: afterPos,
            maxScroll,
            atBottom: true,
          };
        }

        lastPos = afterPos;
      }

      const maxScrollFinal =
        (container.scrollHeight || 0) - (container.clientHeight || 0);
      const finalPos = isWindowContainer
        ? window.scrollY || 0
        : container.scrollTop || 0;

      return {
        label: labelArg,
        container: containerType || "unknown",
        steps,
        final: finalPos,
        maxScroll: maxScrollFinal,
        atBottom: finalPos >= maxScrollFinal - 2,
      };
    },
    label,
    postRootScript()
  );

  return info;
}


/* ============================================================
   ===================== VIDEO – AUTO PAUSE ====================
   ============================================================ */

async function pauseVideoIfAny(page) {
  try {
    await page.evaluate(() => {
      const vids = Array.from(document.querySelectorAll("video"));

      for (const v of vids) {
        try {
          v.autoplay = false;
          v.removeAttribute("autoplay");

          v.muted = true;
          v.pause();

          if (!isNaN(v.currentTime) && v.currentTime === 0) {
            v.currentTime = 0.01;
          }
        } catch (e) {}
      }
    });
    console.log("[FB] Video pause: zatrzymano wszystkie <video>.");
  } catch (e) {
    console.log("[FB] Video pause – błąd:", e?.message || e);
  }
}

/* ============================================================
   ======= BRUTALNA DOŻYNKA – LOAD MORE NA DOLE ================
   ============================================================ */

async function clickAllLoadMoreAtBottom(page, view, maxClicks = 300) {
  // Brutalna dożynka na dole – bez scrolla, tylko to, co widać
  return await page.evaluate(({ isVideo, max }) => {
    function normalize(text) {
      return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
    }

    // Szukamy sensownego roota z komentarzami
    function findCommentsRoot() {
      // Dla watch/reel FB często siedzi w głównej kolumnie
      const main = document.querySelector("div[role='main']");
      if (!main) return document.body;

      // Artykuł z komentarzami (photo/permalink) albo główna kolumna (video)
      const article = main.querySelector("article");
      if (article) return article;

      return main;
    }

    const root = findCommentsRoot();
    if (!root) return 0;

    let clicks = 0;

    for (let i = 0; i < max; i++) {
      const candidates = Array.from(
        root.querySelectorAll(
          "button,div[role='button'],span[role='button'],a[role='button']"
        )
      );

      const btn = candidates.find((el) => {
        const t = normalize(el.textContent);
        if (!t) return false;

        // Wszystkie nasze typy "load more"
        if (t.startsWith("wyświetl więcej komentarzy")) return true;
        if (t === "pokaż więcej odpowiedzi") return true;
        if (/^wyświetl wszystkie \d+ odpowiedzi$/.test(t)) return true;
        if (t === "wyświetl 1 odpowiedź") return true;

        // Dziwny format na watch/reel: "Bandyci drogowi odpowiedział(a) · 27 odpowiedzi"
        if (/odpowiedzi$/.test(t) && /odpowiedzi/.test(t) && t.includes("odpowiedział")) {
          return true;
        }

        return false;
      });

      if (!btn) break;

      const rect = btn.getBoundingClientRect();

      // Pilnujemy, żeby nie klikać czegoś poza ekranem
      if (rect.bottom < 0 || rect.top > window.innerHeight) break;

      btn.click();
      clicks++;
    }

    return clicks;
  }, { isVideo: !!view.isVideo, max: maxClicks });
}

/* ============================================================
   ======= AGRESYWNE DOŁADOWANIE WSZYSTKICH KOMENTARZY =========
   ============================================================ */

async function ensureAllCommentsLoaded(page, expectedTotal = null) {
  // expectedTotal tylko do logów – NIE jest twardym warunkiem stopu
  const hasTarget = typeof expectedTotal === "number" && expectedTotal > 0;

  const view = await page.evaluate(() => {
  const href = location.href;
  const isVideo = /\/watch\/|\/videos\/|[\?&]v=/i.test(href); // 👈 dodane /videos/
  const isPhoto = /[?&]fbid=|\/photo\.php|\/photo\?fbid=|\/photo\/\d/i.test(
    href
  );
  return { href, isVideo, isPhoto };
});

  console.log(
    "[FB] ensureAllCommentsLoaded – start",
    hasTarget ? `(target=${expectedTotal})` : "(bez targetu)",
    "| view:",
    view
  );

  const MAX_ROUNDS = view.isVideo ? 1500 : 2500;
  const MAX_NO_PROGRESS = 10; // ile rund bez progresu zanim uznamy, że koniec

  let noProgressRounds = 0;
  let roundsDone = 0;
  let lastAnchors = 0;
  let breakReason = "max-rounds";

  // helper – czy na stronie są jeszcze przyciski load-more/replies
  async function hasLoadMoreButtons() {
    return await page.evaluate(() => {
      const phrases = [
        "wyświetl więcej komentarzy",
        "wyświetl wszystkie",
        "wyświetl wszystkie odpowiedzi",
        "wyświetl odpowiedzi",
        "zobacz więcej komentarzy",
        "view more comments",
        "view more replies",
        "see more comments",
        "see more replies",
      ];

      const btns = Array.from(
        document.querySelectorAll("button, div[role='button'], span[role='button'], a")
      );

      return btns.some((el) => {
        const txt = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (!txt) return false;
        return phrases.some((p) => txt.includes(p));
      });
    });
  }

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const beforeAnchors = await getCurrentCommentAnchorCount(page);

    // scrollujemy TYLKO przez scrollWithinPost – on ogarnia kontener komentarzy
    const scrollInfo = await scrollWithinPost(
      page,
      `round-${round}`,
      view.isVideo ? 0.18 : 0.25
    );

    const clicks = await expandAllComments(page);
    const afterAnchors = await getCurrentCommentAnchorCount(page);
    const moreButtons = await hasLoadMoreButtons();

    const scrolled = scrollInfo.after !== scrollInfo.before;
    const progressed =
      scrolled || clicks > 0 || afterAnchors > beforeAnchors;

    if (progressed) {
      noProgressRounds = 0;
      lastAnchors = afterAnchors;
    } else {
      noProgressRounds++;
    }

    roundsDone = round;

    if (round === 1 || round % 25 === 0 || round > MAX_ROUNDS - 5) {
      console.log(
        `[FB] ensureAllCommentsLoaded – round ${round} ` +
          `container=${scrollInfo.container} ` +
          `scrollTop: ${scrollInfo.before} → ${scrollInfo.after} ` +
          `anchors: ${beforeAnchors} → ${afterAnchors} ` +
          `clicks=${clicks} noProgress=${noProgressRounds} moreButtons=${moreButtons}`
      );
    }

    // 1) jeśli mamy target i go osiągnęliśmy ORAZ nie ma przycisków – kończymy
    if (hasTarget && afterAnchors >= expectedTotal && !moreButtons) {
      breakReason = "target-reached-no-buttons";
      break;
    }

    // 2) jeśli nie ma przycisków i stoi w miejscu X rund – kończymy
    if (!moreButtons && noProgressRounds >= MAX_NO_PROGRESS) {
      breakReason = "no-buttons-no-progress";
      break;
    }

    // 3) twardy bez-progresu (na wszelki wypadek, gdyby FB coś odwalił)
    if (noProgressRounds >= MAX_NO_PROGRESS * 2) {
      breakReason = "hard-no-progress";
      break;
    }

    await sleepRandom(250, 600);
  }

  console.log(
    "[FB] ensureAllCommentsLoaded – główna pętla:",
    `reason=${breakReason}, rounds=${roundsDone}, anchors=${lastAnchors}${
      hasTarget ? `/target=${expectedTotal}` : ""
    }`
  );

  // Runda kontrolna w górę – domykamy expandy „u góry”
  try {
    let ctrlReason = "max-ctrl-rounds";
    for (let i = 1; i <= 200; i++) {
      const up = await scrollWithinPost(page, `ctrl-up-${i}`, -0.55);
      const clicked = await clickOneExpandButton(page);
      await sleepRandom(160, 320);

      if (up.after === 0) {
        ctrlReason = "top-reached";
        break;
      }

      if (up.after === up.before && !clicked) {
        ctrlReason = "no-move-no-click";
        break;
      }
    }
    console.log("[FB] ensureAllCommentsLoaded – runda kontrolna:", ctrlReason);
  } catch (e) {
    console.log(
      "[FB] ensureAllCommentsLoaded – błąd w rundzie kontrolnej:",
      e?.message || e
    );
  }

  // FINAŁ: dociągnięcie do dna używając TYLKO scrollWithinPost
  // – zero scrollowania document.scrollingElement
  let bottomClicks = 0;
  let lastBottomPos = null;
  let stableRounds = 0;

  try {
    for (let i = 1; i <= 400; i++) {
      const info = await scrollWithinPost(
        page,
        `final-bottom-${i}`,
        view.isVideo ? 0.6 : 0.8
      );

      if (lastBottomPos === info.after) {
        stableRounds++;
      } else {
        stableRounds = 0;
      }

      lastBottomPos = info.after;

      if (i === 1 || i % 50 === 0) {
        console.log(
          `[FB] ensureAllCommentsLoaded – final-bottom step ${i}: container=${info.container}, ` +
            `scrollTop: ${info.before} → ${info.after}`
        );
      }

      // 3 rundy z rzędu bez zmiany pozycji = prawdopodobnie dół kontenera komentarzy
      if (stableRounds >= 3) break;

      await sleepRandom(120, 260);
    }

    // jak już jesteśmy „na dole” kontenera, robimy ostatnią dożynkę przycisków
    const bottomExpand = await expandAllComments(page);
    const extraClicks = await clickAllLoadMoreAtBottom(page, view, 300);
    bottomClicks = bottomExpand + extraClicks;

    if (bottomClicks > 0) {
      console.log(
        `[FB] ensureAllCommentsLoaded – bottom pass: expand=${bottomExpand}, extra=${extraClicks}, total=${bottomClicks}`
      );
      await sleepRandom(700, 1300);
    }
  } catch (e) {
    console.log(
      "[FB] ensureAllCommentsLoaded – błąd przy final bottom:",
      e?.message || e
    );
  }

  const finalAnchors = await getCurrentCommentAnchorCount(page);
  console.log(
    "[FB] ensureAllCommentsLoaded – koniec. anchors=",
    finalAnchors,
    "bottomClicks=",
    bottomClicks
  );
}


async function clickMoreCommentsButtonsVideo(page, maxLoops = 80) {
  console.log(
    "[FB][more-comments] Start klikania 'Wyświetl więcej komentarzy / odpowiedzi' (video)…"
  );

  for (let i = 0; i < maxLoops; i++) {
    const result = await page.evaluate(() => {
      const norm = (s) =>
        (s || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      function getPostRoot() {
        // 1) overlay z postem / video
        const dialogs = Array.from(
          document.querySelectorAll("div[role='dialog']")
        );
        for (const dlg of dialogs) {
          const txt = (dlg.innerText || dlg.textContent || "").toLowerCase();
          if (!txt) continue;
          if (
            txt.includes("komentarz") ||
            txt.includes("comments") ||
            txt.includes("napisz komentarz")
          ) {
            const art = dlg.querySelector("article");
            return art || dlg;
          }
        }

        // 2) strona "Filmy" – główny artykuł
        const main = document.querySelector("main");
        if (main) {
          const art = main.querySelector("article");
          if (art) return art;
          return main;
        }

        // 3) fallback
        return document.body || document;
      }

      const root = getPostRoot();

      const MORE_COMMENTS_LABELS = [
        "wyświetl więcej komentarzy",
        "zobacz więcej komentarzy",
        "view more comments",
        "view previous comments",
        "see more comments",
      ];

      const REPLY_LABELS = [
        "wyświetl więcej odpowiedzi",
        "zobacz więcej odpowiedzi",
        "view more replies",
        "see more replies",
      ];

      const els = Array.from(
        root.querySelectorAll(
          "button, div[role='button'], span[role='button'], span"
        )
      );

      let target = null;
      let kind = null;

      // 1) priorytet: "Wyświetl więcej komentarzy"
      for (const el of els) {
        const txt = norm(el.textContent);
        if (!txt) continue;

        if (MORE_COMMENTS_LABELS.includes(txt)) {
          const rect = el.getBoundingClientRect();
          if (rect.bottom < 0 || rect.top > window.innerHeight) continue; // tylko to, co widać
          target = el;
          kind = "comments";
          break;
        }
      }

      // 2) jeśli nie ma "więcej komentarzy" – szukamy "więcej/X odpowiedzi"
      if (!target) {
        for (const el of els) {
          const txt = norm(el.textContent);
          if (!txt) continue;

          // "Wyświetl więcej odpowiedzi", "Zobacz więcej odpowiedzi"
          if (REPLY_LABELS.includes(txt)) {
            const rect = el.getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
            target = el;
            kind = "replies";
            break;
          }

          // "Sebastian ... · 12 odpowiedzi", "3 odpowiedzi", "5 replies"
          if (
            /(^|\s)\d+\s+(odpowiedź|odpowiedzi|replies)\b/.test(txt) ||
            (txt.includes(" replies") && /\d+/.test(txt))
          ) {
            const rect = el.getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
            target = el;
            kind = "replies";
            break;
          }
        }
      }

      if (!target) {
        return { clicked: false, kind: null };
      }

      try {
        target.scrollIntoView({ block: "center", inline: "nearest" });
      } catch (e) {
        // ignorujemy
      }

      if (typeof target.click === "function") {
        target.click();
        return { clicked: true, kind };
      }

      return { clicked: false, kind: null };
    });

    if (!result || !result.clicked) {
      if (i === 0) {
        console.log(
          "[FB][more-comments] Brak przycisków 'więcej komentarzy/odpowiedzi' – nic nie klikam."
        );
      } else {
        console.log(
          `[FB][more-comments] Brak kolejnych przycisków – zakończono po ${i} kliknięciach.`
        );
      }
      break;
    }

    const what =
      result.kind === "replies"
        ? "więcej odpowiedzi / X odpowiedzi"
        : "więcej komentarzy";

    console.log(
      `[FB][more-comments] Kliknięto '${what}' (iteracja ${i + 1}/${maxLoops}).`
    );

    // krótka pauza po kliknięciu
    await sleepRandom(900, 1600);

    // mały scroll w dół w panelu komentarzy – bez ogromnych skoków
    try {
      await scrollWithinPost(page, `video-more-${i + 1}`, 0.18);
    } catch (e) {
      console.log(
        "[FB][more-comments] scrollWithinPost(video) – błąd:",
        e?.message || e
      );
    }

    await sleepRandom(800, 1400);
  }

  console.log(
    `[FB][more-comments] Zakończono sekwencję video (maxLoops=${maxLoops}).`
  );
}



async function walkVideoCommentsSequential(page, maxCycles = 40) {
  console.log("[FB][video-walk] start – sekwencyjny spacer po komentarzach (VIDEO)…");

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    const result = await page.evaluate(() => {
      const norm = (s) =>
        (s || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      function getPostRoot() {
        // 1) dialog z postem / overlay
        const dialogs = Array.from(
          document.querySelectorAll("div[role='dialog']")
        );
        for (const dlg of dialogs) {
          const txt = (dlg.innerText || dlg.textContent || "").toLowerCase();
          if (!txt) continue;
          if (
            txt.includes("komentarz") ||
            txt.includes("comments") ||
            txt.includes("napisz komentarz")
          ) {
            const art = dlg.querySelector("article");
            return art || dlg;
          }
        }

        // 2) klasyczna strona „Filmy”
        const main = document.querySelector("main, div[role='main']");
        if (main) {
          const art = main.querySelector("article");
          return art || main;
        }

        return document.body || document;
      }

      function getCommentsContainer(root) {
        const divs = Array.from(root.querySelectorAll("div"));
        let best = null;
        let bestScore = 0;

        for (const el of divs) {
          const style = window.getComputedStyle(el);
          if (!style) continue;

          const oy = style.overflowY;
          const h = el.clientHeight || 0;
          const sh = el.scrollHeight || 0;

          if (
            (oy === "auto" || oy === "scroll") &&
            sh > h + 40
          ) {
            const text = (el.innerText || "").toLowerCase();
            if (
              text.includes("komentarz") ||
              text.includes("comment") ||
              text.includes("napisz komentarz")
            ) {
              const score = sh;
              if (score > bestScore) {
                bestScore = score;
                best = el;
              }
            }
          }
        }

        return best || root;
      }

      function clickMoreCommentsOnce(root) {
        const LABELS = [
          "wyświetl więcej komentarzy",
          "zobacz więcej komentarzy",
          "view more comments",
          "see more comments",
        ];

        const buttons = Array.from(
          root.querySelectorAll(
            "button, div[role='button'], span[role='button'], span"
          )
        );

        for (const el of buttons) {
          const txt = norm(el.textContent);
          if (!txt) continue;
          if (LABELS.includes(txt)) {
            try {
              el.scrollIntoView({ block: "center", inline: "nearest" });
            } catch (e) {}
            if (typeof el.click === "function") el.click();
            return true;
          }
        }

        return false;
      }

      function expandReplies(root, limit = 15) {
        const buttons = Array.from(
          root.querySelectorAll(
            "button, div[role='button'], span[role='button'], span"
          )
        );

        let clicked = 0;

        for (const el of buttons) {
          const txt = norm(el.textContent);
          if (!txt) continue;

          // „Wyświetl więcej odpowiedzi”, „Zobacz więcej odpowiedzi”, „View more replies”
          const isMoreReplies =
            txt.includes("więcej odpowiedzi") ||
            txt.includes("more replies") ||
            txt.includes("view previous replies") ||
            txt.includes("zobacz odpowiedzi");

          // „12 odpowiedzi”, „3 odpowiedzi”, „2 replies”
          const isCountReplies = /\d+\s+(odpowiedź|odpowiedzi|replies)\b/.test(
            txt
          );

          if (!isMoreReplies && !isCountReplies) continue;

          try {
            el.scrollIntoView({ block: "center", inline: "nearest" });
          } catch (e) {}

          if (typeof el.click === "function") {
            el.click();
            clicked++;
            if (clicked >= limit) break;
          }
        }

        return clicked;
      }

      function scrollComments(container) {
        const before = container.scrollTop || 0;
        const step = Math.max(200, (container.clientHeight || 0) * 0.7);
        const target = Math.min(
          before + step,
          (container.scrollHeight || 0)
        );
        container.scrollTop = target;
        const after = container.scrollTop || 0;
        return { before, after };
      }

      const root = getPostRoot();
      const container = getCommentsContainer(root);

      // 1) klikamy „Wyświetl więcej komentarzy” TYLKO RAZ w tym cyklu
      const clickedMore = clickMoreCommentsOnce(root);

      // 2) rozwijamy widoczne „X odpowiedzi” / „więcej odpowiedzi”
      const repliesClicked = expandReplies(root, 20);

      // 3) scroll w dół panela komentarzy
      const scrollRes = scrollComments(container);

      const hasButtons = clickedMore || repliesClicked > 0;
      const scrolled = scrollRes.after !== scrollRes.before;

      return {
        clickedMore,
        repliesClicked,
        scrolled,
        hasButtons,
      };
    });

    console.log(
      `[FB][video-walk] cycle ${cycle}: more=${result.clickedMore}, replies=${result.repliesClicked}, scrolled=${result.scrolled}`
    );

    // warunek wyjścia: brak guzików i scroll nic nie zmienił
    if (!result.hasButtons && !result.scrolled) {
      console.log(
        "[FB][video-walk] stop – brak 'więcej komentarzy/odpowiedzi' i nie ma gdzie scrollować."
      );
      break;
    }

    await sleepRandom(1200, 2000);
  }

  console.log("[FB][video-walk] koniec spaceru po komentarzach VIDEO.");
}


/* ============================================================
   ==================== LICZBA KOMENTARZY ======================
   ============================================================ */

async function getCommentCount(page, postUrl) {
  console.log(`[FB] Otwieranie posta: ${postUrl}`);

  // 1) wchodzimy na posta przez safeGoto (z retry)
  const ok = await safeGoto(page, postUrl, "post", {
    // dla liczników lepiej ładniej dociągnąć wszystko
    waitUntil: "networkidle2",
    timeout: NAV_TIMEOUT_MS, // 👈 stała z góry pliku
  });

  if (!ok) {
    // watcher będzie mógł rozpoznać ten typ błędu
    throw new Error("safeGoto-failed");
  }

  // 2) Fallback – FB zamiast posta mógł od razu dać /login?next=...
  let currentUrl = page.url();
  if (currentUrl.includes("/login")) {
    console.log(
      "[FB] Zamiast posta wylądowałem na /login?next=... – próbuję fbLogin() i wracam na posta."
    );

    await fbLogin(page);
    await sleepRandom(3000, 4500);

    const loggedAfterLogin = await checkIfLogged(page).catch(() => false);
    console.log(
      "[FB] Stan sesji po fbLogin() z /login:",
      loggedAfterLogin ? "ZALOGOWANY" : "NIEZALOGOWANY"
    );

    if (loggedAfterLogin) {
      await safeGoto(page, postUrl, "post", {
        waitUntil: "networkidle2",
        timeout: NAV_TIMEOUT_MS,
      });
    } else {
      console.log(
        "[FB] Po fbLogin() z /login nadal wyglądamy na niezalogowanych (prawdopodobnie 2FA) – kontynuuję jako gość."
      );
    }
  }

  // 3) Cookies przy pierwszym wejściu na posta
  await acceptCookies(page, "post-initial");

  // 4) NOWY SCENARIUSZ:
  //    jesteśmy na poście (tak jak na Twoim screenie – dialog + pasek "Zaloguj się" u góry),
  //    ale nie ma /login w URL → sprawdzamy sesję ręcznie.
  let loggedOnPost = false;
  try {
    loggedOnPost = await checkIfLogged(page);
  } catch (e) {
    console.log(
      "[FB] checkIfLogged na widoku posta – błąd:",
      e?.message || e
    );
  }

  if (!loggedOnPost) {
    console.log(
      "[FB] Na widoku posta brak aktywnej sesji (np. pasek 'Zaloguj się') – próbuję fbLogin() i wracam na posta."
    );

    await fbLogin(page);
    await sleepRandom(3000, 4500);

    const loggedAfterFbLogin = await checkIfLogged(page).catch(() => false);
    console.log(
      "[FB] Stan sesji po fbLogin() z widoku posta:",
      loggedAfterFbLogin ? "ZALOGOWANY" : "NIEZALOGOWANY"
    );

    if (loggedAfterFbLogin) {
      console.log(
        "[FB] Po fbLogin() wykryto zalogowanego użytkownika – ponownie otwieram posta."
      );
      await safeGoto(page, postUrl, "post", {
        waitUntil: "networkidle2",
        timeout: NAV_TIMEOUT_MS,
      });

      // po ponownym wejściu jeszcze raz łapiemy cookies z widoku posta
      await acceptCookies(page, "post-initial");
    } else {
      console.log(
        "[FB] Po fbLogin() nadal wyglądamy na niezalogowanych (prawdopodobnie 2FA) – kontynuuję jako gość."
      );
    }
  }

  // 5) Próba ogarnięcia nakładki "Wyświetl więcej na Facebooku" (jeśli występuje)
  await ensureLoggedInOnPostOverlay(page);

  // --- PAUZA NA 2FA / przeładowanie widoku po ewentualnym logowaniu z nakładki ---
  await sleepRandom(3000, 4500);

  // 6) Cookies po ustabilizowaniu widoku posta
  await acceptCookies(page, "post");

  // 🔐 Po próbie logowania (fbLogin + nakładka) sprawdzamy, czy faktycznie jesteśmy zalogowani.
  // Jeśli tak – zapisujemy cookies, żeby kolejne uruchomienia mogły użyć tej sesji.
  try {
    const loggedAfterPostOverlay = await checkIfLogged(page);
    if (loggedAfterPostOverlay) {
      console.log(
        "[FB] Po wejściu na posta jesteśmy zalogowani – zapisuję cookies do cookies.json."
      );
      await saveCookies(page);
    } else {
      console.log(
        "[FB] Po wejściu na posta nadal wyglądamy na niezalogowanych – cookies nie będą zapisane."
      );
    }
  } catch (e) {
    console.log(
      "[FB] Błąd podczas sprawdzania/zapisu cookies po wejściu na posta:",
      e?.message || e
    );
  }

  // 7) Reszta funkcji – BEZ ZMIAN względem tego, co miałeś

  await sleepRandom(1500, 2500);

    const isVideoView = /\/watch\/|\/videos\/|[\?&]v=/i.test(postUrl);
  const isPhotoView = /[?&]fbid=|\/photo\.php|\/photo\?fbid=|\/photo\/\d/i.test(
    postUrl
  );
  console.log(
    "[FB] getCommentCount – view type:",
    isVideoView ? "VIDEO" : isPhotoView ? "PHOTO" : "POST"
  );

  if (isVideoView) {
    await pauseVideoIfAny(page);
    // 🔴 NOWOŚĆ: przy video w overlayu klikamy "Pokaż wszystkie", jeśli trzeba
    await clickShowAllCommentsIfPresent(page);
  }

  if (!isVideoView) {
    await scrollPost(page, 200);
    await sleepRandom(800, 1200);
  }


  

  // 1) Pierwsza próba ustawienia filtra
  try {
    const okFilter = await switchCommentsFilterToAll(page);
    console.log(
      "[FB] Pierwsza próba ustawienia filtra na 'Wszystkie komentarze':",
      okFilter
    );
    if (okFilter) await sleepRandom(1200, 2000);
  } catch (e) {
    console.log(
      "[FB] Błąd switchCommentsFilterToAll (pierwsza próba):",
      e.message
    );
  }

  if (isVideoView) {
    await pauseVideoIfAny(page);
  }

    // ========= UI PARSER – liczymy z całego dokumentu (przed doładowaniem) =========
  const uiInfo = await getUiCommentInfo(page);

  console.log("[DBG] Comments debug (skrócone):", {
    source: uiInfo?.source,
    raw: uiInfo?.raw,
    viewType: uiInfo?.viewType,
    comments: uiInfo?.comments,
  });

  let expectedTotal = null;
  if (uiInfo && typeof uiInfo.comments === "number" && uiInfo.comments > 0) {
    expectedTotal = uiInfo.comments;
  }

  // 🔥 VIDEO: najpierw agresywnie klikamy "Wyświetl więcej komentarzy",
  // dopiero potem uruchamiamy główny loader scrollujący.
  if (isVideoView) {
    await clickMoreCommentsButtonsVideo(page);
  }

  // 2) Doładowanie komentarzy – target z UI tylko jako orientacja
    // 2) Doładowanie komentarzy – dla VIDEO osobny spacer, reszta starym loaderem
  if (isVideoView) {
    await walkVideoCommentsSequential(page, expectedTotal || null);
  } else {
    await ensureAllCommentsLoaded(page, expectedTotal);
  }



  // 3) Druga próba filtra – na wypadek zmiany layoutu
  try {
    const ok2 = await switchCommentsFilterToAll(page);
    console.log(
      "[FB] Druga próba ustawienia filtra na 'Wszystkie komentarze':",
      ok2
    );
    if (ok2) await sleepRandom(800, 1500);
  } catch (e) {
    console.log(
      "[FB] Błąd switchCommentsFilterToAll (druga próba):",
      e.message
    );
  }

  // ========= FALLBACK ANCHORÓW – TEŻ CAŁY DOCUMENT =========
  const fallback = await page.evaluate(() => {
    const root = document;

    const anchors = Array.from(
      root.querySelectorAll("a[href*='comment_id'], a[href*='reply_comment_id']")
    );

    const ids = new Set();

    for (const a of anchors) {
      try {
        const url = new URL(a.href);
        const cid = url.searchParams.get("comment_id");
        const rid = url.searchParams.get("reply_comment_id");
        let raw = rid || cid;
        if (!raw) continue;

        if (!/^\d+$/.test(raw)) {
          try {
            const dec = atob(raw);
            const m = dec.match(/:(\d+)_([0-9]+)/);
            if (m) raw = m[2];
          } catch {}
        }

        if (raw) ids.add(raw);
      } catch {}
    }

    return { count: ids.size };
  });

  console.log("[FB] Fallback – anchor IDs:", fallback.count);

  let finalNum = uiInfo?.comments ?? null;


  if (fallback.count > 0) {
    if (finalNum == null || finalNum === 0) {
      finalNum = fallback.count;
      console.log(
        "[FB] UI puste/0 – używam anchorów jako źródła.",
        `anchor=${fallback.count}`
      );
    } else {
      const diff = finalNum - fallback.count;

      if (diff > 5) {
        console.log(
          "[FB] UI >> anchory – część komentarzy niedostępna, używam anchorów.",
          `ui=${finalNum}, anchor=${fallback.count}`
        );
        finalNum = fallback.count;
      } else if (fallback.count > finalNum) {
        console.log(
          "[FB] Anchory > UI – używam anchorów jako bazowej liczby.",
          `ui=${finalNum}, anchor=${fallback.count}`
        );
        finalNum = fallback.count;
      } else {
        console.log(
          "[FB] UI ~= anchory – zostawiam UI jako źródło.",
          `ui=${finalNum}, anchor=${fallback.count}`
        );
      }
    }
  } else {
    console.log("[FB] Anchory=0 – opieram się wyłącznie na UI:", finalNum);
  }

  if (finalNum != null) {
    console.log("[FB] Liczba komentarzy (final):", finalNum);
    return finalNum;
  }

  console.log("[FB] Brak liczby komentarzy w UI i brak anchorów, zwracam 0.");
  return 0;
}


/* ============================================================
   ================= ROZWIJANIE KOMENTARZY ====================
   ============================================================ */

async function expandAllComments(page) {
  if (!EXPAND_COMMENTS) {
    console.log("[FB] EXPAND_COMMENTS=false → pomijam rozwijanie.");
    return 0;
  }

  let clicks = 0;

  for (let i = 0; i < 30; i++) {
    const didClick = await clickOneExpandButton(page);
    if (!didClick) break;
    clicks++;
    await sleepRandom(900, 1600);
  }

  return clicks;
}

/* ============================================================
   ================== EXTRACT COMMENTS DATA ====================
   ============================================================ */

async function extractCommentsData(page) {
  if (!EXPAND_COMMENTS) return [];

  const data = await page.evaluate(() => {
    function looksLikeTime(t) {
  const lower = t.toLowerCase();
  if (!lower) return false;

  if (
    /\b(min|minut|godz|h|hr|dzień|dni|day|days|tyg|week|weeks|sek|s ago|m ago|h ago|d ago)\b/.test(
      lower
    )
  ) return true;

  if (/\b(wczoraj|yesterday)\b/.test(lower)) return true;
  if (/^\d+\s*(s|min|h|d)\b/.test(lower)) return true;

  return false;
}


    function stripUiWords(str, timeText, author) {
      if (!str) return "";

      let out = str;

      if (author) {
        const escaped = author.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        out = out.replace(new RegExp(escaped, "g"), "");
      }

      if (timeText) {
        const escapedTime = timeText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        out = out.replace(new RegExp(escapedTime, "g"), "");
      }

      out = out.replace(
        /\b(\d+\s*(s|min|minut|godz|h|hr|dni|day|days|tyg|week|weeks)\b|wczoraj|yesterday)\b/gi,
        ""
      );

      out = out.replace(/lubię to!?/gi, "");
      out = out.replace(/(like|odpowiedz|reply)/gi, "");
      out = out.replace(/(komentarz|komentarze|udostępnij|share)/gi, "");

      out = out.replace(/\s+/g, " ").trim();
      return out;
    }

    const anchors = Array.from(
      document.querySelectorAll(
        "a[href*='comment_id'], a[href*='reply_comment_id']"
      )
    );

    const byId = new Map();

    for (const a of anchors) {
      const href = a.href;
      let rawId = null;

      try {
        const url = new URL(href);
        const c = url.searchParams.get("comment_id");
        const r = url.searchParams.get("reply_comment_id");
        rawId = r || c;
      } catch {
        continue;
      }

      if (!rawId) continue;

      let commentId = rawId;

      if (!/^\d+$/.test(commentId)) {
        try {
          const decoded = atob(commentId);
          const m = decoded.match(/_(\d+)$/);
          if (m) commentId = m[1];
        } catch {}
      }

      let block =
        a.closest("div[aria-label*='Komentarz']") ||
        a.closest("div[aria-label*='comment']") ||
        a.closest("li") ||
        a.closest("[role='article']") ||
        a.parentElement;

      if (!block) block = a.parentElement;

      const rawTime = (a.innerText || a.textContent || "").trim();
      let timeText = looksLikeTime(rawTime) ? rawTime : "";

      if (!timeText && block) {
        const t = Array.from(block.querySelectorAll("a, span, time"))
          .map((el) => (el.textContent || "").trim())
          .find((txt) => looksLikeTime(txt));
        if (t) timeText = t;
      }

      let author = null;
      if (block) {
        const links = Array.from(block.querySelectorAll("a"));
        for (const l of links) {
          const t = (l.innerText || l.textContent || "").trim();
          if (!t) continue;

          const low = t.toLowerCase();
          if (
            low === "lubię to!" ||
            low === "lubię to" ||
            low === "like" ||
            low === "odpowiedz" ||
            low === "reply"
          )
            continue;
          if (looksLikeTime(t)) continue;

          author = t;
          break;
        }
      }

      let finalText = "";
      let pos = null;

      if (block) {
        try {
          const rect = block.getBoundingClientRect();
          pos = Math.round(rect.top + window.scrollY);
        } catch {}

        const candidates = [];

        const divs = Array.from(
          block.querySelectorAll("div[dir='auto'], span[dir='auto'], p")
        );

        for (const el of divs) {
          let raw = (el.textContent || "").trim();
          if (!raw) continue;

          if (raw === author) continue;
          if (raw === timeText) continue;
          if (looksLikeTime(raw)) continue;

          const txt = stripUiWords(raw, timeText, author);
          if (!txt) continue;

          const isBtn = el.closest("button,[role='button']");
          if (isBtn) continue;

          candidates.push(txt);
        }

        if (candidates.length > 0) {
          finalText = candidates.reduce(
            (acc, cur) => (cur.length > acc.length ? cur : acc),
            ""
          );
        }

        if (!finalText) {
          let fallback = (block.innerText || "").trim();
          fallback = stripUiWords(fallback, timeText, author);
          finalText = fallback;
        }
      }

      const existing = byId.get(commentId) || {};

      byId.set(commentId, {
        id: commentId,
        author: author || existing.author || null,
        text: finalText || existing.text || "",
        time: timeText || existing.time || "",
        permalink: href,
        pos: pos ?? existing.pos ?? null,
      });
    }

    
  // ⬇️ czyścimy wynik z pustych śmieci (brak tekstu, ID, linka)
  const cleaned = data.filter((c) => {
    const hasText = c.text && c.text.trim().length > 0;
    const hasId = c.id && String(c.id).trim().length > 0;
    const hasLink = c.permalink && c.permalink.trim().length > 0;
    return hasText || hasId || hasLink;
  });

  console.log(
    "[DBG] extractCommentsData – raw:",
    data.length,
    "po czyszczeniu:",
    cleaned.length
  );

  console.log(
    "[FB] extractCommentsData – wyciągnięto komentarzy:",
    cleaned.length
  );
  




    return Array.from(byId.values());
  });

  console.log("[FB] extractCommentsData – wyciągnięto komentarzy:", data.length);
  return data;
}

export { getCommentCount, expandAllComments, extractCommentsData };
