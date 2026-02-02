/**
 * Scheduler dla automatycznych akcji Marketplace
 */

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { loadCookies } from "../fb/cookies.js";
import { isCheckpoint } from "../fb/checkpoint.js";
import { sendOwnerAlert } from "../telegram.js";
import renewer from "./renewer.js";
import publisher from "./publisher.js";
import { getListingsNeedingRenewal, canPublish, getStats } from "./contentPool.js";
import {
  humanDelay,
  longDelay,
  readJsonFile,
  writeJsonFile,
  getDataPath,
  formatDate,
} from "./utils.js";
import {
  MARKETPLACE_ENABLED,
  MARKETPLACE_RENEWAL_INTERVAL_DAYS,
  MARKETPLACE_RENEWAL_CHECK_HOURS,
  MARKETPLACE_PUBLISH_INTERVAL_DAYS,
  MARKETPLACE_MAX_ACTIVE_LISTINGS,
  MARKETPLACE_MAX_ERRORS_BEFORE_STOP,
  MARKETPLACE_HEADLESS,
} from "../config.js";

puppeteer.use(StealthPlugin());

const STATE_FILE = "scheduler_state.json";

/**
 * Domyślny stan schedulera
 */
const DEFAULT_STATE = {
  isRunning: false,
  lastCheck: null,
  lastRenewalRun: null,
  lastPublishRun: null,
  consecutiveErrors: 0,
  stopped: false,
  stoppedReason: null,
};

/**
 * Wczytaj stan schedulera
 */
function loadState() {
  return readJsonFile(getDataPath(STATE_FILE), DEFAULT_STATE);
}

/**
 * Zapisz stan schedulera
 */
function saveState(state) {
  return writeJsonFile(getDataPath(STATE_FILE), state);
}

/**
 * Resetuj stan schedulera
 */
export function resetState() {
  return saveState(DEFAULT_STATE);
}

/**
 * Sprawdź czy scheduler jest zatrzymany
 */
export function isStopped() {
  const state = loadState();
  return state.stopped;
}

/**
 * Zatrzymaj scheduler
 */
export function stop(reason = "Manual stop") {
  const state = loadState();
  state.stopped = true;
  state.stoppedReason = reason;
  state.isRunning = false;
  saveState(state);
  console.log(`[MARKETPLACE:SCHEDULER] Zatrzymano: ${reason}`);
}

/**
 * Wznów scheduler
 */
export function resume() {
  const state = loadState();
  state.stopped = false;
  state.stoppedReason = null;
  state.consecutiveErrors = 0;
  saveState(state);
  console.log("[MARKETPLACE:SCHEDULER] Wznowiono");
}

/**
 * Uruchom przeglądarkę z załadowanymi cookies
 */
async function launchBrowser() {
  console.log("[MARKETPLACE:SCHEDULER] Uruchamianie przeglądarki...");

  const browser = await puppeteer.launch({
    headless: MARKETPLACE_HEADLESS ? "new" : false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--window-size=1366,768",
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });

  const page = await browser.newPage();

  // Ustaw viewport
  await page.setViewport({
    width: 1366,
    height: 768,
  });

  // Załaduj cookies
  const cookies = await loadCookies();
  if (cookies && cookies.length > 0) {
    await page.setCookie(...cookies);
    console.log("[MARKETPLACE:SCHEDULER] Załadowano cookies");
  } else {
    console.warn("[MARKETPLACE:SCHEDULER] Brak cookies - może wymagać logowania");
  }

  return { browser, page };
}

/**
 * Sprawdź czy pora na wznowienia
 */
function shouldRunRenewal() {
  const state = loadState();
  const now = new Date();
  const currentHour = now.getHours();

  // Sprawdź godzinę
  if (!MARKETPLACE_RENEWAL_CHECK_HOURS.includes(currentHour)) {
    return false;
  }

  // Sprawdź czy były ogłoszenia do wznowienia
  const needingRenewal = getListingsNeedingRenewal();
  if (needingRenewal.length === 0) {
    return false;
  }

  // Sprawdź czy już nie sprawdzaliśmy w tej godzinie
  if (state.lastRenewalRun) {
    const lastRun = new Date(state.lastRenewalRun);
    const hoursSinceLastRun = (now - lastRun) / (1000 * 60 * 60);

    // Nie częściej niż raz na godzinę
    if (hoursSinceLastRun < 1) {
      return false;
    }
  }

  return true;
}

/**
 * Sprawdź czy pora na publikację
 */
function shouldRunPublish() {
  const publishCheck = canPublish(
    MARKETPLACE_MAX_ACTIVE_LISTINGS,
    MARKETPLACE_PUBLISH_INTERVAL_DAYS
  );

  return publishCheck.canPublish;
}

/**
 * Uruchom zadanie wznawiania
 */
async function runRenewalTask(page) {
  console.log("[MARKETPLACE:SCHEDULER] Uruchamiam zadanie wznawiania...");

  const state = loadState();

  try {
    const result = await renewer.run(page);

    state.lastRenewalRun = formatDate();
    state.consecutiveErrors = result.success ? 0 : state.consecutiveErrors + 1;
    saveState(state);

    if (result.renewed > 0) {
      await sendOwnerAlert("Marketplace", `✅ Wznowiono ${result.renewed} ogłoszeń`);
    }

    return result;
  } catch (err) {
    state.consecutiveErrors++;
    saveState(state);

    if (err.message === "CHECKPOINT_OR_LOGIN_REQUIRED") {
      await sendOwnerAlert("Marketplace", "🚨 Wykryto checkpoint/login - scheduler zatrzymany");
      stop("CHECKPOINT_OR_LOGIN_REQUIRED");
    }

    throw err;
  }
}

/**
 * Uruchom zadanie publikacji
 */
async function runPublishTask(page) {
  console.log("[MARKETPLACE:SCHEDULER] Uruchamiam zadanie publikacji...");

  const state = loadState();

  try {
    const result = await publisher.run(page);

    state.lastPublishRun = formatDate();
    state.consecutiveErrors = result.success ? 0 : state.consecutiveErrors + 1;
    saveState(state);

    if (result.success && result.listing) {
      await sendOwnerAlert("Marketplace", `📢 Opublikowano "${result.listing.title}" (${result.listing.price} PLN)`);
    }

    return result;
  } catch (err) {
    state.consecutiveErrors++;
    saveState(state);

    if (err.message === "CHECKPOINT_OR_LOGIN_REQUIRED") {
      await sendOwnerAlert("Marketplace", "🚨 Wykryto checkpoint/login - scheduler zatrzymany");
      stop("CHECKPOINT_OR_LOGIN_REQUIRED");
    }

    throw err;
  }
}

/**
 * Główna pętla schedulera (do wywołania przez setInterval lub osobny proces)
 */
export async function runSchedulerCycle() {
  if (!MARKETPLACE_ENABLED) {
    return { skipped: true, reason: "MARKETPLACE_ENABLED=false" };
  }

  const state = loadState();

  // Sprawdź czy zatrzymany
  if (state.stopped) {
    return { skipped: true, reason: state.stoppedReason };
  }

  // Sprawdź limit błędów
  if (state.consecutiveErrors >= MARKETPLACE_MAX_ERRORS_BEFORE_STOP) {
    stop(`Osiągnięto limit ${MARKETPLACE_MAX_ERRORS_BEFORE_STOP} błędów z rzędu`);
    await sendOwnerAlert("Marketplace", `🛑 Automatycznie zatrzymany po ${state.consecutiveErrors} błędach`);
    return { skipped: true, reason: "Max errors reached" };
  }

  // Sprawdź czy jest coś do zrobienia
  const shouldRenew = shouldRunRenewal();
  const shouldPublish = shouldRunPublish();

  if (!shouldRenew && !shouldPublish) {
    return { skipped: true, reason: "Nic do zrobienia" };
  }

  console.log("[MARKETPLACE:SCHEDULER] Rozpoczynam cykl...");
  state.isRunning = true;
  state.lastCheck = formatDate();
  saveState(state);

  let browser;
  let page;
  const results = {
    renewal: null,
    publish: null,
  };

  try {
    // Uruchom przeglądarkę
    const launched = await launchBrowser();
    browser = launched.browser;
    page = launched.page;

    // Nawiguj do FB żeby sprawdzić login
    await page.goto("https://www.facebook.com", { waitUntil: "networkidle2", timeout: 60000 });
    await longDelay();

    // Sprawdź checkpoint
    if (await isCheckpoint(page)) {
      throw new Error("CHECKPOINT_OR_LOGIN_REQUIRED");
    }

    // Uruchom wznawianie
    if (shouldRenew) {
      try {
        results.renewal = await runRenewalTask(page);
      } catch (err) {
        console.error("[MARKETPLACE:SCHEDULER] Błąd wznawiania:", err.message);
        results.renewal = { success: false, error: err.message };
      }

      // Pauza między zadaniami
      await humanDelay(5000, 10000);
    }

    // Uruchom publikację (jeśli wznawianie się powiodło lub nie było)
    if (shouldPublish && (!results.renewal || results.renewal.success !== false)) {
      try {
        results.publish = await runPublishTask(page);
      } catch (err) {
        console.error("[MARKETPLACE:SCHEDULER] Błąd publikacji:", err.message);
        results.publish = { success: false, error: err.message };
      }
    }

  } catch (err) {
    console.error("[MARKETPLACE:SCHEDULER] Krytyczny błąd cyklu:", err.message);

    const state = loadState();
    state.consecutiveErrors++;
    saveState(state);

    if (err.message === "CHECKPOINT_OR_LOGIN_REQUIRED") {
      stop("CHECKPOINT_OR_LOGIN_REQUIRED");
    }

  } finally {
    // Zamknij przeglądarkę
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // Ignoruj
      }
    }

    const state = loadState();
    state.isRunning = false;
    saveState(state);
  }

  console.log("[MARKETPLACE:SCHEDULER] Cykl zakończony");
  return results;
}

/**
 * Uruchom scheduler jako ciągły proces
 * @param {number} intervalMinutes - interwał sprawdzania w minutach
 */
export async function startScheduler(intervalMinutes = 60) {
  console.log(`[MARKETPLACE:SCHEDULER] Start schedulera (interwał: ${intervalMinutes} min)`);

  if (!MARKETPLACE_ENABLED) {
    console.warn("[MARKETPLACE:SCHEDULER] Marketplace wyłączony (MARKETPLACE_ENABLED=false)");
    return;
  }

  // Resetuj stan przy starcie
  const state = loadState();
  state.stopped = false;
  state.stoppedReason = null;
  state.isRunning = false;
  saveState(state);

  // Uruchom pierwszy cykl
  await runSchedulerCycle();

  // Ustaw interwał
  const intervalMs = intervalMinutes * 60 * 1000;
  setInterval(async () => {
    if (!isStopped()) {
      await runSchedulerCycle();
    }
  }, intervalMs);
}

/**
 * Pobierz status schedulera
 */
export function getSchedulerStatus() {
  const state = loadState();
  const stats = getStats();

  return {
    enabled: MARKETPLACE_ENABLED,
    state,
    config: {
      renewalIntervalDays: MARKETPLACE_RENEWAL_INTERVAL_DAYS,
      renewalCheckHours: MARKETPLACE_RENEWAL_CHECK_HOURS,
      publishIntervalDays: MARKETPLACE_PUBLISH_INTERVAL_DAYS,
      maxActiveListings: MARKETPLACE_MAX_ACTIVE_LISTINGS,
      maxErrors: MARKETPLACE_MAX_ERRORS_BEFORE_STOP,
    },
    stats,
    nextActions: {
      shouldRenew: shouldRunRenewal(),
      shouldPublish: shouldRunPublish(),
      listingsNeedingRenewal: getListingsNeedingRenewal().length,
    },
  };
}

/**
 * Ręczne uruchomienie wznawiania (z panelu)
 */
export async function manualRenewal() {
  console.log("[MARKETPLACE:SCHEDULER] Ręczne uruchomienie wznawiania...");

  let browser;
  let page;

  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    page = launched.page;

    await page.goto("https://www.facebook.com", { waitUntil: "networkidle2", timeout: 60000 });
    await longDelay();

    if (await isCheckpoint(page)) {
      throw new Error("CHECKPOINT_OR_LOGIN_REQUIRED");
    }

    return await renewer.run(page);

  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // Ignoruj
      }
    }
  }
}

/**
 * Ręczne uruchomienie publikacji (z panelu)
 */
export async function manualPublish(options = {}) {
  console.log("[MARKETPLACE:SCHEDULER] Ręczne uruchomienie publikacji...");

  let browser;
  let page;

  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    page = launched.page;

    await page.goto("https://www.facebook.com", { waitUntil: "networkidle2", timeout: 60000 });
    await longDelay();

    if (await isCheckpoint(page)) {
      throw new Error("CHECKPOINT_OR_LOGIN_REQUIRED");
    }

    return await publisher.run(page, { ...options, force: true });

  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // Ignoruj
      }
    }
  }
}

export default {
  startScheduler,
  runSchedulerCycle,
  getSchedulerStatus,
  stop,
  resume,
  resetState,
  isStopped,
  manualRenewal,
  manualPublish,
};
