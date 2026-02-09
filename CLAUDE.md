# FB_Watcher - Kontekst projektu

## Opis projektu
Bot monitorujący komentarze na postach Facebook za pomocą Puppeteer. Wykrywa nowe komentarze i wysyła powiadomienia przez Telegram.

## Mapa plików (dla oszczędności tokenów)

| Plik | Linie | Główne funkcje | Opis |
|------|-------|----------------|------|
| `src/watcher.js` | ~895 | `startWatcher()`, `processPost()`, `fetchPosts()` | główna pętla |
| `src/fb/login.js` | ~824 | `doLogin()`, `setupCaptchaSolver()` | logowanie + 2Captcha |
| `src/fb/comments.js` | ~782 | `extractComments()`, `parseComment()` | ekstrakcja komentarzy |
| `src/telegram.js` | ~303 | `sendNotification()`, `formatMessage()` | powiadomienia |
| `src/utils/logger.js` | ~202 | `log()`, `logLevel` | logowanie |
| `src/fb/checkpoint.js` | ~180 | `detectCheckpoint()`, `handleCheckpoint()` | wykrywanie 2FA |
| `src/config.js` | ~172 | eksport zmiennych | env variables |
| `src/fb/cookies.js` | ~149 | `loadCookies()`, `saveCookies()` | zarządzanie sesją |
| `src/db/cache.js` | ~116 | `getCache()`, `updateCache()` | deduplikacja |
| `src/db/dead-posts.js` | ~120 | `loadDeadPosts()`, `addDeadPost()`, `removeDeadPost()` | martwe posty |
| `src/bootstrap.js` | ~27 | - | **PUNKT WEJŚCIA** - ładuje .env przed importami |
| `src/index.js` | ~83 | `main()` | główna logika (importowany przez bootstrap.js) |
| `src/utils/time.js` | ~63 | `parseRelativeTime()` | parsowanie "2 godz." |
| `src/utils/sleep.js` | ~132 | `humanDelay()`, `shuffleArray()`, `humanType()` | human behavior delays |
| `src/utils/mouse.js` | ~195 | `humanClick()`, `moveToElement()` | ruchy myszy Bezier |
| `src/metaads/index.js` | ~170 | `runScan()`, `sendToWatcher()` | punkt wejścia scannera |
| `src/metaads/scanner.js` | ~120 | `scanKeyword()` | scraper Meta Ad Library |
| `src/metaads/extractor.js` | ~170 | `extractAdsFromPage()`, `extractPostUrlFromSnapshot()` | ekstrakcja danych |
| `src/metaads/cache.js` | ~120 | `loadCache()`, `saveCache()` | cache reklam |
| `src/lite/index.js` | ~150 | `getLiteConfig()`, exports | moduł LITE - główny eksport |
| `src/lite/antiDetection.js` | ~150 | `getRandomViewport()`, `generateSessionFingerprint()` | losowy viewport, session mgmt |
| `src/lite/smoothScroll.js` | ~180 | `smoothScrollBy()`, `feedScrollSession()` | płynne scrollowanie |
| `src/lite/humanBehavior.js` | ~200 | `humanClick()`, `betweenPostsPause()`, `createHumanBehavior()` | koordynator human behavior |
| `src/lite/warmup.js` | ~150 | `warmupSession()` | sesja rozgrzewkowa |
| `src/lite/nightMode.js` | ~150 | `handleNightMode()`, `isNightTime()` | tryb nocny + catch-up |
| `src/lite/feedScanner.js` | ~250 | `scanFeed()`, `approveDiscovery()` | skanowanie tablicy |
| `src/lite/keywordMatcher.js` | ~150 | `matchKeywords()`, `createKeywordMatcher()` | dopasowanie słów kluczowych |
| `src/lite/userMistakes.js` | ~150 | `humanTypeWithMistakes()`, `maybeGoBack()` | symulacja błędów użytkownika |
| `src/lite/tabSimulation.js` | ~100 | `maybeSimulateTabSwitch()` | symulacja przełączania kart |
| `src/lite/profileVisitor.js` | ~150 | `maybeVisitProfile()` | odwiedzanie profili |
| `src/lite/imageInteraction.js` | ~150 | `maybeInteractWithImage()` | interakcja ze zdjęciami |
| `src/lite/randomActions.js` | ~150 | `maybeRandomLike()`, `executeRandomActions()` | losowe akcje |
| `data/discoveries.json` | - | - | znalezione posty z Feed Scannera |
| `data/blacklist.json` | - | - | odrzucone posty |
| `data/stats.json` | - | - | globalne statystyki (cykle, komentarze) |
| `data/dead-posts.json` | - | - | martwe posty (brak aktywności > 14 dni) |

## Częste operacje (gdzie edytować)

| Chcę zmienić... | Edytuj plik | Funkcja |
|-----------------|-------------|---------|
| Format powiadomień | `src/telegram.js` | `formatMessage()` |
| Logikę logowania | `src/fb/login.js` | `doLogin()` |
| Ekstrakcję komentarzy | `src/fb/comments.js` | `extractComments()` |
| Interwał sprawdzania | `src/config.js` | `CHECK_INTERVAL_MS` |
| Obsługę checkpoint | `src/fb/checkpoint.js` | `handleCheckpoint()` |
| Cache komentarzy | `src/db/cache.js` | `updateCache()` |
| Opóźnienia human-like | `src/utils/sleep.js` | `humanTypingDelay()` |
| Ruchy myszy | `src/utils/mouse.js` | `humanClick()` |
| Meta Ads Scanner | `src/metaads/scanner.js` | `scanKeyword()` |
| Cache reklam | `src/metaads/cache.js` | `loadCache()`, `saveCache()` |
| LITE anti-detection | `src/lite/antiDetection.js` | `getRandomViewport()` |
| LITE human behavior | `src/lite/humanBehavior.js` | `betweenPostsPause()` |
| LITE night mode | `src/lite/nightMode.js` | `handleNightMode()` |
| LITE feed scanner | `src/lite/feedScanner.js` | `scanFeed()` |
| LITE discoveries | `data/discoveries.json` | (plik JSON) |
| LITE blacklist | `data/blacklist.json` | (plik JSON) |
| Statystyki | `src/watcher.js` | `updatePostStats()`, `updateGlobalStats()` |
| Martwe posty | `src/db/dead-posts.js` | `checkDeadPost()` |

## Architektura

### Źródła postów (priorytet)
1. **Remote API** (`POSTS_API_URL`) - panel administracyjny
2. **Lokalny plik** (`data/posts.json`) - fallback
3. **Google Sheets** (`POSTS_SHEET_URL`) - ostateczny fallback

## Ostatnia sesja (2026-01-29)

### Branch: `feat/lite-human-behavior`

### Co zostało zrobione
- **Naprawa Human Behavior w kluczowych miejscach**:
  - Problem: wszystkie `.click()` były wewnątrz `page.evaluate()` - wykonywały się w kontekście przeglądarki, gdzie NIE ma dostępu do Puppeteer API (`page.mouse.move()`)
  - Funkcje `humanClick()`, `preAction()`, `postAction()` z `src/lite/humanBehavior.js` używają Puppeteer API i działają TYLKO w Node.js
  - Rozwiązanie: refaktoryzacja wzorca "oznacz + kliknij":
    1. W `page.evaluate()` znajdź element i oznacz go atrybutem data (`data-hb-click-*`)
    2. Zwróć kontrolę do Node.js
    3. Użyj `page.$()` żeby uzyskać ElementHandle
    4. Wywołaj `humanClick()` z pełnym ruchem myszy krzywą Beziera
    5. Usuń marker po kliknięciu
  - Zrefaktoryzowane funkcje:
    - `src/fb/ui/post.js`: `clickMenuOptionByPattern`, `clickAllCommentsInMenu`, `switchCommentsFilterToAllScoped`, `openFilterMenuScoped`
    - `src/fb/comments.js`: `openCommentsMenu`, `clickMenuOptionByPrefix`
    - `src/fb/ui/videos.js`: `clickShowAllFromMarkedRow`, `ensureAllCommentsFilter`, `switchCommentsFilterToNewestScoped`, `oneSequentialAction`
    - `src/fb/ui/photo.js`: `clickAllCommentsInMenu`, `switchCommentsFilterToAll`
  - Teraz przy zmianie filtra komentarzy (Najnowsze/Wszystkie) jest widoczny ruch myszy i naturalne opóźnienia

### Poprzednia sesja (2026-01-29 rano)
- **Naprawa ładowania .env (Bootstrap Pattern)**:
  - Problem: ESM import hoisting powodował że `config.js` i `logger.js` czytały env PRZED załadowaniem `.env`
  - Rozwiązanie: nowy plik `src/bootstrap.js` jako punkt wejścia
  - `bootstrap.js` ładuje `.env` PRZED dynamicznym importem `index.js`
  - Usunięto `import "dotenv/config"` z `config.js` i `logger.js`
  - PM2 teraz uruchamia `bootstrap.js` zamiast `index.js`
  - Naprawiono na serwerze i lokalnie

### Poprzednia sesja (2026-01-28)
- **FB_Watcher LITE** - zaawansowany moduł anti-detection i human behavior:
  - Session management (losowy viewport, długość sesji 30-90 min)
  - Warmup session (5-10 min naturalnej aktywności przed monitorowaniem)
  - Night mode (sen nocny + morning catch-up)
  - Feed Scanner (skanowanie tablicy po keywords)
  - Discoveries/Blacklist system (panel API + pliki JSON)
  - Human behavior: płynne scrollowanie, symulacja błędów, tab switching
  - Profile visits, image interaction, random likes

### Poprzednia sesja (2026-01-26)
- **Meta Ads Scanner - naprawa ekstrakcji** (zmiana UI Facebooka):
  - Facebook nie używa już linków `/ads/library/?id=` w HTML
  - Dane reklam są teraz osadzone jako JSON w HTML strony
  - Przepisano `extractor.js` - parsuje JSON z `ad_archive_id`, `page_id`, `page_name`
  - Dodano `METAADS_HEADLESS` - kontrola widoczności przeglądarki
  - Dodano `METAADS_DEBUG` - screenshoty i zapis HTML do debugowania
- **Naprawa systemu logowania** w module metaads:
  - Zmiana z `log(1, ...)` na nowe API `log.prod("METAADS", ...)`
  - Wszystkie 4 pliki zaktualizowane (index, scanner, extractor, cache)

### Poprzednia sesja (2026-01-20)
- **2Captcha solver** - automatyczne rozwiązywanie captcha przy logowaniu
- **Uproszczenie logiki cookies** - usunięto rotację backup cookies
- **Czyszczenie kodu** - usunięto ~400 linii niepotrzebnego kodu

### Konfiguracja 2Captcha (.env)
```
CAPTCHA_API_KEY=twoj_klucz_2captcha
```

### Logika checkpoint (uproszczona)
```
Checkpoint/2FA wykryty
    ↓
Próba rozwiązania captcha (2Captcha)
    ↓
Jeśli sukces → kontynuuj
Jeśli 2FA/blokada → Alert Telegram + Stop
    ↓
Ręczna interwencja:
  - Zmień login/hasło w .env
  - Lub zaktualizuj cookies.json
    ↓
PM2 restartuje automatycznie
```

## Konfiguracja (.env)

### Podstawowe
```
FB_EMAIL=email@example.com
FB_PASSWORD=haslo
CHECK_INTERVAL_MS=60000
```

### FAST_MODE
```
FAST_MODE=true           # włącza tryb szybki
FAST_MAX_AGE_MIN=180     # limit wieku komentarzy (minuty)
```

### Captcha
```
CAPTCHA_API_KEY=klucz_2captcha
```

### Logi
```
LOG_LEVEL=1              # 0=silent, 1=prod, 2=dev, 3=debug
```

### Remote Debug
```
REMOTE_DEBUG_PORT=9222   # port do podglądu przeglądarki (0=wyłączony)
```

### Human Behavior Mode
```
HUMAN_MODE=true                    # włącza symulację człowieka (domyślnie true)
PROXY_URL=http://user:pass@host:port  # rotating residential proxy (opcjonalne)
```

### Meta Ads Scanner
```
METAADS_KEYWORDS=garaże blaszane,hale magazynowe  # słowa kluczowe (rozdzielone ,)
METAADS_COUNTRY=PL                                # kraj (ISO 3166-1 alpha-2)
METAADS_SCAN_INTERVAL_H=12                        # interwał skanowania (godziny)
METAADS_AUTO_SEND_TO_WATCHER=true                 # auto-wysyłka do panelu
METAADS_HEADLESS=true                             # false = widoczna przeglądarka
METAADS_DEBUG=false                               # true = screenshoty + HTML debug
```

### FB_Watcher LITE
```
# Session Management
SESSION_LENGTH_MIN_MS=1800000      # 30 min - minimalna długość sesji
SESSION_LENGTH_MAX_MS=5400000      # 90 min - maksymalna długość sesji

# Warmup (sesja rozgrzewkowa przed monitorowaniem)
WARMUP_ENABLED=true
WARMUP_DURATION_MIN_MS=300000      # 5 min
WARMUP_DURATION_MAX_MS=600000      # 10 min

# Anti-Detection
VIEWPORT_RANDOMIZATION=true        # losowa rozdzielczość przy każdej sesji
TYPING_MISTAKES_ENABLED=true       # symulacja literówek (3%)
TYPING_MISTAKES_CHANCE=0.03
NAVIGATION_MISTAKES_ENABLED=true   # symulacja cofania/powrotu
PROFILE_VISITS_ENABLED=true        # odwiedzanie losowych profili (8%)
PROFILE_VISITS_CHANCE=0.08
TAB_SIMULATION_ENABLED=true        # symulacja przełączania kart (10%)
TAB_SIMULATION_CHANCE=0.10
IMAGE_INTERACTION_ENABLED=true     # interakcja ze zdjęciami (15%)
IMAGE_INTERACTION_CHANCE=0.15

# Night Mode (tryb nocny)
NIGHT_MODE_ENABLED=false           # włącz żeby bot spał w nocy
NIGHT_START_HOUR=22                # początek nocy (22:00)
NIGHT_END_HOUR=7                   # koniec nocy (7:00)
NIGHT_CATCHUP_HOURS=8              # po ilu godzinach robić catch-up

# Feed Scanner (skanowanie tablicy)
FEED_SCAN_ENABLED=false            # włącz żeby skanować feed
FEED_SCAN_KEYWORDS=garaż,blaszany,hala,wiata  # słowa kluczowe
FEED_SCROLL_DURATION_MIN=1         # min czas scrollowania (minuty)
FEED_SCROLL_DURATION_MAX=3         # max czas scrollowania (minuty)

# Human Behavior
HUMAN_RANDOM_LIKE_CHANCE=0.20      # szansa na losowy like (20%)
DISCOVERY_TELEGRAM_ENABLED=false   # alert Telegram przy nowym discovery
WEBHOOK_MAX_AGE_MIN=60             # max wiek komentarzy do wysłania

# Stabilność / Crash Prevention
BROWSER_RECYCLE_EVERY_POSTS=15     # recykling browsera co N postów (zapobiega OOM)
BROWSER_RECYCLE_EVERY_CYCLES=10    # recykling browsera co N cykli
MEMORY_THRESHOLD_MB=2800           # próg pamięci do restartu (MB)

# Statystyki / Dead Posts
DEAD_POST_THRESHOLD_DAYS=14        # próg "martwego" posta (dni bez aktywności)
DEAD_POST_AUTO_MOVE=true           # auto-przeniesienie do dead-posts.json
DEAD_POST_ALERT=false              # alert Telegram przy przeniesieniu
```

## Ważne informacje techniczne

### Bootstrap Pattern (ładowanie .env)
**WAŻNE:** Aplikację ZAWSZE uruchamiaj przez `bootstrap.js`, NIE bezpośrednio `index.js`!

**Problem:** W ES Modules importy są wykonywane PRZED kodem modułu. To oznacza że `config.js` i `logger.js` odczytują `process.env` zanim `index.js` zdąży załadować `.env`.

**Rozwiązanie:** `bootstrap.js` ładuje `.env` PRZED dynamicznym importem `index.js`:
```
bootstrap.js → dotenv.config() → import("./index.js") → config.js, logger.js
```

**Struktura:**
- `src/bootstrap.js` - punkt wejścia, ładuje .env, pokazuje debug
- `src/index.js` - główna logika (NIE uruchamiać bezpośrednio)
- `src/config.js` - zmienne (bez import dotenv)
- `src/utils/logger.js` - logger (bez import dotenv)

### Stealth
Bot używa technik ukrywania automatyzacji:
- `navigator.webdriver = false`
- Usunięcie flag Chromium automation
- Losowe opóźnienia między akcjami
- Plugin `puppeteer-extra-plugin-stealth` (aktywowany!)

### Human Behavior Mode
Symulacja zachowań człowieka dla zmniejszenia ryzyka wykrycia:
- **Stealth Plugin**: ukrywa webdriver, plugins, WebGL, canvas fingerprint
- **Wolne pisanie**: ~120ms/znak z mikro-pauzami (zamiast 35ms)
- **Rozkład Gaussa**: naturalne opóźnienia zamiast jednolitych
- **Shuffle postów**: losowa kolejność sprawdzania (Fisher-Yates)
- **Pauzy między postami**: 3-8 sekund z rozkładem normalnym
- **Ruchy myszy**: krzywe Beziera (opcjonalne)
- **Proxy support**: residential rotating proxy

Logi przy `LOG_LEVEL=2`:
```
[STEALTH] Plugin stealth włączony
[PROXY] Używam proxy: http://***@host:port
[HUMAN] Human Behavior Mode włączony
[HUMAN] Kolejność postów: post3 → post1 → post2
[HUMAN] Pauza: 5.2s
```

### FB_Watcher LITE
Zaawansowany moduł anti-detection z wieloma warstwami ochrony:

**Session Management:**
- Losowy viewport przy każdej sesji (popularne rozdzielczości)
- Sesje 30-90 min, potem restart z nowym fingerprint
- Adaptive delays w zależności od pory dnia

**Warmup Session:**
- 5-10 minut naturalnej aktywności przed monitorowaniem
- Scroll feed, odwiedzanie profili, oglądanie zdjęć
- Buduje "normalną" historię aktywności

**Night Mode:**
- Sen nocny (domyślnie 22:00-7:00)
- Morning catch-up z rozszerzonym max age
- Losowa wariancja czasu budzenia (+/- 30 min)

**Feed Scanner:**
- Skanuje tablicę FB w poszukiwaniu postów z keywords
- Discoveries zapisywane do `data/discoveries.json`
- Panel API do akceptacji/odrzucania

**Human-like Actions:**
- Płynne scrollowanie (easing in/out, overshoot)
- Symulacja literówek i błędów nawigacji
- Tab switching (visibility change events)
- Profile visits i image interaction
- Random likes

**Panel API (nowe endpointy):**
```
GET  /api/discoveries              - lista pending discoveries
POST /api/discoveries/:id/approve  - akceptuj → dodaj do watched
POST /api/discoveries/:id/reject   - odrzuć → dodaj do blacklist
POST /api/discoveries/approve-all  - akceptuj wszystkie
POST /api/discoveries/reject-all   - odrzuć wszystkie
GET  /api/blacklist                - lista blacklist
DELETE /api/blacklist/:id          - usuń z blacklist
POST /api/blacklist                - dodaj URL ręcznie
GET  /api/stats                    - statystyki (summary, posts z tier, daily)
GET  /api/dead-posts               - lista martwych postów
POST /api/dead-posts/:id/reactivate - reaktywuj martwy post
```

Logi przy `LOG_LEVEL=2`:
```
[LITE] Nowa sesja: viewport 1920x1080, długość 67 min
[LITE] Warmup: 7 min
[LITE] Night Mode: 22:00 - 7:00
[LITE] Feed Scan: 4 keywords
[LITE] Background actions: tab_switch, image_hover
```

### Cache
- Plik: `data/comments-cache.json`
- Struktura: `{ [postUrl]: { lastCount, knownIds: [] } }`
- Deduplikacja przez ID komentarzy
- Auto-cleanup gdy > 1000 IDs na post

### Cookies
- Plik: `cookies.json` w głównym katalogu
- Format: tablica cookies z Puppeteer
- Atomic write (bezpieczny zapis)

### Captcha Solver
- Serwis: 2Captcha.com
- Plugin: `puppeteer-extra-plugin-recaptcha`
- Obsługuje: reCAPTCHA v2, v3, hCaptcha
- Czas rozwiązania: ~30-60 sekund

### Remote Debug (podgląd przeglądarki na żywo)
Pozwala podłączyć się do przeglądarki bota i ręcznie zrobić 2FA/checkpoint.

```bash
# 1. Na serwerze - uruchom z portem debug
REMOTE_DEBUG_PORT=9222 node src/index.js

# 2. Na PC - tunel SSH
ssh -L 9222:localhost:9222 root@162.55.188.103

# 3. W Chrome na PC
chrome://inspect/#devices → Configure → localhost:9222
```

Kliknij "inspect" przy facebook.com - masz pełną kontrolę nad przeglądarką.

### Proxy (opcjonalne)
Zmniejsza ryzyko banów przez zmianę IP:
- **Format**: `http://user:pass@host:port` lub `socks5://host:port`
- **Zalecane**: Residential rotating proxy (Bright Data, Oxylabs, IPRoyal)
- Facebook flaguje: datacenter IP, ciągłą aktywność z jednego IP
- Residential IP wyglądają jak zwykli użytkownicy

### Meta Ads Scanner
Moduł do skanowania biblioteki reklam Meta (Ad Library).

**Ekstrakcja danych (2026-01-26):**
- Facebook osadza dane reklam jako JSON w HTML strony
- Parsujemy pola: `ad_archive_id`, `page_id`, `page_name`, `page_profile_uri`
- Budujemy snapshot URL: `https://facebook.com/ads/library/?id={ad_archive_id}`

**Flow:**
1. Wyszukanie reklam po słowach kluczowych
2. Ekstrakcja danych z JSON (adId, pageName, pageId)
3. Sprawdzenie snapshotu - czy jest link do posta FB
4. Wysłanie do panelu watchera (jeśli `METAADS_AUTO_SEND_TO_WATCHER=true`)

**Typy reklam:**
| Typ | Ma post FB? | Wykrywanie | Oznaczenie w panelu |
|-----|-------------|------------|---------------------|
| Promowany post | TAK | `fbid` > 0 w JSON | `[ADS] {pageName}` |
| Dark post | NIE | `fbid:0` w JSON | `[DARK] {pageName}` |
| Link ad | NIE | `link_url` → zewnętrzna strona | `[DARK] {pageName}` |

**Uwaga (2026-01-26):** Większość reklam w Ad Library to dark posts lub link ads bez powiązanego posta FB. Funkcja `extractPostUrlFromSnapshot()` wcześnie wykrywa te typy przez sprawdzenie `fbid:0` i `link_url`.

**Cache:**
- Plik: `data/metaads-cache.json`
- Deduplikacja przez `adId`
- Struktura: `{ "keyword:X": { "adId": {...} } }`

**Logi:**
```
[METAADS] Start skanowania dla: garaże blaszane
[METAADS] Znaleziono 15 reklam dla "garaże blaszane"
[METAADS] Nowa reklama: Garaże Premium (123456)
[METAADS] Wysłano do panelu: [ADS] Garaże Premium
```

## Serwer produkcyjny

| Parametr | Wartość |
|----------|---------|
| IP | `162.55.188.103` |
| User | `root` |
| System | Ubuntu 24.04.3 LTS |
| Ścieżka | `/opt/fb-watcher` |

```bash
# Połączenie SSH
ssh root@162.55.188.103

# SSH z tunelem do remote debug
ssh -L 9222:localhost:9222 root@162.55.188.103
```

## Komendy

```bash
# Uruchomienie (ZAWSZE przez bootstrap.js!)
node src/bootstrap.js

# PM2 (produkcja) - WAŻNE: używaj bootstrap.js
pm2 start /opt/fb-watcher/src/bootstrap.js --name fb-watcher --cwd /opt/fb-watcher

# Logi
pm2 logs fb-watcher

# Generowanie cookies ręcznie
node scripts/generate-cookies.js

# Uruchomienie z remote debug (podgląd przeglądarki)
REMOTE_DEBUG_PORT=9222 node src/bootstrap.js

# Meta Ads Scanner - pojedyncze skanowanie
node src/metaads/index.js --keywords "garaże blaszane" --once

# Meta Ads Scanner - dry-run (bez wysyłki do panelu)
node src/metaads/index.js --keywords "garaże blaszane" --once --dry-run

# Meta Ads Scanner - debug mode (widoczna przeglądarka + screenshoty)
METAADS_HEADLESS=false METAADS_DEBUG=true node src/metaads/index.js --keywords "garaże" --once

# Meta Ads Scanner - jako osobny proces PM2
pm2 start src/metaads/index.js --name metaads-scanner
```

## Skrypty pomocnicze

### `scripts/generate-cookies.js`
Ręczne generowanie cookies przez logowanie w przeglądarce.
```bash
node scripts/generate-cookies.js           # zapisz cookies.json
node scripts/generate-cookies.js --list    # pokaż istniejące
```

## Workflow - wrzucanie na serwer

**ZASADA:** Zawsze tworzyć nowy branch przed wrzuceniem na serwer.

```bash
# 1. Nowy branch z timestampem
git checkout -b deploy/YYYYMMDD-HHMMSS

# 2. Commit + push
git add . && git commit -m "opis zmian"
git push -u origin HEAD

# 3. Na serwerze
ssh root@162.55.188.103
cd /opt/fb-watcher
git fetch && git checkout <branch>
pm2 restart fb-watcher
```

## Jak zadawać pytania (oszczędność tokenów)

### Dobrze
```
"W src/telegram.js:120 formatMessage() - dodaj link do posta"
"src/fb/login.js:45-60 - dodaj 3 retry przy błędzie"
"Czy w watcher.js:200-220 jest memory leak?"
```

### Źle
```
"Znajdź gdzie jest sendNotification"
"Sprawdź czy watcher.js jest OK"
"Pokaż mi cały plik login.js"
```

### Zasady
1. **Podawaj ścieżkę + numer linii** jeśli znasz
2. **Jedno pytanie = jeden temat** → potem `/clear`
3. **Unikaj "pokaż mi" / "wyjaśnij cały plik"**
4. **Po zakończeniu zadania** → `/clear` → nowe zadanie
5. **Aktualizuj mapę plików** gdy dodasz nowy plik

## Do zrobienia / Potencjalne usprawnienia
- [ ] Testy 2Captcha na produkcji przy rzeczywistym checkpoint
- [x] Obsługa błędów gdy FB zmieni UI (Meta Ads Scanner - 2026-01-26)
- [x] Wykrywanie typu reklamy (dark post/link ad/promowany post) - 2026-01-26
- [ ] Rate limiting dla Telegram
- [ ] Metryki/statystyki wykrywania
- [ ] Meta Ads Scanner: wyciąganie treści reklamy ze snapshotu
