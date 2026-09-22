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
import { abholSekunden } from './konvolut';

export const AI_REPORT_VERSION = '1.5';

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

  // Flyer-Verteilkosten (Druck, Helfer). Die App bucht sie als Infrastruktur des
  // Verteilmonats und zieht sie vom Gesamtgewinn ab (TrackingModule, flyerCostByMonth).
  // Bis v1.4 fehlten sie hier komplett: capInf und prof waren um genau diesen Betrag
  // zu günstig. Gleiche Regel wie in der App: nur Kosten > 0 mit Verteildatum.
  const flyerCostAreas = flyerAreas.filter((a: any) => (Number(a.costEuro) || 0) > 0 && (a.distributedDate || '').slice(0, 7));
  const flyerCost = flyerCostAreas.reduce((s: number, a: any) => s + (Number(a.costEuro) || 0), 0);
  const flyerCostByMonth: Record<string, number> = {};
  for (const a of flyerCostAreas) {
    const monat = String(a.distributedDate).slice(0, 7);
    flyerCostByMonth[monat] = round2((flyerCostByMonth[monat] || 0) + (Number(a.costEuro) || 0));
  }
  const totalRevenue = soldBikes.reduce((acc, bike) => acc + (bike.sellingPrice || 0), 0);

  const profit = bikes.reduce((acc, bike) => {
    const expenses = (bike.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
    let flow = -bike.purchasePrice - expenses;
    if (bike.status === 'Verkauft') flow += (bike.sellingPrice || 0);
    return acc + flow;
  }, 0) - totalInventoryCost - totalGroupOrderCost - flyerCost;

  const soldBikesProfit = soldBikes.reduce((acc, bike) => {
    const expenses = (bike.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
    return acc + ((bike.sellingPrice || 0) - bike.purchasePrice - expenses);
  }, 0);

  const infTime = infraBikes.reduce((acc, bike) => acc + bike.timeSpentSeconds, 0);
  const timeSold = soldBikes.reduce((acc, bike) => acc + bike.timeSpentSeconds, 0) + infTime;
  const hourlyWage = timeSold > 0 ? soldBikesProfit / (timeSold / 3600) : 0;
  const totalTimeh = bikes.reduce((acc, bike) => acc + bike.timeSpentSeconds, 0) / 3600;

  const tiedCap = activeBikes.reduce((acc, b) => acc + b.purchasePrice + (b.expenses || []).reduce((s, e) => s + e.amount, 0), 0);
  const infBikesCap = infraBikes.reduce((acc, b) => acc + b.purchasePrice + (b.expenses || []).reduce((s, e) => s + e.amount, 0), 0);
  const infCap = infBikesCap + flyerCost;

  const lagerwert = inventoryItems.reduce((acc, item) => acc + (item.quantity * item.pricePerUnit), 0);
  const standzeitBikes = bikes.filter(b => b.listedAt && b.soldAt);
  const avgStandzeit = standzeitBikes.length > 0
    ? standzeitBikes.reduce((acc, b) => acc + ((new Date(b.soldAt as string).getTime() - new Date(b.listedAt as string).getTime()) / 86400000), 0) / standzeitBikes.length
    : null;

  // Geschäfts-Stundenlohn (alle Kosten / gesamte Zeit inkl. Flyer-Verteilzeit)
  const flyerDurationH = flyerAreas.reduce((s: number, a: any) => s + (Number(a.durationMinutes) || 0) / 60, 0);
  const geschTimeH = totalTimeh + flyerDurationH;
  const geschHw = geschTimeH > 0 ? profit / geschTimeH : 0;

  // Konvolut-Ankaeufe: die Info haengt gespiegelt an jedem Mitglied, hier wird
  // daraus wieder eine Gruppe. Die Kennzahlen entsprechen der Kopfzeile im
  // Tracking: prof ist die Kassenlage des ganzen Ankaufs (Einnahmen minus
  // kompletter Einkauf minus Material), nicht nur der Anteil verkaufter Raeder.
  const konvolute = (() => {
    const proId = new Map<string, Bike[]>();
    for (const b of bikes) {
      const id = b.konvolut?.id;
      if (!id) continue;
      const liste = proId.get(id);
      if (liste) liste.push(b); else proId.set(id, [b]);
    }
    return [...proId.entries()].map(([id, mitglieder]) => {
      const info = mitglieder[0].konvolut!;
      const mat = mitglieder.reduce((s, b) => s + (b.expenses || []).reduce((x, e) => x + e.amount, 0), 0);
      const bp = mitglieder.reduce((s, b) => s + b.purchasePrice, 0);
      const sp = mitglieder.reduce((s, b) => s + (b.status === 'Verkauft' ? (b.sellingPrice || 0) : 0), 0);
      const tz = mitglieder.reduce((s, b) => s + (b.timeSpentSeconds || 0), 0);
      const sold = mitglieder.filter(b => b.status === 'Verkauft').length;
      return {
        id,
        name: info.name,
        price: round2(info.totalPrice),
        pickupMin: info.pickupMinutes,
        pickupS: mitglieder.reduce((s, b) => s + abholSekunden(b, id), 0),
        n0: info.bikeCount,
        n: mitglieder.length,
        sold,
        bp: round2(bp),
        mat: round2(mat),
        sp: round2(sp),
        prof: round2(sp - bp - mat),
        tz,
        hw: sold === mitglieder.length && tz > 0 ? round2((sp - bp - mat) / (tz / 3600)) : null,
        dt: mitglieder.reduce((d, b) => (b.purchaseDate && b.purchaseDate < d ? b.purchaseDate : d), mitglieder[0].purchaseDate),
        notes: info.notes && info.notes.trim() ? info.notes : '',
        bikeIds: mitglieder.map(b => b.id),
      };
    });
  })();

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
        acq: 'acquisitionSource: flyer=Flyer-Akquise, kleinanzeigen=Kleinanzeigen, andere=sonstige Quelle (was genau steht in acqN), null=unbekannt',
        acqN: 'Freitext zur Quelle, nur bei acq=andere, z.B. "Flohmarkt"',
        kv: 'Konvolut-ID (siehe kv[]), null = einzeln angekauft',
        notes: 'Freitext zu DIESEM Rad (Konvolut-Notizen stehen getrennt in kv[].notes)',
        todos: 'offene Checklistenpunkte des Rades (erledigte sind nicht enthalten)',
      },
      inv: { iq: 'initialQuantity', q: 'currentQuantity', c: 'pricePerUnit', oId: 'Group order id' },
      kv: {
        _: 'Konvolut-Ankauf: mehrere Raeder zu EINEM Gesamtpreis und EINER Abholfahrt. Preis und Abholzeit sind gleichmaessig auf die Raeder verteilt, stecken also bereits in deren bp/tz. Nicht doppelt zaehlen. Das Konvolut ist nachtraeglich bearbeitbar (Preis, Abholdauer, Raederliste); eine Bearbeitung verteilt Preis und Abholzeit NEU - auch auf bereits verkaufte Raeder. Aeltere Reports desselben Konvoluts koennen deshalb andere bp/tz-Werte zeigen, das ist kein Datenfehler.',
        id: 'Konvolut-ID, referenziert von bikes[].kv',
        name: 'Anzeigename, z.B. "Konvolut #1"',
        price: 'Gesamtpreis, zuletzt beim Anlegen oder im Bearbeiten-Dialog erfasst. Weicht von bp ab, wenn danach ein einzelnes Rad geloescht oder dessen bp direkt geaendert wurde - dann gilt bp als tatsaechlich im Konvolut steckender Einkauf.',
        pickupMin: 'Erfasste Abholdauer des gesamten Ankaufs in Minuten (anteilig als workLog je Rad gebucht, steckt in tz). Was davon HEUTE noch gebucht ist, steht in pickupS.',
        pickupS: 'Tatsaechlich noch gebuchte Abholzeit in Sekunden (Summe der Abhol-workLogs aller Mitglieder). Kleiner als pickupMin*60 = ein Abhol-Eintrag wurde in der Werkstatt von Hand gekuerzt/geloescht oder ein Rad geloescht.',
        n0: 'Anzahl Raeder, auf die Preis und Abholzeit zuletzt verteilt wurden (beim Anlegen oder beim letzten Bearbeiten)',
        n: 'Anzahl heute vorhandener Mitglieder. Kleiner als n0 = ein Rad wurde ausserhalb des Konvolut-Dialogs geloescht, die Verteilung wurde dann NICHT neu gerechnet.',
        sold: 'davon verkauft',
        bp: 'Summe Einkauf', mat: 'Summe Materialausgaben', sp: 'Summe realisierter Verkaufserloese', tz: 'Summe timeSpentSeconds',
        prof: 'Kassenlage des Ankaufs = sp - bp - mat. Bewusst mit dem KOMPLETTEN Einkauf, auch wenn noch nicht alles verkauft ist (60 EUR gezahlt, 30 EUR zurueck => -30).',
        hw: 'Stundenlohn der Gruppe, nur gesetzt wenn alle Raeder verkauft sind (sonst null)',
        dt: 'fruehestes Ankaufsdatum der Gruppe',
        notes: 'Freitext zum gesamten Ankauf (Verkaeufer, Zustand der Sammlung, Absprachen) - NICHT die Notiz eines einzelnen Rades, die steht in bikes[].notes',
        bikeIds: 'IDs der Mitglieder in bikes[]',
      },
      go: { c: 'totalCost', n: 'name', dt: 'date' },
      svcReq: { iss: 'issue', drop: 'dropoff', st: 'status' },
      logs: "Aktivitäts-/Zeitprotokoll (ts=timestamp ms, m=message inkl. 'Flyer verteilen'-Einträgen & Notizen, mod=module)",
      flyerHistory: { ts: 'log timestamp ISO', act: 'add|edit|delete', fc: 'flyerCount', dt: 'distributedDate', st: 'status (geplant/erledigt)' },
      stats: {
        prof: 'Gesamtgewinn als Cashflow: alle Verkaeufe minus alle Einkaeufe, Materialausgaben, Lagerkaeufe ohne Bestellung, Gruppenbestellungen UND Flyer-Verteilkosten (seit v1.5; vorher fehlten die Flyer-Kosten)',
        capInf: 'Infrastruktur-Summe = Infrastruktur-Raeder (EK + Ausgaben) + Flyer-Verteilkosten; Aufteilung in infDetail',
        infDetail: 'bikes = Infrastruktur-Raeder (EK + Ausgaben), flyer = Flyer-Verteilkosten (Druck, Helfer)',
        flyerCost: 'Summe aller Flyer-Verteilkosten (Gebiete mit Kosten > 0 und Verteildatum)',
        flyerCostByMonth: 'Flyer-Verteilkosten je Verteilmonat (yyyy-MM) - so bucht die App sie in die Infrastruktur des Monats',
        geschHw: 'Geschaefts-Stundenlohn = prof / (gesamte Radzeit + Flyer-Verteilzeit)',
      },
      flyer: {
        'areaDetails[].costEuro': 'Verteilkosten dieses Gebiets (Druck, Helfer) - fliesst in stats.capInf und stats.prof',
        bikesFromAndere: 'Raeder mit acq=andere',
        andereQuellen: 'Raeder mit acq=andere nach Freitext gezaehlt, z.B. {Flohmarkt: 2}',
      },
    },
    stats: {
      rev: round2(totalRevenue),
      prof: round2(profit),
      hw: round2(hourlyWage),
      geschHw: round2(geschHw),
      tt: round2(totalTimeh),
      capActiv: round2(tiedCap),
      capInf: round2(infCap),
      infDetail: { bikes: round2(infBikesCap), flyer: round2(flyerCost) },
      flyerCost: round2(flyerCost),
      flyerCostByMonth,
      lagerwert: round2(lagerwert),
      avgStandzeit: avgStandzeit !== null ? Math.round(avgStandzeit * 10) / 10 : null,
      counts: { sold: soldBikes.length, active: activeBikes.length, all: bikes.length, konvolute: konvolute.length },
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
      acqN: b.acquisitionSource === 'andere' && b.acquisitionNote ? b.acquisitionNote : undefined,
      kv: b.konvolut?.id || null,
      notes: b.notes,
      todos: (b.checklist || []).filter(c => !c.completed).map(c => c.text),
    })),
    kv: konvolute,
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
      bikesFromAndere: bikes.filter(b => b.acquisitionSource === 'andere').length,
      // Aufschluesselung der sonstigen Quellen nach Freitext, z.B. { Flohmarkt: 2 }
      andereQuellen: bikes
        .filter(b => b.acquisitionSource === 'andere')
        .reduce((m: Record<string, number>, b) => {
          const k = (b.acquisitionNote || '').trim() || 'ohne Angabe';
          m[k] = (m[k] || 0) + 1;
          return m;
        }, {}),
      areaDetails: flyerAreas.map((a: any) => ({
        name: a.name || '',
        flyerCount: a.flyerCount || 0,
        date: a.distributedDate || null,
        status: a.status || 'erledigt',
        durationMin: a.durationMinutes || 0,
        costEuro: round2(Number(a.costEuro) || 0), // fliesst in stats.capInf / stats.prof
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
