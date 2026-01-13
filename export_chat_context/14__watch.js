// src/fb/ui/watch.js
import { safeGoto } from "../../utils/navigation.js";
import { sleepRandom } from "../../utils/sleep.js";
import { acceptCookies, saveCookies } from "../cookies.js";
import { fbLogin, checkIfLogged } from "../login.js";
import { getUiCommentInfo } from "../uiCommentInfo.js";

/** Typ handlera UI */
export const type = "watch";

/** Dopasowanie URL – czy jest to link wideo z Facebook Watch. */
export function matchesUrl(url) {
  try {
    const u = new URL(url);
    return (u.pathname || "").toLowerCase().includes("/watch");
  } catch {
    return String(url || "").toLowerCase().includes("/watch");
  }
}

/* ============================================================
   ======================= DEBUG HELPERS ======================
   ============================================================ */

const DEBUG_WATCH = String(process.env.DEBUG_WATCH || "true").toLowerCase() !== "false";

async function safeShot(page, path, clip = null) {
  if (!DEBUG_WATCH) return;
  try {
    const opts = clip ? { path, clip } : { path, fullPage: false };
    await page.screenshot(opts);
    console.log(`[FB][ui:watch][DBG] screenshot -> ${path}`);
  } catch (e) {
    console.log("[FB][ui:watch][DBG] screenshot failed:", e?.message || e);
  }
}

async function shotElement(page, handle, path) {
  if (!DEBUG_WATCH) return;
  try {
    if (!handle) return;
    const box = await handle.boundingBox().catch(() => null);
    if (!box || box.width < 5 || box.height < 5) {
      console.log("[FB][ui:watch][DBG] shotElement: no bbox");
      return;
    }
    const clip = {
      x: Math.max(0, box.x),
      y: Math.max(0, box.y),
      width: Math.max(1, Math.min(box.width, 1920)),
      height: Math.max(1, Math.min(box.height, 1080)),
    };
    await safeShot(page, path, clip);
  } catch (e) {
    console.log("[FB][ui:watch][DBG] shotElement failed:", e?.message || e);
  }
}

async function debugOuterStats(page, outerHandle) {
  if (!DEBUG_WATCH) return null;
  if (!outerHandle) return null;

  return page.evaluate((outer) => {
    const norm = (s) =>
      String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const r = outer.getBoundingClientRect();
    const style = getComputedStyle(outer);

    const anchors = Array.from(
      outer.querySelectorAll("a[href*='comment_id'], a[href*='reply_comment_id']")
    );

    const allText = (outer.innerText || "").toLowerCase();
    const moreHits =
      (allText.match(/wyświetl więcej komentarzy/g) || []).length +
      (allText.match(/zobacz więcej komentarzy/g) || []).length +
      (allText.match(/view more comments/g) || []).length +
      (allText.match(/see more comments/g) || []).length;

    const labels = [];
    const nodes = Array.from(
      outer.querySelectorAll(
        "button,div[role='button'],span[role='button'],a,abbr,[role='article'],div,span"
      )
    ).slice(0, 4000);

    for (const el of nodes) {
      const a = el.getAttribute?.("aria-label");
      const t = norm(a);
      if (t) labels.push(t);
    }

    const freq = new Map();
    for (const l of labels) freq.set(l, (freq.get(l) || 0) + 1);
    const topLabels = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([k, v]) => ({ label: k, n: v }));

    return {
      tag: outer.tagName,
      className: outer.className || "",
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      style: {
        overflowY: style.overflowY,
        position: style.position,
      },
      counts: {
        anchors: anchors.length,
        moreHits,
      },
      topLabels,
    };
  }, outerHandle);
}

async function debugScrollerStats(page, scrollerHandle) {
  if (!DEBUG_WATCH) return null;
  if (!scrollerHandle) return null;

  return page.evaluate((s) => {
    const r = s.getBoundingClientRect();
    const st = getComputedStyle(s);
    return {
      tag: s.tagName,
      className: s.className || "",
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      style: { overflowY: st.overflowY, overflow: st.overflow },
      scroll: {
        scrollTop: s.scrollTop,
        clientHeight: s.clientHeight,
        scrollHeight: s.scrollHeight,
      },
    };
  }, scrollerHandle);
}

/* ============================================================
   ======================= PARSING COUNT =======================
   ============================================================ */

function parseCountFromText(str) {
  if (!str) return null;

  const raw = String(str)
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const m = raw.match(/(\d[\d\s.,]*)(\s*(tys\.?|k|m|mln)?)\s*(komentarz|komentarzy|comments)\b/);
  if (!m) return null;

  let numStr = (m[1] || "").trim().replace(/\s+/g, "");
  const suf = (m[2] || "").trim();

  const hasDecimal = /[.,]\d/.test(numStr);
  if (hasDecimal) numStr = numStr.replace(",", ".");
  else numStr = numStr.replace(/[.,]/g, "");

  let n = Number(numStr);
  if (!Number.isFinite(n)) return null;

  if (suf === "k") n *= 1000;
  if (suf === "tys" || suf === "tys.") n *= 1000;
  if (suf === "m" || suf === "mln") n *= 1000000;

  n = Math.round(n);
  if (n <= 0) return null;
  return n;
}

function parseBestCommentsCountFromBlob(blobStr) {
  if (!blobStr) return null;

  const raw = String(blobStr).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const re = /(\d[\d\s.,]*)(\s*(tys\.?|k|m|mln)?)\s*(komentarz|komentarzy|comments)\b/gi;

  let best = null;
  let match;
  while ((match = re.exec(raw)) !== null) {
    const candidate = `${match[1]} ${match[2] || ""} ${match[4] || ""}`;
    const n = parseCountFromText(candidate);
    if (n && (!best || n > best)) best = n;
  }
  return best;
}

function pickBestCount(candidates) {
  const nums = candidates.filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
  if (!nums.length) return null;

  nums.sort((a, b) => b - a);
  const best = nums[0];
  const second = nums[1];

  if (second && best >= 2 * second && second < 150) return best;

  return best;
}

/* ============================================================
   =================== COMMENTS CONTAINER FIND =================
   ============================================================ */

/**
 * WATCH FIX:
 * - NIE polegamy na h2 "Komentarze" (często go nie ma w Watch).
 * - Szukamy największego klastra linków comment_id/reply_comment_id na stronie.
 */
async function findCommentsOuter(page) {
  const handle = await page.evaluateHandle(() => {
    const nodes = Array.from(document.querySelectorAll("div, section, main, article")).slice(0, 30000);

    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect?.();
      return r && r.width >= 220 && r.height >= 220;
    };

    let best = null;
    let bestScore = -1;

    for (const el of nodes) {
      if (!visible(el)) continue;

      const anchors = el.querySelectorAll?.("a[href*='comment_id'], a[href*='reply_comment_id']");
      const aCount = anchors ? anchors.length : 0;
      if (aCount < 3) continue;

      const txt = (el.innerText || "").toLowerCase();
      const hasWords =
        txt.includes("komentarz") || txt.includes("komentarzy") || txt.includes("comments") || txt.includes("comment");

      // score: anchor count + bonus za słowa “komentarz”
      const score = aCount + (hasWords ? 12 : 0);

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    return best || null;
  });

  const el = handle?.asElement?.() || null;
  if (!el) return null;

  const ok = await page.evaluate((o) => o && document.contains(o), el).catch(() => false);
  return ok ? el : null;
}

async function findScrollableInOuter(page, outerHandle) {
  if (!outerHandle) return null;

  const scrollerHandle = await page.evaluateHandle((outer) => {
    function isVisible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    }

    function canScroll(el) {
      try {
        if (!el) return false;
        const st = getComputedStyle(el);
        const oy = (st.overflowY || "").toLowerCase();
        if (!(oy === "auto" || oy === "scroll")) return false;
        const h = el.clientHeight || 0;
        const sh = el.scrollHeight || 0;
        return sh > h + 80;
      } catch {
        return false;
      }
    }

    const nodes = Array.from(outer.querySelectorAll("div,section,main,article"))
      .filter(isVisible)
      .slice(0, 20000);

    let best = null;
    let bestScore = -1;

    for (const el of nodes) {
      if (!canScroll(el)) continue;

      const delta = (el.scrollHeight || 0) - (el.clientHeight || 0);
      const txt = (el.innerText || "").toLowerCase();

      const hasMore =
        txt.includes("wyświetl więcej komentarzy") ||
        txt.includes("view more comments") ||
        txt.includes("see more comments") ||
        txt.includes("zobacz więcej komentarzy") ||
        txt.includes("zobacz wcześniejsze komentarze");

      const score = delta + (hasMore ? 100000 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    return best || null;
  }, outerHandle);

  const el = scrollerHandle?.asElement?.() || null;
  if (!el) return null;

  const ok = await page.evaluate((s) => s && document.contains(s), el).catch(() => false);
  return ok ? el : null;
}

async function clickMoreCommentsIfPresent(page, outerHandle) {
  if (!outerHandle) return false;

  const labels = [
    "wyświetl więcej komentarzy",
    "zobacz więcej komentarzy",
    "zobacz wcześniejsze komentarze",
    "view more comments",
    "see more comments",
    "show more comments",
    "view previous comments",
  ];

  const clicked = await page.evaluate(
    (outer, labelsArr) => {
      const norm = (s) =>
        String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      const isVisible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      };

      const nodes = Array.from(
        outer.querySelectorAll("button, div[role='button'], span[role='button'], a, span")
      ).filter(isVisible);

      for (const el of nodes) {
        const t = norm(el.getAttribute("aria-label") || el.textContent || "");
        if (!t) continue;
        if (labelsArr.some((x) => t.includes(x))) {
          try {
            el.scrollIntoView({ block: "center" });
          } catch {}
          const clickable =
            el.closest?.("button,a,div[role='button'],span[role='button']") || el;
          try {
            clickable.click();
            return true;
          } catch {}
        }
      }
      return false;
    },
    outerHandle,
    labels
  );

  return !!clicked;
}

async function getAnchorsCount(page, outerHandle) {
  if (!outerHandle) return 0;
  return page
    .evaluate((outer) => {
      const as = Array.from(
        outer.querySelectorAll("a[href*='comment_id'], a[href*='reply_comment_id']")
      );
      const ids = new Set();
      for (const a of as) {
        try {
          const u = new URL(a.href, location.origin);
          const id = u.searchParams.get("reply_comment_id") || u.searchParams.get("comment_id");
          if (id) ids.add(id);
        } catch {}
      }
      return ids.size;
    }, outerHandle)
    .catch(() => 0);
}

async function getCommentRootsCount(page, outerHandle) {
  if (!outerHandle) return 0;
  return page
    .evaluate((outer) => {
      const as = Array.from(
        outer.querySelectorAll("a[href*='comment_id'], a[href*='reply_comment_id']")
      );
      const roots = new Set();
      for (const a of as) {
        const root = a.closest?.("[role='article']") || a.closest?.("div");
        if (root) roots.add(root);
      }
      return roots.size;
    }, outerHandle)
    .catch(() => 0);
}

/* ============================================================
   ============================ API ============================
   ============================================================ */

export async function prepare(page, url) {
  console.log(`[FB][ui:watch] Otwieranie wideo (Watch): ${url}`);
  const ok = await safeGoto(page, url, "watch", { waitUntil: "networkidle2", timeout: 90000 });
  if (!ok) throw new Error("safeGoto-failed");

  await acceptCookies(page, "watch-initial");

  const currentUrl = page.url();
  if (currentUrl.includes("/login")) {
    console.log("[FB][ui:watch] Wymagane logowanie do Facebook – loguję...");
    await fbLogin(page);
    await sleepRandom(3000, 4500);
    const loggedAfterLogin = await checkIfLogged(page).catch(() => false);
    console.log(
      `[FB][ui:watch] Stan sesji po fbLogin: ${loggedAfterLogin ? "ZALOGOWANY" : "NIEZALOGOWANY"}`
    );
    if (loggedAfterLogin) {
      await safeGoto(page, url, "watch", { waitUntil: "networkidle2", timeout: 90000 });
      await acceptCookies(page, "watch-post-login");
    } else {
      console.log("[FB][ui:watch] Logowanie nie powiodło się – kontynuuję bez sesji.");
    }
  } else {
    const logged = await checkIfLogged(page).catch(() => false);
    if (!logged) {
      console.log("[FB][ui:watch] Brak sesji – fbLogin().");
      await fbLogin(page);
      await sleepRandom(3000, 4500);
      await acceptCookies(page, "watch-after-login");
      const logged2 = await checkIfLogged(page).catch(() => false);
      console.log(`[FB][ui:watch] Stan sesji po fbLogin: ${logged2 ? "ZALOGOWANY" : "NIEZALOGOWANY"}`);
    }
  }

  try {
    const loggedFinal = await checkIfLogged(page).catch(() => false);
    if (loggedFinal) await saveCookies(page);
  } catch {}

  await acceptCookies(page, "watch");

  try {
    await page.evaluate(() => {
      const vids = Array.from(document.querySelectorAll("video"));
      for (const v of vids) {
        try {
          v.autoplay = false;
          v.removeAttribute("autoplay");
          v.muted = true;
          v.pause();
          if (!isNaN(v.currentTime) && v.currentTime === 0) v.currentTime = 0.01;
        } catch {}
      }
    });
    console.log("[FB][ui:watch] Wideo wstrzymane (pause).");
  } catch (e) {
    console.log("[FB][ui:watch] Błąd wstrzymania wideo:", e?.message || e);
  }

  if (DEBUG_WATCH) {
    await safeShot(page, "watch-prepare.png");
  }
}

export async function getCommentCount(page, url) {
  const uiInfo = await getUiCommentInfo(page).catch(() => null);

  const parsedFromUiRaw = uiInfo?.raw ? parseBestCommentsCountFromBlob(uiInfo.raw) : null;

  let parsedFromOuter = null;
  const outer = await findCommentsOuter(page).catch(() => null);
  if (outer) {
    parsedFromOuter = await page
      .evaluate((o) => (o.innerText || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(), outer)
      .then((txt) => parseBestCommentsCountFromBlob(txt))
      .catch(() => null);
  }

  const uiDirect =
    uiInfo && typeof uiInfo.comments === "number" && uiInfo.comments > 0 ? uiInfo.comments : null;

  const totalComments = pickBestCount([parsedFromOuter, parsedFromUiRaw, uiDirect]);

  console.log(`[FB][ui:watch][DBG] count sources:`, {
    ui_source: uiInfo?.source || null,
    ui_viewType: uiInfo?.viewType || null,
    ui_comments: uiDirect,
    parsedFromUiRaw,
    parsedFromOuter,
    picked: totalComments,
  });

  let final = totalComments;

  console.log(`[FB][ui:watch] Liczba komentarzy wg UI: ${final !== null ? final : "brak danych"}`);
  return final;
}

export async function loadAllComments(page, { expectedTotal } = {}) {
  console.log("[FB][ui:watch] Ładuję wszystkie komentarze (Watch)...");

  let maxCycles = 40;
  if (typeof expectedTotal === "number" && expectedTotal > 0) {
    maxCycles = Math.min(Math.max(30, Math.ceil(expectedTotal / 6)), 140);
  }
  console.log(`[FB][ui:watch] Rozpoczynam sekwencyjne ładowanie komentarzy, maxCycles=${maxCycles}.`);

  const outer = await findCommentsOuter(page);
  if (!outer) {
    console.log("[FB][ui:watch][DBG] OUTER NOT FOUND -> return");
    if (DEBUG_WATCH) await safeShot(page, "watch-no-outer.png");
    return;
  }

  if (DEBUG_WATCH) {
    const stats = await debugOuterStats(page, outer);
    console.log("[FB][ui:watch][DBG] OUTER stats:", stats);
    await shotElement(page, outer, "watch-outer.png");
  }

  const scroller = await findScrollableInOuter(page, outer);

  if (DEBUG_WATCH) {
    if (scroller) {
      const sstats = await debugScrollerStats(page, scroller);
      console.log("[FB][ui:watch][DBG] SCROLLER stats:", sstats);
      await shotElement(page, scroller, "watch-scroller.png");
    } else {
      console.log("[FB][ui:watch][DBG] SCROLLER NOT FOUND -> fallback: window scroll");
      await safeShot(page, "watch-no-scroller.png");
    }
  }

  let prevAnchors = await getAnchorsCount(page, outer);
  let prevRoots = await getCommentRootsCount(page, outer);
  let noProgress = 0;

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    const clicked = await clickMoreCommentsIfPresent(page, outer);

    let wheeled = false;
    let beforeST = 0;
    let afterST = 0;

    if (scroller) {
      try {
        beforeST = await page.evaluate((s) => s.scrollTop || 0, scroller).catch(() => 0);
      } catch {}

      try {
        const box = await scroller.boundingBox();
        if (box && box.width > 5 && box.height > 5) {
          await page.mouse.move(box.x + box.width / 2, box.y + Math.min(80, box.height / 2));
          await page.mouse.wheel({ deltaY: Math.max(500, Math.floor(box.height * 0.9)) });
          wheeled = true;
        }
      } catch {}

      await sleepRandom(450, 850);

      try {
        afterST = await page.evaluate((s) => s.scrollTop || 0, scroller).catch(() => 0);
      } catch {}
    } else {
      try {
        beforeST = await page.evaluate(() => {
          const el = document.scrollingElement || document.documentElement;
          return el ? el.scrollTop || 0 : 0;
        });
      } catch {}
      try {
        await page.mouse.wheel({ deltaY: 900 });
        wheeled = true;
      } catch {}
      await sleepRandom(450, 850);
      try {
        afterST = await page.evaluate(() => {
          const el = document.scrollingElement || document.documentElement;
          return el ? el.scrollTop || 0 : 0;
        });
      } catch {}
    }

    const curAnchors = await getAnchorsCount(page, outer);
    const curRoots = await getCommentRootsCount(page, outer);

    const progressed = curAnchors > prevAnchors || curRoots > prevRoots;

    if (progressed) {
      prevAnchors = curAnchors;
      prevRoots = curRoots;
      noProgress = 0;
    } else {
      noProgress++;
    }

    console.log(
      `[FB][ui:watch][DBG] cycle ${cycle}/${maxCycles}: clickedMore=${clicked}, wheel=${wheeled}, scrollTop ${beforeST} -> ${afterST}, roots=${curRoots}, anchors=${curAnchors}, noProgress=${noProgress}`
    );

    if (DEBUG_WATCH && cycle === 5) {
      await safeShot(page, "watch-after-5.png");
    }

    if (noProgress >= 8) {
      console.log("[FB][ui:watch] Brak postępu przez kilka cykli – przerywam.");
      if (DEBUG_WATCH) await safeShot(page, "watch-stuck.png");
      break;
    }
  }

  console.log("[FB][ui:watch] Załadowano wszystkie dostępne komentarze (Watch).");
}

export async function extractComments(page, url) {
  const outer = await findCommentsOuter(page).catch(() => null);
  if (!outer) {
    console.log("[FB][ui:watch][DBG] extractComments: OUTER NOT FOUND");
    if (DEBUG_WATCH) await safeShot(page, "watch-extract-no-outer.png");
    return [];
  }

  const comments = await page.evaluate((outerEl) => {
    function norm(s) {
      return String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function toAbsHref(href) {
      if (!href) return null;
      if (href.startsWith("http")) return href;
      if (href.startsWith("/")) return `${location.origin}${href}`;
      return href;
    }

    function getCommentId(href) {
      try {
        const u = new URL(href, location.origin);
        return u.searchParams.get("reply_comment_id") || u.searchParams.get("comment_id");
      } catch {
        return null;
      }
    }

    function normalizeTime(text) {
      if (!text) return null;

      const t = norm(text).toLowerCase();
      if (!t) return null;

      if (t.includes("przed chwilą")) return "0 min";
      if (t === "właśnie teraz" || t === "teraz" || t === "now" || t === "just now") return "0 min";
      if (t.includes("wczoraj") || t.includes("yesterday")) return "wczoraj";

      if (/^\d+\s*(sek|sek\.|s|sec|secs|second|seconds)\b/.test(t)) return t;
      if (/^\d+\s*(min|min\.|m|minut|minuty|minutę)\b/.test(t)) return t;
      if (/^\d+\s*(godz|godz\.|h|hr|hour|hours)\b/.test(t)) return t;
      if (/^\d+\s*(dzień|dni|d)\b/.test(t)) return t;
      if (/^\d+\s*(tyg|tyg\.|week|weeks)\b/.test(t)) return t;

      return null;
    }

    function findTimeInRoot(root) {
      if (!root) return null;

      const els = Array.from(root.querySelectorAll("abbr, a, span")).slice(0, 250);
      for (const el of els) {
        const aria = el.getAttribute?.("aria-label");
        const t1 = normalizeTime(aria);
        if (t1) return t1;

        const title = el.getAttribute?.("title");
        const t2 = normalizeTime(title);
        if (t2) return t2;

        const txt = el.textContent;
        const t3 = normalizeTime(txt);
        if (t3) return t3;
      }
      return null;
    }

    const anchors = Array.from(
      outerEl.querySelectorAll("a[href*='comment_id='], a[href*='reply_comment_id=']")
    );

    const seenRoots = new Set();
    const out = [];

    for (const a of anchors) {
      const href = a.getAttribute("href") || a.href || null;
      const absHref = toAbsHref(href);

      const id = absHref ? getCommentId(absHref) : null;
      if (!id) continue;

      const root = a.closest?.("[role='article']") || a.closest?.("div") || null;
      if (!root) continue;
      if (seenRoots.has(root)) continue;
      seenRoots.add(root);

      const author =
        norm(root.querySelector("a[role='link'] span")?.textContent) ||
        norm(root.querySelector("strong")?.textContent) ||
        null;

      const autos = Array.from(root.querySelectorAll("[dir='auto']"))
        .map((el) => norm(el.textContent))
        .filter(Boolean);

      let text = "";
      if (autos.length) text = autos[autos.length - 1];

      const time = findTimeInRoot(root);

      if (!author && !text) continue;

      out.push({
        id,
        author,
        text,
        permalink: absHref,
        time: time || null,
      });
    }

    return out;
  }, outer);

  console.log(`[FB][ui:watch] Wyekstrahowano komentarzy: ${comments.length}`);
  return comments;
}

export async function debugSnapshot(page) {
  try {
    const path = `snapshot-watch.png`;
    await page.screenshot({ path });
    console.log(`[FB][ui:watch] Zapisano zrzut ekranu: ${path}`);
  } catch (e) {
    console.error("[FB][ui:watch] Błąd zapisu zrzutu ekranu:", e);
  }
}
