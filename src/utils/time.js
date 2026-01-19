// src/utils/time.js
import log from "./logger.js";

/**
 * Parser względnego czasu FB → Date
 * np. "2 min", "3 godz", "wczoraj"
 */
export function parseFbRelativeTime(raw) {
  if (!raw) return null;

  const t = raw.toLowerCase().trim();
  const now = new Date();

  if (t.includes("przed chwilą") || t === "teraz" || t === "now" || t === "just now") {
    return now;
  }

  if (t.includes("wczoraj") || t.includes("yesterday")) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d;
  }

  const m = t.match(/(\d+)\s*(sek|sec|min|minut|godz|hour|h|dni|day|tyg|week)/i);
  if (!m) return null;

  const value = parseInt(m[1], 10);
  if (!Number.isFinite(value)) return null;

  const unit = m[2].toLowerCase();
  const d = new Date(now);

  if (unit.startsWith("sek") || unit.startsWith("sec")) d.setSeconds(d.getSeconds() - value);
  else if (unit.startsWith("min")) d.setMinutes(d.getMinutes() - value);
  else if (unit.startsWith("godz") || unit.startsWith("hour") || unit === "h") d.setHours(d.getHours() - value);
  else if (unit.startsWith("dni") || unit.startsWith("day")) d.setDate(d.getDate() - value);
  else if (unit.startsWith("tyg") || unit.startsWith("week")) d.setDate(d.getDate() - 7 * value);

  return d;
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
