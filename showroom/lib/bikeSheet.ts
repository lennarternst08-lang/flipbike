import type {
  BikeCategory,
  DeliveryOption,
  Hotspot,
  HotspotTone,
  ListingCondition,
  PriceType,
  ShowroomListing,
} from '../types';
import { CATEGORY_LABELS, CONDITION_LABELS } from '../config/seller';
import { emptyListing, guessCategory, newId, uniqueSlug, type BikeLike } from './listing';

// ============================================================================
// Rad-Steckbrief: Anzeigen aus einer Datei einlesen
// ----------------------------------------------------------------------------
// Zweck: eine KI sieht sich die Fotos eines Rads an und schreibt einen
// Steckbrief. Diese Datei wird hier hochgeladen und wird zur fertigen Anzeige –
// statt zwanzig Felder von Hand zu tippen.
//
// Der Parser ist absichtlich sehr nachsichtig. Ein Sprachmodell trifft das
// Format nie zweimal exakt gleich: mal englische Schlüssel, mal "380 €" statt
// 380, mal "Mountainbike" statt "mountainbike", mal ein ```json-Block drumherum.
// Alles das wird hier aufgefangen. Was trotzdem nicht passt, wird nicht still
// verschluckt, sondern als Warnung gemeldet – der Verkäufer sieht vor dem
// Anlegen, was verstanden wurde und was nicht.
// ============================================================================

export const BIKE_SHEET_FORMAT = 'fahrrad-steckbrief';
export const BIKE_SHEET_VERSION = 1;

// --- Kleine Helfer ---------------------------------------------------------

type Raw = Record<string, unknown>;

/** Erster passender Wert aus mehreren möglichen Schlüsselnamen. */
function pick(obj: Raw, ...keys: string[]): unknown {
  for (const key of keys) {
    const hit = Object.keys(obj).find((k) => k.toLowerCase() === key.toLowerCase());
    if (hit !== undefined && obj[hit] !== null && obj[hit] !== '') return obj[hit];
  }
  return undefined;
}

function asText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/** Nimmt Listen entgegen, aber auch "Licht, Schloss und Ständer" als Fließtext. */
function asList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v.trim() : asText((v as Raw)?.text ?? v) ?? ''))
      .filter(Boolean);
  }
  const text = asText(value);
  if (!text) return [];
  return text
    .split(/[,;\n]| und /gi)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "1.250,50 €", "ca. 380", "380 EUR VB" – alles wird zur Zahl. */
function asPrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = asText(value);
  if (!text) return null;
  const cleaned = text
    .replace(/[^\d.,-]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function asRatio(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(n)) return null;
  // Manche Modelle antworten in Prozent (0–100) statt in Anteilen (0–1).
  const ratio = n > 1 && n <= 100 ? n / 100 : n;
  return Math.min(1, Math.max(0, ratio));
}

/** Vergleichsform für Namen und Begriffe: ohne Umlaute, ohne Sonderzeichen. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

// --- Zuordnung der Auswahlwerte -------------------------------------------

const CATEGORY_SYNONYMS: Record<string, BikeCategory> = {
  herrenrad: 'city',
  damenrad: 'city',
  stadtrad: 'city',
  hollandfahrrad: 'hollandrad',
  mtb: 'mountainbike',
  hardtail: 'mountainbike',
  fully: 'mountainbike',
  crossrad: 'trekking',
  fitnessbike: 'trekking',
  roadbike: 'rennrad',
  faltrad: 'klapprad',
  pedelec: 'ebike',
  ebike: 'ebike',
  elektrofahrrad: 'ebike',
  cargobike: 'lastenrad',
};

function toCategory(value: unknown, fallbackText: string): BikeCategory {
  const text = asText(value);
  if (text) {
    const key = normalize(text);
    if (key in CATEGORY_LABELS) return key as BikeCategory;
    if (CATEGORY_SYNONYMS[key]) return CATEGORY_SYNONYMS[key];
    const byLabel = (Object.keys(CATEGORY_LABELS) as BikeCategory[]).find(
      (k) => normalize(CATEGORY_LABELS[k]) === key,
    );
    if (byLabel) return byLabel;
  }
  return guessCategory(`${text ?? ''} ${fallbackText}`);
}

const CONDITION_SYNONYMS: Record<string, ListingCondition> = {
  neu: 'neuwertig',
  wieneu: 'neuwertig',
  topzustand: 'neuwertig',
  sehrgut: 'sehr_gut',
  guterzustand: 'gut',
  inordnung: 'gebraucht',
  ok: 'gebraucht',
  starkgebraucht: 'gebraucht',
  defekt: 'bastler',
  bastler: 'bastler',
  bastlerrad: 'bastler',
  ersatzteiltraeger: 'bastler',
};

function toCondition(value: unknown): { value: ListingCondition; warning?: string } {
  const text = asText(value);
  if (!text) return { value: 'gut' };
  const key = normalize(text);
  if (key in CONDITION_LABELS) return { value: key as ListingCondition };
  if (CONDITION_SYNONYMS[key]) return { value: CONDITION_SYNONYMS[key] };
  const byLabel = (Object.keys(CONDITION_LABELS) as ListingCondition[]).find(
    (k) => normalize(CONDITION_LABELS[k]) === key,
  );
  if (byLabel) return { value: byLabel };
  return { value: 'gut', warning: `Zustand "${text}" nicht erkannt – auf "Gut" gesetzt.` };
}

function toPriceType(value: unknown, priceText?: string): PriceType {
  const key = normalize(asText(value) ?? '');
  if (key === 'fest' || key === 'festpreis' || key === 'fix') return 'fest';
  if (key === 'verschenken' || key === 'zuverschenken' || key === 'geschenk') return 'verschenken';
  if (key === 'vb' || key === 'verhandlungsbasis' || key === 'verhandelbar') return 'vb';
  // Ohne eigenes Feld verrät oft der Preistext selbst, was gemeint ist.
  if (priceText && /\bvb\b|verhandel/i.test(priceText)) return 'vb';
  if (priceText && /festpreis|fixpreis/i.test(priceText)) return 'fest';
  return 'vb';
}

function toTone(value: unknown): HotspotTone {
  const key = normalize(asText(value) ?? '');
  if (['defect', 'mangel', 'defekt', 'schaden', 'problem', 'rost', 'kratzer'].includes(key)) {
    return 'defect';
  }
  if (['highlight', 'hervorheben', 'plus', 'vorteil', 'wichtig'].includes(key)) return 'highlight';
  return 'neutral';
}

function toDelivery(value: unknown): DeliveryOption[] {
  const list = asList(value)
    .map((v) => normalize(v))
    .map((v): DeliveryOption | null => {
      if (v.startsWith('abhol')) return 'abholung';
      if (v.startsWith('liefer')) return 'lieferung';
      if (v.startsWith('versand') || v.startsWith('verschick')) return 'versand';
      return null;
    })
    .filter((v): v is DeliveryOption => v !== null);
  return list.length > 0 ? [...new Set(list)] : ['abholung'];
}

// --- JSON aus einer Antwort herausschälen ---------------------------------

/**
 * Holt das JSON aus dem, was tatsächlich in der Zwischenablage landet: mit
 * ```json-Zaun, mit "Hier ist die Datei:" davor, mit Erklärung dahinter.
 */
export function extractJson(input: string): string | null {
  const text = (input ?? '').trim();
  if (!text) return null;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1].trim() : text;

  const firstObj = body.indexOf('{');
  const firstArr = body.indexOf('[');
  const start =
    firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (start === -1) return null;

  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (end <= start) return null;

  return body.slice(start, end + 1);
}

// --- Ergebnis --------------------------------------------------------------

export interface SheetEntryResult {
  listing: ShowroomListing;
  /** Name des Werkstatt-Rads, mit dem die Fotos verknüpft wurden. */
  matchedBikeName?: string;
  photoCount: number;
  hotspotCount: number;
  /** Alles, was auffiel, aber den Import nicht verhindert. */
  warnings: string[];
}

export interface SheetParseResult {
  ok: boolean;
  /** Gesetzt, wenn die Datei gar nicht gelesen werden konnte. */
  error?: string;
  entries: SheetEntryResult[];
}

export interface SheetParseOptions {
  /** Räder der Werkstatt – für die Zuordnung der Fotos. */
  bikes: BikeLike[];
  /** Bereits vergebene Kurznamen, damit keiner doppelt entsteht. */
  takenSlugs: string[];
}

/** Findet das gemeinte Werkstatt-Rad: erst über die ID, dann über den Namen. */
function matchBike(hint: string | undefined, bikes: BikeLike[]): BikeLike | undefined {
  if (!hint) return undefined;
  const byId = bikes.find((b) => b.id === hint);
  if (byId) return byId;
  const key = normalize(hint);
  if (!key) return undefined;
  const exact = bikes.find((b) => normalize(b.name) === key);
  if (exact) return exact;
  // Letzter Versuch: der Name steckt im Hinweis (oder umgekehrt).
  return bikes.find((b) => {
    const name = normalize(b.name);
    return name.length > 3 && (key.includes(name) || name.includes(key));
  });
}

function parseHotspots(value: unknown, photoCount: number, warnings: string[]): Hotspot[] {
  if (!Array.isArray(value)) return [];
  const hotspots: Hotspot[] = [];
  let ohneKoordinate = 0;

  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const h = raw as Raw;
    const label = asText(pick(h, 'titel', 'label', 'name', 'bauteil', 'teil'));
    if (!label) continue;

    const x = asRatio(pick(h, 'x', 'links', 'left'));
    const y = asRatio(pick(h, 'y', 'oben', 'top'));
    if (x === null || y === null) {
      ohneKoordinate += 1;
      continue;
    }

    const photoIndex = Math.max(
      0,
      Math.round(Number(pick(h, 'foto', 'photoIndex', 'bild', 'photo') ?? 0)) || 0,
    );

    hotspots.push({
      id: newId(),
      photoIndex,
      x,
      y,
      label,
      value: asText(pick(h, 'text', 'wert', 'value', 'beschreibung', 'detail')),
      tone: toTone(pick(h, 'art', 'tone', 'typ', 'kind')),
    });
  }

  if (ohneKoordinate > 0) {
    warnings.push(
      `${ohneKoordinate} Bildpunkt(e) ohne x/y-Angabe übersprungen – die musst du selbst setzen.`,
    );
  }
  const zuHoch = hotspots.filter((h) => photoCount > 0 && h.photoIndex >= photoCount).length;
  if (zuHoch > 0) {
    warnings.push(
      `${zuHoch} Bildpunkt(e) zeigen auf ein Foto, das es (noch) nicht gibt – sie tauchen erst auf, wenn du die Bilder ergänzt.`,
    );
  }
  return hotspots;
}

/** Liest einen Steckbrief und macht daraus fertige Anzeigen (noch Entwürfe). */
export function parseBikeSheet(input: string, options: SheetParseOptions): SheetParseResult {
  const json = extractJson(input);
  if (!json) {
    return { ok: false, error: 'In der Datei steckt kein JSON.', entries: [] };
  }

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return {
      ok: false,
      error: `Die Datei ist kein gültiges JSON (${e instanceof Error ? e.message : e}).`,
      entries: [],
    };
  }

  // Erlaubt sind: die volle Hülle, ein nacktes Array, ein einzelnes Rad.
  let rows: unknown[];
  if (Array.isArray(data)) {
    rows = data;
  } else if (data && typeof data === 'object') {
    const container = pick(data as Raw, 'raeder', 'räder', 'bikes', 'listings', 'anzeigen', 'items');
    rows = Array.isArray(container) ? container : [data];
  } else {
    return { ok: false, error: 'Die Datei enthält keine Rad-Daten.', entries: [] };
  }

  if (rows.length === 0) {
    return { ok: false, error: 'In der Datei steht kein einziges Rad.', entries: [] };
  }

  const taken = [...options.takenSlugs];
  const entries: SheetEntryResult[] = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Raw;
    const warnings: string[] = [];

    const brand = asText(pick(r, 'marke', 'brand', 'hersteller'));
    const model = asText(pick(r, 'modell', 'model'));
    const rawTitle = asText(pick(r, 'titel', 'title', 'name', 'bezeichnung'));
    const title = rawTitle || [brand, model].filter(Boolean).join(' ') || 'Rad aus Steckbrief';
    if (!rawTitle) warnings.push('Kein Titel angegeben – aus Marke und Modell zusammengesetzt.');

    const bikeHint = asText(
      pick(r, 'werkstattRad', 'werkstattrad', 'bikeId', 'bikeid', 'rad', 'werkstatt'),
    );
    const bike = matchBike(bikeHint, options.bikes);
    if (bikeHint && !bike) {
      warnings.push(`Kein Rad namens "${bikeHint}" in der Werkstatt gefunden – ohne Fotos angelegt.`);
    }
    const photoCount = bike?.photos?.length ?? 0;
    if (bike && photoCount === 0) {
      warnings.push(`"${bike.name}" hat noch keine Fotos hinterlegt.`);
    }

    const condition = toCondition(pick(r, 'zustand', 'condition'));
    if (condition.warning) warnings.push(condition.warning);

    const priceRaw = pick(r, 'preis', 'price', 'vk', 'verkaufspreis');
    const price = asPrice(priceRaw);
    if (priceRaw !== undefined && price === null) {
      warnings.push(`Preis "${asText(priceRaw)}" nicht verstanden – bitte selbst eintragen.`);
    }

    const description = asText(pick(r, 'beschreibung', 'description', 'text', 'anzeigentext'));
    if (!description) warnings.push('Keine Beschreibung im Steckbrief.');

    const specsRaw = pick(r, 'eigenschaften', 'specs', 'weitere', 'attribute');
    const specs = Array.isArray(specsRaw)
      ? specsRaw
          .map((s) => {
            const o = (s ?? {}) as Raw;
            const label = asText(pick(o, 'label', 'name', 'titel', 'schluessel', 'key'));
            const val = asText(pick(o, 'wert', 'value', 'text'));
            return label && val ? { id: newId(), label, value: val } : null;
          })
          .filter((s): s is { id: string; label: string; value: string } => s !== null)
      : [];

    const hotspots = parseHotspots(
      pick(r, 'bildpunkte', 'hotspots', 'punkte', 'markierungen'),
      photoCount,
      warnings,
    );

    const zip = asText(pick(r, 'plz', 'zip', 'postleitzahl'));
    const city = asText(pick(r, 'ort', 'stadt', 'city'));

    const listing: ShowroomListing = {
      ...emptyListing(),
      bikeId: bike?.id,
      slug: uniqueSlug(title, taken),
      title,
      subtitle: asText(pick(r, 'untertitel', 'subtitle', 'kurzbeschreibung')),
      description: description ?? '',
      price,
      priceType: toPriceType(pick(r, 'preistyp', 'priceType', 'preisart'), asText(priceRaw)),
      category: toCategory(pick(r, 'kategorie', 'category', 'art', 'radtyp'), `${title} ${brand ?? ''}`),
      condition: condition.value,
      status: 'entwurf',
      brand,
      model,
      year: asText(pick(r, 'baujahr', 'jahr', 'year')),
      color: asText(pick(r, 'farbe', 'color', 'farben')),
      frameSize: asText(pick(r, 'rahmenhoehe', 'rahmenhöhe', 'frameSize', 'rahmengroesse', 'groesse')),
      wheelSize: asText(pick(r, 'laufradgroesse', 'laufradgröße', 'wheelSize', 'zoll', 'reifengroesse')),
      frameType: asText(pick(r, 'rahmenform', 'frameType', 'rahmentyp')),
      gearSystem: asText(pick(r, 'schaltung', 'gearSystem', 'schaltwerk', 'gangschaltung')),
      gearCount: asText(pick(r, 'gaenge', 'gänge', 'gearCount', 'anzahlGaenge', 'gangzahl')),
      brakes: asText(pick(r, 'bremsen', 'brakes', 'bremsanlage')),
      material: asText(pick(r, 'material', 'rahmenmaterial')),
      weightKg: asText(pick(r, 'gewichtKg', 'gewicht', 'weight')),
      specs,
      extras: asList(pick(r, 'zubehoer', 'zubehör', 'extras', 'ausstattung')),
      defects: asList(pick(r, 'maengel', 'mängel', 'defects', 'schaeden', 'probleme')),
      photoIndices: Array.from({ length: photoCount }, (_, i) => i),
      hotspots,
      delivery: toDelivery(pick(r, 'uebergabe', 'übergabe', 'delivery', 'versandart')),
      location: zip || city ? { zip: zip ?? '', city: city ?? '' } : undefined,
    };

    taken.push(listing.slug);
    entries.push({
      listing,
      matchedBikeName: bike?.name,
      photoCount,
      hotspotCount: hotspots.length,
      warnings,
    });
  }

  if (entries.length === 0) {
    return { ok: false, error: 'Es ließ sich kein einziges Rad auslesen.', entries: [] };
  }
  return { ok: true, entries };
}

// --- Die Anleitung für die KI ---------------------------------------------

/**
 * Der Text, den der Verkäufer kopiert und zusammen mit den Fotos in eine KI
 * einfügt. Die Auswahlwerte werden aus den Beschriftungen erzeugt, damit die
 * Anleitung nicht veraltet, sobald eine Kategorie dazukommt.
 */
export function bikeSheetPrompt(workshopBikeNames: string[] = []): string {
  const categories = Object.keys(CATEGORY_LABELS).join(' | ');
  const conditions = Object.keys(CONDITION_LABELS).join(' | ');
  const bikeList =
    workshopBikeNames.length > 0
      ? `\nDiese Räder liegen gerade in meiner Werkstatt. Trag bei "werkstattRad" den Namen ein, der zu den Fotos passt – nur exakt so geschrieben, wie er hier steht:\n${workshopBikeNames
          .map((n) => `- ${n}`)
          .join('\n')}\n`
      : '\nWenn ich dir keinen Namen aus meiner Werkstatt genannt habe, lass "werkstattRad" weg.\n';

  return `Du hilfst mir, ein gebrauchtes Fahrrad zum Verkauf zu beschreiben.

Ich hänge dir Fotos des Rads an. Sieh sie dir genau an und gib mir GENAU EINE JSON-Datei zurück – kein Fließtext davor oder danach, keine Erklärung, nur das JSON.
${bikeList}
Format:

{
  "format": "${BIKE_SHEET_FORMAT}",
  "version": ${BIKE_SHEET_VERSION},
  "raeder": [
    {
      "werkstattRad": "Name aus der Liste oben (optional)",
      "titel": "Kurzer Anzeigentitel, so wie man auf Kleinanzeigen sucht",
      "untertitel": "Ein Halbsatz als Ergänzung (optional)",
      "kategorie": "${categories}",
      "zustand": "${conditions}",
      "marke": "", "modell": "", "baujahr": "", "farbe": "",
      "rahmenhoehe": "z. B. 52 cm", "laufradgroesse": "z. B. 28 Zoll",
      "rahmenform": "Diamant | Trapez | Tiefeinstieg",
      "schaltung": "z. B. Shimano Deore", "gaenge": "z. B. 21",
      "bremsen": "z. B. V-Brake", "material": "z. B. Aluminium", "gewichtKg": "",
      "preis": 250,
      "preistyp": "vb | fest | verschenken",
      "beschreibung": "Fließtext für die Anzeige, 4 bis 8 Sätze.",
      "zubehoer": ["Licht", "Gepäckträger"],
      "maengel": ["Kratzer am Oberrohr", "Reifen hinten abgefahren"],
      "eigenschaften": [{ "label": "Rahmennummer", "wert": "" }],
      "bildpunkte": [
        { "foto": 0, "x": 0.62, "y": 0.55, "titel": "Schaltung", "text": "Shimano Deore, 21 Gänge", "art": "highlight" }
      ]
    }
  ]
}

Regeln:

1. "bildpunkte" sind Markierungen IM Foto. "foto" ist die Nummer des Bildes, beginnend bei 0 in der Reihenfolge, in der ich sie dir gegeben habe. "x" und "y" sind Anteile der Bildbreite bzw. -höhe zwischen 0 und 1, gemessen von der linken oberen Ecke: x=0.5 ist die Mitte, y=0.9 ist ganz unten. Setz die Punkte so genau, wie du das Bauteil im Bild wirklich erkennst.
2. Setz Punkte für die Teile, die beim Gebrauchtkauf zählen: Schaltung, Bremsen, Reifen, Kette, Sattel, Beleuchtung, Federgabel, Laufräder – und für jeden sichtbaren Mangel (Rost, Kratzer, Delle) mit "art": "defect". Lieber 4 gute Punkte als 12 geratene.
3. Erfinde nichts. Wenn du Marke, Modell oder Baujahr nicht sicher erkennst, lass das Feld leer statt zu raten. Bei "beschreibung" nur schreiben, was auf den Fotos zu sehen ist.
4. Sei bei "maengel" ehrlich und vollständig. Offen genannte Mängel schützen mich rechtlich, verschwiegene kosten mich Geld.
5. "preis" nur setzen, wenn ich dir einen genannt habe oder du ihn aus vergleichbaren Angeboten belastbar schätzen kannst. Sonst weglassen.
6. Alle Felder außer "titel" sind optional. Lieber ein Feld weglassen als es falsch füllen.
7. Mehrere Räder: einfach mehrere Einträge in "raeder".

Speicher das Ergebnis als .json-Datei, ich lade sie direkt in meinen Showroom hoch.`;
}

/** Beispieldatei zum Herunterladen – zeigt das Format an einem echten Fall. */
export function bikeSheetExample(): unknown {
  return {
    format: BIKE_SHEET_FORMAT,
    version: BIKE_SHEET_VERSION,
    raeder: [
      {
        werkstattRad: 'Hier den Namen aus deiner Werkstatt eintragen',
        titel: 'Trekkingrad 28 Zoll, 21 Gänge Shimano',
        untertitel: 'Rahmenhöhe 55 cm, frisch durchgesehen',
        kategorie: 'trekking',
        zustand: 'gut',
        marke: '',
        modell: '',
        baujahr: '',
        farbe: 'dunkelblau',
        rahmenhoehe: '55 cm',
        laufradgroesse: '28 Zoll',
        rahmenform: 'Diamant',
        schaltung: 'Shimano Acera',
        gaenge: '21',
        bremsen: 'V-Brake',
        material: 'Aluminium',
        gewichtKg: '',
        preis: 180,
        preistyp: 'vb',
        beschreibung:
          'Solides Trekkingrad, komplett durchgesehen: Bremsen neu eingestellt, Kette gereinigt und geölt, Reifen mit gutem Profil. Licht funktioniert vorn und hinten. Fährt sich ruhig und ist sofort einsatzbereit.',
        zubehoer: ['Licht (StVZO)', 'Gepäckträger', 'Schutzbleche', 'Ständer'],
        maengel: ['Kratzer am Oberrohr', 'Sattel mit leichten Gebrauchsspuren'],
        eigenschaften: [{ label: 'Rahmennummer', wert: '' }],
        bildpunkte: [
          {
            foto: 0,
            x: 0.63,
            y: 0.62,
            titel: 'Schaltung',
            text: 'Shimano Acera, 21 Gänge, sauber geschaltet',
            art: 'highlight',
          },
          {
            foto: 0,
            x: 0.28,
            y: 0.45,
            titel: 'Kratzer',
            text: 'Oberflächlich, kein Rost darunter',
            art: 'defect',
          },
        ],
      },
    ],
  };
}
