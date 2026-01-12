// src/telegram.js
import axios from "axios";

function envBool(name, def = false) {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  if (!v) return def;
  return ["1", "true", "yes", "tak", "y", "on"].includes(v);
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildCaptionHtml(post, c) {
  const postName = escapeHtml(post?.name || "");
  const postDesc = escapeHtml(post?.description || "");
  const author = escapeHtml(c?.author || c?.name || "");
  const text = escapeHtml(c?.text || c?.message || "");
  const rel = escapeHtml(c?.fb_time_raw || c?.time || c?.relative_time || "");
  const url = String(post?.url || "").trim();

  const postLine = postDesc ? `${postName} — ${postDesc}` : postName;

  return (
    `<b>📩 Nowy komentarz na Facebooku</b>\n\n` +
    `<b>👤 Autor:</b>\n${author || "-"}\n\n` +
    `<b>🕒 Czas:</b>\n${rel || "-"}\n\n` +
    `<b>📝 Treść:</b>\n${text || "-"}\n\n` +
    `<b>📌 Post:</b>\n${postLine || "-"}\n\n` +
    (url ? `<a href="${escapeHtml(url)}">👉 Otwórz post</a>` : "")
  );
}

async function tgRequest(token, method, payload) {
  const t = String(token || "").trim();
  if (!t) return { ok: false, error: "Brak tokena bota" };

  const endpoint = `https://api.telegram.org/bot${t}/${method}`;

  try {
    const res = await axios.post(endpoint, payload, { timeout: 15000 });
    if (res?.data?.ok) return { ok: true, data: res.data };
    return { ok: false, error: res?.data?.description || "Telegram error" };
  } catch (e) {
    return {
      ok: false,
      error: e?.response?.data?.description || e?.message || String(e),
    };
  }
}

async function sendMessage(token, chat_id, text, opts = {}) {
  const parse_mode = opts.parse_mode || "HTML";
  const disable_web_page_preview = !!opts.disable_web_page_preview;

  return tgRequest(token, "sendMessage", {
    chat_id,
    text,
    parse_mode,
    disable_web_page_preview,
  });
}

async function sendPhoto(token, chat_id, photo, caption, opts = {}) {
  const parse_mode = opts.parse_mode || "HTML";
  return tgRequest(token, "sendPhoto", {
    chat_id,
    photo,
    caption,
    parse_mode,
  });
}

function getTargets() {
  const sendOwner = envBool("TELEGRAM_SEND_TO_OWNER", true);
  const sendClient = envBool("TELEGRAM_SEND_TO_CLIENT", true);

  const ownerToken = String(process.env.TELEGRAM_BOT_TOKEN_OWNER || "").trim();
  const ownerChat = String(process.env.TELEGRAM_CHAT_ID_OWNER || "").trim();

  const clientToken = String(process.env.TELEGRAM_BOT_TOKEN_CLIENT || "").trim();
  const clientChat = String(process.env.TELEGRAM_CHAT_ID_CLIENT || "").trim();

  const targets = [];

  if (sendOwner && ownerToken && ownerChat) {
    targets.push({ label: "OWNER", token: ownerToken, chat_id: ownerChat });
  } else if (sendOwner) {
    console.warn(
      "[TG] OWNER włączony, ale brakuje TELEGRAM_BOT_TOKEN_OWNER lub TELEGRAM_CHAT_ID_OWNER."
    );
  }

  if (sendClient && clientToken && clientChat) {
    targets.push({ label: "CLIENT", token: clientToken, chat_id: clientChat });
  } else if (sendClient) {
    console.warn(
      "[TG] CLIENT włączony, ale brakuje TELEGRAM_BOT_TOKEN_CLIENT lub TELEGRAM_CHAT_ID_CLIENT."
    );
  }

  return targets;
}

/**
 * 1 komentarz => wysyłka na 2 Telegramy:
 * - Twój (Twoim botem)
 * - Klienta (botem klienta)
 */
async function sendTelegramLead(post, comment) {
  const targets = getTargets();
  if (!targets.length) return;

  const usePhoto = envBool("TELEGRAM_USE_PHOTO", true);
  const disablePreview = envBool("TELEGRAM_DISABLE_WEB_PAGE_PREVIEW", true);

  const caption = buildCaptionHtml(post, comment);
  const img = String(post?.image || "").trim();

  for (const t of targets) {
    if (usePhoto && img) {
      const r1 = await sendPhoto(t.token, t.chat_id, img, caption, {
        parse_mode: "HTML",
      });
      if (r1.ok) {
        console.log(`[TG] Wysłano lead (photo) -> ${t.label}`);
        await new Promise((r) => setTimeout(r, 350));
        continue;
      }
      console.warn(
        `[TG] sendPhoto nie przeszło (${t.label}) -> fallback do sendMessage:`,
        r1.error
      );
    }

    const r2 = await sendMessage(t.token, t.chat_id, caption, {
      parse_mode: "HTML",
      disable_web_page_preview: disablePreview,
    });

    if (r2.ok) console.log(`[TG] Wysłano lead (message) -> ${t.label}`);
    else console.error(`[TG] sendMessage error (${t.label}):`, r2.error);

    await new Promise((r) => setTimeout(r, 350));
  }
}

async function sendTelegramLeads(post, comments = []) {
  for (const c of comments) {
    await sendTelegramLead(post, c);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/* ============================================================
   =======================  ALERTY OWNER  ======================
   ============================================================ */

let _lastAlertAt = 0;
let _lastAlertKey = "";
let _repeatCount = 0;

function shorten(s, max) {
  const x = String(s ?? "");
  if (x.length <= max) return x;
  return x.slice(0, max - 12) + "\n…(obcięto)…";
}

function makeAlertKey(title, msg) {
  const a = String(title || "").slice(0, 80);
  const b = String(msg || "").slice(0, 200);
  return `${a}::${b}`;
}

async function sendOwnerAlert(title, message, opts = {}) {
  if (!envBool("TG_ALERTS_ENABLED", true)) return;

  const token = String(process.env.TELEGRAM_BOT_TOKEN_OWNER || "").trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID_OWNER || "").trim();
  if (!token || !chatId) return;

  const cooldownSec = Number(process.env.TG_ALERTS_COOLDOWN_SEC || "120");
  const maxLen = Number(process.env.TG_ALERTS_MAXLEN || "3500");
  const tz = String(process.env.TG_ALERTS_TIMEZONE || "Europe/Warsaw").trim();

  const now = Date.now();
  const key = makeAlertKey(title, message);

  // Anti-spam: jeśli to samo w kółko w cooldownie, nie spamuj — tylko licz
  if (key === _lastAlertKey && now - _lastAlertAt < cooldownSec * 1000) {
    _repeatCount++;
    return;
  }

  // Jeśli wcześniej coś się powtarzało, doślij podsumowanie
  if (_repeatCount > 0) {
    const summary = `<b>⚠️ Powtarzające się błędy</b>\n\nPoprzedni alert powtórzył się <b>${_repeatCount}</b> razy w krótkim czasie.`;
    await sendMessage(token, chatId, summary, { parse_mode: "HTML" }).catch(
      () => {}
    );
    _repeatCount = 0;
  }

  _lastAlertAt = now;
  _lastAlertKey = key;

  // Lokalny czas PL (nie UTC)
  const dt = new Date();
  const tsLocal = new Intl.DateTimeFormat("pl-PL", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(dt);

  // Dla pewności dopisujemy też UTC (krótkie), żeby łatwiej było debugować serwer
  const tsUtc = dt.toISOString().replace("T", " ").replace("Z", " UTC");

  const text =
    `<b>🚨 FB_Watcher – ALERT</b>\n` +
    `<b>🕒</b> ${escapeHtml(tsLocal)} (${escapeHtml(tz)})\n` +
    `<b>🌍</b> ${escapeHtml(tsUtc)}\n\n` +
    `<b>${escapeHtml(title || "Błąd")}</b>\n\n` +
    `<pre>${escapeHtml(shorten(message, maxLen))}</pre>`;

  const r = await sendMessage(token, chatId, text, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });

  if (!r.ok) {
    // nie rób pętli error->alert->error
    console.log("[TG ALERT] Nie udało się wysłać alertu:", r.error);
  }
}


export { sendTelegramLead, sendTelegramLeads, sendOwnerAlert };
