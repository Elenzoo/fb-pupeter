// src/fb/login.js
import { sleepRandom } from "../utils/sleep.js";

/**
 * Akceptuje popup cookies na stronie logowania FB.
 * Szuka przycisku po tekście, oznacza go data-atrybutem i klika z poziomu Puppeteera.
 */
async function acceptLoginCookies(page) {
  try {
    console.log("[FB][login-cookies] Szukam popupu cookies...");

    // chwila na pojawienie się popupu
    await sleepRandom(800, 1300);

    const found = await page.evaluate(() => {
      const wanted = [
        "Zezwól na wszystkie pliki cookie",
        "Zezwól na wszystkie pliki",
        "Allow all cookies",
        "Odrzuć opcjonalne pliki cookie",
        "Odrzuc opcjonalne pliki cookie",
      ].map((t) => t.toLowerCase());

      const buttons = Array.from(
        document.querySelectorAll("button, [role='button']")
      );

      let marked = false;

      for (const btn of buttons) {
        const txt = (btn.innerText || btn.textContent || "").trim();
        if (!txt) continue;
        const low = txt.toLowerCase();

        if (wanted.some((w) => low.includes(w))) {
          btn.setAttribute("data-fb-cookie-btn", "1");
          marked = true;
          break;
        }
      }

      return marked;
    });

    if (!found) {
      console.log(
        "[FB][login-cookies] Nie znaleziono przycisku cookies (po tekście)."
      );
      return false;
    }

    await page.click('[data-fb-cookie-btn="1"]');
    console.log(
      '[FB][login-cookies] Kliknięto przycisk cookies przez Puppeteera (data-fb-cookie-btn="1").'
    );

    await sleepRandom(1200, 2000);
    return true;
  } catch (err) {
    console.log("[FB][login-cookies] Błąd:", err.message);
    return false;
  }
}

/**
 * Główne logowanie na FB.
 */
async function fbLogin(page) {
  console.log("[FB][login] Start logowania…");

  await page.goto("https://www.facebook.com/login", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  // 1. popup cookies – próbujemy go zamknąć zanim dotkniemy inputów
  await acceptLoginCookies(page);

  console.log("[FB][login] Czekam na input email/pass...");

  await page.waitForSelector("#email", { timeout: 60000 });
  await page.waitForSelector("#pass", { timeout: 60000 });

  // jeszcze raz sprawdź, czy cookies nie wyskoczyły ponownie
  await acceptLoginCookies(page);

  console.log("[FB][login] Wpisuję email...");
  await page.type("#email", process.env.FB_EMAIL || "", { delay: 60 });

  console.log("[FB][login] Wpisuję hasło...");
  await page.type("#pass", process.env.FB_PASSWORD || "", { delay: 60 });

  console.log("[FB][login] Klikam Zaloguj się…");

  await Promise.all([
    page.click('button[name="login"]'),
    page
      .waitForNavigation({
        waitUntil: "networkidle2",
        timeout: 60000,
      })
      .catch(() => {}),
  ]);

  console.log("[FB] Po logowaniu:", page.url());
}

/**
 * Szybki check, czy jesteśmy zalogowani.
 */
async function checkIfLogged(page) {
  return page.evaluate(() => {
    const selectors = [
      'input[aria-label*="Szukaj"]',
      'input[placeholder*="Szukaj"]',
      'a[aria-label*="Profil"]',
      'div[aria-label*="Konto"]',
    ];
    return selectors.some((sel) => document.querySelector(sel));
  });
}

/**
 * Kliknięcie elementu (button / link) po dokładnym tekście – po stronie DOM.
 * Używane np. w nakładce „Wyświetl więcej na Facebooku”.
 */
async function clickByText(page, text) {
  const res = await page.evaluate((label) => {
    const els = Array.from(
      document.querySelectorAll("button, a, div[role='button']")
    );
    const lowLabel = label.toLowerCase();
    for (const el of els) {
      const t = (el.innerText || el.textContent || "").trim().toLowerCase();
      if (!t) continue;
      if (t === lowLabel) {
        el.click();
        return true;
      }
    }
    return false;
  }, text);
  return res;
}

/**
 * Jeżeli na poście pojawi się nakładka z przyciskiem „Zaloguj się / Log In”
 * – klikamy, żeby przejść na pełną stronę FB.
 */
async function ensureLoggedInOnPostOverlay(page) {
  const overlayDetected = await page.evaluate(() => {
    const texts = Array.from(
      document.querySelectorAll("div, span, h1, h2, h3, button, a")
    )
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean);

    return texts.some((t) => {
      const low = t.toLowerCase();
      return (
        low.includes("wyświetl więcej na facebooku") ||
        low.includes("zobacz więcej na facebooku") ||
        low.includes("see more on facebook")
      );
    });
  });

  if (!overlayDetected) return;

  console.log("[FB] Wykryto okno logowania na poście – próba zalogowania.");

  let clicked = await clickByText(page, "Zaloguj się");
  if (!clicked) {
    clicked = await clickByText(page, "Log In");
  }

  if (clicked) {
    console.log(
      "[FB] Kliknięto przycisk logowania w nakładce posta. Czekam na przeładowanie..."
    );
    await sleepRandom(4000, 6000);
  } else {
    console.log(
      "[FB] Nie udało się znaleźć przycisku logowania w nakładce posta."
    );
  }
}

export { fbLogin, checkIfLogged, ensureLoggedInOnPostOverlay, clickByText, acceptLoginCookies };
