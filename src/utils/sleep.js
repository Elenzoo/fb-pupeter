// src/utils/sleep.js
// Human Behavior Mode - opóźnienia symulujące człowieka

/**
 * Podstawowy sleep
 */
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Sleep z losowym opóźnieniem (jednolity rozkład)
 */
function sleepRandom(minMs, maxMs) {
  const delta = maxMs - minMs;
  const extra = Math.random() * delta;
  return sleep(minMs + extra);
}

/**
 * Generuje losową wartość z rozkładu normalnego (Gaussa)
 * Box-Muller transform
 * @param {number} mean - średnia
 * @param {number} stdDev - odchylenie standardowe
 * @returns {number}
 */
function gaussianRandom(mean, stdDev) {
  let u1, u2;
  do {
    u1 = Math.random();
    u2 = Math.random();
  } while (u1 === 0); // u1 nie może być 0

  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z * stdDev;
}

/**
 * Ludzkie opóźnienie z rozkładem Gaussa
 * @param {number} baseMs - bazowe opóźnienie (średnia)
 * @param {number} variance - wariancja jako procent (0.0-1.0)
 * @returns {Promise<void>}
 */
async function humanDelay(baseMs, variance = 0.3) {
  const stdDev = baseMs * variance;
  let delay = gaussianRandom(baseMs, stdDev);

  // Clamp do rozsądnych wartości (50% - 200% średniej)
  delay = Math.max(baseMs * 0.5, Math.min(baseMs * 2, delay));

  return sleep(delay);
}

/**
 * Opóźnienie przy pisaniu - symuluje ludzką szybkość
 * Średnio ~120ms na znak, z mikro-pauzami
 * @returns {Promise<number>} - zwraca użyte opóźnienie w ms
 */
async function humanTypingDelay() {
  // Rozkład: średnia 120ms, stdDev 40ms
  let delay = gaussianRandom(120, 40);

  // Clamp: 60-250ms na znak
  delay = Math.max(60, Math.min(250, delay));

  // 5% szansa na mikro-pauzę (jakby człowiek myślał)
  if (Math.random() < 0.05) {
    delay += gaussianRandom(300, 100);
  }

  await sleep(delay);
  return delay;
}

/**
 * Pauza między postami - 3-8 sekund z rozkładem Gaussa
 * @returns {Promise<number>} - zwraca użyte opóźnienie w ms
 */
async function betweenPostsPause() {
  // Średnia 5.5s, stdDev 1.2s → większość w zakresie 3-8s
  let delay = gaussianRandom(5500, 1200);

  // Clamp: 3-10 sekund
  delay = Math.max(3000, Math.min(10000, delay));

  await sleep(delay);
  return delay;
}

/**
 * Wpisuje tekst znak po znaku z ludzkimi opóźnieniami
 * @param {import('puppeteer').ElementHandle} element - input element
 * @param {string} text - tekst do wpisania
 * @param {import('puppeteer').Page} page - strona (do keyboard)
 * @returns {Promise<void>}
 */
async function humanType(element, text, page) {
  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Wpisz znak
    await page.keyboard.type(char);

    // Opóźnienie między znakami
    await humanTypingDelay();
  }
}

/**
 * Fisher-Yates shuffle - randomizacja tablicy
 * @param {Array} array - tablica do pomieszania
 * @returns {Array} - nowa, pomieszana tablica
 */
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export {
  sleep,
  sleepRandom,
  gaussianRandom,
  humanDelay,
  humanTypingDelay,
  betweenPostsPause,
  humanType,
  shuffleArray,
};
