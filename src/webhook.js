import axios from "axios";
import { POST_LABELS } from "./config.js";

/* ============================================================
   PARSER CZASU FB → ISO
   ============================================================ */

function parseFbRelativeTime(raw) {
  if (!raw) return null;

  const t = raw.toLowerCase().trim();
  const now = new Date();

  // „Przed chwilą”
  if (t.includes("przed chwilą")) return now;

  // „Wczoraj”
  if (t.includes("wczoraj") || t.includes("yesterday")) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d;
  }

  // np. „2 min”, „3 godz.”, „7 tyg.”, „4 dni”
  const m = t.match(/(\d+)\s*(sek|min|minut|godz|h|dni|tyg)/);
  if (!m) return null;

  const value = parseInt(m[1], 10);
  if (!Number.isFinite(value)) return null;

  const unit = m[2];
  const d = new Date(now);

  if (unit.startsWith("sek")) d.setSeconds(d.getSeconds() - value);
  else if (unit.startsWith("min")) d.setMinutes(d.getMinutes() - value);
  else if (unit.startsWith("godz") || unit === "h") d.setHours(d.getHours() - value);
  else if (unit.startsWith("dni")) d.setDate(d.getDate() - value);
  else if (unit.startsWith("tyg")) d.setDate(d.getDate() - 7 * value);

  return d;
}

/* ============================================================
   FILTR WIEKU KOMENTARZA – NIE WYSYŁAMY STARYCH
   ============================================================ */

const MAX_AGE_MIN = 60; // ← możesz zmienić na 30 / 120 / 5 itd.

function filterByAge(comments) {
  const now = Date.now();

  return comments.filter((c) => {
    if (!c.time || c.time.trim() === "") return false; // komentarz bez czasu = odrzucamy

    const abs = parseFbRelativeTime(c.time);
    if (!abs) return false;

    const ageMinutes = (now - abs.getTime()) / 60000;

    return ageMinutes <= MAX_AGE_MIN;
  });
}

/* ============================================================
   GŁÓWNA FUNKCJA WEBHOOKA
   ============================================================ */

async function sendWebhook(post, newComments, newCount, oldCount) {
  const url = process.env.WEBHOOK_URL;
  if (!url) {
    console.warn("[Webhook] Brak WEBHOOK_URL – pomijam wysyłkę.");
    return;
  }

  /* --------------------------------------------
       1) Normalizacja czasu i dodanie pól ISO
     -------------------------------------------- */

  const normalized = newComments.map((c) => {
    const iso = parseFbRelativeTime(c.time);
    return {
      ...c,
      fb_time_raw: c.time || null,
      fb_time_iso: iso ? iso.toISOString() : null,
    };
  });

  /* --------------------------------------------
       2) Filtrowanie komentarzy po wieku
     -------------------------------------------- */

  const freshOnly = filterByAge(normalized);

  console.log("[Webhook] Filtr wieku komentarzy:", {
    before: normalized.length,
    after: freshOnly.length,
  });

  if (freshOnly.length === 0) {
    console.log("[Webhook] Żaden komentarz nie spełnia limitu wieku – nic nie wysyłam.");
    return;
  }

  /* --------------------------------------------
       3) Payload do webhooka
     -------------------------------------------- */

  const payload = {
    postId: post.id,
    postUrl: post.url,
    postName: POST_LABELS[post.id] || post.id,
    commentCount: newCount,
    previousCommentCount: oldCount,
    newComments: freshOnly,
    timestamp: new Date().toISOString(),
  };

  console.log("[Webhook] Wysyłanie danych o nowych komentarzach:", payload);

  /* --------------------------------------------
       4) Wysyłka do Make / webhooka
     -------------------------------------------- */

  try {
    await axios.post(url, payload, { timeout: 10000 });
    console.log("[Webhook] Wysłano nowe komentarze do webhooka.");
  } catch (err) {
    console.error("[Webhook] Błąd wysyłania:", err.message);
  }
}

export { sendWebhook };
