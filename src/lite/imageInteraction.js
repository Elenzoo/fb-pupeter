// src/lite/imageInteraction.js
// Interakcja ze zdjęciami - hover, oglądanie, zamykanie

import { gaussianRandom, sleep } from "../utils/sleep.js";
import { moveToElement, humanClick, randomMouseMovement } from "../utils/mouse.js";
import log from "../utils/logger.js";

/**
 * Hover nad elementem przez określony czas
 * @param {import('puppeteer').Page} page
 * @param {import('puppeteer').ElementHandle} element
 * @param {number} durationMs - czas hoveru
 * @returns {Promise<boolean>}
 */
async function hoverElement(page, element, durationMs) {
  try {
    // Przesuń mysz do elementu
    const moved = await moveToElement(page, element);
    if (!moved) return false;

    // Hover przez określony czas
    await sleep(durationMs);

    return true;
  } catch {
    return false;
  }
}

/**
 * Może wejść w interakcję ze zdjęciem
 * @param {import('puppeteer').Page} page
 * @param {import('puppeteer').ElementHandle} imageElement
 * @param {object} options
 * @returns {Promise<{action: string | null, duration: number}>}
 */
async function maybeInteractWithImage(page, imageElement, options = {}) {
  const {
    chance = 0.15,
    enabled = true,
    hoverMinMs = 1000,
    hoverMaxMs = 3000,
    clickChance = 0.4,  // szansa na kliknięcie po hoverze
    viewMinMs = 2000,
    viewMaxMs = 5000,
  } = options;

  if (!enabled || Math.random() > chance) {
    return { action: null, duration: 0 };
  }

  const startTime = Date.now();

  try {
    // 1. Hover nad zdjęciem
    const hoverDuration = gaussianRandom(
      (hoverMinMs + hoverMaxMs) / 2,
      (hoverMaxMs - hoverMinMs) / 4
    );
    const clampedHover = Math.max(hoverMinMs, Math.min(hoverMaxMs, hoverDuration));

    const hovered = await hoverElement(page, imageElement, clampedHover);

    if (!hovered) {
      return { action: null, duration: 0 };
    }

    // 2. Może kliknij żeby powiększyć
    if (Math.random() < clickChance) {
      await humanClick(page, imageElement);
      await sleep(gaussianRandom(500, 150));

      // "Oglądaj" zdjęcie
      const viewDuration = gaussianRandom(
        (viewMinMs + viewMaxMs) / 2,
        (viewMaxMs - viewMinMs) / 4
      );
      const clampedView = Math.max(viewMinMs, Math.min(viewMaxMs, viewDuration));
      await sleep(clampedView);

      // Zamknij (Escape)
      await page.keyboard.press("Escape");
      await sleep(gaussianRandom(300, 100));

      log.prod("LITE", "[IMAGE] Obejrzano zdjęcie (klik + view)");
      return { action: "click_view", duration: Date.now() - startTime };
    }

    log.prod("LITE", "[IMAGE] Hover nad zdjęciem");
    return { action: "hover", duration: Date.now() - startTime };
  } catch (err) {
    log.debug("IMAGE", `Błąd: ${err.message}`);
    return { action: null, duration: Date.now() - startTime };
  }
}

/**
 * Znajduje obrazki w aktualnym widoku
 * @param {import('puppeteer').Page} page
 * @param {number} limit
 * @returns {Promise<import('puppeteer').ElementHandle[]>}
 */
async function findVisibleImages(page, limit = 10) {
  try {
    const images = await page.$$('img[src*="fbcdn"], img[data-imgperflogname], a[href*="/photo"] img');

    // Filtruj widoczne w viewport
    const visible = [];

    for (const img of images) {
      try {
        const isVisible = await img.isIntersectingViewport();
        if (isVisible) {
          visible.push(img);
        }
        if (visible.length >= limit) break;
      } catch {
        // Element mógł zniknąć
      }
    }

    return visible;
  } catch {
    return [];
  }
}

/**
 * Może wejść w interakcję z losowym zdjęciem na stronie
 * @param {import('puppeteer').Page} page
 * @param {object} options
 * @returns {Promise<{action: string | null, duration: number}>}
 */
async function maybeInteractWithRandomImage(page, options = {}) {
  const { chance = 0.15, enabled = true } = options;

  if (!enabled || Math.random() > chance) {
    return { action: null, duration: 0 };
  }

  const images = await findVisibleImages(page);

  if (images.length === 0) {
    return { action: null, duration: 0 };
  }

  // Wybierz losowy obrazek
  const randomImage = images[Math.floor(Math.random() * images.length)];

  return maybeInteractWithImage(page, randomImage, { ...options, chance: 1.0 });
}

/**
 * Przegląda galerię zdjęć (strzałki lewo/prawo)
 * @param {import('puppeteer').Page} page
 * @param {number} count - ile zdjęć przejrzeć
 * @param {object} options
 * @returns {Promise<number>} - ile faktycznie obejrzano
 */
async function browsePhotoGallery(page, count = 3, options = {}) {
  const {
    viewMinMs = 2000,
    viewMaxMs = 5000,
    direction = "next", // "next" lub "prev"
  } = options;

  let viewed = 0;

  try {
    for (let i = 0; i < count; i++) {
      // Oglądaj aktualne zdjęcie
      const viewDuration = gaussianRandom(
        (viewMinMs + viewMaxMs) / 2,
        (viewMaxMs - viewMinMs) / 4
      );
      await sleep(Math.max(viewMinMs, Math.min(viewMaxMs, viewDuration)));

      viewed++;

      // Przejdź do następnego/poprzedniego
      const key = direction === "next" ? "ArrowRight" : "ArrowLeft";

      try {
        await page.keyboard.press(key);
        await sleep(gaussianRandom(500, 150));
      } catch {
        // Może koniec galerii
        break;
      }
    }
  } catch (err) {
    log.debug("IMAGE", `Błąd galerii: ${err.message}`);
  }

  return viewed;
}

/**
 * Może polubić zdjęcie (podwójne kliknięcie)
 * @param {import('puppeteer').Page} page
 * @param {object} options
 * @returns {Promise<boolean>}
 */
async function maybeLikePhoto(page, options = {}) {
  const { chance = 0.05, enabled = true } = options;

  if (!enabled || Math.random() > chance) return false;

  try {
    // Znajdź przycisk like w lightboxie
    const likeButton = await page.$('[aria-label*="Lubię to"], [aria-label*="Like"]');

    if (!likeButton) return false;

    // Sprawdź czy nie polubione
    const isLiked = await likeButton.evaluate(el =>
      el.getAttribute("aria-pressed") === "true"
    );

    if (isLiked) return false;

    await humanClick(page, likeButton);
    await sleep(gaussianRandom(500, 150));

    log.debug("IMAGE", "Polubiono zdjęcie");
    return true;
  } catch {
    return false;
  }
}

export {
  hoverElement,
  maybeInteractWithImage,
  findVisibleImages,
  maybeInteractWithRandomImage,
  browsePhotoGallery,
  maybeLikePhoto,
};
