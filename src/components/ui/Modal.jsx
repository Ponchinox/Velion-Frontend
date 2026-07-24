import React from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';

/**
 * Componente Modal Global Estandarizado (Sistema de Diseño)
 * - Renderizado en Portal de Document Body (z-[99999]) para cubrir 100% de la pantalla sin fugas ni bordes.
 * - Backdrop z-[99999] bg-black/50 backdrop-blur-sm que cubre Topbar y elementos fijos.
 * - Ventana bg-card rounded-xl border border-line shadow-2xl.
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'max-w-md',
}) {
  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="global-modal-title"
    >
      <div
        className={`bg-card w-full ${maxWidth} rounded-xl border border-line shadow-2xl overflow-hidden text-left p-6 relative space-y-5 animate-in zoom-in-95 duration-150`}
      >
        {/* Botón Cerrar */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-5 right-5 text-lo hover:text-hi transition-colors cursor-pointer p-1 rounded-lg hover:bg-app/50"
            aria-label="Cerrar"
          >
            <X size={20} weight="bold" />
          </button>
        )}

        {/* Header del Modal */}
        {(title || subtitle) && (
          <div className="space-y-1 pr-8">
            {title && (
              <h3 id="global-modal-title" className="text-lg font-extrabold text-hi tracking-tight">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-xs text-lo leading-relaxed">
                {subtitle}
              </p>
            )}
          </div>
        )}

        {/* Contenido */}
        <div>{children}</div>
      </div>
    </div>,
    document.body
  );
}
