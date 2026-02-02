/**
 * Moduł Marketplace - Autoposting i Wznawianie
 *
 * Entry point eksportujący wszystkie funkcje modułu.
 *
 * Funkcjonalności:
 * - Automatyczne wznawianie ogłoszeń co 7 dni
 * - Automatyczne publikowanie nowych ogłoszeń z puli treści
 * - Scheduler z harmonogramem i obsługą błędów
 * - API do zarządzania z panelu
 */

// Eksportuj moduły
export * from "./selectors.js";
export * from "./utils.js";
export * from "./contentPool.js";
export * from "./renewer.js";
export * from "./publisher.js";
export * from "./scheduler.js";

// Import do re-eksportu jako default
import scheduler from "./scheduler.js";
import publisher from "./publisher.js";
import renewer from "./renewer.js";
import contentPool from "./contentPool.js";

/**
 * Inicjalizacja modułu marketplace
 * Wywoływane przy starcie aplikacji jeśli MARKETPLACE_ENABLED=true
 */
export async function initMarketplace() {
  const { MARKETPLACE_ENABLED } = await import("../config.js");

  if (!MARKETPLACE_ENABLED) {
    console.log("[MARKETPLACE] Moduł wyłączony (MARKETPLACE_ENABLED=false)");
    return false;
  }

  console.log("[MARKETPLACE] Inicjalizacja modułu...");

  // Sprawdź konfigurację
  const stats = contentPool.getStats();
  console.log(`[MARKETPLACE] Pula treści: ${stats.pool.activeCategories} aktywnych kategorii`);
  console.log(`[MARKETPLACE] Ogłoszenia: ${stats.listings.active} aktywnych, ${stats.listings.needingRenewal} do wznowienia`);

  // Uruchom scheduler
  // Interwał 60 minut - scheduler sam sprawdza czy jest pora na akcje
  scheduler.startScheduler(60);

  return true;
}

/**
 * API dla panelu - wszystkie funkcje w jednym miejscu
 */
export const marketplaceApi = {
  // Status i statystyki
  getStatus: scheduler.getSchedulerStatus,
  getStats: contentPool.getStats,

  // Pula treści
  getContentPool: contentPool.loadContentPool,
  saveContentPool: contentPool.saveContentPool,
  validatePool: contentPool.validatePoolStructure,
  getRandomContent: contentPool.getRandomContent,

  // Ogłoszenia
  getPublished: contentPool.loadPublished,
  getListingsNeedingRenewal: contentPool.getListingsNeedingRenewal,

  // Log wznowień
  getRenewalLog: renewer.getRenewalLog,

  // Akcje ręczne
  manualRenewal: scheduler.manualRenewal,
  manualPublish: scheduler.manualPublish,

  // Sterowanie schedulerem
  stopScheduler: scheduler.stop,
  resumeScheduler: scheduler.resume,
  resetScheduler: scheduler.resetState,
};

export default {
  initMarketplace,
  marketplaceApi,
  scheduler,
  publisher,
  renewer,
  contentPool,
};
