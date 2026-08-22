import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Send,
} from 'lucide-react';

import type { SellerProfile, ShowroomListing, ShowroomSettings } from '../../types';
import {
  validateDraft,
  whatsappUrl,
  type InquiryDraft,
  type SubmitResult,
} from '../../lib/inquiries';

// ============================================================================
// Kontaktformular des Käufers
// ----------------------------------------------------------------------------
// Bewusst kurz gehalten: Name, E-Mail, Nachricht – mehr braucht eine Anfrage zu
// einem gebrauchten Rad nicht. Alles Weitere (Telefon, Preisvorschlag) ist
// freiwillig, damit niemand an einem Pflichtfeld hängen bleibt und abbricht.
// ============================================================================

export interface ContactFormProps {
  listing?: ShowroomListing | null;
  profile: SellerProfile;
  settings: ShowroomSettings;
  onSubmit: (draft: InquiryDraft) => Promise<SubmitResult>;
  compact?: boolean;
}

/** Bestätigungstext je nach tatsächlich genutztem Weg (siehe lib/inquiries). */
const SUCCESS_TEXT: Record<SubmitResult['via'], string> = {
  mailto: 'Dein Mailprogramm öffnet sich mit der fertigen Nachricht.',
  http: 'Danke, deine Anfrage ist angekommen. Ich melde mich zeitnah.',
  lokal: 'Danke, deine Anfrage ist notiert.',
};

function defaultMessage(listing?: ShowroomListing | null): string {
  if (!listing) return '';
  return `Hallo, ist "${listing.title}" noch zu haben? Ich hätte Interesse und würde mir das Rad gern ansehen.`;
}

/** Erlaubt auch "450,50" – das Komma tippt hier fast jeder. */
function parseOffer(raw: string): number | null {
  const value = raw.replace(',', '.').trim();
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function ContactForm({
  listing,
  profile,
  settings,
  onSubmit,
  compact = false,
}: ContactFormProps) {
  const uid = useId();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState(() => defaultMessage(listing));
  const [offer, setOffer] = useState('');
  const [consent, setConsent] = useState(false);

  // Erst nach dem ersten Absende-Versuch meckern – vorher wirkt das Formular
  // wie ein Verhör.
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [messageTouched, setMessageTouched] = useState(false);

  const listingId = listing?.id;

  // Beim Wechsel auf ein anderes Rad wird der Vorschlagstext nachgezogen,
  // solange der Interessent noch nichts Eigenes geschrieben hat.
  useEffect(() => {
    if (messageTouched) return;
    setMessage(defaultMessage(listing));
    // Der Titel steckt in der Anzeige – nur deren Wechsel ist relevant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  const draft: InquiryDraft = useMemo(
    () => ({
      name,
      email,
      phone: phone.trim() || undefined,
      message,
      offerPrice: parseOffer(offer),
      listingId: listing?.id,
      listingTitle: listing?.title,
    }),
    [name, email, phone, message, offer, listing],
  );

  const errors = attempted ? validateDraft(draft) : [];
  const badName = errors.some((e) => e.includes('Namen'));
  const badEmail = errors.some((e) => e.includes('E-Mail'));
  const badMessage = errors.some((e) => e.includes('worum es geht'));
  const invalidBorder = { borderColor: 'var(--sr-bad)' } as React.CSSProperties;

  const wa = whatsappUrl(profile, listing);
  const mailHref = profile.email
    ? `mailto:${profile.email}?subject=${encodeURIComponent(
        listing ? `Anfrage: ${listing.title}` : 'Anfrage über den Showroom',
      )}`
    : null;
  const telHref = profile.phone ? `tel:${profile.phone.replace(/[^\d+]/g, '')}` : null;
  const hasAlternatives = !!(wa || mailHref || telHref);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    if (busy || !consent) return;
    if (validateDraft(draft).length > 0) return;

    setBusy(true);
    try {
      const res = await onSubmit(draft);
      setResult(res);
    } catch (e) {
      setResult({
        ok: false,
        via: 'lokal',
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  function resetForm() {
    // Name, E-Mail und Telefon bleiben stehen: wer nach dem ersten Rad noch ein
    // zweites anfragt, soll seine Daten nicht erneut tippen müssen.
    setResult(null);
    setAttempted(false);
    setOffer('');
    setMessageTouched(false);
    setMessage(defaultMessage(listing));
  }

  const pad = compact ? 'p-4' : 'p-5 sm:p-6';
  const gap = compact ? 'space-y-3' : 'space-y-4';

  // --- Bestätigung statt Formular -----------------------------------------
  if (result?.ok) {
    return (
      <div className={`sr-panel ${pad} sr-fade-in`}>
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--sr-good)' }} />
          <div className="min-w-0">
            <div className="sr-display text-lg font-semibold">Anfrage ist raus</div>
            <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--sr-muted)' }}>
              {SUCCESS_TEXT[result.via]}
            </p>
            {result.error && (
              <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--sr-warn)' }}>
                {result.error}
              </p>
            )}
          </div>
        </div>
        <button type="button" onClick={resetForm} className="sr-btn sr-btn-ghost mt-4">
          <Send className="w-4 h-4" />
          Noch eine Anfrage
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={`sr-panel ${pad} sr-fade-in`} noValidate>
      {!compact && (
        <div className="mb-4">
          <div className="sr-eyebrow">Kontakt</div>
          <h3 className="sr-display text-xl font-semibold mt-1">Frag einfach nach</h3>
          <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--sr-muted)' }}>
            Schreib kurz, worum es geht – ich melde mich bei dir.
          </p>
        </div>
      )}

      {listing && (
        <p className="mb-3 text-sm" style={{ color: 'var(--sr-muted)' }}>
          Deine Anfrage zu:{' '}
          <span className="font-semibold" style={{ color: 'var(--sr-text)' }}>
            {listing.title}
          </span>
        </p>
      )}

      <div className={gap}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="sr-label" htmlFor={`${uid}-name`}>
              Name *
            </label>
            <input
              id={`${uid}-name`}
              className="sr-input"
              style={badName ? invalidBorder : undefined}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Vor- und Nachname"
            />
          </div>
          <div>
            <label className="sr-label" htmlFor={`${uid}-email`}>
              E-Mail *
            </label>
            <input
              id={`${uid}-email`}
              type="email"
              className="sr-input"
              style={badEmail ? invalidBorder : undefined}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              placeholder="name@beispiel.de"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="sr-label" htmlFor={`${uid}-phone`}>
              Telefon (optional)
            </label>
            <input
              id={`${uid}-phone`}
              type="tel"
              className="sr-input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              inputMode="tel"
              placeholder="Für eine schnelle Rückfrage"
            />
          </div>
          {listing && listing.priceType !== 'verschenken' && (
            <div>
              <label className="sr-label" htmlFor={`${uid}-offer`}>
                Dein Preisvorschlag (€)
              </label>
              <input
                id={`${uid}-offer`}
                type="number"
                min={0}
                step={5}
                className="sr-input"
                value={offer}
                onChange={(e) => setOffer(e.target.value)}
                inputMode="decimal"
                placeholder={listing.price != null ? String(listing.price) : 'optional'}
              />
            </div>
          )}
        </div>

        <div>
          <label className="sr-label" htmlFor={`${uid}-message`}>
            Nachricht *
          </label>
          <textarea
            id={`${uid}-message`}
            className="sr-textarea"
            style={badMessage ? invalidBorder : undefined}
            value={message}
            onChange={(e) => {
              setMessageTouched(true);
              setMessage(e.target.value);
            }}
            placeholder="Ist das Rad noch da? Wann könnte ich es mir ansehen?"
          />
        </div>

        <label
          className="flex items-start gap-3 text-sm leading-relaxed cursor-pointer"
          style={{ color: 'var(--sr-muted)' }}
        >
          <input
            type="checkbox"
            className="mt-1 w-4 h-4 shrink-0"
            style={{ accentColor: 'var(--sr-accent)' }}
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            Ich bin einverstanden, dass meine Angaben zur Bearbeitung der Anfrage gespeichert
            werden. Details stehen in der Datenschutzerklärung im Fuß der Seite.
          </span>
        </label>

        {errors.length > 0 && (
          <div className="flex flex-col items-start gap-1.5">
            {errors.map((e) => (
              <span key={e} className="sr-chip sr-chip-bad text-left">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {e}
              </span>
            ))}
          </div>
        )}

        {result && !result.ok && result.error && (
          <p className="text-sm leading-relaxed" style={{ color: 'var(--sr-bad)' }}>
            {result.error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="sr-btn sr-btn-primary" disabled={busy || !consent}>
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {busy ? 'Wird gesendet …' : 'Anfrage senden'}
          </button>
          {!consent && (
            <span className="text-xs" style={{ color: 'var(--sr-faint)' }}>
              Bitte setz noch das Häkchen.
            </span>
          )}
        </div>

        <p className="text-xs leading-relaxed" style={{ color: 'var(--sr-faint)' }}>
          {settings.transport === 'mailto'
            ? 'Beim Absenden öffnet sich dein E-Mail-Programm mit der fertigen Nachricht. '
            : ''}
          Deine Angaben werden nur für die Antwort auf diese Anfrage verwendet.
        </p>
      </div>

      {hasAlternatives && (
        <>
          <hr className="sr-rule my-4" />
          <div className={compact ? 'space-y-2' : 'space-y-3'}>
            <div className="sr-eyebrow">Lieber direkt?</div>
            <div className="flex flex-wrap gap-2">
              {wa && (
                <a
                  href={wa}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="sr-btn sr-btn-ghost"
                >
                  <MessageCircle className="w-4 h-4" />
                  WhatsApp
                </a>
              )}
              {mailHref && (
                <a href={mailHref} className="sr-btn sr-btn-ghost">
                  <Mail className="w-4 h-4" />
                  {profile.email}
                </a>
              )}
              {telHref && (
                <a href={telHref} className="sr-btn sr-btn-ghost">
                  <Phone className="w-4 h-4" />
                  {profile.phone}
                </a>
              )}
            </div>
          </div>
        </>
      )}
    </form>
  );
}

export default ContactForm;
