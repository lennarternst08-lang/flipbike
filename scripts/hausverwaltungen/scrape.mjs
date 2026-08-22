// Sammelt alle Hausverwaltungen, Genossenschaften, Wohnungsunternehmen,
// Wohnheim- und Pflegetraeger in Braunschweig samt Telefon und E-Mail.
//
//   Aufruf:  node scripts/hausverwaltungen/scrape.mjs
//            node scripts/hausverwaltungen/scrape.mjs --stadt "Wolfenbüttel"
//            node scripts/hausverwaltungen/scrape.mjs --ohne-impressum   (nur Karte, schnell)
//            node scripts/hausverwaltungen/scrape.mjs --limit 20         (Probelauf)
//
//   Ausgang: hausverwaltungen/hausverwaltungen-<stadt>.xlsx   <- die Arbeitsliste
//            hausverwaltungen/hausverwaltungen-<stadt>.csv    <- dasselbe fuer Excel/Sheets
//            hausverwaltungen/hausverwaltungen-<stadt>.json   <- Rohdaten fuer Folgelaeufe
//
// Drei Quellen laufen nacheinander:
//   1. OpenStreetMap ueber Overpass - Firmen mit passendem Tag ODER passendem Namen
//   2. Nominatim - Freitextsuche je Suchbegriff, faengt was Overpass verpasst
//   3. Die kuratierte Liste der Stadt Braunschweig aus quellen.mjs
// Danach holt der Impressum-Schritt zu jeder gefundenen Website Telefon und
// E-Mail. Das ist der Teil, der die Liste ueberhaupt anschreibbar macht:
// in OSM steht fast nie eine Adresse drin.
//
// Ein zweiter Lauf ueberschreibt die Tabelle, behaelt aber die Spalten
// "Angeschrieben am" und "Notiz" aus der vorhandenen JSON - der Arbeitsstand
// geht also nicht verloren.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { xlsxBauen } from './xlsx-mini.mjs';
import {
  OVERPASS_SPIEGEL, NOMINATIM, OSM_FILTER, NAMENS_BAUSTEINE, KATEGORIEN,
  SEEDS, IMPRESSUM_PFADE, EMAIL_SPERRE, BS_VORWAHLEN, BRANCHENFREMD,
} from './quellen.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HIER, '..', '..');
const AUSGABE_ORDNER = path.join(PROJECT, 'hausverwaltungen');

const UA = 'flipbike-hausverwaltungen/1.0 (Fahrrad-Abholung Braunschweig)';
const PARALLEL = 5;            // gleichzeitige Website-Abrufe
const ABRUF_TIMEOUT = 20000;

// ---------------------------------------------------------------- Argumente

const argv = process.argv.slice(2);
const arg = (name, standard) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : standard;
};
const flag = (name) => argv.includes(`--${name}`);

const STADT = arg('stadt', 'Braunschweig');
const LIMIT = Number(arg('limit', 0)) || 0;
const OHNE_IMPRESSUM = flag('ohne-impressum');
const IST_BRAUNSCHWEIG = STADT.toLowerCase() === 'braunschweig';

const log = (...t) => console.log(...t);
const warn = (...t) => console.warn('  !', ...t);

// ------------------------------------------------------------------ Helfer

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch mit Timeout und Standard-Kopfzeilen. Wirft nie - liefert null bei Fehlern. */
async function holen(url, optionen = {}) {
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), optionen.timeout || ABRUF_TIMEOUT);
  try {
    const antwort = await fetch(url, {
      ...optionen,
      signal: abbruch.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept-Language': 'de-DE,de;q=0.9', ...(optionen.headers || {}) },
    });
    return antwort;
  } catch {
    return null;
  } finally {
    clearTimeout(uhr);
  }
}

/** Arbeitet eine Liste mit begrenzter Gleichzeitigkeit ab. */
async function parallelMap(liste, anzahl, arbeit) {
  const ergebnis = new Array(liste.length);
  let naechster = 0;
  const arbeiter = Array.from({ length: Math.min(anzahl, liste.length) }, async () => {
    while (naechster < liste.length) {
      const i = naechster++;
      ergebnis[i] = await arbeit(liste[i], i);
    }
  });
  await Promise.all(arbeiter);
  return ergebnis;
}

/** Wie verlaesslich ist der Name aus dieser Quelle? Kleiner = besser. */
const QUELLEN_RANG = { 'Stadt Braunschweig': 0, 'eigene Liste': 0, OpenStreetMap: 1, Nominatim: 2 };
const quellenRang = (q) => QUELLEN_RANG[q] ?? 3;

/** Vergleichsform eines Firmennamens - fuer das Zusammenfuehren von Dubletten. */
const namensSchluessel = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\b(gmbh|mbh|co|kg|ohg|ag|e\.?\s?g|eg|e\.?\s?v|ug|se|und|&|die|der|das)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();

/** Registrierbare Domain ohne www - der zuverlaessigste Dublettenschluessel. */
const domainVon = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
};

const urlNormalisieren = (roh) => {
  if (!roh) return '';
  let u = String(roh).trim().split(/[\s;,]/)[0];
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u.replace(/^\/+/, '')}`;
  try {
    const parsed = new URL(u);
    if (!parsed.hostname.includes('.')) return '';
    return parsed.origin;
  } catch {
    return '';
  }
};

/** Bringt deutsche Telefonnummern auf eine einheitliche, waehlbare Form. */
function telefonNormalisieren(roh) {
  if (!roh) return '';
  let t = String(roh).split(/[;,]|\s+oder\s+/i)[0].trim();
  t = t.replace(/\s*\(0\)\s*/g, '').replace(/[^\d+]/g, '');
  if (!t) return '';
  if (t.startsWith('0049')) t = `+49${t.slice(4)}`;
  if (t.startsWith('49') && !t.startsWith('+')) t = `+${t}`;
  if (t.startsWith('0')) t = `+49${t.slice(1)}`;
  if (!t.startsWith('+49')) return '';
  const ziffern = t.slice(3);
  if (ziffern.length < 6 || ziffern.length > 13) return '';
  const vorwahl = BS_VORWAHLEN.find((v) => ziffern.startsWith(v));
  if (vorwahl) return `+49 ${vorwahl} ${ziffern.slice(vorwahl.length)}`;
  // Ausserhalb der Region raten wir die Vorwahl nicht - lieber ungetrennt als falsch getrennt.
  return `+49 ${ziffern}`;
}

const emailBrauchbar = (mail) => {
  if (!mail || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(mail)) return false;
  return !EMAIL_SPERRE.some((muster) => muster.test(mail));
};

/**
 * Bewertet, wie gut eine E-Mail als Anschreib-Adresse taugt.
 * info@ und kontakt@ schlagen die Adresse eines einzelnen Mitarbeiters.
 */
function emailRang(mail) {
  const lokal = mail.split('@')[0].toLowerCase();
  if (/^(info|kontakt|contact|mail|office|zentrale|verwaltung|buero|service)$/.test(lokal)) return 0;
  if (/^(info|kontakt|verwaltung|service|hausverwaltung|vermietung)/.test(lokal)) return 1;
  if (/datenschutz|dsb|presse|bewerbung|jobs|karriere|marketing/.test(lokal)) return 4;
  return 2;
}

/**
 * Schiebt einen Eintrag in die passende Zielgruppen-Schublade.
 * Der Name zaehlt mehr als das Tag: eine "Hausverwaltung Meyer" bleibt eine
 * Hausverwaltung, auch wenn in OSM nur "office=company" steht.
 * Liefert null, wenn weder Name noch Tag zur Zielgruppe passen.
 */
function einordnen(name, osmTag = '') {
  // Ein eindeutiges Wohn-Muster im Namen sticht alles Weitere.
  const perName = KATEGORIEN.find((k) => k.muster && k.muster.test(name));
  if (perName) return { kategorie: perName.name, prio: perName.prio };

  // Eine Bank bleibt eine Bank, auch wenn "eG" hinten steht.
  if (BRANCHENFREMD.test(name)) return null;

  const perSchwach = KATEGORIEN.find((k) => k.schwach && k.schwach.test(name));
  if (perSchwach) return { kategorie: perSchwach.name, prio: perSchwach.prio };

  const perTag = KATEGORIEN.find((k) => k.tagMuster && k.tagMuster.test(osmTag));
  if (perTag) return { kategorie: perTag.name, prio: perTag.prio };

  return null;
}

// ------------------------------------------------------- Quelle 1: Overpass

/** Baut die Overpass-Abfrage: Tag-Treffer, Namens-Treffer und Wohnhaus-Betreiber. */
function overpassAbfrage(stadt) {
  const tagZeilen = OSM_FILTER.map((f) => `nwr${f}(area.ort);`).join('\n  ');
  // Overpass-Regex kennt keine Umlaut-Faltung, deshalb beide Schreibweisen mitgeben.
  const namensRegex = NAMENS_BAUSTEINE
    .map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  return `[out:json][timeout:180];
area["name"="${stadt}"]["boundary"="administrative"]["admin_level"~"^(6|8)$"]->.ort;
(
  ${tagZeilen}
  nwr["name"~"${namensRegex}",i](area.ort);
  nwr["operator"~"${namensRegex}",i](area.ort);
  nwr["building"~"^(apartments|dormitory|residential)$"]["operator"](area.ort);
  nwr["landuse"="residential"]["operator"](area.ort);
);
out center tags;`;
}

async function ausOverpass(stadt) {
  const abfrage = overpassAbfrage(stadt);

  for (const spiegel of OVERPASS_SPIEGEL) {
    log(`  Overpass: ${new URL(spiegel).hostname} ...`);
    const antwort = await holen(spiegel, {
      method: 'POST',
      body: new URLSearchParams({ data: abfrage }),
      timeout: 190000,
    });
    if (!antwort || !antwort.ok) {
      warn(`${new URL(spiegel).hostname} antwortet nicht (${antwort ? antwort.status : 'Verbindung'})`);
      continue;
    }
    let daten;
    try {
      daten = await antwort.json();
    } catch {
      warn(`${new URL(spiegel).hostname} liefert kein JSON`);
      continue;
    }

    const eintraege = [];
    for (const el of daten.elements || []) {
      const t = el.tags || {};
      const name = t.name || t.operator || t['official_name'] || t.brand;
      if (!name) continue;

      const osmTag = [t.office, t.shop, t.amenity, t.building, t.landuse].filter(Boolean).join(' ');
      eintraege.push({
        name: String(name).trim(),
        strasse: [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' '),
        plz: t['addr:postcode'] || '',
        ort: t['addr:city'] || stadt,
        telefon: t.phone || t['contact:phone'] || t['contact:mobile'] || '',
        email: t.email || t['contact:email'] || '',
        website: t.website || t['contact:website'] || t.url || '',
        osmTag,
        quelle: 'OpenStreetMap',
        osmId: `${el.type}/${el.id}`,
      });
    }
    if (!eintraege.length) {
      warn(`${new URL(spiegel).hostname} liefert keinen einzigen Treffer - naechster Spiegel`);
      continue;
    }
    log(`  Overpass: ${eintraege.length} Rohtreffer`);
    return eintraege;
  }

  warn('Kein Overpass-Spiegel erreichbar - es fehlen die Kartendaten.');
  return [];
}

// ------------------------------------------------------ Quelle 2: Nominatim

/**
 * Freitextsuche je Suchbegriff. Nominatim erlaubt hoechstens eine Anfrage pro
 * Sekunde, deshalb streng nacheinander mit Pause - das dauert ein paar Minuten,
 * findet dafuer Firmen, deren OSM-Tag nicht in unserer Liste steht.
 */
async function ausNominatim(stadt) {
  const eintraege = [];
  const begriffe = NAMENS_BAUSTEINE.filter((b) => !/^(Immobilien|Stiftung|Wohnanlage|Wohnheim)$/i.test(b));

  for (const [i, begriff] of begriffe.entries()) {
    const url = `${NOMINATIM}?${new URLSearchParams({
      q: `${begriff}, ${stadt}`,
      format: 'jsonv2',
      limit: '40',
      addressdetails: '1',
      extratags: '1',
      countrycodes: 'de',
    })}`;

    const antwort = await holen(url, { timeout: 30000 });
    await schlaf(1100);                                   // Nutzungsbedingung: max. 1 Anfrage/Sekunde
    if (!antwort || !antwort.ok) continue;

    let treffer;
    try {
      treffer = await antwort.json();
    } catch {
      continue;
    }

    for (const p of treffer) {
      const adresse = p.address || {};
      const inStadt = [adresse.city, adresse.town, adresse.municipality, adresse.county]
        .some((o) => o && o.toLowerCase().includes(stadt.toLowerCase()));
      if (!inStadt) continue;
      const name = p.name || adresse.office || adresse.amenity;
      if (!name) continue;

      const extra = p.extratags || {};
      eintraege.push({
        name: String(name).trim(),
        strasse: [adresse.road, adresse.house_number].filter(Boolean).join(' '),
        plz: adresse.postcode || '',
        ort: adresse.city || adresse.town || stadt,
        telefon: extra.phone || extra['contact:phone'] || '',
        email: extra.email || extra['contact:email'] || '',
        website: extra.website || extra['contact:website'] || '',
        osmTag: `${p.category || ''} ${p.type || ''}`.trim(),
        quelle: 'Nominatim',
        osmId: `${p.osm_type}/${p.osm_id}`,
      });
    }
    if ((i + 1) % 15 === 0) log(`  Nominatim: ${i + 1}/${begriffe.length} Suchbegriffe`);
  }

  log(`  Nominatim: ${eintraege.length} Rohtreffer`);
  return eintraege;
}

// ----------------------------------------------------- Quelle 3: Seed-Liste

function ausSeeds(stadt) {
  const eigeneDatei = path.join(AUSGABE_ORDNER, 'eigene-adressen.json');
  let eigene = [];
  if (fs.existsSync(eigeneDatei)) {
    try {
      eigene = JSON.parse(fs.readFileSync(eigeneDatei, 'utf8'));
      log(`  Eigene Liste: ${eigene.length} Eintraege aus eigene-adressen.json`);
    } catch (e) {
      warn(`eigene-adressen.json ist kaputt: ${e.message}`);
    }
  }

  // Die kuratierte Stadtliste gilt nur fuer Braunschweig selbst.
  const basis = IST_BRAUNSCHWEIG ? SEEDS : [];
  return [...basis, ...eigene].map((s) => ({
    name: s.name,
    strasse: s.strasse || '',
    plz: s.plz || '',
    ort: s.ort || stadt,
    telefon: s.telefon || '',
    email: s.email || '',
    website: s.website || '',
    osmTag: '',
    quelle: s.quelle || (eigene.includes(s) ? 'eigene Liste' : 'Stadt Braunschweig'),
    osmId: '',
  }));
}

// -------------------------------------------------------------- Dublettenlogik

/**
 * Fuehrt Eintraege zusammen. Gleiche Domain oder gleicher Namensschluessel =
 * dieselbe Firma. Beim Verschmelzen gewinnt der jeweils vollere Wert, damit
 * sich Kartendaten und Impressum gegenseitig ergaenzen.
 */
function zusammenfuehren(alle) {
  const nachSchluessel = new Map();
  const schluesselVon = new Map();     // Zweitschluessel -> Hauptschluessel

  const aufloesen = (s) => {
    let k = s;
    const gesehen = new Set();
    while (schluesselVon.has(k) && !gesehen.has(k)) {
      gesehen.add(k);
      k = schluesselVon.get(k);
    }
    return k;
  };

  for (const eintrag of alle) {
    const domain = domainVon(urlNormalisieren(eintrag.website));
    const nameKey = namensSchluessel(eintrag.name);
    if (!nameKey && !domain) continue;

    const kandidaten = [domain && `d:${domain}`, nameKey && `n:${nameKey}`]
      .filter(Boolean)
      .map(aufloesen)
      .filter((k) => nachSchluessel.has(k));

    let haupt = kandidaten[0];
    if (!haupt) {
      haupt = domain ? `d:${domain}` : `n:${nameKey}`;
      nachSchluessel.set(haupt, { ...eintrag, namensQuelle: eintrag.quelle, quellen: new Set([eintrag.quelle]) });
    } else {
      const vorhanden = nachSchluessel.get(haupt);
      for (const feld of ['strasse', 'plz', 'ort', 'telefon', 'email', 'website', 'osmTag', 'osmId']) {
        if (!vorhanden[feld] && eintrag[feld]) vorhanden[feld] = eintrag[feld];
      }
      // Namen der besseren Quelle bevorzugen. Bei gleicher Quelle gewinnt der
      // Name, der zur Zielgruppe passt - erst danach zaehlt die Laenge.
      const besser = quellenRang(eintrag.quelle) - quellenRang(vorhanden.namensQuelle);
      const neuPasst = einordnen(eintrag.name) ? 1 : 0;
      const altPasst = einordnen(vorhanden.name) ? 1 : 0;
      if (besser < 0
          || (besser === 0 && neuPasst > altPasst)
          || (besser === 0 && neuPasst === altPasst && eintrag.name.length > vorhanden.name.length)) {
        vorhanden.name = eintrag.name;
        vorhanden.namensQuelle = eintrag.quelle;
      }
      vorhanden.quellen.add(eintrag.quelle);
      // Weitere Kandidaten desselben Eintrags auf den Hauptschluessel umbiegen.
      for (const k of kandidaten.slice(1)) {
        const doppelt = nachSchluessel.get(k);
        if (!doppelt || k === haupt) continue;
        for (const feld of ['strasse', 'plz', 'ort', 'telefon', 'email', 'website', 'osmTag', 'osmId']) {
          if (!vorhanden[feld] && doppelt[feld]) vorhanden[feld] = doppelt[feld];
        }
        for (const q of doppelt.quellen) vorhanden.quellen.add(q);
        nachSchluessel.delete(k);
        schluesselVon.set(k, haupt);
      }
    }

    // Beide Schluessel zeigen kuenftig auf denselben Eintrag.
    for (const k of [domain && `d:${domain}`, nameKey && `n:${nameKey}`].filter(Boolean)) {
      if (k !== haupt && !nachSchluessel.has(k)) schluesselVon.set(k, haupt);
    }
  }

  return [...nachSchluessel.values()];
}

// ---------------------------------------------------------- Impressum-Schritt

/** Liest robots.txt und liefert eine Pruefung, ob ein Pfad abgerufen werden darf. */
async function robotsPruefung(basis) {
  const antwort = await holen(`${basis}/robots.txt`, { timeout: 10000 });
  if (!antwort || !antwort.ok) return () => true;         // keine robots.txt = alles erlaubt

  let text;
  try {
    text = (await antwort.text()).slice(0, 50000);
  } catch {
    return () => true;
  }

  const verboten = [];
  let gilt = false;
  for (const zeile of text.split('\n')) {
    const sauber = zeile.split('#')[0].trim();
    const [feldRoh, ...rest] = sauber.split(':');
    const feld = (feldRoh || '').trim().toLowerCase();
    const wert = rest.join(':').trim();
    if (feld === 'user-agent') gilt = wert === '*';
    else if (gilt && feld === 'disallow' && wert) verboten.push(wert);
    else if (gilt && feld === 'allow' && wert === '/') verboten.length = 0;
  }
  return (pfad) => !verboten.some((v) => pfad.toLowerCase().startsWith(v.toLowerCase()));
}

/** Zieht E-Mails aus HTML - auch die gaengigen Verschleierungen. */
function emailsAusHtml(html) {
  const gefunden = new Set();

  for (const t of html.matchAll(/mailto:([^"'?>\s]+)/gi)) {
    gefunden.add(decodeURIComponent(t[1]).trim().toLowerCase());
  }
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');

  for (const t of text.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    gefunden.add(t[0].trim().toLowerCase());
  }
  // "name (at) firma . de" und Varianten
  for (const t of text.matchAll(/([a-z0-9._%+-]+)\s*[\(\[\{]\s*(?:at|ät)\s*[\)\]\}]\s*([a-z0-9.-]+)\s*[\(\[\{]?\s*(?:punkt|dot)?\s*[\)\]\}]?\s*\.?\s*([a-z]{2,})/gi)) {
    gefunden.add(`${t[1]}@${t[2].replace(/\.$/, '')}.${t[3]}`.toLowerCase());
  }

  return [...gefunden].filter(emailBrauchbar);
}

/** Zieht Telefonnummern aus HTML, tel:-Links zuerst. */
function telefoneAusHtml(html) {
  const gefunden = [];

  for (const t of html.matchAll(/tel:([+0-9()\/\s.-]{6,25})/gi)) {
    const nr = telefonNormalisieren(t[1]);
    if (nr) gefunden.push(nr);
  }
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');

  // Nur Nummern, die als Telefon ausgewiesen sind - sonst fischt man Faxnummern
  // und Handelsregisternummern mit.
  for (const t of text.matchAll(/(?:tel(?:efon)?|fon|ruf|phone)\.?:?\s*([+0-9][+0-9()\/\s.-]{6,24})/gi)) {
    const nr = telefonNormalisieren(t[1]);
    if (nr) gefunden.push(nr);
  }
  return [...new Set(gefunden)];
}

/** Sucht im HTML nach einem Link, der zur Impressum- oder Kontaktseite fuehrt. */
function kontaktLinkFinden(html, basis) {
  for (const t of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const beschriftung = t[2].replace(/<[^>]+>/g, ' ').toLowerCase();
    const ziel = t[1];
    if (!/impressum|imprint|kontakt|contact/.test(`${beschriftung} ${ziel.toLowerCase()}`)) continue;
    try {
      const url = new URL(ziel, basis);
      if (url.origin !== new URL(basis).origin) continue;
      return url.href;
    } catch {
      /* kaputter Link - naechster */
    }
  }
  return '';
}

/**
 * Holt zu einem Eintrag Telefon und E-Mail von der Firmenseite.
 * Reihenfolge: Startseite (findet meist den Impressum-Link) -> Impressum ->
 * bekannte Standardpfade. Nach dem ersten brauchbaren Fund ist Schluss.
 */
async function impressumAuslesen(eintrag) {
  const basis = urlNormalisieren(eintrag.website);
  if (!basis) return eintrag;

  const darfAbrufen = await robotsPruefung(basis);
  const besucht = new Set();
  const emails = new Set();
  const telefone = [];
  let kontaktseite = '';

  const seiteLesen = async (url) => {
    if (besucht.has(url) || besucht.size > 5) return '';
    besucht.add(url);
    let pfad = '/';
    try {
      pfad = new URL(url).pathname;
    } catch {
      return '';
    }
    if (!darfAbrufen(pfad)) return '';

    const antwort = await holen(url);
    if (!antwort || !antwort.ok) return '';
    const typ = antwort.headers.get('content-type') || '';
    if (!typ.includes('html')) return '';

    let html;
    try {
      html = (await antwort.text()).slice(0, 800000);
    } catch {
      return '';
    }
    for (const m of emailsAusHtml(html)) emails.add(m);
    telefone.push(...telefoneAusHtml(html));
    return html;
  };

  const startseite = await seiteLesen(basis);

  // Der Link von der Startseite trifft haeufiger als geratene Pfade.
  const verlinkt = startseite ? kontaktLinkFinden(startseite, basis) : '';
  if (verlinkt) {
    await seiteLesen(verlinkt);
    kontaktseite = verlinkt;
  }

  for (const pfad of IMPRESSUM_PFADE) {
    if (emails.size && telefone.length) break;
    if (besucht.size > 5) break;
    const url = `${basis}${pfad}`;
    const html = await seiteLesen(url);
    if (html && !kontaktseite) kontaktseite = url;
  }

  const domain = domainVon(basis);
  const sortiert = [...emails].sort((a, b) => {
    // Adressen der eigenen Domain zuerst, dann nach Rolle.
    const eigenA = a.endsWith(`@${domain}`) || domain.endsWith(a.split('@')[1] || '~') ? 0 : 1;
    const eigenB = b.endsWith(`@${domain}`) || domain.endsWith(b.split('@')[1] || '~') ? 0 : 1;
    return eigenA - eigenB || emailRang(a) - emailRang(b) || a.length - b.length;
  });

  return {
    ...eintrag,
    email: eintrag.email || sortiert[0] || '',
    weitereEmails: sortiert.slice(1, 4).join(', '),
    telefon: eintrag.telefon || telefone[0] || '',
    kontaktseite,
  };
}

// -------------------------------------------------------------- Ausgabe

const SPALTEN = [
  'Name', 'Kategorie', 'Prio', 'E-Mail', 'Telefon', 'Straße', 'PLZ', 'Ort',
  'Website', 'Weitere E-Mails', 'Kontaktseite', 'Quelle', 'Angeschrieben am', 'Notiz',
];
const BREITEN = [42, 20, 6, 34, 20, 28, 8, 16, 34, 34, 34, 22, 16, 30];

const zeileVon = (e) => [
  e.name, e.kategorie, e.prio, e.email, e.telefon, e.strasse, e.plz, e.ort,
  e.website, e.weitereEmails || '', e.kontaktseite || '', e.quelle,
  e.angeschriebenAm || '', e.notiz || '',
];

/** CSV mit Semikolon und BOM - so oeffnet deutsches Excel die Datei per Doppelklick richtig. */
function csvBauen(eintraege) {
  const feld = (w) => {
    const s = String(w ?? '');
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const zeilen = [SPALTEN.join(';'), ...eintraege.map((e) => zeileVon(e).map(feld).join(';'))];
  return `﻿${zeilen.join('\r\n')}\r\n`;
}

/** Holt "Angeschrieben am" und "Notiz" aus dem letzten Lauf zurueck. */
function arbeitsstandUebernehmen(eintraege, jsonPfad) {
  if (!fs.existsSync(jsonPfad)) return 0;
  let alt;
  try {
    alt = JSON.parse(fs.readFileSync(jsonPfad, 'utf8'));
  } catch {
    return 0;
  }

  const nachSchluessel = new Map();
  for (const a of alt.eintraege || []) {
    if (!a.angeschriebenAm && !a.notiz) continue;
    const domain = domainVon(urlNormalisieren(a.website));
    if (domain) nachSchluessel.set(`d:${domain}`, a);
    const nk = namensSchluessel(a.name);
    if (nk) nachSchluessel.set(`n:${nk}`, a);
  }

  let uebernommen = 0;
  for (const e of eintraege) {
    const domain = domainVon(urlNormalisieren(e.website));
    const treffer = (domain && nachSchluessel.get(`d:${domain}`)) || nachSchluessel.get(`n:${namensSchluessel(e.name)}`);
    if (!treffer) continue;
    e.angeschriebenAm = treffer.angeschriebenAm || '';
    e.notiz = treffer.notiz || '';
    uebernommen++;
  }
  return uebernommen;
}

// ---------------------------------------------------------------- Hauptlauf

async function main() {
  const start = Date.now();
  log(`Hausverwaltungen & Co. in ${STADT} sammeln\n`);

  log('1/4  Kartendaten');
  const [overpass, seeds] = [await ausOverpass(STADT), ausSeeds(STADT)];

  log('\n2/4  Freitextsuche (dauert ein paar Minuten, 1 Anfrage/Sekunde)');
  const nominatim = await ausNominatim(STADT);

  log('\n3/4  Dubletten zusammenfuehren');
  let eintraege = zusammenfuehren([...seeds, ...overpass, ...nominatim]);

  const vorFilter = eintraege.length;
  const behalten = [];
  for (const e of eintraege) {
    e.quelle = [...e.quellen].join(' + ');
    delete e.quellen;
    delete e.namensQuelle;
    e.website = urlNormalisieren(e.website);
    e.telefon = telefonNormalisieren(e.telefon);
    if (!emailBrauchbar(e.email)) e.email = '';

    // Die Namenssuche in OSM zieht ueber operator-Tags auch Laeden und Kitas
    // herein. Wer in keine Zielgruppen-Schublade passt, gehoert nicht auf die
    // Anschreibliste - Ausnahme: die von Hand gepflegten Adressen.
    const treffer = einordnen(e.name, e.osmTag);
    const vonHand = /Stadt Braunschweig|eigene Liste/.test(e.quelle);
    if (!treffer && !vonHand) continue;

    e.kategorie = treffer ? treffer.kategorie : 'Sonstige';
    e.prio = treffer ? treffer.prio : 2;
    behalten.push(e);
  }
  eintraege = behalten;
  log(`  ${eintraege.length} Adressaten der Zielgruppe (${vorFilter - eintraege.length} nicht passende aussortiert)`);

  if (LIMIT) {
    eintraege = eintraege.slice(0, LIMIT);
    log(`  --limit ${LIMIT}: auf ${eintraege.length} gekuerzt`);
  }

  if (OHNE_IMPRESSUM) {
    log('\n4/4  Impressum-Schritt uebersprungen (--ohne-impressum)');
  } else {
    // Ueber den Index zuordnen, nicht ueber Name oder osmId: Seeds haben keine
    // osmId, und zwei Filialen derselben Firma tragen denselben Namen.
    const mitSeite = eintraege.map((e, i) => ({ e, i })).filter(({ e }) => e.website);
    log(`\n4/4  Impressum lesen bei ${mitSeite.length} Firmenseiten`);
    let fertig = 0;
    await parallelMap(mitSeite, PARALLEL, async ({ e, i }) => {
      eintraege[i] = await impressumAuslesen(e);
      if (++fertig % 20 === 0) log(`  ${fertig}/${mitSeite.length}`);
    });
  }

  // Erst die dicksten Fische: hohe Prio, danach die mit E-Mail.
  eintraege.sort((a, b) =>
    b.prio - a.prio ||
    (b.email ? 1 : 0) - (a.email ? 1 : 0) ||
    a.kategorie.localeCompare(b.kategorie, 'de') ||
    a.name.localeCompare(b.name, 'de'));

  fs.mkdirSync(AUSGABE_ORDNER, { recursive: true });
  const dateiName = `hausverwaltungen-${STADT.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const jsonPfad = path.join(AUSGABE_ORDNER, `${dateiName}.json`);

  const uebernommen = arbeitsstandUebernehmen(eintraege, jsonPfad);
  if (uebernommen) log(`\n  Arbeitsstand aus dem letzten Lauf uebernommen: ${uebernommen} Zeilen`);

  const csvPfad = path.join(AUSGABE_ORDNER, `${dateiName}.csv`);
  const xlsxPfad = path.join(AUSGABE_ORDNER, `${dateiName}.xlsx`);

  fs.writeFileSync(csvPfad, csvBauen(eintraege), 'utf8');
  fs.writeFileSync(xlsxPfad, xlsxBauen({
    spalten: SPALTEN,
    zeilen: eintraege.map(zeileVon),
    breiten: BREITEN,
    blattName: STADT.slice(0, 31),
  }));
  fs.writeFileSync(jsonPfad, JSON.stringify({
    stadt: STADT,
    stand: new Date().toISOString(),
    anzahl: eintraege.length,
    eintraege,
  }, null, 2), 'utf8');

  const mitMail = eintraege.filter((e) => e.email).length;
  const mitTel = eintraege.filter((e) => e.telefon).length;
  const dauer = Math.round((Date.now() - start) / 1000);

  log(`\nFertig in ${Math.floor(dauer / 60)}:${String(dauer % 60).padStart(2, '0')} min`);
  log(`  ${eintraege.length} Adressaten, davon ${mitMail} mit E-Mail und ${mitTel} mit Telefon`);
  for (const k of [...new Set(eintraege.map((e) => e.kategorie))]) {
    const teil = eintraege.filter((e) => e.kategorie === k);
    log(`    ${k.padEnd(22)} ${String(teil.length).padStart(3)}  (${teil.filter((e) => e.email).length} mit E-Mail)`);
  }
  log(`\n  ${path.relative(PROJECT, xlsxPfad)}`);
  log(`  ${path.relative(PROJECT, csvPfad)}`);
  log(`  ${path.relative(PROJECT, jsonPfad)}`);
}

main().catch((e) => {
  console.error('Abgebrochen:', e);
  process.exit(1);
});
