// Baut den "ai_report" – die Ausgabedatei für die KI-Auswertung.
//
// Bewusst als eigenes Modul und als REINE Funktion, weil es zwei Aufrufer gibt:
//   1. der Menüpunkt in App.tsx (Download im Browser)
//   2. der nächtliche Job scripts/ai-report-dump.mts (liest Firestore direkt)
// Läge die Logik weiter in App.tsx, würde der Job mit der Zeit ein anderes
// Format liefern als der Knopf – und die legend unten wäre nur noch auf einer
// Seite korrekt.
//
// Konventionen (siehe legend im Report):
// - Keys sind absichtlich minifiziert; die legend dokumentiert jeden einzelnen.
//   BEI NEUEN FELDERN IMMER DIE LEGEND MITPFLEGEN.
// - Ausgabe wird ohne Pretty-Print geschrieben (token-effizient).

import type { Bike, InventoryItem, GroupOrder, ServiceRequest, DailyTodo, Log } from '../types';

export const AI_REPORT_VERSION = '1.2';

export interface AiReportInput {
  bikes: Bike[];
  inventoryItems: InventoryItem[];
  groupOrders: GroupOrder[];
  serviceRequests: ServiceRequest[];
  dailyTodos: DailyTodo[];
  logs: Log[];
  /** Flyer-Gebiete. Im Browser aus localStorage, im Job aus der Collection flyerAreas. */
  flyerAreas?: any[];
  /** Ausgeschlossene Häuser. Im Browser aus localStorage, im Job aus flyerHouses. */
  flyerExcluded?: any[];
  flyerHistory?: any[];
  /** Erzeugungszeitpunkt. Nur setzen, wenn ein fester Wert gebraucht wird (Tests, Job). */
  generatedAt?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildAiReport(input: AiReportInput) {
  const bikes = input.bikes || [];
  const inventoryItems = input.inventoryItems || [];
  const groupOrders = input.groupOrders || [];
  const serviceRequests = input.serviceRequests || [];
  const dailyTodos = input.dailyTodos || [];
  const logs = input.logs || [];
  const flyerAreas: any[] = Array.isArray(input.flyerAreas) ? input.flyerAreas : [];
  const flyerExc: any[] = Array.isArray(input.flyerExcluded) ? input.flyerExcluded : [];
  const flyerHist: any[] = Array.isArray(input.flyerHistory) ? input.flyerHistory : [];

  const activeBikes = bikes.filter(b => b.status !== 'Verkauft' && b.status !== 'Infrastruktur');
  const soldBikes = bikes.filter(b => b.status === 'Verkauft');
  const infraBikes = bikes.filter(b => b.status === 'Infrastruktur');

  const totalInventoryCost = inventoryItems
    .filter(item => !item.orderId)
    .reduce((acc, item) => acc + (item.pricePerUnit * (item.initialQuantity || item.quantity)), 0);
  const totalGroupOrderCost = groupOrders.reduce((acc, order) => acc + order.totalPrice, 0);
  const totalRevenue = soldBikes.reduce((acc, bike) => acc + (bike.sellingPrice || 0), 0);

  const profit = bikes.reduce((acc, bike) => {
    const expenses = (bike.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
    let flow = -bike.purchasePrice - expenses;
    if (bike.status === 'Verkauft') flow += (bike.sellingPrice || 0);
    return acc + flow;
  }, 0) - totalInventoryCost - totalGroupOrderCost;

  const soldBikesProfit = soldBikes.reduce((acc, bike) => {
    const expenses = (bike.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
    return acc + ((bike.sellingPrice || 0) - bike.purchasePrice - expenses);
  }, 0);

  const infTime = infraBikes.reduce((acc, bike) => acc + bike.timeSpentSeconds, 0);
  const timeSold = soldBikes.reduce((acc, bike) => acc + bike.timeSpentSeconds, 0) + infTime;
  const hourlyWage = timeSold > 0 ? soldBikesProfit / (timeSold / 3600) : 0;
  const totalTimeh = bikes.reduce((acc, bike) => acc + bike.timeSpentSeconds, 0) / 3600;

  const tiedCap = activeBikes.reduce((acc, b) => acc + b.purchasePrice + (b.expenses || []).reduce((s, e) => s + e.amount, 0), 0);
  const infCap = infraBikes.reduce((acc, b) => acc + b.purchasePrice + (b.expenses || []).reduce((s, e) => s + e.amount, 0), 0);

  const lagerwert = inventoryItems.reduce((acc, item) => acc + (item.quantity * item.pricePerUnit), 0);
  const standzeitBikes = bikes.filter(b => b.listedAt && b.soldAt);
  const avgStandzeit = standzeitBikes.length > 0
    ? standzeitBikes.reduce((acc, b) => acc + ((new Date(b.soldAt as string).getTime() - new Date(b.listedAt as string).getTime()) / 86400000), 0) / standzeitBikes.length
    : null;

  // Geschäfts-Stundenlohn (alle Kosten / gesamte Zeit inkl. Flyer-Verteilzeit)
  const flyerDurationH = flyerAreas.reduce((s: number, a: any) => s + (Number(a.durationMinutes) || 0) / 60, 0);
  const geschTimeH = totalTimeh + flyerDurationH;
  const geschHw = geschTimeH > 0 ? profit / geschTimeH : 0;

  return {
    _cfg: {
      v: AI_REPORT_VERSION,
      pt: input.generatedAt || new Date().toISOString(),
      desc: 'Full dataset dump for AI. Keys are minified.',
    },
    legend: {
      b: {
        st: 'status (Verkauft=sold, Zu reparieren=todo, Inseriert=listed)',
        bp: 'buyPrice',
        sp: 'sellPrice (realisierter Verkaufspreis, 0 wenn noch nicht verkauft)',
        tp: 'targetSellPrice (Ziel-VK / angepeilter Verkaufspreis, null wenn nicht gesetzt)',
        exp: 'expenses array (materials used from inventory or external: a=amount, d=desc, id=invId, dt=date, cat=category z.B. kleinanzeigen)',
        tz: 'timeSpentSeconds',
        wl: 'workLogs (einzelne Arbeitszeiten): dt=timestamp, s=durationSeconds, n=note (frei beschriftbare Notiz zur Zeit)',
        rcv: 'receivedAt (Eingang)', lst: 'listedAt (inseriert am)', sld: 'soldAt (verkauft am)',
        acq: 'acquisitionSource: flyer=Flyer-Akquise, kleinanzeigen=Kleinanzeigen, null=unbekannt',
      },
      inv: { iq: 'initialQuantity', q: 'currentQuantity', c: 'pricePerUnit', oId: 'Group order id' },
      go: { c: 'totalCost', n: 'name', dt: 'date' },
      svcReq: { iss: 'issue', drop: 'dropoff', st: 'status' },
      logs: "Aktivitäts-/Zeitprotokoll (ts=timestamp ms, m=message inkl. 'Flyer verteilen'-Einträgen & Notizen, mod=module)",
      flyerHistory: { ts: 'log timestamp ISO', act: 'add|edit|delete', fc: 'flyerCount', dt: 'distributedDate', st: 'status (geplant/erledigt)' },
    },
    stats: {
      rev: round2(totalRevenue),
      prof: round2(profit),
      hw: round2(hourlyWage),
      geschHw: round2(geschHw),
      tt: round2(totalTimeh),
      capActiv: round2(tiedCap),
      capInf: round2(infCap),
      lagerwert: round2(lagerwert),
      avgStandzeit: avgStandzeit !== null ? Math.round(avgStandzeit * 10) / 10 : null,
      counts: { sold: soldBikes.length, active: activeBikes.length, all: bikes.length },
      kleinanzeigen: (() => {
        const kaExp = bikes.flatMap(b => (b.expenses || []).filter(e => e.category === 'kleinanzeigen'));
        return { ads: kaExp.length, cost: round2(kaExp.reduce((s, e) => s + e.amount, 0)) };
      })(),
    },
    bikes: bikes.map(b => ({
      id: b.id, name: b.name, st: b.status,
      bp: b.purchasePrice, sp: b.sellingPrice || 0,
      tp: b.targetSellingPrice ?? null,
      exp: (b.expenses || []).map(e => ({ a: e.amount, d: e.description, dt: e.date, id: e.sourceInventoryId, cat: e.category })),
      tz: b.timeSpentSeconds,
      wl: (b.workLogs || []).map(w => ({ dt: w.timestamp, s: w.durationSeconds, n: w.note && w.note.trim() ? w.note : undefined })),
      rcv: b.receivedAt || null,
      lst: b.listedAt || null,
      sld: b.soldAt || null,
      acq: b.acquisitionSource || null,
      notes: b.notes,
      todos: (b.checklist || []).filter(c => !c.completed).map(c => c.text),
    })),
    inv: inventoryItems.map(i => ({
      id: i.id, cat: i.category, name: i.name,
      iq: i.initialQuantity || i.quantity, q: i.quantity,
      c: i.pricePerUnit, oId: i.orderId,
    })),
    gOrders: groupOrders.map(o => ({
      id: o.id, name: o.name, dt: o.date, c: o.totalPrice,
    })),
    svcReq: serviceRequests.map(s => ({
      name: s.name, iss: s.issue, drop: s.dropoffTime, st: s.status, dt: s.id,
    })),
    sysTodos: dailyTodos.map(d => ({
      t: d.text, c: d.completed,
    })),
    logs: logs.map(l => ({ ts: l.timestamp, m: l.message, mod: l.module })),
    flyer: {
      areas: flyerAreas.length,
      distd: flyerAreas.reduce((sum: number, a: any) => sum + (a.flyerCount || 0), 0),
      durationMin: Math.round(flyerDurationH * 60), // Gesamte Flyer-Verteilzeit in Minuten (fließt in geschHw)
      excHouses: flyerExc.length,
      byStatus: {
        erledigt: flyerAreas.filter((a: any) => a.status === 'erledigt' || !a.status).length,
        geplant: flyerAreas.filter((a: any) => a.status === 'geplant').length,
      },
      bikesFromFlyer: bikes.filter(b => b.acquisitionSource === 'flyer').length,
      bikesFromKleinanzeigen: bikes.filter(b => b.acquisitionSource === 'kleinanzeigen').length,
      areaDetails: flyerAreas.map((a: any) => ({
        name: a.name || '',
        flyerCount: a.flyerCount || 0,
        date: a.distributedDate || null,
        status: a.status || 'erledigt',
        durationMin: a.durationMinutes || 0,
        note: a.note || '',
      })),
      history: flyerHist.map((h: any) => ({
        ts: h.ts, act: h.action, name: h.name, fc: h.flyerCount, dt: h.date || null, st: h.status || null,
      })),
    },
  };
}

/** Dateiname des Exports – gleich im Browser wie im Job. */
export function aiReportFileName(date = new Date()) {
  return `ai_report_v${AI_REPORT_VERSION}_${date.toISOString().split('T')[0]}.json`;
}
