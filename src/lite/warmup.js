// src/lite/warmup.js
// Sesja rozgrzewkowa - naturalna aktywność przed monitorowaniem

import { gaussianRandom, sleep } from "../utils/sleep.js";
import { feedScrollSession, smoothScrollBy } from "./smoothScroll.js";
import { randomMouseMovement } from "../utils/mouse.js";
import log from "../utils/logger.js";

/**
 * Sesja rozgrzewkowa przed monitorowaniem
 * Buduje "normalną" historię aktywności
 * @param {import('puppeteer').Page} page
 * @param {number} durationMs - czas warmup (5-10 min)
 * @param {object} options
 * @returns {Promise<{actions: string[], duration: number}>}
 */
async function warmupSession(page, durationMs, options = {}) {
  const {
    scrollFeedEnabled = true,
    visitProfileEnabled = true,
    viewPhotosEnabled = true,
    likeChance = 0.1,
  } = options;

  const startTime = Date.now();
  const actions = [];

  log.prod("LITE", `[WARMUP] Rozpoczynam sesję warmup (${Math.round(durationMs / 1000)}s)`);

  try {
    // 1. Nawiguj na feed główny (jeśli nie jesteśmy)
    const currentUrl = page.url();
    if (!currentUrl.includes("facebook.com") || currentUrl.includes("/login")) {
      await page.goto("https://www.facebook.com/", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await sleep(gaussianRandom(2000, 500));
      actions.push("navigated_to_feed");
    }

    // 2. Scroll feed (40-50% czasu)
    if (scrollFeedEnabled) {
      const scrollDuration = durationMs * gaussianRandom(0.45, 0.05);
      log.debug("WARMUP", `Scrollowanie feed przez ${Math.round(scrollDuration / 1000)}s`);

      await feedScrollSession(page, scrollDuration, {
        pauseOnContentChance: 0.35,
        pauseDurationMs: [2000, 6000],
      });
      actions.push("feed_scroll");
    }

    // Sprawdź czy mamy jeszcze czas
    const elapsed = Date.now() - startTime;
    const remaining = durationMs - elapsed;

    if (remaining < 30000) {
      log.dev("WARMUP", `Warmup zakończony (${actions.length} akcji)`);
      return { actions, duration: elapsed };
    }

    // 3. Może odwiedź losowy profil (20% czasu)
    if (visitProfileEnabled && Math.random() < 0.5) {
      const profileDuration = Math.min(remaining * 0.4, 60000);
      const visited = await maybeVisitRandomProfile(page, profileDuration);
      if (visited) {
        actions.push("profile_visit");
      }
    }

    // Sprawdź czas ponownie
    const elapsed2 = Date.now() - startTime;
    const remaining2 = durationMs - elapsed2;

    if (remaining2 < 20000) {
      log.dev("WARMUP", `Warmup zakończony (${actions.length} akcji)`);
      return { actions, duration: elapsed2 };
    }

    // 4. Może zobacz kilka zdjęć (15% czasu)
    if (viewPhotosEnabled && Math.random() < 0.4) {
      const photoTime = Math.min(remaining2 * 0.3, 40000);
      const viewed = await maybeViewPhotos(page, photoTime);
      if (viewed) {
        actions.push("photos_view");
      }
    }

    // 5. Może zostaw lajka (10% szans)
    if (Math.random() < likeChance) {
      const liked = await maybeLikePost(page);
      if (liked) {
        actions.push("random_like");
      }
    }

    // 6. Wróć na feed
    await page.goto("https://www.facebook.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(gaussianRandom(1500, 400));
    actions.push("returned_to_feed");

    // Losowy ruch myszy na koniec
    await randomMouseMovement(page);

  } catch (err) {
    log.dev("WARMUP", `Błąd podczas warmup: ${err.message}`);
  }

  const totalDuration = Date.now() - startTime;
  log.prod("LITE", `[WARMUP] Zakończony: ${actions.join(", ")} (${Math.round(totalDuration / 1000)}s)`);

  return { actions, duration: totalDuration };
}

/**
 * Może odwiedzić losowy profil z feedu
 * @param {import('puppeteer').Page} page
 * @param {number} maxDuration - max czas na profilu
 * @returns {Promise<boolean>}
 */
async function maybeVisitRandomProfile(page, maxDuration) {
  try {
    // Znajdź linki do profili w feedzie
    const profileLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/profile.php"], a[href*="facebook.com/"][role="link"]'));
      return links
        .map(a => a.href)
        .filter(href =>
          href.includes("facebook.com") &&
          !href.includes("/photo") &&
          !href.includes("/video") &&
          !href.includes("/posts") &&
          !href.includes("/groups")
        )
        .slice(0, 10);
    });

    if (profileLinks.length === 0) return false;

    // Wybierz losowy profil
    const randomProfile = profileLinks[Math.floor(Math.random() * profileLinks.length)];

    log.debug("WARMUP", `Odwiedzam profil: ${randomProfile.substring(0, 50)}...`);

    await page.goto(randomProfile, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

    await sleep(gaussianRandom(2000, 500));

    // Scroll przez chwilę
    const scrollTime = Math.min(maxDuration * 0.7, 30000);
    await feedScrollSession(page, scrollTime, {
      pauseOnContentChance: 0.2,
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Może obejrzeć kilka zdjęć
 * @param {import('puppeteer').Page} page
 * @param {number} maxDuration
 * @returns {Promise<boolean>}
 */
async function maybeViewPhotos(page, maxDuration) {
  try {
    // Znajdź zdjęcia w feedzie
    const photoElements = await page.$$('a[href*="/photo"]');

    if (photoElements.length === 0) return false;

    // Kliknij losowe zdjęcie
    const randomIndex = Math.floor(Math.random() * Math.min(photoElements.length, 5));
    await photoElements[randomIndex].click();

    await sleep(gaussianRandom(3000, 800));

    // "Oglądaj" zdjęcie
    const viewTime = gaussianRandom(maxDuration * 0.5, maxDuration * 0.15);
    await sleep(Math.max(2000, Math.min(maxDuration, viewTime)));

    // Zamknij (Escape lub kliknij X)
    await page.keyboard.press("Escape");
    await sleep(gaussianRandom(500, 150));

    return true;
  } catch {
    return false;
  }
}

/**
 * Może polubić losowy post
 * @param {import('puppeteer').Page} page
 * @returns {Promise<boolean>}
 */
async function maybeLikePost(page) {
  try {
    // Znajdź przyciski like
    const likeButtons = await page.$$('[aria-label*="Lubię to"], [aria-label*="Like"]');

    if (likeButtons.length === 0) return false;

    // Wybierz losowy
    const randomIndex = Math.floor(Math.random() * Math.min(likeButtons.length, 5));
    const button = likeButtons[randomIndex];

    // Sprawdź czy już nie polubiony
    const isLiked = await button.evaluate(el =>
      el.getAttribute("aria-pressed") === "true" ||
      el.closest('[aria-label*="Usuń reakcję"]')
    );

    if (isLiked) return false;

    await button.click();
    await sleep(gaussianRandom(800, 200));

    log.debug("WARMUP", "Polubiono losowy post");
    return true;
  } catch {
    return false;
  }
}

/**
 * Oblicza losowy czas warmup
 * @param {number} minMs - minimum (domyślnie 5 min)
 * @param {number} maxMs - maksimum (domyślnie 10 min)
 * @returns {number}
 */
function getRandomWarmupDuration(minMs = 5 * 60 * 1000, maxMs = 10 * 60 * 1000) {
  const mean = (minMs + maxMs) / 2;
  const stdDev = (maxMs - minMs) / 4;
  let duration = gaussianRandom(mean, stdDev);

  return Math.max(minMs, Math.min(maxMs, duration));
}

export {
  warmupSession,
  maybeVisitRandomProfile,
  maybeViewPhotos,
  maybeLikePost,
  getRandomWarmupDuration,
};
