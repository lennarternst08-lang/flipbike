import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bike, ChecklistItem, InventoryItem, WorkLog } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { formatCurrency } from '../lib/utils';
import {
  ArrowLeft, Play, Pause, Timer, Search, Plus, Trash2, CheckCircle2, Circle,
  Package, StickyNote, ListChecks, Sparkles, LayoutGrid,
} from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { increment } from 'firebase/firestore';
import {
  ActiveTimer, clearActiveTimer, formatKurz, formatUhr, gesamtSekunden, laeuft,
  readActiveTimer, sitzungSekunden, writeActiveTimer,
} from '../lib/stopwatch';
import { LAGER_LEER_HINWEIS, lagerTeile, neueAusgabe } from '../lib/werkstatt';
import { PUTZEN_COST, PUTZEN_LABEL, hasPutzen, togglePutzen } from '../lib/expenses';

interface WorkshopStopwatchModeProps {
  /** Aktive Werkstatt-Projekte, bereits gefiltert und sortiert. */
  projekte: Bike[];
  inventoryItems: InventoryItem[];
  updateBike: (id: string, updates: Partial<Bike>) => void;
  syncBikeTime: (id: string, elapsedSeconds: number, newWorkLog: WorkLog) => void;
  addLog: (message: string, module: 'tracking' | 'workshop' | 'stopwatch' | 'system') => void;
  /** Zurück in die gewohnte Werkstatt-Ansicht. */
  onClose: () => void;
}

export function WorkshopStopwatchMode({
  projekte, inventoryItems, updateBike, syncBikeTime, addLog, onClose,
}: WorkshopStopwatchModeProps) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [suche, setSuche] = useState('');
  const [timer, setTimer] = useState<ActiveTimer | null>(() => readActiveTimer());
  // Erzwingt den Sekundentakt der Anzeige; die Wahrheit steht in `timer`.
  const [, setTick] = useState(0);

  const laufendesRad = useMemo(
    () => projekte.find(b => laeuft(b, timer)) ?? null,
    [projekte, timer]
  );

  // Nur ticken, solange wirklich eine Uhr läuft – sonst rendert die Übersicht
  // im Leerlauf jede Sekunde neu.
  useEffect(() => {
    if (!laufendesRad) return;
    const id = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [laufendesRad]);

  // Nach dem Entsperren des iPads bzw. Tab-Wechsel kann die Uhr woanders
  // gestartet oder gestoppt worden sein – Stand neu einlesen.
  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === 'visible') {
        setTimer(readActiveTimer());
        setTick(t => t + 1);
      }
    };
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
    };
  }, []);

  /** Uhr anhalten und die gelaufene Zeit als Eintrag im Protokoll sichern. */
  const stoppe = useCallback((bike: Bike) => {
    const aktuell = readActiveTimer();
    const sekunden = sitzungSekunden(bike, aktuell);
    clearActiveTimer();
    setTimer(null);

    // Laufmarkierung am Rad sofort lösen. `laeuft()` fällt ohne localStorage-Eintrag
    // auf `bike.startTime` zurück – angemeldet setzt erst der Firestore-Snapshot das
    // Feld auf null, bis dahin liefe die Karte optisch weiter und zählte hoch.
    updateBike(bike.id, { startTime: null });

    if (sekunden > 0) {
      const eintrag: WorkLog = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        durationSeconds: sekunden,
      };
      syncBikeTime(bike.id, sekunden, eintrag);
      addLog(`Stoppuhr gestoppt für "${bike.name}". Dauer: ${formatKurz(sekunden)}.`, 'stopwatch');
    }
  }, [syncBikeTime, updateBike, addLog]);

  /**
   * Kern des Modus: eine neue Uhr starten hält die laufende automatisch an und
   * sichert deren Zeit. So lässt sich zwischen mehreren Rädern hin und her
   * springen, ohne je an "erst stoppen" denken zu müssen.
   */
  const starte = useCallback((bike: Bike) => {
    const vorher = projekte.find(b => laeuft(b, readActiveTimer()));
    if (vorher && vorher.id !== bike.id) {
      stoppe(vorher);
      addLog(`Automatisch pausiert: "${vorher.name}" (Wechsel auf "${bike.name}").`, 'stopwatch');
    }

    const jetzt = Date.now();
    const neu: ActiveTimer = {
      bikeId: bike.id,
      startTime: jetzt,
      initialTime: bike.timeSpentSeconds || 0,
    };
    writeActiveTimer(neu);
    setTimer(neu);
    updateBike(bike.id, { startTime: jetzt });
    addLog(`Stoppuhr gestartet für "${bike.name}" um ${new Date(jetzt).toLocaleTimeString('de-DE')}.`, 'stopwatch');
  }, [projekte, stoppe, updateBike, addLog]);

  const umschalten = useCallback((bike: Bike) => {
    if (laeuft(bike, timer)) stoppe(bike);
    else starte(bike);
  }, [timer, stoppe, starte]);

  const detailRad = detailId ? projekte.find(b => b.id === detailId) ?? null : null;

  if (detailRad) {
    return (
      <StopwatchDetail
        bike={detailRad}
        timer={timer}
        istAktiv={laeuft(detailRad, timer)}
        inventoryItems={inventoryItems}
        updateBike={updateBike}
        addLog={addLog}
        onToggle={() => umschalten(detailRad)}
        onBack={() => setDetailId(null)}
      />
    );
  }

  const gefiltert = suche.trim()
    ? projekte.filter(b => b.name.toLowerCase().includes(suche.trim().toLowerCase()))
    : projekte;

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex flex-wrap items-center gap-3 bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4">
        <h2 className="text-lg sm:text-xl font-bold text-slate-100 flex items-center gap-2 mr-auto">
          <Timer className="w-5 h-5 sm:w-6 sm:h-6 text-orange-500 shrink-0" />
          Stoppuhr-Modus
          <span className="text-sm font-normal text-slate-500">({projekte.length})</span>
        </h2>
        <div className="relative flex-1 min-w-[140px] sm:flex-none sm:w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            placeholder="Rad suchen..."
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            className="pl-10 h-11 bg-slate-800/60 border-slate-700"
          />
        </div>
        <Button
          variant="outline"
          onClick={onClose}
          className="h-11 border-slate-700 text-slate-300 touch-manipulation"
        >
          <LayoutGrid className="w-4 h-4 sm:mr-2" />
          <span className="hidden sm:inline">Normale Ansicht</span>
        </Button>
      </div>

      {laufendesRad ? (
        <p className="text-xs sm:text-sm text-orange-300/90 px-1">
          <span className="inline-block w-2 h-2 rounded-full bg-orange-500 animate-pulse mr-2 align-middle" />
          „{laufendesRad.name}" läuft. Eine andere Uhr zu starten pausiert dieses Rad automatisch und sichert die Zeit.
        </p>
      ) : (
        <p className="text-xs sm:text-sm text-slate-500 px-1">
          Keine Uhr läuft. Tippe auf ein Rad zum Starten – auf die Karte selbst für Notizen, Checkliste und Material.
        </p>
      )}

      {gefiltert.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-slate-500 border border-dashed border-slate-800 rounded-xl">
          <Timer className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm">{suche ? 'Kein Rad gefunden.' : 'Keine aktiven Projekte.'}</p>
        </div>
      ) : (
        // lg statt xl: das iPad Air im Querformat (1180px) bekommt damit drei
        // Spalten statt zwei und zeigt mehr Uhren ohne Scrollen.
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {gefiltert.map(bike => (
            <StopwatchKachel
              key={bike.id}
              bike={bike}
              timer={timer}
              onToggle={() => umschalten(bike)}
              onOpen={() => setDetailId(bike.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function StopwatchKachel({
  bike, timer, onToggle, onOpen,
}: {
  bike: Bike;
  timer: ActiveTimer | null;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const aktiv = laeuft(bike, timer);
  const gesamt = gesamtSekunden(bike, timer);
  const sitzung = sitzungSekunden(bike, timer);
  const offeneChecks = (bike.checklist || []).filter(c => !c.completed).length;

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className={`group text-left rounded-2xl border p-4 transition-colors cursor-pointer touch-manipulation ${
        aktiv
          ? 'border-orange-500/70 bg-orange-500/10 shadow-lg shadow-orange-900/20'
          : 'border-slate-800 bg-slate-900 hover:border-slate-700 hover:bg-slate-800/60'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className="font-semibold text-slate-100 leading-tight line-clamp-2 break-words">
          {bike.name}
        </span>
        {aktiv && (
          <span className="shrink-0 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-orange-400 bg-orange-500/20 border border-orange-500/40 px-2 py-1 rounded">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" /> läuft
          </span>
        )}
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className={`font-mono tabular-nums leading-none ${
            aktiv ? 'text-3xl sm:text-4xl text-orange-400' : 'text-3xl sm:text-4xl text-slate-300'
          }`}>
            {formatUhr(gesamt)}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            {aktiv && sitzung > 0 && (
              <span className="text-orange-300/80">Sitzung {formatKurz(sitzung)}</span>
            )}
            {offeneChecks > 0 && (
              <span className="flex items-center gap-1">
                <ListChecks className="w-3 h-3" /> {offeneChecks} offen
              </span>
            )}
          </div>
        </div>

        {/* Große Taste: bewusst 64px, damit sie mit Handschuhen am iPad sicher trifft. */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          aria-label={aktiv ? `${bike.name} pausieren` : `${bike.name} starten`}
          className={`shrink-0 w-16 h-16 rounded-full flex items-center justify-center transition-transform active:scale-90 touch-manipulation ${
            aktiv
              ? 'bg-orange-500 text-white shadow-lg shadow-orange-900/40'
              : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-900/30'
          }`}
        >
          {aktiv ? <Pause className="w-7 h-7" fill="currentColor" /> : <Play className="w-7 h-7 ml-1" fill="currentColor" />}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StopwatchDetail({
  bike, timer, istAktiv, inventoryItems, updateBike, addLog, onToggle, onBack,
}: {
  bike: Bike;
  timer: ActiveTimer | null;
  istAktiv: boolean;
  inventoryItems: InventoryItem[];
  updateBike: (id: string, updates: Partial<Bike>) => void;
  addLog: (message: string, module: 'tracking' | 'workshop' | 'stopwatch' | 'system') => void;
  onToggle: () => void;
  onBack: () => void;
}) {
  const [notiz, setNotiz] = useState(bike.notes || '');
  const [neuerCheck, setNeuerCheck] = useState('');
  const [materialSuche, setMaterialSuche] = useState('');
  const [ausgabeText, setAusgabeText] = useState('');
  const [ausgabeBetrag, setAusgabeBetrag] = useState('');
  const notizTimer = useRef<number | null>(null);

  // Rad gewechselt (oder von außen aktualisiert) -> Entwurf neu laden.
  useEffect(() => { setNotiz(bike.notes || ''); }, [bike.id]);

  // Notizen entprellt speichern, damit nicht jeder Tastendruck schreibt.
  const notizAendern = (wert: string) => {
    setNotiz(wert);
    if (notizTimer.current) clearTimeout(notizTimer.current);
    notizTimer.current = window.setTimeout(() => {
      updateBike(bike.id, { notes: wert });
    }, 500);
  };
  useEffect(() => () => {
    if (notizTimer.current) clearTimeout(notizTimer.current);
  }, []);

  const checkHinzufuegen = () => {
    const text = neuerCheck.trim();
    if (!text) return;
    const eintrag: ChecklistItem = {
      id: Math.random().toString(36).substr(2, 9),
      text,
      completed: false,
    };
    updateBike(bike.id, { checklist: [...(bike.checklist || []), eintrag] });
    setNeuerCheck('');
  };

  const checkUmschalten = (id: string) => {
    updateBike(bike.id, {
      checklist: (bike.checklist || []).map(c => (c.id === id ? { ...c, completed: !c.completed } : c)),
    });
  };

  const checkLoeschen = (id: string) => {
    updateBike(bike.id, { checklist: (bike.checklist || []).filter(c => c.id !== id) });
  };

  const teilVerbauen = (item: InventoryItem) => {
    if (item.quantity - 1 < 0) { alert(LAGER_LEER_HINWEIS); return; }
    updateBike(bike.id, {
      expenses: [...bike.expenses, neueAusgabe(item.name, item.pricePerUnit, item.id)],
    });
    updateDoc(doc(db, 'inventoryItems', item.id), { quantity: increment(-1) })
      .catch(e => console.error('Lagerbestand konnte nicht reduziert werden:', e));
    addLog(`Material '${item.name}' verbaut in '${bike.name}'`, 'workshop');
  };

  const ausgabeHinzufuegen = () => {
    const betrag = parseFloat(ausgabeBetrag.replace(',', '.'));
    if (!ausgabeText.trim() || isNaN(betrag)) return;
    updateBike(bike.id, { expenses: [...bike.expenses, neueAusgabe(ausgabeText.trim(), betrag)] });
    setAusgabeText('');
    setAusgabeBetrag('');
  };

  const ausgabeLoeschen = (id: string) => {
    const weg = bike.expenses.find(e => e.id === id);
    if (!weg) return;
    if (weg.sourceInventoryId) {
      updateDoc(doc(db, 'inventoryItems', weg.sourceInventoryId), { quantity: increment(1) })
        .catch(e => console.error('Lagerbestand konnte nicht zurückgelegt werden:', e));
      addLog(`Material '${weg.description}' von '${bike.name}' entfernt und ins Lager zurückgelegt.`, 'workshop');
    }
    updateBike(bike.id, { expenses: bike.expenses.filter(e => e.id !== id) });
  };

  const putzenUmschalten = () => {
    const { expenses, added } = togglePutzen(bike);
    updateBike(bike.id, { expenses });
    addLog(
      added
        ? `Putzen (Nikita) gebucht für "${bike.name}": ${formatCurrency(PUTZEN_COST)}`
        : `Putzen (Nikita) entfernt für "${bike.name}"`,
      'workshop'
    );
  };

  const teile = lagerTeile(inventoryItems, materialSuche);
  const materialSumme = bike.expenses.reduce((s, e) => s + e.amount, 0);
  const offen = (bike.checklist || []).filter(c => !c.completed).length;

  return (
    <div className="animate-in fade-in duration-200 pb-4">
      {/* Kompakte Kopfzeile: klebt oben, damit Uhr und Zurück beim Scrollen
          erreichbar bleiben – am iPad der wichtigste Griff. `top-16` statt `top-0`,
          weil die App-Navigation selbst sticky ist (64px hoch, z-50) und die
          Leiste sonst unsichtbar dahinter parkt. */}
      <div className="sticky top-16 z-30 -mx-4 px-4 md:mx-0 md:px-0 py-2 bg-slate-950/95 backdrop-blur border-b border-slate-800 mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label="Zurück zur Übersicht"
            className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors active:scale-95 touch-manipulation"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-100 truncate leading-tight">{bike.name}</p>
            <p className={`font-mono tabular-nums text-lg leading-tight ${istAktiv ? 'text-orange-400' : 'text-slate-400'}`}>
              {formatUhr(gesamtSekunden(bike, timer))}
              {istAktiv && <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse align-middle" />}
            </p>
          </div>

          <button
            onClick={onToggle}
            aria-label={istAktiv ? 'Pausieren' : 'Starten'}
            className={`shrink-0 w-14 h-14 rounded-full flex items-center justify-center transition-transform active:scale-90 touch-manipulation ${
              istAktiv
                ? 'bg-orange-500 text-white shadow-lg shadow-orange-900/40'
                : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-900/30'
            }`}
          >
            {istAktiv ? <Pause className="w-6 h-6" fill="currentColor" /> : <Play className="w-6 h-6 ml-0.5" fill="currentColor" />}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Checkliste */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2 mb-3">
            <ListChecks className="w-4 h-4 text-orange-500" /> Checkliste
            {offen > 0 && <span className="text-[10px] font-bold text-orange-400 bg-orange-500/20 border border-orange-500/40 px-1.5 py-0.5 rounded">{offen} offen</span>}
          </h3>
          <div className="flex gap-2 mb-3">
            <Input
              value={neuerCheck}
              onChange={(e) => setNeuerCheck(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); checkHinzufuegen(); } }}
              placeholder="Aufgabe... (Enter)"
              className="h-11 bg-slate-800/60 border-slate-700"
            />
            <Button
              onClick={checkHinzufuegen}
              disabled={!neuerCheck.trim()}
              className="h-11 w-11 p-0 shrink-0 touch-manipulation"
              aria-label="Aufgabe hinzufügen"
            >
              <Plus className="w-5 h-5" />
            </Button>
          </div>
          {(bike.checklist || []).length === 0 ? (
            <p className="text-xs text-slate-500 italic">Noch keine Aufgaben.</p>
          ) : (
            <ul className="space-y-1">
              {(bike.checklist || []).map(item => (
                <li key={item.id} className="flex items-center gap-2 group">
                  <button
                    onClick={() => checkUmschalten(item.id)}
                    className="flex-1 flex items-center gap-2.5 text-left py-2.5 px-1 rounded-lg hover:bg-slate-800/60 transition-colors touch-manipulation"
                  >
                    {item.completed
                      ? <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-500" />
                      : <Circle className="w-5 h-5 shrink-0 text-slate-600" />}
                    <span className={`text-sm leading-snug ${item.completed ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                      {item.text}
                    </span>
                  </button>
                  <button
                    onClick={() => checkLoeschen(item.id)}
                    aria-label="Aufgabe löschen"
                    className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 hover:text-red-400 hover:bg-slate-800 transition-colors touch-manipulation"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Notizen */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2 mb-3">
            <StickyNote className="w-4 h-4 text-orange-500" /> Notizen
          </h3>
          <textarea
            value={notiz}
            onChange={(e) => notizAendern(e.target.value)}
            placeholder="Was ist am Rad zu tun, was ist aufgefallen..."
            className="w-full h-40 md:h-[calc(100%-2.5rem)] min-h-[160px] rounded-xl bg-slate-800/60 border border-slate-700 p-3 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-orange-500/60 focus:ring-2 focus:ring-orange-500/30 resize-none"
          />
        </section>

        {/* Material */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 md:col-span-2">
          <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between gap-2 mb-3">
            <span className="flex items-center gap-2">
              <Package className="w-4 h-4 text-orange-500" /> Material
            </span>
            <span className="text-orange-400 normal-case tracking-normal">{formatCurrency(materialSumme)}</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Aus Lager verbauen</p>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <Input
                  value={materialSuche}
                  onChange={(e) => setMaterialSuche(e.target.value)}
                  placeholder="Teil suchen..."
                  className="pl-10 h-11 bg-slate-800/60 border-slate-700"
                />
              </div>
              {teile.length === 0 ? (
                <p className="text-xs text-slate-500 italic">Keine passenden Teile im Lager.</p>
              ) : (
                <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                  {teile.map(item => (
                    <button
                      key={item.id}
                      onClick={() => teilVerbauen(item)}
                      className="w-full flex items-center justify-between gap-2 py-2.5 px-2 rounded-lg text-left hover:bg-slate-800 transition-colors touch-manipulation"
                    >
                      <span className="truncate text-sm text-slate-300">{item.name}</span>
                      <span className="shrink-0 flex items-center gap-2 text-xs">
                        <span className="text-slate-500">{item.quantity}x</span>
                        <span className="font-bold text-emerald-500">{formatCurrency(item.pricePerUnit)}</span>
                        <Plus className="w-4 h-4 text-slate-400" />
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <button
                onClick={putzenUmschalten}
                className={`mt-3 w-full flex items-center justify-between gap-2 py-2.5 px-3 rounded-lg border text-sm transition-colors touch-manipulation ${
                  hasPutzen(bike)
                    ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
                    : 'border-slate-700 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4" /> {PUTZEN_LABEL}
                </span>
                <span className="font-medium">{formatCurrency(PUTZEN_COST)}</span>
              </button>
            </div>

            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Gebucht ({bike.expenses.length})</p>
              <div className="flex gap-2 mb-2">
                <Input
                  value={ausgabeText}
                  onChange={(e) => setAusgabeText(e.target.value)}
                  placeholder="Externe Ausgabe..."
                  className="h-11 bg-slate-800/60 border-slate-700 flex-1"
                />
                <Input
                  value={ausgabeBetrag}
                  onChange={(e) => setAusgabeBetrag(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ausgabeHinzufuegen(); } }}
                  inputMode="decimal"
                  placeholder="€"
                  className="h-11 w-20 shrink-0 bg-slate-800/60 border-slate-700"
                />
                <Button
                  onClick={ausgabeHinzufuegen}
                  disabled={!ausgabeText.trim() || !ausgabeBetrag}
                  className="h-11 w-11 p-0 shrink-0 touch-manipulation"
                  aria-label="Ausgabe hinzufügen"
                >
                  <Plus className="w-5 h-5" />
                </Button>
              </div>
              {bike.expenses.length === 0 ? (
                <p className="text-xs text-slate-500 italic">Noch keine Ausgaben erfasst.</p>
              ) : (
                <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                  {bike.expenses.map(exp => (
                    <div key={exp.id} className="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-slate-800/60">
                      <span className="flex-1 truncate text-sm text-slate-300">{exp.description}</span>
                      <span className="shrink-0 text-sm font-medium text-slate-200">{formatCurrency(exp.amount)}</span>
                      <button
                        onClick={() => ausgabeLoeschen(exp.id)}
                        aria-label="Ausgabe löschen"
                        className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 hover:text-red-400 hover:bg-slate-800 transition-colors touch-manipulation"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
