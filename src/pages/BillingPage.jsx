import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../services/api';
import { Cardholder, Check, Sparkle, WarningCircle, CircleNotch, X, Copy, QrCode, ArrowSquareOut } from '@phosphor-icons/react';

// Variables estáticas para fácil modificación
const YAPE_NUMBER = '953789363';
const SUPPORT_WHATSAPP = '991535502';

export default function BillingPage() {
  const { user } = useAuth();
  const [plans, setPlans] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Estado para el modal de Yape
  const [selectedPlanModal, setSelectedPlanModal] = useState(null);
  const [copiedNumber, setCopiedNumber] = useState(false);

  // Identificar el plan actual
  const currentPlan = user?.plan || 'Básico';

  // Cargar planes dinámicos desde la base de datos
  const loadPlans = async () => {
    setIsLoading(true);
    try {
      const data = await apiClient('/plans');
      setPlans(data || []);
    } catch (err) {
      console.error('Error al cargar planes dinámicos:', err);
      setError('No se pudo cargar la lista de planes de suscripción.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPlans();
  }, []);

  const handleOpenModal = (plan) => {
    setSelectedPlanModal(plan);
    setCopiedNumber(false);
  };

  const handleCloseModal = () => {
    setSelectedPlanModal(null);
    setCopiedNumber(false);
  };

  const handleCopyYapeNumber = () => {
    navigator.clipboard.writeText(YAPE_NUMBER);
    setCopiedNumber(true);
    setTimeout(() => setCopiedNumber(false), 2000);
  };

  // Construir el enlace directo a WhatsApp
  const getWhatsAppLink = () => {
    if (!selectedPlanModal) return '#';
    const message = `Hola, acabo de realizar el pago por Yape de S/ ${selectedPlanModal.price} para activar el Plan ${selectedPlanModal.name}. Adjunto la captura del comprobante.`;
    return `https://wa.me/51${SUPPORT_WHATSAPP}?text=${encodeURIComponent(message)}`;
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
                      <span className="text-4xl font-extrabold text-hi">S/ {plan.price}</span>
                      <span className="text-sm text-lo font-semibold">/ mensual</span>
                    </div>
                    <p className="text-sm text-lo mt-2">Acceso a todas las características del paquete.</p>
                  </div>

                  {/* Features List */}
                  <ul className="space-y-3.5 border-t border-line pt-6">
                    {plan.features && plan.features.map((feature, i) => {
                      const text = typeof feature === 'string' ? feature : feature.text;
                      return (
                        <li key={i} className="flex items-start gap-3">
                          <Check size={18} className={`${plan.popular ? 'text-brand' : 'text-emerald-500'} flex-shrink-0 mt-0.5`} />
                          <span className="text-sm text-mid font-medium">{text}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="pt-8">
                  {isCurrent ? (
                    <button
                      disabled
                      className="w-full py-3 px-4 rounded-lg border border-emerald-200 text-emerald-700 font-semibold text-sm bg-emerald-50 cursor-not-allowed transition-all duration-fast text-center"
                    >
                      Plan Activo ✓
                    </button>
                  ) : (
                    <button
                      onClick={() => handleOpenModal(plan)}
                      className={`
                        w-full flex items-center justify-center gap-2
                        py-3 px-4 rounded-lg font-semibold text-sm
                        transition-all duration-fast cursor-pointer active:scale-[0.98]
                        ${plan.popular
                          ? 'bg-brand text-white hover:bg-brand-hover shadow-card'
                          : 'bg-app text-mid hover:bg-line border border-line'
                        }
                      `}
                    >
                      <QrCode size={18} weight="bold" />
                      <span>Adquirir Plan {plan.name}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Pago por Yape */}
      {selectedPlanModal && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div 
            className="bg-card rounded-2xl max-w-md w-full p-6 sm:p-8 border border-line shadow-2xl relative space-y-6 animate-scaleUp"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Botón Cerrar */}
            <button
              onClick={handleCloseModal}
              className="absolute top-4 right-4 p-2 text-lo hover:text-hi hover:bg-app rounded-full transition-colors cursor-pointer"
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
                Para activar o renovar tu suscripción, por favor realiza el pago por Yape al siguiente número:
              </p>
            </div>

            {/* Tarjeta del Número de Yape */}
            <div className="bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/50 rounded-xl p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-purple-600 dark:text-purple-300 uppercase tracking-wider">
                  Número Yape
                </p>
                <p className="text-2xl font-black text-purple-950 dark:text-purple-100 font-mono mt-0.5">
                  {YAPE_NUMBER}
                </p>
              </div>
              <button
                onClick={handleCopyYapeNumber}
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

            {/* Instrucciones */}
            <div className="bg-app border border-line rounded-xl p-4 space-y-2 text-sm text-mid">
              <div className="flex items-center justify-between font-bold text-hi border-b border-line pb-2 mb-1">
                <span>Monto a Yapear:</span>
                <span className="text-lg text-brand font-black">S/ {selectedPlanModal.price}</span>
              </div>
              <p className="text-xs leading-relaxed text-lo">
                Una vez realizado el pago de <strong className="text-hi">S/ {selectedPlanModal.price}</strong>, envía una captura de pantalla del comprobante a nuestro soporte por WhatsApp para activar tu cuenta de inmediato.
              </p>
              <p className="text-xs font-semibold text-hi pt-1">
                Soporte: <span className="font-mono text-brand">{SUPPORT_WHATSAPP}</span>
              </p>
            </div>

            {/* Botón Enviar comprobante por WhatsApp */}
            <a
              href={getWhatsAppLink()}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3.5 px-6 rounded-xl flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-900/20 transition-all hover:scale-[1.01] active:scale-[0.99] text-sm cursor-pointer"
            >
              <span>Enviar comprobante por WhatsApp</span>
              <ArrowSquareOut size={18} weight="bold" />
            </a>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
