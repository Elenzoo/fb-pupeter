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
 * Pr próba zalogowania się na **dowolnym widocznym formularzu logowania**:
 * - pasek u góry,
 * - pełna strona logowania,
 * - popup "Wyświetl więcej na Facebooku".
 */
async function loginViaVisibleForm(page, context = "visible-form") {
  try {
    console.log(`[FB][login-form] Szukam formularza logowania (${context})...`);

    // Spróbuj ogarnąć ewentualne cookies na logowaniu
    await acceptLoginCookies(page).catch(() => {});

    const emailSelector = [
      "input#email",
      "input[name='email']",
      "input[name='email_or_phone']",
      "input[aria-label*='Adres e-mail']",
      "input[placeholder*='Adres e-mail']",
      "input[placeholder*='adres e-mail']",
      "input[placeholder*='Email']",
      "input[placeholder*='email']",
    ].join(",");

    const passSelector = [
      "input#pass",
      "input[name='pass']",
      "input[aria-label*='Hasło']",
      "input[placeholder*='Hasło']",
      "input[placeholder*='hasło']",
      "input[placeholder*='Password']",
      "input[placeholder*='password']",
    ].join(",");

    const emailInput = await page.$(emailSelector);
    const passInput = await page.$(passSelector);

    if (!emailInput || !passInput) {
      console.log(
        "[FB][login-form] Brak pełnego formularza (email + hasło) na stronie."
      );
      return false;
    }

    const email = process.env.FB_EMAIL || "";
    const password = process.env.FB_PASSWORD || "";

    if (!email || !password) {
      console.error(
        "[FB][login-form] Brak FB_EMAIL / FB_PASSWORD w zmiennych środowiskowych."
      );
      return false;
    }

    console.log("[FB][login-form] Wypełniam email/hasło...");

    // wyczyść i wpisz email
    await emailInput.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await emailInput.type(email, { delay: 50 });

    // wyczyść i wpisz hasło
    await passInput.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await passInput.type(password, { delay: 50 });

    const loginButton =
      (await page.$("button[name='login']")) ||
      (await page.$("button[type='submit']"));

    if (!loginButton) {
      console.log("[FB][login-form] Nie znalazłem przycisku logowania.");
      return false;
    }

    console.log("[FB][login-form] Klikam Zaloguj się…");

    await Promise.all([
      loginButton.click(),
      page
        .waitForNavigation({
          waitUntil: "networkidle2",
          timeout: 60000,
        })
        .catch(() => {}),
    ]);

    await sleepRandom(1500, 2500);
    console.log("[FB][login-form] Formularz logowania wysłany.");
    return true;
  } catch (err) {
    console.error("[FB][login-form] Błąd:", err.message);
    return false;
  }
}

/**
 * Główne logowanie na FB – klasyczne /login.
 */
async function fbLogin(page) {
  console.log("[FB][login] Start logowania…");

  await page.goto("https://www.facebook.com/login", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  // popup cookies – próbujemy go zamknąć zanim dotkniemy inputów
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
 * – próbujemy zalogować się **na miejscu**.
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

  console.log(
    "[FB] Wykryto nakładkę / okno logowania na poście – próba zalogowania."
  );

  // 1) Najpierw spróbuj po prostu zalogować się na widocznym formularzu
  const usedInline = await loginViaVisibleForm(page, "post-overlay-inline");
  if (usedInline) {
    const logged = await checkIfLogged(page);
    if (logged) {
      console.log(
        "[FB] Udało się zalogować z poziomu nakładki posta (inline formularz)."
      );
      return;
    }
  }

  // 2) Fallback – klikamy "Zaloguj się" / "Log In", jeśli jest osobny przycisk
  let clicked = await clickByText(page, "Zaloguj się");
  if (!clicked) {
    clicked = await clickByText(page, "Log In");
  }

  if (clicked) {
    console.log(
      "[FB] Kliknięto przycisk logowania w nakładce posta. Czekam na przeładowanie..."
    );
    await sleepRandom(4000, 6000);

    // Po przeładowaniu znowu spróbuj formularza, tym razem już na pełnej stronie logowania
    const used = await loginViaVisibleForm(page, "post-overlay-after-click");
    if (used) {
      const logged = await checkIfLogged(page);
      if (logged) {
        console.log("[FB] Zalogowano po kliknięciu przycisku w nakładce.");
      } else {
        console.log(
          "[FB] Formularz po nakładce wysłany, ale nadal nie widać zalogowanej sesji."
        );
      }
    } else {
      console.log(
        "[FB] Po kliknięciu przycisku w nakładce nie znalazłem formularza logowania."
      );
    }
  } else {
    console.log(
      "[FB] Nie udało się znaleźć przycisku logowania w nakładce posta."
    );
  }
}

export {
  fbLogin,
  checkIfLogged,
  ensureLoggedInOnPostOverlay,
  clickByText,
  acceptLoginCookies,
  loginViaVisibleForm,
};
