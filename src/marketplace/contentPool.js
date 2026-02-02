/**
 * Zarządzanie pulą treści dla Marketplace
 */

import {
  readJsonFile,
  writeJsonFile,
  getDataPath,
  randomFromArray,
  randomPrice,
  shuffleArray,
  imageExists,
} from "./utils.js";

const CONTENT_POOL_FILE = "content_pool.json";
const PUBLISHED_FILE = "published.json";

/**
 * Domyślna struktura puli treści
 */
const DEFAULT_CONTENT_POOL = {
  categories: [],
  settings: {
    imagesPerListing: { min: 1, max: 5 },
    publishHours: [9, 10, 11, 14, 15, 16, 18, 19],
    avoidWeekends: false,
  },
};

/**
 * Domyślna struktura opublikowanych ogłoszeń
 */
const DEFAULT_PUBLISHED = {
  listings: [],
  stats: {
    totalPublished: 0,
    totalRenewed: 0,
    lastPublishedAt: null,
    lastRenewedAt: null,
  },
};

/**
 * Wczytaj pulę treści z pliku
 * @returns {object}
 */
export function loadContentPool() {
  const data = readJsonFile(getDataPath(CONTENT_POOL_FILE), DEFAULT_CONTENT_POOL);
  return data;
}

/**
 * Zapisz pulę treści do pliku
 * @param {object} pool - pula treści
 * @returns {boolean}
 */
export function saveContentPool(pool) {
  return writeJsonFile(getDataPath(CONTENT_POOL_FILE), pool);
}

/**
 * Wczytaj listę opublikowanych ogłoszeń
 * @returns {object}
 */
export function loadPublished() {
  const data = readJsonFile(getDataPath(PUBLISHED_FILE), DEFAULT_PUBLISHED);
  return data;
}

/**
 * Zapisz listę opublikowanych ogłoszeń
 * @param {object} published - dane opublikowanych
 * @returns {boolean}
 */
export function savePublished(published) {
  return writeJsonFile(getDataPath(PUBLISHED_FILE), published);
}

/**
 * Waliduj strukturę kategorii
 * @param {object} category - kategoria do walidacji
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateCategory(category) {
  const errors = [];

  if (!category.id) errors.push("Brak id kategorii");
  if (!category.name) errors.push("Brak nazwy kategorii");
  if (!Array.isArray(category.titles) || category.titles.length === 0) {
    errors.push("Brak tytułów (titles musi być niepustą tablicą)");
  }
  if (!Array.isArray(category.descriptions) || category.descriptions.length === 0) {
    errors.push("Brak opisów (descriptions musi być niepustą tablicą)");
  }
  if (!category.prices || typeof category.prices.min !== "number" || typeof category.prices.max !== "number") {
    errors.push("Nieprawidłowa struktura cen (prices.min i prices.max muszą być liczbami)");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Waliduj całą pulę treści
 * @param {object} pool - pula treści
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validatePoolStructure(pool) {
  const errors = [];

  if (!pool || typeof pool !== "object") {
    return { valid: false, errors: ["Pula treści musi być obiektem"] };
  }

  if (!Array.isArray(pool.categories)) {
    errors.push("categories musi być tablicą");
  } else {
    pool.categories.forEach((cat, idx) => {
      const result = validateCategory(cat);
      if (!result.valid) {
        errors.push(`Kategoria ${idx} (${cat.id || "brak id"}): ${result.errors.join(", ")}`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Pobierz aktywne kategorie
 * @returns {object[]}
 */
export function getActiveCategories() {
  const pool = loadContentPool();
  return pool.categories.filter((cat) => cat.active !== false);
}

/**
 * Pobierz kategorię po ID
 * @param {string} categoryId - ID kategorii
 * @returns {object|null}
 */
export function getCategoryById(categoryId) {
  const pool = loadContentPool();
  return pool.categories.find((cat) => cat.id === categoryId) || null;
}

/**
 * Wygeneruj losową treść ogłoszenia z kategorii
 * @param {string} categoryId - ID kategorii (opcjonalne, losowa jeśli nie podana)
 * @returns {object|null}
 */
export function getRandomContent(categoryId = null) {
  const pool = loadContentPool();
  const activeCategories = pool.categories.filter((cat) => cat.active !== false);

  if (activeCategories.length === 0) {
    console.warn("[MARKETPLACE] Brak aktywnych kategorii w puli treści");
    return null;
  }

  // Wybierz kategorię
  let category;
  if (categoryId) {
    category = activeCategories.find((cat) => cat.id === categoryId);
    if (!category) {
      console.warn(`[MARKETPLACE] Nie znaleziono kategorii: ${categoryId}`);
      return null;
    }
  } else {
    category = randomFromArray(activeCategories);
  }

  // Losuj treść
  const title = randomFromArray(category.titles);
  const description = randomFromArray(category.descriptions);
  const price = randomPrice(category.prices.min, category.prices.max);

  // Losuj zdjęcia (jeśli są)
  let images = [];
  if (Array.isArray(category.images) && category.images.length > 0) {
    // Filtruj tylko istniejące zdjęcia
    const existingImages = category.images.filter((img) => imageExists(img));

    if (existingImages.length > 0) {
      const settings = pool.settings || DEFAULT_CONTENT_POOL.settings;
      const numImages = Math.floor(
        Math.random() * (settings.imagesPerListing.max - settings.imagesPerListing.min + 1)
      ) + settings.imagesPerListing.min;

      // Losuj unikalne zdjęcia
      const shuffled = shuffleArray(existingImages);
      images = shuffled.slice(0, Math.min(numImages, shuffled.length));
    }
  }

  return {
    categoryId: category.id,
    categoryName: category.name,
    title,
    description,
    price,
    images,
    location: category.location || null,
    fbCategory: category.fbCategory || null,
  };
}

/**
 * Sprawdź czy można publikować (nie za często, nie za dużo aktywnych)
 * @param {number} maxActive - max aktywnych ogłoszeń
 * @param {number} minDaysBetween - min dni między publikacjami
 * @returns {{canPublish: boolean, reason: string|null}}
 */
export function canPublish(maxActive, minDaysBetween) {
  const published = loadPublished();
  const now = new Date();

  // Sprawdź liczbę aktywnych
  const activeListings = published.listings.filter((l) => l.status === "active");
  if (activeListings.length >= maxActive) {
    return {
      canPublish: false,
      reason: `Osiągnięto limit ${maxActive} aktywnych ogłoszeń`,
    };
  }

  // Sprawdź ostatnią publikację
  if (published.stats.lastPublishedAt) {
    const lastPublished = new Date(published.stats.lastPublishedAt);
    const daysSinceLastPublish = (now - lastPublished) / (1000 * 60 * 60 * 24);

    if (daysSinceLastPublish < minDaysBetween) {
      return {
        canPublish: false,
        reason: `Ostatnia publikacja ${daysSinceLastPublish.toFixed(1)} dni temu (min: ${minDaysBetween})`,
      };
    }
  }

  // Sprawdź czy odpowiednia godzina
  const pool = loadContentPool();
  const publishHours = pool.settings?.publishHours || DEFAULT_CONTENT_POOL.settings.publishHours;
  const currentHour = now.getHours();

  if (!publishHours.includes(currentHour)) {
    return {
      canPublish: false,
      reason: `Nieprawidłowa godzina (${currentHour}). Dozwolone: ${publishHours.join(", ")}`,
    };
  }

  // Sprawdź weekend
  if (pool.settings?.avoidWeekends) {
    const dayOfWeek = now.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return {
        canPublish: false,
        reason: "Publikowanie wyłączone w weekendy",
      };
    }
  }

  return { canPublish: true, reason: null };
}

/**
 * Dodaj nowe ogłoszenie do listy opublikowanych
 * @param {object} listing - dane ogłoszenia
 * @returns {object} dodane ogłoszenie
 */
export function addPublishedListing(listing) {
  const published = loadPublished();

  const newListing = {
    id: listing.id,
    fbListingId: listing.fbListingId || null,
    categoryId: listing.categoryId,
    title: listing.title,
    price: listing.price,
    publishedAt: listing.publishedAt || new Date().toISOString(),
    lastRenewedAt: null,
    nextRenewalDue: listing.nextRenewalDue,
    status: "active",
  };

  published.listings.push(newListing);
  published.stats.totalPublished++;
  published.stats.lastPublishedAt = newListing.publishedAt;

  savePublished(published);
  return newListing;
}

/**
 * Zaktualizuj ogłoszenie po wznowieniu
 * @param {string} listingId - ID ogłoszenia
 * @param {string} nextRenewalDue - nowa data wznowienia
 * @returns {boolean}
 */
export function updateListingRenewal(listingId, nextRenewalDue) {
  const published = loadPublished();

  const listing = published.listings.find((l) => l.id === listingId);
  if (!listing) {
    console.warn(`[MARKETPLACE] Nie znaleziono ogłoszenia: ${listingId}`);
    return false;
  }

  listing.lastRenewedAt = new Date().toISOString();
  listing.nextRenewalDue = nextRenewalDue;
  published.stats.totalRenewed++;
  published.stats.lastRenewedAt = listing.lastRenewedAt;

  savePublished(published);
  return true;
}

/**
 * Zmień status ogłoszenia
 * @param {string} listingId - ID ogłoszenia
 * @param {string} status - nowy status (active, expired, deleted, blocked)
 * @returns {boolean}
 */
export function updateListingStatus(listingId, status) {
  const published = loadPublished();

  const listing = published.listings.find((l) => l.id === listingId);
  if (!listing) {
    return false;
  }

  listing.status = status;
  savePublished(published);
  return true;
}

/**
 * Pobierz ogłoszenia wymagające wznowienia
 * @returns {object[]}
 */
export function getListingsNeedingRenewal() {
  const published = loadPublished();
  const now = new Date();

  return published.listings.filter((listing) => {
    if (listing.status !== "active") return false;
    if (!listing.nextRenewalDue) return false;

    const dueDate = new Date(listing.nextRenewalDue);
    return now >= dueDate;
  });
}

/**
 * Pobierz statystyki puli i publikacji
 * @returns {object}
 */
export function getStats() {
  const pool = loadContentPool();
  const published = loadPublished();

  const activeCategories = pool.categories.filter((c) => c.active !== false);
  const totalTitles = activeCategories.reduce((sum, c) => sum + (c.titles?.length || 0), 0);
  const totalDescriptions = activeCategories.reduce((sum, c) => sum + (c.descriptions?.length || 0), 0);
  const totalImages = activeCategories.reduce((sum, c) => sum + (c.images?.length || 0), 0);

  const activeListings = published.listings.filter((l) => l.status === "active");
  const needRenewal = getListingsNeedingRenewal();

  return {
    pool: {
      totalCategories: pool.categories.length,
      activeCategories: activeCategories.length,
      totalTitles,
      totalDescriptions,
      totalImages,
    },
    listings: {
      total: published.listings.length,
      active: activeListings.length,
      needingRenewal: needRenewal.length,
      totalPublished: published.stats.totalPublished,
      totalRenewed: published.stats.totalRenewed,
      lastPublishedAt: published.stats.lastPublishedAt,
      lastRenewedAt: published.stats.lastRenewedAt,
    },
  };
}

export default {
  loadContentPool,
  saveContentPool,
  loadPublished,
  savePublished,
  validateCategory,
  validatePoolStructure,
  getActiveCategories,
  getCategoryById,
  getRandomContent,
  canPublish,
  addPublishedListing,
  updateListingRenewal,
  updateListingStatus,
  getListingsNeedingRenewal,
  getStats,
};
