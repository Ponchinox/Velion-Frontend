import React, { createContext, useContext, useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const UnsavedChangesContext = createContext();

export function UnsavedChangesProvider({ children }) {
  const [isDirty, setIsDirty] = useState(false);
  const location = useLocation();

  // Limpiar automáticamente el estado dirty al cambiar de ruta exitosamente
  useEffect(() => {
    setIsDirty(false);
  }, [location.pathname]);

  return (
    <UnsavedChangesContext.Provider value={{ isDirty, setIsDirty }}>
      {children}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges() {
  const context = useContext(UnsavedChangesContext);
  if (!context) {
    throw new Error('useUnsavedChanges debe usarse dentro de un UnsavedChangesProvider');
  }
  return context;
}
