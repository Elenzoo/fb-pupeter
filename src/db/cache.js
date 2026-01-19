// src/db/cache.js
import fs from "fs";
import path from "path";
import log from "../utils/logger.js";

const DATA_DIR = "./data";
const FILE = path.join(DATA_DIR, "comments-cache.json");

/**
 * Upewnia się, że istnieje katalog ./data
 */
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadCache() {
  try {
    ensureDir();
    if (!fs.existsSync(FILE)) return {};
    const raw = fs.readFileSync(FILE, "utf8");
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (e) {
    log.warn("CACHE", `Błąd ładowania: ${e.message}`);

    // Próba odczytu backup jeśli główny plik uszkodzony
    const backupFile = FILE + ".backup";
    if (fs.existsSync(backupFile)) {
      try {
        const backupRaw = fs.readFileSync(backupFile, "utf8");
        if (backupRaw.trim()) {
          log.warn("CACHE", "Odtworzono z backup");
          return JSON.parse(backupRaw);
        }
      } catch (backupErr) {
        log.warn("CACHE", `Błąd odczytu backup: ${backupErr.message}`);
      }
    }

    return {};
  }
}

/**
 * Atomic write - zapisuje do pliku tymczasowego, potem rename.
 * Zapobiega uszkodzeniu cache przy przerwaniu procesu.
 */
export function saveCache(cache) {
  try {
    ensureDir();

    const tmpFile = path.join(DATA_DIR, `.comments-cache.${Date.now()}.tmp`);
    const content = JSON.stringify(cache, null, 2);

    // 1. Zapisz do pliku tymczasowego
    fs.writeFileSync(tmpFile, content, "utf8");

    // 2. Utwórz backup aktualnego pliku (jeśli istnieje)
    if (fs.existsSync(FILE)) {
      try {
        fs.copyFileSync(FILE, FILE + ".backup");
      } catch {
        // Ignoruj błąd backup - nie krytyczny
      }
    }

    // 3. Atomic rename (atomowa operacja na większości systemów plików)
    fs.renameSync(tmpFile, FILE);

  } catch (e) {
    log.warn("CACHE", `Błąd zapisu: ${e.message}`);

    // Spróbuj usunąć plik tmp jeśli został
    try {
      const tmpPattern = path.join(DATA_DIR, ".comments-cache.*.tmp");
      const files = fs.readdirSync(DATA_DIR);
      for (const f of files) {
        if (f.startsWith(".comments-cache.") && f.endsWith(".tmp")) {
          fs.unlinkSync(path.join(DATA_DIR, f));
        }
      }
    } catch {
      // Ignoruj błędy cleanup
    }
  }
}

/**
 * Zwraca rozmiar cache w bajtach (dla monitoringu)
 */
export function getCacheSize() {
  try {
    if (!fs.existsSync(FILE)) return 0;
    const stats = fs.statSync(FILE);
    return stats.size;
  } catch {
    return 0;
  }
}

/**
 * Zwraca liczbę wpisów w cache (dla monitoringu)
 */
export function getCacheEntryCount() {
  try {
    if (!fs.existsSync(FILE)) return 0;
    const raw = fs.readFileSync(FILE, "utf8");
    if (!raw.trim()) return 0;
    const data = JSON.parse(raw);
    return Object.keys(data).length;
  } catch {
    return 0;
  }
}
