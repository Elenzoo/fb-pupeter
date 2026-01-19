import { safeGoto } from "../../utils/navigation.js";
import { sleepRandom } from "../../utils/sleep.js";
import log from "../../utils/logger.js";
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
  log.dev("UI:videos", `Prepare: ${url.slice(0, 50)}...`);
  const ok = await safeGoto(page, url, "videos", { waitUntil: "networkidle2", timeout: 90000 });
  if (!ok) throw new Error("safeGoto-failed");

  const currentUrl = page.url();
  if (currentUrl.includes("/login")) {
    log.dev("UI:videos", "Login required");
    await fbLogin(page);
    await sleepRandom(3000, 4500);

    const loggedAfterLogin = await checkIfLogged(page).catch(() => false);
    log.dev("UI:videos", `Sesja po logowaniu: ${loggedAfterLogin ? "OK" : "BRAK"}`);

    if (loggedAfterLogin) {
      await safeGoto(page, url, "videos", { waitUntil: "networkidle2", timeout: 90000 });
    } else {
      log.warn("UI:videos", "Login failed");
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
    log.debug("UI:videos", "Video paused");
  } catch (e) {
    log.debug("UI:videos", `Video pause error: ${e?.message || e}`);
  }
}

export async function getCommentCount(page, url) {
  const uiInfo = await getUiCommentInfo(page);
  log.debug("UI:videos", "UI info", {
    source: uiInfo?.source,
    raw: uiInfo?.raw,
    viewType: uiInfo?.viewType,
    comments: uiInfo?.comments,
  });

  let totalComments = null;
  if (uiInfo && typeof uiInfo.comments === "number" && uiInfo.comments > 0) totalComments = uiInfo.comments;

  log.dev("UI:videos", `Liczba komentarzy: ${totalComments ?? "brak danych"}`);
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

  log.debug("UI:videos", "Candidates", out);
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

  log.debug("UI:videos", "Show-all click", res);
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

  log.debug("UI:videos", "Filter step#1", res);

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

  log.debug("UI:videos", "Filter step#2", res2);

  await sleepRandom(500, 900);

  return !!res2?.ok;
}

/* ==========================================
   ======= FAST_MODE: SORTOWANIE "NAJNOWSZE" ==
   ========================================== */

export async function switchCommentsFilterToNewestScoped(page) {
  log.dev("UI:videos", "Przełączam na 'Najnowsze'...");

  // ZAWSZE najpierw spróbuj kliknąć "Pokaż wszystkie" żeby otworzyć pełny panel komentarzy
  log.debug("UI:videos", "Otwieranie panelu komentarzy...");

  const clickedShowAll = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

    function isVisible(el) {
      if (!el) return false;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return !!r && r.width > 5 && r.height > 5;
    }

    // Szukaj przycisku "Pokaż wszystkie" / "Show all"
    const btns = Array.from(
      document.querySelectorAll("div[role='button'][aria-label], button[aria-label], a[aria-label]")
    ).filter(isVisible);

    for (const btn of btns) {
      const al = norm(btn.getAttribute("aria-label"));
      if (al === "pokaż wszystkie" || al === "wyświetl wszystkie" || al === "show all" || al === "view all") {
        try {
          btn.scrollIntoView({ block: "center", inline: "nearest" });
        } catch {}
        try {
          btn.click();
          return { clicked: true, label: al };
        } catch {}
      }
    }
    return { clicked: false };
  });

  if (clickedShowAll?.clicked) {
    log.debug("UI:videos", `Kliknięto '${clickedShowAll.label}'`);
    await sleepRandom(1500, 2200);
  } else {
    log.debug("UI:videos", "Nie znaleziono 'Pokaż wszystkie' - może już rozwinięte");
  }

  // Oznacz scope komentarzy
  const mark = await markCommentsScope(page).catch(() => null);
  log.debug("UI:videos", `markCommentsScope: ${mark?.ok ? "OK" : mark?.reason}`);

  if (!mark?.ok) {
    log.debug("UI:videos", "Nie znaleziono sekcji komentarzy");
    return { ok: false, reason: "no-comments-scope" };
  }

  await sleepRandom(200, 400);

  // Sprawdź czy już "Najnowsze"
  const alreadyNewest = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const root = document.querySelector("[data-fbw-comments-root='1']") || document.body;
    const rootTxt = norm(root.innerText || "");

    // Szukamy przycisku z labelem "Najnowsze" jako aktywny filtr
    const btns = Array.from(root.querySelectorAll("div[role='button'],span[role='button'],button"));
    return btns.some((b) => {
      const t = norm(b.textContent);
      return t === "najnowsze" || t === "newest";
    });
  });

  if (alreadyNewest) {
    log.debug("UI:videos", "Filtr już 'Najnowsze' – pomijam");
    return { ok: true, state: "already-newest" };
  }

  // Otwórz menu sortowania
  const openRes = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

    function isVisible(el) {
      if (!el) return false;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return !!r && r.width > 5 && r.height > 5;
    }

    const root = document.querySelector("[data-fbw-comments-root='1']") || document.body;
    const btns = Array.from(root.querySelectorAll("div[role='button'],span[role='button'],button")).filter(isVisible);

    // Szukaj przycisku sortowania (Najtrafniejsze/Most relevant/Top comments/Wszystkie komentarze)
    const sortBtn = btns.find((b) => {
      const t = norm(b.textContent);
      return (
        t === "najtrafniejsze" ||
        t === "most relevant" ||
        t === "top comments" ||
        t === "najlepsze" ||
        t === "wszystkie komentarze" ||
        t === "all comments"
      );
    });

    if (!sortBtn) {
      return { ok: false, reason: "no-sortbtn" };
    }

    try {
      sortBtn.scrollIntoView({ block: "center", inline: "nearest" });
    } catch {}
    try {
      sortBtn.click();
    } catch {}

    return { ok: true, action: "opened-menu" };
  });

  if (!openRes?.ok) {
    log.debug("UI:videos", "Nie znaleziono przycisku sortowania");
    return { ok: false, reason: openRes?.reason || "no-sortbtn" };
  }

  await sleepRandom(400, 700);

  // Wybierz "Najnowsze" z menu
  const selectRes = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

    function isVisible(el) {
      if (!el) return false;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return !!r && r.width > 5 && r.height > 5;
    }

    const menu = document.querySelector("div[role='menu']") || document.querySelector("div[role='dialog']");
    if (!menu) return { ok: false, reason: "no-menu" };

    const items = Array.from(menu.querySelectorAll("div[role='menuitem'], div[role='menuitemradio'], div[role='button']"))
      .filter(isVisible);

    // Szukaj "Najnowsze" / "Newest"
    const target = items.find((el) => {
      const t = norm(el.textContent);
      return t.startsWith("najnowsze") || t.startsWith("newest") || t.startsWith("od najnowszych") || t.startsWith("most recent");
    });

    if (!target) {
      return { ok: false, reason: "no-newest-option" };
    }

    try {
      target.scrollIntoView({ block: "center", inline: "nearest" });
    } catch {}
    try {
      target.click();
    } catch {}

    // Zamknij menu
    try {
      setTimeout(() => document.body.click(), 40);
    } catch {}

    return { ok: true, action: "clicked-newest" };
  });

  if (selectRes?.ok) {
    log.dev("UI:videos", "Filtr ustawiony: 'Najnowsze'");
    await sleepRandom(400, 700);
    return { ok: true };
  }

  log.debug("UI:videos", `Nie udało się wybrać 'Najnowsze': ${selectRes?.reason}`);
  return { ok: false, reason: selectRes?.reason || "select-failed" };
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
  log.debug("UI:videos", "step", res);
  return res || { acted: false, action: "none", dbg: null };
}



/**
 * Wczytuje wszystkie komentarze dla posta wideo.
 */
export async function loadAllComments(page, { expectedTotal } = {}) {
  log.dev("UI:videos", "Ładuję komentarze...");

  await debugDumpShowAllCandidates(page).catch(() => {});

  const mark1 = await markCommentsScope(page).catch(() => null);
  log.debug("UI:videos", "mark#1", mark1);

  await sleepRandom(250, 500);

  // klik show-all z header-row
  const clickedAll = await clickShowAllFromMarkedRow(page).catch(() => false);
  if (clickedAll) {
    await sleepRandom(900, 1400);
    const mark2 = await markCommentsScope(page).catch(() => null);
    log.debug("UI:videos", "mark#2", mark2);
  } else {
    log.debug("UI:videos", "show-all: nie kliknięto");
  }

  // po show-all spróbuj ustawić "Wszystkie komentarze" / "Najnowsze"
  const filterOk = await ensureAllCommentsFilter(page).catch(() => false);
  log.debug("UI:videos", `filter ensure: ${filterOk}`);

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

    if (i === 1 || i % 20 === 0) {
      log.debug("UI:videos", `Cycle ${i}/${maxCycles}`, { action: r?.action, acted: !!r?.acted, noProgress });
    }

    if (noProgress >= 10) {
      log.debug("UI:videos", "Brak postępu – kończę ładowanie");
      break;
    }

    // delikatne, ale różne opóźnienia (żeby nie spamować)
    if (r?.action === "more-comments") await sleepRandom(900, 1400);
    else if (r?.action === "replies") await sleepRandom(700, 1100);
    else await sleepRandom(450, 850);
  }

  log.dev("UI:videos", "Komentarze załadowane");
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

  log.debug("UI:videos", `Wyekstrahowano ${comments.length} komentarzy`);
  return comments;
}

export async function debugSnapshot(page) {
  try {
    const path = `snapshot-videos.png`;
    await page.screenshot({ path });
    log.debug("UI:videos", `Zapisano zrzut: ${path}`);
  } catch (e) {
    log.error("UI:videos", `Błąd zapisu zrzutu: ${e?.message || e}`);
  }
}
