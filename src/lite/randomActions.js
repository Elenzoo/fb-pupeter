// src/lite/randomActions.js
// Losowe akcje - lajki, pauzy, interakcje

import { gaussianRandom, sleep } from "../utils/sleep.js";
import { humanClick } from "../utils/mouse.js";
import { smoothScrollBy } from "./smoothScroll.js";
import log from "../utils/logger.js";

/**
 * Może polubić losowy post (20% domyślnie)
 * @param {import('puppeteer').Page} page
 * @param {object} options
 * @returns {Promise<boolean>} - true jeśli polubiono
 */
async function maybeRandomLike(page, options = {}) {
  const {
    chance = 0.20,
    enabled = true,
  } = options;

  if (!enabled || Math.random() > chance) return false;

  try {
    // Znajdź przyciski like na stronie
    const likeButtons = await page.$$(
      '[aria-label*="Lubię to"]:not([aria-pressed="true"]), ' +
      '[aria-label*="Like"]:not([aria-pressed="true"])'
    );

    if (likeButtons.length === 0) {
      log.debug("RANDOM", "Brak przycisków like do kliknięcia");
      return false;
    }

    // Filtruj widoczne w viewport
    const visibleButtons = [];
    for (const btn of likeButtons) {
      try {
        const isVisible = await btn.isIntersectingViewport();
        if (isVisible) {
          // Sprawdź czy to nie jest już polubione
          const isLiked = await btn.evaluate(el =>
            el.getAttribute("aria-pressed") === "true" ||
            el.closest('[aria-label*="Usuń reakcję"]') ||
            el.closest('[aria-label*="Remove"]')
          );
          if (!isLiked) {
            visibleButtons.push(btn);
          }
        }
      } catch {
        // Element mógł zniknąć
      }
      if (visibleButtons.length >= 5) break;
    }

    if (visibleButtons.length === 0) {
      return false;
    }

    // Wybierz losowy przycisk
    const randomButton = visibleButtons[Math.floor(Math.random() * visibleButtons.length)];

    // Kliknij
    await humanClick(page, randomButton);
    await sleep(gaussianRandom(800, 200));

    log.prod("LITE", "[LIKE] Polubiono losowy post");
    return true;
  } catch (err) {
    log.debug("RANDOM", `Błąd random like: ${err.message}`);
    return false;
  }
}

/**
 * Pauza proporcjonalna do długości treści
 * @param {number} contentLength - długość tekstu
 * @param {object} options
 * @returns {Promise<number>} - czas pauzy w ms
 */
async function contentBasedPause(contentLength, options = {}) {
  const {
    msPerChar = 50,      // ~50ms na znak (200 słów/min)
    minMs = 1000,
    maxMs = 15000,
    variance = 0.3,
  } = options;

  // Bazowy czas czytania
  let basePause = contentLength * msPerChar;

  // Dodaj wariancję Gaussa
  basePause = gaussianRandom(basePause, basePause * variance);

  // Clamp
  const finalPause = Math.max(minMs, Math.min(maxMs, basePause));

  await sleep(finalPause);

  log.debug("RANDOM", `Content pause: ${Math.round(finalPause / 1000)}s dla ${contentLength} znaków`);
  return finalPause;
}

/**
 * Może wykonać "micro-break" - krótką pauzę z minimalną aktywnością
 * @param {import('puppeteer').Page} page
 * @param {object} options
 * @returns {Promise<{executed: boolean, duration: number}>}
 */
async function maybeMicroBreak(page, options = {}) {
  const {
    chance = 0.1,
    enabled = true,
    minDurationMs = 3000,
    maxDurationMs = 10000,
  } = options;

  if (!enabled || Math.random() > chance) {
    return { executed: false, duration: 0 };
  }

  const duration = gaussianRandom(
    (minDurationMs + maxDurationMs) / 2,
    (maxDurationMs - minDurationMs) / 4
  );
  const clampedDuration = Math.max(minDurationMs, Math.min(maxDurationMs, duration));

  log.debug("RANDOM", `Micro-break: ${Math.round(clampedDuration / 1000)}s`);

  // Symuluj minimalną aktywność
  const startTime = Date.now();

  while (Date.now() - startTime < clampedDuration) {
    // Mały scroll (czasem)
    if (Math.random() < 0.3) {
      const smallScroll = gaussianRandom(0, 30);
      if (Math.abs(smallScroll) > 10) {
        await smoothScrollBy(page, smallScroll, { duration: 200 });
      }
    }

    // Krótka pauza
    await sleep(gaussianRandom(1000, 300));
  }

  return { executed: true, duration: clampedDuration };
}

/**
 * Może rozwinąć "Zobacz więcej" w poście
 * @param {import('puppeteer').Page} page
 * @param {object} options
 * @returns {Promise<boolean>}
 */
async function maybeExpandSeeMore(page, options = {}) {
  const {
    chance = 0.3,
    enabled = true,
  } = options;

  if (!enabled || Math.random() > chance) return false;

  try {
    // Znajdź przyciski "Zobacz więcej" / "See more"
    const seeMoreButtons = await page.$$(
      '[role="button"]:has-text("Zobacz więcej"), ' +
      '[role="button"]:has-text("See more"), ' +
      'div[dir="auto"] span:has-text("Zobacz więcej"), ' +
      'div[dir="auto"] span:has-text("See more")'
    );

    if (seeMoreButtons.length === 0) return false;

    // Wybierz losowy widoczny
    for (const btn of seeMoreButtons) {
      try {
        const isVisible = await btn.isIntersectingViewport();
        if (isVisible) {
          await humanClick(page, btn);
          await sleep(gaussianRandom(500, 150));
          log.debug("RANDOM", "Rozwinięto 'Zobacz więcej'");
          return true;
        }
      } catch {
        // Kontynuuj
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Może kliknąć w reakcje (emoji) żeby zobaczyć kto reagował
 * @param {import('puppeteer').Page} page
 * @param {object} options
 * @returns {Promise<boolean>}
 */
async function maybeViewReactions(page, options = {}) {
  const {
    chance = 0.05,
    enabled = true,
    viewDurationMs = [2000, 5000],
  } = options;

  if (!enabled || Math.random() > chance) return false;

  try {
    // Znajdź liczniki reakcji
    const reactionCounters = await page.$$('[aria-label*="reakcji"], [aria-label*="reactions"]');

    if (reactionCounters.length === 0) return false;

    // Kliknij losowy widoczny
    for (const counter of reactionCounters) {
      try {
        const isVisible = await counter.isIntersectingViewport();
        if (isVisible) {
          await humanClick(page, counter);
          await sleep(gaussianRandom(500, 150));

          // "Oglądaj" reakcje
          const viewTime = gaussianRandom(
            (viewDurationMs[0] + viewDurationMs[1]) / 2,
            (viewDurationMs[1] - viewDurationMs[0]) / 4
          );
          await sleep(Math.max(viewDurationMs[0], Math.min(viewDurationMs[1], viewTime)));

          // Zamknij (Escape)
          await page.keyboard.press("Escape");
          await sleep(gaussianRandom(300, 100));

          log.debug("RANDOM", "Obejrzano reakcje");
          return true;
        }
      } catch {
        // Kontynuuj
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Wykonuje losowe "naturalne" akcje
 * @param {import('puppeteer').Page} page
 * @param {object} options
 * @returns {Promise<{actions: string[]}>}
 */
async function executeRandomActions(page, options = {}) {
  const {
    likeEnabled = true,
    likeChance = 0.20,
    microBreakEnabled = true,
    microBreakChance = 0.10,
    expandEnabled = true,
    expandChance = 0.30,
    reactionsEnabled = true,
    reactionsChance = 0.05,
  } = options;

  const actions = [];

  // Micro-break
  if (microBreakEnabled) {
    const result = await maybeMicroBreak(page, { chance: microBreakChance });
    if (result.executed) actions.push("micro_break");
  }

  // Random like
  if (likeEnabled) {
    const liked = await maybeRandomLike(page, { chance: likeChance });
    if (liked) actions.push("random_like");
  }

  // Expand see more
  if (expandEnabled) {
    const expanded = await maybeExpandSeeMore(page, { chance: expandChance });
    if (expanded) actions.push("expand_see_more");
  }

  // View reactions
  if (reactionsEnabled) {
    const viewed = await maybeViewReactions(page, { chance: reactionsChance });
    if (viewed) actions.push("view_reactions");
  }

  return { actions };
}

export {
  maybeRandomLike,
  contentBasedPause,
  maybeMicroBreak,
  maybeExpandSeeMore,
  maybeViewReactions,
  executeRandomActions,
};
