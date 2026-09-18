import React, { useState } from 'react';
import { GroupOrder } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { formatCurrency } from '../lib/utils';
import { Folder, Plus, X, AlertTriangle, Lock } from 'lucide-react';
import { GroupOrderDraftItem, artikelSumme } from '../lib/groupOrders';

interface GroupOrderModalProps {
  // Gesetzt = bestehende Bestellung bearbeiten, sonst neu anlegen.
  order?: GroupOrder;
  initialItems?: GroupOrderDraftItem[];
  // Gibt Fehler zurück, wenn die Änderung mit dem Lager kollidiert – dann bleibt
  // der Dialog offen und zeigt sie an.
  onSave: (
    daten: { name: string; totalPrice: number; date: string },
    items: GroupOrderDraftItem[]
  ) => string[] | void;
  onClose: () => void;
}

const leererArtikel: GroupOrderDraftItem = {
  name: '', category: 'part', pricePerUnit: 0, quantity: 1, verbaut: 0,
};

export function GroupOrderModal({ order, initialItems = [], onSave, onClose }: GroupOrderModalProps) {
  const bearbeiten = !!order;
  const [daten, setDaten] = useState({
    name: order?.name ?? '',
    totalPrice: order?.totalPrice ?? 0,
    date: order?.date ?? new Date().toISOString().split('T')[0],
  });
  const [items, setItems] = useState<GroupOrderDraftItem[]>(initialItems);
  const [neuerArtikel, setNeuerArtikel] = useState<GroupOrderDraftItem>(leererArtikel);
  const [fehler, setFehler] = useState<string[]>([]);

  // Jede Änderung verwirft die Fehlerliste – sie gehört zum letzten Speicherversuch
  // und wäre danach nur noch irreführend.
  const patchDaten = (updates: Partial<typeof daten>) => {
    setFehler([]);
    setDaten({ ...daten, ...updates });
  };
  const setzeItems = (next: GroupOrderDraftItem[]) => {
    setFehler([]);
    setItems(next);
  };
  const aendereArtikel = (idx: number, updates: Partial<GroupOrderDraftItem>) =>
    setzeItems(items.map((it, i) => (i === idx ? { ...it, ...updates } : it)));

  const summe = artikelSumme(items);
  const differenz = daten.totalPrice - summe;

  const speichern = () => {
    const ergebnis = onSave(daten, items);
    if (Array.isArray(ergebnis) && ergebnis.length > 0) {
      setFehler(ergebnis);
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-lg font-bold text-blue-400 flex items-center">
            <Folder className="w-5 h-5 mr-2" />
            {bearbeiten ? 'Gruppenbestellung bearbeiten' : 'Neue Gruppenbestellung'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {fehler.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 space-y-1">
              <p className="text-sm font-medium text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> Nicht gespeichert
              </p>
              {fehler.map((f, i) => (
                <p key={i} className="text-xs text-red-300/90">{f}</p>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950/50 p-4 rounded-lg border border-slate-800">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-400 mb-1">Name der Bestellung (z.B. Bike24 Großbestellung)</label>
              <Input
                value={daten.name}
                onChange={(e) => patchDaten({ name: e.target.value })}
                className="bg-slate-800 border-slate-700 text-slate-100"
                placeholder="Bestellungsname"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Gesamtpreis (€)</label>
              <Input
                type="number"
                value={daten.totalPrice || ''}
                onChange={(e) => patchDaten({ totalPrice: parseFloat(e.target.value) || 0 })}
                className="bg-slate-800 border-slate-700 text-slate-100 font-bold"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Kaufdatum</label>
              <Input
                type="date"
                value={daten.date}
                onChange={(e) => patchDaten({ date: e.target.value })}
                className="bg-slate-800 border-slate-700 text-slate-100"
              />
            </div>
            {items.length > 0 && (
              <div className="md:col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="text-slate-500">Summe der Artikel: <span className="text-slate-300 font-medium">{formatCurrency(summe)}</span></span>
                {Math.abs(differenz) >= 0.01 && (
                  <>
                    <span className="text-amber-400">
                      {differenz > 0 ? `${formatCurrency(differenz)} nicht auf Artikel verteilt (z.B. Versand)` : `${formatCurrency(-differenz)} über dem Gesamtpreis`}
                    </span>
                    <button
                      onClick={() => patchDaten({ totalPrice: Math.round(summe * 100) / 100 })}
                      className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
                    >
                      Summe übernehmen
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-medium text-slate-300 mb-3 border-b border-slate-800 pb-2">
              Enthaltene Artikel ({items.length})
            </h3>
            {items.length === 0 ? (
              <p className="text-xs text-slate-500 italic mb-4">Noch keine Artikel hinzugefügt.</p>
            ) : (
              <div className="space-y-2 mb-4">
                {items.map((item, idx) => (
                  <div key={item.inventoryId ?? `neu-${idx}`} className="bg-slate-800/50 p-2 rounded border border-slate-700/50">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                      <div className="sm:col-span-5">
                        <Input
                          value={item.name}
                          onChange={(e) => aendereArtikel(idx, { name: e.target.value })}
                          className="bg-slate-900 border-slate-600 text-xs h-8"
                          placeholder="Teil-Name"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <select
                          className="w-full bg-slate-900 border-slate-600 text-slate-200 text-xs rounded-md block h-8 px-2"
                          value={item.category}
                          onChange={(e) => aendereArtikel(idx, { category: e.target.value as 'part' | 'consumable' })}
                        >
                          <option value="part">Einbauteil</option>
                          <option value="consumable">Verbrauch</option>
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <Input
                          type="number"
                          value={item.quantity || ''}
                          onChange={(e) => aendereArtikel(idx, { quantity: parseInt(e.target.value) || 0 })}
                          className={`bg-slate-900 border-slate-600 text-xs h-8 ${item.quantity < item.verbaut ? 'border-red-500' : ''}`}
                          title="Stückzahl"
                        />
                      </div>
                      <div className="sm:col-span-1">
                        <Input
                          type="number"
                          value={item.pricePerUnit !== undefined ? item.pricePerUnit : ''}
                          onChange={(e) => aendereArtikel(idx, { pricePerUnit: parseFloat(e.target.value) || 0 })}
                          className="bg-slate-900 border-slate-600 text-xs h-8"
                          title="€ / Stück"
                        />
                      </div>
                      <div className="sm:col-span-1 flex justify-end">
                        <button
                          onClick={() => item.verbaut === 0 && setzeItems(items.filter((_, i) => i !== idx))}
                          disabled={item.verbaut > 0}
                          className="text-red-400 hover:text-red-300 disabled:text-slate-600 disabled:cursor-not-allowed p-1"
                          title={item.verbaut > 0
                            ? `${item.verbaut}× verbaut – erst die Ausgabe am Rad löschen`
                            : 'Artikel entfernen'}
                        >
                          {item.verbaut > 0 ? <Lock className="w-4 h-4" /> : <X className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    {item.verbaut > 0 && (
                      <p className="text-[10px] text-slate-500 mt-1.5">
                        {item.verbaut}× schon an einem Rad verbaut · Mindeststückzahl {item.verbaut}
                        {item.pricePerUnit !== (initialItems.find(i => i.inventoryId === item.inventoryId)?.pricePerUnit ?? item.pricePerUnit) && (
                          <span className="text-amber-400"> · Preisänderung wird auf {item.verbaut} gebuchte Ausgabe{item.verbaut > 1 ? 'n' : ''} übertragen</span>
                        )}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="bg-slate-800 p-3 rounded-lg border border-slate-700 shadow-inner">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Artikel hinzufügen</h4>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                <div className="sm:col-span-5">
                  <label className="block text-[10px] text-slate-500 mb-1">Name</label>
                  <Input
                    value={neuerArtikel.name}
                    onChange={(e) => setNeuerArtikel({ ...neuerArtikel, name: e.target.value })}
                    className="bg-slate-900 border-slate-600 text-xs h-8"
                    placeholder="Teil-Name"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[10px] text-slate-500 mb-1">Kategorie</label>
                  <select
                    className="w-full bg-slate-900 border-slate-600 text-slate-200 text-xs rounded-md block h-8 px-2"
                    value={neuerArtikel.category}
                    onChange={(e) => setNeuerArtikel({ ...neuerArtikel, category: e.target.value as 'part' | 'consumable' })}
                  >
                    <option value="part">Einbauteil</option>
                    <option value="consumable">Verbrauch</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[10px] text-slate-500 mb-1">Stückzahl</label>
                  <Input
                    type="number"
                    value={neuerArtikel.quantity || ''}
                    onChange={(e) => setNeuerArtikel({ ...neuerArtikel, quantity: parseInt(e.target.value) || 0 })}
                    className="bg-slate-900 border-slate-600 text-xs h-8"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[10px] text-slate-500 mb-1">€ / Stk</label>
                  <Input
                    type="number"
                    value={neuerArtikel.pricePerUnit !== undefined ? neuerArtikel.pricePerUnit : ''}
                    onChange={(e) => setNeuerArtikel({ ...neuerArtikel, pricePerUnit: parseFloat(e.target.value) || 0 })}
                    className="bg-slate-900 border-slate-600 text-xs h-8"
                  />
                </div>
                <div className="sm:col-span-12 mt-2">
                  <Button
                    size="sm"
                    className="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 h-8 text-xs"
                    onClick={() => {
                      if (!neuerArtikel.name) return;
                      setzeItems([...items, neuerArtikel]);
                      setNeuerArtikel(leererArtikel);
                    }}
                    disabled={!neuerArtikel.name}
                  >
                    <Plus className="w-3 h-3 mr-1" /> Artikel zur Bestellung hinzufügen
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-900/80 flex space-x-3 mt-auto">
          <Button
            variant="outline"
            className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
            onClick={onClose}
          >
            Abbrechen
          </Button>
          <Button
            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-lg shadow-blue-500/20"
            onClick={speichern}
            disabled={!daten.name || daten.totalPrice <= 0 || items.length === 0}
          >
            {bearbeiten ? 'Änderungen speichern' : 'Bestellung speichern'}
          </Button>
        </div>
      </div>
    </div>
  );
}
