import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isDemoUser } from '../utils/demoUtils';
import {
  ShieldCheck,
  Check,
  Sparkle,
  CircleNotch,
  ArrowRight,
  WarningCircle,
  X,
  Copy,
  CheckCircle,
  Clock,
  WhatsappLogo,
} from '@phosphor-icons/react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function PlanSelectionPage() {
  const { user } = useAuth();

  if (isDemoUser(user)) {
    return <Navigate to="/dashboard" replace />;
  }

  const [plans, setPlans]                 = useState([]);
  const [billingConfig, setBillingConfig] = useState(null);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState('');
  const [selectedPlan, setSelectedPlan]   = useState(null); // Plan en modal de pago
  const [copied, setCopied]               = useState(false);
  const [paymentSent, setPaymentSent]     = useState(false); // Pantalla de "esperando verificación"

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError('');
      try {
        const [resPlans, resConfig] = await Promise.all([
          fetch(`${API_BASE_URL}/api/plans`),
          fetch(`${API_BASE_URL}/api/plans/billing-config`).catch(() => null)
        ]);

        if (!resPlans.ok) throw new Error('No se pudieron obtener los planes.');
        const dataPlans = await resPlans.json();
        setPlans(dataPlans || []);

        if (resConfig && resConfig.ok) {
          const dataConfig = await resConfig.json();
          setBillingConfig(dataConfig);
        }
      } catch (err) {
        console.error(err);
        setError('Error al cargar los planes disponibles. Por favor intenta de nuevo.');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const hasPaymentDetails = Boolean(
    billingConfig?.paymentMethod && billingConfig?.paymentRecipient
  );

  const handleCopyRecipient = () => {
    if (!billingConfig?.paymentRecipient) return;
    navigator.clipboard.writeText(billingConfig.paymentRecipient).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const handleConfirmPayment = () => {
    if (!billingConfig?.paymentContact) {
      setPaymentSent(true);
      setSelectedPlan(null);
      return;
    }

    const cleanContact = billingConfig.paymentContact.replace(/\D/g, '');
    const method = billingConfig.paymentMethod || 'pago';
    const msg = encodeURIComponent(
      `Hola! Acabo de realizar el ${method} de S/ ${selectedPlan?.price} por el Plan ${selectedPlan?.name} de Velion Agent. Mi correo de registro es: ${user?.email}. Adjunto el comprobante de pago. 🙏`
    );
    window.open(`https://wa.me/${cleanContact}?text=${msg}`, '_blank');
    setPaymentSent(true);
    setSelectedPlan(null);
  };

  // ─── Pantalla de espera post-pago ───
  if (paymentSent) {
    return (
      <div className="min-h-dvh bg-app flex flex-col items-center justify-center p-6 text-center gap-6">
        <div className="w-20 h-20 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto">
          <Clock size={40} className="text-emerald-500" weight="bold" />
        </div>
        <div className="space-y-2 max-w-md">
          <h1 className="text-2xl font-extrabold text-hi">¡Pago enviado! Verificando...</h1>
          <p className="text-lo text-base leading-relaxed">
            Recibimos tu notificación de pago. Nuestro equipo verificará el comprobante y activará
            tu cuenta en los próximos minutos. Te avisaremos por WhatsApp.
          </p>
        </div>
        <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl max-w-sm text-sm text-amber-800 dark:text-amber-200 flex items-start gap-3">
          <WarningCircle size={20} className="flex-shrink-0 mt-0.5 text-amber-600" weight="bold" />
          <p>
            {billingConfig?.paymentContact ? (
              <>
                Si aún no enviaste el comprobante por WhatsApp, contáctanos directamente al{' '}
                <strong>+{billingConfig.paymentContact.replace(/\D/g, '')}</strong> con la captura de tu pago.
              </>
            ) : (
              'Contacta al administrador para obtener instrucciones de pago.'
            )}
          </p>
        </div>
        <p className="text-xs text-muted">Puedes cerrar esta pestaña mientras esperas la activación.</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-app flex flex-col justify-between p-6 sm:p-10">
      {/* Header */}
      <header className="max-w-6xl mx-auto w-full flex items-center justify-between pb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center text-white shadow-md">
            <ShieldCheck size={24} weight="bold" />
          </div>
          <div>
            <span className="font-extrabold text-hi text-lg tracking-tight">Velion Agent</span>
            <span className="block text-xs text-muted">Plataforma de IA para WhatsApp</span>
          </div>
        </div>
        <div className="text-right">
          <span className="text-xs text-muted block">Conectado como</span>
          <span className="text-xs font-bold text-hi">{user?.email}</span>
        </div>
      </header>

      {/* Contenido Principal */}
      <main className="max-w-6xl mx-auto w-full flex-1 flex flex-col items-center justify-center py-6">
        <div className="text-center space-y-3 max-w-2xl mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand/10 text-brand text-xs font-bold uppercase tracking-wider">
            <Sparkle size={14} weight="fill" />
            Paso 2 de 2 — Activa tu cuenta
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-hi tracking-tight">
            Elige el plan ideal para tu negocio
          </h1>
          <p className="text-lo text-base sm:text-lg">
            Selecciona un plan para comenzar a automatizar tus ventas por WhatsApp con Inteligencia Artificial.
          </p>
        </div>

        {error && (
          <div className="w-full max-w-md mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-500 text-sm">
            <WarningCircle size={20} weight="bold" className="flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <CircleNotch size={36} className="text-brand animate-spin" />
            <span className="text-sm text-muted">Cargando planes disponibles...</span>
          </div>
        ) : plans.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <p className="text-hi font-bold text-lg">No hay planes disponibles en este momento.</p>
            <p className="text-muted text-sm">Por favor contacta al administrador del sistema.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full items-stretch">
            {plans.map((plan) => {
              const isPopular = plan.popular || false;
              return (
                <div
                  key={plan.id}
                  className={`relative rounded-2xl flex flex-col justify-between transition-all duration-200 ${
                    isPopular
                      ? 'bg-card border-2 border-brand shadow-xl scale-[1.02] z-10'
                      : 'bg-card border border-line hover:border-brand/40 shadow-sm'
                  }`}
                >
                  {isPopular && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 bg-brand text-white text-xs font-black rounded-full uppercase tracking-wider shadow-md">
                      Más Popular
                    </div>
                  )}

                  <div className="p-7 space-y-6">
                    {/* Encabezado del Plan */}
                    <div className="space-y-1">
                      <h2 className="text-lg font-black text-hi uppercase tracking-wide">{plan.name}</h2>
                      <p className="text-muted text-xs">{plan.description || 'Plan de automatización'}</p>
                    </div>

                    {/* Precio */}
                    <div className="flex items-baseline gap-1">
                      <span className="text-sm font-bold text-lo">S/</span>
                      <span className="text-4xl font-black text-hi tracking-tight">{plan.price}</span>
                      <span className="text-xs text-muted">/mes</span>
                    </div>

                    <div className="w-full h-px bg-line" />

                    {/* Características */}
                    <ul className="space-y-3">
                      <li className="flex items-center gap-3 text-sm text-hi">
                        <Check size={16} weight="bold" className="text-emerald-500 flex-shrink-0" />
                        <span><strong>{plan.connLimit}</strong> Conexión de WhatsApp</span>
                      </li>
                      <li className="flex items-center gap-3 text-sm text-hi">
                        <Check size={16} weight="bold" className="text-emerald-500 flex-shrink-0" />
                        <span><strong>{plan.msgLimit ? plan.msgLimit.toLocaleString() : 'Ilimitados'}</strong> Mensajes/mes</span>
                      </li>
                      <li className="flex items-center gap-3 text-sm text-hi">
                        <Check size={16} weight="bold" className="text-emerald-500 flex-shrink-0" />
                        <span><strong>{plan.maxProducts || 10}</strong> Productos en catálogo</span>
                      </li>
                      {plan.hasCampaigns && (
                        <li className="flex items-center gap-3 text-sm text-hi">
                          <Check size={16} weight="bold" className="text-emerald-500 flex-shrink-0" />
                          <span>Campañas masivas</span>
                        </li>
                      )}
                      {plan.hasAutomations && (
                        <li className="flex items-center gap-3 text-sm text-hi">
                          <Check size={16} weight="bold" className="text-emerald-500 flex-shrink-0" />
                          <span>Automatizaciones y Flujos</span>
                        </li>
                      )}
                      {plan.hasAdvancedMarketing && (
                        <li className="flex items-center gap-3 text-sm text-hi">
                          <Check size={16} weight="bold" className="text-emerald-500 flex-shrink-0" />
                          <span>Marketing y analítica avanzada</span>
                        </li>
                      )}
                      <li className="flex items-center gap-3 text-sm text-hi">
                        <Check size={16} weight="bold" className="text-emerald-500 flex-shrink-0" />
                        <span>Atención con IA 24/7</span>
                      </li>
                    </ul>
                  </div>

                  {/* Botón de acción */}
                  <div className="p-7 pt-0">
                    <button
                      onClick={() => setSelectedPlan(plan)}
                      className={`w-full py-3.5 px-5 rounded-xl font-extrabold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        isPopular
                          ? 'bg-brand hover:bg-brand-hover text-white shadow-lg shadow-brand/25'
                          : 'bg-app hover:bg-line border border-line text-hi'
                      }`}
                    >
                      <span>Seleccionar Plan</span>
                      <ArrowRight size={16} weight="bold" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto w-full pt-8 border-t border-line text-center text-xs text-muted">
        © {new Date().getFullYear()} Velion Agent. Todos los derechos reservados.
      </footer>

      {/* ─── Modal de Pago ─── */}
      {selectedPlan && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-line rounded-2xl max-w-md w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150 relative">
            {/* Botón cerrar */}
            <button
              onClick={() => setSelectedPlan(null)}
              className="absolute top-4 right-4 text-muted hover:text-hi p-1.5 rounded-lg hover:bg-app transition-colors cursor-pointer"
            >
              <X size={18} weight="bold" />
            </button>

            <div className="p-6 space-y-5">
              {/* Título */}
              <div className="space-y-1 pr-6">
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 text-xs font-bold">
                  <CheckCircle size={12} weight="bold" />
                  Plan seleccionado
                </div>
                <h3 className="text-xl font-extrabold text-hi">
                  Activación — Plan {selectedPlan.name}
                </h3>
                <p className="text-lo text-sm">
                  Realiza el pago indicado y envíanos el comprobante para activar tu cuenta de inmediato.
                </p>
              </div>

              {/* Monto a pagar */}
              <div className="flex items-center justify-between bg-brand/5 border border-brand/20 rounded-xl px-4 py-3">
                <span className="text-sm font-semibold text-hi">Monto a pagar:</span>
                <span className="text-2xl font-black text-brand">S/ {selectedPlan.price}</span>
              </div>

              {/* Datos de pago centralizados o fallback seguro */}
              {hasPaymentDetails ? (
                <div className="bg-app border border-line rounded-xl p-4 space-y-3">
                  <p className="text-xs font-bold text-lo uppercase tracking-wider">
                    Datos de Pago ({billingConfig.paymentMethod})
                  </p>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted">Destinatario / Cuenta</p>
                      <p className="text-lg font-black text-hi tracking-wide">{billingConfig.paymentRecipient}</p>
                    </div>
                    <button
                      onClick={handleCopyRecipient}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                        copied
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600'
                          : 'bg-card border-line text-mid hover:border-brand hover:text-brand'
                      }`}
                    >
                      {copied ? <CheckCircle size={13} weight="bold" /> : <Copy size={13} weight="bold" />}
                      {copied ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-center space-y-1">
                  <p className="text-sm font-semibold text-hi">
                    Contacta al administrador para obtener instrucciones de pago.
                  </p>
                </div>
              )}

              {/* Instrucciones */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-lo uppercase tracking-wider">Pasos a seguir</p>
                {[
                  hasPaymentDetails
                    ? `Realiza el pago de S/ ${selectedPlan.price} mediante ${billingConfig.paymentMethod}.`
                    : 'Solicita los datos de pago al administrador del sistema.',
                  'Toma una captura de pantalla del comprobante de pago.',
                  'Haz clic en el botón de abajo y envíanos la captura.',
                  'Activamos tu cuenta en minutos al verificar el comprobante. ✅',
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm text-hi">
                    <span className="w-5 h-5 rounded-full bg-brand text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </div>
                ))}
              </div>

              {/* Botón de acción principal */}
              {billingConfig?.paymentContact ? (
                <button
                  onClick={handleConfirmPayment}
                  className="w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] text-white transition-all cursor-pointer shadow-md"
                >
                  <WhatsappLogo size={18} weight="fill" />
                  Enviar comprobante por WhatsApp
                </button>
              ) : (
                <div className="p-3 bg-card border border-line rounded-xl text-center text-xs text-lo font-semibold">
                  Contacta al administrador para obtener instrucciones de pago.
                </div>
              )}

              {billingConfig?.paymentContact && (
                <p className="text-center text-xs text-muted">
                  ¿Preguntas? Escríbenos al{' '}
                  <a
                    href={`https://wa.me/${billingConfig.paymentContact.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand font-semibold underline"
                  >
                    +{billingConfig.paymentContact.replace(/\D/g, '')}
                  </a>
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
