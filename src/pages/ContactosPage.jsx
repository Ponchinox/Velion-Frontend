import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  MagnifyingGlass,
  FileCsv,
  UserPlus,
  Plus,
  DotsThreeVertical,
  Tag,
  Funnel,
  UserCircle,
  PencilSimple,
  Trash,
  Phone,
  X,
  Check,
  CheckCircle,
  WarningCircle,
  ArrowClockwise,
} from '@phosphor-icons/react';
import * as contactService from '../services/contactService';
import ConfirmModal from '../components/ui/ConfirmModal';
import Modal from '../components/ui/Modal';


/* ─── Configuración de tags (colores) ─── */
const TAG_STYLES = {
  'Lead Caliente':    'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  'Soporte':          'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  'Mayorista':        'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  'En Seguimiento':   'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  'Clientes Cerrados':'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  'VIP':              'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
};

const TAG_OPTIONS = ['Lead Caliente', 'Soporte', 'Mayorista', 'En Seguimiento', 'VIP'];

/* ─── Avatar con iniciales ─── */
const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700',
  'bg-orange-100 text-orange-700',
  'bg-rose-100 text-rose-700',
  'bg-amber-100 text-amber-700',
];

function Avatar({ name, index }) {
  const initials = name
    ? name
        .split(' ')
        .map(w => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'U';
  const colorCls = AVATAR_COLORS[index % AVATAR_COLORS.length];

  return (
    <span
      className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold flex-shrink-0 ${colorCls}`}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

function TagBadge({ label }) {
  const cls = TAG_STYLES[label] ?? 'bg-gray-100 text-lo ring-1 ring-line';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '—';
  }
}

/* ─── Fila de tabla (desktop) ─── */
function ContactRow({ contact, index, onDelete, onToggleBot }) {
  return (
    <tr className="border-b border-line hover:bg-app/60 transition-colors duration-fast group">
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3">
          <Avatar name={contact.name} index={index} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-hi truncate">{contact.name}</p>
          </div>
        </div>
      </td>

      <td className="px-5 py-3.5">
        <div className="flex items-center gap-1.5">
          <Phone size={13} className="text-muted flex-shrink-0" />
          <span className="text-sm text-mid font-mono">{contact.phone}</span>
        </div>
      </td>

      <td className="px-5 py-3.5">
        <span className="text-sm text-mid font-medium">
          {formatDate(contact.createdAt)}
        </span>
      </td>

      <td className="px-5 py-3.5">
        <span className="text-sm text-lo">{contact.lastInteraction || 'Sin interacción'}</span>
      </td>

      {/* Columna: Estado (Pausar / Reactivar IA) */}
      <td className="px-5 py-3.5 text-center">
        {contact.botPaused ? (
          <button
            onClick={() => onToggleBot(contact, false)}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold transition-all border border-amber-300 cursor-pointer shadow-xs"
            title="Bot Pausado. Haz clic para reactivar respuestas automáticas de la IA"
          >
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            Reactivar IA
          </button>
        ) : (
          <button
            onClick={() => onToggleBot(contact, true)}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold transition-all border border-emerald-200 cursor-pointer shadow-xs"
            title="Bot Activo. Haz clic para pausar respuestas de la IA para este contacto"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Pausar IA
          </button>
        )}
      </td>

      {/* Columna: Acciones (Eliminar) */}
      <td className="px-5 py-3.5 text-center">
        <button
          onClick={() => onDelete(contact)}
          className="p-2 rounded-md text-muted hover:text-danger hover:bg-red-50 transition-colors cursor-pointer"
          title="Eliminar contacto"
          aria-label={`Eliminar contacto ${contact.name}`}
        >
          <Trash size={16} />
        </button>
      </td>
    </tr>
  );
}

/* ─── Tarjeta móvil ─── */
function ContactCard({ contact, index, onDelete, onToggleBot }) {
  return (
    <div className="bg-card border border-line rounded-lg shadow-card p-4 flex flex-col gap-3 relative">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Avatar name={contact.name} index={index} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-hi truncate">{contact.name}</p>
              {contact.botPaused && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                  Bot Pausado
                </span>
              )}
            </div>
            <p className="text-xs text-lo font-mono mt-0.5">{contact.phone}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {contact.botPaused ? (
            <button
              onClick={() => onToggleBot(contact, false)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-50 text-amber-800 text-xs font-bold border border-amber-300 cursor-pointer shadow-xs"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              Reactivar IA
            </button>
          ) : (
            <button
              onClick={() => onToggleBot(contact, true)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200 cursor-pointer shadow-xs"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Pausar IA
            </button>
          )}
          <button
            onClick={() => onDelete(contact)}
            className="p-1.5 rounded-md text-muted hover:text-danger hover:bg-red-50 transition-colors cursor-pointer"
            title="Eliminar contacto"
          >
            <Trash size={16} />
          </button>
        </div>
      </div>

      <div className="text-xs text-muted">
        <span className="font-semibold text-hi">Fecha de Registro: </span>
        <span>{formatDate(contact.createdAt)}</span>
      </div>

      <div className="flex items-center justify-between text-2xs text-muted pt-1 border-t border-line">
        <span>Interacción: {contact.lastInteraction || '—'}</span>
        <span className="font-semibold text-brand bg-brand-light px-1.5 py-0.5 rounded">{contact.category}</span>
      </div>
    </div>
  );
}

/* ─── Modal Añadir Contacto ─── */
function AddContactModal({ onClose, onSave }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !phone) return;
    setSaving(true);
    try {
      await onSave({
        name,
        phone,
        lastInteraction: 'Hace un momento',
      });
      onClose();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Añadir Nuevo Contacto"
      subtitle="Ingresa el nombre y teléfono para registrar un nuevo contacto en el CRM."
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="c-name" className="block text-xs font-semibold text-hi">Nombre Completo <span className="text-red-500">*</span></label>
          <input
            id="c-name"
            type="text"
            required
            maxLength={100}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder=""
            className="w-full px-3 py-2.5 text-sm bg-app border border-line rounded-lg text-hi placeholder:text-muted focus:outline-none focus:border-brand focus:shadow-input-focus transition-all"
          />
          <div className="text-right mt-0.5">
            <span className="text-[11px] text-lo font-mono">{(name || '').length} / 100</span>
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="c-phone" className="block text-xs font-semibold text-hi">Teléfono <span className="text-red-500">*</span></label>
          <input
            id="c-phone"
            type="tel"
            required
            maxLength={20}
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder=""
            className="w-full px-3 py-2.5 text-sm bg-app border border-line rounded-lg text-hi placeholder:text-muted focus:outline-none focus:border-brand focus:shadow-input-focus transition-all font-mono"
          />
          <div className="text-right mt-0.5">
            <span className="text-[11px] text-lo font-mono">{(phone || '').length} / 20</span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-line">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold border border-line text-mid hover:bg-app rounded-lg cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-xs font-bold bg-brand text-white hover:bg-brand-hover rounded-lg shadow cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Guardar Contacto'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ─── Skeleton Loader para tabla ─── */
function TableSkeleton() {
  return (
    <div className="bg-card border border-line rounded-lg shadow-card overflow-hidden">
      <div className="h-10 bg-app border-b border-line" />
      {[1, 2, 3, 4].map(n => (
        <div key={n} className="flex items-center gap-5 px-5 py-4 border-b border-line animate-pulse">
          <div className="flex items-center gap-3 w-1/4">
            <div className="w-8 h-8 rounded-full bg-line" />
            <div className="h-3.5 w-24 bg-line rounded" />
          </div>
          <div className="h-3.5 w-1/4 bg-line rounded" />
          <div className="flex gap-1.5 w-1/4">
            <div className="h-4 w-12 bg-line rounded-full" />
            <div className="h-4 w-16 bg-line rounded-full" />
          </div>
          <div className="h-3.5 w-1/6 bg-line rounded ml-auto" />
        </div>
      ))}
    </div>
  );
}

/* ─── Componente Principal ─── */
const ITEMS_PER_PAGE = 50;

export default function ContactosPage() {
  const [contacts, setContacts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [toast, setToast] = useState(null);

  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [contactToDelete, setContactToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const hasFetchedRef = useRef(false);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadContacts = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const data = await contactService.getContacts();
      setContacts(data || []);
    } catch (err) {
      setErrorMsg('No se pudieron cargar los contactos. Verifica tu conexión.');
      showToast('Error al obtener la lista de contactos.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    loadContacts();
  }, [loadContacts]);

  // Al modificar el buscador, reiniciar la página a 1
  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  const handleCreateContact = async (newContactData) => {
    try {
      const savedContact = await contactService.createContact(newContactData);
      setContacts(prev => [savedContact, ...prev]);
      showToast('Contacto creado correctamente');
    } catch {
      showToast('Error al guardar el contacto en el servidor', 'error');
      throw new Error();
    }
  };

  const handleConfirmDeleteContact = async () => {
    if (!contactToDelete) return;
    setIsDeleting(true);
    try {
      await contactService.deleteContact(contactToDelete.id);
      setContacts(prev => prev.filter(c => c.id !== contactToDelete.id));
      showToast('Contacto eliminado correctamente');
    } catch {
      showToast('Error al eliminar el contacto del servidor', 'error');
    } finally {
      setIsDeleting(false);
      setContactToDelete(null);
    }
  };

  const handleToggleBot = async (contact, newStatus) => {
    try {
      const updated = await contactService.toggleBotPause(contact.id, newStatus);
      setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, botPaused: updated.botPaused } : c));
      showToast(newStatus ? 'IA pausada para este contacto' : 'IA reactivada correctamente');
    } catch {
      showToast('Error al actualizar el estado de la IA', 'error');
    }
  };

  // Filtrado reactivo en memoria (sin filtros de categoría/etiquetas)
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return contacts;
    return contacts.filter(c => 
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.phone && c.phone.replace(/\s/g, '').includes(q.replace(/\s/g, '')))
    );
  }, [contacts, search]);

  // Paginación estricta a 50 por página
  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
  const paginatedContacts = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filtered.slice(start, start + ITEMS_PER_PAGE);
  }, [filtered, currentPage]);

  return (
    <section aria-labelledby="contactos-heading">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-line pb-6 mb-6">
        <div>
          <h1 id="contactos-heading" className="text-2xl font-extrabold text-hi tracking-tight flex items-center gap-2.5">
            <UserPlus size={28} className="text-brand" weight="bold" />
            Directorio de Contactos
          </h1>
          <p className="text-sm text-lo mt-1">
            Gestiona tus leads y clientes para segmentar campañas.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0 self-start sm:self-auto">
          <button
            id="btn-importar-csv"
            disabled
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-line bg-card text-sm font-semibold text-muted shadow-sm opacity-50 cursor-not-allowed"
          >
            <FileCsv size={18} className="text-muted" aria-hidden="true" />
            Importar CSV (Próximamente)
          </button>
          <button
            id="btn-añadir-contacto"
            onClick={() => setShowAddModal(true)}
            className="
              inline-flex items-center justify-center gap-2
              px-5 py-2.5 rounded-xl
              bg-brand text-white font-bold text-sm
              hover:bg-brand-hover active:scale-[0.98]
              transition-all duration-fast shadow-md cursor-pointer
            "
          >
            <Plus size={18} weight="bold" aria-hidden="true" />
            <span>Añadir Contacto</span>
          </button>
        </div>
      </div>

      {/* ── Buscador + Tabla limpia de 50 elementos/página ── */}
      <div className="flex flex-col gap-4">
        {/* Barra de búsqueda con botón X único (type="text" evita duplicado del navegador) */}
        <div className="relative">
          <MagnifyingGlass
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            aria-hidden="true"
          />
          <input
            id="search-contactos"
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre o número..."
            className="
              w-full pl-9 pr-10 py-2.5 rounded-md border border-line bg-card
              text-sm text-hi placeholder:text-muted
              focus:outline-none focus:border-brand focus:shadow-input-focus
              transition-all duration-fast shadow-card
            "
            aria-label="Buscar contactos"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted hover:text-hi transition-colors duration-fast cursor-pointer p-1"
              aria-label="Limpiar búsqueda"
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Contador de resultados */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-lo">
            <span className="font-semibold text-hi">{filtered.length}</span>{' '}
            {filtered.length === 1 ? 'contacto encontrado' : 'contactos encontrados'}
          </p>
        </div>

        {/* ── Visualización de Datos / Loader / Error ── */}
        {isLoading ? (
          <TableSkeleton />
        ) : errorMsg ? (
          /* Error en el Servidor (Failsafe) */
          <div className="bg-card border border-line rounded-lg shadow-card p-10 text-center space-y-4">
            <WarningCircle size={40} className="mx-auto text-danger" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-hi">{errorMsg}</p>
              <p className="text-xs text-lo mt-1">El backend de la plataforma se encuentra desconectado.</p>
            </div>
            <button
              onClick={loadContacts}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-brand text-white hover:bg-brand-hover rounded-md shadow transition-colors cursor-pointer"
            >
              <ArrowClockwise size={14} />
              Reintentar Conexión
            </button>
          </div>
        ) : filtered.length > 0 ? (
          <>
            {/* Vista desktop */}
            <div className="hidden sm:block bg-card border border-line rounded-lg shadow-card overflow-hidden">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-app border-b border-line">
                    {['Cliente', 'Teléfono', 'Fecha de Registro', 'Última Interacción', 'Estado', 'Acciones'].map(c => (
                      <th key={c} className={`px-5 py-3 text-2xs font-semibold text-lo uppercase tracking-wider ${['Estado', 'Acciones'].includes(c) ? 'text-center' : 'text-left'}`}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedContacts.map((contact, i) => (
                    <ContactRow
                      key={contact.id}
                      contact={contact}
                      index={i}
                      onDelete={setContactToDelete}
                      onToggleBot={handleToggleBot}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Vista móvil */}
            <div className="sm:hidden space-y-3">
              {paginatedContacts.map((contact, i) => (
                <ContactCard
                  key={contact.id}
                  contact={contact}
                  index={i}
                  onDelete={setContactToDelete}
                  onToggleBot={handleToggleBot}
                />
              ))}
            </div>

            {/* Controles de Paginación (50 elementos por página) */}
            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3">
                <p className="text-xs text-lo">
                  Mostrando <span className="font-semibold text-hi">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> a{' '}
                  <span className="font-semibold text-hi">{Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)}</span> de{' '}
                  <span className="font-semibold text-hi">{filtered.length}</span> contactos
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    className="px-3 py-1.5 text-xs font-semibold rounded-md border border-line bg-card text-mid hover:bg-app disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-xs"
                  >
                    Anterior
                  </button>
                  <span className="px-2 text-xs font-semibold text-hi">
                    Página {currentPage} de {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    className="px-3 py-1.5 text-xs font-semibold rounded-md border border-line bg-card text-mid hover:bg-app disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-xs"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Estado vacío ordinario */
          <div className="bg-card border border-line rounded-lg shadow-card p-10 text-center">
            <UserCircle size={40} className="mx-auto text-muted mb-3" aria-hidden="true" />
            <p className="text-sm font-medium text-hi">Sin resultados</p>
            <p className="text-xs text-lo mt-1">
              Intenta con otro término de búsqueda o{' '}
              <button
                onClick={() => setSearch('')}
                className="text-brand hover:text-brand-hover underline cursor-pointer"
              >
                limpia el buscador
              </button>.
            </p>
          </div>
        )}
      </div>

      {/* Clic fuera cierra el menú contextual */}
      {openMenuId && (
        <div className="fixed inset-0 z-10" onClick={() => setOpenMenuId(null)} />
      )}

      {/* Modal interactivo de creación */}
      {showAddModal && (
        <AddContactModal
          onClose={() => setShowAddModal(false)}
          onSave={handleCreateContact}
        />
      )}

      {/* Modal de confirmación de eliminación */}
      <ConfirmModal
        isOpen={!!contactToDelete}
        onClose={() => setContactToDelete(null)}
        onConfirm={handleConfirmDeleteContact}
        title="Eliminar Contacto"
        message="¿Está seguro que desea eliminar este contacto? Esta acción no se puede deshacer."
        confirmText="Eliminar"
        cancelText="Cancelar"
        isLoading={isDeleting}
      />

      {/* Toasts */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-card-md text-sm font-medium
            ${toast.type === 'success'
              ? 'bg-card border-emerald-200 text-emerald-700'
              : 'bg-card border-red-200 text-danger'
            }
          `}
          role="status"
          aria-live="polite"
        >
          {toast.type === 'success' ? (
            <CheckCircle size={18} weight="bold" className="text-success flex-shrink-0" />
          ) : (
            <WarningCircle size={18} weight="bold" className="text-danger flex-shrink-0" />
          )}
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-1 text-muted hover:text-hi cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}
    </section>
  );
}
