export type BikeStatus = 'Zu reparieren' | 'Inseriert' | 'Verkauft' | 'Infrastruktur' | 'Material';

export interface Expense {
  id: string;
  description: string;
  amount: number;
  date: string;
  sourceInventoryId?: string;
}

export interface GroupOrder {
  id: string;
  name: string;
  totalPrice: number;
  date: string;
  userId?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: 'part' | 'consumable' | 'machinery';
  pricePerUnit: number;
  quantity: number;
  initialQuantity?: number;
  sourceId: string;
  purchaseDate: string;
  userId: string;
  orderId?: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface WorkLog {
  id: string;
  timestamp: string;
  durationSeconds: number;
}

export interface Receipt {
  id: string;
  bikeId: string;
  referenceId: string; // ID of the bike or expense
  referenceType: 'bike_purchase' | 'expense' | 'infrastructure' | 'material' | 'order';
  fileUrl: string;
  fileName: string;
  fileType: string;
  uploadedAt: number;
  userId?: string;
}

export interface Bike {
  id: string;
  name: string;
  status: BikeStatus;
  purchasePrice: number;
  purchaseDate: string;
  _isHypothetical?: boolean;
  sellingPrice: number | null;
  saleDate: string | null;
  targetSellingPrice: number | null;
  timeSpentSeconds: number;
  startTime?: number | null; // For offline stopwatch tracking
  lastModified: number; // For sorting in workshop
  receivedAt?: string | null; // Standzeit-Tracking: Eingang (ISO 8601)
  listedAt?: string | null;   // Standzeit-Tracking: inseriert am (ISO 8601)
  soldAt?: string | null;     // Standzeit-Tracking: verkauft am (ISO 8601)
  expenses: Expense[];
  checklist: ChecklistItem[];
  workLogs?: WorkLog[];
  notes: string;
  photos: string[];
  hiddenInWorkshop?: boolean;
  userId?: string;
  isStandalone?: boolean;
  linkedFromId?: string;
}

export interface DailyTodo {
  id: string;
  text: string;
  completed: boolean;
  createdAt?: number;
  linkedBikeId?: string;
  userId?: string;
}

export interface ServiceRequest {
  id: string;
  name: string;
  issue: string;
  dropoffTime: string;
  status: 'Ausstehend' | 'Angenommen' | 'In Bearbeitung' | 'Fertig' | 'Abgeholt';
  phone?: string;
  notes?: string;
  userId?: string;
}

export interface Log {
  id: string;
  timestamp: number;
  message: string;
  module: 'tracking' | 'workshop' | 'stopwatch' | 'system';
  revertAction?: {
    type: 'add' | 'delete' | 'update';
    data: any;
  };
  userId?: string;
}
