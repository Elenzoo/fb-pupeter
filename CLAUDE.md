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
| `src/index.js` | ~83 | `main()` | punkt wejścia |
| `src/utils/time.js` | ~63 | `parseRelativeTime()` | parsowanie "2 godz." |

## Częste operacje (gdzie edytować)

| Chcę zmienić... | Edytuj plik | Funkcja |
|-----------------|-------------|---------|
| Format powiadomień | `src/telegram.js` | `formatMessage()` |
| Logikę logowania | `src/fb/login.js` | `doLogin()` |
| Ekstrakcję komentarzy | `src/fb/comments.js` | `extractComments()` |
| Interwał sprawdzania | `src/config.js` | `CHECK_INTERVAL_MS` |
| Obsługę checkpoint | `src/fb/checkpoint.js` | `handleCheckpoint()` |
| Cache komentarzy | `src/db/cache.js` | `updateCache()` |

## Architektura

### Źródła postów (priorytet)
1. **Remote API** (`POSTS_API_URL`) - panel administracyjny
2. **Lokalny plik** (`data/posts.json`) - fallback
3. **Google Sheets** (`POSTS_SHEET_URL`) - ostateczny fallback

## Ostatnia sesja (2026-01-20)

### Branch: `feat/react-admin-panel`

### Co zostało zrobione
- **2Captcha solver** - automatyczne rozwiązywanie captcha przy logowaniu:
  - Plugin `puppeteer-extra-plugin-recaptcha`
  - Konfiguracja: `CAPTCHA_API_KEY` w .env
  - Działa dla reCAPTCHA v2/v3
- **Uproszczenie logiki cookies** - usunięto rotację backup cookies:
  - Usunięto soft ban detection
  - Usunięto automatyczną rotację cookies przy checkpoint
  - Checkpoint = alert Telegram + stop (wymaga ręcznej interwencji)
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

## Ważne informacje techniczne

### Stealth
Bot używa technik ukrywania automatyzacji:
- `navigator.webdriver = false`
- Usunięcie flag Chromium automation
- Losowe opóźnienia między akcjami
- Plugin `puppeteer-extra-plugin-stealth`

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
# Uruchomienie
node src/index.js

# PM2 (produkcja)
pm2 start ecosystem.config.cjs

# Logi
pm2 logs fb-watcher

# Generowanie cookies ręcznie
node scripts/generate-cookies.js

# Uruchomienie z remote debug (podgląd przeglądarki)
REMOTE_DEBUG_PORT=9222 node src/index.js
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
- [ ] Obsługa błędów gdy FB zmieni UI
- [ ] Rate limiting dla Telegram
- [ ] Metryki/statystyki wykrywania
