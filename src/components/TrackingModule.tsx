import React, { useState, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import { Bike, BikeStatus, Receipt, InventoryItem, GroupOrder, WorkLog } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { formatCurrency, formatTime } from '../lib/utils';
import { TrendingUp, Clock, Wallet, Plus, Search, Filter, ArrowUpDown, ArrowUp, ArrowDown, MoreVertical, Trash2, Edit2, Star, ChevronDown, ChevronUp, X, Check, FileCheck, Eye, EyeOff, Play, Pause, RotateCcw, Megaphone, Monitor } from 'lucide-react';
import { ReceiptUploader } from './ReceiptUploader';
import { doc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { 
  format, subDays, subWeeks, subMonths, subYears, 
  isSameDay, isSameWeek, isSameMonth, isSameYear, 
  parseISO, endOfDay, endOfWeek, endOfMonth, endOfYear,
  startOfWeek, startOfMonth,
  differenceInDays
} from 'date-fns';
import { de } from 'date-fns/locale';

const pointLabelsPlugin = {
  id: 'pointLabels',
  afterDatasetsDraw(chart: any) {
    const { ctx, data } = chart;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = 'bold 10px Inter';
    ctx.fillStyle = '#94a3b8';

    data.datasets.forEach((dataset: any, datasetIndex: number) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      meta.data.forEach((element: any, index: number) => {
        const value = dataset.data[index];
        if (value !== 0 && value !== null && value !== undefined) {
          const formattedValue = typeof value === 'number' ? Math.round(value).toString() : value;
          ctx.fillText(formattedValue, element.x, element.y - 8);
        }
      });
    });
    ctx.restore();
  }
};

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  pointLabelsPlugin
);

interface TrackingModuleProps {
  bikes: Bike[];
  inventoryItems?: InventoryItem[];
  groupOrders?: GroupOrder[];
  receipts?: Receipt[];
  updateBike: (id: string, updates: Partial<Bike>) => void;
  addBike: (bike: Partial<Bike>) => void;
  deleteBike: (id: string) => void;
  deleteInventoryItem: (id: string) => void;
  deleteGroupOrder?: (id: string) => void;
  onNavigateToWorkshop: (id: string) => void;
  initialScrollPos?: number;
  isTiedCapitalExpanded: boolean;
  setIsTiedCapitalExpanded: (expanded: boolean) => void;
  addLog: (message: string, module: 'tracking' | 'workshop' | 'stopwatch' | 'system', revertAction?: any) => void;
}

export function TrackingModule({ 
  bikes: rawBikes, 
  inventoryItems = [],
  groupOrders = [],
  receipts = [],
  updateBike, 
  addBike, 
  deleteBike, 
  deleteInventoryItem,
  deleteGroupOrder,
  onNavigateToWorkshop, 
  initialScrollPos,
  isTiedCapitalExpanded,
  setIsTiedCapitalExpanded,
  addLog
}: TrackingModuleProps) {
  const [isHypotheticalMode, setIsHypotheticalMode] = useState(false);
  const todayStr = new Date().toISOString().split('T')[0];

  const bikes = React.useMemo(() => {
    if (!isHypotheticalMode) return rawBikes;
    return rawBikes.map(bike => {
      if (bike.status === 'Zu reparieren' || bike.status === 'Inseriert') {
        const expenses = bike.expenses?.reduce((sum, exp) => sum + exp.amount, 0) || 0;
        return {
          ...bike,
          status: 'Verkauft' as BikeStatus,
          sellingPrice: bike.targetSellingPrice || (bike.purchasePrice + expenses),
          saleDate: todayStr,
          _isHypothetical: true
        };
      }
      return bike;
    });
  }, [rawBikes, isHypotheticalMode, todayStr]);

  const [filterStatus, setFilterStatus] = useState<BikeStatus | 'Alle' | 'Aktueller Bestand'>('Alle');
  const [searchQuery, setSearchQuery] = useState('');
  const [purchaseDateStart, setPurchaseDateStart] = useState<string>('');
  const [purchaseDateEnd, setPurchaseDateEnd] = useState<string>('');
  const [minSellingPrice, setMinSellingPrice] = useState<string>('');
  const [maxSellingPrice, setMaxSellingPrice] = useState<string>('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [timeframe, setTimeframe] = useState<'day' | 'week' | 'month' | 'year'>('month');
  
  const [tableViewMode, setTableViewMode] = useState<'quick' | 'expanded'>(() => {
    const saved = localStorage.getItem('flipbike_tableViewMode');
    if (saved === 'quick' || saved === 'expanded') return saved;
    return window.innerWidth < 768 ? 'quick' : 'expanded';
  });

  React.useEffect(() => {
    localStorage.setItem('flipbike_tableViewMode', tableViewMode);
  }, [tableViewMode]);

  type SortField = 'name' | 'status' | 'purchaseDate' | 'purchasePrice' | 'expenses' | 'timeSpentSeconds' | 'targetSellingPrice' | 'saleDate' | 'sellingPrice' | 'hourlyWage' | 'profit' | 'velocity';
  const [sortField, setSortField] = useState<SortField>('status');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Erweiterung #3: Selektions-Scorecard (Ankauf-Entscheidungshilfe)
  const [isScorecardOpen, setIsScorecardOpen] = useState(false);
  const [scBp, setScBp] = useState('');
  const [scParts, setScParts] = useState('');
  const [scSp, setScSp] = useState('');
  const [scTimeCat, setScTimeCat] = useState<'<30' | '30-60' | '1-2' | '>2'>('1-2');

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renameBikeId, setRenameBikeId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [editTimeBikeId, setEditTimeBikeId] = useState<string | null>(null);
  const [editHours, setEditHours] = useState(0);
  const [editMinutes, setEditMinutes] = useState(0);
  
  const [newBikeData, setNewBikeData] = useState<Partial<Bike>>({
    name: '',
    purchaseDate: new Date().toISOString().split('T')[0],
    purchasePrice: 0,
    targetSellingPrice: 0,
    status: 'Zu reparieren',
    acquisitionSource: 'flyer'
  });

  const [isReady, setIsReady] = useState(!initialScrollPos);
  const [, setTick] = useState(0);

  // Periodic re-render to update running timers
  React.useEffect(() => {
    const interval = setInterval(() => {
      const localTimerJson = localStorage.getItem('flipbike_active_timer');
      const hasLocalTimer = !!localTimerJson;
      if (hasLocalTimer || bikes.some(b => b.startTime)) {
        setTick(t => t + 1);
      }
    }, 10000); // Update every 10 seconds
    return () => clearInterval(interval);
  }, [bikes]);

  const [salePromptBikeId, setSalePromptBikeId] = useState<string | null>(null);
  const [salePromptPrice, setSalePromptPrice] = useState<string>('');
  const [salePromptDate, setSalePromptDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // Listing-Dialog (Statuswechsel -> Inseriert): Zielpreis (sp) ist Pflicht
  const [listPromptBikeId, setListPromptBikeId] = useState<string | null>(null);
  const [listPromptPrice, setListPromptPrice] = useState<string>('');
  const [listPromptDate, setListPromptDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const [selectedPeriodIndex, setSelectedPeriodIndex] = useState<number | null>(null);

  // Universal operative timer (localStorage-persisted, counts toward businessHourlyWage)
  const [univIsRunning, setUnivIsRunning] = useState(false);
  const [univTime, setUnivTime] = useState(0);
  const [univLogs, setUnivLogs] = useState<WorkLog[]>([]);
  const [univAdjust, setUnivAdjust] = useState('');
  const [univShowLogs, setUnivShowLogs] = useState(false);
  const univTimerRef = useRef<number | null>(null);
  const univStartTsRef = useRef<number | null>(null);
  const univBaseRef = useRef<number>(0);

  // Load universal timer from localStorage on mount
  React.useEffect(() => {
    const saved = localStorage.getItem('flipbike_univ_timer');
    if (!saved) return;
    try {
      const data = JSON.parse(saved);
      const logs: WorkLog[] = data.logs || [];
      setUnivLogs(logs);
      if (data.startTime) {
        const base: number = data.baseSeconds || 0;
        const elapsed = Math.floor((Date.now() - data.startTime) / 1000);
        univStartTsRef.current = data.startTime;
        univBaseRef.current = base;
        setUnivTime(base + elapsed);
        setUnivIsRunning(true);
      } else {
        setUnivTime(data.baseSeconds || 0);
      }
    } catch {}
  }, []);

  // Timer tick
  React.useEffect(() => {
    if (univIsRunning) {
      univTimerRef.current = window.setInterval(() => {
        setUnivTime(t => t + 1);
      }, 1000);
    } else {
      if (univTimerRef.current) clearInterval(univTimerRef.current);
    }
    return () => { if (univTimerRef.current) clearInterval(univTimerRef.current); };
  }, [univIsRunning]);

  const handleUnivStart = () => {
    const now = Date.now();
    univStartTsRef.current = now;
    univBaseRef.current = univTime;
    setUnivIsRunning(true);
    localStorage.setItem('flipbike_univ_timer', JSON.stringify({ logs: univLogs, startTime: now, baseSeconds: univTime }));
  };

  const handleUnivStop = () => {
    if (univTimerRef.current) clearInterval(univTimerRef.current);
    setUnivIsRunning(false);
    const elapsed = univTime - univBaseRef.current;
    let newLogs = univLogs;
    if (elapsed > 0) {
      const newLog: WorkLog = { id: Date.now().toString(), timestamp: new Date().toISOString(), durationSeconds: elapsed };
      newLogs = [...univLogs, newLog];
      setUnivLogs(newLogs);
    }
    univStartTsRef.current = null;
    localStorage.setItem('flipbike_univ_timer', JSON.stringify({ logs: newLogs, startTime: null, baseSeconds: univTime }));
  };

  const handleUnivAdjust = () => {
    const mins = parseFloat(univAdjust);
    if (!mins || isNaN(mins)) return;
    const delta = Math.round(mins * 60);
    const newTime = Math.max(0, univTime + delta);
    setUnivTime(newTime);
    if (univIsRunning) univBaseRef.current += delta;
    if (delta !== 0) {
      const newLog: WorkLog = { id: Date.now().toString(), timestamp: new Date().toISOString(), durationSeconds: delta };
      const newLogs = [...univLogs, newLog];
      setUnivLogs(newLogs);
      localStorage.setItem('flipbike_univ_timer', JSON.stringify({ logs: newLogs, startTime: univStartTsRef.current, baseSeconds: univIsRunning ? univBaseRef.current : newTime }));
    }
    setUnivAdjust('');
  };

  const handleUnivDeleteLog = (logId: string) => {
    const log = univLogs.find(l => l.id === logId);
    if (!log) return;
    const newTime = Math.max(0, univTime - log.durationSeconds);
    setUnivTime(newTime);
    if (univIsRunning) univBaseRef.current -= log.durationSeconds;
    const newLogs = univLogs.filter(l => l.id !== logId);
    setUnivLogs(newLogs);
    localStorage.setItem('flipbike_univ_timer', JSON.stringify({ logs: newLogs, startTime: univStartTsRef.current, baseSeconds: univIsRunning ? univBaseRef.current : newTime }));
  };

  const handleUnivReset = () => {
    if (univIsRunning) return;
    setUnivTime(0);
    setUnivLogs([]);
    univBaseRef.current = 0;
    localStorage.removeItem('flipbike_univ_timer');
  };

  const handleStatusChange = (bikeId: string, newStatus: BikeStatus) => {
    const bike = bikes.find(b => b.id === bikeId);
    if (!bike) return;

    if (newStatus === 'Verkauft' && bike.status !== 'Verkauft') {
      setSalePromptBikeId(bikeId);
      setSalePromptPrice(bike.sellingPrice?.toString() || bike.targetSellingPrice?.toString() || '');
      setSalePromptDate(new Date().toISOString().split('T')[0]);
    } else if (newStatus === 'Inseriert' && bike.status !== 'Inseriert') {
      // Bug #3: Zielpreis ist beim Inserieren Pflicht
      setListPromptBikeId(bikeId);
      setListPromptPrice(bike.targetSellingPrice ? bike.targetSellingPrice.toString() : '');
      setListPromptDate(new Date().toISOString().split('T')[0]);
    } else {
      updateBike(bikeId, { status: newStatus });
    }
  };

  const confirmSale = () => {
    if (salePromptBikeId) {
      updateBike(salePromptBikeId, {
        status: 'Verkauft',
        sellingPrice: parseFloat(salePromptPrice) || 0,
        saleDate: salePromptDate,
        soldAt: salePromptDate
      });
      setSalePromptBikeId(null);
    }
  };

  const confirmListing = () => {
    const price = parseFloat(listPromptPrice);
    if (!listPromptBikeId || !(price > 0)) return; // Pflichtfeld: sp > 0
    updateBike(listPromptBikeId, {
      status: 'Inseriert',
      targetSellingPrice: price,
      listedAt: listPromptDate
    });
    setListPromptBikeId(null);
  };

  React.useLayoutEffect(() => {
    if (initialScrollPos) {
      window.scrollTo(0, initialScrollPos);
      // Small delay to ensure browser has processed the scroll before showing content
      const timer = setTimeout(() => setIsReady(true), 0);
      return () => clearTimeout(timer);
    }
  }, [initialScrollPos]);

  const handleAddBikeSubmit = () => {
    if (!newBikeData.name) return;
    addBike(newBikeData);
    setIsAddModalOpen(false);
    setNewBikeData({
      name: '',
      purchaseDate: new Date().toISOString().split('T')[0],
      purchasePrice: 0,
      targetSellingPrice: 0,
      status: 'Zu reparieren',
      acquisitionSource: 'flyer'
    });
  };

  // Calculate KPIs
  const soldBikes = bikes.filter((b) => b.status === 'Verkauft');
  
  const totalUmsatz = soldBikes.reduce((acc, bike) => acc + (bike.sellingPrice || 0), 0);

  // Gesamtgewinn = Cashflow (Alle Einnahmen - Alle Ausgaben)
  const totalInventoryCostTracking = inventoryItems
    .filter(item => !item.orderId)
    .reduce((acc, item) => acc + (item.pricePerUnit * (item.initialQuantity || item.quantity)), 0);
    
  const totalGroupOrderCostTracking = groupOrders.reduce((acc, order) => acc + order.totalPrice, 0);

  const totalProfit = bikes.reduce((acc, bike) => {
    const expenses = bike.expenses.reduce((sum, exp) => sum + exp.amount, 0);
    let bikeFlow = -bike.purchasePrice - expenses;
    if (bike.status === 'Verkauft') {
      bikeFlow += (bike.sellingPrice || 0);
    }
    return acc + bikeFlow;
  }, 0) - totalInventoryCostTracking - totalGroupOrderCostTracking;

  // Stundenlohn = Nur für verkaufte Fahrräder (Gewinn der verkauften / Zeit der verkauften)
  const soldBikesProfit = soldBikes.reduce((acc, bike) => {
    const expenses = bike.expenses.reduce((sum, exp) => sum + exp.amount, 0);
    return acc + ((bike.sellingPrice || 0) - bike.purchasePrice - expenses);
  }, 0);

  const infrastructureTimeSeconds = bikes.filter(b => b.status === 'Infrastruktur').reduce((acc, bike) => acc + bike.timeSpentSeconds, 0);
  const totalTimeSeconds = soldBikes.reduce((acc, bike) => acc + bike.timeSpentSeconds, 0) + infrastructureTimeSeconds;
  const avgHourlyWage = totalTimeSeconds > 0
    ? soldBikesProfit / (totalTimeSeconds / 3600)
    : 0;

  // Bug #1: Geschäfts-Stundenlohn = Nettogewinn / gesamte erfasste Zeit (alle Räder + operative Zeit, alle Kosten)
  const totalAllTimeSeconds = bikes.reduce((acc, bike) => acc + bike.timeSpentSeconds, 0) + univTime;
  const businessHourlyWage = totalAllTimeSeconds > 0
    ? totalProfit / (totalAllTimeSeconds / 3600)
    : 0;

  // Erweiterung #1: Ø Standzeit (gelistet -> verkauft) in Tagen über Räder mit beiden Daten
  const standzeitBikes = bikes.filter(b => b.listedAt && b.soldAt);
  const avgStandzeit = standzeitBikes.length > 0
    ? standzeitBikes.reduce((acc, b) => acc + differenceInDays(parseISO(b.soldAt as string), parseISO(b.listedAt as string)), 0) / standzeitBikes.length
    : null;

  const activeBikesWithCapital = bikes
    .filter(b => b.status !== 'Verkauft' && b.status !== 'Infrastruktur' && b.status !== 'Material')
    .map(bike => {
      const expenses = bike.expenses.reduce((sum, exp) => sum + exp.amount, 0);
      return { ...bike, tiedCapital: bike.purchasePrice + expenses };
    })
    .sort((a, b) => b.tiedCapital - a.tiedCapital);

  const infrastructureWithCapital = bikes
    .filter(b => b.status === 'Infrastruktur')
    .map(bike => {
      const expenses = bike.expenses.reduce((sum, exp) => sum + exp.amount, 0);
      return { ...bike, tiedCapital: bike.purchasePrice + expenses };
    })
    .sort((a, b) => b.tiedCapital - a.tiedCapital);

  const materialWithCapital = bikes
    .filter(b => b.status === 'Material')
    .map(bike => {
      const expenses = bike.expenses.reduce((sum, exp) => sum + exp.amount, 0);
      return { ...bike, tiedCapital: bike.purchasePrice + expenses };
    })
    .sort((a, b) => b.tiedCapital - a.tiedCapital);

  const tiedCapital = activeBikesWithCapital.reduce((acc, bike) => acc + bike.tiedCapital, 0);
  const infrastructureCapital = infrastructureWithCapital.reduce((acc, bike) => acc + bike.tiedCapital, 0);
  const materialCapital = materialWithCapital.reduce((acc, bike) => acc + bike.tiedCapital, 0) + inventoryItems.reduce((acc, item) => acc + (item.pricePerUnit * item.quantity), 0);
  const totalTiedCapital = tiedCapital + infrastructureCapital + materialCapital;

  // Erweiterung #2: Lagerwert (Restwert Ersatzteillager) = Σ(menge × preis/einheit)
  const lagerwert = inventoryItems.reduce((acc, item) => acc + (item.quantity * item.pricePerUnit), 0);
  const totalGebunden = tiedCapital + lagerwert;

  // --- Chart Calculations ---
  const getPeriods = (tf: 'day' | 'week' | 'month' | 'year') => {
    const now = new Date();
    switch (tf) {
      case 'day': return Array.from({ length: 14 }).map((_, i) => subDays(now, 13 - i));
      case 'week': return Array.from({ length: 12 }).map((_, i) => startOfWeek(subWeeks(now, 11 - i), { weekStartsOn: 1 }));
      case 'month': return Array.from({ length: 6 }).map((_, i) => startOfMonth(subMonths(now, 5 - i)));
      case 'year': return Array.from({ length: 12 }).map((_, i) => startOfMonth(subMonths(now, 11 - i)));
    }
  };

  const isSamePeriod = (date1: Date, date2: Date, tf: 'day' | 'week' | 'month' | 'year') => {
    switch (tf) {
      case 'day': return isSameDay(date1, date2);
      case 'week': return isSameWeek(date1, date2, { weekStartsOn: 1 });
      case 'month': return isSameMonth(date1, date2);
      case 'year': return isSameMonth(date1, date2);
    }
  };

  const formatPeriod = (date: Date, tf: 'day' | 'week' | 'month' | 'year') => {
    switch (tf) {
      case 'day': return format(date, 'dd.MM', { locale: de });
      case 'week': return `${format(date, 'dd.MM', { locale: de })} - ${format(endOfWeek(date, { weekStartsOn: 1 }), 'dd.MM', { locale: de })}`;
      case 'month': return format(date, 'MMM yy', { locale: de });
      case 'year': return format(date, 'MMM yy', { locale: de });
    }
  };

  const getEndOfPeriod = (date: Date, tf: 'day' | 'week' | 'month' | 'year') => {
    switch (tf) {
      case 'day': return endOfDay(date);
      case 'week': return endOfWeek(date, { weekStartsOn: 1 });
      case 'month': return endOfMonth(date);
      case 'year': return endOfMonth(date);
    }
  };

  const periods = getPeriods(timeframe); // Oldest to newest
  const labels = periods.map(p => formatPeriod(p, timeframe));

  const investData = periods.map(period => {
    let invest = 0;
    bikes.forEach(bike => {
      if (bike.purchaseDate && isSamePeriod(parseISO(bike.purchaseDate), period, timeframe)) {
        invest += bike.purchasePrice;
      }
      bike.expenses.forEach(exp => {
        if (exp.date && isSamePeriod(parseISO(exp.date), period, timeframe)) {
          invest += exp.amount;
        }
      });
    });

    groupOrders.forEach(order => {
      if (order.date && isSamePeriod(parseISO(order.date), period, timeframe)) {
        invest += order.totalPrice;
      }
    });

    inventoryItems.forEach(item => {
      if (!item.orderId && item.purchaseDate && isSamePeriod(parseISO(item.purchaseDate), period, timeframe)) {
        invest += item.pricePerUnit * (item.initialQuantity || item.quantity);
      }
    });

    return invest;
  });

  const umsatzData = periods.map(period => {
    let umsatz = 0;
    bikes.forEach(bike => {
      if (bike.saleDate && isSamePeriod(parseISO(bike.saleDate), period, timeframe)) {
        umsatz += (bike.sellingPrice || 0);
      }
    });
    return umsatz;
  });

  const gewinnData = umsatzData.map((umsatz, i) => umsatz - investData[i]);

  const periodDetails = periods.map(period => {
    const bought: { name: string, price: number }[] = [];
    const sold: { name: string, price: number }[] = [];
    const workSessions: { bikeName: string, duration: number }[] = [];
    const materialExpenses: { bikeName: string, desc: string, amount: number }[] = [];
    let totalHours = 0;
    let totalExpenses = 0;
    let totalPurchasePrice = 0;
    let totalSellingPrice = 0;
    
    bikes.forEach(bike => {
      if (bike.purchaseDate && isSamePeriod(parseISO(bike.purchaseDate), period, timeframe)) {
        bought.push({ name: bike.name, price: bike.purchasePrice });
        totalPurchasePrice += bike.purchasePrice;
        
        // Fallback for unlogged time (attribute to purchase date)
        const totalLoggedTime = (bike.workLogs || []).reduce((sum, l) => sum + l.durationSeconds, 0);
        const unloggedTime = Math.max(0, bike.timeSpentSeconds - totalLoggedTime);
        if (unloggedTime > 0) {
          totalHours += unloggedTime / 3600;
          workSessions.push({ bikeName: `${bike.name} (Basis)`, duration: unloggedTime });
        }
      }
      if (bike.saleDate && isSamePeriod(parseISO(bike.saleDate), period, timeframe)) {
        sold.push({ name: bike.name, price: bike.sellingPrice || 0 });
        totalSellingPrice += (bike.sellingPrice || 0);
      }
      
      // Work logs
      bike.workLogs?.forEach(log => {
        if (isSamePeriod(parseISO(log.timestamp), period, timeframe)) {
          totalHours += log.durationSeconds / 3600;
          workSessions.push({ bikeName: bike.name, duration: log.durationSeconds });
        }
      });

      // Expenses
      bike.expenses.forEach(exp => {
        if (exp.date && isSamePeriod(parseISO(exp.date), period, timeframe)) {
          totalExpenses += exp.amount;
          materialExpenses.push({ bikeName: bike.name, desc: exp.description, amount: exp.amount });
        }
      });
    });

    groupOrders.forEach(order => {
      if (order.date && isSamePeriod(parseISO(order.date), period, timeframe)) {
        totalExpenses += order.totalPrice;
        materialExpenses.push({ bikeName: 'Gruppenbestellung', desc: order.name, amount: order.totalPrice });
      }
    });

    inventoryItems.forEach(item => {
      if (!item.orderId && item.purchaseDate && isSamePeriod(parseISO(item.purchaseDate), period, timeframe)) {
         const cost = item.pricePerUnit * (item.initialQuantity || item.quantity);
         totalExpenses += cost;
         materialExpenses.push({ bikeName: 'Material', desc: `${item.name} (${item.initialQuantity || item.quantity}x)`, amount: cost });
      }
    });
    
    const balance = totalSellingPrice - totalPurchasePrice - totalExpenses;

    return { 
      label: formatPeriod(period, timeframe),
      bought, 
      sold, 
      totalHours, 
      totalExpenses, 
      totalPurchasePrice,
      totalSellingPrice,
      balance,
      workSessions, 
      materialExpenses 
    };
  });

  const gesamtGewinnData = periods.map(period => {
    const end = getEndOfPeriod(period, timeframe);
    let profit = 0;
    bikes.forEach(bike => {
      if (bike.purchaseDate && parseISO(bike.purchaseDate) <= end) {
        profit -= bike.purchasePrice;
      }
      bike.expenses.forEach(exp => {
        if (exp.date && parseISO(exp.date) <= end) {
          profit -= exp.amount;
        }
      });
      if (bike.status === 'Verkauft' && bike.saleDate && parseISO(bike.saleDate) <= end) {
        profit += (bike.sellingPrice || 0);
      }
    });

    groupOrders.forEach(order => {
      if (order.date && parseISO(order.date) <= end) {
        profit -= order.totalPrice;
      }
    });

    inventoryItems.forEach(item => {
      if (!item.orderId && item.purchaseDate && parseISO(item.purchaseDate) <= end) {
        profit -= item.pricePerUnit * (item.initialQuantity || item.quantity);
      }
    });

    return profit;
  });

  const stundenlohnData = periods.map(period => {
    let periodProfit = 0;
    let periodTime = 0;
    
    bikes.forEach(bike => {
      if (bike.status === 'Infrastruktur') {
         if (isSamePeriod(parseISO(bike.purchaseDate), period, timeframe)) {
            periodTime += bike.timeSpentSeconds;
         }
      } else if (bike.status === 'Verkauft' && bike.saleDate) {
        const effectiveDate = parseISO(bike.saleDate);
        if (isSamePeriod(effectiveDate, period, timeframe)) {
          const expenses = bike.expenses.reduce((sum, exp) => sum + exp.amount, 0);
          const profit = (bike.sellingPrice || 0) - bike.purchasePrice - expenses;
          
          periodProfit += profit;
          periodTime += bike.timeSpentSeconds;
        }
      }
    });
    
    return periodTime > 0 ? periodProfit / (periodTime / 3600) : 0;
  });

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { 
      legend: { 
        display: true,
        position: 'top' as const,
        labels: { color: '#cbd5e1', boxWidth: 12, padding: 10 }
      },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        titleColor: '#f1f5f9',
        bodyColor: '#cbd5e1',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8,
        callbacks: {
          label: (context: any) => {
            let label = context.dataset.label || '';
            if (label) label += ': ';
            if (context.parsed.y !== null) {
              label += formatCurrency(context.parsed.y);
            }
            return label;
          },
          footer: (context: any) => {
            const index = context[0].dataIndex;
            const data = context[0].dataset.data;
            if (index > 0) {
              const diff = data[index] - data[index - 1];
              const sign = diff >= 0 ? '+' : '';
              return `Bilanz: ${sign}${formatCurrency(diff)}`;
            }
            return '';
          }
        }
      }
    },
    onClick: (event: any, elements: any) => {
      if (elements.length > 0) {
        setSelectedPeriodIndex(elements[0].index);
      }
    },
    scales: {
      y: { 
        grid: { color: 'rgba(255, 255, 255, 0.1)' }, 
        ticks: { color: '#94a3b8' },
        grace: '10%'
      },
      x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
    }
  };

  const stundenlohnChartData = {
    labels,
    datasets: [{
      label: 'Stundenlohn (€/h)',
      data: stundenlohnData,
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      tension: 0.1,
      fill: false,
    }]
  };

  const stundenlohnOptions = {
    ...commonOptions,
    plugins: {
      ...commonOptions.plugins,
      tooltip: {
        ...commonOptions.plugins.tooltip,
        callbacks: {
          ...commonOptions.plugins.tooltip.callbacks,
          label: (context: any) => {
            let label = context.dataset.label || '';
            if (label) label += ': ';
            if (context.parsed.y !== null) {
              label += `${context.parsed.y.toFixed(2)} €/h`;
            }
            return label;
          },
          footer: (context: any) => {
            const index = context[0].dataIndex;
            const details = periodDetails[index];
            const lines = [];
            if (details.bought.length > 0) lines.push(`Gekauft: ${details.bought.map(b => b.name).join(', ')}`);
            if (details.sold.length > 0) lines.push(`Verkauft: ${details.sold.map(b => b.name).join(', ')}`);
            if (details.totalHours > 0) lines.push(`Arbeitszeit: ${details.totalHours.toFixed(1)}h`);
            return lines.length > 0 ? '\n' + lines.join('\n') : '';
          }
        }
      }
    }
  };

  const gewinnPeriodeOptions = {
    ...commonOptions,
    plugins: {
      ...commonOptions.plugins,
      tooltip: {
        ...commonOptions.plugins.tooltip,
        callbacks: {
          ...commonOptions.plugins.tooltip.callbacks,
          footer: (context: any) => {
            const index = context[0].dataIndex;
            const details = periodDetails[index];
            const lines = [];
            if (details.bought.length > 0) lines.push(`Gekauft: ${details.bought.map(b => b.name).join(', ')}`);
            if (details.sold.length > 0) lines.push(`Verkauft: ${details.sold.map(b => b.name).join(', ')}`);
            if (details.totalHours > 0) lines.push(`Arbeitszeit: ${details.totalHours.toFixed(1)}h`);
            if (details.totalExpenses > 0) lines.push(`Material: ${formatCurrency(details.totalExpenses)}`);
            return lines.length > 0 ? '\n' + lines.join('\n') : '';
          }
        }
      }
    }
  };

  const gesamtGewinnChartData = {
    labels,
    datasets: [{
      label: 'Gesamtgewinn (€)',
      data: gesamtGewinnData,
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      tension: 0.1,
      fill: false,
    }]
  };

  const gewinnPeriodeChartData = {
    labels,
    datasets: [{
      label: `Gewinn / ${timeframe === 'day' ? 'Tag' : timeframe === 'week' ? 'Woche' : timeframe === 'month' ? 'Monat' : 'Jahr'}`,
      data: gewinnData,
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      tension: 0.1,
      fill: false,
    }]
  };

  const investUmsatzChartData = {
    labels,
    datasets: [
      {
        label: 'Invest / Periode',
        data: investData,
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.2)',
        tension: 0.1,
        fill: true,
      },
      {
        label: 'Umsatz / Periode',
        data: umsatzData,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.2)',
        tension: 0.1,
        fill: true,
      }
    ]
  };

  const stundenAufgebrachtChartData = {
    labels,
    datasets: [{
      label: 'Stunden aufgebracht (h)',
      data: periodDetails.map(p => p.totalHours),
      borderColor: '#8b5cf6',
      backgroundColor: 'rgba(139, 92, 246, 0.1)',
      tension: 0.1,
      fill: true,
    }]
  };

  const stundenAufgebrachtOptions = {
    ...commonOptions,
    plugins: {
      ...commonOptions.plugins,
      tooltip: {
        ...commonOptions.plugins.tooltip,
        callbacks: {
          ...commonOptions.plugins.tooltip.callbacks,
          label: (context: any) => {
            let label = context.dataset.label || '';
            if (label) label += ': ';
            if (context.parsed.y !== null) {
              label += `${context.parsed.y.toFixed(1)} h`;
            }
            return label;
          },
          footer: (context: any) => {
            const index = context[0].dataIndex;
            const details = periodDetails[index];
            const lines: string[] = [];
            if (details.workSessions.length > 0) {
              const bikeHours: Record<string, number> = {};
              details.workSessions.forEach(ws => {
                bikeHours[ws.bikeName] = (bikeHours[ws.bikeName] || 0) + ws.duration / 3600;
              });
              Object.entries(bikeHours).forEach(([name, hours]) => {
                lines.push(`${name}: ${hours.toFixed(1)}h`);
              });
            }
            return lines.length > 0 ? '\n' + lines.join('\n') : '';
          }
        }
      }
    },
    scales: {
      ...commonOptions.scales,
      y: {
        ...commonOptions.scales.y,
        ticks: {
          ...commonOptions.scales.y.ticks,
          callback: (value: any) => `${value} h`
        }
      }
    }
  };

  const [selectedMonthAggregate, setSelectedMonthAggregate] = useState<string | null>(null);

  const extractToStandaloneProject = (item: any) => {
    addBike({
      name: item.name,
      status: 'Infrastruktur',
      purchasePrice: 0,
      purchaseDate: item.purchaseDate || item.date || new Date().toISOString().split('T')[0],
      sellingPrice: null,
      saleDate: null,
      targetSellingPrice: null,
      timeSpentSeconds: 0,
      expenses: [],
      checklist: [],
      photos: [],
      notes: '',
      lastModified: Date.now(),
      isStandalone: true,
      linkedFromId: item.id,
      hiddenInWorkshop: false
    });
    addLog(`"${item.name}" als eigenständiges Projekt extrahiert`, 'tracking');
  };

  const activeMaterialMonth = selectedMonthAggregate 
    ? {
       bikes: bikes.filter(b => (b.status === 'Infrastruktur' || b.status === 'Material') && b.purchaseDate && b.purchaseDate.startsWith(selectedMonthAggregate)),
       inventory: inventoryItems.filter(i => i.purchaseDate && i.purchaseDate.startsWith(selectedMonthAggregate) && !i.orderId),
       orders: groupOrders?.filter(o => o.date && o.date.startsWith(selectedMonthAggregate)) || []
      }
    : null;

  // Filter and sort bikes for inventory
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 inline-block opacity-30" />;
    return sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 ml-1 inline-block" /> : <ArrowDown className="w-3 h-3 ml-1 inline-block" />;
  };

  const aggregatedBikes = React.useMemo(() => {
    // 1. Separate Material/Infrastruktur bikes vs Regular bikes
    const regularBikes = bikes.filter(b => b.isStandalone || (b.status !== 'Infrastruktur' && b.status !== 'Material'));
    const infraMaterialBikes = bikes.filter(b => !b.isStandalone && (b.status === 'Infrastruktur' || b.status === 'Material'));

    const monthGroups: Record<string, Bike> = {};

    infraMaterialBikes.forEach(bike => {
      const date = parseISO(bike.purchaseDate);
      const monthKey = format(date, 'yyyy-MM');
      const monthName = format(date, 'MMMM yyyy', { locale: de });

      if (!monthGroups[monthKey]) {
        monthGroups[monthKey] = {
          id: `monthly-mat-${monthKey}`,
          name: `Infrastruktur & Material - ${monthName}`,
          status: 'Material',
          purchasePrice: 0,
          purchaseDate: `${monthKey}-01`,
          sellingPrice: null,
          saleDate: null,
          targetSellingPrice: null,
          timeSpentSeconds: 0,
          lastModified: Date.now(),
          expenses: [],
          checklist: [],
          notes: '',
          photos: [],
        };
      }
      monthGroups[monthKey].purchasePrice += bike.purchasePrice;
    });

    inventoryItems.forEach(item => {
      const date = parseISO(item.purchaseDate);
      const monthKey = format(date, 'yyyy-MM');
      const monthName = format(date, 'MMMM yyyy', { locale: de });

      if (!monthGroups[monthKey]) {
        monthGroups[monthKey] = {
          id: `monthly-mat-${monthKey}`,
          name: `Infrastruktur & Material - ${monthName}`,
          status: 'Material',
          purchasePrice: 0,
          purchaseDate: `${monthKey}-01`,
          sellingPrice: null,
          saleDate: null,
          targetSellingPrice: null,
          timeSpentSeconds: 0,
          lastModified: Date.now(),
          expenses: [],
          checklist: [],
          notes: '',
          photos: [],
        };
      }
      monthGroups[monthKey].purchasePrice += (item.pricePerUnit * item.quantity);
    });

    return [...regularBikes, ...Object.values(monthGroups)];
  }, [bikes, inventoryItems]);

  const filteredBikes = aggregatedBikes
    .filter(b => {
      if (filterStatus === 'Alle') return true;
      if (filterStatus === 'Aktueller Bestand') return b.status === 'Zu reparieren' || b.status === 'Inseriert';
      return b.status === filterStatus;
    })
    .filter(b => b.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .filter(b => {
      if (!purchaseDateStart) return true;
      return new Date(b.purchaseDate) >= new Date(purchaseDateStart);
    })
    .filter(b => {
      if (!purchaseDateEnd) return true;
      return new Date(b.purchaseDate) <= new Date(purchaseDateEnd);
    })
    .filter(b => {
      const price = b.sellingPrice || b.targetSellingPrice || 0;
      if (!minSellingPrice) return true;
      return price >= parseFloat(minSellingPrice);
    })
    .filter(b => {
      const price = b.sellingPrice || b.targetSellingPrice || 0;
      if (!maxSellingPrice) return true;
      return price <= parseFloat(maxSellingPrice);
    })
    .sort((a, b) => {
      let valA: any = 0;
      let valB: any = 0;

      const expensesA = a.expenses.reduce((sum, exp) => sum + exp.amount, 0);
      const expensesB = b.expenses.reduce((sum, exp) => sum + exp.amount, 0);

      const profitA = a.status === 'Verkauft' ? (a.sellingPrice || 0) - a.purchasePrice - expensesA : -Infinity;
      const profitB = b.status === 'Verkauft' ? (b.sellingPrice || 0) - b.purchasePrice - expensesB : -Infinity;

      const hourlyWageA = a.status === 'Verkauft' && a.sellingPrice && a.timeSpentSeconds > 0 ? profitA / (a.timeSpentSeconds / 3600) : -Infinity;
      const hourlyWageB = b.status === 'Verkauft' && b.sellingPrice && b.timeSpentSeconds > 0 ? profitB / (b.timeSpentSeconds / 3600) : -Infinity;

      const velocityA = a.saleDate ? differenceInDays(parseISO(a.saleDate), parseISO(a.purchaseDate)) : (sortDirection === 'asc' ? Infinity : -Infinity);
      const velocityB = b.saleDate ? differenceInDays(parseISO(b.saleDate), parseISO(b.purchaseDate)) : (sortDirection === 'asc' ? Infinity : -Infinity);

      switch (sortField) {
        case 'name': valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); break;
        case 'status': 
          const statusOrder = { 'Zu reparieren': 1, 'Inseriert': 2, 'Verkauft': 3, 'Infrastruktur': 4, 'Material': 5 };
          valA = statusOrder[a.status as keyof typeof statusOrder] || 6; 
          valB = statusOrder[b.status as keyof typeof statusOrder] || 6; 
          break;
        case 'purchaseDate': valA = new Date(a.purchaseDate).getTime(); valB = new Date(b.purchaseDate).getTime(); break;
        case 'purchasePrice': valA = a.purchasePrice; valB = b.purchasePrice; break;
        case 'expenses': valA = expensesA; valB = expensesB; break;
        case 'timeSpentSeconds': valA = a.timeSpentSeconds; valB = b.timeSpentSeconds; break;
        case 'targetSellingPrice': valA = a.targetSellingPrice || 0; valB = b.targetSellingPrice || 0; break;
        case 'saleDate': valA = a.saleDate ? new Date(a.saleDate).getTime() : 0; valB = b.saleDate ? new Date(b.saleDate).getTime() : 0; break;
        case 'sellingPrice': valA = a.sellingPrice || 0; valB = b.sellingPrice || 0; break;
        case 'hourlyWage': valA = hourlyWageA; valB = hourlyWageB; break;
        case 'profit': valA = profitA; valB = profitB; break;
        case 'velocity': valA = velocityA; valB = velocityB; break;
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

  // --- Scorecard-Berechnungen (Erweiterung #3) ---
  const TIME_MID: Record<string, number> = { '<30': 0.25, '30-60': 0.75, '1-2': 1.5, '>2': 3 };
  const scTimeMid = TIME_MID[scTimeCat];
  const scProjDB = (parseFloat(scSp) || 0) - (parseFloat(scBp) || 0) - (parseFloat(scParts) || 0);
  const scProjHw = scTimeMid > 0 ? scProjDB / scTimeMid : 0;

  const historicalWages = rawBikes
    .filter(b => b.status === 'Verkauft' && b.timeSpentSeconds > 0 && !!b.sellingPrice)
    .map(b => {
      const exp = b.expenses.reduce((s, e) => s + e.amount, 0);
      const profit = (b.sellingPrice || 0) - b.purchasePrice - exp;
      return { name: b.name, wage: profit / (b.timeSpentSeconds / 3600) };
    });
  const scBetterThan = historicalWages.filter(h => scProjHw > h.wage).length;
  const scClosest = historicalWages.length > 0
    ? historicalWages.reduce((best, h) => Math.abs(h.wage - scProjHw) < Math.abs(best.wage - scProjHw) ? h : best)
    : null;
  const scLight = scProjHw >= 30
    ? { bg: 'bg-emerald-500/10', border: 'border-emerald-500/40', text: 'text-emerald-400', label: 'Stark – ankaufen' }
    : scProjHw >= 15
      ? { bg: 'bg-yellow-500/10', border: 'border-yellow-500/40', text: 'text-yellow-400', label: 'Grenzwertig – genau prüfen' }
      : { bg: 'bg-red-500/10', border: 'border-red-500/40', text: 'text-red-400', label: 'Schwach – eher ablehnen' };

  return (
    <div className={`space-y-6 pb-20 md:pb-0 transition-opacity ${isReady ? 'duration-300 opacity-100' : 'duration-0 opacity-0'}`}>
      {/* Inventory List (Moved to top) */}
      <Card className="flex flex-col overflow-hidden">
        <CardHeader className="flex flex-col md:flex-row md:items-center justify-between space-y-4 md:space-y-0 pb-4 bg-slate-900/60 border-b border-slate-800 rounded-t-2xl">
          <div className="flex items-center space-x-4">
            <CardTitle className="text-xl">Inventar</CardTitle>
            <Button size="sm" onClick={() => setIsAddModalOpen(true)} className="h-8">
              <Plus className="w-4 h-4 mr-1" /> Neu
            </Button>
            <Button size="sm" variant="outline" onClick={() => setIsScorecardOpen(true)} className="h-8 border-slate-700 text-slate-300 hover:text-white">
              <FileCheck className="w-4 h-4 mr-1" /> Bewerten
            </Button>
          </div>
          <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
            <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700 mr-2">
              <button
                onClick={() => {
                  setTableViewMode('quick');
                  setShowAdvancedFilters(false);
                  setFilterStatus('Alle');
                  setPurchaseDateStart('');
                  setPurchaseDateEnd('');
                  setMinSellingPrice('');
                  setMaxSellingPrice('');
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${tableViewMode === 'quick' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-300'}`}
              >
                Schnellansicht
              </button>
              <button
                onClick={() => setTableViewMode('expanded')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${tableViewMode === 'expanded' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-300'}`}
              >
                Erweitert
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
              <Input
                placeholder="Suchen..."
                className="pl-9 w-full sm:w-48 h-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {tableViewMode === 'expanded' && (
              <>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                  className={`h-9 px-3 border-slate-700 ${showAdvancedFilters ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                >
                  <Filter className="w-4 h-4 mr-1" /> Filter
                </Button>
                <select
                  className="h-9 rounded-lg border border-slate-700/80 bg-slate-800/60 px-3 py-1 text-sm text-slate-200 transition-colors hover:border-slate-600 focus:outline-none focus:border-orange-500/60 focus:ring-2 focus:ring-orange-500/30"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as any)}
                >
                  <option value="Alle">Alle Status</option>
                  <option value="Aktueller Bestand">Aktueller Bestand</option>
                  <option value="Zu reparieren">Zu reparieren</option>
                  <option value="Inseriert">Inseriert</option>
                  <option value="Verkauft">Verkauft</option>
                  <option value="Infrastruktur">Infrastruktur</option>
                </select>
              </>
            )}
          </div>
        </CardHeader>

        {tableViewMode === 'expanded' && showAdvancedFilters && (
          <div className="p-4 bg-slate-900/50 border-b border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 animate-in slide-in-from-top-2 duration-200">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Ankauf von</label>
              <Input 
                type="date" 
                className="h-8 text-xs bg-slate-800 border-slate-700" 
                value={purchaseDateStart}
                onChange={(e) => setPurchaseDateStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Ankauf bis</label>
              <Input 
                type="date" 
                className="h-8 text-xs bg-slate-800 border-slate-700" 
                value={purchaseDateEnd}
                onChange={(e) => setPurchaseDateEnd(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Preis von (€)</label>
              <Input 
                type="number" 
                placeholder="Min..." 
                className="h-8 text-xs bg-slate-800 border-slate-700" 
                value={minSellingPrice}
                onChange={(e) => setMinSellingPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Preis bis (€)</label>
              <Input 
                type="number" 
                placeholder="Max..." 
                className="h-8 text-xs bg-slate-800 border-slate-700" 
                value={maxSellingPrice}
                onChange={(e) => setMaxSellingPrice(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-8 text-xs text-slate-500 hover:text-slate-300"
                onClick={() => {
                  setPurchaseDateStart('');
                  setPurchaseDateEnd('');
                  setMinSellingPrice('');
                  setMaxSellingPrice('');
                  setFilterStatus('Alle');
                  setSearchQuery('');
                }}
              >
                Filter zurücksetzen
              </Button>
            </div>
          </div>
        )}
        <CardContent className="pt-0 px-0">
          <div className="overflow-x-auto max-h-[70vh] md:max-h-none">
            <table className="w-full text-sm text-left text-slate-300 border-separate border-spacing-0">
              <thead className="text-xs text-slate-400 uppercase bg-slate-800 sticky top-0 z-30">
                <tr>
                  <th className="px-2 py-3 cursor-pointer hover:bg-slate-700/50 sticky left-0 z-40 bg-slate-800 border-r border-slate-700/50 min-w-[140px]" onClick={() => handleSort('name')}>Fahrrad ({filteredBikes.length}) <SortIcon field="name" /></th>
                  <th className="px-2 py-3 border-b border-slate-700/50">Beleg</th>
                  <th className="px-1 py-3 border-b border-slate-700/50 w-8 text-center" title="Akquise-Quelle (FL = Flyer, KA = Kleinanzeigen)">Src</th>
                  <th className="px-3 py-3 cursor-pointer hover:bg-slate-700/50 border-b border-slate-700/50" onClick={() => handleSort('status')}>Status <SortIcon field="status" /></th>
                  <th className="px-3 py-3 cursor-pointer hover:bg-slate-700/50 border-b border-slate-700/50" onClick={() => handleSort('purchaseDate')}>Ankauf <SortIcon field="purchaseDate" /></th>
                  <th className="px-3 py-3 cursor-pointer hover:bg-slate-700/50 border-b border-slate-700/50" onClick={() => handleSort('purchasePrice')}>EK (€) <SortIcon field="purchasePrice" /></th>
                  {tableViewMode === 'expanded' && <th className="px-3 py-3 cursor-pointer hover:bg-slate-700/50 border-b border-slate-700/50" onClick={() => handleSort('expenses')}>Material (€) <SortIcon field="expenses" /></th>}
                  {tableViewMode === 'expanded' && <th className="px-3 py-3 cursor-pointer hover:bg-slate-700/50 border-b border-slate-700/50" onClick={() => handleSort('timeSpentSeconds')}>Stunden <SortIcon field="timeSpentSeconds" /></th>}
                  {tableViewMode === 'expanded' && <th className="px-3 py-3 cursor-pointer hover:bg-slate-700/50 border-b border-slate-700/50" onClick={() => handleSort('targetSellingPrice')}>Ziel VK (€) <SortIcon field="targetSellingPrice" /></th>}
                  <th className="px-3 py-3 cursor-pointer hover:bg-slate-700/50 border-b border-slate-700/50" onClick={() => handleSort('saleDate')}>Verkauf <SortIcon field="saleDate" /></th>
                  {tableViewMode === 'expanded' && <th className="px-3 py-3 cursor-pointer hover:bg-slate-700/50 border-b border-slate-700/50" onClick={() => handleSort('velocity')}>Dauer <SortIcon field="velocity" /></th>}
                  <th className="px-3 py-3 cursor-pointer hover:bg-slate-700/50 border-b border-slate-700/50" onClick={() => handleSort('sellingPrice')}>VK (€) <SortIcon field="sellingPrice" /></th>
                  {tableViewMode === 'expanded' && <th className="px-3 py-3 cursor-pointer hover:bg-slate-700/50 border-b border-slate-700/50" onClick={() => handleSort('hourlyWage')}>Stundenlohn <SortIcon field="hourlyWage" /></th>}
                  <th className="px-3 py-3 cursor-pointer hover:bg-slate-700/50 border-b border-slate-700/50" onClick={() => handleSort('profit')}>Profit <SortIcon field="profit" /></th>
                </tr>
              </thead>
              <tbody>
                {filteredBikes.map((bike) => {
                  const expenses = bike.expenses.reduce((sum, exp) => sum + exp.amount, 0);
                  const profit = bike.status === 'Verkauft' 
                    ? (bike.sellingPrice || 0) - bike.purchasePrice - expenses
                    : bike.status === 'Infrastruktur'
                      ? -(bike.purchasePrice + expenses)
                      : null;
                  
                  const targetProfit = (bike.sellingPrice || bike.targetSellingPrice || 0) - bike.purchasePrice - expenses;
                  const hourlyWage = bike.sellingPrice && bike.timeSpentSeconds > 0 
                    ? targetProfit / (bike.timeSpentSeconds / 3600) 
                    : null;
                  
                  const isBigWin = (hourlyWage && hourlyWage >= 50) || (profit && profit >= 200) || (bike.sellingPrice && bike.sellingPrice >= 500);

                  // Erweiterung #1: Stale-Alarm – inseriert & älter als 7 Tage
                  const isStale = bike.status === 'Inseriert' && !!bike.listedAt && differenceInDays(new Date(), parseISO(bike.listedAt)) > 7;

                  return (
                    <tr key={bike.id} className={`group border-b border-slate-800 transition-colors ${
                      bike._isHypothetical ? 'bg-orange-950/20 hover:bg-orange-900/30 border-orange-900/50' :
                      isBigWin
                        ? 'bg-yellow-500/5 hover:bg-yellow-500/10' 
                        : 'hover:bg-slate-800/30'
                    }`}>
                      <td className={`px-2 py-2 sticky left-0 ${openMenuId === bike.id ? 'z-50' : 'z-20'} transition-colors border-r border-slate-700/50 min-w-[140px] ${
                        bike._isHypothetical ? 'bg-orange-950/40 group-hover:bg-orange-900/40' :
                        isBigWin 
                          ? 'bg-slate-900 group-hover:bg-slate-800 shadow-[inset_4px_0_0_rgba(234,179,8,0.5)]' 
                          : 'bg-slate-900 group-hover:bg-slate-800'
                      }`}>
                        <div className="flex items-center space-x-1 relative w-full">
                          {!bike.id.startsWith('monthly-mat-') && (
                            <>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuId(openMenuId === bike.id ? null : bike.id);
                                }}
                                className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-md transition-colors shrink-0"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>
                              {openMenuId === bike.id && (
                                <>
                                  <div className="fixed inset-0 z-0" onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); }}></div>
                                  <div className="absolute left-0 top-8 z-10 w-52 bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setRenameBikeId(bike.id); setRenameValue(bike.name); setOpenMenuId(null); }}
                                      className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center"
                                    >
                                      <Edit2 className="w-3 h-3 mr-2" /> Umbenennen
                                    </button>
                                    {/* Akquise-Quelle */}
                                    <div className="px-3 py-2">
                                      <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1.5">Akquise-Quelle</p>
                                      <div className="flex gap-1">
                                        <button
                                          onClick={(e) => { e.stopPropagation(); updateBike(bike.id, { acquisitionSource: 'flyer' }); setOpenMenuId(null); }}
                                          className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
                                            (bike.acquisitionSource === 'flyer' || !bike.acquisitionSource)
                                              ? 'bg-emerald-600 text-white'
                                              : 'bg-slate-700 text-slate-400 hover:text-white hover:bg-slate-600'
                                          }`}
                                        >
                                          <Megaphone className="w-3 h-3" /> Flyer
                                        </button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); updateBike(bike.id, { acquisitionSource: 'kleinanzeigen' }); setOpenMenuId(null); }}
                                          className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
                                            bike.acquisitionSource === 'kleinanzeigen'
                                              ? 'bg-blue-600 text-white'
                                              : 'bg-slate-700 text-slate-400 hover:text-white hover:bg-slate-600'
                                          }`}
                                        >
                                          <Monitor className="w-3 h-3" /> KA
                                        </button>
                                      </div>
                                    </div>
                                    <div className="h-px bg-slate-700 my-1"></div>
                                    <button
                                      onClick={(e) => {
                                          e.stopPropagation();
                                          const isHidden = bike.status === 'Infrastruktur' ? (bike.hiddenInWorkshop !== false) : (bike.hiddenInWorkshop === true);
                                          updateBike(bike.id, { hiddenInWorkshop: !isHidden });
                                          setOpenMenuId(null);
                                      }}
                                      className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center"
                                    >
                                      {(() => {
                                         const isHidden = bike.status === 'Infrastruktur' ? (bike.hiddenInWorkshop !== false) : (bike.hiddenInWorkshop === true);
                                         return isHidden ? <><Eye className="w-3 h-3 mr-2" /> In Werkstatt zeigen</> : <><EyeOff className="w-3 h-3 mr-2" /> Aus Werkstatt ausblenden</>;
                                      })()}
                                    </button>
                                    <div className="h-px bg-slate-700 my-1"></div>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); deleteBike(bike.id); setOpenMenuId(null); }}
                                      className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-slate-700 hover:text-red-300 flex items-center"
                                    >
                                      <Trash2 className="w-3 h-3 mr-2" /> Löschen
                                    </button>
                                  </div>
                                </>
                              )}
                            </>
                          )}
                          <button 
                            onClick={() => {
                               if (bike.id.startsWith('monthly-mat-')) {
                                   setSelectedMonthAggregate(bike.id.replace('monthly-mat-', ''));
                               } else {
                                   onNavigateToWorkshop(bike.id);
                               }
                            }}
                            className={`font-medium transition-colors text-left flex flex-col justify-center truncate md:whitespace-nowrap md:overflow-visible ${
                              bike.status === 'Infrastruktur' || bike.status === 'Material' || bike.id.startsWith('monthly-mat-')
                                ? (receipts.find(r => r.referenceId === bike.id) || bike.id.startsWith('monthly-mat-') ? 'text-emerald-400 hover:text-emerald-300' : 'text-red-400 hover:text-red-300')
                                : 'text-slate-200 hover:text-white'
                            }`}
                            title={bike.name}
                          >
                            <div className="flex items-start">
                              <span className={`truncate whitespace-normal text-xs md:text-sm md:whitespace-nowrap leading-tight line-clamp-2 md:line-clamp-none ${bike._isHypothetical ? 'text-orange-500' : ''}`}>{bike.name}</span>
                              {isBigWin && (
                                <Star className="w-3 h-3 ml-1 mt-0.5 shrink-0 text-yellow-500 fill-yellow-500" />
                              )}
                              {isStale && (
                                <span className="ml-1.5 mt-0.5 shrink-0 bg-red-500/20 text-red-400 text-[9px] px-1.5 py-0.5 rounded border border-red-500/40 whitespace-nowrap uppercase tracking-wider font-bold">Preis prüfen</span>
                              )}
                            </div>
                            {bike._isHypothetical && (
                              <span className="text-[9px] text-orange-400/80 font-semibold uppercase tracking-wider mt-0.5 block">Hypothetisch (-&gt; {formatCurrency(bike.sellingPrice || 0)})</span>
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        {(bike.status === 'Infrastruktur' || bike.status === 'Material' || bike.id.startsWith('monthly-mat-')) ? (
                          <ReceiptUploader
                            bikeId={bike.id}
                            referenceId={bike.id}
                            referenceType={bike.status === 'Infrastruktur' ? 'infrastructure' : 'material'}
                            existingReceipt={receipts.find(r => r.referenceId === bike.id)}
                          />
                        ) : (
                          <span className="text-slate-600 text-xs">–</span>
                        )}
                      </td>
                      <td className="px-1 py-2 text-center w-8">
                        {bike.acquisitionSource === 'flyer' && (
                          <span title="Flyer-Akquise">
                            <Megaphone className="w-3.5 h-3.5 text-emerald-400 inline-block" />
                          </span>
                        )}
                        {bike.acquisitionSource === 'kleinanzeigen' && (
                          <span title="Kleinanzeigen">
                            <Monitor className="w-3.5 h-3.5 text-blue-400 inline-block" />
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={bike.status}
                          disabled={bike._isHypothetical}
                          onChange={(e) => handleStatusChange(bike.id, e.target.value as BikeStatus)}
                          className={`h-8 px-2 rounded-md text-xs font-medium border-none focus:ring-2 focus:ring-orange-500 outline-none ${
                            bike._isHypothetical ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' :
                            bike.status === 'Zu reparieren' ? 'bg-red-500/20 text-red-400' :
                            bike.status === 'Inseriert' ? 'bg-blue-500/20 text-blue-400' :
                            bike.status === 'Verkauft' ? 'bg-emerald-500/20 text-emerald-400' :
                            bike.status === 'Material' ? 'bg-purple-500/20 text-purple-400' :
                            'bg-slate-500/20 text-slate-400'
                          }`}
                        >
                          <option value="Zu reparieren" className="bg-slate-800 text-slate-200">Zu reparieren</option>
                          <option value="Inseriert" className="bg-slate-800 text-slate-200">Inseriert</option>
                          <option value="Verkauft" className="bg-slate-800 text-slate-200">Verkauft</option>
                          <option value="Infrastruktur" className="bg-slate-800 text-slate-200">Infrastruktur</option>
                          <option value="Material" className="bg-slate-800 text-slate-200">Material</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <div className="relative w-32 h-8">
                          <Input 
                            type={bike.purchaseDate ? "date" : "text"}
                            value={bike.purchaseDate || ''} 
                            onChange={(e) => updateBike(bike.id, { purchaseDate: e.target.value })}
                            onFocus={(e) => {
                              e.target.type = "date";
                              try { (e.target as any).showPicker(); } catch (err) {}
                            }}
                            onBlur={(e) => {
                              if (!e.target.value) e.target.type = "text";
                            }}
                            placeholder="-"
                            className="absolute inset-0 h-full w-full bg-transparent border-transparent hover:border-slate-700 focus:bg-slate-800 px-2 text-xs z-10"
                          />
                          {!bike.purchaseDate && (
                            <div 
                              className="absolute inset-0 z-20 cursor-pointer" 
                              onClick={(e) => {
                                const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                                if (input) {
                                  input.focus();
                                }
                              }}
                            />
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Input 
                          type="number"
                          value={bike.purchasePrice} 
                          onChange={(e) => updateBike(bike.id, { purchasePrice: parseFloat(e.target.value) || 0 })}
                          className="h-8 w-20 bg-transparent border-transparent hover:border-slate-700 focus:bg-slate-800 px-2"
                        />
                      </td>
                      {tableViewMode === 'expanded' && (
                        <td className="px-3 py-2">
                          <span className="text-slate-300 px-2">{formatCurrency(expenses)}</span>
                        </td>
                      )}
                      {tableViewMode === 'expanded' && (
                        <td className="px-3 py-2">
                          <button 
                            onClick={() => {
                              setEditTimeBikeId(bike.id);
                              setEditHours(Math.floor(bike.timeSpentSeconds / 3600));
                              setEditMinutes(Math.floor((bike.timeSpentSeconds % 3600) / 60));
                            }}
                            className="text-slate-300 px-2 hover:text-orange-400 transition-colors flex items-center"
                          >
                            {bike.startTime && (
                              <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse mr-1.5 shrink-0"></div>
                            )}
                            {(() => {
                              let currentSeconds = bike.timeSpentSeconds || 0;
                              
                              // Check if this bike has an active timer in DB
                              if (bike.startTime) {
                                currentSeconds += Math.floor((Date.now() - bike.startTime) / 1000);
                              }
                              
                              // Check if this bike has an active timer in localStorage (more up-to-date)
                              try {
                                const localTimerJson = localStorage.getItem('flipbike_active_timer');
                                if (localTimerJson) {
                                  const localTimer = JSON.parse(localTimerJson);
                                  if (localTimer && localTimer.bikeId === bike.id) {
                                    const elapsedSeconds = Math.floor((Date.now() - localTimer.startTime) / 1000);
                                    currentSeconds = (localTimer.initialTime || 0) + elapsedSeconds;
                                  }
                                }
                              } catch (e) {
                                // Ignore localStorage errors
                              }
                              
                              return (currentSeconds / 3600).toFixed(1);
                            })()}h
                          </button>
                        </td>
                      )}
                      {tableViewMode === 'expanded' && (
                        <td className="px-3 py-2">
                          <Input 
                            type="number"
                            value={bike.targetSellingPrice || ''} 
                            onChange={(e) => updateBike(bike.id, { targetSellingPrice: parseFloat(e.target.value) || null })}
                            className="h-8 w-20 bg-transparent border-transparent hover:border-slate-700 focus:bg-slate-800 px-2"
                            placeholder="-"
                          />
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <div className="relative w-32 h-8">
                          <Input 
                            type={bike.saleDate ? "date" : "text"}
                            value={bike.saleDate || ''} 
                            disabled={bike._isHypothetical}
                            onChange={(e) => updateBike(bike.id, { saleDate: e.target.value || null })}
                            onFocus={(e) => {
                              if (bike._isHypothetical) return;
                              e.target.type = "date";
                              try { (e.target as any).showPicker(); } catch (err) {}
                            }}
                            onBlur={(e) => {
                              if (!e.target.value) e.target.type = "text";
                            }}
                            placeholder="-"
                            className="absolute inset-0 h-full w-full bg-transparent border-transparent hover:border-slate-700 focus:bg-slate-800 px-2 text-xs z-10"
                          />
                          {!bike.saleDate && (
                            <div 
                              className="absolute inset-0 z-20 cursor-pointer" 
                              onClick={(e) => {
                                const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                                if (input) {
                                  input.focus();
                                }
                              }}
                            />
                          )}
                        </div>
                      </td>
                      {tableViewMode === 'expanded' && (
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="text-slate-300 px-2">
                            {bike.saleDate ? `${differenceInDays(parseISO(bike.saleDate), parseISO(bike.purchaseDate))} d` : '-'}
                          </span>
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <Input 
                          type="number"
                          value={bike.sellingPrice || ''} 
                          disabled={bike._isHypothetical}
                          onChange={(e) => updateBike(bike.id, { sellingPrice: parseFloat(e.target.value) || null })}
                          className={`h-8 w-20 bg-transparent border-transparent hover:border-slate-700 focus:bg-slate-800 px-2 font-medium ${
                            bike._isHypothetical ? 'text-orange-400 opacity-80' :
                            hourlyWage !== null 
                              ? hourlyWage >= 15 
                                ? 'text-emerald-400' 
                                : 'text-red-400'
                              : ''
                          }`}
                          placeholder="-"
                        />
                      </td>
                      {tableViewMode === 'expanded' && (
                        <td className={`px-3 py-2 font-medium ${
                          hourlyWage !== null 
                            ? hourlyWage >= 15 
                              ? 'text-emerald-400' 
                              : 'text-red-400' 
                            : 'text-slate-400'
                        }`}>
                          {hourlyWage !== null ? `${formatCurrency(hourlyWage)}/h` : '-'}
                        </td>
                      )}
                      <td className={`px-3 py-2 font-medium ${profit && profit > 0 ? 'text-emerald-400' : profit && profit < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                        {profit !== null ? formatCurrency(profit) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Hypothetical Mode Toggle */}
      <div className={`flex items-center justify-between p-4 rounded-xl border ${isHypotheticalMode ? 'bg-orange-500/10 border-orange-500/50' : 'bg-slate-800/50 border-slate-700/50'} transition-colors mt-6 mb-2`}>
        <div className="flex items-center space-x-3">
          <input 
            type="checkbox" 
            id="hypotheticalMode"
            checked={isHypotheticalMode}
            onChange={(e) => setIsHypotheticalMode(e.target.checked)}
            className="w-5 h-5 rounded border-slate-600 text-orange-500 focus:ring-orange-500 bg-slate-700" 
          />
          <div>
            <label htmlFor="hypotheticalMode" className="font-bold text-slate-200 cursor-pointer flex items-center">
              Hypothetischer Liquidationsmodus
              {isHypotheticalMode && <span className="ml-3 text-xs text-orange-400 font-bold bg-orange-500/20 px-2 py-0.5 rounded uppercase tracking-wider">Aktiviert</span>}
            </label>
            <p className="text-xs text-slate-400 mt-1">
              Simuliert temporär den Verkauf aller Bestand-Räder zum eingetragenen "Angepeilter VK" (bzw. Break-Even). Gilt für die Tabelle oben und alle Auswertungen unten.
            </p>
          </div>
        </div>
      </div>

      {/* KPI Header */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mt-4">
        <Card>
          <CardContent className="p-6 flex items-start space-x-4">
            <div className="p-3 bg-indigo-500/20 rounded-lg text-indigo-500 shrink-0">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-slate-400 font-medium">Gesamtumsatz</p>
              <h3 className="text-2xl font-bold text-slate-100">{formatCurrency(totalUmsatz)}</h3>
              <div className="mt-2 pt-2 border-t border-slate-700/50">
                <p className="text-xs text-slate-400 font-medium leading-tight">Ø Standzeit (gelistet → verkauft)</p>
                <h4 className="text-lg font-bold text-slate-300">
                  {avgStandzeit !== null ? `${avgStandzeit.toFixed(0)} Tage` : '—'}
                </h4>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex items-center space-x-4">
            <div className="p-3 bg-orange-500/20 rounded-lg text-orange-500">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-400 font-medium">Gesamtgewinn</p>
              <h3 className="text-2xl font-bold text-slate-100">{formatCurrency(totalProfit)}</h3>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex items-start space-x-4">
            <div className="p-3 bg-emerald-500/20 rounded-lg text-emerald-500 shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-slate-400 font-medium leading-tight">DB/Schrauberstunde (Verkaufte Räder)</p>
              <h3 className="text-2xl font-bold text-slate-100">{formatCurrency(avgHourlyWage)}/h</h3>
              <div className="mt-2 pt-2 border-t border-slate-700/50">
                <p className="text-xs text-slate-400 font-medium leading-tight">Geschäfts-Stundenlohn (alle Kosten)</p>
                <h4 className="text-lg font-bold text-slate-300">{formatCurrency(businessHourlyWage)}/h</h4>
              </div>
              {/* Operative Zeit – universelle Stoppuhr */}
              <div className="mt-2 pt-2 border-t border-slate-700/50">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs text-slate-400 font-medium leading-tight">Operative Zeit</p>
                  <div className="flex items-center gap-1">
                    <span className={`text-xs font-mono font-bold ${univIsRunning ? 'text-emerald-400' : 'text-slate-200'}`}>{formatTime(univTime)}</span>
                    {!univIsRunning && univTime > 0 && (
                      <button onClick={handleUnivReset} className="text-slate-600 hover:text-red-400 transition-colors ml-0.5" title="Zurücksetzen">
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={univIsRunning ? handleUnivStop : handleUnivStart}
                    className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold transition-colors active:scale-95 ${
                      univIsRunning
                        ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/30'
                        : 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/30'
                    }`}
                  >
                    {univIsRunning ? <><Pause className="w-3 h-3" />Stop</> : <><Play className="w-3 h-3" />Start</>}
                  </button>
                  <button
                    onClick={() => setUnivShowLogs(v => !v)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors border ${univShowLogs ? 'bg-slate-600/50 text-slate-300 border-slate-500/50' : 'bg-slate-700/40 text-slate-500 border-slate-600/30 hover:text-slate-300'}`}
                  >
                    Logs {univLogs.length > 0 && <span className="ml-0.5 opacity-70">({univLogs.length})</span>}
                  </button>
                </div>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <input
                    type="number"
                    value={univAdjust}
                    onChange={e => setUnivAdjust(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleUnivAdjust()}
                    placeholder="+/- Min"
                    className="flex-1 min-w-0 bg-slate-700/40 border border-slate-600/50 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20"
                  />
                  <button
                    onClick={handleUnivAdjust}
                    className="px-2.5 py-1.5 rounded-lg text-xs bg-slate-700/40 text-slate-400 hover:bg-slate-700 border border-slate-600/30 transition-colors whitespace-nowrap active:scale-95"
                  >
                    Anwenden
                  </button>
                </div>
                {univShowLogs && (
                  <div className="mt-2 space-y-0.5 max-h-28 overflow-y-auto pr-0.5">
                    {univLogs.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-1">Noch keine Einträge</p>
                    ) : (
                      [...univLogs].reverse().map(log => (
                        <div key={log.id} className="flex items-center justify-between gap-2 text-xs py-0.5">
                          <span className="text-slate-500 shrink-0">{format(parseISO(log.timestamp), 'HH:mm')}</span>
                          <span className={`font-mono font-medium flex-1 ${log.durationSeconds < 0 ? 'text-red-400' : 'text-slate-300'}`}>
                            {log.durationSeconds < 0 ? '−' : ''}{formatTime(Math.abs(log.durationSeconds))}
                          </span>
                          <button onClick={() => handleUnivDeleteLog(log.id)} className="text-slate-600 hover:text-red-400 transition-colors shrink-0">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card 
          className="cursor-pointer hover:bg-slate-800/50 transition-colors"
          onClick={() => setIsTiedCapitalExpanded(!isTiedCapitalExpanded)}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="p-3 bg-blue-500/20 rounded-lg text-blue-500 shrink-0">
                  <Wallet className="w-6 h-6" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-slate-400 font-medium leading-tight">Gebundenes Kapital (Räder)</p>
                  <h3 className="text-2xl font-bold text-slate-100">{formatCurrency(tiedCapital)}</h3>
                  <div className="mt-2 pt-2 border-t border-slate-700/50 space-y-0.5">
                    <div className="flex justify-between gap-4 text-xs">
                      <span className="text-slate-400">Lagerwert (Teile)</span>
                      <span className="text-slate-300 font-medium whitespace-nowrap">{formatCurrency(lagerwert)}</span>
                    </div>
                    <div className="flex justify-between gap-4 text-xs">
                      <span className="text-slate-400 font-semibold">Gesamt gebunden</span>
                      <span className="text-blue-400 font-bold whitespace-nowrap">{formatCurrency(totalGebunden)}</span>
                    </div>
                  </div>
                </div>
              </div>
              {isTiedCapitalExpanded ? (
                <ChevronUp className="w-5 h-5 text-slate-500" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-500" />
              )}
            </div>
            
            {isTiedCapitalExpanded && (
              <div className="mt-4 pt-4 border-t border-slate-700 space-y-1">
                {activeBikesWithCapital.map(bike => (
                  <div 
                    key={bike.id} 
                    className="flex justify-between items-center text-sm hover:bg-slate-700/50 p-2 -mx-2 rounded cursor-pointer transition-colors group"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateToWorkshop(bike.id);
                    }}
                  >
                    <span className="text-slate-300 truncate pr-2 group-hover:text-blue-400 transition-colors">{bike.name}</span>
                    <span className="text-slate-100 font-medium whitespace-nowrap">{formatCurrency(bike.tiedCapital)}</span>
                  </div>
                ))}
                {activeBikesWithCapital.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-2">Kein gebundenes Kapital (Fahrräder).</p>
                )}
                
                {infrastructureWithCapital.length > 0 && (
                  <>
                    <div className="my-3 border-t border-slate-700/50"></div>
                    <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Infrastruktur</p>
                    {infrastructureWithCapital.map(bike => (
                      <div 
                        key={bike.id} 
                        className="flex justify-between items-center text-sm hover:bg-slate-700/50 p-2 -mx-2 rounded cursor-pointer transition-colors group"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigateToWorkshop(bike.id);
                        }}
                      >
                        <span className="text-slate-400 truncate pr-2 group-hover:text-blue-400 transition-colors">{bike.name}</span>
                        <span className="text-slate-300 font-medium whitespace-nowrap">{formatCurrency(bike.tiedCapital)}</span>
                      </div>
                    ))}
                    <div className="mt-3 pt-3 border-t border-slate-700 flex justify-between items-center">
                      <span className="text-sm font-bold text-slate-300">Gesamt (inkl. Infrastruktur)</span>
                      <span className="text-sm font-bold text-blue-400">{formatCurrency(totalTiedCapital)}</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
          <h2 className="text-xl font-bold">Auswertung</h2>
          <div className="flex space-x-1 bg-slate-800 p-1 rounded-lg overflow-x-auto max-w-full">
            {(['day', 'week', 'month', 'year'] as const).map(tf => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors whitespace-nowrap ${
                  timeframe === tf ? 'bg-slate-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf === 'day' ? 'Tage' : tf === 'week' ? 'Wochen' : tf === 'month' ? 'Monate' : 'Jahre'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-bold text-slate-200 text-center">Stundenlohn</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="h-[250px]">
                <Line data={stundenlohnChartData} options={stundenlohnOptions} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-bold text-slate-200 text-center">Gesamtgewinn</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="h-[250px]">
                <Line data={gesamtGewinnChartData} options={commonOptions} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-bold text-slate-200 text-center">
                Gewinn / {timeframe === 'day' ? 'Tag' : timeframe === 'week' ? 'Woche' : timeframe === 'month' ? 'Monat' : 'Jahr'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="h-[250px]">
                <Line data={gewinnPeriodeChartData} options={gewinnPeriodeOptions} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-bold text-slate-200 text-center">
                Invest / Umsatz
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="h-[250px]">
                <Line data={investUmsatzChartData} options={commonOptions} />
              </div>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-bold text-slate-200 text-center">
                Stunden aufgebracht
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="h-[250px]">
                <Line data={stundenAufgebrachtChartData} options={stundenAufgebrachtOptions} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {activeMaterialMonth && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <h2 className="text-lg font-bold text-slate-100 flex items-center">
                <Wallet className="w-5 h-5 mr-2 text-blue-500" />
                Infrastruktur & Material ({selectedMonthAggregate})
              </h2>
              <button 
                onClick={() => setSelectedMonthAggregate(null)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                title="Schließen"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto space-y-6">
               <div>
                  <h3 className="text-sm font-semibold uppercase text-slate-500 tracking-wider mb-3">Infrastruktur & Werkzeuge (Bikes)</h3>
                  {activeMaterialMonth.bikes.length === 0 ? (
                     <p className="text-sm text-slate-500">Keine Infrastruktur-Käufe in diesem Monat.</p>
                  ) : (
                     <div className="space-y-2">
                        {activeMaterialMonth.bikes.map(bike => {
                           const hasReceipt = receipts?.find(r => r.referenceId === bike.id);
                           const isMaterial = bike.status === 'Material';
                           const isExtracted = bikes.some(b => b.linkedFromId === bike.id);
                           return (
                               <div key={bike.id} className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center gap-3 sm:gap-0 bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                                  <div className="flex flex-col w-full sm:w-auto">
                                     <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                                        <span className={`font-medium break-words leading-tight ${hasReceipt ? 'text-emerald-400' : 'text-slate-200'}`}>{bike.name}</span>
                                        {isExtracted && (
                                            <span className="bg-blue-500/20 text-blue-400 text-[10px] px-1.5 py-0.5 rounded border border-blue-500/30 whitespace-nowrap">Als Projekt erfasst</span>
                                        )}
                                        <div className="shrink-0">
                                            <ReceiptUploader 
                                                bikeId={bike.id}
                                                referenceId={bike.id}
                                                referenceType={isMaterial ? 'material' : 'infrastructure'}
                                                existingReceipt={hasReceipt}
                                            />
                                        </div>
                                     </div>
                                     <span className="text-xs text-slate-500 mt-1">{isMaterial ? 'Kategorie: Material' : 'Kategorie: Infrastruktur'} | {bike.purchaseDate}</span>
                                  </div>
                                  <div className="flex items-center justify-between w-full sm:w-auto mt-2 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-700/50">
                                     <span className="font-bold text-slate-200">{formatCurrency(bike.purchasePrice)}</span>
                                     <div className="flex items-center space-x-2">
                                         {!isExtracted && (
                                             <button 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    extractToStandaloneProject(bike);
                                                }}
                                                className="text-slate-400 hover:text-blue-400 transition-colors pointer-events-auto sm:ml-4"
                                                title="Als Projekt extrahieren (für Zeiterfassung)"
                                             >
                                                <FileCheck className="w-4 h-4" />
                                             </button>
                                         )}
                                         <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                deleteBike(bike.id);
                                            }}
                                            className="text-slate-400 hover:text-red-400 transition-colors pointer-events-auto sm:ml-2"
                                            title="Löschen"
                                         >
                                            <Trash2 className="w-4 h-4" />
                                         </button>
                                     </div>
                                  </div>
                               </div>
                           );
                        })}
                     </div>
                  )}
               </div>

               <div>
                  <h3 className="text-sm font-semibold uppercase text-slate-500 tracking-wider mb-3">Materialinventar & Verbrauchsteile</h3>
                  {activeMaterialMonth.inventory.length === 0 ? (
                     <p className="text-sm text-slate-500">Keine Einzel-Käufe in diesem Monat.</p>
                  ) : (
                     <div className="space-y-2">
                        {activeMaterialMonth.inventory.map(item => {
                           let hasReceipt = receipts?.find(r => r.referenceId === item.id);
                           let isDerivedReceipt = false;
                           let derivedReceiptLabel = '';
                           if (!hasReceipt && item.orderId) {
                             hasReceipt = receipts?.find(r => r.referenceId === item.orderId);
                             if (hasReceipt) {
                               isDerivedReceipt = true;
                               const gOrder = groupOrders?.find(go => go.id === item.orderId);
                               derivedReceiptLabel = gOrder ? '✓ ' + gOrder.name : 'Abgedeckt';
                             }
                           }
                           const isConsumable = item.category === 'consumable';
                           const isExtracted = bikes.some(b => b.linkedFromId === item.id);
                           return (
                               <div key={item.id} className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center gap-3 sm:gap-0 bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                                  <div className="flex flex-col w-full sm:w-auto">
                                     <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                                        <span className={`font-medium break-words leading-tight ${hasReceipt ? 'text-emerald-400' : 'text-slate-200'}`}>{item.name}</span>
                                        {isExtracted && (
                                            <span className="bg-blue-500/20 text-blue-400 text-[10px] px-1.5 py-0.5 rounded border border-blue-500/30 whitespace-nowrap">Als Projekt erfasst</span>
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
                                     <span className="text-xs text-slate-500 mt-1">
                                         {item.quantity} Stück à {formatCurrency(item.pricePerUnit)} | {item.purchaseDate}
                                     </span>
                                  </div>
                                  <div className="flex items-center justify-between w-full sm:w-auto mt-2 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-700/50">
                                     <span className="font-bold text-slate-200">{formatCurrency(item.pricePerUnit * item.quantity)}</span>
                                     <div className="flex items-center space-x-2">
                                         {!isExtracted && (
                                             <button 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    extractToStandaloneProject(item);
                                                }}
                                                className="text-slate-400 hover:text-blue-400 transition-colors pointer-events-auto sm:ml-4"
                                                title="Als Projekt extrahieren (für Zeiterfassung)"
                                             >
                                                <FileCheck className="w-4 h-4" />
                                             </button>
                                         )}
                                         <button 
                                            onClick={(e) => {
                                               e.stopPropagation();
                                               try {
                                                 deleteInventoryItem(item.id);
                                               } catch (err) {
                                                 console.error("Fehler beim Löschen des Materials:", err);
                                                 alert("Fehler beim Löschen.");
                                               }
                                           }}
                                           className="text-slate-400 hover:text-red-400 transition-colors pointer-events-auto sm:ml-2"
                                           title="Löschen"
                                        >
                                           <Trash2 className="w-4 h-4" />
                                        </button>
                                     </div>
                                  </div>
                               </div>
                           );
                        })}
                     </div>
                  )}
               </div>

               <div>
                  <h3 className="text-sm font-semibold uppercase text-slate-500 tracking-wider mt-6 mb-3">Gruppenbestellungen</h3>
                  {activeMaterialMonth.orders.length === 0 ? (
                     <p className="text-sm text-slate-500">Keine Gruppenbestellungen in diesem Monat.</p>
                  ) : (
                     <div className="space-y-2">
                        {activeMaterialMonth.orders.map(order => {
                           const hasReceipt = receipts?.find(r => r.referenceId === order.id);
                           const isExtracted = bikes.some(b => b.linkedFromId === order.id);
                           return (
                               <div key={order.id} className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center gap-3 sm:gap-0 bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                                  <div className="flex flex-col w-full sm:w-auto">
                                     <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                                        <span className={`font-medium break-words leading-tight ${hasReceipt ? 'text-emerald-400' : 'text-slate-200'}`}>{order.name}</span>
                                        {isExtracted && (
                                            <span className="bg-blue-500/20 text-blue-400 text-[10px] px-1.5 py-0.5 rounded border border-blue-500/30 whitespace-nowrap">Als Projekt erfasst</span>
                                        )}
                                        <div className="shrink-0">
                                            <ReceiptUploader 
                                                bikeId=""
                                                referenceId={order.id}
                                                referenceType="order"
                                                existingReceipt={hasReceipt}
                                            />
                                        </div>
                                     </div>
                                     <span className="text-xs text-slate-500 mt-1">
                                         {order.date}
                                     </span>
                                  </div>
                                  <div className="flex items-center justify-between w-full sm:w-auto mt-2 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-700/50">
                                     <span className="font-bold text-slate-200">{formatCurrency(order.totalPrice)}</span>
                                     <div className="flex items-center space-x-2">
                                         {!isExtracted && (
                                             <button 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    extractToStandaloneProject(order);
                                                }}
                                                className="text-slate-400 hover:text-blue-400 transition-colors pointer-events-auto sm:ml-4"
                                                title="Als Projekt extrahieren (für Zeiterfassung)"
                                             >
                                                <FileCheck className="w-4 h-4" />
                                             </button>
                                         )}
                                         <button 
                                            onClick={(e) => { 
                                                e.stopPropagation();
                                                deleteGroupOrder && deleteGroupOrder(order.id) 
                                            }}
                                            className="text-slate-400 hover:text-red-400 transition-colors pointer-events-auto sm:ml-2"
                                            title="Löschen"
                                         >
                                            <Trash2 className="w-4 h-4" />
                                         </button>
                                     </div>
                                  </div>
                               </div>
                           );
                        })}
                     </div>
                  )}
               </div>
            </div>
            <div className="p-4 border-t border-slate-800 bg-slate-900/50 flex justify-end">
                <Button onClick={() => setSelectedMonthAggregate(null)} variant="outline">Schließen</Button>
            </div>
          </div>
        </div>
      )}

      {/* Sale Details Modal */}
      {salePromptBikeId && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <h2 className="text-lg font-bold text-slate-100 flex items-center">
                <TrendingUp className="w-5 h-5 mr-2 text-emerald-500" />
                Verkaufsdetails
              </h2>
              <button 
                onClick={() => setSalePromptBikeId(null)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Verkaufspreis (€)</label>
                <Input 
                  type="number"
                  value={salePromptPrice}
                  onChange={(e) => setSalePromptPrice(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-slate-100"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Verkaufsdatum</label>
                <Input 
                  type="date"
                  value={salePromptDate}
                  onChange={(e) => setSalePromptDate(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-slate-100"
                />
              </div>
              <div className="pt-4 flex space-x-3">
                <Button 
                  variant="outline" 
                  className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
                  onClick={() => setSalePromptBikeId(null)}
                >
                  Abbrechen
                </Button>
                <Button
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white"
                  onClick={confirmSale}
                >
                  <Check className="w-4 h-4 mr-2" /> Bestätigen
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Listing Details Modal (Statuswechsel -> Inseriert) */}
      {listPromptBikeId && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <h2 className="text-lg font-bold text-slate-100 flex items-center">
                <TrendingUp className="w-5 h-5 mr-2 text-blue-500" />
                Inserieren
              </h2>
              <button
                onClick={() => setListPromptBikeId(null)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Zielpreis / VK (€) *</label>
                <Input
                  type="number"
                  value={listPromptPrice}
                  onChange={(e) => setListPromptPrice(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-slate-100"
                  placeholder="Pflichtfeld – muss größer 0 sein"
                  autoFocus
                />
                <p className="text-xs text-slate-500 mt-1">Pflicht: Ohne Zielpreis kann der Live-Stundenlohn-Rechner nicht arbeiten.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Inseriert am</label>
                <Input
                  type="date"
                  value={listPromptDate}
                  onChange={(e) => setListPromptDate(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-slate-100"
                />
              </div>
              <div className="pt-4 flex space-x-3">
                <Button
                  variant="outline"
                  className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
                  onClick={() => setListPromptBikeId(null)}
                >
                  Abbrechen
                </Button>
                <Button
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={confirmListing}
                  disabled={!(parseFloat(listPromptPrice) > 0)}
                >
                  <Check className="w-4 h-4 mr-2" /> Inserieren
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Bike Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
          <Card className="w-full max-w-md bg-slate-900 border-slate-800 shadow-2xl animate-in zoom-in-95 duration-200 my-auto">
            <CardHeader>
              <CardTitle>{newBikeData.status === 'Material' ? 'Neues Material hinzufügen' : newBikeData.status === 'Infrastruktur' ? 'Neue Infrastruktur hinzufügen' : 'Neues Fahrrad hinzufügen'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-400">Name / Modell</label>
                <Input 
                  placeholder="z.B. Trek Marlin 7" 
                  value={newBikeData.name}
                  onChange={(e) => setNewBikeData({...newBikeData, name: e.target.value})}
                  className="bg-slate-800 border-slate-700"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400">Einkaufspreis (€)</label>
                  <Input 
                    type="number"
                    value={newBikeData.purchasePrice || ''}
                    onChange={(e) => setNewBikeData({...newBikeData, purchasePrice: parseFloat(e.target.value) || 0})}
                    className="bg-slate-800 border-slate-700"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400">Ziel VK (€)</label>
                  <Input 
                    type="number"
                    value={newBikeData.targetSellingPrice || ''}
                    onChange={(e) => setNewBikeData({...newBikeData, targetSellingPrice: parseFloat(e.target.value) || 0})}
                    className="bg-slate-800 border-slate-700"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400">Status</label>
                  <select 
                    className="w-full bg-slate-800 border-slate-700 text-slate-200 text-sm rounded-md focus:ring-orange-500 focus:border-orange-500 block p-2 h-[42px]"
                    value={newBikeData.status || 'Zu reparieren'}
                    onChange={(e) => setNewBikeData({...newBikeData, status: e.target.value as any})}
                  >
                    <option value="Zu reparieren">Zu reparieren</option>
                    <option value="Infrastruktur">Infrastruktur</option>
                    <option value="Material">Material</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400">Einkaufsdatum</label>
                  <div className="relative">
                    <Input 
                      type={newBikeData.purchaseDate ? "date" : "text"}
                      value={newBikeData.purchaseDate || ''}
                      onChange={(e) => setNewBikeData({...newBikeData, purchaseDate: e.target.value})}
                      onFocus={(e) => {
                        e.target.type = "date";
                        try { (e.target as any).showPicker(); } catch (err) {}
                      }}
                      onBlur={(e) => {
                        if (!e.target.value) e.target.type = "text";
                      }}
                      placeholder="-"
                      className="bg-slate-800 border-slate-700 relative z-10"
                    />
                    {!newBikeData.purchaseDate && (
                      <div 
                        className="absolute inset-0 z-20 cursor-pointer" 
                        onClick={(e) => {
                          const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                          if (input) {
                            input.focus();
                          }
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
              {/* Akquise-Quelle: nur bei Fahrrädern (nicht Material/Infrastruktur) */}
              {newBikeData.status !== 'Material' && newBikeData.status !== 'Infrastruktur' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400">Akquise-Quelle</label>
                  <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
                    <button
                      type="button"
                      onClick={() => setNewBikeData({...newBikeData, acquisitionSource: 'flyer'})}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                        (newBikeData.acquisitionSource ?? 'flyer') === 'flyer'
                          ? 'bg-emerald-600 text-white shadow'
                          : 'text-slate-400 hover:text-slate-300'
                      }`}
                    >
                      <Megaphone className="w-3.5 h-3.5" /> Flyer-Akquise
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewBikeData({...newBikeData, acquisitionSource: 'kleinanzeigen'})}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                        newBikeData.acquisitionSource === 'kleinanzeigen'
                          ? 'bg-blue-600 text-white shadow'
                          : 'text-slate-400 hover:text-slate-300'
                      }`}
                    >
                      <Monitor className="w-3.5 h-3.5" /> Kleinanzeigen
                    </button>
                  </div>
                </div>
              )}
              <div className="flex justify-end space-x-3 pt-4">
                <Button variant="outline" onClick={() => setIsAddModalOpen(false)}>
                  Abbrechen
                </Button>
                <Button onClick={handleAddBikeSubmit} className="bg-orange-500 hover:bg-orange-600 text-white">
                  Speichern
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      {/* Edit Time Modal */}
      {editTimeBikeId && (
        <div className="fixed inset-0 z-50 flex justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
          <Card className="w-full max-w-sm bg-slate-900 border-slate-800 shadow-2xl animate-in zoom-in-95 duration-200 my-auto">
            <CardHeader>
              <CardTitle>Zeit anpassen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400">Stunden</label>
                  <Input 
                    type="number"
                    value={editHours}
                    onChange={(e) => setEditHours(parseInt(e.target.value) || 0)}
                    className="bg-slate-800 border-slate-700"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400">Minuten</label>
                  <Input 
                    type="number"
                    value={editMinutes}
                    onChange={(e) => setEditMinutes(parseInt(e.target.value) || 0)}
                    className="bg-slate-800 border-slate-700"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-400">Oder Gesamtminuten</label>
                <Input 
                  type="number"
                  placeholder="Gesamtminuten..."
                  onChange={(e) => {
                    const totalMins = parseInt(e.target.value) || 0;
                    setEditHours(Math.floor(totalMins / 60));
                    setEditMinutes(totalMins % 60);
                  }}
                  className="bg-slate-800 border-slate-700"
                />
              </div>
              <div className="text-xs text-slate-500 italic">
                Entspricht {(editHours + editMinutes / 60).toFixed(2)} Dezimalstunden
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <Button variant="outline" onClick={() => setEditTimeBikeId(null)}>
                  Abbrechen
                </Button>
                <Button 
                  onClick={() => {
                    const totalSeconds = (editHours * 3600) + (editMinutes * 60);
                    const bike = bikes.find(b => b.id === editTimeBikeId);
                    
                    if (bike) {
                      const diff = totalSeconds - (bike.timeSpentSeconds || 0);
                      let updatedWorkLogs = [...(bike.workLogs || [])];
                      
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

                      updateBike(editTimeBikeId, { 
                        timeSpentSeconds: totalSeconds,
                        workLogs: updatedWorkLogs,
                        ...(bike.startTime ? { startTime: Date.now() } : {})
                      });
                    }
                    setEditTimeBikeId(null);
                  }} 
                  className="bg-orange-500 hover:bg-orange-600 text-white"
                >
                  Speichern
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      {/* Rename Bike Modal */}
      {renameBikeId && (
        <div className="fixed inset-0 z-50 flex justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
          <Card className="w-full max-w-sm bg-slate-900 border-slate-800 shadow-2xl animate-in zoom-in-95 duration-200 my-auto">
            <CardHeader>
              <CardTitle>Fahrrad umbenennen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-400">Neuer Name</label>
                <Input 
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && renameValue.trim()) {
                      updateBike(renameBikeId, { name: renameValue.trim() });
                      setRenameBikeId(null);
                    }
                  }}
                  className="bg-slate-800 border-slate-700"
                  autoFocus
                />
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <Button variant="outline" onClick={() => setRenameBikeId(null)}>
                  Abbrechen
                </Button>
                <Button 
                  onClick={() => {
                    if (renameValue.trim()) {
                      updateBike(renameBikeId, { name: renameValue.trim() });
                      setRenameBikeId(null);
                    }
                  }} 
                  className="bg-orange-500 hover:bg-orange-600 text-white"
                >
                  Speichern
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Scorecard Modal (Erweiterung #3: Rad bewerten vor Ankauf) */}
      {isScorecardOpen && (
        <div className="fixed inset-0 z-[120] flex justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
          <Card className="w-full max-w-md bg-slate-900 border-slate-800 shadow-2xl animate-in zoom-in-95 duration-200 my-auto">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center">
                <FileCheck className="w-5 h-5 mr-2 text-orange-500" /> Rad bewerten vor Ankauf
              </CardTitle>
              <button
                onClick={() => setIsScorecardOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-400">Einkaufspreis (€)</label>
                  <Input type="number" value={scBp} onChange={(e) => setScBp(e.target.value)} placeholder="0" className="bg-slate-800 border-slate-700" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-400">Teilekosten (€)</label>
                  <Input type="number" value={scParts} onChange={(e) => setScParts(e.target.value)} placeholder="0" className="bg-slate-800 border-slate-700" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-400">Erwarteter Verkaufspreis (€)</label>
                <Input type="number" value={scSp} onChange={(e) => setScSp(e.target.value)} placeholder="0" className="bg-slate-800 border-slate-700" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-400">Geschätzte Reparaturzeit</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['<30', '30-60', '1-2', '>2'] as const).map(cat => (
                    <button
                      key={cat}
                      onClick={() => setScTimeCat(cat)}
                      className={`py-2 rounded-md text-xs font-medium transition-colors ${scTimeCat === cat ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                    >
                      {cat === '<30' ? '< 30 min' : cat === '30-60' ? '30–60 min' : cat === '1-2' ? '1–2 h' : '> 2 h'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Ergebnis */}
              <div className={`rounded-xl border p-4 ${scLight.bg} ${scLight.border}`}>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-300">Proj. Deckungsbeitrag</span>
                  <span className="font-bold text-slate-100">{formatCurrency(scProjDB)}</span>
                </div>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-sm text-slate-300">Proj. €/h</span>
                  <span className={`text-2xl font-bold ${scLight.text}`}>{formatCurrency(scProjHw)}/h</span>
                </div>
                <div className={`mt-2 text-xs font-bold uppercase tracking-wider ${scLight.text}`}>{scLight.label}</div>
              </div>

              {/* Historik-Vergleich */}
              <div className="rounded-lg bg-slate-800/50 border border-slate-700/50 p-3 text-sm">
                {historicalWages.length >= 3 ? (
                  <>
                    <p className="text-slate-300">
                      Besser als <span className="font-bold text-emerald-400">{scBetterThan}</span> von <span className="font-bold">{historicalWages.length}</span> deiner verkauften Räder.
                    </p>
                    {scClosest && (
                      <p className="text-slate-400 mt-1">
                        Vergleichbar mit: <span className="text-slate-200">{scClosest.name}</span> <span className="text-slate-500">({formatCurrency(scClosest.wage)}/h)</span>
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-slate-400 italic">Noch zu wenig Daten — Projektion trotzdem anzeigen.</p>
                )}
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <Button variant="outline" onClick={() => setIsScorecardOpen(false)} className="border-slate-700 text-slate-300 hover:bg-slate-800">
                  Ablehnen
                </Button>
                <Button
                  onClick={() => {
                    setNewBikeData({
                      name: '',
                      purchaseDate: new Date().toISOString().split('T')[0],
                      purchasePrice: parseFloat(scBp) || 0,
                      targetSellingPrice: parseFloat(scSp) || 0,
                      status: 'Zu reparieren'
                    });
                    setIsScorecardOpen(false);
                    setIsAddModalOpen(true);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  <Check className="w-4 h-4 mr-2" /> Ankauf erfassen
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Detailed Period Modal */}
      {selectedPeriodIndex !== null && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-6 border-b border-slate-800 bg-slate-900/50">
              <div>
                <h2 className="text-2xl font-bold text-slate-100">
                  Details: {periodDetails[selectedPeriodIndex].label}
                  <span className={`ml-4 text-lg ${periodDetails[selectedPeriodIndex].balance >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    Bilanz: {periodDetails[selectedPeriodIndex].balance > 0 ? '+' : ''}{formatCurrency(periodDetails[selectedPeriodIndex].balance)}
                  </span>
                </h2>
                <p className="text-sm text-slate-400">Übersicht der Aktivitäten in diesem Zeitraum</p>
              </div>
              <button 
                onClick={() => setSelectedPeriodIndex(null)}
                className="p-2 rounded-full text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-all"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-8">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                  <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1">Gekauft ({periodDetails[selectedPeriodIndex].bought.length})</p>
                  <p className="text-xl font-bold text-slate-100">{formatCurrency(periodDetails[selectedPeriodIndex].totalPurchasePrice)}</p>
                </div>
                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                  <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1">Verkauft ({periodDetails[selectedPeriodIndex].sold.length})</p>
                  <p className="text-xl font-bold text-slate-100">{formatCurrency(periodDetails[selectedPeriodIndex].totalSellingPrice)}</p>
                </div>
                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                  <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1">Arbeitszeit</p>
                  <p className="text-xl font-bold text-slate-100">{periodDetails[selectedPeriodIndex].totalHours.toFixed(1)}h</p>
                </div>
                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                  <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1">Material</p>
                  <p className="text-xl font-bold text-slate-100">{formatCurrency(periodDetails[selectedPeriodIndex].totalExpenses)}</p>
                </div>
              </div>

              {/* Activity Lists */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Inventory Changes */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest border-b border-slate-800 pb-2">Bestand</h3>
                  {periodDetails[selectedPeriodIndex].bought.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-emerald-500">Neu Gekauft:</p>
                      <ul className="space-y-1">
                        {periodDetails[selectedPeriodIndex].bought.map((item, i) => (
                          <li key={i} className="text-sm text-slate-300 flex justify-between items-center">
                            <span className="flex items-center"><Plus className="w-3 h-3 mr-2 text-emerald-500" /> {item.name}</span>
                            <span className="text-slate-500">{formatCurrency(item.price)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {periodDetails[selectedPeriodIndex].sold.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-orange-500">Verkauft:</p>
                      <ul className="space-y-1">
                        {periodDetails[selectedPeriodIndex].sold.map((item, i) => (
                          <li key={i} className="text-sm text-slate-300 flex justify-between items-center">
                            <span className="flex items-center"><Check className="w-3 h-3 mr-2 text-orange-500" /> {item.name}</span>
                            <span className="text-slate-500">{formatCurrency(item.price)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {periodDetails[selectedPeriodIndex].bought.length === 0 && periodDetails[selectedPeriodIndex].sold.length === 0 && (
                    <p className="text-sm text-slate-600 italic">Keine Bestandsänderungen.</p>
                  )}
                </div>

                {/* Work & Expenses */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest border-b border-slate-800 pb-2">Arbeit & Material</h3>
                  {periodDetails[selectedPeriodIndex].workSessions.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-blue-500">Arbeitszeiten:</p>
                      <ul className="space-y-1">
                        {periodDetails[selectedPeriodIndex].workSessions.map((session, i) => (
                          <li key={i} className="text-sm text-slate-300 flex justify-between">
                            <span>{session.bikeName}</span>
                            <span className="text-slate-500">{(session.duration / 3600).toFixed(1)}h</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {periodDetails[selectedPeriodIndex].materialExpenses.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-purple-500">Materialausgaben:</p>
                      <ul className="space-y-1">
                        {periodDetails[selectedPeriodIndex].materialExpenses.map((exp, i) => (
                          <li key={i} className="text-sm text-slate-300 flex justify-between">
                            <span className="truncate pr-4">{exp.bikeName}: {exp.desc}</span>
                            <span className="text-slate-500 whitespace-nowrap">{formatCurrency(exp.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {periodDetails[selectedPeriodIndex].workSessions.length === 0 && periodDetails[selectedPeriodIndex].materialExpenses.length === 0 && (
                    <p className="text-sm text-slate-600 italic">Keine Ausgaben oder Arbeitszeiten.</p>
                  )}
                </div>
              </div>
            </div>
            
            <div className="p-6 border-t border-slate-800 bg-slate-900/50 flex justify-end">
              <Button onClick={() => setSelectedPeriodIndex(null)} className="bg-slate-800 hover:bg-slate-700 text-slate-200">
                Schließen
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
