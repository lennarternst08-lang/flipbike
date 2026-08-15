import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  // iOS/Safari zeigt den Standort-Dialog nur zuverlässig nach einer echten
  // Nutzeraktion. Deshalb kein Auto-Abruf beim Laden, sondern ein Knopf.
  const [geoStatus, setGeoStatus] = useState<'idle' | 'requesting' | 'active' | 'denied' | 'unavailable' | 'insecure'>('idle');
  const watchIdRef = useRef<number | null>(null);
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

  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  // Live-Standort – wird bewusst erst auf Tippen gestartet (siehe oben)
  const startWatch = useCallback(() => {
    if (!('geolocation' in navigator)) { setGeoStatus('unavailable'); return; }
    // Immer frisch starten: eine alte (fehlgeschlagene) Abfrage hat sonst jeden
    // weiteren Versuch verschluckt – die Meldung blieb dann für immer stehen.
    stopWatch();
    setGeoStatus('requesting');
    watchIdRef.current = navigator.geolocation.watchPosition(
      (p) => {
        setPos([p.coords.latitude, p.coords.longitude]);
        setAccuracy(p.coords.accuracy ?? null);
        setGeoStatus('active');
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          stopWatch();
          setGeoStatus('denied');
        } else {
          // Kurzzeitige Aussetzer (kein Empfang, Zeitüberschreitung) dürfen eine
          // bereits laufende Ortung nicht zurückstufen.
          setGeoStatus((s) => (s === 'active' ? s : err.code === err.TIMEOUT ? 'requesting' : 'unavailable'));
        }
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
    );
  }, [stopWatch]);

  useEffect(() => {
    // Ohne HTTPS gibt es gar keinen Standort – das sonst als "blockiert" zu
    // melden wäre irreführend.
    if (!window.isSecureContext) { setGeoStatus('insecure'); return; }
    let cancelled = false;
    let status: any = null;

    // Wird die Erlaubnis außerhalb der Seite geändert (iOS-Einstellungen,
    // Safaris "aA"-Menü), muss die Meldung von selbst verschwinden.
    const applyState = () => {
      if (!status || cancelled) return;
      if (status.state === 'granted') startWatch();
      else if (status.state === 'denied') { stopWatch(); setGeoStatus('denied'); }
      else setGeoStatus((s) => (s === 'active' ? s : 'idle'));
    };

    (async () => {
      try {
        status = await (navigator as any).permissions?.query({ name: 'geolocation' });
        if (cancelled || !status) return;
        if (status.state === 'granted') startWatch();     // schon erlaubt → direkt los
        else if (status.state === 'denied') setGeoStatus('denied');
        // 'prompt' → auf den Knopf warten, sonst bleibt der iOS-Dialog aus
        status.addEventListener?.('change', applyState);
      } catch { /* ohne Permissions-API einfach auf den Knopf warten */ }
    })();

    // Rückkehr aus den Einstellungen: Zustand erneut prüfen
    const onVisible = () => { if (document.visibilityState === 'visible') applyState(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      status?.removeEventListener?.('change', applyState);
      document.removeEventListener('visibilitychange', onVisible);
      stopWatch();
    };
  }, [startWatch, stopWatch]);

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
    if (!pos) { startWatch(); return; } // noch kein Standort → hier anfordern
    if (!mapRef.current) return;
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
          {/* Liegt ein Standort vor, zählt der – nie an einer alten Meldung hängenbleiben */}
          {pos ? (
            inside ? (
              <span className="px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold">✓ Du bist im Gebiet</span>
            ) : (
              <span className="px-2 py-1 rounded-full bg-orange-500/15 text-orange-300 border border-orange-500/30 font-semibold">Noch {distance} m bis zum Gebiet</span>
            )
          ) : geoStatus === 'insecure' ? (
            <span className="px-2 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">Standort braucht HTTPS – bitte die https-Adresse öffnen.</span>
          ) : geoStatus === 'unavailable' ? (
            <span className="px-2 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">Standort nicht verfügbar – Ortungsdienste aktiv?</span>
          ) : geoStatus === 'denied' ? (
            <span className="px-2 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">Standort ist für diese Seite blockiert</span>
          ) : (
            <span className="px-2 py-1 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              {geoStatus === 'requesting' ? 'Standort wird gesucht…' : 'Standort noch nicht aktiviert'}
            </span>
          )}
          {accuracy != null && pos && (
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
            className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg border active:scale-95 ${
              follow && pos ? 'bg-blue-600 border-blue-400' : 'bg-slate-900/90 border-slate-700'
            }`}
            aria-label="Auf meinen Standort zentrieren"
          >
            <Crosshair className="w-7 h-7" />
          </button>
        </div>

        {/* Standort freischalten – der Tipp darauf löst den iOS-Dialog aus */}
        {!pos && geoStatus !== 'insecure' && (
          <div className="absolute left-3 right-3 bottom-3 z-[1000]">
            {geoStatus === 'denied' ? (
              <div className="rounded-2xl bg-slate-900/95 border border-amber-500/40 p-3 shadow-xl">
                <p className="text-sm font-semibold text-amber-300">Standort ist blockiert</p>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  <b>iPhone/Safari:</b> oben links auf <b>„aA"</b> tippen → <b>Website-Einstellungen</b> → <b>Standort</b> → <b>Erlauben</b>, dann Seite neu laden.
                  <br />
                  Hilft das nicht: <b>Einstellungen → Safari → Standort → Fragen</b> und <b>Einstellungen → Datenschutz → Ortungsdienste</b> einschalten.
                </p>
                <button onClick={startWatch} className="mt-2 w-full py-2.5 rounded-xl bg-slate-800 border border-slate-600 font-semibold active:bg-slate-700">
                  Erneut versuchen
                </button>
              </div>
            ) : (
              <button
                onClick={startWatch}
                disabled={geoStatus === 'requesting'}
                className="w-full py-3.5 rounded-2xl bg-blue-600 text-white font-bold text-base shadow-xl flex items-center justify-center gap-2 active:bg-blue-700 disabled:opacity-70"
              >
                <Crosshair className="w-5 h-5" />
                {geoStatus === 'requesting' ? 'Standort wird gesucht…' : 'Standort aktivieren'}
              </button>
            )}
          </div>
        )}

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
