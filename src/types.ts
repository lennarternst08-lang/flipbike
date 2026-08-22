import type { ShowroomListing } from '../showroom/types';

export type BikeStatus = 'Zu reparieren' | 'Inseriert' | 'Verkauft' | 'Infrastruktur' | 'Material';

export interface Expense {
  id: string;
  description: string;
  amount: number;
  date: string;
  sourceInventoryId?: string;
  // markiert Sonder-Ausgaben, damit sie zählbar/erkennbar bleiben:
  // 'kleinanzeigen' = Inserat-Gebühren, 'putzen' = Reinigung durch Angestellten
  category?: 'kleinanzeigen' | 'putzen';
}

export interface GroupOrder {
  id: string;
  name: string;
  totalPrice: number;
  date: string;
  userId?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: 'part' | 'consumable' | 'machinery';
  pricePerUnit: number;
  quantity: number;
  initialQuantity?: number;
  sourceId: string;
  purchaseDate: string;
  userId: string;
  orderId?: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

// Einzelner bekannter Mangel für den Kaufvertrag (Ziffer 2)
export interface BikeDefect {
  id: string;
  text: string;
}

// Art des Vertragsschlusses/der Übergabe – entscheidet über das Widerrufsrecht.
export type BikeUebergabeArt = 'abholung' | 'lieferung';

// Fahrrad-Stammdaten für den vorausgefüllten Kaufvertrag.
// Alle Felder optional & frei lassbar – ein Fahrrad kann jederzeit ohne
// vollständige Details angelegt werden (keine Pflichtfelder).
export interface BikeDetails {
  // 1. Kaufgegenstand (Fahrrad)
  marke?: string;
  modell?: string;
  rahmennummer?: string;
  laufradgroesse?: string;   // Zoll
  rahmenhoehe?: string;      // Rahmenhöhe / Größe
  farbe?: string;
  gangschaltung?: string;    // z.B. Shimano Deore
  anzahlGaenge?: string;     // z.B. 21
  baujahr?: string;          // ca. Baujahr
  zubehoer?: string;         // mitverkauftes Zubehör
  maengel?: BikeDefect[];    // 2. Zustand & bekannte Mängel

  // Käufer & Übergabe – meist erst beim Verkauf ausgefüllt (optional)
  kaeuferName?: string;
  kaeuferAnschrift?: string;
  kaeuferKontakt?: string;   // Telefon / E-Mail
  verkaufspreis?: string;    // Vertrags-Kaufpreis; leer => sellingPrice/targetSellingPrice
  zahlweise?: string;        // bar / Überweisung
  ort?: string;              // Ort des Vertragsschlusses
  datum?: string;            // Übergabe- / Warenerhalts-Datum (yyyy-mm-dd) → Fristbeginn

  // Vertragsschluss / Übergabe – steuert Widerrufsrecht im generierten Vertrag.
  // 'abholung'  = in den Geschäftsräumen → kein Widerrufsrecht (§ 312b BGB greift nicht)
  // 'lieferung' = außerhalb von Geschäftsräumen / Fernabsatz → 14 Tage Widerrufsrecht
  uebergabeArt?: BikeUebergabeArt;
  lieferadresse?: string;        // nur bei Lieferung (Pflicht)
  vertragsschlussDatum?: string; // getrennt von datum: Frist läuft ab Warenerhalt
  kaeuferEmail?: string;         // für die Widerrufserklärung (Pflicht bei Lieferung)
  ruecksendekosten?: string;     // konkreter Schätzbetrag; fehlt er, trägt sie der Verkäufer
}

export interface WorkLog {
  id: string;
  timestamp: string;
  durationSeconds: number;
  note?: string; // frei beschriftbare Notiz zur einzelnen Zeit (Arbeits-Protokoll)
}

export interface Receipt {
  id: string;
  bikeId: string;
  referenceId: string; // ID of the bike or expense
  referenceType: 'bike_purchase' | 'expense' | 'infrastructure' | 'material' | 'order';
  fileUrl: string;
  fileName: string;
  fileType: string;
  uploadedAt: number;
  userId?: string;
}

export interface Bike {
  id: string;
  name: string;
  status: BikeStatus;
  purchasePrice: number;
  purchaseDate: string;
  _isHypothetical?: boolean;
  sellingPrice: number | null;
  saleDate: string | null;
  targetSellingPrice: number | null;
  timeSpentSeconds: number;
  startTime?: number | null; // For offline stopwatch tracking
  lastModified: number; // For sorting in workshop
  receivedAt?: string | null; // Standzeit-Tracking: Eingang (ISO 8601)
  listedAt?: string | null;   // Standzeit-Tracking: inseriert am (ISO 8601)
  soldAt?: string | null;     // Standzeit-Tracking: verkauft am (ISO 8601)
  expenses: Expense[];
  checklist: ChecklistItem[];
  workLogs?: WorkLog[];
  notes: string;
  photos: string[];
  details?: BikeDetails; // Fahrrad-Stammdaten für den Kaufvertrag
  /**
   * Showroom-Anzeige zu diesem Rad. Liegt am Fahrrad-Dokument, weil die
   * Firestore-Regeln nicht neu ausgerollt werden können und `isValidBike`
   * Zusatzfelder erlaubt (hasAll, nicht hasOnly). Die Fotos bleiben in
   * `photos` – im Anzeigen-Objekt ist `photos` deshalb immer leer.
   */
  showroom?: ShowroomListing;
  hiddenInWorkshop?: boolean;
  userId?: string;
  isStandalone?: boolean;
  linkedFromId?: string;
  acquisitionSource?: 'flyer' | 'kleinanzeigen';
}

export type FlyerAreaStatus = 'geplant' | 'erledigt';

export interface DistributedArea {
  id: string;
  points: [number, number][];
  flyerCount: number;
  name?: string;
  note?: string;
  distributedDate?: string; // ISO yyyy-mm-dd
  status?: FlyerAreaStatus;
  durationMinutes?: number; // Verteil-Dauer in Minuten → fließt in Geschäfts-Stundenlohn & Logs ein
  costEuro?: number;        // Kosten der Verteilung (Druck, Helfer o.ä.) → fließt in Infrastruktur des Monats
  createdAt?: number;
  userId?: string;
}

export interface ExcludedHouse {
  id: string;
  point: [number, number];
  createdAt?: number;
  userId?: string;
}

// Woher der Lead kam: WhatsApp-Scan, von Hand angelegt oder beim Anlegen eines Rades.
export type FlyerLeadSource = 'whatsapp' | 'manual' | 'bike';

// Eine Anfrage, die auf einen Flyer hin kam – als Punkt auf der Flyerkarte.
// Liegt (wie ExcludedHouse) in der Firestore-Collection `flyerHouses`, dort aber
// mit `kind: 'lead'` markiert, damit beide Sorten sauber getrennt bleiben.
// Enthält personenbezogene Daten → wird bewusst NICHT in localStorage gespiegelt.
export interface FlyerLead {
  id: string;
  point: [number, number]; // [lat, lng] wie überall sonst
  address: string;
  name?: string;
  note?: string;
  source: FlyerLeadSource;
  createdAt?: number;
  bikeIds?: string[]; // Räder, die aus diesem Lead entstanden sind
  userId?: string;
}

export interface FlyerHistoryEntry {
  id: string;
  ts: string;            // ISO timestamp des Log-Eintrags
  action: 'add' | 'edit' | 'delete';
  name: string;
  flyerCount: number;
  date?: string | null;  // distributedDate des Gebiets
  status?: FlyerAreaStatus;
}

export interface DailyTodo {
  id: string;
  text: string;
  completed: boolean;
  createdAt?: number;
  linkedBikeId?: string;
  userId?: string;
}

export interface ServiceRequest {
  id: string;
  name: string;
  issue: string;
  dropoffTime: string;
  status: 'Ausstehend' | 'Angenommen' | 'In Bearbeitung' | 'Fertig' | 'Abgeholt';
  phone?: string;
  notes?: string;
  userId?: string;
}

export interface Log {
  id: string;
  timestamp: number;
  message: string;
  module: 'tracking' | 'workshop' | 'stopwatch' | 'system';
  revertAction?: {
    type: 'add' | 'delete' | 'update';
    data: any;
  };
  userId?: string;
}
