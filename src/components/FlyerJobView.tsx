import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Polygon, CircleMarker, Circle, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, Plus, Minus, ListChecks, ChevronDown, ChevronUp, MapPin, Check, Navigation } from 'lucide-react';
import { FlyerJob, jobKey, pointInPolygon, distanceToPolygonM } from '../flyerJob';

// Austräger-Ansicht: eigenständige Seite, die NUR den übergebenen Auftrag kennt.
// Kein Firebase, kein Zugriff auf die Geschäftsdaten – der Auftrag kommt aus dem Link.

interface Props { job: FlyerJob }

// Karte auf das Gebiet einpassen (einmalig beim Öffnen)
function FitArea({ points }: { points: [number, number][] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || points.length < 3) return;
    done.current = true;
    map.fitBounds(points, { padding: [24, 24] });
  }, [map, points]);
  return null;
}

// Karten-Steuerung von außen (Zoom-Buttons, "zu mir")
function MapControl({ onReady }: { onReady: (m: any) => void }) {
  const map = useMap();
  useEffect(() => { onReady(map); }, [map, onReady]);
  return null;
}

// Sobald der Austräger selbst schiebt, soll die Karte nicht mehr wegspringen
function StopFollowOnDrag({ onUserMove }: { onUserMove: () => void }) {
  useMapEvents({ dragstart: onUserMove });
  return null;
}

export default function FlyerJobView({ job }: Props) {
  const [pos, setPos] = useState<[number, number] | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [listOpen, setListOpen] = useState(false);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const mapRef = useRef<any>(null);

  const storageKey = useMemo(() => jobKey(job), [job]);

  // Fortschritt liegt nur auf dem Gerät des Austrägers.
  // Gespeichert wird erst nach dem Laden – sonst überschreibt der leere
  // Anfangszustand beim Öffnen den bisherigen Fortschritt.
  const [progressLoaded, setProgressLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setDone(JSON.parse(raw));
    } catch {}
    setProgressLoaded(true);
  }, [storageKey]);
  useEffect(() => {
    if (!progressLoaded) return;
    try { localStorage.setItem(storageKey, JSON.stringify(done)); } catch {}
  }, [done, storageKey, progressLoaded]);

  // Display beim Austragen anlassen (falls der Browser das unterstützt)
  useEffect(() => {
    let lock: any = null;
    const request = async () => {
      try { lock = await (navigator as any).wakeLock?.request('screen'); } catch {}
    };
    request();
    const onVisible = () => { if (document.visibilityState === 'visible') request(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      try { lock?.release?.(); } catch {}
    };
  }, []);

  // Live-Standort
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGeoError('Dieses Gerät liefert keinen Standort.');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPos([p.coords.latitude, p.coords.longitude]);
        setAccuracy(p.coords.accuracy ?? null);
        setGeoError(null);
      },
      (err) => {
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Standort ist blockiert. Bitte im Browser für diese Seite erlauben.'
            : 'Standort konnte nicht ermittelt werden.'
        );
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Mitführen: Karte folgt dem Standort, stark hineingezoomt
  useEffect(() => {
    if (!follow || !pos || !mapRef.current) return;
    const map = mapRef.current;
    map.setView(pos, Math.max(map.getZoom() || 0, 18), { animate: true });
  }, [pos, follow]);

  const inside = pos ? pointInPolygon(pos, job.p) : null;
  const distance = pos && !inside ? Math.round(distanceToPolygonM(pos, job.p)) : null;

  const totalHouses = job.s.reduce((s, st) => s + st.h.length, 0) || job.t || 0;
  const doneCount = Object.values(done).filter(Boolean).length;

  const centerOnMe = () => {
    if (!pos || !mapRef.current) return;
    setFollow(true);
    mapRef.current.setView(pos, Math.max(mapRef.current.getZoom() || 0, 18), { animate: true });
  };
  const zoom = (d: number) => {
    if (!mapRef.current) return;
    mapRef.current.setZoom((mapRef.current.getZoom() || 17) + d);
  };

  return (
    <div className="bg-slate-950 text-slate-100 flex flex-col" style={{ height: '100dvh' }}>
      {/* Kopfzeile */}
      <div className="shrink-0 px-3 pt-3 pb-2 bg-slate-900 border-b border-slate-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Flyer-Auftrag</p>
            <h1 className="text-lg font-extrabold leading-tight truncate">{job.n || 'Gebiet'}</h1>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-extrabold leading-none">{totalHouses}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Häuser</div>
          </div>
        </div>

        {/* Statuszeile: bin ich im Gebiet? */}
        <div className="mt-2 flex items-center gap-2 text-xs">
          {geoError ? (
            <span className="px-2 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">{geoError}</span>
          ) : inside === null ? (
            <span className="px-2 py-1 rounded-full bg-slate-800 text-slate-400 border border-slate-700">Standort wird gesucht…</span>
          ) : inside ? (
            <span className="px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold">✓ Du bist im Gebiet</span>
          ) : (
            <span className="px-2 py-1 rounded-full bg-orange-500/15 text-orange-300 border border-orange-500/30 font-semibold">
              Noch {distance} m bis zum Gebiet
            </span>
          )}
          {accuracy != null && !geoError && (
            <span className="text-slate-500">±{Math.round(accuracy)} m</span>
          )}
        </div>
      </div>

      {/* Karte */}
      <div className="relative flex-1 min-h-0">
        <MapContainer
          center={job.p[0]}
          zoom={17}
          zoomControl={false}
          style={{ height: '100%', width: '100%', backgroundColor: '#0f172a' }}
        >
          <TileLayer
            crossOrigin="anonymous"
            attribution='&copy; OpenStreetMap'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />
          <MapControl onReady={(m) => (mapRef.current = m)} />
          <StopFollowOnDrag onUserMove={() => setFollow(false)} />
          <FitArea points={job.p} />

          {/* Gebiet */}
          <Polygon positions={job.p} pathOptions={{ color: '#10b981', weight: 4, fillColor: '#10b981', fillOpacity: 0.18 }} />

          {/* "Keine Werbung"-Häuser */}
          {job.x.map((p, i) => (
            <CircleMarker key={i} center={p} radius={7} pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#ef4444', fillOpacity: 1 }} />
          ))}

          {/* Eigener Standort */}
          {pos && (
            <>
              {accuracy != null && accuracy > 5 && (
                <Circle center={pos} radius={accuracy} pathOptions={{ color: '#3b82f6', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.12 }} />
              )}
              <CircleMarker center={pos} radius={9} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#3b82f6', fillOpacity: 1 }} />
            </>
          )}
        </MapContainer>

        {/* Bedienelemente – groß genug für den Daumen */}
        <div className="absolute right-3 bottom-3 flex flex-col gap-2 z-[1000]">
          <button onClick={() => zoom(1)} className="w-12 h-12 rounded-full bg-slate-900/90 border border-slate-700 flex items-center justify-center active:bg-slate-800 shadow-lg" aria-label="Hineinzoomen">
            <Plus className="w-6 h-6" />
          </button>
          <button onClick={() => zoom(-1)} className="w-12 h-12 rounded-full bg-slate-900/90 border border-slate-700 flex items-center justify-center active:bg-slate-800 shadow-lg" aria-label="Herauszoomen">
            <Minus className="w-6 h-6" />
          </button>
          <button
            onClick={centerOnMe}
            disabled={!pos}
            className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg border ${
              follow && pos ? 'bg-blue-600 border-blue-400' : 'bg-slate-900/90 border-slate-700'
            } ${!pos ? 'opacity-40' : 'active:scale-95'}`}
            aria-label="Auf meinen Standort zentrieren"
          >
            <Crosshair className="w-7 h-7" />
          </button>
        </div>

        {/* Hinweis, wenn Mitführen aus ist */}
        {!follow && pos && (
          <button onClick={centerOnMe} className="absolute left-1/2 -translate-x-1/2 bottom-4 z-[1000] px-4 py-2 rounded-full bg-blue-600 text-white text-sm font-semibold shadow-lg flex items-center gap-2">
            <Navigation className="w-4 h-4" /> Zurück zu mir
          </button>
        )}
      </div>

      {/* Straßenliste als aufklappbare Leiste */}
      <div className="shrink-0 bg-slate-900 border-t border-slate-800" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <button onClick={() => setListOpen(!listOpen)} className="w-full px-4 py-3 flex items-center justify-between active:bg-slate-800">
          <span className="flex items-center gap-2 font-semibold">
            <ListChecks className="w-5 h-5 text-emerald-400" />
            Straßen ({job.s.length})
          </span>
          <span className="flex items-center gap-2 text-sm text-slate-400">
            {doneCount}/{job.s.length} erledigt
            {listOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
          </span>
        </button>

        {listOpen && (
          <div className="max-h-[45vh] overflow-y-auto px-3 pb-3 space-y-2">
            {job.note && (
              <p className="text-xs text-slate-300 bg-slate-800 rounded-lg px-3 py-2">{job.note}</p>
            )}
            {job.s.length === 0 && (
              <p className="text-sm text-slate-400 px-1 py-2">Keine Straßenliste hinterlegt – bitte nach Karte austragen.</p>
            )}
            {job.s.map((st) => {
              const isDone = !!done[st.n];
              return (
                <div key={st.n} className={`rounded-xl border px-3 py-2 ${isDone ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-800 border-slate-700'}`}>
                  <button onClick={() => setDone((d) => ({ ...d, [st.n]: !d[st.n] }))} className="w-full flex items-center justify-between gap-2 text-left">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 ${isDone ? 'bg-emerald-500 border-emerald-500' : 'border-slate-500'}`}>
                        {isDone && <Check className="w-4 h-4 text-white" />}
                      </span>
                      <span className={`font-bold truncate ${isDone ? 'line-through text-slate-400' : ''}`}>{st.n}</span>
                    </span>
                    <span className="text-xs text-slate-400 shrink-0">{st.h.length} Häuser</span>
                  </button>
                  {st.h.length > 0 && (
                    <p className="text-sm text-slate-200 mt-1 leading-snug pl-8">{st.h.join(', ')}</p>
                  )}
                  {st.x.length > 0 && (
                    <p className="text-xs text-red-400 mt-1 pl-8"><span className="font-bold">NICHT:</span> {st.x.join(', ')}</p>
                  )}
                </div>
              );
            })}
            <p className="text-[10px] text-slate-500 px-1 pt-1 flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Rote Punkte auf der Karte = keine Werbung. Adressen © OpenStreetMap.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
