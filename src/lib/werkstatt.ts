import { Expense, InventoryItem } from '../types';

// Kleine geteilte Bausteine für die Materialbuchung am Rad. Bewusst hier und
// nicht in einer Komponente: die gewohnte Werkstatt und der Stoppuhr-Modus
// buchen damit identisch, sonst driften die beiden Wege mit der Zeit auseinander.

export const LAGER_LEER_HINWEIS =
  'Bestand reicht nicht aus. Erst Lager auffüllen oder manuell als externe Ausgabe erfassen.';

/**
 * Was sich am Rad verbauen lässt: nur Ersatzteile mit Restbestand.
 * Verbrauchsmaterial wird direkt als Kosten erfasst und liegt nicht im Lager.
 */
export function lagerTeile(items: InventoryItem[], suche = ''): InventoryItem[] {
  const q = suche.trim().toLowerCase();
  return items.filter(i => {
    if (i.quantity <= 0) return false;
    if (i.category !== 'part') return false;
    if (q && !i.name.toLowerCase().includes(q)) return false;
    return true;
  });
}

/**
 * Neue Materialausgabe. `quelleInventarId` nur setzen, wenn der Posten wirklich
 * aus dem Lager kommt – daran hängt später das Zurücklegen beim Löschen.
 */
export function neueAusgabe(beschreibung: string, betrag: number, quelleInventarId?: string): Expense {
  const ausgabe: Expense = {
    id: Math.random().toString(36).substr(2, 9),
    description: beschreibung,
    amount: betrag,
    date: new Date().toISOString(),
  };
  if (quelleInventarId) ausgabe.sourceInventoryId = quelleInventarId;
  return ausgabe;
}
