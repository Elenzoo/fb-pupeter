# FB Watcher — koncepcja działania panelu (pod integrację backendu)

Ten dokument opisuje **jak ma działać panel administratora** dla systemu FB Watcher.
Panel jest **centrum sterowania**, backend (scrapery / workerzy) będzie dopinany etapami.

Panel:
- przechowuje konfigurację,
- zbiera wykrycia (discoveries),
- umożliwia zatwierdzanie,
- zarządza obserwacją i akcjami (alerty, autoposting).

---

## Wspólny schemat działania

ŹRÓDŁO → WYKRYCIE (DISCOVERY) → ZATWIERDZENIE → OBSERWACJA / AKCJA

Panel **nie scrapuje** — panel **zarządza i decyduje**.

---

## 1. Przeglądanie głównej strony Facebooka (Home / Feed)

### Cel
Automatyczne wykrywanie postów z **głównej tablicy Facebooka** (Home / Feed),
czyli tego, co realnie pojawia się użytkownikowi po zalogowaniu:
- posty stron,
- posty publiczne,
- posty sponsorowane,
- treści powiązane z zainteresowaniami.

### Jak to działa
1. W panelu konfigurowane są:
   - tryb skanowania **głównej strony Facebooka**,
   - zestawy słów kluczowych.
2. Backend cyklicznie przegląda główny feed Facebooka.
3. Każdy post dopasowany do słów kluczowych trafia do panelu jako **Wykrycie (Discovery)**.
4. Operator w panelu:
   - **Zatwierdza** → post zostaje dodany do listy obserwowanych (Watcher),
   - **Odrzuca** → wykrycie jest ignorowane.

### Panel musi posiadać
- konfigurację skanowania strony głównej Facebooka,
- listę wykryć z typu `home_feed`,
- akcję: `Zatwierdź → dodaj do obserwowanych`.

---

## 2. Scrapping grup Facebooka

### Cel
Wychwytywanie zapytań i leadów z grup branżowych.

### Jak to działa
1. W panelu dodawane są:
   - grupy Facebook,
   - przypisane zestawy słów kluczowych.
2. Backend skanuje nowe posty w grupach.
3. Dopasowania trafiają do **Wykryć (Discovery)** z typem `group_post`.
4. Operator:
   - zatwierdza → (opcjonalnie) dodaje post do obserwowanych,
   - odrzuca → ignor.

### Panel musi posiadać
- listę grup,
- przypisywanie keywordów,
- decyzję na wykryciu: `dodaj do obserwowanych` / `tylko alert`.

---

## 3. Meta Ads (reklamy konkurencji)

### Cel
Monitoring reklam konkurencji i wyciąganie konkretnych reklam/postów do dalszej obserwacji.

### Jak to działa
1. W panelu definiowane są:
   - konkurencja (opcjonalnie),
   - słowa kluczowe.
2. Backend skanuje Meta Ads Library.
3. Znalezione reklamy trafiają do **Wykryć (Discovery)**:
   - link do reklamy,
   - reklamodawca,
   - typ (grafika / wideo),
   - opis.
4. Panel posiada wyszukiwarkę wykryć.
5. Po **zatwierdzeniu**:
   - jeśli reklama ma publiczny link/post → trafia do obserwowanych linków watchera,
   - reklama zostaje przypisana do istniejących obserwacji.

### Panel musi posiadać
- listę monitorów Meta Ads,
- listę wykryć reklam,
- akcję: `Zatwierdź → dodaj do obserwowanych`.

---

## 4. Automatyczne dodawanie ogłoszeń (Marketplace)

### Cel
Autoposting ogłoszeń z puli treści, z rotacją i obsługą wielu kont.

### Jak to działa
1. W panelu tworzone są:
   - pule ogłoszeń (szablony),
   - kampanie publikacji.
2. Kampania:
   - wybiera konto FB,
   - ustala harmonogram,
   - rotuje treści.
3. Backend publikuje ogłoszenia.
4. Przy błędzie lub blokadzie:
   - kampania zostaje zatrzymana,
   - panel pokazuje status i możliwość wznowienia.

### Panel musi posiadać
- pulę ogłoszeń,
- kampanie publikacji,
- statusy: ACTIVE / PAUSED / ERROR,
- przyciski STOP / WZNÓW.

---

## Kluczowe byty w panelu (minimalny zestaw)

- **Sources** – główna strona FB, grupy, meta ads
- **Discoveries** – wszystkie wykrycia (jedno wspólne miejsce)
- **Watched** – obserwowane linki/posty (dla watchera)
- **Campaigns** – autoposting / marketplace

Każdy typ wykrycia przechodzi przez:
`Discoveries → Zatwierdź → Watched / Campaign`

---

## Założenia architektoniczne

- Panel = źródło prawdy
- Backend = wykonawca (worker)
- Główna strona FB, grupy i Meta Ads to **różne źródła**, ale **ten sam proces zatwierdzania**
- Każda funkcja backendu może być dodana później bez zmiany panelu

---

## Uwaga projektowa

Panel musi być gotowy na:
- wiele kont Facebook,
- blokady i zatrzymania,
- różne typy źródeł (Home / Group / Ads),
- dalszą rozbudowę bez refaktoru UI.

