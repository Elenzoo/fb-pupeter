// src/db/dead-posts.js
// Moduł zarządzania martwymi postami (posty bez aktywności > N dni)

import fs from "fs";
import path from "path";
import log from "../utils/logger.js";

const DATA_DIR = "./data";
const FILE = path.join(DATA_DIR, "dead-posts.json");

/**
 * Upewnia się, że istnieje katalog ./data
 */
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Wczytuje listę martwych postów
 * @returns {Array} Lista martwych postów
 */
export function loadDeadPosts() {
  try {
    ensureDir();
    if (!fs.existsSync(FILE)) return [];
    const raw = fs.readFileSync(FILE, "utf8");
    if (!raw.trim()) return [];
    return JSON.parse(raw);
  } catch (e) {
    log.warn("DEAD-POSTS", `Błąd ładowania: ${e.message}`);
    return [];
  }
}

/**
 * Zapisuje listę martwych postów (atomic write)
 * @param {Array} deadPosts Lista martwych postów
 */
export function saveDeadPosts(deadPosts) {
  try {
    ensureDir();
    const tmpFile = path.join(DATA_DIR, `.dead-posts.${Date.now()}.tmp`);
    const content = JSON.stringify(deadPosts, null, 2);

    fs.writeFileSync(tmpFile, content, "utf8");
    fs.renameSync(tmpFile, FILE);

  } catch (e) {
    log.warn("DEAD-POSTS", `Błąd zapisu: ${e.message}`);
  }
}

/**
 * Dodaje post do listy martwych
 * @param {Object} post Post do dodania (id, url, name)
 * @param {number} lastCommentAgeDays Ile dni od ostatniego komentarza
 * @param {number} totalDetected Łączna liczba wykrytych komentarzy
 * @param {string} reason Powód przeniesienia
 * @returns {Object|null} Dodany wpis lub null jeśli już istnieje
 */
export function addDeadPost(post, lastCommentAgeDays, totalDetected, reason = "no_activity_14_days") {
  const deadPosts = loadDeadPosts();

  // Sprawdź czy post już jest na liście
  const existing = deadPosts.find(dp => dp.id === post.id || dp.url === post.url);
  if (existing) {
    log.dev("DEAD-POSTS", `Post ${post.name || post.id} już jest na liście martwych`);
    return null;
  }

  const entry = {
    id: post.id,
    url: post.url,
    name: post.name || post.id,
    lastCommentAgeDays,
    movedAt: new Date().toISOString(),
    totalDetectedBeforeDeath: totalDetected,
    reason
  };

  deadPosts.push(entry);
  saveDeadPosts(deadPosts);

  log.prod("DEAD-POSTS", `Przeniesiono do martwych: ${entry.name} (${lastCommentAgeDays} dni bez aktywności)`);
  return entry;
}

/**
 * Usuwa post z listy martwych (reaktywacja)
 * @param {string} id ID posta do usunięcia
 * @returns {Object|null} Usunięty wpis lub null jeśli nie znaleziono
 */
export function removeDeadPost(id) {
  const deadPosts = loadDeadPosts();
  const index = deadPosts.findIndex(dp => dp.id === id);

  if (index === -1) {
    log.dev("DEAD-POSTS", `Post ${id} nie znaleziony na liście martwych`);
    return null;
  }

  const [removed] = deadPosts.splice(index, 1);
  saveDeadPosts(deadPosts);

  log.prod("DEAD-POSTS", `Reaktywowano: ${removed.name}`);
  return removed;
}

/**
 * Sprawdza czy post jest na liście martwych
 * @param {string} id ID posta
 * @returns {boolean}
 */
export function isDeadPost(id) {
  const deadPosts = loadDeadPosts();
  return deadPosts.some(dp => dp.id === id);
}

/**
 * Zwraca wpis martwego posta po ID
 * @param {string} id ID posta
 * @returns {Object|null}
 */
export function getDeadPost(id) {
  const deadPosts = loadDeadPosts();
  return deadPosts.find(dp => dp.id === id) || null;
}

/**
 * Zwraca liczbę martwych postów
 * @returns {number}
 */
export function getDeadPostCount() {
  return loadDeadPosts().length;
}
