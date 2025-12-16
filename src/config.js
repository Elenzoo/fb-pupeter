// config.js
import "dotenv/config";

/* ==================== GOOGLE SHEETS – NOWY SYSTEM ==================== */
/**
 * POSTS_SHEET_URL – URL do opublikowanego jako CSV arkusza z postami.
 * Np.:
 *  - w Google Sheets: Plik → Opublikuj w internecie → CSV
 *  - w .env: POSTS_SHEET_URL=https://docs.google.com/spreadsheets/d/....../pub?output=csv
 */
const POSTS_SHEET_URL = process.env.POSTS_SHEET_URL || "";

/**
 * POSTS_REFRESH_MS – co ile MILISEKUND watcher ma odświeżać listę postów z arkusza.
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
 * Jeżeli nie masz ani FB_POST_URLS, ani POSTS_SHEET_URL,
 * to faktycznie nie ma co monitorować → robimy twardy exit.
 * Jeśli korzystasz z Google Sheets (POSTS_SHEET_URL ustawione),
 * to brak FB_POST_URLS już nie jest problemem.
 */
if (!POSTS.length && !POSTS_SHEET_URL) {
  console.error(
    "[CONFIG] Brak źródeł postów. Ustaw FB_POST_URLS (ENV) lub POSTS_SHEET_URL (Google Sheets CSV)."
  );
  process.exit(1);
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

export {
  // stary system – optional (watcher go już nie potrzebuje, ale nic nie szkodzi że jest)
  POSTS,
  POST_LABELS,
  // używane przez watcher.js / comments.js
  EXPAND_COMMENTS,
  USE_UI_HANDLERS,
  INCLUDE_REPLIES,
  CHECK_INTERVAL_MS,
  POSTS_SHEET_URL,
  POSTS_REFRESH_MS,
};
