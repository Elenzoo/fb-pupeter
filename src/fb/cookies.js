import fs from "fs/promises";
import { sleepRandom } from "../utils/sleep.js";

async function loadCookies(page) {
  try {
    const raw = await fs.readFile("cookies.json", "utf8");
    const cookies = JSON.parse(raw);
    if (Array.isArray(cookies) && cookies.length) {
      await page.setCookie(...cookies);
      console.log("[FB][cookies] Załadowano zapisane cookies.");
    }
  } catch {
    console.log("[FB][cookies] Brak zapisanych cookies – logowanie od zera.");
  }
}

async function saveCookies(page) {
  try {
    const cookies = await page.cookies();
    await fs.writeFile(
      "cookies.json",
      JSON.stringify(cookies, null, 2),
      "utf8"
    );
    console.log("[FB][cookies] Cookies zapisane.");
  } catch (e) {
    console.error("[FB][cookies] Błąd zapisu cookies:", e.message);
  }
}

async function acceptCookies(page, label) {
  console.log(`[FB][cookies-${label}] Sprawdzanie pop-up cookies...`);
  await sleepRandom(1500, 3000);

  const result = await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll("button, div[role='button']")
    );
    const labels = [
      "Zezwól na wszystkie pliki cookie",
      "Odrzuć opcjonalne pliki cookie",
      "Allow all cookies",
      "Decline optional cookies",
    ];
    const texts = buttons
      .map((el) => (el.innerText || "").trim())
      .filter(Boolean);

    let target = null;

    outer: for (const el of buttons) {
      const txt = (el.innerText || "").trim();
      if (!txt) continue;
      for (const lab of labels) {
        if (txt.toLowerCase() === lab.toLowerCase()) {
          target = el;
          break outer;
        }
      }
    }

    if (!target) {
      for (const el of buttons) {
        const txt = (el.innerText || "").trim().toLowerCase();
        if (!txt) continue;
        if (txt.includes("pliki cookie") || txt.includes("cookies")) {
          target = el;
          break;
        }
      }
    }

    if (!target) {
      return { clicked: false, texts };
    }

    target.click();
    return { clicked: true, texts };
  });

  if (result.clicked) {
    console.log(`[FB][cookies-${label}] Kliknięto przycisk akceptacji cookies.`);
    await sleepRandom(1500, 2500);
  } else {
    console.log(
      `[FB][cookies-${label}] Nie znaleziono przycisku cookies. Teksty na przyciskach:`,
      result.texts
    );
  }
}

export { loadCookies, saveCookies, acceptCookies };
