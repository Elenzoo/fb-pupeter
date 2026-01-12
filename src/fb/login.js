// src/fb/login.js
import { sleepRandom } from "../utils/sleep.js";

/**
 * FB login helpers – PRO (NO COOLDOWN)
 *
 * Najważniejsze:
 * - Główne logowanie: https://www.facebook.com/login.php?next=<postUrl>
 * - Best-effort (zero throw, zero crashy)
 * - Dwa tryby:
 *    1) login.php?next (najstabilniejsze)
 *    2) fallback: loginViaVisibleForm (overlay / różne layouty)
 *
 * Kompatybilność:
 * - eksportujemy też clickByText, acceptLoginCookies, loginViaVisibleForm (jak w wersji lokalnej)
 */

function norm(s) {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cookies popup – wersja "mark + click" (jak lokalnie), ale best-effort.
 */
async function acceptLoginCookies(page) {
  try {
    console.log("[FB][login-cookies] Szukam popupu cookies...");

    await sleepRandom(300, 900);

    const found = await page.evaluate(() => {
      const wanted = [
        "Zezwól na wszystkie pliki cookie",
        "Zezwól na wszystkie pliki",
        "Allow all cookies",
        "Accept all cookies",
        "Akceptuj wszystkie",
        "Odrzuć opcjonalne pliki cookie",
        "Odrzuc opcjonalne pliki cookie",
      ].map((t) => t.toLowerCase());

      const buttons = Array.from(
        document.querySelectorAll("button, [role='button']")
      );

      for (const btn of buttons) {
        const txt = (btn.innerText || btn.textContent || "").trim();
        if (!txt) continue;
        const low = txt.toLowerCase();

        if (wanted.some((w) => low.includes(w))) {
          btn.setAttribute("data-fb-cookie-btn", "1");
          return true;
        }
      }

      return false;
    });

    if (!found) {
      return false;
    }

    await page
      .click('[data-fb-cookie-btn="1"]')
      .catch(() => {});

    console.log(
      '[FB][login-cookies] Kliknięto cookies (data-fb-cookie-btn="1").'
    );

    await sleepRandom(600, 1200);
    return true;
  } catch (err) {
    console.log("[FB][login-cookies] Błąd (ignorowany):", err?.message || err);
    return false;
  }
}

/**
 * Minimalne kliknięcie cookies bez markowania (czasem FB blokuje atrybuty).
 */
async function acceptCookiesIfPresent(page) {
  try {
    await sleepRandom(250, 650);

    const clicked = await page.evaluate(() => {
      const wanted = [
        "Zezwòl na wszystkie pliki cookie",
        "Zezwól na wszystkie pliki cookie",
        "Zezwòl na wszystkie pliki",
        "Zezwól na wszystkie pliki",
        "Allow all cookies",
        "Accept all cookies",
        "Akceptuj wszystkie",
      ].map((x) => x.toLowerCase());

      const btns = Array.from(
        document.querySelectorAll("button, [role='button']")
      );

      for (const b of btns) {
        const t = (b.innerText || b.textContent || "").trim();
        if (!t) continue;
        const low = t.toLowerCase();
        if (wanted.some((w) => low.includes(w))) {
          b.click();
          return true;
        }
      }
      return false;
    });

    if (clicked) {
      console.log("[FB][cookies] Kliknięto accept cookies (fallback).");
      await sleepRandom(500, 1100);
    }
    return !!clicked;
  } catch {
    return false;
  }
}

/**
 * Pomocnik: wpisz login/hasło + kliknij login. Best-effort.
 */
async function fillLoginFormBestEffort(page) {
  const email = process.env.FB_EMAIL || "";
  const password = process.env.FB_PASSWORD || "";

  if (!email || !password) {
    console.log("[FB][login] Brak FB_EMAIL / FB_PASSWORD – pomijam login.");
    return false;
  }

  const emailSel = [
    "input#email",
    "input[name='email']",
    "input[name='email_or_phone']",
    "input[type='text']",
  ].join(",");

  const passSel = [
    "input#pass",
    "input[name='pass']",
    "input[type='password']",
  ].join(",");

  const emailInput = await page.$(emailSel).catch(() => null);
  const passInput = await page.$(passSel).catch(() => null);

  if (!emailInput || !passInput) {
    console.log("[FB][login] Brak pól email/hasło na stronie login.");
    return false;
  }

  console.log("[FB][login] Wpisuję email i hasło...");

  await emailInput.click({ clickCount: 3 }).catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  await emailInput.type(email, { delay: 35 }).catch(() => {});

  await passInput.click({ clickCount: 3 }).catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  await passInput.type(password, { delay: 35 }).catch(() => {});

  const loginButton =
    (await page.$('button[name="login"]')) ||
    (await page.$('button[type="submit"]')) ||
    (await page.$('div[role="button"][tabindex="0"]')) ||
    (await page.$("button")) ||
    null;

  if (!loginButton) {
    console.log("[FB][login] Brak przycisku logowania – kończę próbę.");
    return false;
  }

  console.log("[FB][login] Klikam logowanie…");

  await Promise.all([
    loginButton.click().catch(() => {}),
    page
      .waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 })
      .catch(() => {}),
  ]);

  await sleepRandom(1400, 2400);
  return true;
}

/**
 * Próba logowania na dowolnym widocznym formularzu (z lokalnej wersji),
 * ale z lekkimi ulepszeniami i bez crashy.
 */
async function loginViaVisibleForm(page, context = "visible-form") {
  try {
    console.log(`[FB][login-form] Szukam formularza logowania (${context})...`);

    await acceptLoginCookies(page).catch(() => {});
    await acceptCookiesIfPresent(page).catch(() => {});

    const emailSelector = [
      "input#email",
      "input[name='email']",
      "input[name='email_or_phone']",
      "input[aria-label*='Adres e-mail']",
      "input[placeholder*='Adres e-mail']",
      "input[placeholder*='adres e-mail']",
      "input[placeholder*='Email']",
      "input[placeholder*='email']",
      "input[type='text']",
    ].join(",");

    const passSelector = [
      "input#pass",
      "input[name='pass']",
      "input[aria-label*='Hasło']",
      "input[placeholder*='Hasło']",
      "input[placeholder*='hasło']",
      "input[placeholder*='Password']",
      "input[placeholder*='password']",
      "input[type='password']",
    ].join(",");

    const emailInput = await page.$(emailSelector).catch(() => null);
    const passInput = await page.$(passSelector).catch(() => null);

    if (!emailInput || !passInput) {
      console.log(
        "[FB][login-form] Brak pełnego formularza (email + hasło) na stronie."
      );
      return false;
    }

    const ok = await fillLoginFormBestEffort(page);
    if (!ok) return false;

    console.log("[FB][login-form] Formularz logowania wysłany.");
    return true;
  } catch (err) {
    console.error("[FB][login-form] Błąd (ignorowany):", err?.message || err);
    return false;
  }
}

/**
 * Główne logowanie – NAJSTABILNIEJSZE: login.php?next=<URL>
 * Param nextUrl: URL posta, do którego FB ma wrócić po loginie.
 */
async function fbLogin(page, nextUrl = "") {
  try {
    console.log("[FB][login] Start logowania (best-effort)");

    const next = nextUrl ? `?next=${encodeURIComponent(nextUrl)}` : "";
    const url = `https://www.facebook.com/login.php${next}`;

    await page
      .goto(url, { waitUntil: "networkidle2", timeout: 60000 })
      .catch(() => {});

    await sleepRandom(900, 1400);

    // cookies – dwie metody (mark+click oraz szybki fallback)
    await acceptLoginCookies(page).catch(() => {});
    await acceptCookiesIfPresent(page).catch(() => {});

    const ok = await fillLoginFormBestEffort(page);
    if (!ok) return false;

    // FB czasem zostaje na tej samej stronie – dodatkowa pauza
    await sleepRandom(1200, 2000);

    return true;
  } catch (e) {
    console.log("[FB][login] Błąd (ignorowany):", e?.message || e);
    return false;
  }
}

/**
 * Heurystyczny check sesji (jak serwer).
 */
async function checkIfLogged(page) {
  try {
    return await page.evaluate(() => {
      return !!(
        document.querySelector('input[aria-label*="Szukaj"]') ||
        document.querySelector('input[placeholder*="Szukaj"]') ||
        document.querySelector('a[aria-label*="Profil"]') ||
        document.querySelector('div[aria-label*="Konto"]')
      );
    });
  } catch {
    return false;
  }
}

/**
 * Kliknięcie elementu po dokładnym tekście (lokalny helper).
 */
async function clickByText(page, text) {
  const res = await page.evaluate((label) => {
    const els = Array.from(
      document.querySelectorAll("button, a, div[role='button'], span[role='button']")
    );
    const lowLabel = String(label || "").toLowerCase();
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
 * Heurystyka login-wall (serwerowa).
 * Uwaga: "Log In" czasem jest widoczne mimo, że da się czytać komentarze,
 * więc to powinno odpalać się dopiero gdy UI nie potrafi odczytać danych.
 */
async function looksLikeLoginWall(page) {
  try {
    return await page.evaluate(() => {
      const txt = (document.body?.innerText || "").toLowerCase();
      if (!txt) return false;

      const hasLoginWords =
        txt.includes("log in") ||
        txt.includes("sign up") ||
        txt.includes("create new account") ||
        txt.includes("zaloguj") ||
        txt.includes("zarejestruj");

      if (!hasLoginWords) return false;

      const hasLoginForm =
        !!document.querySelector("input[type='password']") ||
        !!document.querySelector("input#email") ||
        !!document.querySelector("input[name='email']");

      const hasPostWords =
        txt.includes("comment") ||
        txt.includes("comments") ||
        txt.includes("komentarz") ||
        txt.includes("lubię to") ||
        txt.includes("like") ||
        txt.includes("reply") ||
        txt.includes("replied");

      return hasLoginForm || (hasLoginWords && !hasPostWords);
    });
  } catch {
    return false;
  }
}

/**
 * Główny „włącznik” do użycia w UI handlerach:
 * - jeśli wygląda na login-wall -> login.php?next -> wróć na post
 * - fallback: próba loginViaVisibleForm (gdyby FB zrobił overlay)
 *
 * Param postUrl: najlepiej podać URL posta (żeby next= działało idealnie)
 */
async function ensureLoggedInOnPostOverlay(page, postUrl = "") {
  try {
    const cur = page.url();
    const target = postUrl || cur;

    const wall = await looksLikeLoginWall(page);
    if (!wall) return false;

    console.log(
      "[FB][login] Wykryto login-wall -> login.php?next i próba logowania."
    );

    const tried = await fbLogin(page, target);

    let logged = await checkIfLogged(page);
    console.log("[FB][login] session after fbLogin:", logged ? "YES" : "NO");

    // jeśli FB nie przerzucił automatycznie, wróć na post
    if (target && norm(page.url()) !== norm(target)) {
      await page
        .goto(target, { waitUntil: "networkidle2", timeout: 60000 })
        .catch(() => {});
      await sleepRandom(900, 1400);
    }

    // jeszcze raz sprawdź sesję po powrocie
    logged = await checkIfLogged(page);

    // fallback: gdyby FB nadal siedział na overlayu, spróbuj visible-form
    if (!logged) {
      const usedInline = await loginViaVisibleForm(page, "post-overlay-inline");
      if (usedInline) {
        logged = await checkIfLogged(page);
        console.log(
          "[FB][login] session after loginViaVisibleForm:",
          logged ? "YES" : "NO"
        );
      }
    }

    return tried && logged;
  } catch (e) {
    console.log(
      "[FB][login] ensureLoggedInOnPostOverlay error (ignored):",
      e?.message || e
    );
    return false;
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
