// src/fb/ui/post.js
import { EXPAND_COMMENTS } from "../../config.js";
import { sleepRandom } from "../../utils/sleep.js";
import { safeGoto } from "../../utils/navigation.js";

import { scrollPost } from "../scroll.js";
import { acceptCookies, saveCookies } from "../cookies.js";
import { ensureLoggedInOnPostOverlay, fbLogin, checkIfLogged } from "../login.js";
import { clickOneExpandButton } from "../expandButtons.js";

const NAV_TIMEOUT_MS = process.env.NAV_TIMEOUT_MS ? Number(process.env.NAV_TIMEOUT_MS) : 90000;

export const type = "post";

export function matchesUrl(url) {
  if (!url) return false;
  const u = String(url);
  if (u.includes("/watch")) return false;
  if (u.includes("/videos/")) return false;
  if (u.includes("/photo")) return false;
  if (u.includes("photo.php")) return false;

  return (
    u.includes("/posts/") ||
    u.includes("permalink.php") ||
    u.includes("/story.php") ||
    /facebook\.com\/[^/]+\/posts\//i.test(u)
  );
}

/* ============================================================
   =============== POST ROOT (DIALOG / MAIN) ===================
   ============================================================ */

function postRootScript() {
  return `
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
          text.includes("write a comment") ||
          text.includes("comment");

        const looksLikeNotifications =
          text.startsWith("powiadomienia") &&
          text.includes("wszystkie") &&
          text.includes("nieprzeczytane");

        return !looksLikeNotifications && hasCommentWord && hasActions;
      });

      if (postDialog) {
        const art = postDialog.querySelector("article");
        return art || postDialog;
      }

      const main = document.querySelector("div[role='main'], main");
      if (main) {
        const article = main.querySelector("article");
        return article || main;
      }

      return document.body;
    }
  `;
}

async function getPostScopeSelector(page) {
  const scope = await page.evaluate((code) => {
    // eslint-disable-next-line no-eval
    eval(code);
    // @ts-ignore
    const root = typeof getPostRoot === "function" ? getPostRoot() : null;
    if (!root) return "document";

    const dlg = root.closest("div[role='dialog']");
    if (dlg) return "div[role='dialog']";

    const main = document.querySelector("div[role='main'], main");
    if (main) return "div[role='main']";

    return "document";
  }, postRootScript());

  return scope || "document";
}

/* ============================================================
   =========== PRZEŁĄCZANIE FILTRA: ALL COMMENTS ===============
   ============================================================ */

async function clickAllCommentsInMenu(page) {
  const result = await page.evaluate(() => {
    const norm = (s) =>
      String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    const menu = document.querySelector("div[role='menu']");
    if (!menu) return { clicked: false, noMenu: true };

    const items = Array.from(menu.querySelectorAll("div[role='menuitem'], div[role='menuitemradio']"));

    const opt = items.find((el) => {
      const t = norm(el.textContent);
      return (
        t.startsWith("wszystkie komentarze") ||
        t.startsWith("all comments") ||
        t.startsWith("pokaż wszystkie") ||
        t.startsWith("pokaz wszystkie") ||
        t.startsWith("show all")
      );
    });

    if (!opt) return { clicked: false, noMenu: false };

    try {
      opt.scrollIntoView?.({ block: "center", inline: "nearest" });
    } catch {}

    try {
      opt.click();
      return { clicked: true, noMenu: false };
    } catch {
      return { clicked: false, noMenu: false };
    }
  });

  if (result.clicked) {
    await sleepRandom(250, 450);
    await page
      .waitForFunction(() => !document.querySelector("div[role='menu']"), { timeout: 2500 })
      .catch(() => {});
  }

  return result;
}

async function switchCommentsFilterToAllScoped(page, scopeSel = "document") {
  console.log("[FB][ui:post][filter] Próba przełączenia filtra komentarzy…");
  console.log("[FB][ui:post][filter] scope=", scopeSel);

  // 0) Jeśli menu już otwarte -> wybierz "Wszystkie komentarze" / "Pokaż wszystkie"
  const menuAlreadyOpen = await page.evaluate(() => !!document.querySelector("div[role='menu']"));
  if (menuAlreadyOpen) {
    console.log("[FB][ui:post][filter] Menu już otwarte – wybieram opcję.");
    const r = await clickAllCommentsInMenu(page);
    if (r?.clicked)
      console.log("[FB][ui:post][filter] Filtr komentarzy ustawiony na: 'Wszystkie komentarze' / 'Pokaż wszystkie'.");
    return !!r?.clicked;
  }

  // 1) Kliknij przycisk filtra (Najtrafniejsze/Most relevant) – BEZ wymogu, że jest w viewport
  const pre = await page.evaluate(
    (scopeSel, code) => {
      const norm = (s) =>
        String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      // eslint-disable-next-line no-eval
      eval(code);
      // @ts-ignore
      const root = typeof getPostRoot === "function" ? getPostRoot() : null;

      function getLabel(el) {
        if (!el) return "";
        const aria = el.getAttribute?.("aria-label");
        if (aria) return aria;
        return el.textContent || "";
      }

      function isVisibleEnough(el) {
        try {
          if (!el) return false;
          const st = window.getComputedStyle(el);
          if (!st) return true;
          if (st.display === "none" || st.visibility === "hidden") return false;
          const r = el.getBoundingClientRect();
          if (!r || r.width < 8 || r.height < 8) return false;
          return true;
        } catch {
          return true;
        }
      }

      function findClickableAncestor(start) {
        let el = start;
        for (let i = 0; i < 10 && el; i++) {
          const role = el.getAttribute?.("role");
          const tag = (el.tagName || "").toLowerCase();
          if (
            tag === "button" ||
            role === "button" ||
            role === "menuitem" ||
            role === "menuitemradio" ||
            role === "link"
          ) {
            return el;
          }
          el = el.parentElement;
        }
        return null;
      }

      // 1A) jeśli już jest "All comments" / "Pokaż wszystkie"
      const btnsAll = Array.from(
        document.querySelectorAll("button,div[role='button'],span[role='button'],a[role='button']")
      );
      for (const el of btnsAll) {
        const t = norm(getLabel(el));
        if (
          t === "wszystkie komentarze" ||
          t === "all comments" ||
          t === "pokaż wszystkie" ||
          t === "pokaz wszystkie" ||
          t === "show all"
        ) {
          return { ok: true, state: "already-all", where: "document" };
        }
      }

      const scopeEl = scopeSel === "document" ? document : document.querySelector(scopeSel);
      const scopes = [scopeEl, root, document].filter(Boolean);

      // 1B) główna ścieżka: szukamy "Najtrafniejsze/Most relevant" w klikalnych elementach,
      //     ale NIE wymagamy, żeby był w viewport – scrollIntoView go dociągnie.
      for (const sc of scopes) {
        const clickables = Array.from(
          sc.querySelectorAll("button,div[role='button'],span[role='button'],a[role='button']")
        );

        const candidates = [];
        for (const el of clickables) {
          const t = norm(getLabel(el));
          if (!(t.startsWith("najtrafniejsze") || t.startsWith("most relevant"))) continue;
          if (!isVisibleEnough(el)) continue;

          let dist = 999999;
          try {
            const r = el.getBoundingClientRect();
            // preferuj elementy bliżej środka ekranu (mniejszy “doskok”)
            dist = Math.abs(r.top - window.innerHeight / 2);
          } catch {}

          candidates.push({ el, dist });
        }

        if (candidates.length) {
          candidates.sort((a, b) => a.dist - b.dist);
          const picked = candidates[0].el;

          try {
            picked.scrollIntoView?.({ block: "center", inline: "nearest" });
          } catch {}

          try {
            picked.click();
            return { ok: true, state: "clicked-filter", where: sc === document ? "document" : "scope" };
          } catch {
            // nic
          }
        }
      }

      // 1C) fallback: znajdź sam TEKST "Najtrafniejsze/Most relevant" gdziekolwiek (span/div),
      //     potem kliknij najbliższego klikalnego parenta.
      for (const sc of scopes) {
        const nodes = Array.from(sc.querySelectorAll("span,div,a,button"))
          .filter(isVisibleEnough)
          .slice(0, 20000);

        for (const n of nodes) {
          const t = norm(n.textContent);
          if (!(t === "najtrafniejsze" || t === "most relevant" || t.startsWith("najtrafniejsze"))) continue;

          const clickable = findClickableAncestor(n) || (n.tagName?.toLowerCase() === "button" ? n : null);
          if (!clickable) continue;

          try {
            clickable.scrollIntoView?.({ block: "center", inline: "nearest" });
          } catch {}

          try {
            clickable.click();
            return { ok: true, state: "clicked-filter-fallback", where: sc === document ? "document" : "scope" };
          } catch {
            // nic
          }
        }
      }

      return { ok: false, state: "not-found" };
    },
    scopeSel,
    postRootScript()
  );

  if (!pre?.ok) {
    console.log("[FB][ui:post][filter] Nie znaleziono przycisku filtra komentarzy.");
    return false;
  }

  if (pre.state === "already-all") {
    console.log("[FB][ui:post][filter] Filtr już ustawiony na 'Wszystkie komentarze' / 'Pokaż wszystkie' – pomijam.");
    return true;
  }

  console.log("[FB][ui:post][filter] Kliknięto filtr:", pre);

  // WAŻNE: po kliknięciu filtra daj chwilę na render menu
  await sleepRandom(350, 650);

  // 2) Menu -> "Wszystkie komentarze" / "Pokaż wszystkie"
  const menuResult = await clickAllCommentsInMenu(page);

  if (menuResult?.clicked) {
    console.log("[FB][ui:post][filter] Filtr komentarzy ustawiony na: 'Wszystkie komentarze' / 'Pokaż wszystkie'.");
    return true;
  }

  // 3) Fallback: czasem FB przełącza bez menu — sprawdź label
  const afterLabelIsAll = await page.evaluate(() => {
    const norm = (s) =>
      String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    const els = Array.from(
      document.querySelectorAll("button,div[role='button'],span[role='button'],a[role='button']")
    );

    function getLabel(el) {
      const aria = el.getAttribute?.("aria-label");
      if (aria) return aria;
      return el.textContent || "";
    }

    return els.some((el) => {
      const t = norm(getLabel(el));
      return (
        t === "wszystkie komentarze" ||
        t === "all comments" ||
        t === "pokaż wszystkie" ||
        t === "pokaz wszystkie" ||
        t === "show all"
      );
    });
  });

  if (afterLabelIsAll) {
    console.log("[FB][ui:post][filter] Przełączyło się bez menu na 'Wszystkie komentarze' / 'Pokaż wszystkie'.");
    return true;
  }

  console.log(
    "[FB][ui:post][filter] Nie udało się ustawić filtra na 'Wszystkie komentarze' / 'Pokaż wszystkie'. menuResult=",
    menuResult
  );
  return false;
}


/* ============================================================
   =================== LICZENIE Z UI (POST) ====================
   ============================================================ */

/**
 * Kluczowa poprawka:
 * - NIE licz po samym scopeSel (bo dialog może zawierać inny overlay / powiadomienia).
 * - Licz wewnątrz getPostRoot() (czyli “prawdziwy post”).
 */
async function getCommentCountFromUiPostRoot(page) {
  const res = await page.evaluate((code) => {
    // eslint-disable-next-line no-eval
    eval(code);

    const norm = (s) =>
      String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const lower = (s) => norm(s).toLowerCase();

    function parsePlEnCount(text) {
      const t = lower(text);
      if (!t) return null;

      if (!(t.includes("komentarz") || t.includes("comment"))) return null;

      let x = t
        .replace(/komentarz(?:e|y|ów)?/g, "")
        .replace(/comments?/g, "")
        .replace(/[():]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      let mult = 1;
      if (/\btys\b|\btyś\b|\btysi[ąa]c\b/.test(x)) {
        mult = 1000;
        x = x.replace(/\btys\b|\btyś\b|\btysi[ąa]c\b/g, "").trim();
      }
      if (/\bmln\b|\bmillion\b/.test(x)) {
        mult = 1000000;
        x = x.replace(/\bmln\b|\bmillion\b/g, "").trim();
      }

      x = x.replace(/\s+/g, "");
      if (x.includes(",") && !x.includes(".")) x = x.replace(/,/g, ".");
      x = x.replace(/[^0-9.]/g, "");
      if (!x) return null;

      const n = Number(x);
      if (!Number.isFinite(n)) return null;

      return Math.round(n * mult);
    }

    // @ts-ignore
    const root = typeof getPostRoot === "function" ? getPostRoot() : null;
    const scope = root || document;

    // anty-śmieci: wytnij kawałki typowe dla powiadomień / headera
    const badBlock = (txt) => {
      const t = lower(txt);
      if (!t) return false;
      if (t.includes("powiadomienia") && (t.includes("nieprzeczytane") || t.includes("wszystkie"))) return true;
      if (t === "wszystkie" || t === "nieprzeczytane") return true;
      return false;
    };

    // 1) Najpewniejsze: span z tekstem "72 komentarze"
    const spans = Array.from(scope.querySelectorAll("span"));
    let best = null;

    for (const el of spans) {
      const raw = norm(el.textContent);
      if (!raw) continue;
      if (badBlock(raw)) continue;

      const val = parsePlEnCount(raw);
      if (val == null) continue;

      let score = 0;
      score += Math.max(0, 40 - raw.length);

      try {
        const r = el.getBoundingClientRect();
        if (r.width > 10 && r.height > 10) score += 10;
        if (r.top >= -50 && r.top <= window.innerHeight + 50) score += 10;
      } catch {}

      if (!best || score > best.score) best = { raw, val, score };
    }

    if (best) return { ok: true, source: "post-root-span", raw: best.raw, comments: best.val };

    // 2) Fallback: czasem licznik siedzi w klikalnym elemencie
    const nodes = Array.from(
      scope.querySelectorAll("div[role='button'], span[role='button'], button, a[role='link'], a")
    );

    for (const el of nodes) {
      const raw = norm(el.textContent);
      if (!raw) continue;
      if (badBlock(raw)) continue;

      const val = parsePlEnCount(raw);
      if (val != null) return { ok: true, source: "post-root-clickable", raw, comments: val };
    }

    // 3) Ostatecznie: regex po tekście root
    const blob = norm(scope.innerText || "");
    const m = blob.match(/(\d[\d\s.,]*)\s*(komentarz(?:e|y|ów)?|comments?)/i);
    if (m) {
      const raw = norm(`${m[1]} ${m[2]}`);
      const val = parsePlEnCount(raw);
      if (val != null) return { ok: true, source: "post-root-regex", raw, comments: val };
    }

    return { ok: false, reason: "not-found" };
  }, postRootScript());

  return res?.ok ? res : null;
}

/* ============================================================
   =================== LICZENIE ANCHORÓW =======================
   ============================================================ */

async function getCurrentCommentAnchorCount(page) {
  const count = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll("a[href*='comment_id'], a[href*='reply_comment_id']"));
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

    return ids.size;
  });

  return count || 0;
}

/* ============================================================
   =================== SCROLL TYLKO W POŚCIE ===================
   ============================================================ */

async function scrollWithinPost(page, label, factor = 0.25) {
  const info = await page.evaluate(
    (factorArg, labelArg, code) => {
      // eslint-disable-next-line no-eval
      eval(code);
      // @ts-ignore
      const root = typeof getPostRoot === "function" ? getPostRoot() : document.body;

      const norm = (s) =>
        String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      function canScrollByTest(el) {
        try {
          if (!el) return false;
          const ch = el.clientHeight || 0;
          const sh = el.scrollHeight || 0;
          if (ch <= 0) return false;
          if (sh <= ch + 30) return false;

          const before = el.scrollTop ?? 0;
          el.scrollTop = before + 80;
          const after = el.scrollTop ?? before;
          el.scrollTop = before;
          return after !== before;
        } catch {
          return false;
        }
      }

      function isVisible(el) {
        if (!el) return false;
        const st = window.getComputedStyle(el);
        if (!st) return true;
        if (st.display === "none" || st.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        if (!r || r.width < 5 || r.height < 5) return false;
        return true;
      }

      function pickContainerSmart() {
        // 0) cache z poprzednich rund (tylko jeśli nadal działa)
        const cached = window.__FBW_POST_COMMENTS_CONTAINER;
        if (cached && document.contains(cached) && canScrollByTest(cached)) return { el: cached, label: "cached" };

        const scope = root?.closest?.("div[role='dialog']") || root || document.body;
        const scopes = [scope, root, document.querySelector("div[role='main'], main"), document.body].filter(Boolean);

        // 1) preferuj kontenery blisko rejonu komentarzy (textbox / „Napisz komentarz”)
        let anchor = null;
        const needles = ["napisz komentarz", "write a comment", "komentarze", "comments"];
        const candAnchor = Array.from(document.querySelectorAll("div[role='textbox'], textarea, span, div"))
          .filter(isVisible)
          .find((el) => needles.some((n) => norm(el.getAttribute?.("aria-label") || el.textContent).includes(n)));

        if (candAnchor) anchor = candAnchor;

        function score(el) {
          const ch = el.clientHeight || 0;
          const sh = el.scrollHeight || 0;
          const delta = sh - ch;

          // premia jeśli w środku widać słowa komentarzy
          const t = norm(el.innerText || "");
          const hasCommentWords = t.includes("komentarz") || t.includes("comment") || t.includes("napisz komentarz");
          let s = delta + (hasCommentWords ? 12000 : 0);

          // premia jeśli blisko anchora
          if (anchor) {
            const ar = anchor.getBoundingClientRect();
            const er = el.getBoundingClientRect();
            const dist = Math.abs(er.top - ar.top);
            s += Math.max(0, 4000 - dist);
          }

          return s;
        }

        let best = null;
        let bestScore = -1;

        for (const sc of scopes) {
          const divs = Array.from(sc.querySelectorAll("div, section, main, article"))
            .filter(isVisible)
            .slice(0, 18000);

          for (const el of divs) {
            if (!canScrollByTest(el)) continue;
            const s = score(el);
            if (s > bestScore) {
              bestScore = s;
              best = el;
            }
          }
          if (best) break;
        }

        if (best) {
          window.__FBW_POST_COMMENTS_CONTAINER = best;
          return { el: best, label: "smart" };
        }

        // 2) ostateczny fallback: window scroll (czasem w post view działa)
        return {
          el: document.scrollingElement || document.documentElement || document.body,
          label: "window",
        };
      }

      const picked = pickContainerSmart();
      const container = picked.el;
      const containerType = picked.label;

      const isWindowContainer =
        container === document.body || container === document.documentElement || container === document.scrollingElement;

      const before = isWindowContainer ? window.scrollY || 0 : container.scrollTop || 0;
      const maxScroll = (container.scrollHeight || 0) - (container.clientHeight || 0);

      if (maxScroll <= 0) {
        return { before, after: before, container: `${containerType}-no-scroll`, label: labelArg };
      }

      const f = factorArg || 0.25;
      const sign = f < 0 ? -1 : 1;
      const magnitude = Math.min(Math.abs(f), 1);

      // większy krok niż wcześniej, bo FB ładuje porcjami i ma throttling
      const baseStep = (container.clientHeight || window.innerHeight || 600) * magnitude;
      const step = Math.max(120, Math.min(baseStep, 520));

      const target = sign < 0 ? Math.max(0, before - step) : Math.min(maxScroll, before + step);

      if (isWindowContainer) window.scrollTo(0, target);
      else container.scrollTop = target;

      const after = isWindowContainer ? window.scrollY || 0 : container.scrollTop || 0;

      // jeśli nie drgnęło, spróbuj fallback: window scrollBy (FB czasem blokuje scrollTop)
      if (after === before) {
        try {
          window.scrollBy(0, sign * step);
        } catch {}
      }

      const after2 = isWindowContainer ? window.scrollY || 0 : container.scrollTop || 0;

      return { before, after: after2, container: containerType, label: labelArg };
    },
    factor,
    label,
    postRootScript()
  );

  return info;
}

/* ============================================================
   =================== EXPAND (LEGACY) =========================
   ============================================================ */

async function expandAllComments(page) {
  if (!EXPAND_COMMENTS) return 0;

  let clicks = 0;
  for (let i = 0; i < 30; i++) {
    const didClick = await clickOneExpandButton(page);
    if (!didClick) break;
    clicks++;
    await sleepRandom(900, 1600);
  }
  return clicks;
}

/* ============================================================
   =================== HANDLER API =============================
   ============================================================ */

export async function prepare(page, url) {
  console.log(`[FB][ui:post] prepare: ${url}`);

  const ok = await safeGoto(page, url, "post", {
    waitUntil: "networkidle2",
    timeout: NAV_TIMEOUT_MS,
  });

  if (!ok) throw new Error("safeGoto-failed");

  const currentUrl = page.url();
  if (currentUrl.includes("/login")) {
    console.log("[FB][ui:post] /login redirect → fbLogin() and back");
    await fbLogin(page);
    await sleepRandom(3000, 4500);

    const loggedAfterLogin = await checkIfLogged(page).catch(() => false);
    console.log("[FB][ui:post] session after fbLogin:", loggedAfterLogin ? "OK" : "NO");

    if (loggedAfterLogin) {
      await safeGoto(page, url, "post", {
        waitUntil: "networkidle2",
        timeout: NAV_TIMEOUT_MS,
      });
    }
  }

  await acceptCookies(page, "post-initial");

  await ensureLoggedInOnPostOverlay(page).catch(() => {});
  await sleepRandom(1200, 1800);
  await acceptCookies(page, "post");

  try {
    const logged = await checkIfLogged(page).catch(() => false);
    if (logged) await saveCookies(page);
  } catch {}

  // tu zostawiamy (minimalna ingerencja), ale getCommentCount i tak czeka na uspokojenie scrolla
  await scrollPost(page, 120).catch(() => {});
  await sleepRandom(600, 900);
}

async function waitForScrollStop(page, { timeoutMs = 2000, stableMs = 250 } = {}) {
  try {
    await page.waitForFunction(
      ({ stableMs }) => {
        const now = performance.now();
        const y = window.scrollY || 0;

        if (!window.__fbScrollStop) {
          window.__fbScrollStop = { lastY: y, lastChange: now };
          return false;
        }

        const st = window.__fbScrollStop;

        if (Math.abs(y - st.lastY) > 0) {
          st.lastY = y;
          st.lastChange = now;
          return false;
        }

        return now - st.lastChange >= stableMs;
      },
      { timeout: timeoutMs },
      { stableMs }
    );
    return true;
  } catch {
    return false;
  }
}

export async function getCommentCount(page, url) {
  console.log("[FB][ui:post] getCommentCount…");

  // FB często robi auto-scroll / reflow tuż po wejściu – nie klikamy filtra w trakcie ruchu
  await waitForScrollStop(page, { timeoutMs: 2400, stableMs: 320 });

  const scopeSel = await getPostScopeSelector(page);

  const okFilter = await switchCommentsFilterToAllScoped(page, scopeSel).catch(() => false);
  console.log("[FB][ui:post] filter all comments:", okFilter);

  // po filtrze DOM lubi się przebudować; nie scrollujemy — tylko chwila stabilizacji
  if (okFilter) {
    await sleepRandom(250, 450);
    await waitForScrollStop(page, { timeoutMs: 1200, stableMs: 220 });
  }

  // KLUCZ: licz UI po root posta, nie po scope dialogu
  const ui = await getCommentCountFromUiPostRoot(page).catch(() => null);

  console.log("[FB][ui:post] UI comments:", {
    source: ui?.source || "none",
    raw: ui?.raw || null,
    comments: ui?.comments ?? null,
  });

  if (ui && typeof ui.comments === "number" && ui.comments > 0) {
    return ui.comments;
  }

  const anchors = await getCurrentCommentAnchorCount(page);
  console.log("[FB][ui:post] Fallback anchor count =", anchors);

  return anchors > 0 ? anchors : null;
}

export async function loadAllComments(page, { expectedTotal } = {}) {
  console.log(`[FB][ui:post] loadAllComments… expectedTotal=${expectedTotal ?? "n/a"}`);

  await waitForScrollStop(page, { timeoutMs: 2400, stableMs: 320 });

  const MAX_ROUNDS = 600;
  const MAX_NO_PROGRESS = 10;

  let noProgress = 0;
  let lastAnchors = await getCurrentCommentAnchorCount(page);

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const before = lastAnchors;

    const scrollInfo = await scrollWithinPost(page, `round-${round}`, 0.25);
    const clicks = await expandAllComments(page);
    await sleepRandom(220, 420);

    const after = await getCurrentCommentAnchorCount(page);

    const progressed = scrollInfo.after !== scrollInfo.before || clicks > 0 || after > before;

    if (progressed) noProgress = 0;
    else noProgress++;

    lastAnchors = after;

    if (round === 1 || round % 25 === 0) {
      console.log(
        `[FB][ui:post] round=${round} container=${scrollInfo.container} scrollTop: ${scrollInfo.before}→${scrollInfo.after} anchors: ${before}→${after} clicks=${clicks} noProgress=${noProgress}`
      );
    }

    if (typeof expectedTotal === "number" && expectedTotal > 0) {
      if (after >= expectedTotal && noProgress >= 2) {
        console.log("[FB][ui:post] stop reason=target-reached");
        break;
      }
    }

    if (noProgress >= MAX_NO_PROGRESS) {
      console.log("[FB][ui:post] stop reason=no-progress");
      break;
    }
  }
}

export async function extractComments(page, url) {
  const data = await page.evaluate(() => {
    function extractCommentId(u) {
      const m = u?.match(/comment_id=([^&]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    }

    const allLinks = Array.from(document.querySelectorAll('a[role="link"]'));
    const idToTimeMap = {};

    for (let i = 0; i < allLinks.length; i++) {
      const link = allLinks[i];
      const href = link.getAttribute("href") || "";
      const id = extractCommentId(href);
      if (!id) continue;

      for (let j = i + 1; j < Math.min(allLinks.length, i + 5); j++) {
        const timeText = allLinks[j]?.textContent?.trim()?.toLowerCase();
        if (timeText && /^\d+\s?(min|godz|sek|dni|tyg|h|d|m)\b/.test(timeText)) {
          idToTimeMap[id] = timeText;
          break;
        }
      }
    }

    const nodes = Array.from(document.querySelectorAll("div.xwib8y2.xpdmqnj.x1g0dm76.x1y1aw1k"));

    const extracted = nodes
      .map((node, idx) => {
        const author = node.querySelector('a[role="link"] span span')?.textContent?.trim() || null;
        const text = node.querySelector('div[dir="auto"]')?.textContent?.trim() || null;

        const linkEl = node.querySelector('a[role="link"]');
        const href = linkEl?.getAttribute("href") || null;
        const permalink = href ? (href.startsWith("http") ? href : `https://www.facebook.com${href}`) : null;

        const id = permalink ? extractCommentId(permalink) : null;
        const time = id && idToTimeMap[id] ? idToTimeMap[id] : null;

        if (!author || !text) return null;

        return { id, author, text, time, permalink, pos: idx };
      })
      .filter(Boolean);

    return extracted;
  });

  console.log("[FB][ui:post] extractComments: count =", data?.length || 0);
  return Array.isArray(data) ? data : [];
}

export async function debugSnapshot(page) {
  const scopeSel = await getPostScopeSelector(page);
  const anchors = await getCurrentCommentAnchorCount(page).catch(() => 0);

  return {
    scopeSel,
    anchors,
    url: page.url(),
  };
}
