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

  const MAX_ROUNDS = 200;      // maks. liczba rund
  let lastCount = 0;           // ile ID mieliśmy ostatnio
  let noProgressRounds = 0;    // ile rund bez progresu z rzędu

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    // Ten kawałek odpala się w przeglądarce
    const info = await page.evaluate(
      new Function(
        `"use strict";
        ${postRootScript()}
        const root = getPostRoot();

        // 1) liczymy UNIKALNE ID komentarzy z anchorów
        const anchors = Array.from(
          root.querySelectorAll(
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

            // czasem ID jest zakodowane base64
            if (!/^\\d+$/.test(raw)) {
              try {
                const dec = atob(raw);             // np. "comment:xyz_123456789"
                const m = dec.match(/:(\\d+)_([0-9]+)/);
                if (m) raw = m[2];
              } catch {}
            }

            if (raw) ids.add(raw);
          } catch {}
        }

        const count = ids.size;

        // 2) scroll – ZAWSZE z okna, żeby log był sensowny
        const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
        const scrollMax =
          (document.documentElement.scrollHeight || document.body.scrollHeight || 0)
          - window.innerHeight;

        return { count, scrollTop, scrollMax };
      `
      )
    );

    const { count, scrollTop, scrollMax } = info;

    console.log(
      `[FB] ensureAllCommentsLoaded – runda ${round}, IDs=${count}, scroll=${scrollTop}/${scrollMax}`
    );

    // jeśli znamy expectedTotal i już dojechaliśmy – wychodzimy
    if (expectedTotal && count >= expectedTotal) {
      console.log(
        `[FB] ensureAllCommentsLoaded – osiągnięto expectedTotal=${expectedTotal} (IDs=${count})`
      );
      break;
    }

    // progres / brak progresu
    if (count <= lastCount) {
      noProgressRounds++;
    } else {
      noProgressRounds = 0;
      lastCount = count;
    }

    // 3 rundy bez żadnego wzrostu ID → koniec głównej pętli
    if (noProgressRounds >= 3) {
      console.log(
        "[FB] ensureAllCommentsLoaded – brak progresu (IDs nie rosną), stop (główna pętla)."
      );
      break;
    }

    // klikamy "więcej komentarzy / odpowiedzi / zobacz więcej"
    await expandAllComments(page);

    // i dopiero potem scrollujemy dół posta
    await scrollPost(page, 900);
    await sleepRandom(700, 1100);
  }

  // ===================== RUNDA KONTROLNA =====================
  console.log("[FB] ensureAllCommentsLoaded – runda kontrolna (agresywny scroll).");

  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    for (let i = 0; i < 10; i++) {
      // mocny scroll w dół
      window.scrollBy(0, window.innerHeight * 0.9);

      // szukamy wszystkich przycisków typu „więcej komentarzy / odpowiedzi”
      const btns = Array.from(
        document.querySelectorAll('div[role="button"], span')
      );

      for (const el of btns) {
        const txt = (el.innerText || "").trim();

        if (
          /Wyświetl więcej komentarzy/i.test(txt) ||
          /więcej odpowiedzi/i.test(txt) ||
          /\d+\s+odpowiedzi/i.test(txt)
        ) {
          if (typeof el.click === "function") {
            el.click();
          }
        }
      }

      await sleep(400);
    }

    // opcjonalnie wracamy na górę posta/strony
    window.scrollTo(0, 0);
  });

  console.log("[FB] ensureAllCommentsLoaded – koniec.");
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

  // Spróbuj doładować komentarze (scroll + kliknięcia)
  await ensureAllCommentsLoaded(page, null);

  const uiInfo = await page.evaluate(() => {
    const debug = {};

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

    const root = getPostRoot();

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
      return { num: btnRes.num, debug: { ...debug, source: "buttonAllComments", raw: btnRes.raw } };

    const filterRes = fromFilterLinkedCount(btnTexts);
    if (filterRes)
      return { num: filterRes.num, debug: { ...debug, source: "filterLinked", raw: filterRes.raw } };

    const phraseRes = parsePhrase([...globalTexts, ...btnTexts]);
    if (phraseRes)
      return { num: phraseRes.num, debug: { ...debug, source: "phrase", raw: phraseRes.raw } };

    const xOfY = parseXofY([...globalTexts, ...btnTexts]);
    if (xOfY)
      return { num: xOfY.num, debug: { ...debug, source: "xOfY", raw: xOfY.raw } };

    const near = digitNearComment(allEls);
    if (near != null)
      return { num: near, debug: { ...debug, source: "digitNear" } };

    return { num: null, debug: { ...debug, source: "none" } };
  });

  console.log("[DBG] Comments debug:", {
  source: uiInfo.debug?.source,
  raw: uiInfo.debug?.raw,
  buttonTextsSample: uiInfo.debug?.buttonTextsSample?.slice(0, 5),
  globalSampleCount: uiInfo.debug?.globalSample?.length,
});


  const fallback = await page.evaluate(() => {
    function getPostRoot() {
      const dialog = document.querySelector("div[role='dialog']");
      if (dialog) return dialog;
      const article = document.querySelector("div[role='article']");
      if (article) return article;
      return document;
    }

    const root = getPostRoot();
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

  let expanded = false;

  async function clickLoop(label, evalFn, maxClicks = 20) {
    let guard = 0;
    while (guard++ < maxClicks) {
      const clicked = await page.evaluate(evalFn);
      if (!clicked) break;
      expanded = true;
      console.log(label);
      await delay(800 + Math.random() * 700);
    }
  }

  const makeRootFn = () => postRootScript();

  await clickLoop(
    "[FB] -> klik 'więcej komentarzy'",
    new Function(
      "\"use strict\";" +
        makeRootFn() +
        `
        const root = getPostRoot();
        const els = Array.from(
          root.querySelectorAll("button, div[role='button'], span[role='button']")
        );

        for (const el of els) {
          const t = (el.textContent || "").trim().toLowerCase();
          if (!t) continue;

          if (
            t.startsWith("wyświetl więcej komentarzy") ||
            t.startsWith("zobacz więcej komentarzy") ||
            t.startsWith("pokaż komentarze") ||
            t.startsWith("pokaż wcześniejsze komentarze") ||
            t.startsWith("show comments") ||
            t.startsWith("view more comments") ||
            t.startsWith("wyświetl wcześniejsze komentarze") ||
            t.startsWith("view previous comments") ||
            (t.includes("zobacz jeszcze") && t.includes("komentarz"))
          ) {
            const rect = el.getBoundingClientRect();
            if (!rect || rect.width === 0 || rect.height === 0) continue;
            if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
            el.click();
            return true;
          }
        }
        return false;
      `
    )
  );

  await clickLoop(
    "[FB] -> klik 'więcej odpowiedzi / X odpowiedzi'",
    new Function(
      "\"use strict\";" +
        makeRootFn() +
        `
        const root = getPostRoot();
        const els = Array.from(
          root.querySelectorAll("button, div[role='button'], span[role='button']")
        );

        for (const el of els) {
          const t = (el.textContent || "").trim().toLowerCase();
          if (!t) continue;

          if (
            t.startsWith("wyświetl więcej odpowiedzi") ||
            t.startsWith("zobacz więcej odpowiedzi") ||
            t.startsWith("view more replies") ||
            t.startsWith("wyświetl wcześniejsze odpowiedzi") ||
            t.startsWith("view previous replies") ||
            (t.includes("odpowiedzi") && /\d/.test(t))
          ) {
            const rect = el.getBoundingClientRect();
            if (!rect || rect.width === 0 || rect.height === 0) continue;
            if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
            el.click();
            return true;
          }
        }
        return false;
      `
    )
  );

  await clickLoop(
    "[FB] -> klik 'Zobacz więcej (treść komentarza)'",
    new Function(
      "\"use strict\";" +
        makeRootFn() +
        `
        const root = getPostRoot();
        const els = Array.from(
          root.querySelectorAll("span[role='button'], div[role='button']")
        );

        for (const el of els) {
          const t = (el.textContent || "").trim();
          if (t === "Zobacz więcej" || t === "See more") {
            const rect = el.getBoundingClientRect();
            if (!rect || rect.width === 0 || rect.height === 0) continue;
            if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
            el.click();
            return true;
          }
        }
        return false;
      `
    )
  );

  if (!expanded) {
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
