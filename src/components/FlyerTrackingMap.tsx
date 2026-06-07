import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, useMapEvents, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Download, Map as MapIcon, PenTool, XOctagon, Eraser, Undo2, Check } from 'lucide-react';
import html2canvas from 'html2canvas';

interface DistributedArea {
  id: string;
  points: [number, number][];
  flyerCount: number;
}

interface ExcludedHouse {
  id: string;
  point: [number, number];
}

type Mode = 'idle' | 'draw' | 'exclude' | 'delete';

const CENTER_LAT = 52.2289;
const CENTER_LNG = 10.5332;

export function FlyerTrackingMap() {
  const [areas, setAreas] = useState<DistributedArea[]>([]);
  const [excludedHouses, setExcludedHouses] = useState<ExcludedHouse[]>([]);
  
  const [mode, setMode] = useState<Mode>('idle');
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const [cursorPos, setCursorPos] = useState<[number, number] | null>(null);
  
  const [showModal, setShowModal] = useState(false);
  const [currentFlyerCount, setCurrentFlyerCount] = useState('');
  
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedAreas = localStorage.getItem('flyerTracking_areas');
    const savedHouses = localStorage.getItem('flyerTracking_excluded');
    if (savedAreas) setAreas(JSON.parse(savedAreas));
    if (savedHouses) setExcludedHouses(JSON.parse(savedHouses));
  }, []);

  useEffect(() => {
    localStorage.setItem('flyerTracking_areas', JSON.stringify(areas));
    localStorage.setItem('flyerTracking_excluded', JSON.stringify(excludedHouses));
    
    // Cleanup drawing points if mode changes unexpectedly
    if (mode !== 'draw') {
        setDrawingPoints([]);
        setCursorPos(null);
    }
  }, [areas, excludedHouses, mode]);

  const totalFlyers = areas.reduce((sum, area) => sum + area.flyerCount, 0);

  const MapEvents = () => {
    const map = useMapEvents({
      click: (e) => {
        const { lat, lng } = e.latlng;
        
        if (mode === 'exclude') {
          setExcludedHouses([...excludedHouses, { id: Date.now().toString(), point: [lat, lng] }]);
        } else if (mode === 'draw') {
          if (drawingPoints.length > 2) {
             const dist = map.latLngToContainerPoint(e.latlng).distanceTo(map.latLngToContainerPoint(drawingPoints[0] as [number, number]));
             if (dist < 30) {
                 completePolygon();
                 return;
             }
          }
          setDrawingPoints([...drawingPoints, [lat, lng]]);
        }
      },
      mousemove: (e) => {
        if (mode === 'draw') {
          if (drawingPoints.length > 2) {
             const dist = map.latLngToContainerPoint(e.latlng).distanceTo(map.latLngToContainerPoint(drawingPoints[0] as [number, number]));
             if (dist < 30) {
                 setCursorPos(drawingPoints[0] as [number, number]);
                 return;
             }
          }
          setCursorPos([e.latlng.lat, e.latlng.lng]);
        }
      }
    });
    return null;
  };

  const completePolygon = () => {
    if (drawingPoints.length > 2) {
      setShowModal(true);
    }
  };

  const handleSaveArea = () => {
    const count = parseInt(currentFlyerCount);
    if (!isNaN(count) && count > 0) {
      setAreas([...areas, {
        id: Date.now().toString(),
        points: drawingPoints,
        flyerCount: count
      }]);
      setMode('idle');
      setDrawingPoints([]);
      setShowModal(false);
      setCurrentFlyerCount('');
    }
  };

  const cancelDrawing = () => {
    setDrawingPoints([]);
    setMode('idle');
    setShowModal(false);
    setCurrentFlyerCount('');
  };
  
  const handleUndoPoint = () => {
      setDrawingPoints(prev => prev.slice(0, -1));
  };

  const handleExport = async () => {
    if (!mapRef.current) return;
    
    // Temporarily hide map controls for clean export
    const elementsToHide = document.querySelectorAll('.leaflet-control-container');
    elementsToHide.forEach((el: any) => el.style.display = 'none');
    
    try {
      const canvas = await html2canvas(mapRef.current, {
        useCORS: true,
        allowTaint: true,
      });
      
      const link = document.createElement('a');
      link.download = `flyer-tracking-${new Date().toISOString().split('T')[0]}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (error) {
      console.error('Failed to export map', error);
    } finally {
      elementsToHide.forEach((el: any) => el.style.display = '');
    }
  };

  const handleDeleteArea = (id: string, e: any) => {
      if (mode === 'delete') {
          e.originalEvent.stopPropagation();
          setAreas(areas.filter(a => a.id !== id));
      }
  };
  
  const handleDeleteHouse = (id: string, e: any) => {
      if (mode === 'delete') {
          e.originalEvent.stopPropagation();
          setExcludedHouses(excludedHouses.filter(h => h.id !== id));
      }
  };

  // Build temporary polyline for drawing
  const tempDrawPath = [...drawingPoints];
  if (cursorPos) {
      tempDrawPath.push(cursorPos);
  }

  return (
    <div className="space-y-4 mt-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex items-center space-x-4 mb-4">
        <MapIcon className="w-6 h-6 text-emerald-500" />
        <h2 className="text-2xl font-bold">Logistik & Flyer-Tracking</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <Card className="col-span-1 md:col-span-3 border-slate-700 bg-slate-800/40">
          <CardContent className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              <Button 
                variant={mode === 'draw' ? "default" : "secondary"} 
                className={mode === 'draw' ? "bg-emerald-600 hover:bg-emerald-700 outline-none ring-2 ring-emerald-500 ring-offset-2 ring-offset-slate-900" : ""}
                onClick={() => setMode(mode === 'draw' ? 'idle' : 'draw')}
              >
                <PenTool className="w-4 h-4 mr-2" /> 
                {mode === 'draw' ? "Zeichnen aktiv..." : "Gebiet zeichnen"}
              </Button>

              <Button 
                variant={mode === 'exclude' ? "destructive" : "secondary"}
                className={mode === 'exclude' ? "outline-none ring-2 ring-red-500 ring-offset-2 ring-offset-slate-900" : ""}
                onClick={() => setMode(mode === 'exclude' ? 'idle' : 'exclude')}
              >
                <XOctagon className="w-4 h-4 mr-2" />
                {mode === 'exclude' ? "Exkludieren aktiv..." : "Haus exkludieren"}
              </Button>
              
              <Button 
                variant={mode === 'delete' ? "outline" : "secondary"}
                className={mode === 'delete' ? "border-orange-500 text-orange-400 hover:text-orange-300 outline-none ring-2 ring-orange-500 ring-offset-2 ring-offset-slate-900" : ""}
                onClick={() => setMode(mode === 'delete' ? 'idle' : 'delete')}
              >
                <Eraser className="w-4 h-4 mr-2" />
                Löschen
              </Button>

              <Button variant="outline" onClick={handleExport} className="ml-auto">
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            </div>
            
            <div className="flex items-center space-x-4 text-sm font-medium pt-2 md:pt-0">
              <span className={`flex items-center transition-opacity ${mode === 'delete' ? 'opacity-50' : ''}`}>
                <div className="w-3 h-3 bg-emerald-500 bg-opacity-40 border border-emerald-500 mr-2 rounded-sm" /> Verteilt
              </span>
              <span className={`flex items-center transition-opacity ${mode === 'delete' ? 'opacity-50' : ''}`}>
                <div className="w-3 h-3 bg-red-500 rounded-full mr-2" /> Keine Werbung
              </span>
            </div>
          </CardContent>
        </Card>
        
        <Card className="col-span-1 border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-4 flex flex-col items-center justify-center h-full">
            <p className="text-[10px] sm:text-xs text-emerald-500/70 font-bold uppercase tracking-wider">Gesamt verteilte Flyer</p>
            <h3 className="text-3xl font-bold text-emerald-400 mt-1">{totalFlyers.toLocaleString()}</h3>
          </CardContent>
        </Card>
      </div>

      <div className="relative rounded-lg overflow-hidden border border-slate-700 h-[600px] bg-slate-900 group" ref={mapRef}>
        <MapContainer 
          center={[CENTER_LAT, CENTER_LNG]} 
          zoom={17} 
          style={{ height: '100%', width: '100%', backgroundColor: '#0f172a' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />
          <MapEvents />
          
          {areas.map(area => (
             <Polygon 
               key={area.id}
               positions={area.points} 
               pathOptions={{ 
                   fillColor: mode === 'delete' ? '#ef4444' : '#10b981', 
                   fillOpacity: mode === 'delete' ? 0.6 : 0.4, 
                   color: mode === 'delete' ? '#ef4444' : '#10b981', 
                   weight: 2 
               }}
               eventHandlers={{ click: (e) => handleDeleteArea(area.id, e) }}
             >
                 {mode === 'delete' && <Tooltip sticky>Klicken zum Löschen</Tooltip>}
             </Polygon>
          ))}

          {/* Rendering the current drawing lines */}
          {mode === 'draw' && tempDrawPath.length > 0 && (
             <Polyline 
               positions={tempDrawPath} 
               pathOptions={{ color: '#3b82f6', weight: 2, dashArray: '5, 5' }}
             />
          )}

          {/* Render markers for each point in the current drawing to give feedback to where they clicked */}
          {mode === 'draw' && drawingPoints.map((pt, i) => {
             const canClose = i === 0 && drawingPoints.length > 2;
             return (
               <CircleMarker 
                 key={i} 
                 center={pt} 
                 radius={canClose ? 8 : 4} 
                 pathOptions={{ 
                     color: canClose ? '#10b981' : '#2563eb', 
                     fillColor: canClose ? '#10b981' : '#fff', 
                     fillOpacity: canClose ? 0.8 : 1, 
                     weight: 2 
                 }}
                 eventHandlers={{
                     click: (e) => {
                         if (canClose) {
                             e.originalEvent.stopPropagation();
                             completePolygon();
                         }
                     }
                 }}
               >
                  {canClose && <Tooltip permanent direction="right" className="bg-emerald-500 text-white border-0 font-bold opacity-90 text-xs">Zum Verbinden anklicken</Tooltip>}
               </CircleMarker>
             );
          })}

          {/* Fill the already clicked points so they see the forming area */}
          {mode === 'draw' && drawingPoints.length > 2 && (
             <Polygon 
               positions={drawingPoints} 
               pathOptions={{ fillColor: '#3b82f6', fillOpacity: 0.2, color: 'transparent', weight: 0 }}
             />
          )}

          {excludedHouses.map((house) => (
            <CircleMarker
              key={house.id}
              center={house.point}
              radius={7}
              pathOptions={{ 
                  fillColor: mode === 'delete' ? '#f97316' : '#ef4444', 
                  fillOpacity: mode === 'delete' ? 0.9 : 0.9, 
                  color: mode === 'delete' ? '#ea580c' : '#b91c1c', 
                  weight: 2 
              }}
              eventHandlers={{ click: (e) => handleDeleteHouse(house.id, e) }}
            >
                {mode === 'delete' && <Tooltip sticky>Klicken zum Löschen</Tooltip>}
            </CircleMarker>
          ))}
        </MapContainer>
        
        {/* Drawing Context Actions overlay */}
        {mode === 'draw' && (
            <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-[1000] flex space-x-2 bg-slate-900/90 backdrop-blur-md p-2 rounded-xl shadow-2xl border border-slate-700/50">
                {drawingPoints.length > 0 && (
                    <Button variant="secondary" size="sm" onClick={handleUndoPoint} className="text-slate-300">
                        <Undo2 className="w-4 h-4 mr-1" /> Zurück
                    </Button>
                )}
                <Button 
                    variant="default" 
                    size="sm" 
                    className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed" 
                    onClick={completePolygon}
                    disabled={drawingPoints.length <= 2}
                >
                    <Check className="w-4 h-4 mr-1" /> Fertigstellen
                </Button>
            </div>
        )}
        
        {/* Delete Mode Banner */}
        {mode === 'delete' && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000] bg-orange-500/90 backdrop-blur-sm text-white px-4 py-2 rounded-full font-medium shadow-xl flex items-center border border-orange-400">
                <Eraser className="w-4 h-4 mr-2" />
                Klicke auf eine Zone oder ein Haus, um es zu löschen
            </div>
        )}

        {/* Modal Overlay */}
        {showModal && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm z-[1000] flex items-center justify-center p-4">
            <Card className="w-full max-w-sm shadow-2xl border-emerald-500/30">
              <CardHeader>
                <CardTitle className="text-lg text-slate-100">Wie viele Flyer?</CardTitle>
              </CardHeader>
              <CardContent>
                  <Input 
                    type="number"
                    placeholder="Anzahl Flyer (exakt)"
                    value={currentFlyerCount}
                    onChange={(e) => setCurrentFlyerCount(e.target.value)}
                    className="mb-4 text-center text-xl font-bold bg-slate-800 border-emerald-500/50 focus:border-emerald-500"
                    autoFocus
                  />
                  <div className="flex space-x-2">
                    <Button variant="secondary" className="flex-1" onClick={cancelDrawing}>Abbrechen</Button>
                    <Button variant="default" className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white" onClick={handleSaveArea}>Speichern</Button>
                  </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
