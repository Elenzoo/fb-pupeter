// src/index.js
import "dotenv/config";
import { sendOwnerAlert } from "./telegram.js";
import { startWatcher } from "./watcher.js";

console.log("[ALERTS] hooks loading at", new Date().toISOString());
sendOwnerAlert("ALERTS ONLINE", `FB_Watcher start: ${new Date().toISOString()}`)



function safeToString(x) {
  try {
    if (x instanceof Error) return `${x.message}\n${x.stack || ""}`;
    if (typeof x === "string") return x;
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

let _inAlertPath = false;
function fireAlert(title, message) {
  if (_inAlertPath) return;
  _inAlertPath = true;
  sendOwnerAlert(title, message)
    .catch(() => {})
    .finally(() => {
      _inAlertPath = false;
    });
}

// HOOKI MUSZĄ BYĆ ZAŁOŻONE ZANIM POJAWI SIĘ JAKIKOLWIEK ERROR
const _origConsoleError = console.error.bind(console);
console.error = (...args) => {
  _origConsoleError(...args);
  const msg = args.map(safeToString).join(" ");
  fireAlert("console.error", msg);
};

process.on("uncaughtException", (err) => {
  _origConsoleError("[uncaughtException]", err);
  fireAlert("uncaughtException", safeToString(err));
});

process.on("unhandledRejection", (reason) => {
  _origConsoleError("[unhandledRejection]", reason);
  fireAlert("unhandledRejection", safeToString(reason));
});

// PING na start (żebyś zawsze wiedział, że alerty żyją)
sendOwnerAlert("ALERTS ONLINE", `FB_Watcher start: ${new Date().toISOString()}`)
  .then(() => console.log("[ALERTS] startup ping sent"))
  .catch(() => console.log("[ALERTS] startup ping failed (no spam)"));

console.log("[CFG] HEADLESS_BROWSER (process.env) =", process.env.HEADLESS_BROWSER);

startWatcher().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
