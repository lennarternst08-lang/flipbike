import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Bike, Crosshair } from 'lucide-react';

import type { Hotspot } from '../../types';

// ============================================================================
// Bild mit beschrifteten Punkten (nur lesen)
// ----------------------------------------------------------------------------
// Der wichtigste Teil des Showrooms: statt einer Textwüste sieht der Käufer
// direkt im Foto, was verbaut ist und wo es hakt. Die Punkte liegen relativ
// (0..1) im Bild, damit sie auf jedem Bildschirm an derselben Stelle sitzen.
// Auf dem Handy sind 26-Pixel-Punkte schwer zu treffen – deshalb steht unter
// dem Bild dieselbe Auswahl noch einmal als Chip-Reihe.
// ============================================================================

export interface HotspotViewerProps {
  src: string;
  /** Bereits auf dieses Foto gefiltert (siehe `hotspotsForPhoto`). */
  hotspots: Hotspot[];
  alt?: string;
  className?: string;
  autoReveal?: boolean;
}

export function HotspotViewer({
  src,
  hotspots,
  alt = 'Foto des Fahrrads',
  className = '',
  autoReveal = false,
}: HotspotViewerProps) {
  const points = hotspots ?? [];

  /** Fest angeklickt – bleibt stehen, bis man erneut klickt. */
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  /** Nur überfahren (Maus) – flüchtig. */
  const [hoverId, setHoverId] = useState<string | null>(null);
  /** Kurzes Aufblitzen beim ersten Anzeigen. */
  const [flashId, setFlashId] = useState<string | null>(null);

  // Stabiler Schlüssel: die Punktliste wird oft frisch berechnet übergeben,
  // die Effekte dürfen davon aber nicht bei jedem Rendern neu anlaufen.
  const pointKey = points.map((p) => p.id).join('|');

  useEffect(() => {
    setPinnedId(null);
    setHoverId(null);
  }, [src, pointKey]);

  useEffect(() => {
    if (!autoReveal || points.length === 0) return;
    if (typeof window === 'undefined') return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    const timers: number[] = [];
    points.forEach((h, i) => {
      timers.push(window.setTimeout(() => setFlashId(h.id), 350 + i * 520));
    });
    timers.push(window.setTimeout(() => setFlashId(null), 350 + points.length * 520));
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoReveal, pointKey]);

  const activeId = pinnedId ?? hoverId ?? flashId;
  const active = points.find((p) => p.id === activeId) ?? null;
  const activeNumber = active ? points.indexOf(active) + 1 : 0;

  function toggle(id: string) {
    setFlashId(null);
    setPinnedId((prev) => (prev === id ? null : id));
  }

  function onPointKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, id: string) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    // Verhindert, dass der Browser zusätzlich sein eigenes Klick-Ereignis auslöst.
    e.preventDefault();
    toggle(id);
  }

  return (
    <div className={className}>
      <div className="relative overflow-hidden rounded-xl">
        {src ? (
          <img
            src={src}
            alt={alt}
            className="block w-full h-auto select-none"
            draggable={false}
          />
        ) : (
          <div
            className="w-full grid place-items-center gap-2 py-16"
            style={{ background: 'var(--sr-ink-2)' }}
          >
            <Bike className="w-8 h-8" style={{ color: 'var(--sr-faint)' }} />
            <span className="text-sm" style={{ color: 'var(--sr-faint)' }}>
              Noch kein Foto
            </span>
          </div>
        )}

        {src && points.length > 0 && (
          <div
            className="absolute top-2 right-2 sr-chip"
            style={{ background: 'rgba(10,9,8,0.78)' }}
          >
            <Crosshair className="w-4 h-4" style={{ color: 'var(--sr-accent)' }} />
            {points.length} {points.length === 1 ? 'Detail' : 'Details'}
          </div>
        )}

        {src &&
          points.map((h, i) => {
            const isActive = h.id === activeId;
            return (
              <button
                key={h.id}
                type="button"
                className="sr-hotspot"
                data-tone={h.tone ?? 'neutral'}
                data-active={isActive ? 'true' : 'false'}
                style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%` }}
                onClick={() => toggle(h.id)}
                onKeyDown={(e) => onPointKeyDown(e, h.id)}
                onMouseEnter={() => setHoverId(h.id)}
                onMouseLeave={() => setHoverId((prev) => (prev === h.id ? null : prev))}
                aria-pressed={isActive}
                aria-label={`Punkt ${i + 1}: ${h.label}${h.value ? `, ${h.value}` : ''}`}
              >
                {i + 1}
              </button>
            );
          })}

        {src && active && (
          <div
            className="sr-hotspot-tip"
            style={{
              left: `${active.x * 100}%`,
              top: `${active.y * 100}%`,
              // Nah am rechten/unteren Rand kippt die Blase nach innen,
              // sonst läuft sie aus dem Bild heraus.
              transform: `translate(${
                active.x > 0.6 ? 'calc(-100% + 16px)' : '-16px'
              }, ${active.y > 0.7 ? 'calc(-100% - 20px)' : '20px'})`,
            }}
          >
            <div className="text-sm font-bold leading-tight">
              <span style={{ color: 'var(--sr-accent)' }}>{activeNumber}. </span>
              {active.label}
            </div>
            {active.value && (
              <div className="text-xs mt-1 leading-snug" style={{ color: 'var(--sr-muted)' }}>
                {active.value}
              </div>
            )}
          </div>
        )}
      </div>

      {points.length > 0 && (
        <div className="mt-3">
          <div className="sr-eyebrow mb-2">Im Bild beschriftet</div>
          <div className="flex flex-wrap gap-2">
            {points.map((h, i) => (
              <button
                key={h.id}
                type="button"
                onClick={() => toggle(h.id)}
                className={`sr-chip ${h.id === activeId ? 'sr-chip-accent' : ''}`}
                aria-pressed={h.id === activeId}
              >
                <span
                  className="w-4 h-4 rounded-full grid place-items-center text-[10px] font-extrabold"
                  style={{
                    background:
                      h.tone === 'defect'
                        ? 'var(--sr-bad)'
                        : h.tone === 'highlight'
                          ? 'var(--sr-accent)'
                          : 'var(--sr-line)',
                    color: h.tone === 'neutral' || !h.tone ? 'var(--sr-text)' : '#17110a',
                  }}
                >
                  {i + 1}
                </span>
                {h.label}
              </button>
            ))}
          </div>
          {active?.value && (
            <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--sr-muted)' }}>
              {active.value}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default HotspotViewer;
