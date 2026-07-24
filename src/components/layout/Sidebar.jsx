import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  SquaresFour,
  Buildings,
  Gear,
  SignOut,
  Megaphone,
  DeviceMobile,
  AddressBook,
  ChatTeardrop,
  TreeStructure,
  Cardholder,
  Package,
  Bell,
  Database,
  User as UserIcon,
} from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';
import * as settingsService from '../../services/settingsService';

// Estructura exacta de 3 categorías para Clientes (con Facturación y Ajustes en GESTIÓN Y DATOS)
const CLIENT_NAV_GROUPS = [
  {
    category: 'GENERAL',
    items: [
      { label: 'Dashboard', to: '/dashboard', Icon: SquaresFour },
    ],
  },
  {
    category: 'IA & COMUNICACIÓN',
    items: [
      { label: 'Mensajes',        to: '/mensajes',       Icon: ChatTeardrop },
      { label: 'Campañas',        to: '/campanas',       Icon: Megaphone },
      { label: 'Automatizaciones', to: '/automatizacion', Icon: TreeStructure },
    ],
  },
  {
    category: 'GESTIÓN Y DATOS',
    items: [
      { label: 'Contactos',   to: '/contactos',  Icon: AddressBook },
      { label: 'Inventario',  to: '/productos',  Icon: Package },
      { label: 'Conexiones',  to: '/conexiones', Icon: DeviceMobile },
      { label: 'Facturación', to: '/billing',    Icon: Cardholder },
      { label: 'Ajustes',     to: '/settings',   Icon: Gear },
    ],
  },
];

// Estructura para SuperAdmin
const SUPERADMIN_NAV_GROUPS = [
  {
    category: 'GENERAL',
    items: [
      { label: 'Dashboard',        to: '/dashboard',      Icon: SquaresFour },
      { label: 'Empresas (Admin)', to: '/admin-empresas', Icon: Buildings },
      { label: 'Planes',          to: '/admin-planes',   Icon: Cardholder },
    ],
  },
  {
    category: 'SISTEMA & CONFIGURACIÓN',
    items: [
      { label: 'Alertas Sistema',      to: '/admin-alertas',  Icon: Bell },
      { label: 'Copias Seguridad',     to: '/admin-backups',  Icon: Database },
      { label: 'Configuración Servidor', to: '/admin-config', Icon: Gear },
    ],
  },
];

export default function Sidebar() {
  const { user, signOut } = useAuth();
  const [tenantData, setTenantData] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const fetchTenant = () => {
      settingsService
        .getSettings()
        .then((data) => {
          if (isMounted && data) {
            setTenantData(data);
          }
        })
        .catch(() => {});
    };

    fetchTenant();

    const handleSettingsUpdate = (e) => {
      if (e.detail) setTenantData(e.detail);
      else fetchTenant();
    };

    window.addEventListener('tenantSettingsUpdated', handleSettingsUpdate);
    return () => {
      isMounted = false;
      window.removeEventListener('tenantSettingsUpdated', handleSettingsUpdate);
    };
  }, []);

  const role = user?.role ?? 'superadmin';
  const isImpersonating = !!localStorage.getItem('impersonatedTenantId');

  // Lógica de Nombre y Saludo
  const rawName = (user?.name || user?.displayName || '').trim();

  // Lógica dinámica del Avatar (1. Logo corporativo, 2. Inicial, 3. Ícono genérico)
  const logoUrl = tenantData?.logoUrl || user?.tenantLogo || user?.logoUrl;

  let avatarMode = 'logo';
  if (!logoUrl) {
    if (rawName) {
      avatarMode = 'initial';
    } else {
      avatarMode = 'generic';
    }
  }

  const greetingText = rawName ? `Bienvenido, ${rawName}` : 'Bienvenido usuario';

  // Selección de grupos según rol
  const navGroups =
    role === 'superadmin' && !isImpersonating
      ? SUPERADMIN_NAV_GROUPS
      : CLIENT_NAV_GROUPS;

  return (
    <aside
      className="hidden md:flex fixed inset-y-0 left-0 top-0 h-screen z-30 flex-col bg-white border-r border-slate-200 shadow-xs rounded-none select-none overflow-hidden"
      style={{ width: 'var(--sidebar-w)' }}
      aria-label="Navegación principal"
    >
      {/* ── 1. Cabecera de Perfil (Edge-to-Edge con Lógica de Fallback de Avatar) ── */}
      <div className="p-4 border-b border-slate-100 flex items-center gap-3">
        {/* Caso a: Logo corporativo */}
        {avatarMode === 'logo' && (
          <img
            src={logoUrl}
            alt={rawName || 'Logo Corporativo'}
            className="w-10 h-10 rounded-full object-cover border border-slate-200 flex-shrink-0"
          />
        )}

        {/* Caso b: Inicial del nombre */}
        {avatarMode === 'initial' && (
          <div className="w-10 h-10 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-sm shadow-xs flex-shrink-0">
            {rawName.charAt(0).toUpperCase()}
          </div>
        )}

        {/* Caso c: Ícono genérico de usuario */}
        {avatarMode === 'generic' && (
          <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 border border-slate-200 flex items-center justify-center flex-shrink-0">
            <UserIcon size={20} weight="bold" />
          </div>
        )}

        {/* Saludo dinámico en dos niveles */}
        <div className="flex flex-col min-w-0">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider leading-none">
            Bienvenido
          </span>
          <span className="text-sm font-bold text-slate-900 leading-tight truncate mt-1">
            {rawName || 'Usuario'}
          </span>
        </div>
      </div>

      {/* ── 2. Lista de Navegación Agrupada por Categorías ── */}
      <nav
        className="flex-1 overflow-y-auto space-y-6 p-4 custom-scrollbar"
        role="navigation"
      >
        {navGroups.map((group) => (
          <div key={group.category} className="space-y-1">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-3 mb-2 select-none">
              {group.category}
            </p>
            {group.items.map(({ label, to, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium text-[14px] transition-all duration-150 cursor-pointer ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      size={19}
                      weight={isActive ? 'bold' : 'regular'}
                      className={
                        isActive
                          ? 'text-white flex-shrink-0'
                          : 'text-slate-400 group-hover:text-slate-600 flex-shrink-0 transition-colors'
                      }
                    />
                    <span className="truncate flex-1">{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* ── 3. Sección Inferior: Cerrar Sesión ── */}
      <div className="p-4 border-t border-slate-100 mt-auto">
        <button
          onClick={signOut}
          className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-slate-600 hover:text-red-600 hover:bg-red-50/80 transition-all duration-150 cursor-pointer font-medium text-[14px]"
          aria-label="Cerrar sesión"
        >
          <SignOut
            size={19}
            weight="bold"
            className="text-slate-400 hover:text-red-500 transition-colors flex-shrink-0"
          />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </aside>
  );
}
