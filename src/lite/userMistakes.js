// src/lite/userMistakes.js
// Symulacja błędów użytkownika - literówki, nawigacja, scroll

import { gaussianRandom, sleep, humanTypingDelay } from "../utils/sleep.js";
import { smoothScrollBy } from "./smoothScroll.js";

/**
 * Losowa litera z klawiatury (dla literówek)
 * Wybiera literę blisko na klawiaturze
 * @param {string} intended - zamierzona litera
 * @returns {string}
 */
function getTypoChar(intended) {
  const keyboard = {
    q: ["w", "a", "s"],
    w: ["q", "e", "a", "s", "d"],
    e: ["w", "r", "s", "d", "f"],
    r: ["e", "t", "d", "f", "g"],
    t: ["r", "y", "f", "g", "h"],
    y: ["t", "u", "g", "h", "j"],
    u: ["y", "i", "h", "j", "k"],
    i: ["u", "o", "j", "k", "l"],
    o: ["i", "p", "k", "l"],
    p: ["o", "l"],
    a: ["q", "w", "s", "z", "x"],
    s: ["q", "w", "e", "a", "d", "z", "x", "c"],
    d: ["w", "e", "r", "s", "f", "x", "c", "v"],
    f: ["e", "r", "t", "d", "g", "c", "v", "b"],
    g: ["r", "t", "y", "f", "h", "v", "b", "n"],
    h: ["t", "y", "u", "g", "j", "b", "n", "m"],
    j: ["y", "u", "i", "h", "k", "n", "m"],
    k: ["u", "i", "o", "j", "l", "m"],
    l: ["i", "o", "p", "k"],
    z: ["a", "s", "x"],
    x: ["z", "s", "d", "c"],
    c: ["x", "d", "f", "v"],
    v: ["c", "f", "g", "b"],
    b: ["v", "g", "h", "n"],
    n: ["b", "h", "j", "m"],
    m: ["n", "j", "k"],
  };

  const lower = intended.toLowerCase();
  const neighbors = keyboard[lower];

  if (neighbors && neighbors.length > 0) {
    const typo = neighbors[Math.floor(Math.random() * neighbors.length)];
    return intended === intended.toUpperCase() ? typo.toUpperCase() : typo;
  }

  // Fallback - losowa litera
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  return alphabet[Math.floor(Math.random() * alphabet.length)];
}

/**
 * Wpisuje tekst z symulacją literówek (3% szans na błąd)
 * @param {import('puppeteer').Page} page
 * @param {string} text - tekst do wpisania
 * @param {object} options
 * @param {number} options.mistakeChance - szansa na literówkę (0-1)
 * @param {boolean} options.enabled - czy włączone
 * @returns {Promise<void>}
 */
async function humanTypeWithMistakes(page, text, options = {}) {
  const {
    mistakeChance = 0.03,
    enabled = true,
  } = options;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Szansa na literówkę (tylko dla liter)
    if (enabled && /[a-zA-Z]/.test(char) && Math.random() < mistakeChance) {
      // Wpisz złą literę
      const typoChar = getTypoChar(char);
      await page.keyboard.type(typoChar);
      await humanTypingDelay();

      // Pauza "zauważenia błędu" (200-600ms)
      await sleep(gaussianRandom(400, 100));

      // Backspace
      await page.keyboard.press("Backspace");
      await sleep(gaussianRandom(150, 50));

      // Wpisz poprawną literę
      await page.keyboard.type(char);
      await humanTypingDelay();
    } else {
      // Normalne wpisanie
      await page.keyboard.type(char);
      await humanTypingDelay();
    }
  }
}

/**
 * Może cofnąć się (goBack) i wrócić (goForward) - 5% szans
 * Symuluje przypadkowe kliknięcie "wstecz"
 * @param {import('puppeteer').Page} page
 * @param {object} options
 * @returns {Promise<boolean>} - true jeśli wykonano
 */
async function maybeGoBack(page, options = {}) {
  const { chance = 0.05, enabled = true } = options;

  if (!enabled || Math.random() > chance) return false;

  try {
    // Cofnij
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 });

    // Pauza "zorientowania się" (1-3s)
    await sleep(gaussianRandom(2000, 500));

    // Wróć do przodu
    await page.goForward({ waitUntil: "domcontentloaded", timeout: 10000 });

    // Pauza po powrocie
    await sleep(gaussianRandom(500, 150));

    return true;
  } catch {
    // Może nie było historii - ignoruj
    return false;
  }
}

/**
 * Może scrollnąć w złą stronę i poprawić - 8% szans
 * @param {import('puppeteer').Page} page
 * @param {object} options
 * @returns {Promise<boolean>} - true jeśli wykonano
 */
async function maybeScrollWrongDirection(page, options = {}) {
  const { chance = 0.08, enabled = true } = options;

  if (!enabled || Math.random() > chance) return false;

  try {
    // Scroll w górę (jakby za mocno scrollnął)
    const wrongAmount = -Math.round(gaussianRandom(200, 50));
    await smoothScrollBy(page, wrongAmount, { duration: 400 });

    // Pauza "zorientowania"
    await sleep(gaussianRandom(800, 200));

    // Poprawka - scroll w dół (więcej niż wrócił)
    const correctAmount = Math.round(gaussianRandom(300, 70));
    await smoothScrollBy(page, correctAmount, { duration: 600 });

    return true;
  } catch {
    return false;
  }
}

/**
 * Może przypadkowo kliknąć obok elementu i poprawić
 * @param {import('puppeteer').Page} page
 * @param {import('puppeteer').ElementHandle} element
 * @param {object} options
 * @returns {Promise<boolean>} - true jeśli wykonano misclick
 */
async function maybeMisclick(page, element, options = {}) {
  const { chance = 0.02, enabled = true } = options;

  if (!enabled || Math.random() > chance) return false;

  try {
    const box = await element.boundingBox();
    if (!box) return false;

    // Kliknij trochę obok (10-30px)
    const offsetX = gaussianRandom(20, 5) * (Math.random() > 0.5 ? 1 : -1);
    const offsetY = gaussianRandom(20, 5) * (Math.random() > 0.5 ? 1 : -1);

    await page.mouse.click(
      box.x + box.width / 2 + offsetX,
      box.y + box.height / 2 + offsetY
    );

    // Pauza
    await sleep(gaussianRandom(300, 100));

    return true;
  } catch {
    return false;
  }
}

/**
 * Wykonuje losowe "błędy" użytkownika
 * Wywołuj okresowo podczas sesji
 * @param {import('puppeteer').Page} page
 * @param {object} options
 * @returns {Promise<{executed: string[]}>}
 */
async function executeRandomMistakes(page, options = {}) {
  const {
    navigationMistakesEnabled = true,
    scrollMistakesEnabled = true,
  } = options;

  const executed = [];

  if (navigationMistakesEnabled && await maybeGoBack(page)) {
    executed.push("goBack");
  }

  if (scrollMistakesEnabled && await maybeScrollWrongDirection(page)) {
    executed.push("scrollWrongDirection");
  }

  return { executed };
}

export {
  getTypoChar,
  humanTypeWithMistakes,
  maybeGoBack,
  maybeScrollWrongDirection,
  maybeMisclick,
  executeRandomMistakes,
};
