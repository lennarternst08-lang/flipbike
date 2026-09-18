import { Bike, Expense, InventoryItem } from '../types';

// Eine Gruppenbestellung besteht aus zwei Hälften, die zusammenpassen müssen:
// dem Bestell-Dokument (Name, Datum, Gesamtpreis) und den Lagerposten, die beim
// Anlegen daraus entstanden sind (verknüpft über orderId). Wer die Bestellung
// nachträglich korrigiert, ändert damit zwangsläufig auch das Lager – und wenn ein
// Posten schon an einem Rad verbaut ist, hängt auch dessen Materialausgabe daran.
// Dieses Modul rechnet aus, was eine Änderung konkret bedeutet, bevor irgendwas
// geschrieben wird. So bleibt App.tsx frei von der Fallunterscheidung.

export interface GroupOrderDraftItem {
  // Fehlt bei Artikeln, die beim Bearbeiten neu dazukommen.
  inventoryId?: string;
  name: string;
  category: 'part' | 'consumable';
  pricePerUnit: number;
  quantity: number;
  // Wie oft dieser Posten schon an einem Rad gebucht ist – nicht editierbar,
  // sondern die Untergrenze für die Stückzahl.
  verbaut: number;
}

export interface GroupOrderPlan {
  // Solange hier etwas drinsteht, wird nichts geschrieben.
  fehler: string[];
  anlegen: InventoryItem[];
  aendern: { id: string; updates: Partial<InventoryItem> }[];
  loeschen: string[];
  // Betroffene Räder mit ihrer kompletten neuen Ausgabenliste.
  ausgaben: { bikeId: string; expenses: Expense[] }[];
  ausgabenAnzahl: number;
}

const neueId = () => Math.random().toString(36).substr(2, 9);

// Zählt die echten Buchungen statt initialQuantity - quantity: nur die Buchungen
// brechen, wenn ein Posten schrumpft oder verschwindet.
export function verbautCount(inventoryId: string, bikes: Bike[]): number {
  return bikes.reduce(
    (n, b) => n + (b.expenses || []).filter(e => e.sourceInventoryId === inventoryId).length,
    0
  );
}

// Startzustand für den Bearbeiten-Dialog: die Lagerposten der Bestellung, jeweils
// mit der Stückzahl, die ursprünglich gekauft wurde (nicht der Restbestand).
export function buildDraftItems(
  orderId: string,
  inventoryItems: InventoryItem[],
  bikes: Bike[]
): GroupOrderDraftItem[] {
  return inventoryItems
    .filter(i => i.orderId === orderId)
    .map(i => ({
      inventoryId: i.id,
      name: i.name,
      category: i.category === 'consumable' ? 'consumable' : 'part',
      pricePerUnit: i.pricePerUnit,
      quantity: i.initialQuantity ?? i.quantity,
      verbaut: verbautCount(i.id, bikes),
    }));
}

export function planGroupOrderUpdate(
  order: { id: string; name: string; date: string },
  draft: GroupOrderDraftItem[],
  inventoryItems: InventoryItem[],
  bikes: Bike[],
  userId: string
): GroupOrderPlan {
  const plan: GroupOrderPlan = {
    fehler: [], anlegen: [], aendern: [], loeschen: [], ausgaben: [], ausgabenAnzahl: 0,
  };
  const vorhanden = inventoryItems.filter(i => i.orderId === order.id);

  // Ausgaben werden pro Rad gesammelt, damit ein Rad mit zwei geänderten Posten
  // nicht zweimal geschrieben wird und die zweite Änderung die erste überholt.
  const ausgabenProRad = new Map<string, Expense[]>();
  const merkeAusgabe = (bike: Bike, mapper: (e: Expense) => Expense) => {
    const bisher = ausgabenProRad.get(bike.id) ?? bike.expenses ?? [];
    ausgabenProRad.set(bike.id, bisher.map(mapper));
  };

  for (const item of draft) {
    const menge = Math.max(0, Math.round(item.quantity));

    if (!item.inventoryId) {
      if (!item.name.trim()) continue;
      plan.anlegen.push({
        id: neueId(),
        name: item.name.trim(),
        category: item.category,
        pricePerUnit: item.pricePerUnit,
        quantity: menge,
        initialQuantity: menge,
        sourceId: order.name,
        purchaseDate: order.date,
        orderId: order.id,
        userId,
      });
      continue;
    }

    const alt = vorhanden.find(i => i.id === item.inventoryId);
    if (!alt) continue;

    const verbaut = verbautCount(alt.id, bikes);
    if (menge < verbaut) {
      plan.fehler.push(
        `"${alt.name}": ${verbaut}× schon an einem Rad verbaut – die Stückzahl kann nicht unter ${verbaut} liegen.`
      );
      continue;
    }

    const updates: Partial<InventoryItem> = {
      name: item.name.trim() || alt.name,
      category: item.category,
      pricePerUnit: item.pricePerUnit,
      // Gekauft bleibt gekauft; im Lager liegt nur, was noch nicht verbaut ist.
      initialQuantity: menge,
      quantity: menge - verbaut,
      // Name und Datum der Bestellung sind in jedem Posten gespiegelt.
      sourceId: order.name,
      purchaseDate: order.date,
    };
    if ((Object.keys(updates) as (keyof InventoryItem)[]).some(k => alt[k] !== updates[k])) {
      plan.aendern.push({ id: alt.id, updates });
    }

    // Preis und Bezeichnung stecken auch in den bereits gebuchten Materialausgaben.
    // Ohne diese Korrektur rechnet das betroffene Rad mit dem alten Preis weiter.
    const nameNeu = updates.name!;
    if (verbaut > 0 && (alt.pricePerUnit !== item.pricePerUnit || alt.name !== nameNeu)) {
      for (const bike of bikes) {
        const treffer = (bike.expenses || []).filter(e => e.sourceInventoryId === alt.id);
        if (treffer.length === 0) continue;
        plan.ausgabenAnzahl += treffer.length;
        merkeAusgabe(bike, e =>
          e.sourceInventoryId === alt.id
            ? { ...e, description: nameNeu, amount: item.pricePerUnit }
            : e
        );
      }
    }
  }

  // Was im Dialog entfernt wurde, fliegt aus dem Lager – außer es hängt schon an einem Rad.
  const behalten = new Set(draft.map(d => d.inventoryId).filter(Boolean) as string[]);
  for (const alt of vorhanden) {
    if (behalten.has(alt.id)) continue;
    const verbaut = verbautCount(alt.id, bikes);
    if (verbaut > 0) {
      plan.fehler.push(
        `"${alt.name}" ist ${verbaut}× verbaut und kann nicht entfernt werden. Erst die Ausgabe am Rad löschen.`
      );
      continue;
    }
    plan.loeschen.push(alt.id);
  }

  plan.ausgaben = [...ausgabenProRad].map(([bikeId, expenses]) => ({ bikeId, expenses }));
  return plan;
}

// Summe der Artikelpreise. Weicht bewusst vom Gesamtpreis der Bestellung ab
// (Versand, Rabatte) – der Dialog zeigt die Differenz nur an.
export function artikelSumme(items: { pricePerUnit: number; quantity: number }[]): number {
  return items.reduce((s, i) => s + (i.pricePerUnit || 0) * (i.quantity || 0), 0);
}
