import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Eye,
  Inbox,
  LayoutGrid,
  Settings2,
  Store,
  Tag,
} from 'lucide-react';

import '../theme.css';

import type {
  LegalPage,
  Perspective,
  SellerProfile,
  ShowroomBundle,
  ShowroomInquiry,
  ShowroomListing,
  ShowroomSettings,
} from '../types';
import type { BikeLike } from '../lib/listing';
import {
  emptyListing,
  isPublic,
  listingFromBike,
  newId,
  uniqueSlug,
} from '../lib/listing';
import {
  buildBundle,
  downloadJson,
  loadFavorites,
  loadInquiries,
  loadListings,
  loadProfile,
  loadSettings,
  normalizeListing,
  parseBundle,
  saveFavorites,
  saveInquiries,
  saveListings,
  saveProfile,
  saveSettings,
} from '../lib/storage';
import {
  fetchInquiries,
  mergeInquiries,
  normalizeInquiry,
  submitInquiry,
  type InquiryDraft,
  type SubmitResult,
} from '../lib/inquiries';

import { SellerDashboard } from './seller/SellerDashboard';
import { ListingEditor } from './seller/ListingEditor';
import { InboxPanel } from './seller/InboxPanel';
import { SellerProfileForm } from './seller/SellerProfileForm';
import { StorefrontView } from './buyer/StorefrontView';
import { ListingDetail } from './buyer/ListingDetail';
import { LegalPages } from './buyer/LegalPages';

// ============================================================================
// Showroom – Wurzelkomponente
// ----------------------------------------------------------------------------
// Hält den kompletten Zustand des Reiters und schaltet zwischen den beiden
// Perspektiven um:
//
//   Verkäufer – Anzeigen pflegen, Bilder beschriften, Posteingang, Impressum
//   Käufer    – genau die Seite, die ein Interessent später im Netz sieht
//
// Dieselbe Komponente trägt auch die eigenständige Website: dort wird sie mit
// `lockedPerspective="kaeufer"` und einem fertigen `initialBundle` gerendert
// (siehe showroom/standalone/main.tsx).
// ============================================================================

type SellerView =
  | { kind: 'dashboard' }
  | { kind: 'editor'; id: string }
  | { kind: 'inbox' }
  | { kind: 'profile' };

type BuyerView =
  | { kind: 'storefront' }
  | { kind: 'detail'; id: string }
  | { kind: 'legal'; page: LegalPage };

export interface ShowroomModuleProps {
  /** Räder aus Tracking/Werkstatt – Grundlage für "Anzeige aus Rad erstellen". */
  bikes?: BikeLike[];
  /** Springt in die Werkstatt zum passenden Rad. */
  onNavigateToWorkshop?: (bikeId: string) => void;
  addLog?: (message: string, module?: 'tracking' | 'workshop' | 'stopwatch' | 'system') => void;
  /**
   * Spiegelt eine Anzeige in das Fahrrad-Dokument der Cloud.
   * Die Haupt-App reicht hier `updateBike` durch; ohne Anmeldung passiert nichts.
   */
  onPersistListingToBike?: (bikeId: string, listing: ShowroomListing) => void;
  /** Erzwingt eine Perspektive – für die eigenständige Website. */
  lockedPerspective?: Perspective;
  /** Vorgefertigte Daten (Website-Export) statt des Browser-Speichers. */
  initialBundle?: ShowroomBundle | null;
}

export function ShowroomModule({
  bikes = [],
  onNavigateToWorkshop,
  addLog,
  onPersistListingToBike,
  lockedPerspective,
  initialBundle,
}: ShowroomModuleProps) {
  const fromBundle = !!initialBundle;

  const [listings, setListings] = useState<ShowroomListing[]>(() =>
    initialBundle ? initialBundle.listings : loadListings(),
  );
  const [inquiries, setInquiries] = useState<ShowroomInquiry[]>(() =>
    fromBundle ? [] : loadInquiries(),
  );
  const [profile, setProfile] = useState<SellerProfile>(() =>
    initialBundle ? initialBundle.profile : loadProfile(),
  );
  const [settings, setSettings] = useState<ShowroomSettings>(() => {
    const base = loadSettings();
    return initialBundle ? { ...base, ...initialBundle.settings } : base;
  });
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites());

  const [perspective, setPerspective] = useState<Perspective>(
    () => lockedPerspective ?? settings.defaultPerspective,
  );
  const [sellerView, setSellerView] = useState<SellerView>({ kind: 'dashboard' });
  const [buyerView, setBuyerView] = useState<BuyerView>({ kind: 'storefront' });
  /** Welche Anzeige zuletzt geändert wurde – Auslöser für den Cloud-Spiegel. */
  const [mirrorId, setMirrorId] = useState<string | null>(null);

  // --- Speichern (im Website-Betrieb bewusst aus) --------------------------
  useEffect(() => {
    if (!fromBundle) saveListings(listings);
  }, [listings, fromBundle]);
  useEffect(() => {
    if (!fromBundle) saveInquiries(inquiries);
  }, [inquiries, fromBundle]);
  useEffect(() => {
    if (!fromBundle) saveProfile(profile);
  }, [profile, fromBundle]);
  useEffect(() => {
    if (!fromBundle) saveSettings(settings);
  }, [settings, fromBundle]);
  useEffect(() => {
    saveFavorites(favorites);
  }, [favorites]);

  // Geteilte Links (#/rad/<slug>) landen direkt auf der Anzeige.
  useEffect(() => {
    const match = /^#\/rad\/(.+)$/.exec(window.location.hash || '');
    if (!match) return;
    const key = decodeURIComponent(match[1]);
    const hit = listings.find((l) => l.slug === key || l.id === key);
    if (hit) {
      setPerspective(lockedPerspective ?? 'kaeufer');
      setBuyerView({ kind: 'detail', id: hit.id });
    }
    // Absichtlich nur beim ersten Rendern: die App lädt bei jedem Hash-Wechsel neu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bikeById = useCallback(
    (id?: string) => (id ? bikes.find((b) => b.id === id) ?? null : null),
    [bikes],
  );

  const publicListings = useMemo(() => listings.filter(isPublic), [listings]);

  // --- Anzeigen ------------------------------------------------------------

  const patchListing = useCallback((id: string, patch: Partial<ShowroomListing>) => {
    setListings((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...patch, updatedAt: Date.now() } : l)),
    );
    setMirrorId(id);
  }, []);

  /**
   * Anzeigen zu einem Rad werden in dessen Firestore-Dokument gespiegelt.
   * Bewusst verzögert: der Editor speichert bei jedem Tastendruck, und jeder
   * Tastendruck als Cloud-Schreibvorgang wäre unnötig teuer.
   */
  useEffect(() => {
    if (fromBundle || !onPersistListingToBike || !mirrorId) return;
    const listing = listings.find((l) => l.id === mirrorId);
    const bikeId = listing?.bikeId;
    if (!listing || !bikeId) return;
    const timer = setTimeout(() => onPersistListingToBike(bikeId, listing), 1500);
    return () => clearTimeout(timer);
  }, [listings, mirrorId, onPersistListingToBike, fromBundle]);

  /**
   * Anzeigen, die auf einem anderen Gerät angelegt wurden, kommen über das
   * Fahrrad-Dokument zurück. Nur fehlende werden übernommen – lokale Änderungen
   * dürfen dabei nicht überschrieben werden.
   */
  useEffect(() => {
    if (fromBundle) return;
    const fromCloud = bikes
      .map((b) => b.showroom)
      .filter((raw): raw is Record<string, unknown> => !!raw && typeof raw === 'object')
      .map((raw) => normalizeListing(raw as Partial<ShowroomListing>));
    if (fromCloud.length === 0) return;
    setListings((prev) => {
      const known = new Set(prev.map((l) => l.id));
      const missing = fromCloud.filter((l) => l.id && !known.has(l.id));
      return missing.length > 0 ? [...missing, ...prev] : prev;
    });
  }, [bikes, fromBundle]);

  const createFromBike = useCallback(
    (bikeId: string) => {
      const bike = bikes.find((b) => b.id === bikeId);
      if (!bike) return;
      const listing = listingFromBike(bike, listings.map((l) => l.slug));
      setListings((prev) => [listing, ...prev]);
      setSellerView({ kind: 'editor', id: listing.id });
      addLog?.(`Showroom-Anzeige aus "${bike.name}" erstellt`, 'tracking');
    },
    [bikes, listings, addLog],
  );

  const createEmpty = useCallback(() => {
    const listing = {
      ...emptyListing(),
      title: 'Neue Anzeige',
      slug: uniqueSlug('neue-anzeige', listings.map((l) => l.slug)),
    };
    setListings((prev) => [listing, ...prev]);
    setSellerView({ kind: 'editor', id: listing.id });
  }, [listings]);

  const duplicateListing = useCallback(
    (id: string) => {
      const src = listings.find((l) => l.id === id);
      if (!src) return;
      const copy: ShowroomListing = {
        ...src,
        id: newId(),
        bikeId: undefined,
        slug: uniqueSlug(`${src.title} kopie`, listings.map((l) => l.slug)),
        title: `${src.title} (Kopie)`,
        status: 'entwurf',
        publishedAt: null,
        soldAt: null,
        views: 0,
        likes: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setListings((prev) => [copy, ...prev]);
      setSellerView({ kind: 'editor', id: copy.id });
    },
    [listings],
  );

  const deleteListing = useCallback(
    (id: string) => {
      const l = listings.find((x) => x.id === id);
      if (l && !window.confirm(`Anzeige "${l.title}" wirklich löschen?`)) return;
      setListings((prev) => prev.filter((x) => x.id !== id));
      setSellerView({ kind: 'dashboard' });
      if (l) addLog?.(`Showroom-Anzeige gelöscht: "${l.title}"`, 'tracking');
    },
    [listings, addLog],
  );

  const changeStatus = useCallback(
    (id: string, status: ShowroomListing['status']) => {
      const patch: Partial<ShowroomListing> = { status };
      if (status === 'online') patch.publishedAt = Date.now();
      if (status === 'verkauft') patch.soldAt = Date.now();
      patchListing(id, patch);
    },
    [patchListing],
  );

  const toggleFavorite = useCallback(
    (id: string) => {
      // Der Zähler folgt der Merkliste, damit beides nicht auseinanderläuft.
      const wasLiked = favorites.includes(id);
      setFavorites(wasLiked ? favorites.filter((f) => f !== id) : [...favorites, id]);
      setListings((prev) =>
        prev.map((l) =>
          l.id === id ? { ...l, likes: Math.max(0, l.likes + (wasLiked ? -1 : 1)) } : l,
        ),
      );
    },
    [favorites],
  );

  const openListing = useCallback((listing: ShowroomListing) => {
    setBuyerView({ kind: 'detail', id: listing.id });
    setListings((prev) =>
      prev.map((l) => (l.id === listing.id ? { ...l, views: l.views + 1 } : l)),
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // --- Anfragen ------------------------------------------------------------

  const handleSubmitInquiry = useCallback(
    async (draft: InquiryDraft): Promise<SubmitResult> => {
      // Auf der echten Website liefe "lokal" ins Leere: die Anfrage landete im
      // Browser des Interessenten. Dort ist der Mailweg der ehrliche Rückfall.
      const effective =
        fromBundle && settings.transport === 'lokal' && profile.email
          ? { ...settings, transport: 'mailto' as const }
          : settings;
      const result = await submitInquiry(draft, effective, profile);
      if (result.via === 'lokal') {
        // submitInquiry hat bereits in den Speicher geschrieben – Zustand nachziehen.
        setInquiries(loadInquiries());
      }
      return result;
    },
    [settings, profile, fromBundle],
  );

  const refreshInquiries = useCallback(async () => {
    const newest = inquiries[0]?.createdAt;
    const { inquiries: incoming, error } = await fetchInquiries(settings, newest);
    if (error) return { added: 0, error };
    const { merged, added } = mergeInquiries(inquiries, incoming);
    setInquiries(merged);
    return { added };
  }, [inquiries, settings]);

  const importInquiries = useCallback(
    (json: string) => {
      try {
        const data = JSON.parse(json);
        const raw = Array.isArray(data) ? data : data?.inquiries;
        if (!Array.isArray(raw)) return { added: 0, error: 'Keine Anfragen in der Datei gefunden.' };
        const parsed = raw
          .map((r: unknown) => normalizeInquiry(r))
          .filter((i): i is ShowroomInquiry => i !== null)
          .map((i) => ({ ...i, channel: 'import' as const }));
        const { merged, added } = mergeInquiries(inquiries, parsed);
        setInquiries(merged);
        return { added };
      } catch (e) {
        return { added: 0, error: e instanceof Error ? e.message : String(e) };
      }
    },
    [inquiries],
  );

  const unreadCount = inquiries.filter((i) => i.status === 'neu').length;

  // --- Export / Import -----------------------------------------------------

  const exportWebsite = useCallback(() => {
    downloadJson('showroom-data.json', buildBundle(profile, listings, settings));
    addLog?.('Showroom-Daten für die Website exportiert', 'system');
  }, [profile, listings, settings, addLog]);

  const importBundle = useCallback(
    (json: string) => {
      const bundle = parseBundle(json);
      if (!bundle) return false;
      setProfile(bundle.profile);
      setSettings((prev) => ({ ...prev, ...bundle.settings }));
      setListings((prev) => {
        const byId = new Map(prev.map((l) => [l.id, l]));
        for (const l of bundle.listings) byId.set(l.id, l);
        return [...byId.values()];
      });
      return true;
    },
    [],
  );

  // --- Darstellung ---------------------------------------------------------

  const accentStyle = { ['--sr-accent' as string]: profile.accent } as React.CSSProperties;
  const showSwitch = !lockedPerspective;

  const activeSellerListing =
    sellerView.kind === 'editor' ? listings.find((l) => l.id === sellerView.id) : undefined;
  const activeBuyerListing =
    buyerView.kind === 'detail' ? listings.find((l) => l.id === buyerView.id) : undefined;

  return (
    <div className="sr-root sr-wood sr-grain relative min-h-[70vh] rounded-2xl overflow-hidden" style={accentStyle}>
      {showSwitch && (
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-[var(--sr-line)]">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl grid place-items-center border"
              style={{
                borderColor: 'var(--sr-accent-line)',
                background: 'var(--sr-accent-soft)',
              }}
            >
              <Store className="w-5 h-5" style={{ color: 'var(--sr-accent)' }} />
            </div>
            <div className="leading-tight">
              <div className="sr-display text-lg font-semibold">
                {profile.displayName || 'Showroom'}
              </div>
              <div className="sr-eyebrow">
                {perspective === 'verkaeufer' ? 'Verkäufer-Ansicht' : 'Käufer-Ansicht'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {perspective === 'verkaeufer' && (
              <div className="hidden sm:flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSellerView({ kind: 'dashboard' })}
                  className={`sr-btn ${sellerView.kind === 'dashboard' ? 'sr-btn-ghost' : 'sr-btn-quiet'}`}
                >
                  <LayoutGrid className="w-4 h-4" />
                  Anzeigen
                </button>
                <button
                  type="button"
                  onClick={() => setSellerView({ kind: 'inbox' })}
                  className={`sr-btn relative ${sellerView.kind === 'inbox' ? 'sr-btn-ghost' : 'sr-btn-quiet'}`}
                >
                  <Inbox className="w-4 h-4" />
                  Posteingang
                  {unreadCount > 0 && (
                    <span
                      className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                      style={{ background: 'var(--sr-accent)', color: '#17110a' }}
                    >
                      {unreadCount}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setSellerView({ kind: 'profile' })}
                  className={`sr-btn ${sellerView.kind === 'profile' ? 'sr-btn-ghost' : 'sr-btn-quiet'}`}
                >
                  <Settings2 className="w-4 h-4" />
                  Profil
                </button>
              </div>
            )}

            {/* Perspektiven-Umschalter */}
            <div className="sr-inset flex items-center p-1 gap-1">
              {(
                [
                  { key: 'verkaeufer' as const, label: 'Verkäufer', Icon: Tag },
                  { key: 'kaeufer' as const, label: 'Käufer', Icon: Eye },
                ]
              ).map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPerspective(key)}
                  className={`sr-btn ${perspective === key ? 'sr-btn-primary' : 'sr-btn-quiet'}`}
                  style={{ padding: '7px 14px', fontSize: 13 }}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Zweite Zeile für schmale Bildschirme */}
      {showSwitch && perspective === 'verkaeufer' && (
        <div className="sm:hidden relative z-10 flex items-center gap-1 px-4 pb-3">
          <button
            type="button"
            onClick={() => setSellerView({ kind: 'dashboard' })}
            className={`sr-btn flex-1 ${sellerView.kind === 'dashboard' ? 'sr-btn-ghost' : 'sr-btn-quiet'}`}
          >
            <LayoutGrid className="w-4 h-4" />
            Anzeigen
          </button>
          <button
            type="button"
            onClick={() => setSellerView({ kind: 'inbox' })}
            className={`sr-btn flex-1 ${sellerView.kind === 'inbox' ? 'sr-btn-ghost' : 'sr-btn-quiet'}`}
          >
            <Inbox className="w-4 h-4" />
            Eingang{unreadCount > 0 ? ` (${unreadCount})` : ''}
          </button>
          <button
            type="button"
            onClick={() => setSellerView({ kind: 'profile' })}
            className={`sr-btn flex-1 ${sellerView.kind === 'profile' ? 'sr-btn-ghost' : 'sr-btn-quiet'}`}
          >
            <Settings2 className="w-4 h-4" />
            Profil
          </button>
        </div>
      )}

      <div className="relative z-10 sr-fade-in">
        {perspective === 'verkaeufer' ? (
          <>
            {sellerView.kind === 'dashboard' && (
              <SellerDashboard
                listings={listings}
                inquiries={inquiries}
                bikes={bikes}
                profile={profile}
                settings={settings}
                bikeById={bikeById}
                onEdit={(id) => setSellerView({ kind: 'editor', id })}
                onCreateFromBike={createFromBike}
                onCreateEmpty={createEmpty}
                onDelete={deleteListing}
                onDuplicate={duplicateListing}
                onStatusChange={changeStatus}
                onPreview={(id) => {
                  setPerspective('kaeufer');
                  setBuyerView({ kind: 'detail', id });
                }}
                onOpenInbox={() => setSellerView({ kind: 'inbox' })}
                onOpenProfile={() => setSellerView({ kind: 'profile' })}
                onNavigateToWorkshop={onNavigateToWorkshop}
              />
            )}

            {sellerView.kind === 'editor' &&
              (activeSellerListing ? (
                <ListingEditor
                  listing={activeSellerListing}
                  bike={bikeById(activeSellerListing.bikeId)}
                  profile={profile}
                  settings={settings}
                  onChange={(patch) => patchListing(activeSellerListing.id, patch)}
                  onClose={() => setSellerView({ kind: 'dashboard' })}
                  onDelete={() => deleteListing(activeSellerListing.id)}
                  onPreview={() => {
                    setPerspective('kaeufer');
                    setBuyerView({ kind: 'detail', id: activeSellerListing.id });
                  }}
                />
              ) : (
                <MissingListing onBack={() => setSellerView({ kind: 'dashboard' })} />
              ))}

            {sellerView.kind === 'inbox' && (
              <InboxPanel
                inquiries={inquiries}
                listings={listings}
                profile={profile}
                settings={settings}
                onUpdate={(id, patch) =>
                  setInquiries((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
                }
                onDelete={(id) => setInquiries((prev) => prev.filter((i) => i.id !== id))}
                onRefresh={refreshInquiries}
                onImport={importInquiries}
                onBack={() => setSellerView({ kind: 'dashboard' })}
                onOpenListing={(id) => setSellerView({ kind: 'editor', id })}
              />
            )}

            {sellerView.kind === 'profile' && (
              <SellerProfileForm
                profile={profile}
                settings={settings}
                listings={listings}
                onProfileChange={(patch) => setProfile((p) => ({ ...p, ...patch }))}
                onSettingsChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
                onExportWebsite={exportWebsite}
                onImportBundle={importBundle}
                onBack={() => setSellerView({ kind: 'dashboard' })}
              />
            )}
          </>
        ) : (
          <>
            {buyerView.kind === 'storefront' && (
              <StorefrontView
                listings={publicListings}
                profile={profile}
                settings={settings}
                bikeById={bikeById}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
                onOpen={openListing}
                onOpenLegal={(page) => setBuyerView({ kind: 'legal', page })}
                onSubmitInquiry={handleSubmitInquiry}
              />
            )}

            {buyerView.kind === 'detail' &&
              (activeBuyerListing ? (
                <ListingDetail
                  listing={activeBuyerListing}
                  bike={bikeById(activeBuyerListing.bikeId)}
                  profile={profile}
                  settings={settings}
                  isFavorite={favorites.includes(activeBuyerListing.id)}
                  onToggleFavorite={toggleFavorite}
                  onBack={() => setBuyerView({ kind: 'storefront' })}
                  onSubmitInquiry={handleSubmitInquiry}
                  onOpenLegal={(page) => setBuyerView({ kind: 'legal', page })}
                  moreListings={publicListings.filter((l) => l.id !== activeBuyerListing.id)}
                  onOpen={openListing}
                />
              ) : (
                <MissingListing onBack={() => setBuyerView({ kind: 'storefront' })} />
              ))}

            {buyerView.kind === 'legal' && (
              <LegalPages
                page={buyerView.page}
                profile={profile}
                onBack={() => setBuyerView({ kind: 'storefront' })}
                onOpenLegal={(page) => setBuyerView({ kind: 'legal', page })}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MissingListing({ onBack }: { onBack: () => void }) {
  return (
    <div className="p-10 text-center">
      <p className="text-[var(--sr-muted)] mb-4">Diese Anzeige gibt es nicht mehr.</p>
      <button type="button" onClick={onBack} className="sr-btn sr-btn-ghost">
        <ArrowLeft className="w-4 h-4" />
        Zurück
      </button>
    </div>
  );
}

export default ShowroomModule;
