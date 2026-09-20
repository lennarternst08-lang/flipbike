import { Bike, KonvolutInfo, WorkLog } from '../types';

// Konvolut-Ankauf: ein Preis, eine Abholfahrt, mehrere Räder. Damit die Tabelle
// trotzdem pro Rad rechnen kann (Stundenlohn, Profit, Standzeit), wird beides
// beim Anlegen zu gleichen Teilen auf die Räder verteilt. Danach ist jedes Rad
// ein ganz normales Rad – die Werkstatt bucht weiter einzeln Zeit darauf, die
// Abholzeit steckt dann schon als erster Zeiteintrag drin.
//
// Dieses Modul rechnet nur; es kennt weder Firestore noch React.

export interface KonvolutDraftBike {
  id: string;   // nur für die Listenanzeige im Dialog
  name: string;
}

export interface KonvolutDraft {
  name: string;
  purchaseDate: string;
  totalPrice: number;
  pickupMinutes: number;
  bikes: KonvolutDraftBike[];
  acquisitionSource?: 'flyer' | 'kleinanzeigen';
}

/**
 * Teilt einen Eurobetrag centgenau auf `anzahl` Räder auf. Der Rest landet auf
 * den ersten Rädern, damit die Summe der Einzelpreise exakt dem Konvolutpreis
 * entspricht – sonst fehlen in der Auswertung stillschweigend ein paar Cent.
 */
export function splitPreis(total: number, anzahl: number): number[] {
  if (anzahl <= 0) return [];
  const cents = Math.round((total || 0) * 100);
  const basis = Math.floor(cents / anzahl);
  const rest = cents - basis * anzahl;
  return Array.from({ length: anzahl }, (_, i) => (basis + (i < rest ? 1 : 0)) / 100);
}

/** Gleiche Logik für die Abholzeit, nur in ganzen Sekunden. */
export function splitSekunden(total: number, anzahl: number): number[] {
  if (anzahl <= 0) return [];
  const ganz = Math.max(0, Math.round(total || 0));
  const basis = Math.floor(ganz / anzahl);
  const rest = ganz - basis * anzahl;
  return Array.from({ length: anzahl }, (_, i) => basis + (i < rest ? 1 : 0));
}

/** Nächste freie Nummer, damit die Konvolute durchlaufend "#1, #2, …" heißen. */
export function naechsteKonvolutNummer(bikes: Bike[]): number {
  let max = 0;
  for (const b of bikes) {
    const treffer = /#(\d+)/.exec(b.konvolut?.name || '');
    if (treffer) max = Math.max(max, parseInt(treffer[1], 10));
  }
  return max + 1;
}

export function standardKonvolutName(bikes: Bike[]): string {
  return `Konvolut #${naechsteKonvolutNummer(bikes)}`;
}

/** Vorschau für den Dialog – dieselben Zahlen, die das Anlegen später schreibt. */
export function konvolutVorschau(totalPrice: number, pickupMinutes: number, anzahl: number) {
  return {
    preisProRad: anzahl > 0 ? (totalPrice || 0) / anzahl : 0,
    minutenProRad: anzahl > 0 ? (pickupMinutes || 0) / anzahl : 0,
  };
}

/**
 * Baut aus dem Dialog-Entwurf die Räder, die angelegt werden sollen. Die
 * Abholzeit wandert als benannter Zeiteintrag in `workLogs`, damit sie in der
 * Werkstatt nachvollziehbar bleibt und nicht als anonyme Startzeit dasteht.
 */
export function buildKonvolutBikes(draft: KonvolutDraft, konvolutId: string): Partial<Bike>[] {
  const gueltige = draft.bikes.filter(b => b.name.trim().length > 0);
  const anzahl = gueltige.length;
  if (anzahl === 0) return [];

  const info: KonvolutInfo = {
    id: konvolutId,
    name: draft.name.trim(),
    totalPrice: draft.totalPrice || 0,
    pickupMinutes: draft.pickupMinutes || 0,
    bikeCount: anzahl,
  };

  const preise = splitPreis(draft.totalPrice, anzahl);
  const sekunden = splitSekunden((draft.pickupMinutes || 0) * 60, anzahl);
  const jetzt = new Date().toISOString();

  return gueltige.map((entwurf, i) => {
    const anteil = sekunden[i];
    const workLogs: WorkLog[] = anteil > 0
      ? [{
          id: `${konvolutId}-abholung-${i}`,
          timestamp: jetzt,
          durationSeconds: anteil,
          note: `Abholung ${info.name} (Anteil ${(anteil / 60).toFixed(0)} min von ${info.pickupMinutes} min)`,
        }]
      : [];

    return {
      name: entwurf.name.trim(),
      status: 'Zu reparieren' as const,
      purchasePrice: preise[i],
      purchaseDate: draft.purchaseDate,
      targetSellingPrice: null,
      timeSpentSeconds: anteil,
      workLogs,
      acquisitionSource: draft.acquisitionSource,
      konvolut: info,
    };
  });
}

// ---------------------------------------------------------------------------
// Anzeige in der Inventar-Tabelle
// ---------------------------------------------------------------------------

export interface KonvolutGruppe {
  info: KonvolutInfo;
  bikes: Bike[];
}

export type KonvolutZeile =
  | { kind: 'bike'; bike: Bike; imKonvolut: boolean }
  | { kind: 'konvolut'; gruppe: KonvolutGruppe };

/**
 * Faltet eine bereits gefilterte und sortierte Radliste so zusammen, dass jedes
 * Konvolut genau einmal vorkommt – an der Stelle seines bestplatzierten Rades.
 * Die Sortierung der übrigen Zeilen bleibt dadurch unangetastet.
 */
export function konvolutZeilen(bikes: Bike[]): KonvolutZeile[] {
  const proKonvolut = new Map<string, Bike[]>();
  for (const b of bikes) {
    const id = b.konvolut?.id;
    if (!id) continue;
    const liste = proKonvolut.get(id);
    if (liste) liste.push(b);
    else proKonvolut.set(id, [b]);
  }

  const gesehen = new Set<string>();
  const zeilen: KonvolutZeile[] = [];
  for (const b of bikes) {
    const id = b.konvolut?.id;
    if (!id) {
      zeilen.push({ kind: 'bike', bike: b, imKonvolut: false });
      continue;
    }
    if (gesehen.has(id)) continue;
    gesehen.add(id);
    zeilen.push({ kind: 'konvolut', gruppe: { info: b.konvolut!, bikes: proKonvolut.get(id)! } });
  }
  return zeilen;
}

export interface KonvolutSumme {
  anzahl: number;
  einkauf: number;
  material: number;
  sekunden: number;
  zielVk: number;
  verkauf: number;
  /** null, solange noch kein Rad der Gruppe verkauft ist. */
  profit: number | null;
  stundenlohn: number | null;
  verkauft: number;
  ankaufsDatum: string;
}

/** Kennzahlen der Gruppe – dieselben Formeln wie in der Einzelzeile, nur summiert. */
export function konvolutSumme(bikes: Bike[]): KonvolutSumme {
  const summe: KonvolutSumme = {
    anzahl: bikes.length,
    einkauf: 0, material: 0, sekunden: 0, zielVk: 0, verkauf: 0,
    profit: null, stundenlohn: null, verkauft: 0,
    ankaufsDatum: bikes[0]?.purchaseDate || '',
  };

  let profit = 0;
  for (const b of bikes) {
    const material = (b.expenses || []).reduce((s, e) => s + e.amount, 0);
    summe.einkauf += b.purchasePrice;
    summe.material += material;
    summe.sekunden += b.timeSpentSeconds || 0;
    summe.zielVk += b.targetSellingPrice || 0;
    if (b.status === 'Verkauft') {
      summe.verkauft += 1;
      summe.verkauf += b.sellingPrice || 0;
      profit += (b.sellingPrice || 0) - b.purchasePrice - material;
    }
    if (b.purchaseDate && b.purchaseDate < summe.ankaufsDatum) summe.ankaufsDatum = b.purchaseDate;
  }

  if (summe.verkauft > 0) {
    summe.profit = profit;
    // Stundenlohn erst, wenn alles verkauft ist: solange noch Räder offen sind,
    // stünde der volle Zeitaufwand einem Teil-Erlös gegenüber und sähe schlecht aus.
    if (summe.verkauft === summe.anzahl && summe.sekunden > 0) {
      summe.stundenlohn = profit / (summe.sekunden / 3600);
    }
  }
  return summe;
}
