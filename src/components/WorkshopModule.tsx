import React, { useState, useEffect, useRef } from 'react';
import { Bike, Expense, ChecklistItem, WorkLog, InventoryItem, Receipt, GroupOrder } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { formatTime, formatCurrency } from '../lib/utils';
import { Play, Pause, RotateCcw, Plus, Camera, CheckSquare, Wrench, Trash2, CheckCircle2, Circle, Undo2, Search, Eye, X, Clock, Package, Minus, Folders, Folder } from 'lucide-react';
import { increment, doc, updateDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { ReceiptUploader } from './ReceiptUploader';

interface WorkshopModuleProps {
  bikes: Bike[];
  inventoryItems: InventoryItem[];
  groupOrders?: GroupOrder[];
  receipts?: Receipt[];
  updateBike: (id: string, updates: Partial<Bike>) => void;
  syncBikeTime: (id: string, elapsedSeconds: number, newWorkLog: WorkLog) => void;
  activeBikeId: string | null;
  setActiveBikeId: (id: string | null) => void;
  addLog: (message: string, module: 'tracking' | 'workshop' | 'stopwatch' | 'system', revertAction?: any) => void;
  deleteInventoryItem: (id: string) => void;
  addGroupOrder?: (order: Omit<GroupOrder, 'id' | 'userId'>, items: Partial<InventoryItem>[]) => void;
  deleteGroupOrder?: (orderId: string) => void;
}

export function WorkshopModule({ bikes, inventoryItems, groupOrders = [], receipts = [], updateBike, syncBikeTime, activeBikeId, setActiveBikeId, addLog, deleteInventoryItem, addGroupOrder, deleteGroupOrder }: WorkshopModuleProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showInventory, setShowInventory] = useState(false);

  const activeProjects = bikes
    .filter((b) => {
       const isActiveStatus = b.status === 'Zu reparieren' || b.status === 'Infrastruktur' || b.status === 'Material';
       if (!isActiveStatus) return false;
       if (b.status === 'Infrastruktur') {
         return b.hiddenInWorkshop === false;
       }
       return b.hiddenInWorkshop !== true;
    })
    .sort((a, b) => {
      const dateA = a.purchaseDate || '';
      const dateB = b.purchaseDate || '';
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      return (b.lastModified || 0) - (a.lastModified || 0);
    });

  const filteredProjects = activeProjects.filter(bike => 
    bike.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  useEffect(() => {
    if (!activeBikeId && filteredProjects.length > 0) {
      setActiveBikeId(filteredProjects[0].id);
    }
  }, [filteredProjects, activeBikeId, setActiveBikeId]);

  const activeBike = bikes.find((b) => b.id === activeBikeId);

  // Stopwatch state
  const [isRunning, setIsRunning] = useState(false);
  const [time, setTime] = useState(0);
  const [manualTime, setManualTime] = useState('');
  const [lastResetTime, setLastResetTime] = useState<{ time: number, workLogs: WorkLog[] } | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Expense state
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');

  // Checklist state
  const [newChecklistItem, setNewChecklistItem] = useState('');

  // Notes state
  const [notes, setNotes] = useState(activeBike?.notes || '');

  // Photo preview state
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  // Monitor online status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Sync time when active bike changes or on mount
  useEffect(() => {
    const syncTimer = () => {
      if (activeBike) {
        let currentTime = activeBike.timeSpentSeconds || 0;
        let running = false;
        
        try {
          // Check local storage first for a more up-to-date "active" timer (in case of offline/background)
          const localTimerJson = localStorage.getItem('flipbike_active_timer');
          if (localTimerJson) {
            const localTimer = JSON.parse(localTimerJson);
            if (localTimer && localTimer.bikeId === activeBike.id) {
              const elapsedSeconds = Math.floor((Date.now() - localTimer.startTime) / 1000);
              currentTime = (localTimer.initialTime || 0) + elapsedSeconds;
              running = true;
            }
          } else if (activeBike.startTime) {
            // Fallback to DB startTime if no local timer exists
            const elapsedSeconds = Math.floor((Date.now() - activeBike.startTime) / 1000);
            currentTime += elapsedSeconds;
            running = true;
          }
        } catch (e) {
          console.error("Error syncing timer from localStorage:", e);
          localStorage.removeItem('flipbike_active_timer');
        }
        
        setTime(currentTime);
        setNotes(activeBike.notes || '');
        setIsRunning(running);
      }
    };

    syncTimer();

    // Handle visibility change (e.g. returning from background)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncTimer();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [activeBikeId, activeBike?.timeSpentSeconds, activeBike?.startTime]);

  // Timer logic (UI only)
  useEffect(() => {
    if (isRunning) {
      timerRef.current = window.setInterval(() => {
        // Recalculate from start time to avoid drift and background issues
        if (activeBike) {
          const localTimerJson = localStorage.getItem('flipbike_active_timer');
          if (localTimerJson) {
            const localTimer = JSON.parse(localTimerJson);
            const elapsedSeconds = Math.floor((Date.now() - localTimer.startTime) / 1000);
            setTime(localTimer.initialTime + elapsedSeconds);
          } else if (activeBike.startTime) {
            const elapsedSeconds = Math.floor((Date.now() - activeBike.startTime) / 1000);
            setTime(activeBike.timeSpentSeconds + elapsedSeconds);
          }
        }
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning, activeBikeId, activeBike?.startTime]);

  const toggleTimer = () => {
    if (!activeBike) return;
    
    if (isRunning) {
      // Stop timer
      setIsRunning(false);
      const now = Date.now();
      
      // Get the actual elapsed time from the start timestamp
      let elapsed = 0;
      let totalTime = time;
      
      const localTimerJson = localStorage.getItem('flipbike_active_timer');
      if (localTimerJson) {
        const localTimer = JSON.parse(localTimerJson);
        elapsed = Math.floor((now - localTimer.startTime) / 1000);
        totalTime = localTimer.initialTime + elapsed;
      } else if (activeBike.startTime) {
        elapsed = Math.floor((now - activeBike.startTime) / 1000);
        totalTime = activeBike.timeSpentSeconds + elapsed;
      }

      const newWorkLog: WorkLog = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        durationSeconds: elapsed
      };

      // Clear local timer immediately
      localStorage.removeItem('flipbike_active_timer');

      try {
        // Use atomic sync for time to avoid multi-device conflicts
        // This function handles both the Firestore update (atomic) and the local state update (optimistic)
        syncBikeTime(activeBike.id, elapsed, newWorkLog);
        
        const startStr = activeBike.startTime ? new Date(activeBike.startTime).toLocaleTimeString('de-DE') : 'unbekannt';
        addLog(`Stoppuhr gestoppt für "${activeBike.name}". Gestartet um ${startStr}. Dauer: ${formatTime(elapsed)}.`, 'stopwatch');
      } catch (error) {
        console.error("Failed to stop timer in DB:", error);
        // Persistence is enabled, so Firestore will handle the sync when online.
        // But we already updated the local state via updateBike (if it's optimistic).
      }
    } else {
      // Start timer
      setIsRunning(true);
      const now = Date.now();
      
      // Store in local storage for background/offline survival
      localStorage.setItem('flipbike_active_timer', JSON.stringify({
        bikeId: activeBike.id,
        startTime: now,
        initialTime: activeBike.timeSpentSeconds
      }));

      try {
        updateBike(activeBike.id, {
          startTime: now
        });
        addLog(`Stoppuhr gestartet für "${activeBike.name}" um ${new Date(now).toLocaleTimeString('de-DE')}.`, 'stopwatch');
      } catch (error) {
        console.error("Failed to start timer in DB:", error);
      }
    }
  };

  // Sync notes to DB on blur or change
  const handleNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNotes(e.target.value);
    if (activeBike) {
      updateBike(activeBike.id, { notes: e.target.value });
    }
  };

  const handleAddExpense = () => {
    if (!activeBike || !expenseDesc || !expenseAmount) return;
    const amount = parseFloat(expenseAmount.replace(',', '.'));
    if (isNaN(amount)) return;

    const newExpense: Expense = {
      id: Math.random().toString(36).substr(2, 9),
      description: expenseDesc,
      amount,
      date: new Date().toISOString(),
    };

    updateBike(activeBike.id, {
      expenses: [...activeBike.expenses, newExpense],
    });
    setExpenseDesc('');
    setExpenseAmount('');
  };

  const handleDeleteExpense = (expenseId: string) => {
    if (!activeBike) return;
    const expenseToDelete = activeBike.expenses.find(exp => exp.id === expenseId);
    if (!expenseToDelete) return;
    
    // If this expense came from inventory, we should increment the inventory quantity back
    if (expenseToDelete.sourceInventoryId) {
      try {
        const itemRef = doc(db, 'inventoryItems', expenseToDelete.sourceInventoryId);
        updateDoc(itemRef, { quantity: increment(1) });
        addLog(`Material '${expenseToDelete.description}' wurde vom Fahrrad '${activeBike.name}' entfernt und ins Lager zurückgelegt.`, 'workshop');
      } catch (err) {
        console.error("Failed to restore inventory quantity:", err);
      }
    }

    const updatedExpenses = activeBike.expenses.filter(exp => exp.id !== expenseId);
    updateBike(activeBike.id, { expenses: updatedExpenses });
  };

  const handleManualTimeAdjust = () => {
    if (!activeBike || !manualTime) return;
    const minutes = parseInt(manualTime, 10);
    if (isNaN(minutes)) return;
    
    setTime((currentTime) => {
      const newTime = Math.max(0, currentTime + minutes * 60);
      const diff = newTime - currentTime;
      
      let updatedWorkLogs = [...(activeBike.workLogs || [])];
      
      if (diff !== 0) {
        if (diff < 0) {
          // Reduce from the last workLog(s)
          let remainingDiff = Math.abs(diff);
          for (let i = updatedWorkLogs.length - 1; i >= 0; i--) {
            if (updatedWorkLogs[i].durationSeconds >= remainingDiff) {
              updatedWorkLogs[i] = { ...updatedWorkLogs[i], durationSeconds: updatedWorkLogs[i].durationSeconds - remainingDiff };
              remainingDiff = 0;
              break;
            } else {
              remainingDiff -= updatedWorkLogs[i].durationSeconds;
              updatedWorkLogs[i] = { ...updatedWorkLogs[i], durationSeconds: 0 };
            }
          }
          // Filter out 0 duration logs
          updatedWorkLogs = updatedWorkLogs.filter(log => log.durationSeconds > 0);
        } else {
          // Add a new workLog for the added time
          updatedWorkLogs.push({
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            durationSeconds: diff
          });
        }
      }

      updateBike(activeBike.id, { 
        timeSpentSeconds: increment(minutes * 60) as any,
        workLogs: updatedWorkLogs,
        ...(isRunning ? { startTime: Date.now() } : {})
      });
      return newTime;
    });
    setManualTime('');
  };

  const handleAddChecklistItem = () => {
    if (!activeBike || !newChecklistItem.trim()) return;
    const newItem: ChecklistItem = {
      id: Math.random().toString(36).substr(2, 9),
      text: newChecklistItem,
      completed: false,
    };
    updateBike(activeBike.id, {
      checklist: [...(activeBike.checklist || []), newItem],
    });
    setNewChecklistItem('');
  };

  const handleChecklistPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData('text');
    if (pastedText.includes('\n') || pastedText.includes('\\')) {
      e.preventDefault();
      
      const target = e.target as HTMLInputElement;
      const start = target.selectionStart || 0;
      const end = target.selectionEnd || 0;
      
      const textBefore = newChecklistItem.substring(0, start);
      const textAfter = newChecklistItem.substring(end);
      
      const fullText = textBefore + pastedText + textAfter;
      const lines = fullText.split(/[\n\\]/).map(line => line.trim()).filter(line => line !== '');
      
      if (lines.length > 0 && activeBike) {
        const newItems: ChecklistItem[] = lines.map(line => ({
          id: Math.random().toString(36).substr(2, 9),
          text: line,
          completed: false,
        }));
        
        updateBike(activeBike.id, {
          checklist: [...(activeBike.checklist || []), ...newItems],
        });
        
        setNewChecklistItem('');
      }
    }
  };

  const toggleChecklistItem = (itemId: string) => {
    if (!activeBike) return;
    const updatedChecklist = activeBike.checklist.map(item => 
      item.id === itemId ? { ...item, completed: !item.completed } : item
    );
    updateBike(activeBike.id, { checklist: updatedChecklist });
  };

  const deleteChecklistItem = (itemId: string) => {
    if (!activeBike) return;
    const updatedChecklist = activeBike.checklist.filter(item => item.id !== itemId);
    updateBike(activeBike.id, { checklist: updatedChecklist });
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeBike || !e.target.files || e.target.files.length === 0) return;
    
    const files = Array.from(e.target.files) as File[];
    const newPhotos: string[] = [];
    let processedCount = 0;

    files.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        newPhotos.push(base64String);
        processedCount++;

        if (processedCount === files.length) {
          updateBike(activeBike.id, {
            photos: [...(activeBike.photos || []), ...newPhotos]
          });
        }
      };
      reader.readAsDataURL(file);
    });
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDeletePhoto = (index: number) => {
    if (!activeBike) return;
    const updatedPhotos = [...(activeBike.photos || [])];
    updatedPhotos.splice(index, 1);
    updateBike(activeBike.id, { photos: updatedPhotos });
  };

  const [newItemData, setNewItemData] = useState<Partial<InventoryItem>>({
    name: '',
    category: 'part',
    pricePerUnit: 0,
    quantity: 1,
    purchaseDate: new Date().toISOString().split('T')[0]
  });
  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);

  const [isAddGroupOrderModalOpen, setIsAddGroupOrderModalOpen] = useState(false);
  const [groupOrderData, setGroupOrderData] = useState({ name: '', totalPrice: 0, date: new Date().toISOString().split('T')[0] });
  const [groupOrderItems, setGroupOrderItems] = useState<Partial<InventoryItem>[]>([]);
  const [newGroupOrderItem, setNewGroupOrderItem] = useState<Partial<InventoryItem>>({ name: '', category: 'part', pricePerUnit: 0, quantity: 1 });
  
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});

  // Materialkosten Search & Filter States
  const [materialSearch, setMaterialSearch] = useState('');
  const [materialCategory, setMaterialCategory] = useState<'all' | 'part' | 'consumable'>('all');

  const filteredMaterials = inventoryItems.filter(i => {
    if (i.quantity <= 0) return false;
    if (materialCategory !== 'all' && i.category !== materialCategory) return false;
    if (materialSearch && !i.name.toLowerCase().includes(materialSearch.toLowerCase())) return false;
    return true;
  });

  const handleAddGroupOrderSubmit = () => {
      if (!groupOrderData.name || !addGroupOrder) return;
      addGroupOrder(
          { name: groupOrderData.name, totalPrice: groupOrderData.totalPrice, date: groupOrderData.date },
          groupOrderItems
      );
      setIsAddGroupOrderModalOpen(false);
      setGroupOrderData({ name: '', totalPrice: 0, date: new Date().toISOString().split('T')[0] });
      setGroupOrderItems([]);
  };

  const handleAddItemSubmit = () => {
    if (!newItemData.name || !auth.currentUser) return;
    const newItem: InventoryItem = {
      id: Math.random().toString(36).substr(2, 9),
      name: newItemData.name,
      category: newItemData.category as 'part' | 'consumable' | 'machinery',
      pricePerUnit: newItemData.pricePerUnit || 0,
      quantity: newItemData.quantity || 0,
      initialQuantity: newItemData.quantity || 0,
      sourceId: 'manual', // or derived from something else
      purchaseDate: newItemData.purchaseDate || new Date().toISOString().split('T')[0],
      userId: auth.currentUser.uid
    };

    setDoc(doc(db, 'inventoryItems', newItem.id), newItem).catch((e) => {
      console.error("Failed to add inventory item to DB:", e);
    });

    addLog(`Material hinzugefügt: "${newItem.name}"`, 'workshop');
    setIsAddItemModalOpen(false);
    setNewItemData({
      name: '',
      category: 'part',
      pricePerUnit: 0,
      quantity: 1,
      purchaseDate: new Date().toISOString().split('T')[0]
    });
  };

  const handleDeleteItem = (itemId: string, itemName: string) => {
    try {
      deleteInventoryItem(itemId);
    } catch (err) {
      console.error("Fehler beim Löschen:", err);
    }
  };

  const handleUpdateItemQuantity = (itemId: string, incrementValue: number, currentItemName: string) => {
     const docRef = doc(db, 'inventoryItems', itemId);
     updateDoc(docRef, { quantity: increment(incrementValue) });
     addLog(`Materialbestand für "${currentItemName}" ${incrementValue > 0 ? 'erhöht' : 'reduziert'} um ${Math.abs(incrementValue)}`, 'workshop');
  };

  if (showInventory) {
    const parts = inventoryItems.filter(i => i.category === 'part');
    const consumables = inventoryItems.filter(i => i.category === 'consumable');

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex justify-between w-full md:w-auto items-center">
                   <div>
                       <h2 className="text-lg md:text-xl font-bold text-slate-100 flex items-center">
                        <Package className="w-5 h-5 md:w-6 md:h-6 mr-2 md:mr-3 text-orange-500 shrink-0" />
                        Materialinventar
                       </h2>
                       <p className="text-slate-400 text-xs mt-1">Verwalte Ersatzteile und Verbrauchsmaterialien.</p>
                   </div>
                   <Button variant="ghost" size="icon" onClick={() => setShowInventory(false)} className="md:hidden text-slate-400 hover:text-white">
                       <X className="w-5 h-5" />
                   </Button>
                </div>
                <div className="flex flex-wrap gap-2 w-full md:w-auto">
                    <Button size="sm" onClick={() => setIsAddGroupOrderModalOpen(true)} className="bg-blue-600 hover:bg-blue-500 text-white flex-1 md:flex-none">
                        <Folder className="w-4 h-4 mr-2" /> <span className="truncate">Gruppenbestellung</span>
                    </Button>
                    <Button size="sm" onClick={() => setIsAddItemModalOpen(true)} className="bg-orange-500 hover:bg-orange-600 text-white flex-1 md:flex-none">
                        <Plus className="w-4 h-4 mr-2" /> Material
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowInventory(false)} className="hidden md:flex">
                        <X className="w-4 h-4 mr-2" /> Schließen
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Einbauteile */}
                <Card>
                    <CardHeader className="pb-3 border-b border-slate-800">
                      <CardTitle className="text-base text-slate-300">Fahrradteile (Einbauteile)</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        {parts.length === 0 ? (
                           <p className="text-sm text-slate-500 p-4 text-center border-b border-slate-800/50">Keine Fahrradteile vorhanden.</p>
                        ) : (
                            parts.map(item => {
                                let hasReceipt = receipts?.find(r => r.referenceId === item.id);
                                let isDerivedReceipt = false;
                                let derivedReceiptLabel = '';
                                if (!hasReceipt && item.orderId) {
                                  hasReceipt = receipts?.find(r => r.referenceId === item.orderId);
                                  if (hasReceipt) {
                                    isDerivedReceipt = true;
                                    const gOrder = groupOrders.find(go => go.id === item.orderId);
                                    derivedReceiptLabel = gOrder ? '✓ ' + gOrder.name : 'Abgedeckt';
                                  }
                                }
                                return (
                                <div key={item.id} className={`flex flex-col sm:flex-row sm:justify-between items-start sm:items-center gap-3 sm:gap-0 p-4 border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors ${item.quantity === 0 ? 'opacity-50' : ''}`}>
                                    <div className="flex flex-col w-full sm:w-auto">
                                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                                            <span className={`font-medium leading-tight ${hasReceipt ? 'text-emerald-400' : 'text-slate-200'}`}>{item.name}</span>
                                            {item.quantity === 0 && (
                                              <span className="bg-amber-500/20 text-amber-400 text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 whitespace-nowrap uppercase tracking-wider font-bold">Nachbestellen</span>
                                            )}
                                            <div className="shrink-0">
                                              <ReceiptUploader 
                                                  bikeId=""
                                                  referenceId={item.id}
                                                  referenceType="material"
                                                  existingReceipt={hasReceipt}
                                                  readonly={isDerivedReceipt}
                                                  readonlyLabel={derivedReceiptLabel}
                                              />
                                            </div>
                                        </div>
                                        <div className="flex space-x-3 text-xs text-slate-500 mt-1">
                                            <span>{formatCurrency(item.pricePerUnit)} / Stück</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between w-full sm:w-auto sm:flex-col sm:items-end mt-1 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800/50">
                                      <div className="flex items-center space-x-2 bg-slate-900 rounded-md border border-slate-700">
                                          <button onClick={() => handleUpdateItemQuantity(item.id, -1, item.name)} disabled={item.quantity <= 0} className="p-2 sm:p-1.5 text-slate-400 hover:text-white disabled:opacity-30"><Minus className="w-4 h-4 sm:w-3 sm:h-3"/></button>
                                          <span className="w-8 sm:w-6 text-center text-sm font-medium text-slate-200">{item.quantity}</span>
                                          <button onClick={() => handleUpdateItemQuantity(item.id, 1, item.name)} className="p-2 sm:p-1.5 text-slate-400 hover:text-white"><Plus className="w-4 h-4 sm:w-3 sm:h-3"/></button>
                                      </div>
                                      <button onClick={() => handleDeleteItem(item.id, item.name)} className="text-sm sm:text-xs font-medium text-red-500/70 hover:text-red-400 sm:mt-2">Löschen</button>
                                    </div>
                                </div>
                            )})
                        )}
                    </CardContent>
                </Card>

                {/* Verbrauchsmaterial */}
                <Card>
                    <CardHeader className="pb-3 border-b border-slate-800">
                      <CardTitle className="text-base text-slate-300">Verbrauchsmaterial (Bremsenreiniger etc.)</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        {consumables.length === 0 ? (
                           <p className="text-sm text-slate-500 p-4 text-center border-b border-slate-800/50">Gähnende Leere.</p>
                        ) : (
                            consumables.map(item => {
                                let hasReceipt = receipts?.find(r => r.referenceId === item.id);
                                let isDerivedReceipt = false;
                                let derivedReceiptLabel = '';
                                if (!hasReceipt && item.orderId) {
                                  hasReceipt = receipts?.find(r => r.referenceId === item.orderId);
                                  if (hasReceipt) {
                                    isDerivedReceipt = true;
                                    const gOrder = groupOrders.find(go => go.id === item.orderId);
                                    derivedReceiptLabel = gOrder ? '✓ ' + gOrder.name : 'Abgedeckt';
                                  }
                                }
                                return (
                                <div key={item.id} className={`flex flex-col sm:flex-row sm:justify-between items-start sm:items-center gap-3 sm:gap-0 p-4 border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors ${item.quantity === 0 ? 'opacity-50' : ''}`}>
                                    <div className="flex flex-col w-full sm:w-auto">
                                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                                            <span className={`font-medium leading-tight ${hasReceipt ? 'text-emerald-400' : 'text-slate-200'}`}>{item.name}</span>
                                            {item.quantity === 0 && (
                                              <span className="bg-amber-500/20 text-amber-400 text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 whitespace-nowrap uppercase tracking-wider font-bold">Nachbestellen</span>
                                            )}
                                            <div className="shrink-0">
                                              <ReceiptUploader 
                                                  bikeId=""
                                                  referenceId={item.id}
                                                  referenceType="material"
                                                  existingReceipt={hasReceipt}
                                                  readonly={isDerivedReceipt}
                                                  readonlyLabel={derivedReceiptLabel}
                                              />
                                            </div>
                                        </div>
                                        <div className="flex space-x-3 text-xs text-slate-500 mt-1">
                                            <span>{formatCurrency(item.pricePerUnit)} Einkaufspreis</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between w-full sm:w-auto sm:flex-col sm:items-end mt-1 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800/50">
                                        <div className="flex items-center space-x-2 bg-slate-900 rounded-md border border-slate-700">
                                          <button onClick={() => handleUpdateItemQuantity(item.id, -1, item.name)} disabled={item.quantity <= 0} className="p-2 sm:p-1.5 text-slate-400 hover:text-white disabled:opacity-30"><Minus className="w-4 h-4 sm:w-3 sm:h-3"/></button>
                                          <span className="w-8 sm:w-6 text-center text-sm font-medium text-slate-200">{item.quantity}</span>
                                          <button onClick={() => handleUpdateItemQuantity(item.id, 1, item.name)} className="p-2 sm:p-1.5 text-slate-400 hover:text-white"><Plus className="w-4 h-4 sm:w-3 sm:h-3"/></button>
                                        </div>
                                        <button onClick={() => handleDeleteItem(item.id, item.name)} className="text-sm sm:text-xs font-medium text-red-500/70 hover:text-red-400 sm:mt-2">Löschen</button>
                                    </div>
                                </div>
                            )})
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Add Item Modal */}
            {isAddItemModalOpen && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
                  <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
                    <div className="flex items-center justify-between p-4 border-b border-slate-800">
                      <h2 className="text-lg font-bold text-slate-100 flex items-center">
                        Neu ins Inventar
                      </h2>
                      <button 
                        onClick={() => setIsAddItemModalOpen(false)}
                        className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="p-6 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Name (Teil / Material)</label>
                        <Input 
                          value={newItemData.name || ''}
                          onChange={(e) => setNewItemData({...newItemData, name: e.target.value})}
                          className="bg-slate-800 border-slate-700 text-slate-100"
                          placeholder="z.B. Shimano Kette HG-40"
                          autoFocus
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Kategorie</label>
                            <select 
                                className="w-full bg-slate-800 border-slate-700 text-slate-200 text-sm rounded-md focus:ring-orange-500 focus:border-orange-500 block p-2 h-[42px]"
                                value={newItemData.category || 'part'}
                                onChange={(e) => setNewItemData({...newItemData, category: e.target.value as any})}
                            >
                                <option value="part">Einbauteil</option>
                                <option value="consumable">Verbrauchsmaterial</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Stückzahl</label>
                            <Input 
                                type="number"
                                value={newItemData.quantity !== undefined ? newItemData.quantity : 1}
                                onChange={(e) => setNewItemData({...newItemData, quantity: parseInt(e.target.value) || 0})}
                                className="bg-slate-800 border-slate-700 text-slate-100"
                            />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Einkaufspreis / Einheit</label>
                            <Input 
                              type="number"
                              value={newItemData.pricePerUnit !== undefined ? newItemData.pricePerUnit : ''}
                              onChange={(e) => setNewItemData({...newItemData, pricePerUnit: parseFloat(e.target.value) || 0})}
                              className="bg-slate-800 border-slate-700 text-slate-100"
                              placeholder="€"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Kaufdatum</label>
                            <Input 
                              type="date"
                              value={newItemData.purchaseDate || ''}
                              onChange={(e) => setNewItemData({...newItemData, purchaseDate: e.target.value})}
                              className="bg-slate-800 border-slate-700 text-slate-100"
                            />
                          </div>
                      </div>
                      <div className="pt-4 flex space-x-3">
                        <Button 
                          variant="outline" 
                          className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
                          onClick={() => setIsAddItemModalOpen(false)}
                        >
                          Abbrechen
                        </Button>
                        <Button 
                          className="flex-1 bg-orange-600 hover:bg-orange-500 text-white"
                          onClick={handleAddItemSubmit}
                        >
                          Hinzufügen
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
            )}

            {/* Add Group Order Modal */}
            {isAddGroupOrderModalOpen && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
                  <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                    <div className="flex items-center justify-between p-4 border-b border-slate-800">
                      <h2 className="text-lg font-bold text-blue-400 flex items-center">
                        <Folder className="w-5 h-5 mr-2" />
                        Neue Gruppenbestellung
                      </h2>
                      <button 
                        onClick={() => setIsAddGroupOrderModalOpen(false)}
                        className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="p-6 overflow-y-auto space-y-6 flex-1">
                      {/* Order Details */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950/50 p-4 rounded-lg border border-slate-800">
                         <div className="md:col-span-2">
                           <label className="block text-sm font-medium text-slate-400 mb-1">Name der Bestellung (z.B. Bike24 Großbestellung)</label>
                           <Input 
                             value={groupOrderData.name}
                             onChange={(e) => setGroupOrderData({...groupOrderData, name: e.target.value})}
                             className="bg-slate-800 border-slate-700 text-slate-100"
                             placeholder="Bestellungsname"
                             autoFocus
                           />
                         </div>
                         <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Gesamtpreis (€)</label>
                            <Input 
                              type="number"
                              value={groupOrderData.totalPrice || ''}
                              onChange={(e) => setGroupOrderData({...groupOrderData, totalPrice: parseFloat(e.target.value) || 0})}
                              className="bg-slate-800 border-slate-700 text-slate-100 font-bold"
                              placeholder="0.00"
                            />
                         </div>
                         <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Kaufdatum</label>
                            <Input 
                              type="date"
                              value={groupOrderData.date}
                              onChange={(e) => setGroupOrderData({...groupOrderData, date: e.target.value})}
                              className="bg-slate-800 border-slate-700 text-slate-100"
                            />
                         </div>
                      </div>

                      {/* Items List */}
                      <div>
                          <h3 className="text-sm font-medium text-slate-300 mb-3 border-b border-slate-800 pb-2">Enthaltene Artikel ({groupOrderItems.length})</h3>
                          {groupOrderItems.length === 0 ? (
                              <p className="text-xs text-slate-500 italic mb-4">Noch keine Artikel hinzugefügt.</p>
                          ) : (
                              <div className="space-y-2 mb-4">
                                  {groupOrderItems.map((item, idx) => (
                                      <div key={idx} className="flex justify-between items-center text-sm bg-slate-800/50 p-2 rounded border border-slate-700/50">
                                          <div className="flex flex-col">
                                              <span className="text-slate-200">{item.name} <span className="text-slate-500 ml-1">({item.category === 'consumable' ? 'Verbrauch' : 'Einbau'})</span></span>
                                              <span className="text-xs text-slate-500">{item.quantity}x à {formatCurrency(item.pricePerUnit || 0)}</span>
                                          </div>
                                          <button onClick={() => setGroupOrderItems(groupOrderItems.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-300">
                                              <X className="w-4 h-4" />
                                          </button>
                                      </div>
                                  ))}
                              </div>
                          )}

                          {/* Add specific item form */}
                          <div className="bg-slate-800 p-3 rounded-lg border border-slate-700 shadow-inner">
                              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Artikel hinzufügen</h4>
                              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                                  <div className="sm:col-span-5">
                                      <label className="block text-[10px] text-slate-500 mb-1">Name</label>
                                      <Input 
                                          value={newGroupOrderItem.name || ''}
                                          onChange={(e) => setNewGroupOrderItem({...newGroupOrderItem, name: e.target.value})}
                                          className="bg-slate-900 border-slate-600 text-xs h-8"
                                          placeholder="Teil-Name"
                                      />
                                  </div>
                                  <div className="sm:col-span-3">
                                      <label className="block text-[10px] text-slate-500 mb-1">Kategorie</label>
                                      <select 
                                          className="w-full bg-slate-900 border-slate-600 text-slate-200 text-xs rounded-md block h-8 px-2"
                                          value={newGroupOrderItem.category || 'part'}
                                          onChange={(e) => setNewGroupOrderItem({...newGroupOrderItem, category: e.target.value as any})}
                                      >
                                          <option value="part">Einbauteil</option>
                                          <option value="consumable">Verbrauch</option>
                                      </select>
                                  </div>
                                  <div className="sm:col-span-2">
                                      <label className="block text-[10px] text-slate-500 mb-1">Stückzahl</label>
                                      <Input 
                                          type="number"
                                          value={newGroupOrderItem.quantity || ''}
                                          onChange={(e) => setNewGroupOrderItem({...newGroupOrderItem, quantity: parseInt(e.target.value) || 0})}
                                          className="bg-slate-900 border-slate-600 text-xs h-8"
                                      />
                                  </div>
                                  <div className="sm:col-span-2">
                                      <label className="block text-[10px] text-slate-500 mb-1">€ / Stk</label>
                                      <Input 
                                          type="number"
                                          value={newGroupOrderItem.pricePerUnit !== undefined ? newGroupOrderItem.pricePerUnit : ''}
                                          onChange={(e) => setNewGroupOrderItem({...newGroupOrderItem, pricePerUnit: parseFloat(e.target.value) || 0})}
                                          className="bg-slate-900 border-slate-600 text-xs h-8"
                                      />
                                  </div>
                                  <div className="sm:col-span-12 mt-2">
                                      <Button 
                                          size="sm"
                                          className="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 h-8 text-xs"
                                          onClick={() => {
                                              if (newGroupOrderItem.name) {
                                                  setGroupOrderItems([...groupOrderItems, newGroupOrderItem]);
                                                  setNewGroupOrderItem({ name: '', category: 'part', pricePerUnit: 0, quantity: 1 });
                                              }
                                          }}
                                          disabled={!newGroupOrderItem.name}
                                      >
                                          <Plus className="w-3 h-3 mr-1" /> Artikel zur Bestellung hinzufügen
                                      </Button>
                                  </div>
                              </div>
                          </div>
                      </div>
                    </div>
                    
                    {/* Modal Footer */}
                    <div className="p-4 border-t border-slate-800 bg-slate-900/80 flex space-x-3 mt-auto">
                        <Button 
                          variant="outline" 
                          className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
                          onClick={() => setIsAddGroupOrderModalOpen(false)}
                        >
                          Abbrechen
                        </Button>
                        <Button 
                          className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-lg shadow-blue-500/20"
                          onClick={handleAddGroupOrderSubmit}
                          disabled={!groupOrderData.name || groupOrderData.totalPrice <= 0 || groupOrderItems.length === 0}
                        >
                          Bestellung speichern
                        </Button>
                    </div>
                  </div>
                </div>
            )}
        </div>
    )
  }

  if (!activeBike) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400">
        <Wrench className="w-12 h-12 mb-4 opacity-50" />
        <p>Keine aktiven Projekte in der Werkstatt.</p>
        <Button variant="outline" className="mt-4" onClick={() => setShowInventory(true)}>
             <Package className="w-4 h-4 mr-2" /> Materialinventar
        </Button>
      </div>
    );
  }

  const totalExpenses = activeBike.expenses.reduce((sum, e) => sum + e.amount, 0);
  
  let targetProfit = null;
  if (activeBike.status === 'Infrastruktur' || activeBike.status === 'Material') {
    targetProfit = -(activeBike.purchasePrice + totalExpenses);
  } else if (activeBike.targetSellingPrice || activeBike.sellingPrice) {
    targetProfit = (activeBike.targetSellingPrice || activeBike.sellingPrice || 0) - activeBike.purchasePrice - totalExpenses;
  }

  const currentHourlyWage = time > 0 && targetProfit !== null
    ? targetProfit / (time / 3600)
    : null;

  // Bug #3: Inseriertes Rad ohne Zielpreis -> Live-Rechner deaktiviert
  const isMissingTargetPrice = activeBike.status === 'Inseriert' && !activeBike.targetSellingPrice && !activeBike.sellingPrice;

  // Bug #4: Zeit erfasst aber keine Ausgaben gebucht -> Stundenlohn evtl. zu optimistisch
  const showNoExpenseWarning =
    activeBike.expenses.length === 0 &&
    time > 3600 &&
    activeBike.status !== 'Infrastruktur' &&
    activeBike.status !== 'Material';

  return (
    <div className="space-y-6">
      {/* Search and Quick-Switch Bar */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              placeholder="Projekt suchen..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-slate-900/50 border-slate-800 focus:ring-orange-500/50"
            />
          </div>
          <Button variant="outline" className="ml-4" onClick={() => setShowInventory(true)}>
             <Package className="w-4 h-4 mr-2" /> <span className="hidden sm:inline">Inventar</span>
          </Button>
        </div>

        <div className="flex overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 hide-scrollbar space-x-2">
          {filteredProjects.map((bike) => (
            <button
              key={bike.id}
              onClick={() => setActiveBikeId(bike.id)}
              className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-all active:scale-95 ${
                activeBikeId === bike.id
                  ? 'bg-orange-500 text-white shadow-sm shadow-orange-900/30'
                  : 'bg-slate-800/60 text-slate-400 border border-slate-700/60 hover:bg-slate-700 hover:text-slate-200'
              }`}
            >
              {bike.name}
            </button>
          ))}
        </div>
      </div>

      {/* Bug #3: Hinweis bei fehlendem Zielpreis (Inseriert) */}
      {isMissingTargetPrice && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-orange-500/40 bg-orange-500/10 text-orange-300">
          <Clock className="w-5 h-5 mt-0.5 shrink-0 text-orange-400" />
          <p className="text-sm">
            <span className="font-bold">Zielpreis fehlt</span> — Live-Rechner deaktiviert bis zur Eingabe. Trage im Tracking-Tab einen „Ziel VK" ein.
          </p>
        </div>
      )}

      {/* Bug #4: Zeit erfasst, aber keine Ausgaben gebucht */}
      {showNoExpenseWarning && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-yellow-500/40 bg-yellow-500/10 text-yellow-300">
          <Wrench className="w-5 h-5 mt-0.5 shrink-0 text-yellow-400" />
          <p className="text-sm">
            Über 1 Stunde erfasst, aber keine Ausgaben gebucht — Stundenlohn möglicherweise zu optimistisch. Teile aus Lager buchen oder externe Ausgabe hinzufügen?
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Workspace Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Stopwatch Module */}
          <Card className="border-orange-500/20 bg-gradient-to-b from-slate-900 to-slate-900/50">
            <CardHeader className="pb-0 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-slate-400 flex items-center">
                <Clock className="w-4 h-4 mr-2" />
                Stoppuhr
              </CardTitle>
              <div className="flex items-center space-x-2">
                {!isOnline && (
                  <span className="flex items-center text-[10px] text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 bg-orange-400 rounded-full mr-1.5 animate-pulse" />
                    Offline Modus
                  </span>
                )}
                {isOnline && (
                  <span className="flex items-center text-[10px] text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full mr-1.5" />
                    Synchronisiert
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-8 flex flex-col items-center justify-center">
              <div className="text-6xl md:text-8xl font-mono font-bold text-slate-100 tracking-tighter mb-8 tabular-nums">
                {formatTime(time)}
              </div>
              <div className="flex items-center space-x-4 mb-8">
                <Button
                  size="icon"
                  variant="outline"
                  className="w-14 h-14 rounded-full border-slate-700 hover:bg-slate-800"
                  onClick={() => {
                    setTime((prev) => {
                      setLastResetTime({ time: prev, workLogs: activeBike.workLogs || [] });
                      updateBike(activeBike.id, { 
                        timeSpentSeconds: 0,
                        workLogs: [],
                        ...(isRunning ? { startTime: Date.now() } : {})
                      });
                      return 0;
                    });
                  }}
                  title="Zurücksetzen"
                >
                  <RotateCcw className="w-6 h-6 text-slate-400" />
                </Button>
                <Button
                  size="icon"
                  className={`w-20 h-20 rounded-full shadow-lg transition-transform active:scale-95 ${
                    isRunning ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'
                  }`}
                  onClick={toggleTimer}
                >
                  {isRunning ? (
                    <Pause className="w-8 h-8 text-white fill-current" />
                  ) : (
                    <Play className="w-8 h-8 text-white fill-current ml-1" />
                  )}
                </Button>
                {lastResetTime !== null ? (
                  <Button
                    size="icon"
                    variant="outline"
                    className="w-14 h-14 rounded-full border-orange-500/50 hover:bg-orange-500/10 text-orange-400"
                    onClick={() => {
                      setTime(lastResetTime.time);
                      updateBike(activeBike.id, { 
                        timeSpentSeconds: lastResetTime.time,
                        workLogs: lastResetTime.workLogs,
                        ...(isRunning ? { startTime: Date.now() } : {})
                      });
                      setLastResetTime(null);
                    }}
                    title="Rückgängig machen"
                  >
                    <Undo2 className="w-6 h-6" />
                  </Button>
                ) : (
                  <div className="w-14 h-14" />
                )}
              </div>
              
              <div className="flex items-center space-x-2 w-full max-w-xs">
                <Input
                  type="number"
                  placeholder="+/- Min"
                  value={manualTime}
                  onChange={(e) => setManualTime(e.target.value)}
                  className="text-center"
                />
                <Button variant="secondary" onClick={handleManualTimeAdjust}>
                  Korr.
                </Button>
              </div>

              {/* Work Logs List */}
              <div className="w-full mt-8 border-t border-slate-800 pt-6">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Arbeits-Protokoll</h4>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                  {isRunning && activeBike.startTime && (
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-orange-500/10 border border-orange-500/20">
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                        <span className="text-sm text-orange-400">
                          Stoppuhr um {new Date(activeBike.startTime).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} gestartet
                        </span>
                      </div>
                      <span className="text-xs text-orange-500/70 italic">nicht synchronisiert</span>
                    </div>
                  )}
                  {(!activeBike.workLogs || activeBike.workLogs.length === 0) && !isRunning ? (
                    <p className="text-sm text-slate-500 text-center py-2">Noch keine Zeiten erfasst</p>
                  ) : (
                    [...(activeBike.workLogs || [])].reverse().map(log => (
                      <div key={log.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors group">
                        <div className="flex flex-col">
                          <span className="text-sm text-slate-300">
                            {new Date(log.timestamp).toLocaleDateString('de-DE')} {new Date(log.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="flex items-center space-x-3">
                          <span className="text-sm font-mono text-slate-400">
                            {formatTime(log.durationSeconds)}
                          </span>
                          <button
                            onClick={() => {
                                const updatedWorkLogs = activeBike.workLogs!.filter(l => l.id !== log.id);
                                updateBike(activeBike.id, {
                                  workLogs: updatedWorkLogs,
                                  timeSpentSeconds: increment(-log.durationSeconds) as any
                                });
                                // Update local time state if not running
                                if (!isRunning) {
                                  setTime(Math.max(0, (activeBike.timeSpentSeconds || 0) - log.durationSeconds));
                                }
                            }}
                            className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Eintrag löschen"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Checklist */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center text-lg">
                <CheckSquare className="w-5 h-5 mr-2 text-orange-500" />
                Checkliste
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex space-x-2 mb-4">
                <Input
                  placeholder="Neuer Punkt..."
                  value={newChecklistItem}
                  onChange={(e) => setNewChecklistItem(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddChecklistItem()}
                  onPaste={handleChecklistPaste}
                  className="flex-1"
                />
                <Button size="icon" onClick={handleAddChecklistItem}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <div className="space-y-2">
                {activeBike.checklist?.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-2 rounded bg-slate-800/50 group">
                    <div className="flex items-center space-x-3 flex-1 cursor-pointer" onClick={() => toggleChecklistItem(item.id)}>
                      {item.completed ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      ) : (
                        <Circle className="w-5 h-5 text-slate-400" />
                      )}
                      <span className={`text-sm ${item.completed ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                        {item.text}
                      </span>
                    </div>
                    <button 
                      onClick={() => deleteChecklistItem(item.id)}
                      className="text-slate-500 hover:text-red-500 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* To-Do / Notes */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">
                Notizen
              </CardTitle>
            </CardHeader>
            <CardContent>
              <textarea
                className="w-full h-32 bg-slate-800 border border-slate-700 rounded-md p-3 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                placeholder="Zusätzliche Notizen..."
                value={notes}
                onChange={handleNotesChange}
              />
            </CardContent>
          </Card>
        </div>

        {/* Sidebar Column */}
        <div className="space-y-6">
          {/* Material Costs */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex justify-between items-center">
                <span>Materialkosten</span>
                <span className="text-orange-500 font-bold">
                  {formatCurrency(totalExpenses)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col space-y-4 mb-4">
                <div className="flex space-x-2">
                  <Input
                    placeholder="Teil Manuell..."
                    value={expenseDesc}
                    onChange={(e) => setExpenseDesc(e.target.value)}
                    className="flex-1 text-xs"
                  />
                  <Input
                    type="number"
                    placeholder="€"
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value)}
                    className="w-16 text-xs"
                  />
                  <Button size="icon" onClick={handleAddExpense} className="shrink-0 h-9 w-9">
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                
                <div className="border border-slate-700/50 rounded-lg p-3 bg-slate-800/20 flex flex-col h-64">
                   <div className="flex justify-between items-center mb-2">
                     <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Aus Lager hinzufügen</p>
                   </div>
                   
                   <div className="flex space-x-2 mb-2">
                     <Input
                       placeholder="Suchen..."
                       value={materialSearch}
                       onChange={(e) => setMaterialSearch(e.target.value)}
                       className="flex-1 text-xs h-8"
                     />
                     <select
                       className="bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded-md focus:ring-orange-500 focus:border-orange-500 p-1 h-8"
                       value={materialCategory}
                       onChange={(e) => setMaterialCategory(e.target.value as any)}
                     >
                       <option value="all">Alle</option>
                       <option value="part">Einbauteile</option>
                       <option value="consumable">Verbrauchsteile</option>
                     </select>
                   </div>

                   {filteredMaterials.length === 0 ? (
                       <p className="text-xs text-slate-500 italic mt-2">Keine passenden Teile im Lager.</p>
                   ) : (
                     <div className="space-y-1.5 overflow-y-auto pr-1 flex-1">
                        {filteredMaterials.map(item => (
                            <div key={item.id} className="flex justify-between items-center text-xs p-1.5 rounded hover:bg-slate-700/50 cursor-pointer" onClick={() => {
                                    // Bestands-Untergrenze prüfen: keine Buchung unter 0
                                    if (item.quantity - 1 < 0) {
                                      alert("Bestand reicht nicht aus. Erst Lager auffüllen oder manuell als externe Ausgabe erfassen.");
                                      return;
                                    }
                                    // 1. Add expense
                                    const newExpense: Expense = {
                                      id: Math.random().toString(36).substr(2, 9),
                                      description: item.name,
                                      amount: item.pricePerUnit,
                                      date: new Date().toISOString(),
                                      sourceInventoryId: item.id
                                    };
                                    updateBike(activeBike.id, {
                                      expenses: [...activeBike.expenses, newExpense],
                                    });
                                    // 2. Decrement inventory
                                    const itemRef = doc(db, 'inventoryItems', item.id);
                                    updateDoc(itemRef, { quantity: increment(-1) });
                                    addLog(`Material '${item.name}' verbaut in '${activeBike.name}'`, 'workshop');
                            }}>
                                <span className="truncate text-slate-300">
                                  <span className="text-[10px] text-slate-500 mr-2 uppercase tracking-wider">
                                    {item.category === 'part' ? 'Einbau' : 'Verbrauch'}
                                  </span>
                                  {item.name}
                                </span>
                                <div className="flex items-center space-x-2">
                                    <span className="text-slate-500">{item.quantity}x</span>
                                    <span className="font-bold text-emerald-500">{formatCurrency(item.pricePerUnit)}</span>
                                    <Plus className="w-3 h-3 text-slate-400" />
                                </div>
                            </div>
                        ))}
                     </div>
                   )}
                </div>
              </div>
              
              <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                {activeBike.expenses.map((exp) => {
                  let hasReceipt = receipts?.find(r => r.referenceId === exp.id);
                  let isDerivedReceipt = false;
                  let derivedReceiptLabel = '';
                  if (!hasReceipt && exp.sourceInventoryId) {
                    const invItem = inventoryItems.find(i => i.id === exp.sourceInventoryId);
                    if (invItem) {
                      hasReceipt = receipts?.find(r => r.referenceId === invItem.id);
                      if (hasReceipt) {
                         isDerivedReceipt = true;
                         derivedReceiptLabel = '✓ ' + invItem.name;
                      }
                      if (!hasReceipt && invItem.orderId) {
                        hasReceipt = receipts?.find(r => r.referenceId === invItem.orderId);
                        if (hasReceipt) {
                           isDerivedReceipt = true;
                           const gOrder = groupOrders.find(go => go.id === invItem.orderId);
                           derivedReceiptLabel = gOrder ? '✓ ' + gOrder.name : 'Abgedeckt';
                        }
                      }
                    }
                  }
                  return (
                  <div key={exp.id} className="flex flex-col p-2 rounded bg-slate-800/50 text-sm group">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center space-x-2 truncate">
                        <span className={`font-medium truncate ${hasReceipt ? 'text-emerald-400' : 'text-slate-200'}`}>{exp.description}</span>
                        <ReceiptUploader 
                            bikeId={activeBike.id}
                            referenceId={exp.id}
                            referenceType="expense"
                            existingReceipt={hasReceipt}
                            readonly={isDerivedReceipt}
                            readonlyLabel={derivedReceiptLabel}
                        />
                      </div>
                      <div className="flex items-center space-x-3 pl-2 shrink-0">
                        <span className="font-bold text-slate-100 whitespace-nowrap">{formatCurrency(exp.amount)}</span>
                        <button 
                          onClick={() => handleDeleteExpense(exp.id)}
                          className="text-slate-500 hover:text-red-500 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity p-1"
                          title="Löschen"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 flex items-center">
                      <Clock className="w-3 h-3 mr-1" />
                      {new Date(exp.date).toLocaleString('de-DE', { 
                        day: '2-digit', 
                        month: '2-digit', 
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                  </div>
                )})}
                {activeBike.expenses.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-2">Noch keine Ausgaben erfasst.</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Camera / Media */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center">
                <Camera className="w-5 h-5 mr-2 text-orange-500" />
                Fotos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <input 
                type="file" 
                accept="image/*" 
                className="hidden" 
                ref={fileInputRef}
                onChange={handlePhotoUpload}
                multiple
              />
              <div className="grid grid-cols-2 gap-2 mb-4">
                <Button 
                  variant="outline" 
                  className="border-dashed border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500 h-24 flex-col gap-2"
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.removeAttribute('capture');
                      fileInputRef.current.click();
                    }
                  }}
                >
                  <Plus className="w-6 h-6" />
                  <span className="text-xs">Upload</span>
                </Button>
                <Button 
                  variant="outline" 
                  className="border-dashed border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500 h-24 flex-col gap-2"
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.setAttribute('capture', 'environment');
                      fileInputRef.current.click();
                    }
                  }}
                >
                  <Camera className="w-6 h-6" />
                  <span className="text-xs">Kamera</span>
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {activeBike.photos.map((url, i) => (
                  <div key={i} className="group relative aspect-square rounded-md bg-slate-800 overflow-hidden border border-slate-700">
                    <img 
                      src={url} 
                      alt={`Bike photo ${i+1}`} 
                      className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity cursor-pointer" 
                      onClick={() => setSelectedPhoto(url)}
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button 
                        onClick={() => setSelectedPhoto(url)}
                        className="p-1.5 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDeletePhoto(i)}
                        className="p-1.5 bg-red-500/20 hover:bg-red-500/40 rounded-full text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Photo Preview Modal */}
          {selectedPhoto && (
            <div 
              className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4 md:p-8"
              onClick={() => setSelectedPhoto(null)}
            >
              <button 
                className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors z-[110]"
                onClick={() => setSelectedPhoto(null)}
              >
                <X className="w-6 h-6" />
              </button>
              <img 
                src={selectedPhoto} 
                alt="Vorschau" 
                className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          {/* Quick Stats (Small Footer) */}
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-800 text-sm space-y-2">
            <div className="flex justify-between text-slate-400">
              <span>Ankaufspreis:</span>
              <span className="text-slate-200">{formatCurrency(activeBike.purchasePrice)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Bisherige Stunden:</span>
              <span className="text-slate-200">{(time / 3600).toFixed(1)}h</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Angepeilter VK:</span>
              <span className="text-slate-200">{activeBike.targetSellingPrice ? formatCurrency(activeBike.targetSellingPrice) : '-'}</span>
            </div>
            <div className="pt-2 mt-2 border-t border-slate-700 flex justify-between font-medium">
              <span className="text-slate-300">Aktueller Stundenlohn:</span>
              <span className={currentHourlyWage !== null ? (currentHourlyWage >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-400'}>
                {currentHourlyWage !== null ? `${formatCurrency(currentHourlyWage)}/h` : '-'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
