import fs from "node:fs";

const file = "src/fb/comments.js";
let s = fs.readFileSync(file, "utf8");

if (s.includes("FAST_SEEN_DEDUP_PATCH_v1")) {
  console.log("[PATCH] already applied");
  process.exit(0);
}

// 1) wstrzykujemy helper "seen" po pierwszych importach
const helper = `
// FAST_SEEN_DEDUP_PATCH_v1
import fs_node from "node:fs";
import path_node from "node:path";

const __SEEN_PATH = (() => {
  const dataDir = process.env.DATA_DIR || path_node.join(process.cwd(), "data");
  return path_node.join(dataDir, "seen-comments.json");
})();

let __seen = new Set();
let __seenLoaded = false;
let __seenDirty = false;
let __seenFlushT = null;

function __seenLoadOnce(log) {
  if (__seenLoaded) return;
  __seenLoaded = true;
  try {
    if (fs_node.existsSync(__SEEN_PATH)) {
      const raw = fs_node.readFileSync(__SEEN_PATH, "utf8");
      const obj = JSON.parse(raw || "{}");
      if (obj && typeof obj === "object") {
        for (const k of Object.keys(obj)) __seen.add(k);
      }
    }
  } catch (e) {
    try { log && log.warn && log.warn("DEDUP", "seen load failed", { err: String(e?.message || e) }); } catch {}
  }
}

function __seenHas(key) {
  if (!key) return false;
  return __seen.has(String(key));
}

function __seenAdd(key) {
  if (!key) return;
  __seen.add(String(key));
  __seenDirty = true;
  __seenFlushSoon();
}

function __seenFlushSoon() {
  if (__seenFlushT) return;
  __seenFlushT = setTimeout(() => {
    __seenFlushT = null;
    if (!__seenDirty) return;
    __seenDirty = false;
    try {
      const out = {};
      // FAST: zapisujemy tylko klucze (wartość = 1)
      for (const k of __seen) out[k] = 1;
      fs_node.mkdirSync(path_node.dirname(__SEEN_PATH), { recursive: true });
      fs_node.writeFileSync(__SEEN_PATH, JSON.stringify(out));
    } catch {}
  }, 5000);
}
// /FAST_SEEN_DEDUP_PATCH_v1
`;

const firstImportIdx = s.indexOf("\n");
if (firstImportIdx === -1) throw new Error("Cannot find imports boundary");
s = s.slice(0, firstImportIdx + 1) + helper + s.slice(firstImportIdx + 1);

// 2) HEURYSTYKA: po linii z "const dedupKey" wstawiamy DROP jeśli już widziany
//    (działa, jeśli w pliku jest dedupKey — a u Ciebie jest)
const reDedupLine = /^([ \t]*const\s+dedupKey\s*=.*)$/m;
const m = s.match(reDedupLine);
if (!m) {
  throw new Error("Cannot find 'const dedupKey = ...' in comments.js (abort to avoid corruption)");
}

s = s.replace(reDedupLine, `$1
      // FAST_SEEN_DEDUP: RAM gate
      __seenLoadOnce(typeof log !== "undefined" ? log : undefined);
      if (dedupKey && __seenHas(dedupKey)) {
        try { log && log.debug && log.debug("DEDUP", "DROP already seen (fast)", { dedupKey }); } catch {}
        continue;
      }`);

// 3) HEURYSTYKA: po pierwszym miejscu, gdzie logujesz SENT albo gdzie jest oczywiste "wysłane",
//    dopisujemy __seenAdd(dedupKey) – żeby klucz wpadł do RAM i później do pliku.
let injected = false;

// wariant A: log.*("SENT"
s = s.replace(/(log\.(info|debug|warn)\([^)]*["']SENT["'][^)]*\)\s*;)/, (all) => {
  injected = true;
  return `${all}
      // FAST_SEEN_DEDUP: mark sent
      if (typeof dedupKey !== "undefined" && dedupKey) __seenAdd(dedupKey);`;
});

// wariant B: jeśli nie ma "SENT", to spróbuj po "send" w webhook/telegram (łagodniej)
if (!injected) {
  s = s.replace(/(\bawait\s+send[A-Za-z0-9_]*\([^;]*\)\s*;)/, (all) => {
    injected = true;
    return `${all}
      // FAST_SEEN_DEDUP: mark sent
      if (typeof dedupKey !== "undefined" && dedupKey) __seenAdd(dedupKey);`;
  });
}

if (!injected) {
  throw new Error("Could not find SENT/send spot to mark seen (abort)");
}

fs.writeFileSync(file, s);
console.log("[PATCH] applied OK");
