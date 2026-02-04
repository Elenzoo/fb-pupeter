#!/usr/bin/env node
/**
 * Test wszystkich zmiennych .env i funkcji FB_Watcher
 * Uruchom: node tools/test-env-config.js
 */

import "dotenv/config";
import fs from "fs";
import path from "path";

// Symulacja testów bez uruchamiania przeglądarki
const results = {
  timestamp: new Date().toISOString(),
  tests: [],
  summary: { passed: 0, failed: 0, warnings: 0 }
};

function test(name, condition, details = "") {
  const passed = typeof condition === "function" ? condition() : condition;
  const result = { name, passed, details };
  results.tests.push(result);
  if (passed) results.summary.passed++;
  else results.summary.failed++;
  return passed;
}

function warn(name, details) {
  results.tests.push({ name, passed: null, warning: true, details });
  results.summary.warnings++;
}

console.log("\n=== FB_Watcher ENV & Config Test ===\n");

// === 1. PODSTAWOWE ZMIENNE ===
console.log("📋 1. Podstawowe zmienne .env");
test("FB_EMAIL ustawiony", !!process.env.FB_EMAIL, process.env.FB_EMAIL?.slice(0, 10) + "...");
test("FB_PASSWORD ustawiony", !!process.env.FB_PASSWORD, "***");
test("CHECK_INTERVAL_MS prawidłowy", Number(process.env.CHECK_INTERVAL_MS) >= 10000, `${process.env.CHECK_INTERVAL_MS}ms`);
test("LOG_LEVEL w zakresie 0-3", () => {
  const level = Number(process.env.LOG_LEVEL ?? 1);
  return level >= 0 && level <= 3;
}, `LOG_LEVEL=${process.env.LOG_LEVEL}`);

// === 2. FAST_MODE ===
console.log("\n⚡ 2. FAST_MODE (filtrowanie starych postów)");
const FAST_MODE = process.env.FAST_MODE === "true";
const FAST_MAX_AGE_MIN = Number(process.env.FAST_MAX_AGE_MIN || 180);
test("FAST_MODE rozpoznany", typeof FAST_MODE === "boolean", `FAST_MODE=${FAST_MODE}`);
test("FAST_MAX_AGE_MIN prawidłowy", FAST_MAX_AGE_MIN > 0 && FAST_MAX_AGE_MIN <= 1440, `${FAST_MAX_AGE_MIN} min`);

if (FAST_MODE) {
  console.log(`   ✓ Tryb szybki WŁĄCZONY - komentarze starsze niż ${FAST_MAX_AGE_MIN} min będą pomijane`);
} else {
  warn("FAST_MODE wyłączony", "Wszystkie komentarze będą przetwarzane (wolniejsze)");
}

// === 3. WEBHOOK ===
console.log("\n🔗 3. Webhook (wysyłka komentarzy)");
const WEBHOOK_URL = (process.env.WEBHOOK_URL || "").trim();
const WEBHOOK_MAX_AGE_MIN = Number(process.env.WEBHOOK_MAX_AGE_MIN || 60);
test("WEBHOOK_URL ustawiony", !!WEBHOOK_URL, WEBHOOK_URL ? `${WEBHOOK_URL.slice(0, 40)}...` : "BRAK");
test("WEBHOOK_MAX_AGE_MIN prawidłowy", WEBHOOK_MAX_AGE_MIN > 0 && WEBHOOK_MAX_AGE_MIN <= 1440, `${WEBHOOK_MAX_AGE_MIN} min`);

if (WEBHOOK_URL) {
  // Test połączenia
  try {
    const testPayload = { test: true, timestamp: Date.now() };
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testPayload),
      signal: AbortSignal.timeout(10000)
    });
    test("Webhook odpowiada", response.ok || response.status < 500, `Status: ${response.status}`);
  } catch (err) {
    test("Webhook dostępny", false, `Błąd: ${err.message}`);
  }
} else {
  warn("Brak WEBHOOK_URL", "Komentarze nie będą wysyłane na webhook");
}

// === 4. TELEGRAM ===
console.log("\n📱 4. Telegram");
const TG_BOT_OWNER = process.env.TELEGRAM_BOT_TOKEN_OWNER;
const TG_CHAT_OWNER = process.env.TELEGRAM_CHAT_ID_OWNER;
const TG_SEND_OWNER = process.env.TELEGRAM_SEND_TO_OWNER === "1";
test("TELEGRAM_BOT_TOKEN_OWNER", !!TG_BOT_OWNER, TG_BOT_OWNER ? `${TG_BOT_OWNER.slice(0, 15)}...` : "BRAK");
test("TELEGRAM_CHAT_ID_OWNER", !!TG_CHAT_OWNER, TG_CHAT_OWNER || "BRAK");
test("TELEGRAM_SEND_TO_OWNER", TG_SEND_OWNER, TG_SEND_OWNER ? "WŁĄCZONY" : "WYŁĄCZONY");

// Test API Telegram
if (TG_BOT_OWNER && TG_SEND_OWNER) {
  try {
    const tgUrl = `https://api.telegram.org/bot${TG_BOT_OWNER}/getMe`;
    const response = await fetch(tgUrl, { signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    test("Telegram Bot API działa", data.ok, data.result?.username ? `@${data.result.username}` : "Błąd");
  } catch (err) {
    test("Telegram API dostępne", false, `Błąd: ${err.message}`);
  }
}

// === 5. POSTS API (Panel) ===
console.log("\n🌐 5. Posts API (Panel zdalny)");
const POSTS_API_URL = (process.env.POSTS_API_URL || "").trim();
const POSTS_API_TOKEN = (process.env.POSTS_API_TOKEN || "").trim();
test("POSTS_API_URL ustawiony", !!POSTS_API_URL, POSTS_API_URL || "BRAK");
test("POSTS_API_TOKEN ustawiony", !!POSTS_API_TOKEN, POSTS_API_TOKEN ? "***" : "BRAK");

if (POSTS_API_URL) {
  try {
    const headers = POSTS_API_TOKEN ? { Authorization: `Bearer ${POSTS_API_TOKEN}` } : {};
    const response = await fetch(POSTS_API_URL, { headers, signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    test("Posts API odpowiada", response.ok, `Status: ${response.status}, postów: ${Array.isArray(data) ? data.length : data?.posts?.length || "?"}`);
  } catch (err) {
    test("Posts API dostępne", false, `Błąd: ${err.message}`);
  }
}

// === 6. LITE - Session Management ===
console.log("\n🔐 6. LITE - Session Management");
const SESSION_MIN = Number(process.env.SESSION_LENGTH_MIN_MS || 30 * 60 * 1000);
const SESSION_MAX = Number(process.env.SESSION_LENGTH_MAX_MS || 90 * 60 * 1000);
test("SESSION_LENGTH_MIN_MS prawidłowy", SESSION_MIN >= 5 * 60 * 1000, `${Math.round(SESSION_MIN / 60000)} min`);
test("SESSION_LENGTH_MAX_MS prawidłowy", SESSION_MAX > SESSION_MIN, `${Math.round(SESSION_MAX / 60000)} min`);
test("Zakres sesji sensowny", SESSION_MAX <= 3 * 60 * 60 * 1000, "Max 3h");

// === 7. LITE - Warmup ===
console.log("\n🔥 7. LITE - Warmup");
const WARMUP_ENABLED = process.env.WARMUP_ENABLED !== "false";
const WARMUP_MIN = Number(process.env.WARMUP_DURATION_MIN_MS || 5 * 60 * 1000);
const WARMUP_MAX = Number(process.env.WARMUP_DURATION_MAX_MS || 10 * 60 * 1000);
test("WARMUP_ENABLED", true, WARMUP_ENABLED ? "WŁĄCZONY" : "WYŁĄCZONY");
test("WARMUP_DURATION_MIN_MS prawidłowy", WARMUP_MIN >= 60 * 1000, `${Math.round(WARMUP_MIN / 60000)} min`);
test("WARMUP_DURATION_MAX_MS prawidłowy", WARMUP_MAX > WARMUP_MIN, `${Math.round(WARMUP_MAX / 60000)} min`);

// === 8. LITE - Night Mode ===
console.log("\n🌙 8. LITE - Night Mode");
const NIGHT_ENABLED = process.env.NIGHT_MODE_ENABLED === "true";
const NIGHT_START = Number(process.env.NIGHT_START_HOUR || 22);
const NIGHT_END = Number(process.env.NIGHT_END_HOUR || 7);
const NIGHT_CATCHUP = Number(process.env.NIGHT_CATCHUP_HOURS || 8);

test("NIGHT_MODE_ENABLED", true, NIGHT_ENABLED ? "WŁĄCZONY" : "WYŁĄCZONY");
test("NIGHT_START_HOUR prawidłowy", NIGHT_START >= 0 && NIGHT_START <= 23, `${NIGHT_START}:00`);
test("NIGHT_END_HOUR prawidłowy", NIGHT_END >= 0 && NIGHT_END <= 23, `${NIGHT_END}:00`);
test("NIGHT_CATCHUP_HOURS prawidłowy", NIGHT_CATCHUP > 0 && NIGHT_CATCHUP <= 24, `${NIGHT_CATCHUP}h`);

// Sprawdź czy teraz jest noc
const now = new Date();
const currentHour = now.getHours();
const isNight = NIGHT_START > NIGHT_END
  ? (currentHour >= NIGHT_START || currentHour < NIGHT_END)
  : (currentHour >= NIGHT_START && currentHour < NIGHT_END);

if (NIGHT_ENABLED) {
  console.log(`   ℹ️  Aktualna godzina: ${currentHour}:00, tryb nocny: ${NIGHT_START}:00 - ${NIGHT_END}:00`);
  console.log(`   ℹ️  Czy teraz noc? ${isNight ? "TAK - bot będzie spał" : "NIE - bot będzie działał"}`);
}

// === 9. LITE - Human Behavior ===
console.log("\n🧠 9. LITE - Human Behavior");
const HUMAN_MODE = process.env.HUMAN_MODE !== "false";
const VIEWPORT_RAND = process.env.VIEWPORT_RANDOMIZATION !== "false";
const TYPING_MISTAKES = process.env.TYPING_MISTAKES_ENABLED !== "false";
const TYPING_CHANCE = Number(process.env.TYPING_MISTAKES_CHANCE || 0.03);
const NAV_MISTAKES = process.env.NAVIGATION_MISTAKES_ENABLED !== "false";
const PROFILE_VISITS = process.env.PROFILE_VISITS_ENABLED !== "false";
const PROFILE_CHANCE = Number(process.env.PROFILE_VISITS_CHANCE || 0.08);
const TAB_SIM = process.env.TAB_SIMULATION_ENABLED !== "false";
const TAB_CHANCE = Number(process.env.TAB_SIMULATION_CHANCE || 0.10);
const IMAGE_INT = process.env.IMAGE_INTERACTION_ENABLED !== "false";
const IMAGE_CHANCE = Number(process.env.IMAGE_INTERACTION_CHANCE || 0.15);
const RANDOM_LIKE = Number(process.env.HUMAN_RANDOM_LIKE_CHANCE || 0.20);

test("HUMAN_MODE", true, HUMAN_MODE ? "WŁĄCZONY" : "WYŁĄCZONY");
test("VIEWPORT_RANDOMIZATION", true, VIEWPORT_RAND ? "WŁĄCZONY" : "WYŁĄCZONY");
test("TYPING_MISTAKES", true, TYPING_MISTAKES ? `${(TYPING_CHANCE * 100).toFixed(1)}%` : "WYŁĄCZONY");
test("NAVIGATION_MISTAKES", true, NAV_MISTAKES ? "WŁĄCZONY" : "WYŁĄCZONY");
test("PROFILE_VISITS", true, PROFILE_VISITS ? `${(PROFILE_CHANCE * 100).toFixed(1)}%` : "WYŁĄCZONY");
test("TAB_SIMULATION", true, TAB_SIM ? `${(TAB_CHANCE * 100).toFixed(1)}%` : "WYŁĄCZONY");
test("IMAGE_INTERACTION", true, IMAGE_INT ? `${(IMAGE_CHANCE * 100).toFixed(1)}%` : "WYŁĄCZONY");
test("RANDOM_LIKE_CHANCE", RANDOM_LIKE >= 0 && RANDOM_LIKE <= 1, `${(RANDOM_LIKE * 100).toFixed(1)}%`);

// === 10. LITE - Feed Scanner ===
console.log("\n🔍 10. LITE - Feed Scanner");
const FEED_ENABLED = process.env.FEED_SCAN_ENABLED === "true";
const FEED_KEYWORDS = (process.env.FEED_SCAN_KEYWORDS || "").split(",").map(k => k.trim()).filter(Boolean);
const FEED_SCROLL_MIN = Number(process.env.FEED_SCROLL_DURATION_MIN || 1);
const FEED_SCROLL_MAX = Number(process.env.FEED_SCROLL_DURATION_MAX || 3);

test("FEED_SCAN_ENABLED", true, FEED_ENABLED ? "WŁĄCZONY" : "WYŁĄCZONY");
test("FEED_SCAN_KEYWORDS", FEED_ENABLED ? FEED_KEYWORDS.length > 0 : true, FEED_KEYWORDS.length > 0 ? FEED_KEYWORDS.join(", ") : "BRAK");
test("FEED_SCROLL_DURATION prawidłowy", FEED_SCROLL_MAX >= FEED_SCROLL_MIN, `${FEED_SCROLL_MIN}-${FEED_SCROLL_MAX} min`);

// === 11. 2Captcha ===
console.log("\n🔓 11. 2Captcha Solver");
const CAPTCHA_KEY = (process.env.CAPTCHA_API_KEY || "").trim();
test("CAPTCHA_API_KEY ustawiony", !!CAPTCHA_KEY, CAPTCHA_KEY ? `${CAPTCHA_KEY.slice(0, 10)}...` : "BRAK");

if (CAPTCHA_KEY) {
  try {
    const balanceUrl = `https://2captcha.com/res.php?key=${CAPTCHA_KEY}&action=getbalance&json=1`;
    const response = await fetch(balanceUrl, { signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    test("2Captcha API działa", data.status === 1, data.status === 1 ? `Saldo: $${data.request}` : `Błąd: ${data.request}`);
  } catch (err) {
    test("2Captcha API dostępne", false, `Błąd: ${err.message}`);
  }
}

// === 12. Meta Ads Scanner ===
console.log("\n📊 12. Meta Ads Scanner");
const METAADS_KEYWORDS = (process.env.METAADS_KEYWORDS || "").trim();
const METAADS_COUNTRY = (process.env.METAADS_COUNTRY || "PL").trim();
const METAADS_INTERVAL = Number(process.env.METAADS_SCAN_INTERVAL_H || 12);
const METAADS_AUTO_SEND = process.env.METAADS_AUTO_SEND_TO_WATCHER !== "false";

test("METAADS_KEYWORDS", true, METAADS_KEYWORDS || "BRAK");
test("METAADS_COUNTRY", METAADS_COUNTRY.length === 2, METAADS_COUNTRY);
test("METAADS_SCAN_INTERVAL_H", METAADS_INTERVAL > 0, `${METAADS_INTERVAL}h`);
test("METAADS_AUTO_SEND_TO_WATCHER", true, METAADS_AUTO_SEND ? "WŁĄCZONY" : "WYŁĄCZONY");

// === 13. Pliki danych ===
console.log("\n📁 13. Pliki danych");
const dataDir = path.join(process.cwd(), "data");
const cacheFile = path.join(dataDir, "comments-cache.json");
const postsFile = path.join(dataDir, "posts.json");
const discoveriesFile = path.join(dataDir, "discoveries.json");
const blacklistFile = path.join(dataDir, "blacklist.json");

test("Katalog data/ istnieje", fs.existsSync(dataDir), dataDir);
test("comments-cache.json istnieje", fs.existsSync(cacheFile), cacheFile);
test("posts.json istnieje", fs.existsSync(postsFile), postsFile);

if (fs.existsSync(cacheFile)) {
  try {
    const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    const postCount = Object.keys(cache).length;
    test("comments-cache.json prawidłowy", postCount >= 0, `${postCount} postów w cache`);
  } catch {
    test("comments-cache.json prawidłowy", false, "Błąd parsowania JSON");
  }
}

if (fs.existsSync(postsFile)) {
  try {
    const posts = JSON.parse(fs.readFileSync(postsFile, "utf8"));
    test("posts.json prawidłowy", Array.isArray(posts), `${posts.length} postów`);
  } catch {
    test("posts.json prawidłowy", false, "Błąd parsowania JSON");
  }
}

// === PODSUMOWANIE ===
console.log("\n" + "=".repeat(50));
console.log("📊 PODSUMOWANIE");
console.log("=".repeat(50));
console.log(`✅ Testy zaliczone: ${results.summary.passed}`);
console.log(`❌ Testy niezaliczone: ${results.summary.failed}`);
console.log(`⚠️  Ostrzeżenia: ${results.summary.warnings}`);
console.log("=".repeat(50));

// Zapisz wyniki do JSON
const resultsFile = path.join(process.cwd(), "tmp", "env-test-results.json");
fs.mkdirSync(path.dirname(resultsFile), { recursive: true });
fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
console.log(`\n📄 Wyniki zapisane do: ${resultsFile}`);

// Exit code
process.exit(results.summary.failed > 0 ? 1 : 0);
