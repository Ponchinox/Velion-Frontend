import { createBrowserRouter, createRoutesFromElements, RouterProvider, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import BillingPage from './pages/BillingPage';
import SuccessPage from './pages/SuccessPage';
import CancelPage from './pages/CancelPage';
import MainLayout from './components/layout/MainLayout';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import CampaignsPage from './pages/CampaignsPage';
import ConexionesPage from './pages/ConexionesPage';
import ContactosPage from './pages/ContactosPage';
import ChatPage from './pages/ChatPage';
import FlowBuilderPage from './pages/FlowBuilderPage';
import AdminEmpresasPage from './pages/AdminEmpresasPage';
import AdminPlanesPage from './pages/AdminPlanesPage';
import AdminConfiguracionPage from './pages/AdminConfiguracionPage';
import AdminAlertsPage from './pages/AdminAlertsPage';
import AdminBackupsPage from './pages/AdminBackupsPage';
import { useAuth } from './context/AuthContext';
import Products from './pages/Products';
import TenantDashboardPage from './pages/TenantDashboardPage';
import PlanSelectionPage from './pages/PlanSelectionPage';
import { UnsavedChangesProvider } from './context/UnsavedChangesContext';

// Redireccionador inteligente del Dashboard según el rol del usuario
function DashboardRedirect() {
  const { user } = useAuth();
  if (user?.role === 'client') {
    return <TenantDashboardPage />;
  }
  return <DashboardPage />;
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      {/* Ruta pública */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/success" element={<SuccessPage />} />
      <Route path="/cancel" element={<CancelPage />} />

      {/* Vista independiente de selección de plan (Sin Sidebar/Topbar) */}
      <Route
        path="/select-plan"
        element={
          <ProtectedRoute>
            <PlanSelectionPage />
          </ProtectedRoute>
        }
      />

      {/* Rutas protegidas — requieren sesión y manejan RBAC en menús */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <UnsavedChangesProvider>
              <MainLayout />
            </UnsavedChangesProvider>
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardRedirect />} />
        
        {/* Rutas SuperAdmin */}
        <Route
          path="admin-empresas"
          element={
            <ProtectedRoute allowedRoles={['superadmin']}>
              <AdminEmpresasPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin-planes"
          element={
            <ProtectedRoute allowedRoles={['superadmin']}>
              <AdminPlanesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin-config"
          element={
            <ProtectedRoute allowedRoles={['superadmin']}>
              <AdminConfiguracionPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin-alertas"
          element={
            <ProtectedRoute allowedRoles={['superadmin']}>
              <AdminAlertsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin-backups"
          element={
            <ProtectedRoute allowedRoles={['superadmin']}>
              <AdminBackupsPage />
            </ProtectedRoute>
          }
        />
        
        {/* Nuevas rutas de soporte para el rol de Cliente */}
        <Route path="campanas"        element={<CampaignsPage />} />
        <Route path="conexiones"      element={<ConexionesPage />} />
        <Route path="contactos"       element={<ContactosPage />} />
        <Route path="mensajes"        element={<ChatPage />} />
        <Route path="automatizacion"  element={<FlowBuilderPage />} />
        <Route path="productos"       element={<Products />} />
        <Route path="billing"         element={<BillingPage />} />
        
        <Route path="settings"   element={<SettingsPage />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </>
  )
);

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
