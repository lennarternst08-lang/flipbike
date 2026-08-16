// WhatsApp-Nachrichten aus der Bridge-Datenbank abziehen.
//
// Liest messages.db/whatsapp.db DIREKT per node:sqlite (in Node 22+ eingebaut,
// keine Abhaengigkeiten). Braucht weder den MCP-Server noch ein LLM noch eine
// laufende Bridge - die Bridge muss nur irgendwann gelaufen sein, um Nachrichten
// abzuholen.
//
// Schreibt zwei Dateien:
//   whatsapp-context.md  rollierend die letzten 30 Tage, fuer Rueckfragen
//   whatsapp-neu.md      nur der Zuwachs seit dem letzten erfolgreichen Scan
//
// Exit-Codes steuern die aufrufende .bat:
//   0  = Neues vorhanden, Claude soll laufen
//   10 = heute schon gelaufen
//   11 = keine neuen Nachrichten
//   1  = Fehler
//
// ACHTUNG: Beide Ausgabedateien enthalten ALLE privaten Unterhaltungen.
// Sie sind gitignoriert und muessen es bleiben - der Build landet auf
// oeffentlichen GitHub Pages.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE = 'C:/Users/Hacker.HPGAME.000/whatsapp-mcp/whatsapp-bridge/store';
const MESSAGES_DB = path.join(STORE, 'messages.db');
const WHATSAPP_DB = path.join(STORE, 'whatsapp.db');

const CONTEXT_FILE = path.join(PROJECT, 'whatsapp-context.md');
const DELTA_FILE = path.join(PROJECT, 'whatsapp-neu.md');
const STATE_FILE = path.join(PROJECT, 'leads-inbox.state.json');

const CONTEXT_DAYS = 30;
const FORCE = process.argv.includes('--force'); // Tageswaechter uebergehen

// Optionale Zweitablage fuer den Kontext, damit ein Cloud-Ordner ihn mitnimmt und
// claude.ai ueber den Drive-Connector darauf zugreifen kann.
// Reihenfolge: Datei whatsapp-export-target.txt (ein Pfad pro Zeile) schlaegt alles,
// sonst werden die ueblichen Google-Drive-Orte probiert. Fehlt beides, passiert nichts.
const EXPORT_TARGET_FILE = path.join(PROJECT, 'whatsapp-export-target.txt');
const DRIVE_CANDIDATES = [
  'G:/Meine Ablage',
  'G:/My Drive',
  'C:/Users/Hacker.HPGAME.000/Meine Ablage',
  'C:/Users/Hacker.HPGAME.000/Google Drive',
];

function findExportDir() {
  try {
    const configured = fs.readFileSync(EXPORT_TARGET_FILE, 'utf8')
      .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    for (const dir of configured) if (fs.existsSync(dir)) return dir;
  } catch { /* keine Konfigurationsdatei -> Kandidaten probieren */ }
  for (const dir of DRIVE_CANDIDATES) if (fs.existsSync(dir)) return dir;
  return null;
}

const EXIT_OK = 0, EXIT_ERROR = 1, EXIT_ALREADY_TODAY = 10, EXIT_NO_NEW = 11;

// --- Zeit ---------------------------------------------------------------
// Die Bridge speichert Zeitstempel als TEXT: "2026-08-16 17:32:31+02:00".
// Verglichen wird deshalb als Text, nicht ueber Date-Arithmetik.
const toDbTime = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const todayISO = () => toDbTime(new Date()).slice(0, 10);

const readState = () => {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
};

// Eine Telefonnummer ist kein Name. In dieser Installation traegt nur 1 von 32
// chats-Zeilen einen echten Namen - die Masse kommt aus whatsmeow_contacts.
const isNumericName = (s) => /^[+\d\s-]+$/.test(String(s));

// --- Namensaufloesung ---------------------------------------------------
// Die messages-Tabelle hat keinen Absendernamen. Aufloesung wie im MCP-Server:
// chats.name -> whatsmeow_contacts -> ggf. ueber lid_map -> nackte Nummer.
function buildNameResolver(msgDb, waDb) {
  const chatNames = new Map();
  for (const r of msgDb.prepare('SELECT jid, name FROM chats').all()) {
    if (r.name && String(r.name).trim()) chatNames.set(r.jid, String(r.name).trim());
  }

  const contacts = new Map();
  const lidToPn = new Map();
  if (waDb) {
    try {
      for (const r of waDb.prepare(
        'SELECT their_jid, first_name, full_name, push_name, business_name FROM whatsmeow_contacts'
      ).all()) {
        const name = r.full_name || r.push_name || r.first_name || r.business_name;
        if (name && String(name).trim()) contacts.set(r.their_jid, String(name).trim());
      }
    } catch { /* Tabelle fehlt -> Fallback greift */ }
    try {
      for (const r of waDb.prepare('SELECT lid, pn FROM whatsmeow_lid_map').all()) {
        lidToPn.set(r.lid, r.pn);
      }
    } catch { /* optional */ }
  }

  const isNumeric = isNumericName;

  return function resolve(sender) {
    if (!sender) return 'Unbekannt';
    let user = String(sender).split('@')[0];

    // LIDs erst auf die Telefonnummer abbilden
    if (lidToPn.has(user)) user = String(lidToPn.get(user)).split('@')[0];
    else if (lidToPn.has(`${user}@lid`)) user = String(lidToPn.get(`${user}@lid`)).split('@')[0];

    const jid = `${user}@s.whatsapp.net`;
    const fromChat = chatNames.get(jid);
    if (fromChat && !isNumeric(fromChat)) return fromChat;
    const fromContact = contacts.get(jid);
    if (fromContact && !isNumeric(fromContact)) return fromContact;
    return user;
  };
}

// --- Ausgabe ------------------------------------------------------------
function renderMarkdown(rows, title, intro) {
  const byChat = new Map();
  for (const r of rows) {
    if (!byChat.has(r.chat_jid)) byChat.set(r.chat_jid, []);
    byChat.get(r.chat_jid).push(r);
  }

  const out = [`# ${title}`, '', intro, ''];
  // Unterhaltungen mit der juengsten Nachricht zuerst
  const chats = [...byChat.entries()].sort((a, b) => {
    const la = a[1][a[1].length - 1].timestamp, lb = b[1][b[1].length - 1].timestamp;
    return la < lb ? 1 : la > lb ? -1 : 0;
  });

  for (const [jid, msgs] of chats) {
    const isGroup = jid.endsWith('@g.us');
    const label = msgs[0].chat_label || jid.split('@')[0];
    out.push(`## ${label}${isGroup ? ' (Gruppe)' : ''}`, '');
    for (const m of msgs) {
      const when = m.timestamp.slice(0, 16);
      const who = m.is_from_me ? 'Ich' : m.sender_name;
      let text = (m.content || '').trim();
      if (!text && m.media_type) text = `[${m.media_type}]`;
      if (!text) continue;
      out.push(`- **${when} ${who}:** ${text.replace(/\n+/g, ' ')}`);
    }
    out.push('');
  }
  if (chats.length === 0) out.push('_Nichts im gewaehlten Zeitraum._', '');
  return out.join('\n');
}

// --- Hauptlauf ----------------------------------------------------------
function main() {
  if (!fs.existsSync(MESSAGES_DB)) {
    console.error(`FEHLER: ${MESSAGES_DB} nicht gefunden.`);
    return EXIT_ERROR;
  }

  const state = readState();
  if (!FORCE && state.lastRunDate === todayISO()) {
    console.log(`SKIP: heute (${todayISO()}) schon gelaufen.`);
    return EXIT_ALREADY_TODAY;
  }

  // Strikt nur lesend oeffnen. Die Bridge nutzt kein WAL (journal_mode=delete);
  // ein Schreibvorgang haelt kurz eine exklusive Sperre, daher busy_timeout.
  // Schreibend oeffnen wuerde ausserdem Hot-Journal-Rollback ausloesen koennen.
  const msgDb = new DatabaseSync(MESSAGES_DB, { readOnly: true });
  msgDb.exec('PRAGMA busy_timeout = 5000');

  let waDb = null;
  try {
    waDb = new DatabaseSync(WHATSAPP_DB, { readOnly: true });
    waDb.exec('PRAGMA busy_timeout = 5000');
  } catch (e) {
    console.log(`Hinweis: whatsapp.db nicht lesbar (${e.message}) - Namen kommen nur aus chats.name.`);
  }

  try {
    const resolveName = buildNameResolver(msgDb, waDb);

    const since = new Date();
    since.setDate(since.getDate() - CONTEXT_DAYS);
    const contextFrom = toDbTime(since);

    // deleted_at IS NULL: zurueckgezogene Nachrichten bleiben aussen vor.
    // status@broadcast sind WhatsApp-Status-Updates, keine Unterhaltung - nur Rauschen.
    const query = msgDb.prepare(`
      SELECT m.timestamp, m.sender, m.content, m.is_from_me, m.media_type,
             m.chat_jid, c.name AS chat_name
      FROM messages m
      JOIN chats c ON m.chat_jid = c.jid
      WHERE m.deleted_at IS NULL
        AND m.chat_jid != 'status@broadcast'
        AND m.timestamp > ?
      ORDER BY m.timestamp ASC
    `);

    // Bei Gruppen ist chats.name der Gruppenname und damit richtig. Bei Einzelchats
    // steht dort meist nur die Nummer - dann ueber die Kontakte aufloesen.
    const chatLabel = (jid, name) => {
      const trimmed = name ? String(name).trim() : '';
      if (jid.endsWith('@g.us')) return trimmed || jid.split('@')[0];
      if (trimmed && !isNumericName(trimmed)) return trimmed;
      return resolveName(jid);
    };

    const decorate = (rows) => rows.map((r) => ({
      ...r,
      is_from_me: !!r.is_from_me,
      sender_name: r.is_from_me ? 'Ich' : resolveName(r.sender),
      chat_label: chatLabel(r.chat_jid, r.chat_name),
    }));

    const contextRows = decorate(query.all(contextFrom));
    fs.writeFileSync(CONTEXT_FILE, renderMarkdown(
      contextRows,
      `WhatsApp-Kontext (letzte ${CONTEXT_DAYS} Tage)`,
      `Stand: ${toDbTime(new Date())} · ${contextRows.length} Nachrichten.\n` +
      `Automatisch erzeugt von scripts/whatsapp-dump.mjs. Nicht von Hand bearbeiten.\n` +
      `Enthaelt private Unterhaltungen - gitignoriert, nicht weitergeben.`
    ), 'utf8');

    // Delta: alles seit dem letzten ERFOLGREICHEN Scan. Faellt ein Lauf aus,
    // sind dieselben Nachrichten beim naechsten Mal wieder dabei.
    const lastScan = state.lastScan
      ? state.lastScan.replace('T', ' ').slice(0, 19)
      : contextFrom;
    const deltaRows = decorate(query.all(lastScan));

    fs.writeFileSync(DELTA_FILE, renderMarkdown(
      deltaRows,
      'Neue WhatsApp-Nachrichten',
      `Zeitraum: seit ${lastScan} · ${deltaRows.length} Nachrichten.\n` +
      `Nur dieser Zuwachs ist zu pruefen - der volle Rueckblick steht in whatsapp-context.md.`
    ), 'utf8');

    console.log(`Kontext: ${contextRows.length} Nachrichten (${CONTEXT_DAYS} Tage) -> ${path.basename(CONTEXT_FILE)}`);
    console.log(`Neu seit ${lastScan}: ${deltaRows.length} -> ${path.basename(DELTA_FILE)}`);

    // Zweitablage in den Cloud-Ordner, falls vorhanden. Nie den Lauf scheitern lassen -
    // der eigentliche Zweck (Leads finden) haengt nicht daran.
    const exportDir = findExportDir();
    if (exportDir) {
      try {
        const target = path.join(exportDir, 'whatsapp-context.md');
        fs.copyFileSync(CONTEXT_FILE, target);
        console.log(`Kopie fuer die Cloud: ${target}`);
      } catch (e) {
        console.log(`Hinweis: Cloud-Kopie fehlgeschlagen (${e.message}).`);
      }
    } else {
      console.log('Kein Cloud-Ordner gefunden - Kontext bleibt nur lokal.');
    }

    if (deltaRows.length === 0) {
      console.log('Nichts Neues - Claude wird nicht gestartet.');
      return EXIT_NO_NEW;
    }
    return EXIT_OK;
  } finally {
    msgDb.close();
    if (waDb) waDb.close();
  }
}

try {
  process.exit(main());
} catch (e) {
  console.error('FEHLER:', e.message);
  process.exit(EXIT_ERROR);
}
