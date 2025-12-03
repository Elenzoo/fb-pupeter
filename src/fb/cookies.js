// src/fb/cookies.js
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { sleepRandom } from "../utils/sleep.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// cookies.json trzymamy w katalogu, z którego odpalasz `node src/index.js`
const COOKIES_PATH = path.join(process.cwd(), "cookies.json");

/**
 * Wczytywanie cookies z pliku cookies.json
 */
export async function loadCookies(page) {
  try {
    const raw = await fs.readFile(COOKIES_PATH, "utf-8");
    const cookies = JSON.parse(raw);

    if (!Array.isArray(cookies) || cookies.length === 0) {
      console.log("[FB][cookies] Plik cookies.json jest pusty – pomijam.");
      return;
    }

    await page.setCookie(...cookies);
    console.log("[FB][cookies] Załadowano zapisane cookies.");
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log("[FB][cookies] Brak pliku cookies.json – pomijam.");
    } else if (err instanceof SyntaxError) {
      console.log(
        "[FB][cookies] Plik cookies.json ma zły format (JSON). Zacznę od zera."
      );
    } else {
      console.error(
        "[FB][cookies] Błąd przy wczytywaniu cookies:",
        err.message
      );
    }
  }
}

/**
 * Zapis cookies do cookies.json po udanym logowaniu
 */
export async function saveCookies(page) {
  try {
    const cookies = await page.cookies();
    await fs.writeFile(
      COOKIES_PATH,
      JSON.stringify(cookies, null, 2),
      "utf-8"
    );
    console.log("[FB][cookies] Cookies zapisane.");
  } catch (err) {
    console.error("[FB][cookies] Błąd przy zapisie cookies:", err.message);
  }
}

/**
 * OGARNIACZ COOKIES – wersja bazująca na starym działającym kodzie:
 * - prosty DOM (button, [role='button']),
 * - szukamy w KAŻDYM frame,
 * - najpierw dokładne dopasowanie tekstu, potem fallback na „pliki cookie”.
 *
 * `context` jest tylko labelką w logach: np. "login", "post-initial", "post".
 */
export async function acceptCookies(page, context = "generic") {
  console.log(`[FB][cookies-${context}] Sprawdzanie popupu cookies…`);

  // Mały, "ludzki" delay, żeby overlay zdążył się pojawić
  await sleepRandom(1500, 3000);

  const LABELS = [
    "Zezwól na wszystkie pliki cookie",
    "Zezwól na wszystkie pliki cookie w tej przeglądarce",
    "Zezwól na wszystkie",
    "Akceptuj wszystkie",
    "Akceptuj wszystkie pliki cookie",
    "Allow all cookies",
    "Accept all cookies",
    "Allow all",
    "Accept all",
  ];

  let anyClicked = false;
  const debugSamples = [];

  const frames = page.frames();

  for (const frame of frames) {
    try {
      const res = await frame.evaluate((LABELS) => {
        const buttons = Array.from(
          document.querySelectorAll("button, [role='button']")
        );

        const texts = buttons
          .map((el) => (el.innerText || el.textContent || "").trim())
          .filter(Boolean);

        let target = null;

        // 1) Dokładne dopasowanie do znanych labeli
        outer: for (const el of buttons) {
          const txt = (el.innerText || el.textContent || "").trim();
          if (!txt) continue;

          for (const lab of LABELS) {
            if (txt.toLowerCase() === lab.toLowerCase()) {
              target = el;
              break outer;
            }
          }
        }

        // 2) Fallback – cokolwiek z "pliki cookie" / "cookies"
        if (!target) {
          for (const el of buttons) {
            const txt = (el.innerText || el.textContent || "")
              .trim()
              .toLowerCase();
            if (!txt) continue;
            if (txt.includes("pliki cookie") || txt.includes("cookies")) {
              target = el;
              break;
            }
          }
        }

        if (!target) {
          return { clicked: false, sample: texts.slice(0, 25) };
        }

        // Klikamy znaleziony przycisk
        target.click();
        const label = (target.innerText || target.textContent || "").trim();
        return { clicked: true, sample: [label] };
      }, LABELS);

      if (res.clicked) {
        anyClicked = true;
        console.log(
          `[FB][cookies-${context}] Kliknięto przycisk cookies w frame; tekst:`,
          res.sample[0]
        );
        break; // już nie szukamy dalej
      } else if (res.sample && res.sample.length) {
        debugSamples.push({
          frameUrl: frame.url(),
          texts: res.sample,
        });
      }
    } catch (err) {
      console.log(
        `[FB][cookies-${context}] Błąd przy obsłudze cookies w frame ${frame.url()}:`,
        err.message
      );
    }
  }

  if (!anyClicked) {
    console.log(
      `[FB][cookies-${context}] Nie znaleziono przycisku cookies w żadnym frame.`,
      "Próbki tekstów:",
      debugSamples
    );
  } else {
    // Dajemy overlayowi czas na zniknięcie
    await sleepRandom(1500, 2500);
  }
}
