// Kartenbild für den Austräger-Auftrag deterministisch selbst rendern.
//
// Vorher wurde die Live-Karte per html2canvas abfotografiert. Leaflet
// positioniert seine Ebenen aber über CSS-Transforms, die html2canvas falsch
// auflöst – das Gebiet landete verschoben oder halb außerhalb des Bildes.
// Hier werden Kacheln und Gebiet direkt auf ein Canvas gezeichnet: der
// Ausschnitt ist damit berechnet statt abfotografiert und das Gebiet liegt
// garantiert vollständig und mittig im Bild.

const TILE = 256;
const SUBDOMAINS = ['a', 'b', 'c'];
const TILE_URL = (s: string, z: number, x: number, y: number) =>
  `https://${s}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}@2x.png`;

const lngToPx = (lng: number, z: number) => ((lng + 180) / 360) * Math.pow(2, z) * TILE;
const latToPx = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z) * TILE;
};

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // fehlende Kachel überspringen statt abbrechen
    img.src = url;
  });
}

export interface AreaMapOptions {
  width?: number;    // logische Breite
  height?: number;   // logische Höhe
  padding?: number;  // Mindestabstand des Gebiets zum Bildrand
  scale?: number;    // Pixeldichte (2 = scharf)
}

export async function renderAreaMapImage(
  points: [number, number][],
  excluded: [number, number][] = [],
  opts: AreaMapOptions = {},
): Promise<string | null> {
  if (!points || points.length < 3) return null;
  const W = opts.width ?? 900;
  const H = opts.height ?? 620;
  const PAD = opts.padding ?? 56;
  const S = opts.scale ?? 2;

  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

  // Größte Zoomstufe wählen, bei der das Gebiet noch komplett hineinpasst
  let z = 19;
  for (; z >= 10; z--) {
    const spanX = Math.abs(lngToPx(maxLng, z) - lngToPx(minLng, z));
    const spanY = Math.abs(latToPx(minLat, z) - latToPx(maxLat, z));
    if (spanX <= W - 2 * PAD && spanY <= H - 2 * PAD) break;
  }
  z = Math.max(10, Math.min(19, z));

  // Bildausschnitt um die Gebietsmitte legen
  const centerX = (lngToPx(minLng, z) + lngToPx(maxLng, z)) / 2;
  const centerY = (latToPx(minLat, z) + latToPx(maxLat, z)) / 2;
  const left = centerX - W / 2;
  const top = centerY - H / 2;

  const canvas = document.createElement('canvas');
  canvas.width = W * S;
  canvas.height = H * S;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(S, S);

  // Hintergrund, falls einzelne Kacheln fehlen
  ctx.fillStyle = '#e8e5df';
  ctx.fillRect(0, 0, W, H);

  // Kacheln laden und zeichnen
  const x0 = Math.floor(left / TILE), x1 = Math.floor((left + W) / TILE);
  const y0 = Math.floor(top / TILE), y1 = Math.floor((top + H) / TILE);
  const max = Math.pow(2, z);
  const jobs: Promise<void>[] = [];
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= max) continue;
      const wrapX = ((tx % max) + max) % max;
      const sub = SUBDOMAINS[Math.abs(tx + ty) % SUBDOMAINS.length];
      const dx = tx * TILE - left;
      const dy = ty * TILE - top;
      jobs.push(
        loadImage(TILE_URL(sub, z, wrapX, ty)).then((img) => {
          if (img) ctx.drawImage(img, dx, dy, TILE, TILE);
        }),
      );
    }
  }
  await Promise.all(jobs);

  // Gebiet zeichnen
  const toXY = (p: [number, number]): [number, number] => [lngToPx(p[1], z) - left, latToPx(p[0], z) - top];
  ctx.beginPath();
  points.forEach((p, i) => {
    const [x, y] = toXY(p);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = 'rgba(16, 185, 129, 0.22)';
  ctx.fill();
  ctx.strokeStyle = '#059669';
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // "Keine Werbung"-Häuser
  excluded.forEach((p) => {
    const [x, y] = toXY(p);
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  });

  // Quellenangabe (Nutzungsbedingungen der Kartendienste)
  const credit = '© OpenStreetMap-Mitwirkende, © CARTO';
  ctx.font = '11px system-ui, sans-serif';
  const tw = ctx.measureText(credit).width;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(W - tw - 12, H - 20, tw + 12, 20);
  ctx.fillStyle = '#334155';
  ctx.fillText(credit, W - tw - 6, H - 6);

  return canvas.toDataURL('image/png');
}
