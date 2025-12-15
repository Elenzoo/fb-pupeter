// src/fb/ui/watch.js
import { safeGoto } from "../../utils/navigation.js";
import { sleepRandom } from "../../utils/sleep.js";
import { acceptCookies, saveCookies } from "../cookies.js";
import { fbLogin, checkIfLogged } from "../login.js";
import { getUiCommentInfo } from "../uicommentinfo.js";

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

    const articles = Array.from(outer.querySelectorAll("[role='article']"));
    const articlesComment = articles.filter((a) => {
      const aria = (a.getAttribute("aria-label") || "").toLowerCase();
      return aria.includes("komentarz") || aria.includes("comment");
    });

    const anchors = Array.from(
      outer.querySelectorAll("a[href*='comment_id'], a[href*='reply_comment_id']")
    );

    const allText = (outer.innerText || "").toLowerCase();
    const moreHits =
      (allText.match(/wyświetl więcej komentarzy/g) || []).length +
      (allText.match(/zobacz więcej komentarzy/g) || []).length +
      (allText.match(/view more comments/g) || []).length +
      (allText.match(/see more comments/g) || []).length;

    // TOP aria-labels (często w outer widać czy to powiadomienia / sidebar / komentarze)
    const labels = [];
    const nodes = Array.from(
      outer.querySelectorAll("button,div[role='button'],span[role='button'],a,abbr,[role='article']")
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
        roleArticle: articles.length,
        roleArticleComment: articlesComment.length,
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

/* ============================================================
   =================== COMMENTS CONTAINER FIND =================
   ============================================================ */

async function findCommentsOuter(page) {
  // h2 "Komentarze" / "Comments" -> parent
  const h2 = await page
    .$x("//h2[normalize-space()='Komentarze' or normalize-space()='Comments']")
    .then((arr) => arr?.[0] || null);

  if (!h2) return null;

  const outer = await page.evaluateHandle((node) => {
    const isEl = (x) => x && x.nodeType === 1;
    let cur = node;
    for (let i = 0; i < 10; i++) {
      if (!isEl(cur)) break;
      const el = cur;
      if (el.classList && el.classList.contains("x1jx94hy")) return el;
      cur = el.parentElement;
    }
    return node.parentElement || null;
  }, h2);

  const el = outer?.asElement?.() || null;
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
      .slice(0, 15000);

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
        txt.includes("zobacz więcej komentarzy");

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

async function getVisibleCommentCount(page, outerHandle) {
  if (!outerHandle) return 0;
  return page
    .evaluate((outer) => {
      const articles = Array.from(outer.querySelectorAll("[role='article']"));
      let count = 0;
      for (const a of articles) {
        const aria = (a.getAttribute("aria-label") || "").toLowerCase();
        if (aria.includes("komentarz") || aria.includes("comment")) count++;
      }
      return count;
    }, outerHandle)
    .catch(() => 0);
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

/* ============================================================
   ============================ API ============================
   ============================================================ */

/**
 * Przygotowanie strony dla wideo w Watch.
 * ZASADA: nic nie klikamy poza UI Watch.
 */
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

  // pauza wideo (bez klikania UI)
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

/**
 * Pobiera liczbę komentarzy dla wideo (Watch).
 */
export async function getCommentCount(page, url) {
  const uiInfo = await getUiCommentInfo(page).catch(() => null);
  console.log(`[FB][ui:watch][DBG] UI info:`, {
    source: uiInfo?.source,
    raw: uiInfo?.raw ? String(uiInfo.raw).slice(0, 250) + "..." : null,
    viewType: uiInfo?.viewType,
    comments: uiInfo?.comments,
  });

  let totalComments = null;

  if (uiInfo && typeof uiInfo.comments === "number" && uiInfo.comments > 0) {
    totalComments = uiInfo.comments;
  } else if (uiInfo?.raw) {
    const parsed = parseBestCommentsCountFromBlob(uiInfo.raw);
    if (parsed) {
      totalComments = parsed;
      console.log(`[FB][ui:watch][DBG] Parsed from uiInfo.raw => ${parsed}`);
    }
  }

  console.log(`[FB][ui:watch] Liczba komentarzy wg UI: ${totalComments !== null ? totalComments : "brak danych"}`);
  return totalComments;
}

/**
 * Wczytuje wszystkie komentarze w trybie Watch.
 * -> jedyne kliki: "Wyświetl więcej komentarzy"
 * -> scroll: wheel na kontenerze komentarzy
 */
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
  if (!scroller) {
    console.log("[FB][ui:watch][DBG] SCROLLER NOT FOUND -> return");
    if (DEBUG_WATCH) {
      const stats = await debugOuterStats(page, outer);
      console.log("[FB][ui:watch][DBG] OUTER stats (no scroller):", stats);
      await safeShot(page, "watch-no-scroller.png");
    }
    return;
  }

  if (DEBUG_WATCH) {
    const sstats = await debugScrollerStats(page, scroller);
    console.log("[FB][ui:watch][DBG] SCROLLER stats:", sstats);
    await shotElement(page, scroller, "watch-scroller.png");
  }

  let prevArticles = await getVisibleCommentCount(page, outer);
  let prevAnchors = await getAnchorsCount(page, outer);
  let noProgress = 0;

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    const clicked = await clickMoreCommentsIfPresent(page, outer);

    // scrollTop before/after
    let beforeST = 0;
    let afterST = 0;
    try {
      beforeST = await page.evaluate((s) => s.scrollTop || 0, scroller).catch(() => 0);
    } catch {}

    let wheeled = false;
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

    const curArticles = await getVisibleCommentCount(page, outer);
    const curAnchors = await getAnchorsCount(page, outer);

    const progressed = curArticles > prevArticles || curAnchors > prevAnchors;

    if (progressed) {
      prevArticles = curArticles;
      prevAnchors = curAnchors;
      noProgress = 0;
    } else {
      noProgress++;
    }

    console.log(
      `[FB][ui:watch][DBG] cycle ${cycle}/${maxCycles}: clickedMore=${clicked}, wheel=${wheeled}, scrollTop ${beforeST} -> ${afterST}, articles=${curArticles}, anchors=${curAnchors}, noProgress=${noProgress}`
    );

    if (DEBUG_WATCH && cycle === 5) {
      await safeShot(page, "watch-after-5.png");
    }

    if (noProgress >= 6) {
      console.log("[FB][ui:watch] Brak postępu przez kilka cykli – przerywam.");
      if (DEBUG_WATCH) await safeShot(page, "watch-stuck.png");
      break;
    }
  }

  console.log("[FB][ui:watch] Załadowano wszystkie dostępne komentarze (Watch).");
}

/**
 * Ekstrahuje komentarze spod wideo (Watch).
 * (szerszy selektor: role=article + aria-label)
 */
export async function extractComments(page, url) {
  const comments = await page.evaluate(() => {
    function getCommentId(href) {
      try {
        const u = new URL(href, location.origin);
        const cid = u.searchParams.get("comment_id");
        const rid = u.searchParams.get("reply_comment_id");
        return rid || cid;
      } catch {
        return null;
      }
    }

    function pickText(el) {
      if (!el) return "";
      return (el.textContent || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    const articles = Array.from(document.querySelectorAll("[role='article']")).filter((a) => {
      const aria = (a.getAttribute("aria-label") || "").toLowerCase();
      return aria.includes("komentarz") || aria.includes("comment");
    });

    const out = [];

    for (const art of articles) {
      try {
        const linkEl = art.querySelector("a[href*='comment_id='], a[href*='reply_comment_id=']");
        const href = linkEl?.href || null;
        const id = href ? getCommentId(href) : null;

        const author =
          pickText(art.querySelector("a[role='link'] span")) ||
          pickText(art.querySelector("strong")) ||
          null;

        let text = "";
        const autos = Array.from(art.querySelectorAll("[dir='auto']")).map(pickText).filter(Boolean);
        if (autos.length) {
          text = autos.length >= 2 ? autos[autos.length - 1] : autos[0];
        }

        const permalink = href || null;
        if (!author && !text) continue;

        out.push({ id, author, text, permalink, time: null });
      } catch {}
    }

    return out;
  });

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
