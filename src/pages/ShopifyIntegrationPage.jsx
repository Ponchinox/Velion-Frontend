import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowsClockwise,
  CheckCircle,
  WarningCircle,
  LinkBreak,
  CircleNotch,
  FloppyDisk,
  ShieldCheck,
  Warning,
  Storefront,
} from '@phosphor-icons/react';
import * as integrationService from '../services/integrationService';
import ConfirmModal from '../components/ui/ConfirmModal';
import PageNavigationHeader from '../components/navigation/PageNavigationHeader';
import shopifyLogo from '../assets/integrations/shopify.svg';

export default function ShopifyIntegrationPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [shopifyStatus, setShopifyStatus] = useState(null);
  const [shopDomainInput, setShopDomainInput] = useState('');
  const [domainError, setDomainError] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [disconnectModalOpen, setDisconnectModalOpen] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Configuración editable
  const [catalogSettings, setCatalogSettings] = useState({
    catalogMode: 'VELION_ONLY',
    priceSource: 'VELION',
    stockSource: 'VELION',
  });

  // Sistema de Toast
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  // Cargar estado de Shopify
  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
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
      console.error('[Shopify Detail] Error cargando estado:', err.message);
      showToast('No se pudo obtener el estado de Shopify', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();

    // Detección de retorno de OAuth (?shopify=connected)
    if (searchParams.get('shopify') === 'connected') {
      const shop = searchParams.get('shop');
      showToast(`¡Tienda Shopify ${shop ? `(${shop})` : ''} conectada exitosamente!`, 'success');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [loadStatus, searchParams]);

  // Conectar OAuth
  const handleConnect = async (e) => {
    e.preventDefault();
    const cleanDomain = shopDomainInput.trim().toLowerCase();

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
      const token = localStorage.getItem('sa_token');
      const impersonatedTenantId = localStorage.getItem('impersonatedTenantId');
      const returnTo = `${window.location.origin}/integraciones/shopify`;

      // Resolver URL base de la API backend
      let apiBase = import.meta.env.VITE_API_URL;
      if (!apiBase) {
        apiBase = window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://185.163.116.210';
      }
      const baseUrl = apiBase.endsWith('/api') ? apiBase : `${apiBase}/api`;
      const connectUrl = new URL(`${baseUrl}/integrations/shopify/connect`);
      connectUrl.searchParams.set('shop', cleanDomain);
      connectUrl.searchParams.set('returnTo', returnTo);
      if (token) {
        connectUrl.searchParams.set('token', token);
      }
      if (impersonatedTenantId) {
        connectUrl.searchParams.set('tenantId', impersonatedTenantId);
      }

      // NAVEGACIÓN TOP-LEVEL directa al backend (garantiza persistencia de cookie SameSite=Lax)
      window.location.assign(connectUrl.toString());
    } catch (err) {
      console.error('[Shopify Detail] Error conectando:', err);
      showToast(err.message || 'Error al iniciar conexión con Shopify.', 'error');
      setIsConnecting(false);
    }
  };

  // Sincronización Manual
  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await integrationService.syncShopify();
      showToast(res.message || 'Sincronización iniciada correctamente.');
      await loadStatus();
    } catch (err) {
      console.error('[Shopify Detail] Error sincronizando:', err);
      showToast(err.message || 'Error al sincronizar catálogo con Shopify.', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  // Guardar Configuración Comercial
  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setIsSavingSettings(true);
    try {
      await integrationService.updateShopifySettings(catalogSettings);
      showToast('Configuración comercial actualizada.');
      await loadStatus();
    } catch (err) {
      console.error('[Shopify Detail] Error guardando settings:', err);
      showToast(err.message || 'Error al guardar la configuración.', 'error');
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Desconectar
  const handleConfirmDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await integrationService.disconnectShopify(true);
      setDisconnectModalOpen(false);
      showToast('Tienda Shopify desconectada.');
      await loadStatus();
    } catch (err) {
      console.error('[Shopify Detail] Error desconectando:', err);
      showToast(err.message || 'Error al desconectar Shopify.', 'error');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const isConnected = shopifyStatus?.status === 'CONNECTED';

  return (
    <div className="w-full flex flex-col space-y-6 animate-in fade-in duration-200">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-card-md text-sm font-medium bg-card ${
            toast.type === 'error'
              ? 'border-red-500/30 text-red-600'
              : 'border-emerald-500/30 text-emerald-600'
          }`}
          role="status"
        >
          {toast.type === 'error' ? (
            <WarningCircle size={20} weight="fill" className="text-red-500 shrink-0" />
          ) : (
            <CheckCircle size={20} weight="fill" className="text-emerald-500 shrink-0" />
          )}
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-2 text-muted hover:text-hi cursor-pointer"
          >
            &times;
          </button>
        </div>
      )}

      {/* ─── Navegación Unificada ───────────────────────────────────────────── */}
      <PageNavigationHeader />

      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 border-b border-line pb-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50/60 border border-emerald-100 p-2.5 flex items-center justify-center shrink-0">
            <img src={shopifyLogo} alt="Shopify Logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold text-hi">Shopify</h1>
              {loading ? (
                <span className="px-2.5 py-0.5 rounded-full text-2xs font-semibold bg-slate-100 text-slate-500">
                  Cargando...
                </span>
              ) : isConnected ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  <CheckCircle size={13} weight="fill" />
                  Conectado (LIVE_CONNECTION_CONFIRMED)
                </span>
              ) : (shopifyStatus?.stage === 'READY_FOR_DEV_STORE' || shopifyStatus?.isConfigured) ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 border border-blue-500/20">
                  <ShieldCheck size={13} weight="fill" />
                  Listo para Dev Store (READY_FOR_DEV_STORE)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-700 border border-amber-500/20">
                  <Warning size={13} weight="fill" />
                  Credenciales Pendientes (CREDENTIALS_REQUIRED)
                </span>
              )}
            </div>
            <p className="text-xs text-lo mt-1">
              Conecta tu tienda y sincroniza productos, precios e inventario en tiempo real.
            </p>
          </div>
        </div>
      </div>

      {/* ─── Contenido Principal ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Columna Izquierda: Estado y Sincronización */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-card rounded-2xl border border-line p-6 shadow-sm space-y-4">
            <h2 className="text-sm font-bold text-hi border-b border-line pb-3">
              Información de la Tienda
            </h2>

            {loading ? (
              <div className="py-8 flex items-center justify-center text-lo text-xs gap-2">
                <CircleNotch size={18} className="animate-spin text-brand" />
                Cargando datos...
              </div>
            ) : isConnected ? (
              <div className="space-y-3.5 text-xs">
                <div>
                  <span className="text-lo block font-medium">Dominio de la tienda:</span>
                  <span className="text-hi font-mono font-bold text-sm break-all">
                    {shopifyStatus?.shopDomain || '—'}
                  </span>
                </div>

                <div>
                  <span className="text-lo block font-medium">Moneda configurada:</span>
                  <span className="text-hi font-bold">
                    {shopifyStatus?.shopCurrencyCode || 'No especificada'}
                  </span>
                </div>

                <div>
                  <span className="text-lo block font-medium">Última sincronización:</span>
                  <span className="text-hi font-medium">
                    {shopifyStatus?.lastSyncedAt
                      ? new Date(shopifyStatus.lastSyncedAt).toLocaleString()
                      : 'Nunca sincronizado'}
                  </span>
                </div>

                {shopifyStatus?.lastSyncError && (
                  <div className="p-3 rounded-xl bg-red-50/70 border border-red-200 text-red-700 text-xs">
                    <p className="font-bold flex items-center gap-1.5 mb-1">
                      <WarningCircle size={15} weight="fill" className="text-red-600" />
                      Último error registrado:
                    </p>
                    <p className="text-2xs font-mono break-all">{shopifyStatus.lastSyncError}</p>
                  </div>
                )}

                <div className="pt-2 border-t border-line space-y-2">
                  <button
                    onClick={handleSync}
                    disabled={isSyncing}
                    className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    {isSyncing ? (
                      <>
                        <CircleNotch size={16} className="animate-spin" />
                        Sincronizando...
                      </>
                    ) : (
                      <>
                        <ArrowsClockwise size={16} weight="bold" />
                        Sincronizar ahora
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => setDisconnectModalOpen(true)}
                    className="w-full inline-flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-600 border border-red-500/20 text-xs font-bold transition-colors cursor-pointer"
                  >
                    <LinkBreak size={16} weight="bold" />
                    Desconectar tienda
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                <p className="text-lo leading-relaxed">
                  Para habilitar la sincronización de productos, precios y stock con Shopify, vincula el dominio de tu tienda.
                </p>

                {shopifyStatus && !shopifyStatus.isConfigured && (
                  <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-900 space-y-2">
                    <div className="flex items-center gap-1.5 font-bold text-amber-800 text-xs">
                      <Warning size={15} weight="fill" className="text-amber-600 shrink-0" />
                      <span>Configuración Previa de Shopify Partners Requerida</span>
                    </div>
                    <p className="text-2xs text-amber-800 leading-relaxed">
                      Para conectar una <strong>Development Store</strong> en vivo, registre una App en Shopify Partners y configure en el archivo <code className="bg-white/70 px-1 py-0.5 rounded border border-amber-200">backend_api/.env</code>:
                    </p>
                    <div className="text-2xs font-mono bg-white/80 p-2 rounded-lg border border-amber-200/80 space-y-0.5 text-slate-800 select-all">
                      <p>SHOPIFY_CLIENT_ID=&lt;tu_client_id&gt;</p>
                      <p>SHOPIFY_CLIENT_SECRET=&lt;tu_client_secret&gt;</p>
                      <p>SHOPIFY_REDIRECT_URI={shopifyStatus?.redirectUri || 'https://tu-dominio/api/integrations/shopify/callback'}</p>
                    </div>
                    <p className="text-2xs text-amber-700">
                      <strong>Scopes oficiales:</strong> <code className="bg-white/70 px-1 py-0.5 rounded border border-amber-200">read_products, read_inventory, write_draft_orders</code>
                    </p>
                  </div>
                )}

                {shopifyStatus?.isConfigured && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-900 text-2xs space-y-1">
                    <p className="font-bold flex items-center gap-1.5 text-emerald-800">
                      <ShieldCheck size={15} weight="fill" className="text-emerald-600" />
                      <span>READY_FOR_DEV_STORE — Credenciales de App Activas</span>
                    </p>
                    <p className="text-emerald-700">
                      Ingrese el subdominio de su Development Store (ej. <code className="bg-white/70 px-1 py-0.5 rounded">mitienda-dev.myshopify.com</code>) y pulse conectar para autorizar vía OAuth oficial.
                    </p>
                  </div>
                )}

                <form onSubmit={handleConnect} className="space-y-3">
                  <div>
                    <label className="block font-semibold text-hi mb-1">
                      Dominio de tu tienda (.myshopify.com)
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-lo">
                        <Storefront size={16} />
                      </div>
                      <input
                        type="text"
                        value={shopDomainInput}
                        onChange={(e) => {
                          setShopDomainInput(e.target.value);
                          if (domainError) setDomainError('');
                        }}
                        placeholder="ejemplo.myshopify.com"
                        className={`w-full pl-9 pr-3 py-2 rounded-xl bg-app border text-xs text-hi placeholder-lo/50 focus:outline-none focus:ring-2 focus:ring-brand/30 transition-all ${
                          domainError ? 'border-red-500' : 'border-line focus:border-brand'
                        }`}
                      />
                    </div>
                    {domainError && (
                      <p className="text-2xs text-red-600 font-medium mt-1 flex items-center gap-1">
                        <Warning size={13} weight="fill" />
                        {domainError}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={isConnecting}
                    className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    {isConnecting ? (
                      <>
                        <CircleNotch size={16} className="animate-spin" />
                        Conectando con Shopify...
                      </>
                    ) : (
                      'Conectar tienda con OAuth'
                    )}
                  </button>
                </form>

                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-blue-50/60 border border-blue-100 text-blue-900 text-2xs">
                  <ShieldCheck size={18} className="text-brand shrink-0 mt-0.5" weight="fill" />
                  <p>
                    Velion utiliza el flujo seguro OAuth oficial de Shopify. Nunca almacenamos tus contraseñas ni claves API privadas.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Columna Derecha: Configuración Comercial */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card rounded-2xl border border-line p-6 shadow-sm">
            <h2 className="text-sm font-bold text-hi border-b border-line pb-3 mb-5">
              Configuración de Catálogo e Inventario
            </h2>

            {!isConnected ? (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-3 opacity-60">
                <Storefront size={40} className="text-muted" weight="duotone" />
                <p className="text-sm font-semibold text-hi">Conexión requerida</p>
                <p className="text-xs text-lo max-w-sm">
                  Vincula tu tienda de Shopify primero para poder configurar las fuentes de catálogo, precios e inventario.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSaveSettings} className="space-y-6">
                {/* Modo de Catálogo */}
                <div>
                  <label className="block text-xs font-bold text-hi mb-1">
                    Modo de Catálogo Comercial
                  </label>
                  <p className="text-2xs text-lo mb-3 leading-relaxed">
                    Define qué productos puede consultar y ofrecer el agente de IA a los clientes de WhatsApp.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      {
                        value: 'VELION_ONLY',
                        title: 'Solo Velion',
                        desc: 'Únicamente productos cargados en el inventario local.',
                      },
                      {
                        value: 'SHOPIFY_ONLY',
                        title: 'Solo Shopify',
                        desc: 'Únicamente productos sincronizados desde Shopify.',
                      },
                      {
                        value: 'COMBINED',
                        title: 'Catálogo Combinado',
                        desc: 'Permite ofrecer tanto productos locales como de Shopify.',
                      },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className={`flex flex-col p-3.5 rounded-xl border-2 text-left cursor-pointer transition-all ${
                          catalogSettings.catalogMode === opt.value
                            ? 'border-brand bg-brand/5 shadow-2xs'
                            : 'border-line bg-app hover:border-brand/40'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-bold text-hi">{opt.title}</span>
                          <input
                            type="radio"
                            name="catalogMode"
                            value={opt.value}
                            checked={catalogSettings.catalogMode === opt.value}
                            onChange={(e) =>
                              setCatalogSettings({
                                ...catalogSettings,
                                catalogMode: e.target.value,
                              })
                            }
                            className="text-brand focus:ring-brand"
                          />
                        </div>
                        <span className="text-2xs text-lo leading-normal">{opt.desc}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Origen de Precios */}
                <div className="pt-4 border-t border-line">
                  <label className="block text-xs font-bold text-hi mb-1">
                    Origen de Precios
                  </label>
                  <p className="text-2xs text-lo mb-3 leading-relaxed">
                    Determina qué precio toma prioridad al cotizar o confirmar un pedido.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      {
                        value: 'SHOPIFY',
                        title: 'Precios de Shopify',
                        desc: 'Usa los precios y variantes configurados en tu tienda Shopify.',
                      },
                      {
                        value: 'VELION',
                        title: 'Precios de Velion',
                        desc: 'Usa los precios base y promociones locales del panel de Velion.',
                      },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className={`flex flex-col p-3.5 rounded-xl border-2 text-left cursor-pointer transition-all ${
                          catalogSettings.priceSource === opt.value
                            ? 'border-brand bg-brand/5 shadow-2xs'
                            : 'border-line bg-app hover:border-brand/40'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-bold text-hi">{opt.title}</span>
                          <input
                            type="radio"
                            name="priceSource"
                            value={opt.value}
                            checked={catalogSettings.priceSource === opt.value}
                            onChange={(e) =>
                              setCatalogSettings({
                                ...catalogSettings,
                                priceSource: e.target.value,
                              })
                            }
                            className="text-brand focus:ring-brand"
                          />
                        </div>
                        <span className="text-2xs text-lo leading-normal">{opt.desc}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Origen de Stock */}
                <div className="pt-4 border-t border-line">
                  <label className="block text-xs font-bold text-hi mb-1">
                    Origen de Stock e Inventario
                  </label>
                  <p className="text-2xs text-lo mb-3 leading-relaxed">
                    Controla si el stock disponible se verifica contra Shopify o contra el catálogo interno.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      {
                        value: 'SHOPIFY',
                        title: 'Stock de Shopify',
                        desc: 'Verifica la disponibilidad en tiempo real con el inventario de Shopify.',
                      },
                      {
                        value: 'VELION',
                        title: 'Stock de Velion',
                        desc: 'Verifica la disponibilidad mediante el estado local de Velion.',
                      },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className={`flex flex-col p-3.5 rounded-xl border-2 text-left cursor-pointer transition-all ${
                          catalogSettings.stockSource === opt.value
                            ? 'border-brand bg-brand/5 shadow-2xs'
                            : 'border-line bg-app hover:border-brand/40'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-bold text-hi">{opt.title}</span>
                          <input
                            type="radio"
                            name="stockSource"
                            value={opt.value}
                            checked={catalogSettings.stockSource === opt.value}
                            onChange={(e) =>
                              setCatalogSettings({
                                ...catalogSettings,
                                stockSource: e.target.value,
                              })
                            }
                            className="text-brand focus:ring-brand"
                          />
                        </div>
                        <span className="text-2xs text-lo leading-normal">{opt.desc}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Botón Guardar */}
                <div className="pt-4 border-t border-line flex justify-end">
                  <button
                    type="submit"
                    disabled={isSavingSettings}
                    className="inline-flex items-center gap-2 py-2.5 px-6 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    {isSavingSettings ? (
                      <>
                        <CircleNotch size={16} className="animate-spin" />
                        Guardando...
                      </>
                    ) : (
                      <>
                        <FloppyDisk size={16} weight="bold" />
                        Guardar Configuración
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Modal Confirmación de Desconexión */}
      <ConfirmModal
        isOpen={disconnectModalOpen}
        onClose={() => setDisconnectModalOpen(false)}
        onConfirm={handleConfirmDisconnect}
        title="¿Desconectar tienda Shopify?"
        message="Velion dejará de usar esta conexión y eliminará las credenciales locales asociadas. Esto no desinstala automáticamente la aplicación desde tu panel de Shopify."
        confirmText="Desconectar"
        cancelText="Cancelar"
        isLoading={isDisconnecting}
      />
    </div>
  );
}
