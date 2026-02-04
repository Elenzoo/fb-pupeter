// tools/test-feed-scanner.js
// Test Feed Scanner lokalnie

import "dotenv/config";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { loadCookies } from "../src/fb/cookies.js";
import { scanFeed, loadDiscoveries } from "../src/lite/feedScanner.js";
import { loadKeywordsFromFile, getActiveKeywords } from "../src/lite/index.js";
import log from "../src/utils/logger.js";

puppeteer.use(StealthPlugin());

async function testFeedScanner() {
  console.log("=== TEST FEED SCANNER ===\n");

  // 1. Sprawdź keywords
  console.log("1. Sprawdzam keywords.json...");
  const keywordsData = loadKeywordsFromFile();
  console.log("   - enabled:", keywordsData.enabled);
  console.log("   - keywords count:", keywordsData.keywords.length);
  console.log("   - keywords:", keywordsData.keywords.map(k => `${k.text}(${k.enabled ? "ON" : "OFF"})`).join(", "));

  const activeKeywords = getActiveKeywords();
  console.log("   - activeKeywords:", activeKeywords.join(", "));

  if (!keywordsData.enabled) {
    console.log("\n❌ Feed Scanner WYŁĄCZONY (enabled: false)");
    return;
  }
  if (activeKeywords.length === 0) {
    console.log("\n❌ Brak aktywnych keywords");
    return;
  }

  console.log("\n✅ Konfiguracja OK\n");

  // 2. Sprawdź discoveries
  console.log("2. Aktualny stan discoveries...");
  const discoveries = await loadDiscoveries();
  console.log("   - discoveries count:", discoveries.length);
  if (discoveries.length > 0) {
    discoveries.slice(0, 3).forEach(d => {
      console.log(`   - [${d.status}] ${d.pageName}: ${d.matchedKeywords.join(", ")}`);
    });
  }

  // 3. Uruchom przeglądarkę
  console.log("\n3. Uruchamiam przeglądarkę...");
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
    defaultViewport: { width: 1366, height: 768 },
  });

  const page = await browser.newPage();

  // 4. Załaduj cookies
  console.log("4. Ładuję cookies...");
  try {
    await loadCookies(page);
    console.log("   ✅ Cookies załadowane");
  } catch (err) {
    console.log("   ❌ Błąd ładowania cookies:", err.message);
    await browser.close();
    return;
  }

  // 5. Idź na Facebooka
  console.log("5. Nawiguję na facebook.com...");
  await page.goto("https://www.facebook.com/", {
    waitUntil: "networkidle2",
    timeout: 30000,
  });

  // Sprawdź czy zalogowany
  const isLoggedIn = await page.evaluate(() => {
    return !!document.querySelector('[aria-label="Your profile"], [aria-label="Twój profil"]');
  });
  console.log("   - Zalogowany:", isLoggedIn ? "TAK" : "NIE");

  if (!isLoggedIn) {
    console.log("\n❌ Nie zalogowano - sprawdź cookies");
    await browser.close();
    return;
  }

  // 6. Test ekstrakcji postów
  console.log("\n6. Testuję ekstrakcję postów z feed...");

  // Import extractVisiblePosts
  const { extractVisiblePosts } = await import("../src/lite/feedScanner.js");

  // Scroll trochę żeby załadować posty
  await page.evaluate(() => window.scrollBy(0, 500));
  await new Promise(r => setTimeout(r, 2000));

  const posts = await extractVisiblePosts(page);
  console.log(`   - Znaleziono ${posts.length} postów na widoku`);

  if (posts.length > 0) {
    console.log("   - Przykładowe posty:");
    posts.slice(0, 3).forEach((p, i) => {
      console.log(`     ${i + 1}. ${p.pageName}: "${p.content.substring(0, 80)}..."`);
      console.log(`        URL: ${p.url.substring(0, 60)}...`);
    });
  } else {
    console.log("\n⚠️  BRAK POSTÓW - sprawdź selektory w extractVisiblePosts()");
    console.log("   Możliwe że Facebook zmienił UI");
  }

  // 7. Uruchom pełny scan (opcjonalne)
  console.log("\n7. Czy uruchomić pełny scan? (30 sekund)");
  console.log("   Czekam 5 sekund... zamknij okno jeśli nie chcesz");
  await new Promise(r => setTimeout(r, 5000));

  console.log("\n8. Uruchamiam scanFeed() - 30 sekund...");
  try {
    const scanResult = await scanFeed(page, {
      keywords: activeKeywords,
      watchedUrls: [],
      scrollDurationMin: 0.5, // 30 sekund
      scrollDurationMax: 0.5,
      likeChance: 0, // bez lajkowania w teście
      onDiscovery: async (discovery) => {
        console.log(`\n   🎉 NOWY DISCOVERY: ${discovery.pageName}`);
        console.log(`      Keywords: ${discovery.matchedKeywords.join(", ")}`);
        console.log(`      URL: ${discovery.url}`);
      },
    });

    console.log("\n=== WYNIKI SCAN ===");
    console.log("   - discoveries:", scanResult.discoveries.length);
    console.log("   - scrolls:", scanResult.scrolled);
    console.log("   - likes:", scanResult.liked);

    if (scanResult.discoveries.length === 0) {
      console.log("\n   ℹ️  Brak nowych discoveries");
      console.log("   (może nie ma postów z tymi keywords w feed)");
    }
  } catch (err) {
    console.log("\n❌ Błąd podczas scan:", err.message);
    console.log(err.stack);
  }

  // 9. Zamknij
  console.log("\n9. Zamykam przeglądarkę za 5 sekund...");
  await new Promise(r => setTimeout(r, 5000));
  await browser.close();

  console.log("\n=== KONIEC TESTU ===");
}

testFeedScanner().catch(console.error);
