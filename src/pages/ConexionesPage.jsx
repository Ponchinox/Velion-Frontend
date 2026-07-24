import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import * as connectionService from '../services/connectionService';
import ConfirmModal from '../components/ui/ConfirmModal';
import Modal from '../components/ui/Modal';
import {
  Plus,
  QrCode,
  DeviceMobile,
  LinkBreak,
  ArrowsClockwise,
  CircleNotch,
  CheckCircle,
  WarningCircle,
} from '@phosphor-icons/react';

export default function ConexionesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Estados principales
  const [status, setStatus] = useState('LOADING'); // 'LOADING' | 'CONNECTED' | 'DISCONNECTED'
  const [phone, setPhone] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [connectionName, setConnectionName] = useState('Principal');
  const [savedName, setSavedName] = useState(() => localStorage.getItem('sa_connection_name') || 'Ventas / Atención');

  // Código QR
  const [qrBase64, setQrBase64] = useState('');
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);

  // Modales
  const [showNewConnectionModal, setShowNewConnectionModal] = useState(false);
  const [showUpsellModal, setShowUpsellModal] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Toasts
  const [toast, setToast] = useState(null);

  const pollIntervalRef = useRef(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Límites del plan
  const connLimit = user?.tenant?.connLimit || user?.connLimit || 1;
  const isConnected = status === 'CONNECTED';
  const activeConnectionsCount = isConnected ? 1 : 0;

  // Consultar estado de la conexión
  const checkStatus = async () => {
    try {
      const data = await connectionService.getStatus();
      setInstanceName(data.instanceName || '');
      if (data.status === 'open' || data.status === 'CONNECTED') {
        setStatus('CONNECTED');
        setPhone(data.phone || '');
        
        // Cierre automático del modal si estaba abierto
        setShowNewConnectionModal((prev) => {
          if (prev) {
            showToast('¡WhatsApp vinculado exitosamente!');
          }
          return false;
        });

        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        return 'CONNECTED';
      } else {
        setStatus('DISCONNECTED');
        setPhone('');
        return 'DISCONNECTED';
      }
    } catch (err) {
      console.error('Error al comprobar estado de conexión:', err);
      setStatus('DISCONNECTED');
      return 'DISCONNECTED';
    }
  };

  // Carga inicial
  useEffect(() => {
    async function init() {
      await checkStatus();
    }
    init();

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Polling cuando la vista o modal de QR está activo
  useEffect(() => {
    if (showNewConnectionModal && status === 'DISCONNECTED') {
      if (!pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(async () => {
          const current = await checkStatus();
          if (current === 'CONNECTED') {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }, 4000);
      }
    } else if (!showNewConnectionModal && !isConnected) {
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
  }, [showNewConnectionModal, status, isConnected]);

  // Manejar clic en "Vincular Número" (Muro de Pago Interno)
  const handleOpenConnectFlow = () => {
    if (activeConnectionsCount >= connLimit) {
      setShowUpsellModal(true);
    } else {
      setConnectionName('Ventas');
      setQrBase64('');
      setShowNewConnectionModal(true);
    }
  };

  // Generar Código QR
  const handleGenerateQr = async () => {
    if (!connectionName.trim()) {
      showToast('Por favor, ingresa un nombre para la conexión.', 'error');
      return;
    }

    setIsGeneratingQr(true);
    try {
      localStorage.setItem('sa_connection_name', connectionName);
      setSavedName(connectionName);

      const res = await connectionService.getQrCode();
      if (res.status === 'open') {
        setStatus('CONNECTED');
        setShowNewConnectionModal(false);
        showToast('WhatsApp ya se encuentra conectado.');
      } else if (res.qr) {
        const formattedQr = res.qr.startsWith('data:image') ? res.qr : `data:image/png;base64,${res.qr}`;
        setQrBase64(formattedQr);
        setStatus('DISCONNECTED');
        showToast('Código QR generado con éxito.');
      }
    } catch (err) {
      showToast(err.message || 'Error al obtener el código QR de conexión.', 'error');
    } finally {
      setIsGeneratingQr(false);
    }
  };

  // Desconectar dispositivo (logout)
  const executeDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await connectionService.logout();
      setStatus('DISCONNECTED');
      setQrBase64('');
      setPhone('');
      setShowDisconnectModal(false);
      showToast('Sesión de WhatsApp cerrada y destruida correctamente.');
    } catch (err) {
      showToast(err.message || 'Error al desconectar el dispositivo.', 'error');
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      
      {/* ── HEADER PRINCIPAL Y BOTÓN DE ACCIÓN ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-line pb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-hi tracking-tight">
            Conexiones de WhatsApp
          </h1>
          <p className="text-sm text-lo mt-1">
            Vincula tus números telefónicos para que la Inteligencia Artificial automatice tus ventas y soporte.
          </p>
        </div>

        <button
          onClick={handleOpenConnectFlow}
          className="
            inline-flex items-center justify-center gap-2
            px-5 py-2.5 rounded-xl
            bg-brand text-white font-bold text-sm
            hover:bg-brand-hover active:scale-[0.98]
            transition-all duration-fast shadow-md cursor-pointer
            self-start sm:self-auto
          "
        >
          <Plus size={18} weight="bold" />
          <span>Vincular Número</span>
        </button>
      </div>

      {/* ── CUERPO PRINCIPAL / ESTADO VACÍO O GRID DE TARJETAS ── */}
      {status === 'LOADING' ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3">
          <CircleNotch size={40} className="animate-spin text-brand" />
          <p className="text-sm font-semibold text-hi">Verificando estado de conexiones...</p>
          <p className="text-xs text-lo">Conectando con la infraestructura de Evolution API</p>
        </div>
      ) : activeConnectionsCount === 0 ? (
        /* ── ESTADO VACÍO (EMPTY STATE) ── */
        <div className="bg-card border border-line rounded-2xl p-10 text-center max-w-xl mx-auto space-y-4 shadow-card my-6">
          <div className="w-16 h-16 rounded-2xl bg-brand/10 text-brand flex items-center justify-center mx-auto shadow-inner">
            <DeviceMobile size={36} weight="duotone" />
          </div>

          <div className="space-y-2 max-w-md mx-auto">
            <h2 className="text-xl font-extrabold text-hi">Aún no tienes números vinculados</h2>
            <p className="text-sm text-lo leading-relaxed">
              Aún no tienes números vinculados. Conecta tu cuenta de WhatsApp para que la Inteligencia Artificial comience a responder por ti.
            </p>
          </div>
        </div>
      ) : (
        /* ── GRID DE TARJETAS DE CONEXIÓN ── */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Tarjeta de Conexión Activa */}
          <div className="bg-card border border-line rounded-2xl shadow-card overflow-hidden flex flex-col justify-between hover:border-brand/40 transition-all">
            {/* Header de Tarjeta */}
            <div className="p-5 border-b border-line flex items-center justify-between bg-app/40">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-600 flex items-center justify-center font-bold">
                  <DeviceMobile size={22} weight="bold" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-hi leading-none">{savedName}</h3>
                  <span className="text-xs text-lo font-mono mt-1 block">ID: {instanceName}</span>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 text-xs font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Activo
              </span>
            </div>

            {/* Body de Tarjeta */}
            <div className="p-6 space-y-4">
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 space-y-1">
                <p className="text-xs font-bold flex items-center gap-1.5">
                  <CheckCircle size={16} weight="fill" />
                  WhatsApp vinculado exitosamente - Bot Activo
                </p>
                <p className="text-2xs opacity-90">
                  La IA está respondiendo mensajes de clientes en tiempo real.
                </p>
              </div>

              {phone && (
                <div className="flex items-center justify-between text-xs py-1 border-t border-line">
                  <span className="text-lo font-medium">Número conectado:</span>
                  <span className="font-mono font-bold text-hi">+{phone}</span>
                </div>
              )}
            </div>

            {/* Footer de Tarjeta */}
            <div className="p-4 bg-app/30 border-t border-line">
              <button
                onClick={() => setShowDisconnectModal(true)}
                disabled={isDisconnecting}
                className="
                  w-full flex items-center justify-center gap-2
                  py-2.5 px-4 rounded-xl
                  bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400
                  border border-red-500/20 font-bold text-xs
                  transition-all cursor-pointer disabled:opacity-50
                "
              >
                <LinkBreak size={16} weight="bold" />
                <span>Desconectar / Eliminar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 1: NUEVA CONEXIÓN DE WHATSAPP (PASOS Y QR) ── */}
      <Modal
        isOpen={showNewConnectionModal}
        onClose={() => setShowNewConnectionModal(false)}
        title="Vincular Nueva Conexión"
        subtitle="Asigna un nombre a la línea y escanea el código QR desde tu celular."
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          {/* Paso 1: Input Nombre */}
          <div className="space-y-1.5">
            <label htmlFor="conn-name-input" className="block text-xs font-semibold text-hi">
              Nombre de la conexión <span className="text-red-500">*</span>
            </label>
            <input
              id="conn-name-input"
              type="text"
              value={connectionName}
              onChange={(e) => setConnectionName(e.target.value)}
              placeholder="Ej. Ventas, Soporte, Sucursal Lima"
              className="w-full px-3 py-2.5 text-sm bg-app border border-line rounded-lg text-hi placeholder:text-muted focus:outline-none focus:border-brand focus:shadow-input-focus transition-all"
            />
          </div>

          {/* Paso 2: Generar QR o Mostrar QR */}
          {!qrBase64 ? (
            <button
              onClick={handleGenerateQr}
              disabled={isGeneratingQr || !connectionName.trim()}
              className="
                w-full py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white font-bold text-sm
                flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer
                disabled:opacity-50 disabled:cursor-not-allowed mt-2
              "
            >
              {isGeneratingQr ? (
                <>
                  <CircleNotch size={18} className="animate-spin" />
                  <span>Generando QR...</span>
                </>
              ) : (
                <>
                  <QrCode size={18} weight="bold" />
                  <span>Generar Código QR</span>
                </>
              )}
            </button>
          ) : (
            /* Paso 3: Visualización del QR */
            <div className="flex flex-col items-center gap-4 pt-2">
              <div className="relative flex items-center justify-center w-52 h-52 bg-white rounded-xl border border-line overflow-hidden shadow-inner">
                <span className="absolute top-3 left-3 w-5 h-5 border-t-2 border-l-2 border-brand rounded-tl-sm" />
                <span className="absolute top-3 right-3 w-5 h-5 border-t-2 border-r-2 border-brand rounded-tr-sm" />
                <span className="absolute bottom-3 left-3 w-5 h-5 border-b-2 border-l-2 border-brand rounded-bl-sm" />
                <span className="absolute bottom-3 right-3 w-5 h-5 border-b-2 border-r-2 border-brand rounded-br-sm" />

                <img src={qrBase64} alt="Código QR WhatsApp" className="w-44 h-44 object-contain bg-white" />
              </div>

              <div className="text-center space-y-1">
                <p className="text-xs font-bold text-hi flex items-center justify-center gap-1.5">
                  <CircleNotch size={14} className="animate-spin text-brand" />
                  Esperando escaneo en WhatsApp...
                </p>
                <p className="text-3xs text-lo">
                  Ve a WhatsApp &gt; Dispositivos vinculados &gt; Vincular un dispositivo.
                </p>
              </div>

              <button
                onClick={handleGenerateQr}
                disabled={isGeneratingQr}
                className="text-xs text-brand font-semibold hover:underline flex items-center gap-1 cursor-pointer pt-1"
              >
                <ArrowsClockwise size={14} />
                <span>Refrescar código QR</span>
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* ── MODAL 2: UPSELL / MURO DE PAGO INTERNO ── */}
      <Modal
        isOpen={showUpsellModal}
        onClose={() => setShowUpsellModal(false)}
        title="Límite Alcanzado"
        subtitle={`Tu plan actual solo permite ${connLimit} conexión(es) simultánea(s). Actualiza tu plan para vincular más números de WhatsApp.`}
        maxWidth="max-w-sm"
      >
        <div className="pt-2">
          <button
            onClick={() => {
              setShowUpsellModal(false);
              navigate('/billing');
            }}
            className="
              w-full py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white font-bold text-sm
              transition-all duration-fast shadow-md cursor-pointer text-center
            "
          >
            Actualizar Plan
          </button>
        </div>
      </Modal>

      {/* ── MODAL 3: CONFIRMACIÓN DE DESCONEXIÓN DE SESIÓN ── */}
      <ConfirmModal
        isOpen={showDisconnectModal}
        onClose={() => setShowDisconnectModal(false)}
        onConfirm={executeDisconnect}
        title="Desconectar WhatsApp"
        message="¿Estás seguro de que deseas desconectar tu número? El bot automatizado de IA dejará de responder mensajes de inmediato."
        confirmText="Desconectar"
        cancelText="Cancelar"
        isLoading={isDisconnecting}
      />

      {/* Toasts de Notificación */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-card-md text-sm font-medium bg-card
            ${toast.type === 'success'
              ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
              : 'border-red-500/30 text-red-600 dark:text-red-400'
            }
          `}
          role="status"
          aria-live="polite"
        >
          {toast.type === 'success' ? (
            <CheckCircle size={20} weight="fill" className="text-emerald-500 flex-shrink-0" />
          ) : (
            <WarningCircle size={20} weight="fill" className="text-red-500 flex-shrink-0" />
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
