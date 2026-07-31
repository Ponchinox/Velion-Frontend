import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
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
  Package,
  Bell,
  Database,
  User as UserIcon,
  Lock,
  ArrowCircleUp,
  X,
} from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';
import * as settingsService from '../../services/settingsService';

// ─── Estructura para SuperAdmin ───
const SUPERADMIN_NAV_GROUPS = [
  {
    category: 'GENERAL',
    items: [
      { label: 'Dashboard',           to: '/dashboard',      Icon: SquaresFour },
      { label: 'Empresas (Admin)',    to: '/admin-empresas', Icon: Buildings },
      { label: 'Planes',             to: '/admin-planes',   Icon: ArrowCircleUp },
    ],
  },
  {
    category: 'SISTEMA & CONFIGURACIÓN',
    items: [
      { label: 'Alertas Sistema',       to: '/admin-alertas',  Icon: Bell },
      { label: 'Copias Seguridad',      to: '/admin-backups',  Icon: Database },
      { label: 'Configuración Servidor', to: '/admin-config',  Icon: Gear },
    ],
  },
];

// ─── Modal de Upgrade ───
function UpgradeModal({ featureName, onClose }) {
  const navigate = useNavigate();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-8 max-w-sm w-full mx-4 relative">
        {/* Cerrar */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
          aria-label="Cerrar"
        >
          <X size={18} weight="bold" />
        </button>

        {/* Icono */}
        <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-50 text-amber-500 mb-5 mx-auto">
          <Lock size={28} weight="bold" />
        </div>

        {/* Texto */}
        <h2 className="text-base font-bold text-slate-900 text-center mb-2">
          Función bloqueada
        </h2>
        <p className="text-sm text-slate-500 text-center leading-relaxed mb-6">
          <span className="font-semibold text-slate-700">{featureName}</span> no está incluida
          en tu plan actual. Mejora tu plan para desbloquear esta función.
        </p>

        {/* Botones */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => { navigate('/billing'); onClose(); }}
            className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition-colors cursor-pointer"
          >
            Ver Planes & Mejora Ahora
          </button>
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 transition-colors cursor-pointer"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const { user, signOut } = useAuth();
  const [tenantData, setTenantData] = useState(null);
  const [upgradeModal, setUpgradeModal] = useState(null); // { featureName: string }

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
  const isSuperAdmin = role === 'superadmin' && !isImpersonating;

  // Plan features del usuario logueado
  const planFeatures = user?.planFeatures || null;

  // Lógica de Avatar y saludo
  const rawName = (user?.name || user?.displayName || '').trim();
  const logoUrl = tenantData?.logoUrl || user?.tenantLogo || user?.logoUrl;

  let avatarMode = 'logo';
  if (!logoUrl) {
    avatarMode = rawName ? 'initial' : 'generic';
  }

  // ─── Grupos de navegación para clientes (con locks condicionales) ───
  const getClientNavGroups = () => {
    // En Modo Soporte el superadmin necesita acceso completo a todas las secciones
    const hasCampaigns   = isImpersonating || isSuperAdmin || planFeatures?.hasCampaigns === true;
    const hasAutomations = isImpersonating || isSuperAdmin || planFeatures?.hasAutomations === true;

    return [
      {
        category: 'GENERAL',
        items: [
          { label: 'Dashboard', to: '/dashboard', Icon: SquaresFour },
        ],
      },
      {
        category: 'IA & COMUNICACIÓN',
        items: [
          { label: 'Mensajes',         to: '/mensajes',       Icon: ChatTeardrop },
          {
            label: 'Campañas',
            to: '/campanas',
            Icon: Megaphone,
            locked: !hasCampaigns,
            featureName: 'Campañas Masivas',
          },
          {
            label: 'Automatizaciones',
            to: '/automatizacion',
            Icon: TreeStructure,
            locked: !hasAutomations,
            featureName: 'Automatizaciones',
          },
        ],
      },
      {
        category: 'GESTIÓN Y DATOS',
        items: [
          { label: 'Contactos',  to: '/contactos',  Icon: AddressBook },
          { label: 'Inventario', to: '/productos',  Icon: Package },
          { label: 'Conexiones', to: '/conexiones', Icon: DeviceMobile },
          { label: 'Ajustes',    to: '/settings',   Icon: Gear },
        ],
      },
    ];
  };

  const navGroups = isSuperAdmin ? SUPERADMIN_NAV_GROUPS : getClientNavGroups();

  return (
    <>
      {/* Modal de Upgrade (fuera del aside para no tener clipping) */}
      {upgradeModal && (
        <UpgradeModal
          featureName={upgradeModal.featureName}
          onClose={() => setUpgradeModal(null)}
        />
      )}

      <aside
        className="hidden md:flex fixed inset-y-0 left-0 top-0 h-screen z-30 flex-col bg-white border-r border-slate-200 shadow-xs rounded-none select-none overflow-hidden"
        style={{ width: 'var(--sidebar-w)' }}
        aria-label="Navegación principal"
      >
        {/* ── 1. Cabecera de Perfil ── */}
        <div className="p-4 border-b border-slate-100 flex items-center gap-3">
          {avatarMode === 'logo' && (
            <img
              src={logoUrl}
              alt={rawName || 'Logo Corporativo'}
              className="w-10 h-10 rounded-full object-cover border border-slate-200 flex-shrink-0"
            />
          )}
          {avatarMode === 'initial' && (
            <div className="w-10 h-10 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-sm shadow-xs flex-shrink-0">
              {rawName.charAt(0).toUpperCase()}
            </div>
          )}
          {avatarMode === 'generic' && (
            <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 border border-slate-200 flex items-center justify-center flex-shrink-0">
              <UserIcon size={20} weight="bold" />
            </div>
          )}

          <div className="flex flex-col min-w-0">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider leading-none">
              Bienvenido
            </span>
            <span className="text-sm font-bold text-slate-900 leading-tight truncate mt-1">
              {rawName || 'Usuario'}
            </span>
          </div>
        </div>

        {/* ── 2. Lista de Navegación ── */}
        <nav
          className="flex-1 overflow-y-auto space-y-6 p-4 custom-scrollbar"
          role="navigation"
        >
          {navGroups.map((group) => (
            <div key={group.category} className="space-y-1">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-3 mb-2 select-none">
                {group.category}
              </p>

              {group.items.map(({ label, to, Icon, locked, featureName }) => {
                // Item bloqueado: no navega, abre modal
                if (locked) {
                  return (
                    <button
                      key={to}
                      onClick={() => setUpgradeModal({ featureName })}
                      className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium text-[14px] text-slate-400 hover:bg-amber-50 hover:text-amber-600 transition-all duration-150 cursor-pointer group"
                      aria-label={`${label} — requiere plan superior`}
                    >
                      <Icon
                        size={19}
                        weight="regular"
                        className="text-slate-300 flex-shrink-0 transition-colors group-hover:text-amber-400"
                      />
                      <span className="truncate flex-1 text-left">{label}</span>
                      <Lock
                        size={13}
                        weight="bold"
                        className="text-slate-300 flex-shrink-0 group-hover:text-amber-400 transition-colors"
                      />
                    </button>
                  );
                }

                // Item libre: NavLink normal
                return (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium text-[14px] transition-all duration-150 cursor-pointer ${
                        isActive
                          ? 'bg-blue-600 text-white hover:text-white shadow-sm font-semibold'
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
                );
              })}
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
    </>
  );
}
