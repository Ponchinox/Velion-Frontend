import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * ProtectedRoute
 * Muestra un spinner mientras Firebase resuelve el estado de sesión.
 * Redirige a /login si no hay usuario autenticado.
 */
export default function ProtectedRoute({ children, allowedRoles }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  /* Mientras Firebase verifica la sesión → pantalla de carga */
  if (loading) {
    return (
      <div
        className="min-h-dvh bg-app flex flex-col items-center justify-center gap-3"
        role="status"
        aria-live="polite"
        aria-label="Verificando sesión..."
      >
        <svg
          className="animate-spin w-7 h-7 text-brand"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm text-lo">Verificando sesión...</p>
      </div>
    );
  }

  /* Sin usuario → redirige preservando la URL de destino */
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  /* Verificación de Plan Obligatorio (Paywall Gate) */
  const isSuperAdmin = user.role === 'superadmin';
  const hasPlan = isSuperAdmin || Boolean(user.hasPlan || user.tenant?.hasPlan || user.tenant?.planId || (user.plan && user.plan !== 'Sin Plan'));

  if (!hasPlan && location.pathname !== '/select-plan') {
    return <Navigate to="/select-plan" replace />;
  }

  if (hasPlan && location.pathname === '/select-plan') {
    return <Navigate to="/dashboard" replace />;
  }

  /* Control de Roles (RBAC) */
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/productos" replace />;
  }

  return children;
}
