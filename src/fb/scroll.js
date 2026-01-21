import { gaussianRandom, sleep } from "../utils/sleep.js";

/**
 * Scrollowanie posta - płynne, human-like
 * - znajdujemy scrollowalny kontener pod środkiem ekranu
 * - scrollujemy w małych krokach z losowymi opóźnieniami
 */
async function scrollPost(page, amount = 450) {
  // Human behavior: scrolluj w małych krokach (jak kółko myszy)
  const steps = Math.max(3, Math.ceil(amount / 80)); // ~80px na krok
  const stepAmount = Math.round(amount / steps);

  for (let i = 0; i < steps; i++) {
    await page.evaluate((dy) => {
      function findScrollableAncestor(start) {
        let el = start;
        while (el) {
          const style = window.getComputedStyle(el);
          const canScrollY =
            style.overflowY === "auto" || style.overflowY === "scroll";
          if (canScrollY && el.scrollHeight - el.clientHeight > 50) {
            return el;
          }
          el = el.parentElement;
        }
        return null;
      }

      // element pod środkiem ekranu (tam gdzie normalnie kręcisz kółkiem)
      const centerEl = document.elementFromPoint(
        window.innerWidth / 2,
        window.innerHeight / 2
      );

      let target = centerEl ? findScrollableAncestor(centerEl) : null;

      // fallback: dialog
      if (!target) {
        const dialog = document.querySelector("div[role='dialog']");
        if (dialog && dialog.scrollHeight - dialog.clientHeight > 50) {
          target = dialog;
        }
      }

      // ostateczny fallback: dokument
      if (!target) {
        target =
          document.scrollingElement || document.documentElement || document.body;
      }

      if (
        target === document.body ||
        target === document.documentElement ||
        target === document.scrollingElement
      ) {
        const before = window.scrollY;
        window.scrollTo(0, before + dy);
      } else {
        target.scrollTop += dy;
      }
    }, stepAmount);

    // Human delay między krokami scrollowania (30-80ms)
    if (i < steps - 1) {
      const delay = gaussianRandom(50, 15);
      await sleep(Math.max(20, Math.min(100, delay)));
    }
  }
}

export { scrollPost };
