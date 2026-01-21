// src/utils/mouse.js
// Human Behavior Mode - symulacja ruchów myszy krzywymi Beziera

import { gaussianRandom, sleep } from "./sleep.js";

/**
 * Oblicza punkt na krzywej Beziera (3. stopnia)
 * @param {number} t - parametr 0-1
 * @param {number} p0 - punkt startowy
 * @param {number} p1 - punkt kontrolny 1
 * @param {number} p2 - punkt kontrolny 2
 * @param {number} p3 - punkt końcowy
 * @returns {number}
 */
function bezierPoint(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return (
    u * u * u * p0 +
    3 * u * u * t * p1 +
    3 * u * t * t * p2 +
    t * t * t * p3
  );
}

/**
 * Generuje ścieżkę ruchu myszy między dwoma punktami
 * używając krzywej Beziera z losowymi punktami kontrolnymi
 * @param {number} startX
 * @param {number} startY
 * @param {number} endX
 * @param {number} endY
 * @param {number} steps - liczba kroków (więcej = płynniej)
 * @returns {Array<{x: number, y: number}>}
 */
function generateBezierPath(startX, startY, endX, endY, steps = 25) {
  const path = [];

  // Losowe punkty kontrolne - dodają "ludzką" krzywość
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Punkty kontrolne odsunięte o 20-40% odległości w losowym kierunku
  const offset1 = gaussianRandom(distance * 0.3, distance * 0.1);
  const angle1 = Math.random() * Math.PI * 2;
  const cp1x = startX + dx * 0.3 + Math.cos(angle1) * offset1;
  const cp1y = startY + dy * 0.3 + Math.sin(angle1) * offset1;

  const offset2 = gaussianRandom(distance * 0.3, distance * 0.1);
  const angle2 = Math.random() * Math.PI * 2;
  const cp2x = startX + dx * 0.7 + Math.cos(angle2) * offset2;
  const cp2y = startY + dy * 0.7 + Math.sin(angle2) * offset2;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;

    // Easing - wolniej na początku i końcu (naturalny ruch)
    const easedT = t < 0.5
      ? 2 * t * t
      : 1 - Math.pow(-2 * t + 2, 2) / 2;

    const x = bezierPoint(easedT, startX, cp1x, cp2x, endX);
    const y = bezierPoint(easedT, startY, cp1y, cp2y, endY);

    path.push({ x: Math.round(x), y: Math.round(y) });
  }

  return path;
}

/**
 * Przesuwa mysz wzdłuż ścieżki Beziera
 * @param {import('puppeteer').Page} page
 * @param {number} startX
 * @param {number} startY
 * @param {number} endX
 * @param {number} endY
 * @returns {Promise<void>}
 */
async function moveMouse(page, startX, startY, endX, endY) {
  const distance = Math.sqrt(
    Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2)
  );

  // Więcej kroków dla dłuższych ruchów
  const steps = Math.max(15, Math.min(50, Math.round(distance / 15)));
  const path = generateBezierPath(startX, startY, endX, endY, steps);

  for (const point of path) {
    await page.mouse.move(point.x, point.y);

    // Losowe opóźnienie między ruchami (5-15ms)
    const moveDelay = gaussianRandom(10, 3);
    await sleep(Math.max(3, Math.min(20, moveDelay)));
  }
}

/**
 * Pobiera pozycję środka elementu
 * @param {import('puppeteer').ElementHandle} element
 * @returns {Promise<{x: number, y: number}>}
 */
async function getElementCenter(element) {
  const box = await element.boundingBox();
  if (!box) return null;

  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

/**
 * Przesuwa mysz do elementu używając krzywej Beziera
 * @param {import('puppeteer').Page} page
 * @param {import('puppeteer').ElementHandle} element
 * @returns {Promise<boolean>} - true jeśli sukces
 */
async function moveToElement(page, element) {
  try {
    const target = await getElementCenter(element);
    if (!target) return false;

    // Pobierz aktualną pozycję myszy (domyślnie środek ekranu)
    const viewport = page.viewport();
    const currentX = viewport ? viewport.width / 2 : 500;
    const currentY = viewport ? viewport.height / 2 : 300;

    // Dodaj małą losowość do punktu docelowego (nie celuj idealnie w środek)
    const offsetX = gaussianRandom(0, 3);
    const offsetY = gaussianRandom(0, 3);

    await moveMouse(
      page,
      currentX,
      currentY,
      target.x + offsetX,
      target.y + offsetY
    );

    return true;
  } catch {
    return false;
  }
}

/**
 * Human-like kliknięcie - ruch myszy + klik z małym opóźnieniem
 * @param {import('puppeteer').Page} page
 * @param {import('puppeteer').ElementHandle} element
 * @returns {Promise<boolean>} - true jeśli sukces
 */
async function humanClick(page, element) {
  try {
    // Ruch do elementu
    const moved = await moveToElement(page, element);
    if (!moved) {
      // Fallback do normalnego kliku
      await element.click().catch(() => {});
      return true;
    }

    // Małe opóźnienie przed klikiem (50-150ms)
    const preClickDelay = gaussianRandom(100, 30);
    await sleep(Math.max(40, Math.min(200, preClickDelay)));

    // Klik
    await page.mouse.click(
      (await getElementCenter(element)).x,
      (await getElementCenter(element)).y
    );

    // Małe opóźnienie po kliku (30-100ms)
    const postClickDelay = gaussianRandom(60, 20);
    await sleep(Math.max(20, Math.min(120, postClickDelay)));

    return true;
  } catch {
    // Fallback
    await element.click().catch(() => {});
    return true;
  }
}

/**
 * Losowy ruch myszy - symuluje "rozglądanie się" po stronie
 * @param {import('puppeteer').Page} page
 * @returns {Promise<void>}
 */
async function randomMouseMovement(page) {
  try {
    const viewport = page.viewport();
    if (!viewport) return;

    // Losowy punkt na stronie
    const targetX = gaussianRandom(viewport.width / 2, viewport.width / 4);
    const targetY = gaussianRandom(viewport.height / 2, viewport.height / 4);

    // Clamp do viewport
    const clampedX = Math.max(50, Math.min(viewport.width - 50, targetX));
    const clampedY = Math.max(50, Math.min(viewport.height - 50, targetY));

    const currentX = viewport.width / 2;
    const currentY = viewport.height / 2;

    await moveMouse(page, currentX, currentY, clampedX, clampedY);
  } catch {
    // Ignoruj błędy - to tylko dodatkowa symulacja
  }
}

export {
  generateBezierPath,
  moveMouse,
  moveToElement,
  humanClick,
  randomMouseMovement,
};
