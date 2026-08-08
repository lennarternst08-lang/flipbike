import React, { useEffect, useRef, useState } from 'react';
import { BikeDetails, BikeDefect, BikeUebergabeArt } from '../types';
import { Input } from './ui/input';
import { Plus, X, AlertTriangle, Home, Truck } from 'lucide-react';
import { ABHOLUNG_ORT, DEFAULT_RUECKSENDEKOSTEN, missingLieferungFields } from '../lib/kaufvertrag';

interface BikeDetailsFieldsProps {
  value: BikeDetails;
  onChange: (next: BikeDetails) => void;
  includeContract?: boolean; // Käufer- & Übergabefelder einblenden
}

const inputCls = 'bg-slate-800 border-slate-700 text-slate-100';
const labelCls = 'block text-xs font-medium text-slate-400 mb-1';

export function BikeDetailsFields({ value, onChange, includeContract = false }: BikeDetailsFieldsProps) {
  const set = <K extends keyof BikeDetails>(key: K, val: BikeDetails[K]) =>
    onChange({ ...value, [key]: val });

  const maengel: BikeDefect[] = value.maengel ?? [];
  const uebergabeArt: BikeUebergabeArt = value.uebergabeArt === 'lieferung' ? 'lieferung' : 'abholung';
  const isLieferung = uebergabeArt === 'lieferung';
  const missing = missingLieferungFields(value);

  // Wechsel der Übergabeart: Ort bei Abholung vorbelegen, bei Lieferung leeren –
  // aber nur, wenn dort noch die jeweilige Vorbelegung steht (nichts überschreiben).
  const setUebergabeArt = (art: BikeUebergabeArt) => {
    if (art === uebergabeArt) return;
    const next: BikeDetails = { ...value, uebergabeArt: art };
    const ort = (value.ort || '').trim();
    if (art === 'abholung' && ort === '') {
      next.ort = ABHOLUNG_ORT;
    } else if (art === 'lieferung' && ort === ABHOLUNG_ORT) {
      next.ort = '';
    }
    onChange(next);
  };

  const [focusId, setFocusId] = useState<string | null>(null);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  useEffect(() => {
    if (!focusId) return;
    const el = inputRefs.current.get(focusId);
    if (el) el.focus();
    setFocusId(null);
  }, [focusId, maengel]);

  const setMaengel = (next: BikeDefect[]) => set('maengel', next);

  const addMangel = (afterId?: string) => {
    const nd: BikeDefect = { id: Math.random().toString(36).slice(2, 9), text: '' };
    if (afterId) {
      const idx = maengel.findIndex((m) => m.id === afterId);
      setMaengel([...maengel.slice(0, idx + 1), nd, ...maengel.slice(idx + 1)]);
    } else {
      setMaengel([...maengel, nd]);
    }
    setFocusId(nd.id);
  };

  const updateMangel = (id: string, text: string) =>
    setMaengel(maengel.map((m) => (m.id === id ? { ...m, text } : m)));

  const removeMangel = (id: string, focusPrev = false) => {
    const idx = maengel.findIndex((m) => m.id === id);
    const next = maengel.filter((m) => m.id !== id);
    setMaengel(next);
    if (focusPrev && idx > 0) setFocusId(maengel[idx - 1].id);
  };

  // Als Funktion (nicht als Komponente) aufrufen: sonst würden die Inputs bei
  // jedem Tastendruck neu gemountet und verlören den Fokus.
  const renderField = (
    label: string,
    k: keyof BikeDetails,
    opts: { placeholder?: string; type?: string; wide?: boolean } = {},
  ) => (
    <div className={opts.wide ? 'sm:col-span-2' : ''}>
      <label className={labelCls}>{label}</label>
      <Input
        type={opts.type || 'text'}
        value={(value[k] as string) || ''}
        onChange={(e) => set(k, e.target.value)}
        placeholder={opts.placeholder}
        className={inputCls}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* 1. Kaufgegenstand (Fahrrad) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {renderField('Marke', 'marke', { placeholder: 'z.B. Cube' })}
        {renderField('Modell', 'modell', { placeholder: 'z.B. Aim Pro' })}
        {renderField('Rahmennummer', 'rahmennummer', { placeholder: 'eingestanzte Nr.' })}
        {renderField('ca. Baujahr', 'baujahr', { placeholder: 'z.B. 2019' })}
        {renderField('Laufradgröße (Zoll)', 'laufradgroesse', { placeholder: 'z.B. 28"' })}
        {renderField('Rahmenhöhe / Größe', 'rahmenhoehe', { placeholder: 'z.B. 54 cm / M' })}
        {renderField('Farbe', 'farbe', { placeholder: 'z.B. mattschwarz' })}
        {renderField('Gangschaltung', 'gangschaltung', { placeholder: 'z.B. Shimano Deore' })}
        {renderField('Anzahl Gänge', 'anzahlGaenge', { placeholder: 'z.B. 21' })}
        <div className="sm:col-span-2">
          <label className={labelCls}>Mitverkauftes Zubehör</label>
          <textarea
            value={value.zubehoer || ''}
            onChange={(e) => set('zubehoer', e.target.value)}
            placeholder="z.B. Schloss, Beleuchtung, Gepäckträger, Ständer"
            rows={2}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40 focus:border-orange-500/60 resize-none"
          />
        </div>
      </div>

      {/* 2. Zustand & bekannte Mängel */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className={labelCls + ' mb-0 flex items-center'}>
            <AlertTriangle className="w-3.5 h-3.5 mr-1.5 text-amber-500" />
            Bekannte Mängel
          </label>
          <span className="text-[10px] text-slate-500">Enter = nächster Mangel</span>
        </div>
        <div className="space-y-2">
          {maengel.map((m, i) => (
            <div key={m.id} className="flex items-center gap-2">
              <span className="text-xs text-slate-500 w-5 shrink-0 text-right tabular-nums">{i + 1}.</span>
              <Input
                ref={(el: HTMLInputElement | null) => {
                  if (el) inputRefs.current.set(m.id, el);
                  else inputRefs.current.delete(m.id);
                }}
                value={m.text}
                onChange={(e) => updateMangel(m.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addMangel(m.id);
                  } else if (e.key === 'Backspace' && m.text === '' && maengel.length > 1) {
                    e.preventDefault();
                    removeMangel(m.id, true);
                  }
                }}
                placeholder="z.B. Bremsbeläge hinten verschlissen"
                className={inputCls + ' flex-1'}
              />
              <button
                type="button"
                onClick={() => removeMangel(m.id)}
                className="p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-colors shrink-0"
                title="Mangel entfernen"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => addMangel()}
            className="flex items-center gap-1.5 text-sm text-orange-400 hover:text-orange-300 font-medium px-1 py-1 transition-colors"
          >
            <Plus className="w-4 h-4" /> Mangel hinzufügen
          </button>
        </div>
      </div>

      {/* Käufer & Übergabe (für den fertigen Vertrag) */}
      {includeContract && (
        <div className="pt-3 border-t border-slate-800 space-y-4">
          <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
            Käufer &amp; Übergabe — für den fertigen Vertrag (optional)
          </p>

          {/* Vertragsschluss / Übergabe: steuert das Widerrufsrecht im Vertrag */}
          <div>
            <label className={labelCls}>Vertragsschluss / Übergabe</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {([
                { key: 'abholung' as const, icon: Home, title: 'Abholung beim Verkäufer', sub: 'Helene-Engelbrecht-Straße 21' },
                { key: 'lieferung' as const, icon: Truck, title: 'Lieferung / außerhalb', sub: 'auch Abschluss per Chat' },
              ]).map(({ key, icon: Icon, title, sub }) => {
                const active = uebergabeArt === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setUebergabeArt(key)}
                    className={`flex items-start gap-2.5 p-3 rounded-lg border text-left transition-colors ${
                      active
                        ? 'bg-orange-500/10 border-orange-500/60 text-slate-100'
                        : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300'
                    }`}
                  >
                    <span className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                      active ? 'border-orange-500' : 'border-slate-600'
                    }`}>
                      {active && <span className="w-2 h-2 rounded-full bg-orange-500" />}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <Icon className="w-3.5 h-3.5 shrink-0" /> {title}
                      </span>
                      <span className="block text-[11px] text-slate-500 mt-0.5">{sub}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className={`text-[11px] mt-2 leading-relaxed ${isLieferung ? 'text-amber-400' : 'text-slate-500'}`}>
              {isLieferung
                ? 'Außerhalb der Geschäftsräume bzw. Fernabsatz → 14 Tage Widerrufsrecht. Der Vertrag bekommt Seite 2 mit Widerrufsbelehrung, Muster-Formular und Empfangsbestätigung.'
                : 'Vertragsschluss in den Geschäftsräumen → einseitiger Vertrag ohne Widerrufsbelehrung.'}
            </p>
          </div>

          {/* Fehlende Pflichtangaben der Lieferungs-Variante deutlich anzeigen */}
          {isLieferung && missing.length > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-300 leading-relaxed">
                <span className="font-bold">Noch offen:</span> {missing.join(', ')}.
                <span className="block text-amber-400/80 mt-1">
                  Ohne vollständige Belehrung verlängert sich die Widerrufsfrist auf 12 Monate + 14 Tage.
                </span>
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {renderField('Käufer — Name, Vorname', 'kaeuferName', { wide: true })}
            {renderField('Anschrift (Straße, PLZ, Ort)', 'kaeuferAnschrift', { wide: true })}
            {renderField('Telefon', 'kaeuferKontakt')}
            {renderField(isLieferung ? 'E-Mail des Käufers *' : 'E-Mail des Käufers', 'kaeuferEmail', {
              placeholder: isLieferung ? 'für die Widerrufserklärung' : '',
            })}
            {renderField('Kaufpreis (€)', 'verkaufspreis', { placeholder: 'leer = Ziel-VK / VK' })}
            {renderField('Zahlweise', 'zahlweise', { placeholder: 'bar / Überweisung' })}
            {renderField('Ort des Vertragsschlusses', 'ort', {
              placeholder: isLieferung ? 'Lieferadresse / Ort eintragen' : 'z.B. Braunschweig',
              wide: true,
            })}
            {isLieferung && renderField('Lieferadresse (Straße, PLZ, Ort) *', 'lieferadresse', { wide: true })}
            {isLieferung && renderField('Datum des Vertragsschlusses *', 'vertragsschlussDatum', { type: 'date' })}
            {renderField(
              isLieferung ? 'Übergabe / Warenerhalt * (Fristbeginn)' : 'Übergabedatum',
              'datum',
              { type: 'date' },
            )}
            {isLieferung && renderField('Geschätzte Rücksendekosten', 'ruecksendekosten', {
              placeholder: DEFAULT_RUECKSENDEKOSTEN,
              wide: true,
            })}
          </div>
        </div>
      )}
    </div>
  );
}
