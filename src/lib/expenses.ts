import { Bike, Expense } from '../types';

// Reinigung eines Fahrrads durch den Angestellten (Nikita).
// Wird als ganz normale Materialausgabe verbucht, aber über die Kategorie
// 'putzen' markiert, damit sie im Tracking (PTZ-Spalte) umschaltbar bleibt.
export const PUTZEN_COST = 7;
export const PUTZEN_LABEL = 'Putzen (Nikita)';

export function isPutzenExpense(e: Expense): boolean {
  return e.category === 'putzen';
}

export function hasPutzen(bike: Pick<Bike, 'expenses'>): boolean {
  return (bike.expenses || []).some(isPutzenExpense);
}

// Summe der Putz-Ausgaben eines Rads (normalerweise 0 oder PUTZEN_COST).
export function putzenTotal(bike: Pick<Bike, 'expenses'>): number {
  return (bike.expenses || []).filter(isPutzenExpense).reduce((s, e) => s + e.amount, 0);
}

// Schaltet die Putz-Ausgabe um und liefert die neue Ausgabenliste plus eine
// Log-Meldung. Beim Abwählen werden alle Putz-Einträge entfernt (idempotent).
export function togglePutzen(bike: Pick<Bike, 'expenses'>): { expenses: Expense[]; added: boolean } {
  const expenses = bike.expenses || [];
  if (hasPutzen(bike)) {
    return { expenses: expenses.filter((e) => !isPutzenExpense(e)), added: false };
  }
  const newExpense: Expense = {
    id: Math.random().toString(36).substr(2, 9),
    description: PUTZEN_LABEL,
    amount: PUTZEN_COST,
    date: new Date().toISOString(),
    category: 'putzen',
  };
  return { expenses: [...expenses, newExpense], added: true };
}

// Kosten pro Kleinanzeigen-Inserat. Jede Gebühr wird als eigener Expense gespeichert,
// daher wirkt eine spätere Preisänderung nur auf neu erfasste Inserate.
export const KLEINANZEIGEN_AD_COST = 2.49;
export const KLEINANZEIGEN_AD_LABEL = 'Kleinanzeigen-Inserat';

export function isAdExpense(e: Expense): boolean {
  return e.category === 'kleinanzeigen';
}

export function adExpenses(bike: Pick<Bike, 'expenses'>): Expense[] {
  return (bike.expenses || []).filter(isAdExpense);
}

// Wann die Inseratsgebühr wirtschaftlich anfällt: am Tag des Inserats, nicht am Tag
// der Erfassung. Nur so landen nachgetragene Gebühren in der richtigen Periode.
// listedAt fehlt bei Altbeständen – dann das Verkaufsdatum, sonst heute.
export function adExpenseDate(bike: Pick<Bike, 'listedAt' | 'saleDate'>): string {
  const tag = bike.listedAt || bike.saleDate;
  return tag ? `${String(tag).slice(0, 10)}T12:00:00.000Z` : new Date().toISOString();
}

export function addAdExpense(bike: Pick<Bike, 'expenses' | 'listedAt' | 'saleDate'>): Expense[] {
  const newExpense: Expense = {
    id: Math.random().toString(36).substr(2, 9),
    description: KLEINANZEIGEN_AD_LABEL,
    amount: KLEINANZEIGEN_AD_COST,
    date: adExpenseDate(bike),
    category: 'kleinanzeigen',
  };
  return [...(bike.expenses || []), newExpense];
}

// Entfernt das zuletzt gebuchte Inserat (idempotent, wenn keins vorhanden ist).
export function removeLastAdExpense(bike: Pick<Bike, 'expenses'>): Expense[] {
  const expenses = bike.expenses || [];
  const vorhanden = adExpenses(bike);
  if (vorhanden.length === 0) return expenses;
  const letzteId = vorhanden[vorhanden.length - 1].id;
  return expenses.filter((e) => e.id !== letzteId);
}
