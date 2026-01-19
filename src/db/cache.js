// src/db/cache.js
import fs from "fs";
import path from "path";
import log from "../utils/logger.js";

const FILE = "./data/comments-cache.json";

/**
 * Upewnia się, że istnieje katalog ./data
 */
function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
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
    return {};
  }
}

export function saveCache(cache) {
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch (e) {
    log.warn("CACHE", `Błąd zapisu: ${e.message}`);
  }
}
