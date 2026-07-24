import React from 'react';

/**
 * Modal tradicional y limpio de alerta de cambios sin guardar.
 * Se muestra únicamente cuando el blocker de React Router está en estado 'blocked'.
 * 
 * @param {object} blocker Objeto blocker retornado por useUnsavedChangesWarning.
 */
export default function UnsavedChangesModal({ blocker }) {
  if (!blocker || blocker.state !== 'blocked') {
    return null;
  }

  return (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-gray-600/50"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white w-full max-w-sm rounded-lg border border-gray-200 shadow-lg overflow-hidden">
        <div className="p-6 text-center">
          <h3 className="text-base font-bold text-gray-900">
            Cambios sin guardar
          </h3>
          <p className="text-sm text-gray-600 mt-3 leading-relaxed">
            Tienes cambios sin guardar. ¿Estás seguro de que deseas salir? Perderás los datos modificados.
          </p>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => blocker.reset()}
            className="px-4 py-2 text-xs font-semibold bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-md transition-colors cursor-pointer"
          >
            Quedarme a guardar
          </button>
          <button
            type="button"
            onClick={() => blocker.proceed()}
            className="px-4 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-md shadow-sm transition-colors cursor-pointer"
          >
            Salir sin guardar
          </button>
        </div>
      </div>
    </div>
  );
}
