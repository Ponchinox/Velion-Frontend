import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Send,
  Loader2,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  RefreshCw,
  ImagePlus,
  X,
  Image as ImageIcon,
  Calendar,
  Clock,
  Users,
  UserCheck,
  Repeat,
  Plus,
  Search,
  Check,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import * as campaignService from '../services/campaignService';
import * as contactService from '../services/contactService';
import { useUnsavedChanges } from '../context/UnsavedChangesContext';
import Modal from '../components/ui/Modal';

/* ─── Configuración de estilos visuales por estado ─── */
const STATUS_CONFIG = {
  scheduled: {
    label: 'Programada',
    className: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-800/50',
    icon: Clock
  },
  running: {
    label: 'Enviando',
    className: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200 animate-pulse dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800/50',
    icon: RefreshCw
  },
  completed: {
    label: 'Completada',
    className: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50',
    icon: CheckCircle2
  },
  failed: {
    label: 'Fallida',
    className: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-800/50',
    icon: AlertCircle
  },
  pending: {
    label: 'Pendiente',
    className: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-300 dark:ring-yellow-800/50',
    icon: Clock
  }
};

/* ─── Configuración de etiquetas de recurrencia ─── */
const RECURRENCE_CONFIG = {
  NONE: {
    label: 'Una sola vez',
    className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-slate-700'
  },
  EVERY_15_DAYS: {
    label: 'Cada 15 días',
    className: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 ring-1 ring-blue-200 dark:ring-blue-800'
  },
  MONTHLY: {
    label: 'Mensual',
    className: 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 ring-1 ring-purple-200 dark:ring-purple-800'
  }
};

/* ─── Helper para convertir Date local a string formato "YYYY-MM-DDTHH:mm" ─── */
function toLocalDatetimeInputString(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${y}-${m}-${d}T${h}:${min}`;
}

/* ─── Helper para formatear fechas a formato amigable en hora local ─── */
function formatLocalDisplayDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '—';
  }
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [toast, setToast] = useState(null);

  // Modal de creación
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Estados del formulario
  const [name, setName] = useState('');
  const [baseMessage, setBaseMessage] = useState('');
  const [audienceType, setAudienceType] = useState('all'); // 'all' | 'manual'
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  
  // Programación y Recurrencia
  const [scheduleMode, setScheduleMode] = useState('now'); // 'now' | 'scheduled'
  const [scheduledDateTime, setScheduledDateTime] = useState('');
  const [recurrenceType, setRecurrenceType] = useState('NONE'); // 'NONE' | 'EVERY_15_DAYS' | 'MONTHLY'

  // Delays y multimedia
  const [delayMin, setDelayMin] = useState(10);
  const [delayMax, setDelayMax] = useState(20);
  const [mediaFile, setMediaFile] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Submitting y errores de modal
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  // Directorio de contactos para selección manual
  const [contacts, setContacts] = useState([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const [contactSearch, setContactSearch] = useState('');

  const { setIsDirty } = useUnsavedChanges();
  const fileInputRef = useRef(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  /* ─── Cargar historial de campañas ─── */
  const loadCampaigns = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const data = await campaignService.getCampaigns();
      setCampaigns(data || []);
    } catch (err) {
      setErrorMsg(err.message || 'No se pudo conectar con el motor de campañas.');
      showToast(err.message || 'Error al recuperar historial de difusiones.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  /* ─── Cargar contactos del tenant para audiencia manual ─── */
  const loadContacts = useCallback(async () => {
    if (contacts.length > 0) return; // ya cargados
    setIsLoadingContacts(true);
    try {
      const data = await contactService.getContacts();
      setContacts(data || []);
    } catch (err) {
      console.error('Error al cargar contactos:', err);
      showToast('No se pudieron cargar los contactos para la selección manual.', 'error');
    } finally {
      setIsLoadingContacts(false);
    }
  }, [contacts.length]);

  useEffect(() => {
    loadCampaigns();

    // Auto-polling cada 15 segundos para actualizar el estado del scheduler
    const interval = setInterval(async () => {
      try {
        const data = await campaignService.getCampaigns();
        setCampaigns(data || []);
      } catch (err) {
        console.warn('Error en auto-polling de campañas:', err);
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [loadCampaigns]);

  // Si cambia a audiencia manual, cargar contactos
  useEffect(() => {
    if (audienceType === 'manual' && isModalOpen) {
      loadContacts();
    }
  }, [audienceType, isModalOpen, loadContacts]);

  /* ─── Abrir modal con valores por defecto ─── */
  const handleOpenModal = () => {
    // Inicializar fecha programada por defecto a 1 hora en el futuro
    const defaultFuture = new Date(Date.now() + 60 * 60 * 1000);
    setScheduledDateTime(toLocalDatetimeInputString(defaultFuture));
    setName('');
    setBaseMessage('');
    setAudienceType('all');
    setSelectedContactIds([]);
    setScheduleMode('now');
    setRecurrenceType('NONE');
    setDelayMin(10);
    setDelayMax(20);
    setMediaFile(null);
    setModalError('');
    setIsSubmitting(false);
    setShowAdvanced(false);
    setIsModalOpen(true);
    setIsDirty(false);
  };

  const handleCloseModal = () => {
    if (isSubmitting) return;
    setIsModalOpen(false);
    setIsDirty(false);
    setModalError('');
  };

  /* ─── Manejo de imagen ─── */
  const handleMediaChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validación de tamaño (máx 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setModalError('La imagen no puede exceder 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setMediaFile({
        file,
        base64: reader.result,
        name: file.name
      });
      setIsDirty(true);
    };
    reader.readAsDataURL(file);
  };

  /* ─── Lógica de cambio de recurrencia ─── */
  const handleRecurrenceChange = (newRecurrence) => {
    setRecurrenceType(newRecurrence);
    setIsDirty(true);
    // Si elige cada 15 días o mensual, forzar modo de programación
    if (newRecurrence !== 'NONE' && scheduleMode === 'now') {
      setScheduleMode('scheduled');
      if (!scheduledDateTime) {
        const defaultFuture = new Date(Date.now() + 60 * 60 * 1000);
        setScheduledDateTime(toLocalDatetimeInputString(defaultFuture));
      }
    }
  };

  /* ─── Filtro de contactos para búsqueda ─── */
  const filteredContacts = useMemo(() => {
    const q = contactSearch.toLowerCase().trim();
    if (!q) return contacts;
    return contacts.filter(c =>
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.phone && c.phone.includes(q))
    );
  }, [contacts, contactSearch]);

  const handleToggleContact = (id) => {
    setSelectedContactIds(prev =>
      prev.includes(id) ? prev.filter(cId => cId !== id) : [...prev, id]
    );
    setIsDirty(true);
  };

  const handleSelectAllFilteredContacts = () => {
    const filteredIds = filteredContacts.map(c => c.id);
    setSelectedContactIds(prev => Array.from(new Set([...prev, ...filteredIds])));
    setIsDirty(true);
  };

  const handleClearSelectedContacts = () => {
    setSelectedContactIds([]);
    setIsDirty(true);
  };

  /* ─── Validación en tiempo real del formulario ─── */
  const validationError = useMemo(() => {
    if (!name.trim()) return 'El nombre de la campaña es obligatorio.';
    if (!baseMessage.trim()) return 'El mensaje base es obligatorio.';
    if (audienceType === 'manual' && selectedContactIds.length === 0) {
      return 'Debes seleccionar al menos un contacto para la audiencia manual.';
    }
    if (scheduleMode === 'scheduled' || recurrenceType !== 'NONE') {
      if (!scheduledDateTime) {
        return 'Debes definir una fecha y hora para la programación.';
      }
      const scheduledDate = new Date(scheduledDateTime);
      if (isNaN(scheduledDate.getTime())) {
        return 'La fecha de programación no es válida.';
      }
      if (scheduledDate.getTime() <= Date.now()) {
        return 'La fecha y hora de programación debe ser futura.';
      }
    }
    if (delayMin < 10) return 'El retraso mínimo no puede ser menor a 10 segundos.';
    if (delayMax < 15) return 'El retraso máximo no puede ser menor a 15 segundos.';
    if (delayMin >= delayMax) return 'El retraso máximo debe ser mayor al retraso mínimo.';
    return null;
  }, [name, baseMessage, audienceType, selectedContactIds, scheduleMode, recurrenceType, scheduledDateTime, delayMin, delayMax]);

  /* ─── Envío de campaña ─── */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setModalError('');

    if (validationError) {
      setModalError(validationError);
      return;
    }

    setIsSubmitting(true);

    try {
      // Conversión de hora local a formato ISO UTC para el backend
      let scheduledAtISO = null;
      if (scheduleMode === 'scheduled' || recurrenceType !== 'NONE') {
        const localDate = new Date(scheduledDateTime);
        scheduledAtISO = localDate.toISOString();
      }

      const payload = {
        name: name.trim(),
        baseMessage: baseMessage.trim(),
        audienceType,
        contactIds: audienceType === 'manual' ? selectedContactIds : undefined,
        scheduledAt: scheduledAtISO,
        recurrenceType: recurrenceType || 'NONE',
        delayMin: Number(delayMin),
        delayMax: Number(delayMax),
        media: mediaFile ? mediaFile.base64 : null
      };

      const response = await campaignService.launchCampaign(payload);

      showToast(response.message || 'Campaña registrada con éxito.');
      setIsDirty(false);
      setIsModalOpen(false);
      loadCampaigns();
    } catch (err) {
      console.error('Error al lanzar campaña:', err);
      setModalError(err.message || 'Error al procesar la campaña en el servidor.');
      showToast(err.message || 'No se pudo crear la campaña.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ─── KPIs Resumen ─── */
  const metrics = useMemo(() => {
    const total = campaigns.length;
    const scheduled = campaigns.filter(c => c.status === 'scheduled').length;
    const running = campaigns.filter(c => c.status === 'running').length;
    const completed = campaigns.filter(c => c.status === 'completed').length;
    return { total, scheduled, running, completed };
  }, [campaigns]);

  // Fecha mínima para el input datetime-local (no permitir seleccionar el pasado)
  const minLocalDatetime = useMemo(() => toLocalDatetimeInputString(new Date()), []);

  return (
    <section aria-labelledby="campaigns-heading" className="space-y-6">
      {/* Header Principal */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-line pb-6">
        <div>
          <h1 id="campaigns-heading" className="text-2xl font-extrabold text-hi tracking-tight">
            Campañas y Difusiones
          </h1>
          <p className="text-sm text-lo mt-1">
            Automatiza recordatorios de pago y campañas comerciales con recurrencia y spintax anti-bloqueo.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0 self-start sm:self-auto">
          <button
            type="button"
            onClick={loadCampaigns}
            disabled={isLoading}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-line bg-card text-sm font-semibold text-mid hover:text-hi hover:bg-app transition-colors shadow-xs cursor-pointer disabled:opacity-50"
            title="Refrescar historial"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin text-brand' : ''} />
            <span className="hidden sm:inline">Actualizar</span>
          </button>

          <button
            type="button"
            onClick={handleOpenModal}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-brand text-white font-bold text-sm hover:bg-brand-hover active:scale-[0.98] transition-all duration-fast shadow-md cursor-pointer"
          >
            <Plus size={18} strokeWidth={2.5} />
            <span>Nueva Campaña</span>
          </button>
        </div>
      </div>

      {/* Tarjetas de Métricas Resumen */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-line rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-lo">Total Campañas</span>
            <span className="p-2 rounded-lg bg-app text-mid"><Users size={16} /></span>
          </div>
          <p className="text-2xl font-bold text-hi mt-2 font-mono">{metrics.total}</p>
        </div>

        <div className="bg-card border border-line rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">Programadas</span>
            <span className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400"><Clock size={16} /></span>
          </div>
          <p className="text-2xl font-bold text-hi mt-2 font-mono">{metrics.scheduled}</p>
        </div>

        <div className="bg-card border border-line rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">En Ejecución</span>
            <span className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400"><RefreshCw size={16} className={metrics.running > 0 ? 'animate-spin' : ''} /></span>
          </div>
          <p className="text-2xl font-bold text-hi mt-2 font-mono">{metrics.running}</p>
        </div>

        <div className="bg-card border border-line rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Completadas</span>
            <span className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={16} /></span>
          </div>
          <p className="text-2xl font-bold text-hi mt-2 font-mono">{metrics.completed}</p>
        </div>
      </div>

      {/* Tabla de Historial de Campañas */}
      <div className="bg-card border border-line rounded-xl shadow-sm overflow-hidden flex flex-col min-h-[420px]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line bg-card">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-hi">Historial de Campañas</h2>
            <span className="text-2xs text-muted font-mono bg-app px-2 py-0.5 rounded-full font-bold">
              {campaigns.length}
            </span>
          </div>
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
                type="button"
                onClick={loadCampaigns}
                className="px-4 py-2 text-xs font-semibold bg-brand text-white hover:bg-brand-hover rounded-lg shadow cursor-pointer"
              >
                Reintentar
              </button>
            </div>
          ) : campaigns.length > 0 ? (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line bg-app">
                  <th className="px-5 py-3.5 text-left text-2xs font-semibold text-lo uppercase tracking-wider">Campaña</th>
                  <th className="px-5 py-3.5 text-left text-2xs font-semibold text-lo uppercase tracking-wider">Audiencia</th>
                  <th className="px-5 py-3.5 text-left text-2xs font-semibold text-lo uppercase tracking-wider">Recurrencia</th>
                  <th className="px-5 py-3.5 text-left text-2xs font-semibold text-lo uppercase tracking-wider">Próxima Ejecución</th>
                  <th className="px-5 py-3.5 text-left text-2xs font-semibold text-lo uppercase tracking-wider">Estado</th>
                  <th className="px-5 py-3.5 text-left text-2xs font-semibold text-lo uppercase tracking-wider">Creada</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {campaigns.map((c) => {
                  const statusInfo = STATUS_CONFIG[c.status] || {
                    label: c.status,
                    className: 'bg-gray-100 text-lo ring-1 ring-line',
                    icon: Clock
                  };
                  const StatusIcon = statusInfo.icon;

                  const recurrenceInfo = RECURRENCE_CONFIG[c.recurrenceType] || RECURRENCE_CONFIG.NONE;

                  // Resolución visual de audiencia
                  const isManualAudience = c.audienceType === 'manual' || Array.isArray(c.targetContactIds) || Array.isArray(c.audience);
                  const audienceCount = Array.isArray(c.targetContactIds)
                    ? c.targetContactIds.length
                    : (Array.isArray(c.audience) ? c.audience.length : null);

                  return (
                    <tr key={c.id} className="hover:bg-app/40 transition-colors duration-fast">
                      {/* Campaña */}
                      <td className="px-5 py-4 min-w-[220px]">
                        <p className="text-sm font-bold text-hi">{c.name}</p>
                        <p className="text-xs text-lo truncate max-w-xs mt-0.5" title={c.baseMessage}>
                          {c.baseMessage}
                        </p>
                        {c.media && (
                          <span className="inline-flex items-center gap-1 mt-1 text-[11px] font-semibold text-brand">
                            <ImageIcon size={12} />
                            <span>Con Imagen</span>
                          </span>
                        )}
                      </td>

                      {/* Audiencia */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        {isManualAudience ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-semibold bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-800">
                            <UserCheck size={12} />
                            <span>Manual{audienceCount !== null ? ` (${audienceCount})` : ''}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-semibold bg-sky-50 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-800">
                            <Users size={12} />
                            <span>Todos los contactos</span>
                          </span>
                        )}
                      </td>

                      {/* Recurrencia */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-semibold ${recurrenceInfo.className}`}>
                          <Repeat size={12} />
                          <span>{recurrenceInfo.label}</span>
                        </span>
                      </td>

                      {/* Próxima Ejecución */}
                      <td className="px-5 py-4 whitespace-nowrap text-xs text-hi font-mono">
                        {c.nextRunAt ? (
                          <span className="flex items-center gap-1.5">
                            <Calendar size={13} className="text-brand" />
                            {formatLocalDisplayDate(c.nextRunAt)}
                          </span>
                        ) : c.scheduledAt ? (
                          <span className="flex items-center gap-1.5">
                            <Clock size={13} className="text-lo" />
                            {formatLocalDisplayDate(c.scheduledAt)}
                          </span>
                        ) : (
                          <span className="text-lo">—</span>
                        )}
                      </td>

                      {/* Estado */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-bold ${statusInfo.className}`}>
                          <StatusIcon size={12} />
                          <span>{statusInfo.label}</span>
                        </span>
                      </td>

                      {/* Creada */}
                      <td className="px-5 py-4 whitespace-nowrap text-xs text-lo">
                        {formatLocalDisplayDate(c.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center px-6">
              <Send size={36} className="text-muted mb-3" />
              <p className="text-base font-bold text-hi">Sin campañas registradas</p>
              <p className="text-xs text-lo mt-1 max-w-sm">
                Crea tu primera campaña masiva para comunicar promociones o programar recordatorios de pago recurrentes.
              </p>
              <button
                type="button"
                onClick={handleOpenModal}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-white font-semibold text-xs hover:bg-brand-hover shadow cursor-pointer"
              >
                <Plus size={16} />
                <span>Crear Primera Campaña</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ─── MODAL: NUEVA CAMPAÑA V2 ─── */}
      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title="Nueva Campaña Masiva"
        subtitle="Configura el mensaje, audiencia y programación de envíos recurrentes."
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Banner de error dentro del modal si ocurre */}
          {modalError && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-rose-600" />
              <div className="flex-1">{modalError}</div>
            </div>
          )}

          {/* 1. Nombre de la campaña */}
          <div>
            <label className="block text-xs font-semibold text-mid mb-1.5">
              Nombre de la Campaña <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setIsDirty(true); }}
              placeholder="ej. Recordatorio de Pago Quincenal"
              className="w-full px-3.5 py-2.5 rounded-lg border border-line bg-app text-sm text-hi placeholder:text-muted focus:outline-none focus:border-brand"
              required
            />
          </div>

          {/* 2. Mensaje base */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-mid">
                Mensaje Base <span className="text-rose-500">*</span>
              </label>
              <span className="text-2xs text-lo font-mono">
                {baseMessage.length} caracteres
              </span>
            </div>
            <textarea
              value={baseMessage}
              onChange={e => { setBaseMessage(e.target.value); setIsDirty(true); }}
              placeholder="ej. Hola {Nombre}, te recordamos que tu cuota quincenal vence el día de hoy. Por favor confírmanos tu pago."
              rows={4}
              className="w-full px-3.5 py-2.5 rounded-lg border border-line bg-app text-sm text-hi placeholder:text-muted focus:outline-none focus:border-brand resize-none leading-relaxed"
              required
            />
            <div className="text-2xs text-lo mt-1.5 leading-normal flex items-start gap-1.5 bg-app p-2 rounded-md border border-line">
              <HelpCircle size={13} className="flex-shrink-0 mt-0.5 text-brand" />
              <span>
                Tip: Utiliza <strong className="text-hi font-mono">&#123;Nombre&#125;</strong> o <strong className="text-hi font-mono">[Nombre]</strong> para personalizar con el nombre de cada contacto. El motor de IA generará variaciones automáticas para proteger tu número de WhatsApp.
              </span>
            </div>
          </div>

          {/* 3. Selección de Audiencia */}
          <div>
            <label className="block text-xs font-semibold text-mid mb-2">
              Audiencia de Destino <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => { setAudienceType('all'); setIsDirty(true); }}
                className={`flex items-center gap-3 p-3 rounded-xl border text-left cursor-pointer transition-all ${
                  audienceType === 'all'
                    ? 'border-brand bg-brand/5 ring-1 ring-brand'
                    : 'border-line bg-app hover:bg-app/80'
                }`}
              >
                <div className={`p-2 rounded-lg ${audienceType === 'all' ? 'bg-brand text-white' : 'bg-card text-mid'}`}>
                  <Users size={18} />
                </div>
                <div>
                  <p className="text-xs font-bold text-hi">Todos los contactos</p>
                  <p className="text-2xs text-lo">Envío masivo al directorio completo</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => { setAudienceType('manual'); setIsDirty(true); }}
                className={`flex items-center gap-3 p-3 rounded-xl border text-left cursor-pointer transition-all ${
                  audienceType === 'manual'
                    ? 'border-brand bg-brand/5 ring-1 ring-brand'
                    : 'border-line bg-app hover:bg-app/80'
                }`}
              >
                <div className={`p-2 rounded-lg ${audienceType === 'manual' ? 'bg-brand text-white' : 'bg-card text-mid'}`}>
                  <UserCheck size={18} />
                </div>
                <div>
                  <p className="text-xs font-bold text-hi">Selección manual</p>
                  <p className="text-2xs text-lo">Elige destinatarios específicos</p>
                </div>
              </button>
            </div>

            {/* Panel de selección manual de contactos */}
            {audienceType === 'manual' && (
              <div className="mt-3 p-3 rounded-xl border border-line bg-card space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Buscar por nombre o teléfono..."
                      value={contactSearch}
                      onChange={e => setContactSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-line bg-app text-xs text-hi placeholder:text-muted focus:outline-none focus:border-brand"
                    />
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={handleSelectAllFilteredContacts}
                      className="text-2xs font-semibold text-brand hover:underline cursor-pointer"
                    >
                      Seleccionar todos
                    </button>
                    <span className="text-lo text-2xs">•</span>
                    <button
                      type="button"
                      onClick={handleClearSelectedContacts}
                      className="text-2xs font-semibold text-lo hover:text-hi cursor-pointer"
                    >
                      Limpiar
                    </button>
                  </div>
                </div>

                {/* Contador de seleccionados */}
                <div className="flex items-center justify-between text-2xs text-lo px-1">
                  <span>
                    <strong className="text-hi font-bold">{selectedContactIds.length}</strong> contacto(s) seleccionado(s)
                  </span>
                  <span>{filteredContacts.length} disponibles</span>
                </div>

                {/* Lista scrolleable de contactos */}
                <div className="max-h-36 sm:max-h-44 overflow-y-auto border border-line rounded-lg divide-y divide-line bg-app touch-pan-y [scrollbar-width:thin]">
                  {isLoadingContacts ? (
                    <div className="flex items-center justify-center py-8 gap-2 text-xs text-lo">
                      <Loader2 size={16} className="animate-spin text-brand" />
                      <span>Cargando directorio de contactos...</span>
                    </div>
                  ) : filteredContacts.length > 0 ? (
                    filteredContacts.map(c => {
                      const isSelected = selectedContactIds.includes(c.id);
                      return (
                        <div
                          key={c.id}
                          onClick={() => handleToggleContact(c.id)}
                          className={`flex items-center justify-between p-2.5 cursor-pointer transition-colors ${
                            isSelected ? 'bg-brand/10' : 'hover:bg-card'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                              isSelected ? 'bg-brand border-brand text-white' : 'border-line bg-card'
                            }`}>
                              {isSelected && <Check size={11} strokeWidth={3} />}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-hi truncate">{c.name || 'Sin nombre'}</p>
                              <p className="text-2xs text-lo font-mono">{c.phone}</p>
                            </div>
                          </div>
                          {c.botPaused && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded font-mono">
                              IA Pausada
                            </span>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="py-6 text-center text-xs text-lo">
                      {contactSearch ? 'No hay contactos que coincidan con la búsqueda.' : 'No tienes contactos registrados en este Tenant.'}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 4. Programación y Recurrencia */}
          <div className="p-4 rounded-xl border border-line bg-app space-y-4">
            <div>
              <label className="block text-xs font-semibold text-mid mb-2">
                Momento de Envío <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setScheduleMode('now');
                    setRecurrenceType('NONE');
                    setIsDirty(true);
                  }}
                  className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                    scheduleMode === 'now' && recurrenceType === 'NONE'
                      ? 'border-brand bg-card ring-1 ring-brand'
                      : 'border-line bg-card/60 hover:bg-card'
                  }`}
                >
                  <Send size={16} className={scheduleMode === 'now' && recurrenceType === 'NONE' ? 'text-brand' : 'text-lo'} />
                  <div>
                    <p className="text-xs font-bold text-hi">Enviar ahora</p>
                    <p className="text-2xs text-lo">Inmediato en segundo plano</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setScheduleMode('scheduled');
                    setIsDirty(true);
                  }}
                  className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                    scheduleMode === 'scheduled' || recurrenceType !== 'NONE'
                      ? 'border-brand bg-card ring-1 ring-brand'
                      : 'border-line bg-card/60 hover:bg-card'
                  }`}
                >
                  <Clock size={16} className={scheduleMode === 'scheduled' || recurrenceType !== 'NONE' ? 'text-brand' : 'text-lo'} />
                  <div>
                    <p className="text-xs font-bold text-hi">Programar envío</p>
                    <p className="text-2xs text-lo">Definir fecha y hora específica</p>
                  </div>
                </button>
              </div>
            </div>

            {/* Recurrencia */}
            <div>
              <label className="block text-xs font-semibold text-mid mb-1.5">
                Frecuencia de Recurrencia
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 'NONE', label: 'Una sola vez' },
                  { value: 'EVERY_15_DAYS', label: 'Cada 15 días' },
                  { value: 'MONTHLY', label: 'Mensual' }
                ].map(item => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => handleRecurrenceChange(item.value)}
                    className={`px-3 py-2 rounded-lg border text-xs font-semibold cursor-pointer transition-all text-center ${
                      recurrenceType === item.value
                        ? 'border-brand bg-brand/10 text-brand font-bold'
                        : 'border-line bg-card text-mid hover:text-hi'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {recurrenceType !== 'NONE' && (
                <p className="text-2xs text-brand mt-1.5 flex items-center gap-1 font-medium">
                  <Repeat size={12} />
                  <span>
                    {recurrenceType === 'EVERY_15_DAYS'
                      ? 'El sistema ejecutará la campaña automáticamente cada 15 días tras la fecha inicial.'
                      : 'El sistema repetirá la campaña mensualmente respetando el mismo día sin desfases (cero drift).'}
                  </span>
                </p>
              )}
            </div>

            {/* Selector de fecha y hora (si es programada o recurrente) */}
            {(scheduleMode === 'scheduled' || recurrenceType !== 'NONE') && (
              <div>
                <label className="block text-xs font-semibold text-mid mb-1.5">
                  Fecha y Hora de Inicio (Hora local) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  min={minLocalDatetime}
                  value={scheduledDateTime}
                  onChange={e => { setScheduledDateTime(e.target.value); setIsDirty(true); }}
                  className="w-full px-3.5 py-2 rounded-lg border border-line bg-card text-sm text-hi focus:outline-none focus:border-brand font-mono"
                  required
                />
                <p className="text-2xs text-lo mt-1">
                  Se ejecutará en tu zona horaria local. El backend convertirá automáticamente el horario a UTC.
                </p>
              </div>
            )}
          </div>

          {/* 5. Opciones Avanzadas (Colapsable: Delays Anti-Ban e Imagen) */}
          <div className="border border-line rounded-xl overflow-hidden bg-app">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between p-3 text-xs font-semibold text-mid hover:text-hi cursor-pointer"
            >
              <span>Opciones adicionales (Imagen y Retrasos Anti-Ban)</span>
              {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showAdvanced && (
              <div className="p-3 pt-0 border-t border-line space-y-3 bg-card">
                {/* Adjuntar Imagen */}
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
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-line bg-app text-xs font-semibold text-hi hover:bg-app/80 cursor-pointer"
                    >
                      <ImagePlus size={15} className="text-brand" />
                      <span>{mediaFile ? 'Cambiar Imagen' : 'Seleccionar Imagen'}</span>
                    </button>
                    {mediaFile && (
                      <div className="flex items-center gap-2 bg-app px-2.5 py-1.5 rounded-lg border border-line text-xs max-w-[200px]">
                        <img src={mediaFile.base64} alt="Adjunto" className="w-6 h-6 object-cover rounded" />
                        <span className="truncate flex-1 text-hi font-mono text-[11px]">{mediaFile.name}</span>
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

                {/* Retrasos anti-ban */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-mid mb-1">Retraso Mínimo (seg)</label>
                    <input
                      type="number"
                      min="10"
                      max="120"
                      value={delayMin}
                      onChange={e => { setDelayMin(Number(e.target.value)); setIsDirty(true); }}
                      className="w-full px-3 py-1.5 rounded-lg border border-line bg-app text-xs text-hi font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-mid mb-1">Retraso Máximo (seg)</label>
                    <input
                      type="number"
                      min="15"
                      max="300"
                      value={delayMax}
                      onChange={e => { setDelayMax(Number(e.target.value)); setIsDirty(true); }}
                      className="w-full px-3 py-1.5 rounded-lg border border-line bg-app text-xs text-hi font-mono"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer del modal */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-line pb-1">
            <button
              type="button"
              onClick={handleCloseModal}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold border border-line text-mid hover:bg-app rounded-xl cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || Boolean(validationError)}
              className="flex items-center gap-2 px-5 py-2 text-xs font-bold bg-brand text-white hover:bg-brand-hover rounded-xl shadow-md cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Procesando...</span>
                </>
              ) : recurrenceType !== 'NONE' ? (
                <>
                  <Repeat size={14} />
                  <span>Activar Campaña Recurrente</span>
                </>
              ) : scheduleMode === 'scheduled' ? (
                <>
                  <Clock size={14} />
                  <span>Programar Campaña</span>
                </>
              ) : (
                <>
                  <Send size={14} />
                  <span>Lanzar Campaña Ahora</span>
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Notificaciones Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-card-md text-sm font-medium animate-in slide-in-from-bottom-5 duration-200
            ${toast.type === 'success'
              ? 'bg-card border-emerald-200 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300'
              : 'bg-card border-rose-200 text-rose-700 dark:border-rose-800 dark:text-rose-300'
            }
          `}
          role="status"
          aria-live="polite"
        >
          {toast.type === 'success' ? (
            <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          ) : (
            <AlertCircle size={18} className="text-rose-600 dark:text-rose-400 flex-shrink-0" />
          )}
          <span>{toast.msg}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="ml-2 text-muted hover:text-hi cursor-pointer p-0.5"
            aria-label="Cerrar notificación"
          >
            &times;
          </button>
        </div>
      )}
    </section>
  );
}
