// src/lite/index.js
// FB_Watcher LITE - główny moduł eksportujący

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
 * Konfiguracja LITE z env
 */
export function getLiteConfig() {
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

    // Feed Scanner
    feedScanEnabled: process.env.FEED_SCAN_ENABLED === "true",
    feedScanKeywords: (process.env.FEED_SCAN_KEYWORDS || "").split(",").map(k => k.trim()).filter(Boolean),
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
