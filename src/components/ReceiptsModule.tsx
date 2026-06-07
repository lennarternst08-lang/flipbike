import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Receipt, Bike, GroupOrder, InventoryItem } from '../types';
import { FileCheck, Search, Filter, Star, ChevronDown, ChevronRight, Package, PenTool, Archive } from 'lucide-react';
import { ReceiptUploader } from './ReceiptUploader';

interface ReceiptsModuleProps {
  receipts: Receipt[];
  bikes: Bike[];
  groupOrders: GroupOrder[];
  inventoryItems: InventoryItem[];
}

export function ReceiptsModule({ receipts, bikes, groupOrders, inventoryItems }: ReceiptsModuleProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<'all' | 'bike' | 'order' | 'material' | 'infrastructure'>('all');
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});

  const toggleOrder = (id: string) => {
    setExpandedOrders(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Group everything into a unified list
  const allItems = useMemo(() => {
    const items: any[] = [];
    
    // 1. Group Orders
    groupOrders.forEach(order => {
      items.push({
        type: 'order',
        id: order.id,
        name: `Gruppenbestellung: ${order.name}`,
        date: order.date,
        price: order.totalPrice,
        data: order
      });
    });

    // 2. Bikes
    bikes.forEach(bike => {
      let type: 'bike' | 'infrastructure' | 'material' = 'bike';
      if (bike.status === 'Infrastruktur') type = 'infrastructure';
      if (bike.status === 'Material') type = 'material';
      
      items.push({
        type,
        id: bike.id,
        name: bike.name,
        date: bike.purchaseDate || '',
        price: bike.purchasePrice,
        data: bike
      });
    });

    inventoryItems.filter(i => !i.orderId).forEach(item => {
      items.push({
        type: 'material',
        id: item.id,
        name: item.name,
        date: item.purchaseDate || '',
        price: item.pricePerUnit * (item.initialQuantity !== undefined ? item.initialQuantity : item.quantity),
        data: item
      });
    });

    return items;
  }, [bikes, groupOrders, inventoryItems]);

  const filteredItems = useMemo(() => {
    return allItems.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = filterCategory === 'all' || item.type === filterCategory;
      return matchesSearch && matchesCategory;
    });
  }, [allItems, searchQuery, filterCategory]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row gap-4 justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-5 h-5" />
          <Input
            placeholder="Suchen..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="relative w-full md:w-64">
           <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4 pointer-events-none" />
           <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4 pointer-events-none" />
           <select
             className="w-full h-10 pl-9 pr-9 bg-slate-800/60 border border-slate-700/80 text-slate-300 text-sm rounded-lg transition-colors hover:border-slate-600 focus:outline-none focus:border-orange-500/60 focus:ring-2 focus:ring-orange-500/30 appearance-none"
             value={filterCategory}
             onChange={(e) => setFilterCategory(e.target.value as any)}
           >
             <option value="all">Alle Kategorien</option>
             <option value="bike">Fahrräder</option>
             <option value="order">Gruppenbestellungen</option>
             <option value="material">Materialinventar</option>
             <option value="infrastructure">Infrastruktur</option>
           </select>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center text-xl text-slate-100">
            <FileCheck className="w-5 h-5 mr-3 text-orange-400" />
            Übersicht aller Belege
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {filteredItems.map(item => {
              let hasReceipt = receipts.some(r => r.referenceId === item.id);
              let isDerivedReceipt = false;
              let derivedReceiptLabel = '';

              if (!hasReceipt && item.type === 'material') {
                const invItem = inventoryItems.find(i => i.id === item.id);
                if (invItem && invItem.orderId) {
                  const oReceipt = receipts.find(r => r.referenceId === invItem.orderId);
                  if (oReceipt) {
                    hasReceipt = true;
                    isDerivedReceipt = true;
                    const gOrder = groupOrders.find(go => go.id === invItem.orderId);
                    derivedReceiptLabel = gOrder ? '✓ ' + gOrder.name : 'Abgedeckt';
                  }
                }
              }
              
              const isOrder = item.type === 'order';
              let orderItems: InventoryItem[] = [];
              if (isOrder) {
                orderItems = inventoryItems.filter(i => i.orderId === item.id);
              }

              return (
                <div key={item.id} className="border border-slate-800/70 rounded-xl overflow-hidden bg-slate-800/20 transition-colors hover:border-slate-700">
                  <div
                    className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 ${isOrder ? 'cursor-pointer hover:bg-slate-800/40' : ''}`}
                    onClick={() => isOrder && toggleOrder(item.id)}
                  >
                    <div className="flex items-center space-x-3 md:space-x-4 min-w-0 w-full sm:w-auto">
                      {isOrder ? (
                        <Package className={`w-5 h-5 shrink-0 ${hasReceipt ? 'text-emerald-500' : 'text-slate-500'}`} />
                      ) : item.type === 'infrastructure' ? (
                        <Archive className={`w-5 h-5 shrink-0 ${hasReceipt ? 'text-emerald-500' : 'text-slate-500'}`} />
                      ) : item.type === 'material' ? (
                        <PenTool className={`w-5 h-5 shrink-0 ${hasReceipt ? 'text-emerald-500' : 'text-slate-500'}`} />
                      ) : (
                        <Star className={`w-5 h-5 shrink-0 ${hasReceipt ? 'text-emerald-500' : 'text-slate-500'}`} />
                      )}

                      <div className="flex flex-col min-w-0">
                        <span className={`font-medium text-base md:text-lg truncate ${hasReceipt ? 'text-emerald-400' : 'text-slate-200'}`}>
                          {item.name}
                        </span>
                        <span className="text-xs text-slate-500 truncate">
                          {item.type === 'bike' ? 'Fahrrad' :
                           item.type === 'order' ? 'Gruppenbestellung' :
                           item.type === 'infrastructure' ? 'Infrastruktur' : 'Material'} • {item.date}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 md:gap-6 shrink-0 w-full sm:w-auto justify-between sm:justify-end pl-8 sm:pl-0">
                      <span className="font-bold text-slate-300 whitespace-nowrap">
                         {item.price.toFixed(2)} €
                      </span>
                      
                      {/* We stop propagation here so clicking the uploader doesn't toggle the accordion */}
                      <div onClick={e => e.stopPropagation()}>
                        <ReceiptUploader
                          bikeId={item.type === 'bike' ? item.id : ''}
                          referenceId={item.id}
                          referenceType={
                            item.type === 'bike' ? 'bike_purchase' :
                            item.type === 'order' ? 'order' :
                            item.type === 'infrastructure' ? 'infrastructure' : 'material'
                          }
                          existingReceipt={receipts.find(r => r.referenceId === item.id)}
                          readonly={isDerivedReceipt}
                          readonlyLabel={derivedReceiptLabel}
                        />
                      </div>

                      {isOrder && (
                        <div className="text-slate-500 flex items-center justify-center w-6 h-6">
                           {expandedOrders[item.id] ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                        </div>
                      )}
                    </div>
                  </div>

                  {isOrder && expandedOrders[item.id] && (
                    <div className="p-4 bg-slate-900/50 border-t border-slate-800">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Enthaltene Artikel</h4>
                      <div className="space-y-2 pl-9">
                        {orderItems.map(oItem => (
                          <div key={oItem.id} className="flex justify-between items-center text-sm py-1 border-b border-slate-800/30 last:border-0">
                            <span className={`text-slate-300 ${hasReceipt ? 'line-through opacity-70' : ''}`}>{oItem.name}</span>
                            <div className="flex space-x-4">
                              <span className="text-slate-500">{oItem.initialQuantity !== undefined ? oItem.initialQuantity : oItem.quantity}x à {oItem.pricePerUnit.toFixed(2)} €</span>
                              <span className="text-slate-400 font-medium">{((oItem.initialQuantity !== undefined ? oItem.initialQuantity : oItem.quantity) * oItem.pricePerUnit).toFixed(2)} €</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            
            {filteredItems.length === 0 && (
              <div className="text-center py-12 text-slate-500">
                Keine Einträge gefunden.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
