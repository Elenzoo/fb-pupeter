// src/fb/uiCommentInfo.js
// Wykrywanie typu widoku (permalink / photo / video / watch)
// + wyciąganie liczby komentarzy z paska "Wszystkie reakcje / All reactions"

export async function getUiCommentInfo(page) {
  return page.evaluate(() => {
    function norm(str) {
      if (!str) return "";
      return str.replace(/\s+/g, " ").trim();
    }

    function parseNumberLike(str) {
  if (!str) return null;

  const cleaned = str
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // ważne: \b na końcu – sufiks musi być całym słowem, nie "k" z "komentarzy"
  const m = cleaned.match(
    /(\d+(?:[\s.,]\d+)*)(\s*(tys\.|tys|k|mln|m))?\b/i
  );
  if (!m) return null;

  let num = parseFloat(m[1].replace(/\s/g, "").replace(",", "."));
  const suffix = m[3] ? m[3].toLowerCase() : null;

  if (suffix === "tys." || suffix === "tys" || suffix === "k") {
    num *= 1000;
  } else if (suffix === "mln" || suffix === "m") {
    num *= 1_000_000;
  }

  if (!Number.isFinite(num)) return null;
  return Math.round(num);
}


    function collectTexts(root) {
      const out = [];
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_ELEMENT,
        null
      );
      let node;
      while ((node = walker.nextNode())) {
        const t = norm(node.textContent);
        if (t) out.push(t);
      }
      return out;
    }

    function pickExplicitCommentCount(allTexts) {
      for (const t of allTexts) {
        if (!/\b(comments?|komentarz|komentarze|komentarzy)\b/i.test(t)) continue;
        const num = parseNumberLike(t);
        if (num != null) {
          return { num, raw: t };
        }
      }
      return null;
    }

    function pickNeighbourCommentCount(allTexts) {
      // Dla layoutów PHOTO/VIDEO, gdzie mamy same numerki (np. 249 | 17 | 27)
      const numericOnly = [];
      for (const t of allTexts) {
        // interesują nas "gołe" liczby (bez liter)
        if (/^\d+(?:[\s.,]\d+)?$/.test(t)) {
          const num = parseNumberLike(t);
          if (num != null) numericOnly.push(num);
        }
      }

      // Heurystyka: pierwszy numerek to reakcje, drugi to komentarze, trzeci to udostępnienia
      if (numericOnly.length >= 2) {
        return {
          num: numericOnly[1],
          raw: numericOnly.join(" | "),
        };
      }

      return null;
    }

    function buildResult(viewType, root) {
      if (!root) return null;

      const allTexts = collectTexts(root);

      // 1) Próba: tekst z "komentarze/comments"
      let best = pickExplicitCommentCount(allTexts);

      // 2) Fallback: sąsiadujące numerki w pasku (PHOTO/VIDEO)
      if (!best) {
        best = pickNeighbourCommentCount(allTexts);
      }

      return {
        viewType,
        source: `ui-${viewType}`,
        comments: best ? best.num : null,
        raw: best ? best.raw : allTexts.slice(0, 5).join(" | "),
      };
    }

    // ==== SZUKAMY KONKRETNYCH LAYOUTÓW ====

    // WATCH – osobny wrapper (wg. podanego HTML z /watch/)
    const watchBar = document.querySelector(
      "div.x6s0dn4.xi81zsa.x78zum5.x1a02dak.x13a6bvl.xyesn5m"
    );

    // PERMA / PHOTO / VIDEOS – wspólny "top bar" z All reactions/Wszystkie reakcje
    // (wg. podanych DIVów – zaczynamy od mocnego selektora, żeby nie łapać śmieci)
    const genericBar = document.querySelector(
      "div.x6s0dn4.xi81zsa.x78zum5.x6prxxf.x13a6bvl.xvq8zen.xdj266r.xat24cr.x1c1uobl"
    );

        const results = [];

    const href = window.location.href || "";

    // Spójne z resztą projektu (tak jak w ensureAllCommentsLoaded):
    const isPhotoHref = /[?&]fbid=|\/photo\.php|\/photo\?fbid=|\/photo\/\d/i.test(href);
    const isVideoHref = /\/watch\/|\/videos\/|[?&]v=/i.test(href);

    if (genericBar) {
      let vt = "permalink";

      if (isPhotoHref) {
        vt = "photo";
      } else if (isVideoHref) {
        vt = "video";
      } else {
        vt = "permalink";
      }

      results.push(buildResult(vt, genericBar));
    }

    if (watchBar) {
      results.push(buildResult("watch", watchBar));
    }


    // Wybierz pierwsze sensowne
    const withComments = results.find(
      (r) => r && r.comments != null && Number.isFinite(r.comments)
    );
    return withComments || results[0] || null;
  });
}
