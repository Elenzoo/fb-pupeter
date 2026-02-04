// tools/debug-fb-selectors.js
// Debug selektorów Facebook - sprawdź jakie elementy są na stronie

import "dotenv/config";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { loadCookies } from "../src/fb/cookies.js";

puppeteer.use(StealthPlugin());

async function debugSelectors() {
  console.log("=== DEBUG SELEKTORÓW FACEBOOK ===\n");

  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 1366, height: 768 },
  });

  const page = await browser.newPage();

  console.log("1. Ładuję cookies...");
  try {
    await loadCookies(page);
    console.log("   ✅ Cookies załadowane");
  } catch (err) {
    console.log("   ❌ Błąd cookies:", err.message);
    await browser.close();
    return;
  }

  console.log("2. Nawiguję na facebook.com...");
  await page.goto("https://www.facebook.com/", {
    waitUntil: "networkidle2",
    timeout: 30000,
  });

  // Sprawdź czy zalogowany
  const isLoggedIn = await page.evaluate(() => {
    return !!document.querySelector('[aria-label="Your profile"], [aria-label="Twój profil"]');
  });
  console.log("   Zalogowany:", isLoggedIn ? "TAK" : "NIE");

  if (!isLoggedIn) {
    console.log("❌ Nie zalogowano!");
    await browser.close();
    return;
  }

  // Scroll żeby załadować posty
  console.log("\n3. Scrolluję żeby załadować posty...");
  await page.evaluate(() => window.scrollBy(0, 1000));
  await new Promise(r => setTimeout(r, 3000));

  console.log("\n4. Testuję selektory...\n");

  const selectorTests = await page.evaluate(() => {
    const results = {};

    // Stare selektory
    results['[role="article"]'] = document.querySelectorAll('[role="article"]').length;
    results['[data-pagelet*="FeedUnit"]'] = document.querySelectorAll('[data-pagelet*="FeedUnit"]').length;
    results['div[data-ad-preview]'] = document.querySelectorAll('div[data-ad-preview]').length;

    // Nowe potencjalne selektory
    results['[data-pagelet^="FeedUnit"]'] = document.querySelectorAll('[data-pagelet^="FeedUnit"]').length;
    results['[data-pagelet^="Feed"]'] = document.querySelectorAll('[data-pagelet^="Feed"]').length;
    results['div[class*="x1yztbdb"]'] = document.querySelectorAll('div[class*="x1yztbdb"]').length;
    results['[role="feed"] > div'] = document.querySelectorAll('[role="feed"] > div').length;
    results['[role="main"] [role="article"]'] = document.querySelectorAll('[role="main"] [role="article"]').length;
    results['[data-virtualized="false"]'] = document.querySelectorAll('[data-virtualized="false"]').length;

    // Linki do postów
    results['a[href*="/posts/"]'] = document.querySelectorAll('a[href*="/posts/"]').length;
    results['a[href*="/permalink/"]'] = document.querySelectorAll('a[href*="/permalink/"]').length;
    results['a[href*="story_fbid"]'] = document.querySelectorAll('a[href*="story_fbid"]').length;
    results['a[href*="/photo/"]'] = document.querySelectorAll('a[href*="/photo/"]').length;
    results['a[href*="/videos/"]'] = document.querySelectorAll('a[href*="/videos/"]').length;
    results['a[href*="pfbid"]'] = document.querySelectorAll('a[href*="pfbid"]').length;

    // Feed container
    results['[role="feed"]'] = document.querySelectorAll('[role="feed"]').length;
    results['[role="main"]'] = document.querySelectorAll('[role="main"]').length;

    return results;
  });

  console.log("   Wyniki selektorów:");
  for (const [selector, count] of Object.entries(selectorTests)) {
    const status = count > 0 ? "✅" : "❌";
    console.log(`   ${status} ${selector}: ${count}`);
  }

  // Pobierz przykładowy HTML głównego kontenera
  console.log("\n5. Sprawdzam strukturę postów...");

  const feedStructure = await page.evaluate(() => {
    const feed = document.querySelector('[role="feed"]');
    if (!feed) return { error: "Nie znaleziono [role='feed']" };

    const children = Array.from(feed.children).slice(0, 5);
    return {
      feedTagName: feed.tagName,
      feedClasses: feed.className.substring(0, 100),
      childCount: feed.children.length,
      firstChildren: children.map(c => ({
        tagName: c.tagName,
        className: c.className.substring(0, 100),
        hasArticle: !!c.querySelector('[role="article"]'),
        dataPagelet: c.getAttribute('data-pagelet'),
        hasPostLink: !!c.querySelector('a[href*="/posts/"], a[href*="pfbid"], a[href*="story_fbid"]'),
      }))
    };
  });

  console.log("   Feed struktura:", JSON.stringify(feedStructure, null, 2));

  // Pobierz przykładowe linki
  console.log("\n6. Przykładowe linki do postów:");
  const postLinks = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="/posts/"], a[href*="pfbid"], a[href*="story_fbid"], a[href*="/photo/"]');
    return Array.from(links).slice(0, 10).map(l => ({
      href: l.href.substring(0, 100),
      text: l.textContent.substring(0, 50),
      parentClasses: l.closest('[role="article"]')?.className.substring(0, 50) || "brak"
    }));
  });

  postLinks.forEach((l, i) => {
    console.log(`   ${i+1}. ${l.href}...`);
    console.log(`      text: ${l.text || "(brak)"}`);
    console.log(`      parent article: ${l.parentClasses}`);
  });

  console.log("\n7. Zamykam za 30 sekund (możesz sprawdzić ręcznie)...");
  await new Promise(r => setTimeout(r, 30000));
  await browser.close();

  console.log("\n=== KONIEC DEBUG ===");
}

debugSelectors().catch(console.error);
