import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, Marker, Popup, useMapEvents, useMap, Tooltip } from 'react-leaflet';
import { divIcon } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip as ChartTooltip, Legend
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Download, Map as MapIcon, PenTool, XOctagon, Eraser, Undo2, Check, Search, Upload, Pencil, Euro, BarChart3, Ruler, History, Magnet, PlusCircle, Trash2, Clock, ClipboardList, Loader2, Home, X as XIcon, Share2, Link2, Smartphone } from 'lucide-react';
import html2canvas from 'html2canvas';
import { format, parseISO, subMonths, isSameMonth } from 'date-fns';
import { de } from 'date-fns/locale';
import { Bike, DistributedArea, ExcludedHouse, FlyerAreaStatus, FlyerHistoryEntry, FlyerLead, FlyerLeadSource } from '../types';
import { FlyerJob, buildJobUrl } from '../flyerJob';
import { renderAreaMapImage } from '../mapImage';
import { auth, db } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, arrayUnion, arrayRemove } from 'firebase/firestore';
import {
  DEFAULT_PLZ, LEAD_KIND, addressKey, deserializeLead, findExistingLead,
  isExcludedDoc, isLeadDoc, serializeLead, throttledGeocode,
} from '../lib/flyerLeads';

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
// Warten bis alle sichtbaren Kacheln fertig geladen sind (sonst weiße Lücken)
async function waitForTiles(timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tiles = Array.from(document.querySelectorAll<HTMLImageElement>('img.leaflet-tile'));
    if (tiles.length > 0 && tiles.every((t) => t.complete && t.naturalWidth > 0)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}

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

// Roter Punkt für Leads. Bewusst ein divIcon: CircleMarker lässt sich in Leaflet 1.9
// nicht ziehen, und divIcon spart das Nachladen von marker-icon.png (404 im Build).
const leadIcon = divIcon({
  className: '',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -10],
  html: '<div style="width:16px;height:16px;border-radius:50%;background:#e11d48;border:2px solid #fff;box-shadow:0 0 0 1px #881337"></div>',
});

interface FlyerTrackingMapProps {
  addLog?: (message: string, module?: 'tracking' | 'workshop' | 'stopwatch' | 'system', revertAction?: any) => void;
  bikes?: Bike[];
}

export function FlyerTrackingMap({ addLog, bikes = [] }: FlyerTrackingMapProps = {}) {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [areas, setAreas] = useState<DistributedArea[]>([]);
  const [excludedHouses, setExcludedHouses] = useState<ExcludedHouse[]>([]);
  // Leads liegen bewusst NUR hier und in Firestore – nie in localStorage (personenbezogen).
  const [leads, setLeads] = useState<FlyerLead[]>([]);

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

  // --- Leads (Anfragen auf Flyer hin) ---
  const [showLeadModal, setShowLeadModal] = useState(false);
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);
  const [leadStreet, setLeadStreet] = useState('');
  const [leadPlz, setLeadPlz] = useState(DEFAULT_PLZ);
  const [leadName, setLeadName] = useState('');
  const [leadNote, setLeadNote] = useState('');
  const [leadBusy, setLeadBusy] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);
  const [leadHint, setLeadHint] = useState<string | null>(null);
  const [showLeadImport, setShowLeadImport] = useState(false);
  const [leadPasteText, setLeadPasteText] = useState('');
  const [leadImportBusy, setLeadImportBusy] = useState(false);
  const [leadImportInfo, setLeadImportInfo] = useState<string | null>(null);
  const [inboxOffer, setInboxOffer] = useState<any[] | null>(null); // dev-only Eingangskorb

  const mapRef = useRef<HTMLDivElement>(null);
  const mapObjRef = useRef<any>(null);          // Leaflet-Karteninstanz (für fitBounds/Capture)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const leadFileInputRef = useRef<HTMLInputElement>(null); // eigener Ref – nicht mit dem GeoJSON-Import teilen
  const jobCardRef = useRef<HTMLDivElement>(null);
  const migratedRef = useRef(false);
  const housesMigratedRef = useRef(false);      // Legacy-Migration der Häuser nur einmal versuchen
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
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle');
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

      // `flyerHouses` enthält zwei Sorten: "keine Werbung"-Häuser und Leads (kind === 'lead').
      const qHouses = query(collection(db, 'flyerHouses'), where('userId', '==', uid));
      const unsubHouses = onSnapshot(qHouses, (snap) => {
        const raw = snap.docs.map((d) => d.data() as any);
        // Legacy-Migration nur beim allerersten komplett leeren Snapshot. Würde hier auf die
        // *gefilterte* Länge geprüft, kämen gelöschte Häuser zurück, sobald nur noch Leads
        // in der Collection liegen.
        if (!housesMigratedRef.current && snap.empty) {
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
        housesMigratedRef.current = true;
        setExcludedHouses(
          raw.filter(isExcludedDoc).map((d) => ({
            id: d.id, point: [d.lat, d.lng] as [number, number], createdAt: d.createdAt, userId: d.userId,
          }))
        );
        setLeads(raw.filter(isLeadDoc).map(deserializeLead));
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
      setLeads([]); // ohne Login keine Leads – die sind personenbezogen und nur in Firestore
      setHydrated(true);
    }
  }, [uid]);

  // Offline-Spiegel in localStorage (auch als Backup im Online-Modus).
  // Achtung: erst nach der Hydration schreiben – sonst löscht der leere
  // Anfangs-State beim Mounten die gespeicherten Gebiete.
  // WICHTIG: `leads` gehört hier bewusst NICHT hinein. Leads enthalten Namen und
  // Adressen von Kunden; sie bleiben in Firestore, wo die Rules sie an den Account
  // binden. In localStorage wären sie für jeden lesbar, der das Gerät benutzt.
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

  // --- Leads ---
  // Alle Lead-Schreibvorgänge melden Fehler sichtbar. Im Projekt gibt es bereits einen
  // Fall (userTimers), in dem Writes still fehlschlagen – das soll sich nicht wiederholen.
  const leadWriteFailed = (e: unknown) => {
    console.error(e);
    setLeadError('Speichern fehlgeschlagen – bitte erneut versuchen.');
  };

  const addLead = (lead: FlyerLead): FlyerLead | null => {
    if (!uid) { setLeadError('Zum Anlegen von Leads bitte anmelden.'); return null; }
    const full: FlyerLead = { ...lead, userId: uid, createdAt: lead.createdAt ?? Date.now() };
    setDoc(doc(db, 'flyerHouses', full.id), serializeLead(full, uid)).catch(leadWriteFailed);
    setLeads((prev) => [...prev, full]);
    return full;
  };

  const updateLeadPoint = (id: string, lat: number, lng: number) => {
    if (uid) updateDoc(doc(db, 'flyerHouses', id), { lat, lng }).catch(leadWriteFailed);
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, point: [lat, lng] } : l)));
  };

  const updateLeadFields = (id: string, fields: Partial<Pick<FlyerLead, 'address' | 'name' | 'note'>>) => {
    if (uid) updateDoc(doc(db, 'flyerHouses', id), fields).catch(leadWriteFailed);
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...fields } : l)));
  };

  const removeLead = (id: string) => {
    if (uid) deleteDoc(doc(db, 'flyerHouses', id)).catch(leadWriteFailed);
    setLeads((prev) => prev.filter((l) => l.id !== id));
  };

  const linkBikeToLead = (leadId: string, bikeId: string) => {
    if (uid) updateDoc(doc(db, 'flyerHouses', leadId), { bikeIds: arrayUnion(bikeId) }).catch(leadWriteFailed);
    setLeads((prev) => prev.map((l) =>
      l.id === leadId ? { ...l, bikeIds: [...(l.bikeIds ?? []), bikeId].filter((v, i, a) => a.indexOf(v) === i) } : l
    ));
  };

  const unlinkBikeFromLead = (leadId: string, bikeId: string) => {
    if (uid) updateDoc(doc(db, 'flyerHouses', leadId), { bikeIds: arrayRemove(bikeId) }).catch(leadWriteFailed);
    setLeads((prev) => prev.map((l) =>
      l.id === leadId ? { ...l, bikeIds: (l.bikeIds ?? []).filter((b) => b !== bikeId) } : l
    ));
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

  // --- Ausbeute je Gebiet: Leads im Polygon + daraus entstandene Räder ---
  const areaStats = React.useMemo(() => {
    const map: Record<string, { leads: number; bikes: number }> = {};
    areas.forEach((a) => {
      const inside = leads.filter((l) => pointInPolygon(l.point, a.points));
      const bikeIds = new Set<string>();
      inside.forEach((l) => (l.bikeIds ?? []).forEach((b) => bikeIds.add(b)));
      map[a.id] = { leads: inside.length, bikes: bikeIds.size };
    });
    return map;
  }, [areas, leads]);

  const linkedBikesTotal = React.useMemo(() => {
    const s = new Set<string>();
    leads.forEach((l) => (l.bikeIds ?? []).forEach((b) => s.add(b)));
    return s.size;
  }, [leads]);

  // "Flyer pro Lead" / "Flyer pro Rad" – ohne Nenner gibt es keine sinnvolle Zahl.
  const perUnit = (flyerCount: number, n: number) => (n > 0 ? Math.round(flyerCount / n).toString() : '–');

  const bikeById = React.useMemo(() => {
    const m: Record<string, Bike> = {};
    bikes.forEach((b) => { m[b.id] = b; });
    return m;
  }, [bikes]);

  // Vorschläge fürs Verknüpfen: Flyer-Räder aus dem Zeitfenster um den Lead herum,
  // die noch an keinem Lead hängen. Nächstliegendes Kaufdatum zuerst, maximal drei.
  const suggestBikes = (lead: FlyerLead): Bike[] => {
    const linkedAnywhere = new Set<string>();
    leads.forEach((l) => (l.bikeIds ?? []).forEach((b) => linkedAnywhere.add(b)));
    const base = lead.createdAt ?? Date.now();
    const DAY = 86400000;
    return bikes
      .filter((b) => (b.acquisitionSource ?? 'flyer') === 'flyer' && !linkedAnywhere.has(b.id) && b.purchaseDate)
      .map((b) => ({ bike: b, delta: (new Date(b.purchaseDate).getTime() - base) / DAY }))
      .filter(({ delta }) => delta >= -3 && delta <= 30)
      .sort((x, y) => Math.abs(x.delta) - Math.abs(y.delta))
      .slice(0, 3)
      .map(({ bike }) => bike);
  };

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

  // --- Lead-Formular ---
  const openLeadModal = (lead?: FlyerLead) => {
    setLeadError(null);
    setLeadHint(null);
    if (lead) {
      setEditingLeadId(lead.id);
      setLeadStreet(lead.address);
      setLeadPlz(DEFAULT_PLZ);
      setLeadName(lead.name || '');
      setLeadNote(lead.note || '');
    } else {
      setEditingLeadId(null);
      setLeadStreet('');
      setLeadPlz(DEFAULT_PLZ);
      setLeadName('');
      setLeadNote('');
    }
    setShowLeadModal(true);
  };

  const closeLeadModal = () => {
    setShowLeadModal(false);
    setEditingLeadId(null);
    setLeadBusy(false);
    setLeadError(null);
    setLeadHint(null);
  };

  const mapCenter = (): [number, number] => {
    const c = mapObjRef.current?.getCenter?.();
    return c ? [c.lat, c.lng] : [CENTER_LAT, CENTER_LNG];
  };

  const handleSaveLead = async () => {
    const street = leadStreet.trim();
    if (!street) { setLeadError('Bitte eine Adresse eingeben.'); return; }
    setLeadBusy(true);
    setLeadError(null);
    setLeadHint(null);

    // Beim Bearbeiten nur die Felder ändern – der Pin bleibt, wo er hingezogen wurde.
    if (editingLeadId) {
      updateLeadFields(editingLeadId, { address: street, name: leadName.trim(), note: leadNote.trim() });
      setLeadBusy(false);
      closeLeadModal();
      return;
    }

    const dupe = findExistingLead(leads, street);
    if (dupe) {
      setLeadBusy(false);
      setLeadError(`Zu dieser Adresse gibt es schon einen Lead${dupe.name ? ` (${dupe.name})` : ''}.`);
      return;
    }

    let point: [number, number] | null = null;
    try {
      const hit = await throttledGeocode(street, leadPlz);
      if (hit) point = [hit.lat, hit.lng];
    } catch { /* Netzfehler → Fallback unten */ }

    const created = addLead({
      id: `lead_${Date.now()}`,
      point: point ?? mapCenter(),
      address: street,
      name: leadName.trim(),
      note: leadNote.trim(),
      source: 'manual',
    });
    setLeadBusy(false);
    if (!created) return;

    if (point) {
      setFlyTarget({ lat: point[0], lng: point[1], ts: Date.now() });
      closeLeadModal();
    } else {
      // Kein Geocoding-Treffer: Lead existiert, muss aber von Hand platziert werden.
      setLeadHint('Adresse nicht gefunden – der Pin liegt in der Kartenmitte. Bitte an die richtige Stelle ziehen.');
      setTimeout(closeLeadModal, 2500);
    }
  };

  // --- Lead-Import (Datei, Einfügen und dev-Eingangskorb nutzen alle diesen Weg) ---
  const importLeads = async (
    items: any[],
    defaultSource: FlyerLeadSource = 'manual'
  ): Promise<{ added: number; skipped: number; invalid: number; noCoords: number }> => {
    let added = 0, skipped = 0, invalid = 0, noCoords = 0;
    // Gegen den lokalen Stand *und* gegen die in diesem Lauf neu angelegten prüfen.
    const seen: FlyerLead[] = [...leads];
    for (const item of items) {
      const address = String(item?.address ?? item?.adresse ?? '').trim();
      if (!address) { invalid++; continue; }
      if (findExistingLead(seen, address, null)) { skipped++; continue; }

      let point: [number, number] | null =
        typeof item?.lat === 'number' && typeof item?.lng === 'number' ? [item.lat, item.lng] : null;
      if (!point) {
        try {
          const hit = await throttledGeocode(address, String(item?.plz ?? DEFAULT_PLZ));
          if (hit) point = [hit.lat, hit.lng];
        } catch { /* unten als "ohne Koordinate" behandelt */ }
      }
      // Dubletten, die nur über die Koordinate auffallen (andere Schreibweise der Adresse).
      if (point && seen.some((l) => haversineM(l.point, point!) < 25)) { skipped++; continue; }

      const lead: FlyerLead = {
        id: `lead_${Date.now()}_${Math.round(Math.random() * 1e6)}`,
        point: point ?? mapCenter(),
        address,
        name: String(item?.name ?? '').trim(),
        note: String(item?.note ?? item?.notiz ?? '').trim(),
        source: (item?.source as FlyerLeadSource) || defaultSource,
        createdAt: typeof item?.createdAt === 'number' ? item.createdAt : Date.now(),
      };
      const created = addLead(lead);
      if (!created) { invalid++; continue; }
      seen.push(created);
      added++;
      if (!point) noCoords++; // angelegt, liegt aber vorerst in der Kartenmitte
    }
    return { added, skipped, invalid, noCoords };
  };

  const runLeadImport = async (items: any[], source: FlyerLeadSource) => {
    setLeadImportBusy(true);
    setLeadImportInfo('Adressen werden gesucht … (ca. 1 Sekunde pro Adresse)');
    try {
      const { added, skipped, invalid, noCoords } = await importLeads(items, source);
      const parts = [`${added} übernommen`];
      if (skipped) parts.push(`${skipped} schon vorhanden`);
      if (noCoords) parts.push(`${noCoords} ohne Koordinate – Pin bitte setzen`);
      if (invalid) parts.push(`${invalid} ohne Adresse übersprungen`);
      setLeadImportInfo(parts.join(', ') + '.');
    } catch (e) {
      console.error(e);
      setLeadImportInfo('Import fehlgeschlagen.');
    } finally {
      setLeadImportBusy(false);
    }
  };

  const parseLeadPayload = (raw: string): any[] => {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed?.leads;
    if (!Array.isArray(list)) throw new Error('Erwartet wird eine Liste oder { "leads": [...] }.');
    return list;
  };

  const handleImportLeadsFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await runLeadImport(parseLeadPayload(reader.result as string), 'whatsapp');
      } catch (err: any) {
        setLeadImportInfo(`Datei nicht lesbar: ${err?.message || err}`);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // gleiche Datei soll erneut wählbar sein
  };

  const handleImportLeadsPaste = async () => {
    try {
      await runLeadImport(parseLeadPayload(leadPasteText), 'whatsapp');
      setLeadPasteText('');
    } catch (err: any) {
      setLeadImportInfo(`Eingabe nicht lesbar: ${err?.message || err}`);
    }
  };

  // Dev-Eingangskorb: Der WhatsApp-Scan-Job schreibt leads-inbox.json in den Projektstamm,
  // ein Vite-Middleware-Plugin liefert sie unter /__leads-inbox aus. `import.meta.env.DEV`
  // sorgt dafür, dass dieser Zweig im Production-Build gar nicht erst existiert – die
  // veröffentlichte Seite auf GitHub Pages fragt also nie nach Leads.
  useEffect(() => {
    if (!import.meta.env.DEV || !uid) return;
    let cancelled = false;
    fetch('/__leads-inbox')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        const list = Array.isArray(j) ? j : j.leads;
        if (!Array.isArray(list) || list.length === 0) return;
        const fresh = list.filter((it: any) => !findExistingLead(leads, String(it?.address ?? '')));
        if (fresh.length > 0) setInboxOffer(fresh);
      })
      .catch(() => { /* Datei fehlt oder Job lief nie – kein Fehlerfall */ });
    return () => { cancelled = true; };
  }, [uid, leads.length]);

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
    const header = ['Name', 'Datum', 'Status', 'Flyer', 'Flaeche_m2', 'Dichte_Flyer_pro_ha', 'Dauer_min', 'Kosten_EUR', 'Leads', 'Raeder', 'Flyer_pro_Lead', 'Flyer_pro_Rad'];
    const rows = areas.map((a) => {
      const m2 = polygonAreaM2(a.points);
      const dens = m2 > 0 ? a.flyerCount / (m2 / 10000) : 0;
      const s = areaStats[a.id] || { leads: 0, bikes: 0 };
      return [
        `"${(a.name || '').replace(/"/g, '""')}"`,
        a.distributedDate || '',
        a.status || '',
        a.flyerCount,
        Math.round(m2),
        Math.round(dens),
        a.durationMinutes || 0,
        (a.costEuro || 0).toFixed(2),
        s.leads,
        s.bikes,
        perUnit(a.flyerCount, s.leads),
        perUnit(a.flyerCount, s.bikes),
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
        // Achtung: enthält Namen und Adressen – die Datei nicht weitergeben.
        ...leads.map((l) => ({
          type: 'Feature',
          properties: { kind: LEAD_KIND, id: l.id, address: l.address, name: l.name, note: l.note, source: l.source, bikeIds: l.bikeIds ?? [], createdAt: l.createdAt },
          geometry: { type: 'Point', coordinates: [l.point[1], l.point[0]] },
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
        let importedLeads = 0;
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
            // Ohne diese Verzweigung würden exportierte Leads beim Reimport
            // zu "keine Werbung"-Häusern degradieren.
            if (f.properties?.kind === LEAD_KIND) {
              addLead({
                id: f.properties?.id || `lead_${Date.now()}_${importedLeads}`,
                point: [lat, lng],
                address: f.properties?.address || '',
                name: f.properties?.name || '',
                note: f.properties?.note || '',
                source: f.properties?.source || 'manual',
                bikeIds: Array.isArray(f.properties?.bikeIds) ? f.properties.bikeIds : [],
                createdAt: f.properties?.createdAt || Date.now(),
              });
              importedLeads++;
            } else {
              addHouse([lat, lng]);
              importedHouses++;
            }
          }
        });
        alert(`Import: ${importedAreas} Gebiete, ${importedHouses} Häuser, ${importedLeads} Leads.`);
      } catch (err) {
        alert('Import fehlgeschlagen: ' + (err as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // --- Flyer-Auftrag (Job-Order) für den Austräger ---
  // Kartenbild wird berechnet, nicht von der Live-Karte abfotografiert:
  // so liegt das Gebiet garantiert vollständig und mittig im Bild und die
  // Karte des Nutzers springt nicht herum.
  const captureAreaMap = async (area: DistributedArea): Promise<string | null> => {
    try {
      const inside = excludedHouses.filter((h) => pointInPolygon(h.point, area.points)).map((h) => h.point);
      return await renderAreaMapImage(area.points, inside);
    } catch (e) {
      console.error('Kartenbild fehlgeschlagen', e);
      return null;
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

  // Link für den Austräger: der Auftrag wird komplett in die URL kodiert,
  // damit der Austräger keinen Zugang zu den übrigen Daten braucht.
  const buildShareLink = async (): Promise<string | null> => {
    if (!jobArea || !jobData) return null;
    const job: FlyerJob = {
      v: 1,
      n: jobArea.name || 'Gebiet',
      d: jobArea.distributedDate || null,
      f: jobArea.flyerCount || 0,
      t: jobData.totalHouses,
      note: jobArea.note || undefined,
      p: jobArea.points,
      x: excludedHouses.filter((h) => pointInPolygon(h.point, jobArea.points)).map((h) => h.point),
      s: jobData.streets.map((s) => ({ n: s.name, h: s.numbers, x: s.excluded })),
    };
    return await buildJobUrl(job);
  };

  const shareJobLink = async () => {
    const url = await buildShareLink();
    if (!url) return;
    setShareState('idle');
    try {
      if (navigator.share) {
        await navigator.share({ title: `Flyer-Auftrag: ${jobArea?.name || 'Gebiet'}`, text: 'Hier ist dein Flyer-Auftrag mit Karte und Live-Standort:', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareState('copied');
      setTimeout(() => setShareState('idle'), 2500);
    } catch (e: any) {
      if (e?.name === 'AbortError') return; // Teilen-Dialog abgebrochen
      try {
        await navigator.clipboard.writeText(url);
        setShareState('copied');
        setTimeout(() => setShareState('idle'), 2500);
      } catch {
        setShareState('failed');
      }
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
      <div className={`grid grid-cols-2 ${uid ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-3`}>
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
        {uid && (
          <Card className="border-rose-500/30 bg-rose-500/5">
            <CardContent className="p-3 text-center">
              <p className="text-[10px] text-rose-400/70 font-bold uppercase tracking-wider">Leads</p>
              <h3 className="text-2xl font-bold text-rose-400 mt-1">{leads.length}<span className="text-xs text-slate-500"> · {linkedBikesTotal} Räder</span></h3>
            </CardContent>
          </Card>
        )}
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
            <Button
              variant="secondary"
              onClick={() => openLeadModal()}
              disabled={!uid}
              title={uid ? 'Eine Anfrage als Punkt auf der Karte eintragen' : 'Anmeldung erforderlich'}
              className={uid ? 'bg-rose-600 hover:bg-rose-700 text-white' : ''}
            >
              <PlusCircle className="w-4 h-4 mr-2" /> Lead hinzufügen
            </Button>
            <div className="flex items-center gap-2 ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setLeadImportInfo(null); setShowLeadImport(true); }}
                disabled={!uid}
                title={uid ? 'Leads aus einer JSON-Datei oder per Einfügen übernehmen' : 'Anmeldung erforderlich'}
                className="border-slate-700"
              >
                <Upload className="w-4 h-4 mr-1" /> Leads
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportPng} className="border-slate-700"><Download className="w-4 h-4 mr-1" /> PNG</Button>
              <Button variant="outline" size="sm" onClick={handleExportCsv} className="border-slate-700"><Download className="w-4 h-4 mr-1" /> CSV</Button>
              <Button variant="outline" size="sm" onClick={handleExportGeoJson} title="Enthält auch Leads mit Namen und Adressen – Datei nicht weitergeben." className="border-slate-700"><Download className="w-4 h-4 mr-1" /> GeoJSON</Button>
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="border-slate-700"><Upload className="w-4 h-4 mr-1" /> Import</Button>
              <input ref={fileInputRef} type="file" accept=".geojson,application/geo+json,application/json" onChange={handleImportGeoJson} className="hidden" />
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm font-medium text-slate-400">
            <span className="flex items-center"><div className="w-3 h-3 bg-emerald-500/40 border border-emerald-500 mr-2 rounded-sm" /> Verteilt (erledigt)</span>
            <span className="flex items-center"><div className="w-3 h-3 bg-blue-500/40 border border-blue-500 mr-2 rounded-sm" /> Geplant</span>
            <span className="flex items-center"><div className="w-3 h-3 bg-red-500 rounded-full mr-2" /> Keine Werbung</span>
            {uid && <span className="flex items-center"><div className="w-3 h-3 bg-rose-600 border-2 border-white rounded-full mr-2" /> Lead (Anfrage)</span>}
            {mode === 'idle' && <span className="text-xs text-slate-500">Tipp: Gebiet anklicken zum Bearbeiten · Lead-Pin ziehen zum Korrigieren</span>}
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
                    {uid && (
                      <>
                        {(areaStats[area.id]?.leads ?? 0)} Leads · {(areaStats[area.id]?.bikes ?? 0)} Räder
                        {' · '}{perUnit(area.flyerCount, areaStats[area.id]?.leads ?? 0)} Flyer/Lead<br />
                      </>
                    )}
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

          {/* Leads – nur für den angemeldeten Nutzer. Ziehbar, solange nicht gezeichnet wird. */}
          {uid && leads.map((lead) => {
            const linked = (lead.bikeIds ?? []).map((id) => bikeById[id]).filter(Boolean);
            const suggestions = suggestBikes(lead);
            return (
              <Marker
                key={lead.id}
                position={lead.point}
                icon={leadIcon}
                draggable={mode === 'idle'}
                eventHandlers={{
                  dragend: (e: any) => {
                    const p = e.target.getLatLng();
                    updateLeadPoint(lead.id, p.lat, p.lng);
                  },
                }}
              >
                <Popup>
                  <div className="text-xs space-y-2 min-w-[190px]">
                    <div>
                      <strong className="text-sm">{lead.name || 'Lead'}</strong><br />
                      <span className="text-slate-600">{lead.address}</span>
                      {lead.note && <><br /><span className="text-slate-500 italic">{lead.note}</span></>}
                    </div>

                    <div>
                      <div className="font-semibold text-slate-700">Räder ({linked.length})</div>
                      {linked.length === 0 && <div className="text-slate-500">noch keins verknüpft</div>}
                      {linked.map((b) => (
                        <div key={b.id} className="flex items-center justify-between gap-2">
                          <span className="truncate">{b.name}</span>
                          <button type="button" onClick={() => unlinkBikeFromLead(lead.id, b.id)} className="text-red-600 hover:underline shrink-0">lösen</button>
                        </div>
                      ))}
                    </div>

                    {suggestions.length > 0 && (
                      <div>
                        <div className="font-semibold text-slate-700">Vorschläge</div>
                        {suggestions.map((b) => (
                          <div key={b.id} className="flex items-center justify-between gap-2">
                            <span className="truncate">{b.name} <span className="text-slate-400">({b.purchaseDate})</span></span>
                            <button type="button" onClick={() => linkBikeToLead(lead.id, b.id)} className="text-emerald-700 font-semibold hover:underline shrink-0">+</button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-3 pt-1 border-t border-slate-200">
                      <button type="button" onClick={() => openLeadModal(lead)} className="text-blue-600 hover:underline">Bearbeiten</button>
                      <button
                        type="button"
                        onClick={() => { if (confirm(`Lead "${lead.name || lead.address}" löschen?`)) removeLead(lead.id); }}
                        className="text-red-600 hover:underline"
                      >
                        Löschen
                      </button>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
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

                {/* Was das Gebiet gebracht hat */}
                {uid && editingAreaId && (() => {
                  const a = areas.find((x) => x.id === editingAreaId);
                  const s = areaStats[editingAreaId] || { leads: 0, bikes: 0 };
                  const flyer = a ? a.flyerCount : parseInt(formCount) || 0;
                  return (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-rose-400/80 mb-2">Ausbeute</p>
                      <div className="grid grid-cols-4 gap-2 text-center">
                        <div><div className="text-lg font-bold text-rose-400">{s.leads}</div><div className="text-[10px] text-slate-400 uppercase font-bold">Leads</div></div>
                        <div><div className="text-lg font-bold text-emerald-400">{s.bikes}</div><div className="text-[10px] text-slate-400 uppercase font-bold">Räder</div></div>
                        <div><div className="text-lg font-bold text-slate-200">{perUnit(flyer, s.leads)}</div><div className="text-[10px] text-slate-400 uppercase font-bold">Flyer/Lead</div></div>
                        <div><div className="text-lg font-bold text-slate-200">{perUnit(flyer, s.bikes)}</div><div className="text-[10px] text-slate-400 uppercase font-bold">Flyer/Rad</div></div>
                      </div>
                    </div>
                  );
                })()}
                <div className="flex space-x-2 pt-1">
                  <Button variant="secondary" className="flex-1" onClick={editingAreaId ? closeModal : cancelDrawing}>Abbrechen</Button>
                  <Button variant="default" className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white" onClick={handleSaveArea}>Speichern</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

      </div>

      {/* Lead anlegen / bearbeiten */}
      {showLeadModal && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[2000] flex items-center justify-center p-3">
          <Card className="w-full max-w-sm border-slate-700 bg-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">{editingLeadId ? 'Lead bearbeiten' : 'Lead hinzufügen'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="text-xs text-slate-400 flex flex-col gap-1">Adresse (Straße &amp; Hausnummer)
                <Input
                  autoFocus
                  value={leadStreet}
                  onChange={(e) => setLeadStreet(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !leadBusy) handleSaveLead(); }}
                  placeholder="Musterweg 12"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-slate-400 flex flex-col gap-1">PLZ
                  <Input value={leadPlz} onChange={(e) => setLeadPlz(e.target.value)} disabled={!!editingLeadId} />
                </label>
                <label className="text-xs text-slate-400 flex flex-col gap-1">Name (optional)
                  <Input value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder="Vorname" />
                </label>
              </div>
              <label className="text-xs text-slate-400 flex flex-col gap-1">Notiz (optional)
                <Input value={leadNote} onChange={(e) => setLeadNote(e.target.value)} placeholder="z. B. Preis, Klingelschild" />
              </label>

              {editingLeadId && <p className="text-xs text-slate-500">Die Position änderst du, indem du den Pin auf der Karte verschiebst.</p>}
              {leadError && <p className="text-xs text-red-400">{leadError}</p>}
              {leadHint && <p className="text-xs text-amber-400">{leadHint}</p>}

              <div className="flex space-x-2 pt-1">
                <Button variant="secondary" className="flex-1" onClick={closeLeadModal}>Abbrechen</Button>
                <Button className="flex-1 bg-rose-600 hover:bg-rose-700 text-white" onClick={handleSaveLead} disabled={leadBusy}>
                  {leadBusy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Suche…</> : 'Speichern'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Leads importieren – Datei oder Einfügen */}
      {showLeadImport && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[2000] flex items-center justify-center p-3">
          <Card className="w-full max-w-md border-slate-700 bg-slate-800">
            <CardHeader className="pb-3"><CardTitle className="text-lg">Leads importieren</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-400">
                Erwartet wird <code className="text-slate-300">{'{ "leads": [ { "address": "…", "name": "…" } ] }'}</code> oder direkt eine Liste.
                Fehlende Koordinaten werden gesucht (ca. 1 Sekunde pro Adresse). Bereits vorhandene Adressen werden übersprungen.
              </p>
              <Button variant="outline" size="sm" onClick={() => leadFileInputRef.current?.click()} disabled={leadImportBusy} className="border-slate-700 w-full">
                <Upload className="w-4 h-4 mr-1" /> JSON-Datei wählen
              </Button>
              <input ref={leadFileInputRef} type="file" accept=".json,application/json" onChange={handleImportLeadsFile} className="hidden" />
              <textarea
                value={leadPasteText}
                onChange={(e) => setLeadPasteText(e.target.value)}
                placeholder='[{"address":"Musterweg 12","name":"Vorname"}]'
                rows={5}
                className="w-full rounded-md bg-slate-900 border border-slate-700 p-2 text-xs text-slate-200 font-mono"
              />
              <Button
                size="sm"
                onClick={handleImportLeadsPaste}
                disabled={leadImportBusy || !leadPasteText.trim()}
                className="w-full bg-rose-600 hover:bg-rose-700 text-white"
              >
                {leadImportBusy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Import läuft…</> : 'Eingefügte Leads übernehmen'}
              </Button>
              {leadImportInfo && <p className="text-xs text-slate-300">{leadImportInfo}</p>}
              <Button variant="secondary" className="w-full" onClick={() => { setShowLeadImport(false); setLeadImportInfo(null); }} disabled={leadImportBusy}>Schließen</Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Eingangskorb aus dem WhatsApp-Scan (nur im lokalen Dev-Betrieb erreichbar) */}
      {inboxOffer && inboxOffer.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[2000] w-80">
          <Card className="border-rose-500/40 bg-slate-800 shadow-2xl">
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-bold text-white">{inboxOffer.length} neue Leads aus WhatsApp</p>
              <ul className="text-xs text-slate-400 space-y-0.5 max-h-32 overflow-y-auto">
                {inboxOffer.map((l, i) => <li key={i}>· {l.name ? `${l.name} – ` : ''}{l.address}</li>)}
              </ul>
              {leadImportInfo && <p className="text-xs text-slate-300">{leadImportInfo}</p>}
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" className="flex-1" onClick={() => setInboxOffer(null)} disabled={leadImportBusy}>Später</Button>
                <Button
                  size="sm"
                  className="flex-1 bg-rose-600 hover:bg-rose-700 text-white"
                  disabled={leadImportBusy}
                  onClick={async () => { await runLeadImport(inboxOffer, 'whatsapp'); setInboxOffer(null); }}
                >
                  {leadImportBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Übernehmen'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

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

                  {/* Live-Link: Karte mit Standort auf dem Handy des Austrägers */}
                  <div className="mt-3 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3">
                    <div className="flex items-start gap-2">
                      <Smartphone className="w-5 h-5 text-blue-300 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-blue-200">Live-Karte für den Austräger</p>
                        <p className="text-xs text-slate-300 mt-0.5">
                          Handy-Seite mit eingezeichnetem Gebiet und eigenem Standort. Enthält nur diesen Auftrag – keine weiteren Daten.
                        </p>
                      </div>
                    </div>
                    <Button onClick={shareJobLink} className="w-full mt-2 bg-blue-600 hover:bg-blue-700 text-white">
                      {shareState === 'copied'
                        ? <><Check className="w-4 h-4 mr-2" /> Link kopiert</>
                        : shareState === 'failed'
                        ? <><Link2 className="w-4 h-4 mr-2" /> Kopieren fehlgeschlagen</>
                        : <><Share2 className="w-4 h-4 mr-2" /> Link zum Verschicken</>}
                    </Button>
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
