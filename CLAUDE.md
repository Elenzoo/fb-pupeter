# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FB_Watcher is a Node.js Puppeteer-based Facebook comment monitoring bot with anti-detection features, an admin panel (React + Tailwind), and Telegram integration. It monitors specified Facebook posts for new comments and sends notifications via Telegram.

## Commands

```bash
# Start application (ALWAYS use bootstrap.js, never index.js directly!)
node src/bootstrap.js

# Start with remote browser debugging
REMOTE_DEBUG_PORT=9222 node src/bootstrap.js

# PM2 production
pm2 start /opt/fb-watcher/src/bootstrap.js --name fb-watcher --cwd /opt/fb-watcher
pm2 logs fb-watcher
pm2 restart fb-watcher

# Panel API only (runs on port 3180)
node src/panel/api.js

# Panel React UI development
cd src/panel/web && npm install && npm run dev

# Panel React UI build
cd src/panel/web && npm run build

# Panel React UI lint
cd src/panel/web && npm run lint

# Generate cookies manually
node scripts/generate-cookies.js

# Meta Ads Scanner (single scan)
node src/metaads/index.js --keywords "garaże blaszane" --once

# Meta Ads Scanner (debug mode - visible browser)
METAADS_HEADLESS=false METAADS_DEBUG=true node src/metaads/index.js --keywords "garaż" --once
```

## Architecture

### Entry Point - Bootstrap Pattern

**Critical:** ESM import hoisting causes `config.js` and `logger.js` to read `process.env` before `.env` is loaded. The project uses a Bootstrap Pattern:

```
src/bootstrap.js → dotenv.config() → import("./index.js") → config.js, logger.js
```

Always start the application via `bootstrap.js`, never `index.js` directly.

### Core Modules

| Module | Path | Purpose |
|--------|------|---------|
| **Watcher** | `src/watcher.js` | Main monitoring loop, orchestrates cycles |
| **Login** | `src/fb/login.js` | Facebook authentication, 2FA handling, captcha |
| **Comments** | `src/fb/comments.js` | Comment extraction and parsing |
| **Telegram** | `src/telegram.js` | Notification delivery (owner + client channels) |
| **Config** | `src/config.js` | Centralized env variable exports |
| **Logger** | `src/utils/logger.js` | Structured logging (0=silent, 1=prod, 2=dev, 3=debug) |

### LITE Module (Anti-Detection)

The `src/lite/` directory contains advanced anti-detection features:

- **antiDetection.js**: Random viewports, session fingerprints
- **warmup.js**: 5-10 min natural activity before monitoring
- **nightMode.js**: Sleep 22:00-7:00, morning catch-up
- **feedScanner.js**: Scan feed by keywords, save discoveries
- **humanBehavior.js**: Coordinates human-like actions (uses Puppeteer mouse API)
- **smoothScroll.js**: Bezier curve easing for natural scrolling

### Panel

- **API**: `src/panel/api.js` - HTTP server on port 3180, Bearer token auth (`PANEL_TOKEN`)
- **React UI**: `src/panel/web/` - React 18, Vite, Tailwind CSS, TypeScript

### Data Files

| File | Purpose |
|------|---------|
| `data/posts.json` | Watched posts (panel-managed) |
| `data/comments-cache.json` | Deduplication cache |
| `data/discoveries.json` | Feed scanner findings |
| `data/blacklist.json` | Rejected posts |
| `data/metaads-cache.json` | Ad scanner cache |
| `cookies.json` | Active session cookies |

### Post Sources (Priority Order)

1. `POSTS_API_URL` - Panel API (primary)
2. `data/posts.json` - Local file (fallback)
3. `POSTS_SHEET_URL` - Google Sheets CSV (last resort)

## Key Implementation Details

### Human Behavior Pattern

Functions using `humanClick()` follow the "mark + click" pattern because Puppeteer mouse API cannot be called from inside `page.evaluate()`:

1. In `page.evaluate()`: find element, mark with `data-hb-click-*` attribute
2. Return to Node.js context
3. Use `page.$()` to get ElementHandle
4. Call `humanClick()` with Bezier curve mouse movement
5. Remove marker

### Stealth

- `puppeteer-extra-plugin-stealth` enabled
- Random delays between actions
- Shuffled post processing order (Fisher-Yates)
- Gaussian distribution for timing

### Cookies

- Location: `cookies.json` in root directory
- Format: Puppeteer cookie array
- Atomic writes for safety

### Captcha

- Service: 2Captcha.com via `puppeteer-extra-plugin-recaptcha`
- Supports reCAPTCHA v2/v3 and hCaptcha
- Configured via `CAPTCHA_API_KEY` env variable

## File Reference

| File | Key Functions |
|------|---------------|
| `src/watcher.js` | `startWatcher()`, `processPost()`, `fetchPosts()` |
| `src/fb/login.js` | `doLogin()`, `setupCaptchaSolver()` |
| `src/fb/comments.js` | `extractComments()`, `parseComment()` |
| `src/telegram.js` | `sendNotification()`, `formatMessage()` |
| `src/fb/checkpoint.js` | `detectCheckpoint()`, `handleCheckpoint()` |
| `src/fb/cookies.js` | `loadCookies()`, `saveCookies()` |
| `src/db/cache.js` | `getCache()`, `updateCache()` |
| `src/utils/mouse.js` | `humanClick()`, `moveToElement()` |
| `src/lite/humanBehavior.js` | `humanClick()`, `betweenPostsPause()`, `createHumanBehavior()` |
| `src/lite/feedScanner.js` | `scanFeed()`, `approveDiscovery()` |
| `src/metaads/scanner.js` | `scanKeyword()` |
| `src/metaads/extractor.js` | `extractAdsFromPage()`, `extractPostUrlFromSnapshot()` |

## Configuration (.env)

Key environment variables:

```bash
# Facebook account
FB_EMAIL=email@example.com
FB_PASSWORD=password

# Monitoring
CHECK_INTERVAL_MS=60000
FAST_MODE=true
FAST_MAX_AGE_MIN=180
LOG_LEVEL=1  # 0=silent, 1=prod, 2=dev, 3=debug

# Panel
PANEL_PORT=3180
PANEL_TOKEN=fbw_...

# Telegram (two channels: owner + client)
TELEGRAM_BOT_TOKEN_OWNER=...
TELEGRAM_CHAT_ID_OWNER=...
TELEGRAM_BOT_TOKEN_CLIENT=...
TELEGRAM_CHAT_ID_CLIENT=...

# Captcha
CAPTCHA_API_KEY=...

# Remote Debug
REMOTE_DEBUG_PORT=9222  # 0=disabled

# LITE module
WARMUP_ENABLED=true
NIGHT_MODE_ENABLED=false
FEED_SCAN_ENABLED=false
HUMAN_MODE=true
VIEWPORT_RANDOMIZATION=true
```

## Server

- IP: `162.55.188.103`
- Path: `/opt/fb-watcher`
- System: Ubuntu 24.04.3 LTS
- Process manager: PM2

```bash
# SSH with remote debug tunnel
ssh -L 9222:localhost:9222 root@162.55.188.103
```

## Deployment Workflow

```bash
# 1. Create deploy branch with timestamp
git checkout -b deploy/YYYYMMDD-HHMMSS

# 2. Commit and push
git add . && git commit -m "description"
git push -u origin HEAD

# 3. On server
ssh root@162.55.188.103
cd /opt/fb-watcher
git fetch && git checkout <branch>
pm2 restart fb-watcher
```

---

## SZCZEGÓŁOWA MAPA PROJEKTU

### Struktura katalogów

```
/opt/fb-watcher/
├── src/                          # Główny kod aplikacji
│   ├── bootstrap.js              # Entry point (ładuje .env przed importami)
│   ├── index.js                  # Główna inicjalizacja
│   ├── config.js                 # Centralne eksporty z .env (60+ zmiennych)
│   ├── watcher.js                # Główna pętla monitoringu
│   ├── telegram.js               # Powiadomienia Telegram
│   ├── fb/                       # Moduły interakcji z Facebookiem
│   │   ├── login.js              # Logowanie & obsługa 2FA
│   │   ├── comments.js           # Ekstrakcja i parsowanie komentarzy
│   │   ├── cookies.js            # Zarządzanie ciasteczkami
│   │   ├── checkpoint.js         # Wykrywanie checkpoint/2FA
│   │   ├── scroll.js             # Scrollowanie strony
│   │   ├── expandButtons.js      # Rozwijanie komentarzy
│   │   ├── uiCommentInfo.js      # Parsowanie DOM komentarzy
│   │   └── ui/                   # Handlery typów UI
│   │       ├── index.js          # Router
│   │       ├── post.js           # Post/permalink handler
│   │       ├── photo.js          # Photo handler
│   │       ├── videos.js         # Videos handler
│   │       └── watch.js          # Watch/video page handler
│   ├── panel/                    # Panel admina (API + React UI)
│   │   ├── api.js                # HTTP API server (port 3180)
│   │   ├── panel-entry.cjs       # Entry point dla executable
│   │   └── web/                  # React 18 + Vite + Tailwind
│   │       ├── src/              # Źródła React
│   │       └── dist/             # Zbudowane assety
│   ├── lite/                     # Anti-detection & ludzkie zachowania
│   │   ├── antiDetection.js      # Randomizacja viewport, fingerprint sesji
│   │   ├── humanBehavior.js      # Koordynacja ludzkich akcji
│   │   ├── warmup.js             # 5-10 min rozgrzewki
│   │   ├── nightMode.js          # Sen 22:00-7:00 + poranny catch-up
│   │   ├── feedScanner.js        # Skanowanie feed po słowach kluczowych
│   │   ├── profileVisitor.js     # Losowe wizyty profili
│   │   ├── imageInteraction.js   # Interakcje z obrazkami
│   │   ├── smoothScroll.js       # Scrollowanie krzywymi Beziera
│   │   ├── tabSimulation.js      # Symulacja przełączania kart
│   │   ├── userMistakes.js       # Błędy w pisaniu, nawigacji
│   │   ├── randomActions.js      # Losowe lajki podczas sesji
│   │   ├── keywordMatcher.js     # Dopasowanie słów kluczowych
│   │   └── index.js              # Eksporty modułu LITE
│   ├── metaads/                  # Skaner Meta Ads Library
│   │   ├── index.js              # Główny entry & CLI
│   │   ├── scanner.js            # Logika scrapowania reklam
│   │   ├── extractor.js          # Ekstrakcja danych z reklam
│   │   └── cache.js              # Cache reklam
│   ├── db/                       # Persystencja danych
│   │   └── cache.js              # Cache deduplikacji komentarzy
│   └── utils/                    # Narzędzia
│       ├── logger.js             # Strukturalne logowanie (4 poziomy)
│       ├── sleep.js              # Opóźnienia & rozkład Gaussa
│       ├── navigation.js         # Bezpieczna nawigacja z retry
│       ├── mouse.js              # Ludzkie ruchy myszy
│       └── time.js               # Parsowanie czasu (FB relative times)
├── data/                         # Pliki danych
│   ├── posts.json                # Monitorowane posty (z panelu)
│   ├── comments-cache.json       # Cache deduplikacji
│   ├── discoveries.json          # Odkrycia feed scannera
│   ├── blacklist.json            # Odrzucone posty
│   └── images/                   # Uploadowane obrazki
├── .env                          # Konfiguracja środowiska
├── cookies.json                  # Aktywne ciasteczka sesji
└── package.json                  # Zależności & skrypty
```

---

### Kluczowe funkcje z numerami linii

#### Watcher (rdzeń monitoringu)
| Funkcja | Lokalizacja | Opis |
|---------|-------------|------|
| `startWatcher()` | `src/watcher.js:705` | Główna pętla async, orkiestruje cykle |
| `refreshPostsIfNeeded()` | `src/watcher.js:506` | Odświeża listę postów z API/pliku/Sheets |
| `readPanelPosts()` | `src/watcher.js:363` | Czyta `data/posts.json` |
| `fetchPostsFromApi()` | `src/watcher.js:456` | Pobiera posty z panel API (`POSTS_API_URL`) |
| `parseSheetCsv()` | `src/watcher.js:405` | Parsuje Google Sheets CSV |

#### Facebook (interakcja)
| Funkcja | Lokalizacja | Opis |
|---------|-------------|------|
| `fbLogin()` | `src/fb/login.js` | Logowanie do Facebooka |
| `checkIfLogged()` | `src/fb/login.js` | Sprawdza status logowania |
| `loadAllComments()` | `src/fb/comments.js` | Ładuje wszystkie komentarze z posta |
| `extractCommentsData()` | `src/fb/comments.js` | Parsuje obiekty komentarzy |
| `switchCommentsFilterToNewest()` | `src/fb/comments.js` | Zmienia sortowanie na "Najnowsze" |
| `loadCookies()` | `src/fb/cookies.js:19` | Ładuje ciasteczka z pliku |
| `saveCookies()` | `src/fb/cookies.js:56` | Zapisuje ciasteczka atomowo |
| `isCheckpoint()` | `src/fb/checkpoint.js:63` | Wykrywa 2FA/checkpoint |
| `acceptCookies()` | `src/fb/cookies.js:92` | Akceptuje consent cookies |

#### Panel API (endpointy)
| Endpoint | Lokalizacja | Opis |
|----------|-------------|------|
| `GET /api/status` | `src/panel/api.js:524` | Status systemu |
| `GET /api/env/get` | `src/panel/api.js:550` | Pobierz zmienne env |
| `POST /api/env/set` | `src/panel/api.js:634` | Ustaw zmienne env |
| `GET /api/posts` | `src/panel/api.js:676` | Lista postów |
| `POST /api/posts` | `src/panel/api.js:697` | Dodaj post |
| `PATCH /api/posts/:id` | `src/panel/api.js:753` | Edytuj post |
| `DELETE /api/posts/:id` | `src/panel/api.js:807` | Usuń post |
| `POST /api/pm2/start` | `src/panel/api.js:850` | Start procesu |
| `POST /api/pm2/restart` | `src/panel/api.js:866` | Restart procesu |
| `POST /api/pm2/stop` | `src/panel/api.js:883` | Stop procesu |
| `GET /api/pm2/status` | `src/panel/api.js:885` | Status PM2 |
| `GET /api/logs/out` | `src/panel/api.js:899` | Logi stdout |
| `GET /api/logs/err` | `src/panel/api.js:907` | Logi stderr |
| `GET /api/cookies/status` | `src/panel/api.js:916` | Info o ciasteczkach |
| `POST /api/cookies/clear` | `src/panel/api.js:823` | Wyczyść ciasteczka |
| `GET /api/discoveries` | `src/panel/api.js:966` | Lista odkryć |
| `POST /api/discoveries/:id/approve` | `src/panel/api.js:974` | Zatwierdź odkrycie |
| `POST /api/images/upload` | `src/panel/api.js:421` | Upload obrazka |

#### Telegram
| Funkcja | Lokalizacja | Opis |
|---------|-------------|------|
| `sendTelegramLeads()` | `src/telegram.js` | Wysyła powiadomienia o komentarzach |
| `sendOwnerAlert()` | `src/telegram.js` | Wysyła alerty do właściciela |
| `sendMessage()` | `src/telegram.js:112` | Wysyła wiadomość tekstową |
| `sendPhoto()` | `src/telegram.js:124` | Wysyła zdjęcie |
| `shouldSendByAge()` | `src/telegram.js:43` | Filtruje po wieku komentarza |

#### LITE (anti-detection)
| Funkcja | Lokalizacja | Opis |
|---------|-------------|------|
| `warmupSession()` | `src/lite/warmup.js` | 5-10 min sesja rozgrzewki |
| `handleNightMode()` | `src/lite/nightMode.js` | Logika snu & catch-up |
| `scanFeed()` | `src/lite/feedScanner.js` | Skanuj feed po słowach kluczowych |
| `createHumanBehavior()` | `src/lite/humanBehavior.js` | Utwórz instancję zachowania |
| `humanClick()` | `src/lite/humanBehavior.js` | Kliknięcie jak człowiek |
| `preAction()` | `src/lite/humanBehavior.js:57` | Pauza przed akcją |
| `postAction()` | `src/lite/humanBehavior.js:86` | Pauza po akcji |
| `betweenPostsPause()` | `src/lite/humanBehavior.js` | 3-8s pauza między postami |
| `getRandomViewport()` | `src/lite/antiDetection.js:24` | Losowa rozdzielczość |
| `getRandomSessionLength()` | `src/lite/antiDetection.js:41` | Długość sesji 30-90 min |

#### Database & Cache
| Funkcja | Lokalizacja | Opis |
|---------|-------------|------|
| `loadCache()` | `src/db/cache.js:18` | Załaduj cache deduplikacji |
| `saveCache()` | `src/db/cache.js:50` | Zapisz cache atomowo |
| `getCacheSize()` | `src/db/cache.js:93` | Rozmiar pliku cache |
| `getCacheEntryCount()` | `src/db/cache.js:106` | Liczba wpisów w cache |

#### Utils
| Funkcja | Lokalizacja | Opis |
|---------|-------------|------|
| `safeGoto()` | `src/utils/navigation.js:10` | Bezpieczna nawigacja (3 próby, 90s timeout) |
| `humanDelay()` | `src/utils/sleep.js:44` | Opóźnienie Gaussa |
| `humanType()` | `src/utils/sleep.js:97` | Pisanie jak człowiek |
| `parseFbRelativeTime()` | `src/telegram.js:9` | Parse "5 min temu" → Date |
| `log.prod()` | `src/utils/logger.js` | Log produkcyjny |
| `log.dev()` | `src/utils/logger.js` | Log developerski |
| `log.debug()` | `src/utils/logger.js` | Log debug |

---

### Przepływ zmiennych panelu

```
1. DEFINICJA      →  .env (KEY=VALUE)
2. ŁADOWANIE      →  src/bootstrap.js:13 (dotenv.config())
3. EKSPORT        →  src/config.js:287-360 (named exports)
4. UŻYCIE         →  import { VAR_NAME } from "./config.js"
5. MODYFIKACJA    →  POST /api/env/set (src/panel/api.js:634)
6. RESTART        →  pm2 restart --update-env
```

---

### Struktura obiektu posta (z API)

```javascript
{
  id: String,           // UUID hex
  url: String,          // URL posta Facebook
  active: Boolean,      // Czy monitorować
  name: String,         // Nazwa wyświetlana
  image: String,        // Miniaturka URL lub /images/...
  description: String,  // Opis (opcjonalny)
  createdAt: ISO8601,   // Data utworzenia
  updatedAt: ISO8601    // Data modyfikacji
}
```

---

### Stan watchera (watcher.js)

```javascript
let currentPosts = [];           // Aktualna lista postów
let lastRefreshAny = 0;          // Ostatni refresh timestamp
let cycleNumber = 0;             // Licznik cykli

let sessionFingerprint = null;   // LITE: Tożsamość sesji
let sessionStartTime = 0;        // LITE: Start sesji
let isFirstCycleOfSession = true;// LITE: Flaga pierwszego cyklu
let lastCheckTime = null;        // LITE: Ostatnie sprawdzenie

let consecutiveHardFails = 0;    // Licznik błędów (eskalacja)
let navErrorCount = 0;           // Licznik błędów nawigacji
```

---

### Obsługa błędów i stabilność

**Klasyfikacja błędów** (`src/watcher.js:231-282`):
- `isTimeout` - timeout
- `isNet` - błąd sieci
- `isContext` - kontekst zniszczony
- `isFrame` - frame detached
- `isTargetClosed` - target zamknięty
- `isSafeGoto` - błąd nawigacji
- `hardFail` - wymaga reset browser/context

**Strategia eskalacji**:
- Po 3 failach → Reset context (nowa strona)
- Po 5 failach → Restart przeglądarki
- Po 10 cyklach → Hard kill (`HARD_KILL_EVERY_N_CYCLES`)

---

### Zaawansowane funkcje

**Fast Mode** (`FAST_MODE=true`):
- Lokalizacja: `src/config.js:106-113`
- Pomija `loadAllComments()`, używa sortowania "Najnowsze"
- Filtruje po `WEBHOOK_MAX_AGE_MIN` (domyślnie 180 min)

**Night Mode** (`NIGHT_MODE_ENABLED=true`):
- Lokalizacja: `src/lite/nightMode.js`
- Sen od `NIGHT_START_HOUR` (22) do `NIGHT_END_HOUR` (7)
- Poranny catch-up dla komentarzy z nocy

**Feed Scanner** (`FEED_SCAN_ENABLED=true`):
- Lokalizacja: `src/lite/feedScanner.js`
- Skanuje feed po `FEED_SCAN_KEYWORDS`
- Zapisuje do `data/discoveries.json`

**Meta Ads Scanner**:
- Lokalizacja: `src/metaads/`
- Scrapuje Facebook Ads Library
- CLI: `node src/metaads/index.js --keywords "garaż" --once`
