import type {
  InquiryChannel,
  SellerProfile,
  ShowroomInquiry,
  ShowroomListing,
  ShowroomSettings,
} from '../types';
import { formatPrice, newId } from './listing';
import { loadInquiries, saveInquiries } from './storage';

// ============================================================================
// Kontaktanfragen: Eingang, Versand, Abholung von der echten Website
// ----------------------------------------------------------------------------
// Drei Wege, bewusst getrennt, damit der Showroom sowohl in der App als auch
// als eigenständige Website funktioniert:
//
//   'lokal'  – Anfrage landet direkt im Browser-Speicher. Für die Vorschau in
//              der App und für einen ersten Test der Website ohne Server.
//   'mailto' – Das Formular öffnet das Mailprogramm des Interessenten mit
//              fertig ausgefülltem Text. Braucht keinerlei Backend und ist
//              deshalb der Standard für eine frisch aufgesetzte Website.
//   'http'   – Die Website schickt die Anfrage per POST an einen Endpunkt
//              (eigene API, Formspree, Cloud Function …); der Posteingang der
//              App holt sie per GET wieder ab. Das ist die "echte" Anbindung.
//
// Das Vertragsformat des Endpunkts ist absichtlich winzig, damit sich fast
// jeder Dienst davorsetzen lässt – siehe ENDPOINT_CONTRACT.
// ============================================================================

export const ENDPOINT_CONTRACT = `POST  <endpointUrl>
  Header: Content-Type: application/json, X-Showroom-Key: <optional>
  Body:   { id, listingId, listingTitle, name, email, phone, message,
            offerPrice, createdAt, source }
  Antwort: 2xx = angenommen

GET   <endpointUrl>?since=<timestamp>
  Header: X-Showroom-Key: <optional>
  Antwort: { "inquiries": [ ...gleiche Objekte... ] }  oder direkt ein Array`;

export interface InquiryDraft {
  name: string;
  email: string;
  phone?: string;
  message: string;
  offerPrice?: number | null;
  listingId?: string;
  listingTitle?: string;
}

export interface SubmitResult {
  ok: boolean;
  /** Was tatsächlich passiert ist – die Bestätigung im Formular richtet sich danach. */
  via: 'lokal' | 'mailto' | 'http';
  error?: string;
}

export function draftToInquiry(
  draft: InquiryDraft,
  channel: InquiryChannel = 'formular',
  source?: string,
): ShowroomInquiry {
  return {
    id: newId(),
    listingId: draft.listingId,
    listingTitle: draft.listingTitle,
    name: draft.name.trim(),
    email: draft.email.trim(),
    phone: draft.phone?.trim() || undefined,
    message: draft.message.trim(),
    offerPrice: draft.offerPrice ?? null,
    createdAt: Date.now(),
    status: 'neu',
    channel,
    source: source || (typeof location !== 'undefined' ? location.hostname : 'lokal'),
  };
}

/** Prüft das Formular, bevor irgendetwas verschickt wird. */
export function validateDraft(draft: InquiryDraft): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push('Bitte gib deinen Namen an.');
  if (!draft.email.trim()) errors.push('Bitte gib eine E-Mail-Adresse an.');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(draft.email.trim()))
    errors.push('Die E-Mail-Adresse sieht nicht gültig aus.');
  if (draft.message.trim().length < 5) errors.push('Bitte schreib kurz, worum es geht.');
  return errors;
}

/** Hängt eine Anfrage an den lokalen Posteingang an (ohne Dubletten). */
export function appendLocalInquiry(inquiry: ShowroomInquiry): ShowroomInquiry[] {
  const existing = loadInquiries();
  if (existing.some((i) => i.id === inquiry.id)) return existing;
  const next = [inquiry, ...existing].slice(0, 500);
  saveInquiries(next);
  return next;
}

function inquiryMailBody(inquiry: ShowroomInquiry): string {
  const lines = [
    inquiry.listingTitle ? `Anzeige: ${inquiry.listingTitle}` : null,
    `Name: ${inquiry.name}`,
    `E-Mail: ${inquiry.email}`,
    inquiry.phone ? `Telefon: ${inquiry.phone}` : null,
    inquiry.offerPrice != null ? `Preisvorschlag: ${formatPrice(inquiry.offerPrice, 'fest')}` : null,
    '',
    inquiry.message,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

export function inquiryMailtoUrl(inquiry: ShowroomInquiry, profile: SellerProfile): string {
  const subject = inquiry.listingTitle
    ? `Anfrage: ${inquiry.listingTitle}`
    : 'Anfrage über den Showroom';
  return `mailto:${encodeURIComponent(profile.email)}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(inquiryMailBody(inquiry))}`;
}

/** WhatsApp-Direktlink für "Schreib mir kurz" – ohne Umweg über ein Formular. */
export function whatsappUrl(profile: SellerProfile, listing?: ShowroomListing | null): string | null {
  const raw = (profile.whatsapp || profile.phone || '').replace(/[^\d+]/g, '');
  if (!raw) return null;
  const number = raw.replace(/^\+/, '').replace(/^0/, '49');
  const text = listing
    ? `Hallo, ich interessiere mich für "${listing.title}" (${formatPrice(listing.price, listing.priceType)}).`
    : 'Hallo, ich habe eine Frage zu einem Rad aus deinem Showroom.';
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/**
 * Verschickt eine Anfrage über den eingestellten Weg.
 * Der HTTP-Weg fällt bei Fehlern bewusst auf den lokalen Speicher zurück –
 * eine Anfrage darf nie verloren gehen, nur weil der Server gerade streikt.
 */
export async function submitInquiry(
  draft: InquiryDraft,
  settings: ShowroomSettings,
  profile: SellerProfile,
): Promise<SubmitResult> {
  const inquiry = draftToInquiry(draft);

  if (settings.transport === 'mailto' && profile.email) {
    if (typeof window !== 'undefined') window.location.href = inquiryMailtoUrl(inquiry, profile);
    return { ok: true, via: 'mailto' };
  }

  if (settings.transport === 'http' && settings.endpointUrl) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (settings.endpointKey) headers['X-Showroom-Key'] = settings.endpointKey;
      const res = await fetch(settings.endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(inquiry),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true, via: 'http' };
    } catch (e) {
      appendLocalInquiry(inquiry);
      return {
        ok: true,
        via: 'lokal',
        error: `Endpunkt nicht erreichbar (${e instanceof Error ? e.message : e}) – Anfrage wurde lokal gesichert.`,
      };
    }
  }

  appendLocalInquiry(inquiry);
  return { ok: true, via: 'lokal' };
}

/** Wandelt beliebige Fremdformate in eine saubere Anfrage um. */
export function normalizeInquiry(raw: any): ShowroomInquiry | null {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name ?? raw.Name ?? '').trim();
  const email = String(raw.email ?? raw.Email ?? raw._replyto ?? '').trim();
  const message = String(raw.message ?? raw.Nachricht ?? raw.text ?? '').trim();
  if (!name && !email && !message) return null;
  const createdAt = Number(raw.createdAt ?? raw.timestamp ?? Date.parse(raw.date ?? '')) || Date.now();
  return {
    id: String(raw.id ?? newId()),
    listingId: raw.listingId ? String(raw.listingId) : undefined,
    listingTitle: raw.listingTitle ? String(raw.listingTitle) : undefined,
    name: name || 'Ohne Namen',
    email,
    phone: raw.phone ? String(raw.phone) : undefined,
    message,
    offerPrice: raw.offerPrice != null ? Number(raw.offerPrice) : null,
    createdAt,
    status: ['neu', 'gelesen', 'beantwortet', 'archiviert'].includes(raw.status) ? raw.status : 'neu',
    channel: ['formular', 'whatsapp', 'mail', 'telefon', 'import'].includes(raw.channel)
      ? raw.channel
      : 'formular',
    source: raw.source ? String(raw.source) : undefined,
    note: raw.note ? String(raw.note) : undefined,
  };
}

export interface FetchResult {
  inquiries: ShowroomInquiry[];
  error?: string;
}

/** Holt neue Anfragen vom Endpunkt der Website ab (Posteingang aktualisieren). */
export async function fetchInquiries(
  settings: ShowroomSettings,
  since?: number,
): Promise<FetchResult> {
  if (!settings.endpointUrl) {
    return { inquiries: [], error: 'Kein Endpunkt hinterlegt.' };
  }
  try {
    const url = new URL(settings.endpointUrl);
    if (since) url.searchParams.set('since', String(since));
    const headers: Record<string, string> = {};
    if (settings.endpointKey) headers['X-Showroom-Key'] = settings.endpointKey;
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : Array.isArray(data?.inquiries) ? data.inquiries : [];
    return {
      inquiries: list
        .map(normalizeInquiry)
        .filter((i: ShowroomInquiry | null): i is ShowroomInquiry => i !== null),
    };
  } catch (e) {
    return { inquiries: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Führt abgeholte Anfragen mit dem Posteingang zusammen (neue zuerst). */
export function mergeInquiries(
  existing: ShowroomInquiry[],
  incoming: ShowroomInquiry[],
): { merged: ShowroomInquiry[]; added: number } {
  const byId = new Map(existing.map((i) => [i.id, i]));
  let added = 0;
  for (const inc of incoming) {
    if (byId.has(inc.id)) continue;
    byId.set(inc.id, inc);
    added += 1;
  }
  const merged = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
  return { merged, added };
}

/** Vorgeschlagene Antwort auf eine Anfrage – der Verkäufer passt sie an. */
export function replyTemplate(
  inquiry: ShowroomInquiry,
  listing: ShowroomListing | undefined,
  profile: SellerProfile,
): string {
  const anrede = inquiry.name ? `Hallo ${inquiry.name.split(' ')[0]},` : 'Hallo,';
  const radTeil = listing
    ? `danke für dein Interesse an "${listing.title}". Das Rad ist noch zu haben.`
    : 'danke für deine Nachricht.';
  const preisTeil =
    inquiry.offerPrice != null && listing?.price != null
      ? inquiry.offerPrice >= listing.price * 0.9
        ? `\n\nDein Vorschlag von ${formatPrice(inquiry.offerPrice, 'fest')} geht in Ordnung.`
        : `\n\n${formatPrice(inquiry.offerPrice, 'fest')} ist mir leider zu wenig. ${formatPrice(
            Math.round((listing.price * 0.95) / 5) * 5,
            'fest',
          )} könnte ich machen.`
      : '';
  const terminTeil = profile.pickupNote
    ? `\n\n${profile.pickupNote}`
    : '\n\nWann würde dir eine Besichtigung passen?';
  return `${anrede}\n\n${radTeil}${preisTeil}${terminTeil}\n\nViele Grüße\n${
    profile.displayName || profile.legalName
  }`;
}
