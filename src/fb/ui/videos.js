import { safeGoto } from "../../utils/navigation.js";
import { sleepRandom } from "../../utils/sleep.js";
import { acceptCookies } from "../cookies.js";
import { fbLogin, checkIfLogged } from "../login.js";
import { getUiCommentInfo } from "../uiCommentInfo.js";

/** Typ handlera UI */
export const type = "videos";

export function matchesUrl(url) {
  const lower = (url || "").toLowerCase();
  return lower.includes("/videos/") || (lower.includes("?v=") && !lower.includes("/watch"));
}

export async function prepare(page, url) {
  console.log(`[FB][ui:videos] Otwieranie posta wideo: ${url}`);
  const ok = await safeGoto(page, url, "videos", { waitUntil: "networkidle2", timeout: 90000 });
  if (!ok) throw new Error("safeGoto-failed");

  const currentUrl = page.url();
  if (currentUrl.includes("/login")) {
    console.log("[FB][ui:videos] Wymagane logowanie – próbuję zalogować.");
    await fbLogin(page);
    await sleepRandom(3000, 4500);

    const loggedAfterLogin = await checkIfLogged(page).catch(() => false);
    console.log(
      `[FB][ui:videos] Stan sesji po fbLogin: ${loggedAfterLogin ? "ZALOGOWANY" : "NIEZALOGOWANY"}`
    );

    if (loggedAfterLogin) {
      await safeGoto(page, url, "videos", { waitUntil: "networkidle2", timeout: 90000 });
    } else {
      console.log("[FB][ui:videos] Logowanie nieudane – kontynuacja bez sesji.");
    }
  }

  await acceptCookies(page, "videos");

  // stop autoplay
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
    console.log("[FB][ui:videos] Wideo wstrzymane (autoplay wyłączony).");
  } catch (e) {
    console.log("[FB][ui:videos] Błąd zatrzymania wideo:", e?.message || e);
  }
}

export async function getCommentCount(page, url) {
  const uiInfo = await getUiCommentInfo(page);
  console.log(`[FB][ui:videos][DBG] UI info:`, {
    source: uiInfo?.source,
    raw: uiInfo?.raw,
    viewType: uiInfo?.viewType,
    comments: uiInfo?.comments,
  });

  let totalComments = null;
  if (uiInfo && typeof uiInfo.comments === "number" && uiInfo.comments > 0) totalComments = uiInfo.comments;

  console.log(
    `[FB][ui:videos] Liczba komentarzy wg UI: ${totalComments !== null ? totalComments : "brak danych"}`
  );
  return totalComments;
}

/* ==============================
   ======= DEBUG HELPERS ========
   ============================== */

function shortenHtml(html, max = 220) {
  if (!html) return null;
  const s = String(html).replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

async function debugDumpShowAllCandidates(page) {
  const out = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    function pick(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        role: el.getAttribute("role"),
        aria: el.getAttribute("aria-label"),
        text: norm(el.textContent),
        top: Math.round(r.top),
        left: Math.round(r.left),
        w: Math.round(r.width),
        h: Math.round(r.height),
        inViewport: r.bottom > 0 && r.top < window.innerHeight,
      };
    }

    const headers = Array.from(document.querySelectorAll("span"))
      .filter((s) => {
        const t = norm(s.textContent).toLowerCase();
        return t === "komentarze" || t === "comments";
      })
      .slice(0, 5)
      .map(pick);

    const showAll = Array.from(
      document.querySelectorAll("div[role='button'][aria-label],button[aria-label],a[aria-label]")
    )
      .filter((el) => {
        const al = (el.getAttribute("aria-label") || "").toLowerCase().trim();
        return al === "pokaż wszystkie" || al === "wyświetl wszystkie" || al === "show all" || al === "view all";
      })
      .slice(0, 20)
      .map(pick);

    return { headers, showAll };
  });

  console.log("[FB][ui:videos][DBG] candidates:", JSON.stringify(out, null, 2));
}

/* ==========================================
   ======= COMMENTS SCOPE / MARKERS =========
   ========================================== */

async function markCommentsScope(page) {
  return await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

    function isVisible(el) {
      if (!el) return false;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return !!r && r.width > 5 && r.height > 5;
    }

    function pick(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        role: el.getAttribute("role"),
        aria: el.getAttribute("aria-label"),
        text: (el.textContent || "").replace(/\s+/g, " ").trim(),
        top: Math.round(r.top),
        left: Math.round(r.left),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    }

    // clear markers
    try {
      document.querySelectorAll("[data-fbw-comments-root='1']").forEach((n) => n.removeAttribute("data-fbw-comments-root"));
      document.querySelectorAll("[data-fbw-comments-header-row='1']").forEach((n) =>
        n.removeAttribute("data-fbw-comments-header-row")
      );
      document.querySelectorAll("[data-fbw-comments-anchor='1']").forEach((n) =>
        n.removeAttribute("data-fbw-comments-anchor")
      );
    } catch {}

    // find header
    const headerSpans = Array.from(document.querySelectorAll("span"))
      .filter(isVisible)
      .filter((el) => {
        const t = norm(el.textContent);
        return t === "komentarze" || t === "comments";
      });

    if (!headerSpans.length) return { ok: false, reason: "no-header" };

    // pick first visible header and mark a "root" around it
    const h = headerSpans[0];

    // header row: climb until it contains "Pokaż wszystkie" OR "Ukryj komentarze"
    let row = h.parentElement;
    let foundRow = null;

    for (let up = 0; up < 14 && row; up++) {
      const btns = Array.from(
        row.querySelectorAll("div[role='button'][aria-label],button[aria-label],a[aria-label]")
      ).filter(isVisible);

      const ok = btns.some((b) => {
        const al = norm(b.getAttribute("aria-label"));
        return (
          al === "pokaż wszystkie" ||
          al === "wyświetl wszystkie" ||
          al === "show all" ||
          al === "view all" ||
          al === "ukryj komentarze" ||
          al === "hide comments"
        );
      });

      if (ok) {
        foundRow = row;
        break;
      }
      row = row.parentElement;
    }

    if (foundRow) {
      try {
        foundRow.setAttribute("data-fbw-comments-header-row", "1");
      } catch {}
    }

    // comments root: climb from header span to a big block that contains comment box or "Najtrafniejsze"
    let root = h.parentElement;
    let best = null;

    for (let up = 0; up < 26 && root; up++) {
      const txt = norm(root.innerText || "");
      const hasCommentBox = txt.includes("napisz komentarz") || txt.includes("write a comment");
      const hasSort = txt.includes("najtrafniejsze") || txt.includes("most relevant") || txt.includes("top comments");
      const hasRepliesWord = txt.includes("odpowied") || txt.includes("repl");
      const isBigEnough = (root.clientHeight || 0) > 250;

      if ((hasCommentBox || hasSort || hasRepliesWord) && isBigEnough) {
        best = root;
        break;
      }
      root = root.parentElement;
    }

    // fallback: use header row parent
    if (!best && foundRow) best = foundRow.parentElement;
    if (!best) best = document.body;

    try {
      best.setAttribute("data-fbw-comments-root", "1");
    } catch {}

    // anchor element for scroll targeting: header span itself
    try {
      h.setAttribute("data-fbw-comments-anchor", "1");
    } catch {}

    return {
      ok: true,
      reason: "marked",
      header: pick(h),
      row: foundRow ? pick(foundRow) : null,
      root: pick(best),
    };
  });
}

async function clickShowAllFromMarkedRow(page) {
  const res = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

    function isVisible(el) {
      if (!el) return false;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return !!r && r.width > 5 && r.height > 5;
    }

    function pick(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        role: el.getAttribute("role"),
        aria: el.getAttribute("aria-label"),
        text: (el.textContent || "").replace(/\s+/g, " ").trim(),
        top: Math.round(r.top),
        left: Math.round(r.left),
        w: Math.round(r.width),
        h: Math.round(r.height),
        inViewport: r.bottom > 0 && r.top < window.innerHeight,
        html: el.outerHTML ? el.outerHTML.slice(0, 260) : null,
      };
    }

    const row = document.querySelector("[data-fbw-comments-header-row='1']");
    if (!row) return { clicked: false, reason: "no-row", dbg: null };

    const candidates = Array.from(
      row.querySelectorAll("div[role='button'][aria-label],button[aria-label],a[aria-label]")
    ).filter(isVisible);

    // Prefer "Pokaż wszystkie" only (not "Ukryj komentarze")
    for (const c of candidates) {
      const al = norm(c.getAttribute("aria-label"));
      if (al === "pokaż wszystkie" || al === "wyświetl wszystkie" || al === "show all" || al === "view all") {
        try {
          c.scrollIntoView({ block: "center", inline: "nearest" });
        } catch {}
        try {
          c.click();
        } catch {}
        return { clicked: true, reason: "clicked", dbg: pick(c) };
      }
    }

    return { clicked: false, reason: "no-showall-in-row", dbg: candidates.slice(0, 4).map(pick) };
  });

  console.log("[FB][ui:videos][DBG] show-all click:", JSON.stringify(res, null, 2));
  return !!res?.clicked;
}

/* ==========================================
   ======= FILTER/SORT (Najtrafniejsze) ======
   ========================================== */

async function ensureAllCommentsFilter(page) {
  const res = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

    function isVisible(el) {
      if (!el) return false;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return !!r && r.width > 5 && r.height > 5;
    }

    function pick(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        role: el.getAttribute("role"),
        aria: el.getAttribute("aria-label"),
        text: (el.textContent || "").replace(/\s+/g, " ").trim(),
        top: Math.round(r.top),
        left: Math.round(r.left),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    }

    const root = document.querySelector("[data-fbw-comments-root='1']") || document.body;

    // If already shows "Wszystkie komentarze" / "All comments" / "Najnowsze" etc, do nothing
    const rootTxt = norm(root.innerText || "");
    if (rootTxt.includes("wszystkie komentarze") || rootTxt.includes("all comments")) {
      return { ok: true, action: "already-all", dbg: null };
    }

    // find the sort dropdown button in root
    const btns = Array.from(root.querySelectorAll("div[role='button'],span[role='button'],button")).filter(isVisible);

    const sortBtn = btns.find((b) => {
      const t = norm(b.textContent);
      return (
        t === "najtrafniejsze" ||
        t === "most relevant" ||
        t === "top comments" ||
        t === "najlepsze" ||
        t === "newest" ||
        t === "najnowsze"
      );
    });

    if (!sortBtn) {
      return { ok: false, action: "no-sortbtn", dbg: { sample: btns.slice(0, 8).map(pick) } };
    }

    try {
      sortBtn.scrollIntoView({ block: "center", inline: "nearest" });
    } catch {}
    try {
      sortBtn.click();
    } catch {}

    return { ok: true, action: "opened-menu", dbg: pick(sortBtn) };
  });

  console.log("[FB][ui:videos][DBG] filter step#1:", JSON.stringify(res, null, 2));

  if (!res?.ok || res.action !== "opened-menu") return false;

  await sleepRandom(400, 700);

  const res2 = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

    function isVisible(el) {
      if (!el) return false;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return !!r && r.width > 5 && r.height > 5;
    }

    function pick(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        role: el.getAttribute("role"),
        aria: el.getAttribute("aria-label"),
        text: (el.textContent || "").replace(/\s+/g, " ").trim(),
        top: Math.round(r.top),
        left: Math.round(r.left),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    }

    const menu = document.querySelector("div[role='menu']") || document.querySelector("div[role='dialog']");

    if (!menu) return { ok: false, action: "no-menu" };

    const items = Array.from(menu.querySelectorAll("div[role='menuitem'], div[role='menuitemradio'], div[role='button']"))
      .filter(isVisible)
      .slice(0, 200);

    // Prefer: "Wszystkie komentarze" / "All comments"
    let target =
      items.find((el) => norm(el.textContent).startsWith("wszystkie komentarze")) ||
      items.find((el) => norm(el.textContent).startsWith("all comments"));

    // Fallback: "Najnowsze" / "Newest"
    if (!target) {
      target = items.find((el) => norm(el.textContent).startsWith("najnowsze")) || items.find((el) => norm(el.textContent).startsWith("newest"));
    }

    if (!target) {
      return { ok: false, action: "no-target", dbg: { items: items.slice(0, 12).map(pick) } };
    }

    try {
      target.scrollIntoView({ block: "center", inline: "nearest" });
    } catch {}
    try {
      target.click();
    } catch {}

    // close menu
    try {
      setTimeout(() => document.body.click(), 40);
    } catch {}

    return { ok: true, action: "clicked-target", dbg: pick(target) };
  });

  console.log("[FB][ui:videos][DBG] filter step#2:", JSON.stringify(res2, null, 2));

  await sleepRandom(500, 900);

  return !!res2?.ok;
}

/* ==========================================
   ======= SEQUENTIAL ACTION LOOP ============
   ========================================== */

async function oneSequentialAction(page) {
  const res = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

    function isVisible(el) {
      if (!el) return false;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return !!r && r.width > 5 && r.height > 5;
    }

    function pick(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        role: el.getAttribute("role"),
        aria: el.getAttribute("aria-label"),
        text: (el.textContent || "").replace(/\s+/g, " ").trim(),
        top: Math.round(r.top),
        left: Math.round(r.left),
        w: Math.round(r.width),
        h: Math.round(r.height),
        inViewport: r.bottom > 0 && r.top < window.innerHeight,
        html: el.outerHTML ? el.outerHTML.slice(0, 260) : null,
      };
    }

    // scope: root (jak masz) + lekka próba zejścia do panelu komentarzy przy composerze
    const root = document.querySelector("[data-fbw-comments-root='1']") || document.body;

    const composer =
      root.querySelector("[aria-label^='Napisz komentarz']") ||
      root.querySelector("[aria-label^='Write a comment']") ||
      root.querySelector("[role='textbox'][contenteditable='true']");

    let scope = root;
    if (composer) {
      let p = composer.parentElement;
      for (let up = 0; up < 14 && p; up++) {
        const bigEnough = (p.clientHeight || 0) > 220;
        const t = norm(p.innerText || "");
        const looksCommenty =
          t.includes("najtrafniejsze") ||
          t.includes("most relevant") ||
          t.includes("wszystkie komentarze") ||
          t.includes("all comments") ||
          t.includes("wyświetl więcej komentarzy") ||
          t.includes("view more comments");
        if (bigEnough && looksCommenty) {
          scope = p;
          break;
        }
        p = p.parentElement;
      }
    }

    // UWAGA: klikamy TYLKO elementy klikalne
    const clickables = Array.from(
      scope.querySelectorAll(
        "div[role='button'], button, a[role='button'], a[aria-label], div[tabindex='0'], span[role='button']"
      )
    )
      .filter(isVisible)
      .slice(0, 12000);

    const bannedExact = new Set(["zobacz więcej", "see more", "pokaż więcej", "show more"]);

    const moreCommentNeedles = [
      "wyświetl więcej komentarzy",
      "zobacz więcej komentarzy",
      "view more comments",
      "view previous comments",
      "see more comments",
    ];

    // 1) MORE COMMENTS – tylko clickables
    for (const el of clickables) {
      const t = norm(el.getAttribute("aria-label") || el.textContent);
      if (!t) continue;
      if (bannedExact.has(t)) continue;

      if (moreCommentNeedles.some((n) => t.includes(n))) {
        try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch {}
        try { el.click(); } catch {}
        return { acted: true, action: "more-comments", dbg: pick(el) };
      }
    }

    // 2) REPLIES – tylko clickables
    for (const el of clickables) {
      const t = norm(el.getAttribute("aria-label") || el.textContent);
      if (!t) continue;
      if (bannedExact.has(t)) continue;

      const isReply =
        t.includes("wyświetl więcej odpowiedzi") ||
        t.includes("zobacz więcej odpowiedzi") ||
        t.includes("view more replies") ||
        t.includes("see more replies") ||
        /\b\d+\s+(odpowiedź|odpowiedzi|replies)\b/.test(t);

      if (isReply) {
        try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch {}
        try { el.click(); } catch {}
        return { acted: true, action: "replies", dbg: pick(el) };
      }
    }

    // 3) SCROLL – próbuj scope, potem window
    const step = Math.max(260, Math.min(520, Math.floor(window.innerHeight * 0.45)));

    const beforeScope = scope.scrollTop || 0;
    try {
      if (scope && typeof scope.scrollTop === "number") {
        scope.scrollTop = beforeScope + step;
        const afterScope = scope.scrollTop || beforeScope;
        if (afterScope > beforeScope) {
          return { acted: true, action: "scroll-scope", dbg: { beforeScope, afterScope, step } };
        }
      }
    } catch {}

    const beforeWin = window.scrollY || 0;
    window.scrollBy(0, step);
    const afterWin = window.scrollY || 0;

    return {
      acted: afterWin > beforeWin,
      action: afterWin > beforeWin ? "scroll-window" : "no-scroll",
      dbg: { beforeWin, afterWin, step },
    };
  });

  if (res?.dbg?.html) res.dbg.html = shortenHtml(res.dbg.html, 220);
  console.log("[FB][ui:videos][DBG] step:", JSON.stringify(res, null, 2));
  return res || { acted: false, action: "none", dbg: null };
}



/**
 * Wczytuje wszystkie komentarze dla posta wideo.
 */
export async function loadAllComments(page, { expectedTotal } = {}) {
  console.log("[FB][ui:videos] Ładuję wszystkie komentarze (VIDEOS)...");

  await debugDumpShowAllCandidates(page).catch(() => {});

  const mark1 = await markCommentsScope(page).catch(() => null);
  console.log("[FB][ui:videos][DBG] mark#1:", JSON.stringify(mark1, null, 2));

  await sleepRandom(250, 500);

  // klik show-all z header-row
  const clickedAll = await clickShowAllFromMarkedRow(page).catch(() => false);
  if (clickedAll) {
    await sleepRandom(900, 1400);
    const mark2 = await markCommentsScope(page).catch(() => null);
    console.log("[FB][ui:videos][DBG] mark#2:", JSON.stringify(mark2, null, 2));
  } else {
    console.log("[FB][ui:videos] show-all: nie kliknięto (patrz DBG wyżej).");
  }

  // po show-all spróbuj ustawić "Wszystkie komentarze" / "Najnowsze"
  const filterOk = await ensureAllCommentsFilter(page).catch(() => false);
  console.log("[FB][ui:videos] filter ensure:", filterOk);

  // policz cykle dynamicznie
  let maxCycles = 180;
  if (typeof expectedTotal === "number" && expectedTotal > 0) {
    maxCycles = Math.min(Math.max(90, Math.ceil(expectedTotal / 3)), 420);
  }

  let noProgress = 0;

  for (let i = 1; i <= maxCycles; i++) {
    // jedna akcja na cykl
    const r = await oneSequentialAction(page);

    const didProgress = !!r?.acted && r.action !== "banned-see-more-in-comments-root";
    if (!didProgress) noProgress++;
    else noProgress = 0;

    console.log(
      `[FB][ui:videos] cycle ${i}/${maxCycles} action=${r?.action} acted=${!!r?.acted} noProgress=${noProgress}`
    );

    if (noProgress >= 10) {
      console.log("[FB][ui:videos] Brak postępu – kończę ładowanie.");
      break;
    }

    // delikatne, ale różne opóźnienia (żeby nie spamować)
    if (r?.action === "more-comments") await sleepRandom(900, 1400);
    else if (r?.action === "replies") await sleepRandom(700, 1100);
    else await sleepRandom(450, 850);
  }

  console.log("[FB][ui:videos] Komentarze wideo załadowane.");
}

/**
 * Ekstrahuje komentarze z posta wideo.
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

    const allLinks = Array.from(document.querySelectorAll('a[role="link"]'));
    const idToTime = {};

    for (let i = 0; i < allLinks.length; i++) {
      const id = getCommentId(allLinks[i].href || "");
      if (id) {
        for (let j = i + 1; j < i + 5 && j < allLinks.length; j++) {
          const txt = allLinks[j]?.textContent?.trim()?.toLowerCase();
          if (txt && /^\d+\s*(min|sek|godz|dni|tyg)/.test(txt)) {
            idToTime[id] = txt;
            break;
          }
        }
      }
    }

    const commentBlocks = Array.from(
      document.querySelectorAll("div.xwib8y2.xpdmqnj.x1g0dm76.x1y1aw1k")
    );

    const data = commentBlocks
      .map((node) => {
        try {
          const author = node.querySelector('a[role="link"] span span')?.textContent?.trim() || null;
          const text = node.querySelector('div[dir="auto"]')?.textContent?.trim() || "";
          const linkEl = node.querySelector('a[role="link"]');
          const href = linkEl?.getAttribute("href");
          const permalink = href && !href.startsWith("http") ? `https://www.facebook.com${href}` : href;
          const id = permalink ? getCommentId(permalink) : null;
          const time = id && idToTime[id] ? idToTime[id] : null;

          if (!author && !text) return null;
          return { id, author, text, permalink, time };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    return data;
  });

  console.log(`[FB][ui:videos] Wyekstrahowano komentarzy: ${comments.length}`);
  return comments;
}

export async function debugSnapshot(page) {
  try {
    const path = `snapshot-videos.png`;
    await page.screenshot({ path });
    console.log(`[FB][ui:videos] Zapisano zrzut ekranu: ${path}`);
  } catch (e) {
    console.error("[FB][ui:videos] Błąd zapisu zrzutu ekranu:", e);
  }
}
