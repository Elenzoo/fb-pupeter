// src/fb/uiCommentInfo.js
// UI: wykrywanie typu widoku + wyciąganie liczby komentarzy z meta-linii (reakcje | komentarze | udostępnienia)
// FIX: photo view -> meta row + filtr sklejonych liczb typu "287368".
// VIDEO/WATCH: komentarze często są jako: [LICZBA] + [IKONKA], bez tekstu "Komentarz" -> bierzemy z buttonów z ikonką.

export async function getUiCommentInfo(page) {
  return page.evaluate(() => {
    function norm(str) {
      if (!str) return "";
      return String(str).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    }

    function detectViewType() {
      const href = location.href || "";
      const isWatch = href.includes("/watch");
      const isVideo = isWatch || /\/videos\/|[?&]v=/i.test(href);
      const isPhoto = /[?&]fbid=|\/photo\.php|\/photo\?fbid=|\/photo\/\d/i.test(href);

      if (isWatch) return "watch";
      if (isVideo) return "video";
      if (isPhoto) return "photo";
      return "permalink";
    }

    function isVisibleRough(el) {
      if (!el) return false;
      const st = window.getComputedStyle(el);
      if (!st) return true;
      if (st.display === "none" || st.visibility === "hidden") return false;
      return true;
    }

    // pojedynczy token liczbowy (np. "286", "7,8 tys.") – odrzuca wieloliczbowe i "x z y"
    function parseSingleCount(str) {
      const s = norm(str).toLowerCase();
      if (!s) return null;

      // odrzuć "x z y"
      if (/\b\d+\s*z\s*\d+\b/i.test(s)) return null;

      // jeśli są >=2 grupy cyfr -> odrzucamy (ubija "7,8", "286 368", "1 234")
      const groups = s.match(/\d+/g);
      if (groups && groups.length > 1) return null;

      const m = s.match(/^(\d[\d.,]*)\s*(k|tys|tyś|mln|m)?$/i);
      if (!m) return null;

      const raw = m[1];
      const suf = (m[2] || "").toLowerCase();

      let value = parseInt(raw.replace(/[^\d]/g, ""), 10);
      if (!Number.isFinite(value)) return null;

      if (suf === "k" || suf === "tys" || suf === "tyś") value *= 1000;
      else if (suf === "mln" || suf === "m") value *= 1000000;

      return Math.round(value);
    }

    function findActionBarRoot() {
      const candidates = Array.from(document.querySelectorAll("div, section, footer"))
        .filter(isVisibleRough)
        .slice(0, 12000);

      for (const el of candidates) {
        const t = norm(el.innerText).toLowerCase();
        if (!t) continue;

        const hasLike = t.includes("lubię to") || t.includes("like");
        const hasComment = t.includes("komentarz") || t.includes("comment");
        const hasShare = t.includes("udostępnij") || t.includes("share");

        if (hasLike && hasComment && hasShare) {
          if (t.length > 2200) continue;
          return el;
        }
      }
      return null;
    }

    // usuwa tokeny typu "287368", jeśli w tym samym zbiorze istnieją "287" i "368"
    function dropConcatenations(list) {
      const strSet = new Set(list.map((x) => String(x.v)));

      function isConcatOfTwoExisting(vStr) {
        if (vStr.length < 5) return false;
        for (let i = 1; i < vStr.length; i++) {
          const left = vStr.slice(0, i);
          const right = vStr.slice(i);
          if (left.length < 2 || right.length < 2) continue;
          if (strSet.has(left) && strSet.has(right)) return true;
        }
        return false;
      }

      const out = [];
      for (const x of list) {
        const vStr = String(x.v);
        if (isConcatOfTwoExisting(vStr)) continue;
        out.push(x);
      }
      return out;
    }

    function extractFromMetaRow(actionRoot) {
      if (!actionRoot) return { comments: null, shares: null, raw: null };

      const badWords = [
        "odpowiedz",
        "wyświetl",
        "zobacz",
        "najtrafniejsze",
        "najnowsze",
        "lider",
        "edytowano",
      ];

      const divs = Array.from(actionRoot.querySelectorAll("div"))
        .filter(isVisibleRough)
        .slice(0, 6000);

      const scored = [];

      for (const d of divs) {
        const text = norm(d.innerText);
        if (!text) continue;

        const low = text.toLowerCase();
        const hasReactions = low.includes("wszystkie reakcje") || low.includes("all reactions");
        if (!hasReactions) continue;

        if (low.length > 260) continue;
        if (badWords.some((w) => low.includes(w))) continue;

        const atoms = Array.from(d.querySelectorAll("span, a, div"))
          .filter(isVisibleRough)
          .map((el) => norm(el.textContent))
          .filter((s) => s && s.length <= 20);

        let nums = [];
        for (const s of atoms) {
          const v = parseSingleCount(s);
          if (v == null) continue;
          nums.push({ v, s });
        }

        const seen = new Set();
        let uniq = [];
        for (const n of nums) {
          const key = `${n.v}:${n.s}`;
          if (seen.has(key)) continue;
          seen.add(key);
          uniq.push(n);
        }

        uniq = dropConcatenations(uniq);

        if (uniq.length < 2) continue;

        let score = 0;
        score += uniq.length === 2 ? 300 : 0;
        score += Math.max(0, 260 - low.length);

        scored.push({ uniq, score, lowLen: low.length });
      }

      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];
      if (!best) return { comments: null, shares: null, raw: null };

      const comments = best.uniq[0]?.v ?? null;
      const shares = best.uniq[1]?.v ?? null;

      const raw = `metaRow len=${best.lowLen} nums=${best.uniq
        .map((x) => `${x.v}:${x.s}`)
        .join(" | ")} -> comments=${comments} shares=${shares}`;

      return { comments, shares, raw };
    }

    // VIDEO/WATCH: wyciągnij komentarze z przycisku "liczba + ikonka"
    function extractVideoCommentsFromIconButtons() {
      const btns = Array.from(document.querySelectorAll('[role="button"][tabindex="0"]'))
        .filter(isVisibleRough)
        .slice(0, 12000);

      function hasSuffixToken(t) {
        const s = norm(t).toLowerCase();
        return /\b(tys|tyś|k|mln|m)\b/.test(s);
      }

      const candidates = [];

      for (const b of btns) {
        // wariant 1: ikona jako <i data-visualcompletion="css-img">
        const iconI = b.querySelector('i[data-visualcompletion="css-img"]');
        // wariant 2 (na przyszłość): ikona jako svg
        const iconSvg = b.querySelector("svg");

        if (!iconI && !iconSvg) continue;

        const toks = Array.from(b.querySelectorAll("span, a, div"))
          .filter(isVisibleRough)
          .map((el) => norm(el.textContent))
          .filter((t) => t && t.length <= 20);

        if (!toks.length) continue;

        // odetnij tys/mln (np. 496 tys.)
        if (toks.some(hasSuffixToken)) continue;

        // szukamy czystej liczby (np. 127)
        let value = null;
        let rawToken = null;

        for (const t of toks) {
          if (!/^\d[\d.,]*$/.test(t)) continue;
          const v = parseSingleCount(t);
          if (v == null) continue;
          value = v;
          rawToken = t;
          break;
        }

        if (value == null) continue;

        const aria =
          norm(b.getAttribute("aria-label")) +
          " " +
          norm((iconI && iconI.getAttribute && iconI.getAttribute("aria-label")) || "");

        const lowAria = aria.toLowerCase();

        let score = 0;

        // jeśli gdziekolwiek pada "komentarz/comment" -> złoto
        if (/\b(comment|comments|komentarz|komentarze)\b/.test(lowAria)) score += 120;

        // komentarze raczej nie są mikro (1..9) w takim przycisku
        if (value <= 9) score -= 60;

        // komentarze często są 10..5000+ -> lekka premia
        if (value >= 10 && value <= 500000) score += 20;

        candidates.push({
          value,
          score,
          raw: `iconBtn token=${rawToken} toks=${toks.join(" | ")} aria=${aria}`.slice(0, 500),
        });
      }

      if (!candidates.length) {
        return { comments: null, raw: "videoIconButtons: not-found" };
      }

      candidates.sort((a, b) => b.score - a.score || b.value - a.value);
      const best = candidates[0];

      return {
        comments: best.value,
        raw: `videoIconButtons best=${best.value} score=${best.score} ${best.raw}`,
      };
    }

    // VIDEO/WATCH: fallback – próba klasycznego "near labels" (u Ciebie)
    function extractNearLabels(actionRoot) {
      const LIKE_WORDS = ["lubię to", "like"];
      const COMMENT_WORDS = ["komentarz", "comment"];
      const SHARE_WORDS = ["udostępnij", "share"];

      function hasAny(low, arr) {
        return arr.some((w) => low.includes(w));
      }

      function getNodeLabel(el) {
        if (!el) return "";
        const a = norm(el.getAttribute?.("aria-label"));
        if (a) return a;
        return norm(el.textContent);
      }

      function findActionRowContainer(startEl) {
        let cur = startEl;
        for (let up = 0; up < 8 && cur; up++) {
          const t = norm(cur.innerText).toLowerCase();
          if (
            t &&
            hasAny(t, LIKE_WORDS) &&
            hasAny(t, COMMENT_WORDS) &&
            hasAny(t, SHARE_WORDS)
          ) {
            return cur;
          }
          cur = cur.parentElement;
        }
        return null;
      }

      const scope = document.body;

      const clickable = Array.from(scope.querySelectorAll('[role="button"], a, span, div'))
        .filter(isVisibleRough)
        .slice(0, 20000);

      const commentNodes = [];
      for (const el of clickable) {
        const low = getNodeLabel(el).toLowerCase();
        if (!low) continue;
        if (hasAny(low, COMMENT_WORDS)) commentNodes.push(el);
      }

      const scored = [];
      for (const cn of commentNodes) {
        const row = findActionRowContainer(cn);
        if (!row) continue;

        const rowText = norm(row.innerText).toLowerCase();
        if (!rowText) continue;

        if (rowText.includes("wszystkie reakcje") || rowText.includes("all reactions")) continue;

        const parts = Array.from(row.querySelectorAll("span, a, div, [role='button']"))
          .filter(isVisibleRough)
          .map((n) => getNodeLabel(n))
          .map((s) => norm(s))
          .filter((s) => s && s.length <= 40);

        const anyNum = parts.some((s) => parseSingleCount(s) != null);
        if (!anyNum) continue;

        let score = 0;
        score += Math.max(0, 600 - rowText.length);
        score += Math.max(0, 120 - parts.length);

        scored.push({ row, parts, rowLen: rowText.length, score });
      }

      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];

      if (!best) {
        return { comments: null, shares: null, raw: "nearLabels: no-action-row-found" };
      }

      const tokensLow = best.parts.map((s) => s.toLowerCase());

      const idxLike = tokensLow.findIndex((t) => hasAny(t, LIKE_WORDS));
      const idxComment = tokensLow.findIndex((t) => hasAny(t, COMMENT_WORDS));
      const idxShare = tokensLow.findIndex((t) => hasAny(t, SHARE_WORDS));

      function scanLeftForNumber(fromIdx) {
        if (fromIdx == null || fromIdx < 0) return null;
        for (let i = fromIdx - 1; i >= 0 && i >= fromIdx - 14; i--) {
          const v = parseSingleCount(best.parts[i]);
          if (v != null) return { v, at: i, token: best.parts[i] };
        }
        return null;
      }

      let cPick = scanLeftForNumber(idxComment);
      if (!cPick) cPick = scanLeftForNumber(idxLike);

      let sPick = scanLeftForNumber(idxShare);
      if (cPick && sPick && sPick.v === cPick.v) sPick = null;

      const raw = `nearLabels[actionRow] len=${best.rowLen} tokens=${best.parts.join(
        " | "
      )} -> idxLike=${idxLike} idxComment=${idxComment} idxShare=${idxShare} | comments=${
        cPick ? `${cPick.v}(${cPick.token})@${cPick.at}` : "null"
      } | shares=${sPick ? `${sPick.v}(${sPick.token})@${sPick.at}` : "null"}`;

      return {
        comments: cPick ? cPick.v : null,
        shares: sPick ? sPick.v : null,
        raw,
      };
    }

    const viewType = detectViewType();
    const actionRoot = findActionBarRoot();

    let meta;

    if (viewType === "video" || viewType === "watch") {
      // 1) próbuj najpierw ikonki (to jest Twój przypadek z 127 / 496 tys.)
      meta = extractVideoCommentsFromIconButtons();

      // 2) fallback: near labels (jak w Twoim kodzie)
      if (meta.comments == null) {
        const near = extractNearLabels(actionRoot);
        meta = { comments: near.comments, raw: near.raw };
      }
    } else {
      // photo/permalink stabilne -> nie ruszamy
      meta = extractFromMetaRow(actionRoot);
    }

    return {
      source: `ui-${viewType}`,
      viewType,
      comments: meta.comments,
      raw: meta.raw,
    };
  });
}
