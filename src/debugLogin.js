// src/debugLogin.js
import puppeteer from "puppeteer";
import { loadCookies, saveCookies } from "./fb/cookies.js";
import { fbLogin, checkIfLogged } from "./fb/login.js";

async function main() {
  const browser = await puppeteer.launch({
    headless: false,          // ❗ fizyczne okno, żadnego headless
    defaultViewport: null,
    slowMo: 120,              // zwalniamy ruchy, żebyś widział każdy krok
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const page = await browser.newPage();

  // jeśli coś jest w cookies.json – załadujemy
  await loadCookies(page);

  console.log("[DEBUG] Otwieram facebook.com …");
  await page.goto("https://www.facebook.com/", {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });

  console.log("[DEBUG] Start fbLogin(page)...");
  try {
    await fbLogin(page);
    console.log("[DEBUG] fbLogin(page) zakończony (bez throw).");
  } catch (err) {
    console.error("[DEBUG] fbLogin rzucił błąd:", err);
  }

  console.log("[DEBUG] Sprawdzam checkIfLogged...");
  const logged = await checkIfLogged(page);
  console.log("[DEBUG] Wynik checkIfLogged:", logged);

  if (logged) {
    console.log("[DEBUG] Wygląda na to, że jesteś zalogowany – zapisuję cookies...");
    await saveCookies(page);
    console.log("[DEBUG] Cookies zapisane.");
  } else {
    console.log(
      "[DEBUG] Nadal wyglądasz na niezalogowanego (ekran logowania / brak feeda)."
    );
  }

  console.log("==================================================");
  console.log("[DEBUG] Zostawiam okno przeglądarki otwarte.");
  console.log("  • Poobserwuj, na czym fbLogin się wykłada.");
  console.log("  • Jak skończysz, zamknij okno ręcznie,");
  console.log("    a w terminalu wciśnij Ctrl+C, żeby wyjść.");
  console.log("==================================================");

  // trzymamy proces przy życiu, dopóki nie zabijesz go Ctrl+C
  await new Promise(() => {});
}

main().catch((err) => {
  console.error("[DEBUG] Krytyczny błąd w debugLogin:", err);
  process.exit(1);
});
