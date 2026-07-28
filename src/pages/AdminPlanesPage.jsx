import { useState, useEffect } from 'react';
import {
  PlusCircle,
  Check,
  X,
  PencilSimple,
  Sparkle,
  TreeStructure,
  DeviceMobile,
  ChatText,
  Coins,
  Trash,
  CheckCircle,
  WarningCircle,
  Package,
  Megaphone,
  Robot,
  Star,
} from '@phosphor-icons/react';
import * as planService from '../services/planService';
import { useUnsavedChanges } from '../context/UnsavedChangesContext';



/* ─── Skeleton de Tarjetas de Precios ─── */
function CardSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
      {[1, 2, 3].map(n => (
        <div key={n} className="bg-card border border-line rounded-xl shadow p-6 space-y-6 animate-pulse">
          <div className="text-center space-y-3 pb-5 border-b border-line">
            <div className="h-4 bg-line rounded w-20 mx-auto" />
            <div className="h-8 bg-line rounded w-32 mx-auto" />
          </div>
          <div className="space-y-3.5">
            {[1, 2, 3, 4].map(f => (
              <div key={f} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-line" />
                <div className="h-3 bg-line rounded w-3/4" />
              </div>
            ))}
          </div>
          <div className="h-10 bg-line rounded w-full pt-4" />
        </div>
      ))}
    </div>
  );
}

/* ─── Componente Principal ─── */
export default function AdminPlanesPage() {
  const [plans, setPlans] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const { setIsDirty } = useUnsavedChanges();
  const setIsFormDirty = setIsDirty;

  const closeModal = () => {
    setShowModal(false);
    setIsFormDirty(false);
  };

  const [selectedPlan, setSelectedPlan] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState('edit'); // 'create' | 'edit'

  // State for form fields
  const [formName, setFormName] = useState('');
  const [formPrice, setFormPrice] = useState(0);
  const [formConnLimit, setFormConnLimit] = useState(1);
  const [formMsgLimit, setFormMsgLimit] = useState(1000);
  const [formMaxProducts, setFormMaxProducts] = useState(10);
  const [formHasCampaigns, setFormHasCampaigns] = useState(false);
  const [formHasAutomations, setFormHasAutomations] = useState(false);
  const [formHasAdvancedMarketing, setFormHasAdvancedMarketing] = useState(false);
  const [formFlowBuilder, setFormFlowBuilder] = useState(false);
  const [formAiBrain, setFormAiBrain] = useState(false);
  const [formPopular, setFormPopular] = useState(false);
  const [formFeatures, setFormFeatures] = useState(['']);
  const [saving, setSaving] = useState(false);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadPlans = async () => {
    setIsLoading(true);
    try {
      const data = await planService.getPlans();
      setPlans(data || []);
    } catch {
      setPlans([]);
      showToast('Error al conectar con el servidor para obtener los planes.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPlans();
  }, []);

  const openEditModal = (plan) => {
    setSelectedPlan(plan);
    setModalMode('edit');
    setFormName(plan.name);
    setFormPrice(plan.price);
    setFormConnLimit(plan.connLimit);
    setFormMsgLimit(plan.msgLimit);
    setFormMaxProducts(plan.maxProducts ?? 10);
    setFormHasCampaigns(plan.hasCampaigns ?? false);
    setFormHasAutomations(plan.hasAutomations ?? false);
    setFormHasAdvancedMarketing(plan.hasAdvancedMarketing ?? false);
    setFormFlowBuilder(plan.flowBuilder);
    setFormAiBrain(plan.aiBrain);
    setFormPopular(plan.popular);
    
    // Normalizar las features a un array de strings
    if (plan.features && plan.features.length > 0) {
      const normalizedFeatures = plan.features.map(f => typeof f === 'string' ? f : f.text);
      setFormFeatures(normalizedFeatures);
    } else {
      setFormFeatures(['']);
    }
    setShowModal(true);
  };

  const openCreateModal = () => {
    setSelectedPlan(null);
    setModalMode('create');
    setFormName('');
    setFormPrice(29);
    setFormConnLimit(1);
    setFormMsgLimit(1000);
    setFormMaxProducts(10);
    setFormHasCampaigns(false);
    setFormHasAutomations(false);
    setFormHasAdvancedMarketing(false);
    setFormFlowBuilder(false);
    setFormAiBrain(false);
    setFormPopular(false);
    setFormFeatures(['']);
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formName.trim()) return;
    setSaving(true);

    const payload = {
      name: formName.trim(),
      price: Number(formPrice),
      connLimit: Number(formConnLimit),
      msgLimit: Number(formMsgLimit),
      maxProducts: Number(formMaxProducts),
      hasCampaigns: formHasCampaigns,
      hasAutomations: formHasAutomations,
      hasAdvancedMarketing: formHasAdvancedMarketing,
      // flowBuilder se sincroniza con hasAutomations (campo legacy, se mantiene consistente)
      flowBuilder: formHasAutomations,
      aiBrain: formAiBrain,
      popular: formPopular,
      features: formFeatures.filter(f => f.trim() !== ''),
    };

    try {
      if (modalMode === 'edit') {
        await planService.updatePlan(selectedPlan.id, payload);
        showToast('Plan actualizado exitosamente en la base de datos.');
      } else {
        await planService.createPlan(payload);
        showToast('Plan creado exitosamente en la base de datos.');
      }
      closeModal();
      await loadPlans();
    } catch (err) {
      console.error('Error al guardar plan:', err);
      showToast(err.message || 'Error al guardar el plan en la base de datos.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePlan = async (id, name) => {
    if (!window.confirm(`¿Seguro que deseas eliminar el plan comercial "${name}"?`)) return;

    try {
      await planService.deletePlan(id);
      setPlans(prev => prev.filter(p => p.id !== id));
      showToast(`Plan "${name}" eliminado exitosamente.`);
    } catch (err) {
      console.error('Error al eliminar plan:', err);
      showToast(err.message || 'Error al eliminar el plan.', 'error');
    }
  };

  return (
    <section aria-labelledby="planes-heading" className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 id="planes-heading" className="text-xl font-bold text-hi">
            Planes y Suscripciones
          </h1>
          <p className="text-sm text-lo mt-0.5">
            Configura y administra los paquetes comerciales que ofreces a tus tenants.
          </p>
        </div>

        <button
          onClick={openCreateModal}
          className="
            flex items-center gap-2 px-4 py-2.5 rounded-md self-start sm:self-auto
            bg-brand text-white text-sm font-semibold
            hover:bg-brand-hover shadow shadow-card transition-all duration-fast cursor-pointer
          "
        >
          <PlusCircle size={18} weight="bold" aria-hidden="true" />
          Crear Nuevo Plan
        </button>
      </div>

      {/* Pricing Cards Grid / Loader */}
      {isLoading ? (
        <CardSkeleton />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
          {plans.map((plan) => {
            return (
              <div
                key={plan.id}
                className={`
                  relative bg-card rounded-xl shadow p-6 flex flex-col justify-between
                  transition-all duration-200 border-2 group
                  ${plan.popular
                    ? 'border-brand ring-4 ring-brand/10 md:scale-[1.03] z-10'
                    : 'border-line hover:border-line-strong'
                  }
                `}
              >
                {plan.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-brand text-white text-[10px] font-bold uppercase tracking-wider shadow-sm">
                    Más Popular
                  </span>
                )}

                {/* Botón de eliminación en hover */}
                <button
                  onClick={() => handleDeletePlan(plan.id, plan.name)}
                  className="absolute top-4 right-4 p-1.5 rounded-md text-muted hover:text-danger hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all duration-fast cursor-pointer z-20"
                  title="Eliminar Plan"
                >
                  <Trash size={15} />
                </button>

                <div>
                  {/* Header Info */}
                  <div className="text-center pb-5 border-b border-line mb-5">
                    <h3 className="text-lg font-bold text-hi">{plan.name}</h3>
                    <div className="mt-4 flex items-baseline justify-center font-mono">
                      <span className="text-3xl font-extrabold text-hi">S/ {plan.price}</span>
                      <span className="text-sm text-lo ml-1">/ mes</span>
                    </div>
                  </div>

                  {/* Features List */}
                  <ul className="space-y-3.5 mb-8" role="list">
                    {plan.features && plan.features.map((feature, i) => {
                      const text = typeof feature === 'string' ? feature : feature.text;
                      const included = typeof feature === 'string' ? true : feature.included;
                      return (
                        <li key={i} className="flex items-start gap-3">
                          {included ? (
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-50 text-success flex items-center justify-center border border-emerald-200">
                              <Check size={12} weight="bold" />
                            </span>
                          ) : (
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-50 text-lo flex items-center justify-center border border-line">
                              <X size={10} weight="bold" />
                            </span>
                          )}
                          <span className={`text-sm ${included ? 'text-mid' : 'text-lo line-through decoration-gray-300'}`}>
                            {text}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {/* Action Button */}
                <button
                  onClick={() => openEditModal(plan)}
                  className={`
                    w-full flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-semibold transition-all duration-fast cursor-pointer
                    ${plan.popular
                      ? 'bg-brand text-white hover:bg-brand-hover shadow-card'
                      : 'bg-app text-mid hover:bg-line border border-line'
                    }
                  `}
                >
                  <PencilSimple size={16} />
                  Editar Plan
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-plan-title"
        >
          <div className="absolute inset-0 bg-hi/20 backdrop-blur-sm" onClick={() => setShowModal(false)} aria-hidden="true" />

          <div className="relative bg-card rounded-xl shadow-card-md border border-line w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden my-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-line flex-shrink-0 bg-card z-10">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center">
                  <Coins size={16} className="text-brand" aria-hidden="true" />
                </div>
                <div>
                  <p id="modal-plan-title" className="text-sm font-bold text-hi">
                    {modalMode === 'edit' ? 'Editar Plan Asignado' : 'Crear Nuevo Plan'}
                  </p>
                  <p className="text-xs text-lo">Configura los límites y características del plan</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="p-1.5 rounded-md text-lo hover:text-hi hover:bg-app transition-colors duration-fast cursor-pointer"
                aria-label="Cerrar modal"
              >
                <X size={18} />
              </button>
            </div>

            {/* Formulario */}
            <form onSubmit={handleSave} onChange={() => setIsFormDirty(true)} className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1 min-h-0">
                {/* Plan Name & Price */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="plan-name" className="block text-sm font-semibold text-hi mb-1">
                      Nombre del Plan
                    </label>
                    <input
                      id="plan-name"
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="ej. Pro Plus"
                      className="w-full px-3 py-2 rounded-md border border-line bg-card text-sm text-hi placeholder:text-muted focus:outline-none focus:border-brand"
                    />
                  </div>
                  <div>
                    <label htmlFor="plan-price" className="block text-sm font-semibold text-hi mb-1">
                      Precio Mensual (S/)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-lo font-semibold">S/</span>
                      <input
                        id="plan-price"
                        type="number"
                        required
                        value={formPrice}
                        onChange={(e) => setFormPrice(e.target.value)}
                        placeholder="99"
                        className="w-full pl-9 pr-3 py-2 rounded-md border border-line bg-card text-sm text-hi font-mono focus:outline-none focus:border-brand"
                      />
                    </div>
                  </div>
                </div>

                {/* Connection Limit */}
                <div>
                  <label htmlFor="plan-conn" className="block text-sm font-semibold text-hi mb-1">
                    Límite de Conexiones WhatsApp
                  </label>
                  <div className="relative">
                    <DeviceMobile className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                    <input
                      id="plan-conn"
                      type="number"
                      required
                      value={formConnLimit}
                      onChange={(e) => setFormConnLimit(e.target.value)}
                      placeholder="3"
                      className="w-full pl-9 pr-3 py-2 rounded-md border border-line bg-card text-sm text-hi font-mono focus:outline-none focus:border-brand"
                    />
                  </div>
                </div>

                {/* Monthly Message Limit */}
                <div>
                  <label htmlFor="plan-msgs" className="block text-sm font-semibold text-hi mb-1">
                    Límite de Mensajes Mensuales
                  </label>
                  <div className="relative">
                    <ChatText className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                    <input
                      id="plan-msgs"
                      type="number"
                      required
                      value={formMsgLimit}
                      onChange={(e) => setFormMsgLimit(e.target.value)}
                      placeholder="10000"
                      className="w-full pl-9 pr-3 py-2 rounded-md border border-line bg-card text-sm text-hi font-mono focus:outline-none focus:border-brand"
                    />
                  </div>
                </div>

                {/* Módulos Premium */}
                <div className="space-y-3 pt-2">
                  <p className="text-xs font-semibold text-lo uppercase tracking-wider">Límites de Features</p>

                  {/* Max Products */}
                  <div>
                    <label htmlFor="plan-maxproducts" className="block text-sm font-semibold text-hi mb-1">
                      Máximo de Productos en Inventario
                    </label>
                    <div className="relative">
                      <Package className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                      <input
                        id="plan-maxproducts"
                        type="number"
                        required
                        min={1}
                        value={formMaxProducts}
                        onChange={(e) => setFormMaxProducts(e.target.value)}
                        placeholder="10"
                        className="w-full pl-9 pr-3 py-2 rounded-md border border-line bg-card text-sm text-hi font-mono focus:outline-none focus:border-brand"
                      />
                    </div>
                    <p className="text-2xs text-lo mt-1">Usa 999999 para ilimitado.</p>
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  <p className="text-xs font-semibold text-lo uppercase tracking-wider">Módulos Adicionales</p>

                  <div className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2">
                      <Sparkle size={16} className="text-purple-600" />
                      <div>
                        <p className="text-sm font-medium text-hi leading-tight">Habilitar Cerebro IA</p>
                        <p className="text-2xs text-lo mt-0.5 font-medium">Integración con Gemini/Groq</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={formAiBrain}
                      onClick={() => { setFormAiBrain(!formAiBrain); setIsFormDirty(true); }}
                      className={`
                        relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
                        transition-colors duration-200 focus:outline-none
                        ${formAiBrain ? 'bg-brand' : 'bg-gray-200'}
                      `}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${formAiBrain ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {/* Campañas Masivas */}
                  <div className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2">
                      <Megaphone size={16} className="text-blue-500" />
                      <div>
                        <p className="text-sm font-medium text-hi leading-tight">Campañas Masivas</p>
                        <p className="text-2xs text-lo mt-0.5 font-medium">Envíos masivos a contactos</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={formHasCampaigns}
                      onClick={() => { setFormHasCampaigns(!formHasCampaigns); setIsFormDirty(true); }}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${formHasCampaigns ? 'bg-brand' : 'bg-gray-200'}`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${formHasCampaigns ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {/* Flow Builder y Automatizaciones */}
                  <div className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2">
                      <TreeStructure size={16} className="text-indigo-500" />
                      <div>
                        <p className="text-sm font-medium text-hi leading-tight">Flow Builder y Automatizaciones</p>
                        <p className="text-2xs text-lo mt-0.5 font-medium">Acceso al constructor visual de flujos y respuestas automáticas</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={formHasAutomations}
                      onClick={() => { setFormHasAutomations(!formHasAutomations); setIsFormDirty(true); }}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${formHasAutomations ? 'bg-brand' : 'bg-gray-200'}`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${formHasAutomations ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {/* Marketing Avanzado */}
                  <div className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2">
                      <Star size={16} className="text-amber-500" />
                      <div>
                        <p className="text-sm font-medium text-hi leading-tight">Modo Vendedor Persuasivo</p>
                        <p className="text-2xs text-lo mt-0.5 font-medium">Estrategias avanzadas de marketing IA</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={formHasAdvancedMarketing}
                      onClick={() => { setFormHasAdvancedMarketing(!formHasAdvancedMarketing); setIsFormDirty(true); }}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${formHasAdvancedMarketing ? 'bg-amber-500' : 'bg-gray-200'}`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${formHasAdvancedMarketing ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2">
                      <Coins size={16} className="text-brand" />
                      <div>
                        <p className="text-sm font-medium text-hi leading-tight">Plan Destacado (Popular)</p>
                        <p className="text-2xs text-lo mt-0.5 font-medium">Muestra un badge visual llamativo</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={formPopular}
                      onClick={() => { setFormPopular(!formPopular); setIsFormDirty(true); }}
                      className={`
                        relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
                        transition-colors duration-200 focus:outline-none
                        ${formPopular ? 'bg-brand' : 'bg-gray-200'}
                      `}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${formPopular ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>
                </div>

                {/* Beneficios Dinámicos */}
                <div className="space-y-2.5 pt-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-lo uppercase tracking-wider">Beneficios del Plan</p>
                    <button
                      type="button"
                      onClick={() => setFormFeatures([...formFeatures, ''])}
                      className="text-xs font-bold text-brand hover:text-brand-hover flex items-center gap-1 cursor-pointer"
                    >
                      + Añadir Beneficio
                    </button>
                  </div>
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                    {formFeatures.map((feature, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="text"
                          required
                          value={feature}
                          onChange={(e) => {
                            const newFeats = [...formFeatures];
                            newFeats[idx] = e.target.value;
                            setFormFeatures(newFeats);
                          }}
                          placeholder="ej. Soporte 24/7"
                          className="flex-1 px-3 py-1.5 rounded-md border border-line bg-card text-xs text-hi placeholder:text-muted focus:outline-none focus:border-brand"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const newFeats = formFeatures.filter((_, i) => i !== idx);
                            setFormFeatures(newFeats.length > 0 ? newFeats : ['']);
                          }}
                          className="p-1.5 rounded-md border border-line hover:border-danger hover:text-danger bg-card text-lo transition-colors duration-fast cursor-pointer"
                          title="Eliminar beneficio"
                        >
                          <Trash size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-app border-t border-line flex items-center justify-end gap-3 flex-shrink-0 z-10">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-xs font-semibold border border-line bg-card text-hi hover:bg-app rounded-md transition-colors duration-fast cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-hover shadow transition-colors cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Guardando...' : (modalMode === 'edit' ? 'Guardar Cambios' : 'Crear Plan')}
                </button>
              </div>
            </form>
          </div>
        </div>
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
