import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import MobileNav from './MobileNav';
import { AlertTriangle } from 'lucide-react';
import { useUnsavedChanges } from '../../context/UnsavedChangesContext';
import { useUnsavedChangesWarning } from '../../hooks/useUnsavedChangesWarning';
import UnsavedChangesModal from '../ui/UnsavedChangesModal';

export default function MainLayout() {
  const impersonatedTenantId = localStorage.getItem('impersonatedTenantId');
  const impersonatedTenantName = localStorage.getItem('impersonatedTenantName');
  const location = useLocation();
  const isChatRoute = location.pathname.includes('/mensajes') || location.pathname.includes('/automatizacion');

  const { isDirty } = useUnsavedChanges();
  const blocker = useUnsavedChangesWarning(isDirty);

  const handleExitImpersonation = () => {
    localStorage.removeItem('impersonatedTenantId');
    localStorage.removeItem('impersonatedTenantName');
    window.location.href = '/admin-empresas';
  };

  return (
    <div className={`flex ${isChatRoute ? 'h-dvh max-h-dvh overflow-hidden' : 'min-h-dvh'} bg-app`}>

      {/* Sidebar: visible on desktop, hidden on mobile */}
      <Sidebar />

      {/* Main content area */}
      <div
        className={`
          flex-1 flex flex-col ${isChatRoute ? 'h-dvh max-h-dvh overflow-hidden' : 'min-h-dvh'}
          w-full
          md:ml-[var(--sidebar-w)]
        `}
      >
        {impersonatedTenantId && (
          <div className="bg-amber-600 text-white py-2.5 px-6 flex items-center justify-between text-xs font-semibold shadow-md border-b border-amber-700 z-50">
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-white flex-shrink-0 animate-pulse" />
              Modo Soporte Activo: Estás visualizando los datos de "{impersonatedTenantName}"
            </span>
            <button
              onClick={handleExitImpersonation}
              className="bg-white hover:bg-amber-50 text-amber-800 px-3 py-1.5 rounded font-bold shadow-sm transition-all duration-fast active:scale-[0.97] cursor-pointer"
            >
              Salir del Soporte
            </button>
          </div>
        )}

        {/* TopBar: hidden on desktop (md:hidden), visible on mobile */}
        <TopBar />

        {/* 
           Responsive Padding Top:
           - On mobile: pt-16 (64px) to clear the fixed TopBar.
           - On desktop: md:pt-8 as TopBar is hidden and content can start higher up.
        */}
        <main
          id="main-content"
          tabIndex={-1}
          className={`flex-1 flex flex-col ${isChatRoute ? 'h-[calc(100dvh-64px)] max-h-[calc(100dvh-64px)] md:h-screen md:max-h-screen overflow-hidden pt-16 md:pt-0' : 'overflow-y-auto pt-16 md:pt-8'}`}
        >
          {/* Bento navigation: visible on mobile, hidden on desktop */}
          <MobileNav />

          {/* Page content */}
          <div className={isChatRoute ? 'flex-1 h-full w-full overflow-hidden flex flex-col' : 'px-4 py-5 md:px-8 md:py-8'}>
            <Outlet />
          </div>
        </main>
      </div>

      <UnsavedChangesModal blocker={blocker} />
    </div>
  );
}
