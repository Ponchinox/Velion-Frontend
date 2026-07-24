import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import MetricCard from '../components/ui/MetricCard';
import {
  Buildings,
  Users,
  Package,
  ChatTeardrop,
  ArrowUpRight,
  Clock,
  WarningCircle,
  ArrowsClockwise,
  CheckCircle,
} from '@phosphor-icons/react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const SERVICES = [
  { label: 'API Gateway',        status: 'Operacional', pct: 99.9, ok: true  },
  { label: 'Base de Datos',      status: 'Operacional', pct: 100,  ok: true  },
  { label: 'Servicio de Correo', status: 'Operacional', pct: 100,  ok: true  },
  { label: 'Almacenamiento',     status: 'Operacional', pct: 100,  ok: true  },
];

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

export default function DashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [activity, setActivity] = useState([]);

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

  useEffect(() => {
    fetchStats();
  }, []);

  // Tarjetas de Métricas dinámicas en base a PostgreSQL
  const metrics = stats ? [
    {
      id: 'metric-companies',
      title: 'Empresas Registradas',
      value: stats.tenants.total.toString(),
      change: `${stats.tenants.active} activas`,
      changeType: 'up',
      description: `${stats.tenants.suspended} suspendidas`,
      icon: Buildings,
    },
    {
      id: 'metric-users',
      title: 'Usuarios Totales',
      value: stats.users.total.toLocaleString(),
      change: '+100% en vivo',
      changeType: 'up',
      description: 'Usuarios en la plataforma',
      icon: Users,
    },
    {
      id: 'metric-products',
      title: 'Productos Registrados',
      value: stats.products.total.toLocaleString(),
      change: 'Inventario Global',
      changeType: 'up',
      description: 'Catálogo de tenants',
      icon: Package,
    },
    {
      id: 'metric-chats',
      title: 'Conversaciones Activas',
      value: stats.chats.total.toLocaleString(),
      change: `${stats.messages.total.toLocaleString()} mensajes`,
      changeType: 'up',
      description: 'Tráfico del Live Chat',
      icon: ChatTeardrop,
    },
  ] : [];

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
            onClick={fetchStats}
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

        {/* System status */}
        <div className="bg-card border border-line rounded-lg shadow-card p-6" role="region" aria-labelledby="status-heading">
          <h2 id="status-heading" className="text-sm font-bold text-hi uppercase tracking-wide mb-5">
            Estado del Sistema
          </h2>

          <div className="space-y-5">
            {SERVICES.map(svc => (
              <div key={svc.label}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-mid">{svc.label}</span>
                  <span className={`
                    inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold
                    ${svc.ok
                      ? 'bg-green-50 border-green-200 text-success'
                      : 'bg-orange-50 border-orange-200 text-warning'
                    }
                  `}>
                    <span className={`w-1.5 h-1.5 rounded-full ${svc.ok ? 'bg-success' : 'bg-warning'}`} aria-hidden="true" />
                    {svc.status}
                  </span>
                </div>
                <div
                  className="w-full h-2 bg-app rounded-full overflow-hidden border border-line"
                  role="progressbar"
                  aria-valuenow={svc.pct} aria-valuemin={0} aria-valuemax={100}
                  aria-label={`${svc.label}: ${svc.pct}%`}
                >
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${svc.ok ? 'bg-brand' : 'bg-warning'}`}
                    style={{ width: `${svc.pct}%` }}
                  />
                </div>
                <p className="text-xs text-muted mt-1 text-right font-mono">{svc.pct}%</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
