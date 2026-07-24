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
  const [forgotMsg, setForgotMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Por favor, completa todos los campos.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Por favor, introduce un correo electrónico válido.');
      return;
    }
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Llamada a la API real de autenticación de producción
      const res = await loginAccount(email, password);
      loginUser(res.user, res.token);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Credenciales inválidas o error de conexión con el servidor.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex bg-card overflow-hidden">
      {/* ── LADO IZQUIERDO: Branding (Desktop) ── */}
      <div
        className="hidden lg:flex lg:w-1/2 bg-gradient-to-tr from-blue-600 via-[#4f46e5] to-[#4338ca] relative items-end justify-start p-14 overflow-hidden"
      >
        {/* Destellos de luz vibrantes para el fondo */}
        <div className="absolute -top-10 -left-10 w-96 h-96 rounded-full bg-cyan-400/20 blur-3xl opacity-70 pointer-events-none" />
        <div className="absolute -bottom-10 -right-10 w-96 h-96 rounded-full bg-white/10 blur-3xl opacity-60 pointer-events-none" />
        <div className="absolute top-1/3 left-1/4 w-72 h-72 rounded-full bg-indigo-400/20 blur-3xl opacity-50 pointer-events-none" />

        <div className="relative z-10 max-w-lg space-y-5 pb-4">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-white/15 backdrop-blur-md border border-white/20">
            <ShieldCheck size={30} weight="bold" className="text-white" />
          </div>

          <div className="space-y-4">
            <h2 className="text-4xl font-extrabold tracking-tight leading-tight text-white">
              Automatiza tus ventas y atención al cliente 24/7
            </h2>
            <p className="text-white/75 text-lg leading-relaxed">
              Gestiona campañas masivas, inventario y respuestas automáticas con Inteligencia Artificial. Todo desde un solo lugar.
            </p>
          </div>

          {/* Beneficios clave */}
          <div className="flex flex-col gap-3 pt-2">
            {[
              'Respuestas automáticas e inteligentes a clientes',
              'Envío de campañas a toda tu base de contactos',
              'Control total de tu inventario y pedidos',
            ].map((benefit) => (
              <div key={benefit} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-brand/90 flex items-center justify-center flex-shrink-0">
                  <Sparkle size={11} weight="bold" className="text-white" />
                </div>
                <span className="text-sm text-white/85 font-medium">{benefit}</span>
              </div>
            ))}
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
                  onClick={() => setForgotMsg('Para recuperar tu contraseña, contacta al administrador del sistema.')}
                  className="text-xs font-semibold text-brand hover:text-brand-hover transition-colors cursor-pointer"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
              {forgotMsg && (
                <p className="text-xs text-brand font-medium mt-1.5 px-1">{forgotMsg}</p>
              )}
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
                  minLength={6}
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

          <p className="text-center text-sm text-lo pt-4">
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
