// src/fb/scroll.js

/**
 * Proste scrollowanie "jak kółkiem myszki":
 * - znajdujemy scrollowalny kontener pod środkiem ekranu
 * - jeśli się nie uda → dialog → dokument
 */
async function scrollPost(page, amount = 450) {
  await page.evaluate((dy) => {
    function findScrollableAncestor(start) {
      let el = start;
      while (el) {
        const style = window.getComputedStyle(el);
        const canScrollY =
          style.overflowY === "auto" || style.overflowY === "scroll";
        if (canScrollY && el.scrollHeight - el.clientHeight > 50) {
          return el;
        }
        el = el.parentElement;
      }
      return null;
    }

    const centerEl = document.elementFromPoint(
      window.innerWidth / 2,
      window.innerHeight / 2
    );

    let target = centerEl ? findScrollableAncestor(centerEl) : null;

    if (!target) {
      const dialog = document.querySelector("div[role='dialog']");
      if (dialog && dialog.scrollHeight - dialog.clientHeight > 50) {
        target = dialog;
      }
    }

    if (!target) {
      target =
        document.scrollingElement || document.documentElement || document.body;
    }

    if (
      target === document.body ||
      target === document.documentElement ||
      target === document.scrollingElement
    ) {
      const before = window.scrollY || 0;
      window.scrollTo(0, before + dy);
    } else {
      target.scrollTop += dy;
    }
  }, amount);
}

/**
 * Uniwersalne wykrywanie kontenera scrolla z komentarzami.
 *
 * Działa dla:
 * - dialogu z postem (permalink),
 * - widoku zdjęcia (photo view),
 * - widoku wideo / watch (panel komentarzy).
 *
 * Wynik:
 * - zaznacza wybrany kontener atrybutem
 *   data-fbwatcher-comments-scroller="1"
 * - zwraca info diagnostyczne (typ, delta, liczba komentarzy w środku)
 */
async function detectCommentsScrollContainer(page) {
  const info = await page.evaluate(() => {
    function getPostRoot() {
      const dialogs = Array.from(document.querySelectorAll("div[role='dialog']"));

      const postDialog = dialogs.find((dlg) => {
        const text = (dlg.innerText || dlg.textContent || "").toLowerCase();
        if (!text) return false;

        const hasCommentWord = text.includes("komentarz") || text.includes("comment");
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

    const root = getPostRoot() || document.body;

    // ===== 1) Znajdź "bloki komentarzy" =====

    const commentBlocks = [];

    // a) po anchorach comment_id / reply_comment_id
    const anchors = Array.from(
      root.querySelectorAll("a[href*='comment_id'], a[href*='reply_comment_id']")
    );
    for (const a of anchors) {
      const block =
        a.closest("div[aria-label*='Komentarz']") ||
        a.closest("div[aria-label*='comment']") ||
        a.closest("li") ||
        a.closest("article") ||
        a.closest("div");
      if (block && !commentBlocks.includes(block)) {
        commentBlocks.push(block);
      }
    }

    // b) heurystyka po tekście ("Lubię to! / Odpowiedz")
    if (commentBlocks.length === 0) {
      const allDivs = Array.from(
        root.querySelectorAll("div, li, article, section")
      );
      for (const el of allDivs) {
        const txt = (el.innerText || "").toLowerCase();
        if (!txt) continue;
        if (
          txt.includes("lubię to") &&
          (txt.includes("odpowiedz") || txt.includes("reply"))
        ) {
          commentBlocks.push(el);
        }
      }
    }

    // ===== 2) Kandydaci na scroller – po przodkach bloków komentarzy =====

    const candidates = [];

    function pushCandidate(el, reason, weight = 1) {
      if (!el) return;

      const clientHeight = el.clientHeight || 0;
      const scrollHeight = el.scrollHeight || 0;
      const delta = scrollHeight - clientHeight;

      if (clientHeight <= 0 || delta < 32) return; // musi być REALNY scroll

      let existing = candidates.find((c) => c.el === el);
      if (!existing) {
        existing = {
          el,
          clientHeight,
          scrollHeight,
          delta,
          commentsInside: 0,
          reasons: new Set(),
        };
        candidates.push(existing);
      }

      existing.commentsInside += weight;
      existing.reasons.add(reason);
    }

    for (const block of commentBlocks) {
      let p = block;
      const visited = new Set();
      while (
        p &&
        p !== document.body &&
        p !== document.documentElement &&
        !visited.has(p)
      ) {
        visited.add(p);
        const style = window.getComputedStyle(p);
        const oy = style?.overflowY;
        const isScrollable =
          oy === "auto" || oy === "scroll" || oy === "overlay" || oy === "hidden";

        if (isScrollable) {
          pushCandidate(p, "comment-ancestor", 3);
        }

        p = p.parentElement;
      }
    }

    // ===== 3) Kandydat po przycisku "Najtrafniejsze / All comments" =====

    const filterBtn = Array.from(
      root.querySelectorAll("div[role='button'], span[role='button']")
    ).find((el) => {
      const t = (el.textContent || "").trim().toLowerCase();
      return (
        t === "najtrafniejsze" ||
        t === "most relevant" ||
        t === "wszystkie komentarze" ||
        t === "all comments" ||
        t === "autor" ||
        t === "author"
      );
    });

    if (filterBtn) {
      let p = filterBtn.parentElement;
      while (p && p !== document.body && p !== document.documentElement) {
        const style = window.getComputedStyle(p);
        const oy = style?.overflowY;
        const isScrollable =
          oy === "auto" || oy === "scroll" || oy === "overlay" || oy === "hidden";

        if (isScrollable) {
          pushCandidate(p, "filter-ancestor", 5);
          break;
        }
        p = p.parentElement;
      }
    }

    // ===== 4) Rodzic wielu bloków komentarzy =====

    if (commentBlocks.length > 0) {
      const parentCount = new Map();
      for (const b of commentBlocks) {
        const p = b.parentElement;
        if (!p) continue;
        parentCount.set(p, (parentCount.get(p) || 0) + 1);
      }

      for (const [el, count] of parentCount) {
        pushCandidate(el, "block-parent", count);
      }
    }

    // ===== 5) Wybór najlepszego kandydata =====

    let chosen = null;

    if (candidates.length > 0) {
      chosen = candidates.reduce((best, c) => {
        if (!best) return c;
        const scoreC = c.commentsInside * 1000 + c.delta;
        const scoreB = best.commentsInside * 1000 + best.delta;
        return scoreC > scoreB ? c : best;
      }, null);
    }

    let type = "comments-panel";
    let reason = "candidates-with-comments";
    let clientHeight;
    let scrollHeight;
    let delta;
    let commentsInside;

    if (chosen && chosen.el) {
      chosen.el.setAttribute("data-fbwatcher-comments-scroller", "1");
      clientHeight = chosen.clientHeight;
      scrollHeight = chosen.scrollHeight;
      delta = chosen.delta;
      commentsInside = chosen.commentsInside;
    } else {
      const dialog =
        root.closest("div[role='dialog']") ||
        document.querySelector("div[role='dialog']");

      let container =
        dialog ||
        document.scrollingElement ||
        document.documentElement ||
        document.body;

      if (dialog) {
        type = "dialog";
        reason = "fallback-dialog";
      } else {
        type = "window";
        reason = "fallback-window";
      }

      container.setAttribute("data-fbwatcher-comments-scroller", "1");

      clientHeight = container.clientHeight || window.innerHeight;
      scrollHeight = container.scrollHeight || document.body.scrollHeight || 0;
      delta = scrollHeight - clientHeight;
      commentsInside = commentBlocks.length;
    }

    return {
      type,
      reason,
      clientHeight,
      scrollHeight,
      delta,
      commentsInside,
    };
  });

  console.log("[FB] detectCommentsScrollContainer:", info);
  return info;
}

/**
 * Scrollowanie "w obrębie posta / panelu komentarzy".
 * - jeśli istnieje element oznaczony data-fbwatcher-comments-scroller="1"
 *   → używamy go (panel komentarzy, dialog, itp.)
 * - w przeciwnym razie heurystyka: root/dialog/auto/window
 *
 * factor > 0  → w dół
 * factor < 0  → w górę
 */
async function scrollWithinPost(page, label, factor = 0.3) {
  const info = await page.evaluate((factor) => {
    function getPostRoot() {
      const dialogs = Array.from(document.querySelectorAll("div[role='dialog']"));

      const postDialog = dialogs.find((dlg) => {
        const text = (dlg.innerText || dlg.textContent || "").toLowerCase();
        if (!text) return false;

        const hasCommentWord = text.includes("komentarz");
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

    const root = getPostRoot() || document.body;

    function pushIfScrollable(list, el, label) {
      if (!el) return;
      const style = window.getComputedStyle(el);
      if (!style) return;

      const clientH = el.clientHeight || 0;
      const scrollH = el.scrollHeight || 0;
      const delta = scrollH - clientH;

      if (clientH > 0 && delta > 10) {
        list.push({ el, label, delta });
      }
    }

    let container;
    let containerType;

    // 1) Priorytet: panel oznaczony przez detectCommentsScrollContainer
    const marked = document.querySelector(
      "[data-fbwatcher-comments-scroller='1']"
    );
    if (marked) {
      container = marked;
      containerType = "marked-comments-panel";
    } else {
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
        const delta =
          (container.scrollHeight || 0) - (container.clientHeight || 0);
        if (delta <= 0) {
          const cur = container.scrollTop || window.scrollY || 0;
          return {
            before: cur,
            after: cur,
            container: "window-no-scroll",
          };
        }
        containerType = "window";
      }
    }

    const before =
      container === document.body ||
      container === document.documentElement ||
      container === document.scrollingElement
        ? window.scrollY || 0
        : container.scrollTop || 0;

    const maxScroll =
      (container.scrollHeight || 0) - (container.clientHeight || 0);

    if (maxScroll <= 0) {
      return { before, after: before, container: containerType + "-no-scroll" };
    }

    const sign = (factor || 0.3) < 0 ? -1 : 1;
    const magnitude = Math.abs(factor || 0.3);

    const baseStep =
      container.clientHeight * magnitude || window.innerHeight * magnitude;
    const step = Math.max(40, Math.min(baseStep, 180));

    let target;
    if (sign < 0) {
      target = Math.max(0, before - step);
    } else {
      target = Math.min(maxScroll, before + step);
    }

    if (
      container === document.body ||
      container === document.documentElement ||
      container === document.scrollingElement
    ) {
      window.scrollTo(0, target);
    } else {
      container.scrollTop = target;
    }

    const after =
      container === document.body ||
      container === document.documentElement ||
      container === document.scrollingElement
        ? window.scrollY || 0
        : container.scrollTop || 0;

    return { before, after, container: containerType };
  }, factor);

  console.log(
    `[FB] scrollWithinPost[${label}] – ${info.before} -> ${info.after} (${info.container})`
  );

  return info;
}

export { scrollPost, detectCommentsScrollContainer, scrollWithinPost };
