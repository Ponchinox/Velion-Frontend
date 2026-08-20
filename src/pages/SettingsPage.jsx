import React, { useState, useEffect } from 'react';
import {
  User,
  Building,
  Save,
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Key,
  ShieldCheck,
  ArrowLeft,
  CreditCard,
  Lock
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as settingsService from '../services/settingsService';
import * as userService from '../services/userService';
import { useUnsavedChanges } from '../context/UnsavedChangesContext';
import { useAuth } from '../context/AuthContext';

export default function SettingsPage() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState(null); // null (grid) | 'admin' | 'bot' | 'security' | 'billing'
  const [activeSubTab, setActiveSubTab] = useState('general'); // 'general' | 'operations'
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [hasAdvancedMarketing, setHasAdvancedMarketing] = useState(false);
  const [userPlanName, setUserPlanName] = useState('');

  // Estado del Cerebro del Bot (Persistido en Backend)
  const [botConfig, setBotConfig] = useState({
    logoUrl: '',
    companyName: '',
    taxId: '',
    address: '',
    phone: '',
    email: '',
    businessSector: '',
    bankAccounts: '',
    businessHours: '',
    termsAndPolicies: '',
    customPrompt: '',
    botRole: '',
    multiMessageMode: true,
    notificationPhone: '',
    notifySalesWhatsApp: false,
    aiEnabled: true,
  });

  // Estados Maqueta de Cuenta
  const [adminConfig, setAdminConfig] = useState({
    name: 'Administrador General',
    email: 'soporte@velionagent.com',
    phone: '+51 987 654 321',
    role: 'Socio Fundador'
  });

  const { setIsDirty } = useUnsavedChanges();
  const setIsFormDirty = setIsDirty;

  const [securityConfig, setSecurityConfig] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

    // Cargar configuraciones del Tenant y Administrador al montar
    useEffect(() => {
      async function loadSettings() {
        try {
          let tenantData = null;
          let userData = null;
  
          try {
            tenantData = await settingsService.getSettings();
          } catch (e) {
            console.error('Error cargando ajustes del tenant', e);
          }
  
          try {
            userData = await userService.getProfile();
          } catch (e) {
            console.error('Error cargando perfil del usuario', e);
          }
  
          if (tenantData) {
            const pName = (tenantData.planName || tenantData.plan || '').toLowerCase();
            const isProOrHigher = pName.includes('pro') || pName.includes('elite') || pName.includes('empresarial');
            setHasAdvancedMarketing(tenantData.hasAdvancedMarketing === true || user?.role === 'superadmin' || isProOrHigher);
            setUserPlanName(tenantData.planName || tenantData.plan || '');
            setBotConfig({
              logoUrl: tenantData.logoUrl || '',
              companyName: tenantData.companyName || '',
              taxId: tenantData.taxId || '',
              address: tenantData.address || '',
              phone: tenantData.phone || '',
              email: tenantData.email || '',
              businessSector: tenantData.businessSector || '',
              bankAccounts: tenantData.bankAccounts || '',
              businessHours: tenantData.businessHours || '',
              termsAndPolicies: tenantData.termsAndPolicies || '',
              customPrompt: tenantData.customPrompt || '',
              botRole: tenantData.botRole || '',
              multiMessageMode: tenantData.multiMessageMode !== false,
              notificationPhone: tenantData.notificationPhone || '',
              notifySalesWhatsApp: tenantData.notifySalesWhatsApp === true,
              marketingModeEnabled: tenantData.marketingModeEnabled === true,
              aiEnabled: tenantData.aiEnabled !== false,
            });
          }

          if (userData && userData.user) {
            const u = userData.user;
            setAdminConfig({
              name: u.name || '',
              email: u.email || '',
              phone: u.phone || '',
              role: u.role === 'superadmin' ? 'Super Admin' : u.role === 'client' ? 'Cliente Administrador' : 'Miembro de Equipo'
            });
          }
        } catch (error) {
          showToast(error.message || 'Error al recuperar los ajustes.', 'error');
        } finally {
          setIsLoading(false);
        }
      }
      loadSettings();
    }, []);

  const handleBotChange = (e) => {
    const { name, value } = e.target;
    setBotConfig((prev) => ({ ...prev, [name]: value }));
    setIsFormDirty(true);
  };

  const handleGeneratePromptExample = () => {
    setBotConfig((prev) => ({
      ...prev,
      customPrompt: "Eres un vendedor estrella. Saluda siempre con entusiasmo, usa 1 o 2 emojis estratégicos, responde dudas sobre el inventario sin rodeos, y pregunta siempre si desean separar el producto hoy. Trata al cliente de 'tú'."
    }));
    setIsFormDirty(true);
  };

  const handleAdminChange = (e) => {
    const { name, value } = e.target;
    setAdminConfig((prev) => ({ ...prev, [name]: value }));
    setIsFormDirty(true);
  };

  const handleSecurityChange = (e) => {
    const { name, value } = e.target;
    setSecurityConfig((prev) => ({ ...prev, [name]: value }));
    setIsFormDirty(true);
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        showToast('El archivo es demasiado grande. El límite es de 2MB.', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setBotConfig((prev) => ({ ...prev, logoUrl: reader.result }));
        showToast('Logo cargado correctamente. Presione Guardar para aplicar cambios.');
        setIsFormDirty(true);
      };
      reader.readAsDataURL(file);
    }
  };

  // Guardado Real del Cerebro del Bot
  const handleSaveBotConfig = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await settingsService.updateSettings(botConfig);
      window.dispatchEvent(new CustomEvent('tenantSettingsUpdated', { detail: botConfig }));
      showToast('Ajustes del Cerebro de IA actualizados correctamente.');
      setIsFormDirty(false);
    } catch (error) {
      showToast(error.message || 'Error al actualizar los ajustes de la empresa.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveAdminConfig = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const response = await userService.updateProfile({
        name: adminConfig.name,
        email: adminConfig.email,
        phone: adminConfig.phone
      });
      const updatedUser = response?.user || {
        ...user,
        name: adminConfig.name,
        email: adminConfig.email,
        phone: adminConfig.phone
      };
      setAdminConfig({
        name: updatedUser.name || '',
        email: updatedUser.email || '',
        phone: updatedUser.phone || '',
        role: updatedUser.role === 'superadmin' ? 'Super Admin' : updatedUser.role === 'client' ? 'Cliente Administrador' : 'Miembro de Equipo'
      });
      updateUser(updatedUser);
      showToast('Perfil de administrador actualizado con éxito.');
      setIsFormDirty(false);
    } catch (error) {
      showToast(error.message || 'Error al actualizar el perfil de administrador.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveSecurityConfig = async (e) => {
    e.preventDefault();
    if (securityConfig.newPassword !== securityConfig.confirmPassword) {
      showToast('La nueva contraseña y la confirmación no coinciden.', 'error');
      return;
    }
    setIsSubmitting(true);
    try {
      await userService.updatePassword({
        currentPassword: securityConfig.currentPassword,
        newPassword: securityConfig.newPassword
      });
      showToast('Contraseña actualizada con éxito.');
      setSecurityConfig({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
      setIsFormDirty(false);
    } catch (error) {
      showToast(error.message || 'Error al actualizar la contraseña.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };



  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] text-lo">
        <Loader2 size={36} className="animate-spin text-brand mb-2" />
        <p className="text-xs font-semibold">Cargando ajustes globales...</p>
      </div>
    );
  }

  // --- VISTA A: GRILLA DE TARJETAS (Bento Grid original) ---
  if (activeSection === null) {
    const GRID_ITEMS = [
      {
        id: 'admin',
        Icon: User,
        label: 'Perfil de Administrador',
        desc: 'Nombre, correo y datos de cuenta',
        bgClass: 'bg-blue-50',
        iconClass: 'text-blue-600'
      },
      {
        id: 'bot',
        Icon: Building,
        label: 'Cerebro del Bot (Empresa)',
        desc: 'Contexto institucional de la empresa para la IA',
        bgClass: 'bg-indigo-50',
        iconClass: 'text-indigo-600'
      },
      {
        id: 'security',
        Icon: ShieldCheck,
        label: 'Seguridad',
        desc: 'Contraseña, 2FA y accesos',
        bgClass: 'bg-red-50',
        iconClass: 'text-red-600'
      },
      {
        id: 'billing',
        Icon: CreditCard,
        label: 'Facturación & Plan',
        desc: 'Tu plan activo, pagos y método Yape',
        bgClass: 'bg-emerald-50',
        iconClass: 'text-emerald-600'
      }
    ];

    return (
      <div className="w-full h-full flex flex-col flex-1">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-xl font-bold text-gray-900">Ajustes</h1>
          <p className="text-sm text-gray-500 mt-2">
            Administra las preferencias globales del panel.
          </p>
        </div>

        {/* Bento Grid Layout */}
        <div className="w-full grid gap-6 grid-cols-[repeat(auto-fit,minmax(320px,1fr))]">
          {GRID_ITEMS.map(({ id, Icon, label, desc, bgClass, iconClass }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className="w-full h-full flex flex-col items-start p-6 text-left bg-white border border-gray-200 rounded-xl shadow-2xs hover:border-blue-500 hover:shadow-md cursor-pointer group"
            >
              {/* Icon wrapper identical to mockup */}
              <div className={`flex items-center justify-center w-12 h-12 rounded-xl ${bgClass} ${iconClass}`}>
                <Icon size={22} />
              </div>

              {/* Title */}
              <h3 className="text-sm font-bold text-gray-900 mt-4 tracking-tight">
                {label}
              </h3>

              {/* Description */}
              <p className="text-sm text-gray-500 mt-1 leading-snug">
                {desc}
              </p>
            </button>
          ))}
        </div>

        {/* Toasts */}
        {toast && (
          <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-card bg-white border-gray-200">
            {toast.type === 'success' ? (
              <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertCircle size={16} className="text-rose-600 flex-shrink-0" />
            )}
            <span className="text-xs text-gray-700 font-medium">{toast.msg}</span>
          </div>
        )}
      </div>
    );
  }

  // --- VISTA B: DETALLE DE CONFIGURACIÓN SELECCIONADA ---
  return (
    <div className="w-full h-full flex flex-col flex-1">
      {/* Botón de Retorno */}
      <button
        onClick={() => setActiveSection(null)}
        className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:text-blue-700 transition-colors cursor-pointer mb-6"
      >
        <ArrowLeft size={14} />
        <span>Volver a Ajustes</span>
      </button>

      {/* Contenedor del Formulario */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 md:p-8 shadow-sm">
        
        {/* FORM 1: Perfil de Administrador */}
        {activeSection === 'admin' && (
          <form onSubmit={handleSaveAdminConfig} className="space-y-6">
            <div className="pb-3 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Perfil de Administrador</h2>
              <p className="text-sm text-gray-500 mt-0.5">Administra tus datos de contacto y rol de sistema.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Nombre Completo</label>
                <input
                  type="text"
                  name="name"
                  value={adminConfig.name}
                  onChange={handleAdminChange}
                  className="w-full px-4 py-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Rol de Cuenta</label>
                <input
                  type="text"
                  name="role"
                  disabled
                  value={adminConfig.role}
                  className="w-full px-4 py-3 rounded-md border border-gray-200 bg-gray-100/70 text-sm text-gray-500 cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Correo Electrónico</label>
                <input
                  type="email"
                  name="email"
                  value={adminConfig.email}
                  onChange={handleAdminChange}
                  className="w-full px-4 py-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Teléfono Móvil</label>
                <input
                  type="text"
                  name="phone"
                  value={adminConfig.phone}
                  onChange={handleAdminChange}
                  className="w-full px-4 py-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end pt-5 border-t border-gray-100">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow transition-all cursor-pointer disabled:opacity-40"
              >
                {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                <span>Guardar Cambios</span>
              </button>
            </div>
          </form>
        )}

        {/* FORM 2: Cerebro del Bot (Empresa) */}
        {activeSection === 'bot' && (
          <div className="space-y-6">
            <div className="pb-3 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Cerebro del Bot (Contexto IA)</h2>
              <p className="text-sm text-gray-500 mt-0.5">Instrucciones y contexto empresarial que leerá la Inteligencia Artificial.</p>
            </div>

            <div className="flex border-b border-gray-200 mb-6">
              <button
                type="button"
                onClick={() => setActiveSubTab('general')}
                className={`pb-2 border-b-2 text-sm font-bold transition-all cursor-pointer mr-6
                  ${activeSubTab === 'general' ? 'text-blue-600 border-blue-600' : 'text-gray-500 border-transparent hover:text-gray-700'}
                `}
              >
                Información General
              </button>
              <button
                type="button"
                onClick={() => setActiveSubTab('operations')}
                className={`pb-2 border-b-2 text-sm font-bold transition-all cursor-pointer mr-6
                  ${activeSubTab === 'operations' ? 'text-blue-600 border-blue-600' : 'text-gray-500 border-transparent hover:text-gray-700'}
                `}
              >
                Operaciones
              </button>
            </div>

            <form onSubmit={handleSaveBotConfig} className="space-y-6">
              {activeSubTab === 'general' && (
                <div className="space-y-6">
                  {/* Logotipo */}
                  <div className="flex items-center gap-5 pb-5 border-b border-gray-100 col-span-full">
                    <div className="w-16 h-16 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {botConfig.logoUrl ? (
                        <img src={botConfig.logoUrl} alt="Logo" className="object-contain w-full h-full" />
                      ) : (
                        <Building size={28} className="text-gray-400" />
                      )}
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-gray-900">Logo Corporativo</p>
                      <div className="flex gap-2">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          id="bot-logo-uploader"
                          onChange={handleLogoUpload}
                        />
                        <label
                          htmlFor="bot-logo-uploader"
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-gray-200 bg-white text-3xs font-bold text-gray-700 hover:bg-gray-50 cursor-pointer transition-all"
                        >
                          <Upload size={11} />
                          Subir Logo
                        </label>
                        {botConfig.logoUrl && (
                          <button
                            type="button"
                            onClick={() => setBotConfig(p => ({ ...p, logoUrl: '' }))}
                            className="px-3 py-1.5 rounded border border-gray-200 bg-white text-3xs font-bold text-rose-600 hover:bg-gray-50 transition-all"
                          >
                            Remover
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Nombre Comercial de la Empresa</label>
                      <input
                        type="text"
                        name="companyName"
                        value={botConfig.companyName}
                        onChange={handleBotChange}
                        className="w-full px-4 py-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                        placeholder="Nombre comercial"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">RUC / Identificación Fiscal</label>
                      <input
                        type="text"
                        name="taxId"
                        value={botConfig.taxId}
                        onChange={handleBotChange}
                        className="w-full px-4 py-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all font-mono"
                        placeholder="RUC"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Dirección de Oficina</label>
                      <input
                        type="text"
                        name="address"
                        value={botConfig.address}
                        onChange={handleBotChange}
                        className="w-full px-4 py-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                        placeholder="Dirección corporativa"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Actividad / Giro Comercial</label>
                      <input
                        type="text"
                        name="businessSector"
                        value={botConfig.businessSector}
                        onChange={handleBotChange}
                        className="w-full px-4 py-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                        placeholder="ej. Tienda de ropa de anime"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Teléfono Corporativo</label>
                      <input
                        type="text"
                        name="phone"
                        value={botConfig.phone}
                        onChange={handleBotChange}
                        className="w-full px-4 py-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all font-mono"
                        placeholder="Teléfono corporativo"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Correo Electrónico de Soporte</label>
                      <input
                        type="email"
                        name="email"
                        value={botConfig.email}
                        onChange={handleBotChange}
                        className="w-full px-4 py-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                        placeholder="soporte@empresa.com"
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <label className="block text-sm font-semibold text-gray-700">
                          Teléfono para recibir Alertas (Opcional)
                        </label>
                        <div className="group relative cursor-pointer text-gray-400 hover:text-gray-600 flex items-center">
                          <HelpCircle size={15} />
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-72 p-2.5 rounded-lg bg-gray-900 text-white shadow-xl text-xs leading-relaxed text-center z-30 pointer-events-none animate-in fade-in duration-150">
                            El bot enviará alertas de ventas o peticiones de ayuda a este número. Si lo dejas vacío, las alertas llegarán al teléfono de tu Perfil de Administrador.
                            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900" />
                          </div>
                        </div>
                      </div>
                      <input
                        type="text"
                        name="notificationPhone"
                        value={botConfig.notificationPhone || ''}
                        onChange={handleBotChange}
                        className="w-full px-4 py-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all font-mono"
                        placeholder="ej: +51 987654321"
                      />
                    </div>

                    <div className="col-span-full">
                      <div className="flex items-center gap-2 mb-1.5">
                        <label className="block text-sm font-semibold text-gray-700">Identidad e Instrucciones Principales</label>
                        <div className="group relative cursor-pointer text-gray-400 hover:text-gray-600 flex items-center">
                          <HelpCircle size={15} />
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-72 p-2.5 rounded-lg bg-gray-900 text-white shadow-xl text-xs leading-relaxed text-center z-30 pointer-events-none animate-in fade-in duration-150">
                            Define la personalidad y el tono de tu bot. Escribe aquí cómo debe comportarse, si debe ser formal, amigable o si tiene reglas estrictas de venta.
                            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900" />
                          </div>
                        </div>
                      </div>
                      <textarea
                        name="botRole"
                        maxLength={1500}
                        value={botConfig.botRole || botConfig.customPrompt || ''}
                        onChange={(e) => {
                          setBotConfig(prev => ({
                            ...prev,
                            botRole: e.target.value,
                            customPrompt: e.target.value
                          }));
                          setIsFormDirty(true);
                        }}
                        rows={5}
                        className="w-full px-4 py-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all resize-none leading-relaxed font-mono"
                        placeholder=""
                      />
                      <div className="text-right mt-1">
                        <span className="text-xs text-gray-400 font-mono">{(botConfig.botRole || botConfig.customPrompt || '').length} / 1500</span>
                      </div>
                    </div>

                    {/* Checkbox: Notificar pedidos cerrados por WhatsApp */}
                    <div className="col-span-full flex items-center gap-2 pt-2">
                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          name="notifySalesWhatsApp"
                          checked={botConfig.notifySalesWhatsApp === true}
                          onChange={(e) => {
                            setBotConfig(prev => ({ ...prev, notifySalesWhatsApp: e.target.checked }));
                            setIsFormDirty(true);
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                        <span className="text-sm font-semibold text-gray-800">
                          Notificar pedidos cerrados por WhatsApp
                        </span>
                      </label>
                      <div className="group relative cursor-pointer text-gray-400 hover:text-gray-600 flex items-center">
                        <HelpCircle size={15} />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-64 p-2.5 rounded-lg bg-gray-900 text-white shadow-xl text-xs leading-relaxed text-center z-30 pointer-events-none animate-in fade-in duration-150">
                          A este número de WhatsApp la IA enviará un resumen automático con los datos del cliente (dirección, pedido, monto) cada vez que se concrete una venta o envío.
                          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900" />
                        </div>
                      </div>
                    </div>

                    {/* Botón: Activar/Desactivar Inteligencia Artificial */}
                    <div className="col-span-full flex items-center gap-2 pt-4 mt-2 border-t border-gray-100">
                      <div className="flex flex-col gap-1 w-full">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-gray-800">
                            Estado de la Inteligencia Artificial
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setBotConfig(prev => ({ ...prev, aiEnabled: !prev.aiEnabled }));
                              setIsFormDirty(true);
                            }}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors border cursor-pointer ${botConfig.aiEnabled !== false ? 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50' : 'bg-gray-100 border-gray-200 text-gray-500 hover:bg-gray-200'}`}
                          >
                            {botConfig.aiEnabled !== false ? 'Desactivar IA' : 'Activar IA'}
                          </button>
                        </div>
                        <p className="text-xs text-gray-500">
                          {botConfig.aiEnabled !== false
                            ? 'La Inteligencia Artificial está actualmente activada y respondiendo a los clientes.'
                            : 'La Inteligencia Artificial está desactivada. No consumirá tokens ni responderá mensajes.'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}



              {activeSubTab === 'operations' && (
                <div className="grid grid-cols-1 gap-6">
                  <div className="col-span-full">
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Horarios de Atención</label>
                    <textarea
                      name="businessHours"
                      maxLength={300}
                      value={botConfig.businessHours}
                      onChange={handleBotChange}
                      rows={3}
                      className="w-full px-4 py-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all resize-none leading-relaxed col-span-full"
                      placeholder=""
                    />
                    <div className="text-right mt-1">
                      <span className="text-xs text-gray-400 font-mono">{(botConfig.businessHours || '').length} / 300</span>
                    </div>
                  </div>

                  <div className="col-span-full">
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Políticas de Envío y Devoluciones</label>
                    <textarea
                      name="termsAndPolicies"
                      maxLength={800}
                      value={botConfig.termsAndPolicies}
                      onChange={handleBotChange}
                      rows={5}
                      className="w-full px-4 py-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all resize-none leading-relaxed col-span-full"
                      placeholder=""
                    />
                    <div className="text-right mt-1">
                      <span className="text-xs text-gray-400 font-mono">{(botConfig.termsAndPolicies || '').length} / 800</span>
                    </div>
                  </div>

                  <div className="col-span-full">
                    <div className="flex items-center gap-2 mb-1.5">
                      <label className="block text-sm font-semibold text-gray-700">Cuentas Bancarias e Instrucciones de Pago (Clientes)</label>
                      <div className="group relative cursor-pointer text-gray-400 hover:text-gray-600">
                        <HelpCircle size={13} />
                        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block w-52 p-2 rounded bg-white border border-gray-200 shadow-lg text-[9px] leading-relaxed text-gray-700 z-10">
                          Escribe las cuentas bancarias donde tus clientes te transferirán el dinero de sus compras.
                        </span>
                      </div>
                    </div>
                    <textarea
                      name="bankAccounts"
                      maxLength={500}
                      value={botConfig.bankAccounts}
                      onChange={handleBotChange}
                      rows={4}
                      className="w-full px-4 py-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all font-mono resize-none leading-relaxed col-span-full"
                      placeholder=""
                    />
                    <div className="flex items-center justify-between mt-1.5">
                      <p className="text-xs text-gray-500 leading-relaxed">
                        Escribe tus cuentas y métodos de pago exactamente como quieres que el cliente los lea. Nuestro bot los enviará tal cual sin modificarlos.
                      </p>
                      <span className="text-xs text-gray-400 font-mono flex-shrink-0 ml-2">{(botConfig.bankAccounts || '').length} / 500</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-5 border-t border-gray-100 col-span-full">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow transition-all cursor-pointer disabled:opacity-40"
                >
                  {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  <span>Guardar Cambios</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* FORM 3: Seguridad */}
        {activeSection === 'security' && (
          <form onSubmit={handleSaveSecurityConfig} className="space-y-6">
            <div className="pb-3 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Seguridad y Acceso</h2>
              <p className="text-sm text-gray-500 mt-0.5">Actualiza tu contraseña de acceso para proteger tu sesión.</p>
            </div>

            <div className="space-y-5 w-full">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Contraseña Actual</label>
                <input
                  type="password"
                  name="currentPassword"
                  value={securityConfig.currentPassword}
                  onChange={handleSecurityChange}
                  className="w-full px-4 py-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Nueva Contraseña</label>
                <input
                  type="password"
                  name="newPassword"
                  value={securityConfig.newPassword}
                  onChange={handleSecurityChange}
                  className="w-full px-4 py-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                  placeholder="Mínimo 8 caracteres"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Confirmar Nueva Contraseña</label>
                <input
                  type="password"
                  name="confirmPassword"
                  value={securityConfig.confirmPassword}
                  onChange={handleSecurityChange}
                  className="w-full px-4 py-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                  placeholder="Confirme nueva contraseña"
                />
              </div>
            </div>

            <div className="flex justify-end pt-5 border-t border-gray-100">
              <button
                type="submit"
                disabled={isSubmitting || !securityConfig.newPassword}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow transition-all cursor-pointer disabled:opacity-40"
              >
                {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Key size={13} />}
                <span>Cambiar Contraseña</span>
              </button>
            </div>
          </form>
        )}

        {/* FORM 4: Facturación & Plan */}
        {activeSection === 'billing' && (
          <div className="space-y-6">
            <div className="pb-3 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Facturación & Plan</h2>
              <p className="text-sm text-gray-500 mt-0.5">Gestiona tu plan activo y realiza pagos con Yape.</p>
            </div>

            {/* Plan activo */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-emerald-50 border border-emerald-200">
              <div>
                <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">Plan Activo</p>
                <p className="text-base font-bold text-gray-900 mt-0.5">
                  {user?.planFeatures?.name || user?.plan || 'Sin Plan'}
                </p>
                {user?.planFeatures && (
                  <p className="text-xs text-gray-500 mt-1">
                    {user.planFeatures.msgLimit?.toLocaleString()} msg/mes · {user.planFeatures.connLimit} conexión(es) · {user.planFeatures.maxProducts === 999999 ? 'Productos ilimitados' : `Hasta ${user.planFeatures.maxProducts} productos`}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600">
                <CreditCard size={20} />
              </div>
            </div>

            {/* Botón para ir a la página completa de Facturación */}
            <div className="flex justify-start pt-2">
              <button
                onClick={() => navigate('/billing')}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow transition-all cursor-pointer"
              >
                <CreditCard size={14} />
                <span>Ver Planes & Realizar Pago Yape</span>
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Toasts */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-card bg-white border-gray-200">
          {toast.type === 'success' ? (
            <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertCircle size={16} className="text-rose-600 flex-shrink-0" />
          )}
          <span className="text-xs text-gray-700 font-medium">{toast.msg}</span>
        </div>
      )}
    </div>
  );
}
