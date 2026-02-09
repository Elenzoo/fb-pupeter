# CHANGELOG

## [2026-02-09] - Human Behavior dla modułu Marketplace + integracja panelu

### Feature
- **Co:** Dodanie pełnego Human Behavior do modułu Marketplace oraz integracja z panelem
- **Pliki:**
  - `src/marketplace/utils.js` - nowe funkcje: humanClickElement(), humanScroll(), humanScrollToElement(), doRandomMouseMovement()
  - `src/marketplace/publisher.js` - zamiana page.click() na humanClickElement(), scrollowanie przez humanScroll()
  - `src/marketplace/renewer.js` - wzorzec "mark + click", humanScroll(), losowe ruchy myszy
  - `src/panel/api.js` - 10 nowych endpointów API dla Marketplace
  - `src/panel/web/src/pages/Marketplace.tsx` - nowa strona panelu
  - `src/panel/web/src/lib/api.ts` - funkcje API dla Marketplace
  - `src/panel/web/src/lib/types.ts` - 15+ nowych interfejsów TypeScript
  - `src/panel/web/src/components/layouts/CyberLayout.tsx` - nawigacja do Marketplace

### Human Behavior w Marketplace:
1. **humanClickElement()** - klikanie z ruchem myszy krzywą Beziera + preAction/postAction
2. **humanType()** - 3% szansa na literówkę z korektą backspace
3. **humanScroll()** - płynne scrollowanie z easing (używa smoothScrollBy z LITE)
4. **humanDelay()** - rozkład Gaussa zamiast równomiernego
5. **doRandomMouseMovement()** - losowe ruchy myszy między akcjami
6. **Wzorzec "mark + click"** - oznaczanie elementów atrybutem data-hb-*, klikanie z Node.js

### Publisher.js:
- `fillTextField()` - humanClickElement() + humanType()
- `clickPublish()` - humanScroll() zamiast window.scrollTo
- Wszystkie `element.click()` → `humanClickElement()`

### Renewer.js:
- `getListingsFromPage()` - humanScroll() + losowe ruchy myszy
- `renewSingleListing()` - pełny "mark + click" pattern:
  - Oznaczanie przycisków: `data-hb-renew-click="renew-button|menu-button|menu-option|confirm-button"`
  - doRandomMouseMovement() przed kliknięciem
  - humanClickElement() z Bezier mouse movement

### API (nowe endpointy):
- `GET /api/marketplace/status` - status schedulera
- `PUT /api/marketplace/status` - włącz/wyłącz scheduler
- `GET /api/marketplace/listings` - lista ogłoszeń
- `GET /api/marketplace/content-pool` - pula treści
- `PUT /api/marketplace/content-pool` - aktualizuj pulę
- `GET /api/marketplace/renewals` - log wznowień
- `GET /api/marketplace/random-content` - losowa treść (preview)
- `POST /api/marketplace/manual-renew` - ręczne wznowienie
- `POST /api/marketplace/manual-publish` - ręczna publikacja
- `POST /api/marketplace/scheduler/stop|resume` - kontrola schedulera

---

## [2026-02-09] - Poprawki systemu statystyk i filtrowanie martwych postów

### Bugfix/Feature
- **Co:** Kompleksowa naprawa i usprawnienia systemu statystyk
- **Pliki:**
  - `src/watcher.js` - filtrowanie martwych postów w cyklu, śledzenie sesji (lastSessionStart, restartCount)
  - `src/panel/api.js` - filtrowanie martwych z /api/stats, nowe pola summary
  - `src/panel/web/src/pages/Stats.tsx` - poprawki UI (wykres, badge, etykiety czasowe)
  - `src/panel/web/src/lib/types.ts` - nowe pola w StatsResponse
  - `src/utils/time.js` - rozszerzone parsowanie czasów FB
  - `src/fb/ui/post.js` - rozszerzone regex dla ekstrakcji czasu komentarzy

### Zmiany:
1. **Filtrowanie martwych postów w watcher**
   - Martwe posty (>14 dni bez aktywności) są pomijane w cyklu monitorowania
   - Log: `[DEAD-POSTS] Pominięto X martwych postów (Y aktywnych)`

2. **Filtrowanie martwych w API /stats**
   - Endpoint /api/stats nie zwraca już martwych postów w liście
   - Summary zawiera totalPosts, activePosts, deadPosts osobno

3. **Śledzenie sesji PM2**
   - `lastSessionStart` - kiedy wystartował aktualny proces
   - `restartCount` - ile razy PM2 restartował proces
   - Log przy starcie: `Sesja #N, startedAt: YYYY-MM-DD`

4. **Poprawki wyświetlania statystyk**
   - "51 komentarzy **łącznie od 06.02**" zamiast "od uruchomienia"
   - "28 cykli od 06.02" - spójne daty
   - Wyraźne rozdzielenie: ostatni cykl vs sesja PM2

5. **Naprawa wykresu "Ostatnie 7 dni"**
   - Słupki używają pikseli zamiast procent (height: 80px max)
   - Zero = 4px, proporcjonalne skalowanie dla wartości

6. **Naprawa badge "MARTWY"**
   - Biały tekst na czerwonym tle (było: czerwony tekst niewidoczny)
   - Badge "SŁABY" z żółtą ramką

7. **Sortowanie postów po liczbie komentarzy**
   - Ranking postów sortowany malejąco po totalDetected

8. **Rozszerzone parsowanie czasów FB**
   - Nowe formaty: "właśnie", "tydz" (tydzień), daty absolutne ("23 sty", "5 lut")
   - Obsługa przełomu roku dla dat absolutnych

---

## [2026-02-06] - System statystyk i ranking postów

### Feature
- **Co:** Kompletny system statystyk z dashboardem w panelu
- **Pliki:**
  - `src/watcher.js` - funkcje updatePostStats(), updateGlobalStats(), loadGlobalStats(), saveGlobalStats()
  - `src/panel/api.js` - endpoint GET /api/stats z obliczaniem tier postów
  - `src/panel/web/src/pages/Stats.tsx` - nowa strona dashboardu statystyk
  - `src/panel/web/src/lib/api.ts` - funkcja getStats()
  - `src/panel/web/src/lib/types.ts` - typy StatsResponse, PostWithStats, PostTier, DailyStats
  - `data/stats.json` - plik przechowujący statystyki
- **Funkcjonalności:**
  1. **Statystyki per post** - liczba wykrytych komentarzy, data ostatniego komentarza
  2. **Statystyki globalne** - łączne komentarze, liczba cykli, daty
  3. **Statystyki dzienne** - agregacja po dniach z retencją 30 dni
  4. **Tier system** - automatyczna klasyfikacja postów:
     - HOT: nowe komentarze w ciągu ostatniej doby
     - ACTIVE: normalna aktywność
     - WEAK: brak aktywności 7-14 dni
     - DEAD: brak aktywności > 14 dni
  5. **Dashboard UI** - karty podsumowania, wykres 7 dni, tabela ranking postów
- **API:**
  - `GET /api/stats` - zwraca summary, posts z tier, daily stats

---

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
