import { AcquisitionSource, Bike, KonvolutInfo, WorkLog } from '../types';

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
  acquisitionSource?: AcquisitionSource;
  /** Freitext bei 'andere', z.B. "Flohmarkt". */
  acquisitionNote?: string;
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

// Der Abhol-Eintrag wird IMMER über dieses Präfix gefunden, nie über den Index:
// beim Bearbeiten ändern sich Reihenfolge und Anzahl der Räder.
export const abholPrefix = (konvolutId: string) => `${konvolutId}-abholung-`;

/** Alle Abhol-Einträge eines Rades – normalerweise genau einer, defensiv als Liste. */
export function abholLogs(bike: Bike, konvolutId: string): WorkLog[] {
  const p = abholPrefix(konvolutId);
  return (bike.workLogs || []).filter(w => typeof w.id === 'string' && w.id.startsWith(p));
}

/** Tatsächlich als Abholung gebuchte Sekunden eines Rades. */
export const abholSekunden = (bike: Bike, konvolutId: string) =>
  abholLogs(bike, konvolutId).reduce((s, w) => s + (w.durationSeconds || 0), 0);

/**
 * Notiztext des Abhol-Eintrags. Von Anlegen UND Bearbeiten benutzt, sonst driften
 * die beiden Wege im Arbeits-Protokoll auseinander.
 */
export const abholNotiz = (info: KonvolutInfo, sekunden: number) =>
  `Abholung ${info.name} (Anteil ${(sekunden / 60).toFixed(0)} min von ${info.pickupMinutes} min)`;

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
          id: `${abholPrefix(konvolutId)}${i}`,
          timestamp: jetzt,
          durationSeconds: anteil,
          note: abholNotiz(info, anteil),
        }]
      : [];

    const rad: Partial<Bike> = {
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
    if (draft.acquisitionSource === 'andere' && draft.acquisitionNote?.trim()) {
      rad.acquisitionNote = draft.acquisitionNote.trim();
    }
    return rad;
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
  /** Davon als Abholung gebucht (Summe der Abhol-Einträge aller Mitglieder). */
  abholSekunden: number;
  zielVk: number;
  verkauf: number;
  /**
   * Die aktuelle Kassenlage des Konvoluts: alles Eingenommene minus alles
   * Ausgegebene. Anders als bei einem einzelnen Rad steht hier bewusst von
   * Anfang an eine Zahl – das Konvolut wurde als Ganzes bezahlt, also ist das
   * Geld auch als Ganzes raus. Mit 60 € Einkauf und einem verkauften Rad für
   * 30 € sind das -30 €, nicht +21,43 €. Die Einzelzeilen bleiben davon
   * unberührt und zeigen bis zum Verkauf weiterhin "-".
   */
  profit: number;
  stundenlohn: number | null;
  verkauft: number;
  ankaufsDatum: string;
}

/** Kennzahlen der Gruppe. */
export function konvolutSumme(bikes: Bike[]): KonvolutSumme {
  const summe: KonvolutSumme = {
    anzahl: bikes.length,
    einkauf: 0, material: 0, sekunden: 0, abholSekunden: 0, zielVk: 0, verkauf: 0,
    profit: 0, stundenlohn: null, verkauft: 0,
    ankaufsDatum: bikes[0]?.purchaseDate || '',
  };

  const kId = bikes[0]?.konvolut?.id;
  for (const b of bikes) {
    const material = (b.expenses || []).reduce((s, e) => s + e.amount, 0);
    summe.einkauf += b.purchasePrice;
    summe.material += material;
    summe.sekunden += b.timeSpentSeconds || 0;
    if (kId) summe.abholSekunden += abholSekunden(b, kId);
    summe.zielVk += b.targetSellingPrice || 0;
    if (b.status === 'Verkauft') {
      summe.verkauft += 1;
      summe.verkauf += b.sellingPrice || 0;
    }
    if (b.purchaseDate && b.purchaseDate < summe.ankaufsDatum) summe.ankaufsDatum = b.purchaseDate;
  }

  // Der komplette Einsatz zählt, nicht nur der Anteil der verkauften Räder.
  summe.profit = summe.verkauf - summe.einkauf - summe.material;

  // Stundenlohn erst, wenn alles verkauft ist: vorher stünde der volle
  // Zeitaufwand einem Teil-Erlös gegenüber und die Zahl wäre wertlos.
  if (summe.verkauft === summe.anzahl && summe.anzahl > 0 && summe.sekunden > 0) {
    summe.stundenlohn = summe.profit / (summe.sekunden / 3600);
  }
  return summe;
}

/**
 * Was die Kopfzeile anzeigt – abgeleitet aus den Rädern, die es WIRKLICH noch gibt.
 *
 * `info.totalPrice` / `info.pickupMinutes` sind der zuletzt im Dialog erfasste Wert und
 * bleiben unverändert stehen. Löscht man ein einzelnes Mitglied über das normale
 * Zeilenmenü, würde die Kopfzeile sonst weiter "60,00 €" behaupten, während die
 * EK-Spalte und der Gewinn schon mit 40,00 € rechnen. Die Ableitung löst das ohne
 * jede Datenmutation beim Löschen – und deckt gleich den Fall mit ab, dass jemand
 * den Einkaufspreis eines Mitglieds direkt in der Tabelle ändert.
 */
export function konvolutAnzeige(info: KonvolutInfo, summe: KonvolutSumme) {
  const preis = Math.round(summe.einkauf * 100) / 100;
  const abholMinuten = Math.round(summe.abholSekunden / 60);
  return {
    preis,
    abholMinuten,
    preisWeichtAb: Math.abs(preis - (info.totalPrice || 0)) >= 0.01,
    zeitWeichtAb: Math.abs(abholMinuten - (info.pickupMinutes || 0)) >= 1,
  };
}

// ---------------------------------------------------------------------------
// Nachträglich bearbeiten
// ---------------------------------------------------------------------------

/** Eine Zeile im Bearbeiten-Dialog. */
export interface KonvolutEditZeile {
  /** Gesetzt = vorhandenes Mitglied. Fehlt bei neu hinzugefügten Zeilen. */
  bikeId?: string;
  /**
   * Nur bei neuen Zeilen: die ID, die das Rad bekommen soll (= Key der Dialogzeile).
   * Vorgegeben, damit die Vorschau im Dialog exakt die Zahlen zeigt, die gespeichert
   * werden – eine im Plan gewürfelte ID würde die Cent-Verteilung bei jedem Render
   * neu auslosen.
   */
  neuId?: string;
  name: string;
}

export interface KonvolutEditDraft {
  name: string;
  totalPrice: number;
  pickupMinutes: number;
  zeilen: KonvolutEditZeile[];
}

/** Eine Zeile der Vorschau: exakt das, was gespeichert würde. */
export interface KonvolutVerteilung {
  id: string;
  name: string;
  neu: boolean;
  verkauft: boolean;
  laeuft: boolean;
  preis: number;
  preisVorher: number | null;
  /** null = kein intakter Abhol-Eintrag, die Zeit dieses Rades wird nicht angefasst. */
  sekunden: number | null;
  sekundenVorher: number | null;
}

/**
 * Was eine Bearbeitung konkret bedeutet – berechnet, bevor irgendetwas geschrieben
 * wird (gleiche Bauart wie planGroupOrderUpdate in lib/groupOrders.ts).
 */
export interface KonvolutUpdatePlan {
  /** Solange hier etwas drinsteht, wird NICHTS geschrieben. */
  fehler: string[];
  /** Blockiert nicht, gehört aber sichtbar in den Dialog. */
  hinweise: string[];
  info: KonvolutInfo;
  neu: Partial<Bike>[];
  /** Nur die wirklich berührten Felder, plus die alten Werte fürs Rückgängig. */
  aendern: { id: string; updates: Partial<Bike>; oldValues: Partial<Bike> }[];
  /** Vollständige Kopien – die einzige Quelle, aus der ein Undo sie zurückholen kann. */
  loeschen: Bike[];
  verteilung: KonvolutVerteilung[];
  /** Sekunden, die wegen zerstörter Abhol-Einträge nicht gebucht werden können. */
  nichtGebucht: number;
  zusammenfassung: string;
}

const cent = (n: number) => Math.round((n || 0) * 100);

/** Feldweiser Vergleich, damit ein unveränderter Plan keine Schreibvorgänge auslöst. */
function infoGleich(a: KonvolutInfo | undefined, b: KonvolutInfo): boolean {
  if (!a) return false;
  return a.id === b.id && a.name === b.name && cent(a.totalPrice) === cent(b.totalPrice)
    && (a.pickupMinutes || 0) === (b.pickupMinutes || 0)
    && a.bikeCount === b.bikeCount && (a.notes || '') === (b.notes || '');
}

/**
 * Rechnet eine Bearbeitung durch, ohne irgendetwas zu schreiben.
 *
 * Preis und Abholzeit werden auf ALLE Mitglieder neu verteilt, auch auf bereits
 * verkaufte – das ist eine bewusste Entscheidung: ein Konvolut wurde als Ganzes
 * bezahlt, eine Preiskorrektur betrifft folglich jedes Rad daraus. Dass sich damit
 * der Gewinn abgeschlossener Verkäufe rückwirkend ändert, meldet `hinweise`.
 */
export function planKonvolutUpdate(
  mitglieder: Bike[],
  entwurf: KonvolutEditDraft
): KonvolutUpdatePlan {
  const alt = mitglieder[0]?.konvolut;
  const leer: KonvolutUpdatePlan = {
    fehler: [], hinweise: [],
    info: alt ?? { id: '', name: '', totalPrice: 0, pickupMinutes: 0, bikeCount: 0 },
    neu: [], aendern: [], loeschen: [], verteilung: [], nichtGebucht: 0, zusammenfassung: '',
  };
  if (!alt) {
    leer.fehler.push('Dieses Konvolut gibt es nicht mehr.');
    return leer;
  }

  const kId = alt.id;
  const nachId = new Map(mitglieder.map(b => [b.id, b]));
  const behalten = entwurf.zeilen.filter(z => z.bikeId && nachId.has(z.bikeId));
  const neueZeilen = entwurf.zeilen.filter(z => !z.bikeId && z.name.trim().length > 0);

  // --- blockierende Fehler: erst prüfen, dann rechnen ---
  const fehler: string[] = [];
  if (behalten.length + neueZeilen.length === 0) {
    fehler.push('Ein Konvolut braucht mindestens ein Rad. Zum Auflösen: Konvolut löschen.');
  }
  if (!(entwurf.totalPrice >= 0)) fehler.push('Der Gesamtpreis kann nicht negativ sein.');
  if (!(entwurf.pickupMinutes >= 0)) fehler.push('Die Abholdauer kann nicht negativ sein.');
  for (const z of behalten) {
    if (!z.name.trim()) fehler.push(`"${nachId.get(z.bikeId!)!.name}": Der Name darf nicht leer sein.`);
  }
  if (fehler.length > 0) return { ...leer, fehler };

  // --- Zielmenge in STABILER Reihenfolge ---
  // Nach Bike-ID sortiert, nicht nach Zeilenposition: splitPreis gibt den Cent-Rest an
  // die ersten Indizes, sonst springt bei jedem Löschen/Einfügen ein Cent zwischen
  // Rädern – auch zwischen bereits verkauften.
  const ziel = [
    ...behalten.map(z => ({ id: z.bikeId!, bike: nachId.get(z.bikeId!)!, name: z.name.trim() })),
    ...neueZeilen.map(z => ({
      id: z.neuId || `kvb${Math.random().toString(36).slice(2, 9)}`,
      bike: null as Bike | null,
      name: z.name.trim(),
    })),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const preise = splitPreis(entwurf.totalPrice, ziel.length);
  const sekunden = splitSekunden((entwurf.pickupMinutes || 0) * 60, ziel.length);

  const info: KonvolutInfo = {
    id: kId,
    name: entwurf.name.trim() || alt.name,
    totalPrice: entwurf.totalPrice || 0,
    pickupMinutes: entwurf.pickupMinutes || 0,
    bikeCount: ziel.length,
  };
  // Nur setzen wenn vorhanden – undefined lehnt Firestore ab.
  if (alt.notes && alt.notes.trim()) info.notes = alt.notes;

  // Zeitstempel für NEUE Abhol-Einträge: der der Gruppe, nicht "jetzt". Sonst wandert
  // die Abholzeit in den aktuellen Monat statt in den Ankaufsmonat (TrackingModule
  // ordnet Arbeitsstunden über workLogs[].timestamp einer Periode zu).
  const gruppenDatum = mitglieder.reduce(
    (d, b) => (b.purchaseDate && b.purchaseDate < d ? b.purchaseDate : d),
    mitglieder[0].purchaseDate
  );
  const vorhandenerStempel = mitglieder
    .flatMap(b => abholLogs(b, kId))
    .map(w => w.timestamp)
    .sort()[0];
  const refTs = vorhandenerStempel || `${gruppenDatum}T12:00:00.000Z`;

  const ersteQuelle = mitglieder[0].acquisitionSource;
  const quelle = mitglieder.every(b => b.acquisitionSource === ersteQuelle) ? ersteQuelle : undefined;
  const ersteNotiz = mitglieder[0].acquisitionNote;
  const quellNotiz = quelle === 'andere' && mitglieder.every(b => b.acquisitionNote === ersteNotiz) ? ersteNotiz : undefined;

  const plan: KonvolutUpdatePlan = { ...leer, info, fehler: [], hinweise: [] };

  ziel.forEach((z, i) => {
    // ---------- neues Rad ----------
    if (!z.bike) {
      const anteil = sekunden[i];
      const rad: Partial<Bike> = {
        id: z.id,
        name: z.name,
        status: 'Zu reparieren',
        purchasePrice: preise[i],
        purchaseDate: gruppenDatum,
        targetSellingPrice: null,
        timeSpentSeconds: anteil,
        workLogs: anteil > 0
          ? [{ id: `${abholPrefix(kId)}${z.id}`, timestamp: refTs, durationSeconds: anteil, note: abholNotiz(info, anteil) }]
          : [],
        konvolut: info,
      };
      if (quelle) rad.acquisitionSource = quelle;
      if (quellNotiz) rad.acquisitionNote = quellNotiz;
      plan.neu.push(rad);
      plan.verteilung.push({
        id: z.id, name: z.name, neu: true, verkauft: false, laeuft: false,
        preis: preise[i], preisVorher: null, sekunden: anteil, sekundenVorher: null,
      });
      return;
    }

    // ---------- vorhandenes Rad ----------
    const b = z.bike;
    const updates: Partial<Bike> = {};
    const oldValues: Partial<Bike> = {};

    if (z.name !== b.name) { updates.name = z.name; oldValues.name = b.name; }
    if (cent(b.purchasePrice) !== cent(preise[i])) {
      updates.purchasePrice = preise[i];
      oldValues.purchasePrice = b.purchasePrice;
    }

    // ---------- Zeit: defensiv ----------
    // Der Abhol-Eintrag kann bereits zerstört sein – die Werkstatt zieht bei einer
    // negativen Zeitkorrektur von hinten aus den workLogs ab und filtert 0-Einträge.
    const treffer = abholLogs(b, kId);
    let sekundenAnzeige: number | null = null;
    let sekundenVorher: number | null = null;

    if (treffer.length > 0) {
      const altS = treffer.reduce((s, w) => s + (w.durationSeconds || 0), 0);
      const neuS = sekunden[i];
      sekundenAnzeige = neuS;
      sekundenVorher = altS;
      const notizNeu = abholNotiz(info, neuS);
      if (neuS !== altS || treffer.length > 1 || treffer[0].note !== notizNeu) {
        // An Ort und Stelle ersetzen: der Eintrag behält seine Position in der Liste
        // (die Werkstatt zieht Zeit von hinten ab, die Reihenfolge ist also relevant)
        // und vor allem seinen timestamp – ein neuer Stempel verschöbe die Stunden
        // rückwirkend in den aktuellen Monat.
        let ersetzt = false;
        const neueLogs: WorkLog[] = [];
        for (const w of b.workLogs || []) {
          const istAbhol = typeof w.id === 'string' && w.id.startsWith(abholPrefix(kId));
          if (!istAbhol) { neueLogs.push(w); continue; }
          if (ersetzt) continue; // weitere Treffer fallen weg, ihre Sekunden stecken in altS
          ersetzt = true;
          if (neuS > 0) neueLogs.push({ ...w, durationSeconds: neuS, note: notizNeu });
        }
        updates.workLogs = neueLogs;
        oldValues.workLogs = b.workLogs || [];
        // Zeit und Log IMMER gemeinsam: TrackingModule rechnet
        // unloggedTime = max(0, timeSpentSeconds - Summe workLogs) und schlägt die
        // Differenz dem Kaufdatum zu.
        updates.timeSpentSeconds = Math.max(0, (b.timeSpentSeconds || 0) + (neuS - altS));
        oldValues.timeSpentSeconds = b.timeSpentSeconds || 0;
      }
    } else if (sekunden[i] > 0) {
      // Kein Abhol-Eintrag mehr: Zeit dieses Rades bleibt unangetastet. Den Anteil
      // stattdessen auf die übrigen zu verteilen würde einem Rad Zeit anhängen, die
      // es nie hatte, und der Anteil wäre nicht mehr reproduzierbar.
      plan.nichtGebucht += sekunden[i];
      plan.hinweise.push(
        `"${b.name}": kein Abhol-Eintrag mehr vorhanden – die Zeit wurde in der Werkstatt `
        + `von Hand geändert. Der Anteil von ${Math.round(sekunden[i] / 60)} min wird nicht `
        + `gebucht, die Zeit des Rades bleibt wie sie ist.`
      );
    }

    if (!infoGleich(b.konvolut, info)) { updates.konvolut = info; oldValues.konvolut = b.konvolut; }
    if (Object.keys(updates).length > 0) plan.aendern.push({ id: b.id, updates, oldValues });

    if (b.status === 'Verkauft' && (updates.purchasePrice !== undefined || updates.timeSpentSeconds !== undefined)) {
      plan.hinweise.push(
        `"${b.name}" ist bereits verkauft – Gewinn, Monatsauswertung und Gewinnkurve ändern sich rückwirkend.`
      );
    }
    if (b.startTime) plan.hinweise.push(`"${b.name}": die Stoppuhr läuft gerade.`);

    plan.verteilung.push({
      id: b.id, name: z.name, neu: false,
      verkauft: b.status === 'Verkauft', laeuft: !!b.startTime,
      preis: preise[i], preisVorher: b.purchasePrice,
      sekunden: sekundenAnzeige, sekundenVorher,
    });
  });

  // ---------- Löschungen ----------
  const behaltenIds = new Set(behalten.map(z => z.bikeId!));
  plan.loeschen = mitglieder.filter(b => !behaltenIds.has(b.id)).map(b => ({ ...b }));
  for (const w of plan.loeschen) {
    if (w.status === 'Verkauft') {
      plan.hinweise.push(
        `"${w.name}" ist verkauft und wird gelöscht – der Verkauf verschwindet aus Umsatz `
        + `und Monatsauswertung. Rückgängig über das Log.`
      );
    }
  }

  plan.zusammenfassung = fasseZusammen(alt, info, plan);
  return plan;
}

/** Log-Text: muss ohne die App verständlich sein, deshalb mit Namen der gelöschten Räder. */
function fasseZusammen(alt: KonvolutInfo, neu: KonvolutInfo, plan: KonvolutUpdatePlan): string {
  const euro = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
  const teile = [
    alt.name !== neu.name ? `"${alt.name}" → "${neu.name}"` : '',
    cent(alt.totalPrice) !== cent(neu.totalPrice) ? `${euro(alt.totalPrice)} → ${euro(neu.totalPrice)}` : '',
    (alt.pickupMinutes || 0) !== (neu.pickupMinutes || 0)
      ? `Abholung ${alt.pickupMinutes || 0} → ${neu.pickupMinutes || 0} min` : '',
    plan.neu.length ? `${plan.neu.length} neu (${plan.neu.map(b => b.name).join(', ')})` : '',
    plan.loeschen.length ? `${plan.loeschen.length} gelöscht (${plan.loeschen.map(b => b.name).join(', ')})` : '',
    plan.nichtGebucht ? `${Math.round(plan.nichtGebucht / 60)} min ohne Abhol-Eintrag nicht gebucht` : '',
  ].filter(Boolean);
  return teile.length ? teile.join(', ') : 'keine inhaltliche Änderung';
}
