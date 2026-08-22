// Zieht den kompletten Datenbestand aus Firestore und baut daraus den ai_report -
// dieselbe Datei, die der Menüpunkt "KI-Report" im Browser herunterlädt.
//
//   Aufruf:  node --import tsx scripts/ai-report-dump.mts
//            (oder über scripts/tageslauf.bat)
//
//   Ergebnis:
//     ai-report-latest.json          aktueller Stand (minifiziert, gitignoriert)
//     ai-report-archiv/<datum>.json  Tageskopie, damit man später zurückschauen kann
//
//   Exit-Codes (der Batch wertet sie aus):
//     0  = Report geschrieben
//     12 = keine Zugangsdaten gefunden -> AI-Teil wird übersprungen, WhatsApp läuft weiter
//     1  = echter Fehler
//
// WARUM ein Dienstkonto? Die App meldet sich per Google-Popup an; das gibt es in
// einem geplanten Lauf nicht. Der Admin-SDK-Schlüssel ist der einzige Weg, ohne
// Browser an dieselben Daten zu kommen. Er liegt bewusst AUSSERHALB des Repos -
// der Build landet auf öffentlichen GitHub Pages.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { buildAiReport } from '../src/lib/aiReport.ts';
import { isExcludedDoc } from '../src/lib/flyerLeads.ts';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = process.env.USERPROFILE || process.env.HOME || 'C:/';
const SAFE_DIR = path.join(HOME, '.flipbike');
const SAFE_KEY = path.join(SAFE_DIR, 'firebase-sa.json');
const SAFE_CFG = path.join(SAFE_DIR, 'config.json');
const LATEST = path.join(PROJECT, 'ai-report-latest.json');
const ARCHIV = path.join(PROJECT, 'ai-report-archiv');
const ARCHIV_TAGE = 60;

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_NO_CREDENTIALS = 12;

const cfg = JSON.parse(fs.readFileSync(path.join(PROJECT, 'firebase-applet-config.json'), 'utf8'));

/**
 * Sucht den Dienstkonto-Schlüssel an allen Stellen, an denen er landen kann.
 * Der letzte Kandidat ist der Download-Ordner: genau dort legt die Firebase-Konsole
 * die Datei ab, wenn man auf "Neuen privaten Schlüssel generieren" klickt. Wird sie
 * dort gefunden, wandert eine Kopie nach ~/.flipbike - dann funktioniert der Lauf
 * auch, wenn der Download-Ordner später aufgeräumt wird.
 */
function findServiceAccount(): { file: string; data: any } | null {
  const kandidaten: string[] = [];

  if (process.env.FLIPBIKE_FIREBASE_SA) kandidaten.push(process.env.FLIPBIKE_FIREBASE_SA);
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) kandidaten.push(process.env.GOOGLE_APPLICATION_CREDENTIALS);

  // Optionale Zeigerdatei im Projekt (gitignoriert), gleiche Idee wie whatsapp-export-target.txt
  try {
    const zeiger = fs.readFileSync(path.join(PROJECT, 'firebase-sa-path.txt'), 'utf8');
    for (const zeile of zeiger.split(/\r?\n/)) {
      const t = zeile.trim();
      if (t && !t.startsWith('#')) kandidaten.push(t);
    }
  } catch { /* keine Zeigerdatei */ }

  kandidaten.push(SAFE_KEY);

  for (const kandidat of kandidaten) {
    const geladen = ladeSchluessel(kandidat);
    if (geladen) return { file: kandidat, data: geladen };
  }

  // Automatisch im Download-Ordner nachsehen
  for (const ordner of [path.join(HOME, 'Downloads'), path.join(HOME, 'Download')]) {
    let dateien: string[] = [];
    try { dateien = fs.readdirSync(ordner); } catch { continue; }
    const treffer = dateien
      .filter((n) => n.endsWith('.json') && (n.includes('firebase-adminsdk') || n.startsWith(cfg.projectId)))
      .map((n) => path.join(ordner, n))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const datei of treffer) {
      const geladen = ladeSchluessel(datei);
      if (!geladen) continue;
      try {
        fs.mkdirSync(SAFE_DIR, { recursive: true });
        fs.copyFileSync(datei, SAFE_KEY);
        console.log(`Schlüssel im Download-Ordner gefunden und nach ${SAFE_KEY} kopiert.`);
        console.log(`Hinweis: die Kopie in ${datei} kannst du jetzt löschen.`);
        return { file: SAFE_KEY, data: geladen };
      } catch {
        return { file: datei, data: geladen };
      }
    }
  }

  return null;
}

function ladeSchluessel(datei: string): any | null {
  try {
    const data = JSON.parse(fs.readFileSync(datei, 'utf8'));
    if (data.type !== 'service_account' || !data.private_key || !data.client_email) return null;
    if (data.project_id && data.project_id !== cfg.projectId) {
      console.log(`Übersprungen: ${datei} gehört zu Projekt ${data.project_id}, gebraucht wird ${cfg.projectId}.`);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/** Alle Dokumente einer Collection, optional auf einen Nutzer eingegrenzt. */
async function holen(db: FirebaseFirestore.Firestore, name: string, uid?: string) {
  const ref = db.collection(name);
  const snap = await (uid ? ref.where('userId', '==', uid).get() : ref.get());
  return snap.docs.map((d) => ({ ...(d.data() as any), id: d.id }));
}

/**
 * Welches Konto? In der Datenbank liegen die Daten von ZWEI Anmeldungen:
 * dem aktuellen Konto und einem aelteren aus 2025/26. Die App zeigt immer nur
 * das Konto, mit dem man angemeldet ist - der Report muss dasselbe tun, sonst
 * stehen im Report andere Zahlen als in der Oberflaeche.
 *
 * Reihenfolge: Umgebungsvariable -> ~/.flipbike/config.json -> automatisch das
 * Konto, dem die meisten Arbeitsdaten gehoeren (Lager, Bestellungen, To-dos,
 * Flyer-Gebiete). Nur Raeder zaehlen dafuer NICHT: davon hat das alte Konto mehr.
 */
async function bestimmeUid(db: FirebaseFirestore.Firestore): Promise<string | undefined> {
  if (process.env.FLIPBIKE_UID) return process.env.FLIPBIKE_UID;
  try {
    const cfgDatei = JSON.parse(fs.readFileSync(SAFE_CFG, 'utf8'));
    if (cfgDatei.uid) return cfgDatei.uid;
  } catch { /* keine Konfiguration -> automatisch bestimmen */ }

  const punkte: Record<string, number> = {};
  for (const name of ['inventoryItems', 'orders', 'todos', 'flyerAreas', 'flyerHouses', 'flyerSettings']) {
    const snap = await db.collection(name).get();
    for (const d of snap.docs) {
      const u = (d.data() as any).userId;
      if (u) punkte[u] = (punkte[u] || 0) + 1;
    }
  }
  const sortiert = Object.entries(punkte).sort((a, b) => b[1] - a[1]);
  if (sortiert.length === 0) return undefined;
  if (sortiert.length > 1) {
    console.log(`Mehrere Konten gefunden (${sortiert.map(([u, n]) => `${u.slice(0, 6)}…=${n}`).join(', ')}) - genommen wird das erste.`);
    console.log(`Zum Festlegen: {"uid":"…"} in ${SAFE_CFG} schreiben.`);
  }
  return sortiert[0][0];
}

async function main(): Promise<number> {
  const sa = findServiceAccount();
  if (!sa) {
    console.log('Kein Dienstkonto-Schlüssel gefunden - AI-Report wird übersprungen.');
    console.log('So einrichten (einmalig, dauert eine Minute):');
    console.log(`  1. https://console.firebase.google.com/project/${cfg.projectId}/settings/serviceaccounts/adminsdk`);
    console.log('  2. "Neuen privaten Schlüssel generieren" -> Datei herunterladen');
    console.log(`  3. Fertig. Der nächste Lauf findet sie im Download-Ordner von selbst`);
    console.log(`     (oder von Hand nach ${SAFE_KEY} legen).`);
    return EXIT_NO_CREDENTIALS;
  }
  console.log(`Dienstkonto: ${sa.data.client_email} (${sa.file})`);

  const app = initializeApp({ credential: cert(sa.data), projectId: cfg.projectId }, 'ai-report');
  const db = getFirestore(app, cfg.firestoreDatabaseId);
  db.settings({ ignoreUndefinedProperties: true });

  const uid = await bestimmeUid(db);
  if (!uid) {
    console.log('Warnung: kein Konto erkannt - es werden ALLE Daten der Datenbank genommen.');
  } else {
    console.log(`Konto: ${uid}`);
  }

  const [bikes, todos, logs, serviceRequests, inventoryItems, orders, flyerAreas, flyerHouses, flyerHistory] =
    await Promise.all([
      holen(db, 'bikes', uid),
      holen(db, 'todos', uid),
      holen(db, 'logs', uid),
      holen(db, 'serviceRequests', uid),
      holen(db, 'inventoryItems', uid),
      holen(db, 'orders', uid),
      holen(db, 'flyerAreas', uid),
      holen(db, 'flyerHouses', uid),
      holen(db, 'flyerHistory', uid),
    ]);

  if (bikes.length === 0) {
    // Kein Abbruch: ein leerer Bestand ist erlaubt. Aber es ist fast immer ein Zeichen
    // dafür, dass die uid auf ein anderes Konto zeigt.
    console.log('Warnung: keine Fahrräder gelesen. Falsches Konto oder leere Datenbank?');
  } else if (uid) {
    // Stillschweigend weglassen wäre schlecht: der Report sähe vollständig aus.
    const gesamt = (await db.collection('bikes').count().get()).data().count;
    if (gesamt > bikes.length) {
      console.log(`Hinweis: ${gesamt - bikes.length} Räder gehören zu einem anderen Konto und stehen bewusst nicht im Report.`);
    }
  }

  // Die Flyer-Historie ist im Browser nach Zeit sortiert - der KI-Report übernimmt sie 1:1.
  flyerHistory.sort((a: any, b: any) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  const report = buildAiReport({
    bikes: bikes as any,
    inventoryItems: inventoryItems as any,
    groupOrders: orders as any,
    serviceRequests: serviceRequests as any,
    dailyTodos: todos as any,
    logs: logs as any,
    flyerAreas,
    // "keine Werbung"-Häuser und Leads teilen sich eine Collection; für den Report
    // zählen nur die ausgeschlossenen Häuser (siehe src/lib/flyerLeads.ts).
    flyerExcluded: flyerHouses.filter(isExcludedDoc),
    flyerHistory: flyerHistory.map((h: any) => ({
      ts: h.ts, action: h.action, name: h.name, flyerCount: h.flyerCount, date: h.date ?? null, status: h.status ?? null,
    })),
  });

  const str = JSON.stringify(report);
  fs.writeFileSync(LATEST, str);

  fs.mkdirSync(ARCHIV, { recursive: true });
  const heute = new Date().toISOString().split('T')[0];
  fs.writeFileSync(path.join(ARCHIV, `ai_report_${heute}.json`), str);

  // Archiv begrenzen - sonst wächst der Ordner still vor sich hin.
  try {
    const alt = fs.readdirSync(ARCHIV).filter((n) => n.endsWith('.json')).sort();
    for (const datei of alt.slice(0, Math.max(0, alt.length - ARCHIV_TAGE))) {
      fs.unlinkSync(path.join(ARCHIV, datei));
    }
  } catch { /* Aufräumen ist Kür */ }

  const kb = Math.round(str.length / 1024);
  console.log(`Report geschrieben: ${bikes.length} Räder, ${flyerAreas.length} Flyer-Gebiete, ${logs.length} Logzeilen (${kb} KB).`);
  return EXIT_OK;
}

try {
  process.exit(await main());
} catch (e: any) {
  console.error('FEHLER beim AI-Report:', e?.message || e);
  if (e?.code === 7 || /PERMISSION_DENIED/i.test(String(e?.message))) {
    console.error('Das Dienstkonto darf die Datenbank nicht lesen. Rolle "Cloud Datastore User" prüfen.');
  }
  process.exit(EXIT_ERROR);
}
