import { useState, useMemo, useEffect } from 'react';
import {
  MagnifyingGlass,
  FileCsv,
  UserPlus,
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

/* ─── Fila de tabla (desktop) ─── */
function ContactRow({ contact, index, openMenuId, setOpenMenuId, onDelete }) {
  const isOpen = openMenuId === contact.id;

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
        <div className="flex flex-wrap gap-1.5">
          {contact.tags && contact.tags.map(tag => <TagBadge key={tag} label={tag} />)}
        </div>
      </td>

      <td className="px-5 py-3.5">
        <span className="text-sm text-lo">{contact.lastInteraction || 'Sin interacción'}</span>
      </td>

      <td className="px-5 py-3.5 text-right">
        <div className="relative inline-block text-left">
          <button
            onClick={() => setOpenMenuId(isOpen ? null : contact.id)}
            className="p-1.5 rounded-md text-muted hover:text-hi hover:bg-app opacity-0 group-hover:opacity-100 transition-all duration-fast cursor-pointer"
            aria-label={`Acciones para ${contact.name}`}
            aria-expanded={isOpen}
          >
            <DotsThreeVertical size={18} />
          </button>
          
          {isOpen && (
            <div
              className="absolute right-0 top-7 z-20 w-36 bg-card border border-line rounded-lg shadow-card-md overflow-hidden"
              role="menu"
            >
              <button
                className="flex items-center gap-2.5 w-full px-4 py-2 text-xs text-danger hover:bg-red-50 transition-colors duration-fast cursor-pointer text-left"
                role="menuitem"
                onClick={() => {
                  onDelete(contact.id);
                  setOpenMenuId(null);
                }}
              >
                <Trash size={14} />
                Eliminar
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ─── Tarjeta móvil ─── */
function ContactCard({ contact, index, onDelete }) {
  const [showConfirm, setShowConfirm] = useState(false);
  return (
    <div className="bg-card border border-line rounded-lg shadow-card p-4 flex flex-col gap-3 relative">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Avatar name={contact.name} index={index} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-hi truncate">{contact.name}</p>
            <p className="text-xs text-lo font-mono mt-0.5">{contact.phone}</p>
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setShowConfirm(!showConfirm)}
            className="p-1 rounded-md text-muted hover:text-danger hover:bg-red-50 transition-colors cursor-pointer"
            title="Eliminar contacto"
          >
            <Trash size={16} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {contact.tags && contact.tags.map(tag => <TagBadge key={tag} label={tag} />)}
      </div>

      <div className="flex items-center justify-between text-2xs text-muted pt-1 border-t border-line">
        <span>Interacción: {contact.lastInteraction || '—'}</span>
        <span className="font-semibold text-brand bg-brand-light px-1.5 py-0.5 rounded">{contact.category}</span>
      </div>

      {showConfirm && (
        <div className="absolute inset-0 bg-card/95 rounded-lg flex flex-col items-center justify-center p-3 text-center space-y-2 z-10">
          <p className="text-xs font-semibold text-hi">¿Seguro que deseas eliminar este contacto?</p>
          <div className="flex gap-2">
            <button
              onClick={() => { onDelete(contact.id); setShowConfirm(false); }}
              className="px-2.5 py-1 text-2xs font-bold text-white bg-danger hover:bg-danger-hover rounded"
            >
              Sí, eliminar
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              className="px-2.5 py-1 text-2xs font-medium text-mid border border-line rounded bg-app"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Modal Añadir Contacto ─── */
function AddContactModal({ onClose, onSave }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [category, setCategory] = useState('Nuevos Leads');
  const [selectedTags, setSelectedTags] = useState([]);
  const [saving, setSaving] = useState(false);

  const toggleTag = (tag) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter(t => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !phone) return;
    setSaving(true);
    try {
      await onSave({
        name,
        phone,
        category,
        tags: selectedTags,
        lastInteraction: 'Hace un momento',
      });
      onClose();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-contact-title"
    >
      <div className="absolute inset-0 bg-hi/25 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-line rounded-lg shadow-card-md w-full max-w-sm overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <p id="add-contact-title" className="text-sm font-bold text-hi">Añadir Nuevo Contacto</p>
          <button onClick={onClose} className="p-1 rounded-md text-lo hover:bg-app cursor-pointer">
            <X size={16} />
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label htmlFor="c-name" className="block text-xs font-semibold text-hi mb-1">Nombre Completo</label>
            <input
              id="c-name"
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="ej. Sofía Ramírez"
              className="w-full px-3 py-2 text-sm bg-card border border-line rounded-md focus:outline-none focus:border-brand"
            />
          </div>

          <div>
            <label htmlFor="c-phone" className="block text-xs font-semibold text-hi mb-1">Teléfono</label>
            <input
              id="c-phone"
              type="tel"
              required
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="ej. +51 987 654 321"
              className="w-full px-3 py-2 text-sm bg-card border border-line rounded-md focus:outline-none focus:border-brand font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-hi mb-1.5">Categoría</label>
            <div className="grid grid-cols-3 gap-2">
              {['Nuevos Leads', 'En Seguimiento', 'Clientes Cerrados'].map(cat => {
                const active = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`py-1.5 px-2 text-[10px] font-semibold border rounded-md cursor-pointer text-center transition-colors
                      ${active
                        ? 'bg-brand/10 border-brand text-brand'
                        : 'border-line text-mid hover:bg-app'
                      }
                    `}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-hi mb-1.5">Etiquetas</label>
            <div className="flex flex-wrap gap-1.5">
              {TAG_OPTIONS.map(tag => {
                const active = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`px-2 py-1 text-[10px] font-medium rounded-full border cursor-pointer transition-colors
                      ${active
                        ? 'bg-brand text-white border-brand'
                        : 'bg-app border-line text-mid hover:bg-line'
                      }
                    `}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-line">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-semibold border border-line text-mid hover:bg-app rounded-md cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !name || !phone}
              className="px-3.5 py-2 text-xs font-semibold bg-brand text-white hover:bg-brand-hover rounded-md shadow-card cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Crear Contacto'}
            </button>
          </div>
        </form>
      </div>
    </div>
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
export default function ContactosPage() {
  const [contacts, setContacts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [toast, setToast] = useState(null);

  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Todos');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadContacts = async () => {
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
  };

  useEffect(() => {
    loadContacts();
  }, []);

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

  const handleDeleteContact = async (id) => {
    try {
      await contactService.deleteContact(id);
      setContacts(prev => prev.filter(c => c.id !== id));
      showToast('Contacto eliminado correctamente');
    } catch {
      showToast('Error al eliminar el contacto del servidor', 'error');
    }
  };

  // Filtrado reactivo en memoria
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return contacts.filter(c => {
      const matchesCategory =
        activeCategory === 'Todos' || c.category === activeCategory;
      const matchesSearch =
        !q ||
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.phone && c.phone.replace(/\s/g, '').includes(q.replace(/\s/g, '')));
      return matchesCategory && matchesSearch;
    });
  }, [contacts, search, activeCategory]);

  // Categorías con conteos dinámicos en tiempo real
  const categoriesList = useMemo(() => [
    { label: 'Todos',             count: contacts.length },
    { label: 'Nuevos Leads',      count: contacts.filter(c => c.category === 'Nuevos Leads').length },
    { label: 'En Seguimiento',    count: contacts.filter(c => c.category === 'En Seguimiento').length },
    { label: 'Clientes Cerrados', count: contacts.filter(c => c.category === 'Clientes Cerrados').length },
  ], [contacts]);

  return (
    <section aria-labelledby="contactos-heading">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 id="contactos-heading" className="text-xl font-bold text-hi">
            Directorio de Contactos
          </h1>
          <p className="text-sm text-lo mt-0.5">
            Gestiona tus leads y clientes para segmentar campañas.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            id="btn-importar-csv"
            onClick={() => showToast('Simulación de carga CSV completada.', 'success')}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-md border border-line bg-card text-sm font-semibold text-mid hover:bg-app hover:border-line-strong shadow-card transition-all duration-fast cursor-pointer"
          >
            <FileCsv size={16} className="text-emerald-600" aria-hidden="true" />
            Importar CSV
          </button>
          <button
            id="btn-añadir-contacto"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-hover shadow-card transition-all duration-fast cursor-pointer"
          >
            <UserPlus size={16} weight="bold" aria-hidden="true" />
            Añadir Contacto
          </button>
        </div>
      </div>

      {/* ── Layout principal: Sidebar filtros + Tabla ── */}
      <div className="flex flex-col lg:flex-row gap-5">
        {/* Panel de Categorías (Sidebar) */}
        <aside className="lg:w-52 xl:w-56 flex-shrink-0" aria-label="Filtrar por categoría">
          <div className="bg-card border border-line rounded-lg shadow-card p-4">
            <div className="flex items-center gap-2 mb-4">
              <Funnel size={14} className="text-muted" aria-hidden="true" />
              <p className="text-xs font-semibold text-lo uppercase tracking-wider">Categorías</p>
            </div>

            <ul className="space-y-1" role="list">
              {categoriesList.map(({ label, count }) => {
                const isActive = activeCategory === label;
                return (
                  <li key={label}>
                    <button
                      onClick={() => setActiveCategory(label)}
                      className={`
                        w-full flex items-center justify-between px-3 py-2 rounded-md text-sm
                        font-medium transition-all duration-fast cursor-pointer
                        ${isActive
                          ? 'bg-brand text-white shadow-card'
                          : 'text-mid hover:bg-app hover:text-hi'
                        }
                      `}
                      aria-pressed={isActive}
                    >
                      <span>{label}</span>
                      <span className={`text-xs font-mono rounded-full px-1.5 py-0.5
                        ${isActive ? 'bg-white/20 text-white' : 'bg-app text-muted'}`}
                      >
                        {count}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Divider + Tags rápidos */}
            <div className="mt-4 pt-4 border-t border-line">
              <div className="flex items-center gap-2 mb-3">
                <Tag size={14} className="text-muted" aria-hidden="true" />
                <p className="text-xs font-semibold text-lo uppercase tracking-wider">Etiquetas</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TAG_OPTIONS.map(tag => (
                  <button
                    key={tag}
                    onClick={() => setSearch(tag)}
                    className="cursor-pointer"
                    aria-label={`Filtrar por etiqueta ${tag}`}
                  >
                    <TagBadge label={tag} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* Columna derecha: Buscador + Tabla/Cards */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {/* Barra de búsqueda */}
          <div className="relative">
            <MagnifyingGlass
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
              aria-hidden="true"
            />
            <input
              id="search-contactos"
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nombre o número..."
              className="
                w-full pl-9 pr-4 py-2.5 rounded-md border border-line bg-card
                text-sm text-hi placeholder:text-muted
                focus:outline-none focus:border-brand focus:shadow-input-focus
                transition-all duration-fast shadow-card
              "
              aria-label="Buscar contactos"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted hover:text-hi transition-colors duration-fast cursor-pointer"
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
            {activeCategory !== 'Todos' && (
              <button
                onClick={() => setActiveCategory('Todos')}
                className="text-xs text-brand hover:text-brand-hover transition-colors duration-fast cursor-pointer flex items-center gap-1"
              >
                <X size={11} />
                Limpiar filtro
              </button>
            )}
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
                      {['Cliente', 'Teléfono', 'Etiquetas', 'Última Interacción', 'Acciones'].map(c => (
                        <th key={c} className="px-5 py-3 text-left text-2xs font-semibold text-lo uppercase tracking-wider">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((contact, i) => (
                      <ContactRow
                        key={contact.id}
                        contact={contact}
                        index={i}
                        openMenuId={openMenuId}
                        setOpenMenuId={setOpenMenuId}
                        onDelete={handleDeleteContact}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Vista móvil */}
              <div className="sm:hidden space-y-3">
                {filtered.map((contact, i) => (
                  <ContactCard
                    key={contact.id}
                    contact={contact}
                    index={i}
                    onDelete={handleDeleteContact}
                  />
                ))}
              </div>
            </>
          ) : (
            /* Estado vacío ordinario */
            <div className="bg-card border border-line rounded-lg shadow-card p-10 text-center">
              <UserCircle size={40} className="mx-auto text-muted mb-3" aria-hidden="true" />
              <p className="text-sm font-medium text-hi">Sin resultados</p>
              <p className="text-xs text-lo mt-1">
                Intenta con otro término de búsqueda o{' '}
                <button
                  onClick={() => { setSearch(''); setActiveCategory('Todos'); }}
                  className="text-brand hover:text-brand-hover underline cursor-pointer"
                >
                  limpia los filtros
                </button>.
              </p>
            </div>
          )}
        </div>
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
