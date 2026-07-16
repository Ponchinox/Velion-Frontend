import { createContext, useContext, useEffect, useState } from 'react';

/* ─────────────────────────────────────────────────────────────
   AUTH SIMULADO — modo local sin Firebase con soporte RBAC
   Credenciales de prueba:
     a) admin@test.com / 123456   -> rol: 'superadmin'
     b) cliente@test.com / 123456 -> rol: 'client'
   La sesión persiste en localStorage bajo la clave "sa_mock_user"
───────────────────────────────────────────────────────────── */

// Importaciones reales de Firebase (comentadas hasta reactivar cuota):
// import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
// import { auth } from '../firebase';

const STORAGE_KEY = 'sa_mock_user';

/* ── Helpers de persistencia ── */
function loadPersistedUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistUser(user) {
  if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  else       localStorage.removeItem(STORAGE_KEY);
}

/* ── Context ── */
const AuthContext = createContext(null);

/* ── Provider ── */
export function AuthProvider({ children }) {
  // Inicia desde localStorage para persistir entre recargas
  const [user, setUser]       = useState(() => loadPersistedUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simula el tiempo de verificación
    const timer = setTimeout(() => setLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  /**
   * signIn — simulador local con soporte para múltiples roles
   */
  const signIn = async (email, password) => {
    // Simula latencia de red
    await new Promise(r => setTimeout(r, 700));

    const cleanEmail = email.trim().toLowerCase();

    if (cleanEmail === 'admin@test.com' && password === '123456') {
      const mockUser = {
        uid:         'mock-uid-superadmin',
        email:       'admin@test.com',
        displayName: 'Super Admin',
        role:        'superadmin',
      };
      setUser(mockUser);
      persistUser(mockUser);
      return mockUser;
    } else if (cleanEmail === 'cliente@test.com' && password === '123456') {
      const mockUser = {
        uid:         'mock-uid-client',
        email:       'cliente@test.com',
        displayName: 'Cliente Demo',
        role:        'client',
      };
      setUser(mockUser);
      persistUser(mockUser);
      return mockUser;
    }

    // Error en el mismo formato que Firebase Auth
    const err  = new Error('Credenciales incorrectas.');
    err.code   = 'auth/invalid-credential';
    throw err;
  };

  /**
   * signOut — limpia estado local y localStorage
   */
  const signOut = () => {
    setUser(null);
    persistUser(null);
    localStorage.removeItem('sa_token');
  };

  /**
   * loginUser — registra la sesión iniciada desde el servicio API real
   */
  const loginUser = (userData, token) => {
    setUser(userData);
    persistUser(userData);
    if (token) {
      localStorage.setItem('sa_token', token);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, loginUser }}>
      {children}
    </AuthContext.Provider>
  );
}

/* ── Hook ── */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
