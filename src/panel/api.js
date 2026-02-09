// panel/api.js
import http from "http";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import Busboy from "busboy";

// ---- BASE DIR (dev vs exe) ----
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : process.cwd();

// ---- IMAGES CONFIG ----
const IMAGES_DIR = path.join(BASE_DIR, "data", "images");
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/gif", "image/webp"];

// Ensure images directory exists
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

// .env: najpierw dev (cwd), potem exe (BASE_DIR)
dotenv.config({ path: path.join(process.cwd(), ".env"), override: true });
dotenv.config({ path: path.join(BASE_DIR, ".env"), override: true });


// UI: dev -> src/panel/ui, exe -> ./ui
const UI_DIR = process.pkg
  ? path.join(BASE_DIR, "ui")
  : path.join(BASE_DIR, "src", "panel", "ui");

// New React UI: dev -> src/panel/web/dist, exe -> ./web
const NEW_UI_DIR = process.pkg
  ? path.join(BASE_DIR, "web")
  : path.join(BASE_DIR, "src", "panel", "web", "dist");

const PORT = Number(process.env.PANEL_PORT || 3180);
const TOKEN = process.env.PANEL_TOKEN;

const PM2_APP = process.env.PM2_APP || "fbwatcher";
const DEV_PROJECT_DIR = process.env.PROJECT_DIR || ""; // local override

// ---- CACHE (performance) ----
let cachedProjectDir = null;
let cachedNodeVersion = null;
let cachedPm2Version = null;
let cachedLogPaths = null;

if (!TOKEN) {
  console.error("[PANEL] PANEL_TOKEN is required (set it in .env or env vars)");
  process.exit(1);
}

function auth(req, res) {
  const h = req.headers["authorization"] || "";
  if (h !== `Bearer ${TOKEN}`) {
    res.writeHead(401);
    res.end("Unauthorized");
    return false;
  }
  return true;
}

function json(res, obj, code = 200) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj, null, 2));
}

function sh(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: (stdout || "").trim(),
        stderr: (stderr || "").trim(),
        code: err?.code ?? 0,
      });
    });
  });
}


async function getProjectDir() {
  if (DEV_PROJECT_DIR) return DEV_PROJECT_DIR;
  if (cachedProjectDir) return cachedProjectDir;

  const r = await sh(`pm2 describe ${PM2_APP}`);
  const m = r.stdout.match(/exec cwd\s+([^\n]+)/);
  if (!m)
    throw new Error(
      `Cannot detect PROJECT_DIR from pm2 (set PROJECT_DIR in .env for local tests)`
    );
  cachedProjectDir = m[1].trim();
  return cachedProjectDir;
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
  });
}

function safeJsonParse(s) {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch (e) {
    return { ok: false, error: e?.message || "Invalid JSON" };
  }
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function atomicWriteFile(filePath, content) {
  const dir = path.dirname(filePath);
  ensureDir(dir);

  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

function normalizeUrl(u) {
  if (!u) return "";
  const x = String(u).trim();
  if (!/^https?:\/\/.+/i.test(x)) return "";
  return x;
}

function normalizeOptionalUrl(u) {
  if (!u) return "";
  const x = String(u).trim();
  if (x === "") return "";
  // Accept both http/https URLs and local /images/ paths
  if (/^\/images\/.+/i.test(x)) return x;
  if (!/^https?:\/\/.+/i.test(x)) return "";
  return x;
}

function nowIso() {
  return new Date().toISOString();
}

function stripAnsi(str) {
  return (str || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function setEnvKey(envText, key, value) {
  const re = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  if (re.test(envText)) return envText.replace(re, line);
  return envText.replace(/\s*$/, "") + `\n${line}\n`;
}

function pickPostsFile(projectDir) {
  return path.join(projectDir, "data", "posts.json");
}

function readPosts(postsPath) {
  if (!fs.existsSync(postsPath)) return [];
  const raw = fs.readFileSync(postsPath, "utf8").trim();
  if (!raw) return [];
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !Array.isArray(parsed.value))
    throw new Error("posts.json invalid (expected array)");
  return parsed.value;
}

function writePosts(postsPath, posts) {
  atomicWriteFile(postsPath, JSON.stringify(posts, null, 2) + "\n");
}

function genId() {
  return crypto.randomBytes(8).toString("hex");
}

function route(req) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  return { pathname, query: Object.fromEntries(url.searchParams.entries()) };
}

function match(pathname, pattern) {
  const a = pathname.split("/").filter(Boolean);
  const b = pattern.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (b[i].startsWith(":")) params[b[i].slice(1)] = a[i];
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

// ---------- LOGS (dynamic from pm2 describe) ----------
function parsePm2LogPaths(pm2DescribeText) {
  const out =
    pm2DescribeText.match(/Out log path:\s*(.+)$/m)?.[1]?.trim() ||
    pm2DescribeText.match(/out log path:\s*(.+)$/mi)?.[1]?.trim() ||
    "";
  const err =
    pm2DescribeText.match(/Error log path:\s*(.+)$/m)?.[1]?.trim() ||
    pm2DescribeText.match(/error log path:\s*(.+)$/mi)?.[1]?.trim() ||
    "";
  return { out, err };
}

async function getPm2LogPaths(appName) {
  const envOut = (process.env.PM2_LOG_OUT || "").trim();
  const envErr = (process.env.PM2_LOG_ERR || "").trim();
  if (envOut || envErr) return { out: envOut, err: envErr, source: "env" };

  if (cachedLogPaths) return cachedLogPaths;

  const d = await sh(`pm2 describe ${appName}`);
  if (!d.ok)
    return {
      out: "",
      err: "",
      source: "pm2_error",
      pm2: d.stderr || d.stdout || "",
    };

  const p = parsePm2LogPaths(d.stdout);
  cachedLogPaths = { out: p.out || "", err: p.err || "", source: "pm2_describe" };
  return cachedLogPaths;
}

async function readTailLog(filePath, lines) {
  try {
    if (!filePath) {
      return {
        ok: false,
        error:
          "Nie wykryto ścieżki logów (pm2 describe nie zwróciło Out/Error log path).",
        path: filePath,
      };
    }

    if (!fs.existsSync(filePath)) {
      return {
        ok: false,
        error:
          "Plik logów nie istnieje w tej ścieżce. To zwykle znaczy, że PM2 loguje gdzie indziej albo proces jeszcze nic nie wypisał.",
        path: filePath,
      };
    }

    const st = fs.statSync(filePath);
    if (!st || !st.isFile()) {
      return { ok: false, error: "Ścieżka logów nie wskazuje na plik.", path: filePath };
    }

    if (st.size === 0) {
      return {
        ok: false,
        error:
          "Plik logów jest pusty (0 bajtów). Uruchom watcher / poczekaj aż coś wypisze.",
        path: filePath,
      };
    }

    // Use tail command on Linux (fast, doesn't load entire file into memory)
    const tailResult = await sh(`tail -n ${lines} "${filePath}"`);
    if (tailResult.ok && tailResult.stdout) {
      const txt = (tailResult.stdout || "").trim();
      if (txt) {
        return { ok: true, log: tailResult.stdout, path: filePath, via: "tail" };
      }
    }

    // Fallback: read last portion of file (max 512KB) for large files
    const MAX_READ = 512 * 1024;
    if (st.size > MAX_READ) {
      const fd = fs.openSync(filePath, "r");
      const buffer = Buffer.alloc(MAX_READ);
      fs.readSync(fd, buffer, 0, MAX_READ, st.size - MAX_READ);
      fs.closeSync(fd);
      const raw = buffer.toString("utf8");
      const arr = raw.split(/\r?\n/);
      // Skip first line (might be partial)
      const slice = arr.slice(Math.max(1, arr.length - lines)).join("\n");
      const txt = (slice || "").trim();
      if (txt) {
        return { ok: true, log: slice, path: filePath, via: "partial" };
      }
    }

    // Small files: read entirely
    const raw = fs.readFileSync(filePath, "utf8");
    const arr = raw.split(/\r?\n/);
    const slice = arr.slice(Math.max(0, arr.length - lines)).join("\n");
    const txt = (slice || "").trim();

    if (!txt) {
      return { ok: false, error: `Brak danych w ostatnich ${lines} liniach.`, path: filePath, via: "js" };
    }

    return { ok: true, log: slice, path: filePath, via: "js" };
  } catch (e) {
    return { ok: false, error: e?.message || "Błąd odczytu logów.", path: filePath };
  }
}

http
  .createServer(async (req, res) => {
    const { pathname, query } = route(req);
    if (req.method === "GET" && pathname === "/ping") {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("pong");
  return;
}


    // ---------- STATIC IMAGES (/images/*) ----------
    if (req.method === "GET" && pathname.startsWith("/images/")) {
      const filename = pathname.replace(/^\/images\//, "");
      // Security: prevent directory traversal
      if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
        res.writeHead(400);
        res.end("Invalid filename");
        return;
      }

      const filePath = path.join(IMAGES_DIR, filename);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end("Image not found");
        return;
      }

      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
      };
      const contentType = mimeTypes[ext] || "application/octet-stream";

      const stat = fs.statSync(filePath);
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": stat.size,
        "Cache-Control": "public, max-age=31536000", // 1 year cache
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // ---------- NEW REACT UI (/new/) ----------
    if (req.method === "GET" && pathname.startsWith("/new")) {
      const MIME_TYPES = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
      };

      // Remove /new prefix
      let filePath = pathname.replace(/^\/new\/?/, "") || "index.html";

      // Try to serve the file
      let fullPath = path.join(NEW_UI_DIR, filePath);

      // If file doesn't exist and it's not a static asset, serve index.html (SPA fallback)
      if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
        const ext = path.extname(filePath);
        if (!ext || ext === ".html") {
          fullPath = path.join(NEW_UI_DIR, "index.html");
        }
      }

      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const ext = path.extname(fullPath);
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        const content = fs.readFileSync(fullPath);
        res.writeHead(200, { "Content-Type": `${contentType}; charset=utf-8` });
        res.end(content);
        return;
      }
    }

    // ---------- PUBLIC UI (legacy) ----------
    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      const p = path.join(UI_DIR, "index.html");
      const html = fs.readFileSync(p, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "GET" && pathname === "/app.js") {
      const p = path.join(UI_DIR, "app.js");
      const js = fs.readFileSync(p, "utf8");
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
      res.end(js);
      return;
    }

    // ---------- AUTH for API ----------
    if (pathname.startsWith("/api/")) {
      if (!auth(req, res)) return;
    }

    // ===== IMAGE UPLOAD (before PROJECT_DIR - doesn't need it) =====
    if (req.method === "POST" && pathname === "/api/images/upload") {
      console.log("[UPLOAD] Request received");
      const contentType = req.headers["content-type"] || "";
      console.log("[UPLOAD] Content-Type:", contentType);
      if (!contentType.includes("multipart/form-data")) {
        json(res, { ok: false, error: "Expected multipart/form-data" }, 400);
        return;
      }

      try {
        console.log("[UPLOAD] Creating Busboy instance");
        const busboy = Busboy({
          headers: req.headers,
          limits: { fileSize: MAX_IMAGE_SIZE, files: 1 },
        });

        let fileReceived = false;
        let uploadError = null;
        let writeFinishPromise = null;

        busboy.on("file", (fieldname, file, info) => {
          const { filename, mimeType } = info;
          console.log("[UPLOAD] File event:", fieldname, filename, mimeType);

          if (!ALLOWED_MIME.includes(mimeType)) {
            uploadError = `Nieprawidlowy format pliku. Dozwolone: JPEG, PNG, GIF, WebP`;
            file.resume(); // drain the stream
            return;
          }

          fileReceived = true;

          // Generate unique filename
          const ext = path.extname(filename || ".jpg").toLowerCase() || ".jpg";
          const uniqueName = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}${ext}`;
          const filePath = path.join(IMAGES_DIR, uniqueName);

          const writeStream = fs.createWriteStream(filePath);

          file.on("limit", () => {
            uploadError = `Plik za duzy (max ${MAX_IMAGE_SIZE / 1024 / 1024}MB)`;
            writeStream.destroy();
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          });

          // Create promise that resolves when write is complete
          writeFinishPromise = new Promise((resolve) => {
            writeStream.on("finish", () => {
              console.log("[UPLOAD] Write finished:", uniqueName);
              if (!uploadError) {
                resolve({ ok: true, path: `/images/${uniqueName}` });
              } else {
                resolve({ ok: false, error: uploadError });
              }
            });

            writeStream.on("error", (err) => {
              console.log("[UPLOAD] Write error:", err.message);
              uploadError = `Blad zapisu pliku: ${err.message}`;
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
              }
              resolve({ ok: false, error: uploadError });
            });
          });

          file.pipe(writeStream);
        });

        busboy.on("finish", async () => {
          console.log("[UPLOAD] Busboy finish, fileReceived:", fileReceived);
          if (uploadError) {
            json(res, { ok: false, error: uploadError }, 400);
          } else if (!fileReceived) {
            json(res, { ok: false, error: "Nie przeslano pliku" }, 400);
          } else if (writeFinishPromise) {
            const result = await writeFinishPromise;
            json(res, result, result.ok ? 200 : 400);
          } else {
            json(res, { ok: false, error: "Blad przetwarzania pliku" }, 500);
          }
        });

        busboy.on("error", (err) => {
          json(res, { ok: false, error: `Blad uploadu: ${err.message}` }, 500);
        });

        req.pipe(busboy);
      } catch (err) {
        json(res, { ok: false, error: `Blad uploadu: ${err.message}` }, 500);
      }
      return;
    }

    try {
      const PROJECT_DIR = await getProjectDir();
      const ENV_PATH = path.join(PROJECT_DIR, ".env");
      const COOKIES_PATH = path.join(PROJECT_DIR, "cookies.json");
      const POSTS_PATH = pickPostsFile(PROJECT_DIR);

      // ===== STATUS =====
      if (req.method === "GET" && pathname === "/api/status") {
        // Cache node/pm2 versions (don't change during runtime)
        if (!cachedNodeVersion) {
          const node = await sh("node -v");
          cachedNodeVersion = node.stdout;
        }
        if (!cachedPm2Version) {
          const pm2v = await sh("pm2 -v");
          cachedPm2Version = pm2v.stdout;
        }
        const pm2s = await sh(`pm2 status ${PM2_APP}`);
        json(res, {
          ok: true,
          projectDir: PROJECT_DIR,
          envPath: ENV_PATH,
          cookiesPath: COOKIES_PATH,
          postsPath: POSTS_PATH,
          node: cachedNodeVersion,
          pm2: cachedPm2Version,
          pm2Status: stripAnsi(pm2s.stdout),
          time: nowIso(),
        });
        return;
      }

      // ===== ENV GET (selected keys) =====
      if (req.method === "GET" && pathname === "/api/env/get") {
        if (!fs.existsSync(ENV_PATH)) {
          json(res, { ok: false, error: `.env not found at ${ENV_PATH}` }, 400);
          return;
        }
        const raw = fs.readFileSync(ENV_PATH, "utf8");
        const wanted = [
          // Facebook
          "FB_EMAIL",
          "FB_PASSWORD",
          // Watcher
          "CHECK_INTERVAL_MS",
          "FAST_MODE",
          "FAST_MAX_AGE_MIN",
          "INCLUDE_REPLIES",
          // Logi
          "LOG_LEVEL",
          // Puppeteer
          "HEADLESS_BROWSER",
          "USE_UI_HANDLERS",
          "COOKIES_READ_ONLY",
          // Źródła postów
          "POSTS_SHEET_URL",
          "POSTS_API_URL",
          "POSTS_API_TOKEN",
          // Telegram Owner
          "TELEGRAM_SEND_TO_OWNER",
          "TELEGRAM_BOT_TOKEN_OWNER",
          "TELEGRAM_CHAT_ID_OWNER",
          // Telegram Client
          "TELEGRAM_SEND_TO_CLIENT",
          "TELEGRAM_BOT_TOKEN_CLIENT",
          "TELEGRAM_CHAT_ID_CLIENT",
          // Telegram Format
          "TELEGRAM_USE_PHOTO",
          "TELEGRAM_DISABLE_WEB_PAGE_PREVIEW",
          // Telegram Alerty
          "TG_ALERTS_ENABLED",
          "TG_ALERTS_COOLDOWN_SEC",
          "TG_ALERTS_MAXLEN",
          // LITE: Session Management
          "SESSION_LENGTH_MIN_MS",
          "SESSION_LENGTH_MAX_MS",
          "WARMUP_ENABLED",
          "WARMUP_DURATION_MIN_MS",
          "WARMUP_DURATION_MAX_MS",
          // LITE: Anti-Detection
          "VIEWPORT_RANDOMIZATION",
          "TYPING_MISTAKES_ENABLED",
          "TYPING_MISTAKES_CHANCE",
          "NAVIGATION_MISTAKES_ENABLED",
          "PROFILE_VISITS_ENABLED",
          "PROFILE_VISITS_CHANCE",
          "TAB_SIMULATION_ENABLED",
          "TAB_SIMULATION_CHANCE",
          "IMAGE_INTERACTION_ENABLED",
          "IMAGE_INTERACTION_CHANCE",
          // LITE: Night Mode
          "NIGHT_MODE_ENABLED",
          "NIGHT_START_HOUR",
          "NIGHT_END_HOUR",
          "NIGHT_CATCHUP_HOURS",
          // LITE: Feed Scanner
          "FEED_SCAN_ENABLED",
          "FEED_SCAN_KEYWORDS",
          "FEED_SCROLL_DURATION_MIN",
          "FEED_SCROLL_DURATION_MAX",
          // LITE: Human Behavior
          "HUMAN_MODE",
          "HUMAN_RANDOM_LIKE_CHANCE",
          "DISCOVERY_TELEGRAM_ENABLED",
          "WEBHOOK_MAX_AGE_MIN",
          // Legacy
          "WEBHOOK_URL",
        ];
        const values = {};
        for (const k of wanted) {
          const m = raw.match(new RegExp(`^${k}=(.*)$`, "m"));
          values[k] = m ? m[1] : "";
        }
        json(res, { ok: true, values });
        return;
      }

      // ===== ENV SET MULTIPLE =====
      if (req.method === "POST" && pathname === "/api/env/set") {
        const bodyRaw = await readBody(req);
        const parsed = safeJsonParse(bodyRaw || "{}");
        if (!parsed.ok) {
          json(res, { ok: false, error: "Invalid JSON body" }, 400);
          return;
        }

        const set = parsed.value.set && typeof parsed.value.set === "object" ? parsed.value.set : null;
        const restart = Boolean(parsed.value.restart);

        if (!set) {
          json(res, { ok: false, error: "Missing set object" }, 400);
          return;
        }
        if (!fs.existsSync(ENV_PATH)) {
          json(res, { ok: false, error: `.env not found at ${ENV_PATH}` }, 400);
          return;
        }

        let env = fs.readFileSync(ENV_PATH, "utf8");
        const updated = [];

        for (const [k, v] of Object.entries(set)) {
          if (!/^[A-Z0-9_]+$/.test(k)) continue;
          env = setEnvKey(env, k, String(v));
          updated.push(k);
        }

        atomicWriteFile(ENV_PATH, env);

        let pm2Action = null;
        if (restart) {
          const r = await sh(`pm2 restart ${PM2_APP} --update-env`);
          pm2Action = { ok: r.ok, out: r.stdout || r.stderr };
        }

        json(res, { ok: true, updated, restarted: restart, pm2: pm2Action });
        return;
      }

      // ===== POSTS: LIST =====
      if (req.method === "GET" && pathname === "/api/posts") {
        const posts = readPosts(POSTS_PATH);

        // normalizacja (żeby stary posts.json bez pól też działał)
        const norm = (posts || []).map((p) => ({
          id: String(p.id || "").trim(),
          url: String(p.url || "").trim(),
          active: p.active !== undefined ? Boolean(p.active) : true,
          name: String(p.name || "").trim(),
          image: String(p.image || "").trim(),
          description: String(p.description || "").trim(),
          createdAt: p.createdAt || "",
          updatedAt: p.updatedAt || "",
        }));

        norm.sort((x, y) => String(y.createdAt || "").localeCompare(String(x.createdAt || "")));
        json(res, { ok: true, posts: norm });
        return;
      }

      // ===== POSTS: ADD =====
      if (req.method === "POST" && pathname === "/api/posts") {
        const bodyRaw = await readBody(req);
        const parsed = safeJsonParse(bodyRaw || "{}");
        if (!parsed.ok) {
          json(res, { ok: false, error: "Invalid JSON body" }, 400);
          return;
        }

        const url = normalizeUrl(parsed.value.url);
        const active = parsed.value.active !== undefined ? Boolean(parsed.value.active) : true;

        const name = String(parsed.value.name || "").trim();
        const imageRaw = String(parsed.value.image || "").trim();
        const image = normalizeOptionalUrl(imageRaw);
        const description = String(parsed.value.description || "").trim();

        if (!url) {
          json(res, { ok: false, error: "Invalid url (must start with http/https)" }, 400);
          return;
        }
        if (imageRaw !== "" && !image) {
          json(res, { ok: false, error: "Invalid image url (must start with http/https or be empty)" }, 400);
          return;
        }

        const posts = readPosts(POSTS_PATH);
        const existing = posts.find((p) => p.url === url);
        if (existing) {
          existing.active = active;
          existing.name = name;
          existing.image = image;
          existing.description = description;
          existing.updatedAt = nowIso();
          writePosts(POSTS_PATH, posts);
          json(res, { ok: true, post: existing, deduped: true });
          return;
        }

        const post = {
          id: genId(),
          url,
          active,
          name,
          image,
          description,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        posts.push(post);
        writePosts(POSTS_PATH, posts);

        json(res, { ok: true, post });
        return;
      }

      // ===== POSTS: PATCH =====
      const mPatch = req.method === "PATCH" ? match(pathname, "/api/posts/:id") : null;
      if (mPatch) {
        const id = mPatch.id;
        const bodyRaw = await readBody(req);
        const parsed = safeJsonParse(bodyRaw || "{}");
        if (!parsed.ok) {
          json(res, { ok: false, error: "Invalid JSON body" }, 400);
          return;
        }

        const posts = readPosts(POSTS_PATH);
        const post = posts.find((p) => p.id === id);
        if (!post) {
          json(res, { ok: false, error: "Post not found" }, 404);
          return;
        }

        if (parsed.value.url !== undefined) {
          const nextUrl = normalizeUrl(parsed.value.url);
          if (!nextUrl) {
            json(res, { ok: false, error: "Invalid url" }, 400);
            return;
          }
          const dup = posts.find((p) => p.url === nextUrl && p.id !== id);
          if (dup) {
            json(res, { ok: false, error: "Another post with this url already exists" }, 409);
            return;
          }
          post.url = nextUrl;
        }

        if (parsed.value.active !== undefined) post.active = Boolean(parsed.value.active);

        if (parsed.value.name !== undefined) post.name = String(parsed.value.name || "").trim();

        if (parsed.value.image !== undefined) {
          const raw = String(parsed.value.image || "").trim();
          const img = normalizeOptionalUrl(raw);
          if (raw !== "" && !img) {
            json(res, { ok: false, error: "Invalid image url (must start with http/https or be empty)" }, 400);
            return;
          }
          post.image = img;
        }

        if (parsed.value.description !== undefined) post.description = String(parsed.value.description || "").trim();

        post.updatedAt = nowIso();
        writePosts(POSTS_PATH, posts);
        json(res, { ok: true, post });
        return;
      }

      // ===== POSTS: DELETE =====
      const mDel = req.method === "DELETE" ? match(pathname, "/api/posts/:id") : null;
      if (mDel) {
        const id = mDel.id;
        const posts = readPosts(POSTS_PATH);
        const idx = posts.findIndex((p) => p.id === id);
        if (idx === -1) {
          json(res, { ok: false, error: "Post not found" }, 404);
          return;
        }
        const removed = posts.splice(idx, 1)[0];
        writePosts(POSTS_PATH, posts);
        json(res, { ok: true, removed });
        return;
      }

      // ===== COOKIES: CLEAR =====
      if (req.method === "POST" && pathname === "/api/cookies/clear") {
        const bodyRaw = await readBody(req);
        const parsed = safeJsonParse(bodyRaw || "{}");
        const confirm = parsed.ok ? Boolean(parsed.value.confirm) : false;

        if (!confirm) {
          json(res, { ok: false, error: "Set {confirm:true} to clear cookies" }, 400);
          return;
        }

        atomicWriteFile(COOKIES_PATH, "[]\n");
        json(res, { ok: true, cookiesPath: COOKIES_PATH });
        return;
      }

      // ===== PM2 =====
      function okOrErr(r, fallbackErr = "Command failed") {
        if (r.ok) return { ok: true, output: stripAnsi(r.stdout || r.stderr || "") };
        return { ok: false, error: stripAnsi(r.stderr || r.stdout || fallbackErr) };
      }
      async function pm2Describe(name) {
        return await sh(`pm2 describe ${name}`);
      }

      const WATCH_ENTRY = path.join(PROJECT_DIR, "src", "bootstrap.js");
      const WATCH_NAME = PM2_APP || "fbwatcher";

      if (req.method === "POST" && pathname === "/api/pm2/start") {
        const d = await pm2Describe(WATCH_NAME);
        if (d.ok) {
          const r = await sh(`pm2 start ${WATCH_NAME}`);
          json(res, okOrErr(r, "PM2 start failed"));
          return;
        }

        const r = await sh(`pm2 start "${WATCH_ENTRY}" --name "${WATCH_NAME}"`);
        json(res, okOrErr(r, `Cannot create PM2 process for ${WATCH_NAME}`));
        return;
      }

      if (req.method === "POST" && pathname === "/api/pm2/restart") {
        const d = await pm2Describe(WATCH_NAME);
        if (!d.ok) {
          json(res, { ok: false, error: `Process ${WATCH_NAME} not found. Click PM2 Start first.` });
          return;
        }
        const r = await sh(`pm2 restart ${WATCH_NAME} --update-env`);
        json(res, okOrErr(r, "PM2 restart failed"));
        return;
      }

      if (req.method === "POST" && pathname === "/api/pm2/stop") {
        const d = await pm2Describe(WATCH_NAME);
        if (!d.ok) {
          json(res, { ok: false, error: `Process ${WATCH_NAME} not found.` });
          return;
        }
        const r = await sh(`pm2 stop ${WATCH_NAME}`);
        json(res, okOrErr(r, "PM2 stop failed"));
        return;
      }

      if (req.method === "GET" && pathname === "/api/pm2/status") {
        const r = await sh(`pm2 status ${WATCH_NAME}`);
        json(res, okOrErr(r, "PM2 status failed"));
        return;
      }

      // ===== LOGS INFO (debug) =====
      if (req.method === "GET" && pathname === "/api/logs/info") {
        const paths = await getPm2LogPaths(PM2_APP);
        json(res, { ok: true, app: PM2_APP, ...paths });
        return;
      }

      // ===== LOGS =====
      if (req.method === "GET" && pathname === "/api/logs/out") {
        const lines = Math.min(Math.max(parseInt(query.lines || "200", 10) || 200, 20), 2000);
        const paths = await getPm2LogPaths(PM2_APP);
        const payload = await readTailLog(paths.out, lines);
        json(res, { ...payload, source: paths.source });
        return;
      }

      if (req.method === "GET" && pathname === "/api/logs/err") {
        const lines = Math.min(Math.max(parseInt(query.lines || "200", 10) || 200, 20), 2000);
        const paths = await getPm2LogPaths(PM2_APP);
        const payload = await readTailLog(paths.err, lines);
        json(res, { ...payload, source: paths.source });
        return;
      }

      // ===== COOKIES: STATUS =====
      if (req.method === "GET" && pathname === "/api/cookies/status") {
        const mainExists = fs.existsSync(COOKIES_PATH);
        let mainAge = undefined;
        let mainSize = undefined;

        if (mainExists) {
          const stat = fs.statSync(COOKIES_PATH);
          mainSize = stat.size;
          mainAge = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60); // hours
        }

        json(res, {
          ok: true,
          mainCookiesExists: mainExists,
          mainCookiesAge: mainAge,
          mainCookiesSize: mainSize,
          isLoggedIn: mainExists && mainSize > 10,
        });
        return;
      }

      // ===== LITE: KEYWORDS =====
      const KEYWORDS_PATH = path.join(PROJECT_DIR, "data", "keywords.json");

      /**
       * Ładuje i normalizuje keywords do nowego formatu { text, enabled }
       */
      function readKeywords() {
        if (!fs.existsSync(KEYWORDS_PATH)) {
          return { keywords: [], enabled: false };
        }
        const raw = fs.readFileSync(KEYWORDS_PATH, "utf8").trim();
        if (!raw) return { keywords: [], enabled: false };
        const parsed = safeJsonParse(raw);
        if (!parsed.ok || !parsed.value) return { keywords: [], enabled: false };

        const data = parsed.value;

        // Normalizacja - obsługa starego formatu (string[]) i nowego ({ text, enabled }[])
        let keywords = [];
        if (Array.isArray(data.keywords)) {
          keywords = data.keywords.map(k => {
            if (typeof k === "string") {
              // Stary format - konwertuj na nowy
              return { text: k, enabled: true };
            }
            // Nowy format
            return { text: String(k.text || ""), enabled: k.enabled !== false };
          }).filter(k => k.text);
        }

        return {
          keywords,
          enabled: Boolean(data.enabled),
        };
      }

      function writeKeywords(data) {
        atomicWriteFile(KEYWORDS_PATH, JSON.stringify(data, null, 2) + "\n");
      }

      // GET /api/keywords - pobierz listę keywords
      if (req.method === "GET" && pathname === "/api/keywords") {
        const data = readKeywords();
        json(res, { ok: true, ...data });
        return;
      }

      // POST /api/keywords - dodaj keyword
      if (req.method === "POST" && pathname === "/api/keywords") {
        const bodyRaw = await readBody(req);
        const parsed = safeJsonParse(bodyRaw || "{}");
        if (!parsed.ok) {
          json(res, { ok: false, error: "Invalid JSON body" }, 400);
          return;
        }

        const keyword = String(parsed.value.keyword || "").trim();
        if (!keyword) {
          json(res, { ok: false, error: "Keyword is required" }, 400);
          return;
        }

        const data = readKeywords();
        const exists = data.keywords.some(k => k.text === keyword);
        if (!exists) {
          data.keywords.push({ text: keyword, enabled: true });
          writeKeywords(data);
        }
        json(res, { ok: true, keywords: data.keywords });
        return;
      }

      // PUT /api/keywords/:keyword/toggle - włącz/wyłącz pojedynczy keyword
      const mKeywordToggle = req.method === "PUT" ? match(pathname, "/api/keywords/:keyword/toggle") : null;
      if (mKeywordToggle) {
        const keyword = decodeURIComponent(mKeywordToggle.keyword);
        const data = readKeywords();
        const kw = data.keywords.find(k => k.text === keyword);

        if (!kw) {
          json(res, { ok: false, error: "Keyword not found" }, 404);
          return;
        }

        kw.enabled = !kw.enabled;
        writeKeywords(data);
        json(res, { ok: true, keyword: kw, keywords: data.keywords });
        return;
      }

      // DELETE /api/keywords/:keyword - usuń keyword
      const mKeywordDel = req.method === "DELETE" ? match(pathname, "/api/keywords/:keyword") : null;
      if (mKeywordDel) {
        const keyword = decodeURIComponent(mKeywordDel.keyword);
        const data = readKeywords();
        const idx = data.keywords.findIndex(k => k.text === keyword);

        if (idx === -1) {
          json(res, { ok: false, error: "Keyword not found" }, 404);
          return;
        }

        data.keywords.splice(idx, 1);
        writeKeywords(data);
        json(res, { ok: true, keywords: data.keywords });
        return;
      }

      // PUT /api/keywords/enabled - włącz/wyłącz skanowanie (globalny switch)
      if (req.method === "PUT" && pathname === "/api/keywords/enabled") {
        const bodyRaw = await readBody(req);
        const parsed = safeJsonParse(bodyRaw || "{}");
        if (!parsed.ok) {
          json(res, { ok: false, error: "Invalid JSON body" }, 400);
          return;
        }

        const enabled = Boolean(parsed.value.enabled);
        const data = readKeywords();
        data.enabled = enabled;
        writeKeywords(data);
        json(res, { ok: true, enabled: data.enabled });
        return;
      }

      // ===== LITE: DISCOVERIES =====
      const DISCOVERIES_PATH = path.join(PROJECT_DIR, "data", "discoveries.json");
      const BLACKLIST_PATH = path.join(PROJECT_DIR, "data", "blacklist.json");

      function readDiscoveries() {
        if (!fs.existsSync(DISCOVERIES_PATH)) return [];
        const raw = fs.readFileSync(DISCOVERIES_PATH, "utf8").trim();
        if (!raw) return [];
        const parsed = safeJsonParse(raw);
        return parsed.ok && Array.isArray(parsed.value) ? parsed.value : [];
      }

      function writeDiscoveries(data) {
        atomicWriteFile(DISCOVERIES_PATH, JSON.stringify(data, null, 2) + "\n");
      }

      function readBlacklist() {
        if (!fs.existsSync(BLACKLIST_PATH)) return [];
        const raw = fs.readFileSync(BLACKLIST_PATH, "utf8").trim();
        if (!raw) return [];
        const parsed = safeJsonParse(raw);
        return parsed.ok && Array.isArray(parsed.value) ? parsed.value : [];
      }

      function writeBlacklist(data) {
        atomicWriteFile(BLACKLIST_PATH, JSON.stringify(data, null, 2) + "\n");
      }

      // GET /api/discoveries - lista pending discoveries
      if (req.method === "GET" && pathname === "/api/discoveries") {
        const discoveries = readDiscoveries();
        const pending = discoveries.filter((d) => d.status === "pending");
        json(res, { ok: true, discoveries: pending, total: discoveries.length });
        return;
      }

      // POST /api/discoveries/:id/approve - akceptuj discovery
      const mApprove = req.method === "POST" ? match(pathname, "/api/discoveries/:id/approve") : null;
      if (mApprove) {
        const id = mApprove.id;
        const discoveries = readDiscoveries();
        const idx = discoveries.findIndex((d) => d.id === id);

        if (idx === -1) {
          json(res, { ok: false, error: "Discovery not found" }, 404);
          return;
        }

        const discovery = discoveries[idx];
        discovery.status = "approved";
        discovery.approvedAt = nowIso();

        // Usuń z discoveries
        discoveries.splice(idx, 1);
        writeDiscoveries(discoveries);

        // Dodaj do posts.json
        const posts = readPosts(POSTS_PATH);
        const existingPost = posts.find((p) => p.url === discovery.url);

        if (!existingPost) {
          const newPost = {
            id: genId(),
            url: discovery.url,
            active: true,
            name: `[DISC] ${discovery.pageName || "Unknown"}`,
            image: "",
            description: `Keywords: ${(discovery.matchedKeywords || []).join(", ")}`,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            source: "discovery",
            discoveryId: discovery.id,
          };
          posts.push(newPost);
          writePosts(POSTS_PATH, posts);
          json(res, { ok: true, discovery, post: newPost });
        } else {
          json(res, { ok: true, discovery, post: existingPost, note: "Post already exists" });
        }
        return;
      }

      // POST /api/discoveries/:id/reject - odrzuć discovery
      const mReject = req.method === "POST" ? match(pathname, "/api/discoveries/:id/reject") : null;
      if (mReject) {
        const id = mReject.id;
        const discoveries = readDiscoveries();
        const idx = discoveries.findIndex((d) => d.id === id);

        if (idx === -1) {
          json(res, { ok: false, error: "Discovery not found" }, 404);
          return;
        }

        const discovery = discoveries[idx];

        // Dodaj do blacklist
        const blacklist = readBlacklist();
        blacklist.push({
          id: discovery.id,
          url: discovery.url,
          reason: "user_rejected",
          rejectedAt: nowIso(),
          content: discovery.content,
          pageName: discovery.pageName,
        });
        writeBlacklist(blacklist);

        // Usuń z discoveries
        discoveries.splice(idx, 1);
        writeDiscoveries(discoveries);

        json(res, { ok: true, discovery });
        return;
      }

      // POST /api/discoveries/approve-all - akceptuj wszystkie
      if (req.method === "POST" && pathname === "/api/discoveries/approve-all") {
        const discoveries = readDiscoveries();
        const pending = discoveries.filter((d) => d.status === "pending");
        const posts = readPosts(POSTS_PATH);
        const approved = [];

        for (const d of pending) {
          d.status = "approved";
          d.approvedAt = nowIso();

          const existingPost = posts.find((p) => p.url === d.url);
          if (!existingPost) {
            const newPost = {
              id: genId(),
              url: d.url,
              active: true,
              name: `[DISC] ${d.pageName || "Unknown"}`,
              image: "",
              description: `Keywords: ${(d.matchedKeywords || []).join(", ")}`,
              createdAt: nowIso(),
              updatedAt: nowIso(),
              source: "discovery",
              discoveryId: d.id,
            };
            posts.push(newPost);
            approved.push({ discovery: d, post: newPost });
          } else {
            approved.push({ discovery: d, post: existingPost, note: "Post already exists" });
          }
        }

        // Usuń zatwierdzone z discoveries
        const remaining = discoveries.filter((d) => d.status !== "approved");
        writeDiscoveries(remaining);
        writePosts(POSTS_PATH, posts);

        json(res, { ok: true, approved, count: approved.length });
        return;
      }

      // POST /api/discoveries/reject-all - odrzuć wszystkie
      if (req.method === "POST" && pathname === "/api/discoveries/reject-all") {
        const discoveries = readDiscoveries();
        const pending = discoveries.filter((d) => d.status === "pending");
        const blacklist = readBlacklist();

        for (const d of pending) {
          blacklist.push({
            id: d.id,
            url: d.url,
            reason: "bulk_rejected",
            rejectedAt: nowIso(),
            content: d.content,
            pageName: d.pageName,
          });
        }

        writeBlacklist(blacklist);

        // Usuń odrzucone z discoveries
        const remaining = discoveries.filter((d) => d.status !== "pending");
        writeDiscoveries(remaining);

        json(res, { ok: true, rejected: pending.length });
        return;
      }

      // ===== LITE: BLACKLIST =====

      // GET /api/blacklist - lista blacklist
      if (req.method === "GET" && pathname === "/api/blacklist") {
        const blacklist = readBlacklist();
        json(res, { ok: true, blacklist, total: blacklist.length });
        return;
      }

      // DELETE /api/blacklist/:id - usuń z blacklist
      const mBlacklistDel = req.method === "DELETE" ? match(pathname, "/api/blacklist/:id") : null;
      if (mBlacklistDel) {
        const id = mBlacklistDel.id;
        const blacklist = readBlacklist();
        const idx = blacklist.findIndex((b) => b.id === id);

        if (idx === -1) {
          json(res, { ok: false, error: "Blacklist entry not found" }, 404);
          return;
        }

        const removed = blacklist.splice(idx, 1)[0];
        writeBlacklist(blacklist);

        json(res, { ok: true, removed });
        return;
      }

      // POST /api/blacklist - dodaj do blacklist ręcznie
      if (req.method === "POST" && pathname === "/api/blacklist") {
        const bodyRaw = await readBody(req);
        const parsed = safeJsonParse(bodyRaw || "{}");
        if (!parsed.ok) {
          json(res, { ok: false, error: "Invalid JSON body" }, 400);
          return;
        }

        const url = normalizeUrl(parsed.value.url);
        const reason = String(parsed.value.reason || "manual").trim();

        if (!url) {
          json(res, { ok: false, error: "Invalid url" }, 400);
          return;
        }

        const blacklist = readBlacklist();
        const existing = blacklist.find((b) => b.url === url);

        if (existing) {
          json(res, { ok: false, error: "URL already in blacklist" }, 409);
          return;
        }

        const entry = {
          id: `bl_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
          url,
          reason,
          rejectedAt: nowIso(),
        };

        blacklist.push(entry);
        writeBlacklist(blacklist);

        json(res, { ok: true, entry });
        return;
      }

      // ===== STATS API =====
      const STATS_PATH = path.join(PROJECT_DIR, "data", "stats.json");
      const CACHE_PATH = path.join(PROJECT_DIR, "data", "comments-cache.json");
      const DEAD_POSTS_PATH = path.join(PROJECT_DIR, "data", "dead-posts.json");

      function readStatsFile() {
        if (!fs.existsSync(STATS_PATH)) {
          return {
            global: { totalCommentsSent: 0, cyclesCompleted: 0, startedAt: null, lastCycleAt: null },
            daily: {},
          };
        }
        const raw = fs.readFileSync(STATS_PATH, "utf8").trim();
        if (!raw) return { global: { totalCommentsSent: 0, cyclesCompleted: 0, startedAt: null, lastCycleAt: null }, daily: {} };
        const parsed = safeJsonParse(raw);
        return parsed.ok ? parsed.value : { global: { totalCommentsSent: 0, cyclesCompleted: 0, startedAt: null, lastCycleAt: null }, daily: {} };
      }

      function readCacheFile() {
        if (!fs.existsSync(CACHE_PATH)) return {};
        const raw = fs.readFileSync(CACHE_PATH, "utf8").trim();
        if (!raw) return {};
        const parsed = safeJsonParse(raw);
        return parsed.ok ? parsed.value : {};
      }

      function readDeadPosts() {
        if (!fs.existsSync(DEAD_POSTS_PATH)) return [];
        const raw = fs.readFileSync(DEAD_POSTS_PATH, "utf8").trim();
        if (!raw) return [];
        const parsed = safeJsonParse(raw);
        return parsed.ok && Array.isArray(parsed.value) ? parsed.value : [];
      }

      function writeDeadPosts(data) {
        atomicWriteFile(DEAD_POSTS_PATH, JSON.stringify(data, null, 2) + "\n");
      }

      // Funkcja obliczająca tier posta
      function calculatePostTier(stats, daysSinceLastComment) {
        if (daysSinceLastComment === null) return "active"; // Brak danych = zakładamy aktywny
        if (daysSinceLastComment > 14) return "dead";
        if (daysSinceLastComment > 7) return "weak";
        if (daysSinceLastComment < 1 && stats && stats.totalDetected > 0) return "hot";
        return "active";
      }

      // Funkcja formatująca wiek - preferuje lastCommentTime (rzeczywisty czas z FB)
      function formatLastCommentAge(stats) {
        if (!stats) return null;
        // Priorytet: lastCommentTime (czas komentarza z FB) > lastNewCommentAt (czas wykrycia przez bota)
        const timeSource = stats.lastCommentTime || stats.lastNewCommentAt;
        if (!timeSource) return null;
        const lastTime = new Date(timeSource);
        const diffMs = Date.now() - lastTime.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        if (diffDays > 0) return `${diffDays} ${diffDays === 1 ? "dzień" : "dni"}`;
        if (diffHours > 0) return `${diffHours} godz`;
        return "< 1 godz";
      }

      // Funkcja obliczająca dni od ostatniego komentarza
      function getDaysSinceLastComment(stats) {
        if (!stats) return null;
        const timeSource = stats.lastCommentTime || stats.lastNewCommentAt;
        if (!timeSource) return null;
        const lastTime = new Date(timeSource);
        return (Date.now() - lastTime.getTime()) / (1000 * 60 * 60 * 24);
      }

      // GET /api/stats - pełne statystyki
      if (req.method === "GET" && pathname === "/api/stats") {
        const statsData = readStatsFile();
        const cacheData = readCacheFile();
        const deadPosts = readDeadPosts();
        const posts = readPosts(POSTS_PATH);

        // Zbuduj Set ID martwych postów do szybkiego filtrowania
        const deadPostIds = new Set(deadPosts.map((dp) => dp.id));

        // Filtruj martwe posty z listy (są już w /api/dead-posts)
        const livePosts = posts.filter((p) => !deadPostIds.has(p.id));

        // Buduj listę postów z statystykami
        const postsWithStats = livePosts.map((post) => {
          const cacheEntry = cacheData[post.url];
          const stats = cacheEntry?.stats || null;

          const daysSinceLastComment = getDaysSinceLastComment(stats);
          const tier = calculatePostTier(stats, daysSinceLastComment);

          return {
            ...post,
            stats: stats || undefined,
            tier,
            daysSinceLastComment: daysSinceLastComment !== null ? Math.floor(daysSinceLastComment) : null,
            lastCommentAge: formatLastCommentAge(stats),
            // Dodaj info o źródle czasu (do debugowania)
            lastCommentSource: stats?.lastCommentTime ? "fb" : stats?.lastNewCommentAt ? "bot" : null,
          };
        });

        // Sortuj po liczbie wykrytych komentarzy (malejąco)
        postsWithStats.sort((a, b) => {
          const aComments = a.stats?.totalDetected || 0;
          const bComments = b.stats?.totalDetected || 0;
          return bComments - aComments;
        });

        const activePosts = livePosts.filter((p) => p.active !== false).length;

        json(res, {
          ok: true,
          summary: {
            totalPosts: livePosts.length,
            activePosts,
            deadPosts: deadPosts.length,
            totalComments: statsData.global?.totalCommentsSent || 0,
            lastCycleAt: statsData.global?.lastCycleAt || null,
            cyclesCompleted: statsData.global?.cyclesCompleted || 0,
            // Nowe pola - info o sesji
            startedAt: statsData.global?.startedAt || null,
            lastSessionStart: statsData.global?.lastSessionStart || null,
            restartCount: statsData.global?.restartCount || 0,
          },
          posts: postsWithStats,
          daily: statsData.daily || {},
        });
        return;
      }

      // GET /api/dead-posts - lista martwych postów
      if (req.method === "GET" && pathname === "/api/dead-posts") {
        const deadPosts = readDeadPosts();
        json(res, { ok: true, deadPosts, total: deadPosts.length });
        return;
      }

      // POST /api/dead-posts/:id/reactivate - reaktywuj martwy post
      const mReactivate = req.method === "POST" ? match(pathname, "/api/dead-posts/:id/reactivate") : null;
      if (mReactivate) {
        const id = mReactivate.id;
        const deadPosts = readDeadPosts();
        const idx = deadPosts.findIndex((dp) => dp.id === id);

        if (idx === -1) {
          json(res, { ok: false, error: "Dead post not found" }, 404);
          return;
        }

        const deadPost = deadPosts[idx];

        // Sprawdź czy post już istnieje w watched
        const posts = readPosts(POSTS_PATH);
        const existingPost = posts.find((p) => p.url === deadPost.url || p.id === deadPost.id);

        if (existingPost) {
          // Post już istnieje, tylko aktywuj go
          existingPost.active = true;
          existingPost.updatedAt = nowIso();
          writePosts(POSTS_PATH, posts);
        } else {
          // Dodaj post z powrotem do watched
          const newPost = {
            id: deadPost.id,
            url: deadPost.url,
            name: deadPost.name,
            active: true,
            image: "",
            description: `Reaktywowany ${nowIso()}`,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };
          posts.push(newPost);
          writePosts(POSTS_PATH, posts);
        }

        // Usuń z dead-posts
        deadPosts.splice(idx, 1);
        writeDeadPosts(deadPosts);

        json(res, { ok: true, reactivated: deadPost });
        return;
      }

      // ===== MARKETPLACE API =====
      const MARKETPLACE_DATA_DIR = path.join(PROJECT_DIR, "data", "marketplace");

      function readMarketplaceFile(filename, defaultValue = {}) {
        const filePath = path.join(MARKETPLACE_DATA_DIR, filename);
        if (!fs.existsSync(filePath)) return defaultValue;
        const raw = fs.readFileSync(filePath, "utf8").trim();
        if (!raw) return defaultValue;
        const parsed = safeJsonParse(raw);
        return parsed.ok ? parsed.value : defaultValue;
      }

      function writeMarketplaceFile(filename, data) {
        ensureDir(MARKETPLACE_DATA_DIR);
        const filePath = path.join(MARKETPLACE_DATA_DIR, filename);
        atomicWriteFile(filePath, JSON.stringify(data, null, 2) + "\n");
      }

      // GET /api/marketplace/status
      if (req.method === "GET" && pathname === "/api/marketplace/status") {
        try {
          const { marketplaceApi } = await import("../marketplace/index.js");
          const status = marketplaceApi.getStatus();
          json(res, { ok: true, ...status });
        } catch (err) {
          json(res, { ok: false, error: err.message }, 500);
        }
        return;
      }

      // GET /api/marketplace/listings
      if (req.method === "GET" && pathname === "/api/marketplace/listings") {
        try {
          const { marketplaceApi } = await import("../marketplace/index.js");
          const published = marketplaceApi.getPublished();
          json(res, { ok: true, listings: published.listings || [] });
        } catch (err) {
          json(res, { ok: false, error: err.message }, 500);
        }
        return;
      }

      // GET /api/marketplace/content-pool
      if (req.method === "GET" && pathname === "/api/marketplace/content-pool") {
        try {
          const { marketplaceApi } = await import("../marketplace/index.js");
          const pool = marketplaceApi.getContentPool();
          json(res, { ok: true, pool });
        } catch (err) {
          json(res, { ok: false, error: err.message }, 500);
        }
        return;
      }

      // PUT /api/marketplace/content-pool
      if (req.method === "PUT" && pathname === "/api/marketplace/content-pool") {
        const bodyRaw = await readBody(req);
        const parsed = safeJsonParse(bodyRaw || "{}");
        if (!parsed.ok) {
          json(res, { ok: false, error: "Invalid JSON body" }, 400);
          return;
        }

        const pool = parsed.value.pool;
        if (!pool) {
          json(res, { ok: false, error: "Missing pool object" }, 400);
          return;
        }

        try {
          const { marketplaceApi } = await import("../marketplace/index.js");

          // Walidacja struktury
          const validation = marketplaceApi.validatePool(pool);
          if (!validation.valid) {
            json(res, { ok: false, error: `Validation failed: ${validation.errors.join(", ")}` }, 400);
            return;
          }

          marketplaceApi.saveContentPool(pool);
          json(res, { ok: true });
        } catch (err) {
          json(res, { ok: false, error: err.message }, 500);
        }
        return;
      }

      // GET /api/marketplace/renewals
      if (req.method === "GET" && pathname === "/api/marketplace/renewals") {
        const limit = Math.min(Math.max(parseInt(query.limit || "50", 10) || 50, 1), 1000);
        try {
          const { marketplaceApi } = await import("../marketplace/index.js");
          const renewals = marketplaceApi.getRenewalLog();
          const log = (renewals.log || []).slice(0, limit);
          json(res, { ok: true, log, stats: renewals.stats || {} });
        } catch (err) {
          json(res, { ok: false, error: err.message }, 500);
        }
        return;
      }

      // GET /api/marketplace/random-content
      if (req.method === "GET" && pathname === "/api/marketplace/random-content") {
        try {
          const { marketplaceApi } = await import("../marketplace/index.js");
          const content = marketplaceApi.getRandomContent();
          if (!content) {
            json(res, { ok: false, error: "Brak aktywnych kategorii w puli treści" }, 400);
            return;
          }
          json(res, { ok: true, content });
        } catch (err) {
          json(res, { ok: false, error: err.message }, 500);
        }
        return;
      }

      // POST /api/marketplace/manual-renew
      if (req.method === "POST" && pathname === "/api/marketplace/manual-renew") {
        try {
          const { marketplaceApi } = await import("../marketplace/index.js");
          const result = await marketplaceApi.manualRenewal();
          json(res, { ok: true, result });
        } catch (err) {
          json(res, { ok: false, error: err.message }, 500);
        }
        return;
      }

      // POST /api/marketplace/manual-publish
      if (req.method === "POST" && pathname === "/api/marketplace/manual-publish") {
        try {
          const { marketplaceApi } = await import("../marketplace/index.js");
          const result = await marketplaceApi.manualPublish();
          json(res, { ok: true, result });
        } catch (err) {
          json(res, { ok: false, error: err.message }, 500);
        }
        return;
      }

      // POST /api/marketplace/scheduler/stop
      if (req.method === "POST" && pathname === "/api/marketplace/scheduler/stop") {
        try {
          const { marketplaceApi } = await import("../marketplace/index.js");
          marketplaceApi.stopScheduler("Stopped from panel");
          json(res, { ok: true });
        } catch (err) {
          json(res, { ok: false, error: err.message }, 500);
        }
        return;
      }

      // POST /api/marketplace/scheduler/resume
      if (req.method === "POST" && pathname === "/api/marketplace/scheduler/resume") {
        try {
          const { marketplaceApi } = await import("../marketplace/index.js");
          marketplaceApi.resumeScheduler();
          json(res, { ok: true });
        } catch (err) {
          json(res, { ok: false, error: err.message }, 500);
        }
        return;
      }

      json(res, { ok: false, error: "Not found" }, 404);
    } catch (e) {
      json(res, { ok: false, error: e.message }, 500);
    }
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`[PANEL] listening on http://127.0.0.1:${PORT} (PM2_APP=${PM2_APP})`);
    console.log(`[PANEL] UI_DIR=${UI_DIR}`);
    console.log(`[PANEL] BASE_DIR=${BASE_DIR}`);
  });
