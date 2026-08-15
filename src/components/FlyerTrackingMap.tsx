import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, useMapEvents, useMap, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip as ChartTooltip, Legend
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Download, Map as MapIcon, PenTool, XOctagon, Eraser, Undo2, Check, Search, Upload, Pencil, Euro, BarChart3, Ruler, History, Magnet, PlusCircle, Trash2, Clock, ClipboardList, Loader2, Home, X as XIcon } from 'lucide-react';
import html2canvas from 'html2canvas';
import { format, parseISO, subMonths, isSameMonth } from 'date-fns';
import { de } from 'date-fns/locale';
import { DistributedArea, ExcludedHouse, FlyerAreaStatus, FlyerHistoryEntry } from '../types';
import { auth, db } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where } from 'firebase/firestore';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, ChartTooltip, Legend);

type Mode = 'idle' | 'draw' | 'exclude' | 'delete';

const CENTER_LAT = 52.2689; // Braunschweig Mitte – wird sofort durch Auto-Zentrierung überschrieben
const CENTER_LNG = 10.5268;
const HOME_ADDRESS = 'Helene-Engelbrecht-Straße 21, 38124 Braunschweig';
const todayISO = () => new Date().toISOString().split('T')[0];

// --- Geometrie: Polygonfläche in m² (sphärisch) ---
const toRad = (d: number) => (d * Math.PI) / 180;
function polygonAreaM2(points: [number, number][]): number {
  if (points.length < 3) return 0;
  const R = 6378137; // Erdradius in m
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [lat1, lng1] = points[i];
    const [lat2, lng2] = points[(i + 1) % points.length];
    sum += (toRad(lng2) - toRad(lng1)) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  return Math.abs((sum * R * R) / 2);
}
const formatArea = (m2: number) => (m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${Math.round(m2)} m²`);

// Distanz zweier Koordinaten in Metern (Haversine)
function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const la1 = toRad(a[0]);
  const la2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Punkt-in-Polygon (Ray-Casting), Punkte als [lat, lng]
function pointInPolygon(pt: [number, number], poly: [number, number][]): boolean {
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

// Hausnummer in [Zahl, Suffix] für natürliche Sortierung (z.B. "12a" -> [12, "a"])
function parseHouseNumber(hn: string): [number, string] {
  const m = String(hn).match(/^(\d+)\s*(.*)$/);
  return m ? [parseInt(m[1], 10), m[2].toLowerCase()] : [Number.MAX_SAFE_INTEGER, String(hn).toLowerCase()];
}
function sortHouseNumbers(nums: string[]): string[] {
  return [...nums].sort((a, b) => {
    const [na, sa] = parseHouseNumber(a);
    const [nb, sb] = parseHouseNumber(b);
    return na !== nb ? na - nb : sa < sb ? -1 : sa > sb ? 1 : 0;
  });
}

// Overpass-Abfrage: alle Adressen (node+way mit addr:housenumber) im Polygon
// Öffentliche Overpass-Spiegelserver – werden der Reihe nach probiert (Fallback)
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function fetchAddressesInPolygon(points: [number, number][]): Promise<{ street: string; hn: string; lat: number; lon: number }[]> {
  const polyStr = points.map((p) => `${p[0]} ${p[1]}`).join(' ');
  const q = `[out:json][timeout:25];(node["addr:housenumber"](poly:"${polyStr}");way["addr:housenumber"](poly:"${polyStr}"););out center tags;`;

  let json: any = null;
  let lastErr: any = null;
  for (const url of OVERPASS_ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000); // harter Timeout je Server
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) { lastErr = new Error('HTTP ' + res.status); continue; } // 429/504 → nächster Server
      json = await res.json();
      break;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      continue; // Timeout/Netzwerkfehler → nächster Server
    }
  }
  if (!json) throw lastErr || new Error('Overpass nicht erreichbar');

  const seen = new Set<string>();
  const out: { street: string; hn: string; lat: number; lon: number }[] = [];
  for (const el of json.elements || []) {
    const hn = el.tags?.['addr:housenumber'];
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!hn || lat == null || lon == null) continue;
    const street = el.tags?.['addr:street'] || 'Ohne Straßennamen';
    const key = `${street}|${hn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ street, hn, lat, lon });
  }
  return out;
}

// --- Bild-Export: moderne Farbfunktionen für html2canvas übersetzen ---
// Tailwind v4 liefert Farben als oklch(); Transparenz-Varianten (/70) werden zu
// oklab(). html2canvas 1.4.1 kann beides nicht parsen und bricht den Export ab.
// Darum im geklonten DOM jede solche Farbe über einen 1px-Canvas nach rgb() umrechnen.
// Betroffen sind nicht nur reine Farb-Properties, sondern auch zusammengesetzte
// Werte wie box-shadow und background-image (Verläufe).
const COLOR_PROPS = [
  'color', 'background-color', 'background-image', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color', 'outline-color', 'text-decoration-color',
  'box-shadow', 'text-shadow', 'fill', 'stroke', 'column-rule-color', 'caret-color',
  '-webkit-text-fill-color', '-webkit-text-stroke-color', 'text-emphasis-color',
];
const MODERN_COLOR = /(color-mix|oklch|oklab|lch|lab|color)\(/;
// Reihenfolge wichtig: längere Namen zuerst (color-mix vor color)
const COLOR_FNS = ['color-mix', 'oklch', 'oklab', 'lch', 'lab', 'color'];
let colorCtx: CanvasRenderingContext2D | null = null;

function cssColorToRgb(value: string): string | null {
  if (!colorCtx) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    colorCtx = cv.getContext('2d', { willReadFrequently: true });
  }
  if (!colorCtx) return null;
  try {
    colorCtx.clearRect(0, 0, 1, 1);
    colorCtx.fillStyle = value;
    colorCtx.fillRect(0, 0, 1, 1);
    const d = colorCtx.getImageData(0, 0, 1, 1).data;
    const a = d[3] / 255;
    return a >= 0.999 ? `rgb(${d[0]}, ${d[1]}, ${d[2]})` : `rgba(${d[0]}, ${d[1]}, ${d[2]}, ${a.toFixed(3)})`;
  } catch {
    return null;
  }
}

// Ersetzt jede moderne Farbfunktion innerhalb eines Wertes (z. B. in einem
// box-shadow mit mehreren Schatten) und lässt den Rest unangetastet.
function convertModernColors(value: string): string {
  let out = '';
  let i = 0;
  while (i < value.length) {
    let hit = false;
    for (const fn of COLOR_FNS) {
      if (!value.startsWith(fn + '(', i)) continue;
      // Kein Treffer, wenn der Name Teil eines längeren Bezeichners ist (lab in oklab)
      if (i > 0 && /[a-zA-Z0-9-]/.test(value[i - 1])) continue;
      let depth = 0;
      let j = i + fn.length;
      for (; j < value.length; j++) {
        if (value[j] === '(') depth++;
        else if (value[j] === ')') { depth--; if (depth === 0) { j++; break; } }
      }
      const raw = value.slice(i, j);
      out += cssColorToRgb(raw) || raw;
      i = j;
      hit = true;
      break;
    }
    if (!hit) { out += value[i]; i++; }
  }
  return out;
}

function sanitizeColors(doc: Document, root: any) {
  const view = doc.defaultView;
  if (!view || !root) return;
  const nodes: any[] = [root, ...Array.from(root.querySelectorAll('*'))];
  nodes.forEach((n) => {
    if (!n?.style?.setProperty) return;
    const cs = view.getComputedStyle(n);
    COLOR_PROPS.forEach((p) => {
      const v = cs.getPropertyValue(p);
      if (v && MODERN_COLOR.test(v)) {
        const converted = convertModernColors(v);
        if (converted !== v) n.style.setProperty(p, converted);
      }
    });

    // text-transform vorab anwenden: html2canvas misst Text über Range-Offsets
    // des transformierten Strings. Bei "ß" → "SS" wächst die Länge und der
    // Offset läuft aus dem Textknoten (Fehler "setEnd offset ... larger than").
    const tt = cs.getPropertyValue('text-transform');
    if (tt && tt !== 'none') {
      Array.from(n.childNodes).forEach((c: any) => {
        if (c.nodeType === 3 && c.nodeValue) {
          c.nodeValue =
            tt === 'uppercase' ? c.nodeValue.toUpperCase()
            : tt === 'lowercase' ? c.nodeValue.toLowerCase()
            : c.nodeValue.replace(/\b\w/g, (m: string) => m.toUpperCase());
        }
      });
      n.style.setProperty('text-transform', 'none');
    }
  });
}

// Leaflet blendet Kacheln per Animation ein. Läuft die Aufnahme mitten in der
// Einblendung (oder im Hintergrund-Tab, wo die Animation pausiert), sind die
// Kacheln durchsichtig und die Karte käme dunkel heraus. Deshalb für die
// Aufnahme kurz auf volle Deckkraft zwingen.
function forceTilesVisible(): () => void {
  const tiles = Array.from(document.querySelectorAll<HTMLElement>('.leaflet-tile'));
  const prev = tiles.map((t) => t.style.opacity);
  tiles.forEach((t) => (t.style.opacity = '1'));
  return () => tiles.forEach((t, i) => (t.style.opacity = prev[i]));
}

// Alle Bild-Exporte laufen hierüber, damit die Farbkorrektur nie vergessen wird.
// Wichtig: html2canvas klont das gesamte Dokument und wertet auch die Vorfahren
// des Ziels aus (z. B. das Modal-Backdrop) – deshalb das komplette Dokument säubern.
async function captureElement(el: HTMLElement, opts: any = {}) {
  return html2canvas(el, {
    useCORS: true,
    allowTaint: false, // getaintetes Canvas würde toDataURL() scheitern lassen
    ...opts,
    onclone: (doc: Document) => sanitizeColors(doc, doc.documentElement),
  });
}

// --- Firestore <-> App Serialisierung (Punkte als JSON-String, da Firestore keine verschachtelten Arrays erlaubt) ---
const serializeArea = (a: DistributedArea, uid: string) => ({
  id: a.id,
  userId: uid,
  pointsJson: JSON.stringify(a.points),
  flyerCount: a.flyerCount,
  name: a.name || '',
  note: a.note || '',
  distributedDate: a.distributedDate || todayISO(),
  status: a.status || 'erledigt',
  durationMinutes: a.durationMinutes || 0,
  costEuro: a.costEuro || 0,
  createdAt: a.createdAt || Date.now(),
});
const deserializeArea = (d: any): DistributedArea => ({
  id: d.id,
  points: (() => { try { return JSON.parse(d.pointsJson || '[]'); } catch { return []; } })(),
  flyerCount: d.flyerCount || 0,
  name: d.name || '',
  note: d.note || '',
  distributedDate: d.distributedDate || todayISO(),
  status: d.status || 'erledigt',
  durationMinutes: d.durationMinutes || 0,
  costEuro: d.costEuro || 0,
  createdAt: d.createdAt,
  userId: d.userId,
});

const formatEuro = (v: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(v || 0);

// Minuten → "1 h 30 min" bzw. "45 min"
const formatDuration = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
};

// Map-Steuerung: fliegt zu einer Zielposition (Adresssuche)
function MapFlyTo({ target }: { target: { lat: number; lng: number; ts: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 17);
  }, [target, map]);
  return null;
}

interface FlyerTrackingMapProps {
  addLog?: (message: string, module?: 'tracking' | 'workshop' | 'stopwatch' | 'system', revertAction?: any) => void;
}

export function FlyerTrackingMap({ addLog }: FlyerTrackingMapProps = {}) {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [areas, setAreas] = useState<DistributedArea[]>([]);
  const [excludedHouses, setExcludedHouses] = useState<ExcludedHouse[]>([]);

  const [mode, setMode] = useState<Mode>('idle');
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const [cursorPos, setCursorPos] = useState<[number, number] | null>(null);
  const [snapPoint, setSnapPoint] = useState<[number, number] | null>(null); // aktives Andocken
  const [snapEnabled, setSnapEnabled] = useState(true);                       // Andocken an/aus
  const [history, setHistory] = useState<FlyerHistoryEntry[]>([]);            // Flyer-Verteilungs-Historie

  const [showModal, setShowModal] = useState(false);
  const [editingAreaId, setEditingAreaId] = useState<string | null>(null);
  const [formCount, setFormCount] = useState('');
  const [formName, setFormName] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formDate, setFormDate] = useState(todayISO());
  const [formStatus, setFormStatus] = useState<FlyerAreaStatus>('erledigt');
  const [formDuration, setFormDuration] = useState(''); // Verteil-Dauer in Minuten
  const [formCost, setFormCost] = useState('');         // Kosten in € → Infrastruktur des Monats

  // Adresssuche (Geocoding via Nominatim/OSM)
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number; ts: number } | null>(null);

  // Kosten / ROI (lokal gespeichert)
  const [costPerFlyer, setCostPerFlyer] = useState('');
  const [customersWon, setCustomersWon] = useState('');
  const [marginPerCustomer, setMarginPerCustomer] = useState('');
  const [showStats, setShowStats] = useState(false);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapObjRef = useRef<any>(null);          // Leaflet-Karteninstanz (für fitBounds/Capture)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jobCardRef = useRef<HTMLDivElement>(null);
  const migratedRef = useRef(false);
  const settingsHydratedRef = useRef(false);   // true nach erstem Settings-Snapshot
  const remoteSettingsRef = useRef(false);      // verhindert Echo-Write nach Remote-Update
  // Erst wenn die Daten geladen sind, darf der localStorage-Spiegel schreiben.
  // Bewusst State (kein Ref): so läuft der Spiegel-Effekt erst im Render NACH
  // dem Laden – mit den geladenen Daten statt mit dem leeren Anfangszustand.
  const [hydrated, setHydrated] = useState(false);

  // --- Flyer-Auftrag (Job-Order für Austräger) ---
  const [showJobModal, setShowJobModal] = useState(false);
  const [jobArea, setJobArea] = useState<DistributedArea | null>(null);
  const [jobLoading, setJobLoading] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const [jobMapImage, setJobMapImage] = useState<string | null>(null);
  const [jobExporting, setJobExporting] = useState(false);
  const [jobExportError, setJobExportError] = useState<string | null>(null);
  const [jobData, setJobData] = useState<null | {
    streets: { name: string; numbers: string[]; excluded: string[] }[];
    totalHouses: number;
    totalAll: number;
    excludedCount: number;
    unmatchedExcluded: number;
  }>(null);

  // Auth-Status beobachten
  useEffect(() => onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null)), []);

  // Kosten-Einstellungen + Historie laden
  useEffect(() => {
    const saved = localStorage.getItem('flyerTracking_settings');
    if (saved) {
      try {
        const s = JSON.parse(saved);
        setCostPerFlyer(s.costPerFlyer ?? '');
        setCustomersWon(s.customersWon ?? '');
        setMarginPerCustomer(s.marginPerCustomer ?? '');
      } catch {}
    }
    const savedHist = localStorage.getItem('flyerTracking_history');
    if (savedHist) { try { setHistory(JSON.parse(savedHist)); } catch {} }
    const savedSnap = localStorage.getItem('flyerTracking_snapEnabled');
    if (savedSnap !== null) setSnapEnabled(savedSnap === 'true');
  }, []);

  // Historie-Eintrag anhängen → Firestore (eingeloggt) bzw. lokaler State (offline)
  const appendHistory = (action: FlyerHistoryEntry['action'], area: DistributedArea) => {
    const entry: FlyerHistoryEntry = {
      id: `${Date.now()}-${action}`,
      ts: new Date().toISOString(),
      action,
      name: area.name || '',
      flyerCount: area.flyerCount || 0,
      date: area.distributedDate || null,
      status: area.status || 'erledigt',
    };
    if (uid) {
      // onSnapshot aktualisiert den State; Doc enthält zusätzlich userId
      setDoc(doc(db, 'flyerHistory', entry.id), { ...entry, userId: uid }).catch(console.error);
    } else {
      setHistory((prev) => [...prev, entry].slice(-500));
    }
  };

  // Historie als Offline-Spiegel + Brücke für KI-Export.
  // Erst nach dem Laden schreiben, sonst überschreibt der leere Anfangs-State
  // beim Mounten die gespeicherten Daten.
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem('flyerTracking_history', JSON.stringify(history));
  }, [history, hydrated]);

  // Einstellungen persistieren: lokal (Offline) + Firestore (geräteübergreifend)
  useEffect(() => {
    localStorage.setItem('flyerTracking_settings', JSON.stringify({ costPerFlyer, customersWon, marginPerCustomer }));
    localStorage.setItem('flyerTracking_snapEnabled', String(snapEnabled));
    if (!uid) return;
    if (remoteSettingsRef.current) { remoteSettingsRef.current = false; return; } // Echo unterdrücken
    if (!settingsHydratedRef.current) return; // erst nach Initial-Snapshot schreiben
    setDoc(doc(db, 'flyerSettings', uid), { userId: uid, costPerFlyer, customersWon, marginPerCustomer, snapEnabled }, { merge: true }).catch(console.error);
  }, [costPerFlyer, customersWon, marginPerCustomer, snapEnabled, uid]);

  // Auto-Zentrierung beim ersten Laden:
  // 1) Gebiete vorhanden → letztes hinzugefügtes Gebiet (Schwerpunkt)
  // 2) Keine Gebiete → Heimadresse via Nominatim geocoden
  const [hasAutocentered, setHasAutocentered] = useState(false);
  useEffect(() => {
    if (hasAutocentered) return;
    if (areas.length > 0) {
      const latest = [...areas].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
      if (latest.points.length > 0) {
        const lat = latest.points.reduce((s, p) => s + p[0], 0) / latest.points.length;
        const lng = latest.points.reduce((s, p) => s + p[1], 0) / latest.points.length;
        setFlyTarget({ lat, lng, ts: Date.now() });
        setHasAutocentered(true);
      }
    } else {
      // Kein Gebiet vorhanden → Heimadresse geocoden (einmalig)
      setHasAutocentered(true); // sofort sperren damit kein zweiter Request kommt
      fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(HOME_ADDRESS)}`, {
        headers: { 'Accept-Language': 'de' },
      })
        .then((r) => r.json())
        .then((data) => {
          if (data?.[0]) {
            setFlyTarget({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), ts: Date.now() });
          }
        })
        .catch(() => {/* Stille Fehlerbehandlung – Karte bleibt auf Fallback-Mitte */});
    }
  }, [areas, hasAutocentered]);

  // --- Datenquelle: Firestore (eingeloggt) oder localStorage (offline) ---
  useEffect(() => {
    if (uid) {
      // Migration vorhandener localStorage-Daten beim ersten Login
      const qAreas = query(collection(db, 'flyerAreas'), where('userId', '==', uid));
      const unsubAreas = onSnapshot(qAreas, (snap) => {
        const loaded = snap.docs.map((d) => deserializeArea(d.data()));
        if (!migratedRef.current && loaded.length === 0) {
          const legacy = localStorage.getItem('flyerTracking_areas');
          if (legacy) {
            try {
              const legacyAreas: DistributedArea[] = JSON.parse(legacy);
              legacyAreas.forEach((a) => setDoc(doc(db, 'flyerAreas', a.id), serializeArea(a, uid)).catch(console.error));
            } catch {}
          }
        }
        migratedRef.current = true;
        setAreas(loaded);
        setHydrated(true);
      });

      const qHouses = query(collection(db, 'flyerHouses'), where('userId', '==', uid));
      const unsubHouses = onSnapshot(qHouses, (snap) => {
        const loaded = snap.docs.map((d) => {
          const data: any = d.data();
          return { id: data.id, point: [data.lat, data.lng] as [number, number], createdAt: data.createdAt, userId: data.userId };
        });
        if (loaded.length === 0) {
          const legacy = localStorage.getItem('flyerTracking_excluded');
          if (legacy) {
            try {
              const legacyHouses: ExcludedHouse[] = JSON.parse(legacy);
              legacyHouses.forEach((h) =>
                setDoc(doc(db, 'flyerHouses', h.id), { id: h.id, userId: uid, lat: h.point[0], lng: h.point[1], createdAt: h.createdAt || Date.now() }).catch(console.error)
              );
            } catch {}
          }
        }
        setExcludedHouses(loaded);
      });

      // Einstellungen (Kosten/ROI/Snap) – ein Dokument je Nutzer
      const unsubSettings = onSnapshot(doc(db, 'flyerSettings', uid), (snap) => {
        if (snap.exists()) {
          const d: any = snap.data();
          remoteSettingsRef.current = true; // nächsten Persist-Effekt nicht zurückschreiben
          setCostPerFlyer(d.costPerFlyer ?? '');
          setCustomersWon(d.customersWon ?? '');
          setMarginPerCustomer(d.marginPerCustomer ?? '');
          if (typeof d.snapEnabled === 'boolean') setSnapEnabled(d.snapEnabled);
        } else if (!settingsHydratedRef.current) {
          // Noch kein Remote-Dokument → lokale Einstellungen einmalig hochladen
          const local = (() => { try { return JSON.parse(localStorage.getItem('flyerTracking_settings') || '{}'); } catch { return {}; } })();
          const snapLocal = localStorage.getItem('flyerTracking_snapEnabled');
          setDoc(doc(db, 'flyerSettings', uid), {
            userId: uid,
            costPerFlyer: local.costPerFlyer ?? '',
            customersWon: local.customersWon ?? '',
            marginPerCustomer: local.marginPerCustomer ?? '',
            snapEnabled: snapLocal === null ? true : snapLocal === 'true',
          }, { merge: true }).catch(console.error);
        }
        settingsHydratedRef.current = true;
      });

      // Historie – eine Collection je Eintrag
      const qHist = query(collection(db, 'flyerHistory'), where('userId', '==', uid));
      const unsubHist = onSnapshot(qHist, (snap) => {
        const loaded = snap.docs
          .map((d) => {
            const { userId, ...rest } = d.data() as any;
            return rest as FlyerHistoryEntry;
          })
          .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
        if (loaded.length === 0) {
          // Lokale Historie einmalig migrieren
          try {
            const legacy: FlyerHistoryEntry[] = JSON.parse(localStorage.getItem('flyerTracking_history') || '[]');
            legacy.forEach((h) => setDoc(doc(db, 'flyerHistory', h.id), { ...h, userId: uid }).catch(console.error));
          } catch {}
        }
        setHistory(loaded);
      });

      return () => { unsubAreas(); unsubHouses(); unsubSettings(); unsubHist(); };
    } else {
      // Offline-Modus
      const savedAreas = localStorage.getItem('flyerTracking_areas');
      const savedHouses = localStorage.getItem('flyerTracking_excluded');
      if (savedAreas) { try { setAreas(JSON.parse(savedAreas)); } catch {} }
      if (savedHouses) { try { setExcludedHouses(JSON.parse(savedHouses)); } catch {} }
      setHydrated(true);
    }
  }, [uid]);

  // Offline-Spiegel in localStorage (auch als Backup im Online-Modus).
  // Achtung: erst nach der Hydration schreiben – sonst löscht der leere
  // Anfangs-State beim Mounten die gespeicherten Gebiete.
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem('flyerTracking_areas', JSON.stringify(areas));
    localStorage.setItem('flyerTracking_excluded', JSON.stringify(excludedHouses));
  }, [areas, excludedHouses, hydrated]);

  // Zeichen-Reststände aufräumen
  useEffect(() => {
    if (mode !== 'draw') { setDrawingPoints([]); setCursorPos(null); setSnapPoint(null); }
  }, [mode]);

  // --- Persistenz-Helfer ---
  const saveArea = (area: DistributedArea) => {
    if (uid) {
      setDoc(doc(db, 'flyerAreas', area.id), serializeArea(area, uid)).catch(console.error);
      setAreas((prev) => prev.some((a) => a.id === area.id) ? prev.map((a) => a.id === area.id ? area : a) : [...prev, area]);
    } else {
      setAreas((prev) => prev.some((a) => a.id === area.id) ? prev.map((a) => a.id === area.id ? area : a) : [...prev, area]);
    }
  };
  const removeArea = (id: string) => {
    const area = areas.find((a) => a.id === id);
    if (uid) deleteDoc(doc(db, 'flyerAreas', id)).catch(console.error);
    setAreas((prev) => prev.filter((a) => a.id !== id));
    if (area) appendHistory('delete', area);
  };
  const addHouse = (point: [number, number]) => {
    const house: ExcludedHouse = { id: Date.now().toString(), point, createdAt: Date.now(), userId: uid ?? undefined };
    if (uid) setDoc(doc(db, 'flyerHouses', house.id), { id: house.id, userId: uid, lat: point[0], lng: point[1], createdAt: house.createdAt }).catch(console.error);
    setExcludedHouses((prev) => [...prev, house]);
  };
  const removeHouse = (id: string) => {
    if (uid) deleteDoc(doc(db, 'flyerHouses', id)).catch(console.error);
    setExcludedHouses((prev) => prev.filter((h) => h.id !== id));
  };

  // --- KPIs ---
  const totalFlyers = areas.reduce((sum, a) => sum + a.flyerCount, 0);
  const totalAreaM2 = areas.reduce((sum, a) => sum + polygonAreaM2(a.points), 0);
  const avgDensity = totalAreaM2 > 0 ? totalFlyers / (totalAreaM2 / 10000) : 0; // Flyer / ha
  const cpf = parseFloat(costPerFlyer) || 0;
  const totalCost = totalFlyers * cpf;
  const customers = parseInt(customersWon) || 0;
  const margin = parseFloat(marginPerCustomer) || 0;
  const revenue = customers * margin;
  const roi = totalCost > 0 ? ((revenue - totalCost) / totalCost) * 100 : null;

  // --- Statistik: Flyer pro Monat (letzte 6) ---
  const monthly = Array.from({ length: 6 }).map((_, i) => subMonths(new Date(), 5 - i));
  const monthlyLabels = monthly.map((m) => format(m, 'MMM yy', { locale: de }));
  const monthlyData = monthly.map((m) =>
    areas.filter((a) => a.distributedDate && isSameMonth(parseISO(a.distributedDate), m)).reduce((s, a) => s + a.flyerCount, 0)
  );

  // --- Karten-Events ---
  const SNAP_PX = 16; // Andock-Radius in Pixeln

  // Nächstgelegenen Eckpunkt eines bestehenden Gebiets finden (zum Andocken)
  const findSnapVertex = (map: any, latlng: any): [number, number] | null => {
    if (!snapEnabled) return null;
    const cp = map.latLngToContainerPoint(latlng);
    let best: [number, number] | null = null;
    let bestDist = SNAP_PX;
    for (const a of areas) {
      for (const p of a.points) {
        const d = cp.distanceTo(map.latLngToContainerPoint(p));
        if (d < bestDist) { bestDist = d; best = p; }
      }
    }
    return best;
  };

  const MapEvents = () => {
    const map = useMapEvents({
      click: (e) => {
        const { lat, lng } = e.latlng;
        if (mode === 'exclude') {
          addHouse([lat, lng]);
        } else if (mode === 'draw') {
          // Schließen, wenn nahe am Startpunkt
          if (drawingPoints.length > 2) {
            const dist = map.latLngToContainerPoint(e.latlng).distanceTo(map.latLngToContainerPoint(drawingPoints[0] as [number, number]));
            if (dist < 30) { completePolygon(); return; }
          }
          // Andocken an Eckpunkt eines Nachbargebiets
          const snap = findSnapVertex(map, e.latlng);
          setDrawingPoints([...drawingPoints, snap ?? [lat, lng]]);
          setSnapPoint(null);
        }
      },
      mousemove: (e) => {
        if (mode === 'draw') {
          // Vorschau Schließen am Startpunkt
          if (drawingPoints.length > 2) {
            const dist = map.latLngToContainerPoint(e.latlng).distanceTo(map.latLngToContainerPoint(drawingPoints[0] as [number, number]));
            if (dist < 30) { setCursorPos(drawingPoints[0] as [number, number]); setSnapPoint(null); return; }
          }
          // Vorschau Andocken
          const snap = findSnapVertex(map, e.latlng);
          if (snap) { setSnapPoint(snap); setCursorPos(snap); return; }
          setSnapPoint(null);
          setCursorPos([e.latlng.lat, e.latlng.lng]);
        }
      },
    });
    return null;
  };

  const completePolygon = () => { if (drawingPoints.length > 2) openCreateModal(); };

  const openCreateModal = () => {
    setEditingAreaId(null);
    setFormCount('');
    setFormName('');
    setFormNote('');
    setFormDate(todayISO());
    setFormStatus('erledigt');
    setFormDuration('');
    setFormCost('');
    setShowModal(true);
  };

  const openEditModal = (area: DistributedArea) => {
    setEditingAreaId(area.id);
    setFormCount(area.flyerCount.toString());
    setFormName(area.name || '');
    setFormNote(area.note || '');
    setFormDate(area.distributedDate || todayISO());
    setFormStatus(area.status || 'erledigt');
    setFormDuration(area.durationMinutes ? area.durationMinutes.toString() : '');
    setFormCost(area.costEuro ? area.costEuro.toString() : '');
    setShowModal(true);
  };

  const handleSaveArea = () => {
    const count = parseInt(formCount);
    if (isNaN(count) || count < 0) return;
    const duration = Math.max(0, parseInt(formDuration) || 0);
    const cost = Math.max(0, parseFloat(formCost.replace(',', '.')) || 0);
    if (editingAreaId) {
      const existing = areas.find((a) => a.id === editingAreaId);
      if (!existing) return;
      const oldDuration = existing.durationMinutes || 0;
      const oldCost = existing.costEuro || 0;
      const updated = { ...existing, flyerCount: count, name: formName.trim(), note: formNote.trim(), distributedDate: formDate, status: formStatus, durationMinutes: duration, costEuro: cost };
      saveArea(updated);
      appendHistory('edit', updated);
      // Dauer-Änderung protokollieren (fließt in Geschäfts-Stundenlohn ein)
      if (duration !== oldDuration && (duration > 0 || oldDuration > 0)) {
        addLog?.(`Flyer verteilen (Dauer geändert): ${updated.name || 'Gebiet'} – ${formatDuration(oldDuration)} → ${formatDuration(duration)}`, 'stopwatch');
      }
      // Kosten-Änderung protokollieren (fließt in Infrastruktur des Monats ein)
      if (cost !== oldCost) {
        addLog?.(`Flyer-Kosten geändert: ${updated.name || 'Gebiet'} – ${formatEuro(oldCost)} → ${formatEuro(cost)} (Infrastruktur ${formDate.slice(0, 7)})`, 'tracking');
      }
    } else {
      if (drawingPoints.length < 3) return;
      const created: DistributedArea = {
        id: Date.now().toString(),
        points: drawingPoints,
        flyerCount: count,
        name: formName.trim(),
        note: formNote.trim(),
        distributedDate: formDate,
        status: formStatus,
        durationMinutes: duration,
        costEuro: cost,
        createdAt: Date.now(),
        userId: uid ?? undefined,
      };
      saveArea(created);
      appendHistory('add', created);
      // Verteil-Dauer als Zeiteintrag protokollieren (fließt in Geschäfts-Stundenlohn ein)
      if (duration > 0) {
        addLog?.(`Flyer verteilen: ${created.name || 'Gebiet'} (${count} Flyer) – ${formatDuration(duration)}`, 'stopwatch');
      }
      // Kosten protokollieren (fließt in Infrastruktur des Monats ein)
      if (cost > 0) {
        addLog?.(`Flyer-Kosten erfasst: ${created.name || 'Gebiet'} – ${formatEuro(cost)} (Infrastruktur ${formDate.slice(0, 7)})`, 'tracking');
      }
      setMode('idle');
      setDrawingPoints([]);
    }
    closeModal();
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingAreaId(null);
    setFormCount('');
    setFormName('');
    setFormNote('');
    setFormDuration('');
    setFormCost('');
  };

  const cancelDrawing = () => {
    setDrawingPoints([]);
    setMode('idle');
    closeModal();
  };

  const handleUndoPoint = () => setDrawingPoints((prev) => prev.slice(0, -1));

  // --- Adresssuche ---
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(searchQuery)}`, {
        headers: { 'Accept-Language': 'de' },
      });
      const data = await res.json();
      if (data && data.length > 0) {
        setFlyTarget({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), ts: Date.now() });
      } else {
        alert('Keine Adresse gefunden.');
      }
    } catch {
      alert('Adresssuche fehlgeschlagen.');
    } finally {
      setSearching(false);
    }
  };

  // --- Export ---
  const handleExportPng = async () => {
    if (!mapRef.current) return;
    const controls = document.querySelectorAll('.leaflet-control-container');
    controls.forEach((el: any) => (el.style.display = 'none'));
    const restoreTiles = forceTilesVisible();
    try {
      const canvas = await captureElement(mapRef.current);
      const link = document.createElement('a');
      link.download = `flyer-tracking-${todayISO()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (error) {
      console.error('Failed to export map', error);
      alert('Karten-Export fehlgeschlagen: ' + ((error as Error)?.message || 'unbekannter Fehler'));
    } finally {
      restoreTiles();
      controls.forEach((el: any) => (el.style.display = ''));
    }
  };

  const downloadBlob = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handleExportCsv = () => {
    const header = ['Name', 'Datum', 'Status', 'Flyer', 'Flaeche_m2', 'Dichte_Flyer_pro_ha', 'Dauer_min', 'Kosten_EUR'];
    const rows = areas.map((a) => {
      const m2 = polygonAreaM2(a.points);
      const dens = m2 > 0 ? a.flyerCount / (m2 / 10000) : 0;
      return [
        `"${(a.name || '').replace(/"/g, '""')}"`,
        a.distributedDate || '',
        a.status || '',
        a.flyerCount,
        Math.round(m2),
        Math.round(dens),
        a.durationMinutes || 0,
        (a.costEuro || 0).toFixed(2),
      ].join(',');
    });
    downloadBlob([header.join(','), ...rows].join('\n'), `flyer-tracking-${todayISO()}.csv`, 'text/csv');
  };

  const handleExportGeoJson = () => {
    const geo = {
      type: 'FeatureCollection',
      features: [
        ...areas.map((a) => ({
          type: 'Feature',
          properties: { kind: 'area', id: a.id, name: a.name, flyerCount: a.flyerCount, distributedDate: a.distributedDate, status: a.status, note: a.note, durationMinutes: a.durationMinutes || 0, costEuro: a.costEuro || 0 },
          geometry: { type: 'Polygon', coordinates: [[...a.points, a.points[0]].map(([lat, lng]) => [lng, lat])] },
        })),
        ...excludedHouses.map((h) => ({
          type: 'Feature',
          properties: { kind: 'excludedHouse', id: h.id },
          geometry: { type: 'Point', coordinates: [h.point[1], h.point[0]] },
        })),
      ],
    };
    downloadBlob(JSON.stringify(geo, null, 2), `flyer-tracking-${todayISO()}.geojson`, 'application/geo+json');
  };

  const handleImportGeoJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const geo = JSON.parse(reader.result as string);
        if (!geo.features) throw new Error('Kein gültiges GeoJSON');
        let importedAreas = 0;
        let importedHouses = 0;
        geo.features.forEach((f: any) => {
          if (f.geometry?.type === 'Polygon' && f.properties?.kind !== 'excludedHouse') {
            const ring: [number, number][] = f.geometry.coordinates[0].map(([lng, lat]: number[]) => [lat, lng]);
            // Geschlossenen Ring wieder öffnen
            if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
            saveArea({
              id: f.properties?.id || `${Date.now()}-${importedAreas}`,
              points: ring,
              flyerCount: f.properties?.flyerCount || 0,
              name: f.properties?.name || '',
              note: f.properties?.note || '',
              distributedDate: f.properties?.distributedDate || todayISO(),
              status: f.properties?.status || 'erledigt',
              durationMinutes: f.properties?.durationMinutes || 0,
              costEuro: f.properties?.costEuro || 0,
              createdAt: Date.now(),
              userId: uid ?? undefined,
            });
            importedAreas++;
          } else if (f.geometry?.type === 'Point') {
            const [lng, lat] = f.geometry.coordinates;
            addHouse([lat, lng]);
            importedHouses++;
          }
        });
        alert(`Import: ${importedAreas} Gebiete, ${importedHouses} Häuser.`);
      } catch (err) {
        alert('Import fehlgeschlagen: ' + (err as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // --- Flyer-Auftrag (Job-Order) für den Austräger ---
  // Karte auf das Gebiet zoomen und als Bild aufnehmen
  const captureAreaMap = async (area: DistributedArea): Promise<string | null> => {
    const map = mapObjRef.current;
    if (!map || !mapRef.current || area.points.length < 3) return null;
    map.fitBounds(area.points, { padding: [30, 30] });
    await new Promise((r) => setTimeout(r, 1300)); // Kacheln nachladen lassen
    const controls = document.querySelectorAll('.leaflet-control-container');
    controls.forEach((el: any) => (el.style.display = 'none'));
    const restoreTiles = forceTilesVisible();
    try {
      const canvas = await captureElement(mapRef.current);
      return canvas.toDataURL('image/png');
    } catch (e) {
      console.error('Kartenaufnahme fehlgeschlagen', e);
      return null;
    } finally {
      restoreTiles();
      controls.forEach((el: any) => (el.style.display = ''));
    }
  };

  const generateJobOrder = async (area: DistributedArea) => {
    setJobArea(area);
    setShowModal(false);
    setShowJobModal(true);
    setJobLoading(true);
    setJobError(null);
    setJobData(null);
    setJobMapImage(null);
    try {
      // 1) Kartenbild des Gebiets
      const img = await captureAreaMap(area);
      setJobMapImage(img);
      // 2) Adressen via Overpass/OSM
      const addrs = await fetchAddressesInPolygon(area.points);
      // 3) Ausgeschlossene Häuser den Adressen zuordnen (nächste Adresse ≤ 25 m)
      const excludedInside = excludedHouses.filter((h) => pointInPolygon(h.point, area.points));
      const matchedExcludedKeys = new Set<string>();
      excludedInside.forEach((h) => {
        let best: { key: string; d: number } | null = null;
        addrs.forEach((a) => {
          const d = haversineM(h.point, [a.lat, a.lon]);
          if (d <= 25 && (!best || d < best.d)) best = { key: `${a.street}|${a.hn}`, d };
        });
        if (best) matchedExcludedKeys.add(best!.key);
      });
      // 4) Nach Straße gruppieren
      const byStreet: Record<string, { numbers: string[]; excluded: string[] }> = {};
      addrs.forEach((a) => {
        const g = (byStreet[a.street] ||= { numbers: [], excluded: [] });
        if (matchedExcludedKeys.has(`${a.street}|${a.hn}`)) g.excluded.push(a.hn);
        else g.numbers.push(a.hn);
      });
      const streets = Object.entries(byStreet)
        .map(([name, g]) => ({ name, numbers: sortHouseNumbers(g.numbers), excluded: sortHouseNumbers(g.excluded) }))
        .filter((s) => s.numbers.length > 0 || s.excluded.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name, 'de'));
      const excludedCount = matchedExcludedKeys.size;
      const totalAll = addrs.length;
      const totalHouses = totalAll - excludedCount;
      const unmatchedExcluded = excludedInside.length - excludedCount;
      setJobData({ streets, totalHouses, totalAll, excludedCount, unmatchedExcluded });
    } catch (err) {
      setJobError('Adressdaten konnten nicht geladen werden (OpenStreetMap/Overpass war nicht erreichbar). Bitte in ein paar Sekunden erneut versuchen.');
    } finally {
      setJobLoading(false);
    }
  };

  const exportJobPng = async () => {
    if (!jobCardRef.current) return;
    setJobExporting(true);
    setJobExportError(null);
    try {
      const canvas = await captureElement(jobCardRef.current, { backgroundColor: '#ffffff', scale: 2 });
      const url = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `flyer-auftrag-${(jobArea?.name || 'gebiet').replace(/[^\w\-]+/g, '_')}-${todayISO()}.png`;
      link.href = url;
      document.body.appendChild(link); // Firefox braucht den Link im DOM
      link.click();
      link.remove();
    } catch (e) {
      console.error('Job-Export fehlgeschlagen', e);
      setJobExportError('Export fehlgeschlagen: ' + ((e as Error)?.message || 'unbekannter Fehler'));
    } finally {
      setJobExporting(false);
    }
  };

  // --- Karten-Klick auf Gebiet/Haus ---
  const handleAreaClick = (area: DistributedArea, e: any) => {
    e.originalEvent.stopPropagation();
    if (mode === 'delete') removeArea(area.id);
    else if (mode === 'idle') openEditModal(area);
  };
  const handleHouseClick = (id: string, e: any) => {
    if (mode === 'delete') { e.originalEvent.stopPropagation(); removeHouse(id); }
  };

  const tempDrawPath = [...drawingPoints];
  if (cursorPos) tempDrawPath.push(cursorPos);

  const formatCurrency = (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

  return (
    <div className="space-y-4 mt-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center space-x-4">
          <MapIcon className="w-6 h-6 text-emerald-500" />
          <h2 className="text-2xl font-bold">Logistik &amp; Flyer-Tracking</h2>
          {!uid && <span className="text-xs px-2 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">Offline – nur lokal gespeichert</span>}
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowStats((s) => !s)} className="border-slate-700">
          <BarChart3 className="w-4 h-4 mr-2" /> {showStats ? 'Statistik ausblenden' : 'Statistik & ROI'}
        </Button>
      </div>

      {/* KPI-Kacheln */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-3 text-center">
            <p className="text-[10px] text-emerald-500/70 font-bold uppercase tracking-wider">Verteilte Flyer</p>
            <h3 className="text-2xl font-bold text-emerald-400 mt-1">{totalFlyers.toLocaleString('de-DE')}</h3>
          </CardContent>
        </Card>
        <Card className="border-slate-700 bg-slate-800/40">
          <CardContent className="p-3 text-center">
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center justify-center gap-1"><Ruler className="w-3 h-3" /> Fläche</p>
            <h3 className="text-2xl font-bold text-slate-200 mt-1">{formatArea(totalAreaM2)}</h3>
          </CardContent>
        </Card>
        <Card className="border-slate-700 bg-slate-800/40">
          <CardContent className="p-3 text-center">
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Ø Dichte</p>
            <h3 className="text-2xl font-bold text-slate-200 mt-1">{Math.round(avgDensity).toLocaleString('de-DE')}<span className="text-xs text-slate-500"> /ha</span></h3>
          </CardContent>
        </Card>
        <Card className="border-slate-700 bg-slate-800/40">
          <CardContent className="p-3 text-center">
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Gebiete</p>
            <h3 className="text-2xl font-bold text-slate-200 mt-1">{areas.length}<span className="text-xs text-slate-500"> · {excludedHouses.length} ⊘</span></h3>
          </CardContent>
        </Card>
      </div>

      {/* Statistik & ROI Panel */}
      {showStats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="border-slate-700 bg-slate-800/40">
            <CardHeader className="pb-2"><CardTitle className="text-base">Flyer pro Monat</CardTitle></CardHeader>
            <CardContent className="h-56">
              <Bar
                data={{ labels: monthlyLabels, datasets: [{ label: 'Flyer', data: monthlyData, backgroundColor: 'rgba(16,185,129,0.5)', borderColor: '#10b981', borderWidth: 1 }] }}
                options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: 'rgba(255,255,255,0.08)' }, ticks: { color: '#94a3b8' } }, x: { grid: { display: false }, ticks: { color: '#94a3b8' } } } }}
              />
            </CardContent>
          </Card>
          <Card className="border-slate-700 bg-slate-800/40">
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Euro className="w-4 h-4 text-emerald-400" /> Kosten &amp; ROI</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs text-slate-400 flex flex-col gap-1">Kosten/Flyer (€)
                  <Input type="number" step="0.001" value={costPerFlyer} onChange={(e) => setCostPerFlyer(e.target.value)} placeholder="0,03" className="h-8" />
                </label>
                <label className="text-xs text-slate-400 flex flex-col gap-1">Kunden gewonnen
                  <Input type="number" value={customersWon} onChange={(e) => setCustomersWon(e.target.value)} placeholder="0" className="h-8" />
                </label>
                <label className="text-xs text-slate-400 flex flex-col gap-1">Ø Marge/Kunde (€)
                  <Input type="number" value={marginPerCustomer} onChange={(e) => setMarginPerCustomer(e.target.value)} placeholder="0" className="h-8" />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-slate-900/50 rounded-lg p-2"><span className="text-slate-400 text-xs">Gesamtkosten</span><div className="font-bold text-red-400">{formatCurrency(totalCost)}</div></div>
                <div className="bg-slate-900/50 rounded-lg p-2"><span className="text-slate-400 text-xs">Kosten / 1.000 Flyer</span><div className="font-bold text-slate-200">{formatCurrency(cpf * 1000)}</div></div>
                <div className="bg-slate-900/50 rounded-lg p-2"><span className="text-slate-400 text-xs">Umsatz (geschätzt)</span><div className="font-bold text-emerald-400">{formatCurrency(revenue)}</div></div>
                <div className="bg-slate-900/50 rounded-lg p-2"><span className="text-slate-400 text-xs">ROI</span><div className={`font-bold ${roi === null ? 'text-slate-500' : roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{roi === null ? '–' : `${roi >= 0 ? '+' : ''}${roi.toFixed(0)} %`}</div></div>
              </div>
            </CardContent>
          </Card>

          {/* Flyer-Historie */}
          <Card className="border-slate-700 bg-slate-800/40 lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><History className="w-4 h-4 text-emerald-400" /> Flyer-Historie ({history.length})</CardTitle></CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-slate-500 py-2">Noch keine Einträge. Gebiete anlegen, bearbeiten oder löschen wird hier protokolliert.</p>
              ) : (
                <div className="max-h-52 overflow-y-auto space-y-1">
                  {[...history].reverse().map((h) => {
                    const meta = h.action === 'add'
                      ? { icon: <PlusCircle className="w-3.5 h-3.5 text-emerald-400" />, label: 'angelegt', color: 'text-emerald-400' }
                      : h.action === 'edit'
                        ? { icon: <Pencil className="w-3.5 h-3.5 text-blue-400" />, label: 'bearbeitet', color: 'text-blue-400' }
                        : { icon: <Trash2 className="w-3.5 h-3.5 text-red-400" />, label: 'gelöscht', color: 'text-red-400' };
                    return (
                      <div key={h.id} className="flex items-center gap-2 text-xs bg-slate-900/40 rounded px-2 py-1.5">
                        {meta.icon}
                        <span className="text-slate-300 font-medium truncate flex-1">{h.name || 'Gebiet'}</span>
                        <span className={`${meta.color} font-semibold`}>{meta.label}</span>
                        <span className="text-emerald-300 tabular-nums">{h.flyerCount.toLocaleString('de-DE')} Flyer</span>
                        <span className="text-slate-500 tabular-nums">{format(parseISO(h.ts), 'dd.MM.yy HH:mm')}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Toolbar */}
      <Card className="border-slate-700 bg-slate-800/40">
        <CardContent className="p-4 flex flex-col gap-3">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
              <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Adresse oder Ort suchen…" className="pl-9 h-9" />
            </div>
            <Button type="submit" variant="secondary" size="sm" disabled={searching} className="h-9">{searching ? '…' : 'Springen'}</Button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={mode === 'draw' ? 'default' : 'secondary'} className={mode === 'draw' ? 'bg-emerald-600 hover:bg-emerald-700 ring-2 ring-emerald-500 ring-offset-2 ring-offset-slate-900' : ''} onClick={() => setMode(mode === 'draw' ? 'idle' : 'draw')}>
              <PenTool className="w-4 h-4 mr-2" /> {mode === 'draw' ? 'Zeichnen aktiv…' : 'Gebiet zeichnen'}
            </Button>
            <Button variant={mode === 'exclude' ? 'destructive' : 'secondary'} className={mode === 'exclude' ? 'ring-2 ring-red-500 ring-offset-2 ring-offset-slate-900' : ''} onClick={() => setMode(mode === 'exclude' ? 'idle' : 'exclude')}>
              <XOctagon className="w-4 h-4 mr-2" /> {mode === 'exclude' ? 'Exkludieren aktiv…' : 'Haus exkludieren'}
            </Button>
            <Button variant={mode === 'delete' ? 'outline' : 'secondary'} className={mode === 'delete' ? 'border-orange-500 text-orange-400 ring-2 ring-orange-500 ring-offset-2 ring-offset-slate-900' : ''} onClick={() => setMode(mode === 'delete' ? 'idle' : 'delete')}>
              <Eraser className="w-4 h-4 mr-2" /> Löschen
            </Button>
            <Button
              variant={snapEnabled ? 'default' : 'secondary'}
              className={snapEnabled ? 'bg-amber-600 hover:bg-amber-700' : ''}
              onClick={() => setSnapEnabled((s) => !s)}
              title="An Eckpunkte benachbarter Gebiete andocken (verhindert Lücken)"
            >
              <Magnet className="w-4 h-4 mr-2" /> Andocken {snapEnabled ? 'an' : 'aus'}
            </Button>
            <div className="flex items-center gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={handleExportPng} className="border-slate-700"><Download className="w-4 h-4 mr-1" /> PNG</Button>
              <Button variant="outline" size="sm" onClick={handleExportCsv} className="border-slate-700"><Download className="w-4 h-4 mr-1" /> CSV</Button>
              <Button variant="outline" size="sm" onClick={handleExportGeoJson} className="border-slate-700"><Download className="w-4 h-4 mr-1" /> GeoJSON</Button>
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="border-slate-700"><Upload className="w-4 h-4 mr-1" /> Import</Button>
              <input ref={fileInputRef} type="file" accept=".geojson,application/geo+json,application/json" onChange={handleImportGeoJson} className="hidden" />
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm font-medium text-slate-400">
            <span className="flex items-center"><div className="w-3 h-3 bg-emerald-500/40 border border-emerald-500 mr-2 rounded-sm" /> Verteilt (erledigt)</span>
            <span className="flex items-center"><div className="w-3 h-3 bg-blue-500/40 border border-blue-500 mr-2 rounded-sm" /> Geplant</span>
            <span className="flex items-center"><div className="w-3 h-3 bg-red-500 rounded-full mr-2" /> Keine Werbung</span>
            {mode === 'idle' && <span className="text-xs text-slate-500">Tipp: Gebiet anklicken zum Bearbeiten</span>}
            {mode === 'draw' && snapEnabled && <span className="flex items-center text-xs text-amber-400"><Magnet className="w-3 h-3 mr-1" /> Andocken aktiv – rastet an Nachbar-Eckpunkten ein</span>}
          </div>
        </CardContent>
      </Card>

      {/* Karte */}
      <div className="relative rounded-lg overflow-hidden border border-slate-700 h-[600px] bg-slate-900 group" ref={mapRef}>
        <MapContainer ref={mapObjRef} center={[CENTER_LAT, CENTER_LNG]} zoom={17} style={{ height: '100%', width: '100%', backgroundColor: '#0f172a' }}>
          {/* crossOrigin ist Pflicht: ohne CORS-Kacheln lässt html2canvas sie beim
              Bild-Export weg und die Karte käme komplett dunkel heraus */}
          <TileLayer crossOrigin="anonymous" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
          <MapEvents />
          <MapFlyTo target={flyTarget} />

          {areas.map((area) => {
            const planned = area.status === 'geplant';
            const base = mode === 'delete' ? '#ef4444' : planned ? '#3b82f6' : '#10b981';
            return (
              <Polygon
                key={area.id}
                positions={area.points}
                pathOptions={{ fillColor: base, fillOpacity: mode === 'delete' ? 0.6 : 0.4, color: base, weight: 2, dashArray: planned ? '6, 6' : undefined }}
                eventHandlers={{ click: (e) => handleAreaClick(area, e) }}
              >
                <Tooltip sticky>
                  <div className="text-xs">
                    <strong>{area.name || 'Gebiet'}</strong><br />
                    {area.flyerCount.toLocaleString('de-DE')} Flyer · {formatArea(polygonAreaM2(area.points))}<br />
                    {area.distributedDate && format(parseISO(area.distributedDate), 'dd.MM.yyyy')} · {planned ? 'geplant' : 'erledigt'}<br />
                    {mode === 'delete' ? 'Klicken zum Löschen' : 'Klicken zum Bearbeiten'}
                  </div>
                </Tooltip>
              </Polygon>
            );
          })}

          {mode === 'draw' && tempDrawPath.length > 0 && (
            <Polyline positions={tempDrawPath} pathOptions={{ color: '#3b82f6', weight: 2, dashArray: '5, 5' }} />
          )}

          {mode === 'draw' && drawingPoints.map((pt, i) => {
            const canClose = i === 0 && drawingPoints.length > 2;
            return (
              <CircleMarker key={i} center={pt} radius={canClose ? 8 : 4} pathOptions={{ color: canClose ? '#10b981' : '#2563eb', fillColor: canClose ? '#10b981' : '#fff', fillOpacity: canClose ? 0.8 : 1, weight: 2 }}
                eventHandlers={{ click: (e) => { if (canClose) { e.originalEvent.stopPropagation(); completePolygon(); } } }}>
                {canClose && <Tooltip permanent direction="right" className="bg-emerald-500 text-white border-0 font-bold opacity-90 text-xs">Zum Verbinden anklicken</Tooltip>}
              </CircleMarker>
            );
          })}

          {mode === 'draw' && drawingPoints.length > 2 && (
            <Polygon positions={drawingPoints} pathOptions={{ fillColor: '#3b82f6', fillOpacity: 0.2, color: 'transparent', weight: 0 }} />
          )}

          {/* Andock-Indikator: leuchtet wenn der Cursor an einem Nachbar-Eckpunkt einrastet */}
          {mode === 'draw' && snapPoint && (
            <CircleMarker center={snapPoint} radius={11} pathOptions={{ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.35, weight: 3 }}>
              <Tooltip permanent direction="top" className="bg-amber-500 text-white border-0 font-bold opacity-90 text-xs">Andocken</Tooltip>
            </CircleMarker>
          )}

          {excludedHouses.map((house) => (
            <CircleMarker key={house.id} center={house.point} radius={7}
              pathOptions={{ fillColor: mode === 'delete' ? '#f97316' : '#ef4444', fillOpacity: 0.9, color: mode === 'delete' ? '#ea580c' : '#b91c1c', weight: 2 }}
              eventHandlers={{ click: (e) => handleHouseClick(house.id, e) }}>
              {mode === 'delete' && <Tooltip sticky>Klicken zum Löschen</Tooltip>}
            </CircleMarker>
          ))}
        </MapContainer>

        {mode === 'draw' && (
          <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-[1000] flex space-x-2 bg-slate-900/90 backdrop-blur-md p-2 rounded-xl shadow-2xl border border-slate-700/50">
            {drawingPoints.length > 0 && (
              <Button variant="secondary" size="sm" onClick={handleUndoPoint} className="text-slate-300"><Undo2 className="w-4 h-4 mr-1" /> Zurück</Button>
            )}
            <Button variant="default" size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed" onClick={completePolygon} disabled={drawingPoints.length <= 2}>
              <Check className="w-4 h-4 mr-1" /> Fertigstellen
            </Button>
          </div>
        )}

        {mode === 'delete' && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000] bg-orange-500/90 backdrop-blur-sm text-white px-4 py-2 rounded-full font-medium shadow-xl flex items-center border border-orange-400">
            <Eraser className="w-4 h-4 mr-2" /> Klicke auf eine Zone oder ein Haus, um es zu löschen
          </div>
        )}

        {/* Modal: Gebiet anlegen/bearbeiten */}
        {showModal && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm z-[1000] flex items-center justify-center p-4">
            <Card className="w-full max-w-sm shadow-2xl border-emerald-500/30">
              <CardHeader>
                <CardTitle className="text-lg text-slate-100 flex items-center gap-2">
                  {editingAreaId ? <><Pencil className="w-4 h-4" /> Gebiet bearbeiten</> : 'Neues Gebiet'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input placeholder="Name / Straße (optional)" value={formName} onChange={(e) => setFormName(e.target.value)} className="bg-slate-800" />
                <Input type="number" placeholder="Anzahl Flyer (exakt)" value={formCount} onChange={(e) => setFormCount(e.target.value)} className="text-center text-xl font-bold bg-slate-800 border-emerald-500/50 focus:border-emerald-500" autoFocus />
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-slate-400 flex flex-col gap-1">Datum
                    <Input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="bg-slate-800 h-9" />
                  </label>
                  <label className="text-xs text-slate-400 flex flex-col gap-1">Status
                    <select value={formStatus} onChange={(e) => setFormStatus(e.target.value as FlyerAreaStatus)} className="h-9 rounded-lg border border-slate-700 bg-slate-800 px-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500">
                      <option value="erledigt">Erledigt</option>
                      <option value="geplant">Geplant</option>
                    </select>
                  </label>
                </div>
                <label className="text-xs text-slate-400 flex flex-col gap-1">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Dauer (Minuten) – fließt in Geschäfts-Stundenlohn</span>
                  <Input type="number" min="0" placeholder="z. B. 45" value={formDuration} onChange={(e) => setFormDuration(e.target.value)} className="bg-slate-800 h-9" />
                </label>
                <label className="text-xs text-slate-400 flex flex-col gap-1">
                  <span className="flex items-center gap-1"><Euro className="w-3 h-3" /> Kosten (€) – fließt in Infrastruktur des Monats</span>
                  <Input type="number" min="0" step="0.01" placeholder="z. B. 25" value={formCost} onChange={(e) => setFormCost(e.target.value)} className="bg-slate-800 h-9" />
                </label>
                <Input placeholder="Notiz (optional)" value={formNote} onChange={(e) => setFormNote(e.target.value)} className="bg-slate-800" />
                {editingAreaId && (
                  <Button
                    variant="outline"
                    className="w-full border-blue-500/50 text-blue-300 hover:bg-blue-500/10 hover:text-blue-200"
                    onClick={() => { const a = areas.find((x) => x.id === editingAreaId); if (a) generateJobOrder(a); }}
                  >
                    <ClipboardList className="w-4 h-4 mr-2" /> Austräger-Auftrag erstellen
                  </Button>
                )}
                <div className="flex space-x-2 pt-1">
                  <Button variant="secondary" className="flex-1" onClick={editingAreaId ? closeModal : cancelDrawing}>Abbrechen</Button>
                  <Button variant="default" className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white" onClick={handleSaveArea}>Speichern</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

      </div>

      {/* Job-Order Modal – bewusst AUSSERHALB des Karten-Containers: sonst nimmt die
          Kartenaufnahme das offene Modal mit auf und der lange Auftrag würde auf
          600px Kartenhöhe beschnitten */}
      {showJobModal && (
          <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[2000] flex items-start justify-center p-3 overflow-y-auto">
            <div className="w-full max-w-lg my-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-bold text-white flex items-center gap-2"><ClipboardList className="w-5 h-5 text-blue-400" /> Austräger-Auftrag</h3>
                <button onClick={() => setShowJobModal(false)} className="text-slate-400 hover:text-white p-1"><XIcon className="w-5 h-5" /></button>
              </div>

              {jobLoading && (
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 flex flex-col items-center gap-3 text-slate-300">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
                  <p className="text-sm">Karte &amp; Adressen aus OpenStreetMap werden geladen…</p>
                </div>
              )}

              {!jobLoading && jobError && (
                <div className="bg-slate-800 border border-red-500/40 rounded-xl p-6 text-center space-y-3">
                  <p className="text-sm text-red-300">{jobError}</p>
                  <Button variant="secondary" size="sm" onClick={() => jobArea && generateJobOrder(jobArea)}>Erneut versuchen</Button>
                </div>
              )}

              {!jobLoading && !jobError && jobData && jobArea && (
                <>
                  {/* Exportierbare Auftragskarte (heller "Dokument"-Look) */}
                  <div ref={jobCardRef} style={{ backgroundColor: '#ffffff', color: '#0f172a' }} className="rounded-xl p-5">
                    <div className="flex items-start justify-between border-b border-slate-200 pb-3 mb-3">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-widest text-blue-600">Flyer-Verteilauftrag</p>
                        <h2 className="text-xl font-extrabold text-slate-900 leading-tight">{jobArea.name || 'Gebiet'}</h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {jobArea.distributedDate ? format(parseISO(jobArea.distributedDate), 'EEEE, dd.MM.yyyy', { locale: de }) : ''}
                          {jobArea.status === 'geplant' ? ' · geplant' : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="inline-flex items-center gap-1 text-blue-600"><Home className="w-4 h-4" /><span className="text-3xl font-extrabold leading-none">{jobData.totalHouses}</span></div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Häuser auszutragen</p>
                      </div>
                    </div>

                    {jobMapImage && (
                      <img src={jobMapImage} alt="Gebietskarte" className="w-full rounded-lg border border-slate-200 mb-3" />
                    )}

                    <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                      <div className="bg-slate-100 rounded-lg py-1.5"><div className="text-lg font-bold text-slate-900">{jobData.totalAll}</div><div className="text-[10px] text-slate-500 uppercase font-bold">Adressen gesamt</div></div>
                      <div className="bg-slate-100 rounded-lg py-1.5"><div className="text-lg font-bold text-red-600">{jobData.excludedCount}</div><div className="text-[10px] text-slate-500 uppercase font-bold">Keine Werbung</div></div>
                      <div className="bg-slate-100 rounded-lg py-1.5"><div className="text-lg font-bold text-slate-900">{jobArea.flyerCount || '–'}</div><div className="text-[10px] text-slate-500 uppercase font-bold">Flyer geplant</div></div>
                    </div>

                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Straßen &amp; Hausnummern</p>
                    <div className="space-y-2">
                      {jobData.streets.length === 0 && (
                        <p className="text-sm text-slate-500">Keine Adressen mit Hausnummern in OpenStreetMap gefunden. Bitte Gebiet vor Ort abgehen.</p>
                      )}
                      {jobData.streets.map((s) => (
                        <div key={s.name} className="border border-slate-200 rounded-lg px-3 py-2">
                          <div className="flex items-baseline justify-between">
                            <span className="font-bold text-slate-900">{s.name}</span>
                            <span className="text-[11px] text-slate-500 font-semibold">{s.numbers.length} Häuser</span>
                          </div>
                          {s.numbers.length > 0 && (
                            <p className="text-sm text-slate-800 leading-snug mt-0.5">{s.numbers.join(', ')}</p>
                          )}
                          {s.excluded.length > 0 && (
                            <p className="text-xs text-red-600 mt-1"><span className="font-bold">NICHT (keine Werbung):</span> {s.excluded.join(', ')}</p>
                          )}
                        </div>
                      ))}
                    </div>

                    {jobData.unmatchedExcluded > 0 && (
                      <p className="text-xs text-red-600 mt-2">+ {jobData.unmatchedExcluded} markierte „Keine Werbung"-Häuser ohne zugeordnete Adresse – bitte laut Karte beachten.</p>
                    )}

                    <p className="text-[10px] text-slate-400 mt-3 pt-2 border-t border-slate-200">Adressdaten © OpenStreetMap-Mitwirkende · erstellt am {format(new Date(), 'dd.MM.yyyy')} · Angaben können unvollständig sein.</p>
                  </div>

                  {jobExportError && (
                    <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mt-3">{jobExportError}</p>
                  )}

                  <div className="flex gap-2 mt-3">
                    <Button variant="secondary" className="flex-1" onClick={() => setShowJobModal(false)}>Schließen</Button>
                    <Button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={exportJobPng} disabled={jobExporting}>
                      {jobExporting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Exportiere…</> : <><Download className="w-4 h-4 mr-2" /> Als Bild exportieren</>}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
    </div>
  );
}
