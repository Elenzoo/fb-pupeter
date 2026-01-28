// src/lite/antiDetection.js
// Anti-Detection Layer - viewport, session management, activity patterns

import { gaussianRandom } from "../utils/sleep.js";

/**
 * Popularne rozdzielczości ekranów
 * Losowany przy każdej sesji dla fingerprint variety
 */
const VIEWPORTS = [
  { width: 1366, height: 768 },  // najpopularniejsza laptop
  { width: 1920, height: 1080 }, // full HD
  { width: 1440, height: 900 },  // MacBook
  { width: 1536, height: 864 },  // popularna Windows
  { width: 1280, height: 720 },  // HD
  { width: 1600, height: 900 },  // 16:9 laptop
  { width: 1680, height: 1050 }, // 16:10
];

/**
 * Losowa rozdzielczość viewportu
 * @returns {{width: number, height: number}}
 */
function getRandomViewport() {
  const index = Math.floor(Math.random() * VIEWPORTS.length);
  const base = VIEWPORTS[index];

  // Dodaj małą losowość (+/- 10px) żeby nie było dokładnie tych samych wartości
  return {
    width: base.width + Math.floor(gaussianRandom(0, 5)),
    height: base.height + Math.floor(gaussianRandom(0, 5)),
  };
}

/**
 * Losowa długość sesji (30-90 min z rozkładem Gaussa)
 * @param {number} minMs - minimum w ms (domyślnie 30 min)
 * @param {number} maxMs - maksimum w ms (domyślnie 90 min)
 * @returns {number} - długość sesji w ms
 */
function getRandomSessionLength(minMs = 30 * 60 * 1000, maxMs = 90 * 60 * 1000) {
  const mean = (minMs + maxMs) / 2;
  const stdDev = (maxMs - minMs) / 4; // 95% wartości w zakresie

  let length = gaussianRandom(mean, stdDev);

  // Clamp do zakresu
  return Math.max(minMs, Math.min(maxMs, length));
}

/**
 * Mnożnik aktywności w zależności od pory dnia
 * Symuluje naturalne wzorce użycia - rano wolniej, wieczorem aktywniej
 * @param {number} hour - godzina (0-23)
 * @returns {number} - mnożnik (0.3 - 1.2)
 */
function getActivityMultiplier(hour) {
  if (hour === undefined) {
    hour = new Date().getHours();
  }

  // Wczesny poranek (5-7): powolne budzenie
  if (hour >= 5 && hour < 7) return 0.5;

  // Poranek (7-9): normalne tempo
  if (hour >= 7 && hour < 9) return 0.7;

  // Dzień roboczy (9-17): stabilna aktywność
  if (hour >= 9 && hour < 17) return 1.0;

  // Popołudnie (17-19): więcej czasu
  if (hour >= 17 && hour < 19) return 1.1;

  // Wieczór (19-22): szczyt aktywności
  if (hour >= 19 && hour < 22) return 1.2;

  // Noc (22-5): minimalna aktywność (jeśli night mode wyłączony)
  return 0.3;
}

/**
 * Oblicza opóźnienie z uwzględnieniem pory dnia
 * @param {number} baseDelayMs - bazowe opóźnienie
 * @returns {number} - dostosowane opóźnienie
 */
function getAdaptiveDelay(baseDelayMs) {
  const multiplier = getActivityMultiplier();

  // Odwrotność - wyższy multiplier = krótsze opóźnienie
  return Math.round(baseDelayMs / multiplier);
}

/**
 * Losowy czas przerwy między cyklami
 * Bazowo CHECK_INTERVAL_MS, ale z naturalną wariancją
 * @param {number} baseIntervalMs - bazowy interwał
 * @returns {number} - dostosowany interwał w ms
 */
function getRandomizedInterval(baseIntervalMs) {
  // 80-120% bazowego interwału z rozkładem Gaussa
  const variance = baseIntervalMs * 0.2;
  let interval = gaussianRandom(baseIntervalMs, variance / 2);

  // Clamp do rozsądnych wartości
  return Math.max(baseIntervalMs * 0.7, Math.min(baseIntervalMs * 1.5, interval));
}

/**
 * Sprawdza czy sesja powinna się zakończyć
 * @param {number} sessionStartTime - timestamp rozpoczęcia sesji
 * @param {number} maxSessionLength - max długość sesji w ms
 * @returns {boolean}
 */
function shouldEndSession(sessionStartTime, maxSessionLength) {
  return Date.now() - sessionStartTime > maxSessionLength;
}

/**
 * User-Agent strings dla różnych przeglądarek
 * Losowany przy starcie sesji
 */
const USER_AGENTS = [
  // Chrome Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  // Chrome Mac
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  // Firefox Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  // Edge
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
];

/**
 * Losowy User-Agent
 * @returns {string}
 */
function getRandomUserAgent() {
  const index = Math.floor(Math.random() * USER_AGENTS.length);
  return USER_AGENTS[index];
}

/**
 * Generuje losowy fingerprint sesji
 * @returns {{viewport: {width: number, height: number}, userAgent: string, sessionLength: number}}
 */
function generateSessionFingerprint(options = {}) {
  const {
    sessionMinMs = 30 * 60 * 1000,
    sessionMaxMs = 90 * 60 * 1000,
  } = options;

  return {
    viewport: getRandomViewport(),
    userAgent: getRandomUserAgent(),
    sessionLength: getRandomSessionLength(sessionMinMs, sessionMaxMs),
    startTime: Date.now(),
  };
}

export {
  VIEWPORTS,
  getRandomViewport,
  getRandomSessionLength,
  getActivityMultiplier,
  getAdaptiveDelay,
  getRandomizedInterval,
  shouldEndSession,
  USER_AGENTS,
  getRandomUserAgent,
  generateSessionFingerprint,
};
