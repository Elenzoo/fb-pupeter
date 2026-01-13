// src/index.js
import "dotenv/config";
import fs from "fs";
import path from "path";
import { startWatcher } from "./watcher.js";
import { sendOwnerAlert } from "./telegram.js";

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
});

// ping “żyję”
sendOwnerAlert("ALERTS ONLINE", `FB_Watcher start: ${new Date().toISOString()}`)
  .then(() => console.log("[ALERTS] startup ping sent"))
  .catch(() => console.log("[ALERTS] startup ping failed (ignored)"));

startWatcher().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
