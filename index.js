import puppeteer from "puppeteer";
import axios from "axios";
import "dotenv/config";
import fs from "fs/promises";

// ================== KONFIG ==================

const POSTS = [
  {
    id: "post1",
    url: "https://www.facebook.com/watch?v=4154742398114913",
  },
];

// true  = rozwijamy komentarze + wysyłamy content nowych
// false = NIE klikamy nic, tylko licznik komentarzy
const EXPAND_COMMENTS = true;

const CHECK_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 60000);

// stan
const lastCounts = new Map();
const knownComments = new Set(); // <- z powrotem śledzimy znane ID

// ================== UTYLsy ==================

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}
function sleepRandom(minMs, maxMs) {
  const delta = maxMs - minMs;
  const extra = Math.random() * delta;
  return sleep(minMs + extra);
}

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
    await fs.writeFile("cookies.json", JSON.stringify(cookies, null, 2), "utf8");
    console.log("[FB][cookies] Cookies zapisane do cookies.json");
  } catch (e) {
    console.error("[FB][cookies] Błąd zapisu cookies:", e.message);
  }
}

async function clickByText(page, text, scope = "body") {
  const handle = await page.evaluateHandle((t, scopeSel) => {
    const root =
      scopeSel === "body"
        ? document.body
        : document.querySelector(scopeSel) || document.body;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      null
    );

    while (walker.nextNode()) {
      const el = walker.currentNode;
      const txt = (el.textContent || "").trim();
      if (!txt) continue;
      if (txt.toLowerCase() === t.toLowerCase()) {
        return el;
      }
    }
    return null;
  }, text, scope);

  const element = handle.asElement?.();
  if (!element) return false;

  await element.click();
  return true;
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

// ================== LOGOWANIE ==================

async function fbLogin(page) {
  console.log("[FB] Trwa logowanie...");
  await page.goto("https://www.facebook.com/login", {
    waitUntil: "load",
    timeout: 60000,
  });
  console.log("[FB] Strona login załadowana:", page.url());
  await acceptCookies(page, "login");
  await page.waitForSelector("#email", { timeout: 60000 });
  await page.type("#email", process.env.FB_EMAIL || "", { delay: 80 });
  await page.type("#pass", process.env.FB_PASSWORD || "", { delay: 80 });
  await Promise.all([
    page.click('button[name="login"]'),
    page
      .waitForNavigation({ waitUntil: "load", timeout: 60000 })
      .catch(() => {}),
  ]);
  console.log("[FB] Po zalogowaniu, aktualny URL:", page.url());
}

async function checkIfLogged(page) {
  return page.evaluate(() => {
    const selCandidates = [
      'input[aria-label*="Szukaj"]',
      'input[placeholder*="Search"]',
      'a[aria-label*="Profil"]',
      'div[aria-label*="Konto"]',
    ];
    return selCandidates.some((sel) => document.querySelector(sel));
  });
}

async function ensureLoggedInOnPostOverlay(page) {
  const overlayDetected = await page.evaluate(() => {
    const texts = Array.from(
      document.querySelectorAll("div, span, h2, h3, button, a")
    )
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean);
    return texts.some((t) =>
      t.toLowerCase().includes("wyświetl więcej na facebooku")
    );
  });
  if (!overlayDetected) return;

  console.log("[FB] Wykryto okno logowania na poście – próba zalogowania.");
  const clicked = await clickByText(page, "Zaloguj się");
  if (clicked) {
    console.log("[FB] Kliknięto przycisk 'Zaloguj się' w nakładce postu.");
    await sleepRandom(4000, 6000);
  } else {
    console.log("[FB] Nie udało się znaleźć przycisku 'Zaloguj się' na nakładce.");
  }
}

// ================== FILTR KOMENTARZY (Najtrafniejsze -> Wszystkie) ==================

async function switchCommentsFilterToAll(page) {
  console.log(
    "[FB] Próba przełączenia filtra komentarzy z 'Najtrafniejsze' na 'Wszystkie komentarze'..."
  );

  const clickedDropdown = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll("div[role='button'], span, div")
    );
    const dropdown = candidates.find((el) => {
      const t = (el.textContent || "").trim();
      return t === "Najtrafniejsze";
    });
    if (!dropdown) return false;
    dropdown.click();
    return true;
  });

  if (!clickedDropdown) {
    console.log(
      "[FB] Nie znaleziono elementu 'Najtrafniejsze' – być może już jest ustawione 'Wszystkie'."
    );
    return false;
  }

  await sleepRandom(800, 1500);

  const clickedAll = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll(
        "div[role='menuitem'], div[role='menuitemradio'], span, div"
      )
    );
    const allOpt = nodes.find((el) => {
      const t = (el.textContent || "").trim();
      return t.includes("Wszystkie");
    });
    if (!allOpt) return false;
    allOpt.click();
    return true;
  });

  if (clickedAll) {
    console.log("[FB] Przełączono filtr komentarzy na opcję z 'Wszystkie'.");
    return true;
  } else {
    console.log(
      "[FB] Nie znaleziono opcji z 'Wszystkie' w menu – możliwy inny layout."
    );
    return false;
  }
}

// ================== LICZBA KOMENTARZY ==================

async function getCommentCount(page, postUrl) {
  console.log(`[FB] Otwieranie posta: ${postUrl}`);
  await page.goto(postUrl, { waitUntil: "load", timeout: 60000 });

  await sleepRandom(4000, 6000);
  await acceptCookies(page, "post-initial");
  await ensureLoggedInOnPostOverlay(page);
  await sleepRandom(2500, 4000);
  await acceptCookies(page, "post");
  await sleepRandom(2000, 3500);

  // lekki scroll, żeby załadować sekcję komentarzy
  await page.evaluate(() => window.scrollBy(0, 200));
  await sleepRandom(1500, 2500);

  // przełącz filtr komentarzy na "Wszystkie" (jeśli się da)
  try {
    const switched = await switchCommentsFilterToAll(page);
    if (switched) {
      await sleepRandom(1200, 2000);
    }
  } catch (e) {
    console.log("[FB] Błąd podczas przełączania filtra komentarzy:", e.message);
  }

  await page.evaluate(() => window.scrollBy(0, 200));
  await sleepRandom(1000, 1500);

  const uiInfo = await page.evaluate(() => {
    const debug = {};

    // ====== GLOBALNE TEKSTY I PRZYCISKI ======
    const allEls = Array.from(
      document.querySelectorAll("span, div, a, button")
    );

    const globalTexts = allEls
      .map((el) =>
        (el.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter(Boolean);
    debug.globalSample = globalTexts.slice(0, 30);

    const btnEls = Array.from(
      document.querySelectorAll("button, div[role='button']")
    );
    const btnTexts = btnEls
      .map((el) =>
        (el.innerText || el.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter(Boolean);
    debug.buttonTextsSample = btnTexts.slice(0, 20);

    // ====== HEURYSTYKA 0: frazy typu "306 komentarzy", "1,5 tys. komentarzy" ======
    function parseFromCommentsPhrase(texts) {
      let best = null;
      let bestRaw = null;

      for (const raw of texts) {
        const lower = raw.toLowerCase();
        if (!lower.includes("komentarz") && !lower.includes("comment")) continue;

        const m = lower.match(
          /(\d+(?:[.,]\d+)?)(?:\s*(tys\.|k))?\s+(komentarz|komentarze|komentarzy|comment|comments)\b/
        );
        if (!m) continue;

        let n = parseFloat(m[1].replace(",", "."));
        if (m[2]) {
          // tys. / k
          n = n * 1000;
        }
        n = Math.round(n);
        if (!Number.isFinite(n)) continue;

        if (best === null || n > best) {
          best = n;
          bestRaw = raw;
        }
      }

      return best != null ? { num: best, raw: bestRaw } : null;
    }

    const phraseRes = parseFromCommentsPhrase([...btnTexts, ...globalTexts]);
    if (phraseRes) {
      debug.source = "commentsPhraseSmart";
      debug.phraseMatch = phraseRes.raw;
      return { num: phraseRes.num, debug };
    }

    // ========= 1. GŁÓWNE ŹRÓDŁO: przyciski po "Wszystkie reakcje" =========
    const idxReactions = btnTexts.findIndex((t) => {
      const low = t.toLowerCase();
      return (
        low.startsWith("wszystkie reakcje") ||
        low.startsWith("all reactions")
      );
    });

    if (idxReactions !== -1) {
      for (let i = idxReactions + 1; i < btnTexts.length; i++) {
        const t = btnTexts[i];
        if (/^\d+$/.test(t)) {
          const n = Number(t);
          if (Number.isFinite(n)) {
            debug.source = "buttonsAfterReactions";
            debug.reactionsIndex = idxReactions;
            debug.rawCommentsText = t;
            return { num: n, debug };
          }
        }
      }
    }

    // ========= 2. HEURYSTYKA "Wszystkie reakcje" + "X komentarzy" =========
    const reactionLabels = allEls.filter((el) => {
      const t = (el.textContent || "").trim().toLowerCase();
      return (
        t.startsWith("wszystkie reakcje") || t.startsWith("all reactions")
      );
    });
    debug.reactionLabelCount = reactionLabels.length;

    function scanBlockForMaxComments(root, labelText) {
      const texts = Array.from(root.querySelectorAll("span, div"))
        .map((el) => (el.textContent || "").trim())
        .filter(Boolean);

      let bestNum = null;
      let bestStr = null;

      for (const raw of texts) {
        const lower = raw.toLowerCase();
        const m = lower.match(
          /^(\d+)\s+(komentarz|komentarze|komentarzy|comment|comments)\b/
        );
        if (m) {
          const n = parseInt(m[1], 10);
          if (Number.isFinite(n) && (bestNum === null || n > bestNum)) {
            bestNum = n;
            bestStr = raw;
          }
        }
      }

      if (bestNum != null) {
        return {
          num: bestNum,
          debugExtra: {
            source: "labelAncestorPhraseMax",
            labelText,
            matchedText: bestStr,
            blockSample: texts.slice(0, 20),
          },
        };
      }
      return null;
    }

    let bestNum = null;
    let bestLabel = null;
    let bestLevel = null;
    let bestExtra = null;

    for (const lbl of reactionLabels) {
      const labelText = (lbl.textContent || "").trim();
      let root = lbl.parentElement;
      for (let level = 0; level < 5 && root; level++) {
        const res = scanBlockForMaxComments(root, labelText);
        if (res && res.num != null) {
          if (bestNum == null || res.num > bestNum) {
            bestNum = res.num;
            bestLabel = labelText;
            bestLevel = level;
            bestExtra = res.debugExtra;
          }
        }
        root = root.parentElement;
      }
    }

    if (bestNum != null) {
      debug.usedLabel = bestLabel;
      debug.usedLevel = bestLevel;
      debug.fromLabel = bestExtra;
      debug.source = "labelAncestorMax";
      return { num: bestNum, debug };
    }

    // ========= 3. Globalne szukanie "X komentarzy" =========
    let gBestNum = null;
    let gBestStr = null;
    for (const raw of globalTexts) {
      const lower = raw.toLowerCase();
      const m = lower.match(
        /^(\d+)\s+(komentarz|komentarze|komentarzy|comment|comments)\b/
      );
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && (gBestNum === null || n > gBestNum)) {
          gBestNum = n;
          gBestStr = raw;
        }
      }
    }
    if (gBestNum != null) {
      debug.globalMatch = gBestStr;
      debug.source = "globalCommentsPhraseMax";
      return { num: gBestNum, debug };
    }

    // ========= 4. "Goła cyfra" obok słowa "Komentarz" (layout z photo-overlay) =========
    let numNearComment = null;
    let sampleBlock = null;

    for (const el of allEls) {
      const txt = (el.textContent || "").trim();
      if (!/^\d+$/.test(txt)) continue; // musi być czysta liczba

      const parent = el.parentElement;
      if (!parent) continue;

      const blockText = (parent.innerText || "").toLowerCase();
      if (
        blockText.includes("komentarz") ||
        blockText.includes("komentarze") ||
        blockText.includes("comment")
      ) {
        const n = parseInt(txt, 10);
        if (
          Number.isFinite(n) &&
          (numNearComment === null || n > numNearComment)
        ) {
          numNearComment = n;
          sampleBlock = blockText.slice(0, 200);
        }
      }
    }

    if (numNearComment != null) {
      debug.source = "digitNearCommentWord";
      debug.blockSample = sampleBlock;
      return { num: numNearComment, debug };
    }

    // ========= nic nie znaleziono =========
    debug.source = "none";
    return { num: null, debug };
  });

  console.log("[DBG] Comments-from-buttons debug:", uiInfo.debug);

  if (uiInfo.num != null) {
    console.log("[FB] Liczba komentarzy (z UI):", uiInfo.num);
    return uiInfo.num;
  }

  console.log(
    "[FB] Nie udało się odczytać liczby komentarzy z UI – fallback na anchorach."
  );

  const fallback = await page.evaluate(() => {
    const anchors = Array.from(
      document.querySelectorAll('a[href*="comment_id"]')
    );
    const ids = new Set();
    for (const a of anchors) {
      try {
        const url = new URL(a.href);
        const cid = url.searchParams.get("comment_id");
        const rid = url.searchParams.get("reply_comment_id");
        const id = rid || cid;
        if (id) ids.add(id);
      } catch {}
    }
    const count = ids.size > 0 ? 1 : 0;
    return { uniqueIds: ids.size, count };
  });

  console.log(
    `[FB] Liczba komentarzy (fallback po anchorach, uproszczona ${fallback.count}):`,
    fallback
  );
  return fallback.count;
}

// ================== ROZWIJANIE KOMENTARZY ==================

async function expandAllComments(page) {
  if (!EXPAND_COMMENTS) {
    console.log(
      "[FB] EXPAND_COMMENTS=false – pomijam klikanie 'więcej komentarzy/odpowiedzi'."
    );
    return;
  }

  let expanded = false;

  while (true) {
    const clicked = await page.evaluate(() => {
      const elements = Array.from(
        document.querySelectorAll(
          "button, div[role='button'], span[role='button']"
        )
      );
      for (const el of elements) {
        if (el.tagName === "A") continue;
        const txt = (el.textContent || "").trim().toLowerCase();
        if (!txt) continue;
        if (
          txt.startsWith("wyświetl więcej komentarzy") ||
          txt.startsWith("view more comments") ||
          txt.startsWith("wyświetl wcześniejsze komentarze") ||
          txt.startsWith("view previous comments")
        ) {
          el.click();
          return true;
        }
      }
      return false;
    });
    if (!clicked) break;
    expanded = true;
    console.log(
      "[FB] Kliknięto 'więcej komentarzy' – ładowanie kolejnych komentarzy..."
    );
    await sleepRandom(2000, 3000);
  }

  while (true) {
    const clicked = await page.evaluate(() => {
      const elements = Array.from(
        document.querySelectorAll(
          "button, div[role='button'], span[role='button']"
        )
      );
      for (const el of elements) {
        if (el.tagName === "A") continue;
        const txt = (el.textContent || "").trim();
        if (!txt) continue;
        const lower = txt.toLowerCase();
        if (
          lower.startsWith("wyświetl więcej odpowiedzi") ||
          lower.startsWith("view more replies") ||
          lower.startsWith("wyświetl wcześniejsze odpowiedzi") ||
          lower.startsWith("view previous replies") ||
          (lower.includes("odpowied") &&
            !lower.startsWith("odpowiedz") &&
            (/[0-9]|więcej/.test(lower)))
        ) {
          el.click();
          return true;
        }
      }
      return false;
    });
    if (!clicked) break;
    expanded = true;
    console.log(
      "[FB] Kliknięto 'więcej odpowiedzi' – ładowanie kolejnych odpowiedzi..."
    );
    await sleepRandom(1500, 2500);
  }

  while (true) {
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll("span[role='button'], div[role='button']")
      );
      for (const btn of buttons) {
        if (btn.tagName === "A") continue;
        const txt = (btn.textContent || "").trim();
        if (txt === "Zobacz więcej" || txt === "See more") {
          btn.click();
          return true;
        }
      }
      return false;
    });
    if (!clicked) break;
    await sleepRandom(500, 1000);
  }

  if (expanded) {
    console.log(
      "[FB] Wszystkie komentarze i odpowiedzi zostały rozwinięte (na ten moment)."
    );
  } else {
    console.log(
      "[FB] Brak ukrytych komentarzy/odpowiedzi do rozwinięcia (na ten moment)."
    );
  }
}

// ================== EKSTRAKCJA KOMENTARZY ==================

async function extractCommentsData(page) {
  if (!EXPAND_COMMENTS) {
    return [];
  }

  return page.evaluate(() => {
    function looksLikeTime(t) {
      const lower = t.toLowerCase();
      if (!lower) return false;
      if (
        /\b(min|minut|godz|h|hr|dni|day|days|tyg|week|weeks|wczoraj|yesterday|sek|s ago|m ago|h ago|d ago)\b/.test(
          lower
        )
      ) {
        return true;
      }
      if (/^\d+\s*(s|min|h|d)\b/.test(lower)) return true;
      return false;
    }

    function stripUiWords(str, timeText, author) {
      let out = str || "";

      if (author) {
        const escaped = author.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        out = out.replace(new RegExp(escaped, "g"), "").trim();
      }

      if (timeText) {
        const escapedTime = timeText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        out = out.replace(new RegExp(escapedTime, "g"), "").trim();
      }

      out = out.replace(
        /\b(\d+\s*(s|min|minut|godz|h|hr|dni|day|days|tyg|week|weeks)\b|wczoraj|yesterday)\b/gi,
        ""
      );

      out = out.replace(/lubię to!?/gi, "");
      out = out.replace(
        /\b(like|odpowiedz|reply|komentarz|comment|comments|udostępnij|share|autor)\b/gi,
        ""
      );

      out = out.replace(/\s+/g, " ").trim();
      return out;
    }

    const anchors = Array.from(
      document.querySelectorAll('a[href*="comment_id"]')
    );
    const byId = new Map();

    for (const anchor of anchors) {
      const href = anchor.href;
      let commentId = null;
      try {
        const url = new URL(href);
        const cid = url.searchParams.get("comment_id");
        const rid = url.searchParams.get("reply_comment_id");
        commentId = rid || cid;
      } catch {
        continue;
      }
      if (!commentId) continue;

      const rawAnchorText =
        (anchor.innerText || anchor.textContent || "").trim() || "";

      let timeText = looksLikeTime(rawAnchorText) ? rawAnchorText : "";

      let commentItem =
        anchor.closest("div[aria-label*='Komentarz']") ||
        anchor.closest("div[aria-label*='comment']") ||
        anchor.closest("li") ||
        anchor.closest("[role='article']") ||
        anchor.parentElement;

      if (!timeText && commentItem) {
        const timeCand = Array.from(
          commentItem.querySelectorAll("a, span, time")
        )
          .map((el) => (el.textContent || "").trim())
          .filter(looksLikeTime)[0];
        if (timeCand) timeText = timeCand;
      }

      let existing = byId.get(commentId);
      if (!existing) {
        existing = {
          id: commentId,
          author: null,
          text: "",
          time: "",
          permalink: href,
        };
      }

      let author = existing.author;
      let content = existing.text;
      let finalTime = existing.time || timeText;

      if (commentItem) {
        if (!author) {
          const linkElems = Array.from(commentItem.querySelectorAll("a"));
          for (const link of linkElems) {
            const ltxt = (link.innerText || "").trim();
            if (!ltxt) continue;
            const low = ltxt.toLowerCase();
            if (
              low === "lubię to!" ||
              low === "lubię to" ||
              low === "like" ||
              low === "odpowiedz" ||
              low === "reply"
            )
              continue;
            if (looksLikeTime(ltxt)) continue;
            author = ltxt;
            break;
          }
        }

        const potentialBlocks = Array.from(
          commentItem.querySelectorAll("div[dir='auto'], span[dir='auto'], p")
        );

        const candidates = [];

        for (const el of potentialBlocks) {
          const txtRaw = (el.textContent || "").trim();
          if (!txtRaw) continue;
          let txt = txtRaw;
          const lower = txt.toLowerCase();

          if (author && txt === author) continue;
          if (timeText && txt === timeText) continue;
          if (looksLikeTime(txt)) continue;

          if (
            lower.includes("lubię to") ||
            lower.includes("like") ||
            lower.includes("odpowiedz") ||
            lower.includes("reply") ||
            lower.includes("komentarz") ||
            lower.includes("udostępnij")
          ) {
            const withoutUi = stripUiWords(txt, timeText, author);
            if (!withoutUi) continue;
            txt = withoutUi;
          } else {
            txt = stripUiWords(txt, timeText, author);
          }

          if (!txt) continue;

          const btn = el.closest("button,[role='button']");
          if (btn) continue;

          candidates.push(txt);
        }

        let bestText = content || "";
        for (const t of candidates) {
          if (!bestText) {
            bestText = t;
          } else if (t.length > bestText.length) {
            bestText = t;
          }
        }

        if (!bestText) {
          let fullText = (commentItem.innerText || "").trim();
          fullText = stripUiWords(fullText, timeText, author);
          bestText = fullText;
        }

        content = bestText;
      }

      byId.set(commentId, {
        id: commentId,
        author: author || null,
        text: content || "",
        time: finalTime,
        permalink: href,
      });
    }

    return Array.from(byId.values());
  });
}

// ================== WEBHOOK ==================

async function sendWebhook(post, newComments, newCount, oldCount) {
  const url = process.env.WEBHOOK_URL;
  if (!url) {
    console.warn(
      "[Webhook] Brak ustawionego URL webhooka (WEBHOOK_URL) – pomijam wysyłkę."
    );
    return;
  }

  const payload = {
    postId: post.id,
    postUrl: post.url,
    commentCount: newCount,
    previousCommentCount: oldCount,
    newComments,
    timestamp: new Date().toISOString(),
  };

  console.log("[Webhook] Wysyłanie danych o nowych komentarzach:", payload);

  try {
    await axios.post(url, payload, { timeout: 10000 });
    console.log("[Webhook] Wysłano nowe komentarze do webhooka.");
  } catch (err) {
    console.error("[Webhook] Błąd wysyłania do webhooka:", err.message);
  }
}

// ================== GŁÓWNA PĘTLA ==================

async function startWatcher() {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-notifications",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  await loadCookies(page);
  await page
    .goto("https://www.facebook.com/", {
      waitUntil: "load",
      timeout: 60000,
    })
    .catch(() => {});

  let loggedIn = await checkIfLogged(page);
  if (!loggedIn) {
    console.log("[FB] Nie zalogowano, następuje normalne logowanie.");
    await fbLogin(page);
    await saveCookies(page);
  } else {
    console.log("[FB] Użyto istniejącej sesji FB (cookies).");
  }

  console.log(
    "[Watcher] Monitoring startuje. Sprawdzanie co",
    (CHECK_INTERVAL_MS / 1000).toFixed(0),
    "sekund."
  );

  const loop = async () => {
    for (const post of POSTS) {
      try {
        const count = await getCommentCount(page, post.url);
        if (count == null) {
          console.log(
            `[Watcher] Post ${post.id}: Nie udało się odczytać liczby komentarzy.`
          );
          continue;
        }

        const prev = lastCounts.get(post.id) ?? null;

        // ================== PIERWSZE ODCZYTANIE POSTA ==================
        if (prev === null) {
          lastCounts.set(post.id, count);
          console.log(
            `[Watcher] Post ${post.id}: Startowa liczba komentarzy = ${count}`
          );

          if (EXPAND_COMMENTS) {
            await expandAllComments(page);
            const allComments = await extractCommentsData(page);

            // zapamiętujemy wszystkie istniejące komentarze jako "znane"
            for (const c of allComments) {
              if (c.id) knownComments.add(c.id);
            }

            console.log(
              `[Watcher] Post ${post.id}: Zapamiętano ${allComments.length} istniejących komentarzy (bez wysyłki do webhooka).`
            );
          } else {
            console.log(
              `[Watcher] Post ${post.id}: EXPAND_COMMENTS=false – nie wczytuję treści istniejących komentarzy.`
            );
          }
        }

        // ================== ZMIANA LICZNIKA ==================
        else if (count !== prev) {
          console.log(
            `[Watcher] Post ${post.id}: Zmiana liczby komentarzy ${prev} -> ${count}`
          );
          lastCounts.set(post.id, count);

          if (count > prev) {
            let newComments = [];

            if (EXPAND_COMMENTS) {
              await expandAllComments(page);
              const snapshot = await extractCommentsData(page);

              console.log(
                `[DBG] extractCommentsData – snapshot ${snapshot.length} komentarzy.`
              );
              console.dir(snapshot.slice(0, 5), { depth: null });

              // 1) normalnie: tylko komentarze z nowymi ID
              for (const c of snapshot) {
                if (!c.id) continue;
                if (!knownComments.has(c.id)) {
                  knownComments.add(c.id);
                  newComments.push(c);
                }
              }

              // 2) usuwamy totalne śmieci
              newComments = newComments.filter((c) => {
                const hasId = !!(c.id && String(c.id).trim());
                const hasAuthor = !!(c.author && String(c.author).trim());
                const hasText = !!(c.text && String(c.text).trim());
                const hasPermalink =
                  !!(c.permalink && String(c.permalink).trim());

                if (!hasId && !hasAuthor && !hasText && !hasPermalink) {
                  return false;
                }
                return true;
              });

              // 3) fallback: jeśli mimo wzrostu licznika nie znaleźliśmy nic po ID,
              //    bierzemy ostatnie (count - prev) komentarzy ze snapshotu
              if (newComments.length === 0) {
                const diff = Math.max(1, count - prev);
                const cleanedSnapshot = snapshot.filter((c) => {
                  const hasText = !!(c.text && String(c.text).trim());
                  const hasId = !!(c.id && String(c.id).trim());
                  const hasPermalink =
                    !!(c.permalink && String(c.permalink).trim());
                  return hasText || hasId || hasPermalink;
                });

                const tail = cleanedSnapshot.slice(-diff);
                for (const c of tail) {
                  if (c.id) knownComments.add(c.id);
                }
                newComments = tail;

                console.log(
                  `[Watcher] Post ${post.id}: Fallback – po ID nic nie wyszło, biorę ostatnie ${diff} komentarzy jako nowe.`
                );
              }

              console.log(
                `[Watcher] Post ${post.id}: Znaleziono ${newComments.length} NOWYCH komentarzy do wysłania.`
              );
            } else {
              console.log(
                `[Watcher] Post ${post.id}: EXPAND_COMMENTS=false – wysyłam tylko nowy licznik, bez treści komentarzy.`
              );
            }

            await sendWebhook(post, newComments, count, prev);
          } else {
            console.log(
              `[Watcher] Post ${post.id}: Liczba komentarzy zmniejszyła się (${prev} -> ${count}).`
            );
          }
        }

        // ================== BEZ ZMIAN ==================
        else {
          console.log(
            `[Watcher] Post ${post.id}: Bez zmian (${count} komentarzy).`
          );
        }
      } catch (err) {
        console.error(
          `[Watcher] Błąd podczas sprawdzania post ${post.id}:`,
          err.message
        );
      }
    }

    const delay = CHECK_INTERVAL_MS + Math.floor(Math.random() * 5000);
    setTimeout(loop, delay);
  };

  loop();
}

startWatcher().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
