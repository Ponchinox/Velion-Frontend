import { useState, useEffect, useCallback } from 'react';
import {
  Clock,
  CheckCircle2,
  RefreshCw,
  X,
  Sliders,
  TrendingUp,
  DollarSign,
  Users,
  Loader2,
  Info,
  Calendar,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Check,
  Sparkles,
  ShoppingBag
} from 'lucide-react';
import * as followUpService from '../services/followUpService';
import Modal from '../components/ui/Modal';
import {
  formatCancelReason,
  formatCustomerDisplay,
  formatShortDateTime,
  formatRelativeTime,
  buildFollowUpTimeline,
  STATUS_BADGES,
  STAGE_LABELS,
  COMMON_TIMEZONES
} from '../utils/followUpFormatters';

export default function SeguimientosPage() {
  const [activeTab, setActiveTab] = useState('activos');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState({
    activeCount: 0,
    recoveredCount: 0,
    attributedSalesCount: 0,
    attributedSalesTotal: 0,
    recoveryRatePercent: 0,
    followUpEnabled: false,
    timezone: null
  });
  const [sequences, setSequences] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 });

  // Settings Modal state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingEnabled, setSettingEnabled] = useState(false);
  const [settingTimezone, setSettingTimezone] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState(null);
  const [settingsSuccess, setSettingsSuccess] = useState(false);

  // Cancel Modal state
  const [cancelModalItem, setCancelModalItem] = useState(null);
  const [cancelReason, setCancelReason] = useState('MERCHANT_MANUAL');
  const [cancelling, setCancelling] = useState(false);

  // Detail Modal (Timeline) state
  const [detailModalItem, setDetailModalItem] = useState(null);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  const loadSummary = useCallback(async () => {
    try {
      const res = await followUpService.getFollowUpSummary();
      const payload = res?.data || res?.metrics;
      if (payload) {
        setSummary({
          activeCount: payload.activeCount ?? payload.activeSequences ?? 0,
          recoveredCount: payload.recoveredCount ?? payload.recoveredConversations ?? 0,
          attributedSalesCount: payload.attributedSalesCount ?? 0,
          attributedSalesTotal: payload.attributedSalesTotal ?? 0,
          recoveryRatePercent: payload.recoveryRatePercent ?? payload.recoveryRate ?? 0,
          followUpEnabled: Boolean(payload.followUpEnabled),
          timezone: payload.timezone || null
        });
        setSettingEnabled(Boolean(payload.followUpEnabled));
        setSettingTimezone(payload.timezone || 'America/Lima');
      }
    } catch (err) {
      console.error('Error loading follow-up summary:', err);
    }
  }, []);

  const loadSequences = useCallback(async (tab = activeTab, page = 1) => {
    setLoading(true);
    try {
      const res = await followUpService.getFollowUps({ tab, view: tab, page, limit: 20 });
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

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadSummary(), loadSequences(activeTab, pagination.page)]);
    setRefreshing(false);
  };

  const handleSaveSettings = async (e) => {
    if (e) e.preventDefault();
    setSettingsError(null);
    setSettingsSuccess(false);

    if (settingEnabled && (!settingTimezone || !settingTimezone.trim())) {
      setSettingsError('Para activar los seguimientos es obligatorio seleccionar una zona horaria válida.');
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
        await loadSummary();
        await loadSequences(activeTab, 1);
        setTimeout(() => {
          setSettingsSuccess(false);
          setIsSettingsOpen(false);
        }, 1200);
      } else {
        setSettingsError(res?.error || 'Error al guardar configuración.');
      }
    } catch (err) {
      setSettingsError(err.message || 'Error al guardar configuración.');
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
      await loadSummary();
      await loadSequences(activeTab, pagination.page);
    } catch (err) {
      alert(`No se pudo detener el seguimiento: ${err.message}`);
    } finally {
      setCancelling(false);
    }
  };

  // Helper para determinar intento que recuperó la secuencia
  const getRecoveryAttemptLabel = (seq) => {
    if (!seq.attempts || seq.attempts.length === 0) {
      return seq.currentAttempt > 0 ? `Seguimiento ${seq.currentAttempt}` : 'Seguimiento 1';
    }
    const sentAttempts = seq.attempts.filter(a => a.status === 'SENT');
    if (sentAttempts.length > 0) {
      const lastSent = sentAttempts[sentAttempts.length - 1];
      return `Seguimiento ${lastSent.attemptNumber}`;
    }
    return `Seguimiento ${seq.currentAttempt || 1}`;
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* 1. Header Operativo */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
              Seguimientos Automáticos
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                summary.followUpEnabled
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50'
                  : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  summary.followUpEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                }`}
              />
              {summary.followUpEnabled ? 'Activos' : 'Desactivados'}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Velion recupera automáticamente oportunidades que dejan de responder.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-750 transition shadow-sm disabled:opacity-50"
            title="Actualizar datos"
          >
            <RefreshCw className={`w-4 h-4 text-slate-500 ${refreshing ? 'animate-spin text-indigo-600' : ''}`} />
            <span className="hidden sm:inline">Actualizar</span>
          </button>

          <button
            onClick={() => {
              setSettingEnabled(summary.followUpEnabled);
              setSettingTimezone(summary.timezone || 'America/Lima');
              setSettingsError(null);
              setSettingsSuccess(false);
              setIsSettingsOpen(true);
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-750 transition shadow-sm"
          >
            <Sliders className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Configuración</span>
          </button>
        </div>
      </div>

      {/* 2. KPIs en Lenguaje Comercial */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: En Seguimiento */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Clientes en seguimiento
            </span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
              {summary.activeCount}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Esperando respuesta o programados
          </p>
        </div>

        {/* Card 2: Recuperados */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Clientes recuperados
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
              {summary.recoveredCount}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Respondieron al seguimiento
          </p>
        </div>

        {/* Card 3: Ventas Recuperadas */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Ventas recuperadas
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
              {summary.attributedSalesTotal > 0
                ? `S/ ${summary.attributedSalesTotal.toLocaleString('es-PE')}`
                : (summary.attributedSalesCount > 0 ? `${summary.attributedSalesCount} ventas` : 'S/ 0')}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {summary.attributedSalesCount > 0
              ? `${summary.attributedSalesCount} ${summary.attributedSalesCount === 1 ? 'pedido concretado' : 'pedidos concretados'}`
              : 'Pedidos pagados tras seguimiento'}
          </p>
        </div>

        {/* Card 4: Tasa de Recuperación */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Tasa de recuperación
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
              {summary.recoveryRatePercent}%
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Efectividad de recuperación
          </p>
        </div>
      </div>

      {/* 3. Navegación Operativa (3 Tabs) */}
      <div className="border-b border-slate-200 dark:border-slate-800">
        <nav className="flex space-x-6 sm:space-x-8" aria-label="Tabs">
          {/* Tab 1: En seguimiento */}
          <button
            onClick={() => setActiveTab('activos')}
            className={`pb-3.5 px-1 inline-flex items-center gap-2 border-b-2 font-semibold text-sm transition ${
              activeTab === 'activos'
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-300'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>En seguimiento</span>
            {summary.activeCount > 0 && (
              <span className="ml-1 px-2 py-0.5 text-xs font-bold rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300">
                {summary.activeCount}
              </span>
            )}
          </button>

          {/* Tab 2: Recuperados */}
          <button
            onClick={() => setActiveTab('recuperados')}
            className={`pb-3.5 px-1 inline-flex items-center gap-2 border-b-2 font-semibold text-sm transition ${
              activeTab === 'recuperados'
                ? 'border-emerald-600 text-emerald-600 dark:border-emerald-400 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-300'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Recuperados</span>
            {summary.recoveredCount > 0 && (
              <span className="ml-1 px-2 py-0.5 text-xs font-bold rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
                {summary.recoveredCount}
              </span>
            )}
          </button>

          {/* Tab 3: Historial */}
          <button
            onClick={() => setActiveTab('historial')}
            className={`pb-3.5 px-1 inline-flex items-center gap-2 border-b-2 font-semibold text-sm transition ${
              activeTab === 'historial'
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-300'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Historial</span>
          </button>
        </nav>
      </div>

      {/* 4. Tab Content: Container de Listas / Tablas */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-16 flex flex-col items-center justify-center text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin mb-3 text-indigo-600 dark:text-indigo-400" />
            <p className="text-sm font-medium">Cargando oportunidades...</p>
          </div>
        ) : sequences.length === 0 ? (
          /* Empty States según pestaña */
          <div className="p-16 text-center">
            {activeTab === 'activos' && (
              <>
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 mx-auto mb-3.5 flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Todo al día
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                  No hay clientes esperando seguimiento. Cuando un cliente deje de responder durante una compra, aparecerá automáticamente aquí.
                </p>
              </>
            )}
            {activeTab === 'recuperados' && (
              <>
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 mx-auto mb-3.5 flex items-center justify-center">
                  <Sparkles className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Aún no hay clientes recuperados.
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                  Cuando alguien responda a un seguimiento, aparecerá aquí.
                </p>
              </>
            )}
            {activeTab === 'historial' && (
              <>
                <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 mx-auto mb-3.5 flex items-center justify-center">
                  <Calendar className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Aún no hay actividad de seguimientos.
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                  El historial de seguimientos completados o detenidos se mostrará aquí.
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Desktop Table (>= 768px) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-left text-sm">
                <thead className="bg-slate-50/80 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300 font-semibold text-xs uppercase tracking-wider">
                  {activeTab === 'activos' && (
                    <tr>
                      <th scope="col" className="px-6 py-3.5">Cliente</th>
                      <th scope="col" className="px-6 py-3.5">Oportunidad</th>
                      <th scope="col" className="px-6 py-3.5">Estado</th>
                      <th scope="col" className="px-6 py-3.5">Próximo seguimiento</th>
                      <th scope="col" className="px-6 py-3.5">Progreso</th>
                      <th scope="col" className="px-6 py-3.5 text-right">Acciones</th>
                    </tr>
                  )}
                  {activeTab === 'recuperados' && (
                    <tr>
                      <th scope="col" className="px-6 py-3.5">Cliente</th>
                      <th scope="col" className="px-6 py-3.5">Oportunidad</th>
                      <th scope="col" className="px-6 py-3.5">Recuperado después de</th>
                      <th scope="col" className="px-6 py-3.5">Respondió</th>
                      <th scope="col" className="px-6 py-3.5">Resultado</th>
                      <th scope="col" className="px-6 py-3.5 text-right">Acciones</th>
                    </tr>
                  )}
                  {activeTab === 'historial' && (
                    <tr>
                      <th scope="col" className="px-6 py-3.5">Resultado</th>
                      <th scope="col" className="px-6 py-3.5">Fecha</th>
                      <th scope="col" className="px-6 py-3.5">Cliente</th>
                      <th scope="col" className="px-6 py-3.5">Oportunidad</th>
                      <th scope="col" className="px-6 py-3.5">Progreso</th>
                      <th scope="col" className="px-6 py-3.5 text-right">Acciones</th>
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-slate-600 dark:text-slate-300">
                  {sequences.map((seq) => {
                    const statusCfg = STATUS_BADGES[seq.status] || {
                      label: seq.status,
                      color: 'bg-slate-100 text-slate-700'
                    };
                    const { displayName, displayPhone, initials } = formatCustomerDisplay(seq.customer);
                    const canCancel = ['SCHEDULED', 'WAITING_NEXT'].includes(seq.status);

                    {/* VISTA 1: EN SEGUIMIENTO (Desktop) */}
                    if (activeTab === 'activos') {
                      return (
                        <tr key={seq.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold text-xs flex items-center justify-center ring-1 ring-indigo-200 dark:ring-indigo-800/60">
                                {initials}
                              </div>
                              <div>
                                <div className="font-semibold text-slate-900 dark:text-white">
                                  {displayName}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                                  {displayPhone}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="px-6 py-4">
                            <div className="font-medium text-slate-900 dark:text-slate-200 flex items-center gap-1.5">
                              <ShoppingBag className="w-3.5 h-3.5 text-slate-400" />
                              <span>{seq.productName || 'Interés general'}</span>
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              {STAGE_LABELS[seq.stageAtCreation] || seq.stageAtCreation}
                            </div>
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${statusCfg.color}`}>
                              {statusCfg.label}
                            </span>
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap">
                            {seq.nextRunAt ? (
                              <div>
                                <div className="font-semibold text-slate-900 dark:text-white">
                                  {formatRelativeTime(seq.nextRunAt)}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  {formatShortDateTime(seq.nextRunAt, summary.timezone)}
                                </div>
                                <div className="text-[11px] text-slate-400 mt-0.5">
                                  Horario: 09:00–20:00
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                              {seq.currentAttempt} de {seq.maxAttempts || 3}
                            </div>
                            <div className="flex gap-1 mt-1">
                              {[1, 2, 3].map((step) => (
                                <div
                                  key={step}
                                  className={`h-1.5 w-4 rounded-full ${
                                    step <= seq.currentAttempt
                                      ? 'bg-indigo-600 dark:bg-indigo-400'
                                      : 'bg-slate-200 dark:bg-slate-700'
                                  }`}
                                />
                              ))}
                            </div>
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap text-right text-xs">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => setDetailModalItem(seq)}
                                className="px-3 py-1.5 rounded-lg text-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition font-medium"
                              >
                                Ver
                              </button>
                              {canCancel && (
                                <button
                                  onClick={() => setCancelModalItem(seq)}
                                  className="px-3 py-1.5 rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/50 transition font-medium"
                                >
                                  Detener
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    {/* VISTA 2: RECUPERADOS (Desktop) */}
                    if (activeTab === 'recuperados') {
                      return (
                        <tr key={seq.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold text-xs flex items-center justify-center ring-1 ring-emerald-200 dark:ring-emerald-800/60">
                                {initials}
                              </div>
                              <div>
                                <div className="font-semibold text-slate-900 dark:text-white">
                                  {displayName}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                                  {displayPhone}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="px-6 py-4">
                            <div className="font-medium text-slate-900 dark:text-slate-200">
                              {seq.productName || 'Interés general'}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              {STAGE_LABELS[seq.stageAtCreation] || seq.stageAtCreation}
                            </div>
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                              {getRecoveryAttemptLabel(seq)}
                            </span>
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="font-medium text-slate-800 dark:text-slate-200">
                              {formatShortDateTime(seq.recoveredAt, summary.timezone)}
                            </div>
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap">
                            {seq.orderId ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                                <DollarSign className="w-3 h-3" /> Venta recuperada
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50">
                                <Check className="w-3 h-3" /> Conversación retomada
                              </span>
                            )}
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap text-right text-xs">
                            <button
                              onClick={() => setDetailModalItem(seq)}
                              className="px-3 py-1.5 rounded-lg text-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition font-medium"
                            >
                              Ver
                            </button>
                          </td>
                        </tr>
                      );
                    }

                    {/* VISTA 3: HISTORIAL (Desktop) */}
                    return (
                      <tr key={seq.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          {seq.status === 'RECOVERED' ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50">
                              Recuperado
                            </span>
                          ) : seq.status === 'CANCELLED' ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/50">
                              {formatCancelReason(seq.cancelReason)}
                            </span>
                          ) : (
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${statusCfg.color}`}>
                              {statusCfg.label}
                            </span>
                          )}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="font-medium text-slate-800 dark:text-slate-200">
                            {formatShortDateTime(seq.updatedAt || seq.recoveredAt, summary.timezone)}
                          </div>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {displayName}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                            {displayPhone}
                          </div>
                        </td>

                        <td className="px-6 py-4">
                          <div className="font-medium text-slate-800 dark:text-slate-200">
                            {seq.productName || 'Interés general'}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {STAGE_LABELS[seq.stageAtCreation] || seq.stageAtCreation}
                          </div>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">
                          {seq.currentAttempt} de {seq.maxAttempts || 3}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap text-right text-xs">
                          <button
                            onClick={() => setDetailModalItem(seq)}
                            className="px-3 py-1.5 rounded-lg text-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition font-medium"
                          >
                            Ver
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View (< 768px) */}
            <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-800">
              {sequences.map((seq) => {
                const statusCfg = STATUS_BADGES[seq.status] || { label: seq.status, color: 'bg-slate-100 text-slate-700' };
                const { displayName, displayPhone, initials } = formatCustomerDisplay(seq.customer);
                const canCancel = ['SCHEDULED', 'WAITING_NEXT'].includes(seq.status);

                return (
                  <div key={seq.id} className="p-4 space-y-3">
                    {/* Header fila móvil */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold text-xs flex items-center justify-center ring-1 ring-indigo-200 dark:ring-indigo-800/60">
                          {initials}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-white text-sm">
                            {displayName}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                            {displayPhone}
                          </div>
                        </div>
                      </div>

                      {activeTab === 'activos' ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${statusCfg.color}`}>
                          {statusCfg.label}
                        </span>
                      ) : activeTab === 'recuperados' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300">
                          Recuperado
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                          {formatCancelReason(seq.cancelReason) || statusCfg.label}
                        </span>
                      )}
                    </div>

                    {/* Oportunidad / Producto */}
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl text-xs space-y-1">
                      <div className="font-medium text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <ShoppingBag className="w-3.5 h-3.5 text-slate-400" />
                        <span>{seq.productName || 'Interés general'}</span>
                      </div>
                      <div className="text-slate-500 dark:text-slate-400">
                        Etapa: {STAGE_LABELS[seq.stageAtCreation] || seq.stageAtCreation}
                      </div>

                      {activeTab === 'activos' && seq.nextRunAt && (
                        <div className="pt-1 border-t border-slate-200/60 dark:border-slate-700/50 flex justify-between items-center text-slate-700 dark:text-slate-300">
                          <span>Próximo envío:</span>
                          <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                            {formatRelativeTime(seq.nextRunAt)} ({formatShortDateTime(seq.nextRunAt, summary.timezone)})
                          </span>
                        </div>
                      )}

                      {activeTab === 'recuperados' && (
                        <div className="pt-1 border-t border-slate-200/60 dark:border-slate-700/50 flex justify-between items-center text-slate-700 dark:text-slate-300">
                          <span>Recuperado:</span>
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                            {getRecoveryAttemptLabel(seq)} · {formatShortDateTime(seq.recoveredAt, summary.timezone)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Acciones móvil */}
                    <div className="flex items-center justify-between pt-1">
                      <div className="text-xs text-slate-500">
                        Progreso: <span className="font-semibold">{seq.currentAttempt} de {seq.maxAttempts || 3}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setDetailModalItem(seq)}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 transition"
                        >
                          Ver
                        </button>
                        {activeTab === 'activos' && canCancel && (
                          <button
                            onClick={() => setCancelModalItem(seq)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 hover:bg-rose-100 transition"
                          >
                            Detener
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
            <span>
              Página <strong className="text-slate-900 dark:text-white">{pagination.page}</strong> de{' '}
              <strong className="text-slate-900 dark:text-white">{pagination.pages}</strong> ({pagination.total} en total)
            </span>
            <div className="flex gap-2">
              <button
                disabled={pagination.page <= 1}
                onClick={() => loadSequences(activeTab, pagination.page - 1)}
                className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
              >
                Anterior
              </button>
              <button
                disabled={pagination.page >= pagination.pages}
                onClick={() => loadSequences(activeTab, pagination.page + 1)}
                className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 5. Modal: Timeline de Detalles de la Oportunidad */}
      {detailModalItem && (
        <Modal
          isOpen={true}
          onClose={() => {
            setDetailModalItem(null);
            setShowTechnicalDetails(false);
          }}
          title="Línea de Tiempo del Seguimiento"
        >
          <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
            {/* Header del Cliente y Producto */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-bold text-sm flex items-center justify-center">
                  {formatCustomerDisplay(detailModalItem.customer).initials}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    {formatCustomerDisplay(detailModalItem.customer).displayName}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    {formatCustomerDisplay(detailModalItem.customer).displayPhone}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                  <ShoppingBag className="w-3.5 h-3.5 text-slate-400" />
                  {detailModalItem.productName || 'Interés general'}
                </span>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                  STATUS_BADGES[detailModalItem.status]?.color || 'bg-slate-100 text-slate-700'
                }`}>
                  {STATUS_BADGES[detailModalItem.status]?.label || detailModalItem.status}
                </span>
              </div>
            </div>

            {/* Visual Activity Timeline */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-4">
                Actividad Cronológica
              </h4>

              {(() => {
                const timeline = buildFollowUpTimeline(detailModalItem, summary.timezone);
                if (timeline.length === 0) {
                  return (
                    <p className="text-sm text-slate-400 italic">
                      No hay eventos registrados para esta oportunidad.
                    </p>
                  );
                }

                return (
                  <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-700">
                    {timeline.map((event) => {
                      const isSuccess = event.isSuccess;
                      const isWarning = event.iconType === 'failed' || event.iconType === 'cancelled';
                      const isSent = event.iconType === 'sent' || event.iconType === 'delivered' || event.iconType === 'read';

                      return (
                        <div key={event.id} className="relative group">
                          {/* Node Icon */}
                          <div
                            className={`absolute -left-6 top-1 w-5 h-5 rounded-full ring-4 ring-white dark:ring-slate-900 flex items-center justify-center text-[10px] font-bold ${
                              isSuccess
                                ? 'bg-emerald-500 text-white'
                                : isWarning
                                ? 'bg-rose-500 text-white'
                                : isSent
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-300 dark:bg-slate-600 text-slate-700 dark:text-slate-200'
                            }`}
                          >
                            {isSuccess ? '✓' : isSent ? '•' : ''}
                          </div>

                          <div className="bg-white dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80 rounded-xl p-3 shadow-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-sm text-slate-900 dark:text-white">
                                {event.title}
                              </span>
                              <span className="text-xs text-slate-400 font-medium whitespace-nowrap">
                                {event.timeFormatted}
                              </span>
                            </div>

                            {event.description && (
                              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                                {event.description}
                              </p>
                            )}

                            {event.badge && (
                              <div className="mt-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                                  isSuccess
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                }`}>
                                  {event.badge}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Sección Secundaria / Colapsable para Soporte */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                className="w-full flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 py-1 transition"
              >
                <span>Información técnica para soporte</span>
                {showTechnicalDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {showTechnicalDetails && (
                <div className="mt-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-850 text-xs font-mono text-slate-600 dark:text-slate-400 space-y-1.5">
                  <div>ID Secuencia: <span className="text-slate-900 dark:text-slate-200">{detailModalItem.id}</span></div>
                  <div>Etapa original: <span className="text-slate-900 dark:text-slate-200">{detailModalItem.stageAtCreation}</span></div>
                  <div>Fecha ancla (UTC): <span className="text-slate-900 dark:text-slate-200">{detailModalItem.anchorAt || '—'}</span></div>
                  <div>Próximo envío: <span className="text-slate-900 dark:text-slate-200">{detailModalItem.nextRunAt || 'null (terminal)'}</span></div>
                  <div>Intentos registrados: <span className="text-slate-900 dark:text-slate-200">{detailModalItem.attempts?.length || 0}</span></div>
                </div>
              )}
            </div>

            {/* Footer Modal */}
            <div className="flex justify-end pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setDetailModalItem(null);
                  setShowTechnicalDetails(false);
                }}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 6. Modal: Cancelación / Detención de Seguimiento */}
      {cancelModalItem && (
        <Modal
          isOpen={true}
          onClose={() => setCancelModalItem(null)}
          title="Detener Seguimiento Automático"
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              ¿Estás seguro de que deseas detener el seguimiento para{' '}
              <strong className="text-slate-900 dark:text-white">
                {formatCustomerDisplay(cancelModalItem.customer).displayName}
              </strong>?
              No se enviarán más mensajes de recuperación para esta oportunidad.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Motivo
              </label>
              <select
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
              >
                <option value="MERCHANT_MANUAL">Detención manual del negocio</option>
                <option value="CUSTOMER_NOT_INTERESTED">Cliente no está interesado</option>
                <option value="OUT_OF_STOCK">Producto sin stock disponible</option>
                <option value="OTHER">Otro motivo</option>
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setCancelModalItem(null)}
                className="px-4 py-2 text-sm rounded-xl text-slate-600 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 font-medium"
              >
                Volver
              </button>
              <button
                type="button"
                disabled={cancelling}
                onClick={handleCancelSequence}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 shadow-sm"
              >
                {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                Confirmar y Detener
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 7. Modal: Configuración Simple de Seguimientos */}
      {isSettingsOpen && (
        <Modal
          isOpen={true}
          onClose={() => setIsSettingsOpen(false)}
          title="Configuración de Seguimientos"
        >
          <form onSubmit={handleSaveSettings} className="space-y-5">
            {settingsError && (
              <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{settingsError}</span>
              </div>
            )}

            {settingsSuccess && (
              <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Configuración guardada exitosamente.</span>
              </div>
            )}

            {/* Switch: Estado de Seguimientos */}
            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
              <div>
                <div className="font-semibold text-slate-900 dark:text-white text-sm">
                  Seguimientos automáticos
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-sm">
                  Velion enviará mensajes a clientes que dejen de responder durante el proceso de compra.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSettingEnabled(!settingEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                  settingEnabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
                role="switch"
                aria-checked={settingEnabled}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                    settingEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Horario de envío (Fijo V1) */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900 dark:text-white">
                  Horario de envío
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  09:00 – 20:00 (Protegido)
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Los mensajes solo se enviarán dentro de este horario. Si un seguimiento coincide fuera de esta ventana, se pospone automáticamente a las 09:00 del día siguiente.
              </p>
            </div>

            {/* Zona Horaria del Negocio */}
            <div className="space-y-1.5">
              <label htmlFor="modal-timezone" className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Zona Horaria del Negocio
              </label>
              <select
                id="modal-timezone"
                value={settingTimezone}
                onChange={(e) => setSettingTimezone(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Garantiza que el horario 09:00 a 20:00 se calcule exactamente según la hora de tu tienda.
              </p>
            </div>

            {/* Secuencia fija V1 */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80 space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Secuencia Automática de Mensajes
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <div className="font-bold text-indigo-600 dark:text-indigo-400">1.º Envío</div>
                  <div className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">después de 6 h</div>
                </div>
                <div className="p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <div className="font-bold text-indigo-600 dark:text-indigo-400">2.º Envío</div>
                  <div className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">después de 24 h</div>
                </div>
                <div className="p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <div className="font-bold text-indigo-600 dark:text-indigo-400">3.º Envío</div>
                  <div className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">después de 48 h</div>
                </div>
              </div>
            </div>

            {/* Reglas de parada */}
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 text-indigo-800 dark:text-indigo-300 text-xs">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <p>
                Los seguimientos se detienen automáticamente si el cliente responde, compra, solicita dejar de recibir mensajes o un asesor toma la conversación.
              </p>
            </div>

            {/* Botones de acción */}
            <div className="flex justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 text-sm font-medium rounded-xl text-slate-600 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingSettings}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 shadow-sm transition"
              >
                {savingSettings && <Loader2 className="w-4 h-4 animate-spin" />}
                Guardar cambios
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
