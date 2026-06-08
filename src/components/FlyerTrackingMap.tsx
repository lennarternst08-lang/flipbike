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
import { Download, Map as MapIcon, PenTool, XOctagon, Eraser, Undo2, Check, Search, Upload, Pencil, Euro, BarChart3, Ruler } from 'lucide-react';
import html2canvas from 'html2canvas';
import { format, parseISO, subMonths, isSameMonth } from 'date-fns';
import { de } from 'date-fns/locale';
import { DistributedArea, ExcludedHouse, FlyerAreaStatus } from '../types';
import { auth, db } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where } from 'firebase/firestore';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, ChartTooltip, Legend);

type Mode = 'idle' | 'draw' | 'exclude' | 'delete';

const CENTER_LAT = 52.2289;
const CENTER_LNG = 10.5332;
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
  createdAt: d.createdAt,
  userId: d.userId,
});

// Map-Steuerung: fliegt zu einer Zielposition (Adresssuche)
function MapFlyTo({ target }: { target: { lat: number; lng: number; ts: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 17);
  }, [target, map]);
  return null;
}

export function FlyerTrackingMap() {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [areas, setAreas] = useState<DistributedArea[]>([]);
  const [excludedHouses, setExcludedHouses] = useState<ExcludedHouse[]>([]);

  const [mode, setMode] = useState<Mode>('idle');
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const [cursorPos, setCursorPos] = useState<[number, number] | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingAreaId, setEditingAreaId] = useState<string | null>(null);
  const [formCount, setFormCount] = useState('');
  const [formName, setFormName] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formDate, setFormDate] = useState(todayISO());
  const [formStatus, setFormStatus] = useState<FlyerAreaStatus>('erledigt');

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const migratedRef = useRef(false);

  // Auth-Status beobachten
  useEffect(() => onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null)), []);

  // Kosten-Einstellungen laden
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
  }, []);
  useEffect(() => {
    localStorage.setItem('flyerTracking_settings', JSON.stringify({ costPerFlyer, customersWon, marginPerCustomer }));
  }, [costPerFlyer, customersWon, marginPerCustomer]);

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

      return () => { unsubAreas(); unsubHouses(); };
    } else {
      // Offline-Modus
      const savedAreas = localStorage.getItem('flyerTracking_areas');
      const savedHouses = localStorage.getItem('flyerTracking_excluded');
      if (savedAreas) { try { setAreas(JSON.parse(savedAreas)); } catch {} }
      if (savedHouses) { try { setExcludedHouses(JSON.parse(savedHouses)); } catch {} }
    }
  }, [uid]);

  // Offline-Spiegel in localStorage (auch als Backup im Online-Modus)
  useEffect(() => {
    localStorage.setItem('flyerTracking_areas', JSON.stringify(areas));
    localStorage.setItem('flyerTracking_excluded', JSON.stringify(excludedHouses));
  }, [areas, excludedHouses]);

  // Zeichen-Reststände aufräumen
  useEffect(() => {
    if (mode !== 'draw') { setDrawingPoints([]); setCursorPos(null); }
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
    if (uid) deleteDoc(doc(db, 'flyerAreas', id)).catch(console.error);
    setAreas((prev) => prev.filter((a) => a.id !== id));
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
  const MapEvents = () => {
    const map = useMapEvents({
      click: (e) => {
        const { lat, lng } = e.latlng;
        if (mode === 'exclude') {
          addHouse([lat, lng]);
        } else if (mode === 'draw') {
          if (drawingPoints.length > 2) {
            const dist = map.latLngToContainerPoint(e.latlng).distanceTo(map.latLngToContainerPoint(drawingPoints[0] as [number, number]));
            if (dist < 30) { completePolygon(); return; }
          }
          setDrawingPoints([...drawingPoints, [lat, lng]]);
        }
      },
      mousemove: (e) => {
        if (mode === 'draw') {
          if (drawingPoints.length > 2) {
            const dist = map.latLngToContainerPoint(e.latlng).distanceTo(map.latLngToContainerPoint(drawingPoints[0] as [number, number]));
            if (dist < 30) { setCursorPos(drawingPoints[0] as [number, number]); return; }
          }
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
    setShowModal(true);
  };

  const openEditModal = (area: DistributedArea) => {
    setEditingAreaId(area.id);
    setFormCount(area.flyerCount.toString());
    setFormName(area.name || '');
    setFormNote(area.note || '');
    setFormDate(area.distributedDate || todayISO());
    setFormStatus(area.status || 'erledigt');
    setShowModal(true);
  };

  const handleSaveArea = () => {
    const count = parseInt(formCount);
    if (isNaN(count) || count < 0) return;
    if (editingAreaId) {
      const existing = areas.find((a) => a.id === editingAreaId);
      if (!existing) return;
      saveArea({ ...existing, flyerCount: count, name: formName.trim(), note: formNote.trim(), distributedDate: formDate, status: formStatus });
    } else {
      if (drawingPoints.length < 3) return;
      saveArea({
        id: Date.now().toString(),
        points: drawingPoints,
        flyerCount: count,
        name: formName.trim(),
        note: formNote.trim(),
        distributedDate: formDate,
        status: formStatus,
        createdAt: Date.now(),
        userId: uid ?? undefined,
      });
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
    try {
      const canvas = await html2canvas(mapRef.current, { useCORS: true, allowTaint: true });
      const link = document.createElement('a');
      link.download = `flyer-tracking-${todayISO()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (error) {
      console.error('Failed to export map', error);
    } finally {
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
    const header = ['Name', 'Datum', 'Status', 'Flyer', 'Flaeche_m2', 'Dichte_Flyer_pro_ha'];
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
          properties: { kind: 'area', id: a.id, name: a.name, flyerCount: a.flyerCount, distributedDate: a.distributedDate, status: a.status, note: a.note },
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
          </div>
        </CardContent>
      </Card>

      {/* Karte */}
      <div className="relative rounded-lg overflow-hidden border border-slate-700 h-[600px] bg-slate-900 group" ref={mapRef}>
        <MapContainer center={[CENTER_LAT, CENTER_LNG]} zoom={17} style={{ height: '100%', width: '100%', backgroundColor: '#0f172a' }}>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
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
                <Input placeholder="Notiz (optional)" value={formNote} onChange={(e) => setFormNote(e.target.value)} className="bg-slate-800" />
                <div className="flex space-x-2 pt-1">
                  <Button variant="secondary" className="flex-1" onClick={editingAreaId ? closeModal : cancelDrawing}>Abbrechen</Button>
                  <Button variant="default" className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white" onClick={handleSaveArea}>Speichern</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
