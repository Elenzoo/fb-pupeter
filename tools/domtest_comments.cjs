const fs = require("fs");
const path = require("path");

function readEnvFile(envPath) {
  const out = {};
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const i = s.indexOf("=");
    if (i === -1) continue;
    const k = s.slice(0, i).trim();
    const v = s.slice(i + 1).trim();
    out[k] = v;
  }
  return out;
}

function safeHost(u) {
  try { return new URL(u).host; } catch { return null; }
}

function extractIdsFromUrl(u) {
  const ids = {};
  try {
    const url = new URL(u);
    const cid = url.searchParams.get("comment_id");
    const rcid = url.searchParams.get("reply_comment_id");
    const fbclid = url.searchParams.get("fbclid");
    if (cid) ids.comment_id = cid;
    if (rcid) ids.reply_comment_id = rcid;
    if (fbclid) ids.fbclid = fbclid;
  } catch {}
  return ids;
}

async function pickActivePostFromPanel({ panelBase, token }) {
  const url = `${panelBase.replace(/\/+$/,"")}/api/posts`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Panel HTTP ${res.status} for ${url}`);
  const data = await res.json();
  const posts = Array.isArray(data?.posts) ? data.posts : [];
  const active = posts.find(p => p && p.active && p.url);
  if (!active) throw new Error("Panel: brak aktywnych postów z url");
  return active.url;
}

async function main() {
  const envPath = "/opt/fb-watcher/.env";
  const env = readEnvFile(envPath);

  const PANEL_PORT = env.PANEL_PORT || "3180";
  const PANEL_TOKEN = env.PANEL_TOKEN;
  const panelBase = `http://127.0.0.1:${PANEL_PORT}`;

  const urlArg = process.argv[2];

  if (!PANEL_TOKEN && !urlArg) {
    console.error("Brak PANEL_TOKEN w .env i nie podano URL w argumencie.");
    process.exit(2);
  }

  const targetUrl = urlArg || await pickActivePostFromPanel({ panelBase, token: PANEL_TOKEN });
  console.log("[DOMTEST] Target:", targetUrl);

  const cookiesPath = path.join("/opt/fb-watcher", "cookies.json");
  if (!fs.existsSync(cookiesPath)) {
    console.error("[DOMTEST] Brak cookies.json:", cookiesPath);
    process.exit(3);
  }
  const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));

  // Użyj puppeteera z projektu
  const puppeteer = require("puppeteer");

  const executablePath =
    env.PUPPETEER_EXECUTABLE_PATH ||
    undefined;

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--lang=pl-PL,pl",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  // cookies
  try {
    await page.setCookie(...cookies);
    console.log("[DOMTEST] Cookies loaded:", cookies.length);
  } catch (e) {
    console.log("[DOMTEST] setCookie failed:", String(e?.message || e));
  }

  await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 90000 });
  await new Promise(r=>setTimeout(r,2000));

  // Minimalny scroll, żeby FB dociągnął wątek
  await page.evaluate(() => window.scrollTo(0, Math.min(document.body.scrollHeight, 1200)));
  await new Promise(r=>setTimeout(r,1500));

  const result = await page.evaluate(() => {
    function textOf(el) {
      if (!el) return null;
      const t = el.textContent || "";
      return t.replace(/\s+/g, " ").trim();
    }

    function collectLinks(root) {
      const as = Array.from(root.querySelectorAll("a[href]")).slice(0, 50);
      return as.map(a => a.getAttribute("href")).filter(Boolean);
    }

    // Heurystyka: komentarze często siedzą w [role="article"] lub w blokach z "Komentarz"
    const candidates = Array.from(document.querySelectorAll('[role="article"]')).slice(0, 40);

    const items = [];
    for (const node of candidates) {
      // spróbuj rozpoznać komentarz po obecności linków/tekstu
      const links = collectLinks(node);
      const txt = textOf(node);
      if (!txt || txt.length < 3) continue;

      // autor: najczęściej pierwszy sensowny link z nazwą
      const authorLink = Array.from(node.querySelectorAll("a")).find(a => {
        const t = textOf(a);
        return t && t.length >= 2 && t.length <= 60;
      });

      const meta = {
        role: node.getAttribute("role") || null,
        ariaLabel: node.getAttribute("aria-label") || null,
        dataTestid: node.getAttribute("data-testid") || null,
        id: node.id || null,
      };

      // dataset (często puste, ale sprawdzamy)
      const ds = {};
      for (const k in node.dataset) ds[k] = node.dataset[k];

      items.push({
        author: textOf(authorLink),
        text: txt.slice(0, 200),
        links: links.slice(0, 20),
        meta,
        dataset: ds,
      });

      if (items.length >= 5) break;
    }

    return { found: items.length, items };
  });

  // Post-process w Node: domeny + parametry id z URL
  const out = {
    targetUrl,
    found: result.found,
    samples: (result.items || []).map((c, idx) => {
      const hosts = [...new Set((c.links || []).map(u => {
        try { return new URL(u, "https://www.facebook.com").host; } catch { return null; }
      }).filter(Boolean))];

      const urlIds = {};
      for (const u of (c.links || [])) {
        try {
          const abs = new URL(u, "https://www.facebook.com").toString();
          const ids = extractIdsFromUrl(abs);
          for (const k of Object.keys(ids)) urlIds[k] = urlIds[k] || ids[k];
        } catch {}
      }

      return {
        i: idx + 1,
        hosts,
        urlIds,
        meta: c.meta || null,
        dataset: c.dataset || null,
        author: c.author || null,
        text: c.text || null,
        exampleLinks: (c.links || []).slice(0, 5),
      };
    }),
  };

  console.log("[DOMTEST] OUTPUT:");
  console.log(JSON.stringify(out, null, 2));

  await browser.close();
}

main().catch((e) => {
  console.error("[DOMTEST] ERROR:", e && e.stack ? e.stack : String(e));
  process.exit(1);
});
