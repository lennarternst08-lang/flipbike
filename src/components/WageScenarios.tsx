import React, { useEffect, useMemo, useState } from 'react';
import { Input } from './ui/input';
import { ChevronDown, ChevronRight, TrendingUp, Clock, Calculator, Check } from 'lucide-react';

/**
 * Stundenlohn-Szenarien für das aktive Werkstatt-Projekt.
 *
 * Grundrechnung überall gleich:
 *   Kosten   = Ankaufspreis + alle Ausgaben
 *   Gewinn   = VK - Kosten
 *   €/h      = Gewinn / Stunden
 *
 * Drei aufklappbare Blöcke:
 *   1) „nach Verkaufspreis" – VK variiert, Zeit = aktueller Stand
 *   2) „nach Zeit"          – Zeit variiert, VK = Basis-VK
 *   3) „Zielrechner"        – Wunschlohn + geplante Stunden → nötiger VK
 */

/* ---------------- Formatierung ---------------- */

const num = (n: number, digits: number) =>
  (Object.is(n, -0) ? 0 : n).toLocaleString('de-DE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

const eur = (n: number, digits = 0) => `${num(n, digits)} €`;
/** Cent nur zeigen, wenn es welche gibt – hält die Spalten schmal, ohne zu runden */
const eurAuto = (n: number) => (Math.abs(n % 1) < 0.005 ? eur(n, 0) : eur(n, 2));
const wageStr = (n: number) => `${num(n, 1)} €/h`;
const hoursStr = (h: number) => `${num(h, 1)} h`;

/** "12,5" und "12.5" akzeptieren; leer/Unsinn → null */
const parseNum = (s: string): number | null => {
  const v = parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

/* ---------------- „schöne" Schrittweiten ---------------- */

const PRICE_STEPS = [5, 10, 20, 25, 50, 100, 200, 500];
/** ~10 % vom Basispreis, aufgerundet auf den nächsten runden Betrag */
const nicePriceStep = (anchor: number) =>
  PRICE_STEPS.find((s) => s >= Math.abs(anchor) * 0.1) ?? 500;

const TIME_STEPS = [10, 15, 20, 30, 45, 60, 90, 120];
/** ~20 % der bisherigen Zeit, mindestens 10 min – bei 5 h bringen 10 min nichts mehr */
const niceTimeStep = (minutesSoFar: number) =>
  TIME_STEPS.find((s) => s >= minutesSoFar * 0.2) ?? 180;

/* ---------------- localStorage (Einstellungen gelten radübergreifend) ---------------- */

const LS_OPEN = 'fb_wage_open';
const LS_PRICE_STEP = 'fb_wage_price_step';
const LS_TIME_STEP = 'fb_wage_time_step';
const LS_TARGET_WAGE = 'fb_wage_target_wage';

const lsGet = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const lsSet = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Private Mode o.ä. – Einstellungen sind dann nur temporär */
  }
};

/* ---------------- Bausteine ---------------- */

interface PanelProps {
  icon: React.ReactNode;
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function Panel({ icon, title, summary, open, onToggle, children }: PanelProps) {
  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-800 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-slate-800/60 transition-colors"
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
        )}
        {icon}
        <span className="text-sm font-medium text-slate-300 flex-1 truncate">{title}</span>
        {summary && !open && (
          <span className="text-xs text-slate-500 whitespace-nowrap">{summary}</span>
        )}
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t border-slate-800/80">{children}</div>}
    </div>
  );
}

/** Kleines Zahlenfeld mit „auto"-Platzhalter (leer = automatischer Wert) */
function MiniField({
  label,
  value,
  onChange,
  placeholder,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  suffix?: string;
}) {
  return (
    <label className="flex-1 min-w-0">
      <span className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">{label}</span>
      <div className="relative">
        <Input
          type="number"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`h-8 text-xs px-2 ${suffix ? 'pr-7' : ''}`}
        />
        {suffix && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

function Row({
  highlight,
  cells,
}: {
  highlight?: boolean;
  cells: [React.ReactNode, React.ReactNode, React.ReactNode];
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs ${
        highlight ? 'bg-orange-500/10 ring-1 ring-inset ring-orange-500/30' : 'hover:bg-slate-800/60'
      }`}
    >
      <span className="w-16 shrink-0 text-slate-300 tabular-nums">{cells[0]}</span>
      <span className="flex-1 text-right text-slate-400 tabular-nums">{cells[1]}</span>
      <span className="w-[4.5rem] shrink-0 text-right font-medium tabular-nums">{cells[2]}</span>
    </div>
  );
}

function HeadRow({ cells }: { cells: [string, string, string] }) {
  return (
    <div className="flex items-center gap-2 px-2 pb-1 text-[10px] uppercase tracking-wide text-slate-500">
      <span className="w-16 shrink-0">{cells[0]}</span>
      <span className="flex-1 text-right">{cells[1]}</span>
      <span className="w-[4.5rem] shrink-0 text-right">{cells[2]}</span>
    </div>
  );
}

/* ---------------- Hauptkomponente ---------------- */

export interface WageScenariosProps {
  bikeId: string;
  purchasePrice: number;
  totalExpenses: number;
  /** aktuell erfasste Zeit in Sekunden (läuft mit der Stoppuhr mit) */
  currentSeconds: number;
  /** angepeilter VK (bzw. tatsächlicher VK, falls schon verkauft) */
  targetPrice: number | null;
  /** optional: Ergebnis des Zielrechners als neuen Ziel-VK speichern */
  onApplyTargetPrice?: (price: number) => void;
}

export function WageScenarios({
  bikeId,
  purchasePrice,
  totalExpenses,
  currentSeconds,
  targetPrice,
  onApplyTargetPrice,
}: WageScenariosProps) {
  const cost = purchasePrice + totalExpenses;
  const hours = currentSeconds / 3600;
  const hasTime = currentSeconds >= 60;

  /* --- offene Panels merken --- */
  const [open, setOpen] = useState<{ price: boolean; time: boolean; goal: boolean }>(() => {
    try {
      const parsed = JSON.parse(lsGet(LS_OPEN, '{}'));
      return {
        price: !!parsed.price,
        time: !!parsed.time,
        goal: !!parsed.goal,
      };
    } catch {
      return { price: false, time: false, goal: false };
    }
  });
  const toggle = (key: 'price' | 'time' | 'goal') => {
    setOpen((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      lsSet(LS_OPEN, JSON.stringify(next));
      return next;
    });
  };

  /* --- Wunsch-Stundenlohn: Maßstab für die Einfärbung aller Tabellen --- */
  const [targetWageRaw, setTargetWageRaw] = useState(() => lsGet(LS_TARGET_WAGE, '20'));
  const targetWage = Math.max(0.5, parseNum(targetWageRaw) ?? 20);
  const setTargetWage = (v: string) => {
    setTargetWageRaw(v);
    lsSet(LS_TARGET_WAGE, v);
  };

  /* --- Basis-VK: standardmäßig der angepeilte VK, überschreibbar --- */
  const autoAnchor = useMemo(() => {
    if (targetPrice && targetPrice > 0) return targetPrice;
    // Kein Ziel-VK hinterlegt → Preis schätzen, der den Wunschlohn gerade trägt
    const est = cost + targetWage * Math.max(hours, 1);
    const step = nicePriceStep(Math.max(est, 20));
    return Math.max(step, Math.round(est / step) * step);
  }, [targetPrice, cost, targetWage, hours]);

  const [anchorRaw, setAnchorRaw] = useState('');
  const [plannedHoursRaw, setPlannedHoursRaw] = useState('');
  // Rad gewechselt → radbezogene Eingaben zurücksetzen
  useEffect(() => {
    setAnchorRaw('');
    setPlannedHoursRaw('');
  }, [bikeId]);

  const anchor = Math.max(1, parseNum(anchorRaw) ?? autoAnchor);
  const anchorIsCustom = parseNum(anchorRaw) !== null;

  /* --- Schrittweiten --- */
  const [priceStepRaw, setPriceStepRaw] = useState(() => lsGet(LS_PRICE_STEP, ''));
  const [timeStepRaw, setTimeStepRaw] = useState(() => lsGet(LS_TIME_STEP, ''));
  const autoPriceStep = nicePriceStep(anchor);
  const autoTimeStep = niceTimeStep(currentSeconds / 60);
  const priceStep = Math.max(1, parseNum(priceStepRaw) ?? autoPriceStep);
  const timeStep = Math.max(1, parseNum(timeStepRaw) ?? autoTimeStep);

  /* --- Rechnungen --- */
  const wageAt = (price: number, h: number) => (h > 0 ? (price - cost) / h : null);
  const currentWage = wageAt(anchor, hours);

  const wageClass = (w: number | null) =>
    w === null
      ? 'text-slate-500'
      : w < 0
      ? 'text-red-400'
      : w >= targetWage
      ? 'text-emerald-400'
      : 'text-amber-400';

  /**
   * 5 Preise rund um die Basis. Die Vergleichspreise werden aufs Schritt-Raster
   * gerundet (144 € / 20er-Schritt → 100/120/…/180 statt 104/124/…), damit man
   * runde Zahlen vergleicht; die Basis selbst bleibt exakt stehen.
   * Preise ≤ 0 fallen weg und werden nach oben aufgefüllt.
   */
  const priceRows = useMemo(() => {
    const snap = (v: number) => Math.round(v / priceStep) * priceStep;
    const out: number[] = [];
    for (let i = -2; out.length < 5 && i <= 12; i++) {
      const p = i === 0 ? anchor : snap(anchor + i * priceStep);
      if (p > 0) out.push(p);
    }
    return out;
  }, [anchor, priceStep]);

  const timeRows = useMemo(
    () => [0, 1, 2, 3, 4, 5].map((i) => ({ addMin: i * timeStep, h: hours + (i * timeStep) / 60 })),
    [hours, timeStep]
  );

  /* --- Zielrechner --- */
  const autoPlannedHours = Math.max(0.5, Math.ceil((hours + 0.25) * 2) / 2);
  const plannedHours = Math.max(0.25, parseNum(plannedHoursRaw) ?? autoPlannedHours);
  const neededPrice = cost + targetWage * plannedHours;
  const neededPriceRounded = Math.ceil(neededPrice / 5) * 5;
  const wageAtPlanned = wageAt(anchor, plannedHours);
  const deltaToAnchor = neededPriceRounded - anchor;

  /** Wie lange darf ich beim Basis-VK insgesamt arbeiten, um den Wunschlohn zu halten? */
  const budgetHours = anchor > cost ? (anchor - cost) / targetWage : 0;
  const remainingHours = budgetHours - hours;

  /** VK, der bei aktueller Zeit genau den Wunschlohn bringt */
  const priceForTargetWage = cost + targetWage * Math.max(hours, 0);

  return (
    <div className="space-y-2">
      {/* Wunsch-Stundenlohn – gemeinsamer Maßstab, färbt alle Tabellen ein */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-800/30 rounded-xl border border-slate-800">
        <div className="min-w-0">
          <p className="text-xs text-slate-400">Wunsch-Stundenlohn</p>
          <p className="text-[10px] text-slate-600">Maßstab für die Farben unten</p>
        </div>
        <div className="relative w-24 shrink-0">
          <Input
            type="number"
            inputMode="decimal"
            value={targetWageRaw}
            onChange={(e) => setTargetWage(e.target.value)}
            className="h-8 text-xs px-2 pr-8 text-right"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 pointer-events-none">
            €/h
          </span>
        </div>
      </div>

      {/* ---------- 1) Stundenlohn nach Verkaufspreis ---------- */}
      <Panel
        icon={<TrendingUp className="w-4 h-4 text-orange-500 shrink-0" />}
        title="Stundenlohn nach VK"
        summary={hasTime ? `bei ${hoursStr(hours)}` : 'Zeit fehlt'}
        open={open.price}
        onToggle={() => toggle('price')}
      >
        <p className="text-[11px] text-slate-500 mb-3">
          VK variiert, Zeit bleibt bei <span className="text-slate-400">{hoursStr(hours)}</span>.
        </p>

        <div className="flex gap-2 mb-3">
          <MiniField
            label="Basis-VK"
            value={anchorRaw}
            onChange={setAnchorRaw}
            placeholder={String(Math.round(autoAnchor))}
            suffix="€"
          />
          <MiniField
            label="Schritt"
            value={priceStepRaw}
            onChange={(v) => {
              setPriceStepRaw(v);
              lsSet(LS_PRICE_STEP, v);
            }}
            placeholder={String(autoPriceStep)}
            suffix="€"
          />
        </div>

        {hasTime ? (
          <>
            <HeadRow cells={['VK', 'Gewinn', '€/h']} />
            <div className="space-y-0.5">
              {priceRows.map((p) => {
                const w = wageAt(p, hours);
                const isBase = Math.abs(p - anchor) < 0.005;
                return (
                  <Row
                    key={p}
                    highlight={isBase}
                    cells={[
                      eurAuto(p),
                      <span className={p - cost < 0 ? 'text-red-400/80' : undefined}>
                        {eurAuto(p - cost)}
                      </span>,
                      <span className={wageClass(w)}>{w === null ? '–' : wageStr(w)}</span>,
                    ]}
                  />
                );
              })}
            </div>
            <div className="mt-3 pt-2 border-t border-slate-800 space-y-1 text-[11px]">
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Break-even (0 €/h)</span>
                <span className="text-slate-400 tabular-nums">{eurAuto(cost)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Für {num(targetWage, 0)} €/h nötig</span>
                <span className="text-slate-300 tabular-nums">{eurAuto(priceForTargetWage)}</span>
              </div>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-slate-500 py-2">
            Noch keine Zeit erfasst – ohne Stunden gibt es keinen Stundenlohn. Break-even liegt bei{' '}
            <span className="text-slate-300">{eurAuto(cost)}</span>.
          </p>
        )}
      </Panel>

      {/* ---------- 2) Stundenlohn nach Zeit ---------- */}
      <Panel
        icon={<Clock className="w-4 h-4 text-orange-500 shrink-0" />}
        title="Stundenlohn nach Zeit"
        summary={`bei ${eurAuto(anchor)}`}
        open={open.time}
        onToggle={() => toggle('time')}
      >
        <p className="text-[11px] text-slate-500 mb-3">
          Zeit variiert, VK bleibt bei <span className="text-slate-400">{eurAuto(anchor)}</span>
          {anchorIsCustom ? ' (eigene Basis)' : targetPrice ? '' : ' (geschätzt)'}.
        </p>

        <div className="flex gap-2 mb-3">
          <MiniField
            label="Schritt"
            value={timeStepRaw}
            onChange={(v) => {
              setTimeStepRaw(v);
              lsSet(LS_TIME_STEP, v);
            }}
            placeholder={String(autoTimeStep)}
            suffix="min"
          />
          <div className="flex-1 flex items-end pb-1">
            <p className="text-[10px] text-slate-600 leading-tight">
              Auto: ~20 % der bisherigen Zeit
            </p>
          </div>
        </div>

        <HeadRow cells={['Zeit', 'Δ €/h', '€/h']} />
        <div className="space-y-0.5">
          {timeRows.map((r) => {
            const w = wageAt(anchor, r.h);
            const diff = w !== null && currentWage !== null ? w - currentWage : null;
            return (
              <Row
                key={r.addMin}
                highlight={r.addMin === 0}
                cells={[
                  r.addMin === 0 ? hoursStr(r.h) : `+${r.addMin} min`,
                  r.addMin === 0 ? (
                    <span className="text-slate-500">jetzt</span>
                  ) : diff === null ? (
                    hoursStr(r.h)
                  ) : (
                    <span className="text-slate-500">
                      {diff >= 0 ? '+' : '−'}
                      {num(Math.abs(diff), 1)}
                    </span>
                  ),
                  <span className={wageClass(w)}>{w === null ? '–' : wageStr(w)}</span>,
                ]}
              />
            );
          })}
        </div>

        <div className="mt-3 pt-2 border-t border-slate-800 text-[11px]">
          {anchor > cost ? (
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">{num(targetWage, 0)} €/h halten bis</span>
              <span className="text-slate-300 tabular-nums">
                {hoursStr(budgetHours)}
                <span className={remainingHours >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {' '}
                  ({remainingHours >= 0 ? 'noch ' : 'über '}
                  {hoursStr(Math.abs(remainingHours))})
                </span>
              </span>
            </div>
          ) : (
            <p className="text-slate-500">
              VK liegt unter den Kosten ({eurAuto(cost)}) – jede Minute macht den Stundenlohn
              negativer.
            </p>
          )}
        </div>
      </Panel>

      {/* ---------- 3) Zielrechner ---------- */}
      <Panel
        icon={<Calculator className="w-4 h-4 text-orange-500 shrink-0" />}
        title="Zielrechner"
        summary={`→ ${eur(neededPriceRounded)}`}
        open={open.goal}
        onToggle={() => toggle('goal')}
      >
        <p className="text-[11px] text-slate-500 mb-3">
          Geplante Stunden + Wunschlohn → nötiger Verkaufspreis.
        </p>

        <div className="flex gap-2 mb-3">
          <MiniField
            label="Geplant gesamt"
            value={plannedHoursRaw}
            onChange={setPlannedHoursRaw}
            placeholder={num(autoPlannedHours, 1)}
            suffix="h"
          />
          <MiniField
            label="Wunschlohn"
            value={targetWageRaw}
            onChange={setTargetWage}
            placeholder="20"
            suffix="€/h"
          />
        </div>

        <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-800 space-y-1.5">
          <div className="flex justify-between items-baseline gap-2">
            <span className="text-xs text-slate-400">Nötiger VK</span>
            <span className="text-lg font-bold text-orange-400 tabular-nums">
              {eur(neededPriceRounded)}
            </span>
          </div>
          <div className="flex justify-between gap-2 text-[11px]">
            <span className="text-slate-500">
              Kosten {eurAuto(cost)} + {num(plannedHours, 1)} h × {num(targetWage, 0)} €/h
            </span>
            <span className="text-slate-500 tabular-nums">{eur(neededPrice, 2)}</span>
          </div>
          <div className="flex justify-between gap-2 text-[11px] pt-1.5 border-t border-slate-800">
            <span className="text-slate-500">ggü. Basis-VK {eurAuto(anchor)}</span>
            <span
              className={`tabular-nums ${
                deltaToAnchor > 0 ? 'text-amber-400' : 'text-emerald-400'
              }`}
            >
              {deltaToAnchor >= 0 ? '+' : '−'}
              {eurAuto(Math.abs(deltaToAnchor))}
            </span>
          </div>
          <div className="flex justify-between gap-2 text-[11px]">
            <span className="text-slate-500">Basis-VK bei {num(plannedHours, 1)} h</span>
            <span className={`tabular-nums ${wageClass(wageAtPlanned)}`}>
              {wageAtPlanned === null ? '–' : wageStr(wageAtPlanned)}
            </span>
          </div>
        </div>

        {onApplyTargetPrice && (
          <button
            type="button"
            onClick={() => onApplyTargetPrice(neededPriceRounded)}
            className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 text-orange-400 text-xs font-medium transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            {eur(neededPriceRounded)} als Ziel-VK übernehmen
          </button>
        )}
      </Panel>
    </div>
  );
}
