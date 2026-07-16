import { SignOut, ShieldCheck } from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';

export default function TopBar() {
  const { signOut } = useAuth();

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
      <div className="flex items-center gap-2">
        <ShieldCheck size={18} weight="bold" className="text-brand" aria-hidden="true" />
        <span className="text-sm font-bold text-hi">SuperAdmin</span>
      </div>

      {/* Profile/Logout on the right for Mobile View */}
      <button
        onClick={signOut}
        className="
          flex items-center justify-center w-8 h-8 rounded-md
          border border-line text-lo hover:text-danger hover:bg-red-50
          transition-colors duration-[120ms] cursor-pointer
        "
        aria-label="Cerrar sesión"
      >
        <SignOut size={16} weight="regular" aria-hidden="true" />
      </button>
    </header>
  );
}
