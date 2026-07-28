import { createContext, useContext, useEffect, useState } from 'react';

/* ─────────────────────────────────────────────────────────────
   CONTEXTO DE AUTENTICACIÓN
   Credenciales SuperAdmin Oficial:
     nehiseroblitas2001@gmail.com / Undertale.926246740 -> rol: 'superadmin'
   La sesión persiste en localStorage bajo la clave "sa_token"
───────────────────────────────────────────────────────────── */

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
    const err = new Error('Credenciales incorrectas o servidor no disponible.');
    err.code = 'auth/invalid-credential';
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

  /**
   * updateUser — actualiza inmediatamente los datos de la sesión del usuario
   */
  const updateUser = (updatedData) => {
    setUser((prev) => {
      const newUser = prev ? { ...prev, ...updatedData } : updatedData;
      persistUser(newUser);
      return newUser;
    });
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, loginUser, updateUser }}>
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
