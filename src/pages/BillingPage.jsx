import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../services/api';
import { Cardholder, Check, Sparkle, WarningCircle, CircleNotch, X, Copy, QrCode, ArrowSquareOut } from '@phosphor-icons/react';
import { isDemoUser } from '../utils/demoUtils';

export default function BillingPage() {
  const { user } = useAuth();
  const isDemo = isDemoUser(user);
  const [plans, setPlans] = useState([]);
  const [billingConfig, setBillingConfig] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Estado para el modal de Pago
  const [selectedPlanModal, setSelectedPlanModal] = useState(null);
  const [copiedNumber, setCopiedNumber] = useState(false);

  // Identificar el plan actual
  const currentPlan = user?.plan || 'Básico';

  if (isDemo) {
    return (
      <div className="space-y-8 max-w-4xl mx-auto p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-line pb-6">
          <div>
            <h1 className="text-3xl font-extrabold text-hi tracking-tight">Planes y Facturación</h1>
            <p className="text-sm text-lo mt-1">Monitorea tu plan de suscripción de Velion Agent.</p>
          </div>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-app border border-line rounded-lg">
            <Cardholder size={20} className="text-brand" />
            <span className="text-sm font-semibold text-mid">
              Plan actual: <strong className="text-hi font-bold capitalize">{currentPlan}</strong>
            </span>
          </div>
        </div>

        {/* Notificación de Demostración Segura */}
        <div className="bg-card border-2 border-amber-200 dark:border-amber-900/40 rounded-2xl p-8 sm:p-10 text-center space-y-4 shadow-sm">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 mx-auto">
            <Cardholder size={36} weight="duotone" />
          </div>
          <h2 className="text-2xl font-extrabold text-hi tracking-tight">
            Facturación deshabilitada en entorno de demostración.
          </h2>
          <p className="text-base text-mid max-w-lg mx-auto leading-relaxed">
            Esta cuenta utiliza un plan de evaluación preconfigurado.
          </p>
          <div className="pt-2">
            <span className="inline-block px-4 py-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg text-sm text-emerald-700 dark:text-emerald-300 font-semibold">
              Estado: Plan de Evaluación Activo ({currentPlan})
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Cargar planes dinámicos y configuración de pagos desde el backend
  const loadData = async () => {
    setIsLoading(true);
    try {
      const [data, config] = await Promise.all([
        apiClient('/plans'),
        apiClient('/plans/billing-config').catch(() => null)
      ]);
      setPlans(data || []);
      if (config) {
        setBillingConfig(config);
      }
    } catch (err) {
      console.error('Error al cargar planes dinámicos:', err);
      setError('No se pudo cargar la lista de planes de suscripción.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const hasPaymentDetails = Boolean(
    billingConfig?.paymentMethod && billingConfig?.paymentRecipient
  );

  const handleOpenModal = (plan) => {
    setSelectedPlanModal(plan);
    setCopiedNumber(false);
  };

  const handleCloseModal = () => {
    setSelectedPlanModal(null);
    setCopiedNumber(false);
  };

  const handleCopyRecipient = () => {
    if (!billingConfig?.paymentRecipient) return;
    navigator.clipboard.writeText(billingConfig.paymentRecipient);
    setCopiedNumber(true);
    setTimeout(() => setCopiedNumber(false), 2000);
  };

  // Construir el enlace directo a WhatsApp si existe contacto
  const getWhatsAppLink = () => {
    if (!selectedPlanModal || !billingConfig?.paymentContact) return '#';
    const method = billingConfig.paymentMethod || 'pago';
    const message = `Hola, acabo de realizar el ${method} de S/ ${selectedPlanModal.price} para activar el Plan ${selectedPlanModal.name}. Adjunto la captura del comprobante.`;
    const cleanContact = billingConfig.paymentContact.replace(/\D/g, '');
    return `https://wa.me/${cleanContact}?text=${encodeURIComponent(message)}`;
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-line pb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-hi tracking-tight">Planes y Facturación</h1>
          <p className="text-sm text-lo mt-1">Monitorea y actualiza tu plan de suscripción de Velion Agent.</p>
        </div>
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-app border border-line rounded-lg">
          <Cardholder size={20} className="text-brand" />
          <span className="text-sm font-semibold text-mid">
            Plan actual: <strong className="text-hi font-bold capitalize">{currentPlan}</strong>
          </span>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 px-4 py-3 bg-red-50 border border-danger/20 rounded-md text-sm text-danger max-w-2xl">
          <WarningCircle size={18} weight="fill" className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Cargando */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <CircleNotch size={40} className="text-brand animate-spin" />
          <p className="text-sm text-lo font-semibold">Cargando planes de suscripción dinámicos...</p>
        </div>
      ) : plans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center border-2 border-dashed border-line rounded-2xl bg-card">
          <Cardholder size={48} className="text-muted mb-4" />
          <h3 className="text-lg font-bold text-hi">No hay planes disponibles</h3>
          <p className="text-sm text-lo mt-1 max-w-md">
            El SuperAdmin no ha publicado ningún plan comercial activo en la plataforma todavía. Vuelve a consultar más tarde.
          </p>
        </div>
      ) : (
        /* Grilla de planes dinámicos */
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 pt-4">
          {plans.map((plan) => {
            const isCurrent = currentPlan.toLowerCase() === plan.name.toLowerCase();

            return (
              <div
                key={plan.id}
                className={`
                  bg-card rounded-xl p-6 sm:p-8 flex flex-col justify-between relative overflow-hidden transition-all duration-fast border-2
                  ${plan.popular
                    ? 'border-brand shadow-card-hover md:scale-[1.02]'
                    : 'border-line hover:shadow-card'
                  }
                `}
              >
                {/* Badge Popular */}
                {plan.popular && (
                  <div className="absolute top-4 right-4 inline-flex items-center gap-1 px-2.5 py-1 bg-brand text-white text-[10px] font-bold rounded-full uppercase tracking-wider">
                    <Sparkle size={10} weight="fill" className="animate-pulse" />
                    Recomendado
                  </div>
                )}

                <div className="space-y-6">
                  <div>
                    <p className={`text-xs font-bold uppercase tracking-wider ${plan.popular ? 'text-brand' : 'text-muted'}`}>
                      Plan {plan.name}
                    </p>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className="text-4xl font-extrabold text-hi tracking-tight">S/ {plan.price}</span>
                      <span className="text-sm text-lo font-medium">/ mes</span>
                    </div>
                    <p className="text-sm text-lo mt-3">{plan.description}</p>
                  </div>

                  {/* Features */}
                  <div className="space-y-3 border-t border-line pt-6">
                    <div className="text-xs font-bold text-hi uppercase tracking-wider">Incluye:</div>
                    <ul className="space-y-2.5 text-sm text-mid">
                      <li className="flex items-center gap-2">
                        <Check size={16} weight="bold" className="text-brand flex-shrink-0" />
                        <span><strong>{plan.connLimit}</strong> Conexión de WhatsApp</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check size={16} weight="bold" className="text-brand flex-shrink-0" />
                        <span><strong>{plan.msgLimit ? plan.msgLimit.toLocaleString() : 'Ilimitados'}</strong> Mensajes/mes</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check size={16} weight="bold" className="text-brand flex-shrink-0" />
                        <span><strong>{plan.maxProducts || 10}</strong> Productos en catálogo</span>
                      </li>
                      {plan.hasCampaigns && (
                        <li className="flex items-center gap-2">
                          <Check size={16} weight="bold" className="text-brand flex-shrink-0" />
                          <span>Campañas masivas</span>
                        </li>
                      )}
                      {plan.hasAutomations && (
                        <li className="flex items-center gap-2">
                          <Check size={16} weight="bold" className="text-brand flex-shrink-0" />
                          <span>Automatizaciones y Flujos</span>
                        </li>
                      )}
                      {plan.hasAdvancedMarketing && (
                        <li className="flex items-center gap-2">
                          <Check size={16} weight="bold" className="text-brand flex-shrink-0" />
                          <span>Marketing y analítica avanzada</span>
                        </li>
                      )}
                      <li className="flex items-center gap-2">
                        <Check size={16} weight="bold" className="text-brand flex-shrink-0" />
                        <span>Atención con IA 24/7</span>
                      </li>
                    </ul>
                  </div>
                </div>

                {/* Acciones */}
                <div className="pt-8">
                  {isCurrent ? (
                    <button
                      disabled
                      className="w-full py-3 px-4 bg-app border border-line text-muted rounded-xl text-sm font-bold flex items-center justify-center gap-2 cursor-not-allowed"
                    >
                      <Check size={18} weight="bold" />
                      Plan Actual
                    </button>
                  ) : (
                    <button
                      onClick={() => handleOpenModal(plan)}
                      className={`
                        w-full py-3 px-4 rounded-xl text-sm font-bold transition-all duration-fast flex items-center justify-center gap-2 shadow-sm cursor-pointer
                        ${plan.popular
                          ? 'bg-brand hover:bg-brand-hover text-white'
                          : 'bg-app hover:bg-line border border-line text-hi'
                        }
                      `}
                    >
                      Actualizar a este Plan
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL DE PAGO (Portal) */}
      {selectedPlanModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
          <div className="bg-card border border-line rounded-2xl max-w-md w-full p-6 space-y-6 shadow-2xl relative animate-scaleUp">
            {/* Botón Cerrar */}
            <button
              onClick={handleCloseModal}
              className="absolute top-4 right-4 text-muted hover:text-hi p-1.5 rounded-lg hover:bg-app transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>

            {/* Header del Modal */}
            <div className="text-center space-y-2 pt-2">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-purple-500/10 text-purple-600 dark:text-purple-400 mb-1 border border-purple-500/20">
                <QrCode size={32} weight="duotone" />
              </div>
              <h2 className="text-2xl font-extrabold text-hi tracking-tight">
                Activa tu Plan {selectedPlanModal.name}
              </h2>
              <p className="text-sm text-lo">
                Para activar o renovar tu suscripción, sigue las instrucciones de pago a continuación:
              </p>
            </div>

            {/* Tarjeta de pago o fallback seguro */}
            {hasPaymentDetails ? (
              <div className="bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/50 rounded-xl p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-purple-600 dark:text-purple-300 uppercase tracking-wider">
                    {billingConfig.paymentMethod}
                  </p>
                  <p className="text-2xl font-black text-purple-950 dark:text-purple-100 font-mono mt-0.5">
                    {billingConfig.paymentRecipient}
                  </p>
                </div>
                <button
                  onClick={handleCopyRecipient}
                  className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-sm"
                >
                  {copiedNumber ? (
                    <>
                      <Check size={16} weight="bold" />
                      <span>¡Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={16} weight="bold" />
                      <span>Copiar</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-center space-y-1">
                <p className="text-sm font-semibold text-hi">
                  Contacta al administrador para obtener instrucciones de pago.
                </p>
              </div>
            )}

            {/* Instrucciones */}
            <div className="bg-app border border-line rounded-xl p-4 space-y-2 text-sm text-mid">
              <div className="flex items-center justify-between font-bold text-hi border-b border-line pb-2 mb-1">
                <span>Monto a pagar:</span>
                <span className="text-lg text-brand font-black">S/ {selectedPlanModal.price}</span>
              </div>
              <p className="text-xs leading-relaxed text-lo">
                Una vez realizado el pago de <strong className="text-hi">S/ {selectedPlanModal.price}</strong>, envía una captura de pantalla del comprobante para activar tu cuenta de inmediato.
              </p>
              {billingConfig?.paymentContact ? (
                <p className="text-xs font-semibold text-hi pt-1">
                  Soporte: <span className="font-mono text-brand">+{billingConfig.paymentContact.replace(/\D/g, '')}</span>
                </p>
              ) : (
                <p className="text-xs font-semibold text-muted pt-1">
                  Contacta al administrador para obtener instrucciones de pago.
                </p>
              )}
            </div>

            {/* Botón Enviar comprobante por WhatsApp si hay contacto configurado */}
            {billingConfig?.paymentContact ? (
              <a
                href={getWhatsAppLink()}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3.5 px-6 rounded-xl flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-900/20 transition-all hover:scale-[1.01] active:scale-[0.99] text-sm cursor-pointer"
              >
                <span>Enviar comprobante por WhatsApp</span>
                <ArrowSquareOut size={18} weight="bold" />
              </a>
            ) : (
              <div className="p-3 bg-app border border-line rounded-xl text-center text-xs text-lo font-semibold">
                Contacta al administrador para obtener instrucciones de pago.
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
