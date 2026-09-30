import React, { useState, useEffect, useCallback } from 'react';
import { Bell } from '@phosphor-icons/react';
import { io } from 'socket.io-client';
import * as notificationService from '../../services/notificationService';
import NotificationDrawer from './NotificationDrawer';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function NotificationBell({ className = '' }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Cargar conteo inicial de no leídas
  const refreshUnreadCount = useCallback(async () => {
    try {
      const res = await notificationService.getUnreadCount();
      if (res?.success && typeof res.count === 'number') {
        setUnreadCount(res.count);
      }
    } catch (err) {
      console.warn('[NotificationBell] Error obteniendo unread count:', err.message);
    }
  }, []);

  useEffect(() => {
    refreshUnreadCount();

    // Conexión Socket.IO para eventos realtime (Fase B9)
    const token = localStorage.getItem('sa_token');
    let socket;
    try {
      socket = io(API_BASE_URL, {
        auth: { token },
        query: { token },
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 5,
        reconnectionDelay: 2000
      });

      socket.on('connect', () => {
        // Al reconectar, refrescar conteo desde DB (B9: socket no es single source of truth)
        refreshUnreadCount();
      });

      socket.on('customer_notification_created', () => {
        setUnreadCount(prev => prev + 1);
      });
    } catch (sockErr) {
      console.warn('[NotificationBell] No se pudo inicializar Socket:', sockErr.message);
    }

    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, [refreshUnreadCount]);

  // Formato de badge: si > 99 -> '99+'
  const badgeLabel = unreadCount > 99 ? '99+' : unreadCount;

  return (
    <>
      <button
        onClick={() => setIsDrawerOpen(true)}
        className={`
          relative flex items-center justify-center w-9 h-9 rounded-xl
          border border-slate-200/80 bg-white text-slate-600 hover:text-blue-600
          hover:border-blue-200 hover:bg-blue-50/50 shadow-xs
          transition-all duration-150 cursor-pointer flex-shrink-0
          ${className}
        `}
        aria-label={`Notificaciones (${unreadCount} no leídas)`}
        title="Notificaciones"
      >
        <Bell size={19} weight={unreadCount > 0 ? 'fill' : 'regular'} className={unreadCount > 0 ? 'text-blue-600' : 'text-slate-600'} />

        {/* Badge (Fase B6) */}
        {unreadCount > 0 && (
          <span
            className="
              absolute -top-1 -right-1 flex items-center justify-center
              min-w-[18px] h-[18px] px-1 text-[10px] font-extrabold
              text-white bg-rose-600 rounded-full shadow-xs
              border-2 border-white animate-in zoom-in-50 duration-150
            "
          >
            {badgeLabel}
          </span>
        )}
      </button>

      {/* Drawer */}
      <NotificationDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onNotificationAction={refreshUnreadCount}
      />
    </>
  );
}
