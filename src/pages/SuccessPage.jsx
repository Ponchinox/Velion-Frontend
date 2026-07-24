import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowRight, Sparkle } from '@phosphor-icons/react';

export default function SuccessPage() {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirigir al dashboard después de 5 segundos
    const timer = setTimeout(() => {
      // Forzar recarga de ventana al redirigir para asegurar que el AuthContext
      // actualice los datos del usuario logueado en la base de datos (con su nuevo plan Pro)
      window.location.href = '/dashboard';
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-dvh flex items-center justify-center p-6 bg-app">
      <div className="w-full max-w-md bg-card border border-line rounded-2xl p-8 text-center space-y-6 shadow-card relative overflow-hidden">
        {/* Destellos decorativos */}
        <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full bg-brand/10 blur-3xl" />
        <div className="absolute -bottom-10 -right-10 w-40 h-40 rounded-full bg-brand/10 blur-3xl" />

        <div className="relative inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-50 text-emerald-500">
          <ShieldCheck size={40} weight="fill" />
        </div>

        <div className="space-y-2 relative z-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold rounded-full uppercase tracking-wider">
            <Sparkle size={12} weight="fill" />
            Pago Exitoso
          </div>
          <h1 className="text-2xl font-extrabold text-hi tracking-tight pt-2">¡Suscripción Activada!</h1>
          <p className="text-sm text-lo leading-relaxed">
            Hemos recibido tu pago con éxito. Tu cuenta de Tenant ha sido actualizada a **Plan Pro** y todas tus nuevas cuotas e integraciones ya se encuentran activas.
          </p>
        </div>

        <div className="bg-app border border-line rounded-lg p-4 text-xs text-mid">
          Redirigiéndote a tu panel de control en unos segundos de forma automática...
        </div>

        <button
          onClick={() => { window.location.href = '/dashboard'; }}
          className="
            w-full flex items-center justify-center gap-2
            py-3 px-4 rounded-lg
            bg-brand text-white font-semibold text-sm
            hover:bg-brand-hover active:scale-[0.98]
            transition-all duration-fast cursor-pointer
          "
        >
          <span>Ir al Dashboard ahora</span>
          <ArrowRight size={16} weight="bold" />
        </button>
      </div>
    </div>
  );
}
