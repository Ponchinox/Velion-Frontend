import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
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

// ─── Datos de pago Yape (configura aquí tu número y nombre) ───
const YAPE_NUMBER   = '926246740';       // Tu número de Yape
const YAPE_NAME     = 'Velion Agent';    // Nombre que aparece en Yape
const WHATSAPP_CONTACT = '51926246740';  // Número de WhatsApp para confirmar pago

export default function PlanSelectionPage() {
  const { user } = useAuth();

  const [plans, setPlans]                 = useState([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState('');
  const [selectedPlan, setSelectedPlan]   = useState(null); // Plan en modal de pago
  const [copied, setCopied]               = useState(false);
  const [paymentSent, setPaymentSent]     = useState(false); // Pantalla de "esperando verificación"

  useEffect(() => {
    const fetchPlans = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE_URL}/api/plans`);
        if (!res.ok) throw new Error('No se pudieron obtener los planes.');
        const data = await res.json();
        setPlans(data || []);
      } catch (err) {
        console.error(err);
        setError('Error al cargar los planes disponibles. Por favor intenta de nuevo.');
      } finally {
        setLoading(false);
      }
    };
    fetchPlans();
  }, []);

  const handleCopyNumber = () => {
    navigator.clipboard.writeText(YAPE_NUMBER).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const handleConfirmPayment = () => {
    // Abre WhatsApp con el mensaje pre-llenado de confirmación de pago
    const msg = encodeURIComponent(
      `Hola! Acabo de yapear S/ ${selectedPlan?.price} por el Plan ${selectedPlan?.name} de Velion Agent. Mi correo de registro es: ${user?.email}. Adjunto el comprobante de pago. 🙏`
    );
    window.open(`https://wa.me/${WHATSAPP_CONTACT}?text=${msg}`, '_blank');
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
            Si aún no enviaste el comprobante por WhatsApp, por favor contáctanos directamente al{' '}
            <strong>+{WHATSAPP_CONTACT}</strong> con la captura de tu Yape.
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
            <h1 className="font-extrabold text-lg text-hi tracking-tight leading-none">Velion Agent</h1>
            <span className="text-xs text-lo font-medium">Plataforma de Automatización de IA</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-lo">Sesión iniciada como:</p>
          <p className="text-sm font-semibold text-hi">{user?.email}</p>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto w-full space-y-8 my-auto">
        <div className="text-center space-y-3 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand/10 text-brand text-xs font-semibold">
            <Sparkle size={14} weight="bold" />
            <span>Paso Obligatorio de Configuración</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-hi tracking-tight">
            Selecciona el plan ideal para tu empresa
          </h2>
          <p className="text-lo text-base leading-relaxed">
            Elige el plan que mejor se adapte a tu negocio. Después de elegir, te daremos las instrucciones de pago por Yape.
          </p>
        </div>

        {error && (
          <div className="max-w-md mx-auto p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-600 dark:text-red-400 text-sm font-medium flex items-center gap-3">
            <WarningCircle size={20} className="flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <CircleNotch size={32} className="animate-spin text-brand" />
            <p className="text-sm text-lo font-medium">Cargando catálogo de planes...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
            {plans.map((p) => {
              const isPopular  = p.popular;
              const features   = Array.isArray(p.features) ? p.features : [];

              return (
                <div
                  key={p.id}
                  className={`
                    relative rounded-2xl p-6 flex flex-col justify-between transition-all duration-200
                    bg-card border shadow-card
                    ${isPopular
                      ? 'border-brand ring-2 ring-brand/20 shadow-lg scale-[1.02]'
                      : 'border-line hover:border-brand/40'}
                  `}
                >
                  {isPopular && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-1 bg-brand text-white text-xs font-extrabold rounded-full uppercase tracking-wider shadow">
                      Más Popular
                    </div>
                  )}

                  <div className="space-y-5">
                    <div>
                      <h3 className="text-xl font-bold text-hi">{p.name}</h3>
                      <div className="mt-3 flex items-baseline gap-1">
                        <span className="text-4xl font-black text-hi tracking-tight">S/ {p.price}</span>
                        <span className="text-sm font-medium text-lo">/mes</span>
                      </div>
                    </div>

                    <div className="space-y-2 py-2 border-y border-line text-xs">
                      <div className="flex items-center justify-between text-hi font-semibold">
                        <span>Límite de mensajes:</span>
                        <span className="text-brand font-bold">{p.msgLimit.toLocaleString()} msgs</span>
                      </div>
                      <div className="flex items-center justify-between text-hi font-semibold">
                        <span>Conexiones WhatsApp:</span>
                        <span className="text-brand font-bold">{p.connLimit} números</span>
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      <p className="text-xs font-bold text-lo uppercase tracking-wider">Incluye:</p>
                      {features.map((feat, i) => {
                        const featText = typeof feat === 'string' ? feat : feat.text;
                        const included = typeof feat === 'string' ? true : feat.included !== false;
                        return (
                          <div key={i} className={`flex items-start gap-2 text-sm ${included ? 'text-hi font-medium' : 'text-muted line-through'}`}>
                            <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${included ? 'bg-emerald-500/15 text-emerald-600' : 'bg-app text-muted'}`}>
                              <Check size={10} weight="bold" />
                            </div>
                            <span>{featText}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Botón — abre modal de pago, NO asigna el plan */}
                  <div className="pt-6">
                    <button
                      onClick={() => setSelectedPlan(p)}
                      className={`
                        w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md
                        ${isPopular
                          ? 'bg-brand text-white hover:bg-brand-hover active:scale-[0.98]'
                          : 'bg-app border border-line text-hi hover:border-brand hover:text-brand'}
                      `}
                    >
                      <span>Elegir este Plan</span>
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
      <footer className="max-w-6xl mx-auto w-full text-center text-xs text-lo pt-8">
        © 2026 Velion Agent. Todos los derechos reservados.
      </footer>

      {/* ─── Modal de Instrucciones de Pago por Yape ─── */}
      {selectedPlan && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedPlan(null); }}
        >
          <div className="bg-card border border-line rounded-2xl shadow-2xl w-full max-w-md relative animate-in fade-in zoom-in-95 duration-200">
            {/* Cerrar */}
            <button
              onClick={() => setSelectedPlan(null)}
              className="absolute top-4 right-4 text-muted hover:text-hi transition-colors cursor-pointer p-1 rounded-lg hover:bg-app"
              aria-label="Cerrar"
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
                  Pago por Yape — Plan {selectedPlan.name}
                </h3>
                <p className="text-lo text-sm">
                  Realiza el pago al número de Yape indicado y luego envíanos el comprobante por WhatsApp para activar tu cuenta.
                </p>
              </div>

              {/* Monto a pagar */}
              <div className="flex items-center justify-between bg-brand/5 border border-brand/20 rounded-xl px-4 py-3">
                <span className="text-sm font-semibold text-hi">Monto a Yapear:</span>
                <span className="text-2xl font-black text-brand">S/ {selectedPlan.price}</span>
              </div>

              {/* Datos Yape */}
              <div className="bg-app border border-line rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold text-lo uppercase tracking-wider">Datos de Yape</p>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted">Nombre</p>
                    <p className="text-sm font-bold text-hi">{YAPE_NAME}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted">Número de Yape</p>
                    <p className="text-lg font-black text-hi tracking-widest">{YAPE_NUMBER}</p>
                  </div>
                  <button
                    onClick={handleCopyNumber}
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

              {/* Instrucciones */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-lo uppercase tracking-wider">Pasos a seguir</p>
                {[
                  `Abre Yape y yapea S/ ${selectedPlan.price} al número ${YAPE_NUMBER}.`,
                  'Toma una captura de pantalla del comprobante de Yape.',
                  'Haz clic en el botón de WhatsApp abajo y envíanos la captura.',
                  'Activamos tu cuenta en minutos al verificar el pago. ✅',
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
              <button
                onClick={handleConfirmPayment}
                className="w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] text-white transition-all cursor-pointer shadow-md"
              >
                <WhatsappLogo size={18} weight="fill" />
                Ya yapé — Enviar comprobante por WhatsApp
              </button>

              <p className="text-center text-xs text-muted">
                ¿Preguntas? Escríbenos al{' '}
                <a
                  href={`https://wa.me/${WHATSAPP_CONTACT}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand font-semibold underline"
                >
                  +{WHATSAPP_CONTACT}
                </a>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
