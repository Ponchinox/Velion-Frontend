import { useState, useEffect } from 'react';
import MetricCard from '../components/ui/MetricCard';
import {
  Buildings,
  Users,
  Package,
  ChatTeardrop,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  WarningCircle,
  ArrowsClockwise,
  CheckCircle,
  Database,
  Globe,
  CloudArrowUp,
  Cpu,
} from '@phosphor-icons/react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Icono por label de servicio
const SERVICE_ICONS = {
  'Base de Datos':               Database,
  'API Gateway (WhatsApp)':      Globe,
  'Almacenamiento (Cloudinary)': CloudArrowUp,
  'Backend API (Render)':        Cpu,
};

// Formatea una fecha ISO en texto relativo legible
function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `hace ${hrs} h`;
  return `hace ${Math.floor(hrs / 24)} d`;
}

// Formatea el delta respecto a ayer
function formatDelta(delta) {
  if (delta > 0)  return `+${delta} más que ayer`;
  if (delta < 0)  return `${delta} menos que ayer`;
  return 'igual que ayer';
}

export default function DashboardPage() {
  const [stats, setStats]             = useState(null);
  const [loading, setLoading]         = useState(true);
  const [errorMsg, setErrorMsg]       = useState('');
  const [activity, setActivity]       = useState([]);
  const [systemHealth, setSystemHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(true);

  const token = localStorage.getItem('sa_token');
  const authHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const fetchStats = async () => {
    setLoading(true);
    setErrorMsg('');

    try {
      const [statsRes, activityRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/admin/stats`,    { headers: authHeaders }),
        fetch(`${API_BASE_URL}/api/admin/activity`, { headers: authHeaders }),
      ]);

      if (!statsRes.ok) throw new Error('No se pudieron obtener las métricas reales del servidor.');

      const data = await statsRes.json();
      setStats(data);

      if (activityRes.ok) {
        const acts = await activityRes.json();
        setActivity(acts);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'Error de conexión con el backend.');
    } finally {
      setLoading(false);
    }
  };

  const fetchSystemHealth = async () => {
    setHealthLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/system-health`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setSystemHealth(data);
      }
    } catch (err) {
      console.error('[system-health]', err);
    } finally {
      setHealthLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchSystemHealth();
  }, []);

  const handleResetAiStatus = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/ai-status/reset`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (res.ok) {
        setStats((prev) => prev ? { ...prev, aiStatus: 'OPERATIVE' } : prev);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Tarjetas de Métricas dinámicas con seguridad nula (failsafe ante despliegues en progreso)
  const metrics = stats ? [
    {
      id: 'metric-companies',
      title: 'Empresas Registradas',
      value: (stats.tenants?.total ?? 0).toString(),
      change: `${stats.tenants?.active ?? 0} activas`,
      changeType: 'up',
      description: `${stats.tenants?.suspended ?? 0} suspendidas`,
      icon: Buildings,
    },
    {
      id: 'metric-users',
      title: 'Usuarios Totales',
      value: (stats.users?.total ?? 0).toLocaleString(),
      change: `${stats.tenants?.total ?? 0} empresas`,
      changeType: 'up',
      description: 'Administradores y agentes',
      icon: Users,
    },
    {
      id: 'metric-products',
      title: 'Productos Registrados',
      value: (stats.products?.total ?? 0).toLocaleString(),
      change: 'Inventario Global',
      changeType: 'up',
      description: 'Catálogo de todos los tenants',
      icon: Package,
    },
    {
      id: 'metric-chats',
      title: 'Conversaciones Hoy',
      value: ((stats.chats?.today ?? stats.chats?.total ?? 0)).toLocaleString(),
      change: formatDelta(stats.chats?.delta ?? 0),
      changeType: (stats.chats?.delta ?? 0) >= 0 ? 'up' : 'down',
      description: `${(stats.chats?.total ?? 0).toLocaleString()} conversaciones en total`,
      icon: ChatTeardrop,
    },
  ] : [];

  return (
    <section aria-labelledby="dashboard-heading" className="space-y-6">
      <div>
        <h1 id="dashboard-heading" className="text-xl font-bold text-hi flex items-center gap-2">
          Dashboard Administrativo
        </h1>
        <p className="text-sm text-lo mt-0.5">
          Resumen operativo general — estadísticas en tiempo real desde PostgreSQL.
        </p>
      </div>

      {/* Widget de Estado de los Servidores de IA */}
      <div className={`p-4 rounded-xl border flex items-center justify-between transition-all shadow-sm ${
        stats?.aiStatus === 'DOWN_429'
          ? 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
          : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-3.5 h-3.5 rounded-full flex-shrink-0 ${
            stats?.aiStatus === 'DOWN_429' ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'
          }`} />
          <div>
            <h3 className="font-bold text-xs uppercase tracking-wider">Estado de los Servidores de IA</h3>
            <p className="text-sm font-semibold mt-0.5">
              {stats?.aiStatus === 'DOWN_429'
                ? '¡ALERTA GLOBAL! Límite de cuota alcanzado en GitHub/Groq. Los bots no están respondiendo.'
                : 'Operativo'}
            </p>
          </div>
        </div>
        {stats?.aiStatus === 'DOWN_429' && (
          <button
            onClick={handleResetAiStatus}
            className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow transition-colors cursor-pointer"
          >
            Restablecer Estado
          </button>
        )}
      </div>

      {loading ? (
        // Skeletons de Carga
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-card border border-line rounded-lg p-5 space-y-3 animate-pulse">
              <div className="flex justify-between items-center">
                <div className="w-24 h-4 bg-app rounded" />
                <div className="w-8 h-8 bg-app rounded-full" />
              </div>
              <div className="w-16 h-8 bg-app rounded" />
              <div className="w-32 h-3.5 bg-app rounded" />
            </div>
          ))}
        </div>
      ) : errorMsg ? (
        // Panel de Error
        <div className="bg-card border border-line rounded-lg p-8 text-center space-y-4 max-w-md mx-auto shadow-card">
          <WarningCircle size={40} className="mx-auto text-danger" />
          <div>
            <p className="text-sm font-semibold text-hi">Fallo al conectar con el servidor</p>
            <p className="text-xs text-lo mt-1">{errorMsg}</p>
          </div>
          <button
            onClick={() => { fetchStats(); fetchSystemHealth(); }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-brand text-white hover:bg-brand-hover rounded-md shadow transition-colors cursor-pointer"
          >
            <ArrowsClockwise size={14} />
            Reintentar
          </button>
        </div>
      ) : (
        // Métricas Dinámicas
        <div
          className="grid gap-5"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
          role="region"
          aria-label="Métricas principales"
        >
          {metrics.map(m => <MetricCard key={m.id} {...m} />)}
        </div>
      )}

      {/* Cuadro de mensajes de hoy vs ayer */}
      {stats && !loading && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Mensajes hoy */}
          <div className="bg-card border border-line rounded-xl p-5 shadow-card flex flex-col gap-2">
            <p className="text-xs font-semibold text-lo uppercase tracking-wider">Mensajes Hoy</p>
            <p className="text-3xl font-bold text-hi font-mono font-bold">{(stats.messages?.today ?? stats.messages?.total ?? 0).toLocaleString()}</p>
            <div className={`flex items-center gap-1 text-xs font-semibold ${(stats.messages?.delta ?? 0) >= 0 ? 'text-emerald-600' : 'text-danger'}`}>
              {(stats.messages?.delta ?? 0) >= 0
                ? <ArrowUpRight size={14} weight="bold" />
                : <ArrowDownRight size={14} weight="bold" />}
              {formatDelta(stats.messages?.delta ?? 0)}
            </div>
            <p className="text-xs text-lo">{(stats.messages?.total ?? 0).toLocaleString()} mensajes históricos totales</p>
          </div>

          {/* Conversaciones ayer */}
          <div className="bg-card border border-line rounded-xl p-5 shadow-card flex flex-col gap-2">
            <p className="text-xs font-semibold text-lo uppercase tracking-wider">Conversaciones Ayer</p>
            <p className="text-3xl font-bold text-hi font-mono">{(stats.chats?.yesterday ?? 0).toLocaleString()}</p>
            <p className="text-xs text-lo">Para comparar con el día de hoy</p>
          </div>

          {/* Mensajes ayer */}
          <div className="bg-card border border-line rounded-xl p-5 shadow-card flex flex-col gap-2">
            <p className="text-xs font-semibold text-lo uppercase tracking-wider">Mensajes Ayer</p>
            <p className="text-3xl font-bold text-hi font-mono">{(stats.messages?.yesterday ?? 0).toLocaleString()}</p>
            <p className="text-xs text-lo">Referencia del día anterior</p>
          </div>
        </div>
      )}

      {/* Lower grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Activity */}
        <div className="bg-card border border-line rounded-lg shadow-card p-6" role="region" aria-labelledby="activity-heading">
          <div className="mb-5">
            <h2 id="activity-heading" className="text-sm font-bold text-hi uppercase tracking-wide">
              Actividad Reciente
            </h2>
          </div>

          {activity.length === 0 ? (
            <div className="py-8 text-center">
              <CheckCircle size={28} className="mx-auto text-success mb-2" />
              <p className="text-xs text-lo">Sin incidencias recientes — el sistema opera con normalidad.</p>
            </div>
          ) : (
            <ul aria-label="Lista de actividad">
              {activity.map(item => (
                <li key={item.id} className="flex items-start justify-between py-3 border-b border-line last:border-b-0">
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.resolved ? 'bg-success' : 'bg-danger'}`}
                      aria-hidden="true"
                    />
                    <div>
                      <p className="text-sm font-medium text-hi">{item.action}</p>
                      <p className="text-xs text-lo">{item.detail}</p>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-muted flex-shrink-0 ml-4">
                    <Clock size={12} weight="regular" aria-hidden="true" />
                    {timeAgo(item.time)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* System status — REAL */}
        <div className="bg-card border border-line rounded-lg shadow-card p-6" role="region" aria-labelledby="status-heading">
          <div className="flex items-center justify-between mb-5">
            <h2 id="status-heading" className="text-sm font-bold text-hi uppercase tracking-wide">
              Estado del Sistema
            </h2>
            <button
              onClick={fetchSystemHealth}
              disabled={healthLoading}
              className="flex items-center gap-1.5 text-xs text-lo hover:text-brand transition-colors cursor-pointer disabled:opacity-50"
              title="Verificar servicios ahora"
            >
              <ArrowsClockwise size={13} className={healthLoading ? 'animate-spin' : ''} />
              {healthLoading ? 'Verificando...' : 'Actualizar'}
            </button>
          </div>

          {healthLoading && !systemHealth ? (
            <div className="space-y-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="animate-pulse flex items-center justify-between">
                  <div className="h-3.5 bg-app rounded w-32" />
                  <div className="h-5 bg-app rounded-full w-20" />
                </div>
              ))}
            </div>
          ) : systemHealth ? (
            <div className="space-y-4">
              {systemHealth.services.map(svc => {
                const Icon = SERVICE_ICONS[svc.label] || Cpu;
                return (
                  <div key={svc.label} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${svc.ok ? 'bg-emerald-50' : 'bg-red-50'}`}>
                        <Icon size={14} className={svc.ok ? 'text-emerald-600' : 'text-danger'} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-mid truncate">{svc.label}</p>
                        {svc.latencyMs > 0 && (
                          <p className="text-2xs text-muted font-mono">{svc.latencyMs}ms</p>
                        )}
                      </div>
                    </div>
                    <span className={`
                      inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold flex-shrink-0
                      ${svc.ok
                        ? 'bg-green-50 border-green-200 text-success'
                        : 'bg-red-50 border-red-200 text-danger'
                      }
                    `}>
                      <span className={`w-1.5 h-1.5 rounded-full ${svc.ok ? 'bg-success' : 'bg-danger animate-pulse'}`} aria-hidden="true" />
                      {svc.status}
                    </span>
                  </div>
                );
              })}
              {systemHealth.checkedAt && (
                <p className="text-2xs text-muted text-right pt-1 border-t border-line mt-3">
                  Verificado {timeAgo(systemHealth.checkedAt)}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-lo text-center py-6">No se pudo obtener el estado del sistema.</p>
          )}
        </div>
      </div>
    </section>
  );
}
