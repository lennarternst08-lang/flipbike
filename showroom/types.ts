// ============================================================================
// Showroom – Datenmodell
// ----------------------------------------------------------------------------
// Dieser Ordner ist bewusst eigenständig: er kennt weder Firebase noch die
// Tracking-/Werkstatt-Module. Einzige Verbindung zur Haupt-App ist der optionale
// `bikeId`-Verweis plus die Adapter in `lib/storage.ts`. Dadurch lässt sich
// `showroom/` als Ganzes in ein eigenes Website-Projekt kopieren
// (siehe showroom/standalone/README.md).
// ============================================================================

/** Wie ein beschrifteter Punkt im Bild wirken soll. */
export type HotspotTone = 'neutral' | 'highlight' | 'defect';

/**
 * Ein beschrifteter Punkt auf einem Anzeigenfoto ("Schaltung: Shimano Deore").
 * x/y sind relativ (0..1) zur Bildfläche gespeichert, damit die Punkte bei
 * jeder Bildgröße und auf dem Handy an derselben Stelle sitzen.
 */
export interface Hotspot {
  id: string;
  photoIndex: number;
  x: number;
  y: number;
  label: string;
  value?: string;
  tone?: HotspotTone;
}

/** Frei benennbare Zusatz-Eigenschaft (wie die Attribute bei Kleinanzeigen). */
export interface ListingSpec {
  id: string;
  label: string;
  value: string;
}

export type ListingCondition =
  | 'neuwertig'
  | 'sehr_gut'
  | 'gut'
  | 'gebraucht'
  | 'bastler';

export type ListingStatus = 'entwurf' | 'online' | 'reserviert' | 'verkauft';

/** Festpreis, Verhandlungsbasis oder Verschenken. */
export type PriceType = 'fest' | 'vb' | 'verschenken';

export type BikeCategory =
  | 'city'
  | 'trekking'
  | 'mountainbike'
  | 'rennrad'
  | 'gravel'
  | 'hollandrad'
  | 'kinderrad'
  | 'jugendrad'
  | 'klapprad'
  | 'bmx'
  | 'ebike'
  | 'lastenrad'
  | 'sonstiges';

/** Wie das Rad zum Käufer kommt – steuert später auch den Kaufvertrag. */
export type DeliveryOption = 'abholung' | 'lieferung' | 'versand';

export interface ListingLocation {
  zip: string;
  city: string;
  /** Grober Stadtteil statt exakter Adresse – Anschrift steht nur im Impressum. */
  district?: string;
}

/** 360-Grad-Ansicht aus den vorhandenen Fotos ("fast 3D"). */
export interface TurntableConfig {
  enabled: boolean;
  /** Reihenfolge der Fotos für die Drehung (Indizes in den Anzeigenfotos). */
  frameOrder?: number[];
  /** Bei welchem Bild die Drehung startet. */
  startIndex?: number;
}

export interface ShowroomListing {
  id: string;
  /** Verweis auf ein Rad der Haupt-App. Leer = eigenständige Anzeige. */
  bikeId?: string;
  /** URL-tauglicher Kurzname, z. B. "cube-attention-29-zoll". */
  slug: string;

  title: string;
  subtitle?: string;
  description: string;

  /** Preis in Euro. `null` = noch kein Preis gesetzt. */
  price: number | null;
  priceType: PriceType;

  category: BikeCategory;
  condition: ListingCondition;
  status: ListingStatus;

  // --- Fahrrad-Eigenschaften (entsprechen den Kleinanzeigen-Attributen) ---
  brand?: string;
  model?: string;
  year?: string;
  color?: string;
  frameSize?: string;
  wheelSize?: string;
  frameType?: string;
  gearSystem?: string;
  gearCount?: string;
  brakes?: string;
  material?: string;
  weightKg?: string;
  /** Alles, was nicht in die festen Felder passt. */
  specs: ListingSpec[];

  /** Mitverkauftes Zubehör als Schlagworte (Licht, Schloss, Gepäckträger …). */
  extras: string[];
  /** Offen genannte Mängel – ehrlich verkaufen und Gewährleistung absichern. */
  defects: string[];

  /**
   * Eigene Bilder der Anzeige (data:-URL oder normale URL).
   * Bei Anzeigen zu einem Rad der Haupt-App bleiben die Fotos in `Bike.photos`
   * und werden hier nur über `photoIndices` referenziert – das spart Speicher
   * und hält das Firestore-Dokument unter dem 1-MB-Limit.
   */
  photos: string[];
  photoIndices?: number[];
  coverIndex: number;

  hotspots: Hotspot[];
  turntable?: TurntableConfig;

  location?: ListingLocation;
  delivery: DeliveryOption[];
  /** Versandkosten in Euro, wenn Versand angeboten wird. */
  shippingCost?: number;

  createdAt: number;
  updatedAt: number;
  publishedAt?: number | null;
  soldAt?: number | null;

  /** Zähler der Käufer-Ansicht – rein lokal, ersetzt keine echte Statistik. */
  views: number;
  likes: number;

  /** Oben im Showroom hervorheben. */
  featured?: boolean;
  /** Für wen das Rad reserviert ist (nur intern sichtbar). */
  reservedFor?: string;
}

export type InquiryStatus = 'neu' | 'gelesen' | 'beantwortet' | 'archiviert';
export type InquiryChannel = 'formular' | 'whatsapp' | 'mail' | 'telefon' | 'import';

/** Eine Kontaktanfrage aus dem Showroom – landet im Posteingang des Verkäufers. */
export interface ShowroomInquiry {
  id: string;
  listingId?: string;
  /** Titel zum Zeitpunkt der Anfrage – bleibt lesbar, wenn die Anzeige weg ist. */
  listingTitle?: string;
  name: string;
  email: string;
  phone?: string;
  message: string;
  /** Preisvorschlag des Interessenten, falls angegeben. */
  offerPrice?: number | null;
  createdAt: number;
  status: InquiryStatus;
  channel: InquiryChannel;
  /** Woher die Anfrage kam (Domain der Website, "lokal", Import-Datei …). */
  source?: string;
  /** Interne Notiz des Verkäufers. */
  note?: string;
}

/**
 * Verkäufer-Stammdaten. Speist Kopfzeile, Kontaktbereich und Impressum.
 * Wird bewusst NICHT mit echten Daten im Repository abgelegt (der Build läuft
 * auf öffentliche GitHub Pages) – die echten Werte pflegt der Verkäufer in der
 * App, sie liegen dann im Browser bzw. in der exportierten Website-Datei.
 */
export interface SellerProfile {
  /** Anzeigename des Showrooms. */
  displayName: string;
  tagline: string;
  about: string;

  // --- Impressumspflichtige Angaben (§ 5 DDG / § 18 MStV) ---
  legalName: string;
  street: string;
  zip: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  whatsapp?: string;
  /** Umsatzsteuer-ID, falls vorhanden. */
  vatId?: string;
  /** Kleinunternehmer nach § 19 UStG – blendet den USt-Ausweis aus. */
  kleinunternehmer: boolean;
  /** Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV. */
  responsiblePerson?: string;
  /** Gewerbe angemeldet? Steuert den Hinweis zu Gewährleistung/Widerruf. */
  isCommercial: boolean;

  openingHours?: string;
  pickupNote?: string;
  website?: string;
  instagram?: string;

  /** Akzentfarbe des Showrooms als Hex-Wert. */
  accent: string;
  logoDataUrl?: string;
}

/** Wie Anfragen von einer echten Website in den Posteingang gelangen. */
export type InquiryTransportKind = 'lokal' | 'mailto' | 'http';

export type Perspective = 'verkaeufer' | 'kaeufer';

/** Rechtliche Seiten, die ein Verkaufsangebot in Deutschland braucht. */
export type LegalPage = 'impressum' | 'datenschutz' | 'widerruf' | 'agb' | 'versand';

export interface ShowroomSettings {
  transport: InquiryTransportKind;
  /**
   * Endpunkt der echten Website: POST nimmt neue Anfragen entgegen,
   * GET liefert sie für den Posteingang zurück (siehe lib/inquiries.ts).
   */
  endpointUrl?: string;
  /** Optionaler Schlüssel, der als `X-Showroom-Key` mitgeschickt wird. */
  endpointKey?: string;
  /** Öffentliche Basis-URL für Teilen-Links, z. B. https://fahrrad-butz.de */
  publicBaseUrl?: string;
  /** Welche Perspektive der Reiter beim Öffnen zeigt. */
  defaultPerspective: Perspective;
}

/** Alles, was der Showroom braucht – zugleich das Format des Website-Exports. */
export interface ShowroomBundle {
  version: 1;
  exportedAt: number;
  profile: SellerProfile;
  listings: ShowroomListing[];
  settings: Pick<ShowroomSettings, 'endpointUrl' | 'publicBaseUrl' | 'transport'>;
}
