import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ShieldCheck, Check, Sparkle, CircleNotch, ArrowRight, WarningCircle } from '@phosphor-icons/react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function PlanSelectionPage() {
  const { user, loginUser } = useAuth();
  const navigate = useNavigate();

  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState(null);
  const [error, setError] = useState('');

  const token = localStorage.getItem('sa_token');
  const authHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

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

  const handleSelectPlan = async (plan) => {
    setSubmittingId(plan.id);
    setError('');

    try {
      const res = await fetch(`${API_BASE_URL}/api/tenant/assign-plan`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ planId: plan.id }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fallo al seleccionar el plan.');

      // Actualizar el estado global del usuario con el nuevo plan
      const updatedUser = {
        ...user,
        plan: data.tenant.plan,
        planId: data.tenant.planId,
        hasPlan: true,
        tenant: {
          ...(user?.tenant || {}),
          ...data.tenant,
          hasPlan: true,
        },
      };

      loginUser(updatedUser, token);

      // Redirigir al dashboard
      navigate('/dashboard', { replace: true });
    } catch (err) {
      console.error(err);
      setError(err.message || 'Error de conexión al asignar el plan.');
      setSubmittingId(null);
    }
  };

  return (
    <div className="min-h-dvh bg-app flex flex-col justify-between p-6 sm:p-10">
      {/* Header independiente */}
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

      {/* Main Content */}
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
            Para activar tu bot de WhatsApp y acceder al dashboard, elige uno de los siguientes planes. Puedes cambiar de plan en cualquier momento.
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
              const isPopular = p.popular;
              const features = Array.isArray(p.features) ? p.features : [];

              return (
                <div
                  key={p.id}
                  className={`
                    relative rounded-2xl p-6 flex flex-col justify-between transition-all duration-200
                    bg-card border shadow-card
                    ${isPopular ? 'border-brand ring-2 ring-brand/20 shadow-lg scale-[1.02]' : 'border-line hover:border-brand/40'}
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

                    {/* Lista de características */}
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

                  {/* Botón de selección */}
                  <div className="pt-6">
                    <button
                      onClick={() => handleSelectPlan(p)}
                      disabled={!!submittingId}
                      className={`
                        w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md
                        ${isPopular
                          ? 'bg-brand text-white hover:bg-brand-hover active:scale-[0.98]'
                          : 'bg-app border border-line text-hi hover:border-brand hover:text-brand'}
                        disabled:opacity-50 disabled:cursor-not-allowed
                      `}
                    >
                      {submittingId === p.id ? (
                        <>
                          <CircleNotch size={18} className="animate-spin" />
                          <span>Asignando plan...</span>
                        </>
                      ) : (
                        <>
                          <span>Elegir este Plan</span>
                          <ArrowRight size={16} weight="bold" />
                        </>
                      )}
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
    </div>
  );
}
