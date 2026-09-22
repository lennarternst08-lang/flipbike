import React from 'react';
import { Megaphone, Monitor, Store } from 'lucide-react';
import { Input } from './ui/input';
import type { AcquisitionSource } from '../types';

// Woher ein Rad kam. Oben die grobe Wahl (Flyer oder nicht), bei "nicht" darunter die
// Feinwahl Kleinanzeigen / Andere – bei "Andere" mit einem kurzen Freitext wie
// "Flohmarkt". Eine Komponente für alle drei Stellen (Neu-Dialog, Zeilenmenü,
// Konvolut-Dialog), damit die Auswahl überall gleich funktioniert.

export interface Akquise {
  source: AcquisitionSource;
  /** Nur bei source 'andere' von Bedeutung, sonst leer. */
  note: string;
}

/** Klartext für Tooltips, Log-Zeilen und Exporte. */
export function akquiseLabel(source?: AcquisitionSource | null, note?: string | null): string {
  if (source === 'flyer') return 'Flyer';
  if (source === 'kleinanzeigen') return 'Kleinanzeigen';
  if (source === 'andere') return note && note.trim() ? note.trim() : 'Andere';
  return 'unbekannt';
}

/** Das kleine Symbol in der Src-Spalte. */
export function AkquiseIcon({ source, note, className = 'w-3.5 h-3.5' }: {
  source?: AcquisitionSource | null;
  note?: string | null;
  className?: string;
}) {
  const titel = akquiseLabel(source, note);
  if (source === 'flyer') return <span title="Flyer-Akquise"><Megaphone className={`${className} text-emerald-400 inline-block`} /></span>;
  if (source === 'kleinanzeigen') return <span title="Kleinanzeigen"><Monitor className={`${className} text-blue-400 inline-block`} /></span>;
  if (source === 'andere') return <span title={titel}><Store className={`${className} text-violet-400 inline-block`} /></span>;
  return null;
}

export function AkquiseAuswahl({ value, onChange, kompakt = false }: {
  value: Akquise;
  onChange: (next: Akquise) => void;
  /** Kleinere Variante für das Drei-Punkte-Menü der Tabelle. */
  kompakt?: boolean;
}) {
  const nichtFlyer = value.source !== 'flyer';
  const knopf = kompakt
    ? 'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded transition-colors'
    : 'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors';
  const aus = kompakt
    ? 'bg-slate-700 text-slate-400 hover:text-white hover:bg-slate-600'
    : 'text-slate-400 hover:text-slate-300';
  const icon = kompakt ? 'w-3 h-3' : 'w-3.5 h-3.5';
  // Beim Klick auf den Kleinanzeigen-Knopf eine vorher gewählte "Andere"-Quelle
  // nicht überschreiben – sonst wäre der Freitext bei jedem Antippen weg.
  const waehleNichtFlyer = () => {
    if (!nichtFlyer) onChange({ source: 'kleinanzeigen', note: '' });
  };

  return (
    <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
      <div className={kompakt ? 'flex gap-1' : 'flex bg-slate-800 p-1 rounded-lg border border-slate-700'}>
        <button
          type="button"
          onClick={() => onChange({ source: 'flyer', note: '' })}
          className={`${knopf} ${value.source === 'flyer' ? 'bg-emerald-600 text-white shadow' : aus}`}
        >
          <Megaphone className={icon} /> {kompakt ? 'Flyer' : 'Flyer-Akquise'}
        </button>
        <button
          type="button"
          onClick={waehleNichtFlyer}
          className={`${knopf} ${nichtFlyer ? 'bg-blue-600 text-white shadow' : aus}`}
        >
          <Monitor className={icon} /> {kompakt ? 'KA / Andere' : 'Kleinanzeigen'}
        </button>
      </div>

      {nichtFlyer && (
        <div className={kompakt ? 'space-y-1' : 'space-y-2 pl-3 border-l-2 border-blue-500/30'}>
          <div className={kompakt ? 'flex gap-1' : 'flex bg-slate-800/60 p-1 rounded-lg border border-slate-700/60'}>
            <button
              type="button"
              onClick={() => onChange({ source: 'kleinanzeigen', note: '' })}
              className={`${knopf} ${value.source === 'kleinanzeigen' ? 'bg-blue-600/80 text-white' : aus}`}
            >
              <Monitor className={icon} /> Kleinanzeigen
            </button>
            <button
              type="button"
              onClick={() => onChange({ source: 'andere', note: value.source === 'andere' ? value.note : '' })}
              className={`${knopf} ${value.source === 'andere' ? 'bg-violet-600 text-white' : aus}`}
            >
              <Store className={icon} /> Andere
            </button>
          </div>
          {value.source === 'andere' && (
            <Input
              value={value.note}
              onChange={(e) => onChange({ source: 'andere', note: e.target.value })}
              placeholder="Wo? z.B. Flohmarkt"
              maxLength={60}
              autoFocus
              className={kompakt ? 'h-8 text-xs bg-slate-900 border-slate-600' : 'bg-slate-800 border-slate-700'}
            />
          )}
        </div>
      )}
    </div>
  );
}
