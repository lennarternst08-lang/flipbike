import type {
  BikeCategory,
  DeliveryOption,
  ListingCondition,
  ListingStatus,
  PriceType,
  SellerProfile,
  ShowroomSettings,
} from '../types';

// ============================================================================
// Verkäufer-Stammdaten & Beschriftungen
// ----------------------------------------------------------------------------
// WICHTIG: Hier stehen absichtlich nur Platzhalter bzw. ohnehin öffentliche
// Angaben. Der Build dieses Repos landet auf öffentlichen GitHub Pages – echte
// Anschrift und Telefonnummer gehören deshalb nicht in den Quellcode, sondern
// werden in der App unter "Profil & Impressum" eingetragen. Sie liegen dann im
// Browser (localStorage) und wandern nur über den bewussten Website-Export mit.
// ============================================================================

export const DEFAULT_SELLER_PROFILE: SellerProfile = {
  displayName: 'Fahrrad Butz',
  tagline: 'Gebrauchte Fahrräder, ehrlich hergerichtet.',
  about:
    'Ich kaufe gebrauchte Fahrräder an, bringe sie in der eigenen Werkstatt wieder ' +
    'in Schuss und verkaufe sie weiter. Jedes Rad wird durchgesehen, gereinigt und ' +
    'mit allen bekannten Mängeln offen beschrieben. Was du auf den Bildern siehst, ' +
    'ist genau das Rad, das du bekommst.',

  legalName: '',
  street: '',
  zip: '38124',
  city: 'Braunschweig',
  country: 'Deutschland',
  email: '',
  phone: '',
  whatsapp: '',
  vatId: '',
  kleinunternehmer: true,
  responsiblePerson: '',
  isCommercial: true,

  openingHours: 'Besichtigung nach Absprache',
  pickupNote: 'Abholung in Braunschweig. Probefahrt ist selbstverständlich möglich.',
  website: '',
  instagram: '',

  accent: '#c8934a',
};

export const DEFAULT_SETTINGS: ShowroomSettings = {
  transport: 'lokal',
  endpointUrl: '',
  endpointKey: '',
  publicBaseUrl: '',
  defaultPerspective: 'verkaeufer',
};

/**
 * Pflichtfelder für ein rechtssicheres Impressum (§ 5 DDG).
 * `profileGaps` meldet, was noch fehlt – die App zeigt das als Warnung an,
 * damit die Seite nicht ohne Impressum online geht.
 */
export const REQUIRED_IMPRINT_FIELDS: (keyof SellerProfile)[] = [
  'legalName',
  'street',
  'zip',
  'city',
  'email',
];

export const IMPRINT_FIELD_LABELS: Record<string, string> = {
  legalName: 'Vor- und Nachname (bzw. Firma)',
  street: 'Straße und Hausnummer',
  zip: 'Postleitzahl',
  city: 'Ort',
  email: 'E-Mail-Adresse',
  phone: 'Telefonnummer',
};

export function profileGaps(profile: SellerProfile): string[] {
  return REQUIRED_IMPRINT_FIELDS.filter((f) => !String(profile[f] ?? '').trim()).map(
    (f) => IMPRINT_FIELD_LABELS[f] ?? String(f),
  );
}

// --- Beschriftungen für Auswahlfelder -------------------------------------

export const CATEGORY_LABELS: Record<BikeCategory, string> = {
  city: 'Citybike',
  trekking: 'Trekkingrad',
  mountainbike: 'Mountainbike',
  rennrad: 'Rennrad',
  gravel: 'Gravelbike',
  hollandrad: 'Hollandrad',
  kinderrad: 'Kinderrad',
  jugendrad: 'Jugendrad',
  klapprad: 'Klapp-/Faltrad',
  bmx: 'BMX',
  ebike: 'E-Bike / Pedelec',
  lastenrad: 'Lastenrad',
  sonstiges: 'Sonstiges',
};

export const CONDITION_LABELS: Record<ListingCondition, string> = {
  neuwertig: 'Neuwertig',
  sehr_gut: 'Sehr gut',
  gut: 'Gut',
  gebraucht: 'Gebraucht',
  bastler: 'Bastlerrad',
};

/** Kurze, ehrliche Erläuterung – erscheint als Hilfetext beim Zustand. */
export const CONDITION_HINTS: Record<ListingCondition, string> = {
  neuwertig: 'Kaum gefahren, keine sichtbaren Gebrauchsspuren.',
  sehr_gut: 'Gepflegt, nur minimale Gebrauchsspuren, technisch einwandfrei.',
  gut: 'Normale Gebrauchsspuren, technisch komplett überholt.',
  gebraucht: 'Deutliche Gebrauchsspuren, fährt aber zuverlässig.',
  bastler: 'Defekt oder unvollständig – ausdrücklich als Bastlerrad verkauft.',
};

export const STATUS_LABELS: Record<ListingStatus, string> = {
  entwurf: 'Entwurf',
  online: 'Online',
  reserviert: 'Reserviert',
  verkauft: 'Verkauft',
};

export const PRICE_TYPE_LABELS: Record<PriceType, string> = {
  fest: 'Festpreis',
  vb: 'VB (Verhandlungsbasis)',
  verschenken: 'Zu verschenken',
};

export const DELIVERY_LABELS: Record<DeliveryOption, string> = {
  abholung: 'Abholung',
  lieferung: 'Lieferung im Umkreis',
  versand: 'Versand',
};

/** Vorschläge für Zubehör-Schlagworte im Anzeigen-Editor. */
export const EXTRA_SUGGESTIONS: string[] = [
  'Licht (StVZO)',
  'Schutzbleche',
  'Gepäckträger',
  'Ständer',
  'Klingel',
  'Schloss',
  'Korb',
  'Kindersitz',
  'Luftpumpe',
  'Neue Reifen',
  'Neue Kette',
  'Neue Bremsbeläge',
  'Federgabel',
  'Nabendynamo',
];

/**
 * Vorschläge für Bild-Beschriftungen. Genau diese Punkte sind es, die Käufer
 * bei einem gebrauchten Rad wirklich interessieren.
 */
export const HOTSPOT_PRESETS: { label: string; tone: 'neutral' | 'highlight' | 'defect' }[] = [
  { label: 'Schaltung', tone: 'highlight' },
  { label: 'Bremsen', tone: 'highlight' },
  { label: 'Rahmen', tone: 'neutral' },
  { label: 'Laufräder', tone: 'neutral' },
  { label: 'Reifen', tone: 'neutral' },
  { label: 'Sattel', tone: 'neutral' },
  { label: 'Lenker / Griffe', tone: 'neutral' },
  { label: 'Beleuchtung', tone: 'neutral' },
  { label: 'Kette', tone: 'neutral' },
  { label: 'Tretlager / Kurbel', tone: 'neutral' },
  { label: 'Federgabel', tone: 'neutral' },
  { label: 'Gepäckträger', tone: 'neutral' },
  { label: 'Kratzer', tone: 'defect' },
  { label: 'Rost', tone: 'defect' },
  { label: 'Delle', tone: 'defect' },
];
