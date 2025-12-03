// src/fb/login.js
import { FB_EMAIL, FB_PASSWORD } from "../config.js";
import { acceptCookies } from "./cookies.js";

/**
 * Prosty helper delay (bez używania page.waitForTimeout, żeby nie mieszać API)
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sprawdza, czy wyglądamy na zalogowanych:
 *  - jeśli widać feed / główny FB → true
 *  - jeśli nadal strona logowania / "Zaloguj się" → false
 */
export async function checkIfLogged(page) {
  try {
    const url = page.url();
    const isLoginUrl =
      url.includes("/login") ||
      url.includes("/login/device-based") ||
      url.includes("/checkpoint");

    const status = await page.evaluate(() => {
      const bodyText = (document.body.innerText || "").toLowerCase();

      const hasLoginWords =
        bodyText.includes("zaloguj się") ||
        bodyText.includes("log into facebook") ||
        bodyText.includes("nie pamiętasz nazwy konta?");

      const hasFeedClues =
        bodyText.includes("strona główna") ||
        bodyText.includes("znajomi") ||
        bodyText.includes("watch") ||
        bodyText.includes("rolki");

      return {
        hasLoginWords,
        hasFeedClues,
      };
    });

    if (isLoginUrl && status.hasLoginWords && !status.hasFeedClues) {
      return false;
    }

    if (status.hasFeedClues && !status.hasLoginWords) {
      return true;
    }

    // Stan niejednoznaczny – ale jeśli nie jesteśmy na oczywistym /login,
    // to zakładamy, że jesteśmy zalogowani.
    if (!isLoginUrl) {
      return true;
    }

    return false;
  } catch (err) {
    console.error("[FB][checkIfLogged] Błąd:", err.message);
    return false;
  }
}

/**
 * Główna funkcja logowania:
 *  - radzi sobie z wieloma popupami cookies
 *  - NIE polega na waitForNavigation (bo FB często trzyma na /login)
 *  - na końcu pyta checkIfLogged, czy naprawdę weszliśmy do środka
 */
export async function fbLogin(page) {
  if (!FB_EMAIL || !FB_PASSWORD) {
    console.error(
      "[FB] Brak FB_EMAIL lub FB_PASSWORD w env – nie można się zalogować."
    );
    throw new Error("Brak danych logowania FB (FB_EMAIL / FB_PASSWORD).");
  }

  console.log("[FB] Trwa logowanie...");

  // 1) Wejście na /login
  try {
    await page.goto("https://www.facebook.com/login", {
      waitUntil: "load",
      timeout: 60000,
    });
  } catch (err) {
    console.warn(
      "[FB][login] Timeout / błąd przy goto /login – idę dalej i tak.",
      err.message
    );
  }

  // 2) Pierwsza fala cookies – zanim cokolwiek zrobimy
  await delay(2000);
  await acceptCookies(page, "login-initial");
  await delay(1000);
  // Jeszcze jedna próba, gdyby popup doskoczył minimalnie później
  await acceptCookies(page, "login-initial-2");

  // 3) Wyszukanie pól email / hasło
  console.log("[FB][login] Szukam pól email/hasło...");

  const emailInput = await page.$("input[name='email'], input#email");
  const passInput = await page.$("input[name='pass'], input#pass");

  console.log(
    "[FB][login] emailInput:",
    !!emailInput,
    "passInput:",
    !!passInput
  );

  if (!emailInput || !passInput) {
    throw new Error("Nie znaleziono pola email albo hasła na stronie logowania.");
  }

  // 4) Wpisanie maila / hasła – w trakcie też może wyskoczyć cookies,
  // więc po mailu robimy dodatkowy sweep.
  await emailInput.click({ clickCount: 3 });
  await emailInput.type(FB_EMAIL, { delay: 50 });

  // dodatkowy sweep cookies po wpisaniu maila
  await acceptCookies(page, "login-after-email");

  await passInput.click({ clickCount: 3 });
  await passInput.type(FB_PASSWORD, { delay: 50 });

  // 5) Jeszcze raz cookies – tuż przed kliknięciem "Zaloguj się"
  await acceptCookies(page, "login-before-click");
  await delay(500);

  // 6) Znalezienie przycisku "Zaloguj się" i kliknięcie
  const loginBtn =
    (await page.$("button[name='login']")) ||
    (await page.$("button[type='submit']")) ||
    (await page.$("button"));

  console.log("[FB][login] loginBtn:", !!loginBtn);

  if (!loginBtn) {
    throw new Error("Nie znalazłem przycisku logowania.");
  }

  await loginBtn.click();

  console.log(
    "[FB][login] Kliknięto przycisk 'Zaloguj się' – czekam na reakcję..."
  );

  // 7) Po kliknięciu FB potrafi jeszcze raz walnąć cookies
  //    lub checkpoint – więc robimy małą pętlę:
  for (let i = 0; i < 3; i++) {
    await delay(2000);
    await acceptCookies(page, `login-after-click-${i + 1}`);
  }

  // 8) Dajemy jeszcze chwilę na realne zalogowanie
  await delay(4000);

  const nowUrl = page.url();
  console.log("[FB][login] Po kliknięciu login, URL:", nowUrl);

  const logged = await checkIfLogged(page);
  if (!logged) {
    throw new Error("Logowanie nie powiodło się (ciągle ekran logowania).");
  }

  console.log("[FB] Wygląda na to, że logowanie się powiodło.");
}

/**
 * Używane na overlaya posta (np. gdy FB znowu wywali login).
 * Teraz po prostu:
 *  - sprawdza, czy jesteśmy zalogowani
 *  - jeśli nie, próbuje fbLogin
 */
export async function ensureLoggedInOnPostOverlay(page) {
  const logged = await checkIfLogged(page);
  if (logged) {
    return;
  }

  console.log(
    "[FB][ensureLoggedInOnPostOverlay] Wygląda na to, że nie jesteś zalogowany – próbuję fbLogin()…"
  );

  await fbLogin(page);

  const after = await checkIfLogged(page);
  if (!after) {
    throw new Error(
      "Po próbie fbLogin nadal wyglądasz na niezalogowanego (overaly)."
    );
  }
}
