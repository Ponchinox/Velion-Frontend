import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  WhatsappLogo,
  MetaLogo,
  Lock,
  IdentificationBadge,
  Key,
  FloppyDisk,
  ShieldCheck,
  Warning,
  CaretDown,
} from '@phosphor-icons/react';

// ─── Sub-componente: Selector de Proveedor ─────────────────────────────────
function ProviderSelector({ value, onChange }) {
  const options = [
    {
      id: 'EVOLUTION',
      label: 'Conexión QR',
      sublabel: 'Evolution API',
      description: 'Escanea un código QR desde tu celular. Ideal para números personales o de prueba.',
      icon: <QrCode size={26} weight="duotone" />,
      badge: 'Gratis',
      badgeColor: 'bg-emerald-500/15 text-emerald-600',
    },
    {
      id: 'META',
      label: 'API Oficial',
      sublabel: 'Meta Cloud API',
      description: 'Conexión directa con la API Oficial de WhatsApp Business. Ideal para producción y alto volumen.',
      icon: <MetaLogo size={26} weight="duotone" />,
      badge: 'Oficial',
      badgeColor: 'bg-blue-500/15 text-blue-600',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {options.map((opt) => {
        const isSelected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`
              relative flex flex-col items-start gap-2 p-4 rounded-xl border-2 text-left
              transition-all duration-150 cursor-pointer
              ${isSelected
                ? 'border-brand bg-brand/8 shadow-sm'
                : 'border-line bg-app hover:border-brand/40 hover:bg-brand/4'
              }
            `}
          >
            {/* Indicador de selección */}
            <span className={`
              absolute top-3 right-3 w-4 h-4 rounded-full border-2 flex items-center justify-center
              transition-all duration-150
              ${isSelected ? 'border-brand bg-brand' : 'border-muted bg-transparent'}
            `}>
              {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
            </span>

            {/* Icono + Badge */}
            <div className="flex items-center gap-2">
              <span className={`${isSelected ? 'text-brand' : 'text-lo'} transition-colors`}>
                {opt.icon}
              </span>
              <span className={`text-2xs font-bold px-2 py-0.5 rounded-full ${opt.badgeColor}`}>
                {opt.badge}
              </span>
            </div>

            {/* Texto */}
            <div>
              <p className={`text-sm font-extrabold leading-tight ${isSelected ? 'text-brand' : 'text-hi'}`}>
                {opt.label}
              </p>
              <p className="text-2xs text-lo font-medium mt-0.5">{opt.sublabel}</p>
            </div>
            <p className="text-2xs text-lo leading-relaxed">{opt.description}</p>
          </button>
        );
      })}
    </div>
  );
}

// ─── Sub-componente: Campo de formulario ───────────────────────────────────
function FormField({ id, label, placeholder, value, onChange, type = 'text', required, helpText, icon }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-semibold text-hi">
        {icon && <span className="text-muted">{icon}</span>}
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full px-3 py-2.5 text-sm bg-app border border-line rounded-lg text-hi placeholder:text-muted
          focus:outline-none focus:border-brand focus:shadow-input-focus transition-all font-mono"
      />
      {helpText && <p className="text-2xs text-lo">{helpText}</p>}
    </div>
  );
}

// ─── Página Principal ──────────────────────────────────────────────────────
export default function ConexionesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Estados de conexión
  const [status, setStatus] = useState('LOADING');
  const [phone, setPhone] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [savedName, setSavedName] = useState(() => localStorage.getItem('sa_connection_name') || 'Ventas / Atención');
  const [activeProvider, setActiveProvider] = useState('EVOLUTION');
  const [metaPhoneNumberIdSaved, setMetaPhoneNumberIdSaved] = useState(null);

  const [showNewConnectionModal, setShowNewConnectionModal] = useState(false);
  const [showUpsellModal, setShowUpsellModal] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [disconnectInstanceName, setDisconnectInstanceName] = useState(null);
  const [connections, setConnections] = useState([]);

  // Selector de proveedor en el modal
  const [selectedProvider, setSelectedProvider] = useState('EVOLUTION');
  const [connectionName, setConnectionName] = useState('Ventas');

  // Código QR (Evolution)
  const [qrBase64, setQrBase64] = useState('');
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);

  // Formulario Meta (legacy fallback)
  const [metaPhoneNumberId, setMetaPhoneNumberId] = useState('');
  const [metaWabaId, setMetaWabaId] = useState('');
  const [metaAccessToken, setMetaAccessToken] = useState('');
  const [metaPhoneNumber, setMetaPhoneNumber] = useState('');
  const [isSavingMeta, setIsSavingMeta] = useState(false);

  // Meta Embedded Signup (nuevo flujo)
  const [metaOnboardingStatus, setMetaOnboardingStatus] = useState('idle'); // 'idle'|'loading_sdk'|'waiting'|'exchanging'|'success'|'error'
  const [metaOnboardingError, setMetaOnboardingError] = useState(null);
  const [metaAppId, setMetaAppId] = useState(null);
  const [metaConfigId, setMetaConfigId] = useState(null);
  const [showLegacyMeta, setShowLegacyMeta] = useState(false);
  const [metaConfigured, setMetaConfigured] = useState(true); // optimistic, se corrige al cargar

  // Toast
  const [toast, setToast] = useState(null);

  const pollIntervalRef = useRef(null);
  const instanceNameRef = useRef('');

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const [connLimit, setConnLimit] = useState(1);
  const [activeConnectionsCount, setActiveConnectionsCount] = useState(0);
  const isConnected = status === 'CONNECTED';

  const checkStatus = async (currentInstanceName) => {
    // Usar ref para siempre tener el nombre actualizado sin stale closure
    const nameToCheck = currentInstanceName || instanceNameRef.current;
    try {
      const data = await connectionService.getStatus(nameToCheck);
      if (data.instanceName) {
        setInstanceName(data.instanceName);
        instanceNameRef.current = data.instanceName;
      }

      // Estrategia primaria: Evolution API devolvió estado open + teléfono
      if ((data.status === 'open' || data.status === 'CONNECTED') && data.phone) {
        setStatus('CONNECTED');
        setPhone(data.phone);
        setShowNewConnectionModal((prev) => {
          if (prev) showToast('¡WhatsApp vinculado exitosamente!');
          return false;
        });
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        await loadProvider();
        return 'CONNECTED';
      }

      // Estrategia secundaria: Evolution no devolvió el teléfono, pero
      // el webhook YA pudo haberlo guardado en la DB. Verificamos ahí.
      if (data.status === 'open' || data.status === 'CONNECTED') {
        const providerData = await connectionService.getProvider();
        const dbConnections = providerData.connections || [];
        const matchedConn = nameToCheck
          ? dbConnections.find(c => c.instanceName === nameToCheck)
          : dbConnections[0];

        if (matchedConn?.phoneNumber) {
          setStatus('CONNECTED');
          setPhone(matchedConn.phoneNumber);
          setConnections(dbConnections);
          if (providerData.connLimit) setConnLimit(providerData.connLimit);
          if (providerData.activeConnectionsCount !== undefined) setActiveConnectionsCount(providerData.activeConnectionsCount);
          setShowNewConnectionModal((prev) => {
            if (prev) showToast('¡WhatsApp vinculado exitosamente!');
            return false;
          });
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          return 'CONNECTED';
        }
      }

      // Si ninguna estrategia encontró conexión activa
      setStatus('DISCONNECTED');
      setPhone('');
      return 'DISCONNECTED';
    } catch (err) {
      if (err.status === 403) {
        showToast(err.message, 'error');
        setShowNewConnectionModal(false);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      }
      setStatus('DISCONNECTED');
      return 'DISCONNECTED';
    }
  };

  const loadProvider = async () => {
    try {
      const pData = await connectionService.getProvider();
      setConnections(pData.connections || []);
      setActiveProvider(pData.provider || 'EVOLUTION');
      setMetaPhoneNumberIdSaved(pData.metaPhoneNumberId || null);
      if (pData.connLimit) setConnLimit(pData.connLimit);
      if (pData.activeConnectionsCount !== undefined) setActiveConnectionsCount(pData.activeConnectionsCount);
    } catch {}
  };

  useEffect(() => {
    async function init() {
      await checkStatus();
      await loadProvider();
    }
    init();
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
  }, []);

  // Polling QR Evolution
  useEffect(() => {
    if (showNewConnectionModal && status === 'DISCONNECTED' && selectedProvider === 'EVOLUTION') {
      // Limpiar intervalo previo antes de crear uno nuevo
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      pollIntervalRef.current = setInterval(async () => {
        // checkStatus lee instanceNameRef.current internamente para evitar stale closures
        const current = await checkStatus();
        if (current === 'CONNECTED') {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      }, 3000);
    } else if (!showNewConnectionModal || selectedProvider !== 'EVOLUTION') {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
    return () => { if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; } };
  }, [showNewConnectionModal, status, selectedProvider]);

  const handleOpenConnectFlow = () => {
    if (activeConnectionsCount >= connLimit) {
      setShowUpsellModal(true);
    } else {
      setConnectionName('Ventas');
      setQrBase64('');
      setSelectedProvider('EVOLUTION');
      setMetaPhoneNumberId('');
      setMetaWabaId('');
      setMetaAccessToken('');
      setMetaPhoneNumber('');
      setShowNewConnectionModal(true);
    }
  };

  // ── Generación de QR (Evolution) ────────────────────────────────────────
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
        setActiveProvider('EVOLUTION');
        setShowNewConnectionModal(false);
        showToast('WhatsApp ya se encuentra conectado.');
        await loadProvider();
      } else if (res.qr) {
        const formattedQr = res.qr.startsWith('data:image') ? res.qr : `data:image/png;base64,${res.qr}`;
        setQrBase64(formattedQr);
        // Guardar el instanceName tanto en estado como en ref para que el polling lo use sin stale closures
        if (res.instanceName) {
          setInstanceName(res.instanceName);
          instanceNameRef.current = res.instanceName;
        }
        setStatus('DISCONNECTED');
        showToast('Código QR generado. ¡Escanéalo con WhatsApp!');
      }
    } catch (err) {
      showToast(err.message || 'Error al obtener el código QR.', 'error');
    } finally {
      setIsGeneratingQr(false);
    }
  };

  // ── [LEGACY] Crear instancia Meta manualmente ────────────────────────────
  const handleSaveMeta = async () => {
    if (!metaPhoneNumberId.trim() || !metaWabaId.trim() || !metaAccessToken.trim() || !metaPhoneNumber.trim()) {
      showToast('Completa los 4 campos requeridos de Meta.', 'error');
      return;
    }
    setIsSavingMeta(true);
    try {
      localStorage.setItem('sa_connection_name', connectionName || 'Meta API');
      setSavedName(connectionName || 'Meta API');
      await connectionService.metaLegacyConnect({
        metaPhoneNumberId: metaPhoneNumberId.trim(),
        metaWabaId:        metaWabaId.trim(),
        metaAccessToken:   metaAccessToken.trim(),
        phoneNumber:       metaPhoneNumber.trim(),
      });
      setActiveProvider('META');
      setMetaPhoneNumberIdSaved(metaPhoneNumberId.trim());
      setStatus('CONNECTED');
      setShowNewConnectionModal(false);
      showToast('✅ Conexión Meta configurada manualmente.');
      await loadProvider();
    } catch (err) {
      showToast(err.message || 'Error al crear la conexión Meta.', 'error');
    } finally {
      setIsSavingMeta(false);
    }
  };

  // ── Meta Embedded Signup: Carga config del backend ──────────────────────
  const loadMetaConfig = useCallback(async () => {
    try {
      const cfg = await connectionService.getMetaOnboardingConfig();
      if (cfg.configured) {
        setMetaAppId(cfg.appId);
        setMetaConfigId(cfg.configId);
        setMetaConfigured(true);
      } else {
        setMetaConfigured(false);
      }
    } catch {
      setMetaConfigured(false);
    }
  }, []);

  // Ref para capturar eventos de sesión de Meta Embedded Signup (FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING)
  const metaSessionInfoRef = useRef({ wabaId: null, phoneNumberId: null });

  // ── Meta Embedded Signup: Iniciar flujo con FB SDK ───────────────────────
  const handleMetaEmbeddedSignup = useCallback(() => {
    if (!window.FB) {
      setMetaOnboardingError('El SDK de Facebook no está disponible. Verifica tu conexión y recarga la página.');
      return;
    }
    if (!metaAppId || !metaConfigId) {
      setMetaOnboardingError('La integración con Meta no está configurada en el servidor. Contacta al administrador.');
      return;
    }

    setMetaOnboardingStatus('waiting');
    setMetaOnboardingError(null);
    metaSessionInfoRef.current = { wabaId: null, phoneNumberId: null };

    window.FB.login(
      async (response) => {
        if (!response?.authResponse?.code) {
          // Usuario canceló o no autorizó completamente
          setMetaOnboardingStatus('idle');
          if (response?.status === 'unknown') {
            setMetaOnboardingError('Vinculación cancelada. Si fue accidental, vuelve a intentarlo.');
          }
          return;
        }

        const { code } = response.authResponse;
        // Priorizar datos de FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING capturados via message event,
        // o fallback a authResponse si estuvieran presentes
        const wabaId = response.authResponse?.waba_id || metaSessionInfoRef.current?.wabaId || null;
        const phoneNumberId = response.authResponse?.phone_number_id || metaSessionInfoRef.current?.phoneNumberId || null;

        console.log(`📡 [Meta Coexistence] Enviando callback al backend (wabaId: ${wabaId || 'auto-descubrir'}, phoneNumberId: ${phoneNumberId || 'auto-descubrir'})...`);

        setMetaOnboardingStatus('exchanging');
        try {
          const result = await connectionService.metaOnboardingCallback({
            code,
            wabaId,
            phoneNumberId,
          });
          if (result.success) {
            setMetaOnboardingStatus('success');
            setActiveProvider('META');
            setMetaPhoneNumberIdSaved(result.metaPhoneNumberId);
            setStatus('CONNECTED');
            showToast(`✅ WhatsApp Business conectado: +${result.phoneNumber}`);
            setShowNewConnectionModal(false);
            await loadProvider();
          } else {
            throw new Error(result.error || 'Respuesta inesperada del servidor.');
          }
        } catch (err) {
          setMetaOnboardingStatus('error');
          setMetaOnboardingError(err.message || 'Error al completar la vinculación con Meta.');
        }
      },
      {
        config_id:                    metaConfigId,
        response_type:                'code',
        override_default_response_type: true,
        extras: {
          setup:               {},
          version:             'v4',
          featureType:         'whatsapp_business_app_onboarding',
          sessionInfoVersion:  '3',
          coex:                true,  // Activa el flujo Coexistence
        },
      }
    );
  }, [metaAppId, metaConfigId, loadProvider]);

  // Listener para capturar eventos de sesión de Meta Embedded Signup (FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING)
  useEffect(() => {
    const handleMetaMessageEvent = (event) => {
      // Ignorar mensajes sin origen seguro o sin datos
      if (!event.data) return;

      try {
        const rawData = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;

        if (rawData?.type === 'WA_EMBEDDED_SIGNUP') {
          console.log(`📩 [Meta Embedded Signup Event] Evento: ${rawData.event}`, rawData.data);

          if (
            rawData.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' ||
            rawData.event === 'FINISH'
          ) {
            const wabaId = rawData.data?.waba_id || rawData.data?.wabaId || null;
            const phoneNumberId = rawData.data?.phone_number_id || rawData.data?.phoneNumberId || null;
            metaSessionInfoRef.current = { wabaId, phoneNumberId };
            console.log(`✅ [Meta Coexistence] Datos de sesión capturados: WABA=${wabaId}, PhoneID=${phoneNumberId}`);
          } else if (rawData.event === 'CANCEL') {
            console.log('⚠️ [Meta Embedded Signup] Usuario canceló el flujo.');
          } else if (rawData.event === 'ERROR') {
            console.error('❌ [Meta Embedded Signup] Error en el flujo:', rawData.data);
            setMetaOnboardingError(rawData.data?.error_message || 'Error en el registro de Meta.');
          }
        }
      } catch {
        // Ignorar mensajes que no sean JSON
      }
    };

    window.addEventListener('message', handleMetaMessageEvent);
    return () => {
      window.removeEventListener('message', handleMetaMessageEvent);
    };
  }, []);

  // Cargar config Meta cuando el usuario selecciona la opción META
  useEffect(() => {
    if (selectedProvider === 'META' && showNewConnectionModal) {
      setMetaOnboardingStatus('loading_sdk');
      setMetaOnboardingError(null);

      // Cargar config del backend
      loadMetaConfig().then(() => {
        // Cargar el SDK de Facebook si aún no está cargado
        if (!window.FB) {
          const existingScript = document.getElementById('facebook-jssdk');
          if (!existingScript) {
            const script = document.createElement('script');
            script.id  = 'facebook-jssdk';
            script.src = 'https://connect.facebook.net/en_US/sdk.js';
            script.async = true;
            script.onload = () => {
              window.FB.init({
                appId:   metaAppId || '',
                cookie:  true,
                xfbml:   true,
                version: 'v20.0',
              });
              setMetaOnboardingStatus('idle');
            };
            script.onerror = () => {
              setMetaOnboardingStatus('error');
              setMetaOnboardingError('No se pudo cargar el SDK de Facebook. Verifica tu conexión a internet.');
            };
            document.body.appendChild(script);
          } else {
            setMetaOnboardingStatus('idle');
          }
        } else {
          // Re-inicializar con el App ID correcto
          if (metaAppId) {
            window.FB.init({ appId: metaAppId, cookie: true, xfbml: true, version: 'v20.0' });
          }
          setMetaOnboardingStatus('idle');
        }
      });
    }
  }, [selectedProvider, showNewConnectionModal, loadMetaConfig, metaAppId]);

  // ── Desconectar ──────────────────────────────────────────────────────────
  const executeDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await connectionService.logout({
        instanceName: disconnectInstanceName?.instanceName || null,
        connectionId: disconnectInstanceName?.connectionId || null,
        provider: disconnectInstanceName?.provider || null,
      });
      setStatus('DISCONNECTED');
      setQrBase64('');
      setPhone('');
      setMetaPhoneNumberIdSaved(null);
      setShowDisconnectModal(false);
      setDisconnectInstanceName(null);
      showToast('Sesión de WhatsApp desconectada correctamente.');
      await loadProvider(); // Actualizar conteo a la baja
    } catch (err) {
      showToast(err.message || 'Error al desconectar.', 'error');
    } finally {
      setIsDisconnecting(false);
    }
  };

  // ── Render modal – paso de proveedor ─────────────────────────────────────
  const renderModalContent = () => (
    <div className="space-y-5">
      {/* Paso 1: Nombre */}
      <FormField
        id="conn-name-input"
        label="Nombre de la conexión"
        placeholder="Ej. Ventas, Soporte, Sucursal Lima"
        value={connectionName}
        onChange={setConnectionName}
        required
      />

      {/* Paso 2: Selector de proveedor */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-hi">Tipo de conexión <span className="text-red-500">*</span></p>
        <ProviderSelector value={selectedProvider} onChange={(v) => { setSelectedProvider(v); setQrBase64(''); }} />
      </div>

      {/* Paso 3: Flujo según proveedor */}
      {selectedProvider === 'EVOLUTION' ? (
        /* ── Evolution: QR ── */
        <div className="space-y-3">
          {!qrBase64 ? (
            <button
              onClick={handleGenerateQr}
              disabled={isGeneratingQr || !connectionName.trim()}
              className="w-full py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white font-bold text-sm
                flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGeneratingQr ? (
                <><CircleNotch size={18} className="animate-spin" /><span>Generando QR...</span></>
              ) : (
                <><QrCode size={18} weight="bold" /><span>Generar Código QR</span></>
              )}
            </button>
          ) : (
            <div className="flex flex-col items-center gap-4 pt-1">
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
                <p className="text-3xs text-lo">Ve a WhatsApp &gt; Dispositivos vinculados &gt; Vincular un dispositivo.</p>
              </div>
              <button onClick={handleGenerateQr} disabled={isGeneratingQr}
                className="text-xs text-brand font-semibold hover:underline flex items-center gap-1 cursor-pointer">
                <ArrowsClockwise size={14} /><span>Refrescar código QR</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        /* ── Meta Cloud API: Embedded Signup (nuevo flujo oficial) ── */
        <div className="space-y-4">

          {/* ── Panel principal: Botón "Continuar con Facebook" ── */}
          {!showLegacyMeta && (
            <div className="space-y-4">

              {/* Info Banner */}
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-blue-500/8 border border-blue-500/20">
                <ShieldCheck size={18} weight="duotone" className="text-blue-500 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-blue-700 dark:text-blue-400 leading-relaxed space-y-1">
                  <p className="font-semibold">Conecta tu WhatsApp Business existente.</p>
                  <p>Con <strong>Coexistence</strong> podrás seguir usando la app de WhatsApp Business en tu teléfono mientras el bot de IA responde automáticamente a través de la API oficial de Meta.</p>
                </div>
              </div>

              {/* Estado: No configurado en servidor */}
              {!metaConfigured && metaOnboardingStatus !== 'loading_sdk' && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <Warning size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    La integración con Meta no está configurada en este servidor. Contacta al administrador para configurar <code className="font-mono">META_APP_ID</code> y <code className="font-mono">META_EMBEDDED_SIGNUP_CONFIG_ID</code>.
                  </p>
                </div>
              )}

              {/* Estado: Error del proceso */}
              {metaOnboardingError && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                  <Warning size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-700 dark:text-red-400">{metaOnboardingError}</p>
                </div>
              )}

              {/* Botón principal */}
              <button
                id="meta-embedded-signup-btn"
                onClick={handleMetaEmbeddedSignup}
                disabled={
                  !metaConfigured ||
                  metaOnboardingStatus === 'loading_sdk' ||
                  metaOnboardingStatus === 'waiting' ||
                  metaOnboardingStatus === 'exchanging'
                }
                className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2.5
                  shadow-md transition-all cursor-pointer
                  bg-[#1877F2] hover:bg-[#166fe5] active:bg-[#1464d8] text-white
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {metaOnboardingStatus === 'loading_sdk' && (
                  <><CircleNotch size={18} className="animate-spin" /><span>Cargando...</span></>
                )}
                {metaOnboardingStatus === 'waiting' && (
                  <><CircleNotch size={18} className="animate-spin" /><span>Abriendo ventana de Meta...</span></>
                )}
                {metaOnboardingStatus === 'exchanging' && (
                  <><CircleNotch size={18} className="animate-spin" /><span>Completando vinculación...</span></>
                )}
                {(metaOnboardingStatus === 'idle' || metaOnboardingStatus === 'error') && (
                  <><MetaLogo size={18} weight="bold" /><span>Continuar con Facebook</span></>
                )}
              </button>

              {/* Nota de Coexistence */}
              <p className="text-2xs text-lo text-center leading-relaxed">
                Se abrirá una ventana de Meta para autorizar el acceso. Tu número continuará
                funcionando en la app de WhatsApp Business <span className="font-semibold text-blue-500">simultáneamente</span>.
              </p>

              {/* Botón fallback: mostrar formulario manual */}
              <div className="border-t border-line pt-3">
                <button
                  id="meta-show-legacy-form-btn"
                  onClick={() => setShowLegacyMeta(true)}
                  className="flex items-center gap-1 text-2xs text-muted hover:text-hi transition-colors cursor-pointer mx-auto"
                >
                  <CaretDown size={12} />
                  <span>¿Problemas? Conectar manualmente con credenciales</span>
                </button>
              </div>
            </div>
          )}

          {/* ── Panel legado: Formulario manual (oculto por defecto) ── */}
          {showLegacyMeta && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-hi">Configuración manual de credenciales Meta</p>
                <button
                  onClick={() => setShowLegacyMeta(false)}
                  className="text-2xs text-muted hover:text-hi cursor-pointer transition-colors"
                >
                  ← Volver al flujo oficial
                </button>
              </div>

              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-500/8 border border-amber-500/20">
                <Warning size={16} weight="duotone" className="text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                  Modo avanzado. Requiere obtener manualmente los datos desde{' '}
                  <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer"
                    className="font-bold underline underline-offset-2">Meta Developers</a>.
                </p>
              </div>

              <FormField
                id="meta-phone-number"
                label="Número de teléfono WhatsApp Business"
                placeholder="+51987654321"
                value={metaPhoneNumber}
                onChange={setMetaPhoneNumber}
                required
                helpText="Número de teléfono real de tu cuenta WhatsApp Business (con código de país)."
                icon={<DeviceMobile size={14} />}
              />

              <FormField
                id="meta-phone-id"
                label="Phone Number ID"
                placeholder=""
                value={metaPhoneNumberId}
                onChange={setMetaPhoneNumberId}
                required
                helpText="ID numérico en Meta Developers → Tu App → WhatsApp → Configuración de API."
                icon={<IdentificationBadge size={14} />}
              />

              <FormField
                id="meta-waba-id"
                label="WABA ID (WhatsApp Business Account ID)"
                placeholder=""
                value={metaWabaId}
                onChange={setMetaWabaId}
                required
                helpText="ID de tu cuenta de WhatsApp Business en Meta Business Manager."
                icon={<WhatsappLogo size={14} />}
              />

              <FormField
                id="meta-access-token"
                label="Access Token Permanente"
                placeholder=""
                value={metaAccessToken}
                onChange={setMetaAccessToken}
                type="password"
                required
                helpText="Token de acceso permanente (System User) con permiso whatsapp_business_messaging."
                icon={<Key size={14} />}
              />

              <button
                onClick={handleSaveMeta}
                disabled={isSavingMeta || !metaPhoneNumberId.trim() || !metaWabaId.trim() || !metaAccessToken.trim() || !metaPhoneNumber.trim()}
                className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm
                  flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer
                  disabled:opacity-50 disabled:cursor-not-allowed mt-1"
              >
                {isSavingMeta ? (
                  <><CircleNotch size={18} className="animate-spin" /><span>Guardando...</span></>
                ) : (
                  <><FloppyDisk size={18} weight="bold" /><span>Guardar credenciales Meta</span></>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── Render card de conexión activa ───────────────────────────────────────
  const renderConnectionCard = (conn, index) => {
    const isMeta = conn.provider === 'META';
    return (
      <div key={conn.id} className="bg-card border border-line rounded-2xl shadow-card overflow-hidden flex flex-col justify-between hover:border-brand/40 transition-all">
        <div className="p-5 border-b border-line flex items-center justify-between bg-app/40">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${isMeta ? 'bg-blue-500/15 text-blue-600' : 'bg-emerald-500/15 text-emerald-600'}`}>
              {isMeta ? <MetaLogo size={22} weight="bold" /> : <DeviceMobile size={22} weight="bold" />}
            </div>
            <div>
              <h3 className="font-extrabold text-base text-hi leading-none">{`Instancia ${index + 1}`}</h3>
              <span className="text-xs text-lo font-mono mt-1 block">
                {isMeta ? `Phone ID: ${conn.metaPhoneNumberId || '—'}` : `ID: ${conn.instanceName}`}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold
              ${isMeta ? 'bg-blue-500/15 text-blue-600' : 'bg-emerald-500/15 text-emerald-600'}`}>
              <span className={`w-2 h-2 rounded-full animate-pulse ${isMeta ? 'bg-blue-500' : 'bg-emerald-500'}`} />
              Activo
            </span>
            <span className={`text-2xs font-semibold px-2 py-0.5 rounded-full ${isMeta ? 'bg-blue-500/10 text-blue-500' : 'bg-emerald-500/10 text-emerald-600'}`}>
              {isMeta ? 'Meta Cloud API' : 'Evolution QR'}
            </span>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className={`p-3.5 rounded-xl border space-y-1 ${isMeta ? 'bg-blue-500/8 border-blue-500/20 text-blue-700 dark:text-blue-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400'}`}>
            <p className="text-xs font-bold flex items-center gap-1.5">
              <CheckCircle size={16} weight="fill" />
              {isMeta ? 'Conectado vía Meta Cloud API Oficial' : 'WhatsApp vinculado exitosamente - Bot Activo'}
            </p>
            <p className="text-2xs opacity-90">
              {isMeta
                ? 'Los mensajes se procesan a través de la Graph API de Meta.'
                : 'La IA está respondiendo mensajes de clientes en tiempo real.'}
            </p>
          </div>

          {conn.phoneNumber && (
            <div className="flex items-center justify-between text-xs py-1 border-t border-line">
              <span className="text-lo font-medium">Número conectado:</span>
              <span className="font-mono font-bold text-hi">+{conn.phoneNumber}</span>
            </div>
          )}
        </div>

        <div className="p-4 bg-app/30 border-t border-line flex flex-col gap-2">
          {/* Botón de editar (Meta) */}
          {isMeta && (
            <button
              onClick={() => {
                setSelectedProvider('META');
                setConnectionName(`Instancia ${index + 1}`);
                setMetaPhoneNumberId(conn.metaPhoneNumberId || '');
                setMetaWabaId(conn.metaWabaId || '');
                setMetaAccessToken('');
                setMetaPhoneNumber(conn.phoneNumber || '');
                setShowNewConnectionModal(true);
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl
                bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400
                border border-blue-500/20 font-bold text-xs transition-all cursor-pointer"
            >
              <Key size={15} weight="bold" /><span>Editar Credenciales Meta</span>
            </button>
          )}
          <button
            onClick={() => {
              setDisconnectInstanceName({
                instanceName: conn.instanceName || null,
                connectionId: conn.id,
                provider: conn.provider,
              });
              setShowDisconnectModal(true);
            }}
            disabled={isDisconnecting}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl
              bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400
              border border-red-500/20 font-bold text-xs transition-all cursor-pointer disabled:opacity-50"
          >
            <LinkBreak size={16} weight="bold" /><span>Desconectar / Eliminar</span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">

      {/* ── HEADER ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-line pb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-hi tracking-tight">Conexiones de WhatsApp</h1>
          <p className="text-sm text-lo mt-1">
            Vincula tu número de WhatsApp — por código QR o mediante la API Oficial de Meta — para que la IA automatice tus ventas y soporte.
          </p>
        </div>
        <button
          onClick={handleOpenConnectFlow}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl
            bg-brand text-white font-bold text-sm hover:bg-brand-hover active:scale-[0.98]
            transition-all duration-fast shadow-md cursor-pointer self-start sm:self-auto"
        >
          <Plus size={18} weight="bold" />
          <span>Vincular Número</span>
        </button>
      </div>

      {/* ── CUERPO ── */}
      {status === 'LOADING' ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3">
          <CircleNotch size={40} className="animate-spin text-brand" />
          <p className="text-sm font-semibold text-hi">Verificando estado de conexiones...</p>
          <p className="text-xs text-lo">Conectando con la infraestructura de WhatsApp</p>
        </div>
      ) : activeConnectionsCount === 0 ? (
        <div className="bg-card border border-line rounded-2xl p-10 text-center max-w-xl mx-auto space-y-4 shadow-card my-6">
          <div className="w-16 h-16 rounded-2xl bg-brand/10 text-brand flex items-center justify-center mx-auto shadow-inner">
            <DeviceMobile size={36} weight="duotone" />
          </div>
          <div className="space-y-2 max-w-md mx-auto">
            <h2 className="text-xl font-extrabold text-hi">Aún no tienes números vinculados</h2>
            <p className="text-sm text-lo leading-relaxed">
              Conecta tu cuenta de WhatsApp por QR o mediante la API Oficial de Meta para que la IA empiece a responder por ti.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <button onClick={handleOpenConnectFlow}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl
                bg-brand text-white font-bold text-sm hover:bg-brand-hover transition-all shadow-md cursor-pointer">
              <QrCode size={16} weight="bold" /><span>Vincular por QR</span>
            </button>
            <button onClick={() => { setSelectedProvider('META'); setConnectionName('Meta API'); setShowNewConnectionModal(true); }}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl
                bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-all shadow-md cursor-pointer">
              <MetaLogo size={16} weight="bold" /><span>Conectar Meta API</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {connections.map((conn, index) => renderConnectionCard(conn, index))}
        </div>
      )}

      {/* ── MODAL: NUEVA CONEXIÓN ── */}
      <Modal
        isOpen={showNewConnectionModal}
        onClose={() => setShowNewConnectionModal(false)}
        title="Vincular Conexión de WhatsApp"
        subtitle="Elige el tipo de conexión y configura tu número."
        maxWidth="max-w-lg"
      >
        {renderModalContent()}
      </Modal>

      {/* ── MODAL: UPSELL ── */}
      <Modal
        isOpen={showUpsellModal}
        onClose={() => setShowUpsellModal(false)}
        title="Límite Alcanzado"
        subtitle={`Tu plan actual solo permite ${connLimit} conexión(es). Actualiza tu plan para vincular más números.`}
        maxWidth="max-w-sm"
      >
        <div className="pt-2">
          <button
            onClick={() => { setShowUpsellModal(false); navigate('/billing'); }}
            className="w-full py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white font-bold text-sm
              transition-all shadow-md cursor-pointer text-center"
          >
            Actualizar Plan
          </button>
        </div>
      </Modal>

      {/* ── MODAL: CONFIRMAR DESCONEXIÓN ── */}
      <ConfirmModal
        isOpen={showDisconnectModal}
        onClose={() => setShowDisconnectModal(false)}
        onConfirm={executeDisconnect}
        title="Desconectar WhatsApp"
        message="¿Estás seguro de que deseas desconectar tu número? El bot de IA dejará de responder mensajes de inmediato."
        confirmText="Desconectar"
        cancelText="Cancelar"
        isLoading={isDisconnecting}
      />

      {/* ── TOASTS ── */}
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
          {toast.type === 'success'
            ? <CheckCircle size={20} weight="fill" className="text-emerald-500 flex-shrink-0" />
            : <WarningCircle size={20} weight="fill" className="text-red-500 flex-shrink-0" />
          }
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-1 text-muted hover:text-hi cursor-pointer">&times;</button>
        </div>
      )}

    </div>
  );
}