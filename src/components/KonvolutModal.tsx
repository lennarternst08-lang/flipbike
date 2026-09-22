import React, { useMemo, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { formatCurrency } from '../lib/utils';
import { Boxes, Plus, X, Clock, Megaphone, Monitor, AlertTriangle, Undo2, Timer } from 'lucide-react';
import {
  KonvolutDraft, KonvolutDraftBike, KonvolutEditDraft, KonvolutEditZeile, KonvolutGruppe,
  abholSekunden, konvolutVorschau, planKonvolutUpdate, splitPreis, splitSekunden,
} from '../lib/konvolut';
import { DEFAULT_PLZ } from '../lib/flyerLeads';
import { Akquise, AkquiseAuswahl } from './AkquiseQuelle';

interface KonvolutModalProps {
  /** Vorgeschlagener Name, z.B. "Konvolut #3" – nur beim Anlegen. */
  defaultName?: string;
  /** Gesetzt = bestehendes Konvolut bearbeiten, sonst neu anlegen. */
  gruppe?: KonvolutGruppe;
  /** Anlegen: liefert zusätzlich die Abholadresse, kennt keinen Fehlerpfad. */
  onSave?: (draft: KonvolutDraft, adresse: { strasse: string; plz: string }) => void;
  /** Bearbeiten: gibt Fehler zurück, dann bleibt der Dialog offen und zeigt sie an. */
  onSaveEdit?: (entwurf: KonvolutEditDraft) => string[] | void;
  onClose: () => void;
}

// Eine Dialogzeile. Bei neuen Zeilen ist `id` später auch die ID des Rades –
// siehe KonvolutEditZeile.neuId.
interface Zeile extends KonvolutDraftBike {
  bikeId?: string;
}

const zufallsId = () => Math.random().toString(36).slice(2, 11);
const neueZeile = (): Zeile => ({ id: zufallsId(), name: '' });

export function KonvolutModal({ defaultName = '', gruppe, onSave, onSaveEdit, onClose }: KonvolutModalProps) {
  const bearbeiten = !!gruppe;
  const kId = gruppe?.info.id ?? '';

  // Vorbelegung beim Bearbeiten – die Asymmetrie ist Absicht:
  // Preis = Summe der vorhandenen Einkaufspreise, weil er zur Kopfzeile passen muss.
  // Sonst bläst "öffnen, sofort speichern" den Anteil eines außerhalb gelöschten
  // Rades wieder auf. Abholdauer = erfasster Wert, NICHT die Summe der Abhol-Einträge:
  // die schrumpft, wenn in der Werkstatt ein Eintrag zerstört wurde, und wiederholtes
  // Speichern würde die Zeit immer weiter verkleinern.
  const erfassterPreis = gruppe?.info.totalPrice ?? 0;
  const vorhandenerPreis = gruppe
    ? Math.round(gruppe.bikes.reduce((s, b) => s + b.purchasePrice, 0) * 100) / 100
    : 0;
  const gebuchteAbholMin = gruppe
    ? Math.round(gruppe.bikes.reduce((s, b) => s + abholSekunden(b, kId), 0) / 60)
    : 0;

  const [name, setName] = useState(gruppe?.info.name ?? defaultName);
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [totalPrice, setTotalPrice] = useState(gruppe ? vorhandenerPreis : 0);
  const [pickupMinutes, setPickupMinutes] = useState(gruppe?.info.pickupMinutes ?? 0);
  const [quelle, setQuelle] = useState<Akquise>({ source: 'flyer', note: '' });
  const [strasse, setStrasse] = useState('');
  const [plz, setPlz] = useState(DEFAULT_PLZ);
  const [fehler, setFehler] = useState<string[]>([]);

  const [bikes, setBikesRoh] = useState<Zeile[]>(() =>
    gruppe ? gruppe.bikes.map(b => ({ id: b.id, bikeId: b.id, name: b.name })) : [neueZeile()]
  );
  // Im Bearbeiten-Modus entfernte Zeilen: bleiben bis zum Speichern durchgestrichen
  // sichtbar und lassen sich zurückholen – statt einer Rückfrage.
  const [entfernt, setEntfernt] = useState<Zeile[]>([]);

  // Jede Änderung verwirft die Fehlerliste – sie gehört zum letzten Speicherversuch.
  const setBikes = (f: (prev: Zeile[]) => Zeile[]) => { setFehler([]); setBikesRoh(f); };
  const mitFehlerReset = <T,>(setter: (v: T) => void) => (v: T) => { setFehler([]); setter(v); };

  // Das zuletzt angelegte Feld bekommt den Fokus, damit Enter → tippen → Enter
  // ohne Maus durchläuft.
  const fokusRef = useRef<string | null>(null);

  const gueltige = bikes.filter(b => b.name.trim().length > 0 || b.bikeId);
  const anzahl = gueltige.length;

  // --- Bearbeiten: dieselbe Plan-Funktion wie beim Speichern → Vorschau = Ergebnis ---
  const entwurf: KonvolutEditDraft | null = bearbeiten
    ? {
        name,
        totalPrice,
        pickupMinutes,
        zeilen: bikes.map<KonvolutEditZeile>(z =>
          z.bikeId ? { bikeId: z.bikeId, name: z.name } : { neuId: z.id, name: z.name }
        ),
      }
    : null;
  const plan = useMemo(
    () => (gruppe && entwurf ? planKonvolutUpdate(gruppe.bikes, entwurf) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gruppe, name, totalPrice, pickupMinutes, bikes]
  );
  const verteilungNachId = useMemo(
    () => new Map((plan?.verteilung ?? []).map(v => [v.id, v])),
    [plan]
  );

  // --- Anlegen: die bisherige Vorschau ---
  const { preisProRad, minutenProRad } = useMemo(
    () => konvolutVorschau(totalPrice, pickupMinutes, anzahl),
    [totalPrice, pickupMinutes, anzahl]
  );
  const preise = useMemo(() => splitPreis(totalPrice, anzahl), [totalPrice, anzahl]);
  const sekunden = useMemo(() => splitSekunden(pickupMinutes * 60, anzahl), [pickupMinutes, anzahl]);

  const aendere = (id: string, wert: string) =>
    setBikes(prev => prev.map(b => (b.id === id ? { ...b, name: wert } : b)));

  const entferne = (id: string) => {
    const zeile = bikes.find(b => b.id === id);
    // Bestehende Räder im Bearbeiten-Modus: ohne Rückfrage raus, aber zurückholbar.
    if (bearbeiten && zeile?.bikeId) setEntfernt(prev => [...prev, zeile]);
    setBikes(prev => {
      const rest = prev.filter(b => b.id !== id);
      return rest.length === 0 && !bearbeiten ? [neueZeile()] : rest;
    });
  };

  const zurueckholen = (id: string) => {
    const zeile = entfernt.find(z => z.id === id);
    if (!zeile) return;
    setEntfernt(prev => prev.filter(z => z.id !== id));
    setBikes(prev => [...prev, zeile]);
  };

  // Eine leere Zeile unten anhängen – oder, wenn schon eine leer ist, dorthin springen.
  const ergaenze = () => {
    setBikes(prev => {
      const leer = prev.find(b => !b.name.trim() && !b.bikeId);
      if (leer) { fokusRef.current = leer.id; return prev; }
      const zeile = neueZeile();
      fokusRef.current = zeile.id;
      return [...prev, zeile];
    });
  };

  const speichern = () => {
    if (bearbeiten) {
      if (!onSaveEdit || !entwurf) return;
      const ergebnis = onSaveEdit(entwurf);
      if (Array.isArray(ergebnis) && ergebnis.length > 0) { setFehler(ergebnis); return; }
      onClose();
      return;
    }
    if (anzahl === 0 || !onSave) return;
    onSave(
      {
        name: name.trim() || defaultName,
        purchaseDate,
        totalPrice,
        pickupMinutes,
        bikes: gueltige,
        acquisitionSource: quelle.source,
        acquisitionNote: quelle.source === 'andere' ? quelle.note : undefined,
      },
      { strasse: strasse.trim(), plz }
    );
  };

  // Kachelwerte: beim Bearbeiten aus dem Plan, sonst aus der Anlege-Vorschau.
  const kachelAnzahl = bearbeiten ? (plan?.verteilung.length ?? 0) : anzahl;
  const kachelPreis = kachelAnzahl > 0 ? totalPrice / kachelAnzahl : 0;
  const kachelMin = kachelAnzahl > 0 ? pickupMinutes / kachelAnzahl : 0;
  const hatAnzahl = kachelAnzahl > 0;

  const euroDiff = (neu: number, vorher: number | null) => {
    if (vorher === null) return null;
    const d = Math.round((neu - vorher) * 100) / 100;
    if (Math.abs(d) < 0.005) return null;
    return (
      <span className={d > 0 ? 'text-red-400' : 'text-emerald-400'}>
        {' '}{d > 0 ? '+' : '−'}{formatCurrency(Math.abs(d))}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-lg font-bold text-amber-400 flex items-center min-w-0">
            <Boxes className="w-5 h-5 mr-2 shrink-0" />
            <span className="truncate">{bearbeiten ? `${gruppe!.info.name} bearbeiten` : 'Konvolut-Ankauf'}</span>
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          <p className="text-xs text-slate-500">
            {bearbeiten
              ? 'Preis und Abholzeit werden beim Speichern neu auf alle Räder verteilt – auch auf bereits verkaufte. Rückgängig geht danach über das Log.'
              : 'Ein Preis, eine Abholfahrt, mehrere Räder. Preis und Abholzeit werden gleichmäßig auf die Räder verteilt – danach zählt jedes Rad für sich und bekommt in der Werkstatt seine eigene Zeit.'}
          </p>

          {fehler.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 space-y-1">
              <p className="text-sm font-medium text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> Nicht gespeichert
              </p>
              {fehler.map((f, i) => <p key={i} className="text-xs text-red-300/90">{f}</p>)}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950/50 p-4 rounded-lg border border-slate-800">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-400 mb-1">Bezeichnung</label>
              <Input
                value={name}
                onChange={(e) => mitFehlerReset(setName)(e.target.value)}
                className="bg-slate-800 border-slate-700 text-slate-100"
                placeholder={defaultName}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Preis für das Konvolut (€)</label>
              <Input
                type="number"
                value={totalPrice || ''}
                onChange={(e) => mitFehlerReset(setTotalPrice)(parseFloat(e.target.value) || 0)}
                className="bg-slate-800 border-slate-700 text-slate-100 font-bold"
                placeholder="0.00"
                autoFocus
              />
              {bearbeiten && Math.abs(erfassterPreis - vorhandenerPreis) >= 0.01 && (
                <p className="text-[11px] text-slate-500 mt-1">
                  Zuletzt erfasst: {formatCurrency(erfassterPreis)} ·{' '}
                  <button
                    type="button"
                    onClick={() => mitFehlerReset(setTotalPrice)(erfassterPreis)}
                    className="text-amber-400 hover:text-amber-300 underline underline-offset-2"
                  >
                    übernehmen
                  </button>
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Dauer der Abholung (min)</label>
              <Input
                type="number"
                value={pickupMinutes || ''}
                onChange={(e) => mitFehlerReset(setPickupMinutes)(parseFloat(e.target.value) || 0)}
                className="bg-slate-800 border-slate-700 text-slate-100 font-bold"
                placeholder="z.B. 60"
              />
              {bearbeiten && gebuchteAbholMin !== (gruppe!.info.pickupMinutes || 0) && (
                <p className="text-[11px] text-slate-500 mt-1">
                  Aktuell als Abhol-Eintrag gebucht: {gebuchteAbholMin} min
                </p>
              )}
            </div>
            {!bearbeiten && (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Ankaufsdatum</label>
                  <Input
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Akquise-Quelle</label>
                  <AkquiseAuswahl kompakt value={quelle} onChange={setQuelle} />
                </div>
                {quelle.source === 'flyer' && (
                  <div className="md:col-span-2 grid grid-cols-3 gap-2">
                    <label className="col-span-2 text-xs text-slate-400 flex flex-col gap-1">
                      Abholadresse (optional)
                      <Input value={strasse} onChange={(e) => setStrasse(e.target.value)} placeholder="Musterweg 12" />
                    </label>
                    <label className="text-xs text-slate-400 flex flex-col gap-1">
                      PLZ
                      <Input value={plz} onChange={(e) => setPlz(e.target.value)} />
                    </label>
                    <p className="col-span-3 text-[11px] text-slate-500">
                      Legt einen Lead auf der Flyer-Karte an und verknüpft alle Räder des Konvoluts damit.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Live-Aufteilung */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3">
              <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Räder</p>
              <p className="text-xl font-bold text-slate-100 mt-0.5">{kachelAnzahl}</p>
            </div>
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3">
              <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Preis / Rad</p>
              <p className={`text-xl font-bold mt-0.5 ${hatAnzahl ? 'text-amber-400' : 'text-slate-600'}`}>
                {hatAnzahl ? formatCurrency(bearbeiten ? kachelPreis : preisProRad) : '—'}
              </p>
            </div>
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3">
              <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Zeit / Rad</p>
              <p className={`text-xl font-bold mt-0.5 flex items-center gap-1.5 ${hatAnzahl ? 'text-orange-400' : 'text-slate-600'}`}>
                {hatAnzahl && <Clock className="w-4 h-4" />}
                {hatAnzahl ? `${(bearbeiten ? kachelMin : minutenProRad).toFixed(0)} min` : '—'}
              </p>
            </div>
          </div>

          {/* Auswirkungen: blockiert nicht, muss aber gesehen werden */}
          {bearbeiten && ((plan?.hinweise.length ?? 0) > 0 || entfernt.length > 0) && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 space-y-1">
              <p className="text-sm font-medium text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> Auswirkungen
              </p>
              {entfernt.length > 0 && (
                <p className="text-xs text-amber-200/90">
                  {entfernt.length} {entfernt.length === 1 ? 'Rad wird' : 'Räder werden'} beim Speichern gelöscht:{' '}
                  {entfernt.map(z => z.name).join(', ')}. Rückgängig danach über das Log.
                </p>
              )}
              {plan?.hinweise.map((h, i) => <p key={i} className="text-xs text-amber-200/90">{h}</p>)}
            </div>
          )}

          {/* Räder */}
          <div>
            <h3 className="text-sm font-medium text-slate-300 mb-3 border-b border-slate-800 pb-2 flex items-center justify-between">
              <span>Räder im Konvolut</span>
              <span className="text-xs font-normal text-slate-500">Enter fügt das nächste Rad hinzu</span>
            </h3>
            <div className="space-y-2">
              {bikes.map((bike, idx) => {
                const v = bearbeiten ? verteilungNachId.get(bike.id) : undefined;
                const zaehltMit = bearbeiten ? !!v : bike.name.trim().length > 0;
                // Anlegen: Index innerhalb der gültigen Zeilen – nur die bekommen einen Anteil.
                const anteilIdx = gueltige.findIndex(g => g.id === bike.id);
                return (
                  <div key={bike.id} className="flex items-center gap-2">
                    <span className="w-6 shrink-0 text-xs text-slate-500 text-right tabular-nums">{idx + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <Input
                        value={bike.name}
                        onChange={(e) => aendere(bike.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          if (!bike.name.trim()) return;
                          ergaenze();
                        }}
                        ref={(el) => {
                          if (el && fokusRef.current === bike.id) {
                            fokusRef.current = null;
                            el.focus();
                          }
                        }}
                        className="bg-slate-800 border-slate-700 text-sm h-9 w-full"
                        placeholder={`Rad ${idx + 1} – z.B. Damenrad blau 28"`}
                      />
                      {v && (v.verkauft || v.neu || v.laeuft) && (
                        <div className="flex gap-1 mt-1">
                          {v.verkauft && <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded">Verkauft</span>}
                          {v.neu && <span className="text-[9px] font-bold uppercase tracking-wider text-blue-400 bg-blue-500/15 border border-blue-500/30 px-1.5 py-0.5 rounded">neu</span>}
                          {v.laeuft && <span className="text-[9px] font-bold uppercase tracking-wider text-orange-400 bg-orange-500/15 border border-orange-500/30 px-1.5 py-0.5 rounded flex items-center gap-1"><Timer className="w-2.5 h-2.5" />Stoppuhr läuft</span>}
                        </div>
                      )}
                    </div>
                    <span className="w-48 shrink-0 text-right text-xs tabular-nums">
                      {zaehltMit ? (
                        bearbeiten && v ? (
                          <>
                            <span className="text-amber-400 font-medium">{formatCurrency(v.preis)}</span>
                            {euroDiff(v.preis, v.preisVorher)}
                            <span className="text-slate-600 mx-1">·</span>
                            {v.sekunden === null
                              ? <span className="text-slate-500" title="Kein Abhol-Eintrag mehr – die Zeit dieses Rades bleibt unverändert">—</span>
                              : <span className="text-orange-400 font-medium">{Math.round(v.sekunden / 60)} min</span>}
                          </>
                        ) : (
                          <>
                            <span className="text-amber-400 font-medium">{formatCurrency(preise[anteilIdx] ?? 0)}</span>
                            <span className="text-slate-600 mx-1">·</span>
                            <span className="text-orange-400 font-medium">{((sekunden[anteilIdx] ?? 0) / 60).toFixed(0)} min</span>
                          </>
                        )
                      ) : (
                        <span className="text-slate-600">zählt noch nicht</span>
                      )}
                    </span>
                    <button
                      onClick={() => entferne(bike.id)}
                      className="text-slate-500 hover:text-red-400 p-1 shrink-0 transition-colors"
                      title={bearbeiten && bike.bikeId ? 'Rad beim Speichern löschen' : 'Rad entfernen'}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}

              {/* Entfernte Räder bleiben bis zum Speichern sichtbar */}
              {entfernt.map(z => (
                <div key={z.id} className="flex items-center gap-2 opacity-60">
                  <span className="w-6 shrink-0" />
                  <span className="flex-1 min-w-0 text-sm text-slate-500 line-through truncate px-3">{z.name}</span>
                  <span className="w-48 shrink-0 text-right text-[11px] text-red-400/80">wird gelöscht</span>
                  <button
                    onClick={() => zurueckholen(z.id)}
                    className="text-slate-400 hover:text-emerald-400 p-1 shrink-0 transition-colors"
                    title="Zurückholen"
                  >
                    <Undo2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <Button
              size="sm"
              onClick={ergaenze}
              className="w-full mt-3 bg-slate-800 hover:bg-slate-700 text-slate-200 h-9 text-xs border border-slate-700"
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> Weiteres Rad
            </Button>
          </div>
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-900/80 flex space-x-3 mt-auto">
          <Button
            variant="outline"
            className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
            onClick={onClose}
          >
            Abbrechen
          </Button>
          <Button
            className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-medium shadow-lg shadow-amber-500/20 disabled:opacity-40"
            onClick={speichern}
            disabled={!bearbeiten && anzahl === 0}
          >
            {bearbeiten
              ? 'Änderungen speichern'
              : anzahl === 0 ? 'Mindestens ein Rad' : `${anzahl} ${anzahl === 1 ? 'Rad' : 'Räder'} anlegen`}
          </Button>
        </div>
      </div>
    </div>
  );
}
