// src/fb/ui/photo.js
import { safeGoto } from "../../utils/navigation.js";
import { sleepRandom } from "../../utils/sleep.js";
import { scrollPost } from "../scroll.js";
import { acceptCookies, saveCookies } from "../cookies.js";
import { ensureLoggedInOnPostOverlay, fbLogin, checkIfLogged } from "../login.js";
import { getUiCommentInfo } from "../uiCommentInfo.js";
import log from "../../utils/logger.js";

export const type = "photo";

const PACE = (process.env.FB_PACE || "local").toLowerCase();

/**
 * WAŻNE:
 * - Synchronizacja = waitForFunction / waitForEffect (DOM-driven), nie “ślepe sleep”.
 * - Zostawiamy minimalne mikrodelaie (80–260ms) jako “oddech” po re-renderze.
 * - Hard-bottom liczymy rzadziej (tylko gdy trzeba), bo to potrafi zjadać czas.
 */
const PACE_CFG =
  PACE === "server"
    ? {
        // delikatnie wolniej na serwerze (render/CPU)
        stepJitterMinMs: 140,
        stepJitterMaxMs: 260,

        afterScrollMinMs: 260,
        afterScrollMaxMs: 520,

        // max czas na efekt po kliknięciu (FB doładowuje async)
        effectWaitMs: 5200,

        scrollPx: 140,

        // bonusowe kliki, ale event-driven
        bonusClickTries: 2,
        bonusClickDelayMinMs: 120,
        bonusClickDelayMaxMs: 220,

        // HARD BOTTOM (sprawdzane rzadko)
        hardBottomEpsPx: 10,
        hardBottomStableNeed: 4,
        hardBottomStableDelayMinMs: 320,
        hardBottomStableDelayMaxMs: 560,
      }
    : {
        // lokalnie szybciej
        stepJitterMinMs: 90,
        stepJitterMaxMs: 190,

        afterScrollMinMs: 180,
        afterScrollMaxMs: 420,

        effectWaitMs: 4200,

        scrollPx: 160,

        bonusClickTries: 2,
        bonusClickDelayMinMs: 90,
        bonusClickDelayMaxMs: 180,

        hardBottomEpsPx: 10,
        hardBottomStableNeed: 4,
        hardBottomStableDelayMinMs: 240,
        hardBottomStableDelayMaxMs: 420,
      };

export function matchesUrl(url) {
  try {
    const u = new URL(url);
    const path = (u.pathname || "").toLowerCase();

    if (path.includes("photo.php")) return true;
    if (path.startsWith("/photo") || path.includes("/photo/")) return true;
    if (u.searchParams.has("fbid")) return true;

    return false;
  } catch {
    const lower = (url || "").toLowerCase();
    if (lower.includes("photo.php")) return true;
    if (lower.includes("/photo/") || lower.includes("/photo?")) return true;
    if (/(?:\?|&)fbid=/.test(lower)) return true;
    return false;
  }
}

/* ===================== FILTER: ALL COMMENTS (LOKALNIE) ===================== */

async function clickAllCommentsInMenu(page) {
  const result = await page.evaluate(() => {
    const menu =
      document.querySelector("div[role='menu']") ||
      document.querySelector("div[role='dialog']");

    if (!menu) return { clicked: false, noMenu: true };

    const items = Array.from(
      menu.querySelectorAll("div[role='menuitem'], div[role='menuitemradio']")
    );

    const opt = items.find((el) => {
      const t = (el.textContent || "").trim().toLowerCase();
      return t.startsWith("wszystkie komentarze") || t.startsWith("all comments");
    });

    if (!opt) return { clicked: false, noMenu: false };

    opt.click();
    setTimeout(() => {
      try {
        document.body.click();
      } catch {}
    }, 50);

    return { clicked: true, noMenu: false };
  });

  if (result.clicked) {
    await sleepRandom(180, 320);
    await page
      .waitForFunction(() => !document.querySelector("div[role='menu']"), { timeout: 2000 })
      .catch(() => {});
  }

  return result;
}

async function switchCommentsFilterToAll(page) {
  log.debug("UI:photo", "Przełączam filtr → wszystkie komentarze");

  const menuAlreadyOpen = await page.evaluate(() => !!document.querySelector("div[role='menu']"));
  if (menuAlreadyOpen) {
    const r = await clickAllCommentsInMenu(page);
    return !!r.clicked;
  }

  const pre = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("div[role='button'], span[role='button']"));
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

    if (!filterEl) return { state: "not-found" };
    if (labelText === "wszystkie komentarze" || labelText === "all comments") {
      return { state: "already-all" };
    }

    filterEl.click();
    return { state: "clicked-filter" };
  });

  if (pre.state === "not-found") return false;
  if (pre.state === "already-all") return true;

  await sleepRandom(120, 220);
  const r = await clickAllCommentsInMenu(page);
  if (r.clicked) return true;

  const afterLabelIsAll = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("div[role='button'], span[role='button']"));
    return els.some((el) => {
      const t = (el.textContent || "").trim().toLowerCase();
      return t === "wszystkie komentarze" || t === "all comments";
    });
  });

  return afterLabelIsAll;
}

/* ===================== COMMENTS ROOT (KLUCZ) ===================== */

async function getCommentsRootHandle(page) {
  const handle = await page.evaluateHandle(() => {
    const norm = (s) =>
      String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    const isVisible = (el) => {
      if (!el) return false;
      try {
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      } catch {
        return true;
      }
    };

    const isMoreCommentsBtn = (el) => {
      const t = norm(el.getAttribute?.("aria-label") || el.textContent);
      if (!t) return false;
      return (
        t.includes("wyświetl więcej komentarzy") ||
        t.includes("zobacz więcej komentarzy") ||
        t.includes("zobacz wcześniejsze komentarze") ||
        t.includes("view more comments") ||
        t.includes("view previous comments")
      );
    };

    const btns = Array.from(document.querySelectorAll("button,a,div,span,[role='button']")).filter(
      isVisible
    );
    const keyBtn = btns.find(isMoreCommentsBtn);

    if (keyBtn) {
      const dlg = keyBtn.closest?.("div[role='dialog']");
      if (dlg) return dlg;

      let cur = keyBtn.parentElement;
      for (let i = 0; i < 20 && cur; i++) {
        if (cur.matches?.("article,main,section,div")) return cur;
        cur = cur.parentElement;
      }
    }

    const dialogs = Array.from(document.querySelectorAll("div[role='dialog']")).filter(isVisible);
    const dlg2 = dialogs.find((d) => {
      const t = norm(d.innerText || d.textContent);
      if (!t) return false;
      if (t.includes("powiadomienia")) return false;
      if (t.includes("szukaj znajomych")) return false;
      return (
        t.includes("najtrafniejsze") ||
        t.includes("most relevant") ||
        t.includes("komentarz") ||
        t.includes("comment")
      );
    });
    if (dlg2) return dlg2;

    return document.body;
  });

  return handle;
}

async function getCommentsScrollHandle(page, rootHandle) {
  const handle = await page.evaluateHandle((root) => {
    const isVisible = (el) => {
      if (!el) return false;
      try {
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      } catch {
        return true;
      }
    };

    const canScrollByTest = (el) => {
      try {
        if (!el) return false;
        const h = el.clientHeight || 0;
        const sh = el.scrollHeight || 0;
        if (sh <= h + 40) return false;

        const before = el.scrollTop ?? 0;
        el.scrollTop = before + 80;
        const after = el.scrollTop ?? before;
        el.scrollTop = before;

        return after !== before;
      } catch {
        return false;
      }
    };

    const closestScrollable = (start) => {
      let cur = start;
      for (let i = 0; i < 28 && cur; i++) {
        if (canScrollByTest(cur)) return cur;
        cur = cur.parentElement;
      }
      return null;
    };

    const scope = root || document;

    const outer = document.querySelector("div[data-visualcompletion='ignore'][data-thumb='1']");
    if (outer) {
      const sc = closestScrollable(outer);
      if (sc) return sc;
    }

    const candidates = Array.from(scope.querySelectorAll("div,section,main,article"))
      .filter(isVisible)
      .slice(0, 25000);

    let best = null;
    let bestDelta = -1;
    for (const el of candidates) {
      if (!canScrollByTest(el)) continue;
      const delta = (el.scrollHeight || 0) - (el.clientHeight || 0);
      if (delta > bestDelta) {
        bestDelta = delta;
        best = el;
      }
    }

    return best || null;
  }, rootHandle);

  return handle;
}

/* ======================================================================== */

export async function prepare(page, url) {
  log.dev("UI:photo", `Prepare: ${url}`);

  const ok = await safeGoto(page, url, "photo", { waitUntil: "networkidle2", timeout: 90000 });
  if (!ok) throw new Error("safeGoto-failed");

  if (page.url().includes("/login")) {
    log.dev("UI:photo", "/login – fbLogin + re-enter");
    await fbLogin(page);
    await sleepRandom(2500, 4000);
    await safeGoto(page, url, "photo", { waitUntil: "networkidle2", timeout: 90000 });
  }

  await acceptCookies(page, "photo-initial");

  const logged = await checkIfLogged(page).catch(() => false);
  if (!logged) {
    log.dev("UI:photo", "Brak sesji – fbLogin()");
    await fbLogin(page);
    await sleepRandom(2500, 4000);
  }

  await ensureLoggedInOnPostOverlay(page);
  await acceptCookies(page, "photo");

  const loggedFinal = await checkIfLogged(page).catch(() => false);
  if (loggedFinal) await saveCookies(page);
}

function parseNumberLikeNode(str) {
  if (!str) return null;

  const cleaned = String(str)
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const plain = cleaned.replace(/[^\d]/g, "");
  if (/^\d+$/.test(plain)) {
    const n = Number(plain);
    return Number.isFinite(n) ? n : null;
  }

  const m = cleaned.match(/(\d+(?:[.,]\d+)?)[ ]*(k|tys|tyś|thousand)\b/);
  if (m) {
    const base = Number(m[1].replace(",", "."));
    if (Number.isFinite(base)) return Math.round(base * 1000);
  }

  const m2 = cleaned.match(/(\d+(?:[.,]\d+)?)[ ]*(m|mln|million)\b/);
  if (m2) {
    const base = Number(m2[1].replace(",", "."));
    if (Number.isFinite(base)) return Math.round(base * 1000000);
  }

  return null;
}

async function getPhotoUiCountFromChip(page, rootHandle) {
  const res = await page
    .evaluate((root) => {
      const scope = root || document;

      const norm = (s) =>
        String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();

      const parseNum = (s) => {
        const t = norm(s);
        if (!t) return null;

        const plain = t.replace(/[^\d]/g, "");
        if (/^\d+$/.test(plain)) return Number(plain);

        const lower = t.toLowerCase();
        const m = lower.match(/(\d+(?:[.,]\d+)?)[ ]*(k|tys|tyś|thousand)\b/);
        if (m) {
          const base = Number(m[1].replace(",", "."));
          if (Number.isFinite(base)) return Math.round(base * 1000);
        }

        const m2 = lower.match(/(\d+(?:[.,]\d+)?)[ ]*(m|mln|million)\b/);
        if (m2) {
          const base = Number(m2[1].replace(",", "."));
          if (Number.isFinite(base)) return Math.round(base * 1000000);
        }

        return null;
      };

      const isVisible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < window.innerHeight;
      };

      const commentBtn = Array.from(
        document.querySelectorAll("div[role='button'],span[role='button'],a[role='button'],button")
      ).find((el) => {
        const t = norm(el.textContent).toLowerCase();
        return t === "komentarz" || t === "comment" || t.startsWith("komentarz");
      });

      const anchorRect = commentBtn?.getBoundingClientRect?.() || null;
      const anchorCx = anchorRect ? anchorRect.left + anchorRect.width / 2 : null;
      const anchorCy = anchorRect ? anchorRect.top + anchorRect.height / 2 : null;

      const candidates = Array.from(scope.querySelectorAll("div[role='button'],span[role='button']"))
        .filter(isVisible)
        .slice(0, 5000);

      let best = null;
      let bestScore = -Infinity;

      for (const el of candidates) {
        const hasIcon = !!el.querySelector("i[data-visualcompletion='css-img']");
        if (!hasIcon) continue;

        const spans = Array.from(el.querySelectorAll("span")).slice(0, 50);
        let num = null;
        let raw = null;

        for (const sp of spans) {
          const t = norm(sp.textContent);
          if (!t) continue;
          if (t.length > 24) continue;

          const n = parseNum(t);
          if (typeof n === "number" && Number.isFinite(n)) {
            if (n <= 0 || n > 10000000) continue;
            num = n;
            raw = t;
            break;
          }
        }

        if (num == null) continue;

        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;

        let score = 0;

        if (anchorCx != null && anchorCy != null) {
          const dx = cx - anchorCx;
          const dy = cy - anchorCy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          score -= dist;
        }

        const textLen = norm(el.textContent).length;
        score -= Math.min(400, textLen);

        score += Math.min(200, Math.log10(num + 1) * 120);

        if (score > bestScore) {
          bestScore = score;
          best = { count: num, raw, score, text: norm(el.textContent).slice(0, 80) };
        }
      }

      return best;
    }, rootHandle)
    .catch(() => null);

  if (!res || typeof res.count !== "number") return null;
  return { count: res.count, raw: res.raw, dbg: res };
}

export async function getCommentCount(page, url) {
  log.dev("UI:photo", "Liczę komentarze...");

  await scrollPost(page, 220);
  await sleepRandom(220, 420);

  const okFilter = await switchCommentsFilterToAll(page).catch(() => false);
  log.debug("UI:photo", `Filtr all comments: ${okFilter}`);

  // mikro settle po filtrze (bez mulenia)
  await sleepRandom(220, 420);

  const rootHandle = await getCommentsRootHandle(page);

  const chip = await getPhotoUiCountFromChip(page, rootHandle).catch(() => null);
  if (chip?.count != null) {
    log.debug("UI:photo", "UI count (chip)", chip);
  }

  const uiInfo = await getUiCommentInfo(page).catch(() => null);
  const infoCount = uiInfo && typeof uiInfo.comments === "number" ? uiInfo.comments : null;

  const loaded = await page
    .evaluate((root) => {
      const scope = root || document;
      const as = Array.from(scope.querySelectorAll("a[href*='comment_id']"));
      const ids = new Set();
      for (const a of as) {
        const href = a.getAttribute("href") || "";
        const m = href.match(/comment_id=([^&]+)/);
        if (m && m[1]) ids.add(m[1]);
      }
      return ids.size || null;
    }, rootHandle)
    .catch(() => null);

  let total = null;
  let source = "none";

  if (chip?.count != null) {
    total = chip.count;
    source = "ui-photo-chip";
  } else if (infoCount != null) {
    total = infoCount;
    source = uiInfo?.source || "uicommentinfo";
  } else if (loaded != null) {
    total = loaded;
    source = "loaded-comment_id";
  }

  log.debug("UI:photo", "UI comments", {
    source,
    chip: chip?.count ?? null,
    uiInfoSource: uiInfo?.source ?? null,
    uiInfoRaw: uiInfo?.raw ?? null,
    uiInfoCount: infoCount,
    loaded,
    chosen: total,
  });

  try {
    await rootHandle.dispose?.();
  } catch {}

  // krótki oddech przed loadAllComments (żeby nie wejść w trakcie re-renderu)
  await sleepRandom(180, 340);

  return total;
}

export async function loadAllComments(page, { expectedTotal } = {}) {
  log.dev("UI:photo", `loadAllComments expectedTotal=${expectedTotal ?? "n/a"} pace=${PACE}`);

  const MAX_STEPS = 900;
  const MAX_NO_PROGRESS = 28;

  let noProgress = 0;

  const rootHandle = await getCommentsRootHandle(page);
  const scrollHandle = await getCommentsScrollHandle(page, rootHandle);

  const shortBtn = (t) => {
    const s = String(t || "").replace(/\s+/g, " ").trim();
    if (s.length <= 90) return s;
    return s.slice(0, 90) + "…";
  };

  async function countAnchors() {
    return page.evaluate((root) => {
      const scope = root || document;

      const commentAs = Array.from(scope.querySelectorAll("a[href*='comment_id']"));
      const replyAs = Array.from(scope.querySelectorAll("a[href*='reply_comment_id']"));

      const uniq = (arr, param) => {
        const ids = new Set();
        for (const a of arr) {
          const href = a.getAttribute("href") || "";
          const m = href.match(new RegExp(`${param}=([^&]+)`));
          if (m && m[1]) ids.add(m[1]);
        }
        return ids.size;
      };

      return {
        commentsAnchors: uniq(commentAs, "comment_id"),
        replyAnchors: uniq(replyAs, "reply_comment_id"),
        nodes: scope.querySelectorAll("div.xwib8y2.xpdmqnj.x1g0dm76.x1y1aw1k").length || 0,
      };
    }, rootHandle);
  }

  async function gentleScrollKick(pixels = PACE_CFG.scrollPx) {
    try {
      const info = await page.evaluate((root, scroller, px) => {
        const pick =
          scroller || root || document.scrollingElement || document.documentElement || document.body;

        const before =
          pick && typeof pick.scrollTop === "number" ? pick.scrollTop : window.scrollY || 0;

        if (pick && typeof pick.scrollTop === "number") pick.scrollTop = pick.scrollTop + px;
        else window.scrollBy(0, px);

        const after =
          pick && typeof pick.scrollTop === "number" ? pick.scrollTop : window.scrollY || 0;

        return { moved: before !== after, tag: pick?.tagName || "UNKNOWN", before, after };
      }, rootHandle, scrollHandle, pixels);

      if (!info?.moved) {
        log.debug("UI:photo", `Scroll NO-MOVE tag=${info?.tag} ${info?.before}→${info?.after}`);
      }
    } catch {
      await page.evaluate((px) => window.scrollBy(0, px), pixels).catch(() => {});
    }

    await sleepRandom(PACE_CFG.afterScrollMinMs, PACE_CFG.afterScrollMaxMs);
  }

  async function getScrollMetrics() {
    return page.evaluate((root, scroller) => {
      const pick =
        scroller || root || document.scrollingElement || document.documentElement || document.body;

      const isEl = pick && typeof pick.scrollHeight === "number";

      if (!isEl) {
        const se = document.scrollingElement || document.documentElement || document.body;
        return {
          tag: "WINDOW",
          scrollTop: window.scrollY || 0,
          scrollHeight: se?.scrollHeight || 0,
          clientHeight: window.innerHeight || 0,
        };
      }

      return {
        tag: pick.tagName || "UNKNOWN",
        scrollTop: pick.scrollTop || 0,
        scrollHeight: pick.scrollHeight || 0,
        clientHeight: pick.clientHeight || window.innerHeight || 0,
      };
    }, rootHandle, scrollHandle);
  }

  async function hasLoadMoreButtons() {
    return page.evaluate((root) => {
      const scope = root || document;

      const norm = (s) =>
        String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      const isVisible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        return r.bottom > 0 && r.top < window.innerHeight;
      };

      const nodesBtn = Array.from(
        scope.querySelectorAll("button,a,div[role='button'],span[role='button']")
      ).filter(isVisible);

      return nodesBtn.some((el) => {
        const t = norm(el.getAttribute?.("aria-label") || el.textContent);

        if (
          t.includes("wyświetl więcej komentarzy") ||
          t.includes("zobacz więcej komentarzy") ||
          t.includes("zobacz wcześniejsze komentarze") ||
          t.includes("view more comments") ||
          t.includes("view previous comments")
        )
          return true;

        if (/\b\d+\s*(odpowiedzi|replies)\b/.test(t)) return true;
        if (t.includes("wyświetl") && t.includes("odpowied")) return true;
        if (t.includes("zobacz") && t.includes("odpowied")) return true;
        if (t.includes("view") && t.includes("repl")) return true;
        if (t.includes("see") && t.includes("repl")) return true;

        return false;
      });
    }, rootHandle);
  }

  function isHardBottom(m) {
    const eps = Math.max(2, Number(PACE_CFG.hardBottomEpsPx || 10));
    const top = Number(m?.scrollTop || 0);
    const ch = Number(m?.clientHeight || 0);
    const sh = Number(m?.scrollHeight || 0);
    if (!sh || !ch) return false;
    return top + ch >= sh - eps;
  }

  let bottomStable = 0;
  let lastBottomScrollHeight = null;

  async function updateHardBottomStability() {
    const m1 = await getScrollMetrics().catch(() => null);
    if (!m1) return { atBottom: false, stable: bottomStable, tag: "NA", anyMore: true };

    const atBottom = isHardBottom(m1);

    await sleepRandom(PACE_CFG.hardBottomStableDelayMinMs, PACE_CFG.hardBottomStableDelayMaxMs);

    const m2 = await getScrollMetrics().catch(() => m1);
    const atBottom2 = isHardBottom(m2);

    const anyMore = await hasLoadMoreButtons().catch(() => true);

    const sh = Number(m2?.scrollHeight || 0);
    const shStable =
      lastBottomScrollHeight == null ? true : Math.abs(sh - lastBottomScrollHeight) <= 2;

    if (atBottom && atBottom2 && !anyMore && shStable) bottomStable++;
    else bottomStable = 0;

    lastBottomScrollHeight = sh;

    return {
      atBottom: atBottom && atBottom2,
      stable: bottomStable,
      tag: m2?.tag || "UNKNOWN",
      anyMore,
      scrollTop: m2?.scrollTop,
      clientHeight: m2?.clientHeight,
      scrollHeight: m2?.scrollHeight,
    };
  }

  // DOM-driven synchronizacja po klikach (bez ciężkich sleepów)
  async function waitForEffect(beforeCounts, kind) {
    const timeout = PACE_CFG.effectWaitMs;

    const ok = await page
      .waitForFunction(
        (root, before, kindArg) => {
          const scope = root || document;

          const countUniq = (sel, param) => {
            const as = Array.from(scope.querySelectorAll(sel));
            const ids = new Set();
            for (const a of as) {
              const href = a.getAttribute("href") || "";
              const m = href.match(new RegExp(`${param}=([^&]+)`));
              if (m && m[1]) ids.add(m[1]);
            }
            return ids.size;
          };

          const commentsAnchors = countUniq("a[href*='comment_id']", "comment_id");
          const replyAnchors = countUniq("a[href*='reply_comment_id']", "reply_comment_id");
          const nodes = scope.querySelectorAll("div.xwib8y2.xpdmqnj.x1g0dm76.x1y1aw1k").length || 0;

          if (
            commentsAnchors > (before?.commentsAnchors || 0) ||
            replyAnchors > (before?.replyAnchors || 0) ||
            nodes > (before?.nodes || 0)
          ) {
            return true;
          }

          const norm = (s) =>
            String(s || "")
              .replace(/\u00a0/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();

          const isVisible = (el) => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return false;
            return r.bottom > 0 && r.top < window.innerHeight;
          };

          const nodesBtn = Array.from(
            scope.querySelectorAll("button,a,div[role='button'],span[role='button']")
          ).filter(isVisible);

          const stillThere =
            kindArg === "comments"
              ? nodesBtn.some((el) => {
                  const t = norm(el.getAttribute?.("aria-label") || el.textContent);
                  return (
                    t.includes("wyświetl więcej komentarzy") ||
                    t.includes("zobacz więcej komentarzy") ||
                    t.includes("zobacz wcześniejsze komentarze") ||
                    t.includes("view more comments") ||
                    t.includes("view previous comments")
                  );
                })
              : nodesBtn.some((el) => {
                  const t = norm(el.getAttribute?.("aria-label") || el.textContent);
                  if (/\b\d+\s*(odpowiedzi|replies)\b/.test(t)) return true;
                  if (t.includes("wyświetl") && t.includes("odpowied")) return true;
                  if (t.includes("zobacz") && t.includes("odpowied")) return true;
                  if (t.includes("view") && t.includes("repl")) return true;
                  if (t.includes("see") && t.includes("repl")) return true;
                  return false;
                });

          // jeśli kliknięty typ przycisku zniknął -> też traktujemy jako “efekt”
          return !stillThere;
        },
        { timeout, polling: 120 },
        rootHandle,
        beforeCounts,
        kind
      )
      .then(() => true)
      .catch(() => false);

    return ok;
  }

  async function bonusClicks(kind, beforeCounts) {
    const tries = Math.max(0, Number(PACE_CFG.bonusClickTries || 0));
    if (!tries) return 0;

    let clicked = 0;
    let curBefore = beforeCounts;

    for (let i = 0; i < tries; i++) {
      await sleepRandom(PACE_CFG.bonusClickDelayMinMs, PACE_CFG.bonusClickDelayMaxMs);

      const res =
        kind === "replies"
          ? await clickOneReplyButton().catch(() => ({ clicked: false }))
          : await clickMoreCommentsButton().catch(() => ({ clicked: false }));

      if (!res?.clicked) break;

      clicked++;

      // mikro-oddech, potem czekamy na efekt
      await sleepRandom(80, 140);
      await waitForEffect(curBefore, kind);

      // aktualizujemy bazę do kolejnego bonus-kliku
      curBefore = await countAnchors().catch(() => curBefore);

      // minimalny settle po doładowaniu
      await sleepRandom(90, 170);
    }

    return clicked;
  }

    async function clickOneReplyButton() {
    const res = await page.evaluate((root) => {
      const scope = root || document;

      const norm = (s) =>
        String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      const isVisible = (el) => {
        if (!el) return false;
        try {
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) return false;
          // Dopuszczamy też elementy trochę “pod” viewportem – FB lubi lazy render
          return r.bottom > -60 && r.top < window.innerHeight + 120;
        } catch {
          return true;
        }
      };

      const isReplyExpanderText = (t) => {
        if (!t) return false;
        if (t.includes("powiadomienia") || t.includes("szukaj znajomych")) return false;
        if (t.length > 220) return false;

        // WYKLUCZ: zwykłe “Odpowiedz/Reply”
        if (t === "odpowiedz" || t === "reply") return false;
        if (t.startsWith("odpowiedz ")) return false;
        if (t.startsWith("reply ")) return false;

        // KLUCZ: “5 odpowiedzi”, “2 replies”, oraz “... odpowiedział · 5 odpowiedzi”
        if (/\b\d+\s*(odpowiedzi|replies)\b/.test(t)) return true;

        // warianty opisowe
        if (t.includes("wyświetl") && t.includes("odpowied")) return true;
        if (t.includes("zobacz") && t.includes("odpowied")) return true;
        if (t.includes("view") && t.includes("repl")) return true;
        if (t.includes("see") && t.includes("repl")) return true;

        return false;
      };

      // 1) Szukamy NAJSZERZEJ: każdy element z tekstem pasującym do expandera
      // (FB często ma to jako zwykły div/span bez role/button)
      const allTextCandidates = Array.from(
        scope.querySelectorAll("a,button,div,span")
      )
        .filter(isVisible)
        .slice(0, 35000);

      let best = null;
      let bestScore = -Infinity;

      for (const el of allTextCandidates) {
        const tRaw = el.getAttribute?.("aria-label") || el.textContent || "";
        const t = norm(tRaw);
        if (!isReplyExpanderText(t)) continue;

        // Wyklucz elementy, które są “przyciskami reakcji” itp.
        if (t.includes("lubię") || t.includes("like")) continue;
        if (t.includes("udost") || t.includes("share")) continue;

        const r = el.getBoundingClientRect();
        let score = 0;

        // preferuj elementy niżej (zwykle wątki są pod komentarzem)
        score += Math.max(0, r.top);

        // preferuj te z liczbą odpowiedzi
        if (/\b\d+\s*(odpowiedzi|replies)\b/.test(t)) score += 900;

        // preferuj “wszystkie/all”
        if (t.includes("wszystkie") || t.includes("all")) score += 300;

        // preferuj krótsze, “czystsze” teksty (mniej śmieci)
        score -= Math.min(500, t.length * 3);

        if (score > bestScore) {
          bestScore = score;
          best = el;
        }
      }

      if (!best) return { clicked: false };

      // 2) Klikamy NAJBLIŻSZY “klikany” wrapper, a jeśli go nie ma – klikamy sam tekst
      const clickable =
        best.closest?.("a,button,div[role='button'],span[role='button']") || best;

      try {
        clickable.scrollIntoView?.({ block: "center", inline: "nearest" });
      } catch {}

      const txt = (clickable.getAttribute?.("aria-label") || clickable.textContent || "").trim();

      const hardClick = (node) => {
        try {
          node.click();
          return true;
        } catch {}
        try {
          const r = node.getBoundingClientRect();
          const x = Math.floor(r.left + Math.min(10, r.width / 2));
          const y = Math.floor(r.top + Math.min(10, r.height / 2));
          const target = document.elementFromPoint(x, y) || node;
          target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
          target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
          target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
          return true;
        } catch {}
        return false;
      };

      const ok = hardClick(clickable);
      return { clicked: ok, text: txt };
    }, rootHandle);

    return res || { clicked: false };
  }


  async function clickMoreCommentsButton() {
    const res = await page.evaluate((root) => {
      const scope = root || document;

      const norm = (s) =>
        String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      const isVisible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        return r.bottom > 0 && r.top < window.innerHeight;
      };

      const isMore = (t) => {
        if (!t) return false;
        if (t.includes("powiadomienia") || t.includes("szukaj znajomych")) return false;
        if (t.length > 140) return false;

        return (
          t.includes("wyświetl więcej komentarzy") ||
          t.includes("zobacz więcej komentarzy") ||
          t.includes("zobacz wcześniejsze komentarze") ||
          t.includes("view more comments") ||
          t.includes("view previous comments")
        );
      };

      const candidates = Array.from(
        scope.querySelectorAll("a,button,div[role='button'],span[role='button']")
      ).filter(isVisible);

      let best = null;
      let bestY = -1;

      for (const el of candidates) {
        const t = norm(el.getAttribute?.("aria-label") || el.textContent);
        if (!isMore(t)) continue;
        const r = el.getBoundingClientRect();
        if (r.top > bestY) {
          bestY = r.top;
          best = el;
        }
      }

      if (!best) return { clicked: false };

      try {
        best.scrollIntoView?.({ block: "center", inline: "nearest" });
      } catch {}

      const txt = (best.getAttribute?.("aria-label") || best.textContent || "").trim();

      try {
        best.click();
        return { clicked: true, text: txt };
      } catch {
        return { clicked: false, text: txt };
      }
    }, rootHandle);

    return res || { clicked: false };
  }

  /* ===================== SWEEP: REPLY EXPANDERS (TOP -> DOWN) ===================== */

  async function hasAnyReplyExpanders(page, rootHandle) {
    return page.evaluate((root) => {
      const scope = root || document;

      const norm = (s) =>
        String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      const isVisible = (el) => {
        if (!el) return false;
        try {
          const r = el.getBoundingClientRect();
          return r.width > 2 && r.height > 2 && r.bottom > -60 && r.top < window.innerHeight + 120;
        } catch {
          return true;
        }
      };

      const isReplyExpanderText = (t) => {
        if (!t) return false;
        if (t.includes("powiadomienia") || t.includes("szukaj znajomych")) return false;
        if (t.length > 220) return false;

        if (t === "odpowiedz" || t === "reply") return false;
        if (t.startsWith("odpowiedz ")) return false;
        if (t.startsWith("reply ")) return false;

        if (/\b\d+\s*(odpowiedzi|replies)\b/.test(t)) return true;

        if (t.includes("wyświetl") && t.includes("odpowied")) return true;
        if (t.includes("zobacz") && t.includes("odpowied")) return true;
        if (t.includes("view") && t.includes("repl")) return true;
        if (t.includes("see") && t.includes("repl")) return true;

        return false;
      };

      const nodes = Array.from(scope.querySelectorAll("a,button,div,span")).slice(0, 35000);

      for (const el of nodes) {
        if (!isVisible(el)) continue;
        const t = norm(el.getAttribute?.("aria-label") || el.textContent);
        if (!t) continue;

        if (t.includes("lubię") || t.includes("like")) continue;
        if (t.includes("udost") || t.includes("share")) continue;

        if (isReplyExpanderText(t)) return true;
      }

      return false;
    }, rootHandle);
  }

  async function clickAllVisibleReplyExpanders(page, rootHandle, maxPerPass = 12) {
    const res = await page.evaluate(
      (root, limit) => {
        const scope = root || document;

        const norm = (s) =>
          String(s || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();

        const isVisible = (el) => {
          if (!el) return false;
          try {
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return false;
            return r.bottom > -60 && r.top < window.innerHeight + 120;
          } catch {
            return true;
          }
        };

        const isReplyExpanderText = (t) => {
          if (!t) return false;
          if (t.includes("powiadomienia") || t.includes("szukaj znajomych")) return false;
          if (t.length > 220) return false;

          if (t === "odpowiedz" || t === "reply") return false;
          if (t.startsWith("odpowiedz ")) return false;
          if (t.startsWith("reply ")) return false;

          if (/\b\d+\s*(odpowiedzi|replies)\b/.test(t)) return true;

          if (t.includes("wyświetl") && t.includes("odpowied")) return true;
          if (t.includes("zobacz") && t.includes("odpowied")) return true;
          if (t.includes("view") && t.includes("repl")) return true;
          if (t.includes("see") && t.includes("repl")) return true;

          return false;
        };

        const candidates = Array.from(scope.querySelectorAll("a,button,div,span"))
          .filter(isVisible)
          .slice(0, 35000)
          .map((el) => {
            const t = norm(el.getAttribute?.("aria-label") || el.textContent);
            return { el, t };
          })
          .filter((x) => {
            if (!x.t) return false;
            if (x.t.includes("lubię") || x.t.includes("like")) return false;
            if (x.t.includes("udost") || x.t.includes("share")) return false;
            return isReplyExpanderText(x.t);
          });

        // preferuj elementy niżej w widoku
        candidates.sort((a, b) => {
          const ra = a.el.getBoundingClientRect();
          const rb = b.el.getBoundingClientRect();
          return rb.top - ra.top;
        });

        const hardClick = (node) => {
          try {
            node.click();
            return true;
          } catch {}
          try {
            const r = node.getBoundingClientRect();
            const x = Math.floor(r.left + Math.min(10, r.width / 2));
            const y = Math.floor(r.top + Math.min(10, r.height / 2));
            const target = document.elementFromPoint(x, y) || node;
            target.dispatchEvent(
              new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })
            );
            target.dispatchEvent(
              new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window })
            );
            target.dispatchEvent(
              new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
            );
            return true;
          } catch {}
          return false;
        };

        let clicked = 0;
        const sample = [];

        for (const item of candidates) {
          if (clicked >= limit) break;

          const clickable =
            item.el.closest?.("a,button,div[role='button'],span[role='button']") || item.el;

          try {
            clickable.scrollIntoView?.({ block: "center", inline: "nearest" });
          } catch {}

          const txt = (clickable.getAttribute?.("aria-label") || clickable.textContent || "").trim();

          const ok = hardClick(clickable);
          if (ok) {
            clicked++;
            if (sample.length < 5) sample.push(txt);
          }
        }

        return { clicked, sample };
      },
      rootHandle,
      maxPerPass
    );

    return res || { clicked: 0, sample: [] };
  }

  async function scrollCommentsToTop(page, rootHandle, scrollHandle) {
    await page.evaluate((root, scroller) => {
      const pick =
        scroller || root || document.scrollingElement || document.documentElement || document.body;

      if (pick && typeof pick.scrollTop === "number") pick.scrollTop = 0;
      else window.scrollTo(0, 0);
    }, rootHandle, scrollHandle);
  }

  async function sweepRepliesTopDown(
    page,
    rootHandle,
    scrollHandle,
    {
      maxPasses = 3,
      stepsPerPass = 40,
      scrollPx = Math.max(180, Math.floor(Number(PACE_CFG.scrollPx || 160) * 1.2)),
      maxClicksPerStep = 12,
    } = {}
  ) {
    let totalClicked = 0;

    for (let pass = 1; pass <= maxPasses; pass++) {
      await scrollCommentsToTop(page, rootHandle, scrollHandle);
      await sleepRandom(140, 240);

      let staleSteps = 0;

      for (let step = 1; step <= stepsPerPass; step++) {
        const before = await countAnchors().catch(() => null);

        const r = await clickAllVisibleReplyExpanders(page, rootHandle, maxClicksPerStep).catch(
          () => ({ clicked: 0, sample: [] })
        );

        if (r.clicked > 0) {
          totalClicked += r.clicked;

          if (before) {
            await sleepRandom(60, 120);
            await waitForEffect(before, "replies");
          }

          await sleepRandom(90, 160);
          staleSteps = 0;
        } else {
          staleSteps++;
        }

        const m1 = await getScrollMetrics().catch(() => null);
        await gentleScrollKick(scrollPx);
        const m2 = await getScrollMetrics().catch(() => null);

        const moved = !!(m1 && m2 && m2.scrollTop !== m1.scrollTop);

        if (!moved && staleSteps >= 4) break;
        if (staleSteps >= 8) break;
      }

      const any = await hasAnyReplyExpanders(page, rootHandle).catch(() => false);
      if (!any) break;
    }

    return totalClicked;
  }

  /* ------------------ LOG throttling (bez spamu) ------------------ */
  let lastLogAt = 0;
  let lastLogKey = "";
  const LOG_EVERY_N_STEPS = 6;
  const LOG_MIN_MS = 800;
  const shouldLog = (step, key, force = false) => {
    const now = Date.now();
    if (force) {
      lastLogAt = now;
      lastLogKey = key;
      return true;
    }
    if (step % LOG_EVERY_N_STEPS === 0) {
      lastLogAt = now;
      lastLogKey = key;
      return true;
    }
    if (now - lastLogAt >= LOG_MIN_MS && key !== lastLogKey) {
      lastLogAt = now;
      lastLogKey = key;
      return true;
    }
    return false;
  };

  let cur = await countAnchors().catch(() => ({ commentsAnchors: 0, replyAnchors: 0, nodes: 0 }));
  log.debug("UI:photo", "startCounts", cur);

  for (let step = 1; step <= MAX_STEPS; step++) {
    const before = cur;
    let action = "scroll";
    let clickInfo = null;
    let effectOk = false;
    let bonus = 0;

    // 1) REPLIES
    const r1 = await clickOneReplyButton().catch(() => ({ clicked: false }));
    if (r1?.clicked) {
      action = "replies";
      clickInfo = r1;

      await sleepRandom(80, 140);
      effectOk = await waitForEffect(before, "replies");
      await sleepRandom(90, 170);

      // bonus klików tylko jeśli był efekt (żeby nie mielić)
      if (effectOk) {
        bonus = await bonusClicks("replies", before);
      } else {
        // brak efektu -> delikatny scroll, często przycisk jest pod overlay / wirtualizacja
        await gentleScrollKick(Math.floor(PACE_CFG.scrollPx * 0.6));
      }
    } else {
      // 2) MORE COMMENTS
      const c1 = await clickMoreCommentsButton().catch(() => ({ clicked: false }));
      if (c1?.clicked) {
        action = "comments";
        clickInfo = c1;

        await sleepRandom(80, 140);
        effectOk = await waitForEffect(before, "comments");
        await sleepRandom(90, 170);

        if (effectOk) {
          bonus = await bonusClicks("comments", before);
        } else {
          await gentleScrollKick(Math.floor(PACE_CFG.scrollPx * 0.6));
        }
      } else {
        // 3) SCROLL
        action = "scroll";
        await gentleScrollKick(PACE_CFG.scrollPx);
      }
    }

    cur = await countAnchors().catch(() => before);

    const progressed =
      cur.commentsAnchors > before.commentsAnchors ||
      cur.replyAnchors > before.replyAnchors ||
      cur.nodes > before.nodes;

    if (!progressed) noProgress++;
    else noProgress = 0;

    // Hard-bottom sprawdzamy tylko wtedy, gdy realnie utknęliśmy albo scrollujemy
    let hb = { atBottom: false, stable: 0, tag: "NA", anyMore: true };
    const shouldCheckHB = action === "scroll" || noProgress >= 3;
    if (shouldCheckHB) {
      hb = await updateHardBottomStability().catch(() => ({
        atBottom: false,
        stable: bottomStable,
        tag: "NA",
        anyMore: true,
      }));
    }

    const btnTxt = clickInfo?.clicked ? ` btn="${shortBtn(clickInfo.text)}"` : "";
    const key =
      `${action}|cA:${before.commentsAnchors}->${cur.commentsAnchors}` +
      `|rA:${before.replyAnchors}->${cur.replyAnchors}` +
      `|n:${before.nodes}->${cur.nodes}|np:${noProgress}|eff:${effectOk}|bonus:${bonus}` +
      `|hb:${hb.atBottom ? 1 : 0}/${hb.stable} more:${hb.anyMore ? 1 : 0} tag:${hb.tag}${btnTxt}`;

    const forceLog = progressed || clickInfo?.clicked || noProgress >= 10 || hb.stable >= 2;
    if (shouldLog(step, key, forceLog)) {
      log.debug("UI:photo", `step=${step} ${action} cA ${before.commentsAnchors}→${cur.commentsAnchors} rA ${before.replyAnchors}→${cur.replyAnchors} np=${noProgress}/${MAX_NO_PROGRESS}`);
    }

    if (hb.stable >= Number(PACE_CFG.hardBottomStableNeed || 4)) {
      log.debug("UI:photo", "Stop: hard-bottom-stable");
      break;
    }

    if (noProgress >= MAX_NO_PROGRESS) {
      log.debug("UI:photo", "Stop: too many no-progress steps");
      break;
    }

    // mikrojitter na końcu kroku (żeby FB nie dostał “karabinu”)
    await sleepRandom(PACE_CFG.stepJitterMinMs, PACE_CFG.stepJitterMaxMs);
  }

  // FINAL + SWEEP (tylko jeśli coś jeszcze zostało do kliknięcia)
  let final = await countAnchors().catch(() => cur);
  log.debug("UI:photo", "Done", final);

  const needSweep = await hasAnyReplyExpanders(page, rootHandle).catch(() => false);
  if (needSweep) {
    log.debug("UI:photo", "Sweep: reply expanders -> top-down...");
    const clicked = await sweepRepliesTopDown(page, rootHandle, scrollHandle).catch(() => 0);
    log.debug("UI:photo", `Sweep: clicked=${clicked}`);
    final = await countAnchors().catch(() => final);
    log.debug("UI:photo", "After sweep", final);
  } else {
    log.debug("UI:photo", "Sweep: brak reply expanders");
  }

  try {
    await scrollHandle.dispose?.();
  } catch {}
  try {
    await rootHandle.dispose?.();
  } catch {}
}

/* =====================
   Analiza założeń
   1) Zakładanie stałych sleepów po klikach rozjeżdża się z async-renderem FB.
      Tu większość synchronizacji jest DOM-driven (waitForEffect) + mikro settle.
   2) “reply” i “X odpowiedzi” bywają różnymi wrapperami — klikamy closest() i filtrujemy tekstem.
   3) Hard-bottom jest kosztowny czasowo, więc liczymy go tylko gdy utknęliśmy/scrollujemy.

   Co powiedziałby sceptyk?
   - Jeśli FB wirtualizuje wątek, “done” nie zawsze znaczy “wszystko wczytane”.
   - “Loaded” (comment_id) nigdy nie jest “total”, tylko “ile już zobaczyłeś”.
   - UI warianty potrafią zmieniać nazwy/role — logi i fallbacki są konieczne.

   ===================== */
