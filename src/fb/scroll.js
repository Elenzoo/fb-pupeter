/**
 * Scrollowanie posta:
 * - znajdujemy scrollowalny kontener pod środkiem ekranu
 * - jeśli się nie uda → dialog → dokument
 */
async function scrollPost(page, amount = 450) {
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
  }, amount);
}

export { scrollPost };
