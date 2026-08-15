// Auftrag für den Flyer-Austräger.
//
// Der komplette Auftrag steckt im Link (Hash), nicht auf einem Server. Damit
// sieht der Austräger ausschließlich dieses eine Gebiet – Fahrräder, Finanzen
// und Firestore sind für ihn technisch nicht erreichbar. Zusätzlich funktioniert
// der Link ohne Login und ohne Freigabe-Regeln.

export interface JobStreet {
  n: string;   // Straßenname
  h: string[]; // auszutragende Hausnummern
  x: string[]; // ausgenommen ("keine Werbung")
}

export interface FlyerJob {
  v: number;                  // Formatversion
  n: string;                  // Gebietsname
  d?: string | null;          // Datum (ISO)
  f?: number;                 // geplante Flyer
  t?: number;                 // Häuser auszutragen
  note?: string;              // Notiz für den Austräger
  p: [number, number][];      // Gebietspolygon
  x: [number, number][];      // "keine Werbung"-Häuser
  s: JobStreet[];             // Straßenliste
}

export const JOB_HASH_PREFIX = '#auftrag=';

// 5 Nachkommastellen ≈ 1 m Genauigkeit – reicht völlig und hält den Link kurz
const r5 = (v: number) => Math.round(v * 1e5) / 1e5;

export function encodeJob(job: FlyerJob): string {
  const compact: FlyerJob = {
    ...job,
    p: job.p.map(([a, b]) => [r5(a), r5(b)] as [number, number]),
    x: job.x.map(([a, b]) => [r5(a), r5(b)] as [number, number]),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(compact));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  // base64url, damit der Link ohne Escaping durch Messenger geht
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeJob(raw: string): FlyerJob | null {
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const job = JSON.parse(new TextDecoder().decode(bytes));
    if (!job || !Array.isArray(job.p) || job.p.length < 3) return null;
    if (!Array.isArray(job.x)) job.x = [];
    if (!Array.isArray(job.s)) job.s = [];
    return job as FlyerJob;
  } catch {
    return null;
  }
}

export function buildJobUrl(job: FlyerJob): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${JOB_HASH_PREFIX}${encodeJob(job)}`;
}

export function readJobFromLocation(): FlyerJob | null {
  const h = window.location.hash || '';
  if (!h.startsWith(JOB_HASH_PREFIX)) return null;
  return decodeJob(h.slice(JOB_HASH_PREFIX.length));
}

// Stabile Kennung eines Auftrags – für den Fortschritt auf dem Gerät des Austrägers
export function jobKey(job: FlyerJob): string {
  const base = `${job.n}|${job.d || ''}|${job.p.length}|${job.p[0]?.join(',')}`;
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) | 0;
  return 'flyerJob_' + (h >>> 0).toString(36);
}

// --- Geometrie (von Haupt-App und Austräger-Seite gemeinsam genutzt) ---
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const la1 = toRad(a[0]);
  const la2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function pointInPolygon(pt: [number, number], poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    const intersect = (xi > pt[1]) !== (xj > pt[1]) &&
      pt[0] < ((yj - yi) * (pt[1] - xi)) / (xj - xi) + yi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Kürzester Abstand zum Gebietsrand (für "noch X m bis zum Gebiet")
export function distanceToPolygonM(pt: [number, number], poly: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    // Segment in lokale Meter projizieren und Punkt darauf clampen
    const mPerLat = 111320;
    const mPerLng = 111320 * Math.cos(toRad(pt[0]));
    const ax = (a[1] - pt[1]) * mPerLng, ay = (a[0] - pt[0]) * mPerLat;
    const bx = (b[1] - pt[1]) * mPerLng, by = (b[0] - pt[0]) * mPerLat;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    best = Math.min(best, Math.sqrt(cx * cx + cy * cy));
  }
  return best;
}
