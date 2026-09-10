import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  X,
  Plus,
  CheckSquareOffset,
  FileText,
  SpinnerGap,
  WarningCircle,
  ArrowClockwise,
  ClipboardText,
} from '@phosphor-icons/react';
import OperationalCard from './OperationalCard';
import OperationalModal from './OperationalModal';
import { sortTasks, sortNotes } from '../../utils/operationalFormatters';

/**
 * Drawer lateral contextual para Notas y Tareas Operacionales
 * Velion Business Agent — Fase 2D-B
 */
export default function OperationalDrawer({
  isOpen,
  onClose,
  items = [],
  isLoading = false,
  error = '',
  onRetry,
  onStart,
  onComplete,
  onCancel,
  onArchive,
  onCreate,
  chatId,
  customerName = '',
}) {
  const [activeTab, setActiveTab] = useState('TASKS'); // 'TASKS' | 'NOTES' | 'ALL'
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState('TASK');
  const [processingId, setProcessingId] = useState(null);
  const [actionError, setActionError] = useState('');

  // Referencia estable al chatId activo para aislar errores asíncronos entre chats
  const currentChatIdRef = useRef(chatId);

  // Resetear/cerrar modal de creación y error si el operador conmuta de chat
  useEffect(() => {
    currentChatIdRef.current = chatId;
    setModalOpen(false);
    setActionError('');
    setProcessingId(null);
  }, [chatId]);

  // Separar y ordenar items mediante memoización
  const { tasks, notes, allSorted, activeTasksCount, activeNotesCount } = useMemo(() => {
    const rawTasks = items.filter((i) => i.type === 'TASK');
    const rawNotes = items.filter((i) => i.type === 'NOTE');

    const sortedT = sortTasks(rawTasks);
    const sortedN = sortNotes(rawNotes);

    const activeT = rawTasks.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS').length;
    const activeN = rawNotes.filter((n) => n.status === 'ACTIVE').length;

    // En 'Todas', tareas primero y notas después
    const combined = [...sortedT, ...sortedN];

    return {
      tasks: sortedT,
      notes: sortedN,
      allSorted: combined,
      activeTasksCount: activeT,
      activeNotesCount: activeN,
    };
  }, [items]);

  // Manejo de mutaciones con protección de doble clic y aislamiento de errores por chat
  const handleLifecycleAction = async (actionFn, item) => {
    if (processingId) return; // Protección contra doble-click
    const operationChatId = chatId;
    setProcessingId(item.id);
    setActionError('');
    try {
      await actionFn(item);
    } catch (err) {
      console.error('Error en acción de ciclo de vida:', err);
      if (operationChatId === currentChatIdRef.current) {
        setActionError(err.message || 'Error al ejecutar la acción. Intenta nuevamente.');
      }
    } finally {
      if (operationChatId === currentChatIdRef.current) {
        setProcessingId(null);
      }
    }
  };

  const openCreateModal = (type) => {
    setModalType(type);
    setModalOpen(true);
    setActionError('');
  };

  if (!isOpen) return null;

  const currentList =
    activeTab === 'TASKS' ? tasks : activeTab === 'NOTES' ? notes : allSorted;

  return (
    <>
      {/* ── Overlay / Backdrop en móviles y tablet ── */}
      <div
        className="fixed inset-0 bg-black/25 z-40 lg:hidden transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* ── Panel Drawer Lateral ── */}
      <aside
        className={`
          fixed lg:static top-0 right-0 h-full z-40
          w-full sm:w-96 md:w-[420px] lg:flex-shrink-0 bg-card border-l border-line
          flex flex-col shadow-2xl lg:shadow-none animate-in slide-in-from-right duration-200
        `}
        aria-label="Panel de Notas y Tareas Operacionales"
      >
        {/* ── Header ── */}
        <div className="px-5 py-4 border-b border-line flex items-center justify-between flex-shrink-0 bg-card">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-brand/10 text-brand flex items-center justify-center flex-shrink-0">
              <ClipboardText size={20} weight="bold" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-hi leading-tight">Notas y tareas</h2>
              {customerName && (
                <p className="text-xs text-lo truncate max-w-[200px]" title={customerName}>
                  {customerName}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-lo hover:text-hi hover:bg-app transition-colors cursor-pointer"
            aria-label="Cerrar panel de notas y tareas"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Botones de Creación Rápida ── */}
        <div className="px-5 pt-3.5 pb-2 flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => openCreateModal('TASK')}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-brand hover:bg-brand-hover text-white shadow-card transition-all cursor-pointer"
          >
            <Plus size={14} weight="bold" />
            Nueva tarea
          </button>

          <button
            onClick={() => openCreateModal('NOTE')}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 transition-all cursor-pointer"
          >
            <Plus size={14} weight="bold" />
            Nueva nota
          </button>
        </div>

        {/* ── Tabs de Navegación ── */}
        <div className="px-5 py-2 border-b border-line flex-shrink-0">
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-app border border-line text-xs font-semibold">
            <button
              onClick={() => setActiveTab('TASKS')}
              className={`
                flex items-center justify-center gap-1 py-1.5 rounded-lg transition-all cursor-pointer
                ${activeTab === 'TASKS' ? 'bg-card text-brand shadow-sm' : 'text-lo hover:text-hi'}
              `}
            >
              <CheckSquareOffset size={14} />
              <span>Tareas</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${activeTasksCount > 0 ? 'bg-brand text-white' : 'bg-line text-lo'}`}>
                {activeTasksCount}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('NOTES')}
              className={`
                flex items-center justify-center gap-1 py-1.5 rounded-lg transition-all cursor-pointer
                ${activeTab === 'NOTES' ? 'bg-card text-purple-600 shadow-sm' : 'text-lo hover:text-hi'}
              `}
            >
              <FileText size={14} />
              <span>Notas</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${activeNotesCount > 0 ? 'bg-purple-600 text-white' : 'bg-line text-lo'}`}>
                {activeNotesCount}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('ALL')}
              className={`
                flex items-center justify-center gap-1 py-1.5 rounded-lg transition-all cursor-pointer
                ${activeTab === 'ALL' ? 'bg-card text-hi shadow-sm' : 'text-lo hover:text-hi'}
              `}
            >
              <span>Todas</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-line text-lo font-bold">
                {items.length}
              </span>
            </button>
          </div>
        </div>

        {/* ── Banner de Error de Acción ── */}
        {actionError && (
          <div className="mx-5 my-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700 flex items-start justify-between gap-2">
            <span>{actionError}</span>
            <button
              onClick={() => setActionError('')}
              className="text-rose-500 hover:text-rose-800 cursor-pointer"
              aria-label="Descartar mensaje de error"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* ── Contenido de Lista / Skeletons / Empty State ── */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3" style={{ WebkitOverflowScrolling: 'touch' }}>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-48 space-y-3">
              <SpinnerGap size={28} className="animate-spin text-brand" />
              <p className="text-xs text-lo">Cargando notas y tareas...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center p-6 text-center space-y-3 mt-6">
              <WarningCircle size={32} className="text-danger" />
              <div>
                <p className="text-sm font-semibold text-hi">No se pudieron cargar los datos</p>
                <p className="text-xs text-lo mt-0.5">{error}</p>
              </div>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-brand text-white hover:bg-brand-hover rounded-lg shadow-sm transition-colors cursor-pointer"
                >
                  <ArrowClockwise size={13} />
                  Reintentar
                </button>
              )}
            </div>
          ) : currentList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <div className="w-12 h-12 rounded-2xl bg-app flex items-center justify-center mb-3 text-muted">
                {activeTab === 'TASKS' ? (
                  <CheckSquareOffset size={24} />
                ) : activeTab === 'NOTES' ? (
                  <FileText size={24} />
                ) : (
                  <ClipboardText size={24} />
                )}
              </div>
              <p className="text-sm font-semibold text-hi">
                {activeTab === 'TASKS'
                  ? 'No hay tareas registradas'
                  : activeTab === 'NOTES'
                  ? 'No hay notas registradas'
                  : 'Sin elementos operacionales'}
              </p>
              <p className="text-xs text-lo mt-1 max-w-xs leading-relaxed">
                {activeTab === 'TASKS'
                  ? 'Crea una tarea para hacer seguimiento o deja que la IA la cree automáticamente durante la conversación.'
                  : 'Guarda notas clave del cliente, instrucciones de servicio o acuerdos de coordinación.'}
              </p>
            </div>
          ) : (
            currentList.map((item) => (
              <OperationalCard
                key={item.id}
                item={item}
                isProcessing={processingId === item.id}
                isAnyProcessing={Boolean(processingId)}
                onStart={(i) => handleLifecycleAction(onStart, i)}
                onComplete={(i) => handleLifecycleAction(onComplete, i)}
                onCancel={(i) => handleLifecycleAction(onCancel, i)}
                onArchive={(i) => handleLifecycleAction(onArchive, i)}
              />
            ))
          )}
        </div>
      </aside>

      {/* ── Modal de Creación ── */}
      <OperationalModal
        isOpen={modalOpen}
        initialType={modalType}
        chatId={chatId}
        customerName={customerName}
        onClose={() => setModalOpen(false)}
        onSubmit={onCreate}
      />
    </>
  );
}
