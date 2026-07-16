import { useState, useEffect } from 'react';
import {
  Gear,
  WifiHigh,
  Brain,
  Bell,
  CheckCircle,
  X,
  Play,
  FloppyDisk,
  Warning,
  Key,
  Globe,
  Envelope,
  LinkSimple,
  WarningCircle,
} from '@phosphor-icons/react';
import * as configService from '../services/configService';

/* ─── Skeleton de Carga Simple ─── */
function SettingsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-10 bg-app border border-line rounded-lg w-full" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[1, 2].map(n => (
          <div key={n} className="bg-card border border-line rounded-lg p-6 space-y-4">
            <div className="h-4 bg-line rounded w-1/3" />
            <div className="space-y-2">
              <div className="h-3 bg-line rounded w-1/4" />
              <div className="h-9 bg-line rounded w-full" />
            </div>
            <div className="space-y-2">
              <div className="h-3 bg-line rounded w-1/4" />
              <div className="h-9 bg-line rounded w-full" />
            </div>
            <div className="h-8 bg-line rounded w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Componente Principal ─── */
export default function AdminConfiguracionPage() {
  const [activeTab, setActiveTab] = useState('gateways');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Form states - Gateways
  const [evoUrl, setEvoUrl] = useState('');
  const [evoApiKey, setEvoApiKey] = useState('');
  const [wahaUrl, setWahaUrl] = useState('');
  const [wahaApiKey, setWahaApiKey] = useState('');
  const [wahaIsPrimary, setWahaIsPrimary] = useState(false);

  // Form states - AI
  const [geminiKey, setGeminiKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(
    'Eres un asistente de atención al cliente educado, eficiente y servicial.'
  );

  // Form states - System & Alerts
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [errorWebhook, setErrorWebhook] = useState('');

  // Loaders de Test
  const [testingEvo, setTestingEvo] = useState(false);
  const [testingWaha, setTestingWaha] = useState(false);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadConfig = async () => {
    setIsLoading(true);
    try {
      const data = await configService.getGlobalConfig();
      if (data) {
        if (data.evoUrl) setEvoUrl(data.evoUrl);
        if (data.evoApiKey) setEvoApiKey(data.evoApiKey);
        if (data.wahaUrl) setWahaUrl(data.wahaUrl);
        if (data.wahaApiKey) setWahaApiKey(data.wahaApiKey);
        if (data.wahaIsPrimary !== undefined) setWahaIsPrimary(data.wahaIsPrimary);
        if (data.geminiKey) setGeminiKey(data.geminiKey);
        if (data.groqKey) setGroqKey(data.groqKey);
        if (data.systemPrompt) setSystemPrompt(data.systemPrompt);
        if (data.smtpHost) setSmtpHost(data.smtpHost);
        if (data.smtpPort) setSmtpPort(data.smtpPort);
        if (data.smtpUser) setSmtpUser(data.smtpUser);
        if (data.smtpPassword) setSmtpPassword(data.smtpPassword);
        if (data.errorWebhook) setErrorWebhook(data.errorWebhook);
      }
    } catch {
      // Failsafe: la BD está caída, los campos quedan vacíos — el usuario no verá credenciales falsas
      showToast('No se pudo conectar con el servidor. Por favor reinicia el backend.', 'warning');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    setIsSaving(true);

    const payload = {
      evoUrl,
      evoApiKey,
      wahaUrl,
      wahaApiKey,
      wahaIsPrimary,
      geminiKey,
      groqKey,
      systemPrompt,
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPassword,
      errorWebhook,
    };

    try {
      await configService.saveGlobalConfig(payload);
      showToast('Ajustes actualizados correctamente');
    } catch {
      showToast('Error al guardar la configuración en el servidor.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async (gateway) => {
    const gatewayKey = gateway === 'Evolution API' ? 'evolution' : 'waha';
    const setTesting = gateway === 'Evolution API' ? setTestingEvo : setTestingWaha;
    setTesting(true);
    const token = localStorage.getItem('sa_token');

    try {
      const response = await fetch(
        `http://localhost:3000/api/admin/health/gateway/${gatewayKey}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const result = await response.json();

      if (result.ok) {
        showToast(`${gateway} respondiendo correctamente.`);
      } else {
        showToast(`${result.message || `${gateway} no responde.`}`, 'error');
      }
    } catch {
      showToast(`Sin conexión con ${gateway} — verifica la URL configurada.`, 'error');
    } finally {
      setTesting(false);
    }
  };

  return (
    <section aria-labelledby="config-heading" className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 id="config-heading" className="text-xl font-bold text-hi flex items-center gap-2">
            <Gear size={24} className="text-brand" />
            Configuración del Servidor
          </h1>
          <p className="text-sm text-lo mt-0.5">
            Ajustes de infraestructura global, pasarelas de WhatsApp, modelos de IA y alertas de sistema.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving || isLoading}
          className="
            flex items-center gap-2 px-4 py-2.5 rounded-md self-start sm:self-auto
            bg-brand text-white text-sm font-semibold
            hover:bg-brand-hover shadow shadow-card transition-all duration-fast cursor-pointer disabled:opacity-50
          "
        >
          <FloppyDisk size={18} weight="bold" aria-hidden="true" />
          <span>{isSaving ? 'Guardando...' : 'Guardar Ajustes'}</span>
        </button>
      </div>

      {/* Internal Tabs Navigation */}
      <div className="border-b border-line">
        <nav className="flex space-x-6" aria-label="Secciones de configuración">
          {[
            { id: 'gateways', label: 'Gateways de WhatsApp', Icon: WifiHigh },
            { id: 'ai', label: 'Inteligencia Artificial', Icon: Brain },
            { id: 'system', label: 'Sistema & Alertas', Icon: Bell },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 pb-4 text-sm font-medium border-b-2 transition-all duration-fast cursor-pointer
                  ${isActive
                    ? 'border-brand text-brand font-semibold'
                    : 'border-transparent text-lo hover:text-hi hover:border-line-strong'
                  }
                `}
                aria-current={isActive ? 'page' : undefined}
              >
                <tab.Icon size={18} weight={isActive ? 'bold' : 'regular'} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {isLoading ? (
        <SettingsSkeleton />
      ) : (
        <form onSubmit={handleSave} className="space-y-6 pt-2">
          {/* PESTAÑA 1: GATEWAYS */}
          {activeTab === 'gateways' && (
            <div className="space-y-6">
              <div className="bg-brand-light border border-brand/20 p-4 rounded-lg">
                <p className="text-xs text-brand font-medium">
                  Credenciales de conexión para los motores detrás del envío de mensajes a través del protocolo oficial y no oficial.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Evolution API */}
                <div className="bg-card border border-line rounded-lg shadow-card p-6 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-line">
                    <h3 className="text-sm font-bold text-hi flex items-center gap-2">
                      <WifiHigh size={18} className="text-brand" />
                      Evolution API (Principal)
                    </h3>
                    <span className="px-2 py-0.5 rounded bg-emerald-50 text-success text-[10px] font-bold uppercase tracking-wider ring-1 ring-emerald-200">
                      Soporte Nativo
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label htmlFor="evo-url" className="block text-xs font-semibold text-hi mb-1">Endpoint URL</label>
                      <div className="relative">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={14} />
                        <input
                          id="evo-url"
                          type="url"
                          value={evoUrl}
                          onChange={(e) => setEvoUrl(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 text-sm bg-card border border-line rounded-md focus:outline-none focus:border-brand font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="evo-key" className="block text-xs font-semibold text-hi mb-1">Global API Key</label>
                      <div className="relative">
                        <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={14} />
                        <input
                          id="evo-key"
                          type="password"
                          value={evoApiKey}
                          onChange={(e) => setEvoApiKey(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 text-sm bg-card border border-line rounded-md focus:outline-none focus:border-brand font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleTestConnection('Evolution API')}
                    disabled={testingEvo}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-mid bg-app border border-line hover:bg-line rounded-md transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Play size={12} weight="bold" />
                    {testingEvo ? 'Conectando...' : 'Test de Conexión'}
                  </button>
                </div>

                {/* WAHA */}
                <div className="bg-card border border-line rounded-lg shadow-card p-6 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-line">
                    <h3 className="text-sm font-bold text-hi flex items-center gap-2">
                      <WifiHigh size={18} className="text-lo" />
                      WAHA (Respaldo)
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-lo font-semibold">Motor principal</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={wahaIsPrimary}
                        onClick={() => setWahaIsPrimary(!wahaIsPrimary)}
                        className={`
                          relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
                          transition-colors duration-200 focus:outline-none
                          ${wahaIsPrimary ? 'bg-brand' : 'bg-gray-200'}
                        `}
                      >
                        <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow transition duration-200 ${wahaIsPrimary ? 'translate-x-3' : 'translate-x-0'}`} />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label htmlFor="waha-url" className="block text-xs font-semibold text-hi mb-1">Endpoint URL</label>
                      <div className="relative">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={14} />
                        <input
                          id="waha-url"
                          type="url"
                          value={wahaUrl}
                          onChange={(e) => setWahaUrl(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 text-sm bg-card border border-line rounded-md focus:outline-none focus:border-brand font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="waha-key" className="block text-xs font-semibold text-hi mb-1">Global API Key</label>
                      <div className="relative">
                        <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={14} />
                        <input
                          id="waha-key"
                          type="password"
                          value={wahaApiKey}
                          onChange={(e) => setWahaApiKey(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 text-sm bg-card border border-line rounded-md focus:outline-none focus:border-brand font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleTestConnection('WAHA API')}
                    disabled={testingWaha}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-mid bg-app border border-line hover:bg-line rounded-md transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Play size={12} weight="bold" />
                    {testingWaha ? 'Conectando...' : 'Test de Conexión'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* PESTAÑA 2: INTELIGENCIA ARTIFICIAL */}
          {activeTab === 'ai' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-6">
                {/* Google Gemini */}
                <div className="bg-card border border-line rounded-lg shadow-card p-6 space-y-4">
                  <h3 className="text-sm font-bold text-hi flex items-center gap-2 pb-3 border-b border-line">
                    <Brain size={18} className="text-brand" />
                    Google Gemini (Motor Principal)
                  </h3>
                  <div>
                    <label htmlFor="gemini-key" className="block text-xs font-semibold text-hi mb-1">Clave API Maestra</label>
                    <div className="relative">
                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={14} />
                      <input
                        id="gemini-key"
                        type="password"
                        value={geminiKey}
                        onChange={(e) => setGeminiKey(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-sm bg-card border border-line rounded-md focus:outline-none focus:border-brand font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Groq */}
                <div className="bg-card border border-line rounded-lg shadow-card p-6 space-y-4">
                  <h3 className="text-sm font-bold text-hi flex items-center gap-2 pb-3 border-b border-line">
                    <Brain size={18} className="text-purple-600" />
                    Groq (Llama-3 Failsafe)
                  </h3>
                  <div>
                    <label htmlFor="groq-key" className="block text-xs font-semibold text-hi mb-1">Clave API de Respaldo</label>
                    <div className="relative">
                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={14} />
                      <input
                        id="groq-key"
                        type="password"
                        value={groqKey}
                        onChange={(e) => setGroqKey(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-sm bg-card border border-line rounded-md focus:outline-none focus:border-brand font-mono"
                      />
                    </div>
                  </div>
                  <div className="flex items-start gap-2 bg-purple-50/50 border border-purple-100 p-3 rounded-lg text-xs text-purple-700">
                    <Warning size={14} className="mt-0.5 flex-shrink-0" />
                    <p>Este modelo entrará en acción automáticamente si Gemini agota su cuota o responde con un error.</p>
                  </div>
                </div>
              </div>

              {/* Prompt Global */}
              <div className="bg-card border border-line rounded-lg shadow-card p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-hi flex items-center gap-2 pb-3 border-b border-line mb-4 font-semibold">
                    Prompt de Sistema Global
                  </h3>
                  <label htmlFor="system-prompt" className="block text-xs font-semibold text-lo mb-2">
                    Instrucciones base e identidad compartida para la IA en todos los tenants:
                  </label>
                  <textarea
                    id="system-prompt"
                    rows={8}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    className="w-full p-3 text-xs bg-card border border-line rounded-md focus:outline-none focus:border-brand leading-relaxed"
                  />
                </div>
                <p className="text-[10px] text-muted mt-4">
                  *Los inquilinos pueden extender este prompt, pero no omitir sus directrices de seguridad maestras.
                </p>
              </div>
            </div>
          )}

          {/* PESTAÑA 3: SISTEMA & ALERTAS */}
          {activeTab === 'system' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* SMTP */}
              <div className="bg-card border border-line rounded-lg shadow-card p-6 space-y-4">
                <h3 className="text-sm font-bold text-hi flex items-center gap-2 pb-3 border-b border-line">
                  <Envelope size={18} className="text-brand" />
                  Configuración del Servidor de Correo (SMTP)
                </h3>
                <p className="text-xs text-lo font-medium">
                  Utilizado para el envío automatizado de correos de bienvenida, alertas de cuota y restablecimientos de contraseña.
                </p>

                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label htmlFor="smtp-host" className="block text-xs font-semibold text-hi mb-1">SMTP Host</label>
                    <input
                      id="smtp-host"
                      type="text"
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-card border border-line rounded-md focus:outline-none focus:border-brand font-mono"
                    />
                  </div>
                  <div>
                    <label htmlFor="smtp-port" className="block text-xs font-semibold text-hi mb-1">Puerto</label>
                    <input
                      id="smtp-port"
                      type="number"
                      value={smtpPort}
                      onChange={(e) => setSmtpPort(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm bg-card border border-line rounded-md focus:outline-none focus:border-brand font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="smtp-user" className="block text-xs font-semibold text-hi mb-1">Usuario SMTP</label>
                    <input
                      id="smtp-user"
                      type="text"
                      value={smtpUser}
                      onChange={(e) => setSmtpUser(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-card border border-line rounded-md focus:outline-none focus:border-brand font-mono"
                    />
                  </div>
                  <div>
                    <label htmlFor="smtp-password" className="block text-xs font-semibold text-hi mb-1">Contraseña SMTP</label>
                    <input
                      id="smtp-password"
                      type="password"
                      value={smtpPassword}
                      onChange={(e) => setSmtpPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3 py-2 text-sm bg-card border border-line rounded-md focus:outline-none focus:border-brand font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Webhooks */}
              <div className="bg-card border border-line rounded-lg shadow-card p-6 space-y-4">
                <h3 className="text-sm font-bold text-hi flex items-center gap-2 pb-3 border-b border-line">
                  <Bell size={18} className="text-amber-600" />
                  Webhook Global de Errores y Alertas
                </h3>
                <p className="text-xs text-lo font-medium">
                  Especifica un endpoint HTTP de destino (como Slack o Discord) para recibir informes críticos de caídas de bots y cuotas excedidas.
                </p>

                <div>
                  <label htmlFor="error-webhook" className="block text-xs font-semibold text-hi mb-1">Webhook URL</label>
                  <div className="relative">
                    <LinkSimple className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={14} />
                    <input
                      id="error-webhook"
                      type="url"
                      value={errorWebhook}
                      onChange={(e) => setErrorWebhook(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm bg-card border border-line rounded-md focus:outline-none focus:border-brand font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </form>
      )}

      {/* Toasts */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-card-md text-sm font-medium
            ${toast.type === 'success'
              ? 'bg-card border-emerald-200 text-emerald-700'
              : 'bg-card border-amber-200 text-amber-700'
            }
          `}
          role="status"
          aria-live="polite"
        >
          {toast.type === 'success' ? (
            <CheckCircle size={18} weight="bold" className="text-success flex-shrink-0" />
          ) : (
            <WarningCircle size={18} weight="bold" className="text-warning flex-shrink-0" />
          )}
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-1 text-muted hover:text-hi cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}
    </section>
  );
}
