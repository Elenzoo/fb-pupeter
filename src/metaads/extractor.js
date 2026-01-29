/**
 * Meta Ads Extractor - wyciąganie danych z reklam
 * Selektory zweryfikowane: 2026-01-26
 *
 * UWAGA: Facebook Ad Library nie używa już linków do snapshotów w HTML.
 * Dane reklam są osadzone jako JSON w HTML strony.
 */

import { log } from "../utils/logger.js";
import { humanDelay } from "../utils/sleep.js";

/**
 * Waliduje dane reklamy
 * @param {Object} ad - obiekt reklamy
 * @returns {boolean} - czy dane są poprawne
 */
function validateAd(ad) {
  // adId musi być liczbą
  if (!ad.adId || !/^\d+$/.test(ad.adId)) {
    log.dev("METAADS", `Walidacja: nieprawidłowy adId "${ad.adId}"`);
    return false;
  }

  // pageName nie może być pusty
  if (!ad.pageName || ad.pageName === "Unknown") {
    log.dev("METAADS", `Walidacja: brak nazwy strony dla ${ad.adId}`);
    return false;
  }

  return true;
}

/**
 * Wyciąga reklamy ze strony biblioteki reklam
 * NOWA WERSJA: parsuje JSON osadzony w HTML zamiast szukać linków
 * @param {Page} page - strona Puppeteer
 * @returns {Promise<Array>} - lista reklam
 */
export async function extractAdsFromPage(page) {
  const rawAds = await page.evaluate(() => {
    const ads = [];
    const seenIds = new Set();

    // Pobierz cały HTML strony
    const html = document.documentElement.innerHTML;

    // Regex do wyciągania JSON z danymi reklam
    // Format: "ad_archive_id":"123456","collation_count":1,...,"page_name":"Nazwa",...
    const adRegex = /"ad_archive_id":"(\d+)"[^}]*?"page_id":"(\d+)"[^}]*?"page_name":"([^"]+)"/g;

    let match;
    while ((match = adRegex.exec(html)) !== null) {
      const [, adId, pageId, pageNameEncoded] = match;

      if (seenIds.has(adId)) continue;
      seenIds.add(adId);

      // Dekoduj unicode escape sequences (\u017c -> ż)
      const pageName = pageNameEncoded.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) =>
        String.fromCharCode(parseInt(code, 16))
      );

      // Znajdź page_profile_uri dla tego ad_archive_id
      const profileRegex = new RegExp(
        `"ad_archive_id":"${adId}"[^}]*?"page_profile_uri":"([^"]+)"`,
        "i"
      );
      const profileMatch = html.match(profileRegex);
      const pageProfileUri = profileMatch
        ? profileMatch[1].replace(/\\\//g, "/")
        : `https://www.facebook.com/${pageId}/`;

      // Zbuduj URL do snapshotu reklamy
      const adSnapshotUrl = `https://www.facebook.com/ads/library/?id=${adId}`;

      ads.push({
        adId,
        pageId,
        pageName,
        pageProfileUri,
        adSnapshotUrl,
        adText: "", // Wyciągniemy później ze snapshotu
        startDate: null,
        postUrl: null, // Wyciągniemy później ze snapshotu
      });
    }

    return ads;
  });

  log.prod("METAADS", `Znaleziono ${rawAds.length} reklam w JSON`);

  // Walidacja i filtrowanie
  const validAds = rawAds.filter(validateAd);
  const invalidCount = rawAds.length - validAds.length;

  if (invalidCount > 0) {
    log.dev("METAADS", `Odrzucono ${invalidCount} reklam z nieprawidłowymi danymi`);
  }

  return validAds;
}

/**
 * Wyciąga link do posta FB ze snapshotu reklamy
 * @param {Page} page - strona Puppeteer
 * @param {string} snapshotUrl - URL snapshotu
 * @returns {Promise<string|null>} - URL posta lub null
 */
export async function extractPostUrlFromSnapshot(page, snapshotUrl) {
  try {
    await page.goto(snapshotUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await humanDelay(1000, 1500);

    // Debug: zapisz HTML snapshotu do analizy
    const debugMode = process.env.METAADS_DEBUG === "true";
    if (debugMode) {
      try {
        const fs = await import("node:fs");
        const html = await page.content();
        const adId = snapshotUrl.match(/id=(\d+)/)?.[1] || "unknown";
        fs.writeFileSync(`data/metaads-snapshot-${adId}.html`, html);
        log.prod("METAADS", `Snapshot HTML zapisany: data/metaads-snapshot-${adId}.html`);
      } catch (e) {
        log.dev("METAADS", `Błąd zapisu snapshot HTML: ${e.message}`);
      }
    }

    // Szybkie sprawdzenie: czy to dark post (fbid:0) lub link ad?
    const adType = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;

      // Jeśli fbid:0 lub fbid:"0" - to dark post bez powiązanego posta FB
      if (/"fbid":"0"/.test(html) || /"fbid":0[,}]/.test(html)) {
        return "dark_post";
      }

      // Jeśli link_url prowadzi na zewnętrzną stronę - to link ad
      const linkUrlMatch = html.match(/"link_url":"(https?:[^"]+)"/);
      if (linkUrlMatch) {
        const linkUrl = linkUrlMatch[1].replace(/\\\//g, "/");
        if (!linkUrl.includes("facebook.com")) {
          return "link_ad";
        }
      }

      return "potential_post";
    });

    if (adType === "dark_post") {
      log.dev("METAADS", `Dark post (fbid:0) - brak powiązanego posta FB`);
      return null;
    }

    if (adType === "link_ad") {
      log.dev("METAADS", `Link ad - reklama prowadząca na zewnętrzną stronę`);
      return null;
    }

    // Szukaj linku do posta używając różnych metod
    const postUrl = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;

      // METODA 1: Szukaj w JSON osadzonym w HTML
      // Wzorce dla różnych pól zawierających link do posta
      const jsonPatterns = [
        // story_fbid w URL
        /"story_fbid[=:][\\"]*(\d+)/,
        // post_id
        /"post_id[":]+(\d+)/,
        // pfbid (nowy format ID)
        /pfbid[0-9a-zA-Z]+/,
        // URL z /posts/
        /"https?:\\\/\\\/[^"]*\/posts\/(\d+)/,
        /"https?:\\\/\\\/[^"]*\/permalink\/(\d+)/,
        // target_url z postem
        /"target_url":"(https?:[^"]*(?:posts|permalink|story_fbid)[^"]*)"/,
        // share_href
        /"share_href":"(https?:[^"]*(?:posts|permalink|story_fbid)[^"]*)"/,
        // direct link
        /"url":"(https?:[^"]*(?:posts|permalink|story_fbid)[^"]*)"/,
      ];

      // Sprawdź każdy wzorzec
      for (const pattern of jsonPatterns) {
        const match = html.match(pattern);
        if (match) {
          const value = match[1] || match[0];

          // Jeśli to pełny URL
          if (value.startsWith("http")) {
            // Dekoduj escaped slashe
            return value.replace(/\\\//g, "/");
          }

          // Jeśli to ID, sprawdź czy możemy zbudować URL
          // pfbid format - nowy format ID
          if (value.startsWith("pfbid")) {
            // Szukaj page_id w tym samym kontekście
            const pageIdMatch = html.match(/"page_id":"(\d+)"/);
            if (pageIdMatch) {
              return `https://www.facebook.com/${pageIdMatch[1]}/posts/${value}`;
            }
          }

          // Numeryczny ID
          if (/^\d+$/.test(value)) {
            const pageIdMatch = html.match(/"page_id":"(\d+)"/);
            if (pageIdMatch) {
              return `https://www.facebook.com/${pageIdMatch[1]}/posts/${value}`;
            }
          }
        }
      }

      // METODA 2: Szukaj przycisku "See Post" / "View on Facebook" / "Zobacz post"
      const buttonSelectors = [
        'a[aria-label*="See"]',
        'a[aria-label*="View"]',
        'a[aria-label*="Zobacz"]',
        'a[role="link"][href*="facebook.com"]',
        '[data-testid*="post"] a',
        '[data-testid*="story"] a',
      ];

      for (const selector of buttonSelectors) {
        try {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            if (el.href && el.href.includes("facebook.com")) {
              if (
                el.href.includes("/posts/") ||
                el.href.includes("/permalink/") ||
                el.href.includes("story_fbid") ||
                el.href.includes("pfbid")
              ) {
                return el.href;
              }
            }
          }
        } catch (e) {
          // Ignoruj błędy selektorów
        }
      }

      // METODA 3: Szukaj w atrybutach data-*
      const dataElements = document.querySelectorAll("[data-href], [data-url], [data-share-url]");
      for (const el of dataElements) {
        const url =
          el.getAttribute("data-href") ||
          el.getAttribute("data-url") ||
          el.getAttribute("data-share-url");
        if (url && url.includes("facebook.com")) {
          if (
            url.includes("/posts/") ||
            url.includes("/permalink/") ||
            url.includes("story_fbid") ||
            url.includes("pfbid")
          ) {
            return url;
          }
        }
      }

      // METODA 4: Fallback - szukaj wszystkich linków
      const allLinks = document.querySelectorAll('a[href*="facebook.com"]');
      for (const link of allLinks) {
        if (
          link.href.includes("/posts/") ||
          link.href.includes("/permalink/") ||
          link.href.includes("story_fbid") ||
          link.href.includes("pfbid")
        ) {
          return link.href;
        }
      }

      return null;
    });

    if (postUrl) {
      log.prod("METAADS", `Znaleziono post URL: ${postUrl.substring(0, 80)}...`);
    } else {
      log.dev("METAADS", `Dark post - brak linku do posta w snapshot`);

      // Debug: pokaż informacje o strukturze strony
      if (debugMode) {
        const debugInfo = await page.evaluate(() => {
          return {
            hasJsonData: document.documentElement.innerHTML.includes('"ad_archive_id"'),
            linksCount: document.querySelectorAll("a").length,
            fbLinksCount: document.querySelectorAll('a[href*="facebook.com"]').length,
            dataHrefCount: document.querySelectorAll("[data-href]").length,
            title: document.title,
          };
        });
        log.prod("METAADS", `Debug snapshot info:`, debugInfo);
      }
    }

    return postUrl;
  } catch (err) {
    log.dev("METAADS", `Błąd ekstrakcji posta: ${err.message}`);
    return null;
  }
}

/**
 * Wyciąga page_id i page_name ze snapshotu (fallback)
 * @param {Page} page - strona Puppeteer
 * @returns {Promise<{pageId: string|null, pageName: string|null}>}
 */
export async function extractPageInfoFromSnapshot(page) {
  return page.evaluate(() => {
    // Szukaj linku do strony
    const profileLinks = document.querySelectorAll('a[href*="facebook.com/"]');

    for (const link of profileLinks) {
      const href = link.href;

      // Szukaj page ID w URL
      const idMatch = href.match(/facebook\.com\/(\d+)/);
      if (idMatch) {
        // Szukaj nazwy w tekście linka lub pobliskim elemencie
        const name =
          link.textContent?.trim() ||
          link.querySelector("span")?.textContent?.trim() ||
          "Unknown";

        return {
          pageId: idMatch[1],
          pageName: name,
        };
      }
    }

    return { pageId: null, pageName: null };
  });
}
