import React, { useMemo, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { formatCurrency } from '../lib/utils';
import { Boxes, Plus, X, Clock, Megaphone, Monitor } from 'lucide-react';
import {
  KonvolutDraft, KonvolutDraftBike, konvolutVorschau, splitPreis, splitSekunden,
} from '../lib/konvolut';
import { DEFAULT_PLZ } from '../lib/flyerLeads';

interface KonvolutModalProps {
  /** Vorgeschlagener Name, z.B. "Konvolut #3". */
  defaultName: string;
  onSave: (draft: KonvolutDraft, adresse: { strasse: string; plz: string }) => void;
  onClose: () => void;
}

const neueZeile = (): KonvolutDraftBike => ({
  id: Math.random().toString(36).slice(2, 9),
  name: '',
});

export function KonvolutModal({ defaultName, onSave, onClose }: KonvolutModalProps) {
  const [name, setName] = useState(defaultName);
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [totalPrice, setTotalPrice] = useState(0);
  const [pickupMinutes, setPickupMinutes] = useState(0);
  const [acquisitionSource, setAcquisitionSource] = useState<'flyer' | 'kleinanzeigen'>('flyer');
  const [strasse, setStrasse] = useState('');
  const [plz, setPlz] = useState(DEFAULT_PLZ);

  const [bikes, setBikes] = useState<KonvolutDraftBike[]>([neueZeile()]);
  // Das zuletzt angelegte Feld bekommt den Fokus, damit Enter → tippen → Enter
  // ohne Maus durchläuft.
  const fokusRef = useRef<string | null>(null);

  const gueltige = bikes.filter(b => b.name.trim().length > 0);
  const anzahl = gueltige.length;
  const { preisProRad, minutenProRad } = useMemo(
    () => konvolutVorschau(totalPrice, pickupMinutes, anzahl),
    [totalPrice, pickupMinutes, anzahl]
  );
  // Die tatsächlich gebuchten Werte können um einen Cent bzw. eine Sekunde
  // auseinanderliegen – hier steht, was wirklich geschrieben wird.
  const preise = useMemo(() => splitPreis(totalPrice, anzahl), [totalPrice, anzahl]);
  const sekunden = useMemo(() => splitSekunden(pickupMinutes * 60, anzahl), [pickupMinutes, anzahl]);

  const aendere = (id: string, wert: string) =>
    setBikes(prev => prev.map(b => (b.id === id ? { ...b, name: wert } : b)));

  const entferne = (id: string) =>
    setBikes(prev => (prev.length === 1 ? [neueZeile()] : prev.filter(b => b.id !== id)));

  // Eine leere Zeile unten anhängen – oder, wenn schon eine leer ist, einfach
  // dorthin springen statt eine zweite leere Zeile zu erzeugen.
  const ergaenze = () => {
    setBikes(prev => {
      const leer = prev.find(b => !b.name.trim());
      if (leer) { fokusRef.current = leer.id; return prev; }
      const zeile = neueZeile();
      fokusRef.current = zeile.id;
      return [...prev, zeile];
    });
  };

  const speichern = () => {
    if (anzahl === 0) return;
    onSave(
      {
        name: name.trim() || defaultName,
        purchaseDate,
        totalPrice,
        pickupMinutes,
        bikes: gueltige,
        acquisitionSource,
      },
      { strasse: strasse.trim(), plz }
    );
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-lg font-bold text-amber-400 flex items-center">
            <Boxes className="w-5 h-5 mr-2" />
            Konvolut-Ankauf
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          <p className="text-xs text-slate-500">
            Ein Preis, eine Abholfahrt, mehrere Räder. Preis und Abholzeit werden gleichmäßig auf die
            Räder verteilt – danach zählt jedes Rad für sich und bekommt in der Werkstatt seine eigene Zeit.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950/50 p-4 rounded-lg border border-slate-800">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-400 mb-1">Bezeichnung</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-slate-800 border-slate-700 text-slate-100"
                placeholder={defaultName}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Preis für das Konvolut (€)</label>
              <Input
                type="number"
                value={totalPrice || ''}
                onChange={(e) => setTotalPrice(parseFloat(e.target.value) || 0)}
                className="bg-slate-800 border-slate-700 text-slate-100 font-bold"
                placeholder="0.00"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Dauer der Abholung (min)</label>
              <Input
                type="number"
                value={pickupMinutes || ''}
                onChange={(e) => setPickupMinutes(parseFloat(e.target.value) || 0)}
                className="bg-slate-800 border-slate-700 text-slate-100 font-bold"
                placeholder="z.B. 60"
              />
            </div>
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
              <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
                <button
                  type="button"
                  onClick={() => setAcquisitionSource('flyer')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                    acquisitionSource === 'flyer' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-slate-300'
                  }`}
                >
                  <Megaphone className="w-3.5 h-3.5" /> Flyer
                </button>
                <button
                  type="button"
                  onClick={() => setAcquisitionSource('kleinanzeigen')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                    acquisitionSource === 'kleinanzeigen' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-300'
                  }`}
                >
                  <Monitor className="w-3.5 h-3.5" /> Kleinanzeigen
                </button>
              </div>
            </div>
            {acquisitionSource === 'flyer' && (
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
          </div>

          {/* Live-Aufteilung */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3">
              <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Räder</p>
              <p className="text-xl font-bold text-slate-100 mt-0.5">{anzahl}</p>
            </div>
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3">
              <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Preis / Rad</p>
              <p className={`text-xl font-bold mt-0.5 ${anzahl > 0 ? 'text-amber-400' : 'text-slate-600'}`}>
                {anzahl > 0 ? formatCurrency(preisProRad) : '—'}
              </p>
            </div>
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3">
              <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Zeit / Rad</p>
              <p className={`text-xl font-bold mt-0.5 flex items-center gap-1.5 ${anzahl > 0 ? 'text-orange-400' : 'text-slate-600'}`}>
                {anzahl > 0 && <Clock className="w-4 h-4" />}
                {anzahl > 0 ? `${minutenProRad.toFixed(0)} min` : '—'}
              </p>
            </div>
          </div>

          {/* Räder */}
          <div>
            <h3 className="text-sm font-medium text-slate-300 mb-3 border-b border-slate-800 pb-2 flex items-center justify-between">
              <span>Räder im Konvolut</span>
              <span className="text-xs font-normal text-slate-500">Enter fügt das nächste Rad hinzu</span>
            </h3>
            <div className="space-y-2">
              {bikes.map((bike, idx) => {
                const zaehltMit = bike.name.trim().length > 0;
                // Index innerhalb der gültigen Zeilen – nur die bekommen einen Anteil.
                const anteilIdx = gueltige.findIndex(g => g.id === bike.id);
                return (
                  <div key={bike.id} className="flex items-center gap-2">
                    <span className="w-6 shrink-0 text-xs text-slate-500 text-right tabular-nums">{idx + 1}.</span>
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
                      className="bg-slate-800 border-slate-700 text-sm h-9 flex-1"
                      placeholder={`Rad ${idx + 1} – z.B. Damenrad blau 28"`}
                    />
                    <span className="w-44 shrink-0 text-right text-xs tabular-nums">
                      {zaehltMit ? (
                        <>
                          <span className="text-amber-400 font-medium">{formatCurrency(preise[anteilIdx] ?? 0)}</span>
                          <span className="text-slate-600 mx-1">·</span>
                          <span className="text-orange-400 font-medium">
                            {((sekunden[anteilIdx] ?? 0) / 60).toFixed(0)} min
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-600">zählt noch nicht</span>
                      )}
                    </span>
                    <button
                      onClick={() => entferne(bike.id)}
                      className="text-slate-500 hover:text-red-400 p-1 shrink-0 transition-colors"
                      title="Rad entfernen"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
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
            disabled={anzahl === 0}
          >
            {anzahl === 0 ? 'Mindestens ein Rad' : `${anzahl} ${anzahl === 1 ? 'Rad' : 'Räder'} anlegen`}
          </Button>
        </div>
      </div>
    </div>
  );
}
