// Schreibt den Scan-Stand fort. Wird von scan-whatsapp-leads.bat NUR nach einem
// erfolgreichen Claude-Lauf aufgerufen - bricht der Lauf ab, bleibt der alte
// Stand stehen und dieselben Nachrichten kommen beim naechsten Mal wieder ins Delta.
//
// Bewusst ein eigenes Skript: Batch soll kein JSON anfassen muessen.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_FILE = path.join(PROJECT, 'leads-inbox.state.json');

const p = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
              `T${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;

let state = {};
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { /* erste Ausfuehrung */ }

state.lastScan = stamp;              // Grenze fuer das naechste Delta
state.lastRunDate = stamp.slice(0, 10); // Tageswaechter: hoechstens ein Lauf pro Tag
delete state.note;

fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
console.log(`Scan-Stand fortgeschrieben: ${stamp}`);
