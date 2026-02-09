/**
 * Moduł wznawiania ogłoszeń na Facebook Marketplace
 */

import { SELECTORS } from "./selectors.js";
import {
  humanDelay,
  mediumDelay,
  longDelay,
  safeClick,
  takeScreenshot,
  isOnLoginOrCheckpoint,
  readJsonFile,
  writeJsonFile,
  getDataPath,
  formatDate,
  getNextRenewalDate,
  humanScroll,
  humanClickElement,
  doRandomMouseMovement,
} from "./utils.js";
import {
  loadPublished,
  getListingsNeedingRenewal,
  updateListingRenewal,
  updateListingStatus,
} from "./contentPool.js";
import { MARKETPLACE_RENEWAL_INTERVAL_DAYS } from "../config.js";

const RENEWALS_FILE = "renewals.json";
const MY_LISTINGS_URL = "https://www.facebook.com/marketplace/you/selling";

/**
 * Domyślna struktura logów wznowień
 */
const DEFAULT_RENEWALS = {
  log: [],
  stats: {
    totalRenewals: 0,
    successfulRenewals: 0,
    failedRenewals: 0,
  },
};

/**
 * Wczytaj log wznowień
 */
function loadRenewals() {
  return readJsonFile(getDataPath(RENEWALS_FILE), DEFAULT_RENEWALS);
}

/**
 * Zapisz log wznowień
 */
function saveRenewals(renewals) {
  return writeJsonFile(getDataPath(RENEWALS_FILE), renewals);
}

/**
 * Dodaj wpis do logu wznowień
 */
function logRenewal(listingId, success, details = {}) {
  const renewals = loadRenewals();

  renewals.log.unshift({
    timestamp: formatDate(),
    listingId,
    success,
    ...details,
  });

  // Ogranicz log do 1000 wpisów
  if (renewals.log.length > 1000) {
    renewals.log = renewals.log.slice(0, 1000);
  }

  renewals.stats.totalRenewals++;
  if (success) {
    renewals.stats.successfulRenewals++;
  } else {
    renewals.stats.failedRenewals++;
  }

  saveRenewals(renewals);
}

/**
 * Nawiguj do strony moich ogłoszeń
 */
async function navigateToMyListings(page) {
  console.log("[MARKETPLACE:RENEWER] Nawigacja do /marketplace/you/selling...");

  await page.goto(MY_LISTINGS_URL, { waitUntil: "networkidle2", timeout: 60000 });
  await longDelay();

  // Sprawdź czy nie wylogowało lub checkpoint
  if (await isOnLoginOrCheckpoint(page)) {
    throw new Error("CHECKPOINT_OR_LOGIN_REQUIRED");
  }

  return true;
}

/**
 * Pobierz listę ogłoszeń z DOM
 */
async function getListingsFromPage(page) {
  console.log("[MARKETPLACE:RENEWER] Pobieranie listy ogłoszeń z DOM...");

  await humanDelay(2000, 4000);

  // Scroll żeby załadować wszystkie ogłoszenia (human-like)
  for (let i = 0; i < 3; i++) {
    await doRandomMouseMovement(page);
    await humanScroll(page, 500);
    await humanDelay(1000, 2000);
  }

  // Pobierz dane ogłoszeń
  const listings = await page.evaluate(() => {
    const items = [];
    const listItems = document.querySelectorAll('[role="listitem"]');

    listItems.forEach((item, index) => {
      // Próbuj znaleźć tytuł
      const titleEl = item.querySelector('span[dir="auto"]');
      const title = titleEl ? titleEl.textContent.trim() : null;

      // Sprawdź czy jest przycisk "Wznów"
      const renewBtn = item.querySelector('div[role="button"]');
      const hasRenewButton = renewBtn && (
        renewBtn.textContent.includes("Renew") ||
        renewBtn.textContent.includes("Wznów")
      );

      // Sprawdź status
      const statusEl = item.querySelector('[aria-label*="Active"], [aria-label*="Expired"]');
      const isExpired = item.textContent.includes("Expired") || item.textContent.includes("Wygasło");

      if (title) {
        items.push({
          index,
          title,
          hasRenewButton,
          isExpired,
        });
      }
    });

    return items;
  });

  console.log(`[MARKETPLACE:RENEWER] Znaleziono ${listings.length} ogłoszeń na stronie`);
  return listings;
}

/**
 * Wznów pojedyncze ogłoszenie (z Human Behavior)
 */
async function renewSingleListing(page, listingIndex) {
  console.log(`[MARKETPLACE:RENEWER] Próba wznowienia ogłoszenia #${listingIndex}...`);

  const MARKER = "data-hb-renew-click";

  try {
    // Krok 1: Znajdź i oznacz przycisk wznowienia lub menu
    const findResult = await page.evaluate((index, marker) => {
      // Usuń stare markery
      document.querySelectorAll(`[${marker}]`).forEach(el => el.removeAttribute(marker));

      const listItems = document.querySelectorAll('[role="listitem"]');
      const item = listItems[index];

      if (!item) return { success: false, error: "Nie znaleziono elementu" };

      // Szukaj przycisku "Wznów" lub "Renew"
      const buttons = item.querySelectorAll('div[role="button"]');
      for (const btn of buttons) {
        if (btn.textContent.includes("Renew") || btn.textContent.includes("Wznów")) {
          btn.setAttribute(marker, "renew-button");
          return { success: true, type: "renew-button" };
        }
      }

      // Może trzeba najpierw kliknąć menu "..."
      const menuBtn = item.querySelector('[aria-label="More"], [aria-label="Więcej"]');
      if (menuBtn) {
        menuBtn.setAttribute(marker, "menu-button");
        return { success: true, type: "menu-button" };
      }

      return { success: false, error: "Nie znaleziono przycisku wznowienia" };
    }, listingIndex, MARKER);

    if (!findResult.success) {
      return { success: false, error: findResult.error };
    }

    // Krok 2: Kliknij oznaczony element z Human Behavior
    const markedElement = await page.$(`[${MARKER}]`);
    if (markedElement) {
      await doRandomMouseMovement(page);
      await humanClickElement(page, markedElement);
      // Usuń marker
      await page.evaluate((marker) => {
        document.querySelectorAll(`[${marker}]`).forEach(el => el.removeAttribute(marker));
      }, MARKER);
    }

    await mediumDelay();

    // Krok 3: Jeśli kliknęliśmy menu, szukaj opcji "Wznów" w dropdown
    if (findResult.type === "menu-button") {
      await humanDelay(500, 1000);

      // Oznacz opcję w menu
      const menuFound = await page.evaluate((marker) => {
        const menuItems = document.querySelectorAll('[role="menuitem"]');
        for (const item of menuItems) {
          if (item.textContent.includes("Renew") || item.textContent.includes("Wznów")) {
            item.setAttribute(marker, "menu-option");
            return true;
          }
        }
        return false;
      }, MARKER);

      if (!menuFound) {
        // Zamknij menu
        await page.keyboard.press("Escape");
        return { success: false, error: "Brak opcji wznowienia w menu" };
      }

      // Kliknij opcję menu z Human Behavior
      const menuOption = await page.$(`[${MARKER}]`);
      if (menuOption) {
        await humanClickElement(page, menuOption);
        await page.evaluate((marker) => {
          document.querySelectorAll(`[${marker}]`).forEach(el => el.removeAttribute(marker));
        }, MARKER);
      }

      await mediumDelay();
    }

    // Krok 4: Szukaj dialogu potwierdzenia i potwierdź
    await humanDelay(1000, 2000);

    // Oznacz przycisk potwierdzenia
    const confirmFound = await page.evaluate((marker) => {
      const confirmSelectors = [
        '[role="dialog"] [role="button"]',
        '[aria-label="Renew"]',
        '[aria-label="Wznów"]',
      ];

      for (const selector of confirmSelectors) {
        const buttons = document.querySelectorAll(selector);
        for (const btn of buttons) {
          const text = btn.textContent.toLowerCase();
          if (text.includes("renew") || text.includes("wznów") || text.includes("confirm") || text.includes("potwierdź")) {
            btn.setAttribute(marker, "confirm-button");
            return true;
          }
        }
      }

      return false;
    }, MARKER);

    // Kliknij przycisk potwierdzenia z Human Behavior
    if (confirmFound) {
      const confirmBtn = await page.$(`[${MARKER}]`);
      if (confirmBtn) {
        await doRandomMouseMovement(page);
        await humanClickElement(page, confirmBtn);
        await page.evaluate((marker) => {
          document.querySelectorAll(`[${marker}]`).forEach(el => el.removeAttribute(marker));
        }, MARKER);
      }
    }

    await longDelay();

    // Sprawdź czy się udało (brak error message)
    const hasError = await page.evaluate(() => {
      const errorEl = document.querySelector('[role="alert"]');
      return errorEl && errorEl.textContent.length > 0;
    });

    if (hasError) {
      return { success: false, error: "Facebook zwrócił błąd" };
    }

    return { success: true };
  } catch (err) {
    console.error(`[MARKETPLACE:RENEWER] Błąd wznowienia:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Dopasuj ogłoszenia z DOM do naszej bazy danych
 */
function matchListingsToDatabase(pageListings, dbListings) {
  const matches = [];

  for (const dbListing of dbListings) {
    // Szukaj po tytule (częściowe dopasowanie)
    const pageListing = pageListings.find((pl) => {
      if (!pl.title || !dbListing.title) return false;

      // Normalizuj tytuły
      const pageTitle = pl.title.toLowerCase().trim();
      const dbTitle = dbListing.title.toLowerCase().trim();

      // Dokładne lub częściowe dopasowanie
      return pageTitle === dbTitle ||
        pageTitle.includes(dbTitle) ||
        dbTitle.includes(pageTitle);
    });

    if (pageListing) {
      matches.push({
        dbListing,
        pageListing,
      });
    }
  }

  return matches;
}

/**
 * Główna funkcja wznawiania
 * @param {object} page - Puppeteer page
 * @param {object} options - opcje
 * @returns {object} wynik
 */
export async function run(page, options = {}) {
  const results = {
    success: true,
    renewed: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  console.log("[MARKETPLACE:RENEWER] Start procesu wznawiania...");

  try {
    // Pobierz ogłoszenia wymagające wznowienia
    const listingsNeedingRenewal = getListingsNeedingRenewal();

    if (listingsNeedingRenewal.length === 0) {
      console.log("[MARKETPLACE:RENEWER] Brak ogłoszeń do wznowienia");
      return results;
    }

    console.log(`[MARKETPLACE:RENEWER] ${listingsNeedingRenewal.length} ogłoszeń wymaga wznowienia`);

    // Nawiguj do strony ogłoszeń
    await navigateToMyListings(page);

    // Pobierz listę z DOM
    const pageListings = await getListingsFromPage(page);

    if (pageListings.length === 0) {
      console.warn("[MARKETPLACE:RENEWER] Nie znaleziono ogłoszeń na stronie");
      results.errors.push("Brak ogłoszeń na stronie");
      return results;
    }

    // Dopasuj ogłoszenia
    const matches = matchListingsToDatabase(pageListings, listingsNeedingRenewal);

    console.log(`[MARKETPLACE:RENEWER] Dopasowano ${matches.length} ogłoszeń`);

    // Wznawiaj każde dopasowane ogłoszenie
    for (const match of matches) {
      const { dbListing, pageListing } = match;

      console.log(`[MARKETPLACE:RENEWER] Wznawianie: "${dbListing.title}"`);

      // Sprawdź czy jest przycisk wznowienia
      if (!pageListing.hasRenewButton && !pageListing.isExpired) {
        console.log(`[MARKETPLACE:RENEWER] Brak przycisku wznowienia dla: "${dbListing.title}"`);
        results.skipped++;
        logRenewal(dbListing.id, false, { reason: "no_renew_button", title: dbListing.title });
        continue;
      }

      // Spróbuj wznowić
      const renewResult = await renewSingleListing(page, pageListing.index);

      if (renewResult.success) {
        console.log(`[MARKETPLACE:RENEWER] Wznowiono: "${dbListing.title}"`);
        results.renewed++;

        // Aktualizuj w bazie
        const nextRenewal = getNextRenewalDate(MARKETPLACE_RENEWAL_INTERVAL_DAYS);
        updateListingRenewal(dbListing.id, nextRenewal);
        logRenewal(dbListing.id, true, { title: dbListing.title });
      } else {
        console.error(`[MARKETPLACE:RENEWER] Nie udało się wznowić: "${dbListing.title}" - ${renewResult.error}`);
        results.failed++;
        results.errors.push(`${dbListing.title}: ${renewResult.error}`);
        logRenewal(dbListing.id, false, { title: dbListing.title, error: renewResult.error });
      }

      // Pauza między ogłoszeniami (human-like)
      await doRandomMouseMovement(page);
      await humanDelay(3000, 6000);

      // Odśwież stronę co 3 ogłoszenia
      if ((results.renewed + results.failed) % 3 === 0) {
        console.log("[MARKETPLACE:RENEWER] Odświeżanie strony...");
        await page.reload({ waitUntil: "networkidle2" });
        await longDelay();
      }
    }

    // Obsłuż niedopasowane ogłoszenia
    const unmatchedCount = listingsNeedingRenewal.length - matches.length;
    if (unmatchedCount > 0) {
      console.warn(`[MARKETPLACE:RENEWER] ${unmatchedCount} ogłoszeń nie dopasowano`);
      results.skipped += unmatchedCount;
    }

  } catch (err) {
    console.error("[MARKETPLACE:RENEWER] Krytyczny błąd:", err.message);
    results.success = false;
    results.errors.push(err.message);

    // Screenshot przy błędzie
    try {
      const screenshotPath = await takeScreenshot(page, "renewer_error");
      console.log(`[MARKETPLACE:RENEWER] Screenshot: ${screenshotPath}`);
    } catch (e) {
      // Ignoruj błędy screenshota
    }

    // Sprawdź czy to checkpoint
    if (err.message === "CHECKPOINT_OR_LOGIN_REQUIRED") {
      throw err; // Przekaż dalej do obsługi alertów
    }
  }

  console.log(`[MARKETPLACE:RENEWER] Zakończono. Wznowione: ${results.renewed}, Nieudane: ${results.failed}, Pominięte: ${results.skipped}`);
  return results;
}

/**
 * Sprawdź czy teraz jest pora na sprawdzenie wznowień
 * @param {number[]} checkHours - dozwolone godziny
 * @returns {boolean}
 */
export function isRenewalCheckTime(checkHours) {
  const currentHour = new Date().getHours();
  return checkHours.includes(currentHour);
}

/**
 * Pobierz log wznowień
 */
export function getRenewalLog(limit = 100) {
  const renewals = loadRenewals();
  return {
    log: renewals.log.slice(0, limit),
    stats: renewals.stats,
  };
}

export default {
  run,
  isRenewalCheckTime,
  getRenewalLog,
};
