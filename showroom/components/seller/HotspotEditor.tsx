import React, { useEffect, useRef, useState } from 'react';
import { Crosshair, ImagePlus, MousePointer2, Trash2 } from 'lucide-react';

import type { Hotspot, HotspotTone } from '../../types';
import { HOTSPOT_PRESETS } from '../../config/seller';
import { newId } from '../../lib/listing';

// ============================================================================
// Bildpunkte setzen und beschriften
// ----------------------------------------------------------------------------
// Koordinaten werden relativ (0..1) zur Bildfläche gespeichert. Nur so sitzt ein
// Punkt auf dem Handy an derselben Stelle wie am Rechner, egal wie breit das
// Bild gerade dargestellt wird.
// ============================================================================

export interface HotspotEditorProps {
  photos: string[];
  photoIndex: number;
  hotspots: Hotspot[];
  onChange: (hotspots: Hotspot[]) => void;
  onPhotoIndexChange: (index: number) => void;
}

type EditorMode = 'setzen' | 'bearbeiten';

const TONE_ORDER: HotspotTone[] = ['neutral', 'highlight', 'defect'];

const TONE_LABELS: Record<HotspotTone, string> = {
  neutral: 'Neutral',
  highlight: 'Hervorheben',
  defect: 'Mangel',
};

const TONE_COLORS: Record<HotspotTone, string> = {
  neutral: 'var(--sr-muted)',
  highlight: 'var(--sr-accent)',
  defect: 'var(--sr-bad)',
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function HotspotEditor({
  photos,
  photoIndex,
  hotspots,
  onChange,
  onPhotoIndexChange,
}: HotspotEditorProps) {
  const [mode, setMode] = useState<EditorMode>('setzen');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wantsFocus, setWantsFocus] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLInputElement | null>(null);
  // Im Ref statt im State: beim Ziehen darf kein Rendern dazwischenfunken.
  const dragRef = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(
    null,
  );

  const safeIndex = photos.length ? Math.min(Math.max(0, photoIndex), photos.length - 1) : 0;
  const all = hotspots ?? [];
  const current = all.filter((h) => h.photoIndex === safeIndex);
  const selected = current.find((h) => h.id === selectedId) ?? null;

  // Ein frisch gesetzter Punkt bekommt sofort den Schreibcursor ins Label-Feld.
  useEffect(() => {
    if (!wantsFocus) return;
    labelRef.current?.focus();
    setWantsFocus(false);
  }, [wantsFocus]);

  const patchHotspot = (id: string, patch: Partial<Hotspot>) => {
    onChange(all.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  };

  const removeHotspot = (id: string) => {
    onChange(all.filter((h) => h.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mode !== 'setzen' || !photos.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const hotspot: Hotspot = {
      id: newId(),
      photoIndex: safeIndex,
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
      label: '',
      tone: 'neutral',
    };
    onChange([...all, hotspot]);
    setSelectedId(hotspot.id);
    setWantsFocus(true);
  };

  const startDrag = (e: React.PointerEvent<HTMLButtonElement>, id: string) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, moved: false };
    setSelectedId(id);
  };

  const moveDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
    // Ein leichtes Zittern beim Antippen soll den Punkt nicht verschieben.
    if (
      !drag.moved &&
      Math.abs(e.clientX - drag.startX) < 4 &&
      Math.abs(e.clientY - drag.startY) < 4
    ) {
      return;
    }
    drag.moved = true;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    patchHotspot(drag.id, {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    });
  };

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
  };

  if (!photos.length) {
    return (
      <div className="sr-panel-flat p-6 text-center">
        <ImagePlus className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--sr-faint)' }} />
        <p className="text-sm" style={{ color: 'var(--sr-muted)' }}>
          Lade zuerst ein Foto hoch, dann kannst du Bauteile beschriften.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Miniaturen: Bild wechseln, mit Anzahl der Punkte je Bild. */}
      <div className="flex gap-2 overflow-x-auto sr-scroll pb-1">
        {photos.map((photo, i) => {
          const count = all.filter((h) => h.photoIndex === i).length;
          const active = i === safeIndex;
          return (
            <button
              key={`${i}-${photo.slice(-24)}`}
              type="button"
              onClick={() => {
                onPhotoIndexChange(i);
                setSelectedId(null);
              }}
              className="relative shrink-0 rounded-lg overflow-hidden"
              style={{
                width: 76,
                height: 58,
                border: `2px solid ${active ? 'var(--sr-accent)' : 'var(--sr-line)'}`,
                opacity: active ? 1 : 0.75,
              }}
              title={`Foto ${i + 1}`}
            >
              <img
                src={photo}
                alt={`Foto ${i + 1} der Anzeige`}
                className="w-full h-full object-cover"
                draggable={false}
              />
              {count > 0 && (
                <span
                  className="absolute right-1 bottom-1 px-1.5 rounded-full text-[10px] font-bold"
                  style={{ background: 'var(--sr-accent)', color: '#17110a' }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Umschalter der beiden Arbeitsweisen */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="sr-inset flex items-center gap-1 p-1">
          {(
            [
              { key: 'setzen' as const, label: 'Punkt setzen', Icon: Crosshair },
              { key: 'bearbeiten' as const, label: 'Bearbeiten', Icon: MousePointer2 },
            ]
          ).map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={`sr-btn ${mode === key ? 'sr-btn-primary' : 'sr-btn-quiet'}`}
              style={{ padding: '7px 12px', fontSize: 13 }}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs" style={{ color: 'var(--sr-faint)' }}>
          {mode === 'setzen'
            ? 'Klick ins Bild, um eine Stelle zu beschriften.'
            : 'Punkte anklicken oder mit dem Finger verschieben.'}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Bildfläche */}
        <div
          ref={stageRef}
          onClick={handleStageClick}
          className="relative select-none sr-inset overflow-hidden"
          style={{ cursor: mode === 'setzen' ? 'crosshair' : 'default' }}
        >
          <img
            src={photos[safeIndex]}
            alt={`Foto ${safeIndex + 1} der Anzeige – zum Beschriften`}
            className="block w-full h-auto"
            draggable={false}
          />
          {current.map((h, i) => (
            <button
              key={h.id}
              type="button"
              className="sr-hotspot"
              data-tone={h.tone ?? 'neutral'}
              data-active={h.id === selectedId ? 'true' : 'false'}
              style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, touchAction: 'none' }}
              onPointerDown={(e) => startDrag(e, h.id)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedId(h.id);
              }}
              title={h.label || `Punkt ${i + 1}`}
              aria-label={`Punkt ${i + 1}${h.label ? `: ${h.label}` : ''}`}
            >
              {i + 1}
            </button>
          ))}
        </div>

        {/* Bearbeitungsfeld des ausgewählten Punkts */}
        <div className="sr-panel-flat p-4">
          {!selected ? (
            <div className="text-sm" style={{ color: 'var(--sr-muted)' }}>
              <p className="sr-eyebrow mb-2">Kein Punkt ausgewählt</p>
              <p>
                Wähle einen Punkt im Bild aus oder setze einen neuen. Beschriftete Stellen
                beantworten genau die Fragen, die sonst per Nachricht kommen.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <span className="sr-label">Schnellauswahl</span>
                <div className="flex flex-wrap gap-1.5">
                  {HOTSPOT_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() =>
                        patchHotspot(selected.id, { label: preset.label, tone: preset.tone })
                      }
                      className={`sr-chip ${
                        preset.tone === 'defect'
                          ? 'sr-chip-bad'
                          : preset.tone === 'highlight'
                            ? 'sr-chip-accent'
                            : ''
                      }`}
                      style={{ cursor: 'pointer' }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="sr-label" htmlFor={`hs-label-${selected.id}`}>
                  Bezeichnung
                </label>
                <input
                  id={`hs-label-${selected.id}`}
                  ref={labelRef}
                  className="sr-input"
                  value={selected.label ?? ''}
                  onChange={(e) => patchHotspot(selected.id, { label: e.target.value })}
                  placeholder="z. B. Schaltung"
                />
              </div>

              <div>
                <label className="sr-label" htmlFor={`hs-value-${selected.id}`}>
                  Wert / Beschreibung
                </label>
                <input
                  id={`hs-value-${selected.id}`}
                  className="sr-input"
                  value={selected.value ?? ''}
                  onChange={(e) => patchHotspot(selected.id, { value: e.target.value })}
                  placeholder="z. B. Shimano Deore, 9-fach"
                />
              </div>

              <div>
                <span className="sr-label">Ton</span>
                <div className="flex gap-1.5">
                  {TONE_ORDER.map((tone) => {
                    const active = (selected.tone ?? 'neutral') === tone;
                    return (
                      <button
                        key={tone}
                        type="button"
                        onClick={() => patchHotspot(selected.id, { tone })}
                        className="sr-btn flex-1"
                        style={{
                          padding: '7px 8px',
                          fontSize: 12,
                          color: active ? '#17110a' : TONE_COLORS[tone],
                          background: active ? TONE_COLORS[tone] : 'rgba(255,255,255,0.04)',
                          borderColor: active ? TONE_COLORS[tone] : 'var(--sr-line)',
                        }}
                      >
                        {TONE_LABELS[tone]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={() => removeHotspot(selected.id)}
                className="sr-btn sr-btn-danger w-full"
              >
                <Trash2 className="w-4 h-4" />
                Punkt löschen
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Alle Punkte dieses Bildes */}
      <div className="sr-panel-flat p-3">
        <p className="sr-eyebrow mb-2">
          Punkte auf Foto {safeIndex + 1} ({current.length})
        </p>
        {current.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--sr-faint)' }}>
            Noch keine Punkte auf diesem Bild.
          </p>
        ) : (
          <ul className="space-y-1">
            {current.map((h, i) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(h.id)}
                  className="w-full flex items-center gap-3 text-left px-2 py-1.5 rounded-lg"
                  style={{
                    background:
                      h.id === selectedId ? 'var(--sr-accent-soft)' : 'rgba(255,255,255,0.02)',
                  }}
                >
                  <span
                    className="w-6 h-6 shrink-0 rounded-full grid place-items-center text-[11px] font-bold"
                    style={{
                      background: TONE_COLORS[h.tone ?? 'neutral'],
                      color: '#17110a',
                    }}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {h.label || <span style={{ color: 'var(--sr-faint)' }}>Ohne Bezeichnung</span>}
                  </span>
                  <span
                    className="hidden sm:block max-w-[45%] truncate text-xs"
                    style={{ color: 'var(--sr-muted)' }}
                  >
                    {h.value ?? ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default HotspotEditor;
