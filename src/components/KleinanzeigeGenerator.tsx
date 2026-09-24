import React, { useEffect, useRef, useState } from 'react';
import { Bike, BikeDefect, BikeDetails, KleinanzeigeInfo, KleinanzeigeZustand } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Megaphone, Copy, Check, Plus, X, Sparkles, AlertTriangle } from 'lucide-react';
import {
  TITEL_MAX,
  VORSCHLAEGE,
  ZUSTAND_LABELS,
  einleitungVorschlag,
  kleinanzeigeText,
  kleinanzeigeTitel,
  koerpergroesseVorschlag,
  sanitizeKleinanzeige,
} from '../lib/kleinanzeige';

interface KleinanzeigeGeneratorProps {
  bike: Bike;
  // Marke, Modell, Größen, Schaltung und Mängel teilt sich der Generator mit
  // der Kaufvertrag-Karte – Änderungen laufen über deren Speicherweg.
  details: BikeDetails;
  onDetailsChange: (next: BikeDetails) => void;
  updateBike: (id: string, updates: Partial<Bike>) => void;
}

const labelCls = 'block text-xs font-medium text-slate-400 mb-1';
const sectionCls = 'text-[10px] uppercase font-bold text-slate-500 tracking-wider';

/** Kopiert Text – mit Fallback, falls die Clipboard-API fehlt (http, ältere Browser). */
async function kopieren(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}

/**
 * Kleinanzeigen-Generator: erzeugt Titel und Inseratstext nach fester Formel
 * (siehe lib/kleinanzeige.ts). Wird pro Rad mit `key={bike.id}` gerendert,
 * damit der lokale Entwurf beim Radwechsel sauber neu geladen wird.
 */
export function KleinanzeigeGenerator({ bike, details, onDetailsChange, updateBike }: KleinanzeigeGeneratorProps) {
  // --- lokaler Entwurf + entprellter Firestore-Save (wie bei den Details) ---
  const [k, setK] = useState<KleinanzeigeInfo>(() => sanitizeKleinanzeige(bike.kleinanzeige));
  const saveTimer = useRef<number | null>(null);
  const pending = useRef<KleinanzeigeInfo | null>(null);
  const updateBikeRef = useRef(updateBike);
  updateBikeRef.current = updateBike;
  const bikeId = bike.id;

  const flush = () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (pending.current) {
      updateBikeRef.current(bikeId, { kleinanzeige: pending.current });
      pending.current = null;
    }
  };

  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const setKA = (next: KleinanzeigeInfo) => {
    setK(next);
    pending.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, 600);
  };
  const setField = <F extends keyof KleinanzeigeInfo>(f: F, v: KleinanzeigeInfo[F]) => setKA({ ...k, [f]: v });
  const setDetail = <F extends keyof BikeDetails>(f: F, v: BikeDetails[F]) => onDetailsChange({ ...details, [f]: v });

  // --- Ergebnis ---
  const titel = kleinanzeigeTitel(details, k);
  const text = kleinanzeigeText(details, k);
  const vorschlag = einleitungVorschlag(details, k);
  const koerper = koerpergroesseVorschlag(details.rahmenhoehe);

  const [kopiert, setKopiert] = useState<'titel' | 'text' | null>(null);
  const kopiereUndMelde = async (was: 'titel' | 'text', inhalt: string) => {
    if (await kopieren(inhalt)) {
      setKopiert(was);
      window.setTimeout(() => setKopiert((c) => (c === was ? null : c)), 1500);
    }
  };

  // --- Ausstattung ---
  const [eigeneAusstattung, setEigeneAusstattung] = useState('');
  const toggleAusstattung = (teil: string) =>
    setField('ausstattung', k.ausstattung.includes(teil)
      ? k.ausstattung.filter((a) => a !== teil)
      : [...k.ausstattung, teil]);
  const addEigene = () => {
    const teil = eigeneAusstattung.trim();
    if (!teil) return;
    if (!k.ausstattung.includes(teil)) setField('ausstattung', [...k.ausstattung, teil]);
    setEigeneAusstattung('');
  };

  // --- Mängel (dieselbe Liste wie im Kaufvertrag) ---
  const maengel: BikeDefect[] = details.maengel ?? [];
  const setMaengel = (next: BikeDefect[]) => setDetail('maengel', next);

  // Als Funktionen aufrufen (nicht als Komponenten), sonst verlieren die
  // Eingaben bei jedem Tastendruck den Fokus.
  const kaFeld = (
    label: string,
    f: Exclude<keyof KleinanzeigeInfo, 'ausstattung' | 'zustand'>,
    opts: { placeholder?: string; liste?: string[]; wide?: boolean } = {},
  ) => (
    <div className={opts.wide ? 'sm:col-span-2' : ''}>
      <label className={labelCls}>{label}</label>
      <Input
        value={k[f]}
        onChange={(e) => setField(f, e.target.value)}
        placeholder={opts.placeholder}
        list={opts.liste ? `ka-${f}` : undefined}
      />
      {opts.liste && (
        <datalist id={`ka-${f}`}>
          {opts.liste.map((v) => <option key={v} value={v} />)}
        </datalist>
      )}
    </div>
  );

  const detailFeld = (
    label: string,
    f: 'marke' | 'modell' | 'laufradgroesse' | 'rahmenhoehe' | 'farbe' | 'gangschaltung' | 'anzahlGaenge',
    placeholder?: string,
  ) => (
    <div>
      <label className={labelCls}>{label}</label>
      <Input value={details[f] || ''} onChange={(e) => setDetail(f, e.target.value)} placeholder={placeholder} />
    </div>
  );

  const zustaende = Object.keys(ZUSTAND_LABELS) as KleinanzeigeZustand[];
  const vorschlaegeOhneAuswahl = VORSCHLAEGE.ausstattung.filter((a) => !k.ausstattung.includes(a));

  return (
    <Card className="border-orange-500/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center">
          <Megaphone className="w-5 h-5 mr-2 text-orange-500" />
          Kleinanzeigen-Inserat
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-xs text-slate-400 leading-relaxed bg-slate-800/40 border border-slate-700/50 rounded-lg p-3">
          Felder ausfüllen, der Inseratstext entsteht unten automatisch. Leere Angaben fallen weg.
          Marke, Modell, Größen, Farbe, Schaltung und Mängel sind dieselben wie im Kaufvertrag.
        </p>

        {/* Einleitung */}
        <div className="space-y-3">
          <p className={sectionCls}>Einleitung</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {kaFeld('Adjektiv', 'adjektiv', { placeholder: 'z.B. Klassisches', liste: VORSCHLAEGE.adjektiv })}
            {kaFeld('Radtyp', 'radtyp', { placeholder: 'z.B. Damenrad', liste: VORSCHLAEGE.radtyp })}
            {kaFeld('Stil', 'stil', { placeholder: 'z.B. Hollandstil', liste: VORSCHLAEGE.stil })}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {detailFeld('Farbe', 'farbe', 'z.B. glänzend rot')}
            <div className="sm:col-span-2">
              {kaFeld('Highlights (mit Komma trennen)', 'highlights', { placeholder: 'z.B. Weidenkorb, wartungsarmer Technik' })}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={labelCls + ' mb-0'}>Einleitungssatz</label>
              {vorschlag && k.einleitung.trim() !== vorschlag && (
                <button
                  type="button"
                  onClick={() => setField('einleitung', vorschlag)}
                  className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 font-medium"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Vorschlag übernehmen
                </button>
              )}
            </div>
            <textarea
              value={k.einleitung}
              onChange={(e) => setField('einleitung', e.target.value)}
              placeholder={vorschlag || 'Leer lassen = Vorschlag aus den Feldern oben'}
              rows={2}
              className="w-full bg-slate-800/60 border border-slate-700/80 rounded-lg p-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500/60 resize-none"
            />
          </div>
        </div>

        {/* Eckdaten */}
        <div className="space-y-3 pt-3 border-t border-slate-800">
          <p className={sectionCls}>Eckdaten</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {detailFeld('Marke', 'marke', 'z.B. Senator')}
            {detailFeld('Modell', 'modell', 'z.B. Comfort Bike')}
            {detailFeld('Laufradgröße (Zoll)', 'laufradgroesse', 'z.B. 28')}
            {detailFeld('Rahmenhöhe (cm)', 'rahmenhoehe', 'z.B. 50')}
            {kaFeld('Körpergröße von (cm)', 'koerperVon', { placeholder: koerper ? `${koerper.von} (Vorschlag)` : 'z.B. 160' })}
            {kaFeld('Körpergröße bis (cm)', 'koerperBis', { placeholder: koerper ? `${koerper.bis} (Vorschlag)` : 'z.B. 178' })}
          </div>
        </div>

        {/* Technik */}
        <div className="space-y-3 pt-3 border-t border-slate-800">
          <p className={sectionCls}>Schaltung · Bremsen · Beleuchtung</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {detailFeld('Schaltung', 'gangschaltung', 'z.B. Shimano Nexus')}
            {detailFeld('Gänge', 'anzahlGaenge', 'z.B. 3')}
            {kaFeld('Art', 'schaltungsart', { placeholder: 'z.B. Nabenschaltung', liste: VORSCHLAEGE.schaltungsart })}
            {kaFeld('Bedienung', 'schaltBedienung', { placeholder: 'z.B. Drehgriff', liste: VORSCHLAEGE.schaltBedienung })}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {kaFeld('Bremse vorne', 'bremseVorne', { placeholder: 'z.B. V-Bremse', liste: VORSCHLAEGE.bremse })}
            {kaFeld('Bremse hinten', 'bremseHinten', { placeholder: 'leer = wie vorne', liste: VORSCHLAEGE.bremse })}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {kaFeld('Licht-Hersteller', 'lichtHersteller', { placeholder: 'z.B. Shimano' })}
            {kaFeld('Lichtquelle', 'lichtquelle', { placeholder: 'z.B. Nabendynamo', liste: VORSCHLAEGE.lichtquelle })}
            {kaFeld('Scheinwerfer', 'scheinwerfer', { placeholder: 'z.B. LED', liste: VORSCHLAEGE.scheinwerfer })}
          </div>
        </div>

        {/* Ausstattung */}
        <div className="space-y-3 pt-3 border-t border-slate-800">
          <p className={sectionCls}>Ausstattung (Reihenfolge wie im Inserat)</p>
          {k.ausstattung.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {k.ausstattung.map((a) => (
                <span key={a} className="flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-xs bg-orange-500/15 border border-orange-500/50 text-orange-200">
                  {a}
                  <button type="button" onClick={() => toggleAusstattung(a)} className="p-0.5 rounded-full hover:bg-orange-500/30" title="Entfernen">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {vorschlaegeOhneAuswahl.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => toggleAusstattung(a)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border border-slate-700 text-slate-400 hover:border-orange-500/50 hover:text-slate-200 transition-colors"
              >
                <Plus className="w-3 h-3" /> {a}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={eigeneAusstattung}
              onChange={(e) => setEigeneAusstattung(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEigene(); } }}
              placeholder="Eigener Eintrag, z.B. Wittkop Komfortsattel"
              className="flex-1"
            />
            <button
              type="button"
              onClick={addEigene}
              className="shrink-0 h-10 w-10 flex items-center justify-center rounded-lg bg-orange-500 hover:bg-orange-600 text-white"
              title="Hinzufügen"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Zustand & Mängel */}
        <div className="space-y-3 pt-3 border-t border-slate-800">
          <p className={sectionCls}>Zustand &amp; kosmetische Mängel</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {zustaende.map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setField('zustand', z)}
                className={`py-2 rounded-lg border text-sm transition-colors ${
                  k.zustand === z
                    ? 'bg-orange-500/10 border-orange-500/60 text-slate-100 font-medium'
                    : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:border-slate-600'
                }`}
              >
                {ZUSTAND_LABELS[z]}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {maengel.map((m, i) => (
              <div key={m.id} className="flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <Input
                  value={m.text}
                  onChange={(e) => setMaengel(maengel.map((x) => (x.id === m.id ? { ...x, text: e.target.value } : x)))}
                  placeholder={i === 0 ? 'z.B. kleine Lackabplatzer an der Gabel' : 'Weiterer Mangel'}
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => setMaengel(maengel.filter((x) => x.id !== m.id))}
                  className="p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-colors shrink-0"
                  title="Mangel entfernen"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setMaengel([...maengel, { id: Math.random().toString(36).slice(2, 9), text: '' }])}
              className="flex items-center gap-1.5 text-sm text-orange-400 hover:text-orange-300 font-medium px-1 py-1 transition-colors"
            >
              <Plus className="w-4 h-4" /> Mangel hinzufügen
            </button>
          </div>
        </div>

        {/* Vorschau */}
        <div className="space-y-3 pt-3 border-t border-slate-800">
          <p className={sectionCls}>Fertiges Inserat</p>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={labelCls + ' mb-0'}>
                Titel{' '}
                <span className={titel.length > TITEL_MAX ? 'text-red-400 font-bold' : 'text-slate-500'}>
                  ({titel.length}/{TITEL_MAX})
                </span>
              </label>
              <button
                type="button"
                onClick={() => kopiereUndMelde('titel', titel)}
                disabled={!titel}
                className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 font-medium disabled:opacity-40"
              >
                {kopiert === 'titel' ? <><Check className="w-3.5 h-3.5" /> Kopiert</> : <><Copy className="w-3.5 h-3.5" /> Titel kopieren</>}
              </button>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 min-h-[2.25rem] break-words">
              {titel || <span className="text-slate-500">Marke, Modell, Größen eintragen…</span>}
            </div>
          </div>
          <textarea
            readOnly
            value={text}
            rows={20}
            className="w-full bg-slate-800 border border-slate-700 rounded-md p-3 text-sm text-slate-200 font-sans leading-relaxed focus:outline-none focus:ring-2 focus:ring-orange-500 resize-y"
          />
          <button
            type="button"
            onClick={() => kopiereUndMelde('text', text)}
            className="w-full flex items-center justify-center gap-2 h-10 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium shadow-lg shadow-orange-500/20 transition-colors"
          >
            {kopiert === 'text' ? <><Check className="w-4 h-4" /> Text kopiert</> : <><Copy className="w-4 h-4" /> Inseratstext kopieren</>}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
