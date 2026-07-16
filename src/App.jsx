import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import MainLayout from './components/layout/MainLayout';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import CampaignsPage from './pages/CampaignsPage';
import AiBrainPage from './pages/AiBrainPage';
import ConexionesPage from './pages/ConexionesPage';
import ContactosPage from './pages/ContactosPage';
import ChatPage from './pages/ChatPage';
import FlowBuilderPage from './pages/FlowBuilderPage';
import AdminEmpresasPage from './pages/AdminEmpresasPage';
import AdminPlanesPage from './pages/AdminPlanesPage';
import AdminConfiguracionPage from './pages/AdminConfiguracionPage';
import AdminAlertsPage from './pages/AdminAlertsPage';
import AdminBackupsPage from './pages/AdminBackupsPage';
import Products from './pages/Products';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Ruta pública */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* Rutas protegidas — requieren sesión y manejan RBAC en menús */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard"  element={<DashboardPage />} />
            
            {/* Rutas SuperAdmin */}
            <Route path="admin-empresas" element={<AdminEmpresasPage />} />
            <Route path="admin-planes"   element={<AdminPlanesPage />} />
            <Route path="admin-config"   element={<AdminConfiguracionPage />} />
            <Route path="admin-alertas"  element={<AdminAlertsPage />} />
            <Route path="admin-backups"  element={<AdminBackupsPage />} />
            
            {/* Nuevas rutas de soporte para el rol de Cliente */}
            <Route path="campanas"        element={<CampaignsPage />} />
            <Route path="cerebro-ia"      element={<AiBrainPage />} />
            <Route path="conexiones"      element={<ConexionesPage />} />
            <Route path="contactos"       element={<ContactosPage />} />
            <Route path="mensajes"        element={<ChatPage />} />
            <Route path="automatizacion"  element={<FlowBuilderPage />} />
            <Route path="inventario"      element={<Products />} />
            
            <Route path="settings"   element={<SettingsPage />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
