// tools/test-extract-posts2.js
// Debug głębszy - sprawdź strukturę DOM

import "dotenv/config";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { loadCookies } from "../src/fb/cookies.js";

puppeteer.use(StealthPlugin());

async function test() {
  console.log("=== DEBUG STRUKTURA POSTÓW ===\n");

  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox"],
    defaultViewport: { width: 1366, height: 768 },
  });

  const page = await browser.newPage();
  await loadCookies(page);
  await page.goto("https://www.facebook.com/", { waitUntil: "networkidle2" });

  // Scroll więcej
  console.log("Scrolluję więcej...");
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log("\nAnaliza struktury...\n");

  const analysis = await page.evaluate(() => {
    const results = [];

    // Znajdź wszystkie article
    const articles = document.querySelectorAll('[role="article"]');
    console.log("Articles found:", articles.length);

    for (let i = 0; i < Math.min(articles.length, 5); i++) {
      const article = articles[i];
      const item = { index: i };

      // Linki
      const links = article.querySelectorAll('a[href*="facebook.com"]');
      item.links = Array.from(links).slice(0, 5).map(l => ({
        href: l.href.substring(0, 80),
        text: l.textContent.substring(0, 30),
      }));

      // Tekst - szukaj span bez dzieci lub z małą ilością dzieci
      const spans = article.querySelectorAll('span');
      const textSpans = [];
      for (const span of spans) {
        const text = span.textContent?.trim() || "";
        // Szukaj spanów które mają tekst i nie są w nav/header
        if (
          text.length > 20 &&
          text.length < 1000 &&
          !span.closest('nav') &&
          !span.closest('[role="navigation"]') &&
          !text.includes("Facebook") &&
          !text.includes("Lubię to") &&
          !text.includes("Komentarz")
        ) {
          // Sprawdź czy to "liść" (nie ma dużo dzieci span)
          const childSpans = span.querySelectorAll('span');
          if (childSpans.length < 3) {
            textSpans.push(text.substring(0, 100));
          }
        }
      }
      item.textSpans = textSpans.slice(0, 3);

      // Zobacz div z klasami - szukaj głównej treści
      const divs = article.querySelectorAll('div[dir="auto"]');
      item.divsWithAuto = Array.from(divs).slice(0, 3).map(d => ({
        text: d.textContent.substring(0, 100),
        classes: d.className.substring(0, 50),
      }));

      results.push(item);
    }

    return results;
  });

  console.log("Analiza artykułów:\n");
  analysis.forEach(item => {
    console.log(`=== Artykuł #${item.index} ===`);
    console.log("Linki:", JSON.stringify(item.links, null, 2));
    console.log("Teksty span:", item.textSpans);
    console.log("Div dir=auto:", JSON.stringify(item.divsWithAuto, null, 2));
    console.log();
  });

  console.log("Zamykam za 30 sekund...");
  await new Promise(r => setTimeout(r, 30000));
  await browser.close();
}

test().catch(console.error);
