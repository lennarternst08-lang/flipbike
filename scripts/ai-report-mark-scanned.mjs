// Schiebt den Vergleichsstand des AI-Reports nach vorne: ai-report-latest.json
// wird zu ai-report-prev.json. Gleiche Idee wie whatsapp-mark-scanned.mjs - wird
// NUR nach einem erfolgreichen Claude-Lauf aufgerufen.
//
// Warum nicht direkt im Diff-Skript? Bricht die Auswertung ab, wären die Änderungen
// des Tages sonst verbucht, ohne dass sie je in der Tagesnotiz gelandet sind.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LATEST = path.join(PROJECT, 'ai-report-latest.json');
const PREV = path.join(PROJECT, 'ai-report-prev.json');

if (!fs.existsSync(LATEST)) {
  console.log('Kein ai-report-latest.json - Vergleichsstand bleibt, wie er war.');
  process.exit(0);
}

fs.copyFileSync(LATEST, PREV);
console.log('Vergleichsstand des AI-Reports fortgeschrieben.');
