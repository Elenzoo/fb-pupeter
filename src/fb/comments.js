// src/fb/comments.js
import { EXPAND_COMMENTS } from "../config.js";
import { sleepRandom } from "../utils/sleep.js";
import { scrollPost } from "./scroll.js";
import { acceptCookies, saveCookies } from "./cookies.js";
import { ensureLoggedInOnPostOverlay, fbLogin, checkIfLogged } from "./login.js";
import { clickOneExpandButton } from "./expandButtons.js";
import { safeGoto } from "../utils/navigation.js";
import { getUiCommentInfo } from "./uicommentinfo.js";

import * as uiPhoto from "./ui/photo.js";
import * as uiPost from "./ui/post.js";
import * as uiVideos from "./ui/videos.js";
import * as uiWatch from "./ui/watch.js";

const NAV_TIMEOUT_MS = process.env.NAV_TIMEOUT_MS
  ? Number(process.env.NAV_TIMEOUT_MS)
  : 90000;

/* ============================================================
   ===================== UI ROUTER ============================
   ============================================================ */

function pickUiHandler(url) {
  // kolejność ma znaczenie: najpierw najbardziej specyficzne
  if (uiWatch?.matchesUrl?.(url)) return uiWatch;
  if (uiVideos?.matchesUrl?.(url)) return uiVideos;
  if (uiPhoto?.matchesUrl?.(url)) return uiPhoto;
  if (uiPost?.matchesUrl?.(url)) return uiPost;
  return null;
}


/* ============================================================
   =======  PRZEŁĄCZANIE FILTRA / SORTOWANIA KOMENTARZY  =======
   ============================================================ */

async function openCommentsMenu(page) {
  const r = await page.evaluate(() => {
    const norm = (s) =>
      String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    function getLabel(el) {
      return el.getAttribute?.("aria-label") || el.textContent || "";
    }

    if (document.querySelector("div[role='menu']"))
      return { ok: true, state: "menu-already-open" };

    const els = Array.from(
      document.querySelectorAll(
        "button,div[role='button'],span[role='button'],a[role='button']"
      )
    );

    // Trigger to taki przycisk, który aktualnie pokazuje stan (Najtrafniejsze/Wszystkie/Najnowsze itd.)
    // Możemy kliknąć go, żeby otworzyć menu – ALE później wybieramy TYLKO "Wszystkie komentarze".
    const btn = els.find((el) => {
      const t = norm(getLabel(el));
      return (
        t === "najtrafniejsze" ||
        t === "most relevant" ||
        t === "wszystkie komentarze" ||
        t === "all comments" ||
        t === "najnowsze" ||
        t === "newest" ||
        t === "pokaż wszystkie" ||
        t === "show all" ||
        t === "wyświetl wszystkie" ||
        t === "view all"
      );
    });

    if (!btn) return { ok: false, reason: "no-trigger" };

    try {
      btn.scrollIntoView?.({ block: "center", inline: "nearest" });
    } catch {}

    try {
      btn.click();
      return { ok: true, state: "clicked-trigger" };
    } catch {
      return { ok: false, reason: "click-failed" };
    }
  });

  return r?.ok === true;
}

async function clickMenuOptionByPrefix(page, prefixes) {
  return page.evaluate(
    (prefixes) => {
      const norm = (s) =>
        String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      const menu =
        document.querySelector("div[role='menu']") ||
        document.querySelector("div[role='dialog']");
      if (!menu) return { ok: false, reason: "no-menu" };

      const items = Array.from(
        menu.querySelectorAll("div[role='menuitem'], div[role='menuitemradio']")
      );

      const opt = items.find((el) => {
        const t = norm(el.textContent);
        return prefixes.some((p) => t.startsWith(p));
      });

      if (!opt) return { ok: false, reason: "no-opt" };

      try {
        opt.scrollIntoView?.({ block: "center", inline: "nearest" });
      } catch {}

      try {
        opt.click();
        return { ok: true };
      } catch {
        return { ok: false, reason: "click-failed" };
      }
    },
    prefixes
  );
}

async function switchCommentsFilterToAllLegacy(page) {
  console.log("[FB][filter] Próba przełączenia filtra komentarzy na: 'Wszystkie komentarze'…");

  if (!(await page.evaluate(() => !!document.querySelector("div[role='menu']")))) {
    const opened = await openCommentsMenu(page);
    if (opened) await sleepRandom(250, 450);
  }

  const picked = await clickMenuOptionByPrefix(page, [
    "wszystkie komentarze",
    "all comments",
    "pokaż wszystkie",
    "show all",
    "wyświetl wszystkie",
    "view all",
  ]);

  if (picked?.ok) {
    await sleepRandom(250, 450);
    await page
      .waitForFunction(() => !document.querySelector("div[role='menu']"), {
        timeout: 2500,
      })
      .catch(() => {});
    console.log("[FB][filter] Filtr komentarzy ustawiony na: 'Wszystkie komentarze' / 'Pokaż wszystkie'.");
    return true;
  }

  console.log("[FB][filter] Nie udało się ustawić 'Wszystkie komentarze' (best-effort).");
  return false;
}

/* ============================================================
   ===================  EXPAND (LEGACY)  =======================
   ============================================================ */

export async function expandAllComments(page) {
  if (!EXPAND_COMMENTS) return 0;

  let clicks = 0;
  for (let i = 0; i < 30; i++) {
    const didClick = await clickOneExpandButton(page);
    if (!didClick) break;
    clicks++;
    await sleepRandom(450, 900);
  }
  return clicks;
}

/* ============================================================
   ===================  LICZNIK KOMENTARZY  ====================
   ============================================================ */

async function getCommentCountLegacy(page) {
  const ui = await getUiCommentInfo(page).catch(() => null);

  const uiCandidates = [
    ui?.comments,
    ui?.count,
    ui?.commentCount,
    ui?.commentsCount,
    ui?.totalComments,
  ].filter((v) => typeof v === "number" && Number.isFinite(v) && v >= 0);

  if (uiCandidates.length) {
    const best = Math.max(...uiCandidates);
    console.log("[FB][count] UI:", {
      best,
      candidates: uiCandidates,
      source: ui?.source || "ui",
      raw: ui?.raw || null,
      viewType: ui?.viewType || null,
    });
    return best;
  }

  const uiLoose = await page
    .evaluate(() => {
      const texts = [];
      const pushText = (t) => {
        if (!t) return;
        const s = String(t).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
        if (s) texts.push(s);
      };

      const els = Array.from(
        document.querySelectorAll("a,button,div[role='button'],span[role='button']")
      );
      for (const el of els) {
        pushText(el.getAttribute?.("aria-label"));
        pushText(el.textContent);
      }

      const nums = [];
      for (const t of texts) {
        const low = t.toLowerCase();
        let m = low.match(/\b(\d{1,6})\s*(komentarz|komentarze|komentarzy)\b/);
        if (m) nums.push(Number(m[1]));
        m = low.match(/\b(\d{1,6})\s*(comment|comments)\b/);
        if (m) nums.push(Number(m[1]));
      }

      if (!nums.length) return { count: null, sample: texts.slice(0, 25) };
      return { count: Math.max(...nums), sample: texts.slice(0, 25) };
    })
    .catch(() => ({ count: null, sample: [] }));

  if (typeof uiLoose?.count === "number" && Number.isFinite(uiLoose.count)) {
    console.log("[FB][count] UI-loose:", uiLoose.count);
    return uiLoose.count;
  }

  if (ui) {
    console.log("[FB][count] UI object (no number):", { keys: Object.keys(ui), ui });
  } else {
    console.log("[FB][count] UI object: null (getUiCommentInfo failed or returned null)");
  }

  const anchors = await page.evaluate(() => {
    const as = Array.from(
      document.querySelectorAll("a[href*='comment_id'], a[href*='reply_comment_id']")
    );
    const ids = new Set();
    for (const a of as) {
      try {
        const u = new URL(a.href);
        const raw = u.searchParams.get("reply_comment_id") || u.searchParams.get("comment_id");
        if (raw) ids.add(raw);
      } catch {}
    }
    return ids.size;
  });

  if (anchors > 0) console.log("[FB][count] anchors-fallback:", anchors);
  return anchors > 0 ? anchors : null;
}

/* ============================================================
   ===================  EKSTRAKCJA KOMENTARZY  =================
   ============================================================ */

async function extractCommentsFromDOM(page) {
  const data = await page.evaluate(() => {
    function extractCommentIdRaw(url) {
      const m = url?.match(/(?:comment_id|reply_comment_id)=([^&]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    }

    function safeAtob(input) {
      try {
        let s = String(input || "");
        s = s.replace(/-/g, "+").replace(/_/g, "/");
        while (s.length % 4) s += "=";
        return atob(s);
      } catch {
        return null;
      }
    }

    function idNumFromRaw(idRaw) {
      if (!idRaw) return null;
      const s = String(idRaw).trim();
      if (/^\d+$/.test(s)) return s;

      const dec = safeAtob(s);
      if (dec) {
        const m = String(dec).match(/(\d{6,})\s*$/);
        if (m) return m[1];
      }
      const m2 = s.match(/_(\d+)\b/);
      return m2 ? m2[1] : null;
    }

    function normalizeTime(text) {
      if (!text) return null;

      const t = String(text)
        .toLowerCase()
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (t === "właśnie teraz" || t === "teraz" || t === "now" || t === "just now") return "0 min";
      if (/^\d+\s*(min|min\.|m|minut|minuty|minutę|min temu)\b/.test(t)) return t;
      if (/^\d+\s*(godz|godz\.|h|hr|hour|hours)\b/.test(t)) return t;
      if (/^\d+\s*(sek|sek\.|s|sec|secs|second|seconds)\b/.test(t)) return t;
      if (/^\d+\s*(dzień|dni|d|tyg|tyg\.|week|weeks)\b/.test(t)) return t;
      if (t.includes("wczoraj") || t.includes("yesterday")) return t;

      return null;
    }

    function findTimeAround(linkEl, fallbackNode) {
      const root =
        linkEl?.closest?.("div[role='article']") ||
        linkEl?.closest?.("div[aria-label]") ||
        linkEl?.closest?.("div") ||
        fallbackNode;

      if (!root) return null;

      const els = root.querySelectorAll("a, abbr, span");
      for (const el of els) {
        const aria = el.getAttribute?.("aria-label");
        const t1 = normalizeTime(aria);
        if (t1) return t1;

        const txt = el.textContent?.trim();
        const t2 = normalizeTime(txt);
        if (t2) return t2;
      }
      return null;
    }

    const nodes = Array.from(
      document.querySelectorAll("div.xwib8y2.xpdmqnj.x1g0dm76.x1y1aw1k")
    );

    const extracted = nodes
      .map((node, idx) => {
        const author =
          node.querySelector('a[role="link"] span span')?.textContent?.trim() || null;
        const text = node.querySelector('div[dir="auto"]')?.textContent?.trim() || null;

        const linkEl =
          node.querySelector("a[href*='reply_comment_id']") ||
          node.querySelector("a[href*='comment_id']") ||
          node.querySelector('a[role="link"]');

        const href = linkEl?.getAttribute("href") || null;
        const permalink = href ? (href.startsWith("http") ? href : `https://www.facebook.com${href}`) : null;

        const id_raw = permalink ? extractCommentIdRaw(permalink) : null;

        const id = id_raw ? String(id_raw).trim() : null;
        const id_num = id_raw ? idNumFromRaw(id_raw) : null;

        const time = findTimeAround(linkEl, node);

        if (!author || !text) return null;

        return { id, id_raw, id_num, author, text, time, permalink, pos: idx + 1 };
      })
      .filter(Boolean);

    return extracted;
  });

  return Array.isArray(data) ? data : [];
}

/* ============================================================
   ===================  PREPARE / LOAD (LEGACY)  ===============
   ============================================================ */

async function prepareLegacy(page, url) {
  const ok = await safeGoto(page, url, "comments", {
    waitUntil: "networkidle2",
    timeout: NAV_TIMEOUT_MS,
  });

  if (!ok) throw new Error("safeGoto-failed");

  const currentUrl = page.url();
  if (currentUrl.includes("/login")) {
    console.log("[FB] /login redirect → fbLogin() and back");
    await fbLogin(page);
    await sleepRandom(3000, 4500);

    const loggedAfterLogin = await checkIfLogged(page).catch(() => false);
    console.log("[FB] session after fbLogin:", loggedAfterLogin ? "OK" : "NO");

    if (loggedAfterLogin) {
      await safeGoto(page, url, "comments", {
        waitUntil: "networkidle2",
        timeout: NAV_TIMEOUT_MS,
      });
    }
  }

  await acceptCookies(page, "post-initial");
  await ensureLoggedInOnPostOverlay(page).catch(() => {});
  await sleepRandom(900, 1400);
  await acceptCookies(page, "post");

  try {
    const logged = await checkIfLogged(page).catch(() => false);
    if (logged) await saveCookies(page);
  } catch {}

  await scrollPost(page, 140).catch(() => {});
  await sleepRandom(500, 800);

  // ✅ TYLKO "Wszystkie komentarze / Pokaż wszystkie"
  // ❌ NIE DOTYKAMY sortowania ("Najnowsze") w ogóle
  await switchCommentsFilterToAllLegacy(page).catch(() => false);
  await sleepRandom(250, 450);
}

async function loadAllCommentsLegacy(page, opts = {}) {
  if (!EXPAND_COMMENTS) return;

  const expected = Number.isFinite(opts.expectedTotal) ? Number(opts.expectedTotal) : null;

  const MAX_ROUNDS = opts.maxRounds ?? 35;
  const STABLE_ROUNDS = opts.stableRounds ?? 4;
  const MAX_NO_PROGRESS = opts.maxNoProgress ?? 10;
  const CLICKS_PER_ROUND = opts.clicksPerRound ?? 10;

  console.log("[FB][load] start", { expected });

  function uniqAnchorCountEval() {
    return page.evaluate(() => {
      const as = Array.from(
        document.querySelectorAll("a[href*='comment_id'], a[href*='reply_comment_id']")
      );
      const ids = new Set();
      for (const a of as) {
        const href = a.getAttribute("href") || "";
        const m = href.match(/(?:comment_id|reply_comment_id)=([^&]+)/);
        if (m && m[1]) ids.add(m[1]);
      }
      return ids.size;
    });
  }

  function commentNodesCountEval() {
    return page.evaluate(() => {
      const nodes = document.querySelectorAll("div.xwib8y2.xpdmqnj.x1g0dm76.x1y1aw1k");
      return nodes ? nodes.length : 0;
    });
  }

  function hasMoreButtonsEval() {
    return page.evaluate(() => {
      const norm = (s) =>
        String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      const btns = Array.from(
        document.querySelectorAll("div[role='button'], button, span[role='button']")
      );
      return btns.some((b) => {
        const t = norm(b.getAttribute("aria-label") || b.textContent);
        return (
          t.includes("wyświetl więcej komentarzy") ||
          t.includes("zobacz więcej komentarzy") ||
          t.includes("zobacz wcześniejsze komentarze") ||
          t.includes("more comments") ||
          t.includes("view more comments") ||
          t.includes("view previous comments") ||
          t.includes("zobacz więcej odpowiedzi") ||
          t.includes("wyświetl więcej odpowiedzi") ||
          t.includes("more replies") ||
          t.includes("view more replies")
        );
      });
    });
  }

  let anchors = await uniqAnchorCountEval().catch(() => 0);
  let nodes = await commentNodesCountEval().catch(() => 0);

  let stable = 0;
  let noProgress = 0;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    let clicks = 0;
    for (let i = 0; i < CLICKS_PER_ROUND; i++) {
      const did = await clickOneExpandButton(page).catch(() => false);
      if (!did) break;
      clicks++;
      await sleepRandom(250, 450);
    }

    await scrollPost(page, 220).catch(() => {});
    await sleepRandom(400, 700);

    const nextAnchors = await uniqAnchorCountEval().catch(() => anchors);
    const nextNodes = await commentNodesCountEval().catch(() => nodes);
    const moreBtns = await hasMoreButtonsEval().catch(() => false);

    const progressed = nextAnchors > anchors || nextNodes > nodes || clicks > 0;

    if (progressed) {
      anchors = nextAnchors;
      nodes = nextNodes;
      stable = 0;
      noProgress = 0;
    } else {
      stable++;
      noProgress++;
    }

    console.log(
      `[FB][load] round ${round}: anchors ${anchors} -> ${nextAnchors}, nodes ${nodes} -> ${nextNodes}, clicks=${clicks}, stable=${stable}/${STABLE_ROUNDS}, moreBtns=${moreBtns}, noProgress=${noProgress}/${MAX_NO_PROGRESS}`
    );

    const stableEnough = stable >= STABLE_ROUNDS;

    if (!moreBtns && stableEnough) {
      console.log("[FB][load] stop: no more buttons + stable");
      break;
    }

    const reachedExpected =
      expected != null && Number.isFinite(expected) && expected >= 0 && nextNodes >= expected;
    if (reachedExpected && stableEnough && !moreBtns) {
      console.log("[FB][load] stop: expected reached (by nodes) + stable + no more buttons");
      break;
    }

    if (stableEnough && moreBtns) {
      console.log("[FB][load] rescue: stable but still buttons -> deep scroll + wait");
      await scrollPost(page, 520).catch(() => {});
      await sleepRandom(1000, 1600);
      stable = 0;
      continue;
    }

    if (noProgress >= MAX_NO_PROGRESS) {
      if (moreBtns) {
        console.log("[FB][load] last-rescue: no-progress but still buttons -> deep scroll + wait");
        await scrollPost(page, 650).catch(() => {});
        await sleepRandom(1400, 1900);
        stable = 0;
        noProgress = 0;
        continue;
      }

      console.log("[FB][load] stop: too many no-progress rounds");
      break;
    }

    anchors = nextAnchors;
    nodes = nextNodes;
  }

  const finalAnchors = await uniqAnchorCountEval().catch(() => anchors);
  const finalNodes = await commentNodesCountEval().catch(() => nodes);
  console.log("[FB][load] done:", { anchors: finalAnchors, nodes: finalNodes });
}

/* ============================================================
   ===================  PUBLIC API (ROUTED)  ===================
   ============================================================ */

export async function prepare(page, url) {
  const ui = pickUiHandler(url);
  if (ui?.prepare) {
    console.log(`[FB][router] UI -> ${ui.type || "unknown"} prepare`);
    return ui.prepare(page, url);
  }
  console.log("[FB][router] UI -> legacy prepare");
  return prepareLegacy(page, url);
}

export async function getCommentCount(page, url) {
  const ui = pickUiHandler(url || page.url());
  if (ui?.getCommentCount) {
    console.log(`[FB][router] UI -> ${ui.type || "unknown"} getCommentCount`);
    return ui.getCommentCount(page, url);
  }
  console.log("[FB][router] UI -> legacy getCommentCount");
  return getCommentCountLegacy(page);
}

export async function loadAllComments(page, opts = {}, url = null) {
  if (!EXPAND_COMMENTS) return;

  const finalUrl = url || page.url();
  const ui = pickUiHandler(finalUrl);

  if (ui?.loadAllComments) {
    console.log(`[FB][router] UI -> ${ui.type || "unknown"} loadAllComments`);
    return ui.loadAllComments(page, { expectedTotal: opts.expectedTotal });
  }

  console.log("[FB][router] UI -> legacy loadAllComments");
  return loadAllCommentsLegacy(page, opts);
}

export async function extractCommentsData(page, url = null) {
  const finalUrl = url || page.url();
  const ui = pickUiHandler(finalUrl);

  if (ui?.extractComments) {
    console.log(`[FB][router] UI -> ${ui.type || "unknown"} extractComments`);
    const out = await ui.extractComments(page, finalUrl);
    return Array.isArray(out) ? out : [];
  }

  const out = await extractCommentsFromDOM(page);
  return Array.isArray(out) ? out : [];
}
