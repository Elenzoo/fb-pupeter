/**
 * Funkcje pomocnicze dla modułu Marketplace
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { MARKETPLACE_DATA_PATH } from "../config.js";

/**
 * Opóźnienie z losowym czasem (human-like)
 * @param {number} minMs - minimum w ms
 * @param {number} maxMs - maximum w ms
 * @returns {Promise<void>}
 */
export async function humanDelay(minMs = 500, maxMs = 2000) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Krótkie opóźnienie między akcjami
 */
export async function shortDelay() {
  return humanDelay(300, 800);
}

/**
 * Średnie opóźnienie (np. między polami formularza)
 */
export async function mediumDelay() {
  return humanDelay(800, 2000);
}

/**
 * Długie opóźnienie (np. po załadowaniu strony)
 */
export async function longDelay() {
  return humanDelay(2000, 5000);
}

/**
 * Losowy element z tablicy
 * @param {Array} arr - tablica
 * @returns {*} losowy element
 */
export function randomFromArray(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Losowa cena z zakresu (zaokrąglona do 50 lub 100)
 * @param {number} min - minimum
 * @param {number} max - maximum
 * @param {number} roundTo - zaokrąglenie (domyślnie 50)
 * @returns {number}
 */
export function randomPrice(min, max, roundTo = 50) {
  const raw = Math.floor(Math.random() * (max - min + 1)) + min;
  return Math.round(raw / roundTo) * roundTo;
}

/**
 * Generuj unikalny identyfikator ogłoszenia
 * @param {string} prefix - prefix (np. "pub" lub "ren")
 * @returns {string}
 */
export function generateId(prefix = "pub") {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString("hex");
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Formatuj datę do ISO string
 * @param {Date} date - data
 * @returns {string}
 */
export function formatDate(date = new Date()) {
  return date.toISOString();
}

/**
 * Oblicz datę następnego wznowienia
 * @param {number} days - liczba dni
 * @returns {string} ISO string
 */
export function getNextRenewalDate(days = 7) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

/**
 * Sprawdź czy data wymaga wznowienia
 * @param {string} nextRenewalDue - ISO string daty wznowienia
 * @returns {boolean}
 */
export function needsRenewal(nextRenewalDue) {
  if (!nextRenewalDue) return false;
  const dueDate = new Date(nextRenewalDue);
  const now = new Date();
  return now >= dueDate;
}

/**
 * Bezpieczny odczyt pliku JSON
 * @param {string} filePath - ścieżka do pliku
 * @param {*} defaultValue - wartość domyślna
 * @returns {*}
 */
export function readJsonFile(filePath, defaultValue = null) {
  try {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);

    if (!fs.existsSync(fullPath)) {
      return defaultValue;
    }

    const content = fs.readFileSync(fullPath, "utf8");
    return JSON.parse(content);
  } catch (err) {
    console.error(`[MARKETPLACE] Błąd odczytu ${filePath}:`, err.message);
    return defaultValue;
  }
}

/**
 * Bezpieczny zapis pliku JSON (atomic write)
 * @param {string} filePath - ścieżka do pliku
 * @param {*} data - dane do zapisania
 * @returns {boolean}
 */
export function writeJsonFile(filePath, data) {
  try {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Atomic write
    const tmpPath = `${fullPath}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmpPath, fullPath);

    return true;
  } catch (err) {
    console.error(`[MARKETPLACE] Błąd zapisu ${filePath}:`, err.message);
    return false;
  }
}

/**
 * Pobierz ścieżkę do pliku danych marketplace
 * @param {string} filename - nazwa pliku
 * @returns {string}
 */
export function getDataPath(filename) {
  return path.join(process.cwd(), MARKETPLACE_DATA_PATH, filename);
}

/**
 * Pobierz ścieżkę do zdjęcia
 * @param {string} imageName - nazwa pliku zdjęcia
 * @returns {string}
 */
export function getImagePath(imageName) {
  return path.join(process.cwd(), MARKETPLACE_DATA_PATH, "images", imageName);
}

/**
 * Sprawdź czy zdjęcie istnieje
 * @param {string} imageName - nazwa pliku zdjęcia
 * @returns {boolean}
 */
export function imageExists(imageName) {
  const imagePath = getImagePath(imageName);
  return fs.existsSync(imagePath);
}

/**
 * Losowe tasowanie tablicy (Fisher-Yates)
 * @param {Array} arr - tablica
 * @returns {Array} nowa potasowana tablica
 */
export function shuffleArray(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Symulacja ludzkiego wpisywania tekstu
 * @param {object} page - Puppeteer page
 * @param {string} selector - selektor pola
 * @param {string} text - tekst do wpisania
 */
export async function humanType(page, selector, text) {
  await page.click(selector);
  await shortDelay();

  for (const char of text) {
    await page.type(selector, char, { delay: 50 + Math.random() * 100 });

    // Czasami dłuższa pauza (symulacja myślenia)
    if (Math.random() < 0.05) {
      await humanDelay(200, 500);
    }
  }
}

/**
 * Bezpieczne kliknięcie z retry
 * @param {object} page - Puppeteer page
 * @param {string} selector - selektor
 * @param {number} maxRetries - max prób
 * @returns {boolean}
 */
export async function safeClick(page, selector, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      await humanDelay(200, 500);
      await page.click(selector);
      return true;
    } catch (err) {
      if (i === maxRetries - 1) {
        console.error(`[MARKETPLACE] Nie można kliknąć ${selector}:`, err.message);
        return false;
      }
      await humanDelay(1000, 2000);
    }
  }
  return false;
}

/**
 * Czekaj na element z wieloma selektorami (pierwszy znaleziony)
 * @param {object} page - Puppeteer page
 * @param {string[]} selectors - lista selektorów
 * @param {number} timeout - timeout w ms
 * @returns {string|null} selektor który zadziałał lub null
 */
export async function waitForAnySelector(page, selectors, timeout = 10000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          return selector;
        }
      } catch (e) {
        // Ignoruj błędy
      }
    }
    await humanDelay(200, 300);
  }

  return null;
}

/**
 * Zrób screenshot z timestampem
 * @param {object} page - Puppeteer page
 * @param {string} name - nazwa pliku
 * @returns {string} ścieżka do screenshota
 */
export async function takeScreenshot(page, name = "screenshot") {
  const timestamp = Date.now();
  const filename = `${name}_${timestamp}.png`;
  const screenshotPath = path.join(process.cwd(), "tmp", filename);

  // Upewnij się że folder istnieje
  const dir = path.dirname(screenshotPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await page.screenshot({ path: screenshotPath, fullPage: false });
  return screenshotPath;
}

/**
 * Sprawdź czy jesteśmy na stronie logowania/checkpoint
 * @param {object} page - Puppeteer page
 * @returns {boolean}
 */
export async function isOnLoginOrCheckpoint(page) {
  const url = page.url();

  // Strona logowania
  if (url.includes("/login") || url.includes("login.php")) {
    return true;
  }

  // Checkpoint
  if (url.includes("/checkpoint") || url.includes("checkpoint")) {
    return true;
  }

  // Sprawdź też content strony
  try {
    const checkpointIndicators = await page.$('[data-testid="royal_login_form"], [id="checkpointSubmitButton"]');
    if (checkpointIndicators) {
      return true;
    }
  } catch (e) {
    // Ignoruj
  }

  return false;
}

/**
 * Formatuj liczbę jako walutę PLN
 * @param {number} amount - kwota
 * @returns {string}
 */
export function formatCurrency(amount) {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export default {
  humanDelay,
  shortDelay,
  mediumDelay,
  longDelay,
  randomFromArray,
  randomPrice,
  generateId,
  formatDate,
  getNextRenewalDate,
  needsRenewal,
  readJsonFile,
  writeJsonFile,
  getDataPath,
  getImagePath,
  imageExists,
  shuffleArray,
  humanType,
  safeClick,
  waitForAnySelector,
  takeScreenshot,
  isOnLoginOrCheckpoint,
  formatCurrency,
};
