// src/utils/navigation.js
import { sleepRandom } from "./sleep.js";
import log from "./logger.js";

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
      log.debug("NAV", `[${label}] Próba ${attempt}/${MAX_ATTEMPTS}: ${url}`);

      // === FORCE DESKTOP PROFILE (SERVER FIX) ===
      await page.setViewport({ width: 1366, height: 768 });
      // DISABLED UA // === END FORCE DESKTOP PROFILE ===

      await page.goto(url, finalOptions);

      log.debug("NAV", `[${label}] OK na próbie ${attempt}`);
      return true;
    } catch (err) {
      log.warn("NAV", `[${label}] Błąd próba ${attempt}: ${err.message}`);

      if (attempt === MAX_ATTEMPTS) {
        return false;
      }

      await sleepRandom(3000, 7000);

      try {
        log.debug("NAV", "Próba odświeżenia FB...");
        await page
          .goto("https://www.facebook.com/", {
            waitUntil: "load",
            timeout: 45000,
          })
          .catch(() => {});
      } catch (e2) {
        log.warn("NAV", `Odświeżenie FB też błąd: ${e2.message}`);
      }
    }
  }

  // tu w praktyce nie dojdziemy
  return false;
}
