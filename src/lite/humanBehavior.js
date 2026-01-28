// src/lite/humanBehavior.js
// Koordynator zachowań - wrapper dla wszystkich human-like akcji

import { gaussianRandom, sleep, humanDelay } from "../utils/sleep.js";
import { humanClick as mouseHumanClick, randomMouseMovement, moveToElement } from "../utils/mouse.js";
import { smoothScrollBy, smoothScrollToElement } from "./smoothScroll.js";
import { maybeGoBack, maybeScrollWrongDirection, humanTypeWithMistakes } from "./userMistakes.js";
import { maybeSimulateTabSwitch, maybeSimulateBlur } from "./tabSimulation.js";
import { maybeVisitProfile } from "./profileVisitor.js";
import { maybeInteractWithRandomImage } from "./imageInteraction.js";
import { getActivityMultiplier, getAdaptiveDelay } from "./antiDetection.js";
import log from "../utils/logger.js";

/**
 * Konfiguracja domyślna human behavior
 */
const DEFAULT_CONFIG = {
  // Pauzy
  preActionPauseMs: [500, 1500],
  postActionPauseMs: [300, 1000],
  betweenPostsPauseMs: [60000, 180000], // 1-3 minuty między postami

  // Błędy
  typingMistakesEnabled: true,
  typingMistakesChance: 0.03,
  navigationMistakesEnabled: true,
  navigationMistakesChance: 0.05,
  scrollMistakesEnabled: true,
  scrollMistakesChance: 0.08,

  // Tab simulation
  tabSimulationEnabled: true,
  tabSimulationChance: 0.10,
  blurSimulationEnabled: true,
  blurSimulationChance: 0.15,

  // Profile visits
  profileVisitsEnabled: true,
  profileVisitsChance: 0.08,

  // Image interaction
  imageInteractionEnabled: true,
  imageInteractionChance: 0.15,

  // Adaptive delays (pora dnia)
  adaptiveDelaysEnabled: true,
};

/**
 * Pauza przed akcją - symuluje "myślenie"
 * @param {import('puppeteer').Page} page
 * @param {string} actionType - typ akcji (dla logów)
 * @param {object} config
 * @returns {Promise<number>} - użyte opóźnienie w ms
 */
async function preAction(page, actionType = "action", config = DEFAULT_CONFIG) {
  const [minMs, maxMs] = config.preActionPauseMs || [500, 1500];

  let delay = gaussianRandom((minMs + maxMs) / 2, (maxMs - minMs) / 4);
  delay = Math.max(minMs, Math.min(maxMs, delay));

  // Adaptacja do pory dnia
  if (config.adaptiveDelaysEnabled) {
    delay = getAdaptiveDelay(delay);
  }

  // Losowy ruch myszy podczas "myślenia" (30% szans)
  if (Math.random() < 0.3) {
    randomMouseMovement(page).catch(() => {});
  }

  await sleep(delay);

  log.debug("HUMAN", `preAction(${actionType}): ${Math.round(delay)}ms`);
  return delay;
}

/**
 * Pauza po akcji
 * @param {import('puppeteer').Page} page
 * @param {string} actionType
 * @param {object} config
 * @returns {Promise<number>}
 */
async function postAction(page, actionType = "action", config = DEFAULT_CONFIG) {
  const [minMs, maxMs] = config.postActionPauseMs || [300, 1000];

  let delay = gaussianRandom((minMs + maxMs) / 2, (maxMs - minMs) / 4);
  delay = Math.max(minMs, Math.min(maxMs, delay));

  if (config.adaptiveDelaysEnabled) {
    delay = getAdaptiveDelay(delay);
  }

  await sleep(delay);

  log.debug("HUMAN", `postAction(${actionType}): ${Math.round(delay)}ms`);
  return delay;
}

/**
 * Wrapper owija funkcję w human behavior (pre + post action)
 * @param {Function} fn - funkcja do wykonania
 * @param {import('puppeteer').Page} page
 * @param {string} actionType
 * @param {object} config
 * @returns {Promise<*>} - wynik funkcji
 */
async function humanized(fn, page, actionType = "action", config = DEFAULT_CONFIG) {
  await preAction(page, actionType, config);
  const result = await fn();
  await postAction(page, actionType, config);
  return result;
}

/**
 * Human-like kliknięcie z pauzami
 * @param {import('puppeteer').Page} page
 * @param {import('puppeteer').ElementHandle} element
 * @param {object} config
 * @returns {Promise<boolean>}
 */
async function humanClick(page, element, config = DEFAULT_CONFIG) {
  await preAction(page, "click", config);
  const result = await mouseHumanClick(page, element);
  await postAction(page, "click", config);
  return result;
}

/**
 * Human-like nawigacja
 * @param {import('puppeteer').Page} page
 * @param {string} url
 * @param {object} options
 * @returns {Promise<void>}
 */
async function humanNavigate(page, url, options = {}) {
  const {
    config = DEFAULT_CONFIG,
    waitUntil = "domcontentloaded",
    timeout = 30000,
  } = options;

  await preAction(page, "navigate", config);

  await page.goto(url, { waitUntil, timeout });

  // Dłuższa pauza po nawigacji (strona się ładuje)
  const loadDelay = gaussianRandom(2000, 500);
  await sleep(Math.max(1000, Math.min(4000, loadDelay)));

  await postAction(page, "navigate", config);
}

/**
 * Długa pauza między postami (1-3 minuty)
 * Z szansą na scrollowanie głównej tablicy w tym czasie
 * @param {import('puppeteer').Page} page - strona (może być null)
 * @param {object} config
 * @param {object} options - dodatkowe opcje
 * @returns {Promise<{totalTime: number, homeFeedVisited: boolean, scrollTime: number}>}
 */
async function betweenPostsPause(page, config = DEFAULT_CONFIG, options = {}) {
  const {
    homeFeedChance = 0.35, // 35% szans na wejście na główną
    homeFeedScrollMs = [20000, 60000], // 20-60s scrollowania głównej
  } = options;

  const [minMs, maxMs] = config.betweenPostsPauseMs || [60000, 180000];

  // Losowy całkowity czas przerwy (1-3 min)
  let totalDelay = gaussianRandom((minMs + maxMs) / 2, (maxMs - minMs) / 4);
  totalDelay = Math.max(minMs, Math.min(maxMs, totalDelay));
  // NIE używamy getAdaptiveDelay dla długich przerw - już są odpowiednio długie

  const totalMinutes = (totalDelay / 60000).toFixed(1);
  log.prod("LITE", `[PAUZA] Przerwa ${totalMinutes} min między postami...`);

  let homeFeedVisited = false;
  let scrollTime = 0;

  // Szansa na scrollowanie głównej tablicy
  if (page && Math.random() < homeFeedChance) {
    // Losowy czas scrollowania (ale max 60% całkowitej przerwy)
    const maxScrollTime = totalDelay * 0.6;
    const [minScroll, maxScroll] = homeFeedScrollMs;
    let scrollDuration = gaussianRandom((minScroll + maxScroll) / 2, (maxScroll - minScroll) / 4);
    scrollDuration = Math.max(minScroll, Math.min(maxScrollTime, scrollDuration));

    log.prod("LITE", `[PAUZA] Wchodzę na główną stronę FB na ${(scrollDuration / 1000).toFixed(0)}s...`);

    try {
      await page.goto("https://www.facebook.com/", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      await sleep(gaussianRandom(2000, 500));

      const startScroll = Date.now();
      while (Date.now() - startScroll < scrollDuration) {
        // Scroll w dół
        const scrollAmount = gaussianRandom(300, 100);
        await smoothScrollBy(page, Math.max(100, scrollAmount));

        // Pauza między scrollami
        await sleep(gaussianRandom(1500, 500));

        // Losowy ruch myszy (40%)
        if (Math.random() < 0.4) {
          await randomMouseMovement(page).catch(() => {});
        }
      }

      scrollTime = Date.now() - startScroll;
      homeFeedVisited = true;
      log.prod("LITE", `[PAUZA] Zakończono scrollowanie głównej (${(scrollTime / 1000).toFixed(0)}s)`);

    } catch (err) {
      log.dev("LITE", `[PAUZA] Błąd głównej strony: ${err.message}`);
    }
  }

  // Pozostały czas przerwy (po scrollowaniu lub cała przerwa jeśli bez scrollowania)
  const remainingTime = Math.max(5000, totalDelay - scrollTime);

  if (remainingTime > 5000) {
    log.prod("LITE", `[PAUZA] Czekam jeszcze ${(remainingTime / 1000).toFixed(0)}s...`);

    // W pozostałym czasie symuluj drobną aktywność
    const waitStart = Date.now();
    while (Date.now() - waitStart < remainingTime) {
      // Losowy ruch myszy co 15-30s (jeśli page istnieje)
      if (page && Math.random() < 0.3) {
        await randomMouseMovement(page).catch(() => {});
      }
      await sleep(Math.min(remainingTime - (Date.now() - waitStart), gaussianRandom(15000, 5000)));
    }
  }

  const actualTotal = scrollTime + remainingTime;
  log.prod("LITE", `[PAUZA] Przerwa zakończona (${(actualTotal / 1000).toFixed(0)}s total)`);

  return { totalTime: actualTotal, homeFeedVisited, scrollTime };
}

/**
 * Losowo wchodzi na główną stronę FB między postami
 * @param {import('puppeteer').Page} page
 * @param {object} options
 * @returns {Promise<{visited: boolean, scrollTime?: number}>}
 */
async function maybeVisitHomeFeed(page, options = {}) {
  const {
    chance = 0.25, // 25% szans na wejście na główną
    scrollDurationMs = null, // null = losowe 5-15s
    enabled = true,
  } = options;

  if (!enabled || !page) return { visited: false };
  if (Math.random() > chance) return { visited: false };

  log.prod("LITE", "[HOME] Wchodzę na główną stronę FB...");

  try {
    await page.goto("https://www.facebook.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Poczekaj na załadowanie
    await sleep(gaussianRandom(2000, 500));

    // Losowy czas scrollowania (5-15 sekund)
    const scrollDuration = scrollDurationMs || gaussianRandom(10000, 3000);
    const clampedDuration = Math.max(5000, Math.min(20000, scrollDuration));

    log.prod("LITE", `[HOME] Scrolluję feed przez ${(clampedDuration / 1000).toFixed(1)}s`);

    const startTime = Date.now();
    while (Date.now() - startTime < clampedDuration) {
      // Losowy scroll w dół
      const scrollAmount = gaussianRandom(300, 100);
      await smoothScrollBy(page, Math.max(100, scrollAmount));

      // Pauza między scrollami
      await sleep(gaussianRandom(1500, 500));

      // Losowy ruch myszy (40% szans)
      if (Math.random() < 0.4) {
        await randomMouseMovement(page).catch(() => {});
      }
    }

    log.prod("LITE", "[HOME] Zakończono przeglądanie głównej strony");
    return { visited: true, scrollTime: clampedDuration };
  } catch (err) {
    log.dev("LITE", `[HOME] Błąd: ${err.message}`);
    return { visited: false };
  }
}

/**
 * Wykonuje ruchy myszy na page (symulacja aktywności)
 * @param {import('puppeteer').Page} page
 * @param {number} count - ile ruchów
 * @returns {Promise<void>}
 */
async function performMouseMovements(page, count = 3) {
  if (!page) return;

  log.dev("LITE", `[MOUSE] Wykonuję ${count} ruchów myszy`);

  for (let i = 0; i < count; i++) {
    await randomMouseMovement(page).catch(() => {});
    await sleep(gaussianRandom(300, 100));
  }
}

/**
 * Wykonuje losowe akcje "tła" podczas sesji
 * Wywołuj okresowo w głównej pętli
 * @param {import('puppeteer').Page} page
 * @param {object} config
 * @returns {Promise<{actions: string[]}>}
 */
async function executeRandomBackgroundActions(page, config = DEFAULT_CONFIG) {
  const actions = [];

  try {
    // Navigation mistakes (5%)
    if (config.navigationMistakesEnabled && Math.random() < config.navigationMistakesChance) {
      const executed = await maybeGoBack(page, { chance: 1.0 });
      if (executed) actions.push("navigation_mistake");
    }

    // Tab simulation (10%)
    if (config.tabSimulationEnabled && Math.random() < config.tabSimulationChance) {
      const executed = await maybeSimulateTabSwitch(page, { chance: 1.0 });
      if (executed) actions.push("tab_switch");
    }

    // Blur simulation (15%)
    if (config.blurSimulationEnabled && Math.random() < config.blurSimulationChance) {
      const executed = await maybeSimulateBlur(page, { chance: 1.0 });
      if (executed) actions.push("blur");
    }

    // Image interaction (15%)
    if (config.imageInteractionEnabled && Math.random() < config.imageInteractionChance) {
      const result = await maybeInteractWithRandomImage(page, { chance: 1.0 });
      if (result.action) actions.push(`image_${result.action}`);
    }

  } catch (err) {
    log.debug("HUMAN", `Błąd background actions: ${err.message}`);
  }

  if (actions.length > 0) {
    log.debug("HUMAN", `Wykonano: ${actions.join(", ")}`);
  }

  return { actions };
}

/**
 * Human-like wpisywanie tekstu
 * @param {import('puppeteer').Page} page
 * @param {string} text
 * @param {object} config
 * @returns {Promise<void>}
 */
async function humanType(page, text, config = DEFAULT_CONFIG) {
  if (config.typingMistakesEnabled) {
    await humanTypeWithMistakes(page, text, {
      mistakeChance: config.typingMistakesChance,
      enabled: true,
    });
  } else {
    // Bez literówek, ale z ludzkimi opóźnieniami
    for (const char of text) {
      await page.keyboard.type(char);
      await humanDelay(120, 0.3);
    }
  }
}

/**
 * Pauza proporcjonalna do długości tekstu (symulacja czytania)
 * @param {number} contentLength - długość tekstu w znakach
 * @param {object} options
 * @returns {Promise<number>} - czas pauzy w ms
 */
async function readingPause(contentLength, options = {}) {
  const {
    wordsPerMinute = 200, // średnia szybkość czytania
    minPauseMs = 1000,
    maxPauseMs = 10000,
  } = options;

  // Szacuj liczbę słów (średnio 5 znaków na słowo)
  const estimatedWords = contentLength / 5;

  // Czas czytania w ms
  let readingTime = (estimatedWords / wordsPerMinute) * 60 * 1000;

  // Dodaj wariancję
  readingTime = gaussianRandom(readingTime, readingTime * 0.2);

  // Clamp
  const finalPause = Math.max(minPauseMs, Math.min(maxPauseMs, readingTime));

  await sleep(finalPause);
  return finalPause;
}

/**
 * Mały ruch myszy - symulacja "myślenia" lub sprawdzania czegoś
 * @param {import('puppeteer').Page} page
 * @returns {Promise<void>}
 */
async function mouseJiggle(page) {
  try {
    const viewport = page.viewport();
    if (!viewport) return;

    // Mały losowy ruch (20-50px)
    const currentX = viewport.width / 2;
    const currentY = viewport.height / 2;

    const offsetX = gaussianRandom(0, 20);
    const offsetY = gaussianRandom(0, 20);

    await page.mouse.move(currentX + offsetX, currentY + offsetY);
    await sleep(gaussianRandom(100, 30));
  } catch {
    // Ignoruj
  }
}

/**
 * Tworzy skonfigurowany obiekt human behavior
 * @param {object} overrides - nadpisania domyślnej konfiguracji
 * @returns {object}
 */
function createHumanBehavior(overrides = {}) {
  const config = { ...DEFAULT_CONFIG, ...overrides };

  return {
    config,
    preAction: (page, actionType) => preAction(page, actionType, config),
    postAction: (page, actionType) => postAction(page, actionType, config),
    humanized: (fn, page, actionType) => humanized(fn, page, actionType, config),
    humanClick: (page, element) => humanClick(page, element, config),
    humanNavigate: (page, url, options) => humanNavigate(page, url, { ...options, config }),
    betweenPostsPause: (page) => betweenPostsPause(page, config),
    executeRandomBackgroundActions: (page) => executeRandomBackgroundActions(page, config),
    humanType: (page, text) => humanType(page, text, config),
    readingPause,
    mouseJiggle,
    maybeVisitHomeFeed: (page, options) => maybeVisitHomeFeed(page, options),
    performMouseMovements: (page, count) => performMouseMovements(page, count),
  };
}

export {
  DEFAULT_CONFIG,
  preAction,
  postAction,
  humanized,
  humanClick,
  humanNavigate,
  betweenPostsPause,
  executeRandomBackgroundActions,
  humanType,
  readingPause,
  mouseJiggle,
  createHumanBehavior,
  maybeVisitHomeFeed,
  performMouseMovements,
};
