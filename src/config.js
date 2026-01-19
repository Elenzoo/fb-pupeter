import "dotenv/config";

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

/* ==================== CHECKPOINT RECOVERY ==================== */
/**
 * CHECKPOINT_DETECTION – czy włączyć automatyczne wykrywanie checkpointów FB
 * Domyślnie: true
 */
const CHECKPOINT_DETECTION = process.env.CHECKPOINT_DETECTION !== "false";

/**
 * CHECKPOINT_MAX_RETRIES – ile razy próbować recovery z fresh cookies
 * Domyślnie: 3
 */
const CHECKPOINT_MAX_RETRIES = Number(process.env.CHECKPOINT_MAX_RETRIES || 3);

/**
 * BACKUP_COOKIES_DIR – katalog z backup cookies
 * Domyślnie: ./data/backup_cookies
 */
const BACKUP_COOKIES_DIR = process.env.BACKUP_COOKIES_DIR || "./data/backup_cookies";

/**
 * CHECKPOINT_ALERT_TELEGRAM – czy wysyłać alert Telegram przy checkpoint
 * Domyślnie: true
 */
const CHECKPOINT_ALERT_TELEGRAM = process.env.CHECKPOINT_ALERT_TELEGRAM !== "false";

/**
 * SOFT_BAN_DETECTION – wykrywanie "soft ban" (0 komentarzy na wielu postach)
 * Domyślnie: true
 */
const SOFT_BAN_DETECTION = process.env.SOFT_BAN_DETECTION !== "false";

/**
 * SOFT_BAN_THRESHOLD – ile postów z 0 komentarzami = soft ban
 * Domyślnie: 3
 */
const SOFT_BAN_THRESHOLD = Number(process.env.SOFT_BAN_THRESHOLD || 3);

/**
 * SCP_COOKIES_TARGET – cel SCP dla upload cookies (user@host:/path)
 * Np.: SCP_COOKIES_TARGET=user@server:/app/data/backup_cookies/
 */
const SCP_COOKIES_TARGET = (process.env.SCP_COOKIES_TARGET || "").trim();

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

  // checkpoint recovery
  CHECKPOINT_DETECTION,
  CHECKPOINT_MAX_RETRIES,
  BACKUP_COOKIES_DIR,
  CHECKPOINT_ALERT_TELEGRAM,
  SCP_COOKIES_TARGET,

  // soft ban detection
  SOFT_BAN_DETECTION,
  SOFT_BAN_THRESHOLD,
};
