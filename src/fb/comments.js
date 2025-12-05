// src/fb/comments.js
import { EXPAND_COMMENTS } from "../config.js";
import { sleepRandom } from "../utils/sleep.js";
import { scrollWithinPost, detectCommentsScrollContainer } from "./scroll.js";
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

    const candidates = els.filter((el) => {
      const txt = (el.innerText || el.textContent || "").trim().toLowerCase();
      if (!txt) return false;

      const isDropdown =
        txt.includes("najtrafniejsze") ||
        txt.includes("all comments") ||
        txt.includes("most relevant") ||
        txt.includes("wszystkie komentarze") ||
        txt.includes("autor") ||
        txt.includes("author");

      if (!isDropdown) return false;

      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return false;

      if (rect.bottom < 0) return false;
      if (rect.top > window.innerHeight) return false;

      return true;
    });

    if (!candidates.length) return false;

    let target = candidates[0];
    let bestY = Infinity;
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      const centerY = Math.abs(r.top + r.height / 2 - window.innerHeight / 2);
      if (centerY < bestY) {
        bestY = centerY;
        target = el;
      }
    }

    target.click();
    return true;
  });

  if (!opened) {
    console.log("[FB] Nie znaleziono przełącznika filtra komentarzy.");
    return false;
  }

  await sleepRandom(600, 1000);

  const switched = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("div[role='menuitem']"));
    if (!items.length) return false;

    let best = null;
    let bestScore = -1;

    for (const el of items) {
      const txt = (el.innerText || el.textContent || "").trim().toLowerCase();
      if (!txt) continue;

      let score = 0;

      if (txt.includes("wszystkie komentarze") || txt.includes("all comments")) {
        score += 100;
      }
      if (txt.includes("najtrafniejsze") || txt.includes("most relevant")) {
        score -= 20;
      }
      if (txt.includes("autor") || txt.includes("author")) {
        score += 10;
      }

      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;

      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) continue;
      if (rect.bottom < 0) continue;
      if (rect.top > window.innerHeight) continue;

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (!best) return false;

    best.click();
    return true;
  });

  if (!switched) {
    console.log("[FB] Nie udało się wybrać opcji „Wszystkie komentarze”.");
    return false;
  }

  console.log("[FB] Filtr komentarzy ustawiony na: Wszystkie komentarze.");
  await sleepRandom(800, 1400);
  return true;
}

/* ==================================
   =======  ŁADOWANIE KOMENTARZY ====
   ================================== */

async function ensureAllCommentsLoaded(page, expectedTotal = null) {
  console.log("[FB] ensureAllCommentsLoaded – start");

  try {
    const info = await detectCommentsScrollContainer(page);
    console.log("[FB] detectCommentsScrollContainer:", info);
  } catch (e) {
    console.log(
      "[FB] detectCommentsScrollContainer – błąd (ignoruję):",
      e?.message || e
    );
  }

  const MAX_ROUNDS = 300;
  const MAX_NO_PROGRESS = 10;
  let lastCount = 0;
  let noProgressRounds = 0;

  const hasTarget = typeof expectedTotal === "number" && expectedTotal > 0;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const countBefore = await getCurrentCommentAnchorCount(page);

    await expandAllComments(page);

    const scrollInfo = await scrollWithinPost(page, `round-${round}`, 0.25);
    await sleepRandom(250, 450);

    const countAfter = await getCurrentCommentAnchorCount(page);

    console.log(
      `[FB] ensureAllCommentsLoaded – runda ${round}, IDs=${countAfter}, scroll=${scrollInfo.before}/${scrollInfo.after} (${scrollInfo.container})`
    );

    if (hasTarget && countAfter >= expectedTotal) {
      console.log(
        `[FB] ensureAllCommentsLoaded – osiągnięto expectedTotal=${expectedTotal} (IDs=${countAfter})`
      );
      break;
    }

    if (countAfter > lastCount) {
      lastCount = countAfter;
      noProgressRounds = 0;
    } else {
      noProgressRounds++;
    }

    if (!hasTarget && noProgressRounds >= MAX_NO_PROGRESS) {
      console.log(
        "[FB] ensureAllCommentsLoaded – brak progresu (IDs nie rosną), stop (główna pętla)."
      );
      break;
    }
  }

  try {
    console.log(
      "[FB] ensureAllCommentsLoaded – runda kontrolna (scroll góra-dół w obrębie posta)."
    );

    for (let i = 1; i <= 3; i++) {
      const idsBefore = await getCurrentCommentAnchorCount(page);

      const up = await scrollWithinPost(page, `ctrl-up-${i}`, -0.35);
      await sleepRandom(250, 400);

      const down = await scrollWithinPost(page, `ctrl-down-${i}`, 0.35);
      await sleepRandom(250, 400);

      const idsAfter = await getCurrentCommentAnchorCount(page);

      console.log(
        `[FB] kontrola ${i}: IDs ${idsBefore} -> ${idsAfter}, ` +
          `scrollUp=${up.before}->${up.after} (${up.container}), ` +
          `scrollDown=${down.before}->${down.after} (${down.container})`
      );

      if (
        idsAfter <= idsBefore &&
        up.before === up.after &&
        down.before === down.after
      ) {
        console.log("[FB] Runda kontrolna: brak zmian — STOP.");
        break;
      }
    }
  } catch (e) {
    console.log(
      "[FB] ensureAllCommentsLoaded – runda kontrolna zakończona błędem (ignoruję):",
      e?.message || e
    );
  }

  console.log("[FB] ensureAllCommentsLoaded – koniec.");
}

/* =============
   =====  UX ===
   ============= */

async function clickIfExists(page, xpath, label) {
  const didClick = await page.evaluate((xp) => {
    try {
      const doc = document;
      const res = doc.evaluate(
        xp,
        doc,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      const node = res.singleNodeValue;
      if (!node || !(node instanceof HTMLElement)) return false;
      node.click();
      return true;
    } catch (e) {
      return false;
    }
  }, xpath);

  if (!didClick) return false;

  console.log(`[FB] -> klik ${label}`);
  await sleepRandom(600, 1000);
  return true;
}

/* ======================================
   =====  ROZWIJANIE KOMENTARZY  ========
   ====================================== */

async function expandAllComments(page) {
  if (!EXPAND_COMMENTS) {
    console.log("[FB] EXPAND_COMMENTS=false – pomijam rozwijanie komentarzy.");
    return;
  }

  let clickedSomething = false;

  const patterns = [
    {
      xpath:
        "//div[contains(@role,'button')][.//span[contains(text(),'Wyświetl więcej komentarzy') or contains(text(),'View more comments') or contains(text(),'View previous comments')]]",
      label: "'więcej komentarzy / view more comments'",
    },
    {
      xpath:
        "//div[contains(@role,'button')][.//span[contains(text(),'Zobacz więcej komentarzy') or contains(text(),'See more comments')]]",
      label: "'zobacz więcej komentarzy / see more comments'",
    },
    {
      xpath:
        "//div[contains(@role,'button')][.//span[contains(text(),'X odpowiedzi') or contains(text(),'replies') or contains(text(),'See previous replies') or contains(text(),'View more replies')]]",
      label: "'więcej odpowiedzi / X odpowiedzi'",
    },
    {
      xpath:
        "//div[contains(@role,'button')][.//span[contains(text(),'Wyświetl więcej odpowiedzi') or contains(text(),'View more replies') or contains(text(),'View previous replies')]]",
      label: "'więcej odpowiedzi / view more replies'",
    },
  ];

  for (const { xpath, label } of patterns) {
    const didClick = await clickIfExists(page, xpath, label);
    if (didClick) clickedSomething = true;
  }

  if (!clickedSomething) {
    console.log("[FB] Nic do rozwinięcia (komentarze).");
  }

  await sleepRandom(500, 900);
}

/* ======================================
   =====  LICZENIE ANCHORÓW  ============
   ====================================== */

async function getCurrentCommentAnchorCount(page) {
  const count = await page.evaluate(() => {
    const anchors = Array.from(
      document.querySelectorAll("a[href*='comment_id'], a[href*='reply_comment_id']")
    );
    const ids = new Set();

    for (const a of anchors) {
      try {
        const url = new URL(a.href);
        const cid = url.searchParams.get("comment_id");
        const rcid = url.searchParams.get("reply_comment_id");
        if (cid) ids.add(cid);
        if (rcid) ids.add(rcid);
      } catch (e) {
        const href = a.href || "";
        const m = href.match(/(comment_id|reply_comment_id)=(\d+)/);
        if (m) {
          ids.add(m[2]);
        }
      }
    }
    return ids.size;
  });
  return count || 0;
}

/* ============ PARSOWANIE LICZBY KOMENTARZY ============ */

async function getCommentCount(page) {
  const debug = {
    source: "none",
    raw: undefined,
    buttonTextsSample: [],
    globalSampleCount: 0,
  };

  const res = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const result = { num: null, debug: {} };

        function parsePolishLike(text) {
          const m = text.match(/(\d[\d\s]*)\s*komentarz/i);
          if (!m) return null;
          return parseInt(m[1].replace(/\s/g, ""), 10);
        }

        function parseEnglishLike(text) {
          const m = text.match(/(\d[\d\s]*)\s*comment/i);
          if (!m) return null;
          return parseInt(m[1].replace(/\s/g, ""), 10);
        }

        const allButtons = Array.from(
          document.querySelectorAll("div[role='button'], span[role='button']")
        );
        const btnTexts = allButtons
          .map((el) => (el.innerText || el.textContent || "").trim())
          .filter((t) => !!t);

        const debugLocal = {
          buttonTextsSample: btnTexts.slice(0, 30),
          globalSampleCount: btnTexts.length,
        };

        function fromAllCommentsButton(btns) {
          for (const raw of btns) {
            const t = raw.toLowerCase();
            if (
              t.includes("komentarze") ||
              t.includes("comments") ||
              t.includes("replies")
            ) {
              const n =
                parsePolishLike(raw) ??
                parseEnglishLike(raw) ??
                parseInt(raw.replace(/[^\d]/g, ""), 10);
              if (!Number.isNaN(n) && n > 0) {
                return { num: n, raw };
              }
            }
          }
          return null;
        }

        function fromFilterButtonArea() {
          const filterBtn = allButtons.find((el) => {
            const t = (el.innerText || el.textContent || "")
              .trim()
              .toLowerCase();
            return (
              t === "najtrafniejsze" ||
              t === "most relevant" ||
              t === "wszystkie komentarze" ||
              t === "all comments" ||
              t === "autor" ||
              t === "author"
            );
          });

          if (!filterBtn) return null;

          const root =
            filterBtn.closest("div[role='dialog']") ||
            filterBtn.closest("article") ||
            document;

          const nearbyTexts = Array.from(
            root.querySelectorAll("div, span, a, h2, h3")
          )
            .map((el) => (el.innerText || el.textContent || "").trim())
            .filter((t) => !!t);

          let bestNum = null;
          let bestRaw = null;

          for (const raw of nearbyTexts) {
            const n =
              parsePolishLike(raw) ??
              parseEnglishLike(raw) ??
              parseInt(raw.replace(/[^\d]/g, ""), 10);
            if (Number.isNaN(n) || n <= 0) continue;

            const lower = raw.toLowerCase();
            if (
              lower.includes("komentarz") ||
              lower.includes("comment") ||
              lower.includes("odpowiedzi") ||
              lower.includes("replies")
            ) {
              if (bestNum == null || n > bestNum) {
                bestNum = n;
                bestRaw = raw;
              }
            }
          }

          if (bestNum != null) {
            return { num: bestNum, raw: bestRaw };
          }

          return null;
        }

        function fromGlobalTextScan() {
          const allTextNodes = Array.from(
            document.querySelectorAll("div, span, a, h2, h3")
          );
          let bestNum = null;
          let bestRaw = null;

          for (const el of allTextNodes) {
            const raw = (el.innerText || el.textContent || "").trim();
            if (!raw) continue;

            const lower = raw.toLowerCase();
            if (
              !lower.includes("komentarz") &&
              !lower.includes("comment") &&
              !lower.includes("odpowiedzi") &&
              !lower.includes("replies")
            ) {
              continue;
            }

            const n =
              parsePolishLike(raw) ??
              parseEnglishLike(raw) ??
              parseInt(raw.replace(/[^\d]/g, ""), 10);
            if (Number.isNaN(n) || n <= 0) continue;

            if (bestNum == null || n > bestNum) {
              bestNum = n;
              bestRaw = raw;
            }
          }

          if (bestNum != null) {
            return { num: bestNum, raw: bestRaw };
          }

          return null;
        }

        let finalRes =
          fromAllCommentsButton(btnTexts) ||
          fromFilterButtonArea() ||
          fromGlobalTextScan();

        if (finalRes) {
          result.num = finalRes.num;
          result.debug = {
            ...debugLocal,
            source: "filterLinked",
            raw: finalRes.raw,
          };
        } else {
          result.num = null;
          result.debug = { ...debugLocal, source: "none", raw: undefined };
        }

        resolve(result);
      })
  );

  const num = res?.num ?? null;
  const mergedDebug = { ...debug, ...res?.debug };

  console.log("[DBG] Comments debug:", mergedDebug);

  return { num, debug: mergedDebug };
}

/* ======================================
   =====  EKSTRAKCJA KOMENTARZY  ========
   ====================================== */

async function extractCommentsData(page) {
  return await page.evaluate(() => {
    const anchors = Array.from(
      document.querySelectorAll("a[href*='comment_id'], a[href*='reply_comment_id']")
    );

    const byId = new Map();

    for (const a of anchors) {
      let href = a.href;
      let commentId = null;

      try {
        const url = new URL(href);
        commentId =
          url.searchParams.get("comment_id") ||
          url.searchParams.get("reply_comment_id");
      } catch (e) {
        const m = href.match(/(comment_id|reply_comment_id)=(\d+)/);
        if (m) {
          commentId = m[2];
        }
      }

      if (!commentId) continue;

      const root =
        a.closest("div[aria-label*='Komentarz']") ||
        a.closest("div[aria-label*='comment']") ||
        a.closest("li") ||
        a.closest("article") ||
        a.closest("div");

      if (!root) continue;

      const rect = root.getBoundingClientRect();
      const pos = rect.top + rect.height / 2;

      let author = null;
      let authorLink = root.querySelector(
        "a[role='link'][tabindex='0'], strong a[role='link'], span a[role='link']"
      );
      if (authorLink) {
        author = (authorLink.innerText || authorLink.textContent || "").trim();
      }

      let timeText = null;
      const timeEl =
        root.querySelector("a[role='link'] abbr") ||
        root.querySelector("a[role='link'] span");
      if (timeEl) {
        timeText = (timeEl.innerText || timeEl.textContent || "").trim();
      }

      let commentBody =
        root.querySelector("div[dir='auto']") ||
        root.querySelector("span[dir='auto']") ||
        root;

      let text = (commentBody.innerText || commentBody.textContent || "").trim();

      let finalText = text;
      const seeMore = root.querySelector(
        "div[role='button'] span, span[role='button'] span"
      );
      if (seeMore) {
        const moreTxt = (seeMore.innerText || seeMore.textContent || "").trim();
        if (
          /zobacz więcej|see more|więcej/i.test(moreTxt) &&
          !/\.\.\.$/.test(text)
        ) {
          const fallback =
            (root.innerText || root.textContent || "")
              .replace(/\s+/g, " ")
              .trim();
          if (fallback && fallback.length > text.length) {
            finalText = fallback;
          }
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

export {
  switchCommentsFilterToAll,
  ensureAllCommentsLoaded,
  expandAllComments,
  getCurrentCommentAnchorCount,
  getCommentCount,
  extractCommentsData,
};
