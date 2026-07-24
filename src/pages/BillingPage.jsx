import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../services/api';
import { Cardholder, Check, CreditCard, Sparkle, WarningCircle, CircleNotch } from '@phosphor-icons/react';

export default function BillingPage() {
  const { user } = useAuth();
  const [plans, setPlans] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [subscribeLoading, setSubscribeLoading] = useState(null); // Guardar el stripePriceId que está cargando
  const [error, setError] = useState('');

  // Identificar el plan actual
  const currentPlan = user?.plan || 'Básico';

  // Cargar planes dinámicos desde la base de datos
  const loadPlans = async () => {
    setIsLoading(true);
    try {
      // Hacer la llamada al endpoint público
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

  const handleSubscribe = async (stripePriceId) => {
    setSubscribeLoading(stripePriceId);
    setError('');
    try {
      // Llamar al endpoint pasándole el stripePriceId seleccionado
      const response = await apiClient('/stripe/create-checkout', {
        method: 'POST',
        body: { priceId: stripePriceId }
      });
      if (response && response.url) {
        // Redirigir a Stripe Checkout
        window.location.href = response.url;
      } else {
        throw new Error('No se recibió la URL de pago de Stripe.');
      }
    } catch (err) {
      console.error('Error al iniciar el checkout de Stripe:', err);
      setError(err.message || 'Error al conectar con la pasarela de pagos.');
      setSubscribeLoading(null);
    }
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
            const isLoadingThis = subscribeLoading === plan.stripePriceId;

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
                      <span className="text-4xl font-extrabold text-hi">${plan.price}</span>
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
                      onClick={() => handleSubscribe(plan.stripePriceId)}
                      disabled={subscribeLoading !== null}
                      className={`
                        w-full flex items-center justify-center gap-2
                        py-3 px-4 rounded-lg font-semibold text-sm
                        transition-all duration-fast cursor-pointer active:scale-[0.98]
                        disabled:opacity-60 disabled:cursor-not-allowed
                        ${plan.popular
                          ? 'bg-brand text-white hover:bg-brand-hover shadow-card'
                          : 'bg-app text-mid hover:bg-line border border-line'
                        }
                      `}
                    >
                      {isLoadingThis ? (
                        <svg className="animate-spin w-4 h-4 text-current" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <>
                          <CreditCard size={18} weight="bold" />
                          <span>Adquirir Plan {plan.name}</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
