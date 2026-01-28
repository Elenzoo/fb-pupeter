// src/lite/smoothScroll.js
// Płynne scrollowanie symulujące zachowanie człowieka

import { gaussianRandom, sleep } from "../utils/sleep.js";
import log from "../utils/logger.js";

/**
 * Easing function - ease-in-out (wolniej na start i koniec)
 * @param {number} t - progress 0-1
 * @returns {number}
 */
function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Easing function - ease-out (naturalny stop)
 * @param {number} t - progress 0-1
 * @returns {number}
 */
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Płynne scrollowanie o zadaną wartość
 * @param {import('puppeteer').Page} page
 * @param {number} amount - ilość pixeli (+ w dół, - w górę)
 * @param {object} options
 * @param {number} options.duration - czas trwania w ms (domyślnie 800-1500ms)
 * @param {number} options.steps - liczba kroków (więcej = płynniej)
 * @returns {Promise<void>}
 */
async function smoothScrollBy(page, amount, options = {}) {
  const {
    duration = Math.round(gaussianRandom(1100, 200)),
    steps = Math.max(20, Math.abs(Math.round(amount / 15))),
  } = options;

  const stepDelay = duration / steps;

  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    const easedProgress = easeInOutQuad(progress);
    const prevEased = easeInOutQuad((i - 1) / steps);

    const stepAmount = amount * (easedProgress - prevEased);

    await page.evaluate((delta) => {
      window.scrollBy(0, delta);
    }, stepAmount);

    // Losowe mikro-opóźnienie między krokami
    const delay = stepDelay + gaussianRandom(0, stepDelay * 0.2);
    await sleep(Math.max(5, delay));
  }
}

/**
 * Scrolluje do elementu z overshoot i korekcją (jak człowiek)
 * @param {import('puppeteer').Page} page
 * @param {string} selector - selektor elementu
 * @param {object} options
 * @returns {Promise<boolean>} - true jeśli sukces
 */
async function smoothScrollToElement(page, selector, options = {}) {
  const {
    overshoot = true,
    overshootAmount = gaussianRandom(100, 30),
  } = options;

  try {
    // Pobierz pozycję elementu
    const elementPosition = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;

      const rect = el.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

      return {
        top: rect.top + scrollTop,
        height: rect.height,
      };
    }, selector);

    if (!elementPosition) return false;

    // Aktualna pozycja scrolla
    const currentScroll = await page.evaluate(() => window.pageYOffset);

    // Cel - element w 1/3 viewportu
    const viewport = page.viewport();
    const viewportHeight = viewport ? viewport.height : 768;
    const targetScroll = elementPosition.top - viewportHeight / 3;

    let scrollAmount = targetScroll - currentScroll;

    // Overshoot - scrolluj trochę za daleko, potem wróć
    if (overshoot && Math.abs(scrollAmount) > 200) {
      // Scroll z overshoot
      const overshootDirection = scrollAmount > 0 ? 1 : -1;
      await smoothScrollBy(page, scrollAmount + overshootAmount * overshootDirection);

      // Pauza "orientacji"
      await sleep(gaussianRandom(200, 50));

      // Korekcja
      await smoothScrollBy(page, -overshootAmount * overshootDirection, {
        duration: 400,
        steps: 15,
      });
    } else {
      // Bez overshoot dla krótkich scrolli
      await smoothScrollBy(page, scrollAmount);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Sesja scrollowania tablicy (feed scroll)
 * Symuluje przeglądanie Facebooka
 * @param {import('puppeteer').Page} page
 * @param {number} durationMs - czas scrollowania
 * @param {object} options
 * @returns {Promise<void>}
 */
async function feedScrollSession(page, durationMs, options = {}) {
  const {
    onPostVisible = null, // callback gdy post jest widoczny
    pauseOnContentChance = 0.3, // szansa na pauzę przy interesującej treści
    pauseDurationMs = [2000, 5000], // zakres pauzy
  } = options;

  log.dev("SCROLL", `[FEED] Start sesji scrollowania: ${Math.round(durationMs / 1000)}s`);

  const startTime = Date.now();
  let scrollCount = 0;

  while (Date.now() - startTime < durationMs) {
    // Losowa ilość scrollowania (200-500px)
    const scrollAmount = Math.round(gaussianRandom(350, 80));

    await smoothScrollBy(page, scrollAmount);
    scrollCount++;

    // Pauza między scrollami (1-3s z naturalną wariancją)
    const pauseBase = gaussianRandom(2000, 500);
    await sleep(Math.max(800, Math.min(4000, pauseBase)));

    // Szansa na dłuższą pauzę (jakby czytał post)
    if (Math.random() < pauseOnContentChance) {
      const readingPause = gaussianRandom(
        (pauseDurationMs[0] + pauseDurationMs[1]) / 2,
        (pauseDurationMs[1] - pauseDurationMs[0]) / 4
      );
      await sleep(Math.max(pauseDurationMs[0], Math.min(pauseDurationMs[1], readingPause)));
    }

    // Czasem scroll w górę (jakby wrócił do czegoś)
    if (Math.random() < 0.08) {
      await sleep(gaussianRandom(500, 150));
      await smoothScrollBy(page, -Math.round(gaussianRandom(150, 50)));
      await sleep(gaussianRandom(1500, 400));
    }

    // Callback dla widocznych postów
    if (onPostVisible) {
      try {
        await onPostVisible(page, scrollCount);
      } catch {
        // Ignoruj błędy callbacka
      }
    }
  }
}

/**
 * Scroll do góry strony (płynnie)
 * @param {import('puppeteer').Page} page
 * @returns {Promise<void>}
 */
async function smoothScrollToTop(page) {
  const currentScroll = await page.evaluate(() => window.pageYOffset);

  if (currentScroll > 0) {
    await smoothScrollBy(page, -currentScroll, {
      duration: Math.min(2000, Math.max(500, currentScroll / 2)),
    });
  }
}

/**
 * Sprawdza czy element jest widoczny w viewport
 * @param {import('puppeteer').Page} page
 * @param {string} selector
 * @returns {Promise<boolean>}
 */
async function isElementInViewport(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;

    const rect = el.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }, selector);
}

export {
  easeInOutQuad,
  easeOutCubic,
  smoothScrollBy,
  smoothScrollToElement,
  feedScrollSession,
  smoothScrollToTop,
  isElementInViewport,
};
