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

export default function AdminBackupsPage() {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchBackups = async () => {
    setLoading(true);
    setErrorMsg('');
    const token = localStorage.getItem('sa_token');

    try {
      const response = await fetch('http://localhost:3000/api/admin/backups', {
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
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    const token = localStorage.getItem('sa_token');

    try {
      const response = await fetch('http://localhost:3000/api/admin/backups/generate', {
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
      const response = await fetch(`http://localhost:3000/api/admin/backups/download/${filename}`, {
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
