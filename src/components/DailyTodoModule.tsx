import React, { useState } from 'react';
import { DailyTodo, Bike, ServiceRequest } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Plus, CheckCircle2, Circle, Trash2, ArrowLeft, Bike as BikeIcon, Users, Clock, Wrench, Calendar as CalendarIcon } from 'lucide-react';
import { FlyerTrackingMap } from './FlyerTrackingMap';

interface DailyTodoModuleProps {
  todos: DailyTodo[];
  addTodo: (text: string, linkedBikeId?: string) => void;
  toggleTodo: (id: string) => void;
  deleteTodo: (id: string) => void;
  bikes: Bike[];
  onNavigateBack: () => void;
  onNavigateToBike: (bikeId: string) => void;
  addLog: (message: string, module: 'tracking' | 'workshop' | 'stopwatch' | 'system', revertAction?: any) => void;
  serviceRequests: ServiceRequest[];
  addServiceRequest: (request: Omit<ServiceRequest, 'id' | 'userId'>) => void;
  updateServiceRequest: (id: string, updates: Partial<ServiceRequest>) => void;
  deleteServiceRequest: (id: string) => void;
}

export function DailyTodoModule({ 
  todos, addTodo, toggleTodo, deleteTodo, bikes, onNavigateBack, onNavigateToBike, addLog,
  serviceRequests, addServiceRequest, updateServiceRequest, deleteServiceRequest
}: DailyTodoModuleProps) {
  const [newTodoText, setNewTodoText] = useState('');
  const [showBikeSuggestions, setShowBikeSuggestions] = useState(false);
  const [selectedBikeId, setSelectedBikeId] = useState<string | undefined>(undefined);

  // Filter bikes that are not sold
  const activeBikes = bikes.filter(b => b.status !== 'Verkauft');

  const handleAddTodo = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newTodoText.trim()) return;
    addTodo(newTodoText, selectedBikeId);
    setNewTodoText('');
    setSelectedBikeId(undefined);
    setShowBikeSuggestions(false);
  };

  const handleToggleTodo = (id: string) => {
    toggleTodo(id);
  };

  const handleDeleteTodo = (id: string) => {
    deleteTodo(id);
  };

  // Auto-suggest bike based on text input
  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setNewTodoText(text);
    
    if (text.length > 2) {
      const match = activeBikes.find(b => b.name.toLowerCase().includes(text.toLowerCase()));
      if (match && !selectedBikeId) {
        setShowBikeSuggestions(true);
      } else {
        setShowBikeSuggestions(false);
      }
    } else {
      setShowBikeSuggestions(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData('text');
    if (pastedText.includes('\n') || pastedText.includes('\\')) {
      e.preventDefault();
      
      const target = e.target as HTMLInputElement;
      const start = target.selectionStart || 0;
      const end = target.selectionEnd || 0;
      
      const textBefore = newTodoText.substring(0, start);
      const textAfter = newTodoText.substring(end);
      
      const fullText = textBefore + pastedText + textAfter;
      const lines = fullText.split(/[\n\\]/).map(line => line.trim()).filter(line => line !== '');
      
      if (lines.length > 0) {
        lines.forEach(line => {
          addTodo(line, selectedBikeId);
        });
        setNewTodoText('');
        setShowBikeSuggestions(false);
      }
    }
  };

  const formatTodoDate = (timestamp?: number) => {
    if (!timestamp) return 'Heute'; // Fallback for old todos
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Heute';
    if (date.toDateString() === yesterday.toDateString()) return 'Gestern';
    
    return date.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const uncompletedTodos = todos.filter(t => !t.completed);
  const completedTodos = todos.filter(t => t.completed);

  const todayStr = new Date().toDateString();
  const uncompletedToday = uncompletedTodos.filter(t => !t.createdAt || new Date(t.createdAt).toDateString() === todayStr);
  const uncompletedPast = uncompletedTodos.filter(t => t.createdAt && new Date(t.createdAt).toDateString() !== todayStr);

  // Sort completed newest first
  const sortedCompleted = [...completedTodos].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const groupedCompleted: Record<string, DailyTodo[]> = {};
  sortedCompleted.forEach(todo => {
    const dateStr = formatTodoDate(todo.createdAt);
    if (!groupedCompleted[dateStr]) groupedCompleted[dateStr] = [];
    groupedCompleted[dateStr].push(todo);
  });

  const renderTodoItem = (todo: DailyTodo) => (
    <div
      key={todo.id}
      className={`group flex items-center justify-between gap-2 p-3 rounded-xl border transition-all ${
        todo.completed ? 'bg-slate-800/20 border-slate-800/40' : 'bg-slate-800/60 border-slate-700/70 hover:border-slate-600'
      }`}
    >
      <div className="flex items-center space-x-3 flex-1 min-w-0">
        <button onClick={() => handleToggleTodo(todo.id)} className="text-slate-500 hover:text-orange-400 transition-colors shrink-0">
          {todo.completed ? <CheckCircle2 className="w-6 h-6 text-emerald-500" /> : <Circle className="w-6 h-6" />}
        </button>
        <div className="flex flex-col min-w-0">
          <span className={`text-sm md:text-base break-words ${todo.completed ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
            {todo.text}
          </span>
          {todo.linkedBikeId && (
            <button
              onClick={() => onNavigateToBike(todo.linkedBikeId!)}
              className="text-xs text-orange-400 hover:text-orange-300 hover:underline flex items-center mt-1 w-fit"
            >
              <BikeIcon className="w-3 h-3 mr-1" />
              {bikes.find(b => b.id === todo.linkedBikeId)?.name || 'Unbekanntes Rad'}
            </button>
          )}
        </div>
      </div>
      <button onClick={() => handleDeleteTodo(todo.id)} className="text-slate-600 hover:text-red-400 p-2 rounded-lg hover:bg-red-500/10 transition-colors shrink-0 md:opacity-0 md:group-hover:opacity-100">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center space-x-4 mb-6">
        <Button variant="ghost" size="icon" onClick={onNavigateBack}>
          <ArrowLeft className="w-6 h-6" />
        </Button>
        <h2 className="text-2xl font-bold">Daily To-Do</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Neue Aufgabe</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddTodo} className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                placeholder="Was steht heute an? (z.B. Cube putzen)"
                value={newTodoText}
                onChange={handleTextChange}
                onPaste={handlePaste}
                className="flex-1"
              />
              <Button type="submit" className="shrink-0">
                <Plus className="w-5 h-5 mr-1" /> Hinzufügen
              </Button>
            </div>
            
            {showBikeSuggestions && (
              <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/70">
                <p className="text-sm text-slate-400 mb-2">Fahrrad verknüpfen?</p>
                <div className="flex flex-wrap gap-2">
                  {activeBikes.filter(b => b.name.toLowerCase().includes(newTodoText.toLowerCase())).map(bike => (
                    <button
                      key={bike.id}
                      type="button"
                      onClick={() => {
                        setSelectedBikeId(bike.id);
                        setShowBikeSuggestions(false);
                      }}
                      className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-full text-slate-200 flex items-center"
                    >
                      <BikeIcon className="w-3 h-3 mr-1" />
                      {bike.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedBikeId && (
              <div className="flex items-center text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded-lg w-fit">
                <BikeIcon className="w-4 h-4 mr-2" />
                Verknüpft: {bikes.find(b => b.id === selectedBikeId)?.name}
                <button 
                  type="button"
                  onClick={() => setSelectedBikeId(undefined)}
                  className="ml-2 text-slate-400 hover:text-slate-200"
                >
                  &times;
                </button>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Offene Aufgaben ({uncompletedTodos.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {uncompletedTodos.length === 0 ? (
              <p className="text-slate-500 text-center py-8">Keine offenen Aufgaben. Zeit zum Schrauben!</p>
            ) : (
              <>
                {uncompletedPast.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center mb-3">
                      <Clock className="w-3 h-3 mr-1" /> Vergangene Aufgaben
                    </h3>
                    {uncompletedPast.map(renderTodoItem)}
                  </div>
                )}
                
                {uncompletedToday.length > 0 && (
                  <div className="space-y-2">
                    {uncompletedPast.length > 0 && (
                      <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center mb-3 mt-6">
                        <CalendarIcon className="w-3 h-3 mr-1" /> Heute
                      </h3>
                    )}
                    {uncompletedToday.map(renderTodoItem)}
                  </div>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {completedTodos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-slate-400">Erledigte Aufgaben ({completedTodos.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-8">
              {Object.entries(groupedCompleted).map(([dateStr, dateTodos]) => (
                <div key={dateStr} className="space-y-2">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center mb-3 border-b border-slate-800 pb-2">
                    <CalendarIcon className="w-3 h-3 mr-2" /> {dateStr}
                  </h3>
                  {dateTodos.map(renderTodoItem)}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <FlyerTrackingMap />
    </div>
  );
}
