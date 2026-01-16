import "dotenv/config";

/* ==================== PANEL – NOWY SYSTEM ==================== */
/**
 * POSTS_JSON_PATH – ścieżka do pliku z postami zarządzanymi przez panel (domyślnie data/posts.json)
 */
const POSTS_JSON_PATH = process.env.POSTS_JSON_PATH || "data/posts.json";

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

// NOWE: TRYB SZYBKI
// FAST_MODE=true -> sortuj komentarze na "Najnowsze" i skipuj post, gdy najnowszy komentarz jest starszy niż limit
const FAST_MODE = String(process.env.FAST_MODE || "")
  .trim()
  .toLowerCase();

const FAST_SKIP_AGE_MIN = Number(process.env.FAST_SKIP_AGE_MIN || 180);

// co ile sekund lecimy po postach (podstawowy interwał)
// można nadpisać w .env: CHECK_INTERVAL_MS=60000
const CHECK_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 60000);

export {
  // stary system – optional
  POSTS,
  POST_LABELS,

  // używane przez watcher.js / comments.js
  EXPAND_COMMENTS,
  USE_UI_HANDLERS,
  INCLUDE_REPLIES,
  CHECK_INTERVAL_MS,

  // tryb szybki
  FAST_MODE,
  FAST_SKIP_AGE_MIN,

  // źródła postów
  POSTS_JSON_PATH,
  POSTS_SHEET_URL,
  POSTS_REFRESH_MS,
};
