import { sleepRandom } from "../utils/sleep.js";

async function fbLogin(page) {
  console.log("[FB] Trwa logowanie...");

  await page.goto("https://www.facebook.com/login", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  await page.waitForSelector("#email", { timeout: 60000 });

  await page.type("#email", process.env.FB_EMAIL || "", { delay: 60 });
  await page.type("#pass", process.env.FB_PASSWORD || "", { delay: 60 });

  await Promise.all([
    page.click('button[name="login"]'),
    page
      .waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 })
      .catch(() => {}),
  ]);

  console.log("[FB] Po logowaniu:", page.url());
}

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

async function ensureLoggedInOnPostOverlay(page) {
  // Sprawdzamy, czy jest nakładka typu "Wyświetl więcej na Facebooku"
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

  // Najpierw spróbuj PL
  let clicked = await clickByText(page, "Zaloguj się");
  if (!clicked) {
    // potem EN jako fallback
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

export { fbLogin, checkIfLogged, ensureLoggedInOnPostOverlay, clickByText };
