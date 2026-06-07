import React, { useState, useRef } from 'react';
import { Upload, File, CheckCircle, AlertCircle, X, Loader2 } from 'lucide-react';
import { storage, db, auth } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { Receipt } from '../types';

interface ReceiptUploaderProps {
  bikeId: string;
  referenceId: string;
  referenceType: 'bike_purchase' | 'expense' | 'infrastructure' | 'material' | 'order';
  existingReceipt?: Receipt;
  readonly?: boolean;
  readonlyLabel?: string;
}

export function ReceiptUploader({ bikeId, referenceId, referenceType, existingReceipt, readonly, readonlyLabel }: ReceiptUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = () => {
    if (existingReceipt) {
      if (existingReceipt.fileUrl.startsWith('data:')) {
        try {
          const parts = existingReceipt.fileUrl.split(';base64,');
          const contentType = parts[0].split(':')[1];
          const raw = window.atob(parts[1]);
          const rawLength = raw.length;
          const uInt8Array = new Uint8Array(rawLength);
          for (let i = 0; i < rawLength; ++i) {
            uInt8Array[i] = raw.charCodeAt(i);
          }
          const blob = new Blob([uInt8Array], { type: contentType });
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank');
          
          // Note: URL.revokeObjectURL(url) should ideally be called eventually, but for a quick popup it's usually fine
        } catch (e) {
            window.open(existingReceipt.fileUrl, '_blank');
        }
      } else {
        window.open(existingReceipt.fileUrl, '_blank');
      }
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Limit to ~800KB to safely fit within 1MB Firestore limit after Base64 encoding
    if (file.size > 800 * 1024) {
      setError("Datei ist zu groß (max 800KB für direkte Speicherung)");
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Nicht angemeldet");

      // Convert to Base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (error) => reject(error);
      });
      reader.readAsDataURL(file);
      
      const base64String = await base64Promise;

      const receiptId = Math.random().toString(36).substr(2, 9);
      const newReceipt: Receipt = {
        id: receiptId,
        bikeId,
        referenceId,
        referenceType,
        fileUrl: base64String, // Store base64 directly
        fileName: file.name,
        fileType: file.type,
        uploadedAt: Date.now(),
        userId: user.uid,
      };

      await setDoc(doc(db, 'receipts', receiptId), newReceipt);
      
    } catch (err: any) {
      console.error("Fehler beim Upload:", err);
      setError(err.message || "Upload fehlgeschlagen");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!existingReceipt) return;
    
    try {
      await deleteDoc(doc(db, 'receipts', existingReceipt.id));
      // Optionally could also delete from storage here, but we can just delete the DB reference for now
    } catch (err) {
      console.error("Failed to delete receipt", err);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
        accept="image/*,application/pdf"
      />
      
      {existingReceipt ? (
        <div className="flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 px-2 py-1 rounded cursor-pointer hover:bg-emerald-500/20 transition-colors" onClick={handleUploadClick}>
          <CheckCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="text-xs font-medium truncate max-w-[150px]" title={readonly ? readonlyLabel : existingReceipt.fileName}>
            {readonly ? (readonlyLabel ? (readonlyLabel.length > 20 ? readonlyLabel.substring(0, 18) + '...' : readonlyLabel) : 'Abgedeckt') : existingReceipt.fileName}
          </span>
          {!readonly && (
            <button onClick={handleDelete} className="ml-1 p-0.5 rounded-full hover:bg-emerald-500/30 text-emerald-600 shrink-0">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      ) : (
        <button 
          onClick={handleUploadClick}
          disabled={isUploading}
          className="flex items-center gap-1 bg-red-500/10 border border-red-500/20 text-red-500 px-2 py-1 rounded hover:bg-red-500/20 transition-colors"
          title="Kein Beleg vorhanden. Klicken zum Hochladen."
        >
          {isUploading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5" />
          )}
          <span className="text-xs font-medium">Beleg fehlt</span>
          <Upload className="w-3 h-3 ml-1" />
        </button>
      )}
      
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}
