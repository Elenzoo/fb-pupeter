#!/usr/bin/env node
/**
 * scripts/generate-cookies.js
 *
 * Skrypt pomocniczy do generowania cookies Facebook z rotacją.
 * Otwiera przeglądarkę w trybie widocznym, czeka na manualne logowanie (z 2FA),
 * a następnie zapisuje cookies do plików z numeracją.
 *
 * Użycie:
 *   node scripts/generate-cookies.js [--index=N] [--upload] [--list]
 *
 * Opcje:
 *   --index=N  - zapisz jako cookies_N.json (domyślnie: następny wolny numer)
 *   --upload   - po zapisaniu, wyślij cookies przez SCP na serwer
 *   --list     - tylko pokaż listę istniejących plików cookies
 *
 * Przykłady:
 *   node scripts/generate-cookies.js                    # zapisz jako cookies_1.json (lub następny)
 *   node scripts/generate-cookies.js --index=2          # zapisz jako cookies_2.json
 *   node scripts/generate-cookies.js --index=1 --upload # zapisz i wyślij na serwer
 *   node scripts/generate-cookies.js --list             # pokaż istniejące pliki
 */

import "dotenv/config";
import puppeteer from "puppeteer";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { execSync } from "child_process";
import readline from "readline";

// Konfiguracja
const MAIN_COOKIES_FILE = "cookies.json";
const BACKUP_COOKIES_DIR = process.env.BACKUP_COOKIES_DIR || "./data/backup_cookies";
const SCP_COOKIES_TARGET = (process.env.SCP_COOKIES_TARGET || "").trim();

// Kolory konsoli
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
};

function log(msg, color = "reset") {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logBox(lines) {
  const maxLen = Math.max(...lines.map((l) => l.length));
  const border = "═".repeat(maxLen + 2);

  console.log(`\n${colors.cyan}╔${border}╗${colors.reset}`);
  for (const line of lines) {
    const padding = " ".repeat(maxLen - line.length);
    console.log(`${colors.cyan}║${colors.reset} ${line}${padding} ${colors.cyan}║${colors.reset}`);
  }
  console.log(`${colors.cyan}╚${border}╝${colors.reset}\n`);
}

/**
 * Pobiera listę istniejących plików cookies_N.json
 */
function getExistingCookiesFiles() {
  try {
    const backupDir = path.resolve(BACKUP_COOKIES_DIR);
    if (!fsSync.existsSync(backupDir)) return [];

    const files = fsSync.readdirSync(backupDir);
    const cookieFiles = [];

    for (const file of files) {
      const match = file.match(/^cookies_(\d+)\.json$/);
      if (match) {
        const index = parseInt(match[1], 10);
        const filePath = path.join(backupDir, file);
        const stats = fsSync.statSync(filePath);
        const ageHours = Math.round((Date.now() - stats.mtimeMs) / (1000 * 60 * 60));

        cookieFiles.push({ index, filename: file, path: filePath, ageHours });
      }
    }

    return cookieFiles.sort((a, b) => a.index - b.index);
  } catch {
    return [];
  }
}

/**
 * Znajduje następny wolny numer
 */
function getNextFreeIndex() {
  const existing = getExistingCookiesFiles();
  if (existing.length === 0) return 1;
  return Math.max(...existing.map((f) => f.index)) + 1;
}

/**
 * Parsuje argumenty CLI
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    index: null,
    upload: false,
    list: false,
  };

  for (const arg of args) {
    if (arg === "--upload") {
      result.upload = true;
    } else if (arg === "--list") {
      result.list = true;
    } else if (arg.startsWith("--index=")) {
      const val = arg.split("=")[1];
      result.index = parseInt(val, 10);
      if (isNaN(result.index) || result.index < 1) {
        log(`Błąd: --index musi być liczbą >= 1`, "red");
        process.exit(1);
      }
    }
  }

  return result;
}

async function waitForEnter() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${colors.yellow}>>> Naciśnij ENTER gdy skończysz logowanie...${colors.reset}`, () => {
      rl.close();
      resolve();
    });
  });
}

async function checkIfLogged(page) {
  try {
    return await page.evaluate(() => {
      const hasSearch = !!(
        document.querySelector('input[aria-label*="Szukaj"]') ||
        document.querySelector('input[placeholder*="Szukaj"]') ||
        document.querySelector('input[placeholder*="Search"]')
      );
      const hasProfile = !!(
        document.querySelector('a[aria-label*="Profil"]') ||
        document.querySelector('a[aria-label*="Profile"]')
      );
      const hasAccount = !!(
        document.querySelector('div[aria-label*="Konto"]') ||
        document.querySelector('div[aria-label*="Account"]')
      );
      const hasFeed = !!document.querySelector('[role="feed"]');

      return hasSearch || hasProfile || hasAccount || hasFeed;
    });
  } catch {
    return false;
  }
}

async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // ignoruj
  }
}

async function saveCookiesToFile(cookies, filePath) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(cookies, null, 2), "utf8");
}

function uploadViaScp(localPath, target) {
  if (!target) {
    log("Brak SCP_COOKIES_TARGET w .env - pomijam upload", "yellow");
    return false;
  }

  try {
    log(`Wysyłam przez SCP: ${path.basename(localPath)} → ${target}`, "blue");
    execSync(`scp "${localPath}" "${target}"`, { stdio: "inherit" });
    log("Upload zakończony!", "green");
    return true;
  } catch (err) {
    log(`Błąd SCP: ${err.message}`, "red");
    return false;
  }
}

function showList() {
  const files = getExistingCookiesFiles();

  logBox([
    "Lista plików backup cookies",
    `Folder: ${BACKUP_COOKIES_DIR}`,
  ]);

  if (files.length === 0) {
    log("  (brak plików)", "dim");
  } else {
    for (const f of files) {
      const ageStr = f.ageHours < 24 ? `${f.ageHours}h` : `${Math.round(f.ageHours / 24)}d`;
      log(`  ${colors.cyan}${f.filename}${colors.reset} - wiek: ${ageStr}`);
    }
  }

  console.log();
  log(`Następny wolny numer: ${getNextFreeIndex()}`, "dim");
}

async function main() {
  const args = parseArgs();

  // Tryb --list
  if (args.list) {
    showList();
    process.exit(0);
  }

  // Ustal numer pliku
  const targetIndex = args.index ?? getNextFreeIndex();
  const targetFilename = `cookies_${targetIndex}.json`;
  const targetPath = path.join(path.resolve(BACKUP_COOKIES_DIR), targetFilename);

  // Sprawdź czy plik już istnieje
  const existing = getExistingCookiesFiles();
  const existsAlready = existing.some((f) => f.index === targetIndex);

  logBox([
    "FB Cookie Generator (z rotacją)",
    "",
    `Zapisze jako: ${targetFilename}`,
    existsAlready ? `(UWAGA: nadpisze istniejący plik!)` : `(nowy plik)`,
    "",
    "Otworzy przeglądarkę - zaloguj się ręcznie.",
  ]);

  // Pokaż istniejące pliki
  if (existing.length > 0) {
    log("Istniejące pliki backup:", "dim");
    for (const f of existing) {
      const marker = f.index === targetIndex ? " ← nadpisany" : "";
      log(`  ${f.filename}${marker}`, "dim");
    }
    console.log();
  }

  log("Uruchamiam przeglądarkę...", "blue");

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      "--start-maximized",
      "--disable-notifications",
      "--disable-blink-features=AutomationControlled",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const page = await browser.newPage();

  // Stealth
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    window.chrome = window.chrome || { runtime: {} };
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, "languages", { get: () => ["pl-PL", "pl"] });
  });

  log("Nawiguję do Facebook...", "blue");
  await page.goto("https://www.facebook.com/login.php", { waitUntil: "networkidle2" });

  logBox([
    "INSTRUKCJA",
    "",
    "1. Zaloguj się na swoje konto Facebook",
    "2. Jeśli FB poprosi o 2FA - wprowadź kod",
    "3. Poczekaj aż zobaczysz stronę główną",
    "4. Wróć tutaj i naciśnij ENTER",
  ]);

  await waitForEnter();

  log("Sprawdzam status logowania...", "blue");
  let isLogged = await checkIfLogged(page);

  if (!isLogged) {
    log("Nie wykryto sesji. Spróbuj ponownie.", "yellow");

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const retry = await new Promise((resolve) => {
      rl.question("Czy chcesz spróbować ponownie? (t/n): ", (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === "t" || answer.toLowerCase() === "y");
      });
    });

    if (retry) {
      await waitForEnter();
      isLogged = await checkIfLogged(page);
    }

    if (!isLogged) {
      log("Nie wykryto sesji. Zamykam.", "red");
      await browser.close();
      process.exit(1);
    }
  }

  log("Sesja wykryta! Pobieram cookies...", "green");

  const cookies = await page.cookies();
  log(`Pobrano ${cookies.length} cookies`, "cyan");

  // Zapisz do głównego pliku
  const mainPath = path.resolve(MAIN_COOKIES_FILE);
  await saveCookiesToFile(cookies, mainPath);
  log(`Zapisano: ${mainPath}`, "green");

  // Zapisz jako backup z numerem
  await saveCookiesToFile(cookies, targetPath);
  log(`Zapisano backup: ${targetPath}`, "green");

  // Opcjonalnie: upload SCP
  if (args.upload) {
    uploadViaScp(targetPath, SCP_COOKIES_TARGET);
  }

  await browser.close();

  logBox([
    "SUKCES!",
    "",
    `Cookies zapisane jako: ${targetFilename}`,
    "",
    "Aby wygenerować kolejny zestaw:",
    `  node scripts/generate-cookies.js --index=${targetIndex + 1}`,
    "",
    args.upload && SCP_COOKIES_TARGET
      ? `Upload: ${SCP_COOKIES_TARGET}`
      : "Skopiuj pliki na serwer ręcznie lub użyj --upload",
  ].filter(Boolean));

  process.exit(0);
}

main().catch((err) => {
  console.error("Błąd:", err);
  process.exit(1);
});
