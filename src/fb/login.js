// src/fb/login.js
import { sleepRandom, humanType } from "../utils/sleep.js";
import log from "../utils/logger.js";
import { CAPTCHA_ENABLED, CAPTCHA_API_KEY } from "../config.js";

/**
 * Diagnozuje typ captcha na stronie
 * @param {import('puppeteer').Page} page
 * @returns {Promise<{type: string, details: object}>}
 */
async function diagnoseCaptchaType(page) {
  log.prod("CAPTCHA", "=== DIAGNOSTYKA TYPU CAPTCHA ===");

  const frames = page.frames();
  log.prod("CAPTCHA", `Liczba frames: ${frames.length}`);

  const diagnosis = {
    type: "unknown",
    details: {
      frames: [],
      pageIndicators: [],
      sitekey: null,
      publicKey: null,
    }
  };

  // Sprawdź wszystkie frames
  for (const frame of frames) {
    try {
      const url = frame.url();
      if (!url || url === "about:blank") continue;

      const frameInfo = { url: url.substring(0, 120) };

      // FunCaptcha / Arkose Labs
      if (url.includes("arkoselabs") || url.includes("funcaptcha")) {
        diagnosis.type = "funcaptcha";
        frameInfo.type = "funcaptcha";

        // Wyciągnij public key z URL
        const pkMatch = url.match(/[?&]pk=([^&]+)/);
        if (pkMatch) {
          diagnosis.details.publicKey = pkMatch[1];
          frameInfo.publicKey = pkMatch[1];
        }
      }
      // reCAPTCHA
      else if (url.includes("recaptcha") || url.includes("google.com/recaptcha")) {
        diagnosis.type = diagnosis.type === "unknown" ? "recaptcha" : diagnosis.type;
        frameInfo.type = "recaptcha";

        if (url.includes("/enterprise/")) {
          frameInfo.enterprise = true;
        }

        const keyMatch = url.match(/[?&]k=([^&]+)/);
        if (keyMatch) {
          diagnosis.details.sitekey = keyMatch[1];
          frameInfo.sitekey = keyMatch[1];
        }
      }
      // hCaptcha
      else if (url.includes("hcaptcha")) {
        diagnosis.type = diagnosis.type === "unknown" ? "hcaptcha" : diagnosis.type;
        frameInfo.type = "hcaptcha";
      }

      if (frameInfo.type) {
        diagnosis.details.frames.push(frameInfo);
        log.prod("CAPTCHA", `Frame: ${frameInfo.type} - ${url.substring(0, 80)}...`);
      }
    } catch {
      // Ignoruj błędy
    }
  }

  // Sprawdź elementy na głównej stronie + użyj skryptu 2Captcha do wykrywania reCAPTCHA
  const pageCheck = await page.evaluate(() => {
    const indicators = [];

    // FunCaptcha / Arkose Labs
    if (document.querySelector('#FunCaptcha, [data-callback*="funcaptcha"], iframe[src*="arkoselabs"]')) {
      indicators.push("funcaptcha_element");
    }

    // Szukaj enforcement script (Arkose)
    const scripts = Array.from(document.querySelectorAll('script[src]'));
    for (const s of scripts) {
      if (s.src.includes('arkoselabs') || s.src.includes('funcaptcha')) {
        indicators.push(`arkose_script: ${s.src.substring(0, 60)}`);
      }
    }

    // Szukaj data-callback z arkose
    const arkoseDiv = document.querySelector('[data-callback]');
    if (arkoseDiv) {
      indicators.push(`data-callback: ${arkoseDiv.getAttribute('data-callback')}`);
    }

    // reCAPTCHA - element na stronie
    if (document.querySelector('.g-recaptcha, [data-sitekey]')) {
      indicators.push("recaptcha_element");
      const sitekey = document.querySelector('[data-sitekey]')?.getAttribute('data-sitekey');
      if (sitekey) indicators.push(`sitekey: ${sitekey.substring(0, 20)}...`);
    }

    // === SKRYPT 2CAPTCHA - wykrywanie reCAPTCHA clients ===
    // eslint-disable-next-line camelcase
    if (typeof ___grecaptcha_cfg !== 'undefined') {
      try {
        // eslint-disable-next-line camelcase, no-undef
        const clients = Object.entries(___grecaptcha_cfg.clients).map(([cid, client]) => {
          const data = { id: cid, version: cid >= 10000 ? 'V3' : 'V2' };
          const objects = Object.entries(client).filter(([_, value]) => value && typeof value === 'object');

          objects.forEach(([toplevelKey, toplevel]) => {
            const found = Object.entries(toplevel).find(([_, value]) => (
              value && typeof value === 'object' && 'sitekey' in value && 'size' in value
            ));

            if (typeof toplevel === 'object' && toplevel instanceof HTMLElement && toplevel['tagName'] === 'DIV') {
              data.pageurl = toplevel.baseURI;
            }

            if (found) {
              const [sublevelKey, sublevel] = found;
              data.sitekey = sublevel.sitekey;
              const callbackKey = data.version === 'V2' ? 'callback' : 'promise-callback';
              const callback = sublevel[callbackKey];
              if (callback) {
                const keys = [cid, toplevelKey, sublevelKey, callbackKey].map((key) => `['${key}']`).join('');
                data.callback = `___grecaptcha_cfg.clients${keys}`;
              }
            }
          });
          return data;
        });

        if (clients.length > 0) {
          indicators.push(`grecaptcha_clients: ${JSON.stringify(clients)}`);
        }
      } catch (e) {
        indicators.push(`grecaptcha_error: ${e.message}`);
      }
    }

    // Tekst na stronie
    const bodyText = (document.body?.innerText || '').toLowerCase();
    if (bodyText.includes('arkose') || bodyText.includes('funcaptcha')) {
      indicators.push("arkose_text");
    }

    return indicators;
  });

  diagnosis.details.pageIndicators = pageCheck;
  if (pageCheck.length > 0) {
    log.prod("CAPTCHA", `Wskaźniki na stronie: ${pageCheck.join(', ')}`);
  }

  // Jeśli znaleziono funcaptcha, ustaw typ
  if (pageCheck.some(i => i.includes("funcaptcha") || i.includes("arkose"))) {
    diagnosis.type = "funcaptcha";
  }

  // Parsuj dane z grecaptcha_clients (skrypt 2Captcha)
  const grecaptchaMatch = pageCheck.find(i => i.startsWith("grecaptcha_clients:"));
  if (grecaptchaMatch) {
    try {
      const jsonStr = grecaptchaMatch.replace("grecaptcha_clients: ", "");
      const clients = JSON.parse(jsonStr);
      if (clients.length > 0) {
        diagnosis.type = "recaptcha";
        diagnosis.details.grecaptchaClients = clients;
        // Użyj pierwszego klienta z sitekey
        const clientWithSitekey = clients.find(c => c.sitekey);
        if (clientWithSitekey) {
          diagnosis.details.sitekey = clientWithSitekey.sitekey;
          diagnosis.details.callback = clientWithSitekey.callback;
          diagnosis.details.version = clientWithSitekey.version;
          log.prod("CAPTCHA", `Znaleziono reCAPTCHA ${clientWithSitekey.version} przez ___grecaptcha_cfg`);
          log.prod("CAPTCHA", `Sitekey: ${clientWithSitekey.sitekey?.substring(0, 20)}...`);
          if (clientWithSitekey.callback) {
            log.prod("CAPTCHA", `Callback: ${clientWithSitekey.callback}`);
          }
        }
      }
    } catch (e) {
      log.debug("CAPTCHA", `Błąd parsowania grecaptcha_clients: ${e.message}`);
    }
  }

  log.prod("CAPTCHA", `=== WYKRYTY TYP: ${diagnosis.type.toUpperCase()} ===`);

  return diagnosis;
}

/**
 * Rozwiązuje FunCaptcha/Arkose Labs przez 2Captcha API
 * @param {string} publicKey - klucz publiczny Arkose (parametr pk= z URL)
 * @param {string} pageUrl - URL strony z captcha
 * @param {string} surl - opcjonalny service URL
 * @returns {Promise<{ok: boolean, token?: string, error?: string}>}
 */
async function solveFunCaptchaViaApi(publicKey, pageUrl, surl = null) {
  if (!CAPTCHA_API_KEY || !publicKey) {
    return { ok: false, error: "missing_params" };
  }

  log.prod("CAPTCHA", `Wysyłam FunCaptcha do 2Captcha (publicKey: ${publicKey.substring(0, 15)}...)`);

  try {
    const createTaskPayload = {
      clientKey: CAPTCHA_API_KEY,
      task: {
        type: "FunCaptchaTaskProxyless",
        websiteURL: pageUrl,
        websitePublicKey: publicKey,
      },
    };

    // Dodaj service URL jeśli podany
    if (surl) {
      createTaskPayload.task.funcaptchaApiJSSubdomain = surl;
    }

    log.debug("CAPTCHA", `Payload: ${JSON.stringify(createTaskPayload).substring(0, 200)}`);

    const createRes = await fetch("https://api.2captcha.com/createTask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createTaskPayload),
    });
    const createData = await createRes.json();

    if (createData.errorId !== 0) {
      log.error("CAPTCHA", `Błąd createTask: ${createData.errorCode} - ${createData.errorDescription}`);
      return { ok: false, error: createData.errorCode || createData.errorDescription };
    }

    const taskId = createData.taskId;
    log.dev("CAPTCHA", `FunCaptcha Task ID: ${taskId} - czekam na rozwiązanie...`);

    // Polling - max 180 sekund
    const maxAttempts = 36;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 5000));

      const resultRes = await fetch("https://api.2captcha.com/getTaskResult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientKey: CAPTCHA_API_KEY,
          taskId: taskId,
        }),
      });
      const resultData = await resultRes.json();

      if (resultData.errorId !== 0) {
        log.error("CAPTCHA", `Błąd getTaskResult: ${resultData.errorCode}`);
        return { ok: false, error: resultData.errorCode };
      }

      if (resultData.status === "ready") {
        const token = resultData.solution?.token;
        if (token) {
          log.success("CAPTCHA", `FunCaptcha rozwiązana! (próba ${i + 1})`);
          return { ok: true, token };
        }
        log.error("CAPTCHA", "Brak tokenu w odpowiedzi FunCaptcha");
        return { ok: false, error: "no_token" };
      }

      log.debug("CAPTCHA", `Czekam na FunCaptcha... (${i + 1}/${maxAttempts})`);
    }

    return { ok: false, error: "timeout" };
  } catch (err) {
    log.error("CAPTCHA", `Błąd FunCaptcha API: ${err?.message}`);
    return { ok: false, error: err?.message };
  }
}

/**
 * Rozwiązuje reCAPTCHA Enterprise przez API v2 2Captcha (createTask)
 * @param {string} sitekey - klucz witryny reCAPTCHA (parametr k= z URL)
 * @param {string} pageUrl - URL strony z captcha
 * @param {object} options - dodatkowe opcje
 * @param {boolean} options.isInvisible - czy to invisible captcha (domyślnie false)
 * @param {boolean} options.isEnterprise - czy to Enterprise captcha (domyślnie true)
 * @param {string} options.dataS - parametr data-s ze strony (dla Enterprise)
 * @returns {Promise<{ok: boolean, token?: string, error?: string}>}
 */
async function solveRecaptchaViaApi(sitekey, pageUrl, options = {}) {
  const { isInvisible = false, isEnterprise = true, dataS = null } = options;

  if (!CAPTCHA_API_KEY || !sitekey) {
    return { ok: false, error: "missing_params" };
  }

  log.prod("CAPTCHA", `Wysyłam do 2Captcha API v2 (sitekey: ${sitekey.substring(0, 10)}..., enterprise: ${isEnterprise}, dataS: ${dataS ? 'tak' : 'nie'})`);

  try {
    // 1. Wyślij zadanie do 2Captcha (API v2)
    const taskType = isEnterprise
      ? "RecaptchaV2EnterpriseTaskProxyless"
      : "RecaptchaV2TaskProxyless";

    const createTaskPayload = {
      clientKey: CAPTCHA_API_KEY,
      task: {
        type: taskType,
        websiteURL: pageUrl,
        websiteKey: sitekey,
        isInvisible: isInvisible,
        // FB używa własnej domeny dla reCAPTCHA
        apiDomain: "www.recaptcha.net",
      },
    };

    // Dodaj enterprisePayload jeśli mamy data-s
    if (isEnterprise && dataS) {
      createTaskPayload.task.enterprisePayload = { s: dataS };
      log.debug("CAPTCHA", `Dodano enterprisePayload.s: ${dataS.substring(0, 30)}...`);
    }

    log.debug("CAPTCHA", `Typ zadania: ${taskType}`);

    const createRes = await fetch("https://api.2captcha.com/createTask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createTaskPayload),
    });
    const createData = await createRes.json();

    if (createData.errorId !== 0) {
      log.error("CAPTCHA", `Błąd createTask: ${createData.errorCode} - ${createData.errorDescription}`);
      return { ok: false, error: createData.errorCode || createData.errorDescription };
    }

    const taskId = createData.taskId;
    log.dev("CAPTCHA", `Task ID: ${taskId} - czekam na rozwiązanie...`);

    // 2. Polling - czekaj na rozwiązanie (max 180 sekund dla Enterprise)
    const maxAttempts = 36; // 36 * 5s = 180s
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 5000)); // czekaj 5 sekund

      const resultRes = await fetch("https://api.2captcha.com/getTaskResult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientKey: CAPTCHA_API_KEY,
          taskId: taskId,
        }),
      });
      const resultData = await resultRes.json();

      if (resultData.errorId !== 0) {
        log.error("CAPTCHA", `Błąd getTaskResult: ${resultData.errorCode}`);
        return { ok: false, error: resultData.errorCode };
      }

      if (resultData.status === "ready") {
        const token = resultData.solution?.gRecaptchaResponse;
        if (token) {
          log.success("CAPTCHA", `Rozwiązano! (próba ${i + 1})`);
          return { ok: true, token };
        }
        log.error("CAPTCHA", "Brak tokenu w odpowiedzi");
        return { ok: false, error: "no_token" };
      }

      log.debug("CAPTCHA", `Czekam... (${i + 1}/${maxAttempts})`);
    }

    return { ok: false, error: "timeout" };
  } catch (err) {
    log.error("CAPTCHA", `Błąd API: ${err?.message}`);
    return { ok: false, error: err?.message };
  }
}

/**
 * Rozwiązuje reCAPTCHA z siatką obrazków przez GridTask (2Captcha)
 * Zamiast generować token, klika fizycznie w kwadraty wskazane przez pracowników.
 *
 * @param {Page} page - Puppeteer page
 * @returns {Promise<{ok: boolean, clicked?: number[], error?: string}>}
 */
async function solveGridCaptcha(page) {
  if (!CAPTCHA_API_KEY) {
    return { ok: false, error: "missing_api_key" };
  }

  log.prod("CAPTCHA", "=== GRID CAPTCHA SOLVER ===");

  try {
    // 1. Znajdź iframe z siatką obrazków (bframe)
    const frames = page.frames();
    let gridFrame = null;
    let gridFrameUrl = null;

    for (const frame of frames) {
      const url = frame.url();
      if (url.includes('recaptcha') && url.includes('bframe')) {
        gridFrame = frame;
        gridFrameUrl = url;
        log.dev("CAPTCHA", `Znaleziono bframe: ${url.substring(0, 80)}...`);
        break;
      }
    }

    if (!gridFrame) {
      log.warn("CAPTCHA", "Nie znaleziono iframe z siatką obrazków");
      return { ok: false, error: "no_grid_frame" };
    }

    // 2. Poczekaj na załadowanie siatki
    await sleepRandom(1500, 2500);

    // 3. Wyciągnij instrukcję (np. "Wybierz wszystkie kwadraty z przejściami dla pieszych")
    let instruction = "";
    try {
      instruction = await gridFrame.evaluate(() => {
        // Szukaj instrukcji w różnych miejscach
        const selectors = [
          '.rc-imageselect-desc-wrapper',
          '.rc-imageselect-desc',
          '.rc-imageselect-instructions',
          'strong',
          '.rc-imageselect-desc-no-canonical'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent.trim()) {
            return el.textContent.trim();
          }
        }
        return "";
      });
      log.prod("CAPTCHA", `Instrukcja: "${instruction.substring(0, 60)}..."`);
    } catch (err) {
      log.warn("CAPTCHA", `Nie można wyciągnąć instrukcji: ${err?.message}`);
    }

    // Przetłumacz instrukcję na angielski dla 2Captcha (pracownicy lepiej rozumieją)
    const instructionEn = translateInstruction(instruction);
    log.dev("CAPTCHA", `Instrukcja EN: "${instructionEn}"`);

    // 4. Zrób screenshot siatki obrazków
    let screenshotBase64 = null;
    try {
      // Znajdź element z siatką
      const gridElement = await gridFrame.$('.rc-imageselect-challenge, .rc-imageselect-table-33, .rc-imageselect-table-44, .rc-imageselect');

      if (gridElement) {
        const screenshotBuffer = await gridElement.screenshot({ encoding: 'base64' });
        screenshotBase64 = screenshotBuffer;
        log.prod("CAPTCHA", `Screenshot siatki: ${(screenshotBase64.length / 1024).toFixed(1)}KB`);
      } else {
        // Fallback - screenshot całego iframe
        const frameElement = await page.$('iframe[src*="bframe"]');
        if (frameElement) {
          const screenshotBuffer = await frameElement.screenshot({ encoding: 'base64' });
          screenshotBase64 = screenshotBuffer;
          log.prod("CAPTCHA", `Screenshot iframe: ${(screenshotBase64.length / 1024).toFixed(1)}KB`);
        }
      }
    } catch (err) {
      log.error("CAPTCHA", `Błąd screenshot: ${err?.message}`);
      return { ok: false, error: "screenshot_failed" };
    }

    if (!screenshotBase64) {
      return { ok: false, error: "no_screenshot" };
    }

    // 5. Sprawdź rozmiar siatki (3x3 lub 4x4)
    let gridSize = "3x3";
    try {
      gridSize = await gridFrame.evaluate(() => {
        if (document.querySelector('.rc-imageselect-table-44')) return "4x4";
        if (document.querySelector('.rc-imageselect-table-33')) return "3x3";
        // Policz kwadraty
        const tiles = document.querySelectorAll('.rc-imageselect-tile');
        if (tiles.length === 16) return "4x4";
        return "3x3";
      });
      log.dev("CAPTCHA", `Rozmiar siatki: ${gridSize}`);
    } catch {}

    // 6. Wyślij do 2Captcha GridTask
    log.prod("CAPTCHA", "Wysyłam GridTask do 2Captcha...");

    const createTaskPayload = {
      clientKey: CAPTCHA_API_KEY,
      task: {
        type: "GridTask",
        body: screenshotBase64,
        comment: instructionEn || "Select all squares that match the description",
        rows: gridSize === "4x4" ? 4 : 3,
        columns: gridSize === "4x4" ? 4 : 3,
      },
    };

    const createRes = await fetch("https://api.2captcha.com/createTask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createTaskPayload),
    });
    const createData = await createRes.json();

    if (createData.errorId !== 0) {
      log.error("CAPTCHA", `Błąd GridTask: ${createData.errorCode} - ${createData.errorDescription}`);
      return { ok: false, error: createData.errorCode || createData.errorDescription };
    }

    const taskId = createData.taskId;
    log.dev("CAPTCHA", `GridTask ID: ${taskId} - czekam na rozwiązanie...`);

    // 7. Polling - czekaj na rozwiązanie (max 120 sekund)
    const maxAttempts = 24; // 24 * 5s = 120s
    let clickIndices = [];

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 5000));

      const resultRes = await fetch("https://api.2captcha.com/getTaskResult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientKey: CAPTCHA_API_KEY,
          taskId: taskId,
        }),
      });
      const resultData = await resultRes.json();

      if (resultData.errorId !== 0) {
        log.error("CAPTCHA", `Błąd getTaskResult: ${resultData.errorCode}`);
        return { ok: false, error: resultData.errorCode };
      }

      if (resultData.status === "ready") {
        clickIndices = resultData.solution?.click || [];
        log.success("CAPTCHA", `GridTask rozwiązany! Kwadraty: [${clickIndices.join(', ')}]`);
        break;
      }

      log.debug("CAPTCHA", `Czekam na GridTask... (${i + 1}/${maxAttempts})`);
    }

    if (!clickIndices.length) {
      log.warn("CAPTCHA", "Brak kwadratów do kliknięcia (może 'Pomiń'?)");
      // Może trzeba kliknąć "Pomiń" jeśli nie ma pasujących obrazków
      try {
        const skipBtn = await gridFrame.$('.rc-imageselect-incorrect-response, button:has-text("Pomiń"), button:has-text("Skip")');
        if (skipBtn) {
          await skipBtn.click();
          await sleepRandom(1000, 2000);
          return { ok: true, clicked: [], skipped: true };
        }
      } catch {}
      return { ok: false, error: "no_tiles_to_click" };
    }

    // 8. Kliknij wskazane kwadraty
    log.prod("CAPTCHA", `Klikam ${clickIndices.length} kwadratów...`);

    for (const index of clickIndices) {
      try {
        // Indeksy z 2Captcha są 1-based (1 = górny lewy)
        const tileIndex = index - 1; // konwertuj na 0-based

        const clicked = await gridFrame.evaluate((idx) => {
          const tiles = document.querySelectorAll('.rc-imageselect-tile');
          if (tiles[idx]) {
            tiles[idx].click();
            return true;
          }
          // Alternatywny selektor
          const cells = document.querySelectorAll('td.rc-imageselect-tile');
          if (cells[idx]) {
            cells[idx].click();
            return true;
          }
          return false;
        }, tileIndex);

        if (clicked) {
          log.dev("CAPTCHA", `Kliknięto kwadrat ${index}`);
        } else {
          log.warn("CAPTCHA", `Nie znaleziono kwadratu ${index}`);
        }

        // Krótka pauza między kliknięciami (human-like)
        await sleepRandom(200, 500);
      } catch (err) {
        log.warn("CAPTCHA", `Błąd kliknięcia kwadratu ${index}: ${err?.message}`);
      }
    }

    // 9. Kliknij przycisk "Sprawdź" / "Verify"
    await sleepRandom(500, 1000);

    try {
      const verifyBtn = await gridFrame.$('#recaptcha-verify-button, .rc-button-default, button[id*="verify"]');
      if (verifyBtn) {
        log.prod("CAPTCHA", "Klikam 'Sprawdź'...");
        await verifyBtn.click();
        await sleepRandom(2000, 3000);
      }
    } catch (err) {
      log.warn("CAPTCHA", `Błąd kliknięcia Verify: ${err?.message}`);
    }

    return { ok: true, clicked: clickIndices };

  } catch (err) {
    log.error("CAPTCHA", `Błąd GridTask: ${err?.message}`);
    return { ok: false, error: err?.message };
  }
}

/**
 * Tłumaczy polską instrukcję reCAPTCHA na angielski
 */
function translateInstruction(pl) {
  const translations = {
    "przejściami dla pieszych": "crosswalks",
    "przejścia dla pieszych": "crosswalks",
    "sygnalizatorami świetlnymi": "traffic lights",
    "sygnalizatory świetlne": "traffic lights",
    "światłami": "traffic lights",
    "samochodami": "cars",
    "samochody": "cars",
    "autobusami": "buses",
    "autobusy": "buses",
    "motocyklami": "motorcycles",
    "motocykle": "motorcycles",
    "rowerami": "bicycles",
    "rowery": "bicycles",
    "hydrantami": "fire hydrants",
    "hydranty": "fire hydrants",
    "mostami": "bridges",
    "mosty": "bridges",
    "schodami": "stairs",
    "schody": "stairs",
    "górami": "mountains",
    "góry": "mountains",
    "palmami": "palm trees",
    "palmy": "palm trees",
    "łodziami": "boats",
    "łodzie": "boats",
    "taksówkami": "taxis",
    "taksówki": "taxis",
    "chimneys": "chimneys",
    "kominami": "chimneys",
    "kominy": "chimneys",
    "parking meters": "parking meters",
    "parkomatami": "parking meters",
    "parkomaty": "parking meters",
  };

  let en = pl.toLowerCase();

  // Zamień polskie frazy na angielskie
  for (const [plPhrase, enPhrase] of Object.entries(translations)) {
    if (en.includes(plPhrase.toLowerCase())) {
      return `Select all squares with ${enPhrase}`;
    }
  }

  // Jeśli nie znaleziono tłumaczenia, zwróć oryginalną instrukcję
  return pl || "Select all matching images";
}

/**
 * Sprawdza czy pojawiła się siatka obrazków (po kliknięciu checkboxa)
 */
async function hasImageGrid(page) {
  try {
    const frames = page.frames();
    for (const frame of frames) {
      if (frame.url().includes('recaptcha') && frame.url().includes('bframe')) {
        // Sprawdź czy siatka jest widoczna
        const hasGrid = await frame.evaluate(() => {
          const grid = document.querySelector('.rc-imageselect-challenge, .rc-imageselect-table-33, .rc-imageselect-table-44');
          return grid && grid.offsetHeight > 0;
        }).catch(() => false);

        if (hasGrid) {
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

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
    log.debug("LOGIN", "Szukam popupu cookies...");

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

    log.debug("LOGIN", "Kliknięto cookies popup");

    await sleepRandom(600, 1200);
    return true;
  } catch (err) {
    log.debug("LOGIN", `Błąd cookies popup: ${err?.message || err}`);
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
      log.debug("LOGIN", "Kliknięto accept cookies (fallback)");
      await sleepRandom(500, 1100);
    }
    return !!clicked;
  } catch {
    return false;
  }
}

/**
 * Helper: kliknij przycisk submit po rozwiązaniu captcha
 */
async function clickSubmitButton(page) {
  // Rozszerzone selektory dla FB two_step_verification
  const submitSelectors = [
    // FB specyficzne
    'div[aria-label="Kontynuuj"]',
    'div[aria-label="Continue"]',
    'span[dir="auto"]:has-text("Kontynuuj")',
    // Standardowe
    'button[type="submit"]',
    'input[type="submit"]',
    'button[name="submit"]',
    'div[role="button"][tabindex="0"]',
    'button:not([type])',
    '[data-testid="royal_login_button"]',
  ];

  let submitBtn = null;
  for (const sel of submitSelectors) {
    try {
      submitBtn = await page.$(sel);
      if (submitBtn) {
        log.debug("CAPTCHA", `Znaleziono przycisk: ${sel}`);
        break;
      }
    } catch {}
  }

  // Fallback - szukaj przycisku po tekście (rozszerzone dla FB)
  if (!submitBtn) {
    log.debug("CAPTCHA", "Szukam przycisku po tekście...");

    // Diagnostyka - pokaż wszystkie klikalne elementy
    const buttons = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll(
        'button, div[role="button"], a[role="button"], span[role="button"], div[tabindex="0"]'
      ));
      return els.slice(0, 15).map(el => ({
        tag: el.tagName,
        text: (el.innerText || '').substring(0, 50).trim(),
        role: el.getAttribute('role'),
        ariaLabel: el.getAttribute('aria-label'),
      })).filter(x => x.text || x.ariaLabel);
    });
    log.debug("CAPTCHA", `Dostępne przyciski: ${JSON.stringify(buttons, null, 2)}`);

    submitBtn = await page.evaluateHandle(() => {
      // Szukaj we wszystkich możliwych elementach
      const allElements = Array.from(document.querySelectorAll(
        'button, div[role="button"], a[role="button"], span[role="button"], ' +
        'div[tabindex="0"], span[tabindex="0"], a[tabindex="0"]'
      ));

      const texts = [
        'kontynuuj', 'continue', 'submit', 'dalej', 'wyślij', 'potwierdź',
        'prześlij', 'zatwierdź', 'weryfikuj', 'verify', 'next', 'ok'
      ];

      for (const el of allElements) {
        const t = (el.innerText || el.textContent || '').toLowerCase().trim();
        if (!t) continue;

        // Szukaj dokładnego dopasowania lub zawierania
        if (texts.some(x => t === x || t.includes(x))) {
          console.log('[Submit] Znaleziono:', t, el.tagName);
          return el;
        }
      }

      // Ostatnia szansa - szukaj niebieskiego przycisku FB (primary button)
      const primaryBtn = document.querySelector(
        'div[style*="background-color: rgb(24, 119, 242)"], ' +
        'div[class*="primary"], ' +
        'div[class*="layerConfirm"]'
      );
      if (primaryBtn) {
        console.log('[Submit] Znaleziono primary button');
        return primaryBtn;
      }

      return null;
    });

    if (submitBtn?.asElement()) {
      submitBtn = submitBtn.asElement();
    } else {
      submitBtn = null;
    }
  }

  if (submitBtn) {
    log.prod("CAPTCHA", "Klikam przycisk submit...");
    await submitBtn.click();
    await sleepRandom(1000, 2000);
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
    await sleepRandom(2000, 3000);
  } else {
    // Spróbuj kliknąć w środek ekranu gdzie zwykle jest przycisk
    log.warn("CAPTCHA", "Nie znaleziono przycisku - próbuję Tab + Enter");
    await page.keyboard.press('Tab');
    await sleepRandom(300, 500);
    await page.keyboard.press('Tab');
    await sleepRandom(300, 500);
    await page.keyboard.press('Enter');
    await sleepRandom(3000, 4000);
  }
}

/**
 * Pomocnik: wpisz login/hasło + kliknij login. Best-effort.
 */
async function fillLoginFormBestEffort(page) {
  const email = process.env.FB_EMAIL || "";
  const password = process.env.FB_PASSWORD || "";

  if (!email || !password) {
    log.dev("LOGIN", "Brak FB_EMAIL / FB_PASSWORD – pomijam");
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
    log.debug("LOGIN", "Brak pól email/hasło na stronie");
    return false;
  }

  log.dev("LOGIN", "Wpisuję email i hasło (human-like typing)...");

  await emailInput.click({ clickCount: 3 }).catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  // Human-like typing: ~120ms/znak z mikro-pauzami
  await humanType(emailInput, email, page).catch(() => {});

  await passInput.click({ clickCount: 3 }).catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  // Human-like typing: ~120ms/znak z mikro-pauzami
  await humanType(passInput, password, page).catch(() => {});

  const loginButton =
    (await page.$('button[name="login"]')) ||
    (await page.$('button[type="submit"]')) ||
    (await page.$('div[role="button"][tabindex="0"]')) ||
    (await page.$("button")) ||
    null;

  if (!loginButton) {
    log.debug("LOGIN", "Brak przycisku logowania");
    return false;
  }

  log.dev("LOGIN", "Klikam logowanie...");

  await Promise.all([
    loginButton.click().catch(() => {}),
    page
      .waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 })
      .catch(() => {}),
  ]);

  await sleepRandom(1400, 2400);

  // Sprawdź URL - czy jesteśmy na stronie 2FA/weryfikacji
  const currentUrl = page.url();
  log.dev("LOGIN", `URL po logowaniu: ${currentUrl.substring(0, 80)}...`);

  // Jeśli jesteśmy na stronie weryfikacji, spróbuj rozwiązać captcha
  if (currentUrl.includes('two_step_verification') ||
      currentUrl.includes('checkpoint') ||
      currentUrl.includes('authentication')) {
    log.prod("LOGIN", "Wykryto stronę weryfikacji - próbuję rozwiązać captcha...");

    // Poczekaj na załadowanie elementów
    await sleepRandom(4000, 6000);

    // NOWA DIAGNOSTYKA - wykryj typ captcha
    const diagnosis = await diagnoseCaptchaType(page);

    if (!CAPTCHA_ENABLED) {
      log.warn("CAPTCHA", "Solver wyłączony (brak CAPTCHA_API_KEY)");
      await sleepRandom(1000, 2000);
      return true;
    }

    let apiResult = { ok: false };

    // === FUNCAPTCHA / ARKOSE LABS ===
    if (diagnosis.type === "funcaptcha" && diagnosis.details.publicKey) {
      log.prod("CAPTCHA", "Używam solvera FunCaptcha...");

      const maxRetries = 2;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        log.prod("CAPTCHA", `FunCaptcha próba ${attempt}/${maxRetries}...`);

        apiResult = await solveFunCaptchaViaApi(
          diagnosis.details.publicKey,
          currentUrl
        );

        if (apiResult.ok) break;

        if (apiResult.error === 'ERROR_CAPTCHA_UNSOLVABLE' && attempt < maxRetries) {
          log.warn("CAPTCHA", "FunCaptcha nierozwiązywalna - odświeżam...");
          await page.reload({ waitUntil: 'networkidle2' }).catch(() => {});
          await sleepRandom(3000, 5000);
          // Po reload ponownie zdiagnozuj
          const newDiag = await diagnoseCaptchaType(page);
          if (newDiag.details.publicKey) {
            diagnosis.details.publicKey = newDiag.details.publicKey;
          }
        } else if (apiResult.error) {
          break;
        }
      }

      if (apiResult.ok && apiResult.token) {
        log.success("CAPTCHA", "Otrzymano token FunCaptcha!");

        // Wstrzyknij token FunCaptcha
        try {
          const injected = await page.evaluate((token) => {
            let success = false;

            // FunCaptcha callback - różne warianty
            const callbacks = [
              () => window.ArkoseEnforcement?.setSessionToken?.(token),
              () => window.fc_callback?.(token),
              () => window.funcaptchaCallback?.(token),
              () => window.onFunCaptchaSuccess?.(token),
              // Szukaj ukrytego inputa
              () => {
                const input = document.querySelector('input[name="fc-token"], input[name="verification_token"]');
                if (input) {
                  input.value = token;
                  success = true;
                }
              },
              // Wywołaj event submit
              () => {
                const form = document.querySelector('form');
                if (form) {
                  const hiddenInput = document.createElement('input');
                  hiddenInput.type = 'hidden';
                  hiddenInput.name = 'fc-token';
                  hiddenInput.value = token;
                  form.appendChild(hiddenInput);
                  success = true;
                }
              },
            ];

            for (const tryCallback of callbacks) {
              try {
                tryCallback();
              } catch {}
            }

            return success;
          }, apiResult.token);

          log.dev("CAPTCHA", `Token FunCaptcha wstrzyknięty: ${injected ? 'OK' : 'częściowo'}`);
          await sleepRandom(1500, 2500);

          // Kliknij przycisk submit
          await clickSubmitButton(page);
          return true;
        } catch (err) {
          log.error("CAPTCHA", `Błąd wstrzykiwania tokenu FunCaptcha: ${err?.message}`);
        }
      }
    }
    // === RECAPTCHA ===
    else if (diagnosis.type === "recaptcha" && diagnosis.details.sitekey) {
      log.prod("CAPTCHA", "Używam solvera reCAPTCHA...");

      // Sprawdź czy Enterprise
      const isEnterprise = diagnosis.details.frames.some(f => f.enterprise);

      // KROK 1: Kliknij checkbox "Nie jestem robotem" jeśli istnieje
      try {
        const frames = page.frames();
        for (const frame of frames) {
          if (frame.url().includes('recaptcha') && frame.url().includes('anchor')) {
            log.prod("CAPTCHA", "Szukam checkboxa reCAPTCHA...");
            const checkbox = await frame.$('.recaptcha-checkbox-border, .recaptcha-checkbox, #recaptcha-anchor');
            if (checkbox) {
              log.prod("CAPTCHA", "Klikam checkbox 'Nie jestem robotem'...");
              await checkbox.click();
              await sleepRandom(2000, 3000);
              break;
            }
          }
        }
      } catch (err) {
        log.debug("CAPTCHA", `Błąd kliknięcia checkboxa: ${err?.message}`);
      }

      // KROK 2: Sprawdź czy pojawiła się siatka obrazków
      await sleepRandom(1000, 2000);
      const gridDetected = await hasImageGrid(page);

      if (gridDetected) {
        log.prod("CAPTCHA", "Wykryto siatkę obrazków - używam GridTask...");

        // Próby rozwiązania przez GridTask (FB często wymaga 4-6 rund)
        const maxGridRetries = 6;
        for (let gridAttempt = 1; gridAttempt <= maxGridRetries; gridAttempt++) {
          log.prod("CAPTCHA", `GridTask próba ${gridAttempt}/${maxGridRetries}...`);

          const gridResult = await solveGridCaptcha(page);

          if (gridResult.ok) {
            log.success("CAPTCHA", `GridTask sukces! Kliknięto: [${gridResult.clicked?.join(', ') || 'pominięto'}]`);

            // Sprawdź czy captcha zniknęła (sukces)
            await sleepRandom(2000, 3000);
            const stillHasGrid = await hasImageGrid(page);

            if (!stillHasGrid) {
              log.success("CAPTCHA", "Siatka zniknęła - captcha rozwiązana!");
              // Kliknij submit jeśli trzeba
              await clickSubmitButton(page);
              return true;
            } else {
              log.warn("CAPTCHA", "Siatka nadal widoczna - próbuję ponownie...");
              // Może pojawiła się nowa siatka - kontynuuj
            }
          } else {
            log.warn("CAPTCHA", `GridTask błąd: ${gridResult.error}`);

            if (gridResult.error === 'ERROR_CAPTCHA_UNSOLVABLE' && gridAttempt < maxGridRetries) {
              // Kliknij "Nowy obrazek" jeśli dostępny
              try {
                const frames = page.frames();
                for (const frame of frames) {
                  if (frame.url().includes('bframe')) {
                    const newImageBtn = await frame.$('#recaptcha-reload-button, .rc-button-reload');
                    if (newImageBtn) {
                      log.prod("CAPTCHA", "Klikam 'Nowy obrazek'...");
                      await newImageBtn.click();
                      await sleepRandom(2000, 3000);
                    }
                    break;
                  }
                }
              } catch {}
            }
          }
        }

        // GridTask nie zadziałał - fallback do token method
        log.warn("CAPTCHA", "GridTask wyczerpany - próbuję metodę tokenową...");
      }

      // KROK 3 (fallback): Metoda tokenowa (dla przypadków bez siatki lub gdy GridTask nie zadziałał)
      // Wyciągnij data-s
      let dataS = null;
      try {
        dataS = await page.evaluate(() => {
          const recaptchaDiv = document.querySelector('.g-recaptcha, [data-sitekey], #recaptcha');
          if (recaptchaDiv?.dataset?.s) return recaptchaDiv.dataset.s;
          const iframes = document.querySelectorAll('iframe[src*="recaptcha"]');
          for (const iframe of iframes) {
            const match = (iframe.src || '').match(/[?&]s=([^&]+)/);
            if (match) return decodeURIComponent(match[1]);
          }
          return null;
        });
      } catch {}

      const maxRetries = 2;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        log.prod("CAPTCHA", `reCAPTCHA próba ${attempt}/${maxRetries}...`);

        apiResult = await solveRecaptchaViaApi(diagnosis.details.sitekey, currentUrl, {
          isEnterprise,
          isInvisible: false,
          dataS,
        });

        if (apiResult.ok) break;

        if (apiResult.error === 'ERROR_CAPTCHA_UNSOLVABLE' && attempt < maxRetries) {
          log.warn("CAPTCHA", "reCAPTCHA nierozwiązywalna - odświeżam...");
          await page.reload({ waitUntil: 'networkidle2' }).catch(() => {});
          await sleepRandom(3000, 5000);
        } else if (apiResult.error) {
          break;
        }
      }

      if (apiResult.ok && apiResult.token) {
        log.success("CAPTCHA", "Otrzymano token reCAPTCHA!");

        // Wstrzyknij token reCAPTCHA - użyj wykrytego callbacka jeśli dostępny
        const callbackPath = diagnosis.details.callback;
        try {
          const injected = await page.evaluate((token, cbPath) => {
            let success = false;

            // 1. Ustaw wartość w textarea
            const textareas = document.querySelectorAll(
              'textarea[name="g-recaptcha-response"], #g-recaptcha-response'
            );
            textareas.forEach(ta => {
              ta.value = token;
              ta.innerHTML = token;
              success = true;
            });

            // 2. Wywołaj callback wykryty przez skrypt 2Captcha
            if (cbPath) {
              try {
                // cbPath ma format: ___grecaptcha_cfg.clients['0']['X']['Y']['callback']
                const callback = eval(cbPath);
                if (typeof callback === 'function') {
                  callback(token);
                  success = true;
                  console.log('[2Captcha] Callback wywołany:', cbPath);
                }
              } catch (e) {
                console.log('[2Captcha] Błąd callbacka:', e.message);
              }
            }

            // 3. Fallback - standardowe callbacki
            try { window.onCaptchaSuccess?.(token); } catch {}
            try { window.captchaCallback?.(token); } catch {}

            // 4. Szukaj callbacku w ___grecaptcha_cfg (głęboko)
            try {
              const cfg = window.___grecaptcha_cfg;
              if (cfg?.clients) {
                for (const [cid, client] of Object.entries(cfg.clients)) {
                  for (const [key, obj] of Object.entries(client)) {
                    if (obj && typeof obj === 'object') {
                      for (const [subkey, subobj] of Object.entries(obj)) {
                        if (subobj && typeof subobj === 'object') {
                          if (typeof subobj.callback === 'function') {
                            subobj.callback(token);
                            success = true;
                            console.log('[2Captcha] Callback znaleziony w:', cid, key, subkey);
                          }
                        }
                      }
                    }
                  }
                }
              }
            } catch {}

            return success;
          }, apiResult.token, callbackPath);

          log.dev("CAPTCHA", `Token reCAPTCHA wstrzyknięty: ${injected ? 'OK' : 'częściowo'}`);
          await sleepRandom(1500, 2500);

          // Kliknij przycisk submit
          await clickSubmitButton(page);
          return true;
        } catch (err) {
          log.error("CAPTCHA", `Błąd wstrzykiwania tokenu reCAPTCHA: ${err?.message}`);
        }
      }
    }
    // === NIEZNANY TYP ===
    else {
      log.warn("CAPTCHA", `Nieobsługiwany typ captcha: ${diagnosis.type}`);
      log.prod("CAPTCHA", "Szczegóły diagnozy:", JSON.stringify(diagnosis.details, null, 2));
    }

    await sleepRandom(1000, 2000);
  }

  // Standardowe sprawdzenie captcha
  const captchaResult = await solveCaptchaIfPresent(page);
  if (captchaResult.solved) {
    log.success("LOGIN", "Captcha rozwiązana po logowaniu!");
    await sleepRandom(2000, 3000);

    // Po rozwiązaniu captcha, może trzeba kliknąć submit ponownie
    const submitAfterCaptcha = await page.$('button[type="submit"], button[name="login"]');
    if (submitAfterCaptcha) {
      await submitAfterCaptcha.click().catch(() => {});
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
      await sleepRandom(1000, 2000);
    }
  }

  return true;
}

/**
 * Próba logowania na dowolnym widocznym formularzu (z lokalnej wersji),
 * ale z lekkimi ulepszeniami i bez crashy.
 */
async function loginViaVisibleForm(page, context = "visible-form") {
  try {
    log.debug("LOGIN", `Szukam formularza (${context})...`);

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
      log.debug("LOGIN", "Brak pełnego formularza na stronie");
      return false;
    }

    const ok = await fillLoginFormBestEffort(page);
    if (!ok) return false;

    log.dev("LOGIN", "Formularz logowania wysłany");
    return true;
  } catch (err) {
    log.debug("LOGIN", `Błąd formularza: ${err?.message || err}`);
    return false;
  }
}

/**
 * Główne logowanie – NAJSTABILNIEJSZE: login.php?next=<URL>
 * Param nextUrl: URL posta, do którego FB ma wrócić po loginie.
 */
async function fbLogin(page, nextUrl = "") {
  try {
    log.dev("LOGIN", "Start logowania...");

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
    log.debug("LOGIN", `Błąd logowania: ${e?.message || e}`);
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

    log.dev("LOGIN", "Wykryto login-wall → próba logowania");

    const tried = await fbLogin(page, target);

    let logged = await checkIfLogged(page);
    log.dev("LOGIN", `Sesja po fbLogin: ${logged ? "OK" : "BRAK"}`);

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
        log.dev("LOGIN", `Sesja po visible-form: ${logged ? "OK" : "BRAK"}`);
      }
    }

    return tried && logged;
  } catch (e) {
    log.debug("LOGIN", `ensureLoggedInOnPostOverlay error: ${e?.message || e}`);
    return false;
  }
}

/**
 * Wykrywa obecność captcha na stronie (reCAPTCHA, hCaptcha, itp.)
 */
async function hasCaptcha(page) {
  try {
    const result = await page.evaluate(() => {
      // reCAPTCHA v2/v3 - rozszerzone selektory
      const recaptchaSelectors = [
        'iframe[src*="recaptcha"]',
        'iframe[src*="google.com/recaptcha"]',
        'iframe[title*="reCAPTCHA"]',
        'iframe[title*="recaptcha"]',
        '.g-recaptcha',
        '#recaptcha',
        '[data-sitekey]',
        '.rc-anchor',
        '.recaptcha-checkbox',
      ].join(',');

      const recaptcha = document.querySelector(recaptchaSelectors);

      // hCaptcha
      const hcaptcha = document.querySelector(
        'iframe[src*="hcaptcha"], .h-captcha'
      );

      // Facebook image captcha
      const fbCaptcha = document.querySelector(
        'img[src*="captcha"], input[name*="captcha"]'
      );

      // Tekst "Nie jestem robotem" / "I'm not a robot" na stronie
      const bodyText = (document.body?.innerText || '').toLowerCase();
      const hasRobotText = bodyText.includes('nie jestem robotem') ||
                          bodyText.includes("i'm not a robot") ||
                          bodyText.includes('recaptcha');

      // URL zawiera verification/authentication z recaptcha
      const url = window.location.href.toLowerCase();
      const isVerificationPage = url.includes('two_step_verification') ||
                                  url.includes('checkpoint');

      return {
        found: !!(recaptcha || hcaptcha || fbCaptcha || (hasRobotText && isVerificationPage)),
        details: {
          recaptcha: !!recaptcha,
          hcaptcha: !!hcaptcha,
          fbCaptcha: !!fbCaptcha,
          robotText: hasRobotText,
          verificationPage: isVerificationPage
        }
      };
    });

    if (result.found) {
      log.debug("CAPTCHA", "Wykryto captcha", result.details);
    }

    return result.found;
  } catch {
    return false;
  }
}

/**
 * Próbuje rozwiązać captcha na stronie (jeśli plugin 2Captcha jest włączony).
 * Wymaga puppeteer-extra-plugin-recaptcha.
 * @returns {Promise<{solved: boolean, error?: string}>}
 */
async function solveCaptchaIfPresent(page) {
  if (!CAPTCHA_ENABLED) {
    log.debug("CAPTCHA", "Solver wyłączony (brak CAPTCHA_API_KEY)");
    return { solved: false, error: "disabled" };
  }

  try {
    const detected = await hasCaptcha(page);
    if (!detected) {
      log.debug("CAPTCHA", "Brak captcha na stronie");
      return { solved: false, error: "no_captcha" };
    }

    log.prod("CAPTCHA", "Wykryto captcha - rozpoczynam rozwiązywanie...");

    // puppeteer-extra-plugin-recaptcha dodaje metodę solveRecaptchas() do page
    if (typeof page.solveRecaptchas !== "function") {
      log.warn("CAPTCHA", "Plugin recaptcha nie jest załadowany");
      return { solved: false, error: "plugin_not_loaded" };
    }

    const result = await page.solveRecaptchas();

    if (result.solved && result.solved.length > 0) {
      log.prod("CAPTCHA", `Rozwiązano ${result.solved.length} captcha!`);
      await sleepRandom(1000, 2000);
      return { solved: true };
    } else if (result.error) {
      log.warn("CAPTCHA", `Błąd rozwiązywania: ${result.error}`);
      return { solved: false, error: result.error };
    } else {
      log.debug("CAPTCHA", "Brak captcha do rozwiązania (lub nieobsługiwany typ)");
      return { solved: false, error: "unsupported_or_none" };
    }
  } catch (err) {
    log.warn("CAPTCHA", `Wyjątek: ${err?.message || err}`);
    return { solved: false, error: err?.message || "unknown" };
  }
}

export {
  fbLogin,
  checkIfLogged,
  ensureLoggedInOnPostOverlay,
  clickByText,
  acceptLoginCookies,
  loginViaVisibleForm,
  hasCaptcha,
  solveCaptchaIfPresent,
};
