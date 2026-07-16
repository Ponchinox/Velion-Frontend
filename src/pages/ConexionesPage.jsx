import React, { useState, useEffect, useRef } from 'react';
import {
  QrCode,
  Smartphone,
  Unplug,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import * as connectionService from '../services/connectionService';

export default function ConexionesPage() {
  const [status, setStatus] = useState('LOADING'); // 'LOADING' | 'CONNECTED' | 'DISCONNECTED'
  const [qrBase64, setQrBase64] = useState('');
  const [phone, setPhone] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const pollIntervalRef = useRef(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Función para consultar el estado actual
  const checkStatus = async () => {
    try {
      const data = await connectionService.getStatus();
      setInstanceName(data.instanceName || '');
      if (data.status === 'open') {
        setStatus('CONNECTED');
        setPhone(data.phone || '');
        // Detener el polling si está conectado
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      } else {
        setStatus('DISCONNECTED');
        setPhone('');
      }
      return data.status;
    } catch (err) {
      console.error('Error checking connection status:', err);
      setStatus('DISCONNECTED');
      return 'close';
    }
  };

  // Carga inicial
  useEffect(() => {
    async function init() {
      const currentStatus = await checkStatus();
      if (currentStatus !== 'open') {
        // Generar QR si está desconectado
        await handleGenerateQr(false);
      }
    }
    init();

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Polling automático cuando el estado es desconectado
  useEffect(() => {
    if (status === 'DISCONNECTED') {
      if (!pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(async () => {
          await checkStatus();
        }, 5000);
      }
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [status]);

  // Generar o refrescar QR
  const handleGenerateQr = async (showNotification = true) => {
    setIsSubmitting(true);
    try {
      const res = await connectionService.getQrCode();
      if (res.status === 'open') {
        setStatus('CONNECTED');
        if (showNotification) showToast('WhatsApp ya se encuentra conectado.');
      } else if (res.qr) {
        setQrBase64(res.qr);
        setStatus('DISCONNECTED');
        if (showNotification) showToast('Código QR generado con éxito.');
      }
    } catch (err) {
      showToast(err.message || 'Error al obtener el código QR de conexión.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Desconectar dispositivo (logout)
  const handleDisconnect = async () => {
    setIsSubmitting(true);
    try {
      await connectionService.logout();
      setStatus('DISCONNECTED');
      setQrBase64('');
      setPhone('');
      showToast('Sesión de WhatsApp cerrada correctamente.');
      // Generar inmediatamente un nuevo QR
      await handleGenerateQr(false);
    } catch (err) {
      showToast(err.message || 'Error al desconectar el dispositivo.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-120px)] p-6 bg-app/10 animate-in fade-in duration-300">
      <div className="w-full max-w-md bg-card border border-line rounded-xl shadow-card p-6 flex flex-col items-center text-center relative overflow-hidden">
        
        {/* Spinner o Carga */}
        {status === 'LOADING' && (
          <div className="py-12 flex flex-col items-center gap-3">
            <Loader2 size={40} className="animate-spin text-brand" />
            <p className="text-sm font-semibold text-hi">Comprobando estado de conexión...</p>
            <p className="text-2xs text-lo">Estableciendo comunicación con Evolution API</p>
          </div>
        )}

        {/* Estado Conectado */}
        {status === 'CONNECTED' && (
          <div className="py-6 flex flex-col items-center gap-4 w-full">
            <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 animate-bounce">
              <Smartphone size={32} />
            </div>
            <div>
              <h2 className="text-base font-bold text-hi">WhatsApp Vinculado Correctamente</h2>
              <p className="text-xs text-lo mt-1.5 leading-relaxed">
                El bot de Inteligencia Artificial y las campañas de marketing están operando activamente.
              </p>
              {phone && (
                <p className="text-2xs font-mono bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1 rounded-md inline-block mt-3">
                  Número: {phone}
                </p>
              )}
            </div>

            <div className="w-full border-t border-line pt-5 mt-3">
              <button
                onClick={handleDisconnect}
                disabled={isSubmitting}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 text-xs font-bold transition-all cursor-pointer disabled:opacity-40"
              >
                {isSubmitting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Unplug size={14} />
                )}
                <span>Desconectar WhatsApp</span>
              </button>
            </div>
          </div>
        )}

        {/* Estado Desconectado (Mostrar QR) */}
        {status === 'DISCONNECTED' && (
          <div className="py-4 flex flex-col items-center gap-4 w-full">
            <div>
              <h2 className="text-base font-bold text-hi">Conectar WhatsApp</h2>
              <p className="text-2xs text-lo mt-1 leading-relaxed">
                Escanea el código QR desde la sección de Dispositivos Vinculados en tu celular.
              </p>
            </div>

            {/* Contenedor del QR con marcos de enfoque */}
            <div className="relative flex items-center justify-center w-52 h-52 bg-app rounded-xl border border-line overflow-hidden shadow-sm">
              <span className="absolute top-3 left-3 w-5 h-5 border-t-2 border-l-2 border-brand rounded-tl-sm" />
              <span className="absolute top-3 right-3 w-5 h-5 border-t-2 border-r-2 border-brand rounded-tr-sm" />
              <span className="absolute bottom-3 left-3 w-5 h-5 border-b-2 border-l-2 border-brand rounded-bl-sm" />
              <span className="absolute bottom-3 right-3 w-5 h-5 border-b-2 border-r-2 border-brand rounded-br-sm" />

              {isSubmitting ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 size={32} className="animate-spin text-brand" />
                  <span className="text-3xs text-lo font-semibold">Generando código...</span>
                </div>
              ) : qrBase64 ? (
                <img src={qrBase64} alt="Evolution QR Code" className="w-48 h-48 object-contain" />
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <QrCode size={40} className="text-muted animate-pulse" />
                  <span className="text-3xs text-lo font-semibold">QR no disponible</span>
                </div>
              )}
            </div>

            {instanceName && (
              <p className="text-[10px] text-lo font-mono">
                ID de Instancia: <span className="font-semibold text-hi">{instanceName}</span>
              </p>
            )}

            <div className="w-full flex flex-col gap-2 border-t border-line pt-4 mt-2">
              <button
                onClick={() => handleGenerateQr(true)}
                disabled={isSubmitting}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-semibold shadow-card transition-all cursor-pointer disabled:opacity-40"
              >
                {isSubmitting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                <span>Generar Nuevo QR</span>
              </button>
              <p className="text-[10px] text-lo leading-normal font-medium">
                El sistema detectará la vinculación de forma automática.
              </p>
            </div>
          </div>
        )}

      </div>

      {/* Toasts */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-card-md text-sm font-medium bg-card
            ${toast.type === 'success'
              ? 'border-emerald-200 text-emerald-700'
              : 'border-red-200 text-danger'
            }
          `}
          role="status"
          aria-live="polite"
        >
          {toast.type === 'success' ? (
            <CheckCircle2 size={18} className="text-success flex-shrink-0" />
          ) : (
            <AlertCircle size={18} className="text-danger flex-shrink-0" />
          )}
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-1 text-muted hover:text-hi cursor-pointer">
            &times;
          </button>
        </div>
      )}
    </div>
  );
}
