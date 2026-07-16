import { useState, useEffect, useRef } from 'react';
import {
  Send,
  Loader2,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  RefreshCw,
  ImagePlus,
  X,
  Image
} from 'lucide-react';
import * as campaignService from '../services/campaignService';

const STATUS_STYLES = {
  pending: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200',
  running: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 animate-pulse',
  completed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  failed: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [toast, setToast] = useState(null);

  // Form states
  const [name, setName] = useState('');
  const [baseMessage, setBaseMessage] = useState('');
  const [delayMin, setDelayMin] = useState(10);
  const [delayMax, setDelayMax] = useState(30);
  const [mediaFile, setMediaFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fileInputRef = useRef(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadCampaigns = async () => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const data = await campaignService.getCampaigns();
      setCampaigns(data || []);
    } catch {
      setErrorMsg('No se pudo conectar con el motor de campañas.');
      showToast('Error al recuperar historial de difusiones.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCampaigns();

    // Auto-polling silencioso cada 10 segundos para actualizar estado en vivo
    const interval = setInterval(async () => {
      try {
        const data = await campaignService.getCampaigns();
        setCampaigns(data || []);
      } catch (err) {
        console.error('Error en auto-polling:', err);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  const handleMediaChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setMediaFile({
        file,
        base64: reader.result,
        name: file.name
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !baseMessage.trim()) return;

    if (delayMin < 10) {
      showToast('El retraso mínimo no puede ser menor a 10 segundos.', 'error');
      return;
    }
    if (delayMax < 15) {
      showToast('El retraso máximo no puede ser menor a 15 segundos.', 'error');
      return;
    }
    if (delayMin >= delayMax) {
      showToast('El retraso máximo debe ser mayor que el mínimo.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      await campaignService.launchCampaign({
        name: name.trim(),
        baseMessage: baseMessage.trim(),
        delayMin: Number(delayMin),
        delayMax: Number(delayMax),
        audience: 'all',
        media: mediaFile ? mediaFile.base64 : null
      });

      showToast('Campaña encolada y lanzada con éxito en segundo plano.');
      setName('');
      setBaseMessage('');
      setDelayMin(10);
      setDelayMax(30);
      setMediaFile(null);
      loadCampaigns();
    } catch {
      showToast('Error al lanzar la campaña masiva en el servidor.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="campaigns-heading" className="space-y-6">
      {/* Header */}
      <div>
        <h1 id="campaigns-heading" className="text-xl font-bold text-hi">
          Campañas y Difusiones
        </h1>
        <p className="text-sm text-lo mt-0.5">
          Envía mensajes masivos con tecnología anti-bloqueo y spintax generada por IA.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* SECCIÓN A: Formulario de Nueva Campaña */}
        <div className="bg-card border border-line rounded-lg shadow-sm p-6 flex flex-col gap-5 h-fit">
          <h2 className="text-base font-bold text-hi">Nueva Campaña</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-mid mb-1">Nombre de la Campaña</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="ej. Lanzamiento Colección Otoño"
                className="w-full px-3.5 py-2.5 rounded-md border border-line bg-app text-sm text-hi placeholder:text-muted focus:outline-none focus:border-brand"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-mid mb-1">Mensaje Base</label>
              <textarea
                value={baseMessage}
                onChange={e => setBaseMessage(e.target.value)}
                placeholder="ej. Hola {Nombre}, te escribimos para ofrecerte..."
                rows={5}
                className="w-full px-3.5 py-2.5 rounded-md border border-line bg-app text-sm text-hi placeholder:text-muted focus:outline-none focus:border-brand resize-none leading-relaxed"
                required
              />
              <div className="text-2xs text-lo mt-1.5 leading-normal flex items-start gap-1">
                <HelpCircle size={12} className="flex-shrink-0 mt-0.5 text-brand" />
                <span>Escribe tu mensaje. La IA reescribirá el texto individualmente para cada contacto de forma natural y conversacional.</span>
              </div>
            </div>

            {/* Selector de Imagen Opcional */}
            <div>
              <label className="block text-xs font-semibold text-mid mb-1">Adjuntar Imagen (opcional)</label>
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleMediaChange}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-3.5 py-2.5 rounded-md border border-line bg-app text-xs font-semibold text-hi hover:border-line-strong hover:bg-app-hover transition-all cursor-pointer"
                >
                  <ImagePlus size={16} className="text-brand" />
                  <span>Seleccionar Imagen</span>
                </button>
                {mediaFile && (
                  <div className="flex items-center gap-2 bg-app px-2.5 py-1.5 rounded border border-line text-xs max-w-[180px] min-w-0">
                    <img src={mediaFile.base64} alt="Adjunto" className="w-6 h-6 object-cover rounded border border-line" />
                    <span className="truncate flex-1 text-hi font-mono text-[10px]">{mediaFile.name}</span>
                    <button
                      type="button"
                      onClick={() => setMediaFile(null)}
                      className="text-lo hover:text-hi p-0.5 cursor-pointer"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-mid mb-1">Retraso Mínimo (seg)</label>
                <input
                  type="number"
                  min="10"
                  max="120"
                  value={delayMin}
                  onChange={e => setDelayMin(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-md border border-line bg-app text-sm text-hi placeholder:text-muted focus:outline-none focus:border-brand font-mono"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-mid mb-1">Retraso Máximo (seg)</label>
                <input
                  type="number"
                  min="15"
                  max="300"
                  value={delayMax}
                  onChange={e => setDelayMax(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-md border border-line bg-app text-sm text-hi placeholder:text-muted focus:outline-none focus:border-brand font-mono"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !name.trim() || !baseMessage.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-brand hover:bg-brand-hover text-white text-sm font-semibold shadow-card transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Procesando...</span>
                </>
              ) : (
                <>
                  <Send size={16} />
                  <span>Lanzar Campaña</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* SECCIÓN B: Historial de Campañas */}
        <div className="lg:col-span-2 bg-card border border-line rounded-lg shadow-sm overflow-hidden flex flex-col min-h-[400px]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-line bg-card">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-hi">Historial de Campañas</span>
              <span className="text-2xs text-muted font-mono bg-app px-2 py-0.5 rounded-full font-bold">
                {campaigns.length}
              </span>
            </div>
            <button
              onClick={loadCampaigns}
              className="p-1.5 rounded-md hover:bg-app text-lo hover:text-hi transition-colors cursor-pointer"
              title="Refrescar lista"
            >
              <RefreshCw size={15} />
            </button>
          </div>

          <div className="flex-1 overflow-x-auto">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-3">
                <Loader2 size={32} className="animate-spin text-brand" />
                <p className="text-xs text-lo">Cargando historial de campañas...</p>
              </div>
            ) : errorMsg ? (
              <div className="flex flex-col items-center justify-center p-8 text-center space-y-3 mt-10">
                <AlertCircle size={32} className="text-danger" />
                <p className="text-sm font-semibold text-hi">{errorMsg}</p>
                <button
                  onClick={loadCampaigns}
                  className="px-3 py-1.5 text-xs font-semibold bg-brand text-white hover:bg-brand-hover rounded shadow cursor-pointer"
                >
                  Reintentar
                </button>
              </div>
            ) : campaigns.length > 0 ? (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-line bg-app">
                    <th className="px-5 py-3.5 text-left text-2xs font-semibold text-lo uppercase tracking-wider">Campaña</th>
                    <th className="px-5 py-3.5 text-left text-2xs font-semibold text-lo uppercase tracking-wider">Estado</th>
                    <th className="px-5 py-3.5 text-left text-2xs font-semibold text-lo uppercase tracking-wider">Retraso</th>
                    <th className="px-5 py-3.5 text-left text-2xs font-semibold text-lo uppercase tracking-wider">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => {
                    const statusStyle = STATUS_STYLES[c.status] || 'bg-gray-100 text-lo ring-1 ring-line';
                    const statusLabel =
                      c.status === 'pending' ? 'Pendiente' :
                      c.status === 'running' ? 'Enviando' :
                      c.status === 'completed' ? 'Completado' :
                      c.status === 'failed' ? 'Fallido' : c.status;

                    return (
                      <tr key={c.id} className="border-b border-line hover:bg-app/40 transition-colors duration-fast">
                        <td className="px-5 py-4">
                          <p className="text-sm font-semibold text-hi">{c.name}</p>
                          <p className="text-xs text-lo truncate max-w-xs mt-0.5 font-mono">{c.baseMessage}</p>
                          {c.media && (
                            <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold text-brand">
                              <Image size={11} />
                              <span>Con Imagen</span>
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-2xs font-semibold ${statusStyle}`}>
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-xs font-mono text-hi">
                          {c.delayMin}s - {c.delayMax}s
                        </td>
                        <td className="px-5 py-4 text-xs text-lo">
                          {new Date(c.createdAt).toLocaleDateString('es-ES', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center px-6">
                <Send size={32} className="text-muted mb-3" />
                <p className="text-sm font-semibold text-hi">Sin campañas registradas</p>
                <p className="text-xs text-lo mt-1">Crea y programa tu primera campaña masiva para ver el historial.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toasts */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-card-md text-sm font-medium
            ${toast.type === 'success'
              ? 'bg-card border-emerald-200 text-emerald-700'
              : 'bg-card border-red-200 text-danger'
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
    </section>
  );
}
