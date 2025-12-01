import axios from "axios";
import { POST_LABELS } from "./config.js";

async function sendWebhook(post, newComments, newCount, oldCount) {
  const url = process.env.WEBHOOK_URL;
  if (!url) {
    console.warn("[Webhook] Brak WEBHOOK_URL – pomijam wysyłkę.");
    return;
  }

  const payload = {
    postId: post.id,
    postUrl: post.url,
    postName: POST_LABELS[post.id] || post.id,
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
    console.error("[Webhook] Błąd wysyłania:", err.message);
  }
}

export { sendWebhook };
