# CHANGELOG

## [2026-02-02] - Poprawa systemu słów kluczowych w Feed Scannerze

### Feature/Refactor
- **Co:** Całkowita przebudowa systemu keywords dla Feed Scannera
- **Pliki:**
  - `src/lite/keywordMatcher.js` - whole-word matching, obsługa fraz wielowyrazowych
  - `src/lite/index.js` - funkcje loadKeywordsFromFile(), saveKeywordsToFile(), migrateKeywordsFromEnv()
  - `src/panel/api.js` - nowe endpointy API: GET/POST/DELETE /api/keywords, PUT /api/keywords/enabled
  - `src/panel/web/src/components/KeywordsManager.tsx` - nowy komponent UI z tagami
  - `src/panel/web/src/pages/SettingsCyber.tsx` - integracja KeywordsManager
  - `src/panel/web/src/lib/api.ts` - funkcje API dla keywords
  - `src/panel/web/src/lib/types.ts` - typy KeywordsData, KeywordsResponse
  - `src/watcher.js` - dynamiczne ładowanie keywords z JSON
- **Zmiany:**
  1. **Whole-word matching domyślnie** - "wiata" nie matchuje już "świata"
  2. **Obsługa fraz wielowyrazowych** - "blaszany garaż" matchuje całą frazę
  3. **Dedykowany storage** - keywords przechowywane w `data/keywords.json` zamiast .env
  4. **Nowy UI** - lista tagów z możliwością dodawania/usuwania zamiast text input
  5. **Dynamiczne ładowanie** - keywords odczytywane przy każdym cyklu (bez restartu)
  6. **Backward compatibility** - automatyczna migracja ze starego formatu .env
- **API:**
  - `GET /api/keywords` - pobierz listę keywords i status enabled
  - `POST /api/keywords` - dodaj keyword (body: { keyword: "string" })
  - `DELETE /api/keywords/:keyword` - usuń keyword
  - `PUT /api/keywords/enabled` - włącz/wyłącz skanowanie (body: { enabled: bool })

---

## [2026-02-02] - Synchronizacja kodu (lokalna ↔ serwer ↔ GitHub)

### Sync
- **Co:** Pełna synchronizacja kodu między trzema lokalizacjami
- **Lokalizacje:**
  - Lokalna kopia (Windows)
  - Serwer produkcyjny (77.42.82.5)
  - GitHub (origin/main)
- **Pobrano z serwera:**
  - `src/marketplace/` - moduł auto-publikacji (7 plików: contentPool, publisher, renewer, scheduler, selectors, utils, index)
  - `src/telegram.js` - alert throttle (ochrona przed spam alertami)
  - `src/config.js` - konfiguracja marketplace
- **Wgrano na serwer:**
  - Poprawki panelu (blokowanie skrótów klawiszowych podczas edycji formularzy)
  - Powiększenie miniaturek postów (96x64px)
- **Git:**
  - Zainicjowano repo git na serwerze (wcześniej był bez .git)
  - Push do GitHub main (125 plików, +166k linii)
  - Serwer teraz na branchu `main` z tracking
- **Commit:** `b8fad4e`
- **Status:** Wszystkie 3 lokalizacje zsynchronizowane

---

## [2026-02-01] - Migracja na nowy serwer (Helsinki)

### Config/Migration
- **Co:** Pełna migracja FB_Watcher ze starego serwera (162.55.188.103) na nowy (77.42.82.5)
- **Powód:** Stare IP spalone przez Facebook (ciągłe checkpointy, 3435 restartów)
- **Nowy serwer:**
  - IP: 77.42.82.5
  - Lokalizacja: Helsinki, Finland (Hetzner hel1-dc2)
  - Plan: CX23 (2 vCPU, 4GB RAM, 40GB SSD, €3.68/msc)
  - System: Ubuntu 24.04
- **Co przeniesiono:**
  - Kod źródłowy (bez node_modules, .git)
  - `.env` z konfiguracją
  - `data/posts.json` (40 postów)
  - `data/comments-cache.json`
  - `data/discoveries.json`
  - `data/blacklist.json`
  - `cookies.json` (sesja FB)
- **Skonfigurowano:**
  - Node.js 20.20.0
  - Chromium (snap)
  - PM2 z autostartem
  - Xvfb jako usługa systemd
  - Panel API na porcie 3180
- **Zaktualizowano w .env:**
  - `PUPPETEER_EXECUTABLE_PATH=/snap/bin/chromium`
  - `CHROME_PATH=/snap/bin/chromium`
  - `FB_EMAIL=agadgjo@int.pl`
- **Status:** Watcher działa, używa cookies, warmup OK

---
