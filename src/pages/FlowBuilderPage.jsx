import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  ReactFlowProvider,
  Handle,
  Position,
  MarkerType
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  MessageSquare,
  GitBranch,
  Save,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Trash2,
  HelpCircle,
  Image as ImageIcon,
  Clock,
  Tag,
  Plus,
  X,
  Headset,
  Globe,
  Zap,
  Play,
  Sparkles,
  Copy,
  Check,
  Maximize2,
  Sliders,
  Info,
  ArrowRight,
  Smartphone,
  CheckCheck
} from 'lucide-react';
import * as flowService from '../services/flowService';
import * as connectionService from '../services/connectionService';
import { useUnsavedChanges } from '../context/UnsavedChangesContext';

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTES DE NODOS PERSONALIZADOS (ESTILO MODERNO VELION / WORKFLOW)
// ─────────────────────────────────────────────────────────────────────────────

function MessageNode({ data, selected }) {
  const text = (data.label || '').trim();
  const isEmpty = !text;

  return (
    <div
      className={`relative w-[230px] rounded-xl bg-white border transition-all duration-150 select-none shadow-sm hover:shadow-md ${
        selected ? 'border-emerald-500 ring-2 ring-emerald-500/20 shadow-md' : 'border-slate-200'
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-emerald-500 border-2 border-white -top-1.5 shadow-xs"
      />
      {/* Cabecera del Nodo */}
      <div className="flex items-center justify-between px-3 py-2 bg-emerald-50/70 border-b border-emerald-100 rounded-t-xl">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-emerald-500 text-white shadow-2xs">
            <MessageSquare size={13} />
          </div>
          <span className="text-xs font-bold text-emerald-950">Enviar Mensaje</span>
        </div>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-mono">
          WA
        </span>
      </div>

      {/* Contenido / Vista Previa */}
      <div className="p-3">
        {isEmpty ? (
          <p className="text-[11px] text-slate-400 italic">Escribe un mensaje en el inspector...</p>
        ) : (
          <div className="text-[11px] text-slate-700 bg-slate-50 border border-slate-100 rounded-lg p-2 leading-relaxed line-clamp-3 font-normal">
            {data.label}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 !bg-emerald-500 border-2 border-white -bottom-1.5 shadow-xs"
      />
    </div>
  );
}

function MediaNode({ data, selected }) {
  const hasMedia = Boolean(data.mediaUrl);
  return (
    <div
      className={`relative w-[230px] rounded-xl bg-white border transition-all duration-150 select-none shadow-sm hover:shadow-md ${
        selected ? 'border-violet-500 ring-2 ring-violet-500/20 shadow-md' : 'border-slate-200'
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-violet-500 border-2 border-white -top-1.5 shadow-xs"
      />
      <div className="flex items-center justify-between px-3 py-2 bg-violet-50/70 border-b border-violet-100 rounded-t-xl">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-violet-500 text-white shadow-2xs">
            <ImageIcon size={13} />
          </div>
          <span className="text-xs font-bold text-violet-950">Multimedia</span>
        </div>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-100 text-violet-800">
          IMG
        </span>
      </div>

      <div className="p-3 space-y-1.5">
        {hasMedia ? (
          <div className="relative rounded-lg overflow-hidden border border-slate-100 h-20 bg-slate-50 flex items-center justify-center">
            <img src={data.mediaUrl} alt="Preview" className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-violet-200 p-2 text-center text-[10px] text-violet-600 bg-violet-50/40">
            Sin imagen configurada
          </div>
        )}
        {data.label && (
          <p className="text-[11px] text-slate-600 truncate font-medium">{data.label}</p>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 !bg-violet-500 border-2 border-white -bottom-1.5 shadow-xs"
      />
    </div>
  );
}

function DelayNode({ data, selected }) {
  const seconds = data.delaySeconds || 3;
  return (
    <div
      className={`relative w-[210px] rounded-xl bg-white border transition-all duration-150 select-none shadow-sm hover:shadow-md ${
        selected ? 'border-amber-500 ring-2 ring-amber-500/20 shadow-md' : 'border-slate-200'
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-amber-500 border-2 border-white -top-1.5 shadow-xs"
      />
      <div className="flex items-center justify-between px-3 py-2 bg-amber-50/70 border-b border-amber-100 rounded-t-xl">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-amber-500 text-white shadow-2xs">
            <Clock size={13} />
          </div>
          <span className="text-xs font-bold text-amber-950">Esperar / Delay</span>
        </div>
      </div>

      <div className="p-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-amber-900 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
          <Clock size={13} className="text-amber-600" />
          <span className="text-xs font-mono font-bold">{seconds}s</span>
        </div>
        <span className="text-[10px] text-slate-400">Pausa antes de enviar</span>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 !bg-amber-500 border-2 border-white -bottom-1.5 shadow-xs"
      />
    </div>
  );
}

function TagNode({ data, selected }) {
  const tag = (data.tagName || '').trim() || 'sin-etiqueta';
  return (
    <div
      className={`relative w-[210px] rounded-xl bg-white border transition-all duration-150 select-none shadow-sm hover:shadow-md ${
        selected ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-md' : 'border-slate-200'
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-blue-500 border-2 border-white -top-1.5 shadow-xs"
      />
      <div className="flex items-center justify-between px-3 py-2 bg-blue-50/70 border-b border-blue-100 rounded-t-xl">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-blue-600 text-white shadow-2xs">
            <Tag size={13} />
          </div>
          <span className="text-xs font-bold text-blue-950">Añadir Etiqueta</span>
        </div>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
          CRM
        </span>
      </div>

      <div className="p-3">
        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-xs font-mono font-semibold max-w-full truncate">
          <span>#</span>
          <span className="truncate">{tag}</span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 !bg-blue-500 border-2 border-white -bottom-1.5 shadow-xs"
      />
    </div>
  );
}

function HandoffNode({ selected }) {
  return (
    <div
      className={`relative w-[220px] rounded-xl bg-white border transition-all duration-150 select-none shadow-sm hover:shadow-md ${
        selected ? 'border-slate-700 ring-2 ring-slate-700/20 shadow-md' : 'border-slate-300'
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-slate-700 border-2 border-white -top-1.5 shadow-xs"
      />
      <div className="flex items-center justify-between px-3 py-2 bg-slate-100 border-b border-slate-200 rounded-t-xl">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-slate-800 text-white shadow-2xs">
            <Headset size={13} />
          </div>
          <span className="text-xs font-bold text-slate-900">Transferir a Asesor</span>
        </div>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-800">
          HUMANO
        </span>
      </div>

      <div className="p-3">
        <p className="text-[10px] text-slate-600 leading-relaxed font-medium">
          Pausa el bot y transfiere la conversación para atención humana en vivo.
        </p>
      </div>
      {/* Nodo terminal: No tiene handle de salida */}
    </div>
  );
}

function ApiNode({ data, selected }) {
  const method = (data.apiMethod || 'GET').toUpperCase();
  const url = (data.apiUrl || '').trim() || 'https://api.tu-servidor.com';
  return (
    <div
      className={`relative w-[230px] rounded-xl bg-white border transition-all duration-150 select-none shadow-sm hover:shadow-md ${
        selected ? 'border-indigo-500 ring-2 ring-indigo-500/20 shadow-md' : 'border-slate-200'
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-indigo-500 border-2 border-white -top-1.5 shadow-xs"
      />
      <div className="flex items-center justify-between px-3 py-2 bg-indigo-50/70 border-b border-indigo-100 rounded-t-xl">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-indigo-600 text-white shadow-2xs">
            <Globe size={13} />
          </div>
          <span className="text-xs font-bold text-indigo-950">Llamar API</span>
        </div>
        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
          method === 'POST' ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800'
        }`}>
          {method}
        </span>
      </div>

      <div className="p-3">
        <p className="text-[10px] text-slate-500 font-mono truncate bg-slate-50 px-2 py-1 rounded border border-slate-100">
          {url}
        </p>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 !bg-indigo-500 border-2 border-white -bottom-1.5 shadow-xs"
      />
    </div>
  );
}

function ConditionNode({ data, selected }) {
  const options = Array.isArray(data.options) ? data.options : [];
  const question = (data.label || '').trim() || '¿Qué deseas hacer?';

  return (
    <div
      className={`relative w-[250px] rounded-xl bg-white border transition-all duration-150 select-none shadow-sm hover:shadow-md ${
        selected ? 'border-rose-500 ring-2 ring-rose-500/20 shadow-md' : 'border-slate-200'
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-rose-500 border-2 border-white -top-1.5 shadow-xs"
      />
      <div className="flex items-center justify-between px-3 py-2 bg-rose-50/70 border-b border-rose-100 rounded-t-xl">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-rose-600 text-white shadow-2xs">
            <GitBranch size={13} />
          </div>
          <span className="text-xs font-bold text-rose-950">Condición / Opciones</span>
        </div>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800">
          LÓGICA
        </span>
      </div>

      <div className="p-3 space-y-2">
        <p className="text-xs font-semibold text-slate-800 line-clamp-2">{question}</p>

        {/* Salidas independientes por opción */}
        <div className="space-y-1.5 pt-1">
          {options.map((opt, i) => (
            <div
              key={i}
              className="relative flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-rose-50/50 border border-rose-100 text-xs font-medium text-rose-950"
            >
              <span className="truncate pr-3">{opt}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={`opt-${opt}`}
                className="w-3 h-3 !bg-rose-500 border-2 border-white -right-1.5 shadow-xs"
              />
            </div>
          ))}
          {options.length === 0 && (
            <p className="text-[10px] text-slate-400 italic">Agrega opciones en el inspector</p>
          )}
        </div>
      </div>
    </div>
  );
}

const nodeTypes = {
  messageNode: MessageNode,
  conditionNode: ConditionNode,
  mediaNode: MediaNode,
  delayNode: DelayNode,
  tagNode: TagNode,
  handoffNode: HandoffNode,
  apiNode: ApiNode
};

// ─────────────────────────────────────────────────────────────────────────────
// PLANTILLA DE FLUJO DE DEMOSTRACIÓN (RECOMENDADO PARA VENTAS)
// ─────────────────────────────────────────────────────────────────────────────
const DEMO_TEMPLATE = {
  name: 'Flujo de Ventas y Asesoría',
  triggerKeyword: 'menu',
  nodes: [
    {
      id: 'node_welcome',
      type: 'messageNode',
      position: { x: 280, y: 80 },
      data: { label: '¡Hola! 👋 Bienvenido a Velion Oficial. ¿En qué podemos ayudarte hoy?' }
    },
    {
      id: 'node_condition',
      type: 'conditionNode',
      position: { x: 270, y: 220 },
      data: {
        label: 'Por favor, selecciona una de las siguientes opciones:',
        options: ['Ver ofertas', 'Hablar con asesor']
      }
    },
    {
      id: 'node_offers',
      type: 'messageNode',
      position: { x: 60, y: 430 },
      data: { label: '🔥 ¡Excelentes noticias! Hoy tenemos 20% de descuento en todo el catálogo de productos.' }
    },
    {
      id: 'node_handoff',
      type: 'handoffNode',
      position: { x: 480, y: 430 },
      data: { label: 'Transferencia a Asesor' }
    }
  ],
  edges: [
    {
      id: 'edge_welcome_cond',
      source: 'node_welcome',
      target: 'node_condition',
      animated: true,
      style: { stroke: '#10b981', strokeWidth: 2 }
    },
    {
      id: 'edge_cond_offers',
      source: 'node_condition',
      target: 'node_offers',
      sourceHandle: 'opt-Ver ofertas',
      label: 'Ver ofertas',
      animated: true,
      style: { stroke: '#f43f5e', strokeWidth: 2 }
    },
    {
      id: 'edge_cond_handoff',
      source: 'node_condition',
      target: 'node_handoff',
      sourceHandle: 'opt-Hablar con asesor',
      label: 'Hablar con asesor',
      animated: true,
      style: { stroke: '#f43f5e', strokeWidth: 2 }
    }
  ]
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL FLOW BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function FlowBuilderInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const reactFlowWrapper = useRef(null);

  // Estados del Flujo
  const [flowId, setFlowId] = useState(null);
  const [flowName, setFlowName] = useState('Flujo de Ventas Automatizado');
  const [triggerKeyword, setTriggerKeyword] = useState('menu');
  const [isActive, setIsActive] = useState(true);

  // Estados de Interfaz
  const [selectedNode, setSelectedNode] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [paletteSearch, setPaletteSearch] = useState('');
  const [copiedTrigger, setCopiedTrigger] = useState(false);

  // Estado real de conexión WhatsApp del tenant autenticado
  const [whatsappStatus, setWhatsappStatus] = useState({ connected: false, phone: null, loading: false });

  // Cargar estado real de WhatsApp al abrir el modal de prueba
  useEffect(() => {
    if (!isTestModalOpen) return;
    let cancelled = false;
    const fetchStatus = async () => {
      setWhatsappStatus(prev => ({ ...prev, loading: true }));
      try {
        const data = await connectionService.getStatus();
        if (cancelled) return;
        const isConnected = data.status === 'open' || data.status === 'CONNECTED';
        setWhatsappStatus({
          connected: isConnected,
          phone: data.phone || null,
          loading: false,
        });
      } catch {
        if (cancelled) return;
        setWhatsappStatus({ connected: false, phone: null, loading: false });
      }
    };
    fetchStatus();
    return () => { cancelled = true; };
  }, [isTestModalOpen]);

  const { isDirty, setIsDirty } = useUnsavedChanges();

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Carga inicial del flujo existente
  const loadFirstFlow = async () => {
    try {
      const data = await flowService.getFlows();
      if (data && data.length > 0) {
        const activeFlow = data[0];
        setFlowId(activeFlow.id);
        setFlowName(activeFlow.name);
        setTriggerKeyword(activeFlow.triggerKeyword);
        setIsActive(activeFlow.isActive);
        if (activeFlow.nodes) {
          const rawNodes = typeof activeFlow.nodes === 'string' ? JSON.parse(activeFlow.nodes) : activeFlow.nodes;
          setNodes(rawNodes);
        }
        if (activeFlow.edges) {
          const rawEdges = typeof activeFlow.edges === 'string' ? JSON.parse(activeFlow.edges) : activeFlow.edges;
          setEdges(rawEdges);
        }
        setTimeout(() => setIsDirty(false), 200);
      } else {
        // Inicializar con plantilla recomendada para nuevos tenants
        applyTemplate(DEMO_TEMPLATE);
      }
    } catch {
      showToast('Error al conectar con el servidor de flujos.', 'error');
    }
  };

  useEffect(() => {
    loadFirstFlow();
  }, []);

  // Cargar plantilla demo
  const applyTemplate = (tpl = DEMO_TEMPLATE) => {
    setFlowName(tpl.name);
    setTriggerKeyword(tpl.triggerKeyword);
    setIsActive(true);
    setNodes(tpl.nodes);
    setEdges(tpl.edges);
    setSelectedNode(null);
    setIsDirty(true);
    showToast('Plantilla comercial cargada en el lienzo.');
    if (reactFlowInstance) {
      setTimeout(() => reactFlowInstance.fitView({ padding: 0.2 }), 100);
    }
  };

  // Conexión entre nodos con asignación inteligente de etiquetas en ramas de condición
  const onConnect = useCallback(
    (params) => {
      let edgeLabel = '';
      if (params.sourceHandle && params.sourceHandle.startsWith('opt-')) {
        edgeLabel = params.sourceHandle.replace('opt-', '');
      }

      const newEdge = {
        ...params,
        id: `e_${params.source}_${params.target}_${Date.now()}`,
        animated: true,
        label: edgeLabel,
        style: { stroke: edgeLabel ? '#f43f5e' : '#3b82f6', strokeWidth: 2 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: edgeLabel ? '#f43f5e' : '#3b82f6'
        }
      };

      setEdges((eds) => addEdge(newEdge, eds));
      setIsDirty(true);
    },
    [setEdges, setIsDirty]
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      const dragType = event.dataTransfer.getData('application/reactflow');
      if (!dragType) return;

      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      addNodeByType(dragType, position);
    },
    [reactFlowInstance]
  );

  // Función compartida para añadir nodos (drag & drop o click directo desde paleta)
  const addNodeByType = (nodeCategory, position = null) => {
    let resolvedPosition = position;
    if (!resolvedPosition) {
      // Si fue por clic, colocarlo centrado con leve variación
      resolvedPosition = {
        x: 250 + Math.random() * 80,
        y: 150 + Math.random() * 80
      };
    }

    let nodeType = 'messageNode';
    let defaultData = { label: '¡Hola! ¿Cómo podemos ayudarte hoy?' };

    if (nodeCategory === 'condition') {
      nodeType = 'conditionNode';
      defaultData = { label: '¿Qué deseas consultar?', options: ['Ver productos', 'Hablar con asesor'] };
    } else if (nodeCategory === 'media') {
      nodeType = 'mediaNode';
      defaultData = { label: 'Catálogo de novedades', mediaUrl: '' };
    } else if (nodeCategory === 'delay') {
      nodeType = 'delayNode';
      defaultData = { delaySeconds: 3 };
    } else if (nodeCategory === 'tag') {
      nodeType = 'tagNode';
      defaultData = { tagName: 'interesado' };
    } else if (nodeCategory === 'handoff') {
      nodeType = 'handoffNode';
      defaultData = { label: 'Transferencia Humana' };
    } else if (nodeCategory === 'api') {
      nodeType = 'apiNode';
      defaultData = { apiUrl: 'https://api.ejemplo.com/webhook', apiMethod: 'GET', apiBody: '' };
    }

    const newNode = {
      id: `node_${Date.now()}`,
      type: nodeType,
      position: resolvedPosition,
      data: defaultData
    };

    setNodes((nds) => nds.concat(newNode));
    setSelectedNode(newNode);
    setIsDirty(true);
  };

  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const updateNodeData = (newData) => {
    if (!selectedNode) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === selectedNode.id) {
          return { ...n, data: { ...n.data, ...newData } };
        }
        return n;
      })
    );
    setSelectedNode((prev) => ({ ...prev, data: { ...prev.data, ...newData } }));
    setIsDirty(true);
  };

  // Validaciones antes de guardar
  const validateFlow = () => {
    if (!flowName.trim()) {
      showToast('Por favor, ingresa un nombre para el flujo.', 'error');
      return false;
    }
    if (!triggerKeyword.trim()) {
      showToast('La palabra clave (trigger) es obligatoria.', 'error');
      return false;
    }
    if (nodes.length === 0) {
      showToast('El flujo debe tener al menos un nodo.', 'error');
      return false;
    }

    for (const node of nodes) {
      if (node.type === 'messageNode' && !node.data?.label?.trim()) {
        showToast('Hay un nodo de mensaje vacío. Añade texto al mensaje.', 'error');
        return false;
      }
      if (node.type === 'delayNode' && Number(node.data?.delaySeconds) <= 0) {
        showToast('El tiempo de espera debe ser mayor a 0 segundos.', 'error');
        return false;
      }
      if (node.type === 'conditionNode' && (!node.data?.options || node.data.options.length < 1)) {
        showToast('El nodo de condición debe tener al menos una opción.', 'error');
        return false;
      }
    }
    return true;
  };

  const handleSave = async () => {
    if (!validateFlow()) return;

    setIsSaving(true);
    try {
      const response = await flowService.saveFlow({
        id: flowId,
        name: flowName.trim(),
        triggerKeyword: triggerKeyword.trim(),
        nodes: nodes,
        edges: edges,
        isActive: isActive
      });

      if (response && response.id) {
        setFlowId(response.id);
        showToast('✓ Flujo guardado con éxito en la base de datos.');
        setIsDirty(false);
      }
    } catch {
      showToast('Error al persistir el flujo en la base de datos.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyTrigger = () => {
    navigator.clipboard.writeText(triggerKeyword.trim());
    setCopiedTrigger(true);
    setTimeout(() => setCopiedTrigger(false), 2000);
  };

  // Lista de Nodos Disponibles para la Paleta
  const PALETTE_ITEMS = [
    {
      category: 'ACCIONES',
      items: [
        {
          type: 'message',
          title: 'Enviar Mensaje',
          desc: 'Texto simple del bot de WhatsApp',
          Icon: MessageSquare,
          iconBg: 'bg-emerald-500',
          badge: 'Texto'
        },
        {
          type: 'media',
          title: 'Enviar Multimedia',
          desc: 'Imagen con pie de foto opcional',
          Icon: ImageIcon,
          iconBg: 'bg-violet-500',
          badge: 'Imagen'
        },
        {
          type: 'tag',
          title: 'Añadir Etiqueta',
          desc: 'Segmenta el contacto en el CRM',
          Icon: Tag,
          iconBg: 'bg-blue-600',
          badge: 'CRM'
        },
        {
          type: 'delay',
          title: 'Esperar (Delay)',
          desc: 'Pausa breve antes del siguiente paso',
          Icon: Clock,
          iconBg: 'bg-amber-500',
          badge: 'Tiempo'
        },
        {
          type: 'handoff',
          title: 'Transferir a Asesor',
          desc: 'Pausa el bot y transfiere a humano',
          Icon: Headset,
          iconBg: 'bg-slate-700',
          badge: 'Humano'
        },
        {
          type: 'api',
          title: 'Llamar API',
          desc: 'Petición HTTP a un webhook externo',
          Icon: Globe,
          iconBg: 'bg-indigo-600',
          badge: 'Webhook'
        }
      ]
    },
    {
      category: 'LÓGICA',
      items: [
        {
          type: 'condition',
          title: 'Condición / Opciones',
          desc: 'Bifurca según la respuesta del cliente',
          Icon: GitBranch,
          iconBg: 'bg-rose-600',
          badge: 'Ramas'
        }
      ]
    }
  ];

  return (
    <div className="flex flex-col w-full h-[calc(100vh-64px)] bg-slate-50 overflow-hidden font-sans">
      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* BARRA SUPERIOR PROFESIONAL (ESTILO n8n / VELION WORKFLOW) */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <header className="h-14 border-b border-slate-200 bg-white px-5 flex items-center justify-between z-20 flex-shrink-0 shadow-2xs">
        {/* Identificador y Nombre del Flujo */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 text-blue-600 shadow-2xs">
            <GitBranch size={17} />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={flowName}
              onChange={(e) => {
                setFlowName(e.target.value);
                setIsDirty(true);
              }}
              placeholder="Nombre del Flujo"
              className="text-sm font-bold text-slate-800 bg-transparent hover:bg-slate-50 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded px-2 py-1 transition-all outline-none border border-transparent hover:border-slate-200"
            />
          </div>

          {/* Badge del Activador */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-medium text-slate-700">
            <Zap size={13} className="text-amber-500 fill-amber-500" />
            <span className="text-slate-500 font-normal">Activador:</span>
            <span className="font-mono font-bold text-slate-900">{triggerKeyword}</span>
          </div>
        </div>

        {/* Estado y Acciones Rápidas */}
        <div className="flex items-center gap-3">
          {/* Indicador de Guardado */}
          <div className="hidden md:flex items-center gap-1.5 text-xs font-medium text-slate-500 mr-1">
            {isSaving ? (
              <>
                <RefreshCw size={13} className="animate-spin text-blue-600" />
                <span className="text-blue-600">Guardando...</span>
              </>
            ) : isDirty ? (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-amber-700">Cambios sin guardar</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={14} className="text-emerald-600" />
                <span className="text-slate-600">Guardado</span>
              </>
            )}
          </div>

          {/* Toggle Activo / Inactivo */}
          <button
            type="button"
            onClick={() => {
              setIsActive(!isActive);
              setIsDirty(true);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer border ${
              isActive
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100/70'
                : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
            <span>{isActive ? 'Activo' : 'Inactivo'}</span>
          </button>

          {/* Botón Cargar Demo */}
          <button
            type="button"
            onClick={() => applyTemplate(DEMO_TEMPLATE)}
            className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            title="Cargar flujo preconfigurado de bienvenida y opciones"
          >
            <Sparkles size={13} className="text-amber-500" />
            <span>Plantilla Demo</span>
          </button>

          {/* Botón Probar */}
          <button
            type="button"
            onClick={() => setIsTestModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-xs font-bold text-blue-700 hover:bg-blue-100 transition-colors cursor-pointer shadow-2xs"
          >
            <Play size={13} className="fill-blue-600" />
            <span>Probar</span>
          </button>

          {/* Botón Guardar Flujo */}
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            <span>Guardar</span>
          </button>
        </div>
      </header>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* CUERPO EN 3 COLUMNAS: PALETA | LIENZO | INSPECTOR */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* COLUMNA 1: PALETA DE NODOS LATERAL */}
        <aside className="w-64 border-r border-slate-200 bg-white flex flex-col flex-shrink-0 z-10 select-none">
          <div className="p-3.5 border-b border-slate-100">
            <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Caja de Nodos</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Arrastra o pulsa + para agregar</p>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {/* TRIGGER INFO */}
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Activador</span>
              <div className="mt-1.5 p-2.5 rounded-xl border border-amber-200 bg-amber-50/50 flex items-start gap-2.5">
                <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500 text-white flex-shrink-0 mt-0.5">
                  <Zap size={14} className="fill-white" />
                </div>
                <div>
                  <p className="text-xs font-bold text-amber-950">Palabra Clave</p>
                  <p className="text-[10px] text-amber-800 leading-tight mt-0.5 font-mono">
                    "{triggerKeyword}"
                  </p>
                </div>
              </div>
            </div>

            {/* SECCIONES DE NODOS */}
            {PALETTE_ITEMS.map((section, sIdx) => (
              <div key={sIdx}>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {section.category}
                </span>
                <div className="mt-1.5 space-y-1.5">
                  {section.items.map((item, iIdx) => {
                    const Icon = item.Icon;
                    return (
                      <div
                        key={iIdx}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/reactflow', item.type);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        className="group flex items-center justify-between p-2 rounded-xl border border-slate-200 bg-white hover:border-blue-400 hover:shadow-xs transition-all cursor-grab active:cursor-grabbing"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`flex items-center justify-center w-7 h-7 rounded-lg ${item.iconBg} text-white flex-shrink-0 shadow-2xs`}>
                            <Icon size={14} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-800 leading-tight group-hover:text-blue-600 transition-colors">
                              {item.title}
                            </p>
                            <p className="text-[10px] text-slate-400 truncate mt-0.5">
                              {item.desc}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => addNodeByType(item.type)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-blue-600 transition-all cursor-pointer"
                          title="Añadir al centro del lienzo"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Tips de Demo en footer */}
          <div className="p-3 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-500 leading-relaxed flex items-start gap-2">
            <Info size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <span>Los flujos se ejecutan de arriba a abajo siguiendo las conexiones.</span>
          </div>
        </aside>

        {/* COLUMNA 2: LIENZO (REACT FLOW CANVAS) */}
        <main className="flex-1 h-full relative bg-slate-50" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={(changes) => {
              onNodesChange(changes);
              const isReal = changes.some(c => c.type === 'position' || c.type === 'remove' || c.type === 'add');
              if (isReal) setIsDirty(true);
            }}
            onEdgesChange={(changes) => {
              onEdgesChange(changes);
              const isReal = changes.some(c => c.type === 'remove' || c.type === 'add');
              if (isReal) setIsDirty(true);
            }}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.3}
            maxZoom={1.8}
            defaultEdgeOptions={{
              animated: true,
              style: { strokeWidth: 2 }
            }}
          >
            <Controls className="!bg-white !border-slate-200 !shadow-sm !rounded-xl overflow-hidden" />
            <MiniMap
              style={{ height: 100, width: 140, borderRadius: 12, overflow: 'hidden' }}
              className="!border !border-slate-200 !bg-white/90 shadow-sm"
              nodeStrokeColor="#cbd5e1"
              nodeColor="#f1f5f9"
            />
            <Background color="#cbd5e1" gap={20} size={1} />
          </ReactFlow>

          {/* Barra Flotante de Acciones en Lienzo */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/95 backdrop-blur-xs border border-slate-200 shadow-md text-xs">
            <button
              onClick={() => reactFlowInstance?.fitView({ padding: 0.2 })}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Centrar todos los nodos"
            >
              <Maximize2 size={13} />
              <span>Centrar</span>
            </button>
            <div className="w-px h-3 bg-slate-200" />
            <span className="text-[11px] text-slate-400 px-1 font-mono">
              {nodes.length} {nodes.length === 1 ? 'nodo' : 'nodos'} • {edges.length} {edges.length === 1 ? 'conexión' : 'conexiones'}
            </span>
          </div>
        </main>

        {/* COLUMNA 3: INSPECTOR DE PROPIEDADES LATERAL DERECHO */}
        <aside className="w-80 border-l border-slate-200 bg-white flex flex-col flex-shrink-0 z-10 select-none">
          {selectedNode ? (
            /* CONFIGURACIÓN DEL NODO SELECCIONADO */
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Inspector de Nodo
                  </span>
                  <h3 className="text-sm font-bold text-slate-900">
                    {selectedNode.type === 'messageNode' && 'Mensaje de WhatsApp'}
                    {selectedNode.type === 'mediaNode' && 'Enviar Multimedia'}
                    {selectedNode.type === 'delayNode' && 'Esperar (Delay)'}
                    {selectedNode.type === 'tagNode' && 'Añadir Etiqueta CRM'}
                    {selectedNode.type === 'handoffNode' && 'Transferencia a Asesor'}
                    {selectedNode.type === 'apiNode' && 'Llamar API / Webhook'}
                    {selectedNode.type === 'conditionNode' && 'Condición / Opciones'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
                    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
                    setSelectedNode(null);
                    setIsDirty(true);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors cursor-pointer"
                  title="Eliminar este nodo del lienzo"
                >
                  <Trash2 size={13} />
                  <span>Eliminar</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* 1. MESSAGE NODE */}
                {selectedNode.type === 'messageNode' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Texto del Mensaje
                      </label>
                      <textarea
                        value={selectedNode.data.label || ''}
                        onChange={(e) => updateNodeData({ label: e.target.value })}
                        rows={5}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none leading-relaxed"
                        placeholder="Escribe el mensaje que enviará el bot..."
                      />
                    </div>

                    {/* Vista Previa Estilo WhatsApp */}
                    <div>
                      <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                        Vista Previa en WhatsApp
                      </span>
                      <div className="p-3 bg-emerald-50/50 border border-emerald-100 rounded-xl">
                        <div className="bg-white rounded-lg p-2.5 shadow-2xs border border-emerald-100 max-w-[90%]">
                          <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                            {selectedNode.data.label || '...'}
                          </p>
                          <div className="flex items-center justify-end gap-1 mt-1 text-[9px] text-slate-400">
                            <span>12:00</span>
                            <CheckCheck size={12} className="text-blue-500" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. MEDIA NODE */}
                {selectedNode.type === 'mediaNode' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        URL de la Imagen
                      </label>
                      <input
                        type="text"
                        value={selectedNode.data.mediaUrl || ''}
                        onChange={(e) => updateNodeData({ mediaUrl: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-900 font-mono focus:outline-none focus:border-blue-500"
                        placeholder="https://servidor.com/imagen.png"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Subir Archivo Local
                      </label>
                      <input
                        type="file"
                        accept="image/*"
                        id="inspector-media-upload"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              updateNodeData({ mediaUrl: reader.result });
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                      <label
                        htmlFor="inspector-media-upload"
                        className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 cursor-pointer transition-colors"
                      >
                        <ImageIcon size={14} />
                        <span>Seleccionar Imagen</span>
                      </label>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Pie de Foto (Caption opcional)
                      </label>
                      <input
                        type="text"
                        value={selectedNode.data.label || ''}
                        onChange={(e) => updateNodeData({ label: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
                        placeholder="ej. Aquí tienes tu folleto"
                      />
                    </div>
                  </div>
                )}

                {/* 3. DELAY NODE */}
                {selectedNode.type === 'delayNode' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Tiempo de Espera (Segundos)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="60"
                        value={selectedNode.data.delaySeconds || 3}
                        onChange={(e) => updateNodeData({ delaySeconds: Math.max(1, Number(e.target.value)) })}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono font-bold text-slate-900 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 leading-relaxed flex items-start gap-2">
                      <Clock size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                      <span>
                        <strong>Consejo para la demo:</strong> Recomendamos pausas cortas de <strong>1 a 5 segundos</strong> para que la respuesta se sienta natural sin demorar la presentación.
                      </span>
                    </div>
                  </div>
                )}

                {/* 4. TAG NODE */}
                {selectedNode.type === 'tagNode' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Nombre de la Etiqueta CRM
                      </label>
                      <input
                        type="text"
                        value={selectedNode.data.tagName || ''}
                        onChange={(e) => updateNodeData({ tagName: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-blue-500"
                        placeholder="ej. cliente-vip"
                      />
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Esta etiqueta se añadirá automáticamente a la ficha del contacto en la pestaña <strong>Contactos</strong>.
                    </p>
                  </div>
                )}

                {/* 5. HANDOFF NODE */}
                {selectedNode.type === 'handoffNode' && (
                  <div className="space-y-3">
                    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                      <div className="flex items-center gap-2 text-slate-900 font-bold text-xs">
                        <Headset size={16} className="text-slate-700" />
                        <span>Transferencia a Humano</span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Este nodo pausará las respuestas automáticas de la IA para este contacto. La conversación quedará en espera de atención de un asesor en la bandeja de <strong>Mensajes</strong>.
                      </p>
                    </div>
                  </div>
                )}

                {/* 6. API NODE */}
                {selectedNode.type === 'apiNode' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Método HTTP
                      </label>
                      <select
                        value={selectedNode.data.apiMethod || 'GET'}
                        onChange={(e) => updateNodeData({ apiMethod: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-500 bg-white"
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        URL del Endpoint
                      </label>
                      <input
                        type="text"
                        value={selectedNode.data.apiUrl || ''}
                        onChange={(e) => updateNodeData({ apiUrl: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono text-slate-900 focus:outline-none focus:border-blue-500"
                        placeholder="https://api.tu-servidor.com/webhook"
                      />
                    </div>
                    {selectedNode.data.apiMethod === 'POST' && (
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          Cuerpo JSON (Body)
                        </label>
                        <textarea
                          value={selectedNode.data.apiBody || ''}
                          onChange={(e) => updateNodeData({ apiBody: e.target.value })}
                          rows={4}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono text-slate-900 focus:outline-none focus:border-blue-500 resize-none leading-relaxed"
                          placeholder='{ "key": "value" }'
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* 7. CONDITION NODE */}
                {selectedNode.type === 'conditionNode' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Pregunta / Enunciado
                      </label>
                      <input
                        type="text"
                        value={selectedNode.data.label || ''}
                        onChange={(e) => updateNodeData({ label: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-500"
                        placeholder="ej. Elige una opción"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-xs font-bold text-slate-700">
                          Opciones de Bifurcación
                        </label>
                        <span className="text-[10px] text-slate-400">Salidas</span>
                      </div>

                      <div className="space-y-2">
                        {(selectedNode.data.options || []).map((opt, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={opt}
                              onChange={(e) => {
                                const newOpts = [...(selectedNode.data.options || [])];
                                newOpts[i] = e.target.value;
                                updateNodeData({ options: newOpts });
                              }}
                              className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-rose-500 font-medium"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const newOpts = (selectedNode.data.options || []).filter((_, idx) => idx !== i);
                                updateNodeData({ options: newOpts });
                              }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                              title="Eliminar opción"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}

                        <button
                          type="button"
                          onClick={() => {
                            const newOpts = [
                              ...(selectedNode.data.options || []),
                              `Opción ${(selectedNode.data.options || []).length + 1}`
                            ];
                            updateNodeData({ options: newOpts });
                          }}
                          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-rose-300 bg-rose-50/50 hover:bg-rose-100/50 text-xs font-bold text-rose-700 transition-colors cursor-pointer"
                        >
                          <Plus size={13} />
                          <span>Añadir Opción</span>
                        </button>
                      </div>
                    </div>

                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      Cada opción genera un punto de conexión en el lado derecho del nodo en el lienzo. Conecta cada salida a su acción correspondiente.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* CONFIGURACIÓN GENERAL DEL ACTIVADOR Y DEL FLUJO (CUANDO NO HAY NODO SELECCIONADO) */
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <div className="p-4 border-b border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Configuración General
                </span>
                <h3 className="text-sm font-bold text-slate-900">Activador de WhatsApp</h3>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Nombre del Flujo */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Nombre del Flujo
                  </label>
                  <input
                    type="text"
                    value={flowName}
                    onChange={(e) => {
                      setFlowName(e.target.value);
                      setIsDirty(true);
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
                    placeholder="ej. Flujo de Bienvenida y Ofertas"
                  />
                </div>

                {/* Palabra Clave Trigger */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Palabra Clave (Trigger)
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={triggerKeyword}
                      onChange={(e) => {
                        setTriggerKeyword(e.target.value);
                        setIsDirty(true);
                      }}
                      className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-blue-500"
                      placeholder="ej. menu, catalogo"
                    />
                    <Zap size={14} className="absolute left-2.5 top-2.5 text-amber-500 fill-amber-500" />
                  </div>
                </div>

                {/* Banner Explicativo de Coincidencia Exacta */}
                <div className="p-3.5 bg-blue-50/70 border border-blue-100 rounded-xl space-y-1.5 text-xs text-blue-950">
                  <div className="flex items-center gap-1.5 font-bold text-blue-900">
                    <Info size={14} className="text-blue-600 flex-shrink-0" />
                    <span>Regla de Activación Exacta</span>
                  </div>
                  <p className="text-[11px] text-blue-800 leading-relaxed font-normal">
                    La automatización se iniciará cuando el cliente envíe <strong>exactamente</strong> esta palabra o frase (ej: <code className="bg-white/80 px-1 py-0.5 rounded font-mono font-bold">{triggerKeyword}</code>). No distingue mayúsculas de minúsculas.
                  </p>
                </div>

                {/* Resumen del Lienzo */}
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Estado del Lienzo
                  </span>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-xl border border-slate-100 bg-slate-50 text-center">
                      <span className="text-[10px] text-slate-500 block">Nodos</span>
                      <strong className="text-base text-slate-800">{nodes.length}</strong>
                    </div>
                    <div className="p-2.5 rounded-xl border border-slate-100 bg-slate-50 text-center">
                      <span className="text-[10px] text-slate-500 block">Conexiones</span>
                      <strong className="text-base text-slate-800">{edges.length}</strong>
                    </div>
                  </div>
                </div>

                {/* Guía Rápida para Demo Comercial */}
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-1 text-slate-600">
                  <span className="text-[11px] font-bold text-slate-800 block">
                    Consejo para la Reunión Demo
                  </span>
                  <p className="text-[10px] leading-relaxed">
                    1. Envía <code className="font-bold text-blue-600 font-mono">{triggerKeyword}</code> desde tu móvil.<br />
                    2. Muestra cómo el bot responde de inmediato.<br />
                    3. Responde con el nombre de la opción para demostrar la bifurcación visual.
                  </p>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MODAL GUIADO: PROBAR AUTOMATIZACIÓN EN VIVO */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {isTestModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Cabecera */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600 text-white shadow-xs">
                  <Play size={14} className="fill-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Probar Flujo en Vivo</h3>
                  <p className="text-[10px] text-slate-500">Demostración por WhatsApp</p>
                </div>
              </div>
              <button
                onClick={() => setIsTestModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Pasos */}
            <div className="p-5 space-y-4">
              {whatsappStatus.loading ? (
                <div className="flex items-center justify-center p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-500">
                  <RefreshCw size={14} className="animate-spin mr-2" />
                  <span className="text-xs font-bold">Verificando conexión…</span>
                </div>
              ) : whatsappStatus.connected ? (
                <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-bold">WhatsApp Conectado</span>
                  </div>
                  <span className="text-[11px] font-mono font-semibold text-emerald-800">
                    {whatsappStatus.phone || 'Número no disponible'}
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-950">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <span className="text-xs font-bold">WhatsApp No Conectado</span>
                  </div>
                  <span className="text-[11px] font-semibold text-amber-700">
                    Conecta en Ajustes → Conexiones
                  </span>
                </div>
              )}

              <div className="space-y-2.5 text-xs text-slate-700">
                <div className="flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-[10px] flex-shrink-0 mt-0.5">
                    1
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Guarda y verifica que esté Activo</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Estado actual: <strong className={isActive ? 'text-emerald-600' : 'text-slate-500'}>{isActive ? 'ACTIVO' : 'INACTIVO'}</strong>
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-[10px] flex-shrink-0 mt-0.5">
                    2
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-slate-900">Envía este mensaje exacto:</p>
                    <div className="mt-1 flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="font-mono font-bold text-sm text-blue-600">
                        {triggerKeyword}
                      </span>
                      <button
                        onClick={handleCopyTrigger}
                        className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-blue-600 px-2 py-1 rounded bg-white border border-slate-200 cursor-pointer shadow-2xs"
                      >
                        {copiedTrigger ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                        <span>{copiedTrigger ? 'Copiado' : 'Copiar'}</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-[10px] flex-shrink-0 mt-0.5">
                    3
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">El flujo responderá automáticamente</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Si hay bifurcación, responde con una de las opciones para avanzar por el árbol.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setIsTestModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* TOASTS NOTIFICACIONES */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-lg text-xs font-bold animate-in fade-in slide-in-from-bottom-3 duration-150 ${
            toast.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
          role="status"
        >
          {toast.type === 'success' ? (
            <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertCircle size={16} className="text-rose-600 flex-shrink-0" />
          )}
          <span>{toast.msg}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-2 text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

export default function FlowBuilderPage() {
  return (
    <ReactFlowProvider>
      <FlowBuilderInner />
    </ReactFlowProvider>
  );
}
