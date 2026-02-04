# Aktualny kontekst pracy

## Ostatnia aktualizacja
- **Data:** 2026-02-04 16:00
- **Urządzenie:** komputer
- **Status:** zakończone

## W trakcie / Do dokończenia
- [x] Debug Feed Scanner - dlaczego brak nowych discoveries

## Co zostało zrobione

### Debug Feed Scanner (2026-02-04)

**Problem:** Feed Scanner nie znajdował nowych postów od 2 dni.

**Diagnoza:**
1. Plik `keywords.json` istnieje i jest włączony (11 keywords)
2. Feed Scan uruchamia się ~5x dziennie (40% szansy przy każdym cyklu)
3. Blacklist zawiera 298 wpisów (głównie fałszywe dopasowania - stadiony, wiaty)

**Znaleziony problem:**
- Selektory w `extractVisiblePosts()` były przestarzałe - FB zmienił DOM
- Stare selektory: `/posts/`, `/permalink/`, `story_fbid` → **0 postów**
- Nowe selektory dodane: `/photo/`, `/reel/`, `pfbid`, `/videos/` → **1 post**

**Rozwiązanie:**
1. Zaktualizowano selektory w `src/lite/feedScanner.js`
2. Dodano deduplikację po URL
3. Poprawiono filtrowanie tekstu (usuwanie menu FB)
4. Dodano szczegółowe debug logi

**Wynik po naprawie:**
- Feed Scanner teraz wyciąga posty
- Brak discoveries bo feed zawiera posty po angielsku (algorytm FB)
- To nie jest błąd kodu - po prostu w feed nie ma postów z polskimi keywords

**Zalecenia:**
1. Zmienić język FB konta bota na polski
2. Followować polskie strony o garażach
3. Polubić posty o garażach żeby algorytm "nauczył się"

## Pliki zmienione
- `src/lite/feedScanner.js` - zaktualizowane selektory, debug logi
- `tools/debug-fb-selectors.js` (nowy) - debug selektorów
- `tools/test-extract-posts.js` (nowy) - test ekstrakcji
- `tools/test-feed-scanner.js` (nowy) - pełny test Feed Scanner
- `data/keywords.json` (lokalna kopia) - utworzony

## Stan synchronizacji
- **Serwer:** zaktualizowany (git pull + pm2 restart)
- **GitHub:** zcommitowane

## Notatki
- Feed Scanner ma 40% szansy uruchomienia przy każdym cyklu
- Debug logi dodane tymczasowo - można usunąć po ustabilizowaniu
- Blacklist (298 wpisów) blokuje wiele URLs - może wyczyścić?
