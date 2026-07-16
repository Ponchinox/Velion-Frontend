import React, { useState, useEffect } from 'react';
import {
  User,
  CreditCard,
  Building,
  Save,
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Key,
  Lock,
  Calendar
} from 'lucide-react';
import * as settingsService from '../services/settingsService';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('admin'); // 'admin' | 'bot' | 'security' | 'billing'
  const [activeSubTab, setActiveSubTab] = useState('general'); // 'general' | 'billing' | 'operations'
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

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
    termsAndPolicies: ''
  });

  // Estados Maqueta de Cuenta
  const [adminConfig, setAdminConfig] = useState({
    name: 'Administrador General',
    email: 'soporte@velion.co',
    phone: '+51 987 654 321',
    role: 'Socio Fundador'
  });

  const [securityConfig, setSecurityConfig] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Cargar configuraciones del Tenant al montar
  useEffect(() => {
    async function loadSettings() {
      try {
        const data = await settingsService.getSettings();
        if (data) {
          setBotConfig({
            logoUrl: data.logoUrl || '',
            companyName: data.companyName || '',
            taxId: data.taxId || '',
            address: data.address || '',
            phone: data.phone || '',
            email: data.email || '',
            businessSector: data.businessSector || '',
            bankAccounts: data.bankAccounts || '',
            businessHours: data.businessHours || '',
            termsAndPolicies: data.termsAndPolicies || ''
          });

          // Rellenar de forma automática datos del administrador
          setAdminConfig((prev) => ({
            ...prev,
            email: data.email || prev.email,
            name: data.companyName ? `${data.companyName} Admin` : prev.name
          }));
        }
      } catch (error) {
        showToast(error.message || 'Error al recuperar los ajustes de la empresa.', 'error');
      } finally {
        setIsLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleBotChange = (e) => {
    const { name, value } = e.target;
    setBotConfig((prev) => ({ ...prev, [name]: value }));
  };

  const handleAdminChange = (e) => {
    const { name, value } = e.target;
    setAdminConfig((prev) => ({ ...prev, [name]: value }));
  };

  const handleSecurityChange = (e) => {
    const { name, value } = e.target;
    setSecurityConfig((prev) => ({ ...prev, [name]: value }));
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
      showToast('Ajustes del Cerebro de IA actualizados correctamente.');
    } catch (error) {
      showToast(error.message || 'Error al actualizar los ajustes de la empresa.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Guardado Maqueta para otros paneles
  const handleMockSave = (e, sectionName) => {
    e.preventDefault();
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      showToast(`Cambios de ${sectionName} guardados con éxito (Simulación).`);
    }, 800);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] text-lo">
        <Loader2 size={36} className="animate-spin text-brand mb-2" />
        <p className="text-xs font-semibold">Cargando configuraciones corporativas...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6 bg-gray-50 min-h-screen w-full animate-in fade-in duration-300">
      {/* Columna Izquierda: Menú Lateral de Ajustes */}
      <div className="w-full md:w-64 flex-shrink-0 space-y-4">
        <div className="px-1">
          <h1 className="text-base font-bold text-gray-900">Configuración</h1>
          <p className="text-3xs text-gray-500 mt-1 leading-snug">Gestiona tus preferencias de cuenta e IA corporativa.</p>
        </div>
        
        <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-col gap-1 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveTab('admin')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-bold transition-all text-left cursor-pointer
              ${activeTab === 'admin'
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }
            `}
          >
            <User size={15} />
            <span>Perfil de Administrador</span>
          </button>
          
          <button
            type="button"
            onClick={() => setActiveTab('bot')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-bold transition-all text-left cursor-pointer
              ${activeTab === 'bot'
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }
            `}
          >
            <Building size={15} />
            <span>Cerebro del Bot (Empresa)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('security')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-bold transition-all text-left cursor-pointer
              ${activeTab === 'security'
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }
            `}
          >
            <Lock size={15} />
            <span>Seguridad</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('billing')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-bold transition-all text-left cursor-pointer
              ${activeTab === 'billing'
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }
            `}
          >
            <CreditCard size={15} />
            <span>Facturación</span>
          </button>
        </div>
      </div>

      {/* Columna Derecha: Contenido principal del Formulario */}
      <div className="flex-1 bg-white p-6 md:p-8 rounded-xl shadow-sm border border-gray-200">
        
        {/* TAB 1: Perfil de Administrador (Mock) */}
        {activeTab === 'admin' && (
          <form onSubmit={(e) => handleMockSave(e, 'Perfil de Administrador')} className="space-y-5 animate-in fade-in duration-200">
            <div className="pb-3 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-900">Perfil de Administrador</h2>
              <p className="text-3xs text-gray-500 mt-0.5">Datos de contacto personales y tu rol activo en el sistema.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-[10px] font-semibold text-gray-700 mb-1">Nombre Completo</label>
                <input
                  type="text"
                  name="name"
                  value={adminConfig.name}
                  onChange={handleAdminChange}
                  className="w-full px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-700 mb-1">Rol Administrativo</label>
                <input
                  type="text"
                  name="role"
                  disabled
                  value={adminConfig.role}
                  className="w-full px-3 py-2 rounded-md border border-gray-200 bg-gray-100/70 text-xs text-gray-500 focus:outline-none cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-700 mb-1">Correo Electrónico</label>
                <input
                  type="email"
                  name="email"
                  value={adminConfig.email}
                  onChange={handleAdminChange}
                  className="w-full px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-700 mb-1">Teléfono Directo</label>
                <input
                  type="text"
                  name="phone"
                  value={adminConfig.phone}
                  onChange={handleAdminChange}
                  className="w-full px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end pt-5 border-t border-gray-100">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow transition-all cursor-pointer disabled:opacity-40"
              >
                {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                <span>Guardar Cambios</span>
              </button>
            </div>
          </form>
        )}

        {/* TAB 2: Cerebro del Bot (Empresa) - Persistido Real */}
        {activeTab === 'bot' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="pb-3 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-900">Cerebro del Bot (Contexto IA)</h2>
              <p className="text-3xs text-gray-500 mt-0.5">Especifica el contexto institucional de tu negocio para la IA del chatbot.</p>
            </div>

            {/* Sub-Pestañas Superiores de Empresa con diseño de bordes inferiores */}
            <div className="flex border-b border-gray-200 mb-6">
              <button
                type="button"
                onClick={() => setActiveSubTab('general')}
                className={`pb-2 border-b-2 text-xs font-bold transition-all cursor-pointer mr-6
                  ${activeSubTab === 'general'
                    ? 'text-blue-600 border-blue-600'
                    : 'text-gray-500 border-transparent hover:text-gray-700'
                  }
                `}
              >
                Información General
              </button>
              <button
                type="button"
                onClick={() => setActiveSubTab('billing')}
                className={`pb-2 border-b-2 text-xs font-bold transition-all cursor-pointer mr-6
                  ${activeSubTab === 'billing'
                    ? 'text-blue-600 border-blue-600'
                    : 'text-gray-500 border-transparent hover:text-gray-700'
                  }
                `}
              >
                Facturación y Pagos
              </button>
              <button
                type="button"
                onClick={() => setActiveSubTab('operations')}
                className={`pb-2 border-b-2 text-xs font-bold transition-all cursor-pointer mr-6
                  ${activeSubTab === 'operations'
                    ? 'text-blue-600 border-blue-600'
                    : 'text-gray-500 border-transparent hover:text-gray-700'
                  }
                `}
              >
                Operaciones
              </button>
            </div>

            {/* Contenedor del Formulario */}
            <form onSubmit={handleSaveBotConfig} className="space-y-6">
              {activeSubTab === 'general' && (
                <div className="space-y-6">
                  {/* Carga del Logo Comercial */}
                  <div className="flex items-center gap-5 pb-5 border-b border-gray-100 col-span-full">
                    <div className="w-16 h-16 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {botConfig.logoUrl ? (
                        <img src={botConfig.logoUrl} alt="Logo" className="object-contain w-full h-full" />
                      ) : (
                        <Building size={28} className="text-gray-400" />
                      )}
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-gray-900">Logo de Empresa</p>
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
                      <label className="block text-[10px] font-semibold text-gray-700 mb-1">Nombre Comercial</label>
                      <input
                        type="text"
                        name="companyName"
                        value={botConfig.companyName}
                        onChange={handleBotChange}
                        className="w-full px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                        placeholder="Nombre comercial"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-700 mb-1">RUC / Identificación Fiscal</label>
                      <input
                        type="text"
                        name="taxId"
                        value={botConfig.taxId}
                        onChange={handleBotChange}
                        className="w-full px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all font-mono"
                        placeholder="RUC"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-700 mb-1">Dirección Física</label>
                      <input
                        type="text"
                        name="address"
                        value={botConfig.address}
                        onChange={handleBotChange}
                        className="w-full px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                        placeholder="Dirección corporativa"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-700 mb-1">Actividad / Giro de Negocio</label>
                      <input
                        type="text"
                        name="businessSector"
                        value={botConfig.businessSector}
                        onChange={handleBotChange}
                        className="w-full px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                        placeholder="ej. Tienda de ropa de anime"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-700 mb-1">Teléfono de Soporte</label>
                      <input
                        type="text"
                        name="phone"
                        value={botConfig.phone}
                        onChange={handleBotChange}
                        className="w-full px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all font-mono"
                        placeholder="Teléfono corporativo"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-700 mb-1">Correo de Soporte</label>
                      <input
                        type="email"
                        name="email"
                        value={botConfig.email}
                        onChange={handleBotChange}
                        className="w-full px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                        placeholder="soporte@empresa.com"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'billing' && (
                <div className="grid grid-cols-1 gap-6">
                  <div className="col-span-full">
                    <div className="flex items-center gap-2 mb-1.5">
                      <label className="block text-[10px] font-semibold text-gray-700">Cuentas Bancarias e Instrucciones de Pago</label>
                      <div className="group relative cursor-pointer text-gray-400 hover:text-gray-600">
                        <HelpCircle size={13} />
                        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block w-52 p-2 rounded bg-white border border-gray-200 shadow-lg text-[9px] leading-relaxed text-gray-700 z-10">
                          Escribe el número de tus cuentas, alias de cobro y los pasos que debe seguir el usuario.
                        </span>
                      </div>
                    </div>
                    <textarea
                      name="bankAccounts"
                      value={botConfig.bankAccounts}
                      onChange={handleBotChange}
                      rows={8}
                      className="w-full px-3 py-2.5 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all font-mono resize-none leading-relaxed col-span-full"
                      placeholder="BCP Soles: 191-xxxxxx-x. Captura por este chat."
                    />
                  </div>
                </div>
              )}

              {activeSubTab === 'operations' && (
                <div className="grid grid-cols-1 gap-6">
                  <div className="col-span-full">
                    <label className="block text-[10px] font-semibold text-gray-700 mb-1.5">Horarios de Atención</label>
                    <textarea
                      name="businessHours"
                      value={botConfig.businessHours}
                      onChange={handleBotChange}
                      rows={3}
                      className="w-full px-3 py-2.5 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all resize-none leading-relaxed col-span-full"
                      placeholder="Lunes a Viernes de 9:00 AM a 6:00 PM."
                    />
                  </div>

                  <div className="col-span-full">
                    <label className="block text-[10px] font-semibold text-gray-700 mb-1.5">Políticas de Devolución, Envíos y Términos</label>
                    <textarea
                      name="termsAndPolicies"
                      value={botConfig.termsAndPolicies}
                      onChange={handleBotChange}
                      rows={5}
                      className="w-full px-3 py-2.5 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all resize-none leading-relaxed col-span-full"
                      placeholder="Plazo de devolución de 7 días naturales en empaque original sin abrir."
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-5 border-t border-gray-100 col-span-full">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow transition-all cursor-pointer disabled:opacity-40"
                >
                  {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  <span>Guardar Cambios</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 3: Seguridad (Mock) */}
        {activeTab === 'security' && (
          <form onSubmit={(e) => handleMockSave(e, 'Seguridad')} className="space-y-5 animate-in fade-in duration-200">
            <div className="pb-3 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-900">Seguridad y Acceso</h2>
              <p className="text-3xs text-gray-500 mt-0.5">Actualiza tu contraseña de acceso para mantener tu cuenta protegida.</p>
            </div>

            <div className="space-y-5 max-w-md">
              <div>
                <label className="block text-[10px] font-semibold text-gray-700 mb-1">Contraseña Actual</label>
                <input
                  type="password"
                  name="currentPassword"
                  value={securityConfig.currentPassword}
                  onChange={handleSecurityChange}
                  className="w-full px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-700 mb-1">Nueva Contraseña</label>
                <input
                  type="password"
                  name="newPassword"
                  value={securityConfig.newPassword}
                  onChange={handleSecurityChange}
                  className="w-full px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                  placeholder="Mínimo 8 caracteres"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-700 mb-1">Confirmar Nueva Contraseña</label>
                <input
                  type="password"
                  name="confirmPassword"
                  value={securityConfig.confirmPassword}
                  onChange={handleSecurityChange}
                  className="w-full px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-900 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                  placeholder="Confirme nueva contraseña"
                />
              </div>
            </div>

            <div className="flex justify-end pt-5 border-t border-gray-100">
              <button
                type="submit"
                disabled={isSubmitting || !securityConfig.newPassword}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow transition-all cursor-pointer disabled:opacity-40"
              >
                {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Key size={13} />}
                <span>Cambiar Contraseña</span>
              </button>
            </div>
          </form>
        )}

        {/* TAB 4: Facturación (Mock) */}
        {activeTab === 'billing' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="pb-3 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-900">Detalle de Suscripción</h2>
              <p className="text-3xs text-gray-500 mt-0.5">Controla tu plan comercial activo, consumo de límites y facturas del SaaS.</p>
            </div>

            {/* Card de Plan Comercial */}
            <div className="border border-gray-200 rounded-xl bg-gray-50/50 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-2xs">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-900">Plan Pro Anual</span>
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Activo
                  </span>
                </div>
                <p className="text-3xs text-gray-500">Acceso completo a Inteligencia Artificial, campañas masivas y constructores de flujo.</p>
              </div>
              <div className="text-left sm:text-right flex-shrink-0">
                <p className="text-base font-bold text-gray-900">$49.00 / mes</p>
                <p className="text-[10px] text-gray-500 flex items-center gap-1 sm:justify-end mt-1">
                  <Calendar size={12} />
                  Próximo pago: 01 Ago, 2026
                </p>
              </div>
            </div>

            {/* Límites de Uso */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-gray-900">Límites y Consumos</h3>
              
              <div className="space-y-2">
                <div className="flex justify-between text-2xs font-semibold">
                  <span className="text-gray-600">Dispositivos Vinculados</span>
                  <span className="text-gray-900">1 / 3 instancias</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-blue-600 h-full rounded-full" style={{ width: '33%' }} />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-2xs font-semibold">
                  <span className="text-gray-600">Mensajes Despachados (Mensual)</span>
                  <span className="text-gray-900">8,429 / 10,000</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-blue-600 h-full rounded-full" style={{ width: '84.2%' }} />
                </div>
              </div>
            </div>

            {/* Historial de Facturas */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-gray-900">Historial de Pagos</h3>
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-2xs">
                <table className="w-full text-left border-collapse text-2xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                      <th className="p-3">Factura</th>
                      <th className="p-3">Fecha</th>
                      <th className="p-3">Monto</th>
                      <th className="p-3">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-gray-900">
                    <tr className="hover:bg-gray-50/50">
                      <td className="p-3 font-semibold text-blue-600">INV-2026-003</td>
                      <td className="p-3 text-gray-500">01 Jul, 2026</td>
                      <td className="p-3 font-medium">$49.00</td>
                      <td className="p-3 text-emerald-600 font-bold">Pagada</td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="p-3 font-semibold text-blue-600">INV-2026-002</td>
                      <td className="p-3 text-gray-500">01 Jun, 2026</td>
                      <td className="p-3 font-medium">$49.00</td>
                      <td className="p-3 text-emerald-600 font-bold">Pagada</td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="p-3 font-semibold text-blue-600">INV-2026-001</td>
                      <td className="p-3 text-gray-500">01 May, 2026</td>
                      <td className="p-3 font-medium">$49.00</td>
                      <td className="p-3 text-emerald-600 font-bold">Pagada</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Toasts */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-card-md text-sm font-medium bg-card
            ${toast.type === 'success'
              ? 'border-emerald-200 text-emerald-700'
              : 'border-red-200 text-danger'
            }
          `}
          role="status"
          aria-live="polite"
        >
          {toast.type === 'success' ? (
            <CheckCircle2 size={18} className="text-success flex-shrink-0" />
          ) : (
            <AlertCircle size={18} className="text-danger flex-shrink-0" />
          )}
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-1 text-muted hover:text-hi cursor-pointer">
            &times;
          </button>
        </div>
      )}
    </div>
  );
}
