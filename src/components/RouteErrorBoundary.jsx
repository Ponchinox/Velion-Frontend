import React, { useEffect } from 'react';
import { useRouteError, useNavigate } from 'react-router-dom';
import { AlertCircle, RefreshCw, LayoutDashboard } from 'lucide-react';

export default function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  useEffect(() => {
    // Registro técnico reservado únicamente para consola de desarrollador
    console.error('[RouteErrorBoundary]: Error no capturado en ruta:', error);
  }, [error]);

  const handleRetry = () => {
    window.location.reload();
  };

  const handleGoDashboard = () => {
    navigate('/dashboard');
  };

  return (
    <div className="min-h-[55vh] flex items-center justify-center p-6 w-full">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
        <div className="w-14 h-14 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4 border border-amber-200">
          <AlertCircle className="w-7 h-7" />
        </div>
        
        <h2 className="text-xl font-bold text-slate-900 mb-2">
          No pudimos cargar esta sección.
        </h2>
        
        <p className="text-sm text-slate-600 mb-6 leading-relaxed">
          Intenta nuevamente o vuelve al panel.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleRetry}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-all shadow-sm active:scale-95 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            Reintentar
          </button>
          
          <button
            type="button"
            onClick={handleGoDashboard}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-lg text-sm font-semibold transition-all active:scale-95 cursor-pointer"
          >
            <LayoutDashboard className="w-4 h-4" />
            Volver al panel
          </button>
        </div>
      </div>
    </div>
  );
}
