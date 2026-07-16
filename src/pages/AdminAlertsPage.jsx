import { useState, useEffect } from 'react';
import {
  Bell,
  WarningCircle,
  CheckCircle,
  Check,
  ArrowsClockwise,
  Clock,
  Warning
} from '@phosphor-icons/react';

export default function AdminAlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [resolvingId, setResolvingId] = useState(null);

  const fetchAlerts = async () => {
    setLoading(true);
    setErrorMsg('');
    const token = localStorage.getItem('sa_token');

    try {
      const response = await fetch('http://localhost:3000/api/admin/alerts', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('No se pudieron obtener las alertas globales.');
      }

      const data = await response.json();
      setAlerts(data);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'Error al conectar con el servidor.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, []);

  const handleResolve = async (id) => {
    setResolvingId(id);
    const token = localStorage.getItem('sa_token');

    try {
      const response = await fetch(`http://localhost:3000/api/admin/alerts/${id}/resolve`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('No se pudo marcar la alerta como resuelta.');
      }

      // Actualizar el estado de forma optimista/local
      setAlerts((prev) =>
        prev.map((al) => (al.id === id ? { ...al, resolved: true } : al))
      );
    } catch (err) {
      console.error(err);
      alert(err.message || 'Error al resolver la alerta.');
    } finally {
      setResolvingId(null);
    }
  };

  // Obtiene los estilos de color en base a la severidad de la alerta
  const getSeverityBadge = (severity) => {
    switch (severity) {
      case 'CRITICAL':
        return 'bg-red-50 border-red-200 text-red-700 font-bold uppercase';
      case 'HIGH':
        return 'bg-orange-50 border-orange-200 text-orange-700 font-semibold';
      case 'MEDIUM':
        return 'bg-yellow-50 border-yellow-200 text-yellow-700 font-semibold';
      case 'LOW':
      default:
        return 'bg-blue-50 border-blue-200 text-blue-700 font-semibold';
    }
  };

  return (
    <section aria-labelledby="alerts-heading" className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 id="alerts-heading" className="text-xl font-bold text-hi flex items-center gap-2">
            <Bell size={24} className="text-danger" />
            Alertas del Sistema
          </h1>
          <p className="text-sm text-lo mt-0.5">
            Monitorea incidencias operativas, caídas de sockets de WhatsApp o límites de cuotas excedidos.
          </p>
        </div>

        <button
          onClick={fetchAlerts}
          className="flex items-center gap-1.5 px-3 py-2 border border-line hover:bg-app rounded-md text-xs font-semibold text-mid hover:text-hi transition-colors cursor-pointer"
        >
          <ArrowsClockwise size={14} />
          Actualizar
        </button>
      </div>

      {loading ? (
        // Skeleton de Carga de Tabla
        <div className="bg-card border border-line rounded-lg p-6 space-y-4 animate-pulse">
          <div className="h-6 bg-app rounded w-1/4" />
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 bg-app rounded" />
            ))}
          </div>
        </div>
      ) : errorMsg ? (
        // Panel de Error
        <div className="bg-card border border-line rounded-lg p-8 text-center space-y-4 max-w-md mx-auto shadow-card">
          <WarningCircle size={40} className="mx-auto text-danger" />
          <div>
            <p className="text-sm font-semibold text-hi">Fallo al obtener alertas</p>
            <p className="text-xs text-lo mt-1">{errorMsg}</p>
          </div>
          <button
            onClick={fetchAlerts}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-brand text-white hover:bg-brand-hover rounded-md shadow transition-colors cursor-pointer"
          >
            <ArrowsClockwise size={14} />
            Reintentar
          </button>
        </div>
      ) : alerts.length === 0 ? (
        // Alertas Vacías
        <div className="bg-card border border-line rounded-lg shadow-card p-12 text-center text-lo max-w-md mx-auto">
          <CheckCircle size={36} className="mx-auto text-success mb-3" />
          <p className="text-sm font-medium text-hi">Sin alertas pendientes</p>
          <p className="text-xs mt-1">El sistema está funcionando con normalidad sin incidencias registradas.</p>
        </div>
      ) : (
        // Listado de Alertas en Tabla
        <div className="bg-card border border-line rounded-xl shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm text-mid">
              <thead className="bg-app text-xs font-bold text-hi uppercase tracking-wider border-b border-line">
                <tr>
                  <th scope="col" className="px-6 py-4">Severidad</th>
                  <th scope="col" className="px-6 py-4">Tipo</th>
                  <th scope="col" className="px-6 py-4">Incidencia / Mensaje</th>
                  <th scope="col" className="px-6 py-4">Empresa (Tenant)</th>
                  <th scope="col" className="px-6 py-4">Fecha</th>
                  <th scope="col" className="px-6 py-4">Estado</th>
                  <th scope="col" className="px-6 py-4 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-card">
                {alerts.map((al) => (
                  <tr key={al.id} className="hover:bg-app/20 transition-colors duration-fast">
                    {/* Severidad */}
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded border text-2xs font-bold ${getSeverityBadge(al.severity)}`}>
                        {al.severity}
                      </span>
                    </td>

                    {/* Tipo */}
                    <td className="px-6 py-3 font-semibold text-hi font-mono text-xs">
                      {al.type}
                    </td>

                    {/* Mensaje */}
                    <td className="px-6 py-3">
                      <p className="text-sm text-hi line-clamp-1 max-w-[280px]" title={al.message}>
                        {al.message}
                      </p>
                    </td>

                    {/* Tenant */}
                    <td className="px-6 py-3 font-medium text-lo">
                      {al.tenant?.name || <span className="text-muted italic">Global</span>}
                    </td>

                    {/* Fecha */}
                    <td className="px-6 py-3 text-xs text-lo font-mono">
                      <div className="flex items-center gap-1">
                        <Clock size={12} />
                        {new Date(al.createdAt).toLocaleDateString('es-ES', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </td>

                    {/* Estado */}
                    <td className="px-6 py-3">
                      {al.resolved ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-50 border border-green-200 text-success text-2xs font-semibold">
                          <Check size={10} weight="bold" />
                          Resuelta
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-50 border border-red-200 text-danger text-2xs font-semibold animate-pulse">
                          <Warning size={10} weight="bold" />
                          Pendiente
                        </span>
                      )}
                    </td>

                    {/* Acciones */}
                    <td className="px-6 py-3 text-right">
                      {!al.resolved ? (
                        <button
                          onClick={() => handleResolve(al.id)}
                          disabled={resolvingId === al.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-brand hover:bg-brand-hover text-white text-2xs font-semibold rounded shadow transition-colors cursor-pointer disabled:opacity-50"
                        >
                          Resolver
                        </button>
                      ) : (
                        <span className="text-2xs text-muted font-medium italic">Finalizada</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
