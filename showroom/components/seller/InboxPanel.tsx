import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Banknote,
  Bike,
  Check,
  CheckCheck,
  ChevronRight,
  Copy,
  Info,
  Inbox,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';

import type {
  InquiryChannel,
  InquiryStatus,
  SellerProfile,
  ShowroomInquiry,
  ShowroomListing,
  ShowroomSettings,
} from '../../types';
import { coverPhoto, formatDate, formatPrice, relativeDate } from '../../lib/listing';
import { replyTemplate } from '../../lib/inquiries';
import { copyToClipboard } from '../../lib/share';

// ============================================================================
// Posteingang
// ----------------------------------------------------------------------------
// Alles, was aus dem Showroom hereinkommt, an einer Stelle: lesen, antworten,
// ablegen. Der Panel schreibt nie selbst in den Speicher – jede Änderung geht
// über `onUpdate`/`onDelete` zurück an ShowroomModule, damit es genau eine
// Quelle der Wahrheit gibt.
// ============================================================================

export interface InboxPanelProps {
  inquiries: ShowroomInquiry[];
  listings: ShowroomListing[];
  profile: SellerProfile;
  settings: ShowroomSettings;
  onUpdate: (id: string, patch: Partial<ShowroomInquiry>) => void;
  onDelete: (id: string) => void;
  onRefresh: () => Promise<{ added: number; error?: string }>;
  onImport: (json: string) => { added: number; error?: string };
  onBack: () => void;
  onOpenListing: (listingId: string) => void;
}

type FilterKey = 'alle' | InquiryStatus;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'alle', label: 'Alle' },
  { key: 'neu', label: 'Neu' },
  { key: 'gelesen', label: 'Gelesen' },
  { key: 'beantwortet', label: 'Beantwortet' },
  { key: 'archiviert', label: 'Archiviert' },
];

const CHANNEL_ICONS: Record<InquiryChannel, typeof MessageSquare> = {
  formular: MessageSquare,
  whatsapp: Phone,
  mail: Mail,
  telefon: Phone,
  import: Upload,
};

const CHANNEL_LABELS: Record<InquiryChannel, string> = {
  formular: 'Kontaktformular',
  whatsapp: 'WhatsApp',
  mail: 'E-Mail',
  telefon: 'Telefon',
  import: 'Aus Datei eingelesen',
};

type MessageTone = 'good' | 'bad' | 'muted';
interface PanelMessage {
  tone: MessageTone;
  text: string;
}

const TONE_COLORS: Record<MessageTone, string> = {
  good: 'var(--sr-good)',
  bad: 'var(--sr-bad)',
  muted: 'var(--sr-muted)',
};

/** Erste gefüllte Zeile der Nachricht – als Vorschau in der Liste. */
function firstLine(text: string, max = 90): string {
  const line = (text || '').split('\n').find((l) => l.trim()) ?? '';
  const trimmed = line.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}

function formatTime(ts?: number | null): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/** "15 % unter deinem Preis" – ordnet einen Preisvorschlag sofort ein. */
function offerHint(offer: number, price: number): string {
  if (!price) return '';
  const diff = Math.round(((price - offer) / price) * 100);
  if (diff === 0) return 'genau dein Preis';
  return diff > 0 ? `${diff} % unter deinem Preis` : `${Math.abs(diff)} % über deinem Preis`;
}

/** wa.me will die Nummer international ohne Zeichen: 0176… wird zu 49176… */
function whatsappNumber(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('0') ? `49${digits.slice(1)}` : digits;
}

function countedText(added: number): string {
  if (added === 1) return '1 neue Anfrage geladen.';
  return `${added} neue Anfragen geladen.`;
}

export function InboxPanel({
  inquiries,
  listings,
  profile,
  settings,
  onUpdate,
  onDelete,
  onRefresh,
  onImport,
  onBack,
  onOpenListing,
}: InboxPanelProps) {
  const [filter, setFilter] = useState<FilterKey>('alle');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetailOnMobile, setShowDetailOnMobile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<PanelMessage | null>(null);
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);

  const fileRef = useRef<HTMLInputElement | null>(null);
  // Merkt sich, welche Anfrage bereits auf "gelesen" gesetzt wurde – ein
  // erneuter Klick darf den Status nicht wieder überschreiben.
  const markedRef = useRef<Set<string>>(new Set());
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const sorted = useMemo(
    () => [...inquiries].sort((a, b) => b.createdAt - a.createdAt),
    [inquiries],
  );

  const counts = useMemo(() => {
    const base: Record<FilterKey, number> = {
      alle: inquiries.length,
      neu: 0,
      gelesen: 0,
      beantwortet: 0,
      archiviert: 0,
    };
    for (const i of inquiries) base[i.status] = (base[i.status] ?? 0) + 1;
    return base;
  }, [inquiries]);

  const listingById = useMemo(() => {
    const map = new Map<string, ShowroomListing>();
    for (const l of listings) map.set(l.id, l);
    return map;
  }, [listings]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sorted.filter((i) => {
      if (filter !== 'alle' && i.status !== filter) return false;
      if (!q) return true;
      const haystack = [i.name, i.email, i.message, i.listingTitle]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [sorted, filter, search]);

  const selected = selectedId ? inquiries.find((i) => i.id === selectedId) ?? null : null;
  const selectedListing = selected?.listingId ? listingById.get(selected.listingId) : undefined;

  // Antwortvorschlag und Notiz nur beim Wechsel der Anfrage neu setzen –
  // sonst würde jede gespeicherte Änderung den getippten Text überschreiben.
  useEffect(() => {
    const inq = selectedId ? inquiries.find((i) => i.id === selectedId) : null;
    if (!inq) {
      setReply('');
      setNote('');
      return;
    }
    const listing = inq.listingId ? listingById.get(inq.listingId) : undefined;
    setReply(replyTemplate(inq, listing, profile));
    setNote(inq.note ?? '');
    setCopied(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const endpointMissing = settings.transport !== 'http' || !(settings.endpointUrl || '').trim();

  function selectInquiry(inquiry: ShowroomInquiry) {
    setSelectedId(inquiry.id);
    setShowDetailOnMobile(true);
    if (inquiry.status === 'neu' && !markedRef.current.has(inquiry.id)) {
      markedRef.current.add(inquiry.id);
      onUpdate(inquiry.id, { status: 'gelesen' });
    }
  }

  async function handleRefresh() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await onRefresh();
      if (result.error) {
        setMessage({ tone: 'bad', text: `Konnte nicht abgeholt werden: ${result.error}` });
      } else if (result.added > 0) {
        setMessage({ tone: 'good', text: countedText(result.added) });
      } else {
        setMessage({ tone: 'muted', text: 'Nichts Neues.' });
      }
    } catch (e) {
      setMessage({
        tone: 'bad',
        text: `Konnte nicht abgeholt werden: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    setMessage(null);
    const reader = new FileReader();
    reader.onload = () => {
      const result = onImport(String(reader.result ?? ''));
      if (result.error) {
        setMessage({ tone: 'bad', text: `Datei konnte nicht gelesen werden: ${result.error}` });
      } else if (result.added > 0) {
        setMessage({ tone: 'good', text: countedText(result.added) });
      } else {
        setMessage({ tone: 'muted', text: 'Keine neuen Anfragen in der Datei.' });
      }
    };
    reader.onerror = () => setMessage({ tone: 'bad', text: 'Die Datei konnte nicht gelesen werden.' });
    reader.readAsText(file);
    // Zurücksetzen, damit dieselbe Datei erneut gewählt werden kann.
    input.value = '';
  }

  async function handleCopy() {
    const ok = await copyToClipboard(reply);
    if (!ok) {
      setMessage({ tone: 'bad', text: 'Kopieren hat nicht geklappt – markier den Text bitte von Hand.' });
      return;
    }
    setCopied(true);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
  }

  function handleMailReply(inquiry: ShowroomInquiry) {
    const subject = `Re: ${inquiry.listingTitle || selectedListing?.title || 'deine Anfrage'}`;
    const url = `mailto:${encodeURIComponent(inquiry.email)}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(reply)}`;
    window.location.href = url;
    onUpdate(inquiry.id, { status: 'beantwortet' });
  }

  function handleWhatsappReply(inquiry: ShowroomInquiry) {
    const number = whatsappNumber(inquiry.phone || '');
    if (!number) return;
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(reply)}`, '_blank', 'noopener');
  }

  function handleNote(inquiry: ShowroomInquiry, value: string) {
    setNote(value);
    onUpdate(inquiry.id, { note: value });
  }

  function handleDelete(inquiry: ShowroomInquiry) {
    if (!window.confirm(`Anfrage von "${inquiry.name}" wirklich löschen?`)) return;
    onDelete(inquiry.id);
    setSelectedId(null);
    setShowDetailOnMobile(false);
  }

  const unread = counts.neu;

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* --- Kopfzeile ---------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" onClick={onBack} className="sr-btn sr-btn-quiet shrink-0">
            <ArrowLeft className="w-4 h-4" />
            Zurück
          </button>
          <div className="min-w-0">
            <div className="sr-eyebrow">Showroom</div>
            <h2 className="sr-display text-xl sm:text-2xl font-semibold truncate">Posteingang</h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {unread > 0 && (
            <span className="sr-chip sr-chip-accent">{unread} ungelesen</span>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={busy}
            className="sr-btn sr-btn-ghost"
          >
            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
            Aktualisieren
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="sr-btn sr-btn-ghost"
          >
            <Upload className="w-4 h-4" />
            Aus Datei einlesen
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFile}
            className="hidden"
          />
        </div>
      </div>

      {message && (
        <p className="text-sm" style={{ color: TONE_COLORS[message.tone] }}>
          {message.text}
        </p>
      )}

      {/* --- Hinweis auf den fehlenden Endpunkt --------------------------- */}
      {endpointMissing && (
        <div className="sr-panel-flat p-4 flex gap-3">
          <Info className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--sr-muted)' }} />
          <div className="text-sm leading-relaxed" style={{ color: 'var(--sr-muted)' }}>
            <p>
              Anfragen von einer echten Website landen erst dann hier, wenn du im Profil einen
              Endpunkt hinterlegst und als Weg „http“ wählst.
            </p>
            <p className="mt-1">
              Bis dahin erreichen dich Interessenten über E-Mail und WhatsApp – und du kannst eine
              exportierte Datei jederzeit über „Aus Datei einlesen“ hinzufügen.
            </p>
          </div>
        </div>
      )}

      {inquiries.length === 0 ? (
        <div className="sr-panel p-8 sm:p-12 text-center">
          <div
            className="w-14 h-14 rounded-2xl grid place-items-center mx-auto mb-4 border"
            style={{ borderColor: 'var(--sr-line)', background: 'var(--sr-ink-2)' }}
          >
            <Inbox className="w-6 h-6" style={{ color: 'var(--sr-faint)' }} />
          </div>
          <h3 className="sr-display text-lg font-semibold mb-2">Noch keine Anfragen.</h3>
          <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--sr-muted)' }}>
            Hier sammeln sich die Nachrichten aus dem Kontaktformular deines Showrooms sowie alles,
            was du über „Aktualisieren“ von deiner Website abholst oder aus einer Datei einliest.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)] items-start">
          {/* --- Liste ---------------------------------------------------- */}
          <div className={`sr-panel p-3 sm:p-4 ${showDetailOnMobile ? 'hidden lg:block' : 'block'}`}>
            <div className="relative mb-3">
              <Search
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--sr-faint)' }}
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, E-Mail, Nachricht …"
                className="sr-input"
                style={{ paddingLeft: 36 }}
              />
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`sr-chip ${filter === f.key ? 'sr-chip-accent' : ''}`}
                >
                  {f.label}
                  <span style={{ opacity: 0.7 }}>{counts[f.key] ?? 0}</span>
                </button>
              ))}
            </div>

            <div className="sr-scroll space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {visible.length === 0 ? (
                <p className="text-sm py-6 text-center" style={{ color: 'var(--sr-faint)' }}>
                  Nichts gefunden.
                </p>
              ) : (
                visible.map((inq) => {
                  const ChannelIcon = CHANNEL_ICONS[inq.channel] ?? MessageSquare;
                  const listing = inq.listingId ? listingById.get(inq.listingId) : undefined;
                  const title = listing?.title || inq.listingTitle;
                  const active = inq.id === selectedId;
                  return (
                    <button
                      key={inq.id}
                      type="button"
                      onClick={() => selectInquiry(inq)}
                      className="w-full text-left rounded-xl p-3 border transition-colors"
                      style={{
                        borderColor: active ? 'var(--sr-accent-line)' : 'var(--sr-line-soft)',
                        background: active ? 'var(--sr-accent-soft)' : 'var(--sr-ink-2)',
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {inq.status === 'neu' && (
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: 'var(--sr-accent)' }}
                            aria-hidden="true"
                          />
                        )}
                        <span className="font-semibold truncate">{inq.name}</span>
                        <ChannelIcon
                          className="w-3.5 h-3.5 shrink-0"
                          style={{ color: 'var(--sr-faint)' }}
                          aria-hidden="true"
                        />
                        <span
                          className="ml-auto text-[11px] shrink-0"
                          style={{ color: 'var(--sr-faint)' }}
                        >
                          {relativeDate(inq.createdAt)}
                        </span>
                      </div>

                      <p className="text-sm truncate" style={{ color: 'var(--sr-muted)' }}>
                        {firstLine(inq.message) || 'Ohne Nachricht'}
                      </p>

                      {(title || inq.offerPrice != null) && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          {title && (
                            <span className="sr-chip max-w-full">
                              <Bike className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span className="truncate">{title}</span>
                            </span>
                          )}
                          {inq.offerPrice != null && (
                            <span className="sr-chip sr-chip-warn">
                              <Banknote className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              {formatPrice(inq.offerPrice, 'fest')}
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* --- Detail --------------------------------------------------- */}
          <div className={`${showDetailOnMobile ? 'block' : 'hidden lg:block'}`}>
            {!selected ? (
              <div className="sr-panel p-8 text-center">
                <p className="text-sm" style={{ color: 'var(--sr-muted)' }}>
                  Wähle links eine Anfrage aus, um sie zu lesen und zu beantworten.
                </p>
              </div>
            ) : (
              <div className="sr-panel p-4 sm:p-6 space-y-5">
                <button
                  type="button"
                  onClick={() => setShowDetailOnMobile(false)}
                  className="sr-btn sr-btn-quiet lg:hidden"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Zurück zur Liste
                </button>

                {/* Kopf der Anfrage */}
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="sr-display text-lg sm:text-xl font-semibold">{selected.name}</h3>
                    <span className="sr-chip">{CHANNEL_LABELS[selected.channel] ?? 'Anfrage'}</span>
                  </div>
                  <div
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
                    style={{ color: 'var(--sr-muted)' }}
                  >
                    {selected.email && (
                      <a
                        href={`mailto:${selected.email}`}
                        className="inline-flex items-center gap-1.5 hover:underline"
                      >
                        <Mail className="w-4 h-4" aria-hidden="true" />
                        {selected.email}
                      </a>
                    )}
                    {selected.phone && (
                      <a
                        href={`tel:${selected.phone.replace(/\s/g, '')}`}
                        className="inline-flex items-center gap-1.5 hover:underline"
                      >
                        <Phone className="w-4 h-4" aria-hidden="true" />
                        {selected.phone}
                      </a>
                    )}
                  </div>
                  <p className="text-xs mt-2" style={{ color: 'var(--sr-faint)' }}>
                    {formatDate(selected.createdAt)}
                    {formatTime(selected.createdAt) ? ` um ${formatTime(selected.createdAt)} Uhr` : ''}
                    {selected.source ? ` · Herkunft: ${selected.source}` : ''}
                  </p>
                </div>

                {/* Bezug zur Anzeige */}
                {selectedListing && (
                  <button
                    type="button"
                    onClick={() => onOpenListing(selectedListing.id)}
                    className="w-full sr-inset p-3 flex items-center gap-3 text-left"
                  >
                    <ListingThumb listing={selectedListing} />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate">{selectedListing.title}</div>
                      <div className="text-sm" style={{ color: 'var(--sr-accent)' }}>
                        {formatPrice(selectedListing.price, selectedListing.priceType)}
                      </div>
                    </div>
                    <ChevronRight
                      className="w-4 h-4 shrink-0"
                      style={{ color: 'var(--sr-faint)' }}
                      aria-hidden="true"
                    />
                  </button>
                )}
                {!selectedListing && selected.listingTitle && (
                  <p className="text-sm" style={{ color: 'var(--sr-muted)' }}>
                    Betrifft: {selected.listingTitle} (Anzeige gibt es nicht mehr)
                  </p>
                )}

                {/* Nachricht */}
                <div className="sr-inset p-4">
                  <p className="text-sm whitespace-pre-line leading-relaxed">
                    {selected.message || 'Ohne Nachricht.'}
                  </p>
                </div>

                {/* Preisvorschlag */}
                {selected.offerPrice != null && (
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="sr-eyebrow">Preisvorschlag</span>
                    <span className="sr-display text-xl font-semibold" style={{ color: 'var(--sr-accent)' }}>
                      {formatPrice(selected.offerPrice, 'fest')}
                    </span>
                    {selectedListing?.price != null && (
                      <span className="text-sm" style={{ color: 'var(--sr-muted)' }}>
                        {offerHint(selected.offerPrice, selectedListing.price)}
                      </span>
                    )}
                  </div>
                )}

                <hr className="sr-rule" />

                {/* Antwort */}
                <div>
                  <label className="sr-label" htmlFor="sr-inbox-reply">
                    Antwort
                  </label>
                  <textarea
                    id="sr-inbox-reply"
                    className="sr-textarea"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button type="button" onClick={handleCopy} className="sr-btn sr-btn-ghost">
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copied ? 'Kopiert' : 'Text kopieren'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMailReply(selected)}
                      disabled={!selected.email}
                      className="sr-btn sr-btn-primary"
                    >
                      <Mail className="w-4 h-4" />
                      Per E-Mail antworten
                    </button>
                    {selected.phone && (
                      <button
                        type="button"
                        onClick={() => handleWhatsappReply(selected)}
                        className="sr-btn sr-btn-ghost"
                      >
                        <Phone className="w-4 h-4" />
                        Per WhatsApp antworten
                      </button>
                    )}
                  </div>
                </div>

                {/* Interne Notiz */}
                <div>
                  <label className="sr-label" htmlFor="sr-inbox-note">
                    Interne Notiz (nur für dich)
                  </label>
                  <textarea
                    id="sr-inbox-note"
                    className="sr-textarea"
                    style={{ minHeight: 72 }}
                    value={note}
                    onChange={(e) => handleNote(selected, e.target.value)}
                    placeholder="Termin vereinbart, Rad reserviert bis Freitag …"
                  />
                </div>

                <hr className="sr-rule" />

                {/* Status */}
                <div className="flex flex-wrap gap-2">
                  {selected.status !== 'beantwortet' && (
                    <button
                      type="button"
                      onClick={() => onUpdate(selected.id, { status: 'beantwortet' })}
                      className="sr-btn sr-btn-ghost"
                    >
                      <CheckCheck className="w-4 h-4" />
                      Als beantwortet markieren
                    </button>
                  )}
                  {selected.status !== 'archiviert' ? (
                    <button
                      type="button"
                      onClick={() => onUpdate(selected.id, { status: 'archiviert' })}
                      className="sr-btn sr-btn-quiet"
                    >
                      <Archive className="w-4 h-4" />
                      Archivieren
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onUpdate(selected.id, { status: 'gelesen' })}
                      className="sr-btn sr-btn-quiet"
                    >
                      <ArchiveRestore className="w-4 h-4" />
                      Wieder öffnen
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(selected)}
                    className="sr-btn sr-btn-danger sm:ml-auto"
                  >
                    <Trash2 className="w-4 h-4" />
                    Löschen
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Titelbild der zugehörigen Anzeige. Der Posteingang kennt die Werkstatt-Räder
 * nicht, deshalb kann nur ein eigenes Bild der Anzeige aufgelöst werden – für
 * referenzierte Fotos bleibt es beim Platzhalter.
 */
function ListingThumb({ listing }: { listing: ShowroomListing }) {
  const photo = coverPhoto(listing);
  if (!photo) {
    return (
      <div
        className="w-16 h-16 rounded-lg grid place-items-center shrink-0"
        style={{ background: 'var(--sr-ink-2)', border: '1px solid var(--sr-line)' }}
      >
        <Bike className="w-5 h-5" style={{ color: 'var(--sr-faint)' }} aria-hidden="true" />
      </div>
    );
  }
  return (
    <img
      src={photo}
      alt={`Titelbild der Anzeige ${listing.title}`}
      className="w-16 h-16 rounded-lg object-cover shrink-0"
      style={{ border: '1px solid var(--sr-line)' }}
    />
  );
}

export default InboxPanel;
