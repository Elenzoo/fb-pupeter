// src/lite/index.js
// FB_Watcher LITE - główny moduł eksportujący

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const KEYWORDS_PATH = path.join(DATA_DIR, "keywords.json");

// Anti-Detection
export {
  getRandomViewport,
  getRandomSessionLength,
  getActivityMultiplier,
  getAdaptiveDelay,
  getRandomizedInterval,
  shouldEndSession,
  getRandomUserAgent,
  generateSessionFingerprint,
} from "./antiDetection.js";

// Smooth Scroll
export {
  smoothScrollBy,
  smoothScrollToElement,
  feedScrollSession,
  smoothScrollToTop,
  isElementInViewport,
} from "./smoothScroll.js";

// User Mistakes
export {
  humanTypeWithMistakes,
  maybeGoBack,
  maybeScrollWrongDirection,
  maybeMisclick,
  executeRandomMistakes,
} from "./userMistakes.js";

// Warmup
export {
  warmupSession,
  getRandomWarmupDuration,
} from "./warmup.js";

// Tab Simulation
export {
  maybeSimulateTabSwitch,
  maybeSimulateBlur,
  simulateAttentionBreak,
} from "./tabSimulation.js";

// Profile Visitor
export {
  maybeVisitProfile,
  viewProfilePhotos,
  findProfileLinks,
  visitRandomVisibleProfile,
} from "./profileVisitor.js";

// Image Interaction
export {
  hoverElement,
  maybeInteractWithImage,
  findVisibleImages,
  maybeInteractWithRandomImage,
  browsePhotoGallery,
  maybeLikePhoto,
} from "./imageInteraction.js";

// Human Behavior (koordynator)
export {
  DEFAULT_CONFIG as HUMAN_CONFIG,
  preAction,
  postAction,
  humanized,
  humanClick,
  humanNavigate,
  betweenPostsPause,
  executeRandomBackgroundActions,
  humanType,
  readingPause,
  mouseJiggle,
  createHumanBehavior,
} from "./humanBehavior.js";

// Random Actions
export {
  maybeRandomLike,
  contentBasedPause,
  maybeMicroBreak,
  maybeExpandSeeMore,
  maybeViewReactions,
  executeRandomActions,
} from "./randomActions.js";

// Night Mode
export {
  isNightTime,
  getTimeUntilWake,
  nightModeSleep,
  shouldCatchUp,
  getCatchUpMaxAge,
  handleNightMode,
  getNextSleepInfo,
} from "./nightMode.js";

// Keyword Matcher
export {
  normalizeText,
  parseKeywords,
  matchKeywords,
  hasAnyKeyword,
  highlightKeywords,
  extractKeywordContext,
  createKeywordMatcher,
} from "./keywordMatcher.js";

// Feed Scanner
export {
  loadDiscoveries,
  saveDiscoveries,
  loadBlacklist,
  saveBlacklist,
  scanFeed,
  approveDiscovery,
  rejectDiscovery,
  removeFromBlacklist,
  addToBlacklist,
} from "./feedScanner.js";

/**
 * @typedef {Object} KeywordEntry
 * @property {string} text - tekst keyword
 * @property {boolean} enabled - czy keyword jest aktywny
 */

/**
 * @typedef {Object} KeywordsData
 * @property {KeywordEntry[]} keywords - lista keywords z flagą enabled
 * @property {boolean} enabled - globalny switch skanowania
 */

/**
 * Ładuje keywords z pliku JSON
 * Obsługuje zarówno nowy format (obiekty) jak i stary (stringi) dla backward compat
 * @returns {KeywordsData}
 */
export function loadKeywordsFromFile() {
  try {
    if (!fs.existsSync(KEYWORDS_PATH)) {
      return { keywords: [], enabled: false };
    }
    const raw = fs.readFileSync(KEYWORDS_PATH, "utf8").trim();
    if (!raw) return { keywords: [], enabled: false };
    const data = JSON.parse(raw);

    // Normalizacja - obsługa starego formatu (string[]) i nowego ({ text, enabled }[])
    let keywords = [];
    if (Array.isArray(data.keywords)) {
      keywords = data.keywords.map(k => {
        if (typeof k === "string") {
          // Stary format - konwertuj na nowy
          return { text: k, enabled: true };
        }
        // Nowy format
        return { text: String(k.text || ""), enabled: k.enabled !== false };
      }).filter(k => k.text);
    }

    return {
      keywords,
      enabled: Boolean(data.enabled),
    };
  } catch {
    return { keywords: [], enabled: false };
  }
}

/**
 * Zwraca tylko aktywne keywords jako tablicę stringów (do użycia w matcherze)
 * @returns {string[]}
 */
export function getActiveKeywords() {
  const data = loadKeywordsFromFile();
  if (!data.enabled) return [];
  return data.keywords.filter(k => k.enabled).map(k => k.text);
}

/**
 * Zapisuje keywords do pliku JSON
 * @param {KeywordsData} data
 */
export function saveKeywordsToFile(data) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(KEYWORDS_PATH, JSON.stringify(data, null, 2) + "\n");
}

/**
 * Migruje keywords ze starego formatu .env do keywords.json
 * Wywoływane przy starcie aplikacji
 */
export function migrateKeywordsFromEnv() {
  // Jeśli keywords.json już istnieje, sprawdź czy wymaga migracji do nowego formatu
  if (fs.existsSync(KEYWORDS_PATH)) {
    const data = loadKeywordsFromFile();
    // Jeśli już jest w nowym formacie, nic nie rób
    if (data.keywords.length > 0 && typeof data.keywords[0] === "object") {
      return false;
    }
  }

  const envKeywords = process.env.FEED_SCAN_KEYWORDS;
  if (!envKeywords && !fs.existsSync(KEYWORDS_PATH)) return false;

  // Jeśli plik istnieje ale w starym formacie, zmigruj
  if (fs.existsSync(KEYWORDS_PATH)) {
    const data = loadKeywordsFromFile();
    // loadKeywordsFromFile już konwertuje do nowego formatu
    saveKeywordsToFile(data);
    return true;
  }

  // Migracja z .env
  const keywords = envKeywords.split(",").map(k => k.trim()).filter(Boolean);
  if (keywords.length === 0) return false;

  const data = {
    keywords: keywords.map(text => ({ text, enabled: true })),
    enabled: process.env.FEED_SCAN_ENABLED === "true",
  };

  saveKeywordsToFile(data);
  return true;
}

/**
 * Konfiguracja LITE z env
 */
export function getLiteConfig() {
  // Spróbuj załadować keywords z pliku JSON
  const keywordsData = loadKeywordsFromFile();

  // Pobierz tylko aktywne keywords (enabled: true)
  let feedScanKeywords = keywordsData.keywords.filter(k => k.enabled).map(k => k.text);
  let feedScanEnabled = keywordsData.enabled;

  if (feedScanKeywords.length === 0 && !fs.existsSync(KEYWORDS_PATH)) {
    // Fallback na stary format .env tylko jeśli plik JSON nie istnieje
    feedScanKeywords = (process.env.FEED_SCAN_KEYWORDS || "").split(",").map(k => k.trim()).filter(Boolean);
    feedScanEnabled = process.env.FEED_SCAN_ENABLED === "true";
  }

  return {
    // Session Management
    sessionLengthMinMs: Number(process.env.SESSION_LENGTH_MIN_MS || 30 * 60 * 1000),
    sessionLengthMaxMs: Number(process.env.SESSION_LENGTH_MAX_MS || 90 * 60 * 1000),

    // Warmup
    warmupEnabled: process.env.WARMUP_ENABLED !== "false",
    warmupDurationMinMs: Number(process.env.WARMUP_DURATION_MIN_MS || 5 * 60 * 1000),
    warmupDurationMaxMs: Number(process.env.WARMUP_DURATION_MAX_MS || 10 * 60 * 1000),

    // Anti-Detection
    viewportRandomization: process.env.VIEWPORT_RANDOMIZATION !== "false",
    typingMistakesEnabled: process.env.TYPING_MISTAKES_ENABLED !== "false",
    typingMistakesChance: Number(process.env.TYPING_MISTAKES_CHANCE || 0.03),
    navigationMistakesEnabled: process.env.NAVIGATION_MISTAKES_ENABLED !== "false",
    profileVisitsEnabled: process.env.PROFILE_VISITS_ENABLED !== "false",
    profileVisitsChance: Number(process.env.PROFILE_VISITS_CHANCE || 0.08),
    tabSimulationEnabled: process.env.TAB_SIMULATION_ENABLED !== "false",
    tabSimulationChance: Number(process.env.TAB_SIMULATION_CHANCE || 0.10),
    imageInteractionEnabled: process.env.IMAGE_INTERACTION_ENABLED !== "false",
    imageInteractionChance: Number(process.env.IMAGE_INTERACTION_CHANCE || 0.15),

    // Night Mode
    nightModeEnabled: process.env.NIGHT_MODE_ENABLED === "true",
    nightStartHour: Number(process.env.NIGHT_START_HOUR || 22),
    nightEndHour: Number(process.env.NIGHT_END_HOUR || 7),
    nightCatchupHours: Number(process.env.NIGHT_CATCHUP_HOURS || 8),

    // Feed Scanner (z pliku JSON lub fallback na .env)
    feedScanEnabled,
    feedScanKeywords,
    feedScrollDurationMin: Number(process.env.FEED_SCROLL_DURATION_MIN || 1),
    feedScrollDurationMax: Number(process.env.FEED_SCROLL_DURATION_MAX || 3),

    // Random Actions
    humanRandomLikeChance: Number(process.env.HUMAN_RANDOM_LIKE_CHANCE || 0.20),

    // Telegram
    discoveryTelegramEnabled: process.env.DISCOVERY_TELEGRAM_ENABLED === "true",
  };
}

/**
 * Tworzy pełny human behavior z konfiguracją z env
 */
export function createLiteHumanBehavior() {
  const config = getLiteConfig();

  return createHumanBehavior({
    typingMistakesEnabled: config.typingMistakesEnabled,
    typingMistakesChance: config.typingMistakesChance,
    navigationMistakesEnabled: config.navigationMistakesEnabled,
    profileVisitsEnabled: config.profileVisitsEnabled,
    profileVisitsChance: config.profileVisitsChance,
    tabSimulationEnabled: config.tabSimulationEnabled,
    tabSimulationChance: config.tabSimulationChance,
    imageInteractionEnabled: config.imageInteractionEnabled,
    imageInteractionChance: config.imageInteractionChance,
  });
}
