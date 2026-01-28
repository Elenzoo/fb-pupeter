// src/lite/profileVisitor.js
// Odwiedzanie profili - naturalne zachowanie przeglądania

import { gaussianRandom, sleep } from "../utils/sleep.js";
import { feedScrollSession, smoothScrollBy, smoothScrollToTop } from "./smoothScroll.js";
import { humanClick, randomMouseMovement } from "../utils/mouse.js";
import log from "../utils/logger.js";

/**
 * Może odwiedzić profil z określonym prawdopodobieństwem
 * @param {import('puppeteer').Page} page
 * @param {string} profileUrl - URL profilu
 * @param {object} options
 * @returns {Promise<boolean>} - true jeśli odwiedzono
 */
async function maybeVisitProfile(page, profileUrl, options = {}) {
  const {
    chance = 0.08,
    enabled = true,
    minViewTime = 10000,   // 10s
    maxViewTime = 30000,   // 30s
    viewPhotosChance = 0.3,
    photosToView = [2, 4],
  } = options;

  if (!enabled || Math.random() > chance) return false;

  try {
    log.prod("LITE", `[PROFILE] Odwiedzam losowy profil...`);

    // Zapisz aktualny URL żeby wrócić
    const originalUrl = page.url();

    // 1. Nawiguj do profilu
    await page.goto(profileUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

    await sleep(gaussianRandom(2000, 500));

    // 2. Scroll przez określony czas
    const viewTime = gaussianRandom(
      (minViewTime + maxViewTime) / 2,
      (maxViewTime - minViewTime) / 4
    );
    const clampedViewTime = Math.max(minViewTime, Math.min(maxViewTime, viewTime));

    await feedScrollSession(page, clampedViewTime * 0.6, {
      pauseOnContentChance: 0.25,
      pauseDurationMs: [1500, 4000],
    });

    // 3. Może zobacz zdjęcia
    if (Math.random() < viewPhotosChance) {
      const numPhotos = Math.floor(
        gaussianRandom(
          (photosToView[0] + photosToView[1]) / 2,
          (photosToView[1] - photosToView[0]) / 3
        )
      );
      const clampedNum = Math.max(photosToView[0], Math.min(photosToView[1], numPhotos));

      await viewProfilePhotos(page, clampedNum);
    }

    // 4. Wróć (back lub nawigacja)
    if (Math.random() < 0.6) {
      // goBack - bardziej naturalne
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 });
    } else {
      // Nawigacja bezpośrednia
      await page.goto(originalUrl, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
    }

    await sleep(gaussianRandom(1000, 300));

    log.debug("PROFILE", "Powrót z profilu");
    return true;
  } catch (err) {
    log.debug("PROFILE", `Błąd: ${err.message}`);

    // Spróbuj wrócić na feed
    try {
      await page.goto("https://www.facebook.com/", {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
    } catch {
      // Ignoruj
    }

    return false;
  }
}

/**
 * Klika w zakładkę "Zdjęcia" i przegląda
 * @param {import('puppeteer').Page} page
 * @param {number} count - ile zdjęć obejrzeć
 * @returns {Promise<boolean>}
 */
async function viewProfilePhotos(page, count = 3) {
  try {
    // Znajdź zakładkę Zdjęcia/Photos
    const photosTab = await page.$('a[href*="/photos"], a[href*="sk=photos"]');

    if (!photosTab) {
      log.debug("PROFILE", "Nie znaleziono zakładki Zdjęcia");
      return false;
    }

    // Kliknij zakładkę
    await humanClick(page, photosTab);
    await sleep(gaussianRandom(2500, 600));

    // Znajdź zdjęcia
    const photos = await page.$$('a[href*="/photo"], img[data-imgperflogname]');

    if (photos.length === 0) {
      log.debug("PROFILE", "Brak zdjęć do obejrzenia");
      return false;
    }

    // Obejrzyj N losowych zdjęć
    const indices = [];
    const maxPhotos = Math.min(photos.length, count);

    while (indices.length < maxPhotos) {
      const idx = Math.floor(Math.random() * photos.length);
      if (!indices.includes(idx)) {
        indices.push(idx);
      }
    }

    for (const idx of indices) {
      try {
        await humanClick(page, photos[idx]);
        await sleep(gaussianRandom(500, 150));

        // "Oglądaj" zdjęcie
        const viewTime = gaussianRandom(3500, 1000);
        await sleep(Math.max(2000, Math.min(6000, viewTime)));

        // Zamknij
        await page.keyboard.press("Escape");
        await sleep(gaussianRandom(800, 200));
      } catch {
        // Kontynuuj z następnym
      }
    }

    log.debug("PROFILE", `Obejrzano ${indices.length} zdjęć`);
    return true;
  } catch (err) {
    log.debug("PROFILE", `Błąd przy zdjęciach: ${err.message}`);
    return false;
  }
}

/**
 * Znajduje linki do profili w aktualnym widoku
 * @param {import('puppeteer').Page} page
 * @param {number} limit - max liczba linków
 * @returns {Promise<string[]>}
 */
async function findProfileLinks(page, limit = 10) {
  try {
    return await page.evaluate((lim) => {
      const links = Array.from(document.querySelectorAll('a'));
      const profileUrls = [];

      for (const link of links) {
        const href = link.href || "";

        // Filtruj tylko profile
        if (
          href.includes("facebook.com") &&
          (href.includes("/profile.php?id=") || href.match(/facebook\.com\/[a-zA-Z0-9.]+\/?$/)) &&
          !href.includes("/photo") &&
          !href.includes("/video") &&
          !href.includes("/posts") &&
          !href.includes("/groups") &&
          !href.includes("/events") &&
          !href.includes("/watch") &&
          !href.includes("facebook.com/home") &&
          !href.includes("facebook.com/notifications")
        ) {
          if (!profileUrls.includes(href)) {
            profileUrls.push(href);
          }
        }

        if (profileUrls.length >= lim) break;
      }

      return profileUrls;
    }, limit);
  } catch {
    return [];
  }
}

/**
 * Odwiedza losowy profil z aktualnego widoku
 * @param {import('puppeteer').Page} page
 * @param {object} options
 * @returns {Promise<boolean>}
 */
async function visitRandomVisibleProfile(page, options = {}) {
  const profiles = await findProfileLinks(page);

  if (profiles.length === 0) {
    log.debug("PROFILE", "Brak profili do odwiedzenia");
    return false;
  }

  const randomUrl = profiles[Math.floor(Math.random() * profiles.length)];

  return maybeVisitProfile(page, randomUrl, { ...options, chance: 1.0 });
}

export {
  maybeVisitProfile,
  viewProfilePhotos,
  findProfileLinks,
  visitRandomVisibleProfile,
};
