// src/lite/feedScanner.js
// Skanowanie tablicy Facebook - wyszukiwanie postów po keywords

import { gaussianRandom, sleep } from "../utils/sleep.js";
import { feedScrollSession, smoothScrollBy } from "./smoothScroll.js";
import { maybeRandomLike } from "./randomActions.js";
import { createKeywordMatcher } from "./keywordMatcher.js";
import { checkIfLogged } from "../fb/login.js";
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
 * Czeka na załadowanie feedu (pojawienie się rzeczywistej zawartości)
 * @param {import('puppeteer').Page} page
 * @param {number} timeout - max czas czekania w ms
 * @returns {Promise<boolean>}
 */
async function waitForFeedLoaded(page, timeout = 20000) {
  try {
    // Krok 1: Czekaj na główny kontener strony (React musi się zrenderować)
    log.dev("FEED", "Czekam na [role=main]...");
    await page.waitForSelector('[role="main"]', { timeout: timeout / 2 });

    // Krok 2: Czekaj na rzeczywiste linki do postów
    log.dev("FEED", "Czekam na linki do postów...");
    await page.waitForSelector(
      'a[href*="pfbid"], a[href*="/posts/"], a[href*="story_fbid"], a[href*="/permalink/"]',
      { timeout: timeout / 2 }
    );

    // Krok 3: Dodatkowe czekanie na stabilizację DOM
    await sleep(1500);
    return true;
  } catch (err) {
    log.dev("FEED", `waitForFeedLoaded failed: ${err.message}`);
    return false;
  }
}

/**
 * Ekstrahuje posty z aktualnego widoku strony
 * NOWA WERSJA - szuka linków do postów i buduje kontekst wokół nich
 * @param {import('puppeteer').Page} page
 * @returns {Promise<Array<{url: string, content: string, pageName: string}>>}
 */
async function extractVisiblePosts(page) {
  // Pobierz URL przed page.evaluate (dla diagnostyki)
  const currentUrl = page.url();

  const result = await page.evaluate((pageUrl) => {
    const posts = [];
    const seenUrls = new Set();
    const debug = {
      linksFound: 0,
      postsExtracted: 0,
      sampleContent: null,
      reasons: [],
      pageUrl: pageUrl,
      articlesFound: 0,
      feedFound: false,
    };

    // === KROK 1: Znajdź kontener feedu (kluczowe!) ===
    const feedContainer = document.querySelector('[role="feed"]') ||
                          document.querySelector('[role="main"]') ||
                          document.body;

    debug.feedFound = !!document.querySelector('[role="feed"]');

    // === KROK 2: Znajdź posty używając różnych metod ===
    // Facebook może używać różnych struktur - próbujemy kilku

    // Metoda A: Znajdź posty po ich cechach (data-pagelet z FeedUnit)
    let feedUnits = feedContainer.querySelectorAll('[data-pagelet*="FeedUnit"]');

    // Metoda B: Jeśli nie ma FeedUnit, szukaj po strukturze - kontenery z linkami do stron
    if (feedUnits.length === 0) {
      // Szukaj divów które zawierają linki do FB oraz mają tekst
      const allDivs = feedContainer.querySelectorAll('div');
      const potentialPosts = [];

      for (const div of allDivs) {
        // Sprawdź czy div wygląda jak post:
        // - Ma link do strony FB (nie nawigacyjny)
        // - Ma tekst > 20 znaków
        // - Ma przycisk typu "Lubię to" lub podobny
        const links = div.querySelectorAll('a[href*="facebook.com"]');
        const hasPageLink = Array.from(links).some(l => {
          const href = l.href || '';
          return !href.includes('/friends') && !href.includes('/groups') &&
                 !href.includes('/marketplace') && !href.includes('/events') &&
                 !href.includes('/watch?') && l.textContent?.trim().length > 2;
        });

        const hasText = (div.textContent?.length || 0) > 50 && (div.textContent?.length || 0) < 5000;
        const hasLikeButton = div.querySelector('[aria-label*="Lubię"], [aria-label*="Like"], [aria-label*="lubię"]');

        if (hasPageLink && hasText && hasLikeButton) {
          potentialPosts.push(div);
        }
      }

      // Filtruj - weź tylko najbardziej zewnętrzne (unikaj duplikatów)
      feedUnits = potentialPosts.filter((div, i, arr) => {
        return !arr.some((other, j) => j !== i && other.contains(div));
      });
    }

    debug.articlesFound = feedUnits.length;

    // Jeśli znaleziono posty, ekstrahuj z nich dane
    if (feedUnits.length > 0) {
      for (const article of feedUnits) {
        try {
          // Znajdź link do posta - sprawdź kilka miejsc
          let postLink = null;
          let url = '';

          // Metoda 1: Szukaj na przyciskach interakcji (Lubię to, Skomentuj, Udostępnij)
          // Te przyciski często mają link do posta w href
          const interactionButtons = article.querySelectorAll(
            'a[aria-label*="Lubię"], a[aria-label*="Like"], a[aria-label*="lubię"], ' +
            'a[aria-label*="Skomentuj"], a[aria-label*="Comment"], a[aria-label*="komentarz"], ' +
            'a[role="button"][href*="facebook.com"]'
          );
          for (const btn of interactionButtons) {
            const href = btn.href || '';
            if (href.includes('pfbid') || href.includes('/posts/') ||
                href.includes('story_fbid') || href.includes('/permalink/')) {
              postLink = btn;
              url = href;
              break;
            }
          }

          // Metoda 2: Szukaj linków z typowymi wzorcami postów
          if (!url) {
            postLink = article.querySelector(
              'a[href*="pfbid"], a[href*="/posts/"], a[href*="story_fbid"], ' +
              'a[href*="/permalink/"], a[href*="/photo"], a[href*="/video"], a[href*="/reel"]'
            );
            url = postLink?.href || '';
          }

          // Metoda 3: Szukaj linku do timestampu (data publikacji zwykle linkuje do posta)
          if (!url) {
            const timeLinks = article.querySelectorAll('a[href*="facebook.com"]');
            for (const link of timeLinks) {
              const href = link.href || '';
              const text = link.textContent?.trim() || '';
              // Linki z datą/czasem (np. "2 godz.", "wczoraj", "13 godz.")
              if (text.match(/\d+\s*(godz|min|sek|dni|d\.|h\.|m\.)/i) ||
                  text.match(/(wczoraj|dzisiaj|yesterday|today)/i)) {
                if (href.includes('pfbid') || href.includes('/posts/') ||
                    href.includes('story_fbid') || href.includes('/permalink/')) {
                  url = href;
                  break;
                }
              }
            }
          }

          // Metoda 4: Link do strony autora jako fallback
          if (!url) {
            const headerLinks = article.querySelectorAll('a[role="link"]');
            for (const link of headerLinks) {
              const href = link.href || '';
              if (href.includes('/friends') || href.includes('/groups') ||
                  href.includes('/marketplace') || href.includes('/events') ||
                  href.includes('/settings') || href === 'https://www.facebook.com/') {
                continue;
              }
              if (href.includes('facebook.com/') && link.textContent?.trim().length > 2) {
                url = href;
                break;
              }
            }
          }

          // Diagnostyka - co jest w tym artykule
          if (!url && debug.reasons.length < 3) {
            const allLinks = Array.from(article.querySelectorAll('a[href]')).slice(0, 5);
            const textContent = article.textContent?.substring(0, 100) || 'EMPTY';
            const linkCount = article.querySelectorAll('a').length;
            debug.reasons.push(`article[${linkCount} links]: ${textContent.substring(0, 60)}`);
          }

          // Skip duplikaty i puste
          if (!url || seenUrls.has(url)) continue;
          if (url.includes('comment_id=')) continue; // Skip komentarze

          seenUrls.add(url);
          debug.linksFound++;

          // Znajdź treść posta - szukaj div[dir="auto"] lub span[dir="auto"]
          const textElements = article.querySelectorAll('div[dir="auto"], span[dir="auto"]');
          let content = "";

          for (const el of textElements) {
            const txt = el.textContent?.trim() || "";
            // Preferuj teksty 20-1500 znaków
            if (txt.length > 20 && txt.length < 1500 && txt.length > content.length) {
              content = txt;
            }
          }

          // Znajdź autora/stronę - sprawdź kilka metod
          let pageName = "Unknown";

          // Metoda 1: strong bezpośrednio (typowo nazwa autora jest w strong)
          const strongElements = article.querySelectorAll('strong');
          for (const strong of strongElements) {
            const text = strong.textContent?.trim() || "";
            // Nazwa autora zwykle ma 2-50 znaków i nie zawiera typowych słów UI
            if (text.length >= 2 && text.length <= 50 &&
                !text.match(/^(Lubię|Like|Skomentuj|Comment|Udostępnij|Share|Zobacz|See|Więcej|More)$/i)) {
              // Sprawdź czy strong jest linkiem lub ma link w środku
              const parentLink = strong.closest('a');
              const childLink = strong.querySelector('a');
              if (parentLink || childLink || strong.parentElement?.tagName === 'SPAN') {
                pageName = text;
                break;
              }
            }
          }

          // Metoda 2: Link w nagłówku (h2-h4)
          if (pageName === "Unknown") {
            const headerLink = article.querySelector(
              'h2 a[role="link"], h3 a[role="link"], h4 a[role="link"]'
            );
            if (headerLink) {
              const text = headerLink.textContent?.trim() || "";
              if (text.length >= 2 && text.length <= 50) {
                pageName = text;
              }
            }
          }

          // Metoda 3: Pierwszy link który wygląda jak nazwa użytkownika/strony
          if (pageName === "Unknown") {
            const allLinks = article.querySelectorAll('a[role="link"]');
            for (const link of allLinks) {
              const href = link.href || "";
              const text = link.textContent?.trim() || "";
              // Link do profilu FB użytkownika/strony (nie do posta, komentarza itp.)
              if (href.includes('facebook.com/') &&
                  !href.includes('/posts/') && !href.includes('pfbid') &&
                  !href.includes('/photo') && !href.includes('/video') &&
                  !href.includes('/comment') && !href.includes('story_fbid') &&
                  text.length >= 2 && text.length <= 50 &&
                  !text.match(/^\d+\s*(godz|min|sek|dni|h|m|s)/i)) {
                pageName = text;
                break;
              }
            }
          }

          // Zapisz post jeśli ma treść
          if (content.length > 15) {
            content = content.replace(/\s+/g, ' ').trim();

            if (!debug.sampleContent) {
              debug.sampleContent = content.substring(0, 150);
            }

            debug.postsExtracted++;
            posts.push({
              url,
              content: content.substring(0, 500),
              pageName,
            });
          } else {
            debug.reasons.push(`article bez treści (len=${content.length})`);
          }
        } catch (e) {
          debug.reasons.push(`article error: ${e.message}`);
        }
      }
    }

    // === KROK 3: Fallback - szukaj linków bezpośrednio w feedzie ===
    if (posts.length === 0) {
      const postLinkSelectors = [
        'a[href*="pfbid"]',
        'a[href*="/posts/"]',
        'a[href*="story_fbid"]',
        'a[href*="/permalink/"]',
      ];

      const allPostLinks = feedContainer.querySelectorAll(postLinkSelectors.join(', '));

      for (const link of allPostLinks) {
        try {
          const url = link.href;
          if (!url || seenUrls.has(url)) continue;
          if (url.includes('comment_id=')) continue;

          seenUrls.add(url);
          debug.linksFound++;

          // Idź w górę DOM szukając kontenera z treścią
          let container = link;
          let content = "";
          let pageName = "Unknown";

          for (let i = 0; i < 10 && container; i++) {
            container = container.parentElement;
            if (!container) break;

            // Stop na nawigacji
            const role = container.getAttribute?.('role');
            if (role === 'navigation' || role === 'banner') break;

            // Szukaj treści
            const textEl = container.querySelector('div[dir="auto"]');
            if (textEl) {
              const txt = textEl.textContent?.trim() || "";
              if (txt.length > 20 && txt.length < 1500) {
                content = txt;
                break;
              }
            }
          }

          if (content.length > 15) {
            content = content.replace(/\s+/g, ' ').trim();
            debug.postsExtracted++;
            posts.push({ url, content: content.substring(0, 500), pageName });
          }
        } catch (e) {
          // ignoruj
        }
      }
    }

    return { posts, debug };
  }, currentUrl);

  // Loguj diagnostykę
  log.dev("FEED", `Ekstrakcja: articles=${result.debug.articlesFound}, links=${result.debug.linksFound}, posts=${result.debug.postsExtracted}, feed=${result.debug.feedFound}`);

  if (result.debug.sampleContent) {
    log.dev("FEED", `Sample: "${result.debug.sampleContent.substring(0, 100)}..."`);
  }

  // Pokaż przyczyny problemów
  if (result.debug.reasons && result.debug.reasons.length > 0 && result.debug.postsExtracted === 0) {
    log.dev("FEED", `Problemy: ${result.debug.reasons.slice(0, 3).join(' | ')}`);
  }

  return result.posts;
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

  // Zawsze odśwież feed - to zapewnia świeży content
  const currentUrl = page.url();
  log.dev("FEED", `Aktualna strona: ${currentUrl.substring(0, 60)}`);

  // Jeśli nie jesteśmy na stronie głównej FB lub strona jest w złym stanie - nawiguj
  const isOnHomeFeed = currentUrl === "https://www.facebook.com/" ||
                       currentUrl === "https://www.facebook.com" ||
                       currentUrl.startsWith("https://www.facebook.com/?");

  if (!isOnHomeFeed || currentUrl.includes("/login")) {
    log.dev("FEED", "Nawiguję na feed...");
    await page.goto("https://www.facebook.com/", {
      waitUntil: "load",
      timeout: 45000,
    });
  } else {
    // Jesteśmy na FB - przeładuj stronę żeby mieć świeży content
    log.dev("FEED", "Przeładowuję feed...");
    await page.reload({
      waitUntil: "load",
      timeout: 45000,
    });
  }

  // Czekaj aż strona przestanie być w stanie loading (Facebook JavaScript się zrenderuje)
  log.dev("FEED", "Czekam na renderowanie strony...");
  try {
    await page.waitForFunction(
      () => {
        const body = document.body?.textContent || "";
        // Strona jest zrenderowana gdy body nie zaczyna się od JSON
        return body.length > 500 && !body.trim().startsWith("{");
      },
      { timeout: 20000 }
    );
    log.dev("FEED", "Strona zrenderowana");
  } catch (e) {
    log.dev("FEED", `Czekanie na renderowanie timeout: ${e.message}`);
  }

  // Dodatkowe czekanie na stabilizację
  await sleep(gaussianRandom(2000, 500));

  // Sprawdź czy zalogowany
  const isLogged = await checkIfLogged(page);
  if (!isLogged) {
    log.dev("FEED", "UWAGA: Nie zalogowany! Sesja wygasła lub cookies nieprawidłowe.");
    // Spróbuj uzyskać więcej informacji
    const pageTitle = await page.title();
    log.dev("FEED", `Tytuł strony: ${pageTitle}`);
    return {
      discoveries: [],
      liked: 0,
      scrolled: 0,
      error: "not_logged_in",
    };
  }
  log.dev("FEED", "Zalogowany poprawnie");

  // Czekaj na załadowanie feedu (linki do postów)
  const feedLoaded = await waitForFeedLoaded(page, 20000);
  if (!feedLoaded) {
    log.dev("FEED", "Feed nie załadował się w czasie - próbuję kontynuować");
    // Zrób screenshot dla debugowania
    try {
      const screenshotPath = `/opt/fb-watcher/tmp/feed_debug_${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: false });
      log.dev("FEED", `Screenshot zapisany: ${screenshotPath}`);
    } catch (e) {
      log.dev("FEED", `Screenshot failed: ${e.message}`);
    }
    // Daj jeszcze chwilę
    await sleep(3000);
  } else {
    log.dev("FEED", "Feed załadowany pomyślnie");
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
  let lastExtractTime = 0;
  const extractInterval = 3000; // Ekstrahuj co 3 sekundy (nie przy każdym scrollu)

  while (Date.now() - startTime < clampedDuration) {
    // Ekstrahuj posty tylko co kilka sekund (żeby nie obciążać)
    const now = Date.now();
    if (now - lastExtractTime > extractInterval) {
      lastExtractTime = now;

      const posts = await extractVisiblePosts(page);

      if (posts.length > 0) {
        log.dev("FEED", `Wyekstrahowano ${posts.length} postów`);
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
    }

    // Scroll
    const scrollAmount = Math.round(gaussianRandom(350, 80));
    await smoothScrollBy(page, scrollAmount);
    scrollCount++;

    // Pauza między scrollami
    await sleep(gaussianRandom(1500, 400));

    // Może polub losowy post
    if (Math.random() < likeChance / 10) {
      const liked = await maybeRandomLike(page, { chance: 1.0 });
      if (liked) likeCount++;
    }

    // Czasem dłuższa pauza (czytanie)
    if (Math.random() < 0.12) {
      await sleep(gaussianRandom(2500, 600));
    }
  }

  // Zapisz nowe discoveries
  if (newDiscoveries.length > 0) {
    const allDiscoveries = [...existingDiscoveries, ...newDiscoveries];
    await saveDiscoveries(allDiscoveries);
    log.prod("FEED", `Zapisano ${newDiscoveries.length} nowych discoveries`);
  } else {
    log.dev("FEED", `Skanowanie zakończone - brak nowych discoveries (scrolls: ${scrollCount})`);
  }

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
  waitForFeedLoaded,
};
