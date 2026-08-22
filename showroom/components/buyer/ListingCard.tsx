import React, { useRef } from 'react';
import { Bike, Crosshair, Eye, Heart, MapPin } from 'lucide-react';

import type { ShowroomListing } from '../../types';
import type { BikeLike } from '../../lib/listing';
import { coverPhoto, formatPrice, relativeDate } from '../../lib/listing';
import { CATEGORY_LABELS, CONDITION_LABELS, STATUS_LABELS } from '../../config/seller';

// ============================================================================
// Eine Anzeige im Schaufenster
// ----------------------------------------------------------------------------
// Die Karte ist bewusst ein Objekt im Raum und keine Tabellenzeile: sie kippt
// leicht zum Mauszeiger, das Bild liegt darüber und spiegelt sich nach unten.
// Das Kippen läuft über einen Ref direkt am style-Attribut – ginge es über
// State, würde die Karte bei jeder Mausbewegung neu rendern.
// ============================================================================

export interface ListingCardProps {
  listing: ShowroomListing;
  bike?: BikeLike | null;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  onOpen: (listing: ShowroomListing) => void;
}

const MAX_TILT = 6;

export function ListingCard({
  listing,
  bike,
  isFavorite,
  onToggleFavorite,
  onOpen,
}: ListingCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  const cover = coverPhoto(listing, bike);
  const sold = listing.status === 'verkauft';
  const veiled = listing.status !== 'online';
  const hotspotCount = (listing.hotspots ?? []).length;

  const facts = [
    listing.frameSize ? `RH ${listing.frameSize}` : null,
    listing.wheelSize || null,
    listing.gearCount ? `${listing.gearCount} Gänge` : null,
  ].filter((f): f is string => !!f);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    // Wer Bewegung abgestellt hat, bekommt auch keine Neigung.
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const rect = el.getBoundingClientRect();
    const dx = (e.clientX - rect.left) / rect.width - 0.5;
    const dy = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform =
      `rotateX(${(-dy * MAX_TILT).toFixed(2)}deg) ` +
      `rotateY(${(dx * MAX_TILT).toFixed(2)}deg) translateY(-6px)`;
  };

  const handleLeave = () => {
    // Leer setzen statt "none": so greift wieder der Hover-Zustand aus der CSS.
    if (cardRef.current) cardRef.current.style.transform = '';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(listing);
    }
  };

  return (
    <div className="sr-stage">
      <div
        ref={cardRef}
        role="button"
        tabIndex={0}
        aria-label={`Anzeige öffnen: ${listing.title || 'Fahrrad'}`}
        onClick={() => onOpen(listing)}
        onKeyDown={handleKeyDown}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        className="sr-card3d sr-panel relative flex h-full w-full cursor-pointer flex-col text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-accent)]"
      >
        {/* --- Bild ---------------------------------------------------- */}
        <div className="sr-lift relative">
          <div className="relative overflow-hidden rounded-t-[15px]">
            {cover ? (
              <img
                src={cover}
                alt={listing.title || 'Gebrauchtes Fahrrad'}
                loading="lazy"
                className={`w-full aspect-[4/3] object-cover ${sold ? 'grayscale' : ''}`}
              />
            ) : (
              <div
                className="w-full aspect-[4/3] grid place-items-center gap-2"
                style={{ background: 'linear-gradient(180deg, #0b0a09 0%, #141110 100%)' }}
              >
                <Bike className="w-8 h-8" style={{ color: 'var(--sr-faint)' }} />
                <span className="text-xs" style={{ color: 'var(--sr-faint)' }}>
                  Noch kein Foto
                </span>
              </div>
            )}

            {veiled && (
              <div className="absolute inset-0 grid place-items-center bg-black/55">
                <span className={`sr-chip ${sold ? 'sr-chip-bad' : 'sr-chip-warn'}`}>
                  {STATUS_LABELS[listing.status]}
                </span>
              </div>
            )}

            {listing.featured && (
              <span className="sr-chip sr-chip-accent absolute top-3 left-3">Empfehlung</span>
            )}

            {hotspotCount > 0 && (
              <span
                className="sr-chip absolute bottom-3 left-3"
                style={{ background: 'rgba(0, 0, 0, 0.62)' }}
              >
                <Crosshair className="w-3.5 h-3.5" />
                {hotspotCount} {hotspotCount === 1 ? 'Detail' : 'Details'} im Bild
              </span>
            )}

            <button
              type="button"
              aria-label={isFavorite ? 'Von der Merkliste nehmen' : 'Auf die Merkliste'}
              aria-pressed={isFavorite}
              onClick={(e) => {
                // Sonst öffnet sich beim Merken gleich die ganze Anzeige.
                e.stopPropagation();
                onToggleFavorite(listing.id);
              }}
              className="absolute top-3 right-3 grid h-9 w-9 place-items-center rounded-full border bg-black/55 backdrop-blur-sm transition-colors"
              style={{ borderColor: isFavorite ? 'var(--sr-accent-line)' : 'var(--sr-line)' }}
            >
              <Heart
                className="w-4 h-4"
                style={{ color: isFavorite ? 'var(--sr-accent)' : 'var(--sr-muted)' }}
                fill={isFavorite ? 'currentColor' : 'none'}
              />
            </button>
          </div>

          {/* Spiegelung auf dem "Ladenboden" – rein dekorativ. */}
          {cover && (
            <div className="h-9 overflow-hidden" aria-hidden="true">
              <img
                src={cover}
                alt=""
                aria-hidden="true"
                className="sr-reflect w-full aspect-[4/3] object-cover"
              />
            </div>
          )}
        </div>

        {/* --- Text ---------------------------------------------------- */}
        <div className="flex flex-1 flex-col gap-2 px-4 pb-4 pt-1">
          <div className="sr-display sr-brass text-2xl font-semibold leading-none">
            {formatPrice(listing.price, listing.priceType)}
          </div>

          <h3 className="sr-display text-base font-semibold leading-snug">
            {listing.title || 'Ohne Titel'}
          </h3>

          {facts.length > 0 && (
            <p className="text-xs" style={{ color: 'var(--sr-muted)' }}>
              {facts.join(' · ')}
            </p>
          )}

          <div className="flex flex-wrap gap-1.5 pt-1">
            <span className="sr-chip">{CATEGORY_LABELS[listing.category]}</span>
            <span className="sr-chip">{CONDITION_LABELS[listing.condition]}</span>
          </div>

          <div
            className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-[11px]"
            style={{ borderColor: 'var(--sr-line-soft)', color: 'var(--sr-faint)' }}
          >
            <span>{relativeDate(listing.publishedAt ?? listing.createdAt)}</span>
            {listing.location?.city && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {listing.location.city}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Eye className="w-3.5 h-3.5" />
              {listing.views}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ListingCard;
