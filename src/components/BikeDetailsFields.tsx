import React, { useEffect, useRef, useState } from 'react';
import { BikeDetails, BikeDefect } from '../types';
import { Input } from './ui/input';
import { Plus, X, AlertTriangle } from 'lucide-react';

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
        <div className="pt-3 border-t border-slate-800">
          <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-3">
            Käufer &amp; Übergabe — für den fertigen Vertrag (optional)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {renderField('Käufer — Name, Vorname', 'kaeuferName', { wide: true })}
            {renderField('Anschrift (Straße, PLZ, Ort)', 'kaeuferAnschrift', { wide: true })}
            {renderField('Telefon / E-Mail', 'kaeuferKontakt', { wide: true })}
            {renderField('Kaufpreis (€)', 'verkaufspreis', { placeholder: 'leer = Ziel-VK / VK' })}
            {renderField('Zahlweise', 'zahlweise', { placeholder: 'bar / Überweisung' })}
            {renderField('Übergabeort', 'ort', { placeholder: 'z.B. Braunschweig' })}
            {renderField('Übergabedatum', 'datum', { type: 'date' })}
          </div>
        </div>
      )}
    </div>
  );
}
