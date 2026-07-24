import { useState, useEffect } from 'react';
import {
  Database,
  DownloadSimple,
  Plus,
  Clock,
  HardDrive,
  ArrowsClockwise,
  WarningCircle,
  CheckCircle
} from '@phosphor-icons/react';

import * as configService from '../services/configService';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function AdminBackupsPage() {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [toast, setToast] = useState(null);

  // Estados de Configuración Automática de Backups
  const [backupFrequency, setBackupFrequency] = useState('off');
  const [backupCloudEnabled, setBackupCloudEnabled] = useState(false);
  const [backupCloudProvider, setBackupCloudProvider] = useState('cloudinary');
  const [savingSettings, setSavingSettings] = useState(false);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadSettings = async () => {
    try {
      const data = await configService.getGlobalConfig();
      if (data) {
        if (data.backupFrequency) setBackupFrequency(data.backupFrequency);
        if (data.backupCloudEnabled !== undefined) setBackupCloudEnabled(data.backupCloudEnabled);
        if (data.backupCloudProvider) setBackupCloudProvider(data.backupCloudProvider);
      }
    } catch (err) {
      console.error('Error al cargar la configuración de backups:', err);
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await configService.saveGlobalConfig({
        backupFrequency,
        backupCloudEnabled,
        backupCloudProvider,
      });
      showToast('Configuración de copias de seguridad actualizada con éxito');
    } catch (err) {
      console.error(err);
      showToast('Error al guardar los ajustes de copias de seguridad.', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const fetchBackups = async () => {
    setLoading(true);
    setErrorMsg('');
    const token = localStorage.getItem('sa_token');

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/backups`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('No se pudieron obtener las copias de seguridad.');
      }

      const data = await response.json();
      setBackups(data);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'Error de conexión con el backend.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
    loadSettings();
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    const token = localStorage.getItem('sa_token');

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/backups/generate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Fallo al generar el nuevo respaldo del sistema.');
      }

      const newBackup = await response.json();
      
      // Añadir de forma optimista al listado local
      setBackups((prev) => [
        {
          filename: newBackup.filename,
          sizeBytes: newBackup.sizeBytes,
          createdAt: newBackup.createdAt,
        },
        ...prev,
      ]);

      showToast('Nueva copia de seguridad generada con éxito');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Error al procesar el respaldo.', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async (filename) => {
    const token = localStorage.getItem('sa_token');
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/backups/download/${filename}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('No se pudo procesar la descarga del archivo.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Error de descarga.', 'error');
    }
  };

  // Formatea el tamaño del archivo de bytes a un valor legible
  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(2)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(2)} MB`;
  };

  return (
    <section aria-labelledby="backups-heading" className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 id="backups-heading" className="text-xl font-bold text-hi flex items-center gap-2">
            <Database size={24} className="text-brand" />
            Copias de Seguridad (Backups)
          </h1>
          <p className="text-sm text-lo mt-0.5">
            Genera y descarga volcados completos en JSON de los Tenants, usuarios, productos y chats en PostgreSQL.
          </p>
        </div>

        <button
          onClick={handleGenerate}
          disabled={generating}
          className="
            flex items-center gap-2 px-4 py-2.5 rounded-md
            bg-brand text-white text-sm font-semibold
            hover:bg-brand-hover shadow shadow-card transition-all duration-fast cursor-pointer
            disabled:opacity-50 disabled:cursor-not-allowed
          "
        >
          <Plus size={16} weight="bold" />
          {generating ? 'Generando...' : 'Generar Nuevo Backup'}
        </button>
      </div>

      {/* Configuración de Copias de Seguridad Automáticas */}
      <div className="bg-card border border-line rounded-xl shadow-card p-6 space-y-4">
        <h2 className="text-sm font-bold text-hi flex items-center gap-2 pb-2 border-b border-line font-semibold">
          <HardDrive size={18} className="text-brand" />
          Programación de Copias Automáticas
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
          {/* Frecuencia */}
          <div>
            <label htmlFor="backup-freq" className="block text-xs font-semibold text-hi mb-1.5">Frecuencia de Respaldo</label>
            <select
              id="backup-freq"
              value={backupFrequency}
              onChange={(e) => setBackupFrequency(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-card border border-line rounded-md focus:outline-none focus:border-brand cursor-pointer text-mid font-medium"
            >
              <option value="off">Desactivado</option>
              <option value="1d">Cada 1 día (Diario)</option>
              <option value="3d">Cada 3 días</option>
              <option value="7d">Cada semana</option>
            </select>
          </div>

          {/* Backup en la Nube */}
          <div className="flex flex-col gap-2">
            <span className="block text-xs font-semibold text-hi">Respaldo en la Nube</span>
            <div className="flex items-center gap-2.5 py-1.5">
              <button
                type="button"
                role="switch"
                aria-checked={backupCloudEnabled}
                onClick={() => setBackupCloudEnabled(!backupCloudEnabled)}
                className={`
                  relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
                  transition-colors duration-200 focus:outline-none
                  ${backupCloudEnabled ? 'bg-brand' : 'bg-gray-200'}
                `}
              >
                <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow transition duration-200 ${backupCloudEnabled ? 'translate-x-3' : 'translate-x-0'}`} />
              </button>
              <span className="text-xs text-mid font-medium">Sincronizar en la Nube</span>
            </div>
          </div>

          {/* Proveedor de Nube */}
          <div>
            <label htmlFor="backup-provider" className="block text-xs font-semibold text-hi mb-1.5">Proveedor de Nube</label>
            <select
              id="backup-provider"
              value={backupCloudProvider}
              disabled={!backupCloudEnabled}
              onChange={(e) => setBackupCloudProvider(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-card border border-line rounded-md focus:outline-none focus:border-brand cursor-pointer disabled:opacity-50 text-mid font-medium"
            >
              <option value="cloudinary">Cloudinary (Nativo - Integrado)</option>
              <option value="gdrive">Google Drive</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 pt-2 border-t border-line">
          <p className="text-[10px] text-muted max-w-xl leading-relaxed">
            *La rotación automática del servidor local mantendrá activas únicamente las últimas 3 copias para evitar el consumo excesivo de espacio de disco.
          </p>
          <button
            onClick={handleSaveSettings}
            disabled={savingSettings}
            className="px-4 py-2 bg-brand hover:bg-brand-hover text-white text-xs font-semibold rounded-md shadow cursor-pointer transition-colors disabled:opacity-50 self-end sm:self-auto"
          >
            {savingSettings ? 'Guardando...' : 'Guardar Programación'}
          </button>
        </div>
      </div>

      {loading ? (
        // Skeleton de Carga
        <div className="bg-card border border-line rounded-lg p-6 space-y-4 animate-pulse">
          <div className="h-6 bg-app rounded w-1/3" />
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-app rounded" />
            ))}
          </div>
        </div>
      ) : errorMsg ? (
        // Panel de Error
        <div className="bg-card border border-line rounded-lg p-8 text-center space-y-4 max-w-md mx-auto shadow-card">
          <WarningCircle size={40} className="mx-auto text-danger" />
          <div>
            <p className="text-sm font-semibold text-hi">Fallo al escanear respaldos</p>
            <p className="text-xs text-lo mt-1">{errorMsg}</p>
          </div>
          <button
            onClick={fetchBackups}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-brand text-white hover:bg-brand-hover rounded-md shadow transition-colors cursor-pointer"
          >
            <ArrowsClockwise size={14} />
            Reintentar
          </button>
        </div>
      ) : backups.length === 0 ? (
        // Sin Backups
        <div className="bg-card border border-line rounded-lg shadow-card p-12 text-center text-lo max-w-md mx-auto">
          <HardDrive size={36} className="mx-auto text-muted mb-3" />
          <p className="text-sm font-medium text-hi">Historial de respaldos vacío</p>
          <p className="text-xs mt-1">Todavía no has creado ninguna copia de seguridad del SaaS. Haz clic arriba para generar la primera.</p>
        </div>
      ) : (
        // Tabla de Backups
        <div className="bg-card border border-line rounded-xl shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm text-mid">
              <thead className="bg-app text-xs font-bold text-hi uppercase tracking-wider border-b border-line">
                <tr>
                  <th scope="col" className="px-6 py-4">Nombre del Archivo</th>
                  <th scope="col" className="px-6 py-4">Fecha de Generación</th>
                  <th scope="col" className="px-6 py-4">Tamaño</th>
                  <th scope="col" className="px-6 py-4 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-card">
                {backups.map((bk) => (
                  <tr key={bk.filename} className="hover:bg-app/20 transition-colors duration-fast">
                    {/* Nombre */}
                    <td className="px-6 py-3 font-semibold text-hi font-mono text-xs">
                      {bk.filename}
                    </td>

                    {/* Fecha */}
                    <td className="px-6 py-3 text-xs text-lo font-mono">
                      <div className="flex items-center gap-1.5">
                        <Clock size={12} />
                        {new Date(bk.createdAt).toLocaleDateString('es-ES', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </td>

                    {/* Tamaño */}
                    <td className="px-6 py-3 text-xs font-mono font-medium text-mid">
                      {formatSize(bk.sizeBytes)}
                    </td>

                    {/* Acciones */}
                    <td className="px-6 py-3 text-right">
                      <button
                        onClick={() => handleDownload(bk.filename)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-line hover:border-brand hover:text-brand rounded text-xs font-semibold transition-colors cursor-pointer"
                        title="Descargar archivo JSON"
                      >
                        <DownloadSimple size={13} />
                        Descargar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Toasts */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-card-md text-sm font-medium
            ${toast.type === 'error'
              ? 'bg-red-50 border-red-200 text-danger'
              : 'bg-green-50 border-green-200 text-success'
            }
          `}
        >
          {toast.type === 'error' ? (
            <WarningCircle size={18} />
          ) : (
            <CheckCircle size={18} />
          )}
          <span>{toast.msg}</span>
        </div>
      )}
    </section>
  );
}
