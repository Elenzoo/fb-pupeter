/**
 * Meta Ads Scanner - scraper biblioteki reklam
 */

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { log } from "../utils/logger.js";
import { METAADS_COUNTRY, METAADS_HEADLESS, HUMAN_MODE, PROXY_URL, REMOTE_DEBUG_PORT } from "../config.js";
import { extractAdsFromPage, extractPostUrlFromSnapshot } from "./extractor.js";
import { humanDelay } from "../utils/sleep.js";

// Włącz stealth
puppeteer.use(StealthPlugin());

// Błąd captcha
export class CaptchaRequiredError extends Error {
  constructor(message = "Captcha required") {
    super(message);
    this.name = "CAPTCHA_REQUIRED";
  }
}

/**
 * Retry z exponential backoff
 * @param {Function} fn - funkcja do wykonania
 * @param {Object} options - opcje
 * @returns {Promise<any>}
 */
async function retryWithBackoff(fn, { maxRetries = 3, initialDelay = 1000, label = "operation" } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Nie retry'uj captcha - to nie jest transient error
      if (err.name === "CAPTCHA_REQUIRED") {
        throw err;
      }

      if (attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        log.dev("METAADS", `${label} - próba ${attempt}/${maxRetries} nieudana, retry za ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  log.prod("METAADS", `${label} - wszystkie ${maxRetries} prób nieudane`);
  throw lastError;
}

/**
 * Sprawdza czy strona zawiera captcha
 * @param {Page} page
 * @returns {Promise<boolean>}
 */
async function detectCaptcha(page) {
  return page.evaluate(() => {
    // reCAPTCHA iframe
    if (document.querySelector('iframe[src*="recaptcha"]')) return true;
    if (document.querySelector('iframe[src*="captcha"]')) return true;

    // FB captcha testid
    if (document.querySelector('[data-testid="captcha"]')) return true;
    if (document.querySelector('[data-testid="checkpoint"]')) return true;

    // Tekst captcha
    const bodyText = document.body?.innerText?.toLowerCase() || "";
    if (bodyText.includes("security check") || bodyText.includes("prove you're not a robot")) {
      return true;
    }

    return false;
  });
}

/**
 * Buduje URL do biblioteki reklam Meta
 */
function buildAdLibraryUrl(keyword, country = "PL") {
  const params = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country: country,
    q: keyword,
    media_type: "all",
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

/**
 * Scrolluje stronę żeby załadować więcej reklam
 */
async function autoScroll(page, maxScrolls = 10) {
  let previousHeight = 0;
  let scrollCount = 0;

  while (scrollCount < maxScrolls) {
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);

    if (currentHeight === previousHeight) {
      // Brak nowych treści
      break;
    }

    previousHeight = currentHeight;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Czekaj na załadowanie
    await humanDelay(1500, 2500);
    scrollCount++;

    log.dev("METAADS", `Scroll ${scrollCount}/${maxScrolls}`);
  }
}

/**
 * Tworzy instancję przeglądarki
 */
async function createBrowser() {
  const headless = METAADS_HEADLESS ? "new" : false;
  log.prod("METAADS", `Uruchamiam przeglądarkę (headless: ${headless})`);

  const launchOptions = {
    headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--window-size=1920,1080",
    ],
  };

  // Proxy
  if (PROXY_URL) {
    launchOptions.args.push(`--proxy-server=${PROXY_URL}`);
    log.dev("METAADS", `Używam proxy`);
  }

  // Remote debug
  if (REMOTE_DEBUG_PORT) {
    launchOptions.args.push(`--remote-debugging-port=${REMOTE_DEBUG_PORT}`);
  }

  return puppeteer.launch(launchOptions);
}

/**
 * Skanuje bibliotekę reklam dla danego słowa kluczowego
 * @param {string} keyword - słowo kluczowe
 * @returns {Promise<Array>} - lista reklam
 */
export async function scanKeyword(keyword) {
  const url = buildAdLibraryUrl(keyword, METAADS_COUNTRY);
  log.dev("METAADS", `URL: ${url}`);

  const browser = await createBrowser();
  const page = await browser.newPage();

  try {
    // Ustaw viewport i user agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Nawiguj do biblioteki reklam z retry
    log.dev("METAADS", `Ładowanie strony...`);
    await retryWithBackoff(
      async () => {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
      },
      { label: "goto ad library" }
    );

    // Czekaj na załadowanie reklam
    await humanDelay(2000, 3000);

    // Debug: zrób screenshot
    const debugScreenshot = process.env.METAADS_DEBUG === "true";
    if (debugScreenshot) {
      try {
        await page.screenshot({ path: "data/metaads-debug-1-loaded.png", fullPage: true });
        log.prod("METAADS", "Screenshot zapisany: data/metaads-debug-1-loaded.png");
      } catch (e) {
        log.warn("METAADS", `Błąd screenshot: ${e.message}`);
      }
    }

    // Debug: pokaż aktualny URL
    log.dev("METAADS", `URL: ${page.url()}`);

    // Sprawdź captcha
    if (await detectCaptcha(page)) {
      log.warn("METAADS", `Wykryto captcha na stronie biblioteki reklam!`);
      throw new CaptchaRequiredError("Captcha detected on Ad Library page");
    }

    // Zamknij popup cookies jeśli jest
    try {
      const cookieButton = await page.$('button[data-cookiebanner="accept_button"]');
      if (cookieButton) {
        await cookieButton.click();
        await humanDelay(500, 1000);
      }
    } catch (e) {
      // Ignore
    }

    // Scrolluj żeby załadować więcej reklam
    await autoScroll(page, 5);

    // Debug: screenshot po scrollowaniu
    if (debugScreenshot) {
      try {
        await page.screenshot({ path: "data/metaads-debug-2-scrolled.png", fullPage: true });
        log.prod("METAADS", "Screenshot zapisany: data/metaads-debug-2-scrolled.png");
      } catch (e) {
        log.warn("METAADS", `Błąd screenshot: ${e.message}`);
      }
    }

    // Debug: sprawdź tytuł strony
    const pageTitle = await page.title();
    log.dev("METAADS", `Tytuł: ${pageTitle}`);

    // Debug: zapisz HTML do analizy
    if (debugScreenshot) {
      const fs = await import("node:fs");
      const html = await page.content();
      fs.writeFileSync("data/metaads-debug.html", html);
      log.prod("METAADS", "HTML zapisany: data/metaads-debug.html");

      // Sprawdź ile jest linków do snapshotów na różne sposoby
      const linkCounts = await page.evaluate(() => {
        return {
          snapshotLinks: document.querySelectorAll('a[href*="/ads/library/?id="]').length,
          allAdLibraryLinks: document.querySelectorAll('a[href*="ads/library"]').length,
          seeAdDetails: document.querySelectorAll('a[aria-label*="See ad details"]').length,
          allLinks: document.querySelectorAll('a').length,
        };
      });
      log.prod("METAADS", `Linki na stronie:`, linkCounts);
    }

    // Wyciągnij reklamy ze strony
    const ads = await extractAdsFromPage(page);
    log.prod("METAADS", `Wyekstrahowano ${ads.length} reklam`);

    // Dla każdej reklamy spróbuj wyciągnąć link do posta
    const adsWithPosts = [];
    for (const ad of ads) {
      if (ad.adSnapshotUrl) {
        try {
          log.dev("METAADS", `Sprawdzam snapshot: ${ad.adId}`);
          const postUrl = await retryWithBackoff(
            async () => extractPostUrlFromSnapshot(page, ad.adSnapshotUrl),
            { maxRetries: 2, label: `snapshot ${ad.adId}` }
          );
          ad.postUrl = postUrl;

          // Sprawdź captcha po nawigacji do snapshotu
          if (await detectCaptcha(page)) {
            log.warn("METAADS", `Wykryto captcha podczas sprawdzania snapshotu!`);
            throw new CaptchaRequiredError("Captcha detected on snapshot page");
          }
        } catch (err) {
          if (err.name === "CAPTCHA_REQUIRED") throw err;
          log.dev("METAADS", `Błąd sprawdzania snapshotu ${ad.adId}: ${err.message}`);
          ad.postUrl = null;
        }

        if (HUMAN_MODE) {
          await humanDelay(1000, 2000);
        }
      }
      adsWithPosts.push(ad);
    }

    return adsWithPosts;
  } finally {
    await browser.close();
  }
}
