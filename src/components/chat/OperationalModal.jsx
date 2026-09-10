import React, { useState, useRef, useEffect } from 'react';
import { X, SpinnerGap, CheckSquareOffset, FileText } from '@phosphor-icons/react';
import {
  NOTE_CATEGORIES,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  validateOperationalInput,
} from '../../utils/operationalFormatters';

/**
 * Modal para creación de Nueva Nota o Nueva Tarea operacional
 * Velion Business Agent — Fase 2D-B
 */
export default function OperationalModal({
  isOpen,
  initialType = 'TASK', // 'TASK' | 'NOTE'
  chatId,
  customerName = '',
  onClose,
  onSubmit,
}) {
  const [type, setType] = useState(initialType);
  const [summary, setSummary] = useState('');
  const [category, setCategory] = useState(initialType === 'TASK' ? 'FOLLOW_UP' : 'GENERAL');
  const [subjectName, setSubjectName] = useState(customerName || '');
  const [priority, setPriority] = useState('NORMAL');
  const [dueDateLocal, setDueDateLocal] = useState('');
  const [dueTimeLocal, setDueTimeLocal] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Token de generación para invalidar resoluciones asíncronas de modales cerrados o chats previos
  const modalGenerationRef = useRef(0);

  // Sincronizar estado cuando se abre o conmuta de chat/tipo
  useEffect(() => {
    modalGenerationRef.current += 1;
    if (isOpen) {
      setType(initialType);
      setCategory(initialType === 'TASK' ? 'FOLLOW_UP' : 'GENERAL');
      setSubjectName(customerName || '');
      setSummary('');
      setPriority('NORMAL');
      setDueDateLocal('');
      setDueTimeLocal('');
      setFormError('');
      setIsSubmitting(false);
    }
  }, [isOpen, chatId, initialType, customerName]);

  // Si cambia el tipo entre TASK y NOTE, ajustar categoría por defecto si no es válida
  const handleTypeChange = (newType) => {
    setType(newType);
    setFormError('');
    if (newType === 'NOTE') {
      setCategory('GENERAL');
    } else {
      setCategory('FOLLOW_UP');
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const submitGen = modalGenerationRef.current;

    // Validación previa mediante validador centralizado
    const validation = validateOperationalInput({
      type,
      category,
      summary,
      chatId,
      dueDateLocal,
      dueTimeLocal,
    });

    if (!validation.valid) {
      setFormError(validation.error);
      return;
    }

    setIsSubmitting(true);
    setFormError('');

    try {
      const payload = {
        type,
        category,
        summary: summary.trim(),
        chatId,
      };

      if (subjectName.trim()) {
        payload.subjectName = subjectName.trim();
      }

      if (type === 'TASK') {
        payload.priority = priority;
        if (dueDateLocal) payload.dueDateLocal = dueDateLocal;
        if (dueTimeLocal) payload.dueTimeLocal = dueTimeLocal;
      }

      await onSubmit(payload);

      // Solo cerrar si la promesa corresponde a la generación activa actual del modal
      if (submitGen === modalGenerationRef.current) {
        onClose();
      }
    } catch (err) {
      // Solo reportar error si el modal no ha sido reiniciado/conmutado a otro chat
      if (submitGen === modalGenerationRef.current) {
        console.error('Error al crear item operacional:', err);
        setFormError(err.message || 'Error al guardar el elemento. Intenta nuevamente.');
        setIsSubmitting(false);
      }
    }
  };

  const categories = type === 'NOTE' ? NOTE_CATEGORIES : TASK_CATEGORIES;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-fast">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="operational-modal-title"
        className="w-full max-w-md rounded-2xl bg-card border border-line shadow-xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-fast"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div className="flex items-center gap-2">
            {type === 'TASK' ? (
              <CheckSquareOffset size={20} className="text-brand" weight="bold" />
            ) : (
              <FileText size={20} className="text-purple-600" weight="bold" />
            )}
            <h3 id="operational-modal-title" className="text-base font-bold text-hi">
              {type === 'TASK' ? 'Nueva Tarea Operacional' : 'Nueva Nota Operacional'}
            </h3>
          </div>

          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-lo hover:text-hi hover:bg-app transition-colors cursor-pointer"
            aria-label="Cerrar modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Selector de Tipo (Tabs) ── */}
        <div className="px-5 pt-4 pb-2">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-app border border-line">
            <button
              type="button"
              onClick={() => handleTypeChange('TASK')}
              className={`
                flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer
                ${type === 'TASK' ? 'bg-card text-brand shadow-sm' : 'text-lo hover:text-hi'}
              `}
            >
              <CheckSquareOffset size={14} weight="bold" />
              Tarea
            </button>
            <button
              type="button"
              onClick={() => handleTypeChange('NOTE')}
              className={`
                flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer
                ${type === 'NOTE' ? 'bg-card text-purple-600 shadow-sm' : 'text-lo hover:text-hi'}
              `}
            >
              <FileText size={14} weight="bold" />
              Nota
            </button>
          </div>
        </div>

        {/* ── Formulario ── */}
        <form onSubmit={handleSubmit} className="px-5 py-3 space-y-3.5 overflow-y-auto max-h-[75vh]">
          {formError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
              {formError}
            </div>
          )}

          {/* Categoría */}
          <div>
            <label htmlFor="op-modal-category" className="block text-xs font-semibold text-hi mb-1">
              Categoría <span className="text-danger">*</span>
            </label>
            <select
              id="op-modal-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-line bg-app text-hi focus:outline-none focus:border-brand"
            >
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Resumen / Descripción */}
          <div>
            <label htmlFor="op-modal-summary" className="block text-xs font-semibold text-hi mb-1">
              Descripción / Resumen <span className="text-danger">*</span>
            </label>
            <textarea
              id="op-modal-summary"
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={type === 'TASK' ? 'Ej: Llamar para confirmar fecha de instalación...' : 'Ej: El cliente prefiere entregas por la mañana...'}
              className="w-full px-3 py-2 text-xs rounded-lg border border-line bg-app text-hi placeholder:text-muted focus:outline-none focus:border-brand resize-none"
              required
            />
          </div>

          {/* Cliente / Sujeto relacionado (opcional) */}
          <div>
            <label htmlFor="op-modal-subject" className="block text-xs font-semibold text-hi mb-1">
              Cliente o Referencia (Opcional)
            </label>
            <input
              id="op-modal-subject"
              type="text"
              value={subjectName}
              onChange={(e) => setSubjectName(e.target.value)}
              placeholder="Nombre del cliente o contacto"
              className="w-full px-3 py-2 text-xs rounded-lg border border-line bg-app text-hi placeholder:text-muted focus:outline-none focus:border-brand"
            />
          </div>

          {/* Campos específicos de Tarea */}
          {type === 'TASK' && (
            <>
              {/* Prioridad */}
              <div>
                <label className="block text-xs font-semibold text-hi mb-1">
                  Prioridad
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {TASK_PRIORITIES.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setPriority(p.value)}
                      className={`
                        py-1.5 px-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer text-center
                        ${priority === p.value
                          ? p.value === 'HIGH'
                            ? 'bg-rose-50 border-rose-300 text-rose-700'
                            : p.value === 'NORMAL'
                            ? 'bg-blue-50 border-blue-300 text-brand'
                            : 'bg-gray-100 border-gray-300 text-gray-700'
                          : 'bg-app border-line text-lo hover:border-line-strong'
                        }
                      `}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fecha y Hora de Vencimiento Local */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="op-modal-due-date" className="block text-xs font-semibold text-hi mb-1">
                    Fecha límite (Opcional)
                  </label>
                  <input
                    id="op-modal-due-date"
                    type="date"
                    value={dueDateLocal}
                    onChange={(e) => setDueDateLocal(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-line bg-app text-hi focus:outline-none focus:border-brand"
                  />
                </div>
                <div>
                  <label htmlFor="op-modal-due-time" className="block text-xs font-semibold text-hi mb-1">
                    Hora límite (Opcional)
                  </label>
                  <input
                    id="op-modal-due-time"
                    type="time"
                    value={dueTimeLocal}
                    onChange={(e) => setDueTimeLocal(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-line bg-app text-hi focus:outline-none focus:border-brand"
                  />
                </div>
              </div>
            </>
          )}

          {/* ── Footer con Botones ── */}
          <div className="pt-3 border-t border-line flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-line bg-app text-lo hover:text-hi hover:bg-line transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !summary.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-brand hover:bg-brand-hover text-white shadow-card transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <SpinnerGap size={14} className="animate-spin" />
                  Guardando...
                </>
              ) : (
                type === 'TASK' ? 'Crear Tarea' : 'Crear Nota'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
