/**
 * Meta Ads Scanner - punkt wejścia
 * Skanuje bibliotekę reklam Meta i wysyła znalezione posty do panelu watchera
 */

import { parseArgs } from "node:util";
import { log } from "../utils/logger.js";
import {
  METAADS_KEYWORDS,
  METAADS_SCAN_INTERVAL_H,
  METAADS_AUTO_SEND_TO_WATCHER,
  POSTS_API_URL,
  POSTS_API_TOKEN,
} from "../config.js";
import { scanKeyword } from "./scanner.js";
import { loadCache, saveCache, markAsSent, cleanOldEntries, getCacheStats } from "./cache.js";

// Parsowanie argumentów CLI
const { values: args } = parseArgs({
  options: {
    keywords: { type: "string", short: "k" },
    once: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: false,
});

function printHelp() {
  console.log(`
Meta Ads Scanner - wyszukiwanie reklam w bibliotece Meta

Użycie:
  node src/metaads/index.js [opcje]

Opcje:
  -k, --keywords "słowo1,słowo2"   Słowa kluczowe do wyszukania
  --once                           Pojedyncze skanowanie (bez pętli)
  --dry-run                        Tylko skanuj, nie wysyłaj do panelu
  -h, --help                       Pokaż pomoc

Przykłady:
  node src/metaads/index.js --keywords "garaże blaszane"
  node src/metaads/index.js --once --dry-run
  node src/metaads/index.js  # używa METAADS_KEYWORDS z .env

Konfiguracja (.env):
  METAADS_KEYWORDS=garaże blaszane,hale magazynowe
  METAADS_COUNTRY=PL
  METAADS_SCAN_INTERVAL_H=12
  METAADS_AUTO_SEND_TO_WATCHER=true
  METAADS_HEADLESS=false  # false = widoczna przeglądarka
`);
}

/**
 * Wysyła post do panelu watchera
 */
async function sendToWatcher(ad) {
  if (!POSTS_API_URL) {
    log.dev("METAADS", "Brak POSTS_API_URL - pomijam wysyłkę do panelu");
    return false;
  }

  const isPromotedPost = !!ad.postUrl;
  const payload = {
    url: isPromotedPost ? ad.postUrl : `https://facebook.com/${ad.pageId}`,
    name: `${isPromotedPost ? "[ADS]" : "[DARK]"} ${ad.pageName}`,
    description: ad.adText.slice(0, 200) + (ad.adText.length > 200 ? "..." : ""),
    enabled: true,
    source: "metaads-scanner",
    metadata: {
      adId: ad.adId,
      pageId: ad.pageId,
      adSnapshotUrl: ad.adSnapshotUrl,
      startDate: ad.startDate,
      isDarkPost: !isPromotedPost,
    },
  };

  try {
    const response = await fetch(POSTS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(POSTS_API_TOKEN && { Authorization: `Bearer ${POSTS_API_TOKEN}` }),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      log.warn("METAADS", `Błąd wysyłki do panelu: ${response.status} - ${text}`);
      return false;
    }

    log.prod("METAADS", `Wysłano do panelu: ${payload.name}`);
    return true;
  } catch (err) {
    log.warn("METAADS", `Błąd połączenia z panelem: ${err.message}`);
    return false;
  }
}

/**
 * Główna funkcja skanowania
 */
async function runScan(keywords, dryRun = false) {
  log.prod("METAADS", `Start skanowania dla: ${keywords.join(", ")}`);

  const cache = loadCache();
  let totalNew = 0;
  let totalSent = 0;

  for (const keyword of keywords) {
    log.prod("METAADS", `Skanowanie: "${keyword}"`);

    try {
      const ads = await scanKeyword(keyword);
      log.dev("METAADS", `Znaleziono ${ads.length} reklam dla "${keyword}"`);

      for (const ad of ads) {
        const cacheKey = `keyword:${keyword}`;
        const existing = cache[cacheKey]?.[ad.adId];

        if (existing) {
          // Aktualizuj lastSeen
          cache[cacheKey][ad.adId].lastSeen = new Date().toISOString();
          continue;
        }

        // Nowa reklama
        totalNew++;
        log.success("METAADS", `Nowa reklama: ${ad.pageName} (${ad.adId})`);

        // Zapisz do cache
        if (!cache[cacheKey]) cache[cacheKey] = {};
        cache[cacheKey][ad.adId] = {
          ...ad,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          sentToWatcher: false,
        };

        // Wyślij do panelu
        if (!dryRun && METAADS_AUTO_SEND_TO_WATCHER) {
          const sent = await sendToWatcher(ad);
          if (sent) {
            cache[cacheKey][ad.adId].sentToWatcher = true;
            totalSent++;
          }
        }
      }
    } catch (err) {
      log.error("METAADS", `Błąd skanowania "${keyword}": ${err.message}`);
    }
  }

  // Czyszczenie starych wpisów (30 dni TTL)
  cleanOldEntries(cache, 30);

  saveCache(cache);

  // Monitoring - alert przy 0 nowych reklam
  if (totalNew === 0) {
    log.warn("METAADS", `Brak nowych reklam - sprawdź czy wszystko działa poprawnie`);
  }

  // Statystyki cache
  const stats = getCacheStats(cache);
  log.prod("METAADS", `Zakończono: ${totalNew} nowych, ${totalSent} wysłanych`);
  log.dev("METAADS", `Cache: ${stats.totalAds} reklam, ${stats.totalSent} wysłanych, ${stats.totalDarkPosts} dark posts`);

  return { totalNew, totalSent, stats };
}

/**
 * Pętla skanowania (co X godzin)
 */
async function startLoop(keywords, dryRun = false) {
  const intervalMs = METAADS_SCAN_INTERVAL_H * 60 * 60 * 1000;

  while (true) {
    await runScan(keywords, dryRun);
    log.prod("METAADS", `Następne skanowanie za ${METAADS_SCAN_INTERVAL_H}h`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Main
 */
async function main() {
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Pobierz keywords z argumentów lub .env
  const keywordsStr = args.keywords || METAADS_KEYWORDS;
  if (!keywordsStr) {
    console.error("Błąd: Brak słów kluczowych. Użyj --keywords lub ustaw METAADS_KEYWORDS w .env");
    process.exit(1);
  }

  const keywords = keywordsStr.split(",").map((k) => k.trim()).filter(Boolean);
  const dryRun = args["dry-run"];

  if (dryRun) {
    log.prod("METAADS", "Tryb dry-run - nie będę wysyłać do panelu");
  }

  if (args.once) {
    await runScan(keywords, dryRun);
  } else {
    await startLoop(keywords, dryRun);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
