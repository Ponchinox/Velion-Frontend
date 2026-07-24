import React from 'react';
import { createPortal } from 'react-dom';

/**
 * Componente Modal Global de Confirmación (Diseño Minimalista y Limpio)
 * Basado estrictamente en la estructura visual de Conexiones / UnsavedChangesModal.
 * 
 * Props:
 * - isOpen (boolean): Si el modal está activo
 * - onClose (function): Callback al cancelar o cerrar el modal
 * - onConfirm (function): Callback al confirmar la acción
 * - title (string): Título dinámico
 * - message (string): Mensaje dinámico explicativo
 * - confirmText (string, opcional): Texto del botón primario (default: "Eliminar")
 * - cancelText (string, opcional): Texto del botón secundario (default: "Cancelar")
 * - isLoading (boolean, opcional): Estado de carga al ejecutar la acción
 */
export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = '¿Estás seguro?',
  message = 'Esta acción no se puede deshacer.',
  confirmText = 'Eliminar',
  cancelText = 'Cancelar',
  isLoading = false,
}) {
  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="bg-card w-full max-w-sm rounded-xl border border-line shadow-2xl overflow-hidden text-left">
        <div className="p-6 text-center">
          <h3 id="confirm-modal-title" className="text-base font-bold text-hi">
            {title}
          </h3>
          <p className="text-sm text-lo mt-2 leading-relaxed">
            {message}
          </p>
        </div>

        <div className="px-6 py-4 bg-app/50 border-t border-line flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-xs font-semibold bg-app border border-line hover:bg-card text-hi rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="px-4 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg shadow-sm transition-colors cursor-pointer disabled:opacity-50"
          >
            {isLoading ? 'Eliminando...' : confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
