import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Bot, 
  Users, 
  Tag, 
  MessageSquare, 
  ArrowRight, 
  TrendingUp, 
  Sparkles, 
  Clock, 
  CheckCircle,
  HelpCircle,
  AlertCircle,
  BellRing
} from 'lucide-react';
import * as tenantDashboardService from '../services/tenantDashboardService';
import { useAuth } from '../context/AuthContext';

export default function TenantDashboardPage() {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const hasFetchedRef = useRef(false);

  const loadMetrics = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const data = await tenantDashboardService.getTenantMetrics();
      setMetrics(data);
    } catch (err) {
      console.error(err);
      setErrorMsg('No pudimos recuperar las métricas operativas de tu negocio.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    loadMetrics();
  }, [loadMetrics]);

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        {/* Header Skeleton */}
        <div className="space-y-2">
          <div className="h-7 bg-line rounded w-64" />
          <div className="h-4 bg-line rounded w-96" />
        </div>
        
        {/* Bento Grid Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-48 bg-line rounded-xl" />
          <div className="h-48 bg-line rounded-xl" />
          <div className="h-48 bg-line rounded-xl" />
          <div className="h-48 bg-line rounded-xl" />
        </div>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="bg-card border border-line rounded-xl p-8 text-center space-y-4 max-w-md mx-auto shadow-card mt-12">
        <AlertCircle size={40} className="mx-auto text-danger" />
        <div>
          <p className="text-sm font-semibold text-hi">Fallo al conectar con el servidor</p>
          <p className="text-xs text-lo mt-1">{errorMsg}</p>
        </div>
        <button
          onClick={loadMetrics}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-brand text-white hover:bg-brand-hover rounded-md shadow transition-colors cursor-pointer"
        >
          Reintentar Carga
        </button>
      </div>
    );
  }

  // Cálculos de participación del bot/agente (mensajes)
  const totalMsgs = metrics.messages.total || 0;
  const botPct = totalMsgs > 0 ? Math.round((metrics.messages.sent / totalMsgs) * 100) : 0;
  const clientPct = totalMsgs > 0 ? Math.round((metrics.messages.received / totalMsgs) * 100) : 0;

  return (
    <section aria-labelledby="tenant-dashboard-heading" className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 id="tenant-dashboard-heading" className="text-xl font-bold text-hi">
          ¡Hola, {user?.displayName || 'Empresa'}!
        </h1>
        <p className="text-sm text-lo mt-0.5">
          Desempeño y estadísticas operativas en tiempo real.
        </p>
      </div>

      {/* Bento Grid Asimétrico */}
      <div className="space-y-6">
        
        {/* TARJETA 1 (Héroe - Ocupa todo el ancho): Operación Autónoma */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-line rounded-2xl shadow-sm ring-1 ring-gray-900/5 p-8 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-sm">
                <Bot size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold text-hi">Operación Autónoma</h3>
              </div>
            </div>
          </div>

          <div className="my-6 grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
            {/* Métricas Numéricas */}
            <div className="space-y-4 col-span-1 md:col-span-1 border-r border-line/50 pr-4">
              <div>
                <p className="text-xs text-muted font-medium uppercase tracking-wider">Respuestas Bot</p>
                <p className="text-2xl font-mono font-bold text-hi mt-0.5">{metrics.messages.sent}</p>
              </div>
              <div>
                <p className="text-xs text-muted font-medium uppercase tracking-wider">Interacciones</p>
                <p className="text-2xl font-mono font-bold text-hi mt-0.5">{metrics.messages.received}</p>
              </div>
            </div>

            {/* Panel Visual de Automatización */}
            <div className="col-span-1 md:col-span-2 space-y-3">
              <div className="flex justify-between items-end">
                <div>
                  <p className="text-xs text-lo font-semibold">Eficiencia del Bot</p>
                  <p className="text-2xl font-bold text-indigo-700 font-mono">{botPct}%</p>
                </div>
                <span className="text-2xs text-muted font-mono font-bold">Total: {totalMsgs}</span>
              </div>

              {/* Barra de progreso gruesa e impactante */}
              <div className="w-full h-4 bg-white rounded-full overflow-hidden border border-line shadow-inner relative">
                <div 
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-500" 
                  style={{ width: `${botPct}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* CONTENEDOR SUBORDINADO DE 3 COLUMNAS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Tarjeta 2: Audiencia Adquirida */}
          <div className="bg-white border border-line rounded-2xl shadow-sm p-6 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Users size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-hi">Audiencia Adquirida</h3>
                </div>
              </div>
              {metrics.contacts.newToday > 0 ? (
                <span className="px-2 py-0.5 rounded-full text-3xs font-semibold bg-green-50 border border-green-200 text-green-700 flex items-center gap-1 animate-pulse">
                  +{metrics.contacts.newToday} Hoy
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-3xs font-semibold bg-gray-50 border border-gray-200 text-gray-500">
                  CRM
                </span>
              )}
            </div>

            <div className="my-6 flex items-baseline gap-2">
              <p className="text-3xl font-mono font-bold text-brand">{metrics.contacts.total}</p>
              <span className="text-2xs font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded">Activos</span>
            </div>
          </div>

          {/* Tarjeta 3: Inventario Activo */}
          <div className="bg-white border border-line rounded-2xl shadow-sm p-6 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-50 text-green-600 flex items-center justify-center">
                  <Tag size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-hi">Inventario Activo</h3>
                </div>
              </div>
              {metrics.products.activePromotions > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-3xs font-bold text-green-600 uppercase tracking-wide">
                    Campañas
                  </span>
                </div>
              )}
            </div>

            <div className="my-6 grid grid-cols-2 gap-4">
              <div>
                <p className="text-3xs text-muted uppercase font-bold">Catálogo</p>
                <p className="text-2xl font-mono font-bold text-hi mt-0.5">{metrics.products.total}</p>
              </div>
              <div>
                <p className="text-3xs text-muted uppercase font-bold">Ofertas</p>
                <p className={`text-2xl font-mono font-bold mt-0.5 ${metrics.products.activePromotions > 0 ? 'text-green-600 font-extrabold' : 'text-hi'}`}>
                  {metrics.products.activePromotions}
                </p>
              </div>
            </div>
          </div>

          {/* Tarjeta 4: Notificaciones Recientes */}
          <div className="bg-white border border-line rounded-2xl shadow-sm p-6 flex flex-col justify-between h-[216px]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                  <BellRing size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-hi">Notificaciones</h3>
                </div>
              </div>
              {metrics.notifications?.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-3xs font-semibold bg-red-50 border border-red-100 text-red-600 animate-pulse">
                  Nuevas
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto pr-1 space-y-3 custom-scrollbar">
              {!metrics.notifications || metrics.notifications.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-70">
                  <CheckCircle size={28} className="text-green-500 mb-2" />
                  <p className="text-xs font-semibold text-hi">Todo al día</p>
                  <p className="text-2xs text-lo mt-0.5">No hay notificaciones recientes</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {metrics.notifications.map((notif) => {
                    const isPayment = notif.type === 'PAYMENT_VERIFY' || notif.message.toLowerCase().includes('pago');
                    const isHandoff = notif.type === 'HUMAN_HANDOFF' || notif.message.toLowerCase().includes('humano');
                    const isOrder = notif.type === 'ORDER_CLOSED' || notif.message.toLowerCase().includes('pedido');
                    
                    let bg = 'bg-gray-50';
                    let text = 'text-gray-600';
                    if (isPayment) { bg = 'bg-emerald-50'; text = 'text-emerald-600'; }
                    else if (isHandoff) { bg = 'bg-purple-50'; text = 'text-purple-600'; }
                    else if (isOrder) { bg = 'bg-blue-50'; text = 'text-blue-600'; }
                    else if (notif.severity === 'CRITICAL') { bg = 'bg-red-50'; text = 'text-red-600'; }

                    return (
                      <li key={notif.id} className="flex gap-3 items-start">
                        <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${bg.replace('bg-', 'bg-').replace('50', '500')}`} />
                        <div className="flex-1">
                          <p className="text-xs text-hi font-medium line-clamp-2 leading-tight">
                            {notif.message.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim()}
                          </p>
                          <p className="text-3xs text-muted mt-1 font-mono">
                            {new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
