import { useEffect, useMemo, useState } from 'react';
import {
  Bike,
  Copy,
  Crosshair,
  Eye,
  Heart,
  Image as ImageIcon,
  MessageSquare,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  TriangleAlert,
  Wrench,
} from 'lucide-react';

import type {
  ListingStatus,
  SellerProfile,
  ShowroomInquiry,
  ShowroomListing,
  ShowroomSettings,
} from '../../types';
import type { BikeLike } from '../../lib/listing';
import { coverPhoto, formatPrice, listingPhotos, relativeDate } from '../../lib/listing';
import { STATUS_LABELS, profileGaps } from '../../config/seller';

// ============================================================================
// Verkäufer-Startseite
// ----------------------------------------------------------------------------
// Zeigt in einem Blick, was online ist, was noch fehlt und welche Räder aus der
// Werkstatt noch keine Anzeige haben. Die Seite entscheidet nichts selbst – sie
// meldet jede Änderung nach oben, damit der Zustand an einer Stelle liegt.
// ============================================================================

export interface SellerDashboardProps {
  listings: ShowroomListing[];
  inquiries: ShowroomInquiry[];
  bikes: BikeLike[];
  profile: SellerProfile;
  settings: ShowroomSettings;
  bikeById: (id?: string) => BikeLike | null | undefined;
  onEdit: (id: string) => void;
  onCreateFromBike: (bikeId: string) => void;
  onCreateEmpty: () => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onStatusChange: (id: string, status: ListingStatus) => void;
  onPreview: (id: string) => void;
  onOpenInbox: () => void;
  onOpenProfile: () => void;
  onNavigateToWorkshop?: (bikeId: string) => void;
}

/** Räder, die gar keine Fahrräder sind – die tauchen im Showroom nie auf. */
const NON_BIKE_STATUS = ['Infrastruktur', 'Material'];

/** Diese Räder warten am ehesten auf eine Anzeige und stehen deshalb vorn. */
const PREFERRED_STATUS = ['Inseriert', 'Zu reparieren'];

const MAX_WORKSHOP_TILES = 12;

type StatusFilter = 'alle' | ListingStatus;

const STATUS_CHIP_CLASS: Record<ListingStatus, string> = {
  entwurf: 'sr-chip',
  online: 'sr-chip sr-chip-good',
  reserviert: 'sr-chip sr-chip-warn',
  verkauft: 'sr-chip sr-chip-accent',
};

const STATUS_ORDER: ListingStatus[] = ['entwurf', 'online', 'reserviert', 'verkauft'];

export function SellerDashboard({
  listings,
  inquiries,
  bikes,
  profile,
  bikeById,
  onEdit,
  onCreateFromBike,
  onCreateEmpty,
  onDelete,
  onDuplicate,
  onStatusChange,
  onPreview,
  onOpenInbox,
  onOpenProfile,
  onNavigateToWorkshop,
}: SellerDashboardProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('alle');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const gaps = profileGaps(profile);

  // Das Menü darf nicht offen stehen bleiben, wenn woanders geklickt wird.
  // `mousedown` statt `click`, damit der eigene Knopf danach noch umschalten kann.
  useEffect(() => {
    if (!openMenuId) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest('[data-sr-menu]')) return;
      setOpenMenuId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenuId(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenuId]);

  const counts = useMemo(() => {
    const base: Record<ListingStatus, number> = {
      entwurf: 0,
      online: 0,
      reserviert: 0,
      verkauft: 0,
    };
    for (const listing of listings) base[listing.status] += 1;
    return base;
  }, [listings]);

  const newInquiries = useMemo(
    () => inquiries.filter((i) => i.status === 'neu').length,
    [inquiries],
  );

  const shopValue = useMemo(
    () =>
      listings
        .filter((l) => l.status === 'online')
        .reduce((sum, l) => sum + (l.price ?? 0), 0),
    [listings],
  );

  const inquiriesPerListing = useMemo(() => {
    const map: Record<string, number> = {};
    for (const inquiry of inquiries) {
      if (!inquiry.listingId) continue;
      map[inquiry.listingId] = (map[inquiry.listingId] ?? 0) + 1;
    }
    return map;
  }, [inquiries]);

  // Räder ohne Anzeige – Material und Infrastruktur sind keine Fahrräder.
  const openBikes = useMemo(() => {
    const used = new Set(
      listings.map((l) => l.bikeId).filter((id): id is string => !!id),
    );
    const rank = (status: string) => {
      const index = PREFERRED_STATUS.indexOf(status);
      return index === -1 ? PREFERRED_STATUS.length : index;
    };
    return bikes
      .filter((b) => !NON_BIKE_STATUS.includes(b.status) && !used.has(b.id))
      .sort(
        (a, b) =>
          rank(a.status) - rank(b.status) || (a.name || '').localeCompare(b.name || '', 'de'),
      );
  }, [bikes, listings]);

  const shownBikes = openBikes.slice(0, MAX_WORKSHOP_TILES);
  const hiddenBikes = openBikes.length - shownBikes.length;

  const visibleListings = useMemo(() => {
    const query = search.trim().toLowerCase();
    return listings
      .filter((l) => (statusFilter === 'alle' ? true : l.status === statusFilter))
      .filter((l) => {
        if (!query) return true;
        const haystack = [l.title, l.subtitle, l.brand, l.model, l.slug]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [listings, search, statusFilter]);

  const hasListings = listings.length > 0;

  return (
    <div className="px-4 sm:px-6 py-5 sm:py-6 flex flex-col gap-6">
      {/* --- Kopf --- */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="sr-eyebrow">Verkäufer</div>
          <h2 className="sr-display text-2xl sm:text-3xl font-semibold">Deine Anzeigen</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onCreateEmpty} className="sr-btn sr-btn-primary">
            <Plus className="w-4 h-4" />
            Neue Anzeige
          </button>
          <button type="button" onClick={onOpenProfile} className="sr-btn sr-btn-ghost">
            <Settings2 className="w-4 h-4" />
            Profil &amp; Impressum
          </button>
        </div>
      </div>

      {/* --- Fehlende Pflichtangaben --- */}
      {gaps.length > 0 && (
        <div
          className="rounded-xl p-3 sm:p-4 flex flex-wrap items-start gap-3"
          style={{
            background: 'rgba(217, 164, 65, 0.10)',
            border: '1px solid rgba(217, 164, 65, 0.32)',
          }}
        >
          <TriangleAlert
            className="w-5 h-5 shrink-0 mt-0.5"
            style={{ color: 'var(--sr-warn)' }}
          />
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-semibold" style={{ color: 'var(--sr-warn)' }}>
              Bevor die Seite online geht, fehlen noch: {gaps.join(', ')}.
            </p>
            <p className="text-sm mt-1" style={{ color: 'var(--sr-muted)' }}>
              Diese Angaben gehören ins Impressum. Anzeigen kannst du trotzdem schon vorbereiten.
            </p>
          </div>
          <button type="button" onClick={onOpenProfile} className="sr-btn sr-btn-ghost">
            Jetzt ergänzen
          </button>
        </div>
      )}

      {/* --- Kennzahlen --- */}
      {hasListings && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
          <StatTile label="Online" value={String(counts.online)} />
          <StatTile label="Entwürfe" value={String(counts.entwurf)} />
          <StatTile label="Reserviert" value={String(counts.reserviert)} />
          <StatTile label="Verkauft" value={String(counts.verkauft)} />
          <StatTile
            label="Neue Anfragen"
            value={String(newInquiries)}
            onClick={onOpenInbox}
            highlight={newInquiries > 0}
          />
          <StatTile
            label="Wert im Schaufenster"
            value={formatPrice(shopValue, 'fest')}
            small
          />
        </div>
      )}

      {/* --- Räder aus der Werkstatt --- */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4" style={{ color: 'var(--sr-accent)' }} />
          <h3 className="sr-display text-lg font-semibold">Aus der Werkstatt übernehmen</h3>
        </div>

        {shownBikes.length === 0 ? (
          <div className="sr-panel-flat p-4 text-sm" style={{ color: 'var(--sr-muted)' }}>
            {bikes.length === 0
              ? 'In der Werkstatt liegt gerade kein Rad. Sobald du eines anlegst, kannst du es hier direkt übernehmen.'
              : 'Für jedes Rad aus der Werkstatt gibt es bereits eine Anzeige.'}
          </div>
        ) : (
          <>
            <div className="sr-scroll flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
              {shownBikes.map((bike) => {
                const photo = bike.photos?.[0];
                const photoCount = bike.photos?.length ?? 0;
                const target = bike.targetSellingPrice ?? bike.sellingPrice ?? null;
                return (
                  <div
                    key={bike.id}
                    className="sr-panel-flat shrink-0 w-44 sm:w-48 p-2 flex flex-col gap-2"
                  >
                    <div className="sr-inset h-24 rounded-lg overflow-hidden">
                      {photo ? (
                        <img
                          src={photo}
                          alt={`Foto von ${bike.name}`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <PhotoPlaceholder />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate" title={bike.name}>
                        {bike.name}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--sr-faint)' }}>
                        {photoCount === 1 ? '1 Foto' : `${photoCount} Fotos`} · {bike.status}
                      </div>
                      <div className="text-sm mt-1" style={{ color: 'var(--sr-accent)' }}>
                        {target == null ? 'Kein Zielpreis' : formatPrice(target, 'fest')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onCreateFromBike(bike.id)}
                      className="sr-btn sr-btn-ghost w-full"
                      style={{ padding: '7px 10px', fontSize: 13 }}
                    >
                      <Plus className="w-4 h-4" />
                      Anzeige erstellen
                    </button>
                  </div>
                );
              })}
            </div>
            {hiddenBikes > 0 && (
              <p className="text-xs" style={{ color: 'var(--sr-faint)' }}>
                {hiddenBikes === 1
                  ? 'Ein weiteres Rad ohne Anzeige wird hier nicht gezeigt.'
                  : `${hiddenBikes} weitere Räder ohne Anzeige werden hier nicht gezeigt.`}
              </p>
            )}
          </>
        )}
      </section>

      {/* --- Anzeigen --- */}
      {!hasListings ? (
        <div className="sr-panel p-6 sm:p-8 text-center flex flex-col items-center gap-4">
          <div
            className="w-14 h-14 rounded-2xl grid place-items-center border"
            style={{ borderColor: 'var(--sr-accent-line)', background: 'var(--sr-accent-soft)' }}
          >
            <Bike className="w-7 h-7" style={{ color: 'var(--sr-accent)' }} />
          </div>
          <div>
            <h3 className="sr-display text-xl font-semibold">Noch keine Anzeige</h3>
            <p className="text-sm mt-2 max-w-md mx-auto" style={{ color: 'var(--sr-muted)' }}>
              Nimm ein Rad aus der Werkstatt: Bilder, Marke und bekannte Mängel wandern dann
              gleich mit. Oder leg eine leere Anzeige an, wenn du ein Rad verkaufst, das nicht
              in der Werkstatt liegt.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={onCreateEmpty} className="sr-btn sr-btn-primary">
              <Plus className="w-4 h-4" />
              Neue Anzeige
            </button>
            <button type="button" onClick={onOpenProfile} className="sr-btn sr-btn-ghost">
              <Settings2 className="w-4 h-4" />
              Profil &amp; Impressum
            </button>
          </div>
        </div>
      ) : (
        <section className="flex flex-col gap-4">
          {/* Suche und Status */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1 min-w-0">
              <Search
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--sr-faint)' }}
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Anzeige suchen …"
                aria-label="Anzeigen durchsuchen"
                className="sr-input"
                style={{ paddingLeft: 36 }}
              />
            </div>
            <div className="sr-scroll flex items-center gap-2 overflow-x-auto pb-1">
              <FilterChip
                label="Alle"
                count={listings.length}
                active={statusFilter === 'alle'}
                onClick={() => setStatusFilter('alle')}
              />
              {STATUS_ORDER.map((status) => (
                <FilterChip
                  key={status}
                  label={STATUS_LABELS[status]}
                  count={counts[status]}
                  active={statusFilter === status}
                  onClick={() => setStatusFilter(status)}
                />
              ))}
            </div>
          </div>

          {visibleListings.length === 0 ? (
            <div className="sr-panel-flat p-5 text-sm" style={{ color: 'var(--sr-muted)' }}>
              Zu dieser Suche passt keine Anzeige.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3 sm:gap-4">
              {visibleListings.map((listing) => (
                <ListingRow
                  key={listing.id}
                  listing={listing}
                  bike={bikeById(listing.bikeId)}
                  inquiryCount={inquiriesPerListing[listing.id] ?? 0}
                  menuOpen={openMenuId === listing.id}
                  onToggleMenu={() =>
                    setOpenMenuId((current) => (current === listing.id ? null : listing.id))
                  }
                  onCloseMenu={() => setOpenMenuId(null)}
                  onEdit={onEdit}
                  onPreview={onPreview}
                  onDelete={onDelete}
                  onDuplicate={onDuplicate}
                  onStatusChange={onStatusChange}
                  onNavigateToWorkshop={onNavigateToWorkshop}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// --- Bausteine -------------------------------------------------------------

function PhotoPlaceholder() {
  return (
    <div
      className="w-full h-full grid place-items-center gap-1 text-center"
      style={{ color: 'var(--sr-faint)' }}
    >
      <div>
        <Bike className="w-5 h-5 mx-auto" />
        <div className="text-[10px] mt-1">Noch kein Foto</div>
      </div>
    </div>
  );
}

interface StatTileProps {
  label: string;
  value: string;
  onClick?: () => void;
  highlight?: boolean;
  small?: boolean;
}

function StatTile({ label, value, onClick, highlight, small }: StatTileProps) {
  const content = (
    <>
      <div className="sr-eyebrow truncate">{label}</div>
      <div
        className={`sr-display font-semibold mt-1 ${small ? 'text-lg' : 'text-2xl'}`}
        style={highlight ? { color: 'var(--sr-accent)' } : undefined}
      >
        {value}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="sr-panel-flat p-3 text-left"
        style={
          highlight
            ? { borderColor: 'var(--sr-accent-line)', background: 'var(--sr-accent-soft)' }
            : undefined
        }
      >
        {content}
      </button>
    );
  }

  return <div className="sr-panel-flat p-3">{content}</div>;
}

interface FilterChipProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

function FilterChip({ label, count, active, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${active ? 'sr-chip sr-chip-accent' : 'sr-chip'} shrink-0 whitespace-nowrap`}
      style={{ cursor: 'pointer' }}
    >
      {label}
      <span style={{ color: 'var(--sr-faint)' }}>{count}</span>
    </button>
  );
}

interface ListingRowProps {
  listing: ShowroomListing;
  bike?: BikeLike | null;
  inquiryCount: number;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onEdit: (id: string) => void;
  onPreview: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onStatusChange: (id: string, status: ListingStatus) => void;
  onNavigateToWorkshop?: (bikeId: string) => void;
}

function ListingRow({
  listing,
  bike,
  inquiryCount,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onEdit,
  onPreview,
  onDelete,
  onDuplicate,
  onStatusChange,
  onNavigateToWorkshop,
}: ListingRowProps) {
  const cover = coverPhoto(listing, bike);
  const photoCount = listingPhotos(listing, bike).length;
  const hotspotCount = (listing.hotspots ?? []).length;

  // Was eine Anzeige braucht, bevor sie jemand sehen darf.
  const missing: string[] = [];
  if (listing.price == null && listing.priceType !== 'verschenken') missing.push('Preis');
  if ((listing.description ?? '').trim().length < 40) missing.push('Beschreibung');
  if (photoCount === 0) missing.push('Foto');

  return (
    <article className="sr-panel p-3 sm:p-4 flex flex-col gap-3">
      <div className="flex gap-3">
        <div className="sr-inset w-20 h-20 sm:w-24 sm:h-24 shrink-0 rounded-xl overflow-hidden">
          {cover ? (
            <img
              src={cover}
              alt={`Titelbild von ${listing.title || 'Anzeige ohne Titel'}`}
              className="w-full h-full object-cover"
            />
          ) : (
            <PhotoPlaceholder />
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className="sr-display text-base sm:text-lg font-semibold leading-snug break-words">
              {listing.title || 'Anzeige ohne Titel'}
            </h4>
            <span className={`${STATUS_CHIP_CLASS[listing.status]} shrink-0`}>
              {STATUS_LABELS[listing.status]}
            </span>
          </div>

          <div className="text-sm font-semibold" style={{ color: 'var(--sr-accent)' }}>
            {formatPrice(listing.price, listing.priceType)}
          </div>

          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs mt-0.5"
            style={{ color: 'var(--sr-muted)' }}
          >
            <span className="inline-flex items-center gap-1" title="Aufrufe">
              <Eye className="w-4 h-4" />
              {listing.views}
            </span>
            <span className="inline-flex items-center gap-1" title="Merkungen">
              <Heart className="w-4 h-4" />
              {listing.likes}
            </span>
            <span className="inline-flex items-center gap-1" title="Fotos">
              <ImageIcon className="w-4 h-4" />
              {photoCount}
            </span>
            <span className="inline-flex items-center gap-1" title="Bildpunkte">
              <Crosshair className="w-4 h-4" />
              {hotspotCount}
            </span>
            <span className="inline-flex items-center gap-1" title="Anfragen zu dieser Anzeige">
              <MessageSquare className="w-4 h-4" />
              {inquiryCount}
            </span>
          </div>

          {missing.length > 0 && (
            <div
              className="text-xs mt-1 inline-flex items-center gap-1"
              style={{ color: 'var(--sr-warn)' }}
            >
              <TriangleAlert className="w-4 h-4 shrink-0" />
              Fehlt noch: {missing.join(', ')}
            </div>
          )}

          {listing.updatedAt > 0 && (
            <div className="text-xs mt-0.5" style={{ color: 'var(--sr-faint)' }}>
              Zuletzt geändert {relativeDate(listing.updatedAt)}
            </div>
          )}
        </div>
      </div>

      <div className="sr-rule" />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onEdit(listing.id)}
          className="sr-btn sr-btn-ghost"
          style={{ padding: '8px 12px', fontSize: 13 }}
        >
          <Pencil className="w-4 h-4" />
          Bearbeiten
        </button>
        <button
          type="button"
          onClick={() => onPreview(listing.id)}
          className="sr-btn sr-btn-quiet"
          style={{ padding: '8px 12px', fontSize: 13 }}
        >
          <Eye className="w-4 h-4" />
          Vorschau
        </button>

        <select
          className="sr-select"
          value={listing.status}
          aria-label={`Status von ${listing.title || 'dieser Anzeige'}`}
          onChange={(e) => onStatusChange(listing.id, e.target.value as ListingStatus)}
          style={{ width: 'auto', minWidth: 130, padding: '8px 10px', fontSize: 13 }}
        >
          {STATUS_ORDER.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>

        <div className="relative ml-auto" data-sr-menu="">
          <button
            type="button"
            onClick={onToggleMenu}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Weitere Aktionen"
            className="sr-btn sr-btn-quiet"
            style={{ padding: '8px 10px' }}
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="sr-panel absolute right-0 bottom-full mb-2 z-30 w-56 p-1 flex flex-col gap-1"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onCloseMenu();
                  onDuplicate(listing.id);
                }}
                className="sr-btn sr-btn-quiet w-full"
                style={{ justifyContent: 'flex-start', fontSize: 13 }}
              >
                <Copy className="w-4 h-4" />
                Duplizieren
              </button>

              {listing.bikeId && onNavigateToWorkshop && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onCloseMenu();
                    onNavigateToWorkshop(listing.bikeId as string);
                  }}
                  className="sr-btn sr-btn-quiet w-full"
                  style={{ justifyContent: 'flex-start', fontSize: 13 }}
                >
                  <Wrench className="w-4 h-4" />
                  In der Werkstatt öffnen
                </button>
              )}

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onCloseMenu();
                  onDelete(listing.id);
                }}
                className="sr-btn sr-btn-danger w-full"
                style={{ justifyContent: 'flex-start', fontSize: 13 }}
              >
                <Trash2 className="w-4 h-4" />
                Löschen
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default SellerDashboard;
