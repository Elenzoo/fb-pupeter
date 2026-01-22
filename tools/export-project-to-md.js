#!/usr/bin/env node
/**
 * Wypasiony eksport projektu do jednego Markdown:
 * - Overview (statystyki + mini tree)
 * - 🚪 Entrypoints & Flow (stała lista pod FB_Watcher)
 * - Public API (exports) z liniami
 * - Function/Class index (mapa funkcji i klas per plik)
 * - Keyword index (wystąpienia + linie)
 * - Import graph (lite)
 * - Pełny kod wszystkich plików z numerami linii
 *
 * Uruchom:
 *   node tools/export-project-to-md.js
 *
 * ENV:
 *   EXPORT_OUT=EXPORT_PROJEKTU_PLUS.md
 *   EXPORT_ROOT=.
 *   EXPORT_MAX_BYTES=2000000
 *   EXPORT_TREE_DEPTH=3
 *   EXPORT_TREE_MAX_LINES=220
 *   EXPORT_KEYWORDS=FAST_MODE,WEBHOOK_URL,PM2,pm2,watcher,DEDUP,newest,Najnowsze
 *   EXPORT_KEYWORD_MAX_HITS=60
 *   EXPORT_REDACT=0|1         (domyślnie 0; 1 zamazuje .env / cookies.json itp.)
 *   EXPORT_FUNC_INDEX_MAX=220  (max wpisów w function index na plik; domyślnie 220)
 */

import fs from "fs";
import path from "path";

const ROOT = path.resolve(process.env.EXPORT_ROOT || process.cwd());
const OUT_FILE = path.resolve(process.env.EXPORT_OUT || path.join(ROOT, "EXPORT_PROJEKTU_PLUS.md"));
const MAX_BYTES = Number(process.env.EXPORT_MAX_BYTES || 2_000_000);
const TREE_DEPTH = Number(process.env.EXPORT_TREE_DEPTH || 3);
const TREE_MAX_LINES = Number(process.env.EXPORT_TREE_MAX_LINES || 220);
const KEYWORD_MAX_HITS = Number(process.env.EXPORT_KEYWORD_MAX_HITS || 60);
const REDACT = String(process.env.EXPORT_REDACT || "0") === "1";
const FUNC_INDEX_MAX = Number(process.env.EXPORT_FUNC_INDEX_MAX || 220);

const DEFAULT_KEYWORDS = [
  "FAST_MODE",
  "FAST_MAX_AGE_MIN",
  "WEBHOOK_URL",
  "PANEL_TOKEN",
  "PM2",
  "pm2",
  "watcher",
  "dedup",
  "DEDUP",
  "Najnowsze",
  "newest",
  "switchComments",
  "cookies",
  "COOKIES",
  "HEADLESS_BROWSER",
  "USE_UI_HANDLERS",
];

const KEYWORDS = String(process.env.EXPORT_KEYWORDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const FINAL_KEYWORDS = KEYWORDS.length ? KEYWORDS : DEFAULT_KEYWORDS;

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  ".pnpm-store",
  ".yarn",
  ".vscode",
  ".idea",
]);

const IGNORE_FILES = new Set([
  // locki możesz dodać jeśli chcesz
  // "package-lock.json",
  // "yarn.lock",
  // "pnpm-lock.yaml",
]);

const ALLOWED_EXT = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".json",
  ".html",
  ".css",
  ".md",
  ".yml",
  ".yaml",
  ".txt",
]);

const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".ico",
  ".pdf",
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".mp3",
  ".wav",
]);

function normalizeRel(p) {
  return path.relative(ROOT, p).split(path.sep).join("/");
}

function isHiddenName(name) {
  return name.startsWith(".") && name !== ".env" && !name.startsWith(".env.");
}

function looksBinaryByExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXT.has(ext);
}

function isAllowedFile(filePath) {
  const name = path.basename(filePath);
  if (IGNORE_FILES.has(name)) return false;

  // .env / .env.*
  if (name === ".env" || name.startsWith(".env.")) return true;

  // cookies.json (jeśli jest w projekcie) – dopuszczamy do dumpa
  if (name.toLowerCase() === "cookies.json") return true;

  const ext = path.extname(name).toLowerCase();
  if (!ext) return false;
  if (looksBinaryByExt(filePath)) return false;
  return ALLOWED_EXT.has(ext);
}

function detectLang(filePath) {
  const name = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (name === ".env" || name.startsWith(".env.")) return "dotenv";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "js";
  if (ext === ".ts") return "ts";
  if (ext === ".tsx") return "tsx";
  if (ext === ".jsx") return "jsx";
  if (ext === ".json") return "json";
  if (ext === ".html") return "html";
  if (ext === ".css") return "css";
  if (ext === ".yml" || ext === ".yaml") return "yaml";
  if (ext === ".md") return "md";
  return "";
}

function typeLabel(filePath) {
  const name = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (name === ".env" || name.startsWith(".env.")) return "ENV";
  if (ext === ".json") return "JSON";
  if (ext === ".md") return "Markdown";
  if (ext === ".html") return "HTML";
  if (ext === ".css") return "CSS";
  if (ext === ".yml" || ext === ".yaml") return "YAML";
  if (ext === ".ts" || ext === ".tsx") return "TypeScript";
  return "JavaScript/tekst";
}

function guessDescription(rel) {
  const p = rel.toLowerCase();
  if (p.includes("/fb/")) return "Logika Facebook/Puppeteer (UI, komentarze, logowanie).";
  if (p.includes("/panel/")) return "Panel (frontend/backend) do zarządzania watcherem.";
  if (p.includes("/utils/")) return "Utility helpers (sleep, nawigacja, itp.).";
  if (p.endsWith("watcher.js")) return "Główna pętla watchera: cykle, cache, webhook/telegram.";
  if (p.includes("config") || p.startsWith(".env")) return "Konfiguracja / stałe / ustawienia.";
  if (p.endsWith("package.json")) return "Metadane projektu i zależności (npm).";
  return "Plik projektu (kod/konfiguracja).";
}

function safeReadText(filePath) {
  const st = fs.statSync(filePath);
  if (st.size > MAX_BYTES) {
    return { ok: false, reason: `Za duży (${st.size} B > ${MAX_BYTES} B)`, text: null, size: st.size };
  }

  const buf = fs.readFileSync(filePath);

  // detekcja binarki (NUL) w pierwszych 4 KB
  const lim = Math.min(buf.length, 4096);
  for (let i = 0; i < lim; i++) {
    if (buf[i] === 0) {
      return { ok: false, reason: "Wykryto binarkę (NUL byte)", text: null, size: st.size };
    }
  }

  const text = buf.toString("utf8").replace(/\u0000/g, "");
  return { ok: true, reason: null, text, size: st.size };
}

function redactIfNeeded(rel, text) {
  if (!REDACT) return text;

  const low = rel.toLowerCase();

  if (low.endsWith("cookies.json")) return "[REDACTED: cookies.json]\n";
  if (low === ".env" || low.startsWith(".env.")) return "[REDACTED: .env]\n";

  let out = text;

  // maskowanie KEY=...
  out = out.replace(/^([A-Z0-9_]{3,})=(.+)$/gm, (m, k) => `${k}=[REDACTED]`);

  // maskowanie webhooków Make
  out = out.replace(/https?:\/\/hook\.[^\s"'`]+/g, "[REDACTED_URL]");

  // maskowanie bearer tokenów
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]");

  return out;
}

function padLeft(n, width) {
  const s = String(n);
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

function addLineNumbers(text) {
  const lines = text.split(/\r?\n/);
  const width = String(lines.length).length;
  return lines.map((line, idx) => `${padLeft(idx + 1, width)} | ${line}`).join("\n");
}

function makeAnchor(rel) {
  const base = `ścieżka-${rel}`;
  return base
    .toLowerCase()
    .replace(/[`]/g, "")
    .replace(/[^\p{L}\p{N}\s/_-]+/gu, "")
    .replace(/[\/_]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function walk(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const ent of entries) {
    const full = path.join(dir, ent.name);

    if (ent.isDirectory()) {
      if (IGNORE_DIRS.has(ent.name)) continue;
      if (isHiddenName(ent.name)) continue;
      walk(full, out);
      continue;
    }

    if (!ent.isFile()) continue;

    // ukryte pliki: pomiń poza .env*
    if (isHiddenName(ent.name) && !(ent.name === ".env" || ent.name.startsWith(".env."))) continue;

    if (!isAllowedFile(full)) continue;

    out.push(full);
  }
}

function sortFiles(files) {
  const rel = (f) => normalizeRel(f);

  const score = (r) => {
    const low = r.toLowerCase();
    if (low === "package.json") return 0;
    if (low.startsWith(".env")) return 1;
    if (low.includes("config")) return 2;
    if (low.startsWith("src/")) return 10;
    if (low.includes("panel")) return 20;
    return 30;
  };

  return [...files].sort((a, b) => {
    const ra = rel(a);
    const rb = rel(b);
    const sa = score(ra);
    const sb = score(rb);
    if (sa !== sb) return sa - sb;
    return ra.localeCompare(rb);
  });
}

function countByExt(files) {
  const map = new Map();
  for (const f of files) {
    const name = path.basename(f);
    let ext = path.extname(name).toLowerCase();
    if (name === ".env" || name.startsWith(".env.")) ext = ".env";
    if (name.toLowerCase() === "cookies.json") ext = ".cookies.json";
    map.set(ext, (map.get(ext) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function buildTree(paths, maxDepth, maxLines) {
  const root = { name: "", children: new Map(), isFile: false };

  function insert(rel) {
    const parts = rel.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!node.children.has(p)) node.children.set(p, { name: p, children: new Map(), isFile: false });
      node = node.children.get(p);
    }
    node.isFile = true;
  }

  for (const rel of paths) insert(rel);

  const lines = [];
  let emitted = 0;

  function walkNode(node, depth, prefix) {
    if (emitted >= maxLines) return;
    if (depth > maxDepth) return;

    const entries = [...node.children.values()].sort((a, b) => {
      const aIsDir = a.children.size > 0 && !a.isFile;
      const bIsDir = b.children.size > 0 && !b.isFile;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    entries.forEach((child, idx) => {
      if (emitted >= maxLines) return;
      const isLast = idx === entries.length - 1;
      const branch = isLast ? "└─ " : "├─ ";
      const nextPrefix = prefix + (isLast ? "   " : "│  ");
      const label = child.name + (child.children.size > 0 && !child.isFile ? "/" : "");
      lines.push(prefix + branch + label);
      emitted++;

      if (child.children.size > 0 && depth + 1 <= maxDepth) {
        walkNode(child, depth + 1, nextPrefix);
      }
    });
  }

  walkNode(root, 1, "");
  if (emitted >= maxLines) lines.push("… (tree truncated)");
  return lines.join("\n");
}

/**
 * Ekstrakcja eksportów (Public API)
 * - export function/name/const/class
 * - export { a, b as c }
 * - export default
 * - module.exports
 * - exports.foo =
 */
function extractExports(text) {
  const lines = text.split(/\r?\n/);
  const exports = [];

  const push = (kind, name, line) => exports.push({ kind, name, line });

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];

    let m = l.match(/^\s*export\s+function\s+([A-Za-z0-9_$]+)/);
    if (m) push("export function", m[1], i + 1);

    m = l.match(/^\s*export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/);
    if (m) push("export const", m[1], i + 1);

    m = l.match(/^\s*export\s+class\s+([A-Za-z0-9_$]+)/);
    if (m) push("export class", m[1], i + 1);

    m = l.match(/^\s*export\s*\{\s*([^}]+)\s*\}\s*;?\s*$/);
    if (m) push("export {..}", m[1].trim(), i + 1);

    m = l.match(/^\s*export\s+default\b/);
    if (m) push("export default", "(default)", i + 1);

    m = l.match(/^\s*module\.exports\s*=\s*(.+)\s*;?\s*$/);
    if (m) push("module.exports", m[1].trim().slice(0, 80), i + 1);

    m = l.match(/^\s*exports\.([A-Za-z0-9_$]+)\s*=\s*(.+)\s*;?\s*$/);
    if (m) push("exports.*", `${m[1]} = ${m[2].trim().slice(0, 60)}`, i + 1);
  }

  return exports;
}

/**
 * Function/Class index:
 * - function foo(
 * - async function foo(
 * - const foo = (...) =>
 * - const foo = async (...) =>
 * - export function foo(
 * - export const foo = (...) =>
 * - class Foo
 * - export class Foo
 *
 * UWAGA: to heurystyka (bez AST), ale w praktyce bardzo skuteczna do nawigacji.
 */
function extractFunctionsAndClasses(text, maxPerFile) {
  const lines = text.split(/\r?\n/);
  const out = [];
  const seen = new Set();

  const add = (kind, name, line) => {
    const key = `${kind}:${name}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, name, line });
  };

  for (let i = 0; i < lines.length; i++) {
    if (out.length >= maxPerFile) break;
    const l = lines[i];

    // export async function foo(
    let m = l.match(/^\s*export\s+async\s+function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (m) add("export async function", m[1], i + 1);

    // export function foo(
    m = l.match(/^\s*export\s+function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (m) add("export function", m[1], i + 1);

    // async function foo(
    m = l.match(/^\s*async\s+function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (m) add("async function", m[1], i + 1);

    // function foo(
    m = l.match(/^\s*function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (m) add("function", m[1], i + 1);

    // export class Foo
    m = l.match(/^\s*export\s+class\s+([A-Za-z0-9_$]+)/);
    if (m) add("export class", m[1], i + 1);

    // class Foo
    m = l.match(/^\s*class\s+([A-Za-z0-9_$]+)/);
    if (m) add("class", m[1], i + 1);

    // export const foo = async (...) =>
    m = l.match(/^\s*export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*async\b/);
    if (m) add("export const async", m[1], i + 1);

    // export const foo = (...) =>
    m = l.match(/^\s*export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/);
    if (m) add("export const arrow", m[1], i + 1);

    // const foo = async (...) =>
    m = l.match(/^\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*async\b/);
    if (m) add("const async", m[1], i + 1);

    // const foo = (...) =>
    m = l.match(/^\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/);
    if (m) add("const arrow", m[1], i + 1);
  }

  // odszumianie: usuń super krótkie "a", "b" itp. (jeśli złapie)
  return out.filter((x) => x.name.length >= 2);
}

/**
 * Import graph (lite):
 * - import ... from "./x"
 * - import "./x"
 * - require("./x")
 * Tylko lokalne ścieżki zaczynające się od "." lub ".."
 */
function extractLocalImports(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  const seen = new Set();

  const add = (spec, line) => {
    if (!spec) return;
    if (!(spec.startsWith("./") || spec.startsWith("../"))) return;
    const key = `${spec}#${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ spec, line });
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];

    let m = l.match(/^\s*import\s+.*?\s+from\s+["']([^"']+)["']\s*;?\s*$/);
    if (m) add(m[1], i + 1);

    m = l.match(/^\s*import\s+["']([^"']+)["']\s*;?\s*$/);
    if (m) add(m[1], i + 1);

    m = l.match(/require\s*\(\s*["']([^"']+)["']\s*\)/);
    if (m) add(m[1], i + 1);
  }

  return out;
}

function keywordHits(rel, text, keywords, maxHitsTotal) {
  const lines = text.split(/\r?\n/);
  const hits = [];
  const lowRel = rel.toLowerCase();

  if (lowRel.includes("dist/") || lowRel.includes("build/")) return [];

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    for (const kw of keywords) {
      if (!kw) continue;
      if (lineText.includes(kw)) {
        hits.push({
          keyword: kw,
          line: i + 1,
          preview: lineText.trim().slice(0, 160),
        });
        if (hits.length >= maxHitsTotal) return hits;
      }
    }
  }
  return hits;
}

function main() {
  const files = [];
  walk(ROOT, files);
  const sorted = sortFiles(files);
  const rels = sorted.map(normalizeRel);

  const projectName = path.basename(ROOT);
  const nowIso = new Date().toISOString();

  // read all files once (dla indeksów)
  const fileCache = new Map(); // rel -> { ok, text, reason, size }
  for (const f of sorted) {
    const rel = normalizeRel(f);
    const read = safeReadText(f);
    if (read.ok) {
      const redacted = redactIfNeeded(rel, read.text);
      fileCache.set(rel, { ...read, text: redacted });
    } else {
      fileCache.set(rel, read);
    }
  }

  // indeksy
  const exportIndex = []; // { rel, kind, name, line }
  const fnIndex = new Map(); // rel -> [{kind,name,line}]
  const keywordIndex = new Map(); // kw -> array of { rel, line, preview }
  const importGraph = new Map(); // rel -> imports [{spec,line}]

  for (const rel of rels) {
    const entry = fileCache.get(rel);
    if (!entry || !entry.ok) continue;

    // exports
    const ex = extractExports(entry.text);
    ex.forEach((e) => exportIndex.push({ rel, ...e }));

    // functions/classes
    const fns = extractFunctionsAndClasses(entry.text, FUNC_INDEX_MAX);
    if (fns.length) fnIndex.set(rel, fns);

    // keywords
    const hits = keywordHits(rel, entry.text, FINAL_KEYWORDS, KEYWORD_MAX_HITS);
    for (const h of hits) {
      if (!keywordIndex.has(h.keyword)) keywordIndex.set(h.keyword, []);
      keywordIndex.get(h.keyword).push({ rel, line: h.line, preview: h.preview });
    }

    // imports
    const im = extractLocalImports(entry.text);
    if (im.length) importGraph.set(rel, im);
  }

  // stats
  const extCounts = countByExt(sorted);
  const totalBytes = [...fileCache.values()].reduce((acc, v) => acc + (v?.size || 0), 0);

  // tree
  const tree = buildTree(rels, TREE_DEPTH, TREE_MAX_LINES);

  // build markdown
  let md = "";
  md += `# 📦 EXPORT PROJEKTU+: ${projectName}\n\n`;
  md += `**Root:** \`${ROOT}\`  \n`;
  md += `**Wygenerowano:** \`${nowIso}\`  \n`;
  md += `**Liczba plików:** \`${sorted.length}\`  \n`;
  md += `**Łączny rozmiar (raw):** \`${totalBytes} B\`  \n`;
  md += `**Max rozmiar pliku:** \`${MAX_BYTES} B\`  \n`;
  md += `**Redaction:** \`${REDACT ? "ON" : "OFF"}\`  \n\n`;

  md += `---\n\n`;

  md += `## 🗺️ Overview\n\n`;

  // ✅ Stała sekcja pod FB_Watcher – dokładnie jak chciałeś
  md += `## 🚪 Entrypoints & Flow\n\n`;
  md += `- src/index.js → główny start aplikacji\n`;
  md += `- src/watcher.js → główna pętla watchera\n`;
  md += `- src/panel/** → backend / frontend panelu\n`;
  md += `- tools/export-project-to-md.js → narzędzie eksportu projektu\n\n`;
  md += `---\n\n`;

  md += `### 📊 Statystyki\n\n`;
  md += `- Top rozszerzenia:\n`;
  extCounts.slice(0, 12).forEach(([ext, n]) => {
    md += `  - \`${ext}\`: **${n}**\n`;
  });
  md += `\n`;

  md += `### 🌳 Struktura (depth=${TREE_DEPTH})\n\n`;
  md += "```text\n" + tree + "\n```\n\n";

  md += `---\n\n`;

  // Public API index
  md += `## 📦 Public API (exports)\n\n`;
  if (exportIndex.length === 0) {
    md += `_Brak wykrytych eksportów (albo projekt jest w całości w jednym entry i bez exportów)._ \n\n`;
  } else {
    const byFile = new Map();
    for (const e of exportIndex) {
      if (!byFile.has(e.rel)) byFile.set(e.rel, []);
      byFile.get(e.rel).push(e);
    }

    for (const [rel, list] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const anchor = makeAnchor(rel);
      md += `### \`${rel}\` → [sekcja pliku](#${anchor})\n\n`;
      list.sort((a, b) => a.line - b.line);
      for (const e of list) {
        md += `- L${e.line}: **${e.kind}** \`${e.name}\`\n`;
      }
      md += `\n`;
    }
  }

  md += `---\n\n`;

  // Function/Class index
  md += `## 🧠 Function/Class index\n\n`;
  if (fnIndex.size === 0) {
    md += `_Brak wykrytych funkcji/klas (albo nie wykryto wzorców)._ \n\n`;
  } else {
    for (const [rel, list] of [...fnIndex.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const anchor = makeAnchor(rel);
      md += `### \`${rel}\` → [sekcja pliku](#${anchor})\n\n`;
      list.sort((a, b) => a.line - b.line);
      for (const x of list) {
        md += `- L${x.line}: **${x.kind}** \`${x.name}\`\n`;
      }
      md += `\n`;
    }
  }

  md += `---\n\n`;

  // Keyword index
  md += `## 🔎 Keyword index\n\n`;
  const kws = [...keywordIndex.entries()].sort((a, b) => b[1].length - a[1].length);
  if (kws.length === 0) {
    md += `_Brak trafień dla keywordów._\n\n`;
  } else {
    for (const [kw, hits] of kws) {
      md += `### \`${kw}\` (hits: ${hits.length})\n\n`;
      hits.slice(0, KEYWORD_MAX_HITS).forEach((h) => {
        md += `- \`${h.rel}\` L${h.line}: \`${h.preview}\`\n`;
      });
      md += `\n`;
    }
  }

  md += `---\n\n`;

  // Import graph lite
  md += `## 🧩 Import graph (lite)\n\n`;
  if (importGraph.size === 0) {
    md += `_Brak lokalnych importów (albo nie wykryto wzorców import/require)._ \n\n`;
  } else {
    for (const [rel, im] of [...importGraph.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      md += `### \`${rel}\`\n\n`;
      im.forEach((x) => {
        md += `- L${x.line}: \`${x.spec}\`\n`;
      });
      md += `\n`;
    }
  }

  md += `---\n\n`;

  // File table of contents
  md += `## 🧭 Spis treści plików\n`;
  for (const rel of rels) {
    md += `- [${rel}](#${makeAnchor(rel)})\n`;
  }
  md += `\n---\n\n`;

  // Full file contents
  for (const f of sorted) {
    const rel = normalizeRel(f);
    const lang = detectLang(f);
    const typ = typeLabel(f);
    const desc = guessDescription(rel);

    md += `### 📄 Ścieżka: \`${rel}\`\n`;
    md += `**Typ:** ${typ}  \n`;
    md += `**Opis:** ${desc}  \n\n`;

    const entry = fileCache.get(rel);
    if (!entry || !entry.ok) {
      md += `**UWAGA:** pominięto treść → ${entry?.reason || "unknown"}  \n\n---\n\n`;
      continue;
    }

    md += `\`\`\`${lang}\n${addLineNumbers(entry.text)}\n\`\`\`\n\n---\n\n`;
  }

  fs.writeFileSync(OUT_FILE, md, "utf8");
  console.log(`[EXPORT+] OK -> ${OUT_FILE}`);
  console.log(`[EXPORT+] Plików: ${sorted.length}`);
  console.log(`[EXPORT+] Exports: ${exportIndex.length}`);
  console.log(`[EXPORT+] Function index: ${fnIndex.size} files`);
  console.log(`[EXPORT+] Keywords: ${kws.length} keys`);
  console.log(`[EXPORT+] Import graph: ${importGraph.size} files`);
}

try {
  main();
} catch (e) {
  console.error("[EXPORT+] ERROR:", e?.stack || e?.message || String(e));
  process.exit(1);
}
