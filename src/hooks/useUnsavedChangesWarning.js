import { useCallback } from 'react';
import { useBlocker, useBeforeUnload } from 'react-router-dom';

/**
 * Hook universal de advertencia de cambios sin guardar.
 * Intercepta tanto el cierre/recarga de pestaña del navegador como la navegación interna de React Router.
 * Retorna el objeto blocker para controlar de forma personalizada el bloqueo de rutas.
 * 
 * @param {boolean} isDirty Define si el formulario actual se encuentra con cambios pendientes de guardado.
 */
export function useUnsavedChangesWarning(isDirty) {
  const message = "Tiene cambios sin guardar en esta sección. ¿Está seguro de que desea abandonar la página? Los datos no guardados se perderán.";

  // 1. Interceptar recarga o cierre físico de la pestaña del navegador
  useBeforeUnload(
    useCallback(
      (event) => {
        if (isDirty) {
          event.preventDefault();
          event.returnValue = message;
          return message;
        }
      },
      [isDirty]
    )
  );

  // 2. Interceptar navegación interna en la Single Page Application (React Router)
  const blocker = useBlocker(
    useCallback(
      (arg) => {
        if (!isDirty) return false;
        const currentPath = arg?.currentLocation?.pathname;
        const nextPath = arg?.nextLocation?.pathname;
        if (currentPath && nextPath && currentPath === nextPath) {
          return false;
        }
        return true;
      },
      [isDirty]
    )
  );

  return blocker;
}
