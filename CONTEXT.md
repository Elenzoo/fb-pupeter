# Aktualny kontekst pracy

## Ostatnia aktualizacja
- **Data:** 2026-02-02 21:30
- **Urządzenie:** komputer
- **Status:** zakończone

## W trakcie / Do dokończenia
- [x] Poprawa systemu słów kluczowych w Feed Scannerze
  - [x] Whole-word matching (eliminacja false positives)
  - [x] Obsługa fraz wielowyrazowych
  - [x] Dedykowany storage keywords.json
  - [x] Nowe API endpoints
  - [x] Nowy komponent UI KeywordsManager
  - [x] Integracja z SettingsCyber
  - [x] Aktualizacja watcher.js

## Aktualny problem / Blokery
- Brak

## Co zostało zrobione

### 1. keywordMatcher.js
- Zmiana domyślnego `wholeWord` z `false` na `true`
- Nowa funkcja `containsPhrase()` dla fraz wielowyrazowych
- Regex `\bword\b` eliminuje partial match ("wiata" nie matchuje "świata")

### 2. keywords.json storage
- Nowy plik: `data/keywords.json`
- Format: `{ "keywords": ["garaż", "blaszany garaż"], "enabled": true }`
- Funkcje: `loadKeywordsFromFile()`, `saveKeywordsToFile()`, `migrateKeywordsFromEnv()`

### 3. API endpoints (panel/api.js)
- `GET /api/keywords` - pobierz listę i status
- `POST /api/keywords` - dodaj keyword
- `DELETE /api/keywords/:keyword` - usuń keyword
- `PUT /api/keywords/enabled` - włącz/wyłącz

### 4. Panel UI
- Nowy komponent `KeywordsManager.tsx`
- Lista tagów zamiast text input
- Przyciski dodaj/usuń + toggle enabled

### 5. watcher.js
- Dynamiczne ładowanie keywords z JSON przy każdym cyklu
- Automatyczna migracja ze starego formatu .env

## Stan synchronizacji
- Lokalna kopia: zmiany do commita
- Serwer: wymaga deployment
- GitHub: wymaga push

## Następne kroki
1. Build panelu: `cd src/panel/web && npm run build`
2. Commit zmian
3. Push do GitHub
4. Deploy na serwer
5. Test w panelu

## Pliki zmienione
- `src/lite/keywordMatcher.js`
- `src/lite/index.js`
- `src/panel/api.js`
- `src/panel/web/src/components/KeywordsManager.tsx` (nowy)
- `src/panel/web/src/pages/SettingsCyber.tsx`
- `src/panel/web/src/lib/api.ts`
- `src/panel/web/src/lib/types.ts`
- `src/watcher.js`
- `CHANGELOG.md`

## Notatki
- Keywords są teraz ładowane dynamicznie - zmiany w panelu działają bez restartu
- Backward compatibility: stare keywords z .env zostaną automatycznie zmigrowane
