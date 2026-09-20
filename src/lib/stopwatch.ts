import { Bike } from '../types';

// Die laufende Stoppuhr lebt in localStorage, nicht im React-State: so überlebt
// sie einen Tab-Wechsel, das Sperren des iPads und einen Reload im Keller ohne
// Netz. Es kann immer nur eine Uhr laufen – der Schlüssel ist deshalb global und
// nicht pro Rad. `bike.startTime` ist die Zweitquelle für den Fall, dass die Uhr
// auf einem anderen Gerät gestartet wurde.

const KEY = 'flipbike_active_timer';

export interface ActiveTimer {
  bikeId: string;
  startTime: number;   // ms-Zeitstempel des Starts
  initialTime: number; // Sekundenstand des Rades beim Start
}

export function readActiveTimer(): ActiveTimer | null {
  try {
    const roh = localStorage.getItem(KEY);
    if (!roh) return null;
    const t = JSON.parse(roh);
    if (!t || typeof t.bikeId !== 'string' || typeof t.startTime !== 'number') return null;
    return { bikeId: t.bikeId, startTime: t.startTime, initialTime: t.initialTime || 0 };
  } catch {
    // Kaputter Eintrag blockiert sonst dauerhaft jede Uhr.
    try { localStorage.removeItem(KEY); } catch {}
    return null;
  }
}

export function writeActiveTimer(timer: ActiveTimer): void {
  try { localStorage.setItem(KEY, JSON.stringify(timer)); } catch {}
}

export function clearActiveTimer(): void {
  try { localStorage.removeItem(KEY); } catch {}
}

/**
 * Läuft für dieses Rad gerade die Uhr? Ein Eintrag für ein anderes Rad gewinnt
 * bewusst gegen ein altes `startTime` am Dokument – sonst würden nach einem
 * Absturz zwei Uhren gleichzeitig als laufend gelten.
 */
export function laeuft(bike: Bike, timer: ActiveTimer | null): boolean {
  if (timer) return timer.bikeId === bike.id;
  return !!bike.startTime;
}

/** Sekunden der gerade laufenden Sitzung; 0, wenn die Uhr steht. */
export function sitzungSekunden(bike: Bike, timer: ActiveTimer | null, jetzt = Date.now()): number {
  if (timer && timer.bikeId === bike.id) {
    return Math.max(0, Math.floor((jetzt - timer.startTime) / 1000));
  }
  if (!timer && bike.startTime) {
    return Math.max(0, Math.floor((jetzt - bike.startTime) / 1000));
  }
  return 0;
}

/** Gesamtzeit des Rades inklusive der laufenden Sitzung. */
export function gesamtSekunden(bike: Bike, timer: ActiveTimer | null, jetzt = Date.now()): number {
  if (timer && timer.bikeId === bike.id) {
    return timer.initialTime + sitzungSekunden(bike, timer, jetzt);
  }
  return (bike.timeSpentSeconds || 0) + sitzungSekunden(bike, timer, jetzt);
}

/** hh:mm:ss für die große Anzeige. */
export function formatUhr(sekunden: number): string {
  const s = Math.max(0, Math.floor(sekunden));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return [h, m, rest].map(n => String(n).padStart(2, '0')).join(':');
}

/** Kompakt für Nebenangaben: "1h 23m" bzw. "12m". */
export function formatKurz(sekunden: number): string {
  const s = Math.max(0, Math.floor(sekunden));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
