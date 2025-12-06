// src/fb/comments.js
import { EXPAND_COMMENTS } from "../config.js";
import { sleepRandom } from "../utils/sleep.js";
import { scrollPost } from "./scroll.js";
import { acceptCookies } from "./cookies.js";
import { ensureLoggedInOnPostOverlay } from "./login.js";
import { clickOneExpandButton } from "./expandButtons.js";

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
   ======= AGRESYWNE DOŁADOWANIE WSZYSTKICH KOMENTARZY =========
   ============================================================ */

async function ensureAllCommentsLoaded(page, expectedTotal = null) {
  const hasTarget = typeof expectedTotal === "number" && expectedTotal > 0;

  // Rozpoznaj widok po aktualnym URL (wewnątrz strony)
  const view = await page.evaluate(() => {
    const href = location.href;
    const isVideo = /\/watch\/|[\?&]v=/i.test(href);
    const isPhoto = /[?&]fbid=|\/photo\.php|\/photo\?fbid=|\/photo\/\d/i.test(href);
    return { href, isVideo, isPhoto };
  });

  console.log(
    "[FB] ensureAllCommentsLoaded – start",
    hasTarget ? `(target=${expectedTotal})` : "(bez targetu)",
    "| view:",
    view
  );

  // dla VIDEO zwiększamy limit rund, bo potrafi ładować po kawałku
  const MAX_ROUNDS = view.isVideo ? 1200 : 800;
  const MAX_NO_PROGRESS = 12;

  let lastCount = 0;
  let noProgressRounds = 0;
  let breakReason = "max-rounds";
  let roundsDone = 0;
  let targetHitRound = null;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const beforeCount = await getCurrentCommentAnchorCount(page);

    const scrollInfo = await scrollWithinPost(
      page,
      `round-${round}`,
      view.isVideo ? 0.18 : 0.25
    );

    // lekkie odsapnięcie żeby FB zdążył dociągnąć kontent
    await sleepRandom(180, 320);

    // rozwijamy przyciski "Wyświetl więcej komentarzy / odpowiedzi"
    await expandAllComments(page);

    const afterCount = await getCurrentCommentAnchorCount(page);

    const progressed =
      afterCount > lastCount ||
      afterCount > beforeCount ||
      (scrollInfo.after !== scrollInfo.before &&
        !String(scrollInfo.container || "").includes("no-scroll"));

    if (progressed) {
      lastCount = Math.max(lastCount, afterCount);
      noProgressRounds = 0;
    } else {
      noProgressRounds++;
    }

    roundsDone = round;

    if (hasTarget && afterCount >= expectedTotal && targetHitRound === null) {
      targetHitRound = round;
    }

    // log co kilka rund + zawsze ostatnie 5
    if (round % 25 === 0 || round > MAX_ROUNDS - 5) {
      console.log(
        `[FB] ensureAllCommentsLoaded – round ${round} container: ${scrollInfo.container} before/after: ${scrollInfo.before} → ${scrollInfo.after} anchors: ${beforeCount} → ${afterCount} noProgress: ${noProgressRounds}`
      );
    }

    // jeśli przez X rund nic się realnie nie zmienia – wychodzimy
    if (noProgressRounds >= MAX_NO_PROGRESS) {
      breakReason = "no-progress";
      break;
    }
  }

  console.log(
    "[FB] ensureAllCommentsLoaded – główna pętla:",
    `reason=${breakReason}, rounds=${roundsDone}, anchors=${lastCount}${
      hasTarget
        ? `/target=${expectedTotal}, targetHitRound=${targetHitRound || "never"}`
        : ""
    }`
  );

  // Runda kontrolna – jazda w górę, szukanie "Wyświetl X odpowiedzi"
  try {
    let ctrlReason = "max-ctrl-rounds";
    for (let i = 1; i <= 400; i++) {
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

  // Finał – dociągnięcie do absolutnego dołu panelu komentarzy
  try {
    const bottom = await scrollToAbsoluteBottom(page, "final-bottom");
    console.log("[FB] ensureAllCommentsLoaded – final bottom:", bottom);
  } catch (e) {
    console.log(
      "[FB] ensureAllCommentsLoaded – błąd przy final bottom:",
      e?.message || e
    );
  }

  const finalCount = await getCurrentCommentAnchorCount(page);

  console.log(
    "[FB] ensureAllCommentsLoaded – koniec.",
    `reason=${breakReason}, anchors=${finalCount}`
  );
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

/* ============================================================
   ===== POMOCNICZE: SCROLL W OBRĘBIE POSTA ====================
   ============================================================ */

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
      const isVideoView = /\/watch\/|[\?&]v=/i.test(href);

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

      // ===== PHOTO / VIDEO – najpierw próbujemy "oficjalny" panel komentarzy =====
      if (isPhotoView || isVideoView) {
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
      const isVideoView = /\/watch\/|[\?&]v=/i.test(href);

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

      // PHOTO / VIDEO – najpierw próbujemy znaleźć panel komentarzy
      if (isPhotoView || isVideoView) {
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
   ==================== LICZBA KOMENTARZY ======================
   ============================================================ */

async function getCommentCount(page, postUrl) {
  console.log(`[FB] Otwieranie posta: ${postUrl}`);

  await page.goto(postUrl, { waitUntil: "networkidle2", timeout: 60000 });
  await sleepRandom(3000, 4500);

  await acceptCookies(page, "post-initial");
  await ensureLoggedInOnPostOverlay(page);
  await acceptCookies(page, "post");
  await sleepRandom(1500, 2500);

  const isVideoView = /\/watch\/|[\?&]v=/i.test(postUrl);
  const isPhotoView = /[?&]fbid=|\/photo\.php|\/photo\?fbid=|\/photo\/\d/i.test(
    postUrl
  );
  console.log(
    "[FB] getCommentCount – view type:",
    isVideoView ? "VIDEO" : isPhotoView ? "PHOTO" : "POST"
  );

  if (isVideoView) {
    await pauseVideoIfAny(page);
  }

  if (!isVideoView) {
    await scrollPost(page, 200);
    await sleepRandom(800, 1200);
  }

  // 1) Pierwsza próba ustawienia filtra
  try {
    const ok = await switchCommentsFilterToAll(page);
    console.log(
      "[FB] Pierwsza próba ustawienia filtra na 'Wszystkie komentarze':",
      ok
    );
    if (ok) await sleepRandom(1200, 2000);
  } catch (e) {
    console.log("[FB] Błąd switchCommentsFilterToAll (pierwsza próba):", e.message);
  }

  if (isVideoView) {
    await pauseVideoIfAny(page);
  }

  // ========= UI PARSER – liczymy z całego dokumentu (przed doładowaniem) =========
  const uiInfo = await page.evaluate(() => {
    const debug = {};

    const isPhotoView = /[?&]fbid=|\/photo\.php|\/photo\?fbid=|\/photo\/\d/i.test(
      location.href
    );
    const isVideoView = /\/watch\/|[\?&]v=/i.test(location.href);

    debug.isPhotoView = isPhotoView;
    debug.isVideoView = isVideoView;

    const root = document;
    debug.rootTag = root.tagName || "DOCUMENT";

    const allEls = Array.from(root.querySelectorAll("span, div, button, a"));

    const globalTexts = allEls
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);

    const btnEls = Array.from(
      root.querySelectorAll("button, div[role='button'], span[role='button']")
    );

    const btnTexts = btnEls
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);

    debug.globalSample = globalTexts.slice(0, 30);
    debug.buttonTextsSample = btnTexts.slice(0, 20);

    // PHOTO – heurystyka: po "Wszystkie reakcje" pierwszy numerek to liczba komentarzy
    function fromPhotoTopBlock(buttonTexts) {
      if (!isPhotoView) return null;

      const idx = buttonTexts.findIndex((t) => {
        const low = t.toLowerCase();
        return (
          low.includes("wszystkie reakcje") ||
          low.includes("all reactions")
        );
      });
      if (idx === -1) return null;

      const tail = buttonTexts.slice(idx + 1, idx + 8);
      const firstNum = tail.find((t) => /^\d+$/.test(t));
      if (!firstNum) return null;

      const num = parseInt(firstNum, 10);
      if (!Number.isFinite(num) || num <= 0) return null;

      return { num, raw: tail.join(",") };
    }

    function fromAllCommentsButton(buttonTexts) {
      const idx = buttonTexts.findIndex((t) => {
        const low = t.toLowerCase();
        return low === "wszystkie komentarze" || low === "all comments";
      });
      if (idx === -1) return null;

      const numericCandidates = [];
      for (let i = idx - 3; i <= idx + 3; i++) {
        if (i < 0 || i >= buttonTexts.length || i === idx) continue;
        const t = buttonTexts[i];
        if (!t) continue;
        const m = t.match(/^\d+$/);
        if (m) numericCandidates.push(parseInt(m[0], 10));
      }
      if (!numericCandidates.length) return null;
      const best = Math.max(...numericCandidates);
      return { num: best, raw: numericCandidates.join(",") };
    }

    function fromFilterLinkedCount(buttonTexts) {
      const filterIdx = buttonTexts.findIndex((t) => {
        const low = t.toLowerCase();
        return (
          low === "najtrafniejsze" ||
          low === "most relevant" ||
          low === "wszystkie komentarze" ||
          low === "all comments"
        );
      });

      if (filterIdx === -1) return null;

      for (let i = filterIdx - 1; i >= 0; i--) {
        const txt = buttonTexts[i];
        if (!txt) continue;
        const lower = txt.toLowerCase();

        if (!lower.includes("komentarz") && !lower.includes("comment")) {
          continue;
        }

        const m = lower.match(
          /(\d+(?:[.,]\d+)?)(?:\s*(tys\.|k))?\s+(komentarz|komentarze|komentarzy|comment|comments)\b/
        );
        if (!m) continue;

        let n = parseFloat(m[1].replace(",", "."));
        if (m[2]) n *= 1000;
        n = Math.round(n);

        return { num: n, raw: txt };
      }

      return null;
    }

    function fromReactionsBlock(allTexts) {
      const idx = allTexts.findIndex((t) => {
        const lower = t.toLowerCase();
        return (
          lower.includes("wszystkie reakcje") ||
          lower.includes("all reactions")
        );
      });
      if (idx === -1) return null;

      const tail = allTexts.slice(idx + 1, idx + 10);

      const likeIdx = tail.findIndex((t) => {
        const lower = t.toLowerCase();
        return (
          lower.includes("lubię to") ||
          lower.includes("like") ||
          lower.includes("polub")
        );
      });
      const segment = likeIdx === -1 ? tail : tail.slice(0, likeIdx);

      const nums = segment
        .map((t) => t.trim())
        .filter((t) => /^\d+$/.test(t))
        .map((t) => parseInt(t, 10))
        .filter((n) => Number.isFinite(n) && n >= 0);

      if (!nums.length) return null;

      let chosen = null;
      if (nums.length >= 2) {
        chosen = nums[1];
      } else {
        chosen = nums[0];
      }

      return { num: chosen, raw: nums.join(",") };
    }

    function parsePhrase(texts) {
      let best = null;
      let raw = null;

      for (const t of texts) {
        const lower = t.toLowerCase();

        if (
          lower.includes("wszystkie reakcje") ||
          lower.includes("all reactions")
        ) {
          continue;
        }
        if (!lower.includes("komentarz") && !lower.includes("comment")) continue;
        if (
          lower.startsWith("zobacz jeszcze") ||
          lower.startsWith("wyświetl jeszcze") ||
          lower.startsWith("view more")
        )
          continue;

        const m = lower.match(
          /(\d+(?:[.,]\d+)?)(?:\s*(tys\.|k))?\s+(komentarz|komentarze|komentarzy|comment|comments)\b/
        );
        if (!m) continue;

        let n = parseFloat(m[1].replace(",", "."));
        if (m[2]) n *= 1000;
        n = Math.round(n);

        best = n;
        raw = t;
      }

      return best != null ? { num: best, raw } : null;
    }

    function parseXofY(texts) {
      let best = null;
      let raw = null;
      for (const t of texts) {
        const lower = t.toLowerCase();
        const m = lower.match(
          /(\d+)\s*z\s*(\d+)\s+(komentarz|komentarze|komentarzy|comment|comments)\b/
        );
        if (!m) continue;

        const total = parseInt(m[2], 10);
        if (!Number.isFinite(total) || total <= 0) continue;

        if (best === null || total > best) {
          best = total;
          raw = t;
        }
      }
      return best != null && best > 0 ? { num: best, raw } : null;
    }

    function digitNearComment(allElements) {
      let near = null;
      for (const el of allElements) {
        const txt = (el.textContent || "").trim();
        if (!/^\d+$/.test(txt)) continue;
        const parent = el.parentElement;
        if (!parent) continue;
        const block = (parent.innerText || "").toLowerCase();
        if (block.includes("komentarz") || block.includes("comment")) {
          const n = parseInt(txt, 10);
          if (!near || n > near) near = n;
        }
      }
      return near;
    }

    const allTexts = [...globalTexts, ...btnTexts];

    // 1) PHOTO – najpierw próbujemy topowy blok po "Wszystkie reakcje"
    const photoRes = fromPhotoTopBlock(btnTexts);
    if (photoRes)
      return {
        num: photoRes.num,
        debug: { ...debug, source: "photoTopBlock", raw: photoRes.raw },
      };

    // 2) standardowe heurystyki
    const btnRes = !isPhotoView ? fromAllCommentsButton(btnTexts) : null;
    if (btnRes)
      return {
        num: btnRes.num,
        debug: { ...debug, source: "buttonAllComments", raw: btnRes.raw },
      };

    const filterRes = fromFilterLinkedCount(btnTexts);
    if (filterRes)
      return {
        num: filterRes.num,
        debug: { ...debug, source: "filterLinked", raw: filterRes.raw },
      };

    const reactRes = fromReactionsBlock(allTexts);
    if (reactRes)
      return {
        num: reactRes.num,
        debug: { ...debug, source: "reactionsBlock", raw: reactRes.raw },
      };

    const phraseRes = parsePhrase(allTexts);
    if (phraseRes)
      return {
        num: phraseRes.num,
        debug: { ...debug, source: "phrase", raw: phraseRes.raw },
      };

    const xOfY = parseXofY(allTexts);
    if (xOfY)
      return {
        num: xOfY.num,
        debug: { ...debug, source: "xOfY", raw: xOfY.raw },
      };

    const near = digitNearComment(allEls);
    if (near != null)
      return {
        num: near,
        debug: { ...debug, source: "digitNear" },
      };

    return { num: null, debug: { ...debug, source: "none" } };
  });

  console.log("[DBG] Comments debug (skrócone):", {
    source: uiInfo.debug?.source,
    raw: uiInfo.debug?.raw,
    isPhotoView: uiInfo.debug?.isPhotoView,
    isVideoView: uiInfo.debug?.isVideoView,
  });

  let expectedTotal = null;
  if (typeof uiInfo.num === "number" && uiInfo.num > 0) {
    expectedTotal = uiInfo.num;
  }

  // 2) Doładowanie komentarzy – target z UI tylko jako orientacja, nie stop
  await ensureAllCommentsLoaded(page, expectedTotal);

  // 3) Druga próba filtra – gdyby FB przełączył layout w międzyczasie
  try {
    const ok2 = await switchCommentsFilterToAll(page);
    console.log(
      "[FB] Druga próba ustawienia filtra na 'Wszystkie komentarze':",
      ok2
    );
    if (ok2) await sleepRandom(800, 1500);
  } catch (e) {
    console.log("[FB] Błąd switchCommentsFilterToAll (druga próba):", e.message);
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

  let finalNum = uiInfo.num;

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
        // UI pokazuje dużo więcej niż realnie widzimy – ufamy temu, co faktycznie jest w anchorach
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
        /\b(min|minut|godz|h|hr|dni|day|days|tyg|week|weeks|sek|s ago|m ago|h ago|d ago)\b/.test(
          lower
        )
      )
        return true;

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

    return Array.from(byId.values());
  });

  console.log("[FB] extractCommentsData – wyciągnięto komentarzy:", data.length);
  return data;
}

export { getCommentCount, expandAllComments, extractCommentsData };
