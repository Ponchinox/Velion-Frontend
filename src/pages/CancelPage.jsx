import { useNavigate } from 'react-router-dom';
import { WarningCircle, ArrowLeft } from '@phosphor-icons/react';

export default function CancelPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh flex items-center justify-center p-6 bg-app">
      <div className="w-full max-w-md bg-card border border-line rounded-2xl p-8 text-center space-y-6 shadow-card">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-50 text-amber-500">
          <WarningCircle size={40} weight="fill" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold text-hi tracking-tight">Pago Cancelado</h1>
          <p className="text-sm text-lo leading-relaxed">
            Has cancelado el proceso de pago en la pasarela de Stripe Checkout. No se ha realizado ningún cobro a tu tarjeta.
          </p>
        </div>

        <div className="pt-2">
          <button
            onClick={() => navigate('/billing')}
            className="
              w-full flex items-center justify-center gap-2
              py-3 px-4 rounded-lg
              bg-brand text-white font-semibold text-sm
              hover:bg-brand-hover active:scale-[0.98]
              transition-all duration-fast cursor-pointer
            "
          >
            <ArrowLeft size={16} weight="bold" />
            <span>Volver a Planes e Intentar de Nuevo</span>
          </button>
        </div>
      </div>
    </div>
  );
}
