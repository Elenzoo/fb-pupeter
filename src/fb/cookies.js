// src/fb/cookies.js
import fs from "fs/promises";
import { sleepRandom } from "../utils/sleep.js";

/**
 * Ładowanie cookies z pliku cookies.json i wstrzyknięcie do strony.
 */
async function loadCookies(page) {
  try {
    const raw = await fs.readFile("cookies.json", "utf8");
    const cookies = JSON.parse(raw);

    if (Array.isArray(cookies) && cookies.length) {
      await page.setCookie(...cookies);
      console.log("[FB][cookies] Załadowano zapisane cookies (cookies.json).");
    } else {
      console.log(
        "[FB][cookies] cookies.json istnieje, ale nie zawiera poprawnej tablicy cookies."
      );
    }
  } catch (err) {
    console.log(
      "[FB][cookies] Brak zapisanych cookies lub błąd odczytu – logowanie od zera.",
      err?.message || err
    );
  }
}

/**
 * Zapisuje aktualne cookies z przeglądarki do pliku cookies.json
 * w katalogu roboczym procesu (tam, skąd odpalasz node).
 */
async function saveCookies(page) {
  try {
    const cookies = await page.cookies();

    if (!Array.isArray(cookies) || cookies.length === 0) {
      console.log(
        "[FB][cookies] Brak cookies do zapisania – tablica pusta (prawdopodobnie niezalogowany?)."
      );
      return;
    }

    const json = JSON.stringify(cookies, null, 2);
    await fs.writeFile("cookies.json", json, "utf8");

    console.log(
      `[FB][cookies] Zapisano ${cookies.length} cookies do cookies.json.`
    );
  } catch (err) {
    console.error(
      "[FB][cookies] Błąd przy zapisie cookies do cookies.json:",
      err?.message || err
    );
  }
}

/**
 * Ogólne akceptowanie popupu cookies na FB (np. na postach).
 * label – tylko do logów (np. 'post', 'post-initial', 'login', itd.).
 */
async function acceptCookies(page, label = "global") {
  try {
    // chwila na pojawienie się popupu
    await sleepRandom(800, 1500);

    const result = await page.evaluate(() => {
      const wanted = [
        "zezwól na wszystkie pliki cookie",
        "zezwól na wszystkie pliki",
        "akceptuj wszystkie pliki cookie",
        "akceptuj wszystkie",
        "allow all cookies",
        "accept all cookies",
        "accept essential and optional cookies",
        "tylko niezbędne pliki cookie",
        "odrzuć opcjonalne pliki cookie",
      ].map((t) => t.toLowerCase());

      const buttons = Array.from(
        document.querySelectorAll("button, [role='button']")
      );

      let clicked = false;
      const texts = [];

      for (const btn of buttons) {
        const txt = (btn.innerText || btn.textContent || "").trim();
        if (!txt) continue;

        const low = txt.toLowerCase();
        texts.push(txt);

        if (wanted.some((w) => low.includes(w))) {
          btn.click();
          clicked = true;
          break;
        }
      }

      return { clicked, texts };
    });

    if (result.clicked) {
      console.log(
        `[FB][cookies-${label}] Kliknięto przycisk akceptacji cookies.`
      );
      await sleepRandom(1500, 2500);
    } else {
      console.log(
        `[FB][cookies-${label}] Nie znaleziono przycisku cookies. Teksty na przyciskach:`,
        result.texts
      );
    }
  } catch (err) {
    console.log(
      `[FB][cookies-${label}] Błąd przy obsłudze popupu cookies:`,
      err?.message || err
    );
  }
}

export { loadCookies, saveCookies, acceptCookies };
