import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bike,
  Check,
  ChevronRight,
  Clock,
  Eye,
  Heart,
  Link as LinkIcon,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Rotate3d,
  Send,
  Share2,
  ShieldCheck,
  Truck,
} from 'lucide-react';

import type {
  LegalPage,
  SellerProfile,
  ShowroomListing,
  ShowroomSettings,
} from '../../types';
import type { BikeLike } from '../../lib/listing';
import {
  coverPhoto,
  formatPrice,
  hotspotsForPhoto,
  listingPhotos,
  relativeDate,
} from '../../lib/listing';
import type { InquiryDraft, SubmitResult } from '../../lib/inquiries';
import { whatsappUrl } from '../../lib/inquiries';
import { copyToClipboard, listingUrl, nativeShare, shareTargets } from '../../lib/share';
import {
  CATEGORY_LABELS,
  CONDITION_HINTS,
  CONDITION_LABELS,
  DELIVERY_LABELS,
  STATUS_LABELS,
} from '../../config/seller';

import { HotspotViewer } from './HotspotViewer';
import { TurntableViewer } from './TurntableViewer';
import { ContactForm } from './ContactForm';

// ============================================================================
// Die Anzeige, so wie ein Interessent sie sieht
// ----------------------------------------------------------------------------
// Aufbau bewusst wie im Laden: erst das Rad ansehen (Bilder mit beschrifteten
// Bauteilen), dann der Preis, dann die harten Fakten, dann das Gespräch. Die
// Mängel stehen absichtlich weit oben und nicht im Kleingedruckten – wer beim
// Gebrauchtrad ehrlich ist, verkauft schneller und bekommt weniger Ärger.
// ============================================================================

export interface ListingDetailProps {
  listing: ShowroomListing;
  bike?: BikeLike | null;
  profile: SellerProfile;
  settings: ShowroomSettings;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  onBack: () => void;
  onSubmitInquiry: (draft: InquiryDraft) => Promise<SubmitResult>;
  onOpenLegal: (page: LegalPage) => void;
  moreListings: ShowroomListing[];
  onOpen: (listing: ShowroomListing) => void;
}

const STATUS_CHIP: Record<ShowroomListing['status'], string> = {
  entwurf: 'sr-chip',
  online: 'sr-chip sr-chip-good',
  reserviert: 'sr-chip sr-chip-warn',
  verkauft: 'sr-chip sr-chip-bad',
};

const SHARE_ICONS = {
  whatsapp: MessageCircle,
  mail: Mail,
  facebook: Share2,
  telegram: Send,
  copy: LinkIcon,
} as const;

export function ListingDetail({
  listing,
  bike,
  profile,
  settings,
  isFavorite,
  onToggleFavorite,
  onBack,
  onSubmitInquiry,
  onOpenLegal,
  moreListings,
  onOpen,
}: ListingDetailProps) {
  const photos = useMemo(() => listingPhotos(listing, bike), [listing, bike]);

  const [photoIndex, setPhotoIndex] = useState(() =>
    Math.min(Math.max(0, listing.coverIndex ?? 0), Math.max(0, photos.length - 1)),
  );
  const [turntableOn, setTurntableOn] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLElement | null>(null);
  const copyTimer = useRef<number | null>(null);

  // Beim Wechsel auf ein anderes Rad wieder von vorn anfangen.
  useEffect(() => {
    setPhotoIndex(Math.min(Math.max(0, listing.coverIndex ?? 0), Math.max(0, photos.length - 1)));
    setTurntableOn(false);
    setShareOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing.id]);

  useEffect(() => {
    if (!shareOpen) return;
    const close = (e: MouseEvent) => {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) setShareOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [shareOpen]);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const currentPhoto = photos[photoIndex] ?? photos[0] ?? '';
  const hotspots = useMemo(
    () => hotspotsForPhoto(listing, photoIndex),
    [listing, photoIndex],
  );

  // Für die Drehung zählt die eigene Reihenfolge, falls der Verkäufer eine gesetzt hat.
  const turntableFrames = useMemo(() => {
    const order = listing.turntable?.frameOrder ?? [];
    const picked = order
      .map((i) => photos[i])
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
    return picked.length >= 3 ? picked : photos;
  }, [listing.turntable, photos]);

  const canTurntable = !!listing.turntable?.enabled && turntableFrames.length >= 3;
  const waLink = whatsappUrl(profile, listing);
  const targets = shareTargets(listing, profile, settings);

  const city = listing.location?.city || profile.city;
  const district = listing.location?.district;
  const publishedTs = listing.publishedAt ?? listing.updatedAt;

  const facts = useMemo(() => {
    const out: { key: string; label: string; value: string; hint?: string }[] = [];
    const add = (key: string, label: string, value?: string | null, hint?: string) => {
      const v = String(value ?? '').trim();
      if (v) out.push({ key, label, value: v, hint });
    };
    add('brand', 'Marke', listing.brand);
    add('model', 'Modell', listing.model);
    add('year', 'Baujahr', listing.year);
    add('color', 'Farbe', listing.color);
    add('frameSize', 'Rahmenhöhe', listing.frameSize);
    add('wheelSize', 'Laufradgröße', listing.wheelSize);
    add('frameType', 'Rahmenform', listing.frameType);
    add('gearSystem', 'Schaltung', listing.gearSystem);
    add('gearCount', 'Gänge', listing.gearCount);
    add('brakes', 'Bremsen', listing.brakes);
    add('material', 'Material', listing.material);
    add(
      'weight',
      'Gewicht',
      listing.weightKg ? (/kg/i.test(listing.weightKg) ? listing.weightKg : `${listing.weightKg} kg`) : '',
    );
    add('category', 'Kategorie', CATEGORY_LABELS[listing.category]);
    add(
      'condition',
      'Zustand',
      CONDITION_LABELS[listing.condition],
      CONDITION_HINTS[listing.condition],
    );
    for (const spec of listing.specs ?? []) add(`spec-${spec.id}`, spec.label, spec.value);
    return out;
  }, [listing]);

  async function handleShare() {
    if (shareOpen) {
      setShareOpen(false);
      return;
    }
    // Auf dem Handy ist das Systemmenü der bessere Weg – nur wenn es keins gibt,
    // klappt die eigene Liste auf.
    const done = await nativeShare(listing, profile, settings);
    if (!done) setShareOpen(true);
  }

  async function handleCopy() {
    const ok = await copyToClipboard(listingUrl(listing, settings));
    if (!ok) return;
    setCopied(true);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => {
      setCopied(false);
      setShareOpen(false);
      copyTimer.current = null;
    }, 2000);
  }

  function scrollToForm() {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="px-4 sm:px-6 py-5 sm:py-7 max-w-6xl mx-auto">
      {/* 1. Kopfzeile ------------------------------------------------------ */}
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onBack} className="sr-btn sr-btn-quiet">
          <ArrowLeft className="w-4 h-4" />
          Zurück
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onToggleFavorite(listing.id)}
            className={`sr-btn ${isFavorite ? 'sr-btn-ghost' : 'sr-btn-quiet'}`}
            aria-pressed={isFavorite}
            aria-label={isFavorite ? 'Von der Merkliste nehmen' : 'Auf die Merkliste setzen'}
          >
            <Heart
              className="w-4 h-4"
              style={{
                color: isFavorite ? 'var(--sr-accent)' : 'inherit',
                fill: isFavorite ? 'var(--sr-accent)' : 'none',
              }}
            />
            <span className="hidden sm:inline">{isFavorite ? 'Gemerkt' : 'Merken'}</span>
          </button>

          <div className="relative" ref={shareRef}>
            <button
              type="button"
              onClick={handleShare}
              className="sr-btn sr-btn-ghost"
              aria-haspopup="menu"
              aria-expanded={shareOpen}
            >
              <Share2 className="w-4 h-4" />
              <span className="hidden sm:inline">Teilen</span>
            </button>

            {shareOpen && (
              <div className="sr-panel absolute right-0 mt-2 p-1.5 w-52 z-30" role="menu">
                {targets.map((t) => {
                  const Icon = SHARE_ICONS[t.key];
                  if (!t.href) {
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={handleCopy}
                        className="sr-btn sr-btn-quiet w-full justify-start"
                        role="menuitem"
                      >
                        {copied ? (
                          <Check className="w-4 h-4" style={{ color: 'var(--sr-good)' }} />
                        ) : (
                          <Icon className="w-4 h-4" />
                        )}
                        {copied ? 'Kopiert' : t.label}
                      </button>
                    );
                  }
                  // mailto: darf keinen neuen Tab aufreißen – der bleibt sonst leer stehen.
                  const external = /^https?:/i.test(t.href);
                  return (
                    <a
                      key={t.key}
                      href={t.href}
                      target={external ? '_blank' : undefined}
                      rel={external ? 'noopener noreferrer' : undefined}
                      onClick={() => setShareOpen(false)}
                      className="sr-btn sr-btn-quiet w-full justify-start"
                      role="menuitem"
                    >
                      <Icon className="w-4 h-4" />
                      {t.label}
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2./3. Bilder und Preis ------------------------------------------- */}
      <div className="grid lg:grid-cols-5 gap-5 lg:gap-8 mt-4">
        <div className="lg:col-span-3">
          <div className="sr-panel p-3 sm:p-4">
            {turntableOn && canTurntable ? (
              <TurntableViewer
                photos={turntableFrames}
                startIndex={listing.turntable?.startIndex ?? 0}
                alt={listing.title}
                onExit={() => setTurntableOn(false)}
              />
            ) : (
              <HotspotViewer
                src={currentPhoto}
                hotspots={hotspots}
                alt={`${listing.title} – Foto ${photoIndex + 1} von ${Math.max(1, photos.length)}`}
                autoReveal
              />
            )}
          </div>

          {/* Spiegelung wie auf einem polierten Ladenboden. */}
          {currentPhoto && !turntableOn && (
            <div className="h-10 sm:h-14 overflow-hidden" aria-hidden="true">
              <img src={currentPhoto} alt="" className="sr-reflect w-full" />
            </div>
          )}

          {(photos.length > 1 || canTurntable) && (
            <div className="mt-2 flex items-center gap-3">
              {photos.length > 1 && (
                <div className="flex-1 min-w-0 flex gap-2 overflow-x-auto sr-scroll pb-1">
                  {photos.map((p, i) => (
                    <button
                      key={`${i}-${p.slice(-16)}`}
                      type="button"
                      onClick={() => {
                        setTurntableOn(false);
                        setPhotoIndex(i);
                      }}
                      className="shrink-0 rounded-lg overflow-hidden"
                      style={{
                        border: `2px solid ${
                          i === photoIndex && !turntableOn ? 'var(--sr-accent)' : 'var(--sr-line)'
                        }`,
                      }}
                      aria-label={`Foto ${i + 1} anzeigen`}
                      aria-current={i === photoIndex && !turntableOn}
                    >
                      <img
                        src={p}
                        alt={`${listing.title} – Vorschaubild ${i + 1}`}
                        className="w-20 h-16 object-cover block"
                      />
                    </button>
                  ))}
                </div>
              )}

              {canTurntable && (
                <button
                  type="button"
                  onClick={() => setTurntableOn((v) => !v)}
                  className={`sr-btn shrink-0 ${turntableOn ? 'sr-btn-primary' : 'sr-btn-ghost'}`}
                >
                  <Rotate3d className="w-4 h-4" />
                  Drehansicht
                </button>
              )}
            </div>
          )}
        </div>

        {/* 4. Preis, Titel, die zwei wichtigen Knöpfe ----------------------- */}
        <div className="lg:col-span-2">
          <div className="sr-eyebrow">{CATEGORY_LABELS[listing.category]}</div>
          <div className="sr-display sr-brass text-4xl sm:text-5xl font-bold mt-1 leading-none">
            {formatPrice(listing.price, listing.priceType)}
          </div>

          <h1 className="sr-display text-2xl sm:text-3xl font-semibold mt-3 leading-tight">
            {listing.title}
          </h1>
          {listing.subtitle && (
            <p className="text-sm mt-1" style={{ color: 'var(--sr-muted)' }}>
              {listing.subtitle}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className={STATUS_CHIP[listing.status]}>{STATUS_LABELS[listing.status]}</span>
            <span className="sr-chip">{CONDITION_LABELS[listing.condition]}</span>
          </div>

          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs"
            style={{ color: 'var(--sr-faint)' }}
          >
            {publishedTs > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                {relativeDate(publishedTs)}
              </span>
            )}
            {city && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="w-4 h-4" />
                {district ? `${city} · ${district}` : city}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Eye className="w-4 h-4" />
              {listing.views} {listing.views === 1 ? 'Aufruf' : 'Aufrufe'}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col gap-2 mt-5">
            <button
              type="button"
              onClick={scrollToForm}
              className="sr-btn sr-btn-primary flex-1"
              style={{ padding: '13px 20px', fontSize: 15 }}
            >
              <Mail className="w-5 h-5" />
              Nachricht schreiben
            </button>
            {waLink && (
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="sr-btn sr-btn-ghost flex-1"
                style={{ padding: '13px 20px', fontSize: 15 }}
              >
                <MessageCircle className="w-5 h-5" />
                Per WhatsApp fragen
              </a>
            )}
          </div>
        </div>
      </div>

      {/* 5. Auf einen Blick ----------------------------------------------- */}
      {facts.length > 0 && (
        <section className="mt-8">
          <h2 className="sr-display text-xl font-semibold">Auf einen Blick</h2>
          <hr className="sr-rule mt-2 mb-4" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
            {facts.map((f) => (
              <div key={f.key} className="sr-panel-flat p-3">
                <div className="sr-eyebrow">{f.label}</div>
                <div className="text-sm font-semibold mt-1 break-words">{f.value}</div>
                {f.hint && (
                  <div className="text-xs mt-1 leading-snug" style={{ color: 'var(--sr-faint)' }}>
                    {f.hint}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 6. Beschreibung --------------------------------------------------- */}
      {listing.description.trim() && (
        <section className="mt-8">
          <h2 className="sr-display text-xl font-semibold">Beschreibung</h2>
          <hr className="sr-rule mt-2 mb-4" />
          <p
            className="whitespace-pre-line text-[15px] leading-relaxed"
            style={{ color: 'var(--sr-text)' }}
          >
            {listing.description}
          </p>
        </section>
      )}

      {/* 7. Zubehör und Mängel -------------------------------------------- */}
      {(listing.extras?.length > 0 || listing.defects?.length > 0) && (
        <div className="grid md:grid-cols-2 gap-6 mt-8">
          {listing.extras?.length > 0 && (
            <section>
              <h2 className="sr-display text-xl font-semibold">Mit dabei</h2>
              <hr className="sr-rule mt-2 mb-4" />
              <div className="flex flex-wrap gap-2">
                {listing.extras.map((e, i) => (
                  <span key={`${i}-${e}`} className="sr-chip sr-chip-accent">
                    {e}
                  </span>
                ))}
              </div>
            </section>
          )}

          {listing.defects?.length > 0 && (
            <section>
              <h2 className="sr-display text-xl font-semibold">Ehrlich gesagt</h2>
              <hr className="sr-rule mt-2 mb-3" />
              <p className="text-xs mb-3" style={{ color: 'var(--sr-faint)' }}>
                Das ist ein gebrauchtes Rad. Was nicht perfekt ist, steht hier – nicht im
                Kleingedruckten.
              </p>
              <ul className="flex flex-col gap-2">
                {listing.defects.map((d, i) => (
                  <li key={`${i}-${d}`} className="flex items-start gap-2">
                    <span
                      className="sr-chip sr-chip-bad shrink-0"
                      style={{ padding: '2px 8px' }}
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                    <span className="text-sm leading-relaxed pt-0.5">{d}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* 8./9. Übergabe und Verkäufer -------------------------------------- */}
      <div className="grid md:grid-cols-2 gap-4 mt-8">
        <section className="sr-panel p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5" style={{ color: 'var(--sr-accent)' }} />
            <h2 className="sr-display text-lg font-semibold">Übergabe</h2>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {(listing.delivery ?? []).map((d) => (
              <span key={d} className="sr-chip">
                {DELIVERY_LABELS[d]}
              </span>
            ))}
          </div>
          {listing.delivery?.includes('versand') && listing.shippingCost != null && (
            <p className="text-sm mt-3" style={{ color: 'var(--sr-muted)' }}>
              Versand kostet {formatPrice(listing.shippingCost, 'fest')}.
            </p>
          )}
          {profile.pickupNote && (
            <p className="text-sm mt-3 leading-relaxed" style={{ color: 'var(--sr-muted)' }}>
              {profile.pickupNote}
            </p>
          )}
        </section>

        <section className="sr-panel p-4 sm:p-5">
          <div className="sr-eyebrow">Verkäufer</div>
          <div className="sr-display text-lg font-semibold mt-1">
            {profile.displayName || 'Showroom'}
          </div>
          {(profile.zip || profile.city) && (
            <div
              className="flex items-center gap-1.5 text-sm mt-1"
              style={{ color: 'var(--sr-muted)' }}
            >
              <MapPin className="w-4 h-4" />
              {[profile.zip, profile.city].filter(Boolean).join(' ')}
            </div>
          )}
          {profile.openingHours && (
            <div
              className="flex items-center gap-1.5 text-sm mt-1"
              style={{ color: 'var(--sr-muted)' }}
            >
              <Clock className="w-4 h-4" />
              {profile.openingHours}
            </div>
          )}
          {(profile.email || profile.phone) && (
            <div className="flex flex-wrap gap-2 mt-4">
              {profile.email && (
                <a href={`mailto:${profile.email}`} className="sr-btn sr-btn-ghost">
                  <Mail className="w-4 h-4" />
                  E-Mail
                </a>
              )}
              {profile.phone && (
                <a href={`tel:${profile.phone.replace(/\s+/g, '')}`} className="sr-btn sr-btn-ghost">
                  <Phone className="w-4 h-4" />
                  Anrufen
                </a>
              )}
            </div>
          )}
        </section>
      </div>

      {/* 10. Kontaktformular ----------------------------------------------- */}
      <section className="mt-8 scroll-mt-6" ref={formRef}>
        <h2 className="sr-display text-xl font-semibold">Fragen zum Rad?</h2>
        <hr className="sr-rule mt-2 mb-4" />
        <ContactForm
          listing={listing}
          profile={profile}
          settings={settings}
          onSubmit={onSubmitInquiry}
        />
      </section>

      {/* 11. Rechtlicher Hinweis ------------------------------------------- */}
      <section className="sr-inset p-4 mt-8">
        <div className="flex items-start gap-2">
          <ShieldCheck className="w-5 h-5 shrink-0" style={{ color: 'var(--sr-accent)' }} />
          <div className="text-sm leading-relaxed" style={{ color: 'var(--sr-muted)' }}>
            {profile.isCommercial ? (
              <>
                Gewerblicher Verkauf: du hast die gesetzliche Gewährleistung von einem Jahr auf
                gebrauchte Sachen.
              </>
            ) : (
              <>Privatverkauf: keine Garantie, keine Rücknahme.</>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {profile.isCommercial && (
                <button
                  type="button"
                  onClick={() => onOpenLegal('widerruf')}
                  className="underline underline-offset-4 text-xs font-semibold"
                  style={{ color: 'var(--sr-accent)' }}
                >
                  Widerrufsbelehrung
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpenLegal('impressum')}
                className="underline underline-offset-4 text-xs font-semibold"
                style={{ color: 'var(--sr-accent)' }}
              >
                Impressum
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 12. Weitere Räder -------------------------------------------------- */}
      {moreListings.length > 0 && (
        <section className="mt-8">
          <h2 className="sr-display text-xl font-semibold">Weitere Räder</h2>
          <hr className="sr-rule mt-2 mb-4" />
          <div className="grid gap-2">
            {moreListings.slice(0, 3).map((l) => (
              <MoreRow
                key={l.id}
                listing={l}
                // Nur Räder aus derselben Werkstatt-Akte können ihr Foto auflösen –
                // die Detailseite kennt bewusst nur ihr eigenes Rad.
                bike={l.bikeId && l.bikeId === listing.bikeId ? bike : null}
                onOpen={onOpen}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function MoreRow({
  listing,
  bike,
  onOpen,
}: {
  listing: ShowroomListing;
  bike?: BikeLike | null;
  onOpen: (listing: ShowroomListing) => void;
}) {
  const photo = coverPhoto(listing, bike);
  return (
    <button
      type="button"
      onClick={() => onOpen(listing)}
      className="sr-panel-flat w-full flex items-center gap-3 p-2 text-left"
    >
      <span
        className="w-20 h-16 shrink-0 rounded-lg overflow-hidden grid place-items-center"
        style={{ background: 'var(--sr-ink)' }}
      >
        {photo ? (
          <img src={photo} alt={listing.title} className="w-full h-full object-cover block" />
        ) : (
          <Bike className="w-5 h-5" style={{ color: 'var(--sr-faint)' }} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold truncate">{listing.title}</span>
        <span className="block text-xs truncate" style={{ color: 'var(--sr-faint)' }}>
          {CATEGORY_LABELS[listing.category]}
        </span>
      </span>
      <span className="sr-display font-semibold text-sm shrink-0" style={{ color: 'var(--sr-accent)' }}>
        {formatPrice(listing.price, listing.priceType)}
      </span>
      <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--sr-faint)' }} />
    </button>
  );
}

export default ListingDetail;
