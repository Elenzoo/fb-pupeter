// tools/test-extract-posts.js
// Szybki test extractVisiblePosts

import "dotenv/config";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { loadCookies } from "../src/fb/cookies.js";
import { extractVisiblePosts } from "../src/lite/feedScanner.js";

puppeteer.use(StealthPlugin());

async function test() {
  console.log("=== TEST extractVisiblePosts ===\n");

  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox"],
    defaultViewport: { width: 1366, height: 768 },
  });

  const page = await browser.newPage();
  await loadCookies(page);
  await page.goto("https://www.facebook.com/", { waitUntil: "networkidle2" });

  // Scroll
  console.log("Scrolluję...");
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 500));
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log("\nEkstrahuję posty...\n");
  const posts = await extractVisiblePosts(page);

  console.log(`Znaleziono ${posts.length} postów:\n`);
  posts.forEach((p, i) => {
    console.log(`${i+1}. ${p.pageName}`);
    console.log(`   URL: ${p.url.substring(0, 80)}...`);
    console.log(`   Content: ${p.content.substring(0, 100)}...`);
    console.log();
  });

  console.log("\nZamykam za 10 sekund...");
  await new Promise(r => setTimeout(r, 10000));
  await browser.close();
}

test().catch(console.error);
