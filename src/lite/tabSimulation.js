// src/lite/tabSimulation.js
// Symulacja przełączania kart przeglądarki

import { gaussianRandom, sleep } from "../utils/sleep.js";
import { smoothScrollBy } from "./smoothScroll.js";
import log from "../utils/logger.js";

/**
 * Symuluje przełączenie na inną kartę i powrót
 * Facebook śledzi visibility events - to je symuluje
 * @param {import('puppeteer').Page} page
 * @param {object} options
 * @returns {Promise<boolean>} - true jeśli wykonano
 */
async function maybeSimulateTabSwitch(page, options = {}) {
  const {
    chance = 0.10,
    enabled = true,
    minAwayTime = 30000,    // 30s
    maxAwayTime = 120000,   // 2 min
  } = options;

  if (!enabled || Math.random() > chance) return false;

  try {
    log.prod("LITE", "[TAB] Symulacja przełączenia karty...");

    // Symuluj "odejście" od FB - trigger visibility change
    await page.evaluate(() => {
      // Nadpisz document.hidden na true
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });

      // Dispatch event
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // "Przebywaj" na innej karcie
    const awayTime = gaussianRandom(
      (minAwayTime + maxAwayTime) / 2,
      (maxAwayTime - minAwayTime) / 4
    );
    const clampedAwayTime = Math.max(minAwayTime, Math.min(maxAwayTime, awayTime));

    log.prod("LITE", `[TAB] Symulacja - nieobecność: ${Math.round(clampedAwayTime / 1000)}s`);
    await sleep(clampedAwayTime);

    // Wróć na kartę FB
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });

      document.dispatchEvent(new Event("visibilitychange"));

      // Też focus event
      window.dispatchEvent(new Event("focus"));
    });

    // Mały scroll po powrocie (jakby "przypomniał sobie gdzie był")
    await sleep(gaussianRandom(500, 150));
    const smallScroll = gaussianRandom(0, 80);
    if (Math.abs(smallScroll) > 30) {
      await smoothScrollBy(page, smallScroll, { duration: 300 });
    }

    log.debug("TAB_SIM", "Powrót na kartę FB");
    return true;
  } catch (err) {
    log.debug("TAB_SIM", `Błąd: ${err.message}`);
    return false;
  }
}

/**
 * Symuluje krótką nieuwagę (blur bez zmiany karty)
 * Np. ktoś odwrócił się od ekranu
 * @param {import('puppeteer').Page} page
 * @param {object} options
 * @returns {Promise<boolean>}
 */
async function maybeSimulateBlur(page, options = {}) {
  const {
    chance = 0.15,
    enabled = true,
    minDuration = 5000,
    maxDuration = 20000,
  } = options;

  if (!enabled || Math.random() > chance) return false;

  try {
    // Blur event (jakby okno straciło focus)
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
    });

    const blurDuration = gaussianRandom(
      (minDuration + maxDuration) / 2,
      (maxDuration - minDuration) / 4
    );
    await sleep(Math.max(minDuration, Math.min(maxDuration, blurDuration)));

    // Focus event (powrót)
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Symuluje okresowe "odchodzenie" od komputera
 * Wywołuj w głównej pętli
 * @param {import('puppeteer').Page} page
 * @param {object} options
 * @returns {Promise<{type: string | null, duration: number}>}
 */
async function simulateAttentionBreak(page, options = {}) {
  const {
    tabSwitchEnabled = true,
    tabSwitchChance = 0.10,
    blurEnabled = true,
    blurChance = 0.15,
  } = options;

  // Najpierw sprawdź tab switch (dłuższe)
  if (tabSwitchEnabled && Math.random() < tabSwitchChance) {
    const startTime = Date.now();
    const executed = await maybeSimulateTabSwitch(page, { chance: 1.0, enabled: true });
    if (executed) {
      return { type: "tab_switch", duration: Date.now() - startTime };
    }
  }

  // Potem blur (krótsze)
  if (blurEnabled && Math.random() < blurChance) {
    const startTime = Date.now();
    const executed = await maybeSimulateBlur(page, { chance: 1.0, enabled: true });
    if (executed) {
      return { type: "blur", duration: Date.now() - startTime };
    }
  }

  return { type: null, duration: 0 };
}

export {
  maybeSimulateTabSwitch,
  maybeSimulateBlur,
  simulateAttentionBreak,
};
