import type {
  BikeCategory,
  Hotspot,
  ListingCondition,
  PriceType,
  ShowroomListing,
} from '../types';

// ============================================================================
// Anzeigen: erzeugen, aus einem Rad ableiten, formatieren.
// ----------------------------------------------------------------------------
// Bewusst ohne Import aus `src/` – ein Rad wird nur strukturell beschrieben
// (`BikeLike`). So bleibt der Ordner kopierbar, obwohl er in der Haupt-App
// direkt mit deren `Bike`-Objekten arbeitet.
// ============================================================================

/**
 * Der Ausschnitt eines Fahrrads aus der Haupt-App, den der Showroom braucht.
 * `Bike` aus `src/types.ts` erfüllt diese Form, ohne dass sie ihn kennen muss.
 */
export interface BikeLike {
  id: string;
  name: string;
  status: string;
  purchasePrice: number;
  sellingPrice?: number | null;
  targetSellingPrice?: number | null;
  photos?: string[];
  notes?: string;
  /**
   * Am Fahrrad gespiegelte Anzeige. Wird als `unknown` geführt, damit dieser
   * Ordner die Cloud-Struktur nicht kennen muss – der Showroom normalisiert
   * den Wert beim Einlesen selbst.
   */
  showroom?: unknown;
  details?: {
    marke?: string;
    modell?: string;
    rahmennummer?: string;
    laufradgroesse?: string;
    rahmenhoehe?: string;
    farbe?: string;
    gangschaltung?: string;
    anzahlGaenge?: string;
    baujahr?: string;
    zubehoer?: string;
    maengel?: { id: string; text: string }[];
  };
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 11);
}

/** Macht aus einem Titel einen URL-tauglichen Kurznamen. */
export function slugify(input: string): string {
  return (input || 'anzeige')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'anzeige';
}

/** Sorgt dafür, dass kein Slug doppelt vergeben wird. */
export function uniqueSlug(base: string, taken: string[]): string {
  const slug = slugify(base);
  if (!taken.includes(slug)) return slug;
  let n = 2;
  while (taken.includes(`${slug}-${n}`)) n += 1;
  return `${slug}-${n}`;
}

export function emptyListing(): ShowroomListing {
  const now = Date.now();
  return {
    id: newId(),
    slug: '',
    title: '',
    description: '',
    price: null,
    priceType: 'vb',
    category: 'city',
    condition: 'gut',
    status: 'entwurf',
    specs: [],
    extras: [],
    defects: [],
    photos: [],
    photoIndices: [],
    coverIndex: 0,
    hotspots: [],
    delivery: ['abholung'],
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    soldAt: null,
    views: 0,
    likes: 0,
  };
}

/** Rät die Kategorie aus dem Namen des Rads – spart Tipparbeit im Editor. */
export function guessCategory(text: string): BikeCategory {
  const t = (text || '').toLowerCase();
  const rules: [RegExp, BikeCategory][] = [
    [/e-?bike|pedelec|bosch|yamaha|impulse/, 'ebike'],
    [/lastenrad|cargo|long ?john/, 'lastenrad'],
    [/mtb|mountain|hardtail|fully/, 'mountainbike'],
    [/renn|road ?bike|rennrad/, 'rennrad'],
    [/gravel|cyclocross|crosser/, 'gravel'],
    [/trekking|tourenrad/, 'trekking'],
    [/holland|omafiets/, 'hollandrad'],
    [/klapp|falt|brompton|tern/, 'klapprad'],
    [/bmx/, 'bmx'],
    [/kinder|\b(12|14|16|18|20)\s?zoll/, 'kinderrad'],
    [/jugend|\b24\s?zoll/, 'jugendrad'],
  ];
  for (const [re, cat] of rules) if (re.test(t)) return cat;
  return 'city';
}

/**
 * Legt aus einem Rad der Werkstatt eine Anzeige an: Fotos werden referenziert
 * (nicht kopiert), Stammdaten und bekannte Mängel wandern direkt mit.
 */
export function listingFromBike(bike: BikeLike, takenSlugs: string[] = []): ShowroomListing {
  const d = bike.details ?? {};
  const base = emptyListing();
  const title = [d.marke, d.modell].filter(Boolean).join(' ').trim() || bike.name;
  const photoCount = (bike.photos ?? []).length;

  return {
    ...base,
    bikeId: bike.id,
    slug: uniqueSlug(title, takenSlugs),
    title,
    subtitle: d.rahmenhoehe ? `Rahmenhöhe ${d.rahmenhoehe}` : undefined,
    description: (bike.notes ?? '').trim(),
    price: bike.sellingPrice ?? bike.targetSellingPrice ?? null,
    category: guessCategory(`${bike.name} ${d.marke ?? ''} ${d.modell ?? ''}`),
    brand: d.marke,
    model: d.modell,
    year: d.baujahr,
    color: d.farbe,
    frameSize: d.rahmenhoehe,
    wheelSize: d.laufradgroesse,
    gearSystem: d.gangschaltung,
    gearCount: d.anzahlGaenge,
    extras: splitExtras(d.zubehoer),
    defects: (d.maengel ?? []).map((m) => m.text).filter(Boolean),
    photoIndices: Array.from({ length: photoCount }, (_, i) => i),
    status: bike.status === 'Verkauft' ? 'verkauft' : 'entwurf',
    soldAt: bike.status === 'Verkauft' ? Date.now() : null,
  };
}

/** "Licht, Schloss und Gepäckträger" -> ["Licht", "Schloss", "Gepäckträger"] */
export function splitExtras(text?: string): string[] {
  if (!text) return [];
  return text
    .split(/[,;\n]| und /gi)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

/**
 * Löst die Bilder einer Anzeige auf: erst die referenzierten Fotos des Rads,
 * danach die eigenen Bilder der Anzeige.
 */
export function listingPhotos(listing: ShowroomListing, bike?: BikeLike | null): string[] {
  const fromBike = (listing.photoIndices ?? [])
    .map((i) => (bike?.photos ?? [])[i])
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
  return [...fromBike, ...(listing.photos ?? [])];
}

/** Das Titelbild – fällt auf das erste vorhandene Bild zurück. */
export function coverPhoto(listing: ShowroomListing, bike?: BikeLike | null): string | null {
  const photos = listingPhotos(listing, bike);
  if (photos.length === 0) return null;
  return photos[listing.coverIndex] ?? photos[0];
}

export function hotspotsForPhoto(listing: ShowroomListing, photoIndex: number): Hotspot[] {
  return (listing.hotspots ?? []).filter((h) => h.photoIndex === photoIndex);
}

// --- Formatierung ----------------------------------------------------------

export function formatPrice(
  price: number | null | undefined,
  priceType: PriceType = 'vb',
): string {
  if (priceType === 'verschenken') return 'Zu verschenken';
  if (price === null || price === undefined) return 'Preis auf Anfrage';
  const value = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: price % 1 === 0 ? 0 : 2,
  }).format(price);
  return priceType === 'vb' ? `${value} VB` : value;
}

export function formatDate(ts?: number | null): string {
  if (!ts) return '–';
  return new Date(ts).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** "vor 3 Tagen" – wie bei Kleinanzeigen unter dem Anzeigentitel. */
export function relativeDate(ts?: number | null): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'gestern';
  if (d < 30) return `vor ${d} Tagen`;
  const m = Math.floor(d / 30);
  return m < 12 ? `vor ${m} Mon.` : formatDate(ts);
}

/** Anzeigen, die ein Käufer sehen darf. */
export function isPublic(listing: ShowroomListing): boolean {
  return listing.status === 'online' || listing.status === 'reserviert';
}

export interface ListingFilter {
  search?: string;
  category?: BikeCategory | 'alle';
  condition?: ListingCondition | 'alle';
  maxPrice?: number | null;
  minPrice?: number | null;
  onlyAvailable?: boolean;
  sort?: 'neueste' | 'preis_auf' | 'preis_ab' | 'beliebt';
}

export function filterListings(
  listings: ShowroomListing[],
  filter: ListingFilter,
): ShowroomListing[] {
  const q = (filter.search ?? '').trim().toLowerCase();
  const result = listings.filter((l) => {
    if (filter.onlyAvailable && l.status !== 'online') return false;
    if (filter.category && filter.category !== 'alle' && l.category !== filter.category) return false;
    if (filter.condition && filter.condition !== 'alle' && l.condition !== filter.condition) return false;
    if (filter.minPrice != null && (l.price ?? 0) < filter.minPrice) return false;
    if (filter.maxPrice != null && (l.price ?? 0) > filter.maxPrice) return false;
    if (q) {
      const haystack = [
        l.title,
        l.subtitle,
        l.description,
        l.brand,
        l.model,
        l.frameSize,
        l.wheelSize,
        ...(l.extras ?? []),
        ...(l.specs ?? []).map((s) => `${s.label} ${s.value}`),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const sorted = [...result];
  switch (filter.sort) {
    case 'preis_auf':
      sorted.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
      break;
    case 'preis_ab':
      sorted.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
      break;
    case 'beliebt':
      sorted.sort((a, b) => b.likes - a.likes || b.views - a.views);
      break;
    default:
      sorted.sort(
        (a, b) => (b.publishedAt ?? b.updatedAt) - (a.publishedAt ?? a.updatedAt),
      );
  }
  // Hervorgehobene Anzeigen stehen immer oben.
  sorted.sort((a, b) => Number(!!b.featured) - Number(!!a.featured));
  return sorted;
}
