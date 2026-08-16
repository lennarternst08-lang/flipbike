import { FlyerLead, FlyerLeadSource } from '../types';

// Leads teilen sich die Firestore-Collection `flyerHouses` mit den
// "keine Werbung"-Häusern. Grund: `isValidFlyerHouse` in firestore.rules prüft nur
// hasRequiredFields(['id','lat','lng','userId']) – Zusatzfelder sind also erlaubt,
// und eine eigene Collection bräuchte ein Rules-Deployment (kein Firebase-CLI vorhanden).
// `kind` trennt beide Sorten. Alte Häuser haben kein `kind` → gelten als 'excluded'.
export const LEAD_KIND = 'lead';

export const DEFAULT_PLZ = '38124';
export const DEFAULT_CITY = 'Braunschweig';

export const isLeadDoc = (d: any): boolean => d?.kind === LEAD_KIND;
export const isExcludedDoc = (d: any): boolean => !d?.kind || d.kind === 'excluded';

// Firestore-Form. lat/lng müssen flach und numerisch bleiben, sonst greift isValidFlyerHouse nicht.
// bikeIds ist ein flaches String-Array – nur *verschachtelte* Arrays verbietet Firestore.
export const serializeLead = (l: FlyerLead, uid: string) => ({
  id: l.id,
  userId: uid,
  lat: l.point[0],
  lng: l.point[1],
  kind: LEAD_KIND,
  address: l.address || '',
  name: l.name || '',
  note: l.note || '',
  source: l.source || 'manual',
  bikeIds: l.bikeIds ?? [],
  createdAt: l.createdAt ?? Date.now(),
});

export const deserializeLead = (d: any): FlyerLead => ({
  id: d.id,
  point: [d.lat, d.lng] as [number, number],
  address: d.address || '',
  name: d.name || '',
  note: d.note || '',
  source: (d.source || 'manual') as FlyerLeadSource,
  bikeIds: Array.isArray(d.bikeIds) ? d.bikeIds : [],
  createdAt: d.createdAt,
  userId: d.userId,
});

// Normalisiert eine Adresse für den Dubletten-Vergleich.
// "Bertha-von-Suttner-Str. 3" und "Bertha von Suttner Straße 3" ergeben denselben Schlüssel.
export const addressKey = (s: string): string =>
  (s || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/strasse|str\.|str\b/g, 'str')
    .replace(/[^a-z0-9]/g, '');

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
}

// Nominatim erlaubt ~1 Anfrage/Sekunde. Alle Aufrufe laufen deshalb durch eine
// gemeinsame Warteschlange – sonst liefert ein Sammelimport nur noch 429er.
const MIN_GAP_MS = 1100;
let queueTail: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function nominatim(params: Record<string, string>): Promise<GeocodeResult | null> {
  const qs = new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'de', ...params });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${qs.toString()}`, {
    headers: { 'Accept-Language': 'de' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    displayName: data[0].display_name || '',
  };
}

// Erst strukturiert (genauer), dann als Freitext – viele Anfragen kommen ohne
// Hausnummer rein ("Gleiwitzstraße, Melverode"), da hilft der Freitext-Versuch.
async function geocodeNow(street: string, plz: string = DEFAULT_PLZ): Promise<GeocodeResult | null> {
  const s = (street || '').trim();
  if (!s) return null;
  const structured = await nominatim({ street: s, postalcode: plz || DEFAULT_PLZ, city: DEFAULT_CITY });
  if (structured) return structured;
  await sleep(MIN_GAP_MS);
  return nominatim({ q: `${s}, ${plz || DEFAULT_PLZ} ${DEFAULT_CITY}` });
}

// Serialisiert alle Geocoding-Aufrufe der App mit Mindestabstand.
export function throttledGeocode(street: string, plz?: string): Promise<GeocodeResult | null> {
  const run = queueTail.then(async () => {
    const result = await geocodeNow(street, plz);
    await sleep(MIN_GAP_MS);
    return result;
  });
  // Fehler dürfen die Warteschlange nicht abreißen lassen.
  queueTail = run.catch(() => undefined);
  return run;
}

// Findet einen vorhandenen Lead zur Adresse: gleicher Adress-Schlüssel oder < 25 m entfernt.
export function findExistingLead(
  leads: FlyerLead[],
  address: string,
  point?: [number, number] | null,
  distanceM?: (a: [number, number], b: [number, number]) => number
): FlyerLead | undefined {
  const key = addressKey(address);
  const byAddress = key ? leads.find((l) => addressKey(l.address) === key) : undefined;
  if (byAddress) return byAddress;
  if (point && distanceM) return leads.find((l) => distanceM(l.point, point) < 25);
  return undefined;
}
