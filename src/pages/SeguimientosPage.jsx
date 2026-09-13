import { useState, useEffect, useCallback } from 'react';
import {
  Clock,
  CheckCircle2,
  RefreshCw,
  X,
  XCircle,
  Sliders,
  TrendingUp,
  DollarSign,
  MessageSquare,
  Loader2,
  Info,
  Calendar,
  AlertTriangle
} from 'lucide-react';
import * as followUpService from '../services/followUpService';
import Modal from '../components/ui/Modal';

const STATUS_BADGES = {
  SCHEDULED: {
    label: 'Programado',
    className: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-800/50',
    icon: Clock
  },
  WAITING_NEXT: {
    label: 'Esperando Sig. Intento',
    className: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-800/50',
    icon: Clock
  },
  PROCESSING: {
    label: 'En Preparación/Envío',
    className: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200 animate-pulse dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800/50',
    icon: RefreshCw
  },
  NEUTRALIZED_INBOUND: {
    label: 'Respuesta Recibida (Inbound)',
    className: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:ring-purple-800/50',
    icon: MessageSquare
  },
  RECOVERED: {
    label: 'Recuperado',
    className: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50',
    icon: CheckCircle2
  },
  EXHAUSTED: {
    label: 'Completado (Sin respuesta)',
    className: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
    icon: CheckCircle2
  },
  CANCELLED: {
    label: 'Cancelado',
    className: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-800/50',
    icon: XCircle
  }
};

const STAGE_LABELS = {
  PRODUCT_SELECTED: 'Producto Seleccionado',
  DETAILS_PROVIDED: 'Detalles Brindados',
  SHIPPING_COORDINATED: 'Envío Coordinado',
  PAYMENT_PENDING: 'Pago Pendiente'
};

const ATTEMPT_STATUS_BADGES = {
  PENDING: { label: 'Pendiente', color: 'text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-300' },
  PROCESSING: { label: 'Procesando', color: 'text-amber-700 bg-amber-100 dark:bg-amber-900/50 dark:text-amber-300' },
  SENT: { label: 'Enviado (Provider OK)', color: 'text-emerald-700 bg-emerald-100 dark:bg-emerald-900/50 dark:text-emerald-300' },
  SKIPPED_POLICY: { label: 'Omitido (Política de Canal)', color: 'text-blue-700 bg-blue-100 dark:bg-blue-900/50 dark:text-blue-300' },
  UNKNOWN_DELIVERY: { label: 'Envío Ambiguo', color: 'text-yellow-700 bg-yellow-100 dark:bg-yellow-900/50 dark:text-yellow-300' },
  FAILED_SAFE: { label: 'Fallido Seguro', color: 'text-rose-700 bg-rose-100 dark:bg-rose-900/50 dark:text-rose-300' }
};

const COMMON_TIMEZONES = [
  { value: 'America/Lima', label: 'Perú (America/Lima) UTC-5' },
  { value: 'America/Bogota', label: 'Colombia (America/Bogota) UTC-5' },
  { value: 'America/Guayaquil', label: 'Ecuador (America/Guayaquil) UTC-5' },
  { value: 'America/Santiago', label: 'Chile (America/Santiago) UTC-4/UTC-3' },
  { value: 'America/Buenos_Aires', label: 'Argentina (America/Buenos_Aires) UTC-3' },
  { value: 'America/Montevideo', label: 'Uruguay (America/Montevideo) UTC-3' },
  { value: 'America/Asuncion', label: 'Paraguay (America/Asuncion) UTC-4/UTC-3' },
  { value: 'America/La_Paz', label: 'Bolivia (America/La_Paz) UTC-4' },
  { value: 'America/Caracas', label: 'Venezuela (America/Caracas) UTC-4' },
  { value: 'America/Mexico_City', label: 'México (America/Mexico_City) UTC-6' },
  { value: 'America/Panama', label: 'Panamá (America/Panama) UTC-5' },
  { value: 'America/Costa_Rica', label: 'Costa Rica (America/Costa_Rica) UTC-6' },
  { value: 'America/Guatemala', label: 'Guatemala (America/Guatemala) UTC-6' },
  { value: 'America/Santo_Domingo', label: 'Rep. Dominicana (America/Santo_Domingo) UTC-4' },
  { value: 'America/New_York', label: 'EE.UU. Este (America/New_York) UTC-5/UTC-4' },
  { value: 'America/Chicago', label: 'EE.UU. Centro (America/Chicago) UTC-6/UTC-5' },
  { value: 'America/Los_Angeles', label: 'EE.UU. Pacífico (America/Los_Angeles) UTC-8/UTC-7' },
  { value: 'Europe/Madrid', label: 'España (Europe/Madrid) UTC+1/UTC+2' }
];

export default function SeguimientosPage() {
  const [activeTab, setActiveTab] = useState('activos');
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({
    activeCount: 0,
    recoveredCount: 0,
    attributedSalesCount: 0,
    recoveryRatePercent: 0,
    followUpEnabled: false,
    timezone: null
  });
  const [sequences, setSequences] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 });

  // Settings tab state
  const [settingEnabled, setSettingEnabled] = useState(false);
  const [settingTimezone, setSettingTimezone] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState(null);
  const [settingsSuccess, setSettingsSuccess] = useState(false);

  // Cancel Modal state
  const [cancelModalItem, setCancelModalItem] = useState(null);
  const [cancelReason, setCancelReason] = useState('MERCHANT_MANUAL');
  const [cancelling, setCancelling] = useState(false);

  // Detail Modal state
  const [detailModalItem, setDetailModalItem] = useState(null);

  const loadSummary = useCallback(async () => {
    try {
      const res = await followUpService.getFollowUpSummary();
      if (res?.data) {
        setSummary(res.data);
        setSettingEnabled(Boolean(res.data.followUpEnabled));
        setSettingTimezone(res.data.timezone || '');
      }
    } catch (err) {
      console.error('Error loading follow-up summary:', err);
    }
  }, []);

  const loadSequences = useCallback(async (tab = activeTab, page = 1) => {
    if (tab === 'configuracion') return;
    setLoading(true);
    try {
      const res = await followUpService.getFollowUps({ tab, page, limit: 20 });
      if (res?.data) {
        setSequences(res.data);
        if (res.pagination) {
          setPagination(res.pagination);
        }
      }
    } catch (err) {
      console.error('Error loading sequences:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    loadSummary();
    loadSequences(activeTab, 1);
  }, [activeTab, loadSummary, loadSequences]);

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSettingsError(null);
    setSettingsSuccess(false);

    if (settingEnabled && (!settingTimezone || !settingTimezone.trim())) {
      setSettingsError('Para activar los seguimientos es obligatorio seleccionar una zona horaria IANA válida.');
      return;
    }

    setSavingSettings(true);
    try {
      const res = await followUpService.updateFollowUpSettings({
        followUpEnabled: settingEnabled,
        timezone: settingTimezone || null
      });
      if (res?.success) {
        setSettingsSuccess(true);
        loadSummary();
        setTimeout(() => setSettingsSuccess(false), 4000);
      }
    } catch (err) {
      setSettingsError(err.message || 'Error al guardar configuración');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCancelSequence = async () => {
    if (!cancelModalItem) return;
    setCancelling(true);
    try {
      await followUpService.cancelFollowUp(cancelModalItem.id, cancelReason);
      setCancelModalItem(null);
      loadSummary();
      loadSequences(activeTab, pagination.page);
    } catch (err) {
      alert(`No se pudo cancelar el seguimiento: ${err.message}`);
    } finally {
      setCancelling(false);
    }
  };

  const formatDate = (isoString) => {
    if (!isoString) return '—';
    try {
      const date = new Date(isoString);
      return new Intl.DateTimeFormat('es-PE', {
        dateStyle: 'short',
        timeStyle: 'short'
      }).format(date);
    } catch {
      return isoString;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
            <Clock className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
            Seguimientos Automáticos
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Recuperación 1-a-1 de oportunidades comerciales abandonadas con IA contextual y horario de quietud seguro.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              loadSummary();
              loadSequences(activeTab, pagination.page);
            }}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700 transition"
          >
            <RefreshCw className="w-4 h-4" />
            Actualizar
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              En Seguimiento
            </span>
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900 dark:text-white">
              {summary.activeCount}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">oportunidades</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            Secuencias programadas o esperando siguiente intento
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Conversaciones Recuperadas
            </span>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
              <MessageSquare className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
              {summary.recoveredCount}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">inbounds post-envío</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            Clientes que respondieron tras un intento de seguimiento
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Ventas Atribuidas
            </span>
            <div className="p-2 rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-amber-600 dark:text-amber-400">
              {summary.attributedSalesCount}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">órdenes pagadas</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            Pagos confirmados dentro de la ventana de atribución
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Tasa de Recuperación
            </span>
            <div className="p-2 rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-950/50 dark:text-purple-400">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-purple-600 dark:text-purple-400">
              {summary.recoveryRatePercent}%
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            Ratio de recuperación sobre total de envíos completados
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800">
        <nav className="flex space-x-8" aria-label="Tabs">
          <button
            onClick={() => setActiveTab('activos')}
            className={`py-4 px-1 inline-flex items-center gap-2 border-b-2 font-medium text-sm transition ${
              activeTab === 'activos'
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-300'
            }`}
          >
            <Clock className="w-4 h-4" />
            Activos
            {summary.activeCount > 0 && (
              <span className="ml-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300">
                {summary.activeCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('recuperados')}
            className={`py-4 px-1 inline-flex items-center gap-2 border-b-2 font-medium text-sm transition ${
              activeTab === 'recuperados'
                ? 'border-emerald-600 text-emerald-600 dark:border-emerald-400 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-300'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            Recuperados
            {summary.recoveredCount > 0 && (
              <span className="ml-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
                {summary.recoveredCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('historial')}
            className={`py-4 px-1 inline-flex items-center gap-2 border-b-2 font-medium text-sm transition ${
              activeTab === 'historial'
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-300'
            }`}
          >
            <Calendar className="w-4 h-4" />
            Historial
          </button>

          <button
            onClick={() => setActiveTab('configuracion')}
            className={`py-4 px-1 inline-flex items-center gap-2 border-b-2 font-medium text-sm transition ${
              activeTab === 'configuracion'
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-300'
            }`}
          >
            <Sliders className="w-4 h-4" />
            Configuración
          </button>
        </nav>
      </div>

      {/* Tab Content: Sequences Table (Activos, Recuperados, Historial) */}
      {activeTab !== 'configuracion' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
          {loading ? (
            <div className="p-12 flex flex-col items-center justify-center text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin mb-3 text-indigo-600 dark:text-indigo-400" />
              <p className="text-sm">Cargando seguimientos...</p>
            </div>
          ) : sequences.length === 0 ? (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">
              <Clock className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
              <p className="text-base font-semibold text-slate-700 dark:text-slate-200">
                No hay seguimientos en esta categoría
              </p>
              <p className="text-sm mt-1">
                {activeTab === 'activos'
                  ? 'Cuando un cliente abandone una compra en etapa comercial, se programará automáticamente un seguimiento aquí.'
                  : 'Los registros completados o cancelados se mostrarán en esta sección.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 font-semibold">
                  <tr>
                    <th scope="col" className="px-6 py-3.5">Cliente</th>
                    <th scope="col" className="px-6 py-3.5">Etapa / Producto</th>
                    <th scope="col" className="px-6 py-3.5">Estado</th>
                    <th scope="col" className="px-6 py-3.5">Intento</th>
                    <th scope="col" className="px-6 py-3.5">Próximo Envío</th>
                    <th scope="col" className="px-6 py-3.5 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-slate-600 dark:text-slate-300">
                  {sequences.map((seq) => {
                    const statusCfg = STATUS_BADGES[seq.status] || { label: seq.status, className: 'bg-slate-100 text-slate-700' };
                    const StatusIcon = statusCfg.icon || Clock;
                    const canCancel = ['SCHEDULED', 'WAITING_NEXT', 'NEUTRALIZED_INBOUND'].includes(seq.status);

                    return (
                      <tr key={seq.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {seq.customer?.name || 'Cliente'}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                            {seq.customer?.phone || 'Sin teléfono'}
                          </div>
                        </td>

                        <td className="px-6 py-4">
                          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                            {STAGE_LABELS[seq.stageAtCreation] || seq.stageAtCreation}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[200px]" title={seq.productName || 'Interés general'}>
                            {seq.productName || 'Interés general'}
                          </div>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${statusCfg.className}`}>
                            <StatusIcon className="w-3.5 h-3.5" />
                            {statusCfg.label}
                          </span>
                          {seq.cancelReason && (
                            <div className="text-[11px] text-slate-400 mt-1">
                              Motivo: {seq.cancelReason}
                            </div>
                          )}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="font-medium text-slate-700 dark:text-slate-200">
                            {seq.currentAttempt} / {seq.maxAttempts || 3}
                          </span>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap text-xs">
                          {seq.nextRunAt ? (
                            <div>
                              <div className="font-medium text-slate-900 dark:text-slate-200">
                                {formatDate(seq.nextRunAt)}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                09:00 - 20:00 (Quiet Hours)
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap text-right text-xs">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setDetailModalItem(seq)}
                              className="px-2.5 py-1.5 rounded-lg text-slate-600 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition"
                            >
                              Detalles
                            </button>
                            {canCancel && (
                              <button
                                onClick={() => setCancelModalItem(seq)}
                                className="px-2.5 py-1.5 rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/50 transition font-medium"
                              >
                                Cancelar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
              <div>
                Página {pagination.page} de {pagination.pages} ({pagination.total} registros)
              </div>
              <div className="flex gap-2">
                <button
                  disabled={pagination.page <= 1}
                  onClick={() => loadSequences(activeTab, pagination.page - 1)}
                  className="px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-50 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Anterior
                </button>
                <button
                  disabled={pagination.page >= pagination.pages}
                  onClick={() => loadSequences(activeTab, pagination.page + 1)}
                  className="px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-50 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Configuración */}
      {activeTab === 'configuracion' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm space-y-6 max-w-3xl">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Sliders className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              Configuración de Seguimientos V1
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Controles generales y zona horaria obligatoria para la protección de horario seguro de envíos.
            </p>
          </div>

          {settingsError && (
            <div className="p-4 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-sm flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>{settingsError}</div>
            </div>
          )}

          {settingsSuccess && (
            <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>Configuración guardada exitosamente.</div>
            </div>
          )}

          <form onSubmit={handleSaveSettings} className="space-y-6">
            {/* Toggle Habilitar */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60">
              <div>
                <label htmlFor="followUpEnabled" className="text-sm font-semibold text-slate-900 dark:text-white block cursor-pointer">
                  Habilitar Seguimientos Automáticos
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  El sistema detectará abandonos comerciales y enviará hasta 3 mensajes contextuales a las +6h, +24h y +48h.
                </p>
              </div>
              <input
                id="followUpEnabled"
                type="checkbox"
                checked={settingEnabled}
                onChange={(e) => setSettingEnabled(e.target.checked)}
                className="w-5 h-5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
              />
            </div>

            {/* Selector Timezone */}
            <div className="space-y-2">
              <label htmlFor="timezone" className="block text-sm font-semibold text-slate-900 dark:text-white">
                Zona Horaria del Negocio (Obligatoria para envíos)
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Garantiza que ningún cliente reciba mensajes fuera de la franja segura (09:00 a 20:00). Si la zona horaria no está definida, el sistema entra en modo seguro (Fail-Closed) y no enviará mensajes.
              </p>
              <select
                id="timezone"
                value={settingTimezone}
                onChange={(e) => setSettingTimezone(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">-- Selecciona una zona horaria --</option>
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Reglas fijas V1 (Información no mutable en V1) */}
            <div className="p-4 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/50 text-xs text-indigo-900 dark:text-indigo-300 space-y-2">
              <div className="font-semibold flex items-center gap-1.5 text-sm">
                <Info className="w-4 h-4" />
                Políticas Operativas Follow-ups V1
              </div>
              <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-300">
                <li><strong>Cadencia Fija:</strong> Intento 1 (+6h) &bull; Intento 2 (+24h) &bull; Intento 3 (+48h) absolutos desde la última interacción real.</li>
                <li><strong>Horario Seguro (Quiet Hours):</strong> De 09:00 a 20:00 hora local. Envíos fuera de hora se posponen automáticamente a las 09:00 del día siguiente.</li>
                <li><strong>Cancelación Inmediata:</strong> Cualquier mensaje nuevo del cliente, intervención de asesor humano (Handoff) o comprobante en verificación cancela el seguimiento activo.</li>
                <li><strong>Anti-Duplicados:</strong> Máximo 1 secuencia activa por cliente en PostgreSQL garantizada con índice parcial.</li>
              </ul>
            </div>

            <button
              type="submit"
              disabled={savingSettings}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 transition"
            >
              {savingSettings ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                'Guardar Configuración'
              )}
            </button>
          </form>
        </div>
      )}

      {/* Modal: Cancelar Seguimiento */}
      {cancelModalItem && (
        <Modal
          isOpen={true}
          onClose={() => setCancelModalItem(null)}
          title="Cancelar Seguimiento Comercial"
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              ¿Estás seguro de que deseas cancelar el seguimiento para{' '}
              <strong>{cancelModalItem.customer?.name || cancelModalItem.customer?.phone}</strong>?
              No se enviarán más intentos para esta oportunidad.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Motivo de Cancelación
              </label>
              <select
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              >
                <option value="MERCHANT_MANUAL">Cancelación manual del comerciante</option>
                <option value="CUSTOMER_NOT_INTERESTED">Cliente no interesado</option>
                <option value="OUT_OF_STOCK">Producto sin stock</option>
                <option value="OTHER">Otro motivo</option>
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setCancelModalItem(null)}
                className="px-4 py-2 text-sm rounded-lg text-slate-600 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              >
                Cerrar
              </button>
              <button
                type="button"
                disabled={cancelling}
                onClick={handleCancelSequence}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50"
              >
                {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                Confirmar Cancelación
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Detalles de la Secuencia e Intentos */}
      {detailModalItem && (
        <Modal
          isOpen={true}
          onClose={() => setDetailModalItem(null)}
          title={`Detalle de Seguimiento #${detailModalItem.id.slice(0, 8)}`}
        >
          <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3 text-xs p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
              <div>
                <span className="text-slate-400 block">Cliente:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {detailModalItem.customer?.name} ({detailModalItem.customer?.phone})
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Etapa Comercial:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {STAGE_LABELS[detailModalItem.stageAtCreation] || detailModalItem.stageAtCreation}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Producto:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {detailModalItem.productName || '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Estado General:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {detailModalItem.status}
                </span>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">
                Historial de Intentos ({detailModalItem.attempts?.length || 0} de {detailModalItem.maxAttempts})
              </h3>

              {(!detailModalItem.attempts || detailModalItem.attempts.length === 0) ? (
                <p className="text-xs text-slate-400 italic">
                  Aún no se han ejecutado intentos para esta oportunidad.
                </p>
              ) : (
                <div className="space-y-3">
                  {detailModalItem.attempts.map((att) => {
                    const attCfg = ATTEMPT_STATUS_BADGES[att.status] || { label: att.status, color: 'text-slate-600 bg-slate-100' };
                    return (
                      <div
                        key={att.id}
                        className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs space-y-2 bg-white dark:bg-slate-900"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            Intento #{att.attemptNumber}
                          </span>
                          <span className={`px-2 py-0.5 rounded font-semibold text-[11px] ${attCfg.color}`}>
                            {attCfg.label}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-slate-500">
                          <div>
                            Programado: <span className="text-slate-700 dark:text-slate-300">{formatDate(att.scheduledAt)}</span>
                          </div>
                          <div>
                            Enviado: <span className="text-slate-700 dark:text-slate-300">{formatDate(att.sentAt)}</span>
                          </div>
                          <div>
                            Proveedor: <span className="text-slate-700 dark:text-slate-300 font-mono">{att.provider || '—'}</span>
                          </div>
                          <div>
                            Provider ID: <span className="text-slate-700 dark:text-slate-300 font-mono truncate">{att.providerMessageId || '—'}</span>
                          </div>
                        </div>

                        {att.sentMessage && (
                          <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <span className="text-slate-400 block mb-1">Mensaje Enviado:</span>
                            <div className="p-2 rounded bg-slate-50 dark:bg-slate-800/60 font-sans text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                              {att.sentMessage}
                            </div>
                          </div>
                        )}

                        {att.errorMessage && (
                          <div className="text-rose-600 dark:text-rose-400 text-[11px] mt-1">
                            Error: {att.errorMessage}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setDetailModalItem(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              >
                Cerrar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
