import { useState, useEffect, useMemo } from 'react';
import {
  Buildings,
  Plus,
  PencilSimple,
  ChartBar,
  Power,
  X,
  Check,
  CaretDown,
  MagnifyingGlass,
  CurrencyDollar,
  Warning,
  CheckCircle,
  XCircle,
  ArrowRight,
  SealCheck,
  WarningCircle,
  ArrowClockwise,
  SignIn,
  Key,
} from '@phosphor-icons/react';
import * as tenantService from '../services/tenantService';
import * as planService from '../services/planService';
import { useUnsavedChanges } from '../context/UnsavedChangesContext';

const PLAN_CONFIG = {
  Básico: {
    cls: 'bg-gray-100 text-lo ring-1 ring-line',
    dot: 'bg-gray-400',
    msgLimit: 1000,
    connLimit: 1,
  },
  Pro: {
    cls: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
    dot: 'bg-violet-500',
    msgLimit: 10000,
    connLimit: 3,
  },
  Elite: {
    cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    dot: 'bg-amber-500',
    msgLimit: 50000,
    connLimit: 10,
  },
};

const PLANS = ['Básico', 'Pro', 'Elite'];



/* ─── Helpers ─── */
function pct(used, limit) {
  if (!limit) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function QuotaBar({ used, limit }) {
  const p = pct(used, limit);
  const barColor =
    p >= 90 ? 'bg-red-500' :
    p >= 70 ? 'bg-amber-500' :
              'bg-emerald-500';
  return (
    <div className="flex flex-col gap-1 min-w-[100px]">
      <div className="flex items-center justify-between">
        <span className="text-2xs text-lo font-mono">{(used || 0).toLocaleString()} / {(limit || 0).toLocaleString()}</span>
        <span className={`text-2xs font-bold ${p >= 90 ? 'text-danger' : p >= 70 ? 'text-warning' : 'text-lo'}`}>
          {p}%
        </span>
      </div>
      <div className="h-1.5 w-full bg-app rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

function PlanBadge({ plan }) {
  const cfg = PLAN_CONFIG[plan] ?? PLAN_CONFIG['Básico'];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-bold ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {plan}
    </span>
  );
}

function StatusBadge({ active }) {
  return active ? (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
      <CheckCircle size={11} weight="bold" /> Activo
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-semibold bg-red-50 text-danger ring-1 ring-red-200">
      <XCircle size={11} weight="bold" /> Suspendido
    </span>
  );
}

/* ─── Fila Desktop ─── */
function CompanyRow({ company, onToggleStatus, onEditCompany, onImpersonate }) {
  const cfg = PLAN_CONFIG[company.plan] || PLAN_CONFIG['Básico'];
  return (
    <tr className="border-b border-line hover:bg-app/50 transition-colors duration-fast group">
      <td className="px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand/10 flex items-center justify-center flex-shrink-0">
            <Buildings size={17} className="text-brand" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-hi truncate">{company.name}</p>
            <p className="text-xs text-lo truncate">{company.email}</p>
          </div>
        </div>
      </td>

      <td className="px-5 py-4">
        <PlanBadge plan={company.plan} />
      </td>

      <td className="px-5 py-4 w-44">
        <QuotaBar used={company.connUsed} limit={company.connLimit || cfg.connLimit} />
      </td>

      <td className="px-5 py-4 w-48">
        <QuotaBar used={company.msgUsed} limit={company.msgLimit || cfg.msgLimit} />
      </td>

      <td className="px-5 py-4">
        <StatusBadge active={company.active} />
      </td>

      <td className="px-5 py-4">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-fast">
          <button
            onClick={() => onEditCompany(company)}
            className="p-1.5 rounded-md text-muted hover:text-brand hover:bg-brand/10 transition-colors duration-fast cursor-pointer"
            title="Editar Empresa"
          >
            <PencilSimple size={15} />
          </button>
          {/* 
          <button
            onClick={() => {}}
            className="p-1.5 rounded-md text-muted hover:text-violet-600 hover:bg-violet-50 transition-colors duration-fast cursor-pointer"
            title="Ver analíticas (En construcción)"
          >
            <ChartBar size={15} />
          </button>
          */}
          <button
            onClick={() => onImpersonate(company.id, company.name)}
            className="p-1.5 rounded-md text-muted hover:text-emerald-600 hover:bg-emerald-50 transition-colors duration-fast cursor-pointer"
            title="Administrar empresa (Modo Soporte)"
          >
            <SignIn size={15} />
          </button>
          <button
            onClick={() => onToggleStatus(company.id, company.active, company.name)}
            className={`p-1.5 rounded-md transition-colors duration-fast cursor-pointer ${
              company.active
                ? 'text-muted hover:text-danger hover:bg-red-50'
                : 'text-muted hover:text-emerald-600 hover:bg-emerald-50'
            }`}
            title={company.active ? 'Suspender cuenta' : 'Activar cuenta'}
          >
            <Power size={15} />
          </button>
        </div>
      </td>
    </tr>
  );
}

/* ─── Tarjeta Móvil ─── */
function CompanyCard({ company, onToggleStatus, onEditCompany, onImpersonate }) {
  const cfg = PLAN_CONFIG[company.plan] || PLAN_CONFIG['Básico'];
  return (
    <div className="bg-card border border-line rounded-lg shadow-card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-brand/10 flex items-center justify-center flex-shrink-0">
            <Buildings size={16} className="text-brand" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-hi truncate">{company.name}</p>
            <p className="text-xs text-lo truncate">{company.email}</p>
          </div>
        </div>
        <StatusBadge active={company.active} />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <PlanBadge plan={company.plan} />
        <span className="text-2xs text-muted">Desde {company.createdAt || '—'}</span>
      </div>
      <div className="space-y-2">
        <p className="text-2xs text-lo uppercase tracking-wider font-medium">Conexiones</p>
        <QuotaBar used={company.connUsed} limit={company.connLimit || cfg.connLimit} />
        <p className="text-2xs text-lo uppercase tracking-wider font-medium pt-1">Mensajes</p>
        <QuotaBar used={company.msgUsed} limit={company.msgLimit || cfg.msgLimit} />
      </div>
      <div className="flex items-center gap-2 border-t border-line pt-3 flex-wrap">
        <button
          onClick={() => onEditCompany(company)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-line text-xs font-medium text-mid hover:bg-app cursor-pointer transition-colors"
        >
          <PencilSimple size={12} /> Editar
        </button>
        <button
          onClick={() => onImpersonate(company.id, company.name)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-line text-xs font-medium text-emerald-700 hover:bg-emerald-50 cursor-pointer transition-colors"
        >
          <SignIn size={12} /> Soporte
        </button>
        <button
          onClick={() => onToggleStatus(company.id, company.active, company.name)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium cursor-pointer transition-colors ml-auto ${
            company.active
              ? 'border-red-200 text-danger hover:bg-red-50'
              : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
          }`}
        >
          <Power size={12} />
          {company.active ? 'Suspender' : 'Activar'}
        </button>
      </div>
    </div>
  );
}

/* ─── Modal Registrar Nueva Empresa ─── */
function NewCompanyModal({ onClose, onSave, setIsDirty }) {
  const [planOpen, setPlanOpen] = useState(false);
  const [plan, setPlan] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [msgLimit, setMsgLimit] = useState(1000);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (plan) {
      setMsgLimit(PLAN_CONFIG[plan]?.msgLimit || 1000);
    }
  }, [plan]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !email || !plan) return;
    setSaving(true);
    try {
      await onSave({
        name,
        email,
        plan,
        msgLimit: Number(msgLimit),
        connLimit: PLAN_CONFIG[plan]?.connLimit || 1,
        active: true,
        connUsed: 0,
        msgUsed: 0,
        createdAt: new Date().toLocaleDateString('es-ES', { month: 'short', year: 'numeric' }),
      });
      setIsDirty(false);
      onClose();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog">
      <div className="absolute inset-0 bg-hi/20 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-card rounded-xl shadow-card-md border border-line w-full max-w-md flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center">
              <Buildings size={16} className="text-brand" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-bold text-hi">Registrar Nueva Empresa</p>
              <p className="text-xs text-lo">Configura el tenant en la plataforma SaaS</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-lo hover:text-hi hover:bg-app transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} onChange={() => setIsDirty(true)} className="px-6 py-5 space-y-4">
          <div>
            <label htmlFor="emp-name" className="block text-sm font-semibold text-hi mb-1">Nombre del Negocio</label>
            <input
              id="emp-name"
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="ej. TechCorp S.A."
              className="w-full px-3.5 py-2.5 rounded-md border border-line bg-card text-sm text-hi placeholder:text-muted focus:outline-none focus:border-brand"
            />
          </div>

          <div>
            <label htmlFor="emp-email" className="block text-sm font-semibold text-hi mb-1">Correo del Propietario</label>
            <input
              id="emp-email"
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@empresa.com"
              className="w-full px-3.5 py-2.5 rounded-md border border-line bg-card text-sm text-hi placeholder:text-muted focus:outline-none focus:border-brand"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-hi mb-1">Plan Asignado</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setPlanOpen(!planOpen)}
                className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-md border border-line bg-card text-sm hover:border-line-strong focus:outline-none cursor-pointer"
              >
                <span className={plan ? 'text-hi' : 'text-muted'}>
                  {plan ? (
                    <span className="flex items-center gap-2">
                      <SealCheck size={14} className="text-brand" />
                      {plan}
                    </span>
                  ) : 'Seleccionar plan...'}
                </span>
                <CaretDown size={14} className={`text-muted transition-transform duration-200 ${planOpen ? 'rotate-180' : ''}`} />
              </button>

              {planOpen && (
                <ul className="absolute left-0 right-0 top-full mt-1 z-20 bg-card border border-line rounded-lg shadow-card-md overflow-hidden">
                  {PLANS.map(p => (
                    <li key={p}>
                      <button
                        type="button"
                        onClick={() => { setPlan(p); setPlanOpen(false); setIsDirty(true); }}
                        className={`flex items-center justify-between w-full px-4 py-3 text-sm hover:bg-app cursor-pointer ${plan === p ? 'text-brand font-semibold' : 'text-mid'}`}
                      >
                        <PlanBadge plan={p} />
                        {plan === p && <Check size={14} className="text-brand flex-shrink-0" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="emp-msg-limit" className="block text-sm font-semibold text-hi mb-1">Límite de Mensajes Mensuales</label>
            <div className="relative">
              <input
                id="emp-msg-limit"
                type="number"
                value={msgLimit}
                onChange={e => setMsgLimit(Number(e.target.value))}
                className="w-full pl-3.5 pr-16 py-2.5 rounded-md border border-line bg-card text-sm text-hi font-mono focus:outline-none focus:border-brand"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-muted">msg/mes</span>
            </div>
          </div>

          <div className="flex items-center justify-between px-6 py-4 border-t border-line bg-app -mx-6 -mb-5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-md border border-line bg-card text-sm font-medium text-mid hover:bg-app"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !name || !email || !plan}
              className="flex items-center gap-2 px-4 py-2.5 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-hover shadow shadow-card cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Registrando...' : 'Registrar Empresa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Modal Editar Empresa Unificado ─── */
function EditCompanyModal({ company, onClose, onSave, setIsDirty }) {
  const [name, setName] = useState(company.name || '');
  const [password, setPassword] = useState('');
  const [plan, setPlan] = useState(company.plan || '');
  const [plans, setPlans] = useState([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchPlans = async () => {
      try {
        const data = await planService.getPlans();
        setPlans(data || []);
      } catch (err) {
        console.error('Error al cargar planes:', err);
      } finally {
        setLoadingPlans(false);
      }
    };
    fetchPlans();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        plan: plan,
      };
      if (password.trim().length >= 4) {
        payload.password = password.trim();
      }
      await onSave(company.id, payload);
      setIsDirty(false);
      onClose();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog">
      <div className="absolute inset-0 bg-hi/25 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-line rounded-lg shadow-card-md w-full max-w-sm overflow-hidden z-10">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div>
            <p className="text-sm font-bold text-hi">Editar Empresa</p>
            <p className="text-xs text-lo mt-0.5">{company.name}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-lo hover:bg-app cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} onChange={() => setIsDirty(true)} className="p-5 space-y-4">
          {/* Nombre de la Empresa */}
          <div>
            <label htmlFor="edit-company-name" className="block text-xs font-semibold text-hi mb-1">Nombre de la Empresa</label>
            <input
              id="edit-company-name"
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-card border border-line rounded-md focus:outline-none text-hi"
            />
          </div>

          {/* Contraseña Administrador (Opcional) */}
          <div>
            <label htmlFor="edit-company-password" className="block text-xs font-semibold text-hi mb-1">Nueva Contraseña de Administrador (Opcional)</label>
            <input
              id="edit-company-password"
              type="password"
              minLength={4}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Dejar vacío para no cambiar"
              className="w-full px-3 py-2 text-sm bg-card border border-line rounded-md focus:outline-none text-hi placeholder:text-muted"
            />
          </div>

          {/* Plan comercial select */}
          <div>
            <label htmlFor="edit-company-plan" className="block text-xs font-semibold text-hi mb-1">Plan Comercial</label>
            {loadingPlans ? (
              <div className="text-xs text-lo py-2">Cargando planes...</div>
            ) : (
              <select
                id="edit-company-plan"
                value={plan}
                onChange={e => setPlan(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-card border border-line rounded-md focus:outline-none text-hi cursor-pointer"
              >
                {plans.map(p => (
                  <option key={p.id} value={p.name}>
                    {p.name} - S/ {p.price}/mes
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-line">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-semibold border border-line text-mid hover:bg-app rounded-md"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-3.5 py-2 text-xs font-semibold bg-brand text-white hover:bg-brand-hover rounded-md shadow cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}



/* ─── Skeleton de Tabla ─── */
function TableSkeleton() {
  return (
    <div className="bg-card border border-line rounded-lg shadow-card overflow-hidden">
      <div className="h-10 bg-app border-b border-line" />
      {[1, 2, 3, 4].map(n => (
        <div key={n} className="flex items-center gap-6 px-5 py-4 border-b border-line animate-pulse">
          <div className="flex items-center gap-3 w-1/4">
            <div className="w-9 h-9 rounded-lg bg-line flex-shrink-0" />
            <div className="space-y-1.5 flex-1">
              <div className="h-3.5 bg-line rounded w-28" />
              <div className="h-2.5 bg-line rounded w-36" />
            </div>
          </div>
          <div className="h-5 bg-line rounded-full w-16" />
          <div className="space-y-1.5 w-1/5">
            <div className="h-2 bg-line rounded w-16" />
            <div className="h-1.5 bg-line rounded w-24" />
          </div>
          <div className="space-y-1.5 w-1/5">
            <div className="h-2 bg-line rounded w-16" />
            <div className="h-1.5 bg-line rounded w-28" />
          </div>
          <div className="h-5 bg-line rounded-full w-20 ml-auto" />
        </div>
      ))}
    </div>
  );
}

/* ─── Componente Principal ─── */
export default function AdminEmpresasPage() {
  const [companies, setCompanies] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [toast, setToast] = useState(null);

  const [search, setSearch]       = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selectedCompanyForEdit, setSelectedCompanyForEdit] = useState(null);

  const { setIsDirty } = useUnsavedChanges();
  const setIsFormDirty = setIsDirty;

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadTenants = async () => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const data = await tenantService.getTenants();
      setCompanies(data || []);
    } catch {
      setErrorMsg('No se pudieron obtener las empresas registradas.');
      setCompanies([]);
      showToast('Error al conectar con el servidor maestro.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTenants();
  }, []);

  const handleImpersonate = (tenantId, tenantName) => {
    localStorage.setItem('impersonatedTenantId', tenantId);
    localStorage.setItem('impersonatedTenantName', tenantName);
    window.location.href = '/productos';
  };

  const handleShowAnalytics = (company) => {
    showToast(`Analíticas de "${company.name}" — módulo en construcción.`, 'success');
  };

  const handleCreateTenant = async (newTenantData) => {
    try {
      const created = await tenantService.createTenant({
        name: newTenantData.name,
        email: newTenantData.email,
        plan: newTenantData.plan,
        msgLimit: Number(newTenantData.msgLimit),
        connLimit: Number(newTenantData.connLimit),
      });
      setCompanies(prev => [created, ...prev]);
      showToast('Empresa y administrador principal creados con éxito. Contraseña por defecto: admin123');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Error al registrar la empresa en el servidor.', 'error');
      throw err;
    }
  };

  const handleToggleStatus = async (id, currentActive, name) => {
    const confirmMsg = currentActive
      ? `¿Estás seguro de que deseas suspender la cuenta de ${name}?`
      : `¿Estás seguro de que deseas reactivar la cuenta de ${name}?`;
    
    if (!window.confirm(confirmMsg)) return;

    try {
      const nextStatus = currentActive ? 'suspended' : 'active';
      await tenantService.updateTenantStatus(id, nextStatus);
      setCompanies(prev => prev.map(c => c.id === id ? { ...c, active: !currentActive } : c));
      showToast(`Estado de la empresa ${name} actualizado.`);
    } catch {
      setCompanies(prev => prev.map(c => c.id === id ? { ...c, active: !currentActive } : c));
      showToast(`Modo Local: Estado de ${name} actualizado.`, 'success');
    }
  };

  const handleUpdateCompany = async (id, companyData) => {
    try {
      const response = await tenantService.updateTenantLimits(id, companyData);
      const updatedTenant = response.tenant;
      setCompanies(prev =>
        prev.map(c => (c.id === id ? {
          ...c,
          name: updatedTenant.name || c.name,
          plan: updatedTenant.plan || c.plan,
          connLimit: updatedTenant.connLimit ?? c.connLimit,
          msgLimit: updatedTenant.msgLimit ?? c.msgLimit
        } : c))
      );
      showToast('Empresa actualizada exitosamente.');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Error al actualizar los datos de la empresa.', 'error');
    }
  };

  // Filtrado reactivo
  const filtered = useMemo(() => {
    return companies.filter(c =>
      !search ||
      (c.name && c.name.toLowerCase().includes(search.toLowerCase())) ||
      (c.email && c.email.toLowerCase().includes(search.toLowerCase()))
    );
  }, [companies, search]);

  // Cálculos dinámicos
  const metrics = useMemo(() => {
    const active = companies.filter(c => c.active).length;
    const mrr = companies
      .filter(c => c.active)
      .reduce((acc, c) => acc + (c.plan === 'Elite' ? 299 : c.plan === 'Pro' ? 99 : 29), 0);

    const nearLimit = companies.filter(c => {
      const cfg = PLAN_CONFIG[c.plan] || PLAN_CONFIG['Básico'];
      const cLimit = c.connLimit || cfg.connLimit;
      const mLimit = c.msgLimit || cfg.msgLimit;
      return pct(c.connUsed, cLimit) >= 80 || pct(c.msgUsed, mLimit) >= 80;
    }).length;

    return [
      {
        label: 'Ingresos Recurrentes',
        value: `S/ ${mrr.toLocaleString()}`,
        sub: 'MRR real de empresas activas',
        Icon: CurrencyDollar,
        color: 'text-emerald-600',
        bg: 'bg-emerald-50',
      },
      {
        label: 'Empresas Activas',
        value: String(active),
        sub: `${companies.length} empresas en total`,
        Icon: Buildings,
        color: 'text-brand',
        bg: 'bg-blue-50',
      },
      {
        label: 'Alertas de Límite',
        value: String(nearLimit),
        sub: nearLimit > 0 ? 'Cerca del 80% de cuota' : 'Sin alertas activas',
        Icon: Warning,
        color: nearLimit > 0 ? 'text-amber-600' : 'text-lo',
        bg:    nearLimit > 0 ? 'bg-amber-50' : 'bg-app',
      },
    ];
  }, [companies]);

  return (
    <section aria-labelledby="admin-empresas-heading">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 id="admin-empresas-heading" className="text-xl font-bold text-hi">
            Gestión de Empresas <span className="text-brand">(SaaS)</span>
          </h1>
          <p className="text-sm text-lo mt-0.5">
            Centro de control global — administra empresas, planes y cuotas.
          </p>
        </div>

        <button
          id="btn-registrar-empresa"
          onClick={() => setShowModal(true)}
          className="
            flex items-center gap-2 px-4 py-2.5 rounded-md self-start sm:self-auto
            bg-brand text-white text-sm font-semibold
            hover:bg-brand-hover shadow-card transition-all duration-fast cursor-pointer
          "
        >
          <Buildings size={16} weight="bold" aria-hidden="true" />
          Registrar Nueva Empresa
        </button>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {metrics.map(({ label, value, sub, Icon, color, bg }) => (
          <div key={label} className="bg-card border border-line rounded-lg shadow-card p-5 flex items-start gap-4">
            <div className={`flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0 ${bg}`}>
              <Icon size={20} className={color} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-lo uppercase tracking-wider">{label}</p>
              <p className={`text-2xl font-bold mt-0.5 font-mono ${color}`}>{value}</p>
              <p className="text-2xs text-muted mt-0.5">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabla / Loader / Error */}
      {isLoading ? (
        <TableSkeleton />
      ) : errorMsg && companies.length === 0 ? (
        /* Error de Conexión (Failsafe) */
        <div className="bg-card border border-line rounded-lg shadow-card p-10 text-center space-y-4 max-w-lg mx-auto">
          <WarningCircle size={40} className="mx-auto text-danger" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-hi">{errorMsg}</p>
            <p className="text-xs text-lo mt-1">No pudimos enlazar con el servidor maestro de licencias.</p>
          </div>
          <button
            onClick={loadTenants}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-brand text-white hover:bg-brand-hover rounded-md shadow transition-colors cursor-pointer"
          >
            <ArrowClockwise size={14} />
            Reintentar Conexión
          </button>
        </div>
      ) : (
        <div className="bg-card border border-line rounded-lg shadow-card overflow-hidden">
          {/* Sub-header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-5 py-4 border-b border-line">
            <div className="flex items-center gap-2">
              <Buildings size={16} className="text-lo" aria-hidden="true" />
              <p className="text-sm font-semibold text-hi">Directorio de Empresas</p>
              <span className="text-xs text-muted font-mono bg-app px-1.5 py-0.5 rounded-full">
                {companies.length}
              </span>
            </div>

            <div className="relative w-full sm:w-64">
              <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar empresa o correo..."
                className="w-full pl-8 pr-3 py-2 rounded-md border border-line bg-app text-sm text-hi placeholder:text-muted focus:outline-none focus:border-brand"
              />
            </div>
          </div>

          {filtered.length > 0 ? (
            <>
              {/* Tabla Desktop */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-app border-b border-line">
                      {['Empresa', 'Plan', 'Conexiones', 'Mensajes / Mes', 'Estado', 'Acciones'].map(col => (
                        <th key={col} className="px-5 py-3 text-left text-2xs font-semibold text-lo uppercase tracking-wider">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(c => (
                      <CompanyRow
                        key={c.id}
                        company={c}
                        onToggleStatus={handleToggleStatus}
                        onEditCompany={setSelectedCompanyForEdit}
                        onImpersonate={handleImpersonate}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Tarjetas Móvil */}
              <div className="lg:hidden p-4 space-y-3">
                {filtered.map(c => (
                  <CompanyCard
                    key={c.id}
                    company={c}
                    onToggleStatus={handleToggleStatus}
                    onEditCompany={setSelectedCompanyForEdit}
                    onImpersonate={handleImpersonate}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="py-12 text-center">
              <Buildings size={36} className="mx-auto text-muted mb-3" aria-hidden="true" />
              <p className="text-sm font-medium text-hi">Sin resultados</p>
              <p className="text-xs text-lo mt-1">Intenta con otro término de búsqueda.</p>
            </div>
          )}

          {/* Footer */}
          <div className="px-5 py-3.5 border-t border-line bg-app flex items-center justify-between">
            <p className="text-xs text-lo">
              Mostrando <span className="font-semibold text-hi">{filtered.length}</span> de <span className="font-semibold text-hi">{companies.length}</span> empresas registradas
            </p>
          </div>
        </div>
      )}

      {/* Modal Registrar Empresa */}
      {showModal && (
        <NewCompanyModal
          onClose={() => { setShowModal(false); setIsFormDirty(false); }}
          onSave={handleCreateTenant}
          setIsDirty={setIsFormDirty}
        />
      )}

      {/* Modal Editar Empresa Unificado */}
      {selectedCompanyForEdit && (
        <EditCompanyModal
          company={selectedCompanyForEdit}
          onClose={() => { setSelectedCompanyForEdit(null); setIsFormDirty(false); }}
          onSave={handleUpdateCompany}
          setIsDirty={setIsFormDirty}
        />
      )}

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
            <CheckCircle size={18} weight="bold" className="text-success flex-shrink-0" />
          ) : (
            <WarningCircle size={18} weight="bold" className="text-danger flex-shrink-0" />
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
