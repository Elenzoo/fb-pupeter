// index.js
import { startWatcher } from "./watcher.js";

startWatcher().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
