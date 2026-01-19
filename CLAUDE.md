# FB_Watcher - Kontekst projektu

## Opis projektu
Bot monitorujący komentarze na postach Facebook za pomocą Puppeteer. Wykrywa nowe komentarze i wysyła powiadomienia przez Telegram.

## Architektura

### Główne moduły
- `src/watcher.js` - główna pętla monitorowania
- `src/config.js` - konfiguracja z .env
- `src/fb/comments.js` - ekstrakcja komentarzy z FB
- `src/fb/cookies.js` - zarządzanie ciasteczkami sesji
- `src/fb/login.js` - logowanie do FB
- `src/telegram.js` - wysyłka powiadomień
- `src/db/cache.js` - cache komentarzy (deduplikacja)
- `src/utils/logger.js` - system logowania
- `src/utils/time.js` - parsowanie czasu FB

### Źródła postów (priorytet)
1. **Remote API** (`POSTS_API_URL`) - panel administracyjny
2. **Lokalny plik** (`data/posts.json`) - fallback
3. **Google Sheets** (`POSTS_SHEET_URL`) - ostateczny fallback

## Ostatnia sesja (2026-01-18)

### Branch: `feat/fast-mode-newest-sorting`

### Co zostało zrobione
- **FAST_MODE** - nowy tryb szybkiego wykrywania komentarzy:
  - Sortowanie "Najnowsze" zamiast domyślnego
  - Funkcja `switchCommentsFilterToNewest()` w comments.js
  - Early skip - pomija posty gdzie najnowszy komentarz > FAST_MAX_AGE_MIN
  - Bez loadAllComments - szybsze działanie
- **Cache dedup** - naprawiono duplikaty powiadomień przez cache
- **System logowania** - nowy logger z poziomami (SILENT/PROD/DEV/DEBUG)
- **Parsowanie czasu FB** - `src/utils/time.js` dla względnych czasów ("2 godz.", "5 min")

### Konfiguracja FAST_MODE (.env)
```
FAST_MODE=true           # włącza tryb szybki
FAST_MAX_AGE_MIN=180     # limit wieku komentarzy (minuty)
CHECK_INTERVAL_MS=60000  # interwał sprawdzania
LOG_LEVEL=1              # 0=silent, 1=prod, 2=dev, 3=debug
```

### Zmiany w plikach (nieskomitowane)
- `src/config.js` - dodane FAST_MODE, FAST_MAX_AGE_MIN, LOG_*
- `src/watcher.js` - logika FAST_MODE, nowy logger
- `src/fb/comments.js` - `switchCommentsFilterToNewest()`
- `src/utils/logger.js` - NOWY plik
- `src/utils/time.js` - NOWY plik
- `src/db/cache.js` - poprawki dedup
- Usunięto: `src/webhook.js` (zastąpiony przez telegram.js)

## Do zrobienia / Potencjalne usprawnienia
- [ ] Testy FAST_MODE na produkcji
- [ ] Obsługa błędów gdy FB zmieni UI
- [ ] Rate limiting dla Telegram
- [ ] Metryki/statystyki wykrywania

## Ważne informacje techniczne

### Stealth
Bot używa technik ukrywania automatyzacji:
- `navigator.webdriver = false`
- Usunięcie flag Chromium automation
- Losowe opóźnienia między akcjami

### Cache
- Plik: `data/comments-cache.json`
- Struktura: `{ [postUrl]: { lastCount, knownIds: [] } }`
- Deduplikacja przez ID komentarzy

### Cookies
- Plik: `cookies.json` w głównym katalogu
- Format: tablica cookies z Puppeteer

## Komendy

```bash
# Uruchomienie
node src/index.js

# PM2 (produkcja)
pm2 start ecosystem.config.cjs

# Logi
pm2 logs fb-watcher
```

## Ostatnie commity
- `0744672` feat(watcher): add FAST_MODE with "Najnowsze" sorting
- `1e33305` fix(server): prevent duplicate comment notifications via cache dedup
- `6f2298e` stable 1.1 server: panel administracyjny, logi, PM2
