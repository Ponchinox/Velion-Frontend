import { useState, useEffect } from 'react';
import {
  Play,
  FloppyDisk,
  ChatText,
  Image,
  Clock,
  Brain,
  GitBranch,
  Lightning,
  Plus,
  ArrowRight,
  Trash,
  PencilSimple,
  DotsThreeVertical,
  Robot,
  Sliders,
  Question,
  X,
  CheckCircle,
  Warning,
} from '@phosphor-icons/react';
import * as automationService from '../services/automationService';

/* ─── Meta configuración para resolver íconos dinámicamente ─── */
const BLOCK_META = {
  trigger: {
    Icon: Lightning,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    borderColor: 'border-amber-300',
    headerBg: 'bg-amber-500',
  },
  text: {
    Icon: ChatText,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    borderColor: 'border-blue-300',
    headerBg: 'bg-blue-500',
  },
  media: {
    Icon: Image,
    color: 'text-violet-600',
    bg: 'bg-violet-50',
    borderColor: 'border-violet-300',
    headerBg: 'bg-violet-500',
  },
  delay: {
    Icon: Clock,
    color: 'text-orange-600',
    bg: 'bg-orange-50',
    borderColor: 'border-orange-300',
    headerBg: 'bg-orange-500',
  },
  ai: {
    Icon: Brain,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    borderColor: 'border-emerald-300',
    headerBg: 'bg-emerald-500',
  },
  condition: {
    Icon: GitBranch,
    color: 'text-rose-600',
    bg: 'bg-rose-50',
    borderColor: 'border-rose-300',
    headerBg: 'bg-rose-500',
  },
  question: {
    Icon: Question,
    color: 'text-sky-600',
    bg: 'bg-sky-50',
    borderColor: 'border-sky-300',
    headerBg: 'bg-sky-500',
  },
};

/* ─── Bloques disponibles en la barra lateral ─── */
const TOOL_BLOCKS = [
  { type: 'trigger', label: 'Disparador', desc: 'Palabra clave o evento inicial' },
  { type: 'text', label: 'Mensaje de Texto', desc: 'Envía un texto al contacto' },
  { type: 'media', label: 'Imagen / Documento', desc: 'Envía un archivo multimedia' },
  { type: 'delay', label: 'Retardo / Espera', desc: 'Pausa antes del siguiente nodo' },
  { type: 'ai', label: 'Respuesta con IA', desc: 'Gemini o Groq responde' },
  { type: 'condition', label: 'Condición Múltiple', desc: 'Bifurca el flujo según respuesta' },
  { type: 'question', label: 'Pregunta Libre', desc: 'Espera respuesta del usuario' },
];

/* ─── Respaldos estáticos locales ─── */
const MOCK_NODES = [];
const MOCK_EDGES = [];

/* ─── Componente Bloque de herramienta ─── */
function ToolBlock({ block }) {
  const meta = BLOCK_META[block.type] || BLOCK_META.text;
  return (
    <div
      draggable
      className={`
        flex items-center gap-3 p-3 rounded-lg border bg-card cursor-grab active:cursor-grabbing
        hover:shadow-card-md hover:-translate-y-0.5 transition-all duration-fast select-none border-line-strong
      `}
      title={block.desc}
    >
      <div className={`flex items-center justify-center w-8 h-8 rounded-md flex-shrink-0 ${meta.bg}`}>
        <meta.Icon size={16} className={meta.color} weight="bold" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-hi leading-tight">{block.label}</p>
        <p className="text-xs text-lo leading-tight mt-0.5 truncate">{block.desc}</p>
      </div>
    </div>
  );
}

/* ─── Componente Nodo ─── */
function FlowNode({ node, selected, onSelect }) {
  const meta = BLOCK_META[node.type] || BLOCK_META.text;
  return (
    <div
      onClick={() => onSelect(node.id)}
      className={`
        absolute bg-card rounded-xl border-2 shadow-card-md w-52 cursor-pointer select-none transition-all duration-fast
        ${selected
          ? `${meta.borderColor} shadow-[0_0_0_3px_rgb(37_99_235/0.20)] scale-105`
          : 'border-line hover:border-line-strong hover:shadow-card-md'
        }
      `}
      style={{ left: node.x, top: node.y }}
      role="button"
      aria-pressed={selected}
    >
      <div className={`flex items-center gap-2 px-3 py-2 rounded-t-[10px] ${meta.headerBg}`}>
        <meta.Icon size={13} className="text-white flex-shrink-0" weight="bold" />
        <span className="text-xs font-bold text-white truncate">{node.label}</span>
      </div>
      <div className="px-3 py-2.5">
        <p className="text-xs text-mid leading-relaxed line-clamp-2">{node.content}</p>
      </div>
      <div className="absolute -right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-card border-2 border-line-strong shadow-card flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-brand" />
      </div>
      <div className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-card border-2 border-line-strong shadow-card" />
    </div>
  );
}

/* ─── Toast de notificación ─── */
function Toast({ msg, type, onClose }) {
  const isSuccess = type === 'success';
  const isWarning = type === 'warning';
  return (
    <div
      className={`
        fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-card-md text-sm font-medium
        ${isSuccess ? 'bg-card border-emerald-200 text-emerald-700' : ''}
        ${isWarning ? 'bg-card border-amber-200 text-amber-700' : ''}
        ${!isSuccess && !isWarning ? 'bg-card border-red-200 text-danger' : ''}
      `}
      role="status"
    >
      {isSuccess && <CheckCircle size={18} weight="bold" className="flex-shrink-0" />}
      {isWarning && <Warning size={18} weight="bold" className="flex-shrink-0" />}
      {!isSuccess && !isWarning && <Warning size={18} weight="bold" className="flex-shrink-0" />}
      <span>{msg}</span>
      <button onClick={onClose} className="ml-1 text-muted hover:text-hi cursor-pointer">
        <X size={14} />
      </button>
    </div>
  );
}

/* ─── Componente Principal ─── */
export default function AutomatizacionPage() {
  const [nodes, setNodes] = useState(MOCK_NODES);
  const [edges, setEdges] = useState(MOCK_EDGES);
  
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [toast, setToast] = useState(null);
  const [toolboxOpen, setToolboxOpen] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const selectedNode = nodes.find(n => n.id === selectedNodeId);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  };

  /* Cargar flujo desde el backend */
  const loadFlow = async () => {
    try {
      const data = await automationService.getFlow();
      if (data && data.nodes && data.edges) {
        setNodes(data.nodes);
        setEdges(data.edges);
      }
    } catch {
      setNodes([]);
      setEdges([]);
    }
  };

  useEffect(() => {
    loadFlow();
  }, []);

  /* Guardar flujo */
  const handleSave = async () => {
    setIsSaving(true);
    try {
      await automationService.saveFlow({ nodes, edges });
      showToast('Flujo guardado y activo en el bot', 'success');
    } catch {
      showToast('Error al guardar el flujo de automatización', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateNodeContent = (id, newContent) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, content: newContent } : n));
  };

  /* Posición del centro de cada nodo (para las flechas SVG) */
  const nodeCenter = (id) => {
    const n = nodes.find(node => node.id === id);
    if (!n) return { x: 0, y: 0 };
    return { x: n.x + 104, y: n.y + 42 };
  };

  return (
    <div
      className="-mx-4 -my-5 md:-mx-8 md:-my-8 flex flex-col overflow-hidden bg-card"
      style={{ height: 'calc(100dvh - var(--topbar-h) - 2rem)' }}
      role="region"
      aria-label="Constructor de flujos"
    >
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-line bg-card flex-shrink-0 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => setToolboxOpen(!toolboxOpen)}
            className="md:hidden p-1.5 rounded-md border border-line text-lo hover:bg-app cursor-pointer"
          >
            <Sliders size={16} />
          </button>

          <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center flex-shrink-0">
            <Robot size={18} className="text-brand" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-hi leading-tight truncate">Flujo del Bot Automático</h1>
            <p className="text-xs text-lo leading-tight">
              {nodes.length} nodos · {edges.length} conexiones
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            disabled
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-line bg-card text-sm font-semibold text-muted shadow-card opacity-50 cursor-not-allowed"
          >
            <Play size={14} weight="bold" className="text-muted" />
            <span className="hidden sm:inline">Probar Bot (Próximamente)</span>
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-hover shadow-card cursor-pointer disabled:opacity-60"
          >
            <FloppyDisk size={14} weight="bold" />
            <span>{isSaving ? 'Guardando...' : 'Guardar Flujo'}</span>
          </button>
        </div>
      </header>

      {/* Workspace */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* CANVAS */}
        <div
          className="flex-1 relative overflow-auto"
          onClick={() => setSelectedNodeId(null)}
          style={{
            backgroundColor: '#F8FAFC',
            backgroundImage: 'radial-gradient(circle, #CBD5E1 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        >
          <div className="relative" style={{ width: 1200, height: 700, minWidth: '100%', minHeight: '100%' }}>
            {/* SVG Edges */}
            <svg className="absolute inset-0 pointer-events-none" width={1200} height={700}>
              <defs>
                <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill="#94A3B8" />
                </marker>
              </defs>

              {edges.map(edge => {
                const from = nodeCenter(edge.from);
                const to = nodeCenter(edge.to);
                if (from.x === 0 && to.x === 0) return null;
                const midX = (from.x + to.x) / 2;
                const path = `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
                return (
                  <g key={edge.id}>
                    <path d={path} fill="none" stroke="#CBD5E1" strokeWidth="2" strokeDasharray="6 3" markerEnd="url(#arrowhead)" />
                    {edge.label && (
                      <text x={midX} y={(from.y + to.y) / 2 - 6} textAnchor="middle" fontSize="10" fill="#64748B" fontFamily="Plus Jakarta Sans, sans-serif" fontWeight="600">
                        {edge.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Nodes */}
            {nodes.map(node => (
              <FlowNode
                key={node.id}
                node={node}
                selected={selectedNodeId === node.id}
                onSelect={id => setSelectedNodeId(id)}
              />
            ))}

            <button
              onClick={e => { e.stopPropagation(); showToast('Arrastra un bloque desde el panel derecho para añadirlo al flujo.', 'warning'); }}
              className="absolute flex items-center justify-center w-9 h-9 rounded-full bg-card border-2 border-dashed border-line-strong text-muted hover:border-brand hover:text-brand cursor-pointer shadow-card"
              style={{ left: 390, top: 300 }}
              title="Añadir nodo"
            >
              <Plus size={16} />
            </button>

            <div className="absolute bottom-4 left-4 flex items-center gap-2 px-3 py-1.5 bg-card border border-line rounded-full shadow-card">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs text-lo font-medium">Flujo activo</span>
            </div>
          </div>
        </div>

        {/* TOOLBOX */}
        <aside
          className={`
            flex-shrink-0 border-l border-line bg-card flex flex-col transition-all duration-200
            ${toolboxOpen ? 'w-64 xl:w-72' : 'w-0 overflow-hidden'} md:w-64 xl:w-72
          `}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-line flex-shrink-0">
            <p className="text-xs font-semibold text-lo uppercase tracking-wider">Bloques disponibles</p>
            <button onClick={() => setToolboxOpen(false)} className="md:hidden p-1 rounded text-muted hover:text-hi cursor-pointer">
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            <p className="text-2xs text-muted px-1 mb-3">Arrastra un bloque al canvas para añadirlo al flujo.</p>
            {TOOL_BLOCKS.map(block => (
              <ToolBlock key={block.type} block={block} />
            ))}
          </div>

          {selectedNode && (
            <div className="border-t border-line flex-shrink-0">
              <div className="px-4 py-3">
                <p className="text-xs font-semibold text-lo uppercase tracking-wider mb-3">Propiedades</p>
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center ${(BLOCK_META[selectedNode.type] || BLOCK_META.text).bg}`}>
                    {(() => {
                      const Icon = (BLOCK_META[selectedNode.type] || BLOCK_META.text).Icon;
                      return <Icon size={12} className={(BLOCK_META[selectedNode.type] || BLOCK_META.text).color} weight="bold" />;
                    })()}
                  </div>
                  <span className="text-xs font-semibold text-hi">{selectedNode.label}</span>
                </div>

                <div className="space-y-2">
                  <div>
                    <label htmlFor="node-edit-content" className="block text-2xs text-lo font-medium mb-1">Contenido</label>
                    <textarea
                      id="node-edit-content"
                      value={selectedNode.content}
                      onChange={e => handleUpdateNodeContent(selectedNode.id, e.target.value)}
                      rows={3}
                      className="w-full px-2.5 py-2 rounded-md border border-line bg-app text-xs text-hi resize-none focus:outline-none focus:border-brand"
                    />
                  </div>
                </div>

                <div className="flex gap-2 mt-3">
                  <button className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-md border border-line text-xs font-medium text-mid hover:bg-app cursor-pointer">
                    <PencilSimple size={12} />
                    Editar
                  </button>
                  <button className="flex items-center justify-center px-2.5 py-2 rounded-md border border-red-200 text-danger hover:bg-red-50 cursor-pointer">
                    <Trash size={12} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
