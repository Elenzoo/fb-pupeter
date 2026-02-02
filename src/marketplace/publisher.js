/**
 * Moduł publikowania ogłoszeń na Facebook Marketplace
 */

import path from "path";
import { SELECTORS, FALLBACK_SELECTORS } from "./selectors.js";
import {
  humanDelay,
  shortDelay,
  mediumDelay,
  longDelay,
  humanType,
  safeClick,
  waitForAnySelector,
  takeScreenshot,
  isOnLoginOrCheckpoint,
  getImagePath,
  generateId,
  formatDate,
  getNextRenewalDate,
} from "./utils.js";
import {
  getRandomContent,
  canPublish,
  addPublishedListing,
} from "./contentPool.js";
import {
  MARKETPLACE_RENEWAL_INTERVAL_DAYS,
  MARKETPLACE_MAX_ACTIVE_LISTINGS,
  MARKETPLACE_PUBLISH_INTERVAL_DAYS,
} from "../config.js";

const CREATE_LISTING_URL = "https://www.facebook.com/marketplace/create/item";

/**
 * Nawiguj do formularza tworzenia ogłoszenia
 */
async function navigateToCreateListing(page) {
  console.log("[MARKETPLACE:PUBLISHER] Nawigacja do formularza tworzenia...");

  await page.goto(CREATE_LISTING_URL, { waitUntil: "networkidle2", timeout: 60000 });
  await longDelay();

  // Sprawdź czy nie wylogowało lub checkpoint
  if (await isOnLoginOrCheckpoint(page)) {
    throw new Error("CHECKPOINT_OR_LOGIN_REQUIRED");
  }

  return true;
}

/**
 * Przesłij zdjęcia do ogłoszenia
 */
async function uploadImages(page, imagePaths) {
  if (!imagePaths || imagePaths.length === 0) {
    console.log("[MARKETPLACE:PUBLISHER] Brak zdjęć do przesłania");
    return true;
  }

  console.log(`[MARKETPLACE:PUBLISHER] Przesyłanie ${imagePaths.length} zdjęć...`);

  try {
    // Znajdź input do uploadu
    const fileInputSelector = 'input[type="file"][accept*="image"]';

    // Czekaj na input
    await page.waitForSelector(fileInputSelector, { timeout: 10000 });

    // Przygotuj pełne ścieżki
    const fullPaths = imagePaths.map((img) => getImagePath(img));

    // Prześlij wszystkie zdjęcia naraz
    const fileInput = await page.$(fileInputSelector);
    if (fileInput) {
      await fileInput.uploadFile(...fullPaths);
      console.log(`[MARKETPLACE:PUBLISHER] Przesłano ${fullPaths.length} zdjęć`);

      // Czekaj na zakończenie uploadu
      await longDelay();
      await humanDelay(2000, 4000);

      return true;
    } else {
      console.warn("[MARKETPLACE:PUBLISHER] Nie znaleziono inputu do zdjęć");
      return false;
    }
  } catch (err) {
    console.error("[MARKETPLACE:PUBLISHER] Błąd uploadu zdjęć:", err.message);
    return false;
  }
}

/**
 * Wypełnij pole tekstowe z fallbackami
 */
async function fillTextField(page, selectorOptions, value, fieldName) {
  const selectors = Array.isArray(selectorOptions) ? selectorOptions : [selectorOptions];

  for (const selector of selectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        await element.click();
        await shortDelay();

        // Wyczyść pole
        await page.keyboard.down("Control");
        await page.keyboard.press("a");
        await page.keyboard.up("Control");
        await shortDelay();

        // Wpisz tekst
        await page.type(selector, value, { delay: 30 + Math.random() * 50 });
        console.log(`[MARKETPLACE:PUBLISHER] Wypełniono ${fieldName}`);
        return true;
      }
    } catch (e) {
      // Próbuj następny selektor
    }
  }

  console.warn(`[MARKETPLACE:PUBLISHER] Nie udało się wypełnić ${fieldName}`);
  return false;
}

/**
 * Wypełnij formularz ogłoszenia
 */
async function fillListingForm(page, content) {
  console.log("[MARKETPLACE:PUBLISHER] Wypełnianie formularza...");

  try {
    // Czekaj na załadowanie formularza
    await humanDelay(2000, 4000);

    // --- TYTUŁ ---
    const titleSelectors = [
      SELECTORS.createListing.titleInput,
      ...FALLBACK_SELECTORS.titleInput,
    ];
    const titleFilled = await fillTextField(page, titleSelectors, content.title, "tytuł");
    if (!titleFilled) {
      throw new Error("Nie można wypełnić tytułu");
    }
    await mediumDelay();

    // --- CENA ---
    const priceSelectors = [
      SELECTORS.createListing.priceInput,
      ...FALLBACK_SELECTORS.priceInput,
    ];
    const priceFilled = await fillTextField(page, priceSelectors, String(content.price), "cena");
    if (!priceFilled) {
      throw new Error("Nie można wypełnić ceny");
    }
    await mediumDelay();

    // --- KATEGORIA (opcjonalnie) ---
    if (content.fbCategory) {
      try {
        const categoryButton = await page.$(SELECTORS.createListing.categoryButton);
        if (categoryButton) {
          await categoryButton.click();
          await mediumDelay();

          // Wybierz kategorię
          const categoryMap = {
            Vehicles: SELECTORS.createListing.categoryVehicles,
            "Home & Garden": SELECTORS.createListing.categoryHomeGarden,
            Electronics: SELECTORS.createListing.categoryElectronics,
          };

          const categorySelector = categoryMap[content.fbCategory] || SELECTORS.createListing.categoryOther;
          await safeClick(page, categorySelector);
          await mediumDelay();
        }
      } catch (e) {
        console.warn("[MARKETPLACE:PUBLISHER] Nie udało się wybrać kategorii:", e.message);
      }
    }

    // --- STAN (opcjonalnie - domyślnie "Używany") ---
    try {
      const conditionDropdown = await page.$(SELECTORS.createListing.conditionDropdown);
      if (conditionDropdown) {
        await conditionDropdown.click();
        await shortDelay();
        await safeClick(page, SELECTORS.createListing.conditionUsed);
        await mediumDelay();
      }
    } catch (e) {
      // Ignoruj - pole może nie istnieć
    }

    // --- OPIS ---
    const descSelectors = [
      SELECTORS.createListing.descriptionInput,
      ...FALLBACK_SELECTORS.descriptionInput,
    ];
    const descFilled = await fillTextField(page, descSelectors, content.description, "opis");
    if (!descFilled) {
      console.warn("[MARKETPLACE:PUBLISHER] Nie udało się wypełnić opisu (kontynuuję)");
    }
    await mediumDelay();

    // --- LOKALIZACJA (opcjonalnie) ---
    if (content.location && content.location.city) {
      try {
        const locationInput = await page.$(SELECTORS.createListing.locationInput);
        if (locationInput) {
          await locationInput.click();
          await shortDelay();

          // Wyczyść i wpisz miasto
          await page.keyboard.down("Control");
          await page.keyboard.press("a");
          await page.keyboard.up("Control");
          await page.type(SELECTORS.createListing.locationInput, content.location.city, { delay: 50 });

          await humanDelay(1500, 3000);

          // Wybierz pierwszą sugestię
          const suggestionSelector = SELECTORS.createListing.locationSuggestion;
          await safeClick(page, suggestionSelector);
          await mediumDelay();
        }
      } catch (e) {
        console.warn("[MARKETPLACE:PUBLISHER] Nie udało się ustawić lokalizacji:", e.message);
      }
    }

    return true;
  } catch (err) {
    console.error("[MARKETPLACE:PUBLISHER] Błąd wypełniania formularza:", err.message);
    return false;
  }
}

/**
 * Kliknij przycisk publikacji
 */
async function clickPublish(page) {
  console.log("[MARKETPLACE:PUBLISHER] Klikanie przycisku publikacji...");

  try {
    // Scroll na dół formularza
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await humanDelay(1000, 2000);

    // Szukaj przycisku publikacji
    const publishSelectors = [
      SELECTORS.createListing.publishButton,
      ...FALLBACK_SELECTORS.publishButton,
    ];

    let clicked = false;
    for (const selector of publishSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          // Sprawdź czy przycisk jest aktywny
          const isDisabled = await page.evaluate((el) => {
            return el.getAttribute("aria-disabled") === "true" || el.disabled;
          }, button);

          if (!isDisabled) {
            await button.click();
            clicked = true;
            console.log("[MARKETPLACE:PUBLISHER] Kliknięto przycisk publikacji");
            break;
          }
        }
      } catch (e) {
        // Próbuj następny selektor
      }
    }

    if (!clicked) {
      // Próba przez evaluate
      clicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('div[role="button"]');
        for (const btn of buttons) {
          const text = btn.textContent.toLowerCase();
          if (text.includes("publish") || text.includes("opublikuj")) {
            btn.click();
            return true;
          }
        }
        return false;
      });
    }

    if (!clicked) {
      throw new Error("Nie znaleziono przycisku publikacji");
    }

    // Czekaj na przetworzenie
    await longDelay();
    await humanDelay(3000, 6000);

    return true;
  } catch (err) {
    console.error("[MARKETPLACE:PUBLISHER] Błąd publikacji:", err.message);
    return false;
  }
}

/**
 * Sprawdź czy publikacja się powiodła
 */
async function checkPublishSuccess(page) {
  console.log("[MARKETPLACE:PUBLISHER] Sprawdzanie wyniku publikacji...");

  try {
    await humanDelay(2000, 4000);

    // Sprawdź URL - sukces przekierowuje na stronę ogłoszenia
    const currentUrl = page.url();
    if (currentUrl.includes("/marketplace/item/") || currentUrl.includes("/marketplace/you/selling")) {
      console.log("[MARKETPLACE:PUBLISHER] Publikacja zakończona sukcesem (URL)");
      return { success: true, url: currentUrl };
    }

    // Sprawdź komunikat sukcesu
    const hasSuccess = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes("your listing is now public") ||
        text.includes("twoje ogłoszenie jest teraz publiczne") ||
        text.includes("listing published") ||
        text.includes("opublikowano");
    });

    if (hasSuccess) {
      console.log("[MARKETPLACE:PUBLISHER] Publikacja zakończona sukcesem (komunikat)");
      return { success: true };
    }

    // Sprawdź błędy
    const errorMessage = await page.evaluate(() => {
      const errorEl = document.querySelector('[role="alert"]');
      return errorEl ? errorEl.textContent : null;
    });

    if (errorMessage) {
      console.error("[MARKETPLACE:PUBLISHER] Błąd publikacji:", errorMessage);
      return { success: false, error: errorMessage };
    }

    // Nieznany stan - sprawdź czy wciąż na formularzu
    const isOnForm = await page.evaluate(() => {
      return document.querySelector('input[aria-label*="Title"], input[aria-label*="Tytuł"]') !== null;
    });

    if (isOnForm) {
      return { success: false, error: "Formularz wciąż widoczny - publikacja nie powiodła się" };
    }

    // Zakładamy sukces jeśli nie ma błędów
    return { success: true };
  } catch (err) {
    console.error("[MARKETPLACE:PUBLISHER] Błąd sprawdzania wyniku:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Główna funkcja publikowania
 * @param {object} page - Puppeteer page
 * @param {object} options - opcje
 * @returns {object} wynik
 */
export async function run(page, options = {}) {
  const result = {
    success: false,
    listing: null,
    error: null,
  };

  console.log("[MARKETPLACE:PUBLISHER] Start procesu publikowania...");

  try {
    // Sprawdź czy można publikować
    if (!options.force) {
      const publishCheck = canPublish(
        MARKETPLACE_MAX_ACTIVE_LISTINGS,
        MARKETPLACE_PUBLISH_INTERVAL_DAYS
      );

      if (!publishCheck.canPublish) {
        console.log(`[MARKETPLACE:PUBLISHER] Nie można publikować: ${publishCheck.reason}`);
        result.error = publishCheck.reason;
        return result;
      }
    }

    // Pobierz losową treść
    const content = options.content || getRandomContent(options.categoryId);

    if (!content) {
      result.error = "Brak treści do publikacji";
      console.error("[MARKETPLACE:PUBLISHER]", result.error);
      return result;
    }

    console.log(`[MARKETPLACE:PUBLISHER] Treść: "${content.title}" (${content.price} PLN)`);

    // Nawiguj do formularza
    await navigateToCreateListing(page);

    // Prześlij zdjęcia (najpierw, bo FB tego wymaga)
    if (content.images && content.images.length > 0) {
      const uploaded = await uploadImages(page, content.images);
      if (!uploaded) {
        console.warn("[MARKETPLACE:PUBLISHER] Nie udało się przesłać zdjęć (kontynuuję)");
      }
    }

    // Wypełnij formularz
    const formFilled = await fillListingForm(page, content);
    if (!formFilled) {
      result.error = "Błąd wypełniania formularza";
      await takeScreenshot(page, "publisher_form_error");
      return result;
    }

    // Kliknij przycisk "Next" jeśli istnieje (wieloetapowy formularz)
    try {
      const nextButton = await page.$(SELECTORS.createListing.nextButton);
      if (nextButton) {
        await nextButton.click();
        await longDelay();
      }
    } catch (e) {
      // Ignoruj - może nie być przycisku Next
    }

    // Publikuj
    const published = await clickPublish(page);
    if (!published) {
      result.error = "Błąd klikania przycisku publikacji";
      await takeScreenshot(page, "publisher_publish_error");
      return result;
    }

    // Sprawdź wynik
    const publishResult = await checkPublishSuccess(page);

    if (publishResult.success) {
      // Zapisz do bazy
      const listingId = generateId("pub");
      const now = formatDate();
      const nextRenewal = getNextRenewalDate(MARKETPLACE_RENEWAL_INTERVAL_DAYS);

      const newListing = addPublishedListing({
        id: listingId,
        categoryId: content.categoryId,
        title: content.title,
        price: content.price,
        publishedAt: now,
        nextRenewalDue: nextRenewal,
      });

      result.success = true;
      result.listing = newListing;
      console.log(`[MARKETPLACE:PUBLISHER] Sukces! ID: ${listingId}`);
    } else {
      result.error = publishResult.error || "Nieznany błąd publikacji";
      await takeScreenshot(page, "publisher_unknown_error");
    }

  } catch (err) {
    console.error("[MARKETPLACE:PUBLISHER] Krytyczny błąd:", err.message);
    result.error = err.message;

    // Screenshot przy błędzie
    try {
      await takeScreenshot(page, "publisher_critical_error");
    } catch (e) {
      // Ignoruj
    }

    // Sprawdź czy to checkpoint
    if (err.message === "CHECKPOINT_OR_LOGIN_REQUIRED") {
      throw err;
    }
  }

  return result;
}

/**
 * Publikuj z podaną treścią (do ręcznego wywołania z panelu)
 */
export async function publishWithContent(page, content) {
  return run(page, { content, force: true });
}

export default {
  run,
  publishWithContent,
};
