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

  if (t.includes("przed chwilą")) return now;

  if (t.includes("wczoraj") || t.includes("yesterday")) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d;
  }

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

// możesz nadpisać w .env: WEBHOOK_MAX_AGE_MIN=60
const MAX_AGE_MIN = Number(process.env.WEBHOOK_MAX_AGE_MIN || 60);

function filterByAge(comments) {
  const now = Date.now();

  return comments.filter((c) => {
    const rel = (c?.fb_time_raw || c?.time || "").trim();
    if (!rel) return false;

    const abs = parseFbRelativeTime(rel);
    if (!abs) return false;

    const ageMinutes = (now - abs.getTime()) / 60000;
    return ageMinutes <= MAX_AGE_MIN;
  });
}

/* ============================================================
   BUILD EVENT PAYLOAD (1 komentarz = 1 obiekt)
   ============================================================ */

function buildEventPayload(post, c) {
  // meta posta (panel/sheets/env fallback)
  const postName =
    (post?.name && String(post.name).trim()) ||
    POST_LABELS[post?.id] ||
    post?.id ||
    "post";

  const postImage = (post?.image && String(post.image).trim()) || null;
  const postDescription = (post?.description && String(post.description).trim()) || null;

  const rel = (c?.fb_time_raw || c?.time || "").trim() || null;
  const createdAt = c?.fb_time_iso || null;

  return {
    event: "new_comment",

    post: {
      id: post?.id || null,
      name: postName,
      description: postDescription,
      image: postImage,
      url: post?.url || null,
    },

    comment: {
      id: c?.id || null,
      author: c?.author || c?.name || null,
      text: c?.text || c?.message || null,
      created_at: createdAt,
      relative_time: rel,
    },

    meta: {
      source: "facebook",
      detected_at: new Date().toISOString(),
    },
  };
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

  const list = Array.isArray(newComments) ? newComments : [];
  if (list.length === 0) return;

  /* --------------------------------------------
       1) Normalizacja czasu i dodanie pól ISO
     -------------------------------------------- */

  const normalized = list.map((c) => {
    const rel = (c?.time || "").trim();
    const iso = parseFbRelativeTime(rel);
    return {
      ...c,
      fb_time_raw: rel || null,
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
    maxAgeMin: MAX_AGE_MIN,
  });

  if (freshOnly.length === 0) {
    console.log("[Webhook] Żaden komentarz nie spełnia limitu wieku – nic nie wysyłam.");
    return;
  }

  /* --------------------------------------------
       3) Wysyłka: 1 komentarz = 1 event
     -------------------------------------------- */

  for (const c of freshOnly) {
    const payload = buildEventPayload(post, c);

    // pomocniczo: zachowujemy też liczniki w logach (nie w payload)
    console.log("[Webhook] Send event:", {
      postId: payload.post.id,
      commentId: payload.comment.id,
      author: payload.comment.author,
      counts: { newCount, oldCount },
    });

    try {
      await axios.post(url, payload, { timeout: 10000 });
      console.log("[Webhook] Wysłano event new_comment.");
    } catch (err) {
      console.error("[Webhook] Błąd wysyłania:", err?.message || err);
    }
  }
}

export { sendWebhook };
