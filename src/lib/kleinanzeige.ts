import { BikeDetails, KleinanzeigeInfo, KleinanzeigeZustand } from '../types';

// ============================================================================
// Kleinanzeigen-Generator
// ----------------------------------------------------------------------------
// Setzt den Inseratstext immer nach derselben Formel zusammen:
//
//   {Einleitung}
//   Vorab (fest)
//   Datenblock: Marke, Modell, Laufradgröße, Rahmenhöhe, Schaltung, Bremsen,
//               Beleuchtung, Ausstattung – jede Zeile nur, wenn ausgefüllt
//   Zustand {…} + kosmetische Mängel (aus den Kaufvertrag-Mängeln)
//   Probefahrt & Standort, Besichtigungszeiten, Terminhinweis (fest)
//   Gewährleistungsausschluss & § 19 UStG (fest)
//
// Die festen Bausteine stehen nur hier – Umzug oder neue Zeiten also an einer
// Stelle ändern.
// ============================================================================

export const VORAB =
  'Vorab: Dies ist ein gewerblicher Verkauf. Ein Eigentumsnachweis liegt vor. ' +
  'Das Fahrrad wird mit einem schriftlichen Kaufvertrag sowie einem Jahr Gewährleistung verkauft.';

export const PROBEFAHRT_STANDORT =
  'Probesitzen und Probefahren sind ausdrücklich erwünscht! ' +
  'Das Rad befindet sich in Braunschweig in der Nähe der Paulikirche im östlichen Ringgebiet.';

export const BESICHTIGUNGSZEITEN = [
  'Besichtigungen:',
  'Montag: ab 18:30',
  'Dienstag: ab 16:00',
  'Mittwoch: ab 16:00',
  'Donnerstag: ab 16:00',
  'Freitag: ab 16:00',
].join('\n');

export const TERMINHINWEIS = 'Nur mit vorheriger Terminvereinbarung!';

export const SCHLUSS =
  'Jegliche genannte Mängel sowie Verschleißteile sind von der Gewährleistung ausgeschlossen. ' +
  'Gemäß § 19 UStG (Kleinunternehmer) wird keine Umsatzsteuer ausgewiesen.';

/** Kleinanzeigen schneidet Titel nach 65 Zeichen ab. */
export const TITEL_MAX = 65;

export const ZUSTAND_LABELS: Record<KleinanzeigeZustand, string> = {
  neuwertig: 'Neuwertig',
  sehr_gut: 'Sehr gut',
  gut: 'Gut',
  gebraucht: 'Gebraucht',
};

// "in einem … Zustand"
const ZUSTAND_DATIV: Record<KleinanzeigeZustand, string> = {
  neuwertig: 'neuwertigen',
  sehr_gut: 'sehr guten',
  gut: 'guten',
  gebraucht: 'gebrauchten',
};

// Vorschlagslisten für die Eingabefelder – frei überschreibbar.
export const VORSCHLAEGE = {
  adjektiv: ['Klassisches', 'Sportliches', 'Robustes', 'Leichtes', 'Elegantes', 'Praktisches', 'Gepflegtes'],
  radtyp: ['Damenrad', 'Herrenrad', 'Unisex-Rad', 'Tiefeinsteiger', 'Jugendrad', 'Kinderrad', 'Trekkingrad', 'Citybike', 'Mountainbike', 'Rennrad'],
  stil: ['Hollandstil', 'Retro-Stil', 'Vintage-Stil', 'City-Stil'],
  schaltungsart: ['Nabenschaltung', 'Kettenschaltung', 'Singlespeed'],
  schaltBedienung: ['Drehgriff', 'Trigger-Schalthebeln', 'Daumenschalthebeln', 'Rahmenschalthebeln'],
  bremse: ['V-Bremse', 'Felgenbremse', 'Seitenzugbremse', 'hydraulische Felgenbremse', 'Scheibenbremse', 'hydraulische Scheibenbremse', 'Rollenbremse', 'Trommelbremse', 'Rücktrittbremse'],
  lichtquelle: ['Nabendynamo', 'Seitenläuferdynamo', 'Akku-Beleuchtung', 'Batterie-Beleuchtung'],
  scheinwerfer: ['LED', 'Halogen'],
  ausstattung: ['Weidenkorb', 'Korb', 'Gepäckträger', 'Vollkettenschutz', 'Kettenschutz', 'Schutzbleche', 'Komfortsattel', 'Klingel', 'Ständer', 'Rahmenschloss', 'Federgabel', 'gefederte Sattelstütze', 'Lenkerkorb', 'Kindersitz-Halterung'],
};

export function emptyKleinanzeige(): KleinanzeigeInfo {
  return {
    einleitung: '',
    adjektiv: '',
    radtyp: '',
    stil: '',
    highlights: '',
    schaltungsart: '',
    schaltBedienung: '',
    bremseVorne: '',
    bremseHinten: '',
    lichtHersteller: '',
    lichtquelle: '',
    scheinwerfer: '',
    koerperVon: '',
    koerperBis: '',
    ausstattung: [],
    zustand: 'sehr_gut',
  };
}

/** Füllt Lücken mit Standardwerten – nie `undefined`, das lehnt Firestore ab. */
export function sanitizeKleinanzeige(k?: Partial<KleinanzeigeInfo> | null): KleinanzeigeInfo {
  const base = emptyKleinanzeige();
  if (!k) return base;
  const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const out = { ...base };
  (Object.keys(base) as (keyof KleinanzeigeInfo)[]).forEach((key) => {
    if (key === 'ausstattung' || key === 'zustand') return;
    (out as any)[key] = s(k[key]);
  });
  out.ausstattung = Array.isArray(k.ausstattung)
    ? k.ausstattung.map(s).map((a) => a.trim()).filter(Boolean)
    : [];
  out.zustand = k.zustand && k.zustand in ZUSTAND_DATIV ? k.zustand : 'sehr_gut';
  return out;
}

// --- Hilfen -----------------------------------------------------------------

const t = (v?: string) => (v || '').trim();

/** "28", "28\"", "28 Zoll" → "28"; alles andere bleibt, wie es ist. */
function ohneEinheit(v: string, einheit: RegExp): string {
  return v.replace(einheit, '').trim();
}

const istZahl = (v: string) => /^\d+([.,]\d+)?$/.test(v);

/** Laufradgröße mit "Zoll", sofern eine reine Zahl eingetragen ist. */
export function laufradText(v?: string): string {
  const roh = t(v);
  const zahl = ohneEinheit(roh, /(zoll|"|''|”|″)$/i);
  return istZahl(zahl) ? `${zahl} Zoll` : roh;
}

/** Rahmenhöhe mit "cm", sofern eine reine Zahl eingetragen ist. */
export function rahmenText(v?: string): string {
  const roh = t(v);
  const zahl = ohneEinheit(roh, /cm$/i);
  return istZahl(zahl) ? `${zahl} cm` : roh;
}

/** Rahmenhöhe in cm als Zahl, sonst null ("M", "54 cm / M" …). */
export function rahmenCm(v?: string): number | null {
  const zahl = ohneEinheit(t(v), /cm$/i);
  return istZahl(zahl) ? parseFloat(zahl.replace(',', '.')) : null;
}

// Grobe Faustregel für City-/Trekkingräder: bis zu dieser Rahmenhöhe (cm)
// passt diese Körpergröße (cm).
const KOERPER_TABELLE: [number, number, number][] = [
  [40, 140, 155],
  [44, 148, 163],
  [47, 155, 170],
  [50, 160, 178],
  [53, 170, 183],
  [56, 176, 190],
  [59, 183, 196],
  [62, 190, 205],
];

/** Vorschlag für die passende Körpergröße, z.B. 50 cm → 160–178 cm. */
export function koerpergroesseVorschlag(rahmenhoehe?: string): { von: string; bis: string } | null {
  const cm = rahmenCm(rahmenhoehe);
  if (cm == null || cm < 30) return null;
  const zeile = KOERPER_TABELLE.find(([max]) => cm <= max);
  return zeile ? { von: String(zeile[1]), bis: String(zeile[2]) } : null;
}

/** "a, b, c" → "a, b und c" */
function aufzaehlung(teile: string[]): string {
  if (teile.length <= 1) return teile.join('');
  return `${teile.slice(0, -1).join(', ')} und ${teile[teile.length - 1]}`;
}

const grossAnfang = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);

/** "V-Bremse" → "V-Bremsen" für "… vorne und hinten". */
function bremsenPlural(v: string): string {
  return /bremse$/i.test(v) ? `${v}n` : v;
}

// --- Bausteine --------------------------------------------------------------

/** "{Adjektiv} {Radtyp} im {Stil}: {Farbe}, mit {Highlight 1} und {Highlight 2}." */
export function einleitungVorschlag(d: BikeDetails, k: KleinanzeigeInfo): string {
  const stil = t(k.stil);
  const kopf = [
    t(k.adjektiv),
    t(k.radtyp),
    stil ? (/^im\s/i.test(stil) ? stil : `im ${stil}`) : '',
  ].filter(Boolean).join(' ');
  const highlights = t(k.highlights).split(',').map((h) => h.trim()).filter(Boolean);
  const rest = [t(d.farbe), highlights.length ? `mit ${aufzaehlung(highlights)}` : '']
    .filter(Boolean)
    .join(', ');
  if (!kopf && !rest) return '';
  return grossAnfang(kopf && rest ? `${kopf}: ${rest}.` : `${kopf || rest}.`);
}

function schaltungZeile(d: BikeDetails, k: KleinanzeigeInfo): string {
  const gaenge = t(d.anzahlGaenge);
  const bedienung = t(k.schaltBedienung);
  return [
    t(d.gangschaltung),
    gaenge ? (/gang/i.test(gaenge) ? gaenge : `${gaenge}-Gang`) : '',
    t(k.schaltungsart),
    bedienung ? `mit ${bedienung}` : '',
  ].filter(Boolean).join(' ');
}

function bremsenZeile(k: KleinanzeigeInfo): string {
  const vorne = t(k.bremseVorne);
  const hinten = t(k.bremseHinten);
  if (vorne && (!hinten || hinten.toLowerCase() === vorne.toLowerCase())) {
    return `${bremsenPlural(vorne)} vorne und hinten`;
  }
  if (vorne && hinten) return `${vorne} vorne, ${hinten} hinten`;
  if (hinten) return `${hinten} hinten`;
  return '';
}

function beleuchtungZeile(k: KleinanzeigeInfo): string {
  const quelle = [t(k.lichtHersteller), t(k.lichtquelle)].filter(Boolean).join(' ');
  const scheinwerfer = t(k.scheinwerfer);
  const lampen = scheinwerfer ? `${scheinwerfer}-Scheinwerfer und Rücklicht` : '';
  if (quelle && lampen) return `${quelle} mit ${lampen}`;
  return quelle || lampen;
}

function rahmenZeile(d: BikeDetails, k: KleinanzeigeInfo): string {
  const rh = rahmenText(d.rahmenhoehe);
  if (!rh) return '';
  const vorschlag = koerpergroesseVorschlag(d.rahmenhoehe);
  const von = t(k.koerperVon) || vorschlag?.von || '';
  const bis = t(k.koerperBis) || vorschlag?.bis || '';
  return von && bis ? `${rh} (passend für ca. ${von}–${bis} cm Körpergröße)` : rh;
}

function maengelText(d: BikeDetails): string {
  return (d.maengel || [])
    .map((m) => t(m.text).replace(/[.;,]+$/, ''))
    .filter(Boolean)
    .join(', ');
}

// --- Ergebnis ---------------------------------------------------------------

/** "{Marke} {Modell} {Radtyp} {Laufrad} Zoll RH {Rahmenhöhe} {Gänge}-Gang" */
export function kleinanzeigeTitel(d: BikeDetails, k: KleinanzeigeInfo): string {
  const rh = rahmenText(d.rahmenhoehe);
  const gaenge = t(d.anzahlGaenge);
  return [
    t(d.marke),
    t(d.modell),
    t(k.radtyp),
    laufradText(d.laufradgroesse),
    rh ? `RH ${rh}` : '',
    gaenge ? (/gang/i.test(gaenge) ? gaenge : `${gaenge}-Gang`) : '',
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ');
}

export function kleinanzeigeText(d: BikeDetails, k: KleinanzeigeInfo): string {
  const zeile = (label: string, wert: string) => (wert ? `${label}: ${wert}` : '');
  const daten = [
    zeile('Marke', t(d.marke)),
    zeile('Modell', t(d.modell)),
    zeile('Laufradgröße', laufradText(d.laufradgroesse)),
    zeile('Rahmenhöhe', rahmenZeile(d, k)),
    zeile('Schaltung', schaltungZeile(d, k)),
    zeile('Bremsen', bremsenZeile(k)),
    zeile('Beleuchtung', beleuchtungZeile(k)),
    zeile('Ausstattung', k.ausstattung.map(t).filter(Boolean).join(', ')),
  ].filter(Boolean).join('\n');

  const maengel = maengelText(d);
  const zustand = [
    `Zustand: Das Rad befindet sich in einem ${ZUSTAND_DATIV[k.zustand]} Zustand. Technisch voll funktionsfähig und fahrbereit.`,
    maengel ? `Kosmetische Mängel: ${maengel}. Alle Mängel sind auf den Fotos zu sehen.` : '',
  ].filter(Boolean).join('\n');

  return [
    t(k.einleitung) || einleitungVorschlag(d, k),
    VORAB,
    daten,
    zustand,
    PROBEFAHRT_STANDORT,
    BESICHTIGUNGSZEITEN,
    TERMINHINWEIS,
    SCHLUSS,
  ].filter(Boolean).join('\n\n');
}
