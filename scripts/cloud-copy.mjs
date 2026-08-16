// Legt Dateien in den Google-Drive-Ordner, damit der Drive-Connector von claude.ai
// sie live lesen kann - ohne "Sync now", anders als bei Projekt-Wissen.
//
// Aufruf: node scripts/cloud-copy.mjs <datei> [<datei> ...]
// Fehlt Drive, passiert nichts und der Exit-Code bleibt 0 - der Rest des Laufs
// haengt nicht daran.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT_TARGET_FILE = path.join(PROJECT, 'whatsapp-export-target.txt');
const EXPORT_SUBDIR = 'FlipBike';

// Google Drive haengt sein Laufwerk nicht immer unter demselben Buchstaben ein
// (beobachtet: erst G:, eine Stunde spaeter H:). Deshalb alle absuchen.
export function findExportDir() {
  try {
    const configured = fs.readFileSync(EXPORT_TARGET_FILE, 'utf8')
      .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    for (const dir of configured) if (fs.existsSync(dir)) return dir;
  } catch { /* keine Konfigurationsdatei -> automatisch suchen */ }

  const roots = [];
  for (let c = 'D'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    const L = String.fromCharCode(c);
    roots.push(`${L}:/Meine Ablage`, `${L}:/My Drive`);
  }
  roots.push(
    path.join(process.env.USERPROFILE || 'C:/', 'Meine Ablage'),
    path.join(process.env.USERPROFILE || 'C:/', 'Google Drive'),
  );

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const sub = path.join(root, EXPORT_SUBDIR);
    try {
      if (!fs.existsSync(sub)) fs.mkdirSync(sub, { recursive: true });
      return sub;
    } catch { /* nicht beschreibbar -> naechster Kandidat */ }
  }
  return null;
}

export function copyToCloud(files) {
  const dir = findExportDir();
  if (!dir) {
    console.log('Kein Cloud-Ordner gefunden - Dateien bleiben nur lokal.');
    return false;
  }
  for (const file of files) {
    const src = path.isAbsolute(file) ? file : path.join(PROJECT, file);
    if (!fs.existsSync(src)) continue;
    try {
      fs.copyFileSync(src, path.join(dir, path.basename(src)));
      console.log(`Cloud: ${path.join(dir, path.basename(src))}`);
    } catch (e) {
      console.log(`Hinweis: Cloud-Kopie von ${path.basename(src)} fehlgeschlagen (${e.message}).`);
    }
  }
  return true;
}

// Direktaufruf von der Kommandozeile
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  copyToCloud(process.argv.slice(2));
}
