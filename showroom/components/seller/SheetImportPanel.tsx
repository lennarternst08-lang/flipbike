import { useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ClipboardCopy,
  Download,
  FileJson,
  Sparkles,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';

import type { BikeLike } from '../../lib/listing';
import type { ShowroomListing } from '../../types';
import {
  bikeSheetExample,
  bikeSheetPrompt,
  parseBikeSheet,
  type SheetEntryResult,
} from '../../lib/bikeSheet';
import { downloadJson } from '../../lib/storage';
import { copyToClipboard } from '../../lib/share';
import { formatPrice } from '../../lib/listing';

// ============================================================================
// Steckbrief hochladen
// ----------------------------------------------------------------------------
// Der zweite Weg zu einer Anzeige, neben "Aus der Werkstatt übernehmen":
// eine KI sieht sich die Fotos an, schreibt einen Steckbrief, der hier
// hochgeladen wird. Bewusst mit Zwischenschritt – erst zeigen, was verstanden
// wurde, dann anlegen. Ein Import, der ungefragt zwölf Anzeigen erzeugt, wäre
// schlimmer als Tippen.
// ============================================================================

export interface SheetImportPanelProps {
  bikes: BikeLike[];
  takenSlugs: string[];
  onImport: (listings: ShowroomListing[]) => void;
}

export function SheetImportPanel({ bikes, takenSlugs, onImport }: SheetImportPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<SheetEntryResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'prompt' | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [pasted, setPasted] = useState('');
  const [showPaste, setShowPaste] = useState(false);

  const bikeNames = bikes.map((b) => b.name);

  const read = (text: string) => {
    const result = parseBikeSheet(text, { bikes, takenSlugs });
    if (!result.ok) {
      setError(result.error ?? 'Die Datei konnte nicht gelesen werden.');
      setEntries(null);
      return;
    }
    setError(null);
    setEntries(result.entries);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => read(String(reader.result ?? ''));
    reader.onerror = () => setError('Die Datei ließ sich nicht öffnen.');
    reader.readAsText(file);
    // Damit dieselbe Datei zweimal hintereinander gewählt werden kann.
    e.target.value = '';
  };

  const copyPrompt = async () => {
    const ok = await copyToClipboard(bikeSheetPrompt(bikeNames));
    if (ok) {
      setCopied('prompt');
      setTimeout(() => setCopied(null), 2000);
    }
  };

  const confirmImport = () => {
    if (!entries) return;
    onImport(entries.map((e) => e.listing));
    setEntries(null);
    setPasted('');
    setShowPaste(false);
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4" style={{ color: 'var(--sr-accent)' }} />
        <h3 className="sr-display text-lg font-semibold">Steckbrief hochladen</h3>
      </div>

      <div className="sr-panel-flat p-4 flex flex-col gap-4">
        <p className="text-sm" style={{ color: 'var(--sr-muted)' }}>
          Lass eine KI die Fotos eines Rads ansehen und daraus einen Steckbrief schreiben. Die
          Datei lädst du hier hoch – Eckdaten, Beschreibung, Mängel und die Punkte im Bild sind
          dann schon gesetzt. Du prüfst nur noch nach.
        </p>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={copyPrompt} className="sr-btn sr-btn-primary">
            {copied === 'prompt' ? <Check className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}
            {copied === 'prompt' ? 'Kopiert' : 'Anleitung für die KI kopieren'}
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="sr-btn sr-btn-ghost"
          >
            <Upload className="w-4 h-4" />
            Datei hochladen
          </button>
          <button
            type="button"
            onClick={() => setShowPaste((v) => !v)}
            className="sr-btn sr-btn-quiet"
          >
            <FileJson className="w-4 h-4" />
            Text einfügen
          </button>
          <button
            type="button"
            onClick={() => downloadJson('rad-steckbrief-beispiel.json', bikeSheetExample())}
            className="sr-btn sr-btn-quiet"
          >
            <Download className="w-4 h-4" />
            Beispieldatei
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".json,.txt,application/json,text/plain"
          onChange={handleFile}
          className="hidden"
        />

        {/* Der Weg ohne Datei: Antwort der KI direkt aus der Zwischenablage. */}
        {showPaste && (
          <div className="flex flex-col gap-2">
            <label className="sr-label" htmlFor="sr-sheet-paste">
              Antwort der KI hier einfügen
            </label>
            <textarea
              id="sr-sheet-paste"
              className="sr-textarea font-mono"
              style={{ minHeight: 140, fontSize: 12 }}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder='{ "format": "fahrrad-steckbrief", ... }'
            />
            <div>
              <button
                type="button"
                onClick={() => read(pasted)}
                disabled={!pasted.trim()}
                className="sr-btn sr-btn-ghost"
              >
                <FileJson className="w-4 h-4" />
                Einlesen
              </button>
            </div>
          </div>
        )}

        {/* Anleitung zum Nachlesen, ohne dass man sie erst kopieren muss. */}
        <div>
          <button
            type="button"
            onClick={() => setShowPrompt((v) => !v)}
            className="sr-btn sr-btn-quiet"
            style={{ padding: '6px 8px', fontSize: 13 }}
          >
            <ChevronDown
              className="w-4 h-4"
              style={{ transform: showPrompt ? 'rotate(180deg)' : undefined }}
            />
            {showPrompt ? 'Anleitung ausblenden' : 'Anleitung ansehen'}
          </button>
          {showPrompt && (
            <pre
              className="sr-inset sr-scroll mt-2 p-3 overflow-x-auto whitespace-pre-wrap"
              style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--sr-muted)', maxHeight: 300 }}
            >
              {bikeSheetPrompt(bikeNames)}
            </pre>
          )}
        </div>

        {error && (
          <div
            className="flex items-start gap-2 p-3 rounded-lg text-sm"
            style={{
              background: 'rgba(212, 105, 95, 0.1)',
              border: '1px solid rgba(212, 105, 95, 0.3)',
              color: 'var(--sr-bad)',
            }}
          >
            <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Das hat nicht geklappt</div>
              <div className="mt-0.5">{error}</div>
            </div>
          </div>
        )}

        {/* Vorschau: erst zeigen, was ankommt, dann anlegen. */}
        {entries && (
          <div className="flex flex-col gap-3 sr-fade-in">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">
                {entries.length === 1 ? '1 Rad gefunden' : `${entries.length} Räder gefunden`}
              </div>
              <button
                type="button"
                onClick={() => setEntries(null)}
                className="sr-btn sr-btn-quiet"
                style={{ padding: '5px 8px', fontSize: 12 }}
              >
                <X className="w-4 h-4" />
                Verwerfen
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {entries.map((entry) => (
                <div key={entry.listing.id} className="sr-inset p-3 flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="font-semibold text-sm">{entry.listing.title}</div>
                    <div className="text-sm" style={{ color: 'var(--sr-accent)' }}>
                      {formatPrice(entry.listing.price, entry.listing.priceType)}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {entry.matchedBikeName ? (
                      <span className="sr-chip sr-chip-good">
                        {entry.matchedBikeName} · {entry.photoCount}{' '}
                        {entry.photoCount === 1 ? 'Foto' : 'Fotos'}
                      </span>
                    ) : (
                      <span className="sr-chip">Ohne Rad aus der Werkstatt</span>
                    )}
                    {entry.hotspotCount > 0 && (
                      <span className="sr-chip sr-chip-accent">
                        {entry.hotspotCount} Bildpunkte
                      </span>
                    )}
                    {entry.listing.defects.length > 0 && (
                      <span className="sr-chip sr-chip-bad">
                        {entry.listing.defects.length} Mängel
                      </span>
                    )}
                    {entry.listing.extras.length > 0 && (
                      <span className="sr-chip">{entry.listing.extras.length} Zubehör</span>
                    )}
                  </div>

                  {entry.warnings.length > 0 && (
                    <ul className="text-xs flex flex-col gap-1" style={{ color: 'var(--sr-warn)' }}>
                      {entry.warnings.map((w, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <TriangleAlert className="w-3 h-3 shrink-0 mt-0.5" />
                          <span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={confirmImport} className="sr-btn sr-btn-primary">
                <Check className="w-4 h-4" />
                {entries.length === 1
                  ? 'Als Entwurf anlegen'
                  : `${entries.length} Entwürfe anlegen`}
              </button>
              <span className="text-xs" style={{ color: 'var(--sr-faint)' }}>
                Wird als Entwurf angelegt – online geht nichts ohne deinen Klick.
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default SheetImportPanel;
