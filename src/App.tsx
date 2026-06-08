import React, { useState, useEffect, useCallback, Component, ReactNode } from 'react';
import { TrackingModule } from './components/TrackingModule';
import { WorkshopModule } from './components/WorkshopModule';
import { DailyTodoModule } from './components/DailyTodoModule';
import { ReceiptsModule } from './components/ReceiptsModule';
import { Bike, DailyTodo, Log, ServiceRequest, Receipt, InventoryItem, GroupOrder } from './types';
import { BarChart3, Wrench, CheckSquare, Download, FileText, Image, User, X, LogIn, LogOut, RotateCcw, Calendar, RefreshCw, CloudUpload } from 'lucide-react';
import { auth, db, signInWithGoogle, logout } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, getDocs, increment, arrayUnion } from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo?: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Mock Data
const initialBikes: Bike[] = [
  {
    id: 'b1',
    name: 'Winora Holiday',
    status: 'Verkauft',
    purchasePrice: 50,
    purchaseDate: '2025-09-30',
    sellingPrice: 160,
    saleDate: '2025-10-14',
    targetSellingPrice: 160,
    timeSpentSeconds: 3 * 3600,
    lastModified: Date.now(),
    expenses: [{ id: 'e1', description: 'Material', amount: 4, date: '2025-10-05' }],
    checklist: [],
    notes: '',
    photos: [],
  },
  {
    id: 'b2',
    name: 'GIANT Terrago',
    status: 'Verkauft',
    purchasePrice: 15,
    purchaseDate: '2025-10-07',
    sellingPrice: 30,
    saleDate: '2025-10-17',
    targetSellingPrice: 30,
    timeSpentSeconds: 3 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: 'war komplett kaputt, Schaltung, Lagerschaden -> Keine kaputten Bastler räder mehr kaufen.',
    photos: [],
  },
  {
    id: 'b3',
    name: 'Platzhalter für november',
    status: 'Verkauft',
    purchasePrice: 0,
    purchaseDate: '2025-11-01',
    sellingPrice: 0,
    saleDate: '2025-11-01',
    targetSellingPrice: 0,
    timeSpentSeconds: 0,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: 'Platzhalter für november',
    photos: [],
  },
  {
    id: 'b4',
    name: 'KCT 02.15',
    status: 'Verkauft',
    purchasePrice: 50,
    purchaseDate: '2025-12-07',
    sellingPrice: 185,
    saleDate: '2026-01-25',
    targetSellingPrice: 185,
    timeSpentSeconds: 9.5 * 3600,
    lastModified: Date.now(),
    expenses: [{ id: 'e4', description: 'Material', amount: 7.98, date: '2025-12-20' }],
    checklist: [],
    notes: 'ABUS Schloss gabs dazu, neue Bremsbeläge, neue Bremszüge, lager neu geffettet + neue Lagerkugeln, poliert + gereinigt, Shimano Deore XT',
    photos: [],
  },
  {
    id: 'b5',
    name: 'Adler 28 Zoll Herrenfahrrad',
    status: 'Verkauft',
    purchasePrice: 100,
    purchaseDate: '2025-12-16',
    sellingPrice: 200,
    saleDate: '2025-12-22',
    targetSellingPrice: 200,
    timeSpentSeconds: 2 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: '',
    photos: [],
  },
  {
    id: 'b6',
    name: 'Hercules Damenfahrrad 26 Zoll',
    status: 'Verkauft',
    purchasePrice: 25,
    purchaseDate: '2025-12-29',
    sellingPrice: 120,
    saleDate: '2026-03-14',
    targetSellingPrice: 120,
    timeSpentSeconds: 7 * 3600,
    lastModified: Date.now(),
    expenses: [{ id: 'e6', description: 'Material', amount: 48.39, date: '2026-01-15' }],
    checklist: [],
    notes: 'neue Weißwandreifen, neues Felgenband, neue Schläuche, poliert + gereinigt',
    photos: [],
  },
  {
    id: 'b7',
    name: 'Vintage Rennrad 28 Zoll',
    status: 'Verkauft',
    purchasePrice: 70,
    purchaseDate: '2026-01-15',
    sellingPrice: 100,
    saleDate: '2026-02-21',
    targetSellingPrice: 100,
    timeSpentSeconds: 2 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: 'Weiterverkauf ohne groß Aufwand, ist auf ebay nicht wirklich weggegangen, daher "100€ und du holst es heute exit" bei 120€ auf ebay ohne wirkliche anfragen.',
    photos: [],
  },
  {
    id: 'b8',
    name: 'Bergamont 28 Zoll Balami N7',
    status: 'Verkauft',
    purchasePrice: 40,
    purchaseDate: '2026-01-19',
    sellingPrice: 160,
    saleDate: '2026-01-29',
    targetSellingPrice: 160,
    timeSpentSeconds: 1 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: 'Bilder auf dem Weg nach Hause gemacht, easy money',
    photos: [],
  },
  {
    id: 'b9',
    name: 'Fashion Line Fahrrad mit Tiefeneinstieg',
    status: 'Verkauft',
    purchasePrice: 2,
    purchaseDate: '2026-02-05',
    sellingPrice: 70,
    saleDate: '2026-02-06',
    targetSellingPrice: 70,
    timeSpentSeconds: 0.33 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: 'Geschenkt bekommen Anna Lena 1/2, 4€ für Schlauch ausgegeben',
    photos: [],
  },
  {
    id: 'b10',
    name: 'Hercules palladio blau 28 Zoll',
    status: 'Verkauft',
    purchasePrice: 15,
    purchaseDate: '2026-02-10',
    sellingPrice: 65,
    saleDate: '2026-02-16',
    targetSellingPrice: 65,
    timeSpentSeconds: 2.5 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: 'Arbeitszeit = hauptsächlich wegzeit. Oma verwechselte Fahrräder, kauf war Notlösung um nach hause zu kommen, Pegasus hellblau für 40 ausgehandelt und probegefahren -> fremdverschulden. inkl. 2 schlösser (1 kabel, 1 gliederschloss)',
    photos: [],
  },
  {
    id: 'b11',
    name: 'Hercules Vintage Rennrad',
    status: 'Verkauft',
    purchasePrice: 55,
    purchaseDate: '2026-02-11',
    sellingPrice: 160,
    saleDate: '2026-02-16',
    targetSellingPrice: 160,
    timeSpentSeconds: 4.3 * 3600,
    lastModified: Date.now(),
    expenses: [{ id: 'e11', description: 'Material', amount: 20.15, date: '2026-02-13' }],
    checklist: [],
    notes: 'Fahrradkarte, platten, rostiges Oberrohr. Rahmen ansonten ok, strategie: aufwenig flip, rahmen polieren & versiegeln, rost als patina verkaufen. Neu: Griffband, Schlauch, Anmerkung',
    photos: [],
  },
  {
    id: 'b12',
    name: 'Elops Decathlon Fahrrad comfort',
    status: 'Verkauft',
    purchasePrice: 50,
    purchaseDate: '2026-02-12',
    sellingPrice: 175,
    saleDate: '2026-03-01',
    targetSellingPrice: 175,
    timeSpentSeconds: 5 * 3600,
    lastModified: Date.now(),
    expenses: [{ id: 'e12', description: 'Material', amount: 28, date: '2026-02-20' }],
    checklist: [],
    notes: '1,5h der Arbeitszeit in Mittagspause der Schule - zeit effektiv genutzt, kein realer Zeitverlust. Zahnkranz rostig, alle teile die rosten können rostig. reifen dreckig aber halten luft. -> Reinigung. Material: Neue Kette, neuer Zahnkranz, Viele Teile USR gereinigt',
    photos: [],
  },
  {
    id: 'b13',
    name: 'Kreidler RT',
    status: 'Verkauft',
    purchasePrice: 125,
    purchaseDate: '2026-02-13',
    sellingPrice: 120,
    saleDate: '2026-03-14',
    targetSellingPrice: 120,
    timeSpentSeconds: 2 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: 'Schloss, Federgabel fest, umwerfer vorne einstelle',
    photos: [],
  },
  {
    id: 'b14',
    name: 'Peugot Bastlerrad Anna Lena',
    status: 'Verkauft',
    purchasePrice: 2,
    purchaseDate: '2026-02-21',
    sellingPrice: 10,
    saleDate: '2026-02-21',
    targetSellingPrice: 10,
    timeSpentSeconds: 0.16 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: 'von Anna Lena, einfach weg das Ding',
    photos: [],
  },
  {
    id: 'b15',
    name: 'Pegasus Solero SL 50cm RH',
    status: 'Verkauft',
    purchasePrice: 20,
    purchaseDate: '2026-02-21',
    sellingPrice: 55,
    saleDate: '2026-02-26',
    targetSellingPrice: 55,
    timeSpentSeconds: 1.5 * 3600,
    lastModified: Date.now(),
    expenses: [{ id: 'e15', description: 'Material', amount: 9.60, date: '2026-02-23' }],
    checklist: [],
    notes: 'Schlauch neu, dreckig, Sattel kaputt, Licht mit Panzertape',
    photos: [],
  },
  {
    id: 'b16',
    name: 'Haibike Seet 7',
    status: 'Verkauft',
    purchasePrice: 260,
    purchaseDate: '2026-02-24',
    sellingPrice: 360,
    saleDate: '2026-03-22',
    targetSellingPrice: 360,
    timeSpentSeconds: 0.25 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: 'mit abholung, NAGELNEU BANGER INSTANT RESELL, Glück beim Kauf',
    photos: [],
  },
  {
    id: 'b17',
    name: 'Scott Sportster 28 Zoll mit Scheibenbremsen',
    status: 'Verkauft',
    purchasePrice: 70,
    purchaseDate: '2026-02-28',
    sellingPrice: 225,
    saleDate: '2026-03-05',
    targetSellingPrice: 225,
    timeSpentSeconds: 3.1 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: '',
    photos: [],
  },
  {
    id: 'b18',
    name: 'Infrastruktur Feburar',
    status: 'Zu reparieren',
    purchasePrice: 63,
    purchaseDate: '2026-02-28',
    sellingPrice: null,
    saleDate: null,
    targetSellingPrice: null,
    timeSpentSeconds: 0,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: 'Kassettenabzieher, Ultraschallreiniger, Werkzeugwand',
    photos: [],
  },
  {
    id: 'b19',
    name: 'Infrastruktur März',
    status: 'Zu reparieren',
    purchasePrice: 149.90,
    purchaseDate: '2026-03-02',
    sellingPrice: null,
    saleDate: null,
    targetSellingPrice: null,
    timeSpentSeconds: 0,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: '5 Bremsenreiniger, 6 Paar Handschuhe, Stativstrahler mit 1900 Lumen, Deckenfeuchtraumlampe, WD40, Silikonspray, Kettenöl Dry Lube 1200ml, Nitril Chemikalienhandschuhe, Stahlwolle, Scheibenbremsen Einstell und Richtwerkzeug, Druckreiniger Parkside, Ultrtraschallreiniger Reinigerkonzentrat',
    photos: [],
  },
  {
    id: 'b20',
    name: 'Rennrad mit Shimano 600er',
    status: 'Inseriert',
    purchasePrice: 130,
    purchaseDate: '2026-03-10',
    sellingPrice: null,
    saleDate: null,
    targetSellingPrice: 158,
    timeSpentSeconds: 2 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: 'auf eBay',
    photos: [],
  },
  {
    id: 'b21',
    name: 'Fashion Line Damenrad ohne Schaltzug',
    status: 'Zu reparieren',
    purchasePrice: 30,
    purchaseDate: '2026-03-12',
    sellingPrice: null,
    saleDate: null,
    targetSellingPrice: 81.50,
    timeSpentSeconds: 3.25 * 3600,
    lastModified: Date.now(),
    expenses: [{ id: 'e21', description: 'Material', amount: 6, date: '2026-03-15' }],
    checklist: [],
    notes: 'Schaltzug der Schaltung nicht vorhanden, Sturmey Archer Ersatz kabelverankerung bestellt. Dreckig, Fehlkauf (war als Defekt mit Platten deklariert, Schaltung nicht aufgefallen)',
    photos: [],
  },
  {
    id: 'b22',
    name: 'nebenan, Christina, 2 Räder',
    status: 'Verkauft',
    purchasePrice: 0,
    purchaseDate: '2026-03-12',
    sellingPrice: 60,
    saleDate: '2026-03-22',
    targetSellingPrice: 60,
    timeSpentSeconds: 1.5 * 3600,
    lastModified: Date.now(),
    expenses: [{ id: 'e22', description: 'Material', amount: 8, date: '2026-03-15' }],
    checklist: [],
    notes: '2 Fahrräder',
    photos: [],
  },
  {
    id: 'b23',
    name: 'Fahrrad von Nachbar',
    status: 'Verkauft',
    purchasePrice: 0,
    purchaseDate: '2026-03-15',
    sellingPrice: 40,
    saleDate: '2026-03-21',
    targetSellingPrice: 40,
    timeSpentSeconds: 1 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: 'Geschenkt bekommen',
    photos: [],
  },
  {
    id: 'b24',
    name: 'Decathlon Triban RC100',
    status: 'Verkauft',
    purchasePrice: 150,
    purchaseDate: '2026-03-16',
    sellingPrice: 200,
    saleDate: '2026-03-20',
    targetSellingPrice: 200,
    timeSpentSeconds: 1 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: 'An Freund verkauft, Abholung dauerte 45 min, 15 min putzen',
    photos: [],
  },
  {
    id: 'b25',
    name: 'Winora Damenfahrrad',
    status: 'Verkauft',
    purchasePrice: 70,
    purchaseDate: '2026-03-16',
    sellingPrice: 130,
    saleDate: '2026-03-22',
    targetSellingPrice: 130,
    timeSpentSeconds: 2 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: 'Abholung Dauer 1h15 min, Rahmen gewaschen & poliert.',
    photos: [],
  },
  {
    id: 'b26',
    name: 'nebenan Anna-Lena',
    status: 'Verkauft',
    purchasePrice: 0,
    purchaseDate: '2026-03-20',
    sellingPrice: 20,
    saleDate: '2026-03-20',
    targetSellingPrice: 20,
    timeSpentSeconds: 1 * 3600,
    lastModified: Date.now(),
    expenses: [{ id: 'e26', description: 'Material', amount: 5, date: '2026-03-20' }],
    checklist: [],
    notes: '',
    photos: [],
  },
  {
    id: 'b27',
    name: 'Damenfahrrad mit 2 Körben',
    status: 'Inseriert',
    purchasePrice: 50,
    purchaseDate: '2026-03-22',
    sellingPrice: null,
    saleDate: null,
    targetSellingPrice: 100.12,
    timeSpentSeconds: 3.58 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: 'auf eBay',
    photos: [],
  },
  {
    id: 'b28',
    name: 'VSF Fahrradmanufaktur T50',
    status: 'Zu reparieren',
    purchasePrice: 120,
    purchaseDate: '2026-03-23',
    sellingPrice: null,
    saleDate: null,
    targetSellingPrice: 137.50,
    timeSpentSeconds: 1.25 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: '',
    photos: [],
  },
  {
    id: 'b29',
    name: 'Pegasus mit Deore XT',
    status: 'Verkauft',
    purchasePrice: 20,
    purchaseDate: '2026-03-23',
    sellingPrice: 50,
    saleDate: '2026-03-24',
    targetSellingPrice: 50,
    timeSpentSeconds: 1 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: '',
    photos: [],
  },
  {
    id: 'b30',
    name: 'Stevens Rider 28 Zoll',
    status: 'Zu reparieren',
    purchasePrice: 150,
    purchaseDate: '2026-03-23',
    sellingPrice: null,
    saleDate: null,
    targetSellingPrice: 152.24,
    timeSpentSeconds: 0.16 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: 'Wurde geliefert für 20€ Aufpreis (auf 130 gehandelt, 150 gezahlt), keine Schutzbleche, Rad vorne hat Spiel (Nabendynamo, Federgabel quitscht. keine Konusschrauben direkt in Sicht)',
    photos: [],
  },
  {
    id: 'b31',
    name: 'nebenan Volker',
    status: 'Zu reparieren',
    purchasePrice: 0,
    purchaseDate: '2026-03-23',
    sellingPrice: null,
    saleDate: null,
    targetSellingPrice: 50,
    timeSpentSeconds: 0,
    lastModified: Date.now(),
    expenses: [{ id: 'e31', description: 'Material', amount: 52.12, date: '2026-03-24' }],
    checklist: [],
    notes: 'Bremsbeläge, Kassette USR, Kette neu',
    photos: [],
  },
  {
    id: 'b32',
    name: 'nebenan Nina',
    status: 'Verkauft',
    purchasePrice: 0,
    purchaseDate: '2026-03-24',
    sellingPrice: 20,
    saleDate: '2026-03-24',
    targetSellingPrice: 20,
    timeSpentSeconds: 0.33 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: 'Schaltung Einstellen',
    photos: [],
  },
  {
    id: 'b33',
    name: 'nebenan Beate',
    status: 'Verkauft',
    purchasePrice: 0,
    purchaseDate: '2026-03-24',
    sellingPrice: 20,
    saleDate: '2026-03-24',
    targetSellingPrice: 20,
    timeSpentSeconds: 1 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: 'Putzen, Reputation: versäumter Termin, daher unaufgeforderte politur',
    photos: [],
  },
  {
    id: 'b34',
    name: 'nebenan Alexandra',
    status: 'Zu reparieren',
    purchasePrice: 0,
    purchaseDate: '2026-03-25',
    sellingPrice: null,
    saleDate: null,
    targetSellingPrice: null,
    timeSpentSeconds: 0.3 * 3600,
    lastModified: Date.now(),
    expenses: [{ id: 'e34', description: 'Material', amount: 4.20, date: '2026-03-25' }],
    checklist: [],
    notes: 'noch nicht abgeholt, generalüberholung',
    photos: [],
  },
  {
    id: 'b35',
    name: 'nebenan Jan',
    status: 'Zu reparieren',
    purchasePrice: 0,
    purchaseDate: '2026-03-25',
    sellingPrice: null,
    saleDate: null,
    targetSellingPrice: null,
    timeSpentSeconds: 0,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: '',
    photos: [],
  },
  {
    id: 'b36',
    name: 'Cube MTB mit Deore XT',
    status: 'Zu reparieren',
    purchasePrice: 130,
    purchaseDate: '2026-03-25',
    sellingPrice: null,
    saleDate: null,
    targetSellingPrice: 144,
    timeSpentSeconds: 1 * 3600,
    lastModified: Date.now(),
    expenses: [],
    checklist: [],
    notes: '',
    photos: [],
  }
];

// Error Boundary Component
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-red-500/30 p-8 rounded-2xl max-w-md w-full text-center shadow-2xl">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <X className="w-8 h-8 text-red-500" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-4">Hoppla! Etwas ist schiefgelaufen.</h1>
            <p className="text-slate-400 mb-6">
              Die Anwendung hat einen unerwarteten Fehler festgestellt. Bitte lade die Seite neu.
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-6 rounded-xl transition-all flex items-center justify-center"
            >
              <RotateCcw className="w-5 h-5 mr-2" />
              Seite neu laden
            </button>
            {process.env.NODE_ENV === 'development' && (
              <div className="mt-6 p-4 bg-black/40 rounded-lg text-left overflow-auto max-h-40">
                <code className="text-xs text-red-400">{this.state.error?.toString()}</code>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  const [activeTab, setActiveTab] = useState<'tracking' | 'workshop' | 'daily' | 'receipts'>('tracking');
  const [trackingScrollPos, setTrackingScrollPos] = useState(0);
  const [isTiedCapitalExpanded, setIsTiedCapitalExpanded] = useState(false);
  
  const handleTabChange = (tab: 'tracking' | 'workshop' | 'daily' | 'receipts') => {
    if (activeTab === 'tracking') {
      setTrackingScrollPos(window.scrollY);
    }
    setActiveTab(tab);
  };
  
  // Load from local storage or use initial data
  const [bikes, setBikes] = useState<Bike[]>(() => {
    const saved = localStorage.getItem('flipbike_bikes');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (e) {
        console.error('Failed to parse bikes from local storage', e);
      }
    }
    return initialBikes;
  });

  const [dailyTodos, setDailyTodos] = useState<DailyTodo[]>(() => {
    const saved = localStorage.getItem('flipbike_todos');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse todos from local storage', e);
      }
    }
    return [];
  });

  const [serviceRequests, setServiceRequests] = useState<ServiceRequest[]>(() => {
    const saved = localStorage.getItem('flipbike_service_requests');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse service requests from local storage', e);
      }
    }
    return [];
  });

  const [receipts, setReceipts] = useState<Receipt[]>(() => {
    const saved = localStorage.getItem('flipbike_receipts');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse receipts from local storage', e);
      }
    }
    return [];
  });

  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>(() => {
    const saved = localStorage.getItem('flipbike_inventory_items');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse inventory items from local storage', e);
      }
    }
    return [];
  });

  const [groupOrders, setGroupOrders] = useState<GroupOrder[]>(() => {
    const saved = localStorage.getItem('flipbike_group_orders');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse group orders from local storage', e);
      }
    }
    return [];
  });

  const [activeWorkshopBikeId, setActiveWorkshopBikeId] = useState<string | null>(() => {
    return localStorage.getItem('flipbike_active_workshop_id');
  });

  const [logs, setLogs] = useState<Log[]>(() => {
    const saved = localStorage.getItem('flipbike_logs');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse logs from local storage', e);
      }
    }
    return [];
  });

  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isLogsModalOpen, setIsLogsModalOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

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
  const [logFilter, setLogFilter] = useState<'all' | 'tracking' | 'workshop' | 'stopwatch' | 'system'>('all');
  const [logSortOrder, setLogSortOrder] = useState<'desc' | 'asc'>('desc');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [user, setUser] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error("Login failed:", error);
    } finally {
      setIsLoggingIn(false);
      setIsProfileMenuOpen(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      if (!currentUser) setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const migrateData = async () => {
      if (!isAuthReady || !user) return;

      try {
        const q = query(collection(db, 'bikes'), where('userId', '==', user.uid));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
          console.log('Firestore is empty, migrating local data...');
          // Migrate bikes
          const savedBikes = localStorage.getItem('flipbike_bikes');
          let bikesToMigrate = savedBikes ? JSON.parse(savedBikes) : initialBikes;
          
          // If local storage is empty or just has initial bikes, ensure we have the full initial set
          if (!bikesToMigrate || bikesToMigrate.length === 0) {
            bikesToMigrate = initialBikes;
          }

          for (const bike of bikesToMigrate) {
            await setDoc(doc(db, 'bikes', bike.id), { ...bike, userId: user.uid });
          }

          // Migrate todos
          const savedTodos = localStorage.getItem('flipbike_todos');
          if (savedTodos) {
            const todosToMigrate = JSON.parse(savedTodos);
            for (const todo of todosToMigrate) {
              await setDoc(doc(db, 'todos', todo.id), { ...todo, userId: user.uid });
            }
          }
          
          // Migrate logs
          const savedLogs = localStorage.getItem('flipbike_logs');
          if (savedLogs) {
            const logsToMigrate = JSON.parse(savedLogs);
            for (const log of logsToMigrate) {
              await setDoc(doc(db, 'logs', log.id), { ...log, userId: user.uid });
            }
          }
          console.log('Migration complete.');
        }
      } catch (error) {
        console.error('Migration failed:', error);
      } finally {
        setIsLoading(false);
      }
    };

    migrateData();
  }, [user, isAuthReady]);

  useEffect(() => {
    if (!isAuthReady || !user) return;

    const qBikes = query(collection(db, 'bikes'), where('userId', '==', user.uid));
    const unsubBikes = onSnapshot(qBikes, (snapshot) => {
      const fetchedBikes = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Bike));
      setBikes(fetchedBikes);
      setIsLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'bikes');
      setIsLoading(false);
    });

    const qTodos = query(collection(db, 'todos'), where('userId', '==', user.uid));
    const unsubTodos = onSnapshot(qTodos, (snapshot) => {
      const fetchedTodos = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as DailyTodo));
      setDailyTodos(fetchedTodos);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'todos'));

    const qServiceRequests = query(collection(db, 'serviceRequests'), where('userId', '==', user.uid));
    const unsubServiceRequests = onSnapshot(qServiceRequests, (snapshot) => {
      const fetchedRequests = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ServiceRequest));
      setServiceRequests(fetchedRequests);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'serviceRequests'));

    const qLogs = query(collection(db, 'logs'), where('userId', '==', user.uid));
    const unsubLogs = onSnapshot(qLogs, (snapshot) => {
      const fetchedLogs = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Log));
      setLogs(fetchedLogs.sort((a, b) => b.timestamp - a.timestamp));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'logs'));

    const qReceipts = query(collection(db, 'receipts'), where('userId', '==', user.uid));
    const unsubReceipts = onSnapshot(qReceipts, (snapshot) => {
      const fetchedReceipts = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Receipt));
      setReceipts(fetchedReceipts);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'receipts'));

    const qInventoryItems = query(collection(db, 'inventoryItems'), where('userId', '==', user.uid));
    const unsubInventoryItems = onSnapshot(qInventoryItems, (snapshot) => {
      const fetchedInventoryItems = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as InventoryItem));
      setInventoryItems(fetchedInventoryItems);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'inventoryItems'));

    const qOrders = query(collection(db, 'orders'), where('userId', '==', user.uid));
    const unsubOrders = onSnapshot(qOrders, (snapshot) => {
      const fetchedOrders = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as GroupOrder));
      setGroupOrders(fetchedOrders);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'orders'));

    return () => {
      unsubBikes();
      unsubTodos();
      unsubServiceRequests();
      unsubLogs();
      unsubReceipts();
      unsubInventoryItems();
      unsubOrders();
    };
  }, [user, isAuthReady]);

  // Save to local storage whenever state changes (fallback)
  useEffect(() => {
    if (!isLoading) {
      localStorage.setItem('flipbike_bikes', JSON.stringify(bikes));
    }
  }, [bikes, isLoading]);

  useEffect(() => {
    if (!isLoading) {
      localStorage.setItem('flipbike_inventory_items', JSON.stringify(inventoryItems));
    }
  }, [inventoryItems, isLoading]);

  useEffect(() => {
    if (!isLoading) {
      localStorage.setItem('flipbike_todos', JSON.stringify(dailyTodos));
    }
  }, [dailyTodos, isLoading]);

  useEffect(() => {
    if (!isLoading) {
      localStorage.setItem('flipbike_service_requests', JSON.stringify(serviceRequests));
    }
  }, [serviceRequests, isLoading]);

  useEffect(() => {
    if (activeWorkshopBikeId && !isLoading) {
      localStorage.setItem('flipbike_active_workshop_id', activeWorkshopBikeId);
    } else if (!isLoading) {
      localStorage.removeItem('flipbike_active_workshop_id');
    }
  }, [activeWorkshopBikeId, isLoading]);

  useEffect(() => {
    if (!isLoading) {
      localStorage.setItem('flipbike_logs', JSON.stringify(logs));
    }
  }, [logs, isLoading]);

  useEffect(() => {
    if (!isLoading) {
      localStorage.setItem('flipbike_receipts', JSON.stringify(receipts));
    }
  }, [receipts, isLoading]);

  const addLog = useCallback((message: string, module: Log['module'] = 'system', revertAction?: Log['revertAction']) => {
    const newLog: Log = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      message,
      module,
    };
    if (revertAction) newLog.revertAction = revertAction;
    if (auth.currentUser?.uid) newLog.userId = auth.currentUser.uid;
    
    // Optimistically update local state
    setLogs(prev => [newLog, ...prev].slice(0, 1000));

    if (auth.currentUser) {
      setDoc(doc(db, 'logs', newLog.id), newLog).catch(e => {
        console.error("Failed to save log to DB:", e);
      });
    }
  }, []);

  const updateBike = useCallback((id: string, updates: Partial<Bike>) => {
    const bike = bikes.find(b => b.id === id);
    if (bike) {
      const oldValues: Partial<Bike> = {};
      let shouldLog = false;
      let message = '';
      let module: Log['module'] = 'tracking';

      if (updates.status && updates.status !== bike.status) {
        oldValues.status = bike.status;
        message = `Status geändert für "${bike.name}": ${bike.status} -> ${updates.status}`;
        shouldLog = true;
      } else if (updates.name && updates.name !== bike.name) {
        oldValues.name = bike.name;
        message = `Fahrrad umbenannt: "${bike.name}" -> "${updates.name}"`;
        shouldLog = true;
      } else if (updates.purchasePrice !== undefined && updates.purchasePrice !== bike.purchasePrice) {
        oldValues.purchasePrice = bike.purchasePrice;
        message = `Einkaufspreis geändert für "${bike.name}": ${bike.purchasePrice} -> ${updates.purchasePrice}`;
        shouldLog = true;
      } else if (updates.sellingPrice !== undefined && updates.sellingPrice !== bike.sellingPrice) {
        oldValues.sellingPrice = bike.sellingPrice;
        message = `Verkaufspreis geändert für "${bike.name}": ${bike.sellingPrice} -> ${updates.sellingPrice}`;
        shouldLog = true;
      } else if (updates.expenses && updates.expenses.length !== bike.expenses.length) {
        oldValues.expenses = bike.expenses;
        message = `Ausgaben geändert für "${bike.name}"`;
        shouldLog = true;
        module = 'workshop';
      } else if (updates.checklist && updates.checklist.length !== bike.checklist.length) {
        oldValues.checklist = bike.checklist;
        message = `Checkliste geändert für "${bike.name}"`;
        shouldLog = true;
        module = 'workshop';
      } else if (updates.notes !== undefined && updates.notes !== bike.notes) {
        oldValues.notes = bike.notes;
        message = `Notizen geändert für "${bike.name}"`;
        shouldLog = true;
        module = 'workshop';
      }

      if (shouldLog) {
        addLog(message, module, { type: 'update', data: { id, oldValues } });
      }
      
      // Prepare local state update (handle increment for local state)
      const localUpdates = { ...updates };
      if (updates.timeSpentSeconds && typeof updates.timeSpentSeconds === 'object' && 'methodName' in (updates.timeSpentSeconds as any)) {
        // This is likely a FieldValue.increment
        // We can't easily get the value from it, so we'll assume the caller might have passed it differently
        // Actually, let's check for a common pattern or just calculate it if we can.
        // For now, let's just use the numeric value if the caller passed it as a number, 
        // but since we want to use increment for DB, we'll have to be clever.
      }

      const updatedBike = { ...bike, ...updates, lastModified: Date.now() };
      
      // If timeSpentSeconds is an increment, we need to calculate the new local value
      if (updates.timeSpentSeconds && typeof updates.timeSpentSeconds === 'object') {
        // Firestore FieldValue objects don't expose their value easily in the SDK, 
        // but we can try to detect it.
        // A better way is to pass the numeric diff in a separate field or just handle it here.
        // Since we know we use increment(n), we can't easily get 'n'.
      }

      // Let's simplify: if the update is an increment, we'll just let the snapshot handle it 
      // or we can pass the numeric value for local state.
      
      // Actually, I'll just change how WorkshopModule calls it.
      // But wait, I already changed WorkshopModule.
      
      // Let's fix updateBike to be smarter.
      const finalLocalUpdates = { ...updates };
      // Check for increment (hacky but works for local optimistic update)
      if (updates.timeSpentSeconds && typeof updates.timeSpentSeconds === 'object' && (updates.timeSpentSeconds as any)._methodName === 'FieldValue.increment') {
          const operand = (updates.timeSpentSeconds as any)._operand;
          if (typeof operand === 'number') {
              finalLocalUpdates.timeSpentSeconds = (bike.timeSpentSeconds || 0) + operand;
          }
      }

      const localUpdatedBike = { ...bike, ...finalLocalUpdates, lastModified: Date.now() };
      
      // Optimistically update local state
      setBikes((prev) => prev.map((b) => (b.id === id ? localUpdatedBike : b)));

      if (auth.currentUser) {
        setIsSyncing(true);
        updateDoc(doc(db, 'bikes', id), { ...updates, lastModified: Date.now() })
          .then(() => setIsSyncing(false))
          .catch(e => {
            setIsSyncing(false);
            // If it fails, the snapshot listener will eventually revert it if it was a hard failure,
            // but with persistence enabled, it should eventually succeed.
            console.error("Optimistic update failed in DB:", e);
            // We don't throw here to avoid crashing the UI, but we log it.
          });
      }
    }
  }, [addLog, bikes]);

  const deleteBike = useCallback((id: string) => {
    const bike = bikes.find(b => b.id === id);
    if (bike) {
      addLog(`Fahrrad gelöscht: "${bike.name}"`, 'tracking', { type: 'delete', data: { ...bike } });
    }
    
    // Optimistically update local state
    setBikes((prev) => prev.filter((b) => b.id !== id));

    if (auth.currentUser) {
      deleteDoc(doc(db, 'bikes', id)).catch(e => {
        handleFirestoreError(e, OperationType.DELETE, 'bikes');
      });
    }
    
    if (activeWorkshopBikeId === id) {
      setActiveWorkshopBikeId(null);
    }
  }, [addLog, bikes, activeWorkshopBikeId]);

  const deleteInventoryItem = useCallback((id: string) => {
    const item = inventoryItems.find(i => i.id === id);
    if (item) {
      addLog(`Material gelöscht: "${item.name}"`, 'workshop', { type: 'delete', data: { ...item } });
    }
    
    // Optimistically update local state
    setInventoryItems((prev) => prev.filter((i) => i.id !== id));

    if (auth.currentUser) {
      deleteDoc(doc(db, 'inventoryItems', id)).catch(e => {
        handleFirestoreError(e, OperationType.DELETE, 'inventoryItems');
      });
    }
  }, [addLog, inventoryItems]);

  const addGroupOrder = useCallback((order: Omit<GroupOrder, 'id' | 'userId'>, items: Partial<InventoryItem>[]) => {
    const orderId = Math.random().toString(36).substr(2, 9);
    const newOrder: GroupOrder = { ...order, id: orderId, userId: auth.currentUser?.uid };

    setGroupOrders(prev => [newOrder, ...prev]);

    if (auth.currentUser) {
      setDoc(doc(db, 'orders', orderId), newOrder).catch(e => console.error("Failed to add order to DB:", e));
      
      const newItems: InventoryItem[] = items.map(item => ({
        id: Math.random().toString(36).substr(2, 9),
        name: item.name!,
        category: item.category as 'part' | 'consumable',
        pricePerUnit: item.pricePerUnit || 0,
        quantity: item.quantity || 1,
        initialQuantity: item.quantity || 1,
        sourceId: newOrder.name,
        purchaseDate: newOrder.date,
        orderId: orderId,
        userId: auth.currentUser!.uid
      }));
      setInventoryItems(prev => [...newItems, ...prev]);
      newItems.forEach(ni => {
        setDoc(doc(db, 'inventoryItems', ni.id), ni).catch(e => console.error("Failed to add inventory item:", e));
      });
    }
    addLog(`Gruppenbestellung hinzugefügt: "${order.name}" mit ${items.length} Teilen`, 'workshop');
  }, [addLog]);

  const deleteGroupOrder = useCallback((orderId: string) => {
    const order = groupOrders.find(o => o.id === orderId);
    if (order) {
       addLog(`Gruppenbestellung gelöscht: "${order.name}"`, 'workshop', { type: 'delete', data: { ...order } });
    }
    
    setGroupOrders(prev => prev.filter(o => o.id !== orderId));
    setInventoryItems(prev => prev.filter(i => i.orderId !== orderId));

    if (auth.currentUser) {
      deleteDoc(doc(db, 'orders', orderId)).catch(e => handleFirestoreError(e, OperationType.DELETE, 'orders'));
      const children = inventoryItems.filter(i => i.orderId === orderId);
      children.forEach(c => {
         deleteDoc(doc(db, 'inventoryItems', c.id)).catch(e => handleFirestoreError(e, OperationType.DELETE, 'inventoryItems'));
      });
    }
  }, [groupOrders, inventoryItems, addLog]);

  const addBike = useCallback((newBikeData: Partial<Bike>) => {
    const newBike: Bike = {
      id: Math.random().toString(36).substr(2, 9),
      name: newBikeData.name || 'Neues Fahrrad',
      status: newBikeData.status || 'Zu reparieren',
      purchasePrice: newBikeData.purchasePrice || 0,
      purchaseDate: newBikeData.purchaseDate || new Date().toISOString().split('T')[0],
      sellingPrice: newBikeData.sellingPrice || null,
      saleDate: newBikeData.saleDate || null,
      targetSellingPrice: newBikeData.targetSellingPrice || null,
      timeSpentSeconds: 0,
      lastModified: Date.now(),
      receivedAt: newBikeData.receivedAt || newBikeData.purchaseDate || new Date().toISOString().split('T')[0],
      listedAt: newBikeData.listedAt || null,
      soldAt: newBikeData.soldAt || null,
      expenses: [],
      checklist: [],
      notes: newBikeData.notes || '',
      photos: [],
      userId: auth.currentUser?.uid
    };
    
    // Optimistically update local state
    setBikes(prev => [newBike, ...prev]);

    if (auth.currentUser) {
      setDoc(doc(db, 'bikes', newBike.id), newBike).catch(e => {
        console.error("Failed to add bike to DB:", e);
      });
    }
    addLog(`Fahrrad hinzugefügt: "${newBike.name}"`, 'tracking', { type: 'add', data: newBike.id });
  }, [addLog]);

  const addTodo = useCallback((text: string, linkedBikeId?: string) => {
    const newTodo: DailyTodo = {
      id: Math.random().toString(36).substr(2, 9),
      text,
      completed: false,
      createdAt: Date.now(),
    };
    if (linkedBikeId) newTodo.linkedBikeId = linkedBikeId;
    if (auth.currentUser?.uid) newTodo.userId = auth.currentUser.uid;
    
    // Optimistically update local state
    setDailyTodos(prev => [...prev, newTodo]);

    if (auth.currentUser) {
      setDoc(doc(db, 'todos', newTodo.id), newTodo).catch(e => {
        handleFirestoreError(e, OperationType.CREATE, 'todos');
      });
    }
    addLog(`To-Do hinzugefügt: "${newTodo.text}"`, 'system');
  }, [addLog]);

  const toggleTodo = useCallback((id: string) => {
    const todo = dailyTodos.find(t => t.id === id);
    if (!todo) return;
    
    const newStatus = !todo.completed;
    const updatedTodo = { ...todo, completed: newStatus };
    
    // Optimistically update local state
    setDailyTodos(prev => prev.map(t => t.id === id ? updatedTodo : t));

    if (auth.currentUser) {
      setIsSyncing(true);
      updateDoc(doc(db, 'todos', id), { 
        completed: newStatus,
        userId: auth.currentUser.uid // Ensure legacy todos get a userId
      })
        .then(() => setIsSyncing(false))
        .catch(e => {
          setIsSyncing(false);
          handleFirestoreError(e, OperationType.UPDATE, 'todos');
        });
    }
    addLog(`To-Do "${todo.text}" als ${newStatus ? 'erledigt' : 'offen'} markiert`, 'system');
  }, [addLog, dailyTodos]);

  const deleteTodo = useCallback((id: string) => {
    const todo = dailyTodos.find(t => t.id === id);
    if (todo) {
      addLog(`To-Do gelöscht: "${todo.text}"`, 'system');
    }
    
    // Optimistically update local state
    setDailyTodos(prev => prev.filter(t => t.id !== id));

    if (auth.currentUser) {
      deleteDoc(doc(db, 'todos', id)).catch(e => {
        handleFirestoreError(e, OperationType.DELETE, 'todos');
      });
    }
  }, [addLog, dailyTodos]);

  const addServiceRequest = useCallback((request: Omit<ServiceRequest, 'id' | 'userId'>) => {
    const newRequest: ServiceRequest = {
      ...request,
      id: Math.random().toString(36).substr(2, 9),
    };
    if (auth.currentUser?.uid) newRequest.userId = auth.currentUser.uid;
    
    setServiceRequests(prev => [...prev, newRequest]);

    if (auth.currentUser) {
      setDoc(doc(db, 'serviceRequests', newRequest.id), newRequest).catch(e => {
        handleFirestoreError(e, OperationType.CREATE, 'serviceRequests');
      });
    }
    addLog(`Service-Anfrage hinzugefügt: "${newRequest.name}"`, 'system');
  }, [addLog]);

  const updateServiceRequest = useCallback((id: string, updates: Partial<ServiceRequest>) => {
    setServiceRequests(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));

    if (auth.currentUser) {
      updateDoc(doc(db, 'serviceRequests', id), updates).catch(e => {
        handleFirestoreError(e, OperationType.UPDATE, 'serviceRequests');
      });
    }
  }, []);

  const deleteServiceRequest = useCallback((id: string) => {
    setServiceRequests(prev => prev.filter(r => r.id !== id));

    if (auth.currentUser) {
      deleteDoc(doc(db, 'serviceRequests', id)).catch(e => {
        handleFirestoreError(e, OperationType.DELETE, 'serviceRequests');
      });
    }
  }, []);

  const syncBikeTime = useCallback((id: string, elapsedSeconds: number, newWorkLog: any) => {
    if (auth.currentUser) {
      updateDoc(doc(db, 'bikes', id), {
        timeSpentSeconds: increment(elapsedSeconds),
        workLogs: arrayUnion(newWorkLog),
        startTime: null,
        lastModified: Date.now()
      }).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'bikes-time'));
    }
  }, []);

  const forceSyncToCloud = useCallback(async () => {
    if (!auth.currentUser) return;
    setIsSyncing(true);
    try {
      // Push all current local state to cloud
      const bikePromises = bikes.map(bike => setDoc(doc(db, 'bikes', bike.id), { ...bike, lastModified: Date.now() }));
      const todoPromises = dailyTodos.map(todo => setDoc(doc(db, 'todos', todo.id), todo));
      const logPromises = logs.map(log => setDoc(doc(db, 'logs', log.id), log));
      const servicePromises = serviceRequests.map(req => setDoc(doc(db, 'serviceRequests', req.id), req));
      
      await Promise.all([...bikePromises, ...todoPromises, ...logPromises, ...servicePromises]);
      addLog('Manuelle Synchronisation (Push) abgeschlossen', 'system');
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'force-sync');
    } finally {
      setIsSyncing(false);
    }
  }, [bikes, dailyTodos, logs, serviceRequests, addLog]);

  const refreshFromCloud = useCallback(async () => {
    if (!auth.currentUser) return;
    setIsLoading(true);
    try {
      const bikesSnap = await getDocs(query(collection(db, 'bikes'), where('userId', '==', auth.currentUser.uid)));
      const todosSnap = await getDocs(query(collection(db, 'todos'), where('userId', '==', auth.currentUser.uid)));
      const logsSnap = await getDocs(query(collection(db, 'logs'), where('userId', '==', auth.currentUser.uid)));
      const serviceSnap = await getDocs(query(collection(db, 'serviceRequests'), where('userId', '==', auth.currentUser.uid)));

      setBikes(bikesSnap.docs.map(doc => ({ ...doc.data(), id: doc.id } as Bike)));
      setDailyTodos(todosSnap.docs.map(doc => ({ ...doc.data(), id: doc.id } as DailyTodo)));
      setLogs(logsSnap.docs.map(doc => ({ ...doc.data(), id: doc.id } as Log)).sort((a, b) => b.timestamp - a.timestamp));
      setServiceRequests(serviceSnap.docs.map(doc => ({ ...doc.data(), id: doc.id } as ServiceRequest)));
      
      addLog('Manuelle Synchronisation (Pull) abgeschlossen', 'system');
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, 'refresh');
    } finally {
      setIsLoading(false);
    }
  }, [addLog]);

  const revertLogAction = (logId: string) => {
    const log = logs.find(l => l.id === logId);
    if (!log || !log.revertAction) return;

    const { type, data } = log.revertAction;

    if (type === 'add') {
      // Revert add: delete the bike
      if (auth.currentUser) {
        deleteDoc(doc(db, 'bikes', data)).catch(e => handleFirestoreError(e, OperationType.DELETE, 'bikes'));
      } else {
        setBikes(prev => prev.filter(b => b.id !== data));
      }
    } else if (type === 'delete') {
      // Revert delete: restore the bike
      if (auth.currentUser) {
        setDoc(doc(db, 'bikes', data.id), { ...data, userId: auth.currentUser.uid }).catch(e => handleFirestoreError(e, OperationType.CREATE, 'bikes'));
      } else {
        setBikes(prev => [data, ...prev]);
      }
    } else if (type === 'update') {
      // Revert update: restore specific fields
      const bike = bikes.find(b => b.id === data.id);
      if (bike) {
        const updatedBike = { ...bike, ...data.oldValues };
        if (auth.currentUser) {
          setDoc(doc(db, 'bikes', data.id), updatedBike).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'bikes'));
        } else {
          setBikes(prev => prev.map(b => b.id === data.id ? updatedBike : b));
        }
      }
    }

    // Remove the log entry or mark it as reverted
    if (auth.currentUser) {
      deleteDoc(doc(db, 'logs', logId)).catch(e => handleFirestoreError(e, OperationType.DELETE, 'logs'));
    } else {
      setLogs(prev => prev.filter(l => l.id !== logId));
    }
  };

  const navigateToWorkshopBike = (bikeId: string) => {
    setActiveWorkshopBikeId(bikeId);
    handleTabChange('workshop');
  };

  const exportCSV = () => {
    // Collect all data available
    const activeBikes = bikes.filter(b => b.status !== 'Verkauft' && b.status !== 'Infrastruktur');
    const soldBikes = bikes.filter(b => b.status === 'Verkauft');
    const infraBikes = bikes.filter(b => b.status === 'Infrastruktur');

    const totalInventoryCost = inventoryItems
      .filter(item => !item.orderId)
      .reduce((acc, item) => acc + (item.pricePerUnit * (item.initialQuantity || item.quantity)), 0);
    const totalGroupOrderCost = groupOrders.reduce((acc, order) => acc + order.totalPrice, 0);
    const totalRevenue = soldBikes.reduce((acc, bike) => acc + (bike.sellingPrice || 0), 0);

    const profit = bikes.reduce((acc, bike) => {
      const expenses = bike.expenses.reduce((sum, exp) => sum + exp.amount, 0);
      let flow = -bike.purchasePrice - expenses;
      if (bike.status === 'Verkauft') flow += (bike.sellingPrice || 0);
      return acc + flow;
    }, 0) - totalInventoryCost - totalGroupOrderCost;

    const soldBikesProfit = soldBikes.reduce((acc, bike) => {
      const expenses = bike.expenses.reduce((sum, exp) => sum + exp.amount, 0);
      return acc + ((bike.sellingPrice || 0) - bike.purchasePrice - expenses);
    }, 0);

    const infTime = bikes.filter(b => b.status === 'Infrastruktur').reduce((acc, bike) => acc + bike.timeSpentSeconds, 0);
    const timeSold = soldBikes.reduce((acc, bike) => acc + bike.timeSpentSeconds, 0) + infTime;
    const hourlyWage = timeSold > 0 ? soldBikesProfit / (timeSold / 3600) : 0;
    const totalTimeh = bikes.reduce((acc, bike) => acc + bike.timeSpentSeconds, 0) / 3600;

    const tiedCap = activeBikes.reduce((acc, b) => acc + b.purchasePrice + b.expenses.reduce((s, e) => s + e.amount, 0), 0);
    const infCap = infraBikes.reduce((acc, b) => acc + b.purchasePrice + b.expenses.reduce((s, e) => s + e.amount, 0), 0);

    // Geschäfts-Stundenlohn (alle Kosten / gesamte Zeit), Lagerwert, Ø Standzeit
    const geschHw = totalTimeh > 0 ? profit / totalTimeh : 0;
    const lagerwert = inventoryItems.reduce((acc, item) => acc + (item.quantity * item.pricePerUnit), 0);
    const standzeitBikes = bikes.filter(b => b.listedAt && b.soldAt);
    const avgStandzeit = standzeitBikes.length > 0
      ? standzeitBikes.reduce((acc, b) => acc + ((new Date(b.soldAt as string).getTime() - new Date(b.listedAt as string).getTime()) / 86400000), 0) / standzeitBikes.length
      : null;

    let flyerAreas = [];
    let flyerExc = [];
    try {
      flyerAreas = JSON.parse(localStorage.getItem('flyerTracking_areas') || "[]");
      flyerExc = JSON.parse(localStorage.getItem('flyerTracking_excluded') || "[]");
    } catch(e){}

    const report = {
      _cfg: {
         v: "1.2", pt: new Date().toISOString(), desc: "Full dataset dump for AI. Keys are minified."
      },
      legend: {
         b: {
           st: "status (Verkauft=sold, Zu reparieren=todo, Inseriert=listed)",
           bp: "buyPrice", sp: "sellPrice",
           exp: "expenses array (materials used from inventory or external: a=amount, d=desc, id=invId, dt=date)",
           tz: "timeSpentSeconds",
           rcv: "receivedAt (Eingang)", lst: "listedAt (inseriert am)", sld: "soldAt (verkauft am)",
           acq: "acquisitionSource: flyer=Flyer-Akquise, kleinanzeigen=Kleinanzeigen, null=unbekannt"
         },
         inv: { iq: "initialQuantity", q: "currentQuantity", c: "pricePerUnit", oId: "Group order id" },
         go: { c: "totalCost", n: "name", dt: "date" },
         svcReq: { iss: "issue", drop: "dropoff", st: "status" }
      },
      stats: {
        rev: Math.round(totalRevenue*100)/100,
        prof: Math.round(profit*100)/100,
        hw: Math.round(hourlyWage*100)/100,
        geschHw: Math.round(geschHw*100)/100,
        tt: Math.round(totalTimeh*100)/100,
        capActiv: Math.round(tiedCap*100)/100,
        capInf: Math.round(infCap*100)/100,
        lagerwert: Math.round(lagerwert*100)/100,
        avgStandzeit: avgStandzeit !== null ? Math.round(avgStandzeit*10)/10 : null,
        counts: { sold: soldBikes.length, active: activeBikes.length, all: bikes.length }
      },
      bikes: bikes.map(b => ({
        id: b.id, name: b.name, st: b.status,
        bp: b.purchasePrice, sp: b.sellingPrice || 0,
        exp: b.expenses.map(e => ({ a: e.amount, d: e.description, dt: e.date, id: e.sourceInventoryId })),
        tz: b.timeSpentSeconds,
        rcv: b.receivedAt || null,
        lst: b.listedAt || null,
        sld: b.soldAt || null,
        acq: b.acquisitionSource || null,
        notes: b.notes,
        todos: b.checklist.filter(c => !c.completed).map(c => c.text)
      })),
      inv: inventoryItems.map(i => ({
        id: i.id, cat: i.category, name: i.name,
        iq: i.initialQuantity || i.quantity, q: i.quantity,
        c: i.pricePerUnit, oId: i.orderId
      })),
      gOrders: groupOrders.map(o => ({
        id: o.id, name: o.name, dt: o.date, c: o.totalPrice
      })),
      svcReq: serviceRequests.map(s => ({
        name: s.name, iss: s.issue, drop: s.dropoffTime, st: s.status, dt: s.id
      })),
      sysTodos: dailyTodos.map(d => ({
        t: d.text, c: d.completed
      })),
      flyer: {
        areas: flyerAreas.length,
        distd: flyerAreas.reduce((sum: number, a: any) => sum + (a.flyerCount || 0), 0),
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
          note: a.note || '',
        }))
      }
    };

    const str = JSON.stringify(report, null, 2);
    const url = URL.createObjectURL(new Blob([str], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai_report_v1.2_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    setIsProfileMenuOpen(false);
  };

  const exportOpenProjectsCSV = () => {
    const csvLines: string[] = [];
    
    // Header
    csvLines.push('Fahrrad,Status,Einkaufspreis (€),Kaufdatum,Wann dran geschraubt,Investierte Zeit (h),Materialkosten (€),Materialien,Checkliste (Erledigt/Gesamt),Offene To-Dos,Notizen');

    const openBikes = bikes.filter(b => b.status === 'Zu reparieren');

    openBikes.forEach(b => {
      const expensesTotal = b.expenses.reduce((sum, e) => sum + e.amount, 0);
      const expensesList = b.expenses.map(e => `${e.description} (${e.amount}€)`).join('; ');
      
      const checklistCompleted = b.checklist.filter(c => c.completed).length;
      const checklistTotal = b.checklist.length;
      const openTodos = b.checklist.filter(c => !c.completed).map(c => c.text).join('; ');

      // Extract unique dates from workLogs if available, otherwise fallback to lastModified
      let workDates = '';
      if (b.workLogs && b.workLogs.length > 0) {
        const dates = b.workLogs.map(w => {
          if (typeof w.timestamp === 'string') return w.timestamp.split('T')[0];
          return new Date(w.timestamp).toISOString().split('T')[0];
        });
        workDates = Array.from(new Set(dates)).join(', ');
      } else {
        workDates = new Date(b.lastModified).toISOString().split('T')[0];
      }

      const timeHours = (b.timeSpentSeconds / 3600).toFixed(2);
      const notes = (b.notes || '').replace(/"/g, '""').replace(/\n/g, ' ');

      csvLines.push(
        `"${b.name}","${b.status}",${b.purchasePrice.toFixed(2)},"${b.purchaseDate}","${workDates}",${timeHours},${expensesTotal.toFixed(2)},"${expensesList}","${checklistCompleted}/${checklistTotal}","${openTodos}","${notes}"`
      );
    });

    const csvContent = csvLines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Zu_reparieren_FlipBike_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setIsProfileMenuOpen(false);
  };

  const downloadCharts = () => {
    const canvases = document.querySelectorAll('canvas');
    if (canvases.length === 0) {
      alert('Keine Diagramme gefunden. Bitte wechsle zum Tracking-Tab.');
      return;
    }
    canvases.forEach((canvas, index) => {
      const url = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `flipbike_chart_${index + 1}.png`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
    setIsProfileMenuOpen(false);
  };

  const exportBackup = () => {
    const backupData = {
      bikes,
      dailyTodos,
      logs,
      activeWorkshopBikeId,
      timestamp: Date.now()
    };
    const jsonContent = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `flipbike_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setIsProfileMenuOpen(false);
    addLog('Manuelles Backup erstellt', 'system');
  };

  const restoreDemoData = async () => {
    if (window.confirm('Möchtest du die Demo-Daten wiederherstellen? Dies wird deine aktuellen Daten überschreiben.')) {
      if (user) {
        try {
          // Upload initial bikes to Firestore
          for (const bike of initialBikes) {
            await setDoc(doc(db, 'bikes', bike.id), { ...bike, userId: user.uid });
          }
          // Optionally clear other collections if needed, but for now just restore bikes
          addLog('Demo-Daten in Cloud wiederhergestellt', 'system');
        } catch (error) {
          console.error('Fehler beim Wiederherstellen der Demo-Daten in der Cloud', error);
        }
      } else {
        setBikes(initialBikes);
        setDailyTodos([]);
        setLogs([]);
        addLog('Demo-Daten lokal wiederhergestellt', 'system');
      }
      setIsProfileMenuOpen(false);
    }
  };

  const importBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const backupData = JSON.parse(content);
        
        if (user) {
          // Upload to Firestore
          if (backupData.bikes) {
            for (const bike of backupData.bikes) {
              await setDoc(doc(db, 'bikes', bike.id), { ...bike, userId: user.uid });
            }
          }
          if (backupData.dailyTodos) {
            for (const todo of backupData.dailyTodos) {
              await setDoc(doc(db, 'todos', todo.id), { ...todo, userId: user.uid });
            }
          }
          if (backupData.logs) {
            for (const log of backupData.logs) {
              await setDoc(doc(db, 'logs', log.id), { ...log, userId: user.uid });
            }
          }
        } else {
          if (backupData.bikes) setBikes(backupData.bikes);
          if (backupData.dailyTodos) setDailyTodos(backupData.dailyTodos);
          if (backupData.logs) setLogs(backupData.logs);
          if (backupData.activeWorkshopBikeId !== undefined) setActiveWorkshopBikeId(backupData.activeWorkshopBikeId);
        }
        
        addLog('Backup erfolgreich wiederhergestellt', 'system');
        alert('Backup erfolgreich wiederhergestellt!');
      } catch (error) {
        console.error('Fehler beim Importieren des Backups', error);
        alert('Fehler beim Importieren des Backups. Die Datei ist möglicherweise beschädigt.');
      }
    };
    reader.readAsText(file);
    setIsProfileMenuOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const filteredLogs = logs
    .filter(log => logFilter === 'all' || log.module === logFilter)
    .sort((a, b) => logSortOrder === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-orange-500/30">
      {/* Top Navigation */}
      <nav className="flex items-center justify-between px-4 md:px-8 py-3 bg-slate-900/80 backdrop-blur-md border-b border-slate-800/70 sticky top-0 z-50">
        <div className="flex items-center space-x-2.5">
          <div className="w-9 h-9 bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center shadow-sm shadow-orange-900/40">
            <Wrench className="w-5 h-5 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-xl tracking-tight text-slate-100 leading-none">Flip<span className="text-orange-500">Bike</span></span>
            {user ? (
              <div className="flex items-center mt-1">
                <div className={`w-1.5 h-1.5 rounded-full mr-1.5 ${!isOnline ? 'bg-red-500' : isSyncing ? 'bg-orange-500 animate-pulse' : 'bg-emerald-500'}`}></div>
                <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">
                  {!isOnline ? 'Offline - Lokal gespeichert' : isSyncing ? 'Synchronisiert...' : 'Synchronisiert'}
                </span>
              </div>
            ) : (
              <div className="flex items-center mt-1">
                <div className="w-1.5 h-1.5 rounded-full mr-1.5 bg-slate-500"></div>
                <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Lokal gespeichert</span>
              </div>
            )}
          </div>
        </div>
        
        {/* Desktop Tabs */}
        <div className="hidden md:flex items-center gap-1 bg-slate-800/40 p-1 rounded-xl border border-slate-700/40">
          {([
            { key: 'tracking', label: 'TRACKING', Icon: BarChart3 },
            { key: 'workshop', label: 'WERKSTATT', Icon: Wrench },
            { key: 'daily', label: 'DAILY', Icon: CheckSquare },
            { key: 'receipts', label: 'BELEGE', Icon: FileText },
          ] as const).map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => handleTabChange(key)}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold tracking-wide transition-all duration-200 ${
                activeTab === key
                  ? 'bg-slate-700/80 text-white shadow-sm ring-1 ring-orange-500/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-700/40'
              }`}
            >
              <Icon className={`w-4 h-4 ${activeTab === key ? 'text-orange-400' : ''}`} />
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center space-x-3">
          <div className="relative">
            <button
              onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
              className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-400 hover:bg-slate-700 hover:border-slate-600 transition-colors overflow-hidden"
            >
              {user?.photoURL ? (
                <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User className="w-4 h-4" />
              )}
            </button>
          
          {isProfileMenuOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-slate-900 border border-slate-800 rounded-lg shadow-xl z-50 overflow-hidden">
              <div className="p-2 space-y-1">
                <button 
                  onClick={() => { setIsLogsModalOpen(true); setIsProfileMenuOpen(false); }}
                  className="w-full flex items-center px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-slate-100 rounded-md transition-colors"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Aktivitäts-Logs
                </button>
                <button 
                  onClick={() => { refreshFromCloud(); setIsProfileMenuOpen(false); }}
                  className="w-full flex items-center px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-slate-100 rounded-md transition-colors"
                >
                  <RefreshCw className="w-4 h-4 mr-2 text-blue-400" />
                  Daten neu laden (Pull)
                </button>
                <button 
                  onClick={() => { forceSyncToCloud(); setIsProfileMenuOpen(false); }}
                  className="w-full flex items-center px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-slate-100 rounded-md transition-colors"
                >
                  <CloudUpload className="w-4 h-4 mr-2 text-emerald-400" />
                  Sync erzwingen (Push)
                </button>
                <div className="border-t border-slate-800 my-1"></div>
                <button 
                  onClick={exportCSV}
                  className="w-full flex items-center px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-slate-100 rounded-md transition-colors"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Vollständiger KI-Report (JSON)
                </button>
                <button 
                  onClick={exportOpenProjectsCSV}
                  className="w-full flex items-center px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-slate-100 rounded-md transition-colors"
                >
                  <Wrench className="w-4 h-4 mr-2" />
                  Zu reparieren Report (CSV)
                </button>
                <button 
                  onClick={downloadCharts}
                  className="w-full flex items-center px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-slate-100 rounded-md transition-colors"
                >
                  <Image className="w-4 h-4 mr-2" />
                  Diagramme herunterladen
                </button>
                <div className="border-t border-slate-800 my-1"></div>
                <button 
                  onClick={exportBackup}
                  className="w-full flex items-center px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-slate-100 rounded-md transition-colors"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Backup erstellen (JSON)
                </button>
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-slate-100 rounded-md transition-colors"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Backup wiederherstellen
                </button>
                <button 
                  onClick={() => { restoreDemoData(); setIsProfileMenuOpen(false); }}
                  className="w-full flex items-center px-3 py-2 text-sm text-orange-400 hover:bg-slate-800 hover:text-orange-300 rounded-md transition-colors"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Demo-Daten wiederherstellen
                </button>
                <div className="border-t border-slate-800 my-1"></div>
                {user ? (
                  <button 
                    onClick={() => { logout(); setIsProfileMenuOpen(false); }}
                    className="w-full flex items-center px-3 py-2 text-sm text-red-400 hover:bg-slate-800 hover:text-red-300 rounded-md transition-colors"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Abmelden
                  </button>
                ) : (
                  <button 
                    onClick={handleLogin}
                    disabled={isLoggingIn}
                    className={`w-full flex items-center px-3 py-2 text-sm text-emerald-400 hover:bg-slate-800 hover:text-emerald-300 rounded-md transition-colors ${isLoggingIn ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <LogIn className="w-4 h-4 mr-2" />
                    {isLoggingIn ? 'Anmeldung läuft...' : 'Mit Google anmelden'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </nav>

      {/* Main Content */}
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 md:py-8 md:pb-8">

        {/* Tab Content */}
        <div className={`animate-in fade-in duration-500 ${activeTab === 'tracking' && trackingScrollPos > 0 ? '' : 'slide-in-from-bottom-4'}`}>
          {activeTab === 'tracking' ? (
            <TrackingModule 
              bikes={bikes} 
              inventoryItems={inventoryItems}
              groupOrders={groupOrders}
              receipts={receipts}
              updateBike={updateBike} 
              addBike={addBike} 
              deleteBike={deleteBike} 
              deleteInventoryItem={deleteInventoryItem}
              deleteGroupOrder={deleteGroupOrder}
              onNavigateToWorkshop={(id) => {
                setActiveWorkshopBikeId(id);
                handleTabChange('workshop');
              }}
              initialScrollPos={trackingScrollPos}
              isTiedCapitalExpanded={isTiedCapitalExpanded}
              setIsTiedCapitalExpanded={setIsTiedCapitalExpanded}
              addLog={addLog}
            />
          ) : activeTab === 'workshop' ? (
            <WorkshopModule 
              bikes={bikes} 
              inventoryItems={inventoryItems}
              groupOrders={groupOrders}
              receipts={receipts}
              updateBike={updateBike} 
              syncBikeTime={syncBikeTime}
              deleteInventoryItem={deleteInventoryItem}
              addGroupOrder={addGroupOrder}
              deleteGroupOrder={deleteGroupOrder}
              activeBikeId={activeWorkshopBikeId}
              setActiveBikeId={setActiveWorkshopBikeId}
              addLog={addLog}
            />
          ) : activeTab === 'receipts' ? (
            <ReceiptsModule
              receipts={receipts}
              bikes={bikes}
              groupOrders={groupOrders}
              inventoryItems={inventoryItems}
            />
          ) : (
            <DailyTodoModule 
              todos={dailyTodos} 
              addTodo={addTodo}
              toggleTodo={toggleTodo}
              deleteTodo={deleteTodo}
              bikes={bikes} 
              onNavigateBack={() => handleTabChange('workshop')}
              onNavigateToBike={navigateToWorkshopBike}
              addLog={addLog}
              serviceRequests={serviceRequests}
              addServiceRequest={addServiceRequest}
              updateServiceRequest={updateServiceRequest}
              deleteServiceRequest={deleteServiceRequest}
            />
          )}
        </div>
      </main>

      {/* Logs Modal */}
      {isLogsModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <h2 className="text-lg font-bold text-slate-100 flex items-center">
                <FileText className="w-5 h-5 mr-2 text-orange-500" />
                Aktivitäts-Logs
              </h2>
              <button 
                onClick={() => setIsLogsModalOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex flex-col sm:flex-row gap-4 justify-between items-center">
              <div className="flex items-center space-x-2 w-full sm:w-auto">
                <span className="text-sm text-slate-400">Filter:</span>
                <select 
                  className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-md focus:ring-orange-500 focus:border-orange-500 block p-2"
                  value={logFilter}
                  onChange={(e) => setLogFilter(e.target.value as any)}
                >
                  <option value="all">Alle</option>
                  <option value="tracking">Tracking</option>
                  <option value="workshop">Werkstatt</option>
                  <option value="stopwatch">Stoppuhr</option>
                  <option value="system">System</option>
                </select>
              </div>
              <div className="flex items-center space-x-2 w-full sm:w-auto">
                <span className="text-sm text-slate-400">Sortierung:</span>
                <select 
                  className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-md focus:ring-orange-500 focus:border-orange-500 block p-2"
                  value={logSortOrder}
                  onChange={(e) => setLogSortOrder(e.target.value as any)}
                >
                  <option value="desc">Neueste zuerst</option>
                  <option value="asc">Älteste zuerst</option>
                </select>
              </div>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {filteredLogs.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  Keine Logs vorhanden.
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredLogs.map(log => (
                    <div key={log.id} className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                      <div className="flex justify-between items-center mb-1">
                        <div className="text-xs text-slate-500">
                          {new Date(log.timestamp).toLocaleString('de-DE')}
                        </div>
                        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 bg-slate-800 px-2 py-0.5 rounded">
                          {log.module}
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-slate-300">
                          {log.message}
                        </div>
                        {log.revertAction && (
                          <button 
                            onClick={() => revertLogAction(log.id)}
                            className="text-xs font-medium text-orange-500 hover:text-orange-400 px-2 py-1 rounded hover:bg-orange-500/10 transition-colors flex items-center"
                          >
                            Rückgängig
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation (Mobile) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900/90 backdrop-blur-lg border-t border-slate-800/70 z-50 pb-safe">
        <div className="flex justify-around items-stretch gap-1 px-2 pt-1.5">
          {([
            { key: 'tracking', label: 'TRACKING', Icon: BarChart3 },
            { key: 'workshop', label: 'WERKSTATT', Icon: Wrench },
            { key: 'daily', label: 'DAILY', Icon: Calendar },
            { key: 'receipts', label: 'BELEGE', Icon: FileText },
          ] as const).map(({ key, label, Icon }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => handleTabChange(key)}
                className={`flex flex-col items-center justify-center flex-1 py-2 rounded-xl transition-all duration-200 active:scale-95 ${
                  active ? 'text-orange-400 bg-orange-500/10' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Icon className={`w-[22px] h-[22px] mb-0.5 ${active ? 'fill-orange-500/15' : ''}`} />
                <span className="text-[10px] font-bold tracking-wide">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <input 
        type="file" 
        accept=".json" 
        ref={fileInputRef} 
        style={{ display: 'none' }} 
        onChange={importBackup} 
      />
    </div>
  );
}

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
