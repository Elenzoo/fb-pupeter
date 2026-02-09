// src/watcher.js
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import RecaptchaPlugin from "puppeteer-extra-plugin-recaptcha";

// Stealth Plugin - ukrywa automatyzację (ZAWSZE pierwszy)
puppeteer.use(StealthPlugin());
console.log("[STEALTH] Plugin stealth włączony");

import fs from "fs";
import path from "path";
import os from "os";
import {
  EXPAND_COMMENTS,
  CHECK_INTERVAL_MS,
  POSTS_SHEET_URL,
  POSTS_REFRESH_MS,
  FAST_MODE,
  FAST_MAX_AGE_MIN,
  POSTS_API_URL,
  POSTS_API_TOKEN,
  CAPTCHA_API_KEY,
  CAPTCHA_ENABLED,
  REMOTE_DEBUG_PORT,
  HUMAN_MODE,
  PROXY_URL,
  // LITE config
  SESSION_LENGTH_MIN_MS,
  SESSION_LENGTH_MAX_MS,
  WARMUP_ENABLED,
  WARMUP_DURATION_MIN_MS,
  WARMUP_DURATION_MAX_MS,
  VIEWPORT_RANDOMIZATION,
  NIGHT_MODE_ENABLED,
  NIGHT_START_HOUR,
  NIGHT_END_HOUR,
  NIGHT_CATCHUP_HOURS,
  // FEED_SCAN_ENABLED i FEED_SCAN_KEYWORDS - ładowane dynamicznie z keywords.json
  FEED_SCROLL_DURATION_MIN,
  FEED_SCROLL_DURATION_MAX,
  HUMAN_RANDOM_LIKE_CHANCE,
  DISCOVERY_TELEGRAM_ENABLED,
  // Dead Posts config
  DEAD_POST_THRESHOLD_DAYS,
  DEAD_POST_AUTO_MOVE,
  DEAD_POST_ALERT,
} from "./config.js";

// Konfiguracja captcha solver (2Captcha) - zostawiam jak masz (nie rozbudowuję tego)
if (CAPTCHA_ENABLED && CAPTCHA_API_KEY) {
  puppeteer.use(
    RecaptchaPlugin({
      provider: { id: "2captcha", token: CAPTCHA_API_KEY },
      visualFeedback: true,
    })
  );
  console.log("[CAPTCHA] 2Captcha solver włączony");
}

import {
  prepare,
  getCommentCount,
  loadAllComments,
  extractCommentsData,
  switchCommentsFilterToNewest,
} from "./fb/comments.js";

import { loadCookies, saveCookies } from "./fb/cookies.js";
import { checkIfLogged, fbLogin, solveCaptchaIfPresent } from "./fb/login.js";
import { isCheckpoint, getCheckpointType } from "./fb/checkpoint.js";
import { parseFbRelativeTime, filterByAge } from "./utils/time.js";
import { shuffleArray } from "./utils/sleep.js";
import { loadCache, saveCache, getCacheSize, getCacheEntryCount } from "./db/cache.js";
import { loadDeadPosts, addDeadPost, isDeadPost } from "./db/dead-posts.js";
import { sendTelegramLeads, sendOwnerAlert } from "./telegram.js";
import log from "./utils/logger.js";

// LITE imports
import {
  getRandomViewport,
  getRandomSessionLength,
  getRandomizedInterval,
  shouldEndSession,
  generateSessionFingerprint,
} from "./lite/antiDetection.js";
import { warmupSession, getRandomWarmupDuration } from "./lite/warmup.js";
import { handleNightMode, getNextSleepInfo } from "./lite/nightMode.js";
import {
  betweenPostsPause,
  executeRandomBackgroundActions,
  createHumanBehavior,
  maybeVisitHomeFeed,
  performMouseMovements,
} from "./lite/humanBehavior.js";
import { scanFeed } from "./lite/feedScanner.js";
import { maybeRandomLike } from "./lite/randomActions.js";
import { smoothScrollBy } from "./lite/smoothScroll.js";
import { maybeSimulateTabSwitch } from "./lite/tabSimulation.js";
import { maybeVisitProfile, findProfileLinks } from "./lite/profileVisitor.js";
import { maybeInteractWithRandomImage } from "./lite/imageInteraction.js";
import { loadKeywordsFromFile, migrateKeywordsFromEnv, getActiveKeywords } from "./lite/index.js";

/**
 * ŹRÓDŁO POSTÓW (PRIMARY): panel => data/posts.json
 * Fallback: Google Sheets CSV (POSTS_SHEET_URL)
 */
const POSTS_FILE =
  process.env.POSTS_FILE || path.join(process.cwd(), "data", "posts.json");

/**
 * CACHE DYSKOWY
 */
const commentsCache = loadCache();
const lastCounts = new Map();
const knownCommentsPerPost = new Map();

// Limity dla knownIds - zapobiega memory leak
const MAX_KNOWN_IDS_PER_POST = 1000;
const KNOWN_IDS_TRIM_TO = 800;

for (const [url, entry] of Object.entries(commentsCache)) {
  if (typeof entry?.lastCount === "number") lastCounts.set(url, entry.lastCount);
  if (Array.isArray(entry?.knownIds)) {
    const ids = entry.knownIds.slice(-MAX_KNOWN_IDS_PER_POST);
    knownCommentsPerPost.set(url, new Set(ids));
  }
}

let currentPosts = [];
let lastRefreshAny = 0;
let cycleNumber = 0;

// LITE: Session management
let sessionFingerprint = null;
let sessionStartTime = 0;
let isFirstCycleOfSession = true;
let lastCheckTime = null;

// LITE: Human behavior instance
const humanBehavior = createHumanBehavior();

// ======= Stabilność: eskalacja błędów =======
let consecutiveHardFails = 0; // licznik kolejnych fail-i typu NAV/PROTOCOL/TARGET
const HARD_FAILS_RESET_CONTEXT = Number(process.env.HARD_FAILS_RESET_CONTEXT || 3);
const HARD_FAILS_RESET_BROWSER = Number(process.env.HARD_FAILS_RESET_BROWSER || 5);
const MAX_POST_RETRY = Number(process.env.POST_RETRY_MAX || 1); // retry per post na nowym page
const BROWSER_RECYCLE_EVERY_CYCLES = Number(process.env.BROWSER_RECYCLE_EVERY_CYCLES || 10);
const BROWSER_RECYCLE_EVERY_POSTS = Number(process.env.BROWSER_RECYCLE_EVERY_POSTS || 15); // recykling CO N POSTÓW w cyklu

// ======= Stary licznik nawigacji (zostawiam, ale ulepszamy wykrywanie) =======
let navErrorCount = 0;
const MAX_NAV_ERRORS = 5;

function envBool(name, def = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (raw === "") return def;
  return ["1", "true", "yes", "y", "tak", "on"].includes(raw);
}

// ================== FAST_MODE HELPER ==================
function getCommentAgeMinutes(timeStr) {
  if (!timeStr) return null;
  const abs = parseFbRelativeTime(timeStr);
  if (!abs) return null;
  return (Date.now() - abs.getTime()) / 60000;
}

// ================== TELEGRAM (FILTER AGE) ==================
// Zwraca liczbę faktycznie wysłanych komentarzy (po filtrowaniu wieku)
async function sendTelegramIfFresh(post, comments, ctx = "normal") {
  const list = Array.isArray(comments) ? comments : [];
  if (list.length === 0) return 0;

  const now = Date.now();

  const normalized = list.map((c) => {
    const rel = String(c?.fb_time_raw || c?.time || "").trim();
    const abs = parseFbRelativeTime(rel);
    const iso = abs ? abs.toISOString() : (c?.fb_time_iso || null);
    const ageMin = abs ? Math.round(((now - abs.getTime()) / 60000) * 10) / 10 : null;

    return {
      ...c,
      fb_time_raw: rel || null,
      fb_time_iso: iso,
      _ageMin: ageMin,
    };
  });

  for (const c of normalized) {
    log.debug("TELEGRAM", `Komentarz ${c?.id}`, {
      ctx,
      author: c?.author || c?.name,
      rel: c?.fb_time_raw,
      ageMin: c?._ageMin,
    });
  }

  const fresh = filterByAge(normalized);
  const maxAge = Number(process.env.WEBHOOK_MAX_AGE_MIN || 60);

  log.dev("TELEGRAM", `Filtr wieku: ${normalized.length} → ${fresh.length}`, { ctx, maxAge });

  if (fresh.length > 0) {
    await sendTelegramLeads(post, fresh);
  } else {
    log.dev("TELEGRAM", "Brak świeżych komentarzy - nic nie wysyłam");
  }

  return fresh.length;
}

/* ============================================================
   ===============   STEALTH / UKRYWANIE BOTA   ===============
   ============================================================ */

async function applyStealth(page) {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    window.chrome = window.chrome || { runtime: {} };
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, "languages", { get: () => ["pl-PL", "pl"] });

    const permissions = window.navigator.permissions;
    if (permissions && permissions.query) {
      const originalQuery = permissions.query.bind(permissions);
      permissions.query = (parameters) => {
        if (parameters && parameters.name === "notifications" && window.Notification) {
          return Promise.resolve({ state: window.Notification.permission });
        }
        return originalQuery(parameters);
      };
    }
  });
}

/* ============================================================
   ===================   STABILNOŚĆ CORE   ====================
   ============================================================ */

function classifyError(err) {
  const msg = String(err?.message || err || "").toLowerCase();

  const isTimeout =
    msg.includes("timeout") ||
    msg.includes("navigation timeout") ||
    msg.includes("timed out");

  const isNet =
    msg.includes("net::err_") ||
    msg.includes("err_connection") ||
    msg.includes("err_internet_disconnected") ||
    msg.includes("err_name_not_resolved") ||
    msg.includes("err_connection_reset");

  const isContext =
    msg.includes("execution context was destroyed") ||
    msg.includes("cannot find context") ||
    msg.includes("context") && msg.includes("destroy");

  const isFrame =
    msg.includes("frame was detached") ||
    msg.includes("detached frame");

  const isTargetClosed =
    msg.includes("target closed") ||
    msg.includes("session closed") ||
    msg.includes("browser has disconnected") ||
    msg.includes("disconnected") ||
    msg.includes("protocol error") && msg.includes("closed");

  const isSafeGoto =
    msg.includes("safegoto-failed");

  const isNavigation =
    isTimeout || isNet || isSafeGoto || msg.includes("navigation");

  // hardFail = coś co zwykle naprawia reset page/context/browser
  const hardFail = isTargetClosed || isContext || isFrame || isNavigation;

  return {
    msg,
    isTimeout,
    isNet,
    isContext,
    isFrame,
    isTargetClosed,
    isSafeGoto,
    isNavigation,
    hardFail,
  };
}

function isNavigationError(err) {
  const c = classifyError(err);
  return c.isNavigation || c.isContext || c.isFrame;
}

async function safeClosePage(page) {
  if (!page) return;
  try {
    await page.close({ runBeforeUnload: false });
  } catch {}
}

async function safeCloseContext(ctx) {
  if (!ctx) return;
  try {
    await ctx.close();
  } catch {}
}

async function safeCloseBrowser(browser) {
  if (!browser) return;
  try {
    await browser.close();
  } catch {}
}

// === CRASH PROTECTION: Monitorowanie pamięci ===
const MEMORY_THRESHOLD_MB = Number(process.env.MEMORY_THRESHOLD_MB || 2800); // 2.8GB - zostaw bufor dla systemu

function getMemoryUsageMB() {
  try {
    const used = process.memoryUsage();
    // RSS = Resident Set Size - całkowita pamięć procesu Node.js
    return Math.round(used.rss / 1024 / 1024);
  } catch {
    return 0;
  }
}

function getSystemMemoryMB() {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    return {
      total: Math.round(totalMem / 1024 / 1024),
      used: Math.round(usedMem / 1024 / 1024),
      free: Math.round(freeMem / 1024 / 1024),
      percent: Math.round((usedMem / totalMem) * 100),
    };
  } catch {
    return { total: 0, used: 0, free: 0, percent: 0 };
  }
}

function shouldRestartDueToMemory() {
  const sysMem = getSystemMemoryMB();
  // Restart gdy zostało mniej niż 15% wolnej pamięci LUB użyto więcej niż threshold
  return sysMem.percent > 85 || sysMem.used > MEMORY_THRESHOLD_MB;
}

async function setupLightweightPage(page) {
  // blokuj ciężkie rzeczy → mniejsze RAM i mniej OOM
  const blockImages = envBool("BLOCK_IMAGES", true);
  const blockMedia = envBool("BLOCK_MEDIA", true);
  const blockFonts = envBool("BLOCK_FONTS", true);

  if (blockImages || blockMedia || blockFonts) {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      try {
        const type = req.resourceType();
        if (blockImages && type === "image") return req.abort();
        if (blockMedia && (type === "media")) return req.abort();
        if (blockFonts && (type === "font")) return req.abort();
        return req.continue();
      } catch {
        try { return req.continue(); } catch {}
      }
    });
  }

  page.setDefaultNavigationTimeout(90000);
  page.setDefaultTimeout(90000);

  // LITE: Użyj losowego viewportu z sesji lub domyślnego
  if (VIEWPORT_RANDOMIZATION && sessionFingerprint?.viewport) {
    await page.setViewport(sessionFingerprint.viewport);
  } else {
    await page.setViewport({ width: 1280, height: 720 });
  }

  await applyStealth(page);
}

/* ============================================================
   ===============   PANEL POSTS (data/posts.json)   ===========
   ============================================================ */

function safeJsonParse(s) {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch (e) {
    return { ok: false, error: e?.message || "Invalid JSON" };
  }
}

function normalizeUrl(u) {
  if (!u) return "";
  const x = String(u).trim();
  if (!/^https?:\/\/.+/i.test(x)) return "";
  return x;
}

function readPanelPosts() {
  try {
    if (!fs.existsSync(POSTS_FILE)) {
      return { ok: false, error: "posts.json nie istnieje", posts: [], path: POSTS_FILE };
    }
    const raw = fs.readFileSync(POSTS_FILE, "utf8").trim();
    if (!raw) {
      return { ok: false, error: "posts.json jest pusty", posts: [], path: POSTS_FILE };
    }

    const parsed = safeJsonParse(raw);
    if (!parsed.ok || !Array.isArray(parsed.value)) {
      return { ok: false, error: "posts.json ma zły format", posts: [], path: POSTS_FILE };
    }

    const posts = parsed.value
      .map((p) => {
        const url = normalizeUrl(p?.url);
        const active = Boolean(p?.active);
        if (!url) return null;
        return {
          id: String(p?.id || url),
          url,
          active,
          name: p?.name ? String(p.name) : "",
          image: p?.image ? String(p.image) : "",
          description: p?.description ? String(p.description) : "",
        };
      })
      .filter(Boolean);

    const activePosts = posts.filter((p) => p.active);
    return { ok: true, posts: activePosts, total: posts.length, path: POSTS_FILE };
  } catch (e) {
    return { ok: false, error: e?.message || "Błąd czytania posts.json", posts: [], path: POSTS_FILE };
  }
}

/* ============================================================
   ===============   GOOGLE SHEETS – PARSOWANIE   =============
   ============================================================ */

function parseSheetCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (!lines.length) {
    log.warn("SHEET", "Pusty CSV z arkusza");
    return [];
  }

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idxUrl = header.findIndex((h) => h === "url");
  const idxActive = header.findIndex((h) => h === "active");
  const idxName = header.findIndex((h) => h === "name" || h === "nazwa");
  const idxImage = header.findIndex((h) => h === "image" || h === "img" || h === "photo" || h === "zdjecie");
  const idxDesc = header.findIndex((h) => h === "description" || h === "desc" || h === "opis");

  if (idxUrl === -1) {
    log.error("SHEET", "Brak kolumny 'url' w arkuszu");
    return [];
  }

  const posts = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(",");
    const rawUrl = (row[idxUrl] || "").trim();
    if (!rawUrl) continue;

    const activeRaw = idxActive !== -1 ? (row[idxActive] || "").trim() : "";
    const activeNorm = activeRaw.toLowerCase();
    const isActive = idxActive === -1 ? true : ["true", "1", "yes", "tak", "y"].includes(activeNorm);

    if (!isActive) continue;

    posts.push({
      id: `sheet-${i}`,
      url: rawUrl,
      name: idxName !== -1 ? (row[idxName] || "").trim() : "",
      image: idxImage !== -1 ? (row[idxImage] || "").trim() : "",
      description: idxDesc !== -1 ? (row[idxDesc] || "").trim() : "",
    });
  }

  return posts;
}

/* ============================================================
   ===============   POSTS FROM REMOTE API   ====================
   ============================================================ */

async function fetchPostsFromApi() {
  if (!POSTS_API_URL) return { ok: false, reason: "no-url" };

  log.dev("API", `Pobieram posty z: ${POSTS_API_URL}`);

  try {
    const headers = { "Content-Type": "application/json" };
    if (POSTS_API_TOKEN) headers["Authorization"] = `Bearer ${POSTS_API_TOKEN}`;

    const res = await fetch(POSTS_API_URL, {
      method: "GET",
      headers,
      timeout: 10000,
    });

    if (!res.ok) {
      log.error("API", `Błąd HTTP: ${res.status} ${res.statusText}`);
      return { ok: false, reason: "http-error", status: res.status };
    }

    const data = await res.json();

    if (!data.ok || !Array.isArray(data.posts)) {
      log.error("API", "Nieprawidłowa odpowiedź (brak ok/posts)");
      return { ok: false, reason: "invalid-response" };
    }

    const posts = data.posts
      .filter((p) => p.active !== false)
      .map((p) => ({
        id: String(p.id || "").trim(),
        url: String(p.url || "").trim(),
        active: true,
        name: String(p.name || "").trim(),
        image: String(p.image || "").trim(),
        description: String(p.description || "").trim(),
      }))
      .filter((p) => p.url);

    return { ok: true, posts, total: data.posts.length };
  } catch (err) {
    log.error("API", `Błąd pobierania postów: ${err.message}`);
    return { ok: false, reason: "fetch-error", error: err.message };
  }
}

/* ============================================================
   ===============   POSTS REFRESH   ===========================
   ============================================================ */

async function refreshPostsIfNeeded(force = false) {
  const now = Date.now();
  if (!force && now - lastRefreshAny < POSTS_REFRESH_MS) return;
  lastRefreshAny = now;

  // 1) PRIMARY: Remote API
  if (POSTS_API_URL) {
    const api = await fetchPostsFromApi();
    if (api.ok && api.posts.length > 0) {
      const newPosts = api.posts;
      const oldJson = JSON.stringify(currentPosts);
      const newJson = JSON.stringify(newPosts);

      if (oldJson !== newJson) {
        log.prod("API", `Załadowano ${newPosts.length} postów`, { total: api.total });
        currentPosts = newPosts;
      } else {
        log.dev("API", `Bez zmian (${newPosts.length} aktywnych)`);
      }
      return;
    }

    log.dev("API", `Fallback do lokalnego pliku (${api.reason || "unknown"})`);
  }

  // 2) SECONDARY: lokalny panel posts.json
  const panel = readPanelPosts();
  if (panel.ok && panel.posts.length > 0) {
    const newPosts = panel.posts;
    const oldJson = JSON.stringify(currentPosts);
    const newJson = JSON.stringify(newPosts);

    if (oldJson !== newJson) {
      log.prod("POSTS", `Załadowano ${newPosts.length} postów z pliku`, { total: panel.total });
      currentPosts = newPosts;
    } else {
      log.dev("POSTS", `Bez zmian (${newPosts.length} aktywnych)`);
    }
    return;
  }

  log.dev("POSTS", "Panel bez postów → fallback: Sheets");

  // 3) FALLBACK: Sheets
  if (!POSTS_SHEET_URL) {
    log.warn("SHEET", "POSTS_SHEET_URL nie ustawiony – brak źródła postów");
    currentPosts = [];
    return;
  }

  log.dev("SHEET", "Odświeżam listę postów z Google Sheets...");

  try {
    const res = await fetch(POSTS_SHEET_URL);
    if (!res.ok) {
      log.error("SHEET", `Błąd HTTP: ${res.status} ${res.statusText}`);
      currentPosts = [];
      return;
    }

    const csvText = await res.text();
    const newPosts = parseSheetCsv(csvText);

    if (!newPosts.length) {
      log.warn("SHEET", "Arkusz nie zwrócił aktywnych postów");
      currentPosts = [];
      return;
    }

    const oldJson = JSON.stringify(currentPosts);
    const newJson = JSON.stringify(newPosts);

    if (oldJson !== newJson) {
      log.prod("SHEET", `Załadowano ${newPosts.length} postów`);
      currentPosts = newPosts;
    } else {
      log.dev("SHEET", "Bez zmian");
    }
  } catch (err) {
    log.error("SHEET", `Błąd pobierania CSV: ${err.message}`);
    currentPosts = [];
  }
}

/* ============================================================
   =====================   CACHE HELPERS   =====================
   ============================================================ */

function getCacheKey(post) {
  return post.url;
}

function getKnownSetForPost(cacheKey) {
  let set = knownCommentsPerPost.get(cacheKey);
  if (!set) {
    const entry = commentsCache[cacheKey];
    set = entry && Array.isArray(entry.knownIds) ? new Set(entry.knownIds) : new Set();
    knownCommentsPerPost.set(cacheKey, set);
  }
  return set;
}

function cleanupKnownIds(set) {
  if (set.size <= MAX_KNOWN_IDS_PER_POST) return;

  const arr = Array.from(set);
  const toRemove = arr.slice(0, arr.length - KNOWN_IDS_TRIM_TO);
  for (const id of toRemove) set.delete(id);

  log.debug("CACHE", `Przycięto knownIds: ${arr.length} → ${set.size}`);
}

function getTotalKnownIdsCount() {
  let total = 0;
  for (const set of knownCommentsPerPost.values()) total += set.size;
  return total;
}

function flushCacheToDisk() {
  const out = { ...commentsCache };

  for (const [cacheKey, count] of lastCounts.entries()) {
    if (!out[cacheKey]) out[cacheKey] = { lastCount: 0, knownIds: [] };
    out[cacheKey].lastCount = count;
  }

  for (const [cacheKey, set] of knownCommentsPerPost.entries()) {
    if (!out[cacheKey]) out[cacheKey] = { lastCount: 0, knownIds: [] };
    out[cacheKey].knownIds = Array.from(set);
  }

  Object.keys(commentsCache).forEach((k) => delete commentsCache[k]);
  Object.assign(commentsCache, out);
  saveCache(out);
}

/* ============================================================
   =====================   STATS HELPERS   =====================
   ============================================================ */

const STATS_FILE = path.join(process.cwd(), "data", "stats.json");
const DAILY_STATS_RETENTION_DAYS = 30;

/**
 * Ładuje globalne statystyki
 */
function loadGlobalStats() {
  const defaultStats = {
    global: {
      totalCommentsSent: 0,
      totalCommentsDetected: 0,
      cyclesCompleted: 0,
      startedAt: new Date().toISOString(),
      lastSessionStart: null,
      lastCycleAt: null,
      restartCount: 0,
    },
    daily: {},
  };

  try {
    if (!fs.existsSync(STATS_FILE)) {
      return defaultStats;
    }
    const raw = fs.readFileSync(STATS_FILE, "utf8");
    if (!raw.trim()) return defaultStats;

    const loaded = JSON.parse(raw);
    // Migracja starych pól
    if (!loaded.global.totalCommentsDetected) loaded.global.totalCommentsDetected = loaded.global.totalCommentsSent || 0;
    if (!loaded.global.restartCount) loaded.global.restartCount = 0;
    return loaded;
  } catch (e) {
    log.warn("STATS", `Błąd ładowania stats: ${e.message}`);
    return defaultStats;
  }
}

/**
 * Zapisuje globalne statystyki
 */
function saveGlobalStats(stats) {
  try {
    const dir = path.dirname(STATS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tmpFile = path.join(dir, `.stats.${Date.now()}.tmp`);
    fs.writeFileSync(tmpFile, JSON.stringify(stats, null, 2), "utf8");
    fs.renameSync(tmpFile, STATS_FILE);
  } catch (e) {
    log.warn("STATS", `Błąd zapisu stats: ${e.message}`);
  }
}

/**
 * Czyści stare wpisy daily (starsze niż DAILY_STATS_RETENTION_DAYS)
 */
function cleanupOldDailyStats(stats) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DAILY_STATS_RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  for (const date of Object.keys(stats.daily)) {
    if (date < cutoffStr) {
      delete stats.daily[date];
    }
  }
}

/**
 * Aktualizuje statystyki per post w cache
 * @param {string} cacheKey URL posta
 * @param {number} newCommentsCount Liczba nowych komentarzy wykrytych w tym cyklu
 * @param {string|null} newestTimeRaw Relatywny czas najnowszego komentarza z FB (np. "2 godz", "5 dni")
 */
function updatePostStats(cacheKey, newCommentsCount, newestTimeRaw = null) {
  const now = new Date().toISOString();

  if (!commentsCache[cacheKey]) {
    commentsCache[cacheKey] = { lastCount: 0, knownIds: [] };
  }

  if (!commentsCache[cacheKey].stats) {
    commentsCache[cacheKey].stats = {
      totalDetected: 0,
      firstSeenAt: now,
      lastSeenAt: now,
      lastNewCommentAt: null,
      lastNewCommentAge: null,
      // Nowe pola - rzeczywisty czas komentarza z FB
      lastCommentTime: null,
      lastCommentAge: null,
    };
  }

  const stats = commentsCache[cacheKey].stats;
  stats.lastSeenAt = now;

  // Aktualizuj czas najnowszego komentarza z FB (niezależnie od tego czy jest nowy)
  if (newestTimeRaw) {
    const parsedTime = parseFbRelativeTime(newestTimeRaw);
    if (parsedTime) {
      stats.lastCommentTime = parsedTime.toISOString();
      stats.lastCommentAge = formatAge(Date.now() - parsedTime.getTime());
      log.dev("STATS", `lastCommentTime: raw="${newestTimeRaw}" → ${stats.lastCommentAge}`);
    }
  }

  if (newCommentsCount > 0) {
    stats.totalDetected += newCommentsCount;
    stats.lastNewCommentAt = now;
    stats.lastNewCommentAge = "teraz";
  } else if (stats.lastNewCommentAt) {
    // Oblicz wiek od ostatniego wykrycia przez bota
    const lastNew = new Date(stats.lastNewCommentAt);
    const diffMs = Date.now() - lastNew.getTime();
    stats.lastNewCommentAge = formatAge(diffMs);
  }

  // Zapisz cache po każdym poście (szybki atomic write ~5-10ms)
  saveCache(commentsCache);
}

/**
 * Aktualizuje globalne statystyki po cyklu
 * @param {number} newCommentsTotal Łączna liczba nowych komentarzy w cyklu
 */
function updateGlobalStats(newCommentsTotal) {
  const stats = loadGlobalStats();
  const today = new Date().toISOString().split("T")[0];
  const now = new Date().toISOString();

  // Ustaw startedAt przy pierwszym cyklu
  if (!stats.global.startedAt) {
    stats.global.startedAt = now;
  }

  // Globalne
  stats.global.totalCommentsSent += newCommentsTotal;
  stats.global.cyclesCompleted += 1;
  stats.global.lastCycleAt = now;

  // Dzienne
  if (!stats.daily[today]) {
    stats.daily[today] = { comments: 0, cycles: 0 };
  }
  stats.daily[today].comments += newCommentsTotal;
  stats.daily[today].cycles += 1;

  // Cleanup starych wpisów
  cleanupOldDailyStats(stats);

  saveGlobalStats(stats);

  log.dev("STATS", `Zapisano statystyki: +${newCommentsTotal} komentarzy, cykl #${stats.global.cyclesCompleted}`);
}

/**
 * Formatuje czytelny wiek (np. "3 dni", "5 godz")
 */
function formatAge(ms) {
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 0) return `${days} ${days === 1 ? "dzień" : "dni"}`;
  if (hours > 0) return `${hours} ${hours === 1 ? "godz" : "godz"}`;
  return "< 1 godz";
}

/**
 * Sprawdza czy post jest martwy i ewentualnie przenosi do dead-posts
 * @param {Object} post Post do sprawdzenia
 * @param {Object} postsData Obiekt z postami do modyfikacji (jeśli trzeba dezaktywować)
 * @returns {boolean} true jeśli post został przeniesiony do martwych
 */
async function checkDeadPost(post) {
  if (!DEAD_POST_AUTO_MOVE) return false;

  const cacheKey = getCacheKey(post);
  const entry = commentsCache[cacheKey];

  // Sprawdź czy post był w ogóle widziany
  if (!entry?.stats?.firstSeenAt) return false;

  // Priorytet: lastCommentTime (rzeczywisty czas komentarza z FB) > lastNewCommentAt (czas wykrycia) > firstSeenAt
  let referenceTime = null;
  let referenceSource = "";

  if (entry.stats.lastCommentTime) {
    // Mamy rzeczywisty czas najnowszego komentarza z FB
    referenceTime = new Date(entry.stats.lastCommentTime);
    referenceSource = "last_comment";
  } else if (entry.stats.lastNewCommentAt) {
    // Fallback: czas ostatniego wykrycia przez bota
    referenceTime = new Date(entry.stats.lastNewCommentAt);
    referenceSource = "last_detection";
  } else {
    // Brak komentarzy - użyj firstSeenAt
    referenceTime = new Date(entry.stats.firstSeenAt);
    referenceSource = "first_seen";
  }

  const daysSinceActivity = (Date.now() - referenceTime.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceActivity < DEAD_POST_THRESHOLD_DAYS) return false;

  // Post jest martwy
  const totalDetected = entry.stats.totalDetected || 0;

  if (isDeadPost(post.id)) return false;

  const added = addDeadPost(post, Math.floor(daysSinceActivity), totalDetected, "no_activity_14_days");

  if (added && DEAD_POST_ALERT) {
    const reasonText = referenceSource === "last_comment"
      ? `Ostatni komentarz: ${Math.floor(daysSinceActivity)} dni temu.`
      : referenceSource === "last_detection"
      ? `Ostatnie wykrycie: ${Math.floor(daysSinceActivity)} dni temu.`
      : `Brak komentarzy przez ${Math.floor(daysSinceActivity)} dni.`;

    await sendOwnerAlert(
      "Martwy post",
      `Post "${post.name || post.id}" został przeniesiony do martwych.\n\n` +
      `${reasonText}\n` +
      `Łącznie wykrytych przed śmiercią: ${totalDetected}`
    );
  }

  return !!added;
}

/* ============================================================
   =====================   BROWSER FACTORY   ===================
   ============================================================ */

const isDev = process.env.NODE_ENV !== "production";

function getExecutablePath() {
  const p =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROME_PATH ||
    process.env.CHROMIUM_PATH ||
    "";
  return String(p || "").trim() || undefined;
}

function buildLaunchOptions() {
  const wantHeadless = envBool("HEADLESS_BROWSER", true);
  const headlessMode = wantHeadless ? "new" : false;

  const linux = process.platform === "linux";
  const executablePath = getExecutablePath();

  const args = [
    "--disable-notifications",
    "--disable-blink-features=AutomationControlled",
    // Optymalizacja pamięci - zapobiega crashom na serwerach z ograniczoną RAM
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-sync",
    "--disable-translate",
    "--metrics-recording-only",
    "--mute-audio",
    "--no-first-run",
    "--safebrowsing-disable-auto-update",
    // Limity pamięci
    "--js-flags=--max-old-space-size=512",
    "--disable-features=TranslateUI",
    "--disable-ipc-flooding-protection",
    // Single process mode dla mniejszego zużycia RAM (opcjonalnie)
    // "--single-process", // może być niestabilne, ale oszczędza RAM
  ];

  if (linux) {
    args.push("--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage");
    // Dodatkowe optymalizacje dla Linux serwerów
    args.push("--disable-accelerated-2d-canvas", "--no-zygote");
  }

  if (REMOTE_DEBUG_PORT > 0) {
    args.push(`--remote-debugging-port=${REMOTE_DEBUG_PORT}`);
    args.push("--remote-debugging-address=127.0.0.1");
    log.prod(
      "DEBUG",
      `Remote debugging na porcie ${REMOTE_DEBUG_PORT} - połącz przez: ssh -L ${REMOTE_DEBUG_PORT}:localhost:${REMOTE_DEBUG_PORT} user@server`
    );
  }

  if (PROXY_URL) {
    args.push(`--proxy-server=${PROXY_URL}`);
    const safeProxyUrl = PROXY_URL.replace(/\/\/([^:]+):([^@]+)@/, "//***:***@");
    log.prod("PROXY", `Używam proxy: ${safeProxyUrl}`);
  }

  if (HUMAN_MODE) {
    log.prod("HUMAN", "Human Behavior Mode włączony");
  }

  return {
    headless: headlessMode,
    defaultViewport: null,
    executablePath,
    args,
    ignoreDefaultArgs: ["--enable-automation"],
  };
}

/* ============================================================
   =====================   GŁÓWNY WATCHER   ===================
   ============================================================ */

async function startWatcher() {
  log.header("FB Comment Watcher");
  log.prod("WATCHER", `Start - interwał: ${Math.round(CHECK_INTERVAL_MS / 1000)}s`, {
    fastMode: FAST_MODE,
    logLevel: log.level,
    liteMode: true,
  });

  // Zapisz czas uruchomienia sesji i zwiększ licznik restartów
  const stats = loadGlobalStats();
  stats.global.lastSessionStart = new Date().toISOString();
  stats.global.restartCount = (stats.global.restartCount || 0) + 1;
  saveGlobalStats(stats);
  log.prod("WATCHER", `Sesja #${stats.global.restartCount}, startedAt: ${stats.global.startedAt?.split("T")[0] || "?"}`);

  // LITE: Log konfiguracji
  if (NIGHT_MODE_ENABLED) {
    log.prod("LITE", `Night Mode: ${NIGHT_START_HOUR}:00 - ${NIGHT_END_HOUR}:00`);
  }
  if (WARMUP_ENABLED) {
    log.prod("LITE", `Warmup: ${Math.round(WARMUP_DURATION_MIN_MS / 60000)}-${Math.round(WARMUP_DURATION_MAX_MS / 60000)} min`);
  }
  // Migracja keywords z .env do keywords.json (jednorazowo)
  if (migrateKeywordsFromEnv()) {
    log.prod("LITE", "Zmigrowano keywords z .env do keywords.json");
  }

  // Log konfiguracji Feed Scan
  const initKeywords = loadKeywordsFromFile();
  const initActiveKeywords = initKeywords.keywords.filter(k => k.enabled);
  if (initKeywords.enabled && initActiveKeywords.length > 0) {
    log.prod("LITE", `Feed Scan: ${initActiveKeywords.length}/${initKeywords.keywords.length} keywords aktywnych`);
  }

  const loop = async () => {
    const cycleStart = Date.now();
    cycleNumber++;
    let newCommentsTotal = 0;
    let errorsCount = 0;
    let hadNavErrorThisRound = false;
    let maxAgeOverride = null;

    let browser = null;
    let ctx = null;

    try {
      // ============ LITE: Night Mode ============
      if (NIGHT_MODE_ENABLED) {
        const nightResult = await handleNightMode({
          enabled: true,
          startHour: NIGHT_START_HOUR,
          endHour: NIGHT_END_HOUR,
          catchupHours: NIGHT_CATCHUP_HOURS,
          baseMaxAgeMin: FAST_MAX_AGE_MIN,
          lastCheck: lastCheckTime,
        });

        if (nightResult.slept) {
          log.prod("LITE", "Obudziłem się po nocy");
          isFirstCycleOfSession = true; // Reset sesji po nocy
          sessionFingerprint = null;
        }

        if (nightResult.catchUp) {
          maxAgeOverride = nightResult.maxAgeOverride;
          log.prod("LITE", `Catch-up mode: max age = ${Math.round(maxAgeOverride)} min`);
        }
      }

      // ============ LITE: Session Management ============
      const needNewSession =
        !sessionFingerprint ||
        shouldEndSession(sessionStartTime, sessionFingerprint.sessionLength);

      if (needNewSession) {
        sessionFingerprint = generateSessionFingerprint({
          sessionMinMs: SESSION_LENGTH_MIN_MS,
          sessionMaxMs: SESSION_LENGTH_MAX_MS,
        });
        sessionStartTime = Date.now();
        isFirstCycleOfSession = true;

        log.prod("LITE", `Nowa sesja: viewport ${sessionFingerprint.viewport.width}x${sessionFingerprint.viewport.height}, ` +
          `długość ${Math.round(sessionFingerprint.sessionLength / 60000)} min`);
      }

      log.prod("WATCHER", `Cykl #${cycleNumber} start`, { posts: currentPosts.length });

      // Odśwież posty na start cyklu
      await refreshPostsIfNeeded(true);

      // (Opcjonalna) prewencja: recycle browser co N cykli
      const shouldRecycleByCycle =
        BROWSER_RECYCLE_EVERY_CYCLES > 0 && cycleNumber % BROWSER_RECYCLE_EVERY_CYCLES === 0;

      // === CRASH PROTECTION: Sprawdź pamięć przed startem ===
      const sysMem = getSystemMemoryMB();
      log.dev("MEMORY", `System: ${sysMem.used}/${sysMem.total}MB (${sysMem.percent}%), Node RSS: ${getMemoryUsageMB()}MB`);

      if (shouldRestartDueToMemory()) {
        log.warn("MEMORY", `Wysokie zużycie pamięci (${sysMem.percent}%) - wymuszam garbage collection`);
        if (global.gc) {
          global.gc();
          log.dev("MEMORY", "Garbage collection wykonane");
        }
      }

      // Start browser/context
      browser = await puppeteer.launch(buildLaunchOptions());

      // === CRASH PROTECTION: Obsługa zdarzenia disconnected ===
      let browserDisconnected = false;
      browser.on('disconnected', () => {
        browserDisconnected = true;
        log.error("BROWSER", "Przeglądarka została rozłączona (crash/OOM/timeout)!");
      });

      // Funkcja helper do sprawdzania czy browser żyje
      const isBrowserAlive = () => {
        if (browserDisconnected) return false;
        try {
          return browser.isConnected();
        } catch {
          return false;
        }
      };

      // Funkcja do bezpiecznego tworzenia nowej strony z sprawdzeniem browsera
      const safeNewPage = async () => {
        if (!isBrowserAlive()) {
          throw new Error("Browser disconnected - cannot create new page");
        }
        return await ctx.newPage();
      };

      ctx = await browser.createBrowserContext(); // izolacja sesji per cykl (stabilniej niż default)

      // ====== LOGIN FLOW na osobnym page (jednorazowy) ======
      {
        const loginPage = await safeNewPage();
        await setupLightweightPage(loginPage);

        await loadCookies(loginPage);
        await loginPage.goto("https://www.facebook.com/", { waitUntil: "load", timeout: 60000 }).catch(() => {});
        let loggedIn = await checkIfLogged(loginPage);

        // CHECKPOINT DETECTION (tylko alert) — zostawiam Twój flow
        const checkpoint = await isCheckpoint(loginPage);
        if (checkpoint) {
          const checkpointType = await getCheckpointType(loginPage);
          log.warn("CHECKPOINT", `Wykryto checkpoint: ${checkpointType}`);

          if (CAPTCHA_ENABLED) {
            const captchaResult = await solveCaptchaIfPresent(loginPage);
            if (captchaResult.solved) {
              log.success("CAPTCHA", "Captcha rozwiązana!");
              await new Promise((r) => setTimeout(r, 2000));
              loggedIn = await checkIfLogged(loginPage);
              if (!loggedIn) {
                await fbLogin(loginPage);
                loggedIn = await checkIfLogged(loginPage);
              }
            }
          }

          if (!loggedIn) {
            await sendOwnerAlert(
              "CHECKPOINT - Wymagana interwencja",
              `Facebook wymaga weryfikacji tożsamości.\n\n` +
                `Typ: ${checkpointType}\n\n` +
                `Wymagane działanie:\n` +
                `1. Zaloguj się ręcznie i zaktualizuj cookies.json\n` +
                `2. Zmień dane logowania w .env jeśli potrzeba\n` +
                `3. PM2 automatycznie wznowi pracę`
            );

            if (REMOTE_DEBUG_PORT > 0) {
              log.warn("CHECKPOINT", "=== REMOTE DEBUG MODE ===");
              log.warn("CHECKPOINT", "Przeglądarka czeka na ręczną interwencję.");
              log.warn("CHECKPOINT", "Sprawdzam co 30s czy jesteś zalogowany...");

              const MAX_WAIT_2FA_MS = 30 * 60 * 1000;
              const startWait2FA = Date.now();
              while (true) {
                if (Date.now() - startWait2FA > MAX_WAIT_2FA_MS) {
                  log.error("CHECKPOINT", "Timeout oczekiwania na 2FA (30 min) - restart procesu");
                  await sendOwnerAlert(
                    "TIMEOUT 2FA",
                    "Przekroczono 30 minut oczekiwania na ręczną interwencję. Proces zostanie zrestartowany."
                  );
                  process.exit(1);
                }
                await new Promise((r) => setTimeout(r, 30000));
                const nowLogged = await checkIfLogged(loginPage).catch(() => false);
                if (nowLogged) {
                  log.success("CHECKPOINT", "Wykryto sesję! Zapisuję cookies i kontynuuję...");
                  await saveCookies(loginPage);
                  loggedIn = true;
                  break;
                }
                const remainingMin = Math.round((MAX_WAIT_2FA_MS - (Date.now() - startWait2FA)) / 60000);
                log.dev("CHECKPOINT", `Nadal brak sesji - czekam... (pozostało ~${remainingMin} min)`);
              }
            } else {
              log.error("CHECKPOINT", "Wymagana interwencja - zatrzymuję proces");
              process.exit(1);
            }
          }
        }

        if (!loggedIn) {
          log.dev("LOGIN", "Brak sesji – logowanie...");
          const LOGIN_TIMEOUT_MS = 120000;
          try {
            await Promise.race([
              fbLogin(loginPage),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Login timeout (2 min)")), LOGIN_TIMEOUT_MS)),
            ]);
          } catch (loginErr) {
            log.error("LOGIN", `Błąd logowania: ${loginErr.message}`);
            await sendOwnerAlert("LOGIN ERROR", `Logowanie nie powiodło się: ${loginErr.message}`);
            throw loginErr;
          }

          loggedIn = await checkIfLogged(loginPage);

          const checkpointAfterLogin = await isCheckpoint(loginPage);
          if (checkpointAfterLogin) {
            const checkpointType = await getCheckpointType(loginPage);
            log.warn("CHECKPOINT", `Checkpoint po logowaniu: ${checkpointType}`);

            await sendOwnerAlert("CHECKPOINT po logowaniu", `Facebook wymaga weryfikacji po próbie logowania.\n\nTyp: ${checkpointType}`);

            if (REMOTE_DEBUG_PORT > 0) {
              log.warn("CHECKPOINT", "=== REMOTE DEBUG MODE ===");
              log.warn("CHECKPOINT", "Zrób 2FA/checkpoint w chrome://inspect. Sprawdzam co 30s...");

              const MAX_WAIT_2FA_MS_LOGIN = 30 * 60 * 1000;
              const startWait2FALogin = Date.now();
              while (true) {
                if (Date.now() - startWait2FALogin > MAX_WAIT_2FA_MS_LOGIN) {
                  log.error("CHECKPOINT", "Timeout oczekiwania na 2FA po logowaniu (30 min) - restart procesu");
                  await sendOwnerAlert(
                    "TIMEOUT 2FA LOGIN",
                    "Przekroczono 30 minut oczekiwania na ręczną interwencję po logowaniu. Proces zostanie zrestartowany."
                  );
                  process.exit(1);
                }
                await new Promise((r) => setTimeout(r, 30000));
                const nowLogged = await checkIfLogged(loginPage).catch(() => false);
                if (nowLogged) {
                  log.success("CHECKPOINT", "Wykryto sesję! Zapisuję cookies i kontynuuję...");
                  await saveCookies(loginPage);
                  loggedIn = true;
                  break;
                }
                const remainingMinLogin = Math.round((MAX_WAIT_2FA_MS_LOGIN - (Date.now() - startWait2FALogin)) / 60000);
                log.dev("CHECKPOINT", `Nadal brak sesji - czekam... (pozostało ~${remainingMinLogin} min)`);
              }
            } else {
              process.exit(1);
            }
          }

          if (loggedIn) {
            log.success("LOGIN", "Zalogowano pomyślnie");
            await saveCookies(loginPage);
          } else {
            log.error("LOGIN", "Logowanie nieudane");
          }
        } else {
          log.dev("LOGIN", "Użyto istniejącej sesji");
        }

        await safeClosePage(loginPage);
      }

      // ============ LITE: Warmup Session ============
      if (WARMUP_ENABLED && isFirstCycleOfSession) {
        const warmupPage = await safeNewPage();
        await setupLightweightPage(warmupPage);
        await loadCookies(warmupPage).catch(() => {});

        const warmupDuration = getRandomWarmupDuration(WARMUP_DURATION_MIN_MS, WARMUP_DURATION_MAX_MS);
        log.prod("LITE", `Warmup: ${Math.round(warmupDuration / 60000)} min`);

        try {
          const warmupResult = await warmupSession(warmupPage, warmupDuration);
          log.dev("LITE", `Warmup zakończony: ${warmupResult.actions.join(", ")}`);
        } catch (warmupErr) {
          log.dev("LITE", `Warmup błąd: ${warmupErr.message}`);
        }

        await safeClosePage(warmupPage);
        isFirstCycleOfSession = false;
      }

      // ============ LITE: Feed Scan (losowo 30-50% szans) ============
      // Ładowanie keywords z pliku JSON (dynamicznie przy każdym cyklu)
      const keywordsData = loadKeywordsFromFile();
      const activeKeywords = getActiveKeywords(); // tylko keywords z enabled: true
      const feedScanEnabled = keywordsData.enabled && activeKeywords.length > 0;

      if (feedScanEnabled) { // TEST: zawsze uruchamiaj (było: Math.random() < 0.4)
        const feedPage = await safeNewPage();
        await setupLightweightPage(feedPage);
        await loadCookies(feedPage).catch(() => {});

        const keywords = activeKeywords;
        const watchedUrls = currentPosts.map(p => p.url);

        log.prod("LITE", `Feed Scan: ${keywords.length} aktywnych keywords`);

        try {
          const scanResult = await scanFeed(feedPage, {
            keywords,
            watchedUrls,
            scrollDurationMin: FEED_SCROLL_DURATION_MIN,
            scrollDurationMax: FEED_SCROLL_DURATION_MAX,
            likeChance: HUMAN_RANDOM_LIKE_CHANCE,
            onDiscovery: DISCOVERY_TELEGRAM_ENABLED ? async (discovery) => {
              await sendOwnerAlert(
                "Nowe Discovery",
                `Znaleziono post z keywords!\n\n` +
                `Strona: ${discovery.pageName}\n` +
                `Keywords: ${discovery.matchedKeywords.join(", ")}\n` +
                `URL: ${discovery.url}\n\n` +
                `Treść: ${discovery.content.substring(0, 200)}...`
              );
            } : null,
          });

          if (scanResult.discoveries.length > 0) {
            log.prod("LITE", `Feed Scan: ${scanResult.discoveries.length} nowych discoveries`);
          }
        } catch (scanErr) {
          log.dev("LITE", `Feed Scan błąd: ${scanErr.message}`);
        }

        await safeClosePage(feedPage);
      }

      if (!currentPosts.length) {
        log.warn("WATCHER", "Brak aktywnych postów do monitorowania");
      } else {
        // Filtruj martwe posty przed przetwarzaniem
        const livePostsToProcess = currentPosts.filter(p => !isDeadPost(p.id));
        const skippedDeadCount = currentPosts.length - livePostsToProcess.length;
        if (skippedDeadCount > 0) {
          log.prod("DEAD-POSTS", `Pominięto ${skippedDeadCount} martwych postów (${livePostsToProcess.length} aktywnych)`);
        } else {
          log.prod("WATCHER", `Przetwarzam ${livePostsToProcess.length} postów (0 martwych)`);
        }

        const shuffledPosts = shuffleArray(livePostsToProcess);
        const postOrder = shuffledPosts.map((p) => p.name || p.id.slice(0, 8)).join(" → ");
        log.dev("HUMAN", `Kolejność postów: ${postOrder}`);

        let postIndex = 0;
        let lastPostPage = null; // Referencja do ostatniego page dla akcji między postami

        for (const post of shuffledPosts) {
          // === CRASH PROTECTION: Sprawdź czy browser żyje przed każdym postem ===
          if (!isBrowserAlive()) {
            log.error("BROWSER", "Browser martwy - przerywam przetwarzanie postów, restart w następnym cyklu");
            break; // wyjdź z pętli postów, cykl się zakończy i browser zostanie zrestartowany
          }

          // === CRASH PREVENTION: Proaktywny recykling gdy pamięć wysoka ===
          const memCheck = getSystemMemoryMB();
          if (memCheck.percent > 80) {
            log.warn("MEMORY", `Wysoka pamięć (${memCheck.percent}%) - wymuszam recykling browsera`);

            // Usuń listener przed zamknięciem (zapobiega fałszywym alarmom)
            browser.removeAllListeners('disconnected');
            await safeCloseContext(ctx);
            await safeCloseBrowser(browser);

            if (global.gc) global.gc();
            await new Promise(r => setTimeout(r, 3000));

            browser = await puppeteer.launch(buildLaunchOptions());
            browserDisconnected = false;
            browser.on('disconnected', () => {
              browserDisconnected = true;
              log.error("BROWSER", "Przeglądarka została rozłączona (crash/OOM/timeout)!");
            });
            ctx = await browser.createBrowserContext();

            const reloginPage = await ctx.newPage();
            await setupLightweightPage(reloginPage);
            await loadCookies(reloginPage);
            await reloginPage.goto("https://www.facebook.com/", { waitUntil: "load", timeout: 60000 }).catch(() => {});
            await saveCookies(reloginPage).catch(() => {});
            await safeClosePage(reloginPage);

            const afterMem = getSystemMemoryMB();
            log.prod("MEMORY", `Po recyklingu: ${afterMem.percent}%`);
          }

          postIndex++;

          // === CRASH PREVENTION: Recykling browsera co N postów ===
          if (BROWSER_RECYCLE_EVERY_POSTS > 0 && postIndex > 1 && (postIndex - 1) % BROWSER_RECYCLE_EVERY_POSTS === 0) {
            const sysMem = getSystemMemoryMB();
            log.prod("BROWSER", `Prewencyjny recykling po ${postIndex - 1} postach (mem: ${sysMem.percent}%)`);

            // Zamknij stary browser (usuń listener przed zamknięciem)
            browser.removeAllListeners('disconnected');
            await safeCloseContext(ctx);
            await safeCloseBrowser(browser);

            // Wymuś garbage collection jeśli dostępne
            if (global.gc) {
              global.gc();
              log.dev("MEMORY", "Garbage collection wykonane");
            }

            // Krótka pauza przed restartem
            await new Promise(r => setTimeout(r, 2000));

            // Utwórz nowy browser
            browser = await puppeteer.launch(buildLaunchOptions());
            browserDisconnected = false;
            browser.on('disconnected', () => {
              browserDisconnected = true;
              log.error("BROWSER", "Przeglądarka została rozłączona (crash/OOM/timeout)!");
            });
            ctx = await browser.createBrowserContext();

            // Zaloguj ponownie w nowej sesji
            const reloginPage = await ctx.newPage();
            await setupLightweightPage(reloginPage);
            await loadCookies(reloginPage);
            await reloginPage.goto("https://www.facebook.com/", { waitUntil: "load", timeout: 60000 }).catch(() => {});
            const stillLogged = await checkIfLogged(reloginPage).catch(() => false);
            if (stillLogged) {
              await saveCookies(reloginPage);
              log.dev("BROWSER", "Sesja FB zachowana po recyklingu");
            } else {
              log.warn("BROWSER", "Utracono sesję FB po recyklingu - próbuję zalogować");
              // Tu można dodać pełne logowanie, ale na razie kontynuuj z cookies
            }
            await safeClosePage(reloginPage);

            const newMem = getSystemMemoryMB();
            log.prod("BROWSER", `Recykling zakończony (mem: ${newMem.percent}%)`);
          }

          const cacheKey = getCacheKey(post);
          const postLabel = post.name || post.id.slice(0, 8);

          // ======= klucz: NOWY PAGE PER POST + retry na NOWYM PAGE =======
          let attempt = 0;
          let done = false;

          while (!done && attempt <= MAX_POST_RETRY) {
            // === CRASH PROTECTION: Sprawdź przed każdą próbą ===
            if (!isBrowserAlive()) {
              log.error("BROWSER", `Browser martwy podczas przetwarzania ${postLabel} - przerywam`);
              done = true;
              break;
            }

            attempt++;

            let page = null;
            try {
              page = await safeNewPage();
              lastPostPage = page; // Zapisz referencję do page
              await setupLightweightPage(page);

              // Jeżeli chcesz, możesz tu też ładować cookies per page (nie jest konieczne w obrębie tego samego contextu,
              // ale bywa stabilniej przy FB). Zostawiam jako opcję.
              if (envBool("LOAD_COOKIES_EACH_PAGE", false)) {
                await loadCookies(page).catch(() => {});
              }

              // LITE: Przerwa między postami (1-3 min) - wykonywana na NOWEJ stronie
              if (HUMAN_MODE) {
                if (postIndex > 1) {
                  log.prod("LITE", `=== Między postami (${postIndex - 1}/${shuffledPosts.length}) ===`);

                  // Długa przerwa 1-3 min z szansą na scrollowanie głównej
                  const pauseResult = await humanBehavior.betweenPostsPause(page);

                  log.prod("LITE", `[PAUZA] Wynik: ${(pauseResult.totalTime / 1000).toFixed(0)}s total, ` +
                    `home=${pauseResult.homeFeedVisited}, scroll=${(pauseResult.scrollTime / 1000).toFixed(0)}s`);
                } else {
                  log.prod("LITE", `=== Pierwszy post w cyklu ===`);
                }

                // Ruchy myszy przed nawigacją do posta
                log.dev("LITE", "[MOUSE] Ruchy myszy przed nawigacją");
                await performMouseMovements(page, 2 + Math.floor(Math.random() * 3));
              }

              log.prod("NAV", `→ ${postLabel} (attempt ${attempt}/${MAX_POST_RETRY + 1})`);
              await prepare(page, post.url);

              // ==================== FAST_MODE BRANCH ====================
              if (FAST_MODE) {
                const knownSet = getKnownSetForPost(cacheKey);
                const isFirstRun = !lastCounts.has(cacheKey);

                const switchResult = await switchCommentsFilterToNewest(page, post.url).catch(() => ({ ok: false }));

                if (!switchResult.ok) {
                  log.dev("FAST", `${postLabel}: Fallback do normalnego trybu`, { reason: switchResult.reason });
                } else {
                  await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));

                  const snapshot = await extractCommentsData(page, post.url).catch(() => []);
                  const sample = snapshot.slice(0, 30);

                  log.dev("FAST", `${postLabel}: ${sample.length} komentarzy (sort=Najnowsze)`);

                  if (isFirstRun) {
                    lastCounts.set(cacheKey, sample.length);
                    for (const c of sample) if (c?.id) knownSet.add(c.id);
                    log.dev("FAST", `${postLabel}: Inicjalizacja - zapamiętano ${sample.length}`);
                    done = true;
                    continue;
                  }

                  // Pobierz czas najnowszego komentarza (do statystyk i dead-post detection)
                  const newestTimeRaw = sample.length > 0 ? (sample[0]?.time || sample[0]?.fb_time_raw) : null;

                  if (sample.length > 0 && newestTimeRaw) {
                    const newestAge = getCommentAgeMinutes(newestTimeRaw);

                    if (newestAge !== null && newestAge > FAST_MAX_AGE_MIN) {
                      log.dev("FAST", `${postLabel}: SKIP - najnowszy ${Math.round(newestAge)} min`, { limit: FAST_MAX_AGE_MIN });
                      // Zapisz stats nawet przy SKIP (żeby mieć czas ostatniego komentarza)
                      updatePostStats(cacheKey, 0, newestTimeRaw);
                      await checkDeadPost(post);
                      done = true;
                      continue;
                    }
                  }

                  const newComments = [];
                  for (const c of sample) {
                    if (!c?.id) continue;
                    if (!knownSet.has(c.id)) {
                      knownSet.add(c.id);
                      newComments.push(c);
                      c.__postId = post.id;
                      c.__postUrl = post.url;
                    }
                  }

                  cleanupKnownIds(knownSet);

                  let sentCount = 0;
                  if (newComments.length > 0) {
                    log.dev("FAST", `${postLabel}: znaleziono ${newComments.length} nowych`);

                    const safeComments = newComments.filter((c) => c.__postId === post.id);
                    if (safeComments.length !== newComments.length) {
                      log.warn("FAST", "Odfiltrowano komentarze spoza posta", {
                        before: newComments.length,
                        after: safeComments.length,
                      });
                    }
                    sentCount = await sendTelegramIfFresh(post, safeComments, "fast");
                    if (sentCount > 0) {
                      log.success("FAST", `${postLabel}: +${sentCount} wysłanych`);
                    }
                    newCommentsTotal += sentCount;
                  } else {
                    log.dev("FAST", `${postLabel}: Brak nowych`);
                  }

                  // STATS: Aktualizuj statystyki per post (z czasem najnowszego komentarza)
                  updatePostStats(cacheKey, sentCount, newestTimeRaw);

                  // DEAD POST: Sprawdź czy post jest martwy
                  await checkDeadPost(post);

                  done = true;
                  continue;
                }
              }
              // ==================== KONIEC FAST_MODE ====================

              const count = await getCommentCount(page, post.url);
              const hasCount = typeof count === "number" && Number.isFinite(count);

              if (!hasCount) {
                log.dev("WATCHER", `${postLabel}: Brak licznika - tryb awaryjny`);
              }

              const prev = lastCounts.has(cacheKey) ? lastCounts.get(cacheKey) : null;
              const knownSet = getKnownSetForPost(cacheKey);

              if (prev === null) {
                const initialCount = hasCount ? count : 0;
                lastCounts.set(cacheKey, initialCount);

                log.dev("WATCHER", `${postLabel}: Inicjalizacja (${initialCount} komentarzy)`);

                if (EXPAND_COMMENTS) {
                  await loadAllComments(page, { expectedTotal: hasCount ? count : undefined }, post.url).catch(() => {});
                  const snap = await extractCommentsData(page, post.url).catch(() => []);
                  for (const c of snap) if (c?.id) knownSet.add(c.id);
                  log.dev("WATCHER", `${postLabel}: Zapamiętano ${snap.length} istniejących`);
                }

                done = true;
                continue;
              }

              if (hasCount) {
                if (count !== prev) {
                  log.dev("WATCHER", `${postLabel}: Zmiana ${prev} → ${count}`);
                  lastCounts.set(cacheKey, count);
                } else {
                  log.dev("WATCHER", `${postLabel}: Bez zmian (${count})`);
                }
              }

              if (!EXPAND_COMMENTS) {
                done = true;
                continue;
              }

              await loadAllComments(page, { expectedTotal: hasCount ? count : undefined }).catch(() => {});
              const snapshot = await extractCommentsData(page, post.url).catch(() => []);

              // Pobierz czas najnowszego komentarza (do statystyk i dead-post detection)
              const snapshotNewestTime = snapshot.length > 0 ? (snapshot[0]?.time || snapshot[0]?.fb_time_raw) : null;

              const newComments = [];
              for (const c of snapshot) {
                if (!c?.id) continue;
                if (!knownSet.has(c.id)) {
                  knownSet.add(c.id);
                  newComments.push(c);
                  c.__postId = post.id;
                  c.__postUrl = post.url;
                }
              }

              cleanupKnownIds(knownSet);

              log.debug("DEDUP", `${postLabel}: context`, {
                snapshotLen: snapshot.length,
                newLen: newComments.length,
              });

              if (hasCount && newComments.length === 0 && count > prev) {
                const diff = Math.max(1, count - prev);
                const tail = snapshot.slice(-diff);
                for (const c of tail) if (c?.id) knownSet.add(c.id);

                log.dev("WATCHER", `${postLabel}: Fallback - biorę ostatnie ${diff}`);
                const sentCount = await sendTelegramIfFresh(post, tail, "fallback");
                if (sentCount > 0) {
                  log.success("WATCHER", `${postLabel}: +${sentCount} wysłanych (fallback)`);
                }
                newCommentsTotal += sentCount;

                // STATS: Aktualizuj statystyki per post (fallback - z czasem najnowszego komentarza)
                updatePostStats(cacheKey, sentCount, snapshotNewestTime);
                await checkDeadPost(post);

                done = true;
                continue;
              }

              let sentCount = 0;
              if (newComments.length > 0) {
                log.dev("WATCHER", `${postLabel}: znaleziono ${newComments.length} nowych`);

                const safeComments = newComments.filter((c) => c.__postId === post.id);
                if (safeComments.length !== newComments.length) {
                  log.warn("WATCHER", "Odfiltrowano komentarze spoza posta", {
                    before: newComments.length,
                    after: safeComments.length,
                  });
                }
                sentCount = await sendTelegramIfFresh(post, safeComments, "normal");
                if (sentCount > 0) {
                  log.success("WATCHER", `${postLabel}: +${sentCount} wysłanych`);
                }
                newCommentsTotal += sentCount;
              }

              // STATS: Aktualizuj statystyki per post (normal mode - z czasem najnowszego komentarza)
              updatePostStats(cacheKey, sentCount, snapshotNewestTime);
              await checkDeadPost(post);

              // sukces → reset liczników hard fail
              consecutiveHardFails = 0;

              // LITE: Losowe akcje tła po przetworzeniu posta
              if (HUMAN_MODE && page) {
                try {
                  log.dev("LITE", "[BACKGROUND] Sprawdzam losowe akcje...");
                  const bgResult = await executeRandomBackgroundActions(page, humanBehavior.config);
                  if (bgResult.actions.length > 0) {
                    log.prod("LITE", `[BACKGROUND] Wykonano: ${bgResult.actions.join(", ")}`);
                  }

                  // Losowy ruch myszy na koniec (60% szans)
                  if (Math.random() < 0.6) {
                    log.dev("LITE", "[MOUSE] Końcowe ruchy myszy");
                    await performMouseMovements(page, 1 + Math.floor(Math.random() * 2));
                  }
                } catch (bgErr) {
                  log.debug("LITE", `Background actions błąd: ${bgErr.message}`);
                }
              }

              done = true;
            } catch (err) {
              errorsCount++;
              const c = classifyError(err);

              log.error("WATCHER", `Błąd przy ${postLabel} (attempt ${attempt}): ${err?.message || err}`);
              log.debug("WATCHER", "Stack", { stack: err?.stack });

              if (c.hardFail) {
                hadNavErrorThisRound = true;
                navErrorCount++;
                consecutiveHardFails++;

                log.warn("WATCHER", "HardFail klasyfikacja", {
                  navErrorCount: `${navErrorCount}/${MAX_NAV_ERRORS}`,
                  consecutiveHardFails,
                  isTargetClosed: c.isTargetClosed,
                  isContext: c.isContext,
                  isFrame: c.isFrame,
                  isNavigation: c.isNavigation,
                });

                // Jeśli wygląda jak padnięty browser/target → szybka eskalacja
                if (c.isTargetClosed) {
                  // Nie ma sensu retry na tym samym browser/context
                  attempt = MAX_POST_RETRY + 1; // kończ retry
                }
              }

              // retry tylko jeśli zostały próby
              if (attempt <= MAX_POST_RETRY) {
                log.warn("WATCHER", `${postLabel}: retry na świeżym page...`);
              } else {
                log.warn("WATCHER", `${postLabel}: brak retry — idę dalej`);
                done = true;
              }

              // === CRASH PROTECTION: Natychmiastowa reakcja na disconnect ===
              if (!isBrowserAlive() || c.isTargetClosed) {
                log.error("BROWSER", "Browser disconnected - natychmiastowy restart");
                browser.removeAllListeners('disconnected');
                await safeCloseContext(ctx);
                await safeCloseBrowser(browser);

                // Utwórz nowy browser z nowym listenerem
                browser = await puppeteer.launch(buildLaunchOptions());
                browserDisconnected = false; // reset flagi
                browser.on('disconnected', () => {
                  browserDisconnected = true;
                  log.error("BROWSER", "Przeglądarka została rozłączona (crash/OOM/timeout)!");
                });
                ctx = await browser.createBrowserContext();
                consecutiveHardFails = 0;
                log.prod("BROWSER", "Browser zrestartowany pomyślnie");
              }
              // Eskalacje globalne (legacy - zachowane dla innych błędów)
              else if (consecutiveHardFails >= HARD_FAILS_RESET_BROWSER) {
                log.error("WATCHER", `Eskalacja: reset BROWSER (consecutiveHardFails=${consecutiveHardFails})`);
                browser.removeAllListeners('disconnected');
                await safeCloseContext(ctx);
                await safeCloseBrowser(browser);

                browser = await puppeteer.launch(buildLaunchOptions());
                browserDisconnected = false;
                browser.on('disconnected', () => {
                  browserDisconnected = true;
                  log.error("BROWSER", "Przeglądarka została rozłączona (crash/OOM/timeout)!");
                });
                ctx = await browser.createBrowserContext();
                consecutiveHardFails = 0;
              } else if (consecutiveHardFails >= HARD_FAILS_RESET_CONTEXT && isBrowserAlive()) {
                log.error("WATCHER", `Eskalacja: reset CONTEXT (consecutiveHardFails=${consecutiveHardFails})`);
                await safeCloseContext(ctx);
                ctx = await browser.createBrowserContext();
                consecutiveHardFails = 0;
              }

              if (isNavigationError(err)) {
                hadNavErrorThisRound = true;
              }
            } finally {
              // ważne: zamknij page po każdej próbie
              // (page może nie istnieć jeśli padło przed newPage)
              // safeClosePage jest w try/catch, więc OK
              // NOTE: page jest w scope try — tu nie mamy do niego dostępu; więc zamykamy przez "finally" w try
              // Zrobione niżej w bloku try: close page w finally per próba:
              await safeClosePage(page);
            }
          }
        }
      }
    } catch (err) {
      errorsCount++;
      log.error("WATCHER", `Błąd w cyklu: ${err?.message || err}`);
    } finally {
      flushCacheToDisk();

      // STATS: Aktualizuj globalne statystyki po cyklu
      updateGlobalStats(newCommentsTotal);

      if (!hadNavErrorThisRound && navErrorCount > 0) {
        log.dev("WATCHER", `Reset licznika błędów nawigacji (było ${navErrorCount})`);
        navErrorCount = 0;
      }

      // Usuń listener przed zamknięciem (zapobiega fałszywym alarmom na końcu cyklu)
      browser.removeAllListeners('disconnected');
      await safeCloseContext(ctx);
      await safeCloseBrowser(browser);

      const duration = Date.now() - cycleStart;
      const cacheSize = getCacheSize();
      const cacheEntries = getCacheEntryCount();
      const totalKnownIds = getTotalKnownIdsCount();

      log.cycleSummary({
        cycle: cycleNumber,
        posts: currentPosts.length,
        newComments: newCommentsTotal,
        duration,
        errors: errorsCount,
        cacheSize,
        cacheEntries,
        totalKnownIds,
      });

      if (cacheSize > 10 * 1024 * 1024) {
        log.warn("CACHE", `Rozmiar cache przekroczył 10MB: ${Math.round(cacheSize / 1024 / 1024)}MB`);
      }

      if (navErrorCount >= MAX_NAV_ERRORS) {
        log.error("WATCHER", "Za dużo błędów nawigacji – kończę proces");
        process.exit(1);
      }

      // prewencyjny "cycle recycle" (opcjonalnie)
      if (BROWSER_RECYCLE_EVERY_CYCLES > 0 && cycleNumber % BROWSER_RECYCLE_EVERY_CYCLES === 0) {
        log.prod("WATCHER", `Prewencja: cycle recycle aktywny (co ${BROWSER_RECYCLE_EVERY_CYCLES} cykli)`);
      }

      // LITE: Aktualizuj czas ostatniego sprawdzenia
      lastCheckTime = new Date();

      // LITE: Sprawdź czy sesja powinna się zakończyć
      // (browser jest już zamknięty w finally - przy następnym cyklu zostanie utworzony nowy)
      if (sessionFingerprint && shouldEndSession(sessionStartTime, sessionFingerprint.sessionLength)) {
        log.prod("LITE", "Koniec sesji - następny cykl z nową sesją");
        sessionFingerprint = null;
      }

      // LITE: Losowy interwał z wariancją
      const delay = getRandomizedInterval(CHECK_INTERVAL_MS);

      // LITE: Info o night mode
      if (NIGHT_MODE_ENABLED) {
        const sleepInfo = getNextSleepInfo(NIGHT_START_HOUR, NIGHT_END_HOUR);
        log.dev("LITE", sleepInfo);
      }

      log.dev("WATCHER", `Następny cykl za ${Math.round(delay / 1000)}s`);
      setTimeout(loop, delay);
    }
  };

  loop();
}

export { startWatcher };
