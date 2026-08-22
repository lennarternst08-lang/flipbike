import type {
  SellerProfile,
  ShowroomBundle,
  ShowroomInquiry,
  ShowroomListing,
  ShowroomSettings,
} from '../types';
import { DEFAULT_SELLER_PROFILE, DEFAULT_SETTINGS } from '../config/seller';
import { emptyListing } from './listing';

// ============================================================================
// Ablage des Showrooms
// ----------------------------------------------------------------------------
// Bewusst localStorage statt Firestore: die Firestore-Regeln dieses Projekts
// lassen sich nicht neu ausrollen (kein Firebase-CLI), eine neue Collection
// `showroomListings` würde also abgelehnt. Anzeigen zu einem Rad lassen sich
// zusätzlich über `bike.showroom` in die Cloud spiegeln – Zusatzfelder an
// Fahrrad-Dokumenten sind von `isValidBike` erlaubt (hasAll, nicht hasOnly).
// Siehe `syncListingToBike` weiter unten.
// ============================================================================

const KEYS = {
  listings: 'showroom_listings',
  inquiries: 'showroom_inquiries',
  profile: 'showroom_profile',
  settings: 'showroom_settings',
  favorites: 'showroom_favorites',
} as const;

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn(`[showroom] ${key} konnte nicht gelesen werden`, e);
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Häufigster Fall: Speicher voll, weil Fotos als data:-URL abgelegt werden.
    console.error(`[showroom] ${key} konnte nicht gespeichert werden`, e);
  }
}

// --- Anzeigen --------------------------------------------------------------

/** Ergänzt fehlende Felder, damit ältere Datenstände nicht abstürzen. */
export function normalizeListing(raw: Partial<ShowroomListing>): ShowroomListing {
  const base = emptyListing();
  return {
    ...base,
    ...raw,
    id: raw.id || base.id,
    slug: raw.slug || base.slug,
    specs: Array.isArray(raw.specs) ? raw.specs : [],
    extras: Array.isArray(raw.extras) ? raw.extras : [],
    defects: Array.isArray(raw.defects) ? raw.defects : [],
    photos: Array.isArray(raw.photos) ? raw.photos : [],
    photoIndices: Array.isArray(raw.photoIndices) ? raw.photoIndices : [],
    hotspots: Array.isArray(raw.hotspots) ? raw.hotspots : [],
    delivery: Array.isArray(raw.delivery) && raw.delivery.length ? raw.delivery : ['abholung'],
    views: typeof raw.views === 'number' ? raw.views : 0,
    likes: typeof raw.likes === 'number' ? raw.likes : 0,
    coverIndex: typeof raw.coverIndex === 'number' ? raw.coverIndex : 0,
  };
}

export function loadListings(): ShowroomListing[] {
  const raw = read<Partial<ShowroomListing>[]>(KEYS.listings, []);
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeListing);
}

export function saveListings(listings: ShowroomListing[]): void {
  write(KEYS.listings, listings);
}

// --- Anfragen --------------------------------------------------------------

export function loadInquiries(): ShowroomInquiry[] {
  const raw = read<ShowroomInquiry[]>(KEYS.inquiries, []);
  return Array.isArray(raw) ? raw : [];
}

export function saveInquiries(inquiries: ShowroomInquiry[]): void {
  write(KEYS.inquiries, inquiries);
}

// --- Profil & Einstellungen ------------------------------------------------

export function loadProfile(): SellerProfile {
  return { ...DEFAULT_SELLER_PROFILE, ...read<Partial<SellerProfile>>(KEYS.profile, {}) };
}

export function saveProfile(profile: SellerProfile): void {
  write(KEYS.profile, profile);
}

export function loadSettings(): ShowroomSettings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<ShowroomSettings>>(KEYS.settings, {}) };
}

export function saveSettings(settings: ShowroomSettings): void {
  write(KEYS.settings, settings);
}

// --- Merkliste des Käufers -------------------------------------------------

export function loadFavorites(): string[] {
  const raw = read<string[]>(KEYS.favorites, []);
  return Array.isArray(raw) ? raw : [];
}

export function saveFavorites(ids: string[]): void {
  write(KEYS.favorites, ids);
}

// --- Export / Import -------------------------------------------------------

export function buildBundle(
  profile: SellerProfile,
  listings: ShowroomListing[],
  settings: ShowroomSettings,
): ShowroomBundle {
  return {
    version: 1,
    exportedAt: Date.now(),
    profile,
    // Nur veröffentlichte Anzeigen wandern auf die Website – Entwürfe bleiben intern.
    listings: listings.filter((l) => l.status !== 'entwurf'),
    settings: {
      endpointUrl: settings.endpointUrl,
      publicBaseUrl: settings.publicBaseUrl,
      transport: settings.transport,
    },
  };
}

export function parseBundle(json: string): ShowroomBundle | null {
  try {
    const data = JSON.parse(json);
    if (!data || data.version !== 1 || !Array.isArray(data.listings)) return null;
    return {
      version: 1,
      exportedAt: data.exportedAt ?? Date.now(),
      profile: { ...DEFAULT_SELLER_PROFILE, ...(data.profile ?? {}) },
      listings: data.listings.map(normalizeListing),
      settings: { transport: 'lokal', ...(data.settings ?? {}) },
    };
  } catch {
    return null;
  }
}

/** Lädt eine Datei im Browser herunter (Website-Export, Anfragen-Backup …). */
export function downloadJson(fileName: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Cloud-Spiegel über das Fahrrad-Dokument -------------------------------

/**
 * Entfernt `undefined` aus einem Objektbaum. Firestore lehnt Dokumente mit
 * undefined-Werten ab, und eine Anzeige hat viele optionale Felder.
 */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefined(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Reduziert eine Anzeige auf das, was am Fahrrad-Dokument gespeichert wird.
 * Bilder bleiben ausdrücklich draußen: sie liegen bereits in `bike.photos` und
 * würden das Dokument sonst über das 1-MB-Limit von Firestore heben.
 */
export function listingForBikeDoc(listing: ShowroomListing): ShowroomListing {
  return stripUndefined({ ...listing, photos: [] });
}
