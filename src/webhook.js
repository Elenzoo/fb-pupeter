// src/webhook.js
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
   NORMALIZACJA ID: zawsze numeryczne
   ============================================================ */

function decodeUrlSafeBase64(str) {
  try {
    if (!str) return null;
    let s = String(str).trim();
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const buf = Buffer.from(s, "base64");
    const out = buf.toString("utf8");
    return out || null;
  } catch {
    return null;
  }
}

function pickNumericId(comment) {
  // 1) preferuj id_num, jeśli jest OK
  if (comment?.id_num && /^\d+$/.test(String(comment.id_num))) return String(comment.id_num);

  // 2) czasem id już jest numeryczne
  if (comment?.id && /^\d+$/.test(String(comment.id))) return String(comment.id);

  // 3) spróbuj wyciągnąć z base64 (często kończy się "_<digits>")
  const raw = comment?.id_raw || comment?.id || null;
  if (raw) {
    const dec = decodeUrlSafeBase64(raw);
    if (dec) {
      // typowo: "comment:..._<NUM>"
      let m = dec.match(/_(\d{6,})\s*$/);
      if (m) return m[1];

      // fallback: ostatni długi numer w środku stringa
      m = dec.match(/(\d{6,})\s*$/);
      if (m) return m[1];
    }

    // 4) regex po samym raw/id (gdy już zawiera _123...)
    let m2 = String(raw).match(/_(\d{6,})\b/);
    if (m2) return m2[1];

    m2 = String(raw).match(/\b(\d{6,})\b/);
    if (m2) return m2[1];
  }

  return null;
}

/* ============================================================
   FILTR WIEKU KOMENTARZA – NIE WYSYŁAMY STARYCH
   ============================================================ */

const MAX_AGE_MIN = 60; // ← możesz zmienić na 30 / 120 / 5 itd.

function filterByAge(comments) {
  const now = Date.now();

  return comments.filter((c) => {
    if (!c.time || String(c.time).trim() === "") return false; // komentarz bez czasu = odrzucamy

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
       1) Normalizacja czasu i ID (numeryczne)
     -------------------------------------------- */

  const normalized = (newComments || []).map((c) => {
    const iso = parseFbRelativeTime(c.time);
    const numericId = pickNumericId(c);

    return {
      // UWAGA: id ma być TYLKO numeryczne
      id: numericId,
      // zachowaj resztę pól, ale usuń id_raw żeby nie wyciekało base64
      author: c.author ?? null,
      text: c.text ?? null,
      time: c.time ?? null,
      permalink: c.permalink ?? null,
      pos: c.pos ?? null,

      // zostawiamy ISO do filtra / downstream
      fb_time_raw: c.time || null,
      fb_time_iso: iso ? iso.toISOString() : null,
    };
  });

  // jeśli z jakiegoś powodu nie udało się zrobić numerycznego id — odfiltruj (bo chcesz tylko cyfry)
  const onlyWithNumericId = normalized.filter((c) => c.id && /^\d+$/.test(String(c.id)));

  if (onlyWithNumericId.length !== normalized.length) {
    console.log("[Webhook] Odfiltrowałem komentarze bez numerycznego id:", {
      before: normalized.length,
      after: onlyWithNumericId.length,
    });
  }

  /* --------------------------------------------
       2) Filtrowanie komentarzy po wieku
     -------------------------------------------- */

  const freshOnly = filterByAge(onlyWithNumericId);

  console.log("[Webhook] Filtr wieku komentarzy:", {
    before: onlyWithNumericId.length,
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
