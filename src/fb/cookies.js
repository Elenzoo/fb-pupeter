// src/fb/cookies.js
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { sleepRandom } from "../utils/sleep.js";
import log from "../utils/logger.js";
import { BACKUP_COOKIES_DIR } from "../config.js";



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

/* ============================================================
   ===============   BACKUP / RESTORE COOKIES   ================
   ============================================================ */

const MAIN_COOKIES_FILE = "cookies.json";

/**
 * Pobiera listę dostępnych plików backup cookies (cookies_1.json, cookies_2.json, itd.)
 * Sortuje po numerze rosnąco
 * @returns {Array<{index: number, path: string, age: number|null}>}
 */
function getBackupCookiesList() {
  try {
    const backupDir = path.resolve(BACKUP_COOKIES_DIR);

    if (!fsSync.existsSync(backupDir)) {
      return [];
    }

    const files = fsSync.readdirSync(backupDir);
    const cookieFiles = [];

    for (const file of files) {
      // Szukamy plików cookies_N.json gdzie N to numer
      const match = file.match(/^cookies_(\d+)\.json$/);
      if (match) {
        const index = parseInt(match[1], 10);
        const filePath = path.join(backupDir, file);

        // Pobierz wiek pliku
        let age = null;
        try {
          const stats = fsSync.statSync(filePath);
          age = Math.round((Date.now() - stats.mtimeMs) / (1000 * 60 * 60)); // godziny
        } catch {}

        cookieFiles.push({
          index,
          path: filePath,
          filename: file,
          age,
        });
      }
    }

    // Sortuj po indeksie rosnąco
    cookieFiles.sort((a, b) => a.index - b.index);
    return cookieFiles;
  } catch (err) {
    log.debug("COOKIES", `Błąd listowania backup: ${err?.message}`);
    return [];
  }
}

/**
 * Sprawdza ile plików backup cookies jest dostępnych
 */
function getBackupCookiesCount() {
  return getBackupCookiesList().length;
}

/**
 * Sprawdza czy jest jakikolwiek backup cookies
 */
function hasAnyBackupCookies() {
  return getBackupCookiesCount() > 0;
}

/**
 * Pobiera informacje o konkretnym pliku backup
 * @param {number} index - numer pliku (1, 2, 3...)
 */
function getBackupCookiesInfo(index) {
  const list = getBackupCookiesList();
  return list.find((f) => f.index === index) || null;
}

/**
 * Przywraca cookies z konkretnego pliku backup
 * @param {number} index - numer pliku (1, 2, 3...)
 * @returns {Promise<{ok: boolean, index: number, age: number|null}>}
 */
async function restoreCookiesFromBackup(index) {
  try {
    const info = getBackupCookiesInfo(index);

    if (!info) {
      log.error("COOKIES", `Brak pliku backup cookies_${index}.json`);
      return { ok: false, index, age: null };
    }

    const mainPath = path.resolve(MAIN_COOKIES_FILE);

    // Skopiuj backup do głównego pliku
    await fs.copyFile(info.path, mainPath);

    log.success("COOKIES", `Przywrócono cookies_${index}.json`, { age: `${info.age}h` });
    return { ok: true, index, age: info.age };
  } catch (err) {
    log.error("COOKIES", `Błąd restore cookies_${index}: ${err?.message}`);
    return { ok: false, index, age: null };
  }
}

/**
 * Próbuje przywrócić kolejny plik cookies z listy
 * @param {number} startFromIndex - od którego indeksu zacząć (1-based)
 * @returns {Promise<{ok: boolean, usedIndex: number|null, remaining: number}>}
 */
async function restoreNextAvailableCookies(startFromIndex = 1) {
  const list = getBackupCookiesList();

  if (list.length === 0) {
    log.error("COOKIES", "Brak plików backup cookies");
    return { ok: false, usedIndex: null, remaining: 0 };
  }

  // Znajdź pierwszy plik z indeksem >= startFromIndex
  const candidates = list.filter((f) => f.index >= startFromIndex);

  if (candidates.length === 0) {
    // Jeśli nie ma kandydatów >= startFromIndex, zacznij od początku
    log.dev("COOKIES", `Brak cookies >= ${startFromIndex}, zaczynam od początku`);
    const first = list[0];
    const result = await restoreCookiesFromBackup(first.index);
    return {
      ok: result.ok,
      usedIndex: result.ok ? first.index : null,
      remaining: list.length - 1,
      looped: true
    };
  }

  const target = candidates[0];
  const result = await restoreCookiesFromBackup(target.index);
  const remaining = candidates.length - 1;

  return {
    ok: result.ok,
    usedIndex: result.ok ? target.index : null,
    remaining,
    looped: false
  };
}

/**
 * Zapisuje cookies jako backup z określonym numerem
 * Używa atomic write dla bezpieczeństwa.
 * @param {Page} page - Puppeteer page
 * @param {number} index - numer pliku (1, 2, 3...)
 * @returns {Promise<boolean>}
 */
async function saveCookiesAsBackup(page, index) {
  try {
    const cookies = await page.cookies();

    if (!cookies || cookies.length === 0) {
      log.warn("COOKIES", "Brak cookies do backup");
      return false;
    }

    const backupDir = path.resolve(BACKUP_COOKIES_DIR);
    await fs.mkdir(backupDir, { recursive: true });

    const filePath = path.join(backupDir, `cookies_${index}.json`);
    const content = JSON.stringify(cookies, null, 2);

    await atomicWriteFile(filePath, content);

    log.success("COOKIES", `Zapisano cookies_${index}.json (${cookies.length} cookies)`);
    return true;
  } catch (err) {
    log.warn("COOKIES", `Błąd zapisu backup: ${err?.message}`);
    return false;
  }
}

/**
 * Znajduje następny wolny numer dla nowego pliku backup
 */
function getNextBackupIndex() {
  const list = getBackupCookiesList();
  if (list.length === 0) return 1;

  const maxIndex = Math.max(...list.map((f) => f.index));
  return maxIndex + 1;
}

/**
 * Tworzy folder backup_cookies jeśli nie istnieje
 */
async function ensureBackupDir() {
  try {
    const backupDir = path.resolve(BACKUP_COOKIES_DIR);
    await fs.mkdir(backupDir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

// Legacy compatibility - dla starego kodu
function hasFreshCookiesBackup() {
  return hasAnyBackupCookies();
}

function getCookiesBackupAge() {
  const list = getBackupCookiesList();
  if (list.length === 0) return null;
  return list[0].age;
}

async function restoreFreshCookies() {
  const result = await restoreNextAvailableCookies(1);
  return result.ok;
}

async function backupCurrentCookies(page) {
  const nextIndex = getNextBackupIndex();
  return saveCookiesAsBackup(page, nextIndex);
}

export {
  loadCookies,
  saveCookies,
  acceptCookies,
  // Backup/restore - nowe API rotacji
  getBackupCookiesList,
  getBackupCookiesCount,
  hasAnyBackupCookies,
  getBackupCookiesInfo,
  restoreCookiesFromBackup,
  restoreNextAvailableCookies,
  saveCookiesAsBackup,
  getNextBackupIndex,
  ensureBackupDir,
  // Legacy compatibility
  hasFreshCookiesBackup,
  getCookiesBackupAge,
  restoreFreshCookies,
  backupCurrentCookies,
};
