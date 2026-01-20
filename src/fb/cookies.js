// src/fb/cookies.js
import fs from "fs/promises";
import path from "path";
import { sleepRandom } from "../utils/sleep.js";
import log from "../utils/logger.js";

// 🔧 POPRAWNA interpretacja COOKIES_READ_ONLY z .env
const COOKIES_READ_ONLY =
  String(process.env.COOKIES_READ_ONLY || "")
    .trim()
    .toLowerCase() === "true";

log.debug("COOKIES", `COOKIES_READ_ONLY=${COOKIES_READ_ONLY}`, { raw: process.env.COOKIES_READ_ONLY });


/**
 * Ładowanie cookies z pliku cookies.json i wstrzyknięcie do strony.
 */
async function loadCookies(page) {
  try {
    const raw = await fs.readFile("cookies.json", "utf8");
    const cookies = JSON.parse(raw);

    if (Array.isArray(cookies) && cookies.length) {
      await page.setCookie(...cookies);
      log.dev("COOKIES", `Załadowano ${cookies.length} cookies z pliku`);
    } else {
      log.dev("COOKIES", "cookies.json istnieje, ale nie zawiera poprawnej tablicy");
    }
  } catch (err) {
    log.dev("COOKIES", `Brak cookies.json lub błąd odczytu: ${err?.message || err}`);
  }
}

/**
 * Atomic write dla plików JSON - zapisuje do tmp, potem rename
 * @param {string} targetPath - docelowa ścieżka pliku
 * @param {string} content - zawartość do zapisania
 */
async function atomicWriteFile(targetPath, content) {
  const dir = path.dirname(targetPath);
  const basename = path.basename(targetPath, ".json");
  const tmpFile = path.join(dir, `.${basename}.${Date.now()}.tmp`);

  // 1. Zapisz do pliku tymczasowego
  await fs.writeFile(tmpFile, content, "utf8");

  // 2. Atomic rename
  await fs.rename(tmpFile, targetPath);
}

/**
 * Zapisuje aktualne cookies z przeglądarki do pliku cookies.json
 * Używa atomic write dla bezpieczeństwa.
 */
async function saveCookies(page) {
  if (COOKIES_READ_ONLY) {
    log.debug("COOKIES", "COOKIES_READ_ONLY=true – pomijam zapis");
    return;
  }

  try {
    const cookies = await page.cookies();
    const content = JSON.stringify(cookies, null, 2);

    await atomicWriteFile("cookies.json", content);

    log.dev("COOKIES", `Zapisano ${cookies.length} cookies do pliku`);
  } catch (e) {
    log.warn("COOKIES", `Błąd zapisu cookies.json: ${e?.message || e}`);

    // Cleanup tmp files
    try {
      const files = await fs.readdir(".");
      for (const f of files) {
        if (f.startsWith(".cookies.") && f.endsWith(".tmp")) {
          await fs.unlink(f);
        }
      }
    } catch {
      // Ignoruj błędy cleanup
    }
  }
}



/**
 * Ogólne akceptowanie popupu cookies na FB (np. na postach).
 * label – tylko do logów (np. 'post', 'post-initial', 'login', itd.).
 */
async function acceptCookies(page, label = "global") {
  try {
    // chwila na pojawienie się popupu
    await sleepRandom(800, 1500);

    const result = await page.evaluate(() => {
      const wanted = [
        "zezwól na wszystkie pliki cookie",
        "zezwól na wszystkie pliki",
        "akceptuj wszystkie pliki cookie",
        "akceptuj wszystkie",
        "allow all cookies",
        "accept all cookies",
        "accept essential and optional cookies",
        "tylko niezbędne pliki cookie",
        "odrzuć opcjonalne pliki cookie",
      ].map((t) => t.toLowerCase());

      const buttons = Array.from(
        document.querySelectorAll("button, [role='button']")
      );

      let clicked = false;
      const texts = [];

      for (const btn of buttons) {
        const txt = (btn.innerText || btn.textContent || "").trim();
        if (!txt) continue;

        const low = txt.toLowerCase();
        texts.push(txt);

        if (wanted.some((w) => low.includes(w))) {
          btn.click();
          clicked = true;
          break;
        }
      }

      return { clicked, texts };
    });

    if (result.clicked) {
      log.debug("COOKIES", `[${label}] Kliknięto akceptację cookies`);
      await sleepRandom(1500, 2500);
    } else {
      log.debug("COOKIES", `[${label}] Nie znaleziono przycisku cookies`, { texts: result.texts?.slice(0, 5) });
    }
  } catch (err) {
    log.debug("COOKIES", `[${label}] Błąd popupu: ${err?.message || err}`);
  }
}

export {
  loadCookies,
  saveCookies,
  acceptCookies,
};
