// src/lite/keywordMatcher.js
// Dopasowywanie słów kluczowych w tekście

/**
 * Normalizuje tekst do porównywania
 * - lowercase
 * - usuwa znaki specjalne (zostawia litery, cyfry, spacje)
 * - usuwa wielokrotne spacje
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  if (!text || typeof text !== "string") return "";

  return text
    .toLowerCase()
    // Zamień polskie znaki na ASCII (opcjonalne - dla lepszego matchingu)
    .replace(/ą/g, "a")
    .replace(/ć/g, "c")
    .replace(/ę/g, "e")
    .replace(/ł/g, "l")
    .replace(/ń/g, "n")
    .replace(/ó/g, "o")
    .replace(/ś/g, "s")
    .replace(/ź/g, "z")
    .replace(/ż/g, "z")
    // Usuń znaki specjalne
    .replace(/[^a-z0-9\s]/g, " ")
    // Usuń wielokrotne spacje
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalizuje pojedyncze keyword
 * @param {string} keyword
 * @returns {string}
 */
function normalizeKeyword(keyword) {
  return normalizeText(keyword);
}

/**
 * Parsuje string keywords do tablicy
 * Obsługuje: "keyword1, keyword2, keyword3" lub "keyword1|keyword2"
 * @param {string} keywordsString
 * @param {string} delimiter - separator (domyślnie przecinek)
 * @returns {string[]}
 */
function parseKeywords(keywordsString, delimiter = ",") {
  if (!keywordsString || typeof keywordsString !== "string") return [];

  return keywordsString
    .split(delimiter)
    .map(k => k.trim())
    .filter(k => k.length > 0);
}

/**
 * Sprawdza czy tekst zawiera keyword (z uwzględnieniem granic słów)
 * @param {string} normalizedText - znormalizowany tekst
 * @param {string} normalizedKeyword - znormalizowane keyword
 * @param {object} options
 * @returns {boolean}
 */
function containsKeyword(normalizedText, normalizedKeyword, options = {}) {
  const {
    wholeWord = true,  // domyślnie whole-word żeby uniknąć false positives (np. "wiata" w "świata")
    fuzzy = false,     // czy pozwolić na drobne błędy
  } = options;

  if (!normalizedText || !normalizedKeyword) return false;

  if (wholeWord) {
    // Regex z granicami słów
    const regex = new RegExp(`\\b${escapeRegex(normalizedKeyword)}\\b`, "i");
    return regex.test(normalizedText);
  }

  if (fuzzy) {
    // Proste fuzzy matching - pozwól na 1 znak różnicy dla długich słów
    return fuzzyMatch(normalizedText, normalizedKeyword);
  }

  // Proste contains
  return normalizedText.includes(normalizedKeyword);
}

/**
 * Sprawdza czy tekst zawiera frazę wielowyrazową
 * Dla pojedynczych słów używa whole-word matching
 * Dla fraz wielowyrazowych buduje regex dla sekwencji słów
 * @param {string} normalizedText - znormalizowany tekst
 * @param {string} normalizedPhrase - znormalizowana fraza
 * @returns {boolean}
 */
function containsPhrase(normalizedText, normalizedPhrase) {
  if (!normalizedText || !normalizedPhrase) return false;

  const words = normalizedPhrase.split(/\s+/).filter(Boolean);

  if (words.length === 0) return false;

  if (words.length === 1) {
    // Pojedyncze słowo - użyj standardowego whole-word
    const regex = new RegExp(`\\b${escapeRegex(words[0])}\\b`, "i");
    return regex.test(normalizedText);
  }

  // Fraza wielowyrazowa - zbuduj regex dla sekwencji słów
  // np. "blaszany garaz" → \bblaszany\s+garaz\b
  const pattern = words.map(w => escapeRegex(w)).join("\\s+");
  const regex = new RegExp(`\\b${pattern}\\b`, "i");
  return regex.test(normalizedText);
}

/**
 * Escape znaków specjalnych regex
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Proste fuzzy matching
 * Pozwala na 1 znak różnicy dla słów > 5 znaków
 * @param {string} text
 * @param {string} keyword
 * @returns {boolean}
 */
function fuzzyMatch(text, keyword) {
  // Najpierw sprawdź exact match
  if (text.includes(keyword)) return true;

  // Dla krótkich słów - tylko exact match
  if (keyword.length <= 5) return false;

  // Sprawdź czy keyword z 1 brakującym znakiem jest w tekście
  for (let i = 0; i < keyword.length; i++) {
    const partial = keyword.slice(0, i) + keyword.slice(i + 1);
    if (text.includes(partial)) return true;
  }

  return false;
}

/**
 * Dopasowuje keywords do tekstu
 * @param {string} text - tekst do przeszukania
 * @param {string[]} keywords - tablica keywords
 * @param {object} options
 * @returns {{matched: string[], text: string}}
 */
function matchKeywords(text, keywords, options = {}) {
  const {
    wholeWord = true,  // domyślnie whole-word
    fuzzy = false,
    minLength = 3, // minimalna długość keyword do matchingu
    usePhraseMatcher = true, // użyj containsPhrase dla fraz wielowyrazowych
  } = options;

  if (!text || !keywords || keywords.length === 0) {
    return { matched: [], text: "" };
  }

  const normalizedText = normalizeText(text);
  const matched = [];

  for (const keyword of keywords) {
    // Skip zbyt krótkich
    if (keyword.length < minLength) continue;

    const normalizedKeyword = normalizeKeyword(keyword);
    const isPhrase = normalizedKeyword.includes(" ");

    let isMatch = false;

    if (usePhraseMatcher && isPhrase) {
      // Dla fraz wielowyrazowych użyj containsPhrase
      isMatch = containsPhrase(normalizedText, normalizedKeyword);
    } else {
      // Dla pojedynczych słów użyj containsKeyword
      isMatch = containsKeyword(normalizedText, normalizedKeyword, { wholeWord, fuzzy });
    }

    if (isMatch) {
      matched.push(keyword); // Zwracamy oryginalny keyword
    }
  }

  return {
    matched,
    text: normalizedText,
  };
}

/**
 * Sprawdza czy tekst pasuje do któregokolwiek keyword
 * @param {string} text
 * @param {string[]} keywords
 * @param {object} options
 * @returns {boolean}
 */
function hasAnyKeyword(text, keywords, options = {}) {
  // Przekaż opcje dalej, matchKeywords teraz domyślnie używa wholeWord=true
  const { matched } = matchKeywords(text, keywords, options);
  return matched.length > 0;
}

/**
 * Podświetla dopasowane keywords w tekście (dla UI)
 * @param {string} text - oryginalny tekst
 * @param {string[]} matchedKeywords - dopasowane keywords
 * @param {string} highlightTemplate - szablon podświetlenia (np. "**$1**")
 * @returns {string}
 */
function highlightKeywords(text, matchedKeywords, highlightTemplate = "**$1**") {
  if (!text || !matchedKeywords || matchedKeywords.length === 0) {
    return text;
  }

  let highlighted = text;

  for (const keyword of matchedKeywords) {
    // Case-insensitive replace z zachowaniem oryginalnej wielkości liter
    const regex = new RegExp(`(${escapeRegex(keyword)})`, "gi");
    highlighted = highlighted.replace(regex, highlightTemplate);
  }

  return highlighted;
}

/**
 * Ekstrahuje kontekst wokół dopasowanego keyword
 * @param {string} text - pełny tekst
 * @param {string} keyword - dopasowany keyword
 * @param {number} contextChars - ile znaków kontekstu z każdej strony
 * @returns {string}
 */
function extractKeywordContext(text, keyword, contextChars = 50) {
  if (!text || !keyword) return "";

  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();

  const index = lowerText.indexOf(lowerKeyword);
  if (index === -1) return text.substring(0, contextChars * 2);

  const start = Math.max(0, index - contextChars);
  const end = Math.min(text.length, index + keyword.length + contextChars);

  let context = text.substring(start, end);

  // Dodaj ... jeśli skrócone
  if (start > 0) context = "..." + context;
  if (end < text.length) context = context + "...";

  return context;
}

/**
 * Tworzy matcher z predefiniowaną listą keywords
 * @param {string[] | string} keywords - tablica lub string (rozdzielony przecinkami)
 * @param {object} options
 * @returns {{match: Function, hasAny: Function, highlight: Function}}
 */
function createKeywordMatcher(keywords, options = {}) {
  const keywordArray = Array.isArray(keywords)
    ? keywords
    : parseKeywords(keywords);

  return {
    /**
     * Dopasuj keywords do tekstu
     * @param {string} text
     * @returns {{matched: string[], text: string}}
     */
    match: (text) => matchKeywords(text, keywordArray, options),

    /**
     * Sprawdź czy tekst zawiera którykolwiek keyword
     * @param {string} text
     * @returns {boolean}
     */
    hasAny: (text) => hasAnyKeyword(text, keywordArray, options),

    /**
     * Podświetl keywords w tekście
     * @param {string} text
     * @param {string} template
     * @returns {string}
     */
    highlight: (text, template) => {
      const { matched } = matchKeywords(text, keywordArray, options);
      return highlightKeywords(text, matched, template);
    },

    /**
     * Lista keywords
     */
    keywords: keywordArray,
  };
}

export {
  normalizeText,
  normalizeKeyword,
  parseKeywords,
  containsKeyword,
  containsPhrase,
  matchKeywords,
  hasAnyKeyword,
  highlightKeywords,
  extractKeywordContext,
  createKeywordMatcher,
};
