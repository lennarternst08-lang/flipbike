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
