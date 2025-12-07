// src/fb/expandButtons.js
// Centralny „button classifier” dla wszystkich przycisków typu:
// - „Wyświetl więcej komentarzy / zobacz więcej komentarzy / view more comments”
// - „Wyświetl wszystkie X odpowiedzi / Wyświetl 1 odpowiedź / X replies”
// - „Zobacz więcej / See more” (bez „Zobacz tłumaczenie”).
// Obsługa PL + EN + ogólne wzorce (comment/reply/more).
// Zwraca true, jeśli COŚ zostało kliknięte.

async function clickOneExpandButton(page) {
  const res = await page.evaluate(() => {
    const isPhotoView = /[?&]fbid=|\/photo\.php|\/photo\?fbid=|\/photo\/\d/i.test(
      location.href
    );
    const isVideoView = /\/watch\/|[\?&]v=/i.test(location.href);

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

    // 🔧 SZEROKI SELECTOR – łapiemy też <a>, a nie tylko „role=button”
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

      // łapiemy wszystkie formy „odpowiedź/odpowiedzi/odpowiedział”
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

      // ❌ tłumaczenia pomijamy całkowicie
      if (hasTranslationWord) return null;

      // 0) Filtrujemy rzeczy oczywiste, których nie chcemy klikać
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

      // 1) więcej KOMENTARZY
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

      // 2) więcej ODPOWIEDZI
      //    a) klasyczne „Wyświetl wszystkie X odpowiedzi / View more replies”
      //    b) same „1 odpowiedzi / 3 odpowiedzi / 2 replies” – jak na Twoim screenie
      if (hasReplyWord && (hasMoreWord || /\d/.test(text))) {
        return { kind: "more-replies", priority: 2 };
      }

      // 3) see more – rozwinięcie długiego tekstu komentarza
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

    // priorytet: more-comments (3) > more-replies (2) > see-more-text (1)
    // przy tym samym priorytecie – najbliżej góry ekranu
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
  });

  if (res && res.clicked) {
    console.log(
      `[FB] -> klik expand '${res.text}' (kind=${res.kind})`
    );
  }

  return !!(res && res.clicked);
}

export { clickOneExpandButton };
