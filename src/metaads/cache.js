/**
 * Meta Ads Cache - zarządzanie cache'em reklam
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "../utils/logger.js";

const CACHE_PATH = "data/metaads-cache.json";

/**
 * Ładuje cache z pliku
 * @returns {Object} cache
 */
export function loadCache() {
  try {
    if (existsSync(CACHE_PATH)) {
      const data = readFileSync(CACHE_PATH, "utf8");
      return JSON.parse(data);
    }
  } catch (err) {
    log.warn("METAADS", `Błąd ładowania cache: ${err.message}`);
  }
  return {};
}

/**
 * Zapisuje cache do pliku
 * @param {Object} cache
 */
export function saveCache(cache) {
  try {
    // Upewnij się że katalog istnieje
    const dir = dirname(CACHE_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Atomic write
    const tempPath = CACHE_PATH + ".tmp";
    writeFileSync(tempPath, JSON.stringify(cache, null, 2));

    // Rename (atomic na większości systemów)
    renameSync(tempPath, CACHE_PATH);

    log.dev("METAADS", `Cache zapisany`);
  } catch (err) {
    log.warn("METAADS", `Błąd zapisu cache: ${err.message}`);
  }
}

/**
 * Sprawdza czy reklama jest w cache
 * @param {Object} cache
 * @param {string} keyword
 * @param {string} adId
 * @returns {boolean}
 */
export function isInCache(cache, keyword, adId) {
  const cacheKey = `keyword:${keyword}`;
  return !!cache[cacheKey]?.[adId];
}

/**
 * Oznacza reklamę jako wysłaną do watchera
 * @param {Object} cache
 * @param {string} keyword
 * @param {string} adId
 */
export function markAsSent(cache, keyword, adId) {
  const cacheKey = `keyword:${keyword}`;
  if (cache[cacheKey]?.[adId]) {
    cache[cacheKey][adId].sentToWatcher = true;
    cache[cacheKey][adId].sentAt = new Date().toISOString();
  }
}

/**
 * Pobiera statystyki cache
 * @param {Object} cache
 * @returns {Object} statystyki
 */
export function getCacheStats(cache) {
  let totalAds = 0;
  let totalSent = 0;
  let totalDarkPosts = 0;
  const keywordStats = {};

  for (const [key, ads] of Object.entries(cache)) {
    const keyword = key.replace("keyword:", "");
    const adsArray = Object.values(ads);

    keywordStats[keyword] = {
      total: adsArray.length,
      sent: adsArray.filter((a) => a.sentToWatcher).length,
      darkPosts: adsArray.filter((a) => !a.postUrl).length,
    };

    totalAds += adsArray.length;
    totalSent += keywordStats[keyword].sent;
    totalDarkPosts += keywordStats[keyword].darkPosts;
  }

  return {
    totalAds,
    totalSent,
    totalDarkPosts,
    keywords: keywordStats,
  };
}

/**
 * Czyści stare wpisy z cache (starsze niż X dni)
 * @param {Object} cache
 * @param {number} maxAgeDays - maksymalny wiek w dniach
 * @returns {Object} oczyszczony cache
 */
export function cleanOldEntries(cache, maxAgeDays = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);

  let removed = 0;

  for (const [key, ads] of Object.entries(cache)) {
    for (const [adId, ad] of Object.entries(ads)) {
      const lastSeen = new Date(ad.lastSeen || ad.firstSeen);
      if (lastSeen < cutoff) {
        delete cache[key][adId];
        removed++;
      }
    }

    // Usuń puste klucze
    if (Object.keys(cache[key]).length === 0) {
      delete cache[key];
    }
  }

  if (removed > 0) {
    log.prod("METAADS", `Usunięto ${removed} starych wpisów z cache`);
  }

  return cache;
}
