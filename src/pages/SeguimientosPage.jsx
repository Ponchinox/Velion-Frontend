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
    <div className="space-y-6 max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 py-4 sm:py-6">
      {/* 1. Header Operativo */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Seguimientos Automáticos
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                summary.followUpEnabled
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-slate-100 text-slate-700 border-slate-200'
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
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            Velion recupera automáticamente oportunidades que dejan de responder.
          </p>
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5 self-start sm:self-auto">
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition shadow-xs disabled:opacity-50 cursor-pointer"
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
            className="inline-flex items-center gap-2 px-3 sm:px-3.5 py-2 text-sm font-medium rounded-xl border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 transition shadow-xs cursor-pointer"
          >
            <Sliders className="w-4 h-4 text-indigo-600" />
            <span>Configuración</span>
          </button>
        </div>
      </div>

      {/* 2. KPIs en Lenguaje Comercial */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: En Seguimiento */}
        <div className="p-4 sm:p-4.5 rounded-2xl bg-white border border-slate-200/90 shadow-xs transition hover:shadow-md">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              Clientes en seguimiento
            </span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold text-slate-900 truncate">
              {summary.activeCount}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Esperando respuesta o programados
          </p>
        </div>

        {/* Card 2: Recuperados */}
        <div className="p-4 sm:p-4.5 rounded-2xl bg-white border border-slate-200/90 shadow-xs transition hover:shadow-md">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              Clientes recuperados
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold text-slate-900 truncate">
              {summary.recoveredCount}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Respondieron al seguimiento
          </p>
        </div>

        {/* Card 3: Ventas Recuperadas */}
        <div className="p-4 sm:p-4.5 rounded-2xl bg-white border border-slate-200/90 shadow-xs transition hover:shadow-md">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              Ventas recuperadas
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold text-slate-900 truncate">
              {summary.attributedSalesTotal > 0
                ? `S/ ${summary.attributedSalesTotal.toLocaleString('es-PE')}`
                : (summary.attributedSalesCount > 0 ? `${summary.attributedSalesCount} ventas` : 'S/ 0')}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {summary.attributedSalesCount > 0
              ? `${summary.attributedSalesCount} ${summary.attributedSalesCount === 1 ? 'pedido concretado' : 'pedidos concretados'}`
              : 'Pedidos pagados tras seguimiento'}
          </p>
        </div>

        {/* Card 4: Tasa de Recuperación */}
        <div className="p-4 sm:p-4.5 rounded-2xl bg-white border border-slate-200/90 shadow-xs transition hover:shadow-md">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              Tasa de recuperación
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold text-slate-900 truncate">
              {summary.recoveryRatePercent}%
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Efectividad de recuperación
          </p>
        </div>
      </div>

      {/* 3. Navegación Operativa (3 Tabs) — Scrollable y accesible en móvil */}
      <div className="border-b border-slate-200 -mx-3.5 sm:mx-0 px-3.5 sm:px-0">
        <nav
          className="flex space-x-4 sm:space-x-8 overflow-x-auto overflow-y-hidden whitespace-nowrap scrollbar-none scroll-smooth pb-px -mb-px"
          aria-label="Tabs de Seguimientos"
        >
          {/* Tab 1: En seguimiento */}
          <button
            onClick={() => setActiveTab('activos')}
            className={`pb-3 px-1 inline-flex items-center gap-2 border-b-2 font-semibold text-sm transition flex-shrink-0 cursor-pointer ${
              activeTab === 'activos'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            <Clock className="w-4 h-4 flex-shrink-0" />
            <span>En seguimiento</span>
            {summary.activeCount > 0 && (
              <span className="ml-0.5 px-2 py-0.5 text-xs font-bold rounded-full bg-indigo-100 text-indigo-700">
                {summary.activeCount}
              </span>
            )}
          </button>

          {/* Tab 2: Recuperados */}
          <button
            onClick={() => setActiveTab('recuperados')}
            className={`pb-3 px-1 inline-flex items-center gap-2 border-b-2 font-semibold text-sm transition flex-shrink-0 cursor-pointer ${
              activeTab === 'recuperados'
                ? 'border-emerald-600 text-emerald-600'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>Recuperados</span>
            {summary.recoveredCount > 0 && (
              <span className="ml-0.5 px-2 py-0.5 text-xs font-bold rounded-full bg-emerald-100 text-emerald-700">
                {summary.recoveredCount}
              </span>
            )}
          </button>

          {/* Tab 3: Historial */}
          <button
            onClick={() => setActiveTab('historial')}
            className={`pb-3 px-1 inline-flex items-center gap-2 border-b-2 font-semibold text-sm transition flex-shrink-0 cursor-pointer ${
              activeTab === 'historial'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            <Calendar className="w-4 h-4 flex-shrink-0" />
            <span>Historial</span>
          </button>
        </nav>
      </div>

      {/* 4. Tab Content: Container de Listas / Tablas */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-12 sm:p-16 flex flex-col items-center justify-center text-slate-500">
            <Loader2 className="w-8 h-8 animate-spin mb-3 text-indigo-600" />
            <p className="text-sm font-medium">Cargando oportunidades...</p>
          </div>
        ) : sequences.length === 0 ? (
          /* Empty States según pestaña */
          <div className="p-10 sm:p-16 text-center">
            {activeTab === 'activos' && (
              <>
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 mx-auto mb-3.5 flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  Todo al día
                </h3>
                <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">
                  No hay clientes esperando seguimiento. Cuando un cliente deje de responder durante una compra, aparecerá automáticamente aquí.
                </p>
              </>
            )}
            {activeTab === 'recuperados' && (
              <>
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 mx-auto mb-3.5 flex items-center justify-center">
                  <Sparkles className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  Aún no hay clientes recuperados.
                </h3>
                <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">
                  Cuando alguien responda a un seguimiento, aparecerá aquí.
                </p>
              </>
            )}
            {activeTab === 'historial' && (
              <>
                <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-600 mx-auto mb-3.5 flex items-center justify-center">
                  <Calendar className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  Aún no hay actividad de seguimientos.
                </h3>
                <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">
                  El historial de seguimientos completados o detenidos se mostrará aquí.
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Desktop Table (>= 768px) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-slate-700 font-semibold text-xs uppercase tracking-wider">
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
                <tbody className="divide-y divide-slate-200 text-slate-600">
                  {sequences.map((seq) => {
                    const statusCfg = STATUS_BADGES[seq.status] || {
                      label: seq.status,
                      color: 'bg-slate-100 text-slate-700 border-slate-200'
                    };
                    const { displayName, displayPhone, initials } = formatCustomerDisplay(seq.customer);
                    const canCancel = ['SCHEDULED', 'WAITING_NEXT'].includes(seq.status);

                    {/* VISTA 1: EN SEGUIMIENTO (Desktop) */}
                    if (activeTab === 'activos') {
                      return (
                        <tr key={seq.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-indigo-50 text-indigo-700 font-bold text-xs flex items-center justify-center ring-1 ring-indigo-200">
                                {initials}
                              </div>
                              <div>
                                <div className="font-semibold text-slate-900">
                                  {displayName}
                                </div>
                                <div className="text-xs text-slate-500 font-mono">
                                  {displayPhone}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="px-6 py-4">
                            <div className="font-medium text-slate-900 flex items-center gap-1.5">
                              <ShoppingBag className="w-3.5 h-3.5 text-slate-400" />
                              <span>{seq.productName || 'Interés general'}</span>
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">
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
                                <div className="font-semibold text-slate-900">
                                  {formatRelativeTime(seq.nextRunAt)}
                                </div>
                                <div className="text-xs text-slate-500">
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
                            <div className="text-xs font-semibold text-slate-700">
                              {seq.currentAttempt} de {seq.maxAttempts || 3}
                            </div>
                            <div className="flex gap-1 mt-1">
                              {[1, 2, 3].map((step) => (
                                <div
                                  key={step}
                                  className={`h-1.5 w-4 rounded-full ${
                                    step <= seq.currentAttempt
                                      ? 'bg-indigo-600'
                                      : 'bg-slate-200'
                                  }`}
                                />
                              ))}
                            </div>
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap text-right text-xs">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => setDetailModalItem(seq)}
                                className="px-3 py-1.5 rounded-lg text-slate-700 bg-slate-100 hover:bg-slate-200 transition font-medium cursor-pointer"
                              >
                                Ver
                              </button>
                              {canCancel && (
                                <button
                                  onClick={() => setCancelModalItem(seq)}
                                  className="px-3 py-1.5 rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 transition font-medium cursor-pointer"
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
                        <tr key={seq.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-700 font-bold text-xs flex items-center justify-center ring-1 ring-emerald-200">
                                {initials}
                              </div>
                              <div>
                                <div className="font-semibold text-slate-900">
                                  {displayName}
                                </div>
                                <div className="text-xs text-slate-500 font-mono">
                                  {displayPhone}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="px-6 py-4">
                            <div className="font-medium text-slate-900">
                              {seq.productName || 'Interés general'}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">
                              {STAGE_LABELS[seq.stageAtCreation] || seq.stageAtCreation}
                            </div>
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="font-semibold text-slate-800 text-xs">
                              {getRecoveryAttemptLabel(seq)}
                            </span>
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="font-medium text-slate-800">
                              {formatShortDateTime(seq.recoveredAt, summary.timezone)}
                            </div>
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap">
                            {seq.orderId ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                <DollarSign className="w-3 h-3" /> Venta recuperada
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <Check className="w-3 h-3" /> Conversación retomada
                              </span>
                            )}
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap text-right text-xs">
                            <button
                              onClick={() => setDetailModalItem(seq)}
                              className="px-3 py-1.5 rounded-lg text-slate-700 bg-slate-100 hover:bg-slate-200 transition font-medium cursor-pointer"
                            >
                              Ver
                            </button>
                          </td>
                        </tr>
                      );
                    }

                    {/* VISTA 3: HISTORIAL (Desktop) */}
                    return (
                      <tr key={seq.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          {seq.status === 'RECOVERED' ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Recuperado
                            </span>
                          ) : seq.status === 'CANCELLED' ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
                              {formatCancelReason(seq.cancelReason)}
                            </span>
                          ) : (
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${statusCfg.color}`}>
                              {formatCancelReason(seq.cancelReason) || statusCfg.label}
                            </span>
                          )}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="font-medium text-slate-800">
                            {formatShortDateTime(seq.updatedAt || seq.recoveredAt, summary.timezone)}
                          </div>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="font-semibold text-slate-900">
                            {displayName}
                          </div>
                          <div className="text-xs text-slate-500 font-mono">
                            {displayPhone}
                          </div>
                        </td>

                        <td className="px-6 py-4">
                          <div className="font-medium text-slate-800">
                            {seq.productName || 'Interés general'}
                          </div>
                          <div className="text-xs text-slate-500">
                            {STAGE_LABELS[seq.stageAtCreation] || seq.stageAtCreation}
                          </div>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">
                          {seq.currentAttempt} de {seq.maxAttempts || 3}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap text-right text-xs">
                          <button
                            onClick={() => setDetailModalItem(seq)}
                            className="px-3 py-1.5 rounded-lg text-slate-700 bg-slate-100 hover:bg-slate-200 transition font-medium cursor-pointer"
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

            {/* Mobile Cards View (< 768px) — Totalmente responsive y accesible */}
            <div className="md:hidden divide-y divide-slate-100">
              {sequences.map((seq) => {
                const statusCfg = STATUS_BADGES[seq.status] || {
                  label: seq.status,
                  color: 'bg-slate-100 text-slate-700 border-slate-200'
                };
                const { displayName, displayPhone, initials } = formatCustomerDisplay(seq.customer);
                const canCancel = ['SCHEDULED', 'WAITING_NEXT'].includes(seq.status);

                return (
                  <div key={seq.id} className="p-3.5 sm:p-4 space-y-3 bg-white">
                    {/* Header fila móvil: avatar + nombre + badge */}
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className="w-9 h-9 rounded-full bg-indigo-50 text-indigo-700 font-bold text-xs flex items-center justify-center ring-1 ring-indigo-200 shrink-0">
                          {initials}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-slate-900 text-sm truncate">
                            {displayName}
                          </div>
                          <div className="text-xs text-slate-500 font-mono truncate">
                            {displayPhone}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 max-w-[48%] flex justify-end">
                        {activeTab === 'activos' ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border text-center break-words ${statusCfg.color}`}>
                            {statusCfg.label}
                          </span>
                        ) : activeTab === 'recuperados' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Recuperado
                          </span>
                        ) : (
                          /* Historial: badges con manejo de textos largos como Semantic Not Eligible */
                          seq.status === 'RECOVERED' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Recuperado
                            </span>
                          ) : seq.status === 'CANCELLED' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200 text-right leading-tight">
                              {formatCancelReason(seq.cancelReason)}
                            </span>
                          ) : (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border text-right leading-tight ${statusCfg.color}`}>
                              {formatCancelReason(seq.cancelReason) || statusCfg.label}
                            </span>
                          )
                        )}
                      </div>
                    </div>

                    {/* Oportunidad / Producto */}
                    <div className="bg-slate-50 p-2.5 rounded-xl text-xs space-y-1.5 border border-slate-100">
                      <div className="font-medium text-slate-900 flex items-center gap-1.5 min-w-0">
                        <ShoppingBag className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span className="truncate">{seq.productName || 'Interés general'}</span>
                      </div>
                      <div className="text-slate-600">
                        Etapa: {STAGE_LABELS[seq.stageAtCreation] || seq.stageAtCreation}
                      </div>

                      {activeTab === 'activos' && seq.nextRunAt && (
                        <div className="pt-1.5 border-t border-slate-200/80 flex flex-col min-[380px]:flex-row min-[380px]:justify-between min-[380px]:items-center gap-0.5 text-slate-700">
                          <span className="text-slate-500">Próximo envío:</span>
                          <span className="font-semibold text-indigo-600">
                            {formatRelativeTime(seq.nextRunAt)} ({formatShortDateTime(seq.nextRunAt, summary.timezone)})
                          </span>
                        </div>
                      )}

                      {activeTab === 'recuperados' && (
                        <div className="pt-1.5 border-t border-slate-200/80 flex flex-col min-[380px]:flex-row min-[380px]:justify-between min-[380px]:items-center gap-0.5 text-slate-700">
                          <span className="text-slate-500">Recuperado:</span>
                          <span className="font-semibold text-emerald-600">
                            {getRecoveryAttemptLabel(seq)} · {formatShortDateTime(seq.recoveredAt, summary.timezone)}
                          </span>
                        </div>
                      )}

                      {activeTab === 'historial' && (
                        <div className="pt-1.5 border-t border-slate-200/80 flex justify-between items-center text-slate-600">
                          <span>Fecha:</span>
                          <span className="font-medium text-slate-800">
                            {formatShortDateTime(seq.updatedAt || seq.recoveredAt, summary.timezone)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Acciones móvil */}
                    <div className="flex items-center justify-between pt-0.5">
                      <div className="text-xs text-slate-600">
                        Progreso: <span className="font-semibold text-slate-800">{seq.currentAttempt} de {seq.maxAttempts || 3}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setDetailModalItem(seq)}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
                        >
                          Ver
                        </button>
                        {activeTab === 'activos' && canCancel && (
                          <button
                            onClick={() => setCancelModalItem(seq)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition cursor-pointer"
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

        {/* Pagination — Responsive y accesible */}
        {pagination.pages > 1 && (
          <div className="px-4 sm:px-6 py-3.5 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
            <span>
              Página <strong className="text-slate-900">{pagination.page}</strong> de{' '}
              <strong className="text-slate-900">{pagination.pages}</strong> ({pagination.total} en total)
            </span>
            <div className="flex gap-2 w-full sm:w-auto justify-end">
              <button
                disabled={pagination.page <= 1}
                onClick={() => loadSequences(activeTab, pagination.page - 1)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-slate-700 cursor-pointer"
              >
                Anterior
              </button>
              <button
                disabled={pagination.page >= pagination.pages}
                onClick={() => loadSequences(activeTab, pagination.page + 1)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-slate-700 cursor-pointer"
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
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex items-center justify-center shrink-0">
                  {formatCustomerDisplay(detailModalItem.customer).initials}
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-900 text-base truncate">
                    {formatCustomerDisplay(detailModalItem.customer).displayName}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono truncate">
                    {formatCustomerDisplay(detailModalItem.customer).displayPhone}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700">
                  <ShoppingBag className="w-3.5 h-3.5 text-slate-500" />
                  {detailModalItem.productName || 'Interés general'}
                </span>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                  STATUS_BADGES[detailModalItem.status]?.color || 'bg-slate-100 text-slate-700 border-slate-200'
                }`}>
                  {STATUS_BADGES[detailModalItem.status]?.label || detailModalItem.status}
                </span>
              </div>
            </div>

            {/* Visual Activity Timeline */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-4">
                Actividad Cronológica
              </h4>

              {(() => {
                const timeline = buildFollowUpTimeline(detailModalItem, summary.timezone);
                if (timeline.length === 0) {
                  return (
                    <p className="text-sm text-slate-500 italic">
                      No hay eventos registrados para esta oportunidad.
                    </p>
                  );
                }

                return (
                  <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                    {timeline.map((event) => {
                      const isSuccess = event.isSuccess;
                      const isWarning = event.iconType === 'failed' || event.iconType === 'cancelled';
                      const isSent = event.iconType === 'sent' || event.iconType === 'delivered' || event.iconType === 'read';

                      return (
                        <div key={event.id} className="relative group">
                          {/* Node Icon */}
                          <div
                            className={`absolute -left-6 top-1 w-5 h-5 rounded-full ring-4 ring-white flex items-center justify-center text-[10px] font-bold ${
                              isSuccess
                                ? 'bg-emerald-500 text-white'
                                : isWarning
                                ? 'bg-rose-500 text-white'
                                : isSent
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-300 text-slate-700'
                            }`}
                          >
                            {isSuccess ? '✓' : isSent ? '•' : ''}
                          </div>

                          <div className="bg-white border border-slate-200/80 rounded-xl p-3 shadow-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-sm text-slate-900">
                                {event.title}
                              </span>
                              <span className="text-xs text-slate-500 font-medium whitespace-nowrap">
                                {event.timeFormatted}
                              </span>
                            </div>

                            {event.description && (
                              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                                {event.description}
                              </p>
                            )}

                            {event.badge && (
                              <div className="mt-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                                  isSuccess
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'bg-slate-100 text-slate-600'
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
            <div className="pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                className="w-full flex items-center justify-between text-xs font-semibold text-slate-600 hover:text-slate-900 py-1 transition cursor-pointer"
              >
                <span>Información técnica para soporte</span>
                {showTechnicalDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {showTechnicalDetails && (
                <div className="mt-3 p-3 rounded-lg bg-slate-50 text-xs font-mono text-slate-600 space-y-1.5 border border-slate-200/80">
                  <div>ID Secuencia: <span className="text-slate-900">{detailModalItem.id}</span></div>
                  <div>Etapa original: <span className="text-slate-900">{detailModalItem.stageAtCreation}</span></div>
                  <div>Fecha ancla (UTC): <span className="text-slate-900">{detailModalItem.anchorAt || '—'}</span></div>
                  <div>Próximo envío: <span className="text-slate-900">{detailModalItem.nextRunAt || 'null (terminal)'}</span></div>
                  <div>Intentos registrados: <span className="text-slate-900">{detailModalItem.attempts?.length || 0}</span></div>
                </div>
              )}
            </div>

            {/* Footer Modal */}
            <div className="flex justify-end pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setDetailModalItem(null);
                  setShowTechnicalDetails(false);
                }}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
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
            <p className="text-sm text-slate-600 leading-relaxed">
              ¿Estás seguro de que deseas detener el seguimiento para{' '}
              <strong className="text-slate-900">
                {formatCustomerDisplay(cancelModalItem.customer).displayName}
              </strong>?
              No se enviarán más mensajes de recuperación para esta oportunidad.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Motivo
              </label>
              <select
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500"
              >
                <option value="MERCHANT_MANUAL">Detención manual del negocio</option>
                <option value="CUSTOMER_NOT_INTERESTED">Cliente no está interesado</option>
                <option value="OUT_OF_STOCK">Producto sin stock disponible</option>
                <option value="OTHER">Otro motivo</option>
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setCancelModalItem(null)}
                className="px-4 py-2 text-sm rounded-xl text-slate-600 bg-slate-100 hover:bg-slate-200 font-medium cursor-pointer"
              >
                Volver
              </button>
              <button
                type="button"
                disabled={cancelling}
                onClick={handleCancelSequence}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 shadow-sm cursor-pointer"
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
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{settingsError}</span>
              </div>
            )}

            {settingsSuccess && (
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Configuración guardada exitosamente.</span>
              </div>
            )}

            {/* Switch: Estado de Seguimientos */}
            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50/60">
              <div>
                <div className="font-semibold text-slate-900 text-sm">
                  Seguimientos automáticos
                </div>
                <p className="text-xs text-slate-600 mt-0.5 max-w-sm">
                  Velion enviará mensajes a clientes que dejen de responder durante el proceso de compra.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSettingEnabled(!settingEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                  settingEnabled ? 'bg-indigo-600' : 'bg-slate-300'
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
            <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">
                  Horario de envío
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                  09:00 – 20:00 (Protegido)
                </span>
              </div>
              <p className="text-xs text-slate-600">
                Los mensajes solo se enviarán dentro de este horario. Si un seguimiento coincide fuera de esta ventana, se pospone automáticamente a las 09:00 del día siguiente.
              </p>
            </div>

            {/* Zona Horaria del Negocio */}
            <div className="space-y-1.5">
              <label htmlFor="modal-timezone" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Zona Horaria del Negocio
              </label>
              <select
                id="modal-timezone"
                value={settingTimezone}
                onChange={(e) => setSettingTimezone(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500"
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">
                Garantiza que el horario 09:00 a 20:00 se calcule exactamente según la hora de tu tienda.
              </p>
            </div>

            {/* Secuencia fija V1 */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Secuencia Automática de Mensajes
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="p-2 rounded-lg bg-white border border-slate-200">
                  <div className="font-bold text-indigo-600">1.º Envío</div>
                  <div className="text-slate-600 text-[11px] mt-0.5">después de 6 h</div>
                </div>
                <div className="p-2 rounded-lg bg-white border border-slate-200">
                  <div className="font-bold text-indigo-600">2.º Envío</div>
                  <div className="text-slate-600 text-[11px] mt-0.5">después de 24 h</div>
                </div>
                <div className="p-2 rounded-lg bg-white border border-slate-200">
                  <div className="font-bold text-indigo-600">3.º Envío</div>
                  <div className="text-slate-600 text-[11px] mt-0.5">después de 48 h</div>
                </div>
              </div>
            </div>

            {/* Reglas de parada */}
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-indigo-50/60 text-indigo-800 text-xs">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <p>
                Los seguimientos se detienen automáticamente si el cliente responde, compra, solicita dejar de recibir mensajes o un asesor toma la conversación.
              </p>
            </div>

            {/* Botones de acción */}
            <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 text-sm font-medium rounded-xl text-slate-600 bg-slate-100 hover:bg-slate-200 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingSettings}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 shadow-sm transition cursor-pointer"
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
