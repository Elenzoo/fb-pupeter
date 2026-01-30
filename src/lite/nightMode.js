// src/lite/nightMode.js
// Tryb nocny - sen i morning catch-up

import { gaussianRandom, sleep } from "../utils/sleep.js";
import log from "../utils/logger.js";

/**
 * Sprawdza czy jest teraz noc (czas snu)
 * @param {number} startHour - początek nocy (np. 22)
 * @param {number} endHour - koniec nocy (np. 7)
 * @param {Date} now - aktualna data (opcjonalne, do testów)
 * @returns {boolean}
 */
function isNightTime(startHour = 22, endHour = 7, now = new Date()) {
  const currentHour = now.getHours();

  // Noc przechodzi przez północ (np. 22-7)
  if (startHour > endHour) {
    return currentHour >= startHour || currentHour < endHour;
  }

  // Noc w ciągu dnia (np. 2-6) - rzadki przypadek
  return currentHour >= startHour && currentHour < endHour;
}

/**
 * Oblicza ile czasu do obudzenia
 * @param {number} endHour - godzina obudzenia
 * @param {Date} now - aktualna data (opcjonalne)
 * @returns {number} - czas w ms
 */
function getTimeUntilWake(endHour = 7, now = new Date()) {
  const wakeTime = new Date(now);

  // Ustaw godzinę obudzenia
  wakeTime.setHours(endHour, 0, 0, 0);

  // Jeśli godzina obudzenia już minęła dziś, ustaw na jutro
  if (wakeTime <= now) {
    wakeTime.setDate(wakeTime.getDate() + 1);
  }

  return wakeTime.getTime() - now.getTime();
}

/**
 * Oblicza losowy czas obudzenia (z wariancją +/- 30 min)
 * @param {number} endHour - bazowa godzina obudzenia
 * @param {number} varianceMinutes - maksymalna wariancja w minutach
 * @returns {number} - czas w ms do obudzenia
 */
function getRandomWakeTime(endHour = 7, varianceMinutes = 30) {
  const baseTime = getTimeUntilWake(endHour);

  // Dodaj losową wariancję (-30 do +30 minut)
  const varianceMs = varianceMinutes * 60 * 1000;
  const randomOffset = gaussianRandom(0, varianceMs / 2);

  // Clamp do +/- varianceMs
  const clampedOffset = Math.max(-varianceMs, Math.min(varianceMs, randomOffset));

  return Math.max(0, baseTime + clampedOffset);
}

/**
 * Śpi do rana
 * @param {object} options
 * @returns {Promise<{sleptMs: number, wakeTime: Date}>}
 */
async function nightModeSleep(options = {}) {
  const {
    endHour = 7,
    varianceMinutes = 30,
    onWake = null, // callback po obudzeniu
  } = options;

  const sleepTime = getRandomWakeTime(endHour, varianceMinutes);
  const wakeTime = new Date(Date.now() + sleepTime);

  log.prod("NIGHT", `Zasypiam do ${wakeTime.toLocaleTimeString("pl-PL")} (${Math.round(sleepTime / 1000 / 60)} min)`);

  // Śpij
  await sleep(sleepTime);

  log.prod("NIGHT", "Budzę się!");

  if (onWake) {
    try {
      await onWake();
    } catch (err) {
      log.dev("NIGHT", `Błąd onWake: ${err.message}`);
    }
  }

  return { sleptMs: sleepTime, wakeTime };
}

/**
 * Sprawdza czy trzeba zrobić catch-up (nadrobić zaległości)
 * @param {Date} lastCheck - ostatnie sprawdzenie
 * @param {number} catchupHours - próg w godzinach (np. 8)
 * @returns {boolean}
 */
function shouldCatchUp(lastCheck, catchupHours = 8) {
  if (!lastCheck) return true;

  const lastCheckTime = lastCheck instanceof Date ? lastCheck : new Date(lastCheck);
  const hoursSinceLastCheck = (Date.now() - lastCheckTime.getTime()) / (1000 * 60 * 60);

  return hoursSinceLastCheck >= catchupHours;
}

/**
 * Oblicza rozszerzony max age dla catch-up
 * @param {number} baseMaxAgeMin - bazowy max age w minutach
 * @param {Date} lastCheck - ostatnie sprawdzenie
 * @returns {number} - rozszerzony max age w minutach
 */
function getCatchUpMaxAge(baseMaxAgeMin, lastCheck) {
  if (!lastCheck) return baseMaxAgeMin * 3; // 540 min (9h) dla pełnego catch-up

  const lastCheckTime = lastCheck instanceof Date ? lastCheck : new Date(lastCheck);
  const minutesSinceLastCheck = (Date.now() - lastCheckTime.getTime()) / (1000 * 60);

  // Max age = czas od ostatniego sprawdzenia + 30 min buffer
  return Math.max(baseMaxAgeMin, minutesSinceLastCheck + 30);
}

/**
 * Pełna logika trybu nocnego
 * Wywołuj na początku każdego cyklu
 * @param {object} options
 * @returns {Promise<{slept: boolean, catchUp: boolean, maxAgeOverride: number | null}>}
 */
async function handleNightMode(options = {}) {
  const {
    enabled = true,
    startHour = 22,
    endHour = 7,
    catchupHours = 8,
    baseMaxAgeMin = 180,
    lastCheck = null,
  } = options;

  if (!enabled) {
    return { slept: false, catchUp: false, maxAgeOverride: null };
  }

  // Sprawdź czy noc
  if (isNightTime(startHour, endHour)) {
    // Śpij do rana
    await nightModeSleep({ endHour });

    // Po obudzeniu - sprawdź catch-up
    const needsCatchUp = shouldCatchUp(lastCheck, catchupHours);
    const maxAgeOverride = needsCatchUp ? getCatchUpMaxAge(baseMaxAgeMin, lastCheck) : null;

    if (needsCatchUp) {
      log.prod("NIGHT", `Catch-up mode: max age = ${Math.round(maxAgeOverride)} min`);
    }

    return { slept: true, catchUp: needsCatchUp, maxAgeOverride };
  }

  // Nie noc - sprawdź tylko catch-up
  const needsCatchUp = shouldCatchUp(lastCheck, catchupHours);
  const maxAgeOverride = needsCatchUp ? getCatchUpMaxAge(baseMaxAgeMin, lastCheck) : null;

  return { slept: false, catchUp: needsCatchUp, maxAgeOverride };
}

/**
 * Formatuje czas do następnego snu/obudzenia
 * @param {number} startHour
 * @param {number} endHour
 * @returns {string}
 */
function getNextSleepInfo(startHour = 22, endHour = 7) {
  const now = new Date();

  if (isNightTime(startHour, endHour, now)) {
    const wakeMs = getTimeUntilWake(endHour, now);
    const wakeTime = new Date(now.getTime() + wakeMs);
    return `Budzenie o ${wakeTime.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}`;
  }

  // Oblicz czas do snu
  const sleepTime = new Date(now);
  sleepTime.setHours(startHour, 0, 0, 0);

  if (sleepTime <= now) {
    sleepTime.setDate(sleepTime.getDate() + 1);
  }

  const msUntilSleep = sleepTime.getTime() - now.getTime();
  const hoursUntilSleep = Math.round(msUntilSleep / (1000 * 60 * 60) * 10) / 10;

  return `Sen za ${hoursUntilSleep}h (${sleepTime.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })})`;
}

export {
  isNightTime,
  getTimeUntilWake,
  getRandomWakeTime,
  nightModeSleep,
  shouldCatchUp,
  getCatchUpMaxAge,
  handleNightMode,
  getNextSleepInfo,
};
