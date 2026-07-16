import { NavLink } from 'react-router-dom';
import {
  SquaresFour,
  Buildings,
  Gear,
  SignOut,
  ShieldCheck,
  UserCircle,
  ChartBar,
  Megaphone,
  Brain,
  DeviceMobile,
  AddressBook,
  ChatTeardrop,
  TreeStructure,
  Cardholder,
  Package,
  Bell,
  Database,
} from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';

const SUPERADMIN_NAV = [
  { label: 'Dashboard Global',      to: '/dashboard',      Icon: SquaresFour },
  { label: 'Empresas (Admin)',       to: '/admin-empresas', Icon: Buildings   },
  { label: 'Planes',                to: '/admin-planes',   Icon: Cardholder  },
  { label: 'Alertas Sistema',       to: '/admin-alertas',  Icon: Bell        },
  { label: 'Copias Seguridad',      to: '/admin-backups',  Icon: Database    },
  { label: 'Configuración Servidor', to: '/admin-config',   Icon: Gear        },
];

const CLIENT_NAV = [
  { label: 'Métricas',       to: '/dashboard',      Icon: ChartBar       },
  { label: 'Contactos',      to: '/contactos',      Icon: AddressBook    },
  { label: 'Mensajes',       to: '/mensajes',       Icon: ChatTeardrop   },
  { label: 'Campañas',       to: '/campanas',       Icon: Megaphone      },
  { label: 'Automatización', to: '/automatizacion', Icon: TreeStructure  },
  { label: 'Cerebro IA',     to: '/cerebro-ia',     Icon: Brain          },
  { label: 'Conexiones',     to: '/conexiones',     Icon: DeviceMobile   },
  { label: 'Inventario',     to: '/inventario',     Icon: Package        },
  { label: 'Ajustes',        to: '/settings',       Icon: Gear           },
];

export default function Sidebar() {
  const { user, signOut } = useAuth();
  const role = user?.role ?? 'superadmin';

  const displayName = user?.displayName ?? user?.email?.split('@')[0] ?? 'Usuario';
  const email       = user?.email ?? '';

  const isImpersonating = !!localStorage.getItem('impersonatedTenantId');
  const activeNav = (role === 'superadmin' && !isImpersonating) ? SUPERADMIN_NAV : CLIENT_NAV;
  const roleLabel = role === 'superadmin'
    ? (isImpersonating ? 'Soporte Activo' : 'Super Admin')
    : 'Cliente';

  return (
    <aside
      className="hidden md:flex fixed inset-y-0 left-0 z-30 flex-col bg-panel border-r border-line shadow-card"
      style={{ width: 'var(--sidebar-w)' }}
      aria-label="Navegación principal"
    >
      {/* ── Brand ── */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-line">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-brand flex-shrink-0">
          <ShieldCheck size={20} weight="bold" className="text-white" aria-hidden="true" />
        </div>
        <div>
          <p className="text-base font-bold text-hi leading-tight">SuperAdmin</p>
          <p className="text-xs text-lo">{roleLabel}</p>
        </div>
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 px-4 py-5 overflow-y-auto space-y-1" role="navigation">
        <p className="text-xs font-semibold text-muted uppercase tracking-widest px-2 mb-3">
          Menú principal
        </p>

        {activeNav.map(({ label, to, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3.5 px-4 py-3 rounded-md font-medium
               transition-all duration-[120ms] cursor-pointer
               ${isActive
                 ? 'bg-brand text-white shadow-card'
                 : 'text-mid hover:bg-app hover:text-hi'
               }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={20}
                  weight={isActive ? 'bold' : 'regular'}
                  aria-hidden="true"
                  className="flex-shrink-0"
                />
                <span className="text-base">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── User footer ── */}
      <div className="border-t border-line px-4 py-4 space-y-2">
        {/* User info */}
        <div className="flex items-center gap-3 px-2 py-2">
          <UserCircle size={32} weight="light" className="text-lo flex-shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-hi truncate capitalize">{displayName}</p>
            <p className="text-xs text-lo truncate">{email}</p>
          </div>
        </div>

        {/* Logout */}
        <button
          onClick={signOut}
          className="
            w-full flex items-center gap-3 px-4 py-3 rounded-md
            text-base font-medium text-lo
            hover:bg-red-50 hover:text-danger
            transition-all duration-[120ms] cursor-pointer
          "
          aria-label="Cerrar sesión"
        >
          <SignOut size={20} weight="regular" aria-hidden="true" />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </aside>
  );
}
