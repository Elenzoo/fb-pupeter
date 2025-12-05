import { EXPAND_COMMENTS } from "../config.js";
import { sleepRandom } from "../utils/sleep.js";
import { scrollPost } from "./scroll.js";
import { acceptCookies } from "./cookies.js";
import { ensureLoggedInOnPostOverlay } from "./login.js";

/* ============================================================
   =======  PRZEŁĄCZANIE FILTRA „WSZYSTKIE KOMENTARZE”  ========
   ============================================================ */

async function switchCommentsFilterToAll(page) {
  console.log("[FB] Próba przełączenia filtra komentarzy…");

  const opened = await page.evaluate(() => {
    const els = Array.from(
      document.querySelectorAll("div[role='button'], span[role='button']")
    );

    const btn = els.find((el) => {
      const t = (el.textContent || "").trim();
      return (
        t === "Najtrafniejsze" ||
        t === "Most relevant" ||
        t === "Wszystkie komentarze" ||
        t === "All comments"
      );
    });

    if (!btn) return { found: false };
    btn.click();
    return { found: true };
  });

  if (!opened.found) {
    console.log("[FB] Nie znaleziono przycisku filtra komentarzy.");
    return false;
  }

  await sleepRandom(400, 800);

  const clicked = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll(
        "div[role='menuitem'], div[role='menuitemradio'], span, div"
      )
    );

    const opt = nodes.find((el) => {
      const t = (el.textContent || "").trim();
      return t.startsWith("Wszystkie komentarze") || t.startsWith("All comments");
    });

    if (!opt) return { clicked: false };
    opt.click();
    return { clicked: true };
  });

  if (!clicked.clicked) {
    console.log("[FB] Nie ma opcji 'Wszystkie komentarze' w menu drop-down.");
    return false;
  }

  console.log("[FB] Filtr komentarzy ustawiony na: Wszystkie komentarze.");
  return true;
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

        const hasCommentWord = text.includes("komentarz");
        const hasActions =
          text.includes("lubię to") ||
          text.includes("komentarz") ||
          text.includes("udostępnij") ||
          text.includes("napisz komentarz");

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
  console.log("[FB] ensureAllCommentsLoaded – start");

  const MAX_ROUNDS = 300;
  const MAX_NO_PROGRESS = 10;
  let lastCount = 0;
  let noProgressRounds = 0;

  const hasTarget = typeof expectedTotal === "number" && expectedTotal > 0;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const countBefore = await getCurrentCommentAnchorCount(page);

    await expandAllComments(page);

    const scrollInfo = await scrollWithinPost(page, `round-${round}`, 0.25);
    await sleepRandom(250, 450);

    const countAfter = await getCurrentCommentAnchorCount(page);

    console.log(
      `[FB] ensureAllCommentsLoaded – runda ${round}, IDs=${countAfter}, scroll=${scrollInfo.before}/${scrollInfo.after}`
    );

    if (hasTarget && countAfter >= expectedTotal) {
      console.log(
        `[FB] ensureAllCommentsLoaded – osiągnięto expectedTotal=${expectedTotal} (IDs=${countAfter})`
      );
      break;
    }

    const progressed =
      countAfter > lastCount || scrollInfo.after !== scrollInfo.before;

    if (progressed) {
      lastCount = Math.max(lastCount, countAfter);
      noProgressRounds = 0;
    } else {
      noProgressRounds++;
    }

    if (noProgressRounds >= MAX_NO_PROGRESS) {
      console.log(
        "[FB] ensureAllCommentsLoaded – brak progresu (IDs + scroll), stop (główna pętla)."
      );
      break;
    }
  }

  // ===== Runda kontrolna – powrót NA SAMĄ GÓRĘ posta/okna =====
  try {
    console.log(
      "[FB] ensureAllCommentsLoaded – runda kontrolna (powrót na górę posta)."
    );

    for (let i = 1; i <= 500; i++) {
      const up = await scrollWithinPost(page, `ctrl-up-${i}`, -0.6);
      await sleepRandom(200, 350);

      console.log(
        `[FB] kontrola ${i}: scrollUp=${up.before}->${up.after} (${up.container})`
      );

      if (up.after === 0 || up.after === up.before) {
        console.log(
          "[FB] Runda kontrolna: osiągnięto górę / brak dalszego scrolla — STOP."
        );
        break;
      }
    }
  } catch (e) {
    console.log(
      "[FB] ensureAllCommentsLoaded – runda kontrolna zakończona błędem (ignoruję):",
      e?.message || e
    );
  }

  console.log("[FB] ensureAllCommentsLoaded – koniec.");
}

/* ============================================================
   ===== POMOCNICZE: LICZENIE ID I SCROLL W POŚCIE ============
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
          } catch (e) {}
        }

        if (raw) ids.add(raw);
      } catch (e) {
        continue;
      }
    }

    return ids.size;
  });

  return count || 0;
}

/**
 * Scrolluje w obrębie posta, a jeśli post nie ma własnego scrolla – scrolluje CAŁĄ STRONĘ.
 * factor > 0  → w dół
 * factor < 0  → w górę
 */
async function scrollWithinPost(page, label, factor = 0.3) {
  const info = await page.evaluate((factor) => {
    const isPhotoView = /[?&]fbid=|\/photo\.php|\/photo\?fbid=|\/photo\/\d/i.test(
      location.href
    );

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

    function pushIfScrollable(list, el, label) {
      if (!el) return;
      const style = window.getComputedStyle(el);
      if (!style) return;

      const oy = style.overflowY;
      const clientH = el.clientHeight || 0;
      const scrollH = el.scrollHeight || 0;
      const delta = scrollH - clientH;

      if (clientH > 0 && delta > 10) {
        list.push({ el, label, delta });
      }
    }

    let container = null;
    let containerType = null;

    if (isPhotoView) {
      const commentInput =
        document.querySelector("div[role='textbox'][data-lexical-editor]") ||
        document.querySelector("form textarea[placeholder*='komentarz' i]") ||
        document.querySelector("form textarea[placeholder*='comment' i]");

      if (commentInput) {
        let p = commentInput.parentElement;
        while (p && p !== document.body && p !== document.documentElement) {
          const style = window.getComputedStyle(p);
          const oy = style.overflowY;
          const ch = p.clientHeight || 0;
          const sh = p.scrollHeight || 0;
          const delta = sh - ch;

          if (
            ch > 0 &&
            delta > 10 &&
            (oy === "auto" || oy === "scroll" || oy === "overlay" || oy === "hidden")
          ) {
            container = p;
            containerType = "photo-comments";
            break;
          }
          p = p.parentElement;
        }
      }
    }

    if (!container) {
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
          document.scrollingElement || document.documentElement || document.body;
        const delta =
          (container.scrollHeight || 0) - (container.clientHeight || 0);
        if (delta <= 0) {
          const cur = container.scrollTop || window.scrollY || 0;
          return { before: cur, after: cur, container: "window-no-scroll" };
        }
        containerType = "window";
      }
    }

    const isWindowContainer =
      container === document.body ||
      container === document.documentElement ||
      container === document.scrollingElement;

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
      };
    }

    const sign = (factor || 0.3) < 0 ? -1 : 1;
    const magnitude = Math.abs(factor || 0.3);

    const baseStep =
      (container.clientHeight || window.innerHeight) * magnitude;
    const step = Math.max(40, Math.min(baseStep, 200));

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

    return { before, after, container: containerType || "unknown" };
  }, factor);

  console.log(
    `[FB] scrollWithinPost[${label}] – ${info.before} -> ${info.after} (${info.container})`
  );

  return info;
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

  await scrollPost(page, 200);
  await sleepRandom(800, 1200);

  try {
    const ok = await switchCommentsFilterToAll(page);
    if (ok) await sleepRandom(1200, 2000);
  } catch (e) {
    console.log("[FB] Błąd switchCommentsFilterToAll:", e.message);
  }

  await ensureAllCommentsLoaded(page, null);

  // ========= UI PARSER – patrzymy w CAŁY DOCUMENT =========
  const uiInfo = await page.evaluate(() => {
    const debug = {};

    const root = document;

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

    // NOWE: liczba jako osobny przycisk obok "Komentarz"/"Comment"
    function fromCommentButtonNeighbour(buttonTexts) {
      const idx = buttonTexts.findIndex((t) => {
        const low = t.toLowerCase();
        return low === "komentarz" || low === "comment";
      });
      if (idx === -1) return null;

      const numericCandidates = [];
      for (let i = idx - 3; i <= idx + 3; i++) {
        if (i < 0 || i >= buttonTexts.length || i === idx) continue;
        const t = buttonTexts[i];
        if (!t) continue;
        const m = t.match(/^\d+$/);
        if (!m) continue;
        numericCandidates.push(parseInt(m[0], 10));
      }

      if (!numericCandidates.length) return null;

      const best = Math.max(...numericCandidates);
      return { num: best, raw: numericCandidates.join(",") };
    }

    function parsePhrase(texts) {
      let best = null;
      let raw = null;

      for (const t of texts) {
        const lower = t.toLowerCase();

        if (lower.includes("wszystkie reakcje") || lower.includes("all reactions")) {
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

    const btnRes = fromAllCommentsButton(btnTexts);
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

    const neighborRes = fromCommentButtonNeighbour(btnTexts);
    if (neighborRes)
      return {
        num: neighborRes.num,
        debug: { ...debug, source: "commentNeighbour", raw: neighborRes.raw },
      };

    const phraseRes = parsePhrase([...globalTexts, ...btnTexts]);
    if (phraseRes)
      return {
        num: phraseRes.num,
        debug: { ...debug, source: "phrase", raw: phraseRes.raw },
      };

    const xOfY = parseXofY([...globalTexts, ...btnTexts]);
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

  console.log("[DBG] Comments debug:", {
    source: uiInfo.debug?.source,
    raw: uiInfo.debug?.raw,
    buttonTextsSample: uiInfo.debug?.buttonTextsSample?.slice(0, 5),
    globalSampleCount: uiInfo.debug?.globalSample?.length,
  });

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

  if ((finalNum == null || finalNum === 0) && fallback.count > 0) {
    finalNum = fallback.count;
    console.log(
      `[FB] Liczba komentarzy z anchorów (UI puste/0): ${finalNum}`
    );
  } else {
    console.log("[FB] UI ma priorytet, anchory tylko jako debug:", {
      ui: finalNum,
      anchor: fallback.count,
    });
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
    return;
  }

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  let expandedSomething = false;

  async function clickOnce() {
    const res = await page.evaluate(() => {
      const isPhotoView = /[?&]fbid=|\/photo\.php|\/photo\?fbid=|\/photo\/\d/i.test(
        location.href
      );

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

      const root = isPhotoView ? document : getPostRoot() || document;

      const buttons = Array.from(
        root.querySelectorAll("button, div[role='button'], span[role='button']")
      );

      const candidates = [];

      for (const el of buttons) {
        const raw = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!raw) continue;

        const text = raw.toLowerCase();

        let kind = null;

        if (
          text.startsWith("wyświetl więcej komentarzy") ||
          text.startsWith("zobacz więcej komentarzy") ||
          text.startsWith("pokaż komentarze") ||
          text.startsWith("pokaż wcześniejsze komentarze") ||
          text.startsWith("show comments") ||
          text.startsWith("view more comments") ||
          text.startsWith("view previous comments")
        ) {
          kind = "more-comments";
        }

        if (!kind) {
          if (
            text.startsWith("wyświetl więcej odpowiedzi") ||
            text.startsWith("zobacz więcej odpowiedzi") ||
            (text.startsWith("wyświetl wszystkie") && text.includes("odpowiedzi")) ||
            text.startsWith("wyświetl wszystkie odpowiedzi") ||
            text.startsWith("wyświetl 1 odpowiedź") ||
            text.startsWith("view more replies") ||
            text.startsWith("view previous replies") ||
            (text.includes("odpowiedzi") && /\d/.test(text)) ||
            (text.includes("repl") && /\d/.test(text))
          ) {
            kind = "more-replies";
          }
        }

        if (!kind) {
          if (text === "zobacz więcej" || text === "see more") {
            kind = "see-more-text";
          }
        }

        if (!kind) continue;

        const rect = el.getBoundingClientRect();
        if (!rect || rect.width === 0 || rect.height === 0) continue;
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue;

        candidates.push({
          kind,
          top: rect.top,
          text: raw,
        });
      }

      if (!candidates.length) {
        return { clicked: false };
      }

      const priority = { "more-comments": 3, "more-replies": 2, "see-more-text": 1 };

      candidates.sort((a, b) => {
        const pa = priority[a.kind] || 0;
        const pb = priority[b.kind] || 0;
        if (pa !== pb) return pb - pa;
        return a.top - b.top;
      });

      const chosenInfo = candidates[0];

      const allButtons = Array.from(
        root.querySelectorAll("button, div[role='button'], span[role='button']")
      );

      let chosenEl = null;
      for (const el of allButtons) {
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (t !== chosenInfo.text) continue;
        const r = el.getBoundingClientRect();
        if (!r || r.width === 0 || r.height === 0) continue;
        if (Math.abs(r.top - chosenInfo.top) > 2) continue;
        chosenEl = el;
        break;
      }

      if (!chosenEl) {
        return { clicked: false };
      }

      chosenEl.click();
      return {
        clicked: true,
        kind: chosenInfo.kind,
        text: chosenInfo.text,
      };
    });

    if (res.clicked) {
      expandedSomething = true;
      console.log(
        `[FB] -> klik '${res.text}' (typ=${res.kind || "?"})`
      );
      return true;
    }

    return false;
  }

  for (let i = 0; i < 30; i++) {
    const didClick = await clickOnce();
    if (!didClick) break;
    await delay(900 + Math.random() * 700);
  }

  if (!expandedSomething) {
    console.log("[FB] Nic do rozwinięcia (komentarze).");
  }
}

/* ============================================================
   ================== EXTRACT COMMENTS DATA ====================
   ============================================================ */

async function extractCommentsData(page) {
  if (!EXPAND_COMMENTS) return [];

  return page.evaluate(() => {
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
}

export { getCommentCount, expandAllComments, extractCommentsData };
