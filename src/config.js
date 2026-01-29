// UWAGA: .env musi być załadowany PRZED importem tego modułu (przez bootstrap.js)

/* ==================== PANEL – NOWY SYSTEM ==================== */
/**
 * POSTS_JSON_PATH – ścieżka do pliku z postami zarządzanymi przez panel (domyślnie data/posts.json)
 */
const POSTS_JSON_PATH = process.env.POSTS_JSON_PATH || "data/posts.json";

/* ==================== PANEL API – ZDALNE POSTY ==================== */
/**
 * POSTS_API_URL – URL do API panelu (endpoint GET /api/posts)
 * Np.: POSTS_API_URL=http://twoj-serwer:3180/api/posts
 * Jeśli ustawione, watcher pobiera posty z panelu przez HTTP (priorytet nad plikiem i Sheets)
 */
const POSTS_API_URL = (process.env.POSTS_API_URL || "").trim();

/**
 * POSTS_API_TOKEN – Bearer token do autoryzacji API panelu
 * Musi być taki sam jak PANEL_TOKEN na serwerze
 */
const POSTS_API_TOKEN = (process.env.POSTS_API_TOKEN || "").trim();

/* ==================== GOOGLE SHEETS – NOWY SYSTEM ==================== */
/**
 * POSTS_SHEET_URL – URL do opublikowanego jako CSV arkusza z postami.
 * Np.:
 *  - w Google Sheets: Plik → Opublikuj w internecie → CSV
 *  - w .env: POSTS_SHEET_URL=https://docs.google.com/spreadsheets/d/....../pub?output=csv
 */
const POSTS_SHEET_URL = process.env.POSTS_SHEET_URL || "";

/**
 * POSTS_REFRESH_MS – co ile MILISEKUND watcher ma odświeżać listę postów (panel/sheets).
 * Np. domyślnie co 5 minut.
 */
const POSTS_REFRESH_MS = Number(
  process.env.POSTS_REFRESH_MS || 5 * 60 * 1000
);

/* ==================== STARY SYSTEM Z ENV (opcjonalny) ==================== */
/**
 * FB_POST_URLS = url1,url2,url3  (opcjonalne)
 * FB_POST_LABELS = nazwa1,nazwa2,nazwa3 (opcjonalne)
 * – tego teraz nie używa watcher, ale zostawiamy, żeby nic się nie wysypało,
 *   jakbyś kiedyś chciał to jeszcze wykorzystać.
 */

function getPostsFromEnv() {
  const raw = process.env.FB_POST_URLS || "";
  const urls = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return urls.map((url, index) => ({
    id: `post${index + 1}`,
    url,
  }));
}

function getPostLabelsFromEnv(posts) {
  const raw = process.env.FB_POST_LABELS || "";
  const labels = raw.split(",").map((s) => s.trim());

  const map = {};
  posts.forEach((post, idx) => {
    map[post.id] = labels[idx] || post.id;
  });
  return map;
}

const POSTS = getPostsFromEnv();
const POST_LABELS = getPostLabelsFromEnv(POSTS);

/**
 * UWAGA: Przy panelu (posts.json) brak źródeł jest normalny na start.
 * Nie robimy twardego exit — watcher ma żyć i po prostu nie monitorować niczego,
 * dopóki nie dodasz postów w panelu.
 */
if (!POSTS.length && !POSTS_SHEET_URL) {
  console.warn(
    "[CONFIG] Brak FB_POST_URLS i POSTS_SHEET_URL. Jeśli używasz panelu, dodaj posty w data/posts.json. Watcher będzie działał, ale nie ma co monitorować."
  );
}

/* ==================== OGÓLNE OPCJE WATCHERA ==================== */

// EXPAND_COMMENTS=false → tylko licznik komentarzy
const EXPAND_COMMENTS =
  process.env.EXPAND_COMMENTS === "false" ? false : true;

// NOWE: przełącznik refaktoru UI handlers
// USE_UI_HANDLERS=false → jedzie legacy
const USE_UI_HANDLERS =
  process.env.USE_UI_HANDLERS === "false" ? false : true;

// NOWE: przełącznik rozwijania odpowiedzi (replies)
// INCLUDE_REPLIES=false → nie klikamy "Wyświetl X odpowiedzi / replies"
const INCLUDE_REPLIES =
  process.env.INCLUDE_REPLIES === "false" ? false : true;

// co ile sekund lecimy po postach (podstawowy interwał)
// można nadpisać w .env: CHECK_INTERVAL_MS=60000
const CHECK_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 60000);

// FAST_MODE: szybki tryb - sortowanie "Najnowsze", bez loadAllComments
// FAST_MODE=true włącza, domyślnie false (stabilny tryb dedup)
const FAST_MODE = process.env.FAST_MODE === "true";

// FAST_MAX_AGE_MIN: limit wieku komentarzy w FAST_MODE (minuty)
// Komentarze starsze niż limit → skip posta (jeśli sort=Najnowsze)
const FAST_MAX_AGE_MIN = Number(process.env.FAST_MAX_AGE_MIN || 180);

/* ==================== LOGOWANIE ==================== */
/**
 * LOG_LEVEL – poziom szczegółowości logów:
 *   0 = SILENT - tylko błędy krytyczne
 *   1 = PROD   - status cykli, nowe komentarze, błędy (domyślny, do pracy na serwerze)
 *   2 = DEV    - szczegóły operacji, timings (do pracy przy kodzie)
 *   3 = DEBUG  - pełne dumpy, payloady, DOM info (hard debug)
 *
 * LOG_TIMESTAMPS – czy dodawać [HH:MM:SS] prefix (domyślnie true)
 * LOG_COLORS – czy kolorować logi w konsoli (domyślnie true)
 */
const LOG_LEVEL = Number(process.env.LOG_LEVEL ?? 1);
const LOG_TIMESTAMPS = process.env.LOG_TIMESTAMPS !== "false";
const LOG_COLORS = process.env.LOG_COLORS !== "false";

/* ==================== CAPTCHA SOLVER ==================== */
/**
 * CAPTCHA_API_KEY – klucz API do 2Captcha
 * Używany do automatycznego rozwiązywania captcha przy logowaniu
 */
const CAPTCHA_API_KEY = (process.env.CAPTCHA_API_KEY || "").trim();

/**
 * CAPTCHA_ENABLED – czy włączyć automatyczne rozwiązywanie captcha
 * Domyślnie: true jeśli CAPTCHA_API_KEY jest ustawiony
 */
const CAPTCHA_ENABLED = process.env.CAPTCHA_ENABLED !== "false" && !!CAPTCHA_API_KEY;

/* ==================== REMOTE DEBUG ==================== */
/**
 * REMOTE_DEBUG_PORT – port do zdalnego debugowania Chrome
 * Gdy ustawiony, możesz podłączyć się przez chrome://inspect
 * i widzieć/kontrolować przeglądarkę na żywo (2FA, checkpoint)
 *
 * Użycie:
 *   1. REMOTE_DEBUG_PORT=9222 node src/index.js
 *   2. SSH tunel: ssh -L 9222:localhost:9222 user@server
 *   3. W Chrome: chrome://inspect → Configure → localhost:9222
 */
const REMOTE_DEBUG_PORT = Number(process.env.REMOTE_DEBUG_PORT || 0);

/* ==================== HUMAN BEHAVIOR MODE ==================== */
/**
 * HUMAN_MODE – włącza symulację zachowań człowieka
 * - Wolniejsze wpisywanie (~120ms/znak zamiast 35ms)
 * - Losowa kolejność postów
 * - Pauzy między postami (3-8 sekund)
 * Domyślnie: true
 */
const HUMAN_MODE = process.env.HUMAN_MODE !== "false";

/**
 * PROXY_URL – URL do proxy HTTP/SOCKS5
 * Format: http://user:pass@host:port lub socks5://host:port
 * Zalecane: residential rotating proxy (Bright Data, Oxylabs, IPRoyal)
 */
const PROXY_URL = (process.env.PROXY_URL || "").trim();

/* ==================== FB_WATCHER LITE ==================== */
/**
 * SESSION_LENGTH_MIN_MS / SESSION_LENGTH_MAX_MS – zakres długości sesji
 * Bot restartuje przeglądarkę po losowym czasie w tym zakresie
 */
const SESSION_LENGTH_MIN_MS = Number(process.env.SESSION_LENGTH_MIN_MS || 30 * 60 * 1000);
const SESSION_LENGTH_MAX_MS = Number(process.env.SESSION_LENGTH_MAX_MS || 90 * 60 * 1000);

/**
 * WARMUP – sesja rozgrzewkowa przed monitorowaniem
 * Buduje "normalną" historię aktywności (scroll, profile, zdjęcia)
 */
const WARMUP_ENABLED = process.env.WARMUP_ENABLED !== "false";
const WARMUP_DURATION_MIN_MS = Number(process.env.WARMUP_DURATION_MIN_MS || 5 * 60 * 1000);
const WARMUP_DURATION_MAX_MS = Number(process.env.WARMUP_DURATION_MAX_MS || 10 * 60 * 1000);

/**
 * VIEWPORT_RANDOMIZATION – losowa rozdzielczość przy każdej sesji
 */
const VIEWPORT_RANDOMIZATION = process.env.VIEWPORT_RANDOMIZATION !== "false";

/**
 * TYPING_MISTAKES – symulacja literówek przy wpisywaniu
 */
const TYPING_MISTAKES_ENABLED = process.env.TYPING_MISTAKES_ENABLED !== "false";
const TYPING_MISTAKES_CHANCE = Number(process.env.TYPING_MISTAKES_CHANCE || 0.03);

/**
 * NAVIGATION_MISTAKES – symulacja przypadkowego cofania/powrotu
 */
const NAVIGATION_MISTAKES_ENABLED = process.env.NAVIGATION_MISTAKES_ENABLED !== "false";

/**
 * PROFILE_VISITS – odwiedzanie losowych profili podczas sesji
 */
const PROFILE_VISITS_ENABLED = process.env.PROFILE_VISITS_ENABLED !== "false";
const PROFILE_VISITS_CHANCE = Number(process.env.PROFILE_VISITS_CHANCE || 0.08);

/**
 * TAB_SIMULATION – symulacja przełączania kart przeglądarki
 */
const TAB_SIMULATION_ENABLED = process.env.TAB_SIMULATION_ENABLED !== "false";
const TAB_SIMULATION_CHANCE = Number(process.env.TAB_SIMULATION_CHANCE || 0.10);

/**
 * IMAGE_INTERACTION – interakcja ze zdjęciami (hover, klik, oglądanie)
 */
const IMAGE_INTERACTION_ENABLED = process.env.IMAGE_INTERACTION_ENABLED !== "false";
const IMAGE_INTERACTION_CHANCE = Number(process.env.IMAGE_INTERACTION_CHANCE || 0.15);

/**
 * NIGHT_MODE – tryb nocny (sen i morning catch-up)
 */
const NIGHT_MODE_ENABLED = process.env.NIGHT_MODE_ENABLED === "true";
const NIGHT_START_HOUR = Number(process.env.NIGHT_START_HOUR || 22);
const NIGHT_END_HOUR = Number(process.env.NIGHT_END_HOUR || 7);
const NIGHT_CATCHUP_HOURS = Number(process.env.NIGHT_CATCHUP_HOURS || 8);

/**
 * FEED_SCAN – skanowanie tablicy w poszukiwaniu postów z keywords
 */
const FEED_SCAN_ENABLED = process.env.FEED_SCAN_ENABLED === "true";
const FEED_SCAN_KEYWORDS = (process.env.FEED_SCAN_KEYWORDS || "").trim();
const FEED_SCROLL_DURATION_MIN = Number(process.env.FEED_SCROLL_DURATION_MIN || 1);
const FEED_SCROLL_DURATION_MAX = Number(process.env.FEED_SCROLL_DURATION_MAX || 3);

/**
 * HUMAN_RANDOM_LIKE_CHANCE – szansa na losowy like podczas sesji
 */
const HUMAN_RANDOM_LIKE_CHANCE = Number(process.env.HUMAN_RANDOM_LIKE_CHANCE || 0.20);

/**
 * DISCOVERY_TELEGRAM_ENABLED – czy wysyłać alert Telegram przy nowym discovery
 */
const DISCOVERY_TELEGRAM_ENABLED = process.env.DISCOVERY_TELEGRAM_ENABLED === "true";

/* ==================== META ADS SCANNER ==================== */
/**
 * METAADS_KEYWORDS – słowa kluczowe do wyszukiwania reklam (rozdzielone przecinkami)
 * Np.: "garaże blaszane,hale magazynowe,wiaty garażowe"
 */
const METAADS_KEYWORDS = (process.env.METAADS_KEYWORDS || "").trim();

/**
 * METAADS_COUNTRY – kod kraju do filtrowania reklam (ISO 3166-1 alpha-2)
 * Domyślnie: PL
 */
const METAADS_COUNTRY = (process.env.METAADS_COUNTRY || "PL").trim();

/**
 * METAADS_SCAN_INTERVAL_H – interwał skanowania w godzinach
 * Domyślnie: 12 (dwa razy dziennie)
 */
const METAADS_SCAN_INTERVAL_H = Number(process.env.METAADS_SCAN_INTERVAL_H || 12);

/**
 * METAADS_AUTO_SEND_TO_WATCHER – czy automatycznie wysyłać nowe reklamy do panelu
 * Domyślnie: true
 */
const METAADS_AUTO_SEND_TO_WATCHER = process.env.METAADS_AUTO_SEND_TO_WATCHER !== "false";

/**
 * METAADS_HEADLESS – czy uruchamiać przeglądarkę w trybie headless
 * Domyślnie: true (bez okna), ustaw na false żeby widzieć przeglądarkę
 */
const METAADS_HEADLESS = process.env.METAADS_HEADLESS !== "false";

export {
  // stary system – optional
  POSTS,
  POST_LABELS,

  // używane przez watcher.js / comments.js
  EXPAND_COMMENTS,
  USE_UI_HANDLERS,
  INCLUDE_REPLIES,
  CHECK_INTERVAL_MS,

  // FAST_MODE
  FAST_MODE,
  FAST_MAX_AGE_MIN,

  // źródła postów
  POSTS_JSON_PATH,
  POSTS_SHEET_URL,
  POSTS_REFRESH_MS,
  POSTS_API_URL,
  POSTS_API_TOKEN,

  // logowanie
  LOG_LEVEL,
  LOG_TIMESTAMPS,
  LOG_COLORS,

  // captcha solver
  CAPTCHA_API_KEY,
  CAPTCHA_ENABLED,

  // remote debug
  REMOTE_DEBUG_PORT,

  // human behavior mode
  HUMAN_MODE,
  PROXY_URL,

  // FB_Watcher LITE
  SESSION_LENGTH_MIN_MS,
  SESSION_LENGTH_MAX_MS,
  WARMUP_ENABLED,
  WARMUP_DURATION_MIN_MS,
  WARMUP_DURATION_MAX_MS,
  VIEWPORT_RANDOMIZATION,
  TYPING_MISTAKES_ENABLED,
  TYPING_MISTAKES_CHANCE,
  NAVIGATION_MISTAKES_ENABLED,
  PROFILE_VISITS_ENABLED,
  PROFILE_VISITS_CHANCE,
  TAB_SIMULATION_ENABLED,
  TAB_SIMULATION_CHANCE,
  IMAGE_INTERACTION_ENABLED,
  IMAGE_INTERACTION_CHANCE,
  NIGHT_MODE_ENABLED,
  NIGHT_START_HOUR,
  NIGHT_END_HOUR,
  NIGHT_CATCHUP_HOURS,
  FEED_SCAN_ENABLED,
  FEED_SCAN_KEYWORDS,
  FEED_SCROLL_DURATION_MIN,
  FEED_SCROLL_DURATION_MAX,
  HUMAN_RANDOM_LIKE_CHANCE,
  DISCOVERY_TELEGRAM_ENABLED,

  // meta ads scanner
  METAADS_KEYWORDS,
  METAADS_COUNTRY,
  METAADS_SCAN_INTERVAL_H,
  METAADS_AUTO_SEND_TO_WATCHER,
  METAADS_HEADLESS,
};
