import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';

/**
 * Componente Modal Global Estandarizado (Sistema de Diseño)
 * - Renderizado en Portal de Document Body (z-[99999]) para cubrir 100% de la pantalla sin fugas ni bordes.
 * - Backdrop z-[99999] bg-black/50 backdrop-blur-sm que cubre Topbar y elementos fijos.
 * - Bloqueo de scroll en document.body mientras el modal está abierto para evitar scroll de fondo.
 * - Ventana bg-card rounded-xl border border-line shadow-2xl con max-height responsive y scroll interno fluido.
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'max-w-md',
}) {
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;

    // Compensar ancho de barra de scroll para evitar saltos de layout
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto overscroll-contain"
      role="dialog"
      aria-modal="true"
      aria-labelledby="global-modal-title"
    >
      <div
        className={`bg-card w-full ${maxWidth} max-h-[90vh] sm:max-h-[88vh] rounded-xl border border-line shadow-2xl text-left p-5 sm:p-6 relative flex flex-col animate-in zoom-in-95 duration-150 my-auto`}
      >
        {/* Botón Cerrar */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 sm:top-5 right-4 sm:right-5 z-20 text-lo hover:text-hi transition-colors cursor-pointer p-1 rounded-lg hover:bg-app/50"
            aria-label="Cerrar"
          >
            <X size={20} weight="bold" />
          </button>
        )}

        {/* Header del Modal - Fijo en la parte superior */}
        {(title || subtitle) && (
          <div className="space-y-1 pr-10 flex-shrink-0 mb-4">
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

        {/* Contenido scrolleable con scrollbar visible y elegante */}
        <div className="overflow-y-auto overscroll-contain flex-1 min-h-0 pr-1.5 -mr-1.5 [scrollbar-width:thin] [scrollbar-color:var(--c-line-strong)_transparent]">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

