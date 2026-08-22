// Vergleicht den frischen ai_report mit dem Stand des letzten ausgewerteten Laufs
// und schreibt die Unterschiede als lesbares Markdown nach ai-report-neu.md.
//
//   Aufruf:  node scripts/ai-report-diff.mjs
//
//   Eingang:  ai-report-prev.json    (Stand des letzten Laufs, rückt erst nach
//                                     erfolgreicher Auswertung nach - wie lastScan
//                                     bei WhatsApp)
//             ai-report-latest.json  (gerade erzeugt von ai-report-dump.mts)
//   Ausgang:  ai-report-neu.md
//
//   Exit-Codes:
//     0  = es gibt Änderungen (bzw. Erstaufnahme)
//     11 = nichts verändert
//     1  = Fehler
//
// KOSTET KEINE TOKENS: hier rechnet nur Node. Der Text ist Vorarbeit für den
// Claude-Schritt, der daraus die Tagesnotiz schreibt.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREV = path.join(PROJECT, 'ai-report-prev.json');
const LATEST = path.join(PROJECT, 'ai-report-latest.json');
const OUT = path.join(PROJECT, 'ai-report-neu.md');
const MAX_LOGZEILEN = 40;

const EXIT_CHANGED = 0;
const EXIT_ERROR = 1;
const EXIT_NOTHING = 11;

const eur = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n || 0);
const num = (n) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(n || 0);

/** Vorzeichenbehaftete Differenz, z. B. "+56,00 €". Ohne Änderung: null. */
const deltaEur = (neu, alt) => {
  const d = round2((neu || 0) - (alt || 0));
  return d === 0 ? null : `${d > 0 ? '+' : '−'}${eur(Math.abs(d))}`;
};
const deltaNum = (neu, alt, einheit = '') => {
  const d = round2((neu || 0) - (alt || 0));
  return d === 0 ? null : `${d > 0 ? '+' : '−'}${num(Math.abs(d))}${einheit}`;
};
const round2 = (n) => Math.round((n || 0) * 100) / 100;

/** Sekunden → "3 h 20 min" bzw. "45 min". */
const dauer = (sek) => {
  const min = Math.round((sek || 0) / 60);
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`;
};
const dauerMin = (min) => dauer((min || 0) * 60);

/** ISO-Zeitstempel als Ortszeit, sonst steht in der Notiz UTC neben der lokalen Uhrzeit. */
const dat = (iso) => {
  if (!iso) return '?';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).replace('T', ' ').slice(0, 16);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const laden = (datei) => {
  try { return JSON.parse(fs.readFileSync(datei, 'utf8')); } catch { return null; }
};

const byId = (arr, key = 'id') => {
  const m = new Map();
  for (const x of arr || []) m.set(x[key], x);
  return m;
};

/** Mengen-Vergleich für Einträge ohne Id (Ausgaben, Arbeitszeiten): neue Elemente per Schlüssel. */
const neueEintraege = (neu, alt, schluessel) => {
  const zaehler = new Map();
  for (const a of alt || []) {
    const k = schluessel(a);
    zaehler.set(k, (zaehler.get(k) || 0) + 1);
  }
  const raus = [];
  for (const n of neu || []) {
    const k = schluessel(n);
    if (zaehler.get(k)) zaehler.set(k, zaehler.get(k) - 1);
    else raus.push(n);
  }
  return raus;
};

function main() {
  const latest = laden(LATEST);
  if (!latest) {
    console.log('Kein ai-report-latest.json - nichts zu vergleichen.');
    return EXIT_NOTHING;
  }
  const prev = laden(PREV);
  const zeilen = [];
  const abschnitt = (titel, inhalt) => {
    if (inhalt.length === 0) return;
    zeilen.push(`## ${titel}`, '', ...inhalt, '');
  };

  if (!prev) {
    // Erstlauf: es gibt keinen Vergleichsstand, also die Ausgangslage festhalten.
    const s = latest.stats || {};
    zeilen.push(
      '# Betrieb – Erstaufnahme',
      '',
      `Stand ${dat(latest._cfg?.pt)}. Es gibt noch keinen Vorlauf zum Vergleichen,`,
      'ab morgen stehen hier nur noch die Änderungen zum Vortag.',
      '',
      '## Ausgangslage',
      '',
      `- ${s.counts?.all ?? 0} Räder erfasst (${s.counts?.active ?? 0} aktiv, ${s.counts?.sold ?? 0} verkauft)`,
      `- Umsatz ${eur(s.rev)}, Gewinn ${eur(s.prof)}`,
      `- Stundenlohn ${eur(s.hw)}/h, Geschäfts-Stundenlohn ${eur(s.geschHw)}/h`,
      `- Gebundenes Kapital ${eur(s.capActiv)}, Lagerwert ${eur(s.lagerwert)}`,
      `- Flyer: ${latest.flyer?.distd ?? 0} verteilt in ${latest.flyer?.areas ?? 0} Gebieten`,
      '',
    );
    fs.writeFileSync(OUT, zeilen.join('\n'));
    console.log('Erstaufnahme geschrieben (kein Vorlauf vorhanden).');
    return EXIT_CHANGED;
  }

  // ---------------------------------------------------------------- Kennzahlen
  const ps = prev.stats || {}, ls = latest.stats || {};
  const kennzahlen = [];
  const kz = (label, neu, alt, formatiert = eur, einheit = '') => {
    const d = formatiert === eur ? deltaEur(neu, alt) : deltaNum(neu, alt, einheit);
    if (d) kennzahlen.push(`- ${label}: ${formatiert(neu)}${einheit} (${d})`);
  };
  kz('Gewinn', ls.prof, ps.prof);
  kz('Umsatz', ls.rev, ps.rev);
  kz('Stundenlohn verkaufter Räder', ls.hw, ps.hw);
  kz('Geschäfts-Stundenlohn', ls.geschHw, ps.geschHw);
  kz('Gebundenes Kapital (aktive Räder)', ls.capActiv, ps.capActiv);
  kz('Lagerwert', ls.lagerwert, ps.lagerwert);
  kz('Erfasste Arbeitszeit gesamt', ls.tt, ps.tt, num, ' h');
  kz('Kleinanzeigen-Gebühren', ls.kleinanzeigen?.cost, ps.kleinanzeigen?.cost);
  if (ls.avgStandzeit !== ps.avgStandzeit && ls.avgStandzeit != null) {
    const d = deltaNum(ls.avgStandzeit, ps.avgStandzeit ?? ls.avgStandzeit, ' Tage');
    kennzahlen.push(`- Ø Standzeit: ${num(ls.avgStandzeit)} Tage${d ? ` (${d})` : ''}`);
  }
  abschnitt('Kennzahlen', kennzahlen);

  // --------------------------------------------------------------------- Räder
  const pb = byId(prev.bikes), lb = byId(latest.bikes);
  const raeder = [];
  const zeit = [];
  const material = [];

  for (const [id, b] of lb) {
    const alt = pb.get(id);
    if (!alt) {
      raeder.push(`- **NEU: ${b.name}** – EK ${eur(b.bp)}, Status „${b.st}"${b.tp ? `, Ziel-VK ${eur(b.tp)}` : ''}${b.acq ? `, Quelle ${b.acq}` : ''}`);
      continue;
    }
    if (alt.st !== b.st) {
      if (b.st === 'Verkauft') {
        const kosten = b.bp + (b.exp || []).reduce((s, e) => s + (e.a || 0), 0);
        raeder.push(`- **VERKAUFT: ${b.name}** für ${eur(b.sp)} – Marge ${eur(round2(b.sp - kosten))} bei ${dauer(b.tz)} Arbeit`);
      } else {
        raeder.push(`- **${b.name}**: „${alt.st}" → „${b.st}"${b.tp ? ` (Ziel-VK ${eur(b.tp)})` : ''}`);
      }
    } else if (alt.sp !== b.sp && b.sp) {
      raeder.push(`- **${b.name}**: Verkaufspreis ${eur(alt.sp)} → ${eur(b.sp)}`);
    }
    if (alt.tp !== b.tp && b.st !== 'Verkauft') {
      raeder.push(`- **${b.name}**: Ziel-VK ${alt.tp ? eur(alt.tp) : 'nicht gesetzt'} → ${b.tp ? eur(b.tp) : 'nicht gesetzt'}`);
    }

    // Neue Arbeitszeiten (Schlüssel: Zeitstempel des Eintrags)
    const neueZeiten = neueEintraege(b.wl, alt.wl, (w) => `${w.dt}`);
    for (const w of neueZeiten) {
      zeit.push(`- **${b.name}**: ${dauer(w.s)}${w.n ? ` – „${w.n}"` : ''}`);
    }
    // Stoppuhr ohne Einzeleintrag: dann wenigstens die Summe melden
    const zeitDelta = (b.tz || 0) - (alt.tz || 0);
    if (zeitDelta > 0 && neueZeiten.length === 0) {
      zeit.push(`- **${b.name}**: ${dauer(zeitDelta)} (ohne Einzelnotiz)`);
    }

    // Neue Ausgaben / verbautes Material
    for (const e of neueEintraege(b.exp, alt.exp, (x) => `${x.dt}|${x.a}|${x.d}`)) {
      const woher = e.id ? ' (aus dem Lager)' : '';
      const art = e.cat === 'kleinanzeigen' ? 'Inseratgebühr' : e.d;
      material.push(`- **${b.name}**: ${art} ${eur(e.a)}${woher}`);
    }

    // Offene To-dos am Rad
    const neuOffen = (b.todos || []).filter((t) => !(alt.todos || []).includes(t));
    const erledigt = (alt.todos || []).filter((t) => !(b.todos || []).includes(t));
    for (const t of neuOffen) raeder.push(`- **${b.name}**: neues To-do „${t}"`);
    for (const t of erledigt) raeder.push(`- **${b.name}**: To-do erledigt „${t}"`);
  }
  for (const [id, b] of pb) {
    if (!lb.has(id)) raeder.push(`- Entfernt: **${b.name}** (war „${b.st}")`);
  }
  abschnitt('Räder', raeder);

  const zeitSumme = [...lb.values()].reduce((s, b) => s + (b.tz || 0), 0)
    - [...pb.values()].reduce((s, b) => s + (b.tz || 0), 0);
  if (zeit.length) zeit.push(`- Summe neu erfasst: **${dauer(zeitSumme)}**`);
  abschnitt('Arbeitszeit', zeit);
  abschnitt('Material & Ausgaben', material);

  // --------------------------------------------------------------------- Lager
  const pi = byId(prev.inv), li = byId(latest.inv);
  const lager = [];
  for (const [id, i] of li) {
    const alt = pi.get(id);
    if (!alt) {
      lager.push(`- Neu im Lager: **${i.name}** ${num(i.iq)} × ${eur(i.c)}`);
    } else if (alt.q !== i.q) {
      const d = round2(i.q - alt.q);
      lager.push(`- **${i.name}**: ${num(alt.q)} → ${num(i.q)} (${d > 0 ? '+' : '−'}${num(Math.abs(d))})`);
    }
  }
  for (const [id, i] of pi) if (!li.has(id)) lager.push(`- Aus dem Lager entfernt: **${i.name}**`);
  abschnitt('Lager', lager);

  // -------------------------------------------------------------------- Flyer
  const pf = prev.flyer || {}, lf = latest.flyer || {};
  const flyer = [];
  // Gebiete tragen in der Praxis fast nie einen Namen - dann ueber das Datum ansprechen.
  const gebietName = (a) => a.name || (a.date ? `Gebiet vom ${a.date}` : 'Gebiet ohne Namen');
  const gebietKey = (a) => `${a.name}|${a.date}`;
  const altGebiete = byId(pf.areaDetails || [], 'name');
  for (const a of lf.areaDetails || []) {
    const alt = (pf.areaDetails || []).find((x) => gebietKey(x) === gebietKey(a));
    if (!alt) {
      const altName = altGebiete.get(a.name);
      if (altName) {
        flyer.push(`- Gebiet **${gebietName(a)}** geändert: ${num(a.flyerCount)} Flyer, ${dauerMin(a.durationMin)}, Status „${a.status}"`);
      } else {
        flyer.push(`- **Neues ${gebietName(a)}**: ${num(a.flyerCount)} Flyer, ${dauerMin(a.durationMin)}, Status „${a.status}"${a.note ? ` – „${a.note}"` : ''}`);
      }
    } else if (alt.status !== a.status) {
      flyer.push(`- Gebiet **${gebietName(a)}**: „${alt.status}" → „${a.status}"`);
    }
  }
  const dFlyer = deltaNum(lf.distd, pf.distd);
  if (dFlyer) flyer.push(`- Verteilte Flyer gesamt: ${num(lf.distd)} (${dFlyer})`);
  const dDauer = round2((lf.durationMin || 0) - (pf.durationMin || 0));
  if (dDauer) flyer.push(`- Verteilzeit gesamt: ${dauerMin(lf.durationMin)} (${dDauer > 0 ? '+' : '−'}${dauerMin(Math.abs(dDauer))})`);
  const dLeadRad = deltaNum(lf.bikesFromFlyer, pf.bikesFromFlyer);
  if (dLeadRad) flyer.push(`- Räder aus Flyer-Akquise: ${lf.bikesFromFlyer} (${dLeadRad})`);
  const dHaeuser = deltaNum(lf.excHouses, pf.excHouses);
  if (dHaeuser) flyer.push(`- „Keine Werbung"-Häuser: ${lf.excHouses} (${dHaeuser})`);
  abschnitt('Flyer', flyer);

  // ------------------------------------------------- Serviceanfragen & To-dos
  const psv = byId(prev.svcReq || [], 'dt'), lsv = byId(latest.svcReq || [], 'dt');
  const service = [];
  for (const [id, s] of lsv) {
    const alt = psv.get(id);
    if (!alt) service.push(`- **Neue Anfrage von ${s.name}**: ${s.iss} (Abgabe ${s.drop}, Status „${s.st}")`);
    else if (alt.st !== s.st) service.push(`- Anfrage ${s.name}: „${alt.st}" → „${s.st}"`);
  }
  for (const [id, s] of psv) if (!lsv.has(id)) service.push(`- Anfrage von ${s.name} entfernt`);
  abschnitt('Serviceanfragen', service);

  const pt = byId(prev.sysTodos || [], 't'), lt = byId(latest.sysTodos || [], 't');
  const todos = [];
  for (const [text, t] of lt) {
    const alt = pt.get(text);
    if (!alt) todos.push(`- Neu: „${text}"${t.c ? ' (schon erledigt)' : ''}`);
    else if (alt.c !== t.c) todos.push(`- ${t.c ? 'Erledigt' : 'Wieder offen'}: „${text}"`);
  }
  for (const [text] of pt) if (!lt.has(text)) todos.push(`- Gestrichen: „${text}"`);
  abschnitt('Tages-To-dos', todos);

  // -------------------------------------------------------- Aktivitätsprotokoll
  const alteLogs = new Set((prev.logs || []).map((l) => `${l.ts}|${l.m}`));
  const neueLogs = (latest.logs || []).filter((l) => !alteLogs.has(`${l.ts}|${l.m}`))
    .sort((a, b) => a.ts - b.ts);
  const logZeilen = neueLogs.slice(-MAX_LOGZEILEN).map((l) => {
    // Ortszeit, nicht UTC: die Notiz liest ein Mensch in Braunschweig.
    const d = new Date(l.ts);
    const p = (n) => String(n).padStart(2, '0');
    const t = `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())}`;
    return `- ${t} [${l.mod}] ${l.m}`;
  });
  if (neueLogs.length > MAX_LOGZEILEN) {
    logZeilen.unshift(`- (${neueLogs.length - MAX_LOGZEILEN} ältere Einträge hier weggelassen, die letzten ${MAX_LOGZEILEN} stehen unten)`);
  }
  abschnitt('Aktivitätsprotokoll', logZeilen);

  if (zeilen.length === 0) {
    fs.writeFileSync(OUT, [
      '# Betrieb – keine Änderungen',
      '',
      `Zwischen ${dat(prev._cfg?.pt)} und ${dat(latest._cfg?.pt)} hat sich in den Daten nichts getan.`,
      '',
    ].join('\n'));
    console.log('Keine Änderungen im Datenbestand.');
    return EXIT_NOTHING;
  }

  const kopf = [
    '# Betriebs-Änderungen seit dem letzten Lauf',
    '',
    `Vergleich: **${dat(prev._cfg?.pt)}** → **${dat(latest._cfg?.pt)}**`,
    '',
  ];
  fs.writeFileSync(OUT, [...kopf, ...zeilen].join('\n'));
  console.log(`Änderungen geschrieben: ${zeilen.filter((z) => z.startsWith('- ')).length} Punkte.`);
  return EXIT_CHANGED;
}

try {
  process.exit(main());
} catch (e) {
  console.error('FEHLER beim Vergleich:', e?.message || e);
  process.exit(EXIT_ERROR);
}
