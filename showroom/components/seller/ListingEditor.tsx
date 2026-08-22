import { useRef, useState } from 'react';
import {
  ArrowLeft,
  Bike as BikeIcon,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  Eye,
  Link2,
  Plus,
  RotateCw,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';

import type {
  BikeCategory,
  DeliveryOption,
  Hotspot,
  ListingCondition,
  ListingLocation,
  ListingSpec,
  ListingStatus,
  PriceType,
  SellerProfile,
  ShowroomListing,
  ShowroomSettings,
} from '../../types';
import type { BikeLike } from '../../lib/listing';
import { formatPrice, listingPhotos, newId, relativeDate, slugify } from '../../lib/listing';
import { copyToClipboard, listingUrl } from '../../lib/share';
import { suggestDescription, suggestTitle } from '../../lib/textSuggestions';
import {
  CATEGORY_LABELS,
  CONDITION_HINTS,
  CONDITION_LABELS,
  DELIVERY_LABELS,
  EXTRA_SUGGESTIONS,
  PRICE_TYPE_LABELS,
  STATUS_LABELS,
  profileGaps,
} from '../../config/seller';
import { HotspotEditor } from './HotspotEditor';

// ============================================================================
// Anzeigen-Editor
// ----------------------------------------------------------------------------
// Der Arbeitsplatz des Verkäufers. Jede Änderung geht sofort über `onChange`
// nach oben – deshalb gibt es keinen Speichern-Knopf, sondern nur den ruhigen
// Hinweis "Automatisch gespeichert".
//
// Fotos einer Anzeige sind zwei Quellen in einer Liste: erst die aus dem
// Werkstatt-Rad referenzierten (`photoIndices`), dann die eigenen (`photos`).
// `hotspots[].photoIndex` und `coverIndex` zeigen auf diese zusammengesetzte
// Liste. Ändert sich ihre Reihenfolge oder Länge, müssen beide mitgezogen
// werden – dafür ist `remapPhotoRefs` da.
// ============================================================================

export interface ListingEditorProps {
  listing: ShowroomListing;
  bike?: BikeLike | null;
  profile: SellerProfile;
  settings: ShowroomSettings;
  onChange: (patch: Partial<ShowroomListing>) => void;
  onClose: () => void;
  onDelete: () => void;
  onPreview: () => void;
}

type SectionKey = 'eckdaten' | 'bilder' | 'text' | 'preis' | 'publish';

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'eckdaten', label: 'Eckdaten' },
  { key: 'bilder', label: 'Bilder & Punkte' },
  { key: 'text', label: 'Beschreibung' },
  { key: 'preis', label: 'Preis & Übergabe' },
  { key: 'publish', label: 'Veröffentlichen' },
];

/** Über 1,5 MB je Bild läuft der Browser-Speicher schnell voll. */
const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024;

// --- kleine Bausteine ------------------------------------------------------

function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  inputMode,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
}) {
  return (
    <label className="block">
      <span className="sr-label">{label}</span>
      <input
        className="sr-input"
        value={value ?? ''}
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? (
        <span className="mt-1 block text-xs" style={{ color: 'var(--sr-faint)' }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-3">
      <h3 className="sr-display text-lg font-semibold">{title}</h3>
      {note ? (
        <p className="text-sm mt-0.5" style={{ color: 'var(--sr-muted)' }}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

function ChecklistRow({ ok, text, missing }: { ok: boolean; text: string; missing: string }) {
  return (
    <li className="flex items-start gap-3">
      {ok ? (
        <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--sr-good)' }} />
      ) : (
        <Circle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--sr-warn)' }} />
      )}
      <div className="min-w-0">
        <div className="text-sm font-semibold">{text}</div>
        {!ok ? (
          <div className="text-xs" style={{ color: 'var(--sr-warn)' }}>
            {missing}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** Liest ein Bild als data:-URL ein – alles bleibt im Browser. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Zieht Bildpunkte und Titelbild mit, wenn sich die Bilderliste ändert.
 * `map` liefert für jeden alten Bildindex den neuen – oder -1, wenn das Bild weg ist.
 */
function remapPhotoRefs(
  listing: ShowroomListing,
  map: (oldIndex: number) => number,
): Partial<ShowroomListing> {
  const hotspots: Hotspot[] = (listing.hotspots ?? [])
    .map((h) => ({ ...h, photoIndex: map(h.photoIndex) }))
    .filter((h) => h.photoIndex >= 0);
  const cover = map(listing.coverIndex ?? 0);
  return { hotspots, coverIndex: cover >= 0 ? cover : 0 };
}

/** Textfelder, die sich aus den Werkstatt-Details eines Rads füllen lassen. */
const BIKE_FIELDS: {
  key: keyof ShowroomListing;
  from: (d: NonNullable<BikeLike['details']>) => string | undefined;
}[] = [
  { key: 'brand', from: (d) => d.marke },
  { key: 'model', from: (d) => d.modell },
  { key: 'year', from: (d) => d.baujahr },
  { key: 'color', from: (d) => d.farbe },
  { key: 'frameSize', from: (d) => d.rahmenhoehe },
  { key: 'wheelSize', from: (d) => d.laufradgroesse },
  { key: 'gearSystem', from: (d) => d.gangschaltung },
  { key: 'gearCount', from: (d) => d.anzahlGaenge },
];

// --- Editor ----------------------------------------------------------------

export function ListingEditor({
  listing,
  bike,
  profile,
  settings,
  onChange,
  onClose,
  onDelete,
  onPreview,
}: ListingEditorProps) {
  const [section, setSection] = useState<SectionKey>('eckdaten');
  const [photoIndex, setPhotoIndex] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [busy, setBusy] = useState<'text' | 'titel' | null>(null);
  const [copied, setCopied] = useState(false);
  const [extraInput, setExtraInput] = useState('');
  const [defectInput, setDefectInput] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const photos = listingPhotos(listing, bike);
  const bikePhotos = bike?.photos ?? [];
  // Nur auflösbare Verweise – so entspricht die Position hier exakt der in `photos`.
  const usedBikeIndices = (listing.photoIndices ?? []).filter(
    (i) => typeof bikePhotos[i] === 'string' && bikePhotos[i].length > 0,
  );
  const ownPhotos = listing.photos ?? [];
  const bikeCount = usedBikeIndices.length;

  const setField = (key: keyof ShowroomListing, value: string) =>
    onChange({ [key]: value } as Partial<ShowroomListing>);

  // --- Eckdaten aus der Werkstatt ------------------------------------------

  const applyFromBike = () => {
    if (!bike) return;
    const d = bike.details ?? {};
    const patch: Record<string, unknown> = {};
    for (const { key, from } of BIKE_FIELDS) {
      const value = (from(d) ?? '').trim();
      if (!value) continue;
      const current = String(
        (listing as unknown as Record<string, unknown>)[key as string] ?? '',
      ).trim();
      // Nichts überschreiben, was schon getippt wurde.
      if (current) continue;
      patch[key as string] = value;
    }
    const maengel = (d.maengel ?? []).map((m) => (m?.text ?? '').trim()).filter(Boolean);
    const neue = maengel.filter((t) => !(listing.defects ?? []).includes(t));
    if (neue.length) patch.defects = [...(listing.defects ?? []), ...neue];
    if (Object.keys(patch).length) onChange(patch as Partial<ShowroomListing>);
  };

  // --- Bilder ---------------------------------------------------------------

  const toggleBikePhoto = (bikeIdx: number) => {
    const pos = usedBikeIndices.indexOf(bikeIdx);
    if (pos >= 0) {
      const next = usedBikeIndices.filter((i) => i !== bikeIdx);
      onChange({
        photoIndices: next,
        ...remapPhotoRefs(listing, (old) => (old === pos ? -1 : old > pos ? old - 1 : old)),
      });
    } else {
      // Neue Werkstatt-Bilder hängen sich hinten an den Werkstatt-Block an.
      const next = [...usedBikeIndices, bikeIdx];
      onChange({
        photoIndices: next,
        ...remapPhotoRefs(listing, (old) => (old >= bikeCount ? old + 1 : old)),
      });
    }
  };

  const movePhoto = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= photos.length) return;
    // Getauscht wird nur innerhalb derselben Quelle – sonst müssten Werkstatt-
    // und eigene Bilder die Plätze tauschen, was es nicht gibt.
    const sameBlock = (index < bikeCount) === (target < bikeCount);
    if (!sameBlock) return;

    const swap = (old: number) => (old === index ? target : old === target ? index : old);

    if (index < bikeCount) {
      const next = [...usedBikeIndices];
      [next[index], next[target]] = [next[target], next[index]];
      onChange({ photoIndices: next, ...remapPhotoRefs(listing, swap) });
    } else {
      const a = index - bikeCount;
      const b = target - bikeCount;
      const next = [...ownPhotos];
      [next[a], next[b]] = [next[b], next[a]];
      onChange({ photos: next, ...remapPhotoRefs(listing, swap) });
    }
  };

  const removePhoto = (index: number) => {
    if (index < bikeCount) {
      toggleBikePhoto(usedBikeIndices[index]);
      return;
    }
    const ownIdx = index - bikeCount;
    onChange({
      photos: ownPhotos.filter((_, i) => i !== ownIdx),
      ...remapPhotoRefs(listing, (old) => (old === index ? -1 : old > index ? old - 1 : old)),
    });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const accepted: string[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_PHOTO_BYTES) {
        rejected.push(file.name);
        continue;
      }
      try {
        accepted.push(await readAsDataUrl(file));
      } catch {
        rejected.push(file.name);
      }
    }
    // Neue Bilder hängen hinten dran, deshalb verschiebt sich kein Index.
    if (accepted.length) onChange({ photos: [...ownPhotos, ...accepted] });
    setUploadError(
      rejected.length
        ? `${rejected.join(', ')}: Bild ist zu groß (max. 1,5 MB) – bitte vorher verkleinern.`
        : '',
    );
    if (fileRef.current) fileRef.current.value = '';
  };

  // --- Texte ----------------------------------------------------------------

  const runSuggestDescription = async () => {
    if (
      (listing.description ?? '').trim() &&
      !window.confirm('Der vorhandene Beschreibungstext wird ersetzt. Fortfahren?')
    ) {
      return;
    }
    setBusy('text');
    try {
      const text = await suggestDescription({ listing, profile });
      onChange({ description: text });
    } finally {
      setBusy(null);
    }
  };

  const runSuggestTitle = async () => {
    setBusy('titel');
    try {
      const title = await suggestTitle({ listing, profile });
      onChange({ title });
    } finally {
      setBusy(null);
    }
  };

  const addExtra = (value: string) => {
    const v = value.trim();
    if (!v || (listing.extras ?? []).includes(v)) return;
    onChange({ extras: [...(listing.extras ?? []), v] });
  };

  const addDefect = (value: string) => {
    const v = value.trim();
    if (!v || (listing.defects ?? []).includes(v)) return;
    onChange({ defects: [...(listing.defects ?? []), v] });
  };

  // --- Preis & Übergabe -----------------------------------------------------

  const patchLocation = (patch: Partial<ListingLocation>) =>
    onChange({ location: { zip: '', city: '', ...(listing.location ?? {}), ...patch } });

  const toggleDelivery = (option: DeliveryOption) => {
    const current = listing.delivery ?? [];
    const next = current.includes(option)
      ? current.filter((d) => d !== option)
      : [...current, option];
    // Ohne Übergabeart kommt das Rad nie beim Käufer an.
    if (!next.length) return;
    onChange({ delivery: next });
  };

  // --- Veröffentlichen ------------------------------------------------------

  const gaps = profileGaps(profile);
  const url = listingUrl(listing, settings);
  const hasPublicBase = !!(settings.publicBaseUrl ?? '').trim();

  const copyLink = async () => {
    const ok = await copyToClipboard(url);
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const setStatus = (status: ListingStatus) => {
    const patch: Partial<ShowroomListing> = { status };
    if (status === 'online' && !listing.publishedAt) patch.publishedAt = Date.now();
    if (status === 'verkauft' && !listing.soldAt) patch.soldAt = Date.now();
    onChange(patch);
  };

  const checks = [
    {
      ok: (listing.title ?? '').trim().length >= 3,
      text: 'Titel gesetzt',
      missing: 'Ohne aussagekräftigen Titel findet dich niemand.',
    },
    {
      ok: listing.price != null || listing.priceType === 'verschenken',
      text: 'Preis gesetzt',
      missing: 'Trage unter "Preis & Übergabe" einen Preis ein.',
    },
    {
      ok: photos.length > 0,
      text: 'Mindestens ein Foto',
      missing: 'Ohne Bild schreibt dich kaum jemand an.',
    },
    {
      ok: (listing.description ?? '').trim().length >= 40,
      text: 'Beschreibung ausführlich genug',
      missing: 'Die Beschreibung ist noch sehr kurz (mindestens 40 Zeichen).',
    },
    {
      ok: !!(listing.location?.city ?? '').trim(),
      text: 'Ort gesetzt',
      missing: 'Käufer wollen wissen, wo das Rad steht.',
    },
    {
      ok: gaps.length === 0,
      text: 'Impressum vollständig',
      missing: `Im Profil fehlt noch: ${gaps.join(', ')}.`,
    },
  ];

  const turntableOn = !!listing.turntable?.enabled;

  return (
    <div className="pb-10">
      {/* Kopfzeile */}
      <div className="sticky top-0 z-20 sr-panel mx-3 sm:mx-6 mt-3 px-3 sm:px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onClose} className="sr-btn sr-btn-quiet">
            <ArrowLeft className="w-4 h-4" />
            Zurück
          </button>

          <div className="min-w-0 flex-1">
            <div className="sr-display text-base sm:text-lg font-semibold truncate">
              {(listing.title ?? '').trim() || 'Ohne Titel'}
            </div>
            <div className="text-[11px] flex items-center gap-1" style={{ color: 'var(--sr-faint)' }}>
              <Check className="w-3 h-3" />
              Automatisch gespeichert
              {listing.updatedAt ? ` · ${relativeDate(listing.updatedAt)}` : ''}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={onPreview} className="sr-btn sr-btn-ghost">
              <Eye className="w-4 h-4" />
              Vorschau
            </button>
            <select
              className="sr-select"
              style={{ width: 'auto' }}
              aria-label="Status der Anzeige"
              value={listing.status}
              onChange={(e) => setStatus(e.target.value as ListingStatus)}
            >
              {(Object.keys(STATUS_LABELS) as ListingStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <button type="button" onClick={onDelete} className="sr-btn sr-btn-danger">
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">Löschen</span>
            </button>
          </div>
        </div>

        {/* Abschnitte */}
        <div className="mt-3 flex gap-1 overflow-x-auto sr-scroll">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSection(s.key)}
              className={`sr-btn shrink-0 ${section === s.key ? 'sr-btn-primary' : 'sr-btn-quiet'}`}
              style={{ padding: '7px 12px', fontSize: 13 }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 sm:px-6 mt-4 space-y-4">
        {/* ------------------------------------------------ 1. Eckdaten */}
        {section === 'eckdaten' && (
          <div className="sr-panel p-4 sm:p-5 sr-fade-in">
            <SectionTitle
              title="Eckdaten"
              note="Das sind die Angaben, nach denen Käufer filtern und suchen."
            />

            {bike && (
              <div className="sr-panel-flat p-3 mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold flex items-center gap-2">
                    <BikeIcon className="w-4 h-4" style={{ color: 'var(--sr-accent)' }} />
                    Aus der Werkstatt übernehmen
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--sr-muted)' }}>
                    Füllt leere Felder aus „{bike.name}“ und ergänzt die dort notierten Mängel.
                    Was du schon getippt hast, bleibt stehen.
                  </p>
                </div>
                <button type="button" onClick={applyFromBike} className="sr-btn sr-btn-ghost">
                  <Wand2 className="w-4 h-4" />
                  Übernehmen
                </button>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <TextField
                  label="Titel"
                  value={listing.title}
                  onChange={(v) => setField('title', v)}
                  placeholder="z. B. Cube Attention 29 Zoll"
                />
              </div>
              <div className="sm:col-span-2">
                <TextField
                  label="Untertitel"
                  value={listing.subtitle}
                  onChange={(v) => setField('subtitle', v)}
                  placeholder="z. B. Rahmenhöhe 52 cm, frisch durchgesehen"
                />
              </div>

              <label className="block">
                <span className="sr-label">Kategorie</span>
                <select
                  className="sr-select"
                  value={listing.category}
                  onChange={(e) => onChange({ category: e.target.value as BikeCategory })}
                >
                  {(Object.keys(CATEGORY_LABELS) as BikeCategory[]).map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="sr-label">Zustand</span>
                <select
                  className="sr-select"
                  value={listing.condition}
                  onChange={(e) => onChange({ condition: e.target.value as ListingCondition })}
                >
                  {(Object.keys(CONDITION_LABELS) as ListingCondition[]).map((c) => (
                    <option key={c} value={c}>
                      {CONDITION_LABELS[c]}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs" style={{ color: 'var(--sr-faint)' }}>
                  {CONDITION_HINTS[listing.condition]}
                </span>
              </label>

              <TextField label="Marke" value={listing.brand} onChange={(v) => setField('brand', v)} />
              <TextField label="Modell" value={listing.model} onChange={(v) => setField('model', v)} />
              <TextField
                label="Baujahr"
                value={listing.year}
                onChange={(v) => setField('year', v)}
                inputMode="numeric"
                placeholder="z. B. 2018"
              />
              <TextField label="Farbe" value={listing.color} onChange={(v) => setField('color', v)} />
              <TextField
                label="Rahmenhöhe"
                value={listing.frameSize}
                onChange={(v) => setField('frameSize', v)}
                placeholder="z. B. 52 cm"
              />
              <TextField
                label="Laufradgröße"
                value={listing.wheelSize}
                onChange={(v) => setField('wheelSize', v)}
                placeholder="z. B. 28 Zoll"
              />
              <TextField
                label="Rahmenform"
                value={listing.frameType}
                onChange={(v) => setField('frameType', v)}
                placeholder="z. B. Diamant, Trapez, Tiefeinstieg"
              />
              <TextField
                label="Schaltung"
                value={listing.gearSystem}
                onChange={(v) => setField('gearSystem', v)}
                placeholder="z. B. Shimano Deore"
              />
              <TextField
                label="Anzahl Gänge"
                value={listing.gearCount}
                onChange={(v) => setField('gearCount', v)}
                inputMode="numeric"
              />
              <TextField
                label="Bremsen"
                value={listing.brakes}
                onChange={(v) => setField('brakes', v)}
                placeholder="z. B. V-Brake, Scheibenbremse"
              />
              <TextField
                label="Material"
                value={listing.material}
                onChange={(v) => setField('material', v)}
                placeholder="z. B. Aluminium, Stahl"
              />
              <TextField
                label="Gewicht (kg)"
                value={listing.weightKg}
                onChange={(v) => setField('weightKg', v)}
                inputMode="decimal"
              />
            </div>

            <hr className="sr-rule my-5" />

            <div className="flex items-center justify-between gap-3 mb-2">
              <h4 className="text-sm font-semibold">Weitere Eigenschaften</h4>
              <button
                type="button"
                className="sr-btn sr-btn-ghost"
                onClick={() =>
                  onChange({
                    specs: [...(listing.specs ?? []), { id: newId(), label: '', value: '' }],
                  })
                }
              >
                <Plus className="w-4 h-4" />
                Eigenschaft hinzufügen
              </button>
            </div>

            {(listing.specs ?? []).length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--sr-faint)' }}>
                Noch nichts ergänzt. Hier passt alles hin, was oben kein eigenes Feld hat –
                Rahmennummer, Reifenbreite, Sattelstütze …
              </p>
            ) : (
              <div className="space-y-2">
                {(listing.specs ?? []).map((spec: ListingSpec) => (
                  <div key={spec.id} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                    <input
                      className="sr-input"
                      style={{ flex: '1 1 40%' }}
                      value={spec.label}
                      placeholder="Bezeichnung"
                      onChange={(e) =>
                        onChange({
                          specs: (listing.specs ?? []).map((s) =>
                            s.id === spec.id ? { ...s, label: e.target.value } : s,
                          ),
                        })
                      }
                    />
                    <input
                      className="sr-input"
                      style={{ flex: '1 1 40%' }}
                      value={spec.value}
                      placeholder="Wert"
                      onChange={(e) =>
                        onChange({
                          specs: (listing.specs ?? []).map((s) =>
                            s.id === spec.id ? { ...s, value: e.target.value } : s,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="sr-btn sr-btn-danger"
                      onClick={() =>
                        onChange({ specs: (listing.specs ?? []).filter((s) => s.id !== spec.id) })
                      }
                      aria-label="Eigenschaft löschen"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------- 2. Bilder & Punkte */}
        {section === 'bilder' && (
          <div className="space-y-4 sr-fade-in">
            {bike && bikePhotos.length > 0 && (
              <div className="sr-panel p-4 sm:p-5">
                <SectionTitle
                  title="Fotos aus der Werkstatt"
                  note="Häkchen setzen, was in der Anzeige erscheinen soll. Die Bilder bleiben beim Rad – die Anzeige verweist nur darauf."
                />
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {bikePhotos.map((photo, i) => {
                    const used = usedBikeIndices.includes(i);
                    return (
                      <button
                        key={`${i}-${photo.slice(-24)}`}
                        type="button"
                        onClick={() => toggleBikePhoto(i)}
                        className="relative rounded-lg overflow-hidden aspect-[4/3]"
                        style={{
                          border: `2px solid ${used ? 'var(--sr-accent)' : 'var(--sr-line)'}`,
                          opacity: used ? 1 : 0.6,
                        }}
                        aria-pressed={used}
                      >
                        <img
                          src={photo}
                          alt={`Werkstattfoto ${i + 1} von ${bike.name}`}
                          className="w-full h-full object-cover"
                        />
                        <span
                          className="absolute right-1 top-1 w-5 h-5 rounded-full grid place-items-center"
                          style={{
                            background: used ? 'var(--sr-accent)' : 'rgba(0,0,0,0.6)',
                            color: used ? '#17110a' : 'var(--sr-faint)',
                          }}
                        >
                          {used ? <Check className="w-3 h-3" /> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="sr-panel p-4 sm:p-5">
              <SectionTitle
                title="Bilder der Anzeige"
                note="Reihenfolge festlegen, Titelbild bestimmen, eigene Bilder ergänzen."
              />

              <div className="flex flex-wrap items-center gap-2 mb-3">
                <button
                  type="button"
                  className="sr-btn sr-btn-ghost"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="w-4 h-4" />
                  Eigene Bilder hochladen
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void handleFiles(e.target.files);
                  }}
                />
                <span className="text-xs" style={{ color: 'var(--sr-faint)' }}>
                  Höchstens 1,5 MB je Bild – alles liegt im Browser-Speicher.
                </span>
              </div>

              {uploadError ? (
                <p className="text-sm mb-3" style={{ color: 'var(--sr-bad)' }}>
                  {uploadError}
                </p>
              ) : null}

              {photos.length === 0 ? (
                <div className="sr-inset p-8 text-center">
                  <BikeIcon className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--sr-faint)' }} />
                  <p className="text-sm" style={{ color: 'var(--sr-muted)' }}>
                    Noch kein Foto
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {photos.map((photo, i) => {
                    const isCover = (listing.coverIndex ?? 0) === i;
                    const fromBike = i < bikeCount;
                    return (
                      <div key={`${i}-${photo.slice(-24)}`} className="sr-panel-flat p-2">
                        <div className="relative rounded-lg overflow-hidden aspect-[4/3] mb-2">
                          <img
                            src={photo}
                            alt={`Bild ${i + 1} der Anzeige`}
                            className="w-full h-full object-cover"
                          />
                          {isCover ? (
                            <span
                              className="sr-chip sr-chip-accent absolute left-1 top-1"
                              style={{ fontSize: 10 }}
                            >
                              Titelbild
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center justify-between gap-1">
                          <button
                            type="button"
                            className="sr-btn sr-btn-quiet"
                            style={{ padding: 6 }}
                            onClick={() => movePhoto(i, -1)}
                            disabled={i === 0 || i === bikeCount}
                            aria-label="Bild nach links"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            className="sr-btn sr-btn-quiet"
                            style={{ padding: 6, fontSize: 11 }}
                            onClick={() => onChange({ coverIndex: i })}
                            disabled={isCover}
                          >
                            <Star className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            className="sr-btn sr-btn-quiet"
                            style={{ padding: 6 }}
                            onClick={() => removePhoto(i)}
                            aria-label={fromBike ? 'Bild aus der Anzeige nehmen' : 'Bild löschen'}
                          >
                            <X className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            className="sr-btn sr-btn-quiet"
                            style={{ padding: 6 }}
                            onClick={() => movePhoto(i, 1)}
                            disabled={i === photos.length - 1 || i === bikeCount - 1}
                            aria-label="Bild nach rechts"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                        <p
                          className="mt-1 text-center text-[10px]"
                          style={{ color: 'var(--sr-faint)' }}
                        >
                          {fromBike ? 'aus der Werkstatt' : 'eigenes Bild'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              <hr className="sr-rule my-5" />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold flex items-center gap-2">
                    <RotateCw className="w-4 h-4" style={{ color: 'var(--sr-accent)' }} />
                    Drehansicht anbieten
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--sr-muted)' }}>
                    Ehrlich gesagt lohnt sich das nur, wenn mindestens 3 Fotos rundherum vom selben
                    Rad aus gleicher Höhe aufgenommen sind. Sonst wirkt es zappelig.
                  </p>
                </div>
                <button
                  type="button"
                  className={`sr-btn ${turntableOn ? 'sr-btn-primary' : 'sr-btn-ghost'}`}
                  onClick={() =>
                    onChange({ turntable: { enabled: !turntableOn, startIndex: 0 } })
                  }
                  aria-pressed={turntableOn}
                >
                  {turntableOn ? 'An' : 'Aus'}
                </button>
              </div>
            </div>

            <div className="sr-panel p-4 sm:p-5">
              <SectionTitle
                title="Bauteile beschriften"
                note="Beschriftete Punkte im Bild beantworten die Fragen, die sonst per Nachricht kommen."
              />
              <HotspotEditor
                photos={photos}
                photoIndex={photoIndex}
                hotspots={listing.hotspots ?? []}
                onChange={(hotspots) => onChange({ hotspots })}
                onPhotoIndexChange={setPhotoIndex}
              />
            </div>
          </div>
        )}

        {/* -------------------------------------------- 3. Beschreibung */}
        {section === 'text' && (
          <div className="space-y-4 sr-fade-in">
            <div className="sr-panel p-4 sm:p-5">
              <SectionTitle
                title="Beschreibung"
                note="Schreib so, wie du es am Telefon erklären würdest."
              />

              <div className="flex flex-wrap items-center gap-2 mb-3">
                <button
                  type="button"
                  className="sr-btn sr-btn-ghost"
                  onClick={() => void runSuggestDescription()}
                  disabled={busy !== null}
                >
                  <Sparkles className="w-4 h-4" />
                  {busy === 'text' ? 'Einen Moment …' : 'Text vorschlagen'}
                </button>
                <button
                  type="button"
                  className="sr-btn sr-btn-ghost"
                  onClick={() => void runSuggestTitle()}
                  disabled={busy !== null}
                >
                  <Wand2 className="w-4 h-4" />
                  {busy === 'titel' ? 'Einen Moment …' : 'Titel vorschlagen'}
                </button>
              </div>

              <textarea
                className="sr-textarea min-h-[300px]"
                value={listing.description ?? ''}
                onChange={(e) => onChange({ description: e.target.value })}
                placeholder="Woher kommt das Rad, was wurde gemacht, was sollte man wissen?"
              />
              <p className="mt-1 text-xs text-right" style={{ color: 'var(--sr-faint)' }}>
                {(listing.description ?? '').length} Zeichen
              </p>
            </div>

            <div className="sr-panel p-4 sm:p-5">
              <SectionTitle title="Zubehör" note="Was geht mit über den Tisch?" />

              {(listing.extras ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {(listing.extras ?? []).map((extra) => (
                    <span key={extra} className="sr-chip sr-chip-accent">
                      {extra}
                      <button
                        type="button"
                        onClick={() =>
                          onChange({ extras: (listing.extras ?? []).filter((x) => x !== extra) })
                        }
                        aria-label={`${extra} entfernen`}
                        style={{ lineHeight: 0 }}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex gap-2 mb-3">
                <input
                  className="sr-input"
                  value={extraInput}
                  placeholder="Zubehör eintragen und Enter drücken"
                  onChange={(e) => setExtraInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    addExtra(extraInput);
                    setExtraInput('');
                  }}
                />
                <button
                  type="button"
                  className="sr-btn sr-btn-ghost shrink-0"
                  onClick={() => {
                    addExtra(extraInput);
                    setExtraInput('');
                  }}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <p className="sr-eyebrow mb-2">Vorschläge</p>
              <div className="flex flex-wrap gap-1.5">
                {EXTRA_SUGGESTIONS.map((suggestion) => {
                  const used = (listing.extras ?? []).includes(suggestion);
                  return (
                    <button
                      key={suggestion}
                      type="button"
                      className="sr-chip"
                      disabled={used}
                      onClick={() => addExtra(suggestion)}
                      style={{ opacity: used ? 0.4 : 1, cursor: used ? 'default' : 'pointer' }}
                    >
                      {used ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                      {suggestion}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="sr-panel p-4 sm:p-5">
              <SectionTitle
                title="Bekannte Mängel"
                note="Offen genannte Mängel gelten als vereinbarte Beschaffenheit – das schützt dich später."
              />

              {(listing.defects ?? []).length > 0 && (
                <ul className="space-y-1.5 mb-3">
                  {(listing.defects ?? []).map((defect) => (
                    <li
                      key={defect}
                      className="flex items-center gap-2 sr-panel-flat px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 text-sm">{defect}</span>
                      <button
                        type="button"
                        className="sr-btn sr-btn-quiet"
                        style={{ padding: 6 }}
                        onClick={() =>
                          onChange({
                            defects: (listing.defects ?? []).filter((d) => d !== defect),
                          })
                        }
                        aria-label={`Mangel "${defect}" entfernen`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex gap-2">
                <input
                  className="sr-input"
                  value={defectInput}
                  placeholder="z. B. Kratzer am Oberrohr"
                  onChange={(e) => setDefectInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    addDefect(defectInput);
                    setDefectInput('');
                  }}
                />
                <button
                  type="button"
                  className="sr-btn sr-btn-ghost shrink-0"
                  onClick={() => {
                    addDefect(defectInput);
                    setDefectInput('');
                  }}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---------------------------------------- 4. Preis & Übergabe */}
        {section === 'preis' && (
          <div className="space-y-4 sr-fade-in">
            <div className="sr-panel p-4 sm:p-5">
              <SectionTitle title="Preis" />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="sr-label">Preis (Euro)</span>
                  <input
                    className="sr-input"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="decimal"
                    value={listing.price ?? ''}
                    placeholder="leer lassen = Preis auf Anfrage"
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') return onChange({ price: null });
                      const n = Number(raw);
                      onChange({ price: Number.isFinite(n) ? n : null });
                    }}
                  />
                </label>

                <label className="block">
                  <span className="sr-label">Preistyp</span>
                  <select
                    className="sr-select"
                    value={listing.priceType}
                    onChange={(e) => onChange({ priceType: e.target.value as PriceType })}
                  >
                    {(Object.keys(PRICE_TYPE_LABELS) as PriceType[]).map((p) => (
                      <option key={p} value={p}>
                        {PRICE_TYPE_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {bike && (
                <div className="sr-inset p-3 mt-4">
                  <p className="sr-eyebrow mb-1">Interne Kalkulation – die sieht nur du</p>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    <span style={{ color: 'var(--sr-muted)' }}>
                      Einkauf:{' '}
                      <span style={{ color: 'var(--sr-text)' }}>
                        {formatPrice(bike.purchasePrice, 'fest')}
                      </span>
                    </span>
                    <span style={{ color: 'var(--sr-muted)' }}>
                      Zielpreis:{' '}
                      <span style={{ color: 'var(--sr-text)' }}>
                        {formatPrice(bike.targetSellingPrice ?? null, 'fest')}
                      </span>
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="sr-panel p-4 sm:p-5">
              <SectionTitle title="Übergabe" note="Mindestens eine Art muss gewählt bleiben." />
              <div className="flex flex-wrap gap-2">
                {(Object.keys(DELIVERY_LABELS) as DeliveryOption[]).map((option) => {
                  const active = (listing.delivery ?? []).includes(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => toggleDelivery(option)}
                      className={`sr-btn ${active ? 'sr-btn-primary' : 'sr-btn-ghost'}`}
                      aria-pressed={active}
                    >
                      {active ? <Check className="w-4 h-4" /> : null}
                      {DELIVERY_LABELS[option]}
                    </button>
                  );
                })}
              </div>

              {(listing.delivery ?? []).includes('versand') && (
                <div className="mt-3 sm:max-w-xs">
                  <label className="block">
                    <span className="sr-label">Versandkosten (Euro)</span>
                    <input
                      className="sr-input"
                      type="number"
                      min={0}
                      step={1}
                      inputMode="decimal"
                      value={listing.shippingCost ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === '') return onChange({ shippingCost: undefined });
                        const n = Number(raw);
                        onChange({ shippingCost: Number.isFinite(n) ? n : undefined });
                      }}
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="sr-panel p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <SectionTitle
                  title="Ort"
                  note="Der Stadtteil genügt – die genaue Anschrift steht nur im Impressum."
                />
                <button
                  type="button"
                  className="sr-btn sr-btn-ghost"
                  onClick={() =>
                    patchLocation({ zip: profile.zip ?? '', city: profile.city ?? '' })
                  }
                >
                  Aus dem Profil übernehmen
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <TextField
                  label="PLZ"
                  value={listing.location?.zip}
                  onChange={(v) => patchLocation({ zip: v })}
                  inputMode="numeric"
                />
                <TextField
                  label="Ort"
                  value={listing.location?.city}
                  onChange={(v) => patchLocation({ city: v })}
                />
                <TextField
                  label="Stadtteil"
                  value={listing.location?.district}
                  onChange={(v) => patchLocation({ district: v })}
                />
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------ 5. Veröffentlichen */}
        {section === 'publish' && (
          <div className="space-y-4 sr-fade-in">
            <div className="sr-panel p-4 sm:p-5">
              <SectionTitle
                title="Bereit zum Online-Stellen?"
                note="Was hier ein Häkchen hat, brauchst du nicht mehr anzufassen."
              />
              <ul className="space-y-2.5">
                {checks.map((c) => (
                  <ChecklistRow key={c.text} ok={c.ok} text={c.text} missing={c.missing} />
                ))}
              </ul>
            </div>

            <div className="sr-panel p-4 sm:p-5">
              <SectionTitle title="Adresse der Anzeige" />

              <div className="sr-inset p-3 flex flex-wrap items-center gap-2">
                <Link2 className="w-4 h-4 shrink-0" style={{ color: 'var(--sr-accent)' }} />
                <span
                  className="min-w-0 flex-1 text-xs break-all"
                  style={{ color: 'var(--sr-muted)' }}
                >
                  {url}
                </span>
                <button
                  type="button"
                  className="sr-btn sr-btn-ghost shrink-0"
                  onClick={() => void copyLink()}
                >
                  <Copy className="w-4 h-4" />
                  {copied ? 'Kopiert' : 'Kopieren'}
                </button>
              </div>

              {!hasPublicBase && (
                <p className="mt-2 text-xs" style={{ color: 'var(--sr-warn)' }}>
                  Dieser Link zeigt nur auf diesen Rechner. Trage im Profil die Adresse deiner
                  Website ein, dann wird daraus ein Link, den du weitergeben kannst.
                </p>
              )}

              <div className="mt-4 sm:max-w-md">
                <label className="block">
                  <span className="sr-label">Kurzname in der Adresse</span>
                  <input
                    className="sr-input"
                    value={listing.slug ?? ''}
                    placeholder="z. B. cube-attention-29-zoll"
                    onChange={(e) => onChange({ slug: e.target.value })}
                    onBlur={(e) => {
                      const clean = slugify(e.target.value);
                      if (clean !== listing.slug) onChange({ slug: clean });
                    }}
                  />
                </label>
              </div>

              <hr className="sr-rule my-5" />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold flex items-center gap-2">
                    <Star className="w-4 h-4" style={{ color: 'var(--sr-accent)' }} />
                    Als Empfehlung hervorheben
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--sr-muted)' }}>
                    Hervorgehobene Anzeigen stehen im Showroom ganz oben.
                  </p>
                </div>
                <button
                  type="button"
                  className={`sr-btn ${listing.featured ? 'sr-btn-primary' : 'sr-btn-ghost'}`}
                  onClick={() => onChange({ featured: !listing.featured })}
                  aria-pressed={!!listing.featured}
                >
                  {listing.featured ? 'An' : 'Aus'}
                </button>
              </div>
            </div>

            <div className="sr-panel p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row gap-3">
                {listing.status === 'online' ? (
                  <button
                    type="button"
                    className="sr-btn sr-btn-ghost flex-1"
                    style={{ padding: '14px 18px', fontSize: 15 }}
                    onClick={() => setStatus('entwurf')}
                  >
                    <Eye className="w-5 h-5" />
                    Wieder verstecken
                  </button>
                ) : (
                  <button
                    type="button"
                    className="sr-btn sr-btn-primary flex-1"
                    style={{ padding: '14px 18px', fontSize: 15 }}
                    onClick={() => setStatus('online')}
                  >
                    <Upload className="w-5 h-5" />
                    Online stellen
                  </button>
                )}
                <button
                  type="button"
                  className="sr-btn sr-btn-ghost"
                  style={{ padding: '14px 18px', fontSize: 15 }}
                  onClick={onPreview}
                >
                  <Eye className="w-5 h-5" />
                  Vorschau ansehen
                </button>
              </div>
              <p className="mt-2 text-xs" style={{ color: 'var(--sr-faint)' }}>
                Aktueller Status: {STATUS_LABELS[listing.status]}
                {listing.publishedAt ? ` · online seit ${relativeDate(listing.publishedAt)}` : ''}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ListingEditor;
