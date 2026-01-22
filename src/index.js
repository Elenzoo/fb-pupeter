// src/index.js

// WATCHER LOCK (anti-double-start)
if (process.env.__WATCHER_LOCKED__) {
  console.error("WATCHER DUPLICATE START — EXIT");
  process.exit(1);
}
process.env.__WATCHER_LOCKED__ = "1";

// timestamp console.log
const __log = console.log;
console.log = (...args) => {
  const ts = new Date().toISOString().replace("T", " ").replace("Z", "");
  __log(`[${ts}]`, ...args);
};

// ✅ .env as SINGLE SOURCE OF TRUTH (override everything)
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { startWatcher } from "./watcher.js";
import { sendOwnerAlert } from "./telegram.js";

// Resolve .env path reliably (works under PM2 + different cwd)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.resolve(__dirname, "..", ".env");

// Load .env with override (wins vs PM2/system env)
dotenv.config({ path: ENV_PATH, override: true });

// (Optional) If you also want to support running from other cwd with local .env,
// you can keep this second load. It will also override.
// dotenv.config({ path: path.join(process.cwd(), ".env"), override: true });

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {}
}

// Ustal katalogi serwerowe (żeby nie waliło w /tmp losowo)
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const TMP_DIR = process.env.TMP_DIR || path.join(process.cwd(), "tmp");
ensureDir(DATA_DIR);
ensureDir(TMP_DIR);

// czas + logi
console.log("[BOOT] NODE_ENV =", process.env.NODE_ENV || "dev");
console.log("[BOOT] TZ =", process.env.TZ || "system");
console.log("[BOOT] DATA_DIR =", DATA_DIR);
console.log("[BOOT] TMP_DIR =", TMP_DIR);
console.log("[CFG] HEADLESS_BROWSER =", process.env.HEADLESS_BROWSER);

// helper
function safeToString(x) {
  try {
    if (x instanceof Error) return `${x.message}\n${x.stack || ""}`;
    if (typeof x === "string") return x;
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

// anti-loop
let _inAlert = false;
function fireAlert(title, message) {
  if (_inAlert) return;
  _inAlert = true;
  sendOwnerAlert(title, message).catch(() => {}).finally(() => (_inAlert = false));
}

// HOOKI na błędy (muszą być przed startWatcher)
const _origErr = console.error.bind(console);
console.error = (...args) => {
  _origErr(...args);
  fireAlert("console.error", args.map(safeToString).join(" "));
};

process.on("unhandledRejection", (reason) => {
  _origErr("[unhandledRejection]", reason);
  fireAlert("unhandledRejection", safeToString(reason));
});

process.on("uncaughtException", (err) => {
  _origErr("[uncaughtException]", err);
  fireAlert("uncaughtException", safeToString(err));
  // Daj czas na wysłanie alertu, potem exit (PM2 zrestartuje)
  setTimeout(() => process.exit(1), 3000);
});

// ping “żyję”
sendOwnerAlert("ALERTS ONLINE", `FB_Watcher start: ${new Date().toISOString()}`)
  .then(() => console.log("[ALERTS] startup ping sent"))
  .catch(() => console.log("[ALERTS] startup ping failed (ignored)"));

startWatcher().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
