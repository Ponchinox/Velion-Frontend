import { useState, useEffect } from 'react';
import { SignOut } from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';
import * as settingsService from '../../services/settingsService';

export default function TopBar() {
  const { user, signOut } = useAuth();
  const [storeName, setStoreName] = useState(() => user?.tenantName || 'Velion Agent');

  useEffect(() => {
    let isMounted = true;
    settingsService.getSettings().then(data => {
      if (isMounted && data?.name) {
        setStoreName(data.name);
      }
    }).catch(() => {});
    return () => { isMounted = false; };
  }, []);

  const displayName = storeName || user?.tenantName || 'Velion Agent';

  return (
    <header
      className="
        md:hidden fixed top-0 left-0 right-0 z-20
        flex items-center justify-between px-4
        bg-card border-b border-line shadow-card
      "
      style={{ height: 'var(--topbar-h)' }}
      role="banner"
    >
      {/* Brand logo/name on the left for Mobile View */}
      <div className="flex items-center min-w-0">
        <span className="text-base font-extrabold tracking-tight text-hi bg-gradient-to-r from-brand via-indigo-600 to-blue-500 bg-clip-text text-transparent truncate">
          {displayName}
        </span>
      </div>

      {/* Profile/Logout on the right for Mobile View */}
      <button
        onClick={signOut}
        className="
          flex items-center justify-center w-8 h-8 rounded-md
          border border-line text-lo hover:text-danger hover:bg-red-50
          transition-colors duration-[120ms] cursor-pointer flex-shrink-0
        "
        aria-label="Cerrar sesión"
      >
        <SignOut size={16} weight="regular" aria-hidden="true" />
      </button>
    </header>
  );
}
