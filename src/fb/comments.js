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

  // 1. Kliknij w przycisk Najtrafniejsze/Wszystkie komentarze
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

  // 2. Kliknij opcję "Wszystkie komentarze"
  const clicked = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll(
        "div[role='menuitem'], div[role='menuitemradio'], span, div"
      )
    );
    const opt = nodes.find((el) => {
      const t = (el.textContent || "").trim();
      return (
        t.startsWith("Wszystkie komentarze") || t.startsWith("All comments")
      );
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
   ==================== LICZBA KOMENTARZY ======================
   ============================================================ */

async function getCommentCount(page, postUrl) {
  console.log(`[FB] Otwieranie posta: ${postUrl}`);

  await page.goto(postUrl, { waitUntil: "networkidle2", timeout: 60000 });
  await sleepRandom(3000, 4500);

  // cookies i nakładki
  await acceptCookies(page, "post-initial");
  await ensureLoggedInOnPostOverlay(page);
  await acceptCookies(page, "post");
  await sleepRandom(1500, 2500);

  await scrollPost(page, 300);
  await sleepRandom(1000, 1500);

  /* ---- FILTR „WSZYSTKIE KOMENTARZE” ---- */
  try {
    const ok = await switchCommentsFilterToAll(page);
    if (ok) await sleepRandom(1200, 2000);
  } catch (e) {
    console.log("[FB] Błąd switchCommentsFilterToAll:", e.message);
  }

  await scrollPost(page, 200);
  await sleepRandom(800, 1200);

  /* ---- GŁÓWNY PARSER LICZNIKA (UI) ---- */

  const uiInfo = await page.evaluate(() => {
    const debug = {};

    const allEls = Array.from(
      document.querySelectorAll("span, div, button, a")
    );

    const globalTexts = allEls
      .map((el) =>
        (el.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter(Boolean);

    const btnEls = Array.from(
      document.querySelectorAll("button, div[role='button']")
    );

    const btnTexts = btnEls
      .map((el) =>
        (el.innerText || el.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter(Boolean);

    debug.globalSample = globalTexts.slice(0, 30);
    debug.buttonTextsSample = btnTexts.slice(0, 20);

    /* ==========================================
       1) LICZBA OBOK "WSZYSTKIE KOMENTARZE"
       ========================================== */

    function fromAllCommentsButton(buttonTexts) {
      const idx = buttonTexts.findIndex((t) => {
        const low = t.toLowerCase();
        return (
          low === "wszystkie komentarze" ||
          low === "all comments"
        );
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

    const btnRes = fromAllCommentsButton(btnTexts);
    if (btnRes) {
      return {
        num: btnRes.num,
        debug: { ...debug, source: "buttonAllComments", raw: btnRes.raw },
      };
    }

    /* ==========================================
       2) LICZNIK POWIĄZANY Z FILTREM
          "Najtrafniejsze / Wszystkie komentarze"
       ========================================== */

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

      // szukamy wstecz pierwszego "X komentarzy" PRZED filtrem
      for (let i = filterIdx - 1; i >= 0; i--) {
        const txt = buttonTexts[i];
        if (!txt) continue;
        const lower = txt.toLowerCase();

        if (
          !lower.includes("komentarz") &&
          !lower.includes("comment")
        ) {
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

    const filterRes = fromFilterLinkedCount(btnTexts);
    if (filterRes) {
      return {
        num: filterRes.num,
        debug: { ...debug, source: "filterLinked", raw: filterRes.raw },
      };
    }

    /* ==========================================
       3) Frazy typu „174 komentarzy”
          (ogólny fallback, jak wyżej nic nie zadziała)
       ========================================== */

    function parsePhrase(texts) {
      let best = null;
      let raw = null;

      for (const t of texts) {
        const lower = t.toLowerCase();

        // IGNORUJEMY bloki powiązane z "Wszystkie reakcje"
        if (lower.includes("wszystkie reakcje") || lower.includes("all reactions")) {
          continue;
        }

        if (!lower.includes("komentarz") && !lower.includes("comment"))
          continue;

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

        // tutaj bierzemy po prostu OSTATNIĄ dopasowaną frazę,
        // a nie największą liczbę (żeby nie brać 231 z innego posta)
        best = n;
        raw = t;
      }

      return best != null ? { num: best, raw } : null;
    }

    const pRes = parsePhrase([...globalTexts, ...btnTexts]);
    if (pRes) {
      return {
        num: pRes.num,
        debug: { ...debug, source: "phrase", raw: pRes.raw },
      };
    }

    /* ==========================================
       4) Wzór „X z Y komentarzy”
       ========================================== */

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

    const xOfY = parseXofY([...globalTexts, ...btnTexts]);
    if (xOfY) {
      return {
        num: xOfY.num,
        debug: { ...debug, source: "xOfY", raw: xOfY.raw },
      };
    }

    /* ==========================================
       5) Cyfra w tym samym bloku co „komentarz”
       ========================================== */

    let near = null;
    for (const el of allEls) {
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

    if (near != null) {
      return {
        num: near,
        debug: { ...debug, source: "digitNear" },
      };
    }

    return { num: null, debug: { ...debug, source: "none" } };
  });

  console.log("[DBG] Comments debug:", uiInfo.debug);

  /* ---- FALLBACK: unikalne ID z anchorów (liczymy ZAWSZE) ---- */

  const fallback = await page.evaluate(() => {
    const anchors = Array.from(
      document.querySelectorAll('a[href*="comment_id"]')
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

  /* ---- FUZJA: UI vs anchor ---- */

  let finalNum = uiInfo.num;

  // 🔥 ZASADA:
  // - jeśli UI dało liczbę > 0 → trzymamy się UI
  // - jeśli UI nie dało nic (null/0), a anchory > 0 → używamy anchorów
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

  // totalny fallback – jakby nic nie wyszło
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

  let expanded = false;

  /* === więcej komentarzy === */
  while (true) {
    const clicked = await page.evaluate(() => {
      const els = Array.from(
        document.querySelectorAll(
          "button, div[role='button'], span[role='button']"
        )
      );

      for (const el of els) {
        const t = (el.textContent || "").trim().toLowerCase();
        if (
          t.startsWith("wyświetl więcej komentarzy") ||
          t.startsWith("zobacz więcej komentarzy") ||
          t.startsWith("view more comments") ||
          t.startsWith("wyświetl wcześniejsze komentarze") ||
          t.startsWith("view previous comments") ||
          (t.includes("zobacz jeszcze") && t.includes("komentarz"))
        ) {
          el.click();
          return true;
        }
      }

      return false;
    });

    if (!clicked) break;

    expanded = true;
    console.log("[FB] -> klik 'więcej komentarzy'");
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 700));
  }

  /* === więcej odpowiedzi === */
  while (true) {
    const clicked = await page.evaluate(() => {
      const els = Array.from(
        document.querySelectorAll(
          "button, div[role='button'], span[role='button']"
        )
      );

      for (const el of els) {
        const t = (el.textContent || "").trim().toLowerCase();

        // klasyczne teksty
        if (
          t.startsWith("wyświetl więcej odpowiedzi") ||
          t.startsWith("zobacz więcej odpowiedzi") ||
          t.startsWith("view more replies") ||
          t.startsWith("wyświetl wcześniejsze odpowiedzi") ||
          t.startsWith("view previous replies")
        ) {
          el.click();
          return true;
        }

        // NOWE: „2 odpowiedzi”, „3 odpowiedzi” itd.
        if (t.includes("odpowiedzi") && /\d/.test(t)) {
          el.click();
          return true;
        }
      }

      return false;
    });

    if (!clicked) break;

    expanded = true;
    console.log("[FB] -> klik 'więcej odpowiedzi / X odpowiedzi'");
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 600));
  }

  /* === "Zobacz więcej" w treści komentarza === */
  while (true) {
    const clicked = await page.evaluate(() => {
      const els = Array.from(
        document.querySelectorAll("span[role='button'], div[role='button']")
      );

      for (const el of els) {
        const t = (el.textContent || "").trim();
        if (t === "Zobacz więcej" || t === "See more") {
          el.click();
          return true;
        }
      }
      return false;
    });

    if (!clicked) break;

    await new Promise((r) => setTimeout(r, 400 + Math.random() * 500));
  }

  /* === Dodatkowy lazy scroll (full preload komentarzy) === */

  for (let i = 0; i < 12; i++) {
    const reached = await page.evaluate((dy) => {
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
          document.scrollingElement ||
          document.documentElement ||
          document.body;
      }

      let before, after;
      if (
        target === document.body ||
        target === document.documentElement ||
        target === document.scrollingElement
      ) {
        before = window.scrollY;
        window.scrollTo(0, before + dy);
        after = window.scrollY;
      } else {
        before = target.scrollTop;
        target.scrollTop = before + dy;
        after = target.scrollTop;
      }

      return after === before;
    }, 350);

    await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
    if (reached) break;
  }

  if (expanded) {
    console.log("[FB] Wszystkie komentarze i odpowiedzi rozwinięte.");
  } else {
    console.log("[FB] Nic nie było ukryte.");
  }
}

/* ============================================================
   ================== EXTRACT COMMENTS DATA ====================
   ============================================================ */

async function extractCommentsData(page) {
  if (!EXPAND_COMMENTS) return [];

  return page.evaluate(() => {
    /* ------------------ FUNKCJE POMOCNICZE ------------------ */

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

    /* ------------------ GŁÓWNY PARSER ------------------ */

    const anchors = Array.from(
      document.querySelectorAll(
        'a[href*="comment_id"], a[href*="reply_comment_id"]'
      )
    );

    const byId = new Map();

    for (const a of anchors) {
      const href = a.href;
      let rawId = null;

      /* ====== ID KOMENTARZA ====== */

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

      // base64 → numer
      if (!/^\d+$/.test(commentId)) {
        try {
          const decoded = atob(commentId); // "comment:xxx_12345"
          const m = decoded.match(/_(\d+)$/);
          if (m) commentId = m[1];
        } catch {}
      }

      /* ====== SZUKAMY BLOKU KOMENTARZA ====== */

      let block =
        a.closest("div[aria-label*='Komentarz']") ||
        a.closest("div[aria-label*='comment']") ||
        a.closest("li") ||
        a.closest("[role='article']") ||
        a.parentElement;

      // fallback
      if (!block) block = a.parentElement;

      /* ====== CZAS ====== */

      const rawTime = (a.innerText || a.textContent || "").trim();
      let timeText = looksLikeTime(rawTime) ? rawTime : "";

      if (!timeText && block) {
        const t = Array.from(block.querySelectorAll("a, span, time"))
          .map((el) => (el.textContent || "").trim())
          .find((txt) => looksLikeTime(txt));
        if (t) timeText = t;
      }

      /* ====== AUTHOR ====== */

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

      /* ====== TREŚĆ KOMENTARZA ====== */

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

          const lower = raw.toLowerCase();

          if (raw === author) continue;
          if (raw === timeText) continue;
          if (looksLikeTime(raw)) continue;

          // usuń UI śmieci
          const txt = stripUiWords(raw, timeText, author);
          if (!txt) continue;

          const isBtn = el.closest("button,[role='button']");
          if (isBtn) continue;

          candidates.push(txt);
        }

        if (candidates.length > 0) {
          // bierzemy najdłuższy
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

      /* ====== ZAPIS DO MAPY ====== */

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
