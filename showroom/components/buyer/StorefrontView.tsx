import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  Bike,
  Clock,
  Euro,
  Globe,
  Instagram,
  MapPin,
  MessageCircle,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';

import type {
  BikeCategory,
  LegalPage,
  ListingCondition,
  SellerProfile,
  ShowroomListing,
  ShowroomSettings,
} from '../../types';
import type { InquiryDraft, SubmitResult } from '../../lib/inquiries';
import type { BikeLike, ListingFilter } from '../../lib/listing';
import { filterListings, formatPrice } from '../../lib/listing';
import { CATEGORY_LABELS, CONDITION_LABELS } from '../../config/seller';

import { ListingCard } from './ListingCard';
import { ContactForm } from './ContactForm';

// ============================================================================
// Das Schaufenster – die Startseite für Käufer
// ----------------------------------------------------------------------------
// Genau diese Seite steht später unter der eigenen Domain. Sie soll sich wie
// ein kleiner Laden anfühlen: erst der Eindruck, dann die Räder, dann das
// Gespräch. Gefiltert wird ausschließlich über `filterListings` – die Sortier-
// und Suchregeln liegen damit an einer einzigen Stelle.
// ============================================================================

type SortKey = NonNullable<ListingFilter['sort']>;

export interface StorefrontViewProps {
  listings: ShowroomListing[];
  profile: SellerProfile;
  settings: ShowroomSettings;
  bikeById: (id?: string) => BikeLike | null | undefined;
  favorites: string[];
  onToggleFavorite: (id: string) => void;
  onOpen: (listing: ShowroomListing) => void;
  onOpenLegal: (page: LegalPage) => void;
  onSubmitInquiry: (draft: InquiryDraft) => Promise<SubmitResult>;
}

const SORT_LABELS: Record<SortKey, string> = {
  neueste: 'Neueste zuerst',
  preis_auf: 'Preis aufsteigend',
  preis_ab: 'Preis absteigend',
  beliebt: 'Beliebteste',
};

/** "fahrrad-butz.de" oder "https://…" – beides soll als Link funktionieren. */
function externalHref(value: string): string {
  const v = value.trim();
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

function instagramHref(value: string): string {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  return `https://instagram.com/${v.replace(/^@/, '')}`;
}

function toNumber(value: string): number | null {
  const raw = value.trim().replace(',', '.');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function StorefrontView({
  listings,
  profile,
  settings,
  bikeById,
  favorites,
  onToggleFavorite,
  onOpen,
  onOpenLegal,
  onSubmitInquiry,
}: StorefrontViewProps) {
  const offerRef = useRef<HTMLDivElement | null>(null);
  const contactRef = useRef<HTMLElement | null>(null);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<BikeCategory | 'alle'>('alle');
  const [condition, setCondition] = useState<ListingCondition | 'alle'>('alle');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [sort, setSort] = useState<SortKey>('neueste');

  const filter: ListingFilter = useMemo(
    () => ({
      search,
      category,
      condition,
      minPrice: toNumber(minPrice),
      maxPrice: toNumber(maxPrice),
      onlyAvailable,
      sort,
    }),
    [search, category, condition, minPrice, maxPrice, onlyAvailable, sort],
  );

  const visible = useMemo(() => filterListings(listings, filter), [listings, filter]);

  const filterActive =
    !!search.trim() ||
    category !== 'alle' ||
    condition !== 'alle' ||
    !!minPrice.trim() ||
    !!maxPrice.trim() ||
    onlyAvailable ||
    sort !== 'neueste';

  const resetFilter = () => {
    setSearch('');
    setCategory('alle');
    setCondition('alle');
    setMinPrice('');
    setMaxPrice('');
    setOnlyAvailable(false);
    setSort('neueste');
  };

  // Nur Kategorien anbieten, zu denen es auch wirklich ein Rad gibt.
  const categories = useMemo(() => {
    const seen: BikeCategory[] = [];
    for (const l of listings) if (!seen.includes(l.category)) seen.push(l.category);
    return seen.sort((a, b) => CATEGORY_LABELS[a].localeCompare(CATEGORY_LABELS[b], 'de'));
  }, [listings]);

  const availableCount = useMemo(
    () => listings.filter((l) => l.status === 'online').length,
    [listings],
  );

  /** Spanne vom günstigsten bis zum teuersten Rad – `null`, wenn kein Preis feststeht. */
  const priceRange = useMemo<string | null>(() => {
    const prices = listings
      .map((l) => l.price)
      .filter((p): p is number => typeof p === 'number' && p > 0);
    if (prices.length === 0) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min === max) return formatPrice(min, 'fest');
    return `${formatPrice(min, 'fest')} – ${formatPrice(max, 'fest')}`;
  }, [listings]);

  const scrollTo = (ref: React.RefObject<HTMLElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const stats: { label: string; value: string }[] = [
    {
      label: 'Im Schaufenster',
      value: availableCount === 1 ? '1 Rad' : `${availableCount} Räder`,
    },
    { label: 'Preise', value: priceRange ?? 'Preis auf Anfrage' },
    { label: 'Standort', value: profile.city || 'auf Anfrage' },
    { label: 'Termin', value: profile.openingHours || 'Besichtigung nach Absprache' },
  ];

  const legalLinks: { page: LegalPage; label: string }[] = [
    { page: 'impressum', label: 'Impressum' },
    { page: 'datenschutz', label: 'Datenschutz' },
    ...(profile.isCommercial
      ? [{ page: 'widerruf' as LegalPage, label: 'Widerrufsbelehrung' }]
      : []),
    { page: 'agb', label: 'AGB' },
    { page: 'versand', label: 'Versand & Zahlung' },
  ];

  const year = new Date().getFullYear();

  return (
    <div>
      {/* --- Kopfbereich ------------------------------------------------ */}
      <header className="sr-vignette relative px-4 py-12 sm:px-8 sm:py-16">
        <div className="relative z-10 mx-auto max-w-3xl text-center">
          <p className="sr-eyebrow">Gebrauchte Fahrräder</p>
          <h1 className="sr-display mt-3 text-3xl font-semibold leading-tight sm:text-5xl">
            {profile.displayName || 'Showroom'}
          </h1>
          {profile.tagline && (
            <p className="mt-3 text-sm sm:text-base" style={{ color: 'var(--sr-muted)' }}>
              {profile.tagline}
            </p>
          )}

          <hr className="sr-rule my-8" />

          <div className="grid grid-cols-2 gap-3 text-left sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="sr-panel-flat px-3 py-3">
                <div className="sr-eyebrow">{s.label}</div>
                <div className="mt-1 text-sm font-semibold leading-snug">{s.value}</div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            <button type="button" className="sr-btn sr-btn-primary" onClick={() => scrollTo(offerRef)}>
              <Bike className="w-4 h-4" />
              Räder ansehen
            </button>
            <button type="button" className="sr-btn sr-btn-ghost" onClick={() => scrollTo(contactRef)}>
              <MessageCircle className="w-4 h-4" />
              Kontakt
            </button>
          </div>
        </div>
      </header>

      {/* --- Filterleiste ----------------------------------------------- */}
      <div ref={offerRef} className="sticky top-0 z-20 px-3 pb-4 sm:px-6">
        <div className="sr-panel p-3 sm:p-4">
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2"
                style={{ color: 'var(--sr-faint)' }}
              />
              <input
                type="search"
                className="sr-input"
                // Platz für die Lupe – als style, weil theme.css ungeschichtet ist
                // und damit jede Tailwind-Padding-Klasse überstimmen würde.
                style={{ paddingLeft: 34 }}
                placeholder="Suchen: Marke, Modell, Rahmenhöhe …"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Räder durchsuchen"
              />
            </div>

            {categories.length > 1 && (
              <div className="sr-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                <button
                  type="button"
                  onClick={() => setCategory('alle')}
                  className={`sr-chip shrink-0 ${category === 'alle' ? 'sr-chip-accent' : ''}`}
                >
                  Alle
                </button>
                {categories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={`sr-chip shrink-0 ${category === c ? 'sr-chip-accent' : ''}`}
                  >
                    {CATEGORY_LABELS[c]}
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div>
                <label className="sr-label" htmlFor="sr-filter-condition">
                  Zustand
                </label>
                <select
                  id="sr-filter-condition"
                  className="sr-select"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value as ListingCondition | 'alle')}
                >
                  <option value="alle">Alle</option>
                  {(Object.keys(CONDITION_LABELS) as ListingCondition[]).map((c) => (
                    <option key={c} value={c}>
                      {CONDITION_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="sr-label" htmlFor="sr-filter-min">
                  Preis ab
                </label>
                <input
                  id="sr-filter-min"
                  className="sr-input"
                  inputMode="numeric"
                  placeholder="0 €"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                />
              </div>

              <div>
                <label className="sr-label" htmlFor="sr-filter-max">
                  Preis bis
                </label>
                <input
                  id="sr-filter-max"
                  className="sr-input"
                  inputMode="numeric"
                  placeholder="beliebig"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                />
              </div>

              <div>
                <label className="sr-label" htmlFor="sr-filter-sort">
                  Sortierung
                </label>
                <select
                  id="sr-filter-sort"
                  className="sr-select"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                >
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                    <option key={k} value={k}>
                      {SORT_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={onlyAvailable}
                onClick={() => setOnlyAvailable((v) => !v)}
                className={`sr-chip ${onlyAvailable ? 'sr-chip-good' : ''}`}
              >
                Nur verfügbare
              </button>

              <span className="text-xs" style={{ color: 'var(--sr-muted)' }}>
                {visible.length === 1 ? '1 Rad' : `${visible.length} Räder`}
              </span>

              {filterActive && (
                <button
                  type="button"
                  onClick={resetFilter}
                  className="sr-btn sr-btn-quiet ml-auto"
                  style={{ padding: '6px 12px', fontSize: 13 }}
                >
                  <RotateCcw className="w-4 h-4" />
                  Filter zurücksetzen
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* --- Raster ------------------------------------------------------ */}
      <section className="px-4 pb-10 sm:px-6">
        {visible.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((l) => (
              <ListingCard
                key={l.id}
                listing={l}
                bike={bikeById(l.bikeId)}
                isFavorite={favorites.includes(l.id)}
                onToggleFavorite={onToggleFavorite}
                onOpen={onOpen}
              />
            ))}
          </div>
        ) : (
          <div className="sr-panel mx-auto max-w-xl px-6 py-12 text-center">
            <Bike className="mx-auto w-8 h-8" style={{ color: 'var(--sr-faint)' }} />
            {listings.length === 0 ? (
              <>
                <p className="sr-display mt-4 text-lg">Gerade ist kein Rad im Schaufenster.</p>
                <p className="mt-2 text-sm" style={{ color: 'var(--sr-muted)' }}>
                  Schreib mir gern, wonach du suchst – oft habe ich noch etwas in der Werkstatt
                  stehen, das noch nicht online ist.
                </p>
                <button
                  type="button"
                  className="sr-btn sr-btn-primary mt-6"
                  onClick={() => scrollTo(contactRef)}
                >
                  <MessageCircle className="w-4 h-4" />
                  Suchanfrage schreiben
                </button>
              </>
            ) : (
              <>
                <p className="sr-display mt-4 text-lg">Dazu passt gerade kein Rad.</p>
                <p className="mt-2 text-sm" style={{ color: 'var(--sr-muted)' }}>
                  Nimm den Filter etwas weiter – vielleicht passt ein anderer Zustand oder eine
                  andere Preisspanne.
                </p>
                <button type="button" className="sr-btn sr-btn-ghost mt-6" onClick={resetFilter}>
                  <X className="w-4 h-4" />
                  Filter zurücksetzen
                </button>
              </>
            )}
          </div>
        )}
      </section>

      {/* --- Über mich --------------------------------------------------- */}
      {(profile.about || profile.pickupNote) && (
        <section className="px-4 pb-10 sm:px-6">
          <div className="sr-panel p-5 sm:p-7">
            <p className="sr-eyebrow">Über mich</p>
            <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
              {profile.logoDataUrl && (
                <img
                  src={profile.logoDataUrl}
                  alt={`Logo von ${profile.displayName || 'dem Showroom'}`}
                  className="h-20 w-20 shrink-0 rounded-xl object-contain sm:h-24 sm:w-24"
                  style={{ background: 'var(--sr-ink-2)' }}
                />
              )}
              <div className="min-w-0 flex-1">
                {profile.about && (
                  <p className="whitespace-pre-line text-sm leading-relaxed">{profile.about}</p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {profile.city && (
                    <span className="sr-chip">
                      <MapPin className="w-3.5 h-3.5" />
                      {profile.city}
                    </span>
                  )}
                  {profile.openingHours && (
                    <span className="sr-chip">
                      <Clock className="w-3.5 h-3.5" />
                      {profile.openingHours}
                    </span>
                  )}
                  {priceRange && (
                    <span className="sr-chip">
                      <Euro className="w-3.5 h-3.5" />
                      {priceRange}
                    </span>
                  )}
                </div>
                {profile.pickupNote && (
                  <p className="mt-4 text-sm" style={{ color: 'var(--sr-muted)' }}>
                    {profile.pickupNote}
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* --- Kontakt ----------------------------------------------------- */}
      <section ref={contactRef} className="px-4 pb-10 sm:px-6">
        <div className="mb-4 flex items-center gap-3">
          <ArrowDown className="w-4 h-4" style={{ color: 'var(--sr-accent)' }} />
          <h2 className="sr-display text-xl font-semibold">Frag einfach nach</h2>
        </div>
        <ContactForm
          listing={null}
          profile={profile}
          settings={settings}
          onSubmit={onSubmitInquiry}
        />
      </section>

      {/* --- Fußzeile ---------------------------------------------------- */}
      <footer className="px-4 pb-10 sm:px-6">
        <hr className="sr-rule mb-6" />
        <div className="flex flex-col gap-4 text-sm sm:flex-row sm:items-start sm:justify-between">
          <nav className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Rechtliches">
            {legalLinks.map((l) => (
              <button
                key={l.page}
                type="button"
                onClick={() => onOpenLegal(l.page)}
                className="underline-offset-4 hover:underline"
                style={{ color: 'var(--sr-muted)' }}
              >
                {l.label}
              </button>
            ))}
          </nav>

          {(profile.website || profile.instagram) && (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {profile.website && (
                <a
                  href={externalHref(profile.website)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 underline-offset-4 hover:underline"
                  style={{ color: 'var(--sr-muted)' }}
                >
                  <Globe className="w-4 h-4" />
                  Website
                </a>
              )}
              {profile.instagram && (
                <a
                  href={instagramHref(profile.instagram)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 underline-offset-4 hover:underline"
                  style={{ color: 'var(--sr-muted)' }}
                >
                  <Instagram className="w-4 h-4" />
                  Instagram
                </a>
              )}
            </div>
          )}
        </div>

        <p className="mt-6 text-xs" style={{ color: 'var(--sr-faint)' }}>
          © {year} {profile.displayName || profile.legalName}
        </p>
      </footer>
    </div>
  );
}

export default StorefrontView;
