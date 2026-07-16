import { NavLink } from 'react-router-dom';
import {
  SquaresFour,
  Buildings,
  Gear,
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

const SUPERADMIN_ITEMS = [
  {
    label:   'Dashboard',
    to:      '/dashboard',
    Icon:    SquaresFour,
    iconCls: 'text-brand',
    desc:    'Resumen global',
  },
  {
    label:   'Empresas',
    to:      '/admin-empresas',
    Icon:    Buildings,
    iconCls: 'text-brand',
    desc:    'Tenants SaaS',
  },
  {
    label:   'Planes',
    to:      '/admin-planes',
    Icon:    Cardholder,
    iconCls: 'text-violet-600',
    desc:    'Suscripciones',
  },
  {
    label:   'Configuración',
    to:      '/admin-config',
    Icon:    Gear,
    iconCls: 'text-lo',
    desc:    'Ajustes Globales',
  },
  {
    label:   'Alertas',
    to:      '/admin-alertas',
    Icon:    Bell,
    iconCls: 'text-rose-600',
    desc:    'Incidencias',
  },
  {
    label:   'Respaldos',
    to:      '/admin-backups',
    Icon:    Database,
    iconCls: 'text-indigo-600',
    desc:    'Copias de seguridad',
  },
];

const CLIENT_ITEMS = [
  {
    label:   'Métricas',
    to:      '/dashboard',
    Icon:    ChartBar,
    iconCls: 'text-brand',
    desc:    'Estadísticas',
  },
  {
    label:   'Contactos',
    to:      '/contactos',
    Icon:    AddressBook,
    iconCls: 'text-violet-600',
    desc:    'Directorio',
  },
  {
    label:   'Mensajes',
    to:      '/mensajes',
    Icon:    ChatTeardrop,
    iconCls: 'text-sky-600',
    desc:    'Live Chat',
  },
  {
    label:   'Campañas',
    to:      '/campanas',
    Icon:    Megaphone,
    iconCls: 'text-orange-600',
    desc:    'Marketing',
  },
  {
    label:   'Automatización',
    to:      '/automatizacion',
    Icon:    TreeStructure,
    iconCls: 'text-teal-600',
    desc:    'Flujos de bot',
  },
  {
    label:   'Cerebro IA',
    to:      '/cerebro-ia',
    Icon:    Brain,
    iconCls: 'text-purple-600',
    desc:    'Inteligencia',
  },
  {
    label:   'Conexiones',
    to:      '/conexiones',
    Icon:    DeviceMobile,
    iconCls: 'text-emerald-600',
    desc:    'WhatsApp',
  },
  {
    label:   'Inventario',
    to:      '/inventario',
    Icon:    Package,
    iconCls: 'text-indigo-600',
    desc:    'Catálogo',
  },
  {
    label:   'Ajustes',
    to:      '/settings',
    Icon:    Gear,
    iconCls: 'text-lo',
    desc:    'Preferencias',
  },
];

export default function MobileNav() {
  const { user } = useAuth();
  const role = user?.role ?? 'superadmin';
  const isImpersonating = !!localStorage.getItem('impersonatedTenantId');
  const items = (role === 'superadmin' && !isImpersonating) ? SUPERADMIN_ITEMS : CLIENT_ITEMS;

  return (
    <nav
      className="block md:hidden px-4 pt-4 pb-2"
      aria-label="Navegación rápida"
    >
      <p className="text-xs font-semibold text-muted uppercase tracking-widest mb-3 px-1">
        Acceso rápido
      </p>

      <div className="grid grid-cols-2 gap-3">
        {items.map(({ label, to, Icon, iconCls, desc }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-col items-start gap-3 p-4 rounded-lg
               bg-card border transition-all duration-[150ms] cursor-pointer
               active:scale-[0.97]
               ${isActive
                 ? 'border-brand/40 shadow-card-md ring-1 ring-brand/20'
                 : 'border-line shadow-card hover:border-line-strong hover:shadow-card-md'
               }`
            }
            aria-label={`Ir a ${label}`}
          >
            {({ isActive }) => (
              <>
                {/* Icon */}
                <div className={`
                  flex items-center justify-center
                  w-10 h-10 rounded-md
                  ${isActive ? 'bg-brand/10' : 'bg-app'}
                  transition-colors duration-[150ms]
                `}>
                  <Icon
                    size={22}
                    weight={isActive ? 'bold' : 'regular'}
                    className={iconCls}
                    aria-hidden="true"
                  />
                </div>

                {/* Text */}
                <div className="min-w-0">
                  <p className={`text-sm font-semibold leading-tight
                    ${isActive ? 'text-brand' : 'text-hi'}`}>
                    {label}
                  </p>
                  <p className="text-xs text-lo leading-tight mt-0.5">{desc}</p>
                </div>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
