// src/config/links.js
import fs from "fs";
import path from "path";

// Jeśli masz Node <18, odkomentuj te dwie linijki:
// import fetch from "node-fetch";
// global.fetch = fetch;

const LINKS_SHEET_URL = process.env.LINKS_SHEET_URL;
const LOCAL_FILE = path.join(process.cwd(), "config", "links.json");

let linksCache = [];
let lastHash = null;

/* ============================================
   Prost y "hash" listy linków
   ============================================ */
function calcHash(urls) {
  return urls.join("|");
}

/* ============================================
   Wczytanie lokalnego pliku JSON
   ============================================ */
function loadLinksFromLocalFile() {
  try {
    const raw = fs.readFileSync(LOCAL_FILE, "utf8");
    const data = JSON.parse(raw);

    if (Array.isArray(data.links)) {
      const cleaned = data.links
        .filter((u) => typeof u === "string")
        .map((u) => u.trim())
        .filter((u) => u.startsWith("http"));

      console.log("[CFG] Załadowane linki z lokalnego pliku:", cleaned);
      return cleaned;
    }

    console.warn("[CFG] Lokalny links.json nie zawiera poprawnego pola 'links'");
    return [];
  } catch (err) {
    console.warn("[CFG] Brak / błąd wczytywania links.json:", err.message);
    return [];
  }
}

/* ============================================
   Parser CSV z Sheetsa
   ============================================ */
function parseCsv(text) {
  const hasSemicolon = text.includes(";");
  const delimiter = hasSemicolon ? ";" : ",";

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const header = lines[0].split(delimiter).map((h) => h.trim().toLowerCase());

  const idxActive = header.indexOf("active");
  const idxUrl = header.indexOf("url");

  if (idxUrl === -1) {
    console.warn("[CFG] W CSV nie znaleziono kolumny 'url'");
    return [];
  }

  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map((c) => c.trim());

    const url = cols[idxUrl] || "";
    if (!url || !url.startsWith("http")) continue;

    let active = true;

    if (idxActive !== -1) {
      const val = (cols[idxActive] || "").toLowerCase();
      active = val === "true" || val === "1" || val === "yes" || val === "y";
    }

    if (!active) continue;

    rows.push(url);
  }

  return rows;
}

/* ============================================
   Pobranie linków z Sheeta lub lokalnie
   ============================================ */
async function fetchLinks() {
  if (!LINKS_SHEET_URL) {
    console.warn("[CFG] Brak LINKS_SHEET_URL w .env – używam lokalnego pliku");
    return loadLinksFromLocalFile();
  }

  try {
    console.log("[CFG] Pobieram linki z Google Sheeta...");
    const res = await fetch(LINKS_SHEET_URL);

    if (!res.ok) {
      console.warn("[CFG] Błąd HTTP przy pobieraniu CSV:", res.status, res.statusText);
      return loadLinksFromLocalFile();
    }

    const text = await res.text();
    const urls = parseCsv(text);
    const unique = [...new Set(urls)];

    // backup
    const payload = { links: unique };
    fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(payload, null, 2), "utf8");
    console.log("[CFG] Zapisano backup do links.json");

    return unique;
  } catch (err) {
    console.error("[CFG] Błąd przy pobieraniu linków z Sheeta:", err.message);
    console.warn("[CFG] Próba użycia lokalnego links.json jako fallback");
    return loadLinksFromLocalFile();
  }
}

/* ============================================
   Reload z porównaniem hashy
   ============================================ */
async function reloadLinks() {
  const urls = await fetchLinks();
  const hash = calcHash(urls);

  if (hash === lastHash) {
    console.log("[CFG] Linki bez zmian (hash taki sam)");
    return;
  }

  lastHash = hash;
  linksCache = urls;

  console.log("[CFG] Zaktualizowane linki:", linksCache);
}

/* ============================================
   API eksportowane dla reszty programu
   ============================================ */
export async function initLinks(autoRefreshMs = 0) {
  await reloadLinks(); // pierwszy load

  if (autoRefreshMs > 0) {
    console.log(
      `[CFG] Auto-refresh linków co ${Math.round(autoRefreshMs / 1000)}s`
    );

    setInterval(() => {
      reloadLinks().catch((err) =>
        console.error("[CFG] Błąd przy auto-refresh linków:", err.message)
      );
    }, autoRefreshMs);
  }
}

export function getLinks() {
  return linksCache;
}
