// src/bootstrap.js
// Ten plik MUSI być punktem wejścia - ładuje .env PRZED wszystkim innym

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.resolve(__dirname, "..", ".env");

// Ładuj .env ZANIM jakikolwiek inny moduł zostanie zaimportowany
const result = dotenv.config({ path: ENV_PATH, override: true });

if (result.error) {
  console.error("[BOOTSTRAP] Błąd ładowania .env:", result.error.message);
  console.error("[BOOTSTRAP] Szukano:", ENV_PATH);
} else {
  console.log("[BOOTSTRAP] .env załadowany z:", ENV_PATH);
}

// Debug - pokaż kluczowe zmienne
console.log("[BOOTSTRAP] LOG_LEVEL =", process.env.LOG_LEVEL);
console.log("[BOOTSTRAP] NODE_ENV =", process.env.NODE_ENV);

// Dynamiczny import - teraz .env jest już załadowany
await import("./index.js");
