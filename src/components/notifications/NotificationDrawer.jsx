import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  CheckCircle,
  WarningCircle,
  Receipt,
  User,
  ShoppingBag,
  Clock,
  ArrowRight,
  Eye,
  Check,
  Trash,
  Funnel
} from '@phosphor-icons/react';
import * as notificationService from '../../services/notificationService';

// Formato de tiempo relativo
function formatTimeAgo(dateString) {
  if (!dateString) return '';
  const diff = Date.now() - new Date(dateString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Hace un momento';
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `Hace ${days} d`;
}

// Icono y color por tipo de notificación
function getNotificationVisual(type, priority) {
  switch (type) {
    case 'HUMAN_HANDOFF_REQUESTED':
      return {
        icon: User,
        color: 'text-rose-600 bg-rose-50 border-rose-200',
        badge: '🔴 Atención Humana',
        deepLinkLabel: 'Ver chat'
      };
    case 'PAYMENT_EVIDENCE_RECEIVED':
      return {
        icon: Receipt,
        color: 'text-amber-600 bg-amber-50 border-amber-200',
        badge: '🟡 Comprobante',
        deepLinkLabel: 'Revisar'
      };
    case 'COMPLAINT_DETECTED':
      return {
        icon: WarningCircle,
        color: 'text-rose-600 bg-rose-50 border-rose-200',
        badge: '🔴 Incidencia',
        deepLinkLabel: 'Revisar'
      };
    case 'SALE_COMPLETED':
      return {
        icon: CheckCircle,
        color: 'text-emerald-600 bg-emerald-50 border-emerald-200',
        badge: '🟢 Venta',
        deepLinkLabel: 'Ver pedido'
      };
    case 'ORDER_CREATED':
      return {
        icon: ShoppingBag,
        color: 'text-blue-600 bg-blue-50 border-blue-200',
        badge: '🔵 Pedido',
        deepLinkLabel: 'Ver pedido'
      };
    default:
      return {
        icon: Clock,
        color: 'text-slate-600 bg-slate-50 border-slate-200',
        badge: priority === 'HIGH' ? '🔴 Prioridad Alta' : 'Notificación',
        deepLinkLabel: 'Ver detalle'
      };
  }
}

export default function NotificationDrawer({ isOpen, onClose, onNotificationAction }) {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(null);

  const filters = [
    { key: 'ALL', label: 'Todos' },
    { key: 'ACTION_REQUIRED', label: 'Requieren acción' },
    { key: 'HUMANS', label: 'Humanos' },
    { key: 'PAYMENTS', label: 'Pagos' },
    { key: 'VENTAS', label: 'Ventas' },
    { key: 'COMPLAINTS', label: 'Incidencias' }
  ];

  // Carga de notificaciones
  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const filterParam = activeFilter === 'ALL' ? undefined : (activeFilter === 'VENTAS' ? 'SALES' : activeFilter);
      const res = await notificationService.getNotifications({
        filter: filterParam,
        limit: 30
      });
      if (res?.success && Array.isArray(res.items)) {
        setNotifications(res.items);
      }
    } catch (err) {
      console.error('[NotificationDrawer] Error cargando notificaciones:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen, activeFilter]);

  if (!isOpen) return null;

  // Manejo de Deep Link seguro (Fase B8, B23)
  const handleDeepLinkClick = async (notif) => {
    if (notif.status === 'UNREAD') {
      try {
        await notificationService.markAsRead(notif.id);
        if (onNotificationAction) onNotificationAction();
      } catch (err) {
        // Tolerancia a fallos: no bloquear navegación si falla markAsRead (B23)
        console.warn('[NotificationDrawer] Error marcando leída:', err);
      }
    }
    onClose();
    if (notif.deepLink && notif.deepLink.startsWith('/')) {
      navigate(notif.deepLink);
    }
  };

  // Marcar como leída
  const handleMarkAsRead = async (id, e) => {
    e.stopPropagation();
    setActionInProgress(id);
    try {
      await notificationService.markAsRead(id);
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, status: 'READ', readAt: new Date().toISOString() } : n)
      );
      if (onNotificationAction) onNotificationAction();
    } catch (err) {
      console.error('[NotificationDrawer] Error al marcar leída:', err);
    } finally {
      setActionInProgress(null);
    }
  };

  // Resolver notificación
  const handleResolve = async (id, e) => {
    e.stopPropagation();
    setActionInProgress(id);
    try {
      await notificationService.resolveNotification(id);
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, status: 'RESOLVED', resolvedAt: new Date().toISOString() } : n)
      );
      if (onNotificationAction) onNotificationAction();
    } catch (err) {
      console.error('[NotificationDrawer] Error al resolver:', err);
    } finally {
      setActionInProgress(null);
    }
  };

  // Descartar notificación
  const handleDismiss = async (id, e) => {
    e.stopPropagation();
    setActionInProgress(id);
    try {
      await notificationService.dismissNotification(id);
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, status: 'DISMISSED' } : n)
      );
      if (onNotificationAction) onNotificationAction();
    } catch (err) {
      console.error('[NotificationDrawer] Error al descartar:', err);
    } finally {
      setActionInProgress(null);
    }
  };

  // Marcar todas como leídas
  const handleMarkAllRead = async () => {
    try {
      await notificationService.markAllAsRead();
      setNotifications(prev =>
        prev.map(n => ({ ...n, status: 'READ', readAt: new Date().toISOString() }))
      );
      if (onNotificationAction) onNotificationAction();
    } catch (err) {
      console.error('[NotificationDrawer] Error al marcar todas leídas:', err);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Bandeja de Notificaciones"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <div
        className="
          relative z-10 w-full sm:w-[440px] max-w-full h-full
          bg-white shadow-2xl flex flex-col
          border-l border-slate-200 animate-in slide-in-from-right duration-200
        "
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <div>
            <h2 className="text-base font-bold text-slate-900 tracking-tight">
              Notificaciones
            </h2>
            <p className="text-xs text-slate-500">
              Centro de alertas y eventos del cliente
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleMarkAllRead}
              className="text-xs text-blue-600 hover:text-blue-800 font-semibold px-2 py-1 rounded hover:bg-blue-50 transition-colors cursor-pointer"
              title="Marcar todas como leídas"
            >
              Marcar todo leído
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              aria-label="Cerrar panel"
            >
              <X size={18} weight="bold" />
            </button>
          </div>
        </div>

        {/* Filtros horizontales (Fase B17) */}
        <div className="px-4 py-2 border-b border-slate-100 bg-white overflow-x-auto custom-scrollbar flex items-center gap-1.5 flex-nowrap">
          {filters.map(f => {
            const isActive = activeFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setActiveFilter(f.key)}
                className={`
                  px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer
                  ${isActive
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900'
                  }
                `}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Contenido / Lista */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-2 custom-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-xs font-medium">Cargando notificaciones...</p>
            </div>
          ) : notifications.length === 0 ? (
            /* Empty State (Fase B22) */
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                <CheckCircle size={26} weight="regular" />
              </div>
              <h3 className="text-sm font-semibold text-slate-800 mb-1">
                No tienes notificaciones pendientes
              </h3>
              <p className="text-xs text-slate-500 max-w-xs">
                Todas las alertas de clientes, pagos e incidencias han sido atendidas o descartadas.
              </p>
            </div>
          ) : (
            notifications.map((notif) => {
              const visual = getNotificationVisual(notif.type, notif.priority);
              const IconComponent = visual.icon;
              const isUnread = notif.status === 'UNREAD';
              const isResolved = notif.status === 'RESOLVED';
              const isDismissed = notif.status === 'DISMISSED';

              return (
                <div
                  key={notif.id}
                  className={`
                    p-3.5 rounded-xl transition-all duration-150 mb-1
                    ${isUnread ? 'bg-blue-50/40 border border-blue-100/60' : 'hover:bg-slate-50/80'}
                    ${isDismissed ? 'opacity-50' : ''}
                  `}
                >
                  <div className="flex items-start gap-3">
                    {/* Icono visual de categoría */}
                    <div className={`p-2 rounded-lg border flex-shrink-0 mt-0.5 ${visual.color}`}>
                      <IconComponent size={18} weight="fill" />
                    </div>

                    {/* Texto principal sanitizado (Fase B19: strictly no raw HTML) */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-[11px] font-semibold text-slate-500 tracking-wider">
                          {visual.badge}
                        </span>
                        <span className="text-[11px] text-slate-400 whitespace-nowrap">
                          {formatTimeAgo(notif.createdAt)}
                        </span>
                      </div>

                      <h4 className="text-xs font-bold text-slate-900 leading-snug truncate">
                        {notif.title}
                      </h4>

                      <p className="text-xs text-slate-600 mt-0.5 line-clamp-2 leading-relaxed">
                        {notif.message}
                      </p>

                      {/* Botones de acción y Deep-Link (Fase B8) */}
                      <div className="flex items-center justify-between gap-2 mt-2.5 pt-2 border-t border-slate-100/70">
                        {notif.deepLink ? (
                          <button
                            onClick={() => handleDeepLinkClick(notif)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
                          >
                            <span>{visual.deepLinkLabel}</span>
                            <ArrowRight size={13} weight="bold" />
                          </button>
                        ) : (
                          <div />
                        )}

                        <div className="flex items-center gap-1">
                          {isUnread && (
                            <button
                              onClick={(e) => handleMarkAsRead(notif.id, e)}
                              disabled={actionInProgress === notif.id}
                              className="px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 rounded transition-colors cursor-pointer"
                              title="Marcar como leída"
                            >
                              Leída
                            </button>
                          )}

                          {!isResolved && (
                            <button
                              onClick={(e) => handleResolve(notif.id, e)}
                              disabled={actionInProgress === notif.id}
                              className="px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 rounded transition-colors cursor-pointer"
                              title="Resolver notificación"
                            >
                              Resolver
                            </button>
                          )}

                          {!isDismissed && (
                            <button
                              onClick={(e) => handleDismiss(notif.id, e)}
                              disabled={actionInProgress === notif.id}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                              title="Descartar"
                            >
                              <Trash size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
