// src/utils/navigation.js
import { sleepRandom } from "./sleep.js";

/**
 * Bezpieczne page.goto z retry.
 * - próbuje kilka razy
 * - po błędzie robi mały reset FB
 */
export async function safeGoto(page, url, label = "goto", options = {}) {
  const MAX_ATTEMPTS = 3;

  const finalOptions = {
    waitUntil: "networkidle2",
    timeout: 90000, // 90s
    ...options,
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(
        `[NAV] (${label}) próba ${attempt}/${MAX_ATTEMPTS}: ${url}`
      );

      await page.goto(url, finalOptions);

      console.log(`[NAV] (${label}) OK na próbie ${attempt}`);
      return true;
    } catch (err) {
      console.error(
        `[NAV] (${label}) błąd na próbie ${attempt}:`,
        err.message
      );

      if (attempt === MAX_ATTEMPTS) {
        // sygnał dla wyżej: to już nie jest chwilowy lag
        return false;
      }

      // chwila przerwy
      await sleepRandom(3000, 7000);

      // próba „przepłukania” sesji – wejście na FB
      try {
        console.log("[NAV] próba odświeżenia FB (strona główna)...");
        await page
          .goto("https://www.facebook.com/", {
            waitUntil: "load",
            timeout: 45000,
          })
          .catch(() => {});
      } catch (e2) {
        console.error(
          "[NAV] odświeżenie FB też poleciało błędem:",
          e2.message
        );
      }
    }
  }

  // tu w praktyce nie dojdziemy
  return false;
}
