import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { loginAccount } from '../services/authService';
import {
  ShieldCheck,
  Eye,
  EyeSlash,
  ArrowRight,
  EnvelopeSimple,
  LockSimple,
  WarningCircle,
  Sparkle,
} from '@phosphor-icons/react';

function getAuthError(code) {
  const MAP = {
    'auth/invalid-credential':      'Correo o contraseña incorrectos.',
    'auth/user-not-found':          'No existe una cuenta con ese correo.',
    'auth/wrong-password':          'La contraseña es incorrecta.',
    'auth/too-many-requests':       'Demasiados intentos fallidos. Espera unos minutos.',
    'auth/user-disabled':           'Esta cuenta ha sido deshabilitada.',
    'auth/network-request-failed':  'Error de red. Comprueba tu conexión.',
  };
  return MAP[code] ?? 'Ocurrió un error inesperado. Intenta de nuevo.';
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname ?? '/dashboard';
  const { signIn, loginUser } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Por favor, completa todos los campos.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Llamada real a la capa de servicios
      const res = await loginAccount(email, password);
      // Guardar sesión en el contexto de autenticación
      loginUser(res.user, res.token);
      navigate(from, { replace: true });
    } catch (err) {
      // Fallback a autenticación simulada local (para desarrollo de maqueta)
      const cleanEmail = email.trim().toLowerCase();
      if ((cleanEmail === 'admin@test.com' || cleanEmail === 'cliente@test.com') && password === '123456') {
        try {
          await signIn(email, password);
          navigate(from, { replace: true });
          return;
        } catch (simErr) {
          setError(simErr.message);
        }
      }
      setError(err.message || 'Error de conexión con el servidor');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex bg-card overflow-hidden">
      {/* ── LADO IZQUIERDO: Branding (Desktop) ── */}
      <div className="hidden lg:flex lg:w-1/2 bg-brand relative items-center justify-center p-12 text-white overflow-hidden">
        {/* Elementos decorativos de fondo */}
        <div className="absolute inset-0 bg-gradient-to-tr from-brand-hover via-brand to-blue-500 opacity-90" />
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-white/10 blur-3xl" />

        <div className="relative max-w-lg space-y-6 z-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-white/15 backdrop-blur-md">
            <ShieldCheck size={32} weight="bold" className="text-white" />
          </div>
          <div className="space-y-2">
            <h2 className="text-4xl font-extrabold tracking-tight leading-tight">
              La plataforma de automatización de WhatsApp definitiva.
            </h2>
            <p className="text-white/80 text-lg leading-relaxed">
              Gestiona campañas masivas, automatiza con Cerebro IA (Gemini/Groq) y atiende a tus clientes en tiempo real.
            </p>
          </div>
          <div className="flex items-center gap-2 pt-4 text-xs text-white/70 font-semibold tracking-wider uppercase">
            <Sparkle size={14} weight="bold" className="text-white animate-pulse" />
            Integración de evolution API & WAHA
          </div>
        </div>
      </div>

      {/* ── LADO DERECHO: Formulario ── */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center p-6 sm:p-12 md:p-20 bg-card">
        <div className="w-full max-w-md mx-auto space-y-8">
          
          {/* Header móvil & escritorio */}
          <div className="space-y-2">
            <div className="lg:hidden inline-flex items-center justify-center w-12 h-12 rounded-lg bg-brand mb-4">
              <ShieldCheck size={26} weight="bold" className="text-white" />
            </div>
            <h1 className="text-2xl font-extrabold text-hi tracking-tight">Iniciar Sesión</h1>
            <p className="text-sm text-lo">Introduce tus datos para acceder a tu panel de administración.</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-label="Formulario de inicio de sesión">
            {/* Email */}
            <div>
              <label htmlFor="login-email" className="block text-sm font-semibold text-mid mb-1.5">
                Correo electrónico
              </label>
              <div className="relative">
                <EnvelopeSimple
                  size={18}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); if (error) setError(''); }}
                  placeholder="ejemplo@negocio.com"
                  autoComplete="email"
                  required
                  className="
                    w-full pl-10 pr-4 py-3 text-sm
                    bg-app border border-line rounded-md text-hi
                    placeholder:text-muted
                    focus:outline-none focus:border-brand focus:shadow-input-focus
                    transition-all duration-fast
                  "
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="login-password" className="text-sm font-semibold text-mid">
                  Contraseña
                </label>
                <button
                  type="button"
                  onClick={() => showToast('Funcionalidad de recuperación simulada.', 'info')}
                  className="text-xs font-semibold text-brand hover:text-brand-hover transition-colors cursor-pointer"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
              <div className="relative">
                <LockSimple
                  size={18}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="login-password"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (error) setError(''); }}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  className="
                    w-full pl-10 pr-10 py-3 text-sm
                    bg-app border border-line rounded-md text-hi
                    placeholder:text-muted
                    focus:outline-none focus:border-brand focus:shadow-input-focus
                    transition-all duration-fast
                  "
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="
                    absolute right-3.5 top-1/2 -translate-y-1/2
                    text-muted hover:text-lo transition-colors cursor-pointer
                  "
                  aria-label={showPw ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPw
                    ? <EyeSlash size={18} aria-hidden="true" />
                    : <Eye size={18} aria-hidden="true" />
                  }
                </button>
              </div>
            </div>

            {/* Error Alert */}
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 px-4 py-3 bg-red-50 border border-danger/20 rounded-md text-sm text-danger"
              >
                <WarningCircle size={18} weight="fill" className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="
                w-full flex items-center justify-center gap-2
                py-3 px-4 rounded-md
                bg-brand text-white font-semibold text-sm
                hover:bg-brand-hover active:scale-[0.98]
                disabled:opacity-60 disabled:cursor-not-allowed
                transition-all duration-fast cursor-pointer
                shadow-card
              "
            >
              {loading ? (
                <svg className="animate-spin w-4 h-4 text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <>
                  <span>Iniciar sesión</span>
                  <ArrowRight size={16} weight="bold" aria-hidden="true" />
                </>
              )}
            </button>
          </form>

          {/* Registro link */}
          <p className="text-center text-sm text-lo pt-2">
            ¿No tienes una cuenta?{' '}
            <Link to="/register" className="font-semibold text-brand hover:text-brand-hover transition-colors">
              Regístrate aquí
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
