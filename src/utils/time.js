// src/utils/time.js
import log from "./logger.js";

/**
 * Parser względnego czasu FB → Date
 * np. "2 min", "3 godz", "wczoraj", "23 sty"
 */
export function parseFbRelativeTime(raw) {
  if (!raw) return null;

  const t = raw.toLowerCase().trim();
  const now = new Date();

  // Natychmiastowe
  if (t.includes("przed chwilą") || t === "teraz" || t === "now" || t === "just now" || t.includes("właśnie")) {
    return now;
  }

  // Wczoraj
  if (t.includes("wczoraj") || t.includes("yesterday")) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d;
  }

  // Względne: "2 min", "3 godz", "5 dni", "1 tyg", "2 tydz"
  const m = t.match(/(\d+)\s*(sek|sec|min|minut|godz|hour|h|dni|day|tyg|tydz|week|w|d|m)\b/i);
  if (m) {
    const value = parseInt(m[1], 10);
    if (!Number.isFinite(value)) return null;

    const unit = m[2].toLowerCase();
    const d = new Date(now);

    if (unit.startsWith("sek") || unit.startsWith("sec")) d.setSeconds(d.getSeconds() - value);
    else if (unit.startsWith("min") || unit === "m") d.setMinutes(d.getMinutes() - value);
    else if (unit.startsWith("godz") || unit.startsWith("hour") || unit === "h") d.setHours(d.getHours() - value);
    else if (unit.startsWith("dni") || unit.startsWith("day") || unit === "d") d.setDate(d.getDate() - value);
    else if (unit.startsWith("tyg") || unit.startsWith("tydz") || unit.startsWith("week") || unit === "w") d.setDate(d.getDate() - 7 * value);

    return d;
  }

  // Daty absolutne: "23 sty", "5 lut", "12 mar" (zakładamy bieżący rok lub poprzedni jeśli data w przyszłości)
  const monthMap = {
    sty: 0, jan: 0,
    lut: 1, feb: 1,
    mar: 2,
    kwi: 3, apr: 3,
    maj: 4, may: 4,
    cze: 5, jun: 5,
    lip: 6, jul: 6,
    sie: 7, aug: 7,
    wrz: 8, sep: 8,
    paź: 9, paz: 9, oct: 9,
    lis: 10, nov: 10,
    gru: 11, dec: 11
  };

  const absMatch = t.match(/(\d{1,2})\s+(sty|lut|mar|kwi|maj|cze|lip|sie|wrz|paź|paz|lis|gru|jan|feb|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i);
  if (absMatch) {
    const day = parseInt(absMatch[1], 10);
    const monthKey = absMatch[2].toLowerCase();
    const month = monthMap[monthKey];

    if (month !== undefined && day >= 1 && day <= 31) {
      const d = new Date(now.getFullYear(), month, day);
      // Jeśli data jest w przyszłości, to był poprzedni rok
      if (d > now) {
        d.setFullYear(d.getFullYear() - 1);
      }
      return d;
    }
  }

  return null;
}

/**
 * Filtruje komentarze - zostawia tylko te młodsze niż maxAgeMin
 */
export function filterByAge(comments, maxAgeMin = 60) {
  const now = Date.now();

  return comments.filter((c) => {
    const rel = (c?.fb_time_raw || c?.time || "").trim();
    if (!rel) return false;

    const abs = parseFbRelativeTime(rel);
    if (!abs) return false;

    const ageMinutes = (now - abs.getTime()) / 60000;
    log.debug("TIME", "Age filter", {
      raw: rel,
      ageMin: Math.round(ageMinutes * 10) / 10,
      maxAgeMin,
    });
    return ageMinutes <= maxAgeMin;
  });
}
