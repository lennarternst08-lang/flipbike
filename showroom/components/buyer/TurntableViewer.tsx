import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Bike, ChevronLeft, ChevronRight, Info, Pause, RotateCw, X } from 'lucide-react';

// ============================================================================
// Drehteller-Ansicht ("fast 3D")
// ----------------------------------------------------------------------------
// Kein 3D-Modell, sondern die vorhandenen Fotos in schneller Folge: zieht man
// waagerecht über das Bild, wandert man durch die Reihe und das Rad wirkt, als
// stünde es auf einem Drehteller. Das kostet nichts extra – die Bilder sind
// ohnehin schon da – und ist genau das, was man bei einem Gebrauchtrad sehen
// will: die Seite, die auf dem Titelbild nicht zu sehen ist.
// ============================================================================

export interface TurntableViewerProps {
  photos: string[];
  startIndex?: number;
  alt?: string;
  onExit?: () => void;
}

/** Läuft umlaufend, auch rückwärts (-1 wird zum letzten Bild). */
function wrapIndex(i: number, len: number): number {
  if (len <= 0) return 0;
  return ((i % len) + len) % len;
}

export function TurntableViewer({
  photos,
  startIndex = 0,
  alt = 'Fahrrad in der Drehansicht',
  onExit,
}: TurntableViewerProps) {
  const frames = photos ?? [];
  const count = frames.length;

  const [index, setIndex] = useState(() => wrapIndex(startIndex, count));
  const [spinning, setSpinning] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);

  const drag = useRef<{ active: boolean; startX: number; startIndex: number }>({
    active: false,
    startX: 0,
    startIndex: 0,
  });

  useEffect(() => {
    setIndex(wrapIndex(startIndex, count));
  }, [startIndex, count]);

  useEffect(() => {
    if (!spinning || count < 2) return;
    const id = window.setInterval(() => {
      setIndex((i) => wrapIndex(i + 1, count));
    }, 120);
    return () => window.clearInterval(id);
  }, [spinning, count]);

  useEffect(() => {
    if (!hintVisible) return;
    const t = window.setTimeout(() => setHintVisible(false), 5000);
    return () => window.clearTimeout(t);
  }, [hintVisible]);

  function step(delta: number) {
    setSpinning(false);
    setHintVisible(false);
    setIndex((i) => wrapIndex(i + delta, count));
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (count < 2) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { active: true, startX: e.clientX, startIndex: index };
    setSpinning(false);
    setHintVisible(false);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current.active || count < 2) return;
    const width = e.currentTarget.getBoundingClientRect().width || 1;
    // Eine volle Breite entspricht einer vollen Umdrehung; unter 14 Pixel pro
    // Bild wird es auf dem Handy zu zappelig.
    const perFrame = Math.max(14, width / count);
    const moved = Math.round((e.clientX - drag.current.startX) / perFrame);
    setIndex(wrapIndex(drag.current.startIndex - moved, count));
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current.active) return;
    drag.current.active = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  if (count === 0) {
    return (
      <div className="sr-inset w-full grid place-items-center gap-2 py-16">
        <Bike className="w-8 h-8" style={{ color: 'var(--sr-faint)' }} />
        <span className="text-sm" style={{ color: 'var(--sr-faint)' }}>
          Noch kein Foto
        </span>
      </div>
    );
  }

  const tooFewFrames = count < 3;
  // Die Bildzahl kann sich ändern, bevor der Effekt oben nachzieht.
  const safeIndex = wrapIndex(index, count);

  return (
    <div>
      <div
        className="relative overflow-hidden rounded-xl select-none"
        style={{ touchAction: 'pan-y', cursor: count > 1 ? 'ew-resize' : 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        <img
          src={frames[safeIndex]}
          alt={`${alt} – Bild ${safeIndex + 1} von ${count}`}
          className="block w-full h-auto pointer-events-none"
          draggable={false}
        />

        {onExit && (
          <button
            type="button"
            onClick={onExit}
            className="sr-btn sr-btn-ghost absolute top-2 right-2"
            style={{ padding: '7px 12px', background: 'rgba(10,9,8,0.78)' }}
            aria-label="Drehansicht schließen"
          >
            <X className="w-4 h-4" />
            Schließen
          </button>
        )}

        {hintVisible && count > 1 && (
          <div
            className="sr-chip absolute left-2 bottom-2"
            style={{ background: 'rgba(10,9,8,0.78)' }}
          >
            <RotateCw className="w-4 h-4" style={{ color: 'var(--sr-accent)' }} />
            Zum Drehen ziehen
          </div>
        )}
      </div>

      {tooFewFrames && (
        <p
          className="mt-2 flex items-start gap-2 text-xs leading-snug"
          style={{ color: 'var(--sr-warn)' }}
        >
          <Info className="w-4 h-4 shrink-0 mt-px" />
          Für die Drehansicht braucht es mindestens 3 Fotos.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={count < 2}
            className="sr-btn sr-btn-ghost"
            style={{ padding: '8px 10px' }}
            aria-label="Ein Bild zurück"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setHintVisible(false);
              setSpinning((s) => !s);
            }}
            disabled={count < 2}
            className={`sr-btn ${spinning ? 'sr-btn-primary' : 'sr-btn-ghost'}`}
          >
            {spinning ? <Pause className="w-4 h-4" /> : <RotateCw className="w-4 h-4" />}
            {spinning ? 'Anhalten' : 'Automatisch drehen'}
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={count < 2}
            className="sr-btn sr-btn-ghost"
            style={{ padding: '8px 10px' }}
            aria-label="Ein Bild weiter"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {count <= 12 ? (
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {frames.map((_, i) => (
              <span
                key={i}
                className="rounded-full"
                style={{
                  width: i === safeIndex ? 8 : 6,
                  height: i === safeIndex ? 8 : 6,
                  background: i === safeIndex ? 'var(--sr-accent)' : 'var(--sr-line)',
                }}
              />
            ))}
          </div>
        ) : (
          <span className="text-xs font-semibold" style={{ color: 'var(--sr-muted)' }}>
            {safeIndex + 1} / {count}
          </span>
        )}
      </div>

      {/* Ohne Vorladen ruckelt der erste Umlauf spürbar. */}
      <div
        aria-hidden="true"
        className="absolute w-px h-px overflow-hidden opacity-0 pointer-events-none"
        style={{ left: -9999, top: -9999 }}
      >
        {frames.map((p, i) => (
          <img key={i} src={p} alt="" loading="eager" />
        ))}
      </div>
    </div>
  );
}

export default TurntableViewer;
