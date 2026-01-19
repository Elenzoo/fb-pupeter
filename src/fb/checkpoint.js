// src/fb/checkpoint.js
import log from "../utils/logger.js";

/**
 * Wykrywanie i obsługa checkpointów/2FA Facebooka
 */

// URL patterns wskazujące na checkpoint/2FA
const CHECKPOINT_URL_PATTERNS = [
  "/checkpoint/",
  "/two_factor/",
  "/login/identify",
  "/recover/initiate",
  "/login/device-based/",
  "/checkpoint/block/",
  "/checkpoint/601/",
];

// DOM selektory wskazujące na checkpoint/2FA
const CHECKPOINT_DOM_SELECTORS = [
  // 2FA
  'input[name="approvals_code"]',
  'input[autocomplete="one-time-code"]',
  'form[id*="two_factor"]',
  // Checkpoint
  '[data-testid="checkpoint_container"]',
  'form[action*="checkpoint"]',
  // Weryfikacja konta
  'input[name="captcha_response"]',
  '[role="dialog"][aria-label*="weryfikacja"]',
  '[role="dialog"][aria-label*="verification"]',
  // Podejrzana aktywność
  'div[data-testid="login_challenge"]',
];

// Teksty wskazujące na checkpoint (polskie i angielskie)
const CHECKPOINT_TEXT_PATTERNS = [
  "wprowadź kod",
  "enter code",
  "two-factor",
  "dwuetapow",
  "weryfikacja",
  "verification required",
  "suspicious activity",
  "podejrzana aktywność",
  "confirm your identity",
  "potwierdź swoją tożsamość",
  "potwierdź, że to ty",
  "we need to confirm",
  "security check",
  "sprawdzenie zabezpieczeń",
  "account verification",
  "weryfikacja konta",
  "enter the code",
  "wpisz kod",
  "approve your login",
  "zatwierdź logowanie",
];

/**
 * Sprawdza czy URL wskazuje na checkpoint
 */
function isCheckpointUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return CHECKPOINT_URL_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Sprawdza czy strona zawiera elementy checkpoint/2FA
 */
async function hasCheckpointElements(page) {
  try {
    const result = await page.evaluate((selectors) => {
      for (const sel of selectors) {
        if (document.querySelector(sel)) return true;
      }
      return false;
    }, CHECKPOINT_DOM_SELECTORS);
    return result;
  } catch {
    return false;
  }
}

/**
 * Sprawdza czy strona zawiera tekst wskazujący na checkpoint
 */
async function hasCheckpointText(page) {
  try {
    const result = await page.evaluate((patterns) => {
      const bodyText = (document.body?.innerText || "").toLowerCase();
      return patterns.some((p) => bodyText.includes(p.toLowerCase()));
    }, CHECKPOINT_TEXT_PATTERNS);
    return result;
  } catch {
    return false;
  }
}

/**
 * Główna funkcja wykrywania checkpoint
 * @param {Page} page - Puppeteer page
 * @returns {Promise<boolean>} - true jeśli wykryto checkpoint
 */
async function isCheckpoint(page) {
  try {
    const url = page.url();

    // 1. Sprawdź URL
    if (isCheckpointUrl(url)) {
      log.dev("CHECKPOINT", `Wykryto checkpoint w URL: ${url}`);
      return true;
    }

    // 2. Sprawdź elementy DOM
    const hasElements = await hasCheckpointElements(page);
    if (hasElements) {
      log.dev("CHECKPOINT", "Wykryto elementy checkpoint w DOM");
      return true;
    }

    // 3. Sprawdź tekst strony (tylko jeśli nie jesteśmy zalogowani)
    // Unikamy false positive na normalnych stronach
    const hasText = await hasCheckpointText(page);
    if (hasText) {
      // Dodatkowa weryfikacja - czy to nie normalna strona FB?
      const isNormalPage = await page.evaluate(() => {
        // Szukamy elementów normalnej strony FB
        const hasNewsFeed = !!document.querySelector('[role="feed"]');
        const hasSearch = !!document.querySelector('input[aria-label*="Szukaj"], input[placeholder*="Szukaj"]');
        return hasNewsFeed || hasSearch;
      });

      if (!isNormalPage) {
        log.dev("CHECKPOINT", "Wykryto tekst checkpoint na stronie");
        return true;
      }
    }

    return false;
  } catch (err) {
    log.debug("CHECKPOINT", `Błąd detekcji: ${err?.message}`);
    return false;
  }
}

/**
 * Określa typ checkpoint
 * @param {Page} page - Puppeteer page
 * @returns {Promise<string>} - typ checkpoint
 */
async function getCheckpointType(page) {
  try {
    const url = page.url();

    if (url.includes("/two_factor/")) return "2FA";
    if (url.includes("/checkpoint/block/")) return "BLOCKED";
    if (url.includes("/checkpoint/")) return "CHECKPOINT";
    if (url.includes("/login/identify")) return "IDENTIFY";
    if (url.includes("/recover/")) return "RECOVERY";

    const has2faInput = await page
      .evaluate(() => {
        return !!(
          document.querySelector('input[name="approvals_code"]') ||
          document.querySelector('input[autocomplete="one-time-code"]')
        );
      })
      .catch(() => false);

    if (has2faInput) return "2FA";

    return "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

export { isCheckpoint, getCheckpointType, isCheckpointUrl };
