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

// Trennzeichen bewusst "/" statt "=": WhatsApp & Co. beenden die automatische
// Verlinkung an einem "=", der Link war dann auf dem Handy nicht anklickbar.
export const JOB_HASH_PREFIX = '#auftrag/';
const LEGACY_PREFIX = '#auftrag=';

// --- base64url ---
function toB64url(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// --- gzip (verkürzt den Link deutlich; ohne Browser-Unterstützung wird roh gespeichert) ---
async function gzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const CS = (globalThis as any).CompressionStream;
    if (!CS) return null;
    const stream = new Blob([bytes as any]).stream().pipeThrough(new CS('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return null; }
}
async function gunzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const DS = (globalThis as any).DecompressionStream;
    if (!DS) return null;
    const stream = new Blob([bytes as any]).stream().pipeThrough(new DS('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return null; }
}

// --- Kompaktformat v2 ---
// Koordinaten als ganzzahlige Differenzen (1e-5 Grad ≈ 1 m): statt
// "52.26955,10.52356" pro Punkt nur noch wenige Zeichen. Zusätzlich ein
// Array statt eines Objekts, damit keine Schlüsselnamen mitreisen.
const E5 = 1e5;
function packCoords(pts: [number, number][]): number[] {
  const out: number[] = [];
  let pLat = 0, pLng = 0;
  pts.forEach(([lat, lng], i) => {
    const a = Math.round(lat * E5), b = Math.round(lng * E5);
    out.push(i === 0 ? a : a - pLat, i === 0 ? b : b - pLng);
    pLat = a; pLng = b;
  });
  return out;
}
function unpackCoords(flat: number[]): [number, number][] {
  const pts: [number, number][] = [];
  let lat = 0, lng = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    lat = i === 0 ? flat[i] : lat + flat[i];
    lng = i === 0 ? flat[i + 1] : lng + flat[i + 1];
    pts.push([lat / E5, lng / E5]);
  }
  return pts;
}

export async function encodeJob(job: FlyerJob): Promise<string> {
  const wire = [
    2,
    job.n || '',
    job.d || '',
    job.f || 0,
    job.t || 0,
    job.note || '',
    packCoords(job.p),
    packCoords(job.x),
    job.s.map((s) => [s.n, s.h.join(','), s.x.join(',')]),
  ];
  const raw = new TextEncoder().encode(JSON.stringify(wire));
  const zipped = await gzip(raw);
  // Präfix kennzeichnet die Kodierung: z = gepackt, j = roh
  return zipped ? 'z' + toB64url(zipped) : 'j' + toB64url(raw);
}

export async function decodeJob(payload: string): Promise<FlyerJob | null> {
  try {
    const kind = payload[0];
    // Alte Links (reines JSON ohne Kennung) weiterhin unterstützen
    if (kind !== 'z' && kind !== 'j') return decodeLegacy(payload);

    let bytes = fromB64url(payload.slice(1));
    if (kind === 'z') {
      const un = await gunzip(bytes);
      if (!un) return null;
      bytes = un;
    }
    const w = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(w) || w[0] !== 2) return null;
    const job: FlyerJob = {
      v: 2,
      n: w[1] || '',
      d: w[2] || null,
      f: w[3] || 0,
      t: w[4] || 0,
      note: w[5] || undefined,
      p: unpackCoords(w[6] || []),
      x: unpackCoords(w[7] || []),
      s: (w[8] || []).map((s: any[]) => ({
        n: s[0] || '',
        h: s[1] ? String(s[1]).split(',') : [],
        x: s[2] ? String(s[2]).split(',') : [],
      })),
    };
    return job.p.length >= 3 ? job : null;
  } catch {
    return null;
  }
}

// Links aus der ersten Fassung (base64 von rohem JSON-Objekt)
function decodeLegacy(payload: string): FlyerJob | null {
  try {
    const job = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    if (!job || !Array.isArray(job.p) || job.p.length < 3) return null;
    if (!Array.isArray(job.x)) job.x = [];
    if (!Array.isArray(job.s)) job.s = [];
    return job as FlyerJob;
  } catch {
    return null;
  }
}

export async function buildJobUrl(job: FlyerJob): Promise<string> {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${JOB_HASH_PREFIX}${await encodeJob(job)}`;
}

export async function readJobFromLocation(): Promise<FlyerJob | null> {
  const h = window.location.hash || '';
  if (h.startsWith(JOB_HASH_PREFIX)) return decodeJob(h.slice(JOB_HASH_PREFIX.length));
  if (h.startsWith(LEGACY_PREFIX)) return decodeJob(h.slice(LEGACY_PREFIX.length));
  return null;
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
