import type { SellerProfile, ShowroomListing, ShowroomSettings } from '../types';
import { formatPrice } from './listing';

// ============================================================================
// Teilen: Links, Zwischenablage, native Teilen-Funktion des Handys
// ============================================================================

/**
 * Die öffentliche Adresse einer Anzeige.
 * Ohne hinterlegte Website-Adresse wird die aktuelle Seite mit `#/rad/<slug>`
 * verwendet – der Link funktioniert dann zumindest innerhalb der App.
 */
export function listingUrl(listing: ShowroomListing, settings: ShowroomSettings): string {
  const base = (settings.publicBaseUrl || '').trim().replace(/\/+$/, '');
  if (base) return `${base}/#/rad/${listing.slug || listing.id}`;
  if (typeof location === 'undefined') return `#/rad/${listing.slug || listing.id}`;
  return `${location.origin}${location.pathname}#/rad/${listing.slug || listing.id}`;
}

export function shareText(listing: ShowroomListing, profile: SellerProfile): string {
  const preis = formatPrice(listing.price, listing.priceType);
  const ort = listing.location?.city || profile.city;
  return `${listing.title} – ${preis}${ort ? ` (${ort})` : ''}`;
}

export interface ShareTarget {
  key: 'whatsapp' | 'mail' | 'facebook' | 'telegram' | 'copy';
  label: string;
  /** `null` bei "Link kopieren" – das läuft über `copyToClipboard`. */
  href: string | null;
}

export function shareTargets(
  listing: ShowroomListing,
  profile: SellerProfile,
  settings: ShowroomSettings,
): ShareTarget[] {
  const url = listingUrl(listing, settings);
  const text = shareText(listing, profile);
  const encUrl = encodeURIComponent(url);
  const encText = encodeURIComponent(text);
  return [
    { key: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}` },
    {
      key: 'mail',
      label: 'E-Mail',
      href: `mailto:?subject=${encText}&body=${encodeURIComponent(`${text}\n\n${url}`)}`,
    },
    { key: 'facebook', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${encUrl}` },
    { key: 'telegram', label: 'Telegram', href: `https://t.me/share/url?url=${encUrl}&text=${encText}` },
    { key: 'copy', label: 'Link kopieren', href: null },
  ];
}

export async function copyToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fällt unten auf den alten Weg zurück (z. B. ohne HTTPS).
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Nutzt das native Teilen-Menü, wenn das Gerät eins hat (Handy). */
export async function nativeShare(
  listing: ShowroomListing,
  profile: SellerProfile,
  settings: ShowroomSettings,
): Promise<boolean> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (!nav.share) return false;
  try {
    await nav.share({
      title: listing.title,
      text: shareText(listing, profile),
      url: listingUrl(listing, settings),
    });
    return true;
  } catch {
    return false;
  }
}
