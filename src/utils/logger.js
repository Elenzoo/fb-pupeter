import "dotenv/config";
// src/utils/logger.js
// Ujednolicony system logowania z poziomami: SILENT(0), PROD(1), DEV(2), DEBUG(3)

/**
 * LOG_LEVEL:
 *   0 = SILENT - tylko błędy krytyczne
 *   1 = PROD   - status cykli, nowe komentarze, błędy (domyślny)
 *   2 = DEV    - szczegóły operacji, timings
 *   3 = DEBUG  - pełne dumpy, payloady, DOM info
 */
const LOG_LEVEL = Number(process.env.LOG_LEVEL ?? 1);
const LOG_TIMESTAMPS = process.env.LOG_TIMESTAMPS !== "false";
const LOG_COLORS = process.env.LOG_COLORS !== "false";

// ANSI kolory
const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

// Kolory dla modułów
const moduleColors = {
  WATCHER: colors.cyan,
  NAV: colors.blue,
  "UI:post": colors.magenta,
  "UI:videos": colors.magenta,
  "UI:photo": colors.magenta,
  "UI:watch": colors.magenta,
  FILTER: colors.yellow,
  EXTRACT: colors.green,
  DEDUP: colors.gray,
  TELEGRAM: colors.blue,
  WEBHOOK: colors.blue,
  API: colors.cyan,
  COOKIES: colors.gray,
  LOGIN: colors.yellow,
  ERROR: colors.red,
  FAST: colors.green,
};

function c(color, text) {
  if (!LOG_COLORS) return text;
  return `${color}${text}${colors.reset}`;
}

function timestamp() {
  if (!LOG_TIMESTAMPS) return "";
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return c(colors.dim, `[${hh}:${mm}:${ss}]`) + " ";
}

function formatModule(mod) {
  const color = moduleColors[mod] || colors.white;
  return c(color, `[${mod}]`);
}

function formatData(data) {
  if (data === undefined || data === null) return "";
  if (typeof data === "string") return ` ${c(colors.dim, data)}`;
  if (typeof data === "number") return ` ${c(colors.dim, String(data))}`;

  // Object - pokaż kluczowe info
  try {
    const keys = Object.keys(data);
    if (keys.length === 0) return "";

    const parts = [];
    for (const k of keys.slice(0, 5)) {
      const v = data[k];
      if (v === undefined || v === null) continue;
      if (typeof v === "string" && v.length > 50) {
        parts.push(`${k}:"${v.slice(0, 47)}..."`);
      } else if (typeof v === "object") {
        parts.push(`${k}:{...}`);
      } else {
        parts.push(`${k}:${JSON.stringify(v)}`);
      }
    }
    if (keys.length > 5) parts.push(`+${keys.length - 5} more`);
    return ` ${c(colors.dim, `(${parts.join(", ")})`)}`;
  } catch {
    return "";
  }
}

function formatDataFull(data) {
  if (data === undefined || data === null) return "";
  try {
    return `\n${c(colors.dim, JSON.stringify(data, null, 2))}`;
  } catch {
    return "";
  }
}

/**
 * Logger główny
 */
const log = {
  /** Poziom 0+ - Błędy krytyczne (zawsze pokazywane) */
  error(mod, msg, data) {
    const prefix = timestamp() + formatModule(mod || "ERROR");
    console.error(`${prefix} ${c(colors.red, "✗")} ${msg}${formatData(data)}`);
  },

  /** Poziom 0+ - Ostrzeżenia (zawsze pokazywane) */
  warn(mod, msg, data) {
    const prefix = timestamp() + formatModule(mod || "WARN");
    console.warn(`${prefix} ${c(colors.yellow, "⚠")} ${msg}${formatData(data)}`);
  },

  /** Poziom 1+ - PROD: Status cykli, nowe komentarze, kluczowe zdarzenia */
  prod(mod, msg, data) {
    if (LOG_LEVEL < 1) return;
    const prefix = timestamp() + formatModule(mod);
    console.log(`${prefix} ${msg}${formatData(data)}`);
  },

  /** Poziom 1+ - PROD z ikoną sukcesu */
  success(mod, msg, data) {
    if (LOG_LEVEL < 1) return;
    const prefix = timestamp() + formatModule(mod);
    console.log(`${prefix} ${c(colors.green, "✓")} ${msg}${formatData(data)}`);
  },

  /** Poziom 2+ - DEV: Szczegóły operacji, timings */
  dev(mod, msg, data) {
    if (LOG_LEVEL < 2) return;
    const prefix = timestamp() + formatModule(mod);
    console.log(`${prefix} ${msg}${formatData(data)}`);
  },

  /** Poziom 3+ - DEBUG: Pełne dumpy, payloady, DOM info */
  debug(mod, msg, data) {
    if (LOG_LEVEL < 3) return;
    const prefix = timestamp() + formatModule(mod);
    console.log(`${prefix} ${c(colors.gray, "[DBG]")} ${msg}${formatDataFull(data)}`);
  },

  /** Separator wizualny (poziom 1+) */
  separator(char = "─", length = 50) {
    if (LOG_LEVEL < 1) return;
    console.log(c(colors.dim, char.repeat(length)));
  },

  /** Nagłówek sekcji (poziom 1+) */
  header(title) {
    if (LOG_LEVEL < 1) return;
    console.log("");
    console.log(c(colors.cyan, `═══ ${title} ${"═".repeat(Math.max(0, 44 - title.length))}`));
  },

  /** Podsumowanie cyklu (poziom 1+) */
  cycleSummary({ cycle, posts, newComments, duration, errors = 0, cacheSize = 0, cacheEntries = 0, totalKnownIds = 0 }) {
    if (LOG_LEVEL < 1) return;
    const prefix = timestamp() + formatModule("WATCHER");
    const status = errors > 0 ? c(colors.yellow, `⚠ ${errors} err`) : c(colors.green, "✓");
    const durationStr = duration ? ` (${(duration / 1000).toFixed(1)}s)` : "";
    console.log(
      `${prefix} Cykl #${cycle} done: ${posts} postów, ${c(colors.green, `+${newComments}`)} nowych${durationStr} ${status}`
    );

    // Metryki cache (poziom 2+ - DEV)
    if (LOG_LEVEL >= 2 && (cacheSize > 0 || totalKnownIds > 0)) {
      const cacheSizeStr = cacheSize > 0 ? `${Math.round(cacheSize / 1024)}KB` : "0KB";
      console.log(
        `${prefix} ${c(colors.dim, `Cache: ${cacheSizeStr}, ${cacheEntries} postów, ${totalKnownIds} knownIds`)}`
      );
    }
  },

  /** Aktualny poziom logowania */
  get level() {
    return LOG_LEVEL;
  },

  /** Czy dany poziom jest włączony */
  isEnabled(level) {
    return LOG_LEVEL >= level;
  },
};

// Stałe poziomów do eksportu
const LEVELS = {
  SILENT: 0,
  PROD: 1,
  DEV: 2,
  DEBUG: 3,
};

export { log, LEVELS };
export default log;
