import puppeteer from "puppeteer";
import axios from "axios";
import "dotenv/config";
import fs from "fs/promises";

/* ============================================================
   =========================  KONFIG  ==========================
   ============================================================ */

// FB_POST_URLS = url1,url2,url3
function getPostsFromEnv() {
  const raw = process.env.FB_POST_URLS || "";
  const urls = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return urls.map((url, index) => ({
    id: `post${index + 1}`,
    url,
  }));
}

// FB_POST_LABELS = nazwa1,nazwa2,nazwa3 (opcjonalnie)
function getPostLabelsFromEnv(posts) {
  const raw = process.env.FB_POST_LABELS || "";
  const labels = raw.split(",").map((s) => s.trim());

  const map = {};
  posts.forEach((post, idx) => {
    map[post.id] = labels[idx] || post.id;
  });
  return map;
}

const POSTS = getPostsFromEnv();

if (!POSTS.length) {
  console.error(
    "[CONFIG] Brak postów do monitorowania. Ustaw FB_POST_URLS w .env (lista URL, oddzielone przecinkami)."
  );
  process.exit(1);
}

const POST_LABELS = getPostLabelsFromEnv(POSTS);

// EXPAND_COMMENTS=false → tylko licznik
const EXPAND_COMMENTS =
  process.env.EXPAND_COMMENTS === "false" ? false : true;

const CHECK_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 60000);

// stany
const lastCounts = new Map();
const knownComments = new Set();

/* ============================================================
   ========================  UTYLITY  ==========================
   ============================================================ */

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function sleepRandom(minMs, maxMs) {
  const delta = maxMs - minMs;
  const extra = Math.random() * delta;
  return sleep(minMs + extra);
}

/**
 * Scrollowanie posta:
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

    // element pod środkiem ekranu (tam gdzie normalnie kręcisz kółkiem)
    const centerEl = document.elementFromPoint(
      window.innerWidth / 2,
      window.innerHeight / 2
    );

    let target = centerEl ? findScrollableAncestor(centerEl) : null;

    // fallback: dialog
    if (!target) {
      const dialog = document.querySelector("div[role='dialog']");
      if (dialog && dialog.scrollHeight - dialog.clientHeight > 50) {
        target = dialog;
      }
    }

    // ostateczny fallback: dokument
    if (!target) {
      target =
        document.scrollingElement || document.documentElement || document.body;
    }

    if (
      target === document.body ||
      target === document.documentElement ||
      target === document.scrollingElement
    ) {
      const before = window.scrollY;
      window.scrollTo(0, before + dy);
    } else {
      target.scrollTop += dy;
    }
  }, amount);
}

/* ====================== COOKIES ======================= */

async function loadCookies(page) {
  try {
    const raw = await fs.readFile("cookies.json", "utf8");
    const cookies = JSON.parse(raw);
    if (Array.isArray(cookies) && cookies.length) {
      await page.setCookie(...cookies);
      console.log("[FB][cookies] Załadowano zapisane cookies.");
    }
  } catch {
    console.log("[FB][cookies] Brak zapisanych cookies – logowanie od zera.");
  }
}

async function saveCookies(page) {
  try {
    const cookies = await page.cookies();
    await fs.writeFile(
      "cookies.json",
      JSON.stringify(cookies, null, 2),
      "utf8"
    );
    console.log("[FB][cookies] Cookies zapisane.");
  } catch (e) {
    console.error("[FB][cookies] Błąd zapisu cookies:", e.message);
  }
}

async function acceptCookies(page, label) {
  console.log(`[FB][cookies-${label}] Sprawdzanie pop-up cookies...`);
  await sleepRandom(1500, 3000);

  const result = await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll("button, div[role='button']")
    );
    const labels = [
      "Zezwól na wszystkie pliki cookie",
      "Odrzuć opcjonalne pliki cookie",
      "Allow all cookies",
      "Decline optional cookies",
    ];
    const texts = buttons
      .map((el) => (el.innerText || "").trim())
      .filter(Boolean);

    let target = null;

    outer: for (const el of buttons) {
      const txt = (el.innerText || "").trim();
      if (!txt) continue;
      for (const lab of labels) {
        if (txt.toLowerCase() === lab.toLowerCase()) {
          target = el;
          break outer;
        }
      }
    }

    if (!target) {
      for (const el of buttons) {
        const txt = (el.innerText || "").trim().toLowerCase();
        if (!txt) continue;
        if (txt.includes("pliki cookie") || txt.includes("cookies")) {
          target = el;
          break;
        }
      }
    }

    if (!target) {
      return { clicked: false, texts };
    }

    target.click();
    return { clicked: true, texts };
  });

  if (result.clicked) {
    console.log(`[FB][cookies-${label}] Kliknięto przycisk akceptacji cookies.`);
    await sleepRandom(1500, 2500);
  } else {
    console.log(
      `[FB][cookies-${label}] Nie znaleziono przycisku cookies. Teksty na przyciskach:`,
      result.texts
    );
  }
}

/* ============================================================
   ======================== LOGOWANIE =========================
   ============================================================ */

async function fbLogin(page) {
  console.log("[FB] Trwa logowanie...");

  await page.goto("https://www.facebook.com/login", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  await page.waitForSelector("#email", { timeout: 60000 });

  await page.type("#email", process.env.FB_EMAIL || "", { delay: 60 });
  await page.type("#pass", process.env.FB_PASSWORD || "", { delay: 60 });

  await Promise.all([
    page.click('button[name="login"]'),
    page
      .waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 })
      .catch(() => {}),
  ]);

  console.log("[FB] Po logowaniu:", page.url());
}

async function checkIfLogged(page) {
  return page.evaluate(() => {
    const selectors = [
      'input[aria-label*="Szukaj"]',
      'input[placeholder*="Szukaj"]',
      'a[aria-label*="Profil"]',
      'div[aria-label*="Konto"]',
    ];
    return selectors.some((sel) => document.querySelector(sel));
  });
}

async function clickByText(page, text) {
  const res = await page.evaluate((label) => {
    const els = Array.from(
      document.querySelectorAll("button, a, div[role='button']")
    );
    const lowLabel = label.toLowerCase();
    for (const el of els) {
      const t = (el.innerText || el.textContent || "").trim().toLowerCase();
      if (!t) continue;
      if (t === lowLabel) {
        el.click();
        return true;
      }
    }
    return false;
  }, text);
  return res;
}

async function ensureLoggedInOnPostOverlay(page) {
  // Sprawdzamy, czy jest nakładka typu "Wyświetl więcej na Facebooku"
  const overlayDetected = await page.evaluate(() => {
    const texts = Array.from(
      document.querySelectorAll("div, span, h1, h2, h3, button, a")
    )
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean);

    return texts.some((t) => {
      const low = t.toLowerCase();
      return (
        low.includes("wyświetl więcej na facebooku") ||
        low.includes("zobacz więcej na facebooku") ||
        low.includes("see more on facebook")
      );
    });
  });

  if (!overlayDetected) return;

  console.log("[FB] Wykryto okno logowania na poście – próba zalogowania.");

  // Najpierw spróbuj PL
  let clicked = await clickByText(page, "Zaloguj się");
  if (!clicked) {
    // potem EN jako fallback
    clicked = await clickByText(page, "Log In");
  }

  if (clicked) {
    console.log(
      "[FB] Kliknięto przycisk logowania w nakładce posta. Czekam na przeładowanie..."
    );
    await sleepRandom(4000, 6000);
  } else {
    console.log(
      "[FB] Nie udało się znaleźć przycisku logowania w nakładce posta."
    );
  }
}

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

  /* ---- GŁÓWNY PARSER LICZNIKA ---- */

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

    /* ===============================
       A) „X z Y komentarzy”
       =============================== */
    function parseXofY(texts) {
      let best = null;
      let raw = null;
      for (const t of texts) {
        const lower = t.toLowerCase();
        if (!lower.includes("komentarz") && !lower.includes("comment"))
          continue;

        const m = lower.match(/(\d+)\s*z\s*(\d+)/);
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
    if (xOfY) return { num: xOfY.num, debug: { ...debug, source: "xOfY" } };

    /* ===============================
       B) Frazy typu „306 komentarzy”
       =============================== */

    function parsePhrase(texts) {
      let best = null;
      let raw = null;

      for (const t of texts) {
        const lower = t.toLowerCase();
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

        if (!best || n > best) {
          best = n;
          raw = t;
        }
      }

      return best != null ? { num: best, raw } : null;
    }

    const pRes = parsePhrase([...globalTexts, ...btnTexts]);
    if (pRes)
      return { num: pRes.num, debug: { ...debug, source: "phrase" } };

    /* ===============================
       C) Cyfra po „Wszystkie reakcje”
       =============================== */

    const idx = btnTexts.findIndex((t) =>
      t.toLowerCase().startsWith("wszystkie reakcje")
    );

    if (idx !== -1) {
      for (let i = idx + 1; i < btnTexts.length; i++) {
        const t = btnTexts[i];
        if (/^\d+$/.test(t)) {
          return {
            num: Number(t),
            debug: { ...debug, source: "buttonsAfterReactions", raw: t },
          };
        }
      }
    }

    /* ===============================
       D) Cyfra obok słowa Komentarz
       =============================== */

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

    if (near != null)
      return { num: near, debug: { ...debug, source: "digitNear" } };

    return { num: null, debug: { ...debug, source: "none" } };
  });

  console.log("[DBG] Comments debug:", uiInfo.debug);

  if (uiInfo.num != null) {
    console.log("[FB] Liczba komentarzy (UI):", uiInfo.num);
    return uiInfo.num;
  }

  /* ---- FALLBACK: unikalne ID z anchorów ---- */

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
  return fallback.count;
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
    await new Promise((r) =>
      setTimeout(r, 800 + Math.random() * 700)
    );
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
    await new Promise((r) =>
      setTimeout(r, 600 + Math.random() * 600)
    );
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

    await new Promise((r) =>
      setTimeout(r, 400 + Math.random() * 500)
    );
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

    await new Promise((r) =>
      setTimeout(r, 300 + Math.random() * 300)
    );
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

/* ============================================================
   ======================== WEBHOOK ============================
   ============================================================ */

async function sendWebhook(post, newComments, newCount, oldCount) {
  const url = process.env.WEBHOOK_URL;
  if (!url) {
    console.warn("[Webhook] Brak WEBHOOK_URL – pomijam wysyłkę.");
    return;
  }

  const payload = {
    postId: post.id,
    postUrl: post.url,
    postName: POST_LABELS[post.id] || post.id,
    commentCount: newCount,
    previousCommentCount: oldCount,
    newComments,
    timestamp: new Date().toISOString(),
  };

  console.log("[Webhook] Wysyłanie danych o nowych komentarzach:", payload);

  try {
    await axios.post(url, payload, { timeout: 10000 });
    console.log("[Webhook] Wysłano nowe komentarze do webhooka.");
  } catch (err) {
    console.error("[Webhook] Błąd wysyłania:", err.message);
  }
}

/* ============================================================
   ======================== WATCHER ============================
   ============================================================ */

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

/* ============================================================
   ===================== START APPLICATION =====================
   ============================================================ */

startWatcher().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
