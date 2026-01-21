// src/fb/expandButtons.js
// Centralny „button classifier" dla wszystkich przycisków typu:
// - „Wyświetl więcej komentarzy / zobacz więcej komentarzy / view more comments"
// - „Wyświetl wszystkie X odpowiedzi / Wyświetl 1 odpowiedź / X replies"
// - „Zobacz więcej / See more" (bez „Zobacz tłumaczenie").
// Obsługa PL + EN + ogólne wzorce (comment/reply/more).
// Zwraca true, jeśli COŚ zostało kliknięte.

import { INCLUDE_REPLIES } from "../config.js";
import { humanDelay } from "../utils/sleep.js";
import log from "../utils/logger.js";

async function clickOneExpandButton(page) {
  // Human behavior: małe opóźnienie przed szukaniem przycisku
  await humanDelay(150, 0.4);

  const res = await page.evaluate((includeReplies) => {
    const isPhotoView = /[?&]fbid=|\/photo\.php|\/photo\?fbid=|\/photo\/\d/i.test(
      location.href
    );
    const isWatchView = /\/watch\//i.test(location.href);
    const isVideoView = isWatchView || /\/videos\/|[\?&]v=/i.test(location.href); // 👈 dodane /videos/

    function getPostRoot() {
      const dialogs = Array.from(document.querySelectorAll("div[role='dialog']"));
      const postDialog = dialogs.find((dlg) => {
        const text = (dlg.innerText || dlg.textContent || "").toLowerCase();
        if (!text) return false;
        const hasCommentWord =
          text.includes("komentarz") || text.includes("comment");
        const hasActions =
          text.includes("lubię to") ||
          text.includes("komentarz") ||
          text.includes("udostępnij") ||
          text.includes("napisz komentarz") ||
          text.includes("comment");
        const looksLikeNotifications =
          text.startsWith("powiadomienia") &&
          text.includes("wszystkie") &&
          text.includes("nieprzeczytane");
        return !looksLikeNotifications && hasCommentWord && hasActions;
      });
      if (postDialog) return postDialog;
      const main = document.querySelector("div[role='main']");
      if (main) {
        const article = main.querySelector("article");
        return article || main;
      }
      return document.body;
    }

    function isVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (style.opacity && parseFloat(style.opacity) < 0.05) return false;
      if (style.pointerEvents === "none") return false;
      const rect = el.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
      return true;
    }

    // scope – cały dokument dla PHOTO/VIDEO, inaczej root posta
    const root =
      isPhotoView || isVideoView ? document : getPostRoot() || document;
    // (widok /watch/ jest traktowany jak video)

    const buttons = Array.from(
      root.querySelectorAll(
        "button, a, div[role='button'], span[role='button']"
      )
    );

    function classifyButton(raw) {
      const text = raw.toLowerCase();
      const hasCommentWord =
        text.includes("komentarz") ||
        text.includes("comments") ||
        text.includes("comment");
      const hasReplyWord =
        /odpowiedź|odpowiedz|odpowiedzi|odpowiedzia/.test(text) ||
        text.includes("reply") ||
        text.includes("replies") ||
        text.includes("repl");
      const hasMoreWord =
        text.includes("wyświetl") ||
        text.includes("zobacz") ||
        text.includes("pokaż") ||
        text.includes("view") ||
        text.includes("show") ||
        text.includes("see") ||
        text.includes("wszystkie") ||
        text.includes("all") ||
        text.includes("previous");
      const hasTranslationWord =
        text.includes("tłumaczenie") || text.includes("translation");
      if (hasTranslationWord) return null;
      if (
        text === "komentarz" ||
        text === "comment" ||
        text === "lubię to" ||
        text === "lubię to!" ||
        text === "like" ||
        text === "odpowiedz" ||
        text === "reply"
      ) {
        return null;
      }
      if (
        hasCommentWord &&
        hasMoreWord &&
        (text.includes("więcej") ||
          text.includes("more") ||
          text.includes("poprzednie") ||
          text.includes("previous"))
      ) {
        return { kind: "more-comments", priority: 3 };
      }

      // ✅ ON/OFF odpowiedzi
      if (includeReplies && hasReplyWord && (hasMoreWord || /\d/.test(text))) {
        return { kind: "more-replies", priority: 2 };
      }

      if (
        text === "zobacz więcej" ||
        text === "see more" ||
        text.startsWith("zobacz więcej ") ||
        text.startsWith("see more ")
      ) {
        return { kind: "see-more-text", priority: 1 };
      }
      return null;
    }

    const candidates = [];

    for (const el of buttons) {
      if (!isVisible(el)) continue;
      const raw = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!raw) continue;
      const cls = classifyButton(raw);
      if (!cls) continue;
      const rect = el.getBoundingClientRect();
      candidates.push({
        el,
        kind: cls.kind,
        priority: cls.priority,
        top: rect.top,
        text: raw,
      });
    }

    if (!candidates.length) {
      return { clicked: false };
    }

    candidates.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.top - b.top;
    });

    const chosen = candidates[0];
    try {
      chosen.el.click();
      return {
        clicked: true,
        kind: chosen.kind,
        text: chosen.text,
      };
    } catch (e) {
      return { clicked: false };
    }
  }, INCLUDE_REPLIES);

  if (res && res.clicked) {
    log.debug("EXPAND", `Klik '${res.text}' (${res.kind})`);
    // Human behavior: opóźnienie po kliknięciu (czekaj na reakcję UI)
    await humanDelay(400, 0.3);
  }
  return !!(res && res.clicked);
}

export { clickOneExpandButton };
