// index.js
import { startWatcher } from "./watcher.js";

console.log("[CFG] HEADLESS_BROWSER (process.env) =", process.env.HEADLESS_BROWSER);

startWatcher().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
