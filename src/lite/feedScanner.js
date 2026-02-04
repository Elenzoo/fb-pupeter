// src/lite/feedScanner.js
// Skanowanie tablicy Facebook - wyszukiwanie postów po keywords

import { gaussianRandom, sleep } from "../utils/sleep.js";
import { feedScrollSession, smoothScrollBy } from "./smoothScroll.js";
import { maybeRandomLike } from "./randomActions.js";
import { createKeywordMatcher } from "./keywordMatcher.js";
import log from "../utils/logger.js";
import fs from "fs/promises";
import path from "path";

/**
 * Ścieżki do plików danych
 */
const DATA_DIR = "data";
const DISCOVERIES_FILE = path.join(DATA_DIR, "discoveries.json");
const BLACKLIST_FILE = path.join(DATA_DIR, "blacklist.json");

/**
 * Ładuje discoveries z pliku
 * @returns {Promise<Array>}
 */
async function loadDiscoveries() {
  try {
    const data = await fs.readFile(DISCOVERIES_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

/**
 * Zapisuje discoveries do pliku
 * @param {Array} discoveries
 */
async function saveDiscoveries(discoveries) {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DISCOVERIES_FILE, JSON.stringify(discoveries, null, 2));
  } catch (err) {
    log.dev("FEED", `Błąd zapisu discoveries: ${err.message}`);
  }
}

/**
 * Ładuje blacklist z pliku
 * @returns {Promise<Array>}
 */
async function loadBlacklist() {
  try {
    const data = await fs.readFile(BLACKLIST_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

/**
 * Zapisuje blacklist do pliku
 * @param {Array} blacklist
 */
async function saveBlacklist(blacklist) {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(BLACKLIST_FILE, JSON.stringify(blacklist, null, 2));
  } catch (err) {
    log.dev("FEED", `Błąd zapisu blacklist: ${err.message}`);
  }
}

/**
 * Generuje unikalny ID dla discovery
 * @returns {string}
 */
function generateDiscoveryId() {
  return `disc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Ekstrahuje posty z aktualnego widoku strony
 * @param {import('puppeteer').Page} page
 * @returns {Promise<Array<{url: string, content: string, pageName: string}>>}
 */
async function extractVisiblePosts(page) {
  return page.evaluate(() => {
    const posts = [];
    const seenUrls = new Set();

    // Selektory dla postów FB (zaktualizowane 2026-02)
    const postContainers = document.querySelectorAll(
      '[role="article"], [data-virtualized="false"], div[data-ad-preview]'
    );

    for (const container of postContainers) {
      try {
        // Znajdź link do posta (rozszerzone selektory - FB używa różnych formatów)
        const postLink = container.querySelector(
          'a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"], ' +
          'a[href*="/photo/"], a[href*="/reel/"], a[href*="pfbid"], a[href*="/videos/"]'
        );

        if (!postLink) continue;

        // Deduplikacja po URL
        const url = postLink.href.split("?")[0]; // Usuń query string
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);

        // Tekst posta - szukaj głównej treści
        // Najpierw spróbuj znaleźć data-ad-preview="message" (reklamy)
        // Potem szukaj większych bloków tekstu w [dir="auto"]
        let content = "";

        // Metoda 1: data-ad-preview="message" (dla reklam)
        const adMessage = container.querySelector('[data-ad-preview="message"]');
        if (adMessage) {
          content = adMessage.textContent?.trim() || "";
        }

        // Metoda 2: znajdź największy blok tekstu w [dir="auto"]
        if (!content || content.length < 20) {
          const textElements = container.querySelectorAll('[dir="auto"]');
          let longestText = "";
          for (const el of textElements) {
            const text = el.textContent?.trim() || "";
            // Filtruj menu/nawigację/przyciski
            if (
              text.length > longestText.length &&
              text.length > 10 &&
              !text.includes("Facebook") &&
              !text.includes("Lubię to") &&
              !text.includes("Komentarz") &&
              !text.includes("Udostępnij") &&
              !text.includes("Zobacz") &&
              !el.closest('nav') &&
              !el.closest('[role="navigation"]') &&
              !el.closest('[role="banner"]')
            ) {
              longestText = text;
            }
          }
          if (longestText.length > content.length) {
            content = longestText;
          }
        }
        content = content.trim();

        // Nazwa strony/użytkownika - szukaj w różnych miejscach
        let pageName = "Unknown";
        const pageNameSelectors = [
          'h2 a', 'h3 a', 'h4 a', 'strong a',
          '[role="link"] span', 'a[role="link"] span',
          'a[href*="facebook.com/"][aria-label]'
        ];
        for (const sel of pageNameSelectors) {
          const el = container.querySelector(sel);
          if (el) {
            const text = el.textContent?.trim() || el.getAttribute('aria-label');
            if (text && text.length > 1 && text.length < 100) {
              pageName = text;
              break;
            }
          }
        }

        if (content.length > 10) {
          posts.push({
            url: postLink.href,
            content: content.substring(0, 500), // Max 500 znaków
            pageName,
          });
        }
      } catch {
        // Ignoruj błędy pojedynczych postów
      }
    }

    return posts;
  });
}

/**
 * Skanuje tablicę w poszukiwaniu postów z keywords
 * @param {import('puppeteer').Page} page
 * @param {object} options
 * @returns {Promise<{discoveries: Array, liked: number, scrolled: number}>}
 */
async function scanFeed(page, options = {}) {
  const {
    keywords = [],
    watchedUrls = [],       // URLe już monitorowane
    blacklistUrls = [],     // URLe na blackliście
    scrollDurationMin = 1,  // minuty
    scrollDurationMax = 3,
    likeChance = 0.20,
    onDiscovery = null,     // callback dla nowego discovery
  } = options;

  log.dev("FEED", `Rozpoczynam skanowanie (keywords: ${keywords.join(", ")})`);

  // Stwórz matcher
  const matcher = createKeywordMatcher(keywords);

  // Załaduj istniejące discoveries i blacklist
  const existingDiscoveries = await loadDiscoveries();
  const existingBlacklist = await loadBlacklist();

  // Zbiór znanych URLi (do deduplikacji)
  const knownUrls = new Set([
    ...watchedUrls,
    ...blacklistUrls,
    ...existingDiscoveries.map(d => d.url),
    ...existingBlacklist.map(b => b.url),
  ]);

  const newDiscoveries = [];
  let likeCount = 0;
  let scrollCount = 0;

  // Nawiguj na feed jeśli trzeba
  const currentUrl = page.url();
  if (!currentUrl.includes("facebook.com") || currentUrl.includes("/login")) {
    await page.goto("https://www.facebook.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(gaussianRandom(2000, 500));
  }

  // Oblicz czas scrollowania
  const scrollDuration = gaussianRandom(
    ((scrollDurationMin + scrollDurationMax) / 2) * 60 * 1000,
    ((scrollDurationMax - scrollDurationMin) / 4) * 60 * 1000
  );
  const clampedDuration = Math.max(
    scrollDurationMin * 60 * 1000,
    Math.min(scrollDurationMax * 60 * 1000, scrollDuration)
  );

  log.dev("FEED", `Scroll przez ${Math.round(clampedDuration / 1000)}s`);

  const startTime = Date.now();

  while (Date.now() - startTime < clampedDuration) {
    // Ekstrahuj widoczne posty
    const posts = await extractVisiblePosts(page);

    // DEBUG: loguj ile postów znaleziono (tylko przy pierwszym scroll)
    if (scrollCount === 0) {
      log.dev("FEED", `extractVisiblePosts: ${posts.length} postów na widoku`);
    }

    for (const post of posts) {
      // Skip znane
      if (knownUrls.has(post.url)) continue;

      // Sprawdź keywords
      const { matched } = matcher.match(post.content);

      if (matched.length > 0) {
        // Nowy discovery!
        const discovery = {
          id: generateDiscoveryId(),
          url: post.url,
          content: post.content,
          pageName: post.pageName,
          matchedKeywords: matched,
          source: "home_feed",
          discoveredAt: new Date().toISOString(),
          status: "pending",
        };

        newDiscoveries.push(discovery);
        knownUrls.add(post.url);

        log.prod("FEED", `Znaleziono: "${post.pageName}" (keywords: ${matched.join(", ")})`);

        // Callback
        if (onDiscovery) {
          try {
            await onDiscovery(discovery);
          } catch {
            // Ignoruj
          }
        }
      }

      // Dodaj URL do znanych (nawet bez match, żeby nie sprawdzać ponownie)
      knownUrls.add(post.url);
    }

    // Scroll
    const scrollAmount = Math.round(gaussianRandom(350, 80));
    await smoothScrollBy(page, scrollAmount);
    scrollCount++;

    // Pauza między scrollami
    await sleep(gaussianRandom(2000, 500));

    // Może polub losowy post
    if (Math.random() < likeChance / 10) { // Podziel przez 10 bo to w pętli
      const liked = await maybeRandomLike(page, { chance: 1.0 });
      if (liked) likeCount++;
    }

    // Czasem dłuższa pauza (czytanie)
    if (Math.random() < 0.15) {
      await sleep(gaussianRandom(3000, 800));
    }
  }

  // Zapisz nowe discoveries
  if (newDiscoveries.length > 0) {
    const allDiscoveries = [...existingDiscoveries, ...newDiscoveries];
    await saveDiscoveries(allDiscoveries);
    log.prod("FEED", `Zapisano ${newDiscoveries.length} nowych discoveries`);
  }

  // DEBUG: podsumowanie skanu
  log.dev("FEED", `Podsumowanie: scrolls=${scrollCount}, knownUrls=${knownUrls.size}, discoveries=${newDiscoveries.length}`);

  return {
    discoveries: newDiscoveries,
    liked: likeCount,
    scrolled: scrollCount,
  };
}

/**
 * Akceptuje discovery - przenosi do watched
 * @param {string} discoveryId
 * @returns {Promise<{discovery: object | null, success: boolean}>}
 */
async function approveDiscovery(discoveryId) {
  const discoveries = await loadDiscoveries();
  const index = discoveries.findIndex(d => d.id === discoveryId);

  if (index === -1) {
    return { discovery: null, success: false };
  }

  const discovery = discoveries[index];
  discovery.status = "approved";
  discovery.approvedAt = new Date().toISOString();

  // Usuń z discoveries
  discoveries.splice(index, 1);
  await saveDiscoveries(discoveries);

  return { discovery, success: true };
}

/**
 * Odrzuca discovery - przenosi do blacklist
 * @param {string} discoveryId
 * @param {string} reason
 * @returns {Promise<{success: boolean}>}
 */
async function rejectDiscovery(discoveryId, reason = "user_rejected") {
  const discoveries = await loadDiscoveries();
  const index = discoveries.findIndex(d => d.id === discoveryId);

  if (index === -1) {
    return { success: false };
  }

  const discovery = discoveries[index];

  // Dodaj do blacklist
  const blacklist = await loadBlacklist();
  blacklist.push({
    id: discovery.id,
    url: discovery.url,
    reason,
    rejectedAt: new Date().toISOString(),
    content: discovery.content,
    pageName: discovery.pageName,
  });
  await saveBlacklist(blacklist);

  // Usuń z discoveries
  discoveries.splice(index, 1);
  await saveDiscoveries(discoveries);

  return { success: true };
}

/**
 * Usuwa z blacklist (pozwala na re-discovery)
 * @param {string} blacklistId
 * @returns {Promise<{success: boolean}>}
 */
async function removeFromBlacklist(blacklistId) {
  const blacklist = await loadBlacklist();
  const index = blacklist.findIndex(b => b.id === blacklistId);

  if (index === -1) {
    return { success: false };
  }

  blacklist.splice(index, 1);
  await saveBlacklist(blacklist);

  return { success: true };
}

/**
 * Dodaje URL do blacklist ręcznie
 * @param {string} url
 * @param {string} reason
 * @returns {Promise<{id: string, success: boolean}>}
 */
async function addToBlacklist(url, reason = "manual") {
  const blacklist = await loadBlacklist();

  // Sprawdź czy już jest
  if (blacklist.some(b => b.url === url)) {
    return { id: null, success: false };
  }

  const id = `bl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  blacklist.push({
    id,
    url,
    reason,
    rejectedAt: new Date().toISOString(),
  });

  await saveBlacklist(blacklist);
  return { id, success: true };
}

/**
 * Funkcja testowa - uruchom scan ręcznie
 */
async function testScan() {
  console.log("Test scan - użyj w kontekście z page");
  console.log("Przykład: await scanFeed(page, { keywords: ['garaż', 'blaszany'] })");
}

export {
  loadDiscoveries,
  saveDiscoveries,
  loadBlacklist,
  saveBlacklist,
  extractVisiblePosts,
  scanFeed,
  approveDiscovery,
  rejectDiscovery,
  removeFromBlacklist,
  addToBlacklist,
  testScan,
};
