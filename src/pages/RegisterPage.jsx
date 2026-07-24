import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { registerAccount } from '../services/authService';
import {
  ShieldCheck,
  Eye,
  EyeSlash,
  ArrowRight,
  EnvelopeSimple,
  LockSimple,
  WarningCircle,
  Sparkle,
  Buildings,
  User,
} from '@phosphor-icons/react';

export default function RegisterPage() {
  const navigate = useNavigate();

  const [businessName, setBusinessName] = useState('');
  const [userName, setUserName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!businessName || !userName || !email || !password || !confirmPassword) {
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
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Llamada real a la API del backend
      await registerAccount(businessName, userName, email, password);
      setSuccess(true);
      setTimeout(() => {
        navigate('/login');
      }, 2000);
    } catch (err) {
      setError(err.message || 'Error de conexión con el servidor.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex bg-card overflow-hidden">
      {/* ── LADO IZQUIERDO: Branding (Desktop) ── */}
      <div className="hidden lg:flex lg:w-1/2 bg-brand relative items-center justify-center p-12 text-white overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-tr from-brand-hover via-brand to-blue-500 opacity-90" />
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-white/10 blur-3xl" />

        <div className="relative max-w-lg space-y-6 z-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-white/15 backdrop-blur-md">
            <ShieldCheck size={32} weight="bold" className="text-white" />
          </div>
          <div className="space-y-4">
            {/* Texto anterior de registro (conservado como comentario):
            <h2 className="text-4xl font-extrabold tracking-tight leading-tight">
              Únete a la nueva era del marketing conversacional.
            </h2>
            <p className="text-white/80 text-lg leading-relaxed">
              Crea tu cuenta de inquilino y comienza a conectar múltiples números de WhatsApp, configurar automatizaciones y diseñar flujos interactivos de forma inmediata.
            </p>
            */}
            <h2 className="text-4xl font-extrabold tracking-tight leading-tight text-white">
              Automatiza tus ventas y atención al cliente 24/7
            </h2>
            <p className="text-white/75 text-lg leading-relaxed">
              Gestiona campañas masivas, inventario y respuestas automáticas con Inteligencia Artificial. Todo desde un solo lugar.
            </p>
          </div>
          <div className="flex items-center gap-2 pt-4 text-xs text-white/70 font-semibold tracking-wider uppercase">
            <Sparkle size={14} weight="bold" className="text-white animate-pulse" />
            Empieza gratis hoy mismo
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
            <h1 className="text-2xl font-extrabold text-hi tracking-tight">Crear una cuenta</h1>
            <p className="text-sm text-lo">Registra tu negocio para empezar a automatizar tus ventas.</p>
          </div>

          {success ? (
            <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-lg text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto text-xl font-bold">
                ✓
              </div>
              <p className="text-sm font-semibold text-emerald-800">¡Registro Completado con éxito!</p>
              <p className="text-xs text-emerald-600">Redirigiéndote al inicio de sesión...</p>
            </div>
          ) : (
            /* Form */
            <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-label="Formulario de registro">
              
              {/* Nombre del Negocio */}
              <div>
                <label htmlFor="reg-business" className="block text-sm font-semibold text-mid mb-1.5">
                  Nombre del Negocio
                </label>
                <div className="relative">
                  <Buildings
                    size={18}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="reg-business"
                    type="text"
                    value={businessName}
                    onChange={(e) => { setBusinessName(e.target.value); if (error) setError(''); }}
                    placeholder="Mi Negocio S.A."
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

              {/* Nombre de Usuario Administrador */}
              <div>
                <label htmlFor="reg-username" className="block text-sm font-semibold text-mid mb-1.5">
                  Tu Nombre Completo
                </label>
                <div className="relative">
                  <User
                    size={18}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="reg-username"
                    type="text"
                    value={userName}
                    onChange={(e) => { setUserName(e.target.value); if (error) setError(''); }}
                    placeholder="Juan Pérez"
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

              {/* Email */}
              <div>
                <label htmlFor="reg-email" className="block text-sm font-semibold text-mid mb-1.5">
                  Correo electrónico
                </label>
                <div className="relative">
                  <EnvelopeSimple
                    size={18}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="reg-email"
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (error) setError(''); }}
                    placeholder="admin@minegocio.com"
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
                <label htmlFor="reg-password" className="block text-sm font-semibold text-mid mb-1.5">
                  Contraseña
                </label>
                <div className="relative">
                  <LockSimple
                    size={18}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="reg-password"
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); if (error) setError(''); }}
                    placeholder="Mínimo 6 caracteres"
                    autoComplete="new-password"
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

              {/* Confirm Password */}
              <div>
                <label htmlFor="reg-confirm" className="block text-sm font-semibold text-mid mb-1.5">
                  Confirmar Contraseña
                </label>
                <div className="relative">
                  <LockSimple
                    size={18}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="reg-confirm"
                    type={showPw ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); if (error) setError(''); }}
                    placeholder="Repite la contraseña"
                    autoComplete="new-password"
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
                    <span>Registrar cuenta</span>
                    <ArrowRight size={16} weight="bold" aria-hidden="true" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* Login link */}
          <p className="text-center text-sm text-lo pt-2">
            ¿Ya tienes una cuenta?{' '}
            <Link to="/login" className="font-semibold text-brand hover:text-brand-hover transition-colors">
              Inicia sesión aquí
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
