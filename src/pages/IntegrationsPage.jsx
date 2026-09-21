import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  PlugsConnected,
  ArrowsClockwise,
  CheckCircle,
  WarningCircle,
  LinkBreak,
  ArrowSquareOut,
  ShoppingBag,
  CircleNotch,
  FloppyDisk,
  QrCode,
  ChatCircleDots,
  ShieldCheck,
  Warning,
  Info,
  Storefront,
} from '@phosphor-icons/react';
import * as integrationService from '../services/integrationService';
import * as connectionService from '../services/connectionService';
import ConfirmModal from '../components/ui/ConfirmModal';

// ─── SVG Logo de Shopify ──────────────────────────────────────────────────
function ShopifyLogo({ className = 'w-8 h-8' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M20.2 6.8c-.1-.3-.3-.4-.5-.4h-2.1c-.2-.7-.6-2.1-1.7-3.1C14.7 2.2 13.5 2 12.6 2c-.2 0-.3.1-.4.2L9.9 4.3C9.7 4.2 9.5 4.1 9.3 4.1c-1.3 0-2.6 1-3.6 2.8C4.5 9 4.2 11.5 4.2 13.5c0 3.3 1.2 5.5 2.8 6.9 1.4 1.3 3.3 1.6 4.9 1.6 1.9 0 3.8-.5 5.5-2.2 1.6-1.6 2.6-3.8 2.8-6.6.1-2.1-.1-4.7-.5-6.4h.5zM12.6 3.6c.6 0 1.5.2 2.3 1-.3.4-.8 1.1-1.2 1.8h-2.6l1.5-2.8zm-3.6 2.2c.6-1.1 1.4-1.8 2.2-1.9L9.8 6.5C9.5 6.1 9.2 5.8 9 5.8zm3.2 14.7c-1.3 0-2.8-.3-3.9-1.3-1.3-1.1-2.3-3-2.3-5.8 0-1.8.3-4.1 1.2-5.7.8-1.5 1.8-2.3 2.8-2.3.2 0 .4 0 .6.1l-2.1 3.9c-.2.4-.1.9.3 1.1.4.2.9.1 1.1-.3l2.2-4.1c.1 0 .2-.1.4-.1h2.8c-.3.6-.6 1.3-1 2.1-.2.4 0 .9.4 1.1.4.2.9 0 1.1-.4.4-.9.9-1.9 1.2-2.8h.4c.3 1.5.5 3.9.4 5.7-.2 2.4-1.1 4.3-2.4 5.6-1.4 1.4-3.1 1.8-4.7 1.8z"
        fill="#95BF47"
      />
      <path
        d="M14.9 6.4h-2.8c-.2 0-.3.1-.4.1L9.5 10.6c-.2.4-.7.5-1.1.3-.4-.2-.5-.7-.3-1.1l2.1-3.9c-.2-.1-.4-.1-.6-.1-1 0-2 .8-2.8 2.3-.9 1.6-1.2 3.9-1.2 5.7 0 2.8 1 4.7 2.3 5.8 1.1 1 2.6 1.3 3.9 1.3 1.6 0 3.3-.4 4.7-1.8 1.3-1.3 2.2-3.2 2.4-5.6.1-1.8-.1-4.2-.4-5.7h-.4c-.3.9-.8 1.9-1.2 2.8-.2.4-.7.6-1.1.4-.4-.2-.6-.7-.4-1.1.4-.8.7-1.5 1-2.1z"
        fill="#5E8E3E"
      />
    </svg>
  );
}

export default function IntegrationsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Estados de Shopify
  const [shopifyLoading, setShopifyLoading] = useState(true);
  const [shopifyStatus, setShopifyStatus] = useState(null);
  const [shopifyShopDomain, setShopifyShopDomain] = useState('');
  const [domainError, setDomainError] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [disconnectModalOpen, setDisconnectModalOpen] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Configuración de catálogo editable
  const [catalogSettings, setCatalogSettings] = useState({
    catalogMode: 'VELION_ONLY',
    priceSource: 'VELION',
    stockSource: 'VELION',
  });

  // Estados de Conexiones WhatsApp (Meta / Evolution)
  const [connectionData, setConnectionData] = useState(null);
  const [connectionsLoading, setConnectionsLoading] = useState(true);

  // Sistema de Toast
  const [toast, setToast] = useState(null); // { type: 'success' | 'error' | 'info', message: string }

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  // Cargar estado de Shopify
  const loadShopifyStatus = useCallback(async () => {
    try {
      setShopifyLoading(true);
      const res = await integrationService.getShopifyStatus();
      setShopifyStatus(res);
      if (res && res.settings) {
        setCatalogSettings({
          catalogMode: res.settings.catalogMode || 'VELION_ONLY',
          priceSource: res.settings.priceSource || 'VELION',
          stockSource: res.settings.stockSource || 'VELION',
        });
      }
    } catch (err) {
      console.error('[Integraciones] Error cargando estado de Shopify:', err.message);
      showToast('No se pudo obtener el estado de Shopify', 'error');
    } finally {
      setShopifyLoading(false);
    }
  }, []);

  // Cargar estado de WhatsApp (Meta / Evolution)
  const loadWhatsAppStatus = useCallback(async () => {
    try {
      setConnectionsLoading(true);
      const res = await connectionService.getProvider();
      setConnectionData(res);
    } catch (err) {
      console.error('[Integraciones] Error cargando conexiones WhatsApp:', err.message);
    } finally {
      setConnectionsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadShopifyStatus();
    loadWhatsAppStatus();

    // Detección de retorno de OAuth (?shopify=connected)
    if (searchParams.get('shopify') === 'connected') {
      const shop = searchParams.get('shop');
      showToast(`¡Tienda Shopify ${shop ? `(${shop})` : ''} conectada exitosamente!`, 'success');
      // Limpiar la URL sin recargar la página
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [loadShopifyStatus, loadWhatsAppStatus, searchParams]);

  // Manejador de Conexión OAuth
  const handleConnectShopify = async (e) => {
    e.preventDefault();
    const cleanDomain = shopifyShopDomain.trim().toLowerCase();

    if (!cleanDomain) {
      setDomainError('Ingresa el dominio de tu tienda Shopify.');
      return;
    }

    if (!cleanDomain.endsWith('.myshopify.com') && !cleanDomain.includes('.')) {
      setDomainError('El dominio debe tener el formato tu-tienda.myshopify.com');
      return;
    }

    setDomainError('');
    setIsConnecting(true);

    try {
      const res = await integrationService.connectShopify(cleanDomain);
      if (res.authUrl) {
        // Redirigir de inmediato al portal seguro de OAuth de Shopify
        window.location.href = res.authUrl;
      } else {
        showToast('No se recibió la URL de autorización de Shopify.', 'error');
        setIsConnecting(false);
      }
    } catch (err) {
      console.error('[Integraciones] Error conectando Shopify:', err);
      showToast(err.message || 'Error al iniciar conexión con Shopify.', 'error');
      setIsConnecting(false);
    }
  };

  // Manejador de Sincronización
  const handleSyncNow = async () => {
    if (isSyncing) return;
    setIsSyncing(true);

    try {
      const res = await integrationService.syncShopify();
      const pCount = res.productsSynced ?? 0;
      const vCount = res.variantsSynced ?? 0;
      showToast(`Catálogo sincronizado: ${pCount} productos, ${vCount} variantes.`, 'success');
      await loadShopifyStatus();
    } catch (err) {
      console.error('[Integraciones] Error en sincronización:', err);
      showToast(err.message || 'Error al sincronizar el catálogo de Shopify.', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  // Manejador de Guardado de Configuración
  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    try {
      await integrationService.updateShopifySettings(catalogSettings);
      showToast('Configuración de catálogo actualizada correctamente.', 'success');
      await loadShopifyStatus();
    } catch (err) {
      console.error('[Integraciones] Error guardando settings:', err);
      showToast(err.message || 'Error al actualizar configuración.', 'error');
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Manejador de Desconexión
  const handleConfirmDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await integrationService.disconnectShopify(false);
      showToast('Integración de Shopify desconectada.', 'info');
      setDisconnectModalOpen(false);
      await loadShopifyStatus();
    } catch (err) {
      console.error('[Integraciones] Error al desconectar:', err);
      showToast(err.message || 'Error al desconectar Shopify.', 'error');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const isConnected = shopifyStatus?.status === 'CONNECTED';
  const isShopifyError = shopifyStatus?.status === 'ERROR';
  const isReauthNeeded = isShopifyError || shopifyStatus?.lastSyncError === 'REAUTH_REQUIRED';

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-300">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 animate-in slide-in-from-top-4 duration-200">
          <div
            className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium ${
              toast.type === 'error'
                ? 'bg-red-50 text-red-800 border-red-200'
                : toast.type === 'info'
                ? 'bg-blue-50 text-blue-800 border-blue-200'
                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
            }`}
          >
            {toast.type === 'error' ? (
              <WarningCircle size={20} className="text-red-500 shrink-0" weight="bold" />
            ) : toast.type === 'info' ? (
              <Info size={20} className="text-blue-500 shrink-0" weight="bold" />
            ) : (
              <CheckCircle size={20} className="text-emerald-500 shrink-0" weight="bold" />
            )}
            <span>{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              className="ml-2 text-slate-400 hover:text-slate-600 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line pb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
              <PlugsConnected size={24} weight="duotone" />
            </div>
            <h1 className="text-2xl font-bold text-hi">Integraciones</h1>
          </div>
          <p className="text-sm text-lo">
            Conecta tu tienda online y canales oficiales de mensajería para automatizar tus ventas.
          </p>
        </div>

        <button
          onClick={() => {
            loadShopifyStatus();
            loadWhatsAppStatus();
          }}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-card border border-line text-mid hover:text-hi hover:bg-app transition-colors shadow-sm cursor-pointer self-start sm:self-auto"
        >
          <ArrowsClockwise size={15} className={shopifyLoading ? 'animate-spin' : ''} />
          Actualizar estado
        </button>
      </div>

      {/* Grid de Integraciones */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ─── 1. SHOPIFY CARD (2 columnas en pantallas grandes) ─────────── */}
        <div className="lg:col-span-2 bg-card rounded-2xl border border-line p-6 shadow-sm flex flex-col justify-between">
          <div>
            {/* Cabecera Tarjeta Shopify */}
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shadow-xs">
                  <ShopifyLogo className="w-9 h-9" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-hi">Shopify</h2>
                    {shopifyLoading ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">
                        <CircleNotch size={12} className="animate-spin" />
                        Cargando...
                      </span>
                    ) : isConnected ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                        <CheckCircle size={13} weight="fill" />
                        Conectado
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                        No conectado
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-lo mt-1">
                    Sincroniza productos, precios e inventario de tu tienda Shopify con Velion.
                  </p>
                </div>
              </div>
            </div>

            {/* Contenido Dinámico según Estado de Conexión */}
            {shopifyLoading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
                <CircleNotch size={32} className="animate-spin text-brand" />
                <p className="text-sm">Verificando estado de la integración...</p>
              </div>
            ) : isConnected ? (
              /* ── ESTADO CONECTADO ── */
              <div className="space-y-6">
                {/* Alerta de Re-autenticación si aplica */}
                {isReauthNeeded && (
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <Warning size={22} className="text-amber-600 shrink-0" weight="fill" />
                      <div>
                        <p className="text-xs font-bold">Shopify requiere volver a conectarse</p>
                        <p className="text-xs text-amber-700 mt-0.5">
                          El token de acceso expiró o los permisos fueron revocados desde Shopify.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleConnectShopify({ preventDefault: () => {} })}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition-colors cursor-pointer shrink-0"
                    >
                      Reconectar
                    </button>
                  </div>
                )}

                {/* Métricas y Estado Rápido */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-app border border-line">
                    <span className="text-xs font-medium text-lo block">Tienda Vinculada</span>
                    <span className="text-sm font-bold text-hi block mt-1 truncate" title={shopifyStatus?.shopDomain}>
                      {shopifyStatus?.shopDomain || 'Desconocida'}
                    </span>
                  </div>

                  <div className="p-4 rounded-xl bg-app border border-line">
                    <span className="text-xs font-medium text-lo block">Moneda de Catálogo</span>
                    <span className="text-sm font-bold text-hi block mt-1">
                      {shopifyStatus?.shopCurrencyCode || shopifyStatus?.currencyCode || 'USD'}
                    </span>
                  </div>

                  <div className="p-4 rounded-xl bg-app border border-line">
                    <span className="text-xs font-medium text-lo block">Última Sincronización</span>
                    <span className="text-sm font-bold text-hi block mt-1">
                      {shopifyStatus?.lastSyncAt
                        ? new Date(shopifyStatus.lastSyncAt).toLocaleString('es-PE', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })
                        : 'Nunca'}
                    </span>
                  </div>
                </div>

                {/* Último Error Sanitizado */}
                {shopifyStatus?.lastSyncError && !isReauthNeeded && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
                    <WarningCircle size={16} className="shrink-0 text-red-500" />
                    <span>Último error reportado: {shopifyStatus.lastSyncError}</span>
                  </div>
                )}

                {/* Botón Sincronizar Catálogo */}
                <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-emerald-50/50 border border-emerald-100">
                  <div>
                    <h4 className="text-xs font-bold text-emerald-900">Sincronización de Catálogo</h4>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      Descarga los productos y variantes activos desde Shopify a Velion.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleSyncNow}
                    disabled={isSyncing}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isSyncing ? (
                      <>
                        <CircleNotch size={14} className="animate-spin" />
                        Sincronizando...
                      </>
                    ) : (
                      <>
                        <ArrowsClockwise size={14} weight="bold" />
                        Sincronizar ahora
                      </>
                    )}
                  </button>
                </div>

                {/* Configuración de Catálogo Comercial */}
                <div className="border-t border-line pt-5 space-y-4">
                  <div>
                    <h4 className="text-sm font-bold text-hi">Cómo usar Shopify en Velion</h4>
                    <p className="text-xs text-lo mt-0.5">
                      Personaliza cómo interactúa el catálogo y los pedidos entre Velion y Shopify.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Modo de Catálogo */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-mid">Modo de Catálogo</label>
                      <select
                        value={catalogSettings.catalogMode}
                        onChange={(e) =>
                          setCatalogSettings({ ...catalogSettings, catalogMode: e.target.value })
                        }
                        className="w-full text-xs font-medium px-3 py-2 rounded-lg bg-app border border-line text-hi focus:outline-none focus:border-brand"
                      >
                        <option value="VELION_ONLY">Solo catálogo Velion</option>
                        <option value="SHOPIFY_ONLY">Solo Shopify</option>
                        <option value="COMBINED">Combinar Velion + Shopify</option>
                      </select>
                    </div>

                    {/* Origen de Precios */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-mid">Origen de Precios</label>
                      <select
                        value={catalogSettings.priceSource}
                        onChange={(e) =>
                          setCatalogSettings({ ...catalogSettings, priceSource: e.target.value })
                        }
                        className="w-full text-xs font-medium px-3 py-2 rounded-lg bg-app border border-line text-hi focus:outline-none focus:border-brand"
                      >
                        <option value="VELION">Precios de Velion</option>
                        <option value="SHOPIFY">Precios de Shopify</option>
                      </select>
                    </div>

                    {/* Origen de Inventario / Stock */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-mid">Origen de Inventario</label>
                      <select
                        value={catalogSettings.stockSource}
                        onChange={(e) =>
                          setCatalogSettings({ ...catalogSettings, stockSource: e.target.value })
                        }
                        className="w-full text-xs font-medium px-3 py-2 rounded-lg bg-app border border-line text-hi focus:outline-none focus:border-brand"
                      >
                        <option value="VELION">Inventario de Velion</option>
                        <option value="SHOPIFY">Inventario de Shopify</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={handleSaveSettings}
                      disabled={isSavingSettings}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg bg-brand hover:bg-brand-hover text-white transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {isSavingSettings ? (
                        <CircleNotch size={14} className="animate-spin" />
                      ) : (
                        <FloppyDisk size={14} weight="bold" />
                      )}
                      Guardar configuración
                    </button>

                    <button
                      type="button"
                      onClick={() => setDisconnectModalOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 transition-colors cursor-pointer"
                    >
                      <LinkBreak size={15} />
                      Desconectar Shopify
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* ── ESTADO DESCONECTADO ── */
              <form onSubmit={handleConnectShopify} className="space-y-5">
                <div className="p-4 rounded-xl bg-app border border-line">
                  <label className="block text-xs font-bold text-hi mb-1">
                    Dominio de tu tienda Shopify
                  </label>
                  <p className="text-xs text-lo mb-3">
                    Introduce tu dominio .myshopify.com para iniciar la autorización segura.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <Storefront size={18} className="absolute left-3 top-2.5 text-slate-400" />
                      <input
                        type="text"
                        value={shopifyShopDomain}
                        onChange={(e) => {
                          setShopifyShopDomain(e.target.value);
                          if (domainError) setDomainError('');
                        }}
                        placeholder="mi-tienda.myshopify.com"
                        className={`w-full pl-9 pr-3 py-2 text-xs font-medium rounded-lg bg-card border text-hi focus:outline-none focus:ring-1 ${
                          domainError
                            ? 'border-red-400 focus:ring-red-400'
                            : 'border-line focus:ring-brand focus:border-brand'
                        }`}
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isConnecting}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-sm cursor-pointer disabled:opacity-50 shrink-0"
                    >
                      {isConnecting ? (
                        <>
                          <CircleNotch size={14} className="animate-spin" />
                          Conectando...
                        </>
                      ) : (
                        <>
                          <ArrowSquareOut size={15} weight="bold" />
                          Conectar Shopify
                        </>
                      )}
                    </button>
                  </div>

                  {domainError && (
                    <p className="text-xs text-red-600 mt-2 font-medium flex items-center gap-1">
                      <WarningCircle size={14} />
                      {domainError}
                    </p>
                  )}
                </div>

                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-blue-50/60 border border-blue-100 text-blue-900 text-xs">
                  <ShieldCheck size={20} className="text-brand shrink-0 mt-0.5" weight="fill" />
                  <div>
                    <span className="font-bold block">Autenticación Directa y Segura</span>
                    <span className="text-blue-800">
                      Velion utiliza el flujo oficial OAuth de Shopify. Nunca ingreses contraseñas ni claves API privadas.
                    </span>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* ─── 2. CANALES DE MENSAJERÍA (COLUMNA DERECHA) ─────────────── */}
        <div className="space-y-6">
          {/* Tarjeta Meta WhatsApp Cloud API */}
          <div className="bg-card rounded-2xl border border-line p-6 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
                  <ChatCircleDots size={24} weight="duotone" />
                </div>
                {connectionsLoading ? (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500">
                    Cargando...
                  </span>
                ) : connectionData?.provider === 'META' && connectionData?.connectionState === 'OPEN' ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                    <CheckCircle size={13} weight="fill" />
                    Conectado
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                    No conectado
                  </span>
                )}
              </div>

              <h3 className="text-base font-bold text-hi mb-1">Meta WhatsApp Cloud API</h3>
              <p className="text-xs text-lo leading-relaxed mb-4">
                Conexión oficial de WhatsApp Business API a través de la infraestructura cloud de Meta.
              </p>

              {connectionData?.provider === 'META' && connectionData?.phoneNumber && (
                <div className="mb-4 p-2.5 rounded-lg bg-app border border-line text-xs font-medium text-hi">
                  Número: <span className="font-bold">{connectionData.phoneNumber}</span>
                </div>
              )}
            </div>

            <button
              onClick={() => navigate('/conexiones')}
              className="w-full inline-flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-app hover:bg-card border border-line text-xs font-semibold text-hi transition-colors cursor-pointer"
            >
              Administrar conexión
              <ArrowSquareOut size={14} />
            </button>
          </div>

          {/* Tarjeta Evolution API (QR) */}
          <div className="bg-card rounded-2xl border border-line p-6 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
                  <QrCode size={24} weight="duotone" />
                </div>
                {connectionsLoading ? (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500">
                    Cargando...
                  </span>
                ) : connectionData?.provider === 'EVOLUTION' && connectionData?.connectionState === 'OPEN' ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                    <CheckCircle size={13} weight="fill" />
                    Conectado
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                    No conectado
                  </span>
                )}
              </div>

              <h3 className="text-base font-bold text-hi mb-1">Evolution API (QR)</h3>
              <p className="text-xs text-lo leading-relaxed mb-4">
                Conexión de WhatsApp mediante escaneo de código QR para líneas comerciales o de prueba.
              </p>

              {connectionData?.provider === 'EVOLUTION' && connectionData?.phoneNumber && (
                <div className="mb-4 p-2.5 rounded-lg bg-app border border-line text-xs font-medium text-hi">
                  Número: <span className="font-bold">{connectionData.phoneNumber}</span>
                </div>
              )}
            </div>

            <button
              onClick={() => navigate('/conexiones')}
              className="w-full inline-flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-app hover:bg-card border border-line text-xs font-semibold text-hi transition-colors cursor-pointer"
            >
              Administrar conexión
              <ArrowSquareOut size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Modal de Desconexión de Shopify */}
      <ConfirmModal
        isOpen={disconnectModalOpen}
        onClose={() => setDisconnectModalOpen(false)}
        onConfirm={handleConfirmDisconnect}
        title="¿Desconectar tienda Shopify?"
        message="Velion dejará de usar esta conexión y eliminará las credenciales locales asociadas. Esto no desinstala automáticamente la aplicación desde Shopify."
        confirmText="Desconectar"
        cancelText="Cancelar"
        isLoading={isDisconnecting}
      />
    </div>
  );
}
