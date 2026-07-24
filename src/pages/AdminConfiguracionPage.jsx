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
import { useUnsavedChanges } from '../context/UnsavedChangesContext';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

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
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const { setIsDirty } = useUnsavedChanges();
  const setIsFormDirty = setIsDirty;

  // Form states - AI & System
  const [systemPrompt, setSystemPrompt] = useState(
    'Eres un asistente de atención al cliente educado, eficiente y servicial.'
  );
  const [errorWebhook, setErrorWebhook] = useState('');

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadConfig = async () => {
    setIsLoading(true);
    try {
      const data = await configService.getGlobalConfig();
      if (data) {
        if (data.systemPrompt) setSystemPrompt(data.systemPrompt);
        if (data.errorWebhook) setErrorWebhook(data.errorWebhook);
      }
      setTimeout(() => setIsFormDirty(false), 200);
    } catch {
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
      systemPrompt,
      errorWebhook,
    };

    try {
      await configService.saveGlobalConfig(payload);
      showToast('Ajustes actualizados correctamente');
      setIsFormDirty(false);
    } catch {
      showToast('Error al guardar la configuración en el servidor.', 'error');
    } finally {
      setIsSaving(false);
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
            Ajustes de infraestructura global y prompt de sistema maestro para el bot.
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

      {/* Tab Content */}
      {isLoading ? (
        <SettingsSkeleton />
      ) : (
        <form onSubmit={handleSave} onChange={() => setIsFormDirty(true)} className="space-y-6 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Prompt Global de Sistema */}
            <div className="md:col-span-2 bg-card border border-line rounded-lg shadow-card p-6 flex flex-col justify-between space-y-4">
              <div>
                <h3 className="text-sm font-bold text-hi flex items-center gap-2 pb-3 border-b border-line mb-4 font-semibold">
                  <Brain size={18} className="text-brand" />
                  Prompt de Sistema Global (Maestro)
                </h3>
                <label htmlFor="system-prompt" className="block text-xs font-semibold text-lo mb-2">
                  Instrucciones base e identidad compartida para la IA en todos los tenants:
                </label>
                <textarea
                  id="system-prompt"
                  rows={10}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  className="w-full p-3 text-xs bg-card border border-line rounded-md focus:outline-none focus:border-brand leading-relaxed"
                />
              </div>
              <p className="text-[10px] text-muted leading-relaxed">
                *Los inquilinos pueden extender este prompt mediante su propio Cerebro de Bot, pero no omitir las directrices de seguridad maestras definidas aquí.
              </p>
            </div>

            {/* Webhooks y Alertas */}
            <div className="bg-card border border-line rounded-lg shadow-card p-6 space-y-4">
              <h3 className="text-sm font-bold text-hi flex items-center gap-2 pb-3 border-b border-line">
                <Bell size={18} className="text-amber-600" />
                Alertas y Notificaciones
              </h3>
              <p className="text-xs text-lo leading-relaxed font-medium">
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
                    placeholder="https://discord.com/api/webhooks/..."
                    className="w-full pl-9 pr-3 py-2 text-sm bg-card border border-line rounded-md focus:outline-none focus:border-brand font-mono"
                  />
                </div>
              </div>
            </div>

          </div>
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
