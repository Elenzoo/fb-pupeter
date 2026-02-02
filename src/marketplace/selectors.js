/**
 * Selektory CSS dla Facebook Marketplace
 * UWAGA: Selektory FB zmieniają się często - wymagają regularnej aktualizacji
 */

export const SELECTORS = {
  // ==================== STRONA GŁÓWNA MARKETPLACE ====================
  marketplace: {
    // Nawigacja
    createListingButton: '[aria-label="Create new listing"], [aria-label="Utwórz nowe ogłoszenie"]',
    yourListingsLink: 'a[href*="/marketplace/you/selling"]',

    // Lista ogłoszeń użytkownika
    listingCard: '[data-pagelet="MarketplaceSelling"] > div > div',
    listingTitle: 'span[dir="auto"]',
    listingPrice: 'span[dir="auto"]',
    listingImage: 'img[src*="scontent"]',
  },

  // ==================== MOJE OGŁOSZENIA (/marketplace/you/selling) ====================
  myListings: {
    // Kontener z ogłoszeniami
    container: '[data-pagelet="MarketplaceSelling"]',

    // Pojedyncze ogłoszenie
    listingItem: '[role="listitem"], [data-visualcompletion="ignore-dynamic"]',

    // Przycisk akcji (... menu)
    actionMenuButton: '[aria-label="More"], [aria-label="Więcej"]',

    // Przycisk "Wznów" w menu lub bezpośrednio
    renewButton: '[role="menuitem"]:has-text("Renew"), [role="menuitem"]:has-text("Wznów")',
    renewButtonDirect: 'div[role="button"]:has-text("Renew"), div[role="button"]:has-text("Wznów")',

    // Status ogłoszenia
    activeStatus: ':has-text("Active"), :has-text("Aktywne")',
    expiredStatus: ':has-text("Expired"), :has-text("Wygasło")',
    pendingStatus: ':has-text("Pending"), :has-text("Oczekujące")',

    // Potwierdzenie wznowienia
    renewConfirmButton: '[role="button"]:has-text("Renew"), [role="button"]:has-text("Wznów")',
  },

  // ==================== FORMULARZ TWORZENIA OGŁOSZENIA ====================
  createListing: {
    // URL formularza
    url: 'https://www.facebook.com/marketplace/create/item',

    // Wybór kategorii
    categoryButton: '[aria-label="Choose a category"], [aria-label="Wybierz kategorię"]',
    categoryVehicles: '[role="menuitem"]:has-text("Vehicles"), [role="menuitem"]:has-text("Pojazdy")',
    categoryHomeGarden: '[role="menuitem"]:has-text("Home & Garden"), [role="menuitem"]:has-text("Dom i ogród")',
    categoryElectronics: '[role="menuitem"]:has-text("Electronics"), [role="menuitem"]:has-text("Elektronika")',
    categoryOther: '[role="menuitem"]:has-text("Miscellaneous"), [role="menuitem"]:has-text("Inne")',

    // Pola formularza
    titleInput: 'input[aria-label="Title"], input[aria-label="Tytuł"], label:has-text("Title") input, label:has-text("Tytuł") input',
    priceInput: 'input[aria-label="Price"], input[aria-label="Cena"], label:has-text("Price") input, label:has-text("Cena") input',
    descriptionInput: 'textarea[aria-label="Description"], textarea[aria-label="Opis"], label:has-text("Description") textarea, label:has-text("Opis") textarea',

    // Lokalizacja
    locationInput: 'input[aria-label="Location"], input[aria-label="Lokalizacja"]',
    locationSuggestion: '[role="listbox"] [role="option"]',

    // Zdjęcia
    photoUploadButton: '[aria-label="Add Photos"], [aria-label="Dodaj zdjęcia"]',
    photoInput: 'input[type="file"][accept*="image"]',
    photoPreview: '[data-pagelet="MediaUploader"] img',
    removePhotoButton: '[aria-label="Remove photo"], [aria-label="Usuń zdjęcie"]',

    // Dodatkowe opcje
    conditionDropdown: '[aria-label="Condition"], [aria-label="Stan"]',
    conditionNew: '[role="option"]:has-text("New"), [role="option"]:has-text("Nowy")',
    conditionUsed: '[role="option"]:has-text("Used"), [role="option"]:has-text("Używany")',

    // Publikacja
    publishButton: '[aria-label="Publish"], [aria-label="Opublikuj"], div[role="button"]:has-text("Publish"), div[role="button"]:has-text("Opublikuj")',
    nextButton: '[aria-label="Next"], [aria-label="Dalej"]',

    // Potwierdzenie sukcesu
    successMessage: ':has-text("Your listing is now public"), :has-text("Twoje ogłoszenie jest teraz publiczne")',
    viewListingButton: '[role="button"]:has-text("View Listing"), [role="button"]:has-text("Zobacz ogłoszenie")',
  },

  // ==================== EDYCJA OGŁOSZENIA ====================
  editListing: {
    editButton: '[aria-label="Edit"], [aria-label="Edytuj"]',
    saveButton: '[aria-label="Save"], [aria-label="Zapisz"]',
    deleteButton: '[aria-label="Delete"], [aria-label="Usuń"]',
    deleteConfirmButton: '[role="button"]:has-text("Delete"), [role="button"]:has-text("Usuń")',
  },

  // ==================== DIALOGI I MODALNE ====================
  dialogs: {
    // Ogólne
    closeButton: '[aria-label="Close"], [aria-label="Zamknij"]',
    confirmButton: '[role="button"]:has-text("Confirm"), [role="button"]:has-text("Potwierdź")',
    cancelButton: '[role="button"]:has-text("Cancel"), [role="button"]:has-text("Anuluj")',

    // Błędy
    errorMessage: '[role="alert"]',

    // Checkpoint / Weryfikacja
    checkpointDialog: '[role="dialog"]:has-text("Security Check"), [role="dialog"]:has-text("Kontrola bezpieczeństwa")',
  },

  // ==================== WSPÓLNE ====================
  common: {
    // Spinner ładowania
    loadingSpinner: '[role="progressbar"]',

    // Przyciski nawigacji
    backButton: '[aria-label="Go back"], [aria-label="Wróć"]',

    // Menu dropdown
    dropdownMenu: '[role="menu"]',
    menuItem: '[role="menuitem"]',
  },
};

/**
 * Alternatywne selektory (fallback) - używane gdy główne nie działają
 * Facebook często zmienia atrybuty, więc warto mieć zapasowe
 */
export const FALLBACK_SELECTORS = {
  titleInput: [
    'input[name="title"]',
    'input[placeholder*="title" i]',
    'input[placeholder*="tytuł" i]',
    '[data-testid="marketplace_listing_title_input"]',
  ],
  priceInput: [
    'input[name="price"]',
    'input[placeholder*="price" i]',
    'input[placeholder*="cena" i]',
    '[data-testid="marketplace_listing_price_input"]',
  ],
  descriptionInput: [
    'textarea[name="description"]',
    'textarea[placeholder*="description" i]',
    'textarea[placeholder*="opis" i]',
    '[data-testid="marketplace_listing_description_input"]',
  ],
  publishButton: [
    'button[type="submit"]',
    '[data-testid="marketplace_listing_publish_button"]',
  ],
};

/**
 * XPath selektory - backup dla trudnych przypadków
 */
export const XPATH_SELECTORS = {
  renewButton: '//div[@role="button"][contains(., "Wznów") or contains(., "Renew")]',
  publishButton: '//div[@role="button"][contains(., "Opublikuj") or contains(., "Publish")]',
  titleInput: '//input[contains(@aria-label, "Tytuł") or contains(@aria-label, "Title")]',
};

export default SELECTORS;
