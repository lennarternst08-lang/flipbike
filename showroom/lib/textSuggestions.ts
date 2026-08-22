import type { SellerProfile, ShowroomListing } from '../types';
import { CATEGORY_LABELS, CONDITION_LABELS } from '../config/seller';
import { formatPrice } from './listing';

// ============================================================================
// Textvorschläge
// ----------------------------------------------------------------------------
// Erste Ausbaustufe: rein regelbasiert, ohne Netz und ohne API-Schlüssel. Damit
// funktioniert der Vorschlag sofort und auch offline.
// Für die spätere Automatisierung steht `SuggestionEngine` bereit: eine
// LLM-Anbindung (das Projekt hat @google/genai bereits als Abhängigkeit) muss
// nur dieselbe Schnittstelle erfüllen und wird im Editor eingehängt.
// ============================================================================

export interface SuggestionInput {
  listing: ShowroomListing;
  profile: SellerProfile;
}

export interface SuggestionEngine {
  name: string;
  describe(input: SuggestionInput): Promise<string> | string;
  title(input: SuggestionInput): Promise<string> | string;
}

/** Ein Satzbaustein pro Bereich – zusammen ergibt das einen lesbaren Text. */
function techSentence(l: ShowroomListing): string {
  const teile: string[] = [];
  if (l.gearSystem || l.gearCount) {
    const gears = [l.gearCount ? `${l.gearCount} Gänge` : null, l.gearSystem]
      .filter(Boolean)
      .join(' – ');
    teile.push(`Schaltung: ${gears}`);
  }
  if (l.brakes) teile.push(`Bremsen: ${l.brakes}`);
  if (l.wheelSize) teile.push(`Laufräder: ${l.wheelSize}`);
  if (l.frameSize) teile.push(`Rahmenhöhe: ${l.frameSize}`);
  if (l.material) teile.push(`Rahmen: ${l.material}`);
  if (l.weightKg) teile.push(`Gewicht: ca. ${l.weightKg} kg`);
  return teile.length ? teile.join('\n') : '';
}

function conditionSentence(l: ShowroomListing): string {
  const zustand = CONDITION_LABELS[l.condition];
  if (l.condition === 'bastler') {
    return `Zustand: ${zustand}. Das Rad wird ausdrücklich als Bastlerrad verkauft und ist so nicht fahrbereit.`;
  }
  if (l.defects.length === 0) {
    return `Zustand: ${zustand}. Mir sind keine Mängel bekannt.`;
  }
  return `Zustand: ${zustand}. Ehrlich gesagt, was nicht perfekt ist:\n${l.defects
    .map((d) => `• ${d}`)
    .join('\n')}`;
}

function extrasSentence(l: ShowroomListing): string {
  if (!l.extras.length) return '';
  return `Mit dabei: ${l.extras.join(', ')}.`;
}

function priceSentence(l: ShowroomListing): string {
  if (l.priceType === 'verschenken') return 'Das Rad ist zu verschenken – Abholung genügt.';
  if (l.price == null) return 'Preis auf Anfrage – schreib mich einfach an.';
  if (l.priceType === 'vb') {
    return `Preis: ${formatPrice(l.price, 'fest')}. Über einen fairen Vorschlag lässt sich reden.`;
  }
  return `Preis: ${formatPrice(l.price, 'fest')} – Festpreis.`;
}

function closingSentence(p: SellerProfile): string {
  const teile = [
    p.pickupNote || 'Abholung nach Absprache, Probefahrt ist selbstverständlich möglich.',
  ];
  if (p.isCommercial) {
    teile.push(
      'Verkauf erfolgt als Privatperson wäre hier falsch: ich verkaufe gewerblich, ' +
        'du hast also die gesetzliche Gewährleistung.',
    );
  } else {
    teile.push(
      'Privatverkauf, daher keine Garantie, keine Rücknahme und kein Umtausch.',
    );
  }
  return teile.join(' ');
}

/** Der eingebaute, regelbasierte Vorschlagsgenerator. */
export const ruleEngine: SuggestionEngine = {
  name: 'Textbausteine',

  title({ listing }) {
    const teile = [
      listing.brand,
      listing.model,
      CATEGORY_LABELS[listing.category],
      listing.wheelSize ? `${listing.wheelSize}` : null,
      listing.frameSize ? `RH ${listing.frameSize}` : null,
    ].filter(Boolean);
    const roh = teile.join(' ').replace(/\s+/g, ' ').trim();
    return roh || listing.title || 'Gebrauchtes Fahrrad';
  },

  describe({ listing, profile }) {
    const kopf = [
      `${listing.brand ? `${listing.brand} ` : ''}${listing.model ?? ''}`.trim() || listing.title,
      CATEGORY_LABELS[listing.category],
      listing.color,
      listing.year ? `Baujahr ca. ${listing.year}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    const bloecke = [
      `Zu verkaufen: ${kopf}.`,
      techSentence(listing),
      conditionSentence(listing),
      extrasSentence(listing),
      listing.hotspots.length
        ? `Die wichtigsten Stellen habe ich direkt im Bild beschriftet – ${listing.hotspots
            .map((h) => h.label)
            .filter((v, i, a) => a.indexOf(v) === i)
            .slice(0, 6)
            .join(', ')}.`
        : '',
      priceSentence(listing),
      closingSentence(profile),
    ].filter((b) => b.trim().length > 0);

    return bloecke.join('\n\n');
  },
};

/**
 * Die aktive Engine. Später kann hier eine LLM-Variante gesetzt werden,
 * ohne dass ein einziger Aufrufer im Editor angefasst werden muss.
 */
let activeEngine: SuggestionEngine = ruleEngine;

export function setSuggestionEngine(engine: SuggestionEngine): void {
  activeEngine = engine;
}

export function getSuggestionEngine(): SuggestionEngine {
  return activeEngine;
}

export async function suggestDescription(input: SuggestionInput): Promise<string> {
  return activeEngine.describe(input);
}

export async function suggestTitle(input: SuggestionInput): Promise<string> {
  return activeEngine.title(input);
}

/**
 * Fertige Kurztexte für den Alltag: die drei Nachrichten, die man beim
 * Gebrauchtrad-Verkauf immer wieder tippt.
 */
export function quickReplies(listing: ShowroomListing, profile: SellerProfile): {
  label: string;
  text: string;
}[] {
  const preis = formatPrice(listing.price, listing.priceType);
  const name = profile.displayName || profile.legalName || '';
  return [
    {
      label: 'Noch verfügbar',
      text: `Hallo, ja – "${listing.title}" ist noch da. ${
        profile.pickupNote || 'Besichtigung nach Absprache.'
      }\n\nViele Grüße\n${name}`,
    },
    {
      label: 'Besichtigung anbieten',
      text: `Hallo, gern. Wann würde es dir passen? Ich bin flexibel, sag einfach zwei, drei Zeiten, die dir passen.\n\nViele Grüße\n${name}`,
    },
    {
      label: 'Preis halten',
      text: `Hallo, der Preis von ${preis} ist schon knapp kalkuliert – das Rad ist komplett durchgesehen. Bei Abholung diese Woche kann ich dir noch etwas entgegenkommen.\n\nViele Grüße\n${name}`,
    },
  ];
}
