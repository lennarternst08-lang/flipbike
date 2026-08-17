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
import { copyToCloud } from './cloud-copy.mjs';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE = 'C:/Users/Hacker.HPGAME.000/whatsapp-mcp/whatsapp-bridge/store';
const MESSAGES_DB = path.join(STORE, 'messages.db');
const WHATSAPP_DB = path.join(STORE, 'whatsapp.db');

const CONTEXT_FILE = path.join(PROJECT, 'whatsapp-context.md');
const DELTA_FILE = path.join(PROJECT, 'whatsapp-neu.md');
const STATE_FILE = path.join(PROJECT, 'leads-inbox.state.json');

const FORCE = process.argv.includes('--force'); // Tageswaechter uebergehen

// Optionale Zweitablage fuer den Kontext, damit ein Cloud-Ordner ihn mitnimmt und
// claude.ai ueber den Drive-Connector darauf zugreifen kann.
// Reihenfolge: Datei whatsapp-export-target.txt (ein Pfad pro Zeile) schlaegt alles,
// sonst werden die ueblichen Google-Drive-Orte probiert. Fehlt beides, passiert nichts.
// Ablage in den Drive-Ordner steckt in cloud-copy.mjs, weil sie auch nach dem
// Claude-Schritt nochmal gebraucht wird (fuer die Tagesnotiz).

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

    // --- Datei 1: ALLES. Vollstaendiger Verlauf, bei jedem Lauf neu geschrieben. ---
    const allRows = decorate(query.all('0000'));
    fs.writeFileSync(CONTEXT_FILE, renderMarkdown(
      allRows,
      'WhatsApp - vollstaendiger Verlauf',
      `Stand: ${toDbTime(new Date())} · ${allRows.length} Nachrichten, alles was die Bridge hat.\n` +
      `Bei jedem Lauf komplett neu geschrieben. Nicht von Hand bearbeiten.\n` +
      `Fuer den heutigen Tag siehe whatsapp-neu.md.\n` +
      `Enthaelt private Unterhaltungen - gitignoriert, nicht weitergeben.`
    ), 'utf8');

    // --- Datei 2: HEUTE. Immer der laufende Tag, damit die Datei jederzeit ---
    // --- etwas Sinnvolles zeigt und nicht direkt nach einem Lauf leer ist.  ---
    // Reicht der letzte Scan weiter zurueck als Mitternacht, gilt der frueheste
    // Zeitpunkt - so faellt nichts durch, wenn ein Tag ohne Lauf verstrichen ist.
    const lastScan = state.lastScan ? state.lastScan.replace('T', ' ').slice(0, 19) : '0000';
    const midnight = `${todayISO()} 00:00:00`;
    const dayFrom = lastScan < midnight ? lastScan : midnight;

    const dayRows = decorate(query.all(dayFrom));
    fs.writeFileSync(DELTA_FILE, renderMarkdown(
      dayRows,
      'WhatsApp - neue Nachrichten',
      `Zeitraum: seit ${dayFrom} · ${dayRows.length} Nachrichten.\n` +
      `Normalerweise der heutige Tag; liegt der letzte Scan laenger zurueck,\n` +
      `reicht der Zeitraum entsprechend weiter, damit nichts uebersehen wird.\n` +
      `Der vollstaendige Verlauf steht in whatsapp-context.md.`
    ), 'utf8');

    // Ob Claude laufen muss, entscheidet der UNVERARBEITETE Rest - nicht der
    // Tagesinhalt. Sonst liefe der Job jeden Tag erneut ueber dieselben Nachrichten.
    const unprocessed = decorate(query.all(lastScan)).length;

    console.log(`Alles : ${allRows.length} Nachrichten -> ${path.basename(CONTEXT_FILE)}`);
    console.log(`Heute : ${dayRows.length} Nachrichten (seit ${dayFrom}) -> ${path.basename(DELTA_FILE)}`);
    console.log(`Davon noch nicht ausgewertet: ${unprocessed}`);

    // Zweitablage im Cloud-Ordner, damit der Drive-Connector von claude.ai
    // live darauf zugreifen kann. Nie den Lauf scheitern lassen - der eigentliche
    // Zweck (Leads finden) haengt nicht daran.
    copyToCloud([CONTEXT_FILE, DELTA_FILE]);

    if (unprocessed === 0) {
      console.log('Nichts Unverarbeitetes - Claude wird nicht gestartet.');
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
