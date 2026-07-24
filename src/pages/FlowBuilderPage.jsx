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
  Position
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
  Image,
  Clock,
  Tag,
  Plus,
  X,
  Headset,
  Globe
} from 'lucide-react';
import * as flowService from '../services/flowService';
import { useUnsavedChanges } from '../context/UnsavedChangesContext';

// --- COMPONENTES DE NODOS PERSONALIZADOS ---

function MessageNode({ data }) {
  return (
    <div className="bg-card border-2 border-emerald-600 rounded-lg p-3 text-xs w-[180px] shadow-sm select-none">
      <Handle type="target" position={Position.Top} className="w-2.5 h-2.5 bg-emerald-600" />
      <div className="font-bold text-emerald-600 mb-1">Mensaje de Texto</div>
      <div className="text-[10px] text-hi truncate font-medium">
        {data.label || 'Escribe tu mensaje...'}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-2.5 h-2.5 bg-emerald-600" />
    </div>
  );
}

function MediaNode({ data }) {
  return (
    <div className="bg-card border-2 border-violet-600 rounded-lg p-3 text-xs w-[180px] shadow-sm select-none">
      <Handle type="target" position={Position.Top} className="w-2.5 h-2.5 bg-violet-600" />
      <div className="font-bold text-violet-600 mb-1">Enviar Multimedia</div>
      <div className="text-[9px] text-lo truncate mb-1">
        {data.mediaUrl ? 'Imagen adjunta' : 'Sin imagen'}
      </div>
      <div className="text-[10px] text-hi truncate font-medium">
        {data.label || 'Descripción (opcional)'}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-2.5 h-2.5 bg-violet-600" />
    </div>
  );
}

function DelayNode({ data }) {
  return (
    <div className="bg-card border-2 border-orange-500 rounded-lg p-3 text-xs w-[180px] shadow-sm select-none">
      <Handle type="target" position={Position.Top} className="w-2.5 h-2.5 bg-orange-500" />
      <div className="font-bold text-orange-600 mb-1">Retraso / Espera</div>
      <div className="text-[10px] text-hi font-mono font-semibold">
        {data.delaySeconds || 10} segundos
      </div>
      <Handle type="source" position={Position.Bottom} className="w-2.5 h-2.5 bg-orange-500" />
    </div>
  );
}

function TagNode({ data }) {
  return (
    <div className="bg-card border-2 border-amber-500 rounded-lg p-3 text-xs w-[180px] shadow-sm select-none">
      <Handle type="target" position={Position.Top} className="w-2.5 h-2.5 bg-amber-500" />
      <div className="font-bold text-amber-600 mb-1">Añadir Etiqueta</div>
      <div className="bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 text-[9px] text-amber-800 inline-block font-mono font-bold">
        {data.tagName || 'sin-etiqueta'}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-2.5 h-2.5 bg-amber-500" />
    </div>
  );
}

function HandoffNode() {
  return (
    <div className="bg-card border-2 border-slate-600 rounded-lg p-3 text-xs w-[180px] shadow-sm select-none">
      <Handle type="target" position={Position.Top} className="w-2.5 h-2.5 bg-slate-600" />
      <div className="font-bold text-slate-600 mb-1">Transferir a Asesor</div>
      <div className="text-[9px] text-lo leading-normal">
        Pausa el bot de chat y transfiere la atención a humanos.
      </div>
    </div>
  );
}

function ApiNode({ data }) {
  return (
    <div className="bg-card border-2 border-indigo-600 rounded-lg p-3 text-xs w-[180px] shadow-sm select-none">
      <Handle type="target" position={Position.Top} className="w-2.5 h-2.5 bg-indigo-600" />
      <div className="font-bold text-indigo-600 mb-1">Llamar API (Webhook)</div>
      <div className="text-[9px] text-indigo-800 font-bold bg-indigo-50 px-1.5 py-0.5 rounded inline-block font-mono mb-1">
        {data.apiMethod || 'GET'}
      </div>
      <div className="text-[9px] text-lo truncate">
        {data.apiUrl || 'https://api.tu-servidor.com'}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-2.5 h-2.5 bg-indigo-600" />
    </div>
  );
}

function ConditionNode({ data }) {
  const options = data.options || [];
  return (
    <div className="bg-card border-2 border-rose-600 rounded-lg p-3 text-xs w-[190px] shadow-sm select-none">
      <Handle type="target" position={Position.Top} className="w-2.5 h-2.5 bg-rose-600" />
      <div className="font-bold text-rose-600 mb-1">Opción / Condición</div>
      <div className="text-[10px] text-hi truncate font-medium mb-2">
        {data.label || 'Título de condición...'}
      </div>
      <div className="space-y-1">
        {options.map((opt, i) => (
          <div key={i} className="relative bg-rose-50 border border-rose-100 rounded px-1.5 py-1 text-[9px] text-rose-800 font-semibold flex justify-between items-center">
            <span>{opt}</span>
            <Handle
              type="source"
              position={Position.Bottom}
              id={`opt-${opt}`}
              style={{
                bottom: -12,
                left: `${(i + 1) * (100 / (options.length + 1))}%`,
                background: '#e11d48',
                width: 7,
                height: 7
              }}
            />
          </div>
        ))}
        {options.length === 0 && (
          <p className="text-[9px] text-muted italic">Sin opciones definidas.</p>
        )}
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

const edgeTypes = {};

const initialNodes = [
  {
    id: 'n1',
    type: 'messageNode',
    data: { label: 'Mensaje Inicial (Disparador)' },
    position: { x: 250, y: 150 }
  }
];

function FlowBuilderInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const reactFlowWrapper = useRef(null);

  // Configuraciones generales del flujo
  const [flowId, setFlowId] = useState(null);
  const [flowName, setFlowName] = useState('Nuevo Flujo Automatizado');
  const [triggerKeyword, setTriggerKeyword] = useState('hola');
  const [isActive, setIsActive] = useState(true);

  const [selectedNode, setSelectedNode] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const { isDirty, setIsDirty } = useUnsavedChanges();

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

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
          setNodes(typeof activeFlow.nodes === 'string' ? JSON.parse(activeFlow.nodes) : activeFlow.nodes);
        }
        if (activeFlow.edges) {
          setEdges(typeof activeFlow.edges === 'string' ? JSON.parse(activeFlow.edges) : activeFlow.edges);
        }
        // Marcar como limpio nada más cargarse el flujo inicial
        setTimeout(() => setIsDirty(false), 200);
      }
    } catch {
      showToast('Error al conectar con el servidor de flujos.', 'error');
    }
  };

  useEffect(() => {
    loadFirstFlow();
  }, []);

  const onConnect = useCallback(
    (params) => {
      setEdges((eds) => addEdge({ ...params, animated: true }, eds));
      setIsDirty(true);
    },
    [setEdges]
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();

      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
      const dragType = event.dataTransfer.getData('application/reactflow');

      if (typeof dragType === 'undefined' || !dragType) {
        return;
      }

      const position = reactFlowInstance.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      let nodeType = 'messageNode';
      let defaultData = { label: 'Mensaje de Texto' };

      if (dragType === 'condition') {
        nodeType = 'conditionNode';
        defaultData = { label: 'Elige una opción:', options: ['Comprar', 'Soporte'] };
      } else if (dragType === 'media') {
        nodeType = 'mediaNode';
        defaultData = { label: 'Folletos y fotos', mediaUrl: '' };
      } else if (dragType === 'delay') {
        nodeType = 'delayNode';
        defaultData = { delaySeconds: 10 };
      } else if (dragType === 'tag') {
        nodeType = 'tagNode';
        defaultData = { tagName: 'interesado' };
      } else if (dragType === 'handoff') {
        nodeType = 'handoffNode';
        defaultData = { label: 'Transferencia Humana' };
      } else if (dragType === 'api') {
        nodeType = 'apiNode';
        defaultData = { apiUrl: 'https://api.ejemplo.com/webhook', apiMethod: 'GET', apiBody: '' };
      }

      const newNode = {
        id: `node_${Date.now()}`,
        type: nodeType,
        position,
        data: defaultData
      };

      setNodes((nds) => nds.concat(newNode));
      setIsDirty(true);
    },
    [reactFlowInstance, setNodes]
  );

  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node);
  }, []);

  const updateNodeData = (newData) => {
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

  const handleSave = async () => {
    if (!flowName.trim() || !triggerKeyword.trim()) {
      showToast('El nombre del flujo y la palabra clave son obligatorios.', 'error');
      return;
    }

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
        showToast('Flujo visual guardado correctamente.');
        setIsDirty(false);
      }
    } catch {
      showToast('Error al persistir el flujo visual en la base de datos.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row w-full h-[calc(100vh-64px)] md:h-screen bg-card overflow-hidden">
      {/* Panel Lateral Izquierdo: Herramientas y Configuración */}
      <div className="w-full md:w-80 border-r border-line bg-card flex flex-col p-5 overflow-y-auto flex-shrink-0">
        <h1 className="text-base font-bold text-hi mb-1">Flow Builder</h1>
        <p className="text-2xs text-lo mb-4">Crea árboles de decisión interactivos para WhatsApp.</p>

        {/* Configuración del Flujo */}
        <div className="space-y-3.5 mb-5 pb-5 border-b border-line">
          <div>
            <label className="block text-xs font-semibold text-mid mb-1">Nombre del Flujo</label>
            <input
              type="text"
              value={flowName}
              onChange={(e) => {
                setFlowName(e.target.value);
                setIsDirty(true);
              }}
              className="w-full px-3 py-2 rounded-md border border-line bg-app text-xs text-hi focus:outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-mid mb-1">Palabra Clave (Trigger)</label>
            <input
              type="text"
              value={triggerKeyword}
              onChange={(e) => {
                setTriggerKeyword(e.target.value);
                setIsDirty(true);
              }}
              placeholder="ej. precio, catalogo"
              className="w-full px-3 py-2 rounded-md border border-line bg-app text-xs text-hi focus:outline-none focus:border-brand font-mono"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-mid">Estado del Flujo</span>
            <button
              type="button"
              onClick={() => {
                setIsActive(!isActive);
                setIsDirty(true);
              }}
              className={`px-3 py-1.5 rounded-full text-2xs font-bold transition-colors cursor-pointer ${isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-lo'}`}
            >
              {isActive ? 'Activo' : 'Inactivo'}
            </button>
          </div>
        </div>

        {/* Selector de Nodos Arrastrables */}
        <div className="space-y-3 mb-5">
          <h2 className="text-xs font-bold text-hi uppercase tracking-wider">Caja de Nodos</h2>
          <p className="text-3xs text-lo">Arrastra estos bloques al lienzo de la derecha para agregarlos al flujo.</p>

          <div className="grid grid-cols-1 gap-2.5">
            {/* Enviar Mensaje */}
            <div
              className="flex items-center gap-3 p-2.5 rounded-lg border border-line bg-app hover:border-brand transition-all cursor-grab active:cursor-grabbing group select-none"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/reactflow', 'message');
                event.dataTransfer.effectAllowed = 'move';
              }}
            >
              <div className="flex items-center justify-center w-8 h-8 rounded bg-emerald-50 text-emerald-600">
                <MessageSquare size={15} />
              </div>
              <div>
                <p className="text-xs font-semibold text-hi leading-none">Enviar Mensaje</p>
                <p className="text-[10px] text-lo mt-1">Texto simple del bot</p>
              </div>
            </div>

            {/* Enviar Multimedia */}
            <div
              className="flex items-center gap-3 p-2.5 rounded-lg border border-line bg-app hover:border-brand transition-all cursor-grab active:cursor-grabbing group select-none"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/reactflow', 'media');
                event.dataTransfer.effectAllowed = 'move';
              }}
            >
              <div className="flex items-center justify-center w-8 h-8 rounded bg-violet-50 text-violet-600">
                <Image size={15} />
              </div>
              <div>
                <p className="text-xs font-semibold text-hi leading-none">Enviar Multimedia</p>
                <p className="text-[10px] text-lo mt-1">Enviar imagen con caption</p>
              </div>
            </div>

            {/* Retraso / Espera */}
            <div
              className="flex items-center gap-3 p-2.5 rounded-lg border border-line bg-app hover:border-brand transition-all cursor-grab active:cursor-grabbing group select-none"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/reactflow', 'delay');
                event.dataTransfer.effectAllowed = 'move';
              }}
            >
              <div className="flex items-center justify-center w-8 h-8 rounded bg-orange-50 text-orange-600">
                <Clock size={15} />
              </div>
              <div>
                <p className="text-xs font-semibold text-hi leading-none">Retraso / Espera</p>
                <p className="text-[10px] text-lo mt-1">Pausar por X segundos</p>
              </div>
            </div>

            {/* Añadir Etiqueta */}
            <div
              className="flex items-center gap-3 p-2.5 rounded-lg border border-line bg-app hover:border-brand transition-all cursor-grab active:cursor-grabbing group select-none"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/reactflow', 'tag');
                event.dataTransfer.effectAllowed = 'move';
              }}
            >
              <div className="flex items-center justify-center w-8 h-8 rounded bg-amber-50 text-amber-600">
                <Tag size={15} />
              </div>
              <div>
                <p className="text-xs font-semibold text-hi leading-none">Añadir Etiqueta</p>
                <p className="text-[10px] text-lo mt-1">Guardar etiqueta en CRM</p>
              </div>
            </div>

            {/* Transferir a Asesor */}
            <div
              className="flex items-center gap-3 p-2.5 rounded-lg border border-line bg-app hover:border-brand transition-all cursor-grab active:cursor-grabbing group select-none"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/reactflow', 'handoff');
                event.dataTransfer.effectAllowed = 'move';
              }}
            >
              <div className="flex items-center justify-center w-8 h-8 rounded bg-slate-100 text-slate-700">
                <Headset size={15} />
              </div>
              <div>
                <p className="text-xs font-semibold text-hi leading-none">Transferir a Asesor</p>
                <p className="text-[10px] text-lo mt-1">Pausa y pasa a chat humano</p>
              </div>
            </div>

            {/* Llamar API Webhook */}
            <div
              className="flex items-center gap-3 p-2.5 rounded-lg border border-line bg-app hover:border-brand transition-all cursor-grab active:cursor-grabbing group select-none"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/reactflow', 'api');
                event.dataTransfer.effectAllowed = 'move';
              }}
            >
              <div className="flex items-center justify-center w-8 h-8 rounded bg-indigo-50 text-indigo-600">
                <Globe size={15} />
              </div>
              <div>
                <p className="text-xs font-semibold text-hi leading-none">Llamar API (Webhook)</p>
                <p className="text-[10px] text-lo mt-1">Hacer petición HTTP externa</p>
              </div>
            </div>

            {/* Condición / Opciones */}
            <div
              className="flex items-center gap-3 p-2.5 rounded-lg border border-line bg-app hover:border-brand transition-all cursor-grab active:cursor-grabbing group select-none"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/reactflow', 'condition');
                event.dataTransfer.effectAllowed = 'move';
              }}
            >
              <div className="flex items-center justify-center w-8 h-8 rounded bg-rose-50 text-rose-600">
                <GitBranch size={15} />
              </div>
              <div>
                <p className="text-xs font-semibold text-hi leading-none">Condición / Opciones</p>
                <p className="text-[10px] text-lo mt-1">Bifurcar por respuestas</p>
              </div>
            </div>
          </div>
        </div>

        {/* Editor de Propiedades del Nodo Seleccionado */}
        <div className="flex-1 border-t border-line pt-5">
          {selectedNode ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-hi uppercase tracking-wider">Propiedades</h3>
                <button
                  type="button"
                  onClick={() => {
                    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
                    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
                    setSelectedNode(null);
                  }}
                  className="flex items-center gap-1 text-[10px] text-rose-600 hover:underline cursor-pointer"
                >
                  <Trash2 size={11} />
                  <span>Eliminar</span>
                </button>
              </div>

              {/* Formulario Dinámico según Tipo */}
              {selectedNode.type === 'messageNode' && (
                <div>
                  <label className="block text-[10px] font-semibold text-mid mb-1">Texto del Mensaje</label>
                  <textarea
                    value={selectedNode.data.label || ''}
                    onChange={(e) => updateNodeData({ label: e.target.value })}
                    rows={4}
                    className="w-full px-3 py-2 rounded-md border border-line bg-app text-xs text-hi focus:outline-none focus:border-brand resize-none leading-relaxed"
                    placeholder="Escribe el mensaje..."
                  />
                </div>
              )}

              {selectedNode.type === 'mediaNode' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-mid mb-1">Texto / Caption (opcional)</label>
                    <input
                      type="text"
                      value={selectedNode.data.label || ''}
                      onChange={(e) => updateNodeData({ label: e.target.value })}
                      className="w-full px-3 py-2 rounded-md border border-line bg-app text-xs text-hi focus:outline-none focus:border-brand"
                      placeholder="ej. Aquí tienes tu folleto"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-mid mb-1">Imagen (URL o Archivo)</label>
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={selectedNode.data.mediaUrl || ''}
                        onChange={(e) => updateNodeData({ mediaUrl: e.target.value })}
                        className="w-full px-3 py-2 rounded-md border border-line bg-app text-xs text-hi focus:outline-none focus:border-brand font-mono"
                        placeholder="Pegar URL de la imagen..."
                      />
                      <div className="flex items-center gap-2">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          id="property-media-file"
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
                          htmlFor="property-media-file"
                          className="w-full text-center px-3 py-2 rounded border border-line bg-app text-2xs font-semibold text-hi hover:bg-app-hover cursor-pointer"
                        >
                          Subir Imagen Local
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {selectedNode.type === 'delayNode' && (
                <div>
                  <label className="block text-[10px] font-semibold text-mid mb-1">Tiempo de Espera (segundos)</label>
                  <input
                    type="number"
                    min="1"
                    max="3600"
                    value={selectedNode.data.delaySeconds || 10}
                    onChange={(e) => updateNodeData({ delaySeconds: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-md border border-line bg-app text-xs text-hi focus:outline-none focus:border-brand font-mono"
                  />
                </div>
              )}

              {selectedNode.type === 'tagNode' && (
                <div>
                  <label className="block text-[10px] font-semibold text-mid mb-1">Nombre de la Etiqueta (CRM)</label>
                  <input
                    type="text"
                    value={selectedNode.data.tagName || ''}
                    onChange={(e) => updateNodeData({ tagName: e.target.value.trim() })}
                    className="w-full px-3 py-2 rounded-md border border-line bg-app text-xs text-hi focus:outline-none focus:border-brand font-mono"
                    placeholder="ej. leads-interesados"
                  />
                </div>
              )}

              {selectedNode.type === 'handoffNode' && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2">
                  <div className="flex gap-2 text-slate-700 items-start">
                    <HelpCircle size={15} className="text-slate-500 flex-shrink-0 mt-0.5" />
                    <p className="text-3xs leading-relaxed font-semibold">
                      Este nodo pausará el bot automáticamente para este contacto. Un asesor humano deberá atender la conversación y reanudarlo manualmente desde el chat.
                    </p>
                  </div>
                </div>
              )}

              {selectedNode.type === 'apiNode' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-mid mb-1">Método HTTP</label>
                    <select
                      value={selectedNode.data.apiMethod || 'GET'}
                      onChange={(e) => updateNodeData({ apiMethod: e.target.value })}
                      className="w-full px-3 py-2 rounded-md border border-line bg-app text-xs text-hi focus:outline-none focus:border-brand cursor-pointer"
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-mid mb-1">URL de la API</label>
                    <input
                      type="text"
                      value={selectedNode.data.apiUrl || ''}
                      onChange={(e) => updateNodeData({ apiUrl: e.target.value })}
                      className="w-full px-3 py-2 rounded-md border border-line bg-app text-xs text-hi focus:outline-none focus:border-brand font-mono"
                      placeholder="https://api.ejemplo.com/webhook"
                    />
                  </div>
                  {selectedNode.data.apiMethod === 'POST' && (
                    <div>
                      <label className="block text-[10px] font-semibold text-mid mb-1">Cuerpo JSON (Body)</label>
                      <textarea
                        value={selectedNode.data.apiBody || ''}
                        onChange={(e) => updateNodeData({ apiBody: e.target.value })}
                        rows={4}
                        className="w-full px-3 py-2 rounded-md border border-line bg-app text-xs text-hi focus:outline-none focus:border-brand font-mono resize-none leading-relaxed"
                        placeholder='{ "key": "value" }'
                      />
                    </div>
                  )}
                </div>
              )}

              {selectedNode.type === 'conditionNode' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-mid mb-1">Pregunta / Condición</label>
                    <input
                      type="text"
                      value={selectedNode.data.label || ''}
                      onChange={(e) => updateNodeData({ label: e.target.value })}
                      className="w-full px-3 py-2 rounded-md border border-line bg-app text-xs text-hi focus:outline-none focus:border-brand"
                      placeholder="ej. Elige tu opción"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-mid mb-1">Opciones de Salida</label>
                    <div className="space-y-2 mt-1.5">
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
                            className="flex-1 px-2.5 py-1.5 rounded border border-line bg-app text-xs text-hi focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const newOpts = (selectedNode.data.options || []).filter((_, idx) => idx !== i);
                              updateNodeData({ options: newOpts });
                            }}
                            className="text-lo hover:text-danger p-1 font-bold"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const newOpts = [...(selectedNode.data.options || []), `Opción ${(selectedNode.data.options || []).length + 1}`];
                          updateNodeData({ options: newOpts });
                        }}
                        className="w-full flex items-center justify-center gap-1 py-1.5 border border-dashed border-line bg-app hover:bg-app-hover rounded text-2xs font-semibold text-hi cursor-pointer"
                      >
                        <Plus size={12} />
                        <span>Añadir opción</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-start gap-2 text-lo">
              <HelpCircle size={14} className="text-brand flex-shrink-0 mt-0.5" />
              <p className="text-3xs leading-relaxed">
                Haz clic sobre cualquier nodo del lienzo de diseño para editar sus propiedades específicas y estructurar las respuestas.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Lienzo Principal (React Flow Canvas) */}
      <div className="flex-1 h-full relative" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={(changes) => {
            onNodesChange(changes);
            const isRealChange = changes.some(c => c.type === 'position' || c.type === 'remove' || c.type === 'add');
            if (isRealChange) setIsDirty(true);
          }}
          onEdgesChange={(changes) => {
            onEdgesChange(changes);
            const isRealChange = changes.some(c => c.type === 'remove' || c.type === 'add');
            if (isRealChange) setIsDirty(true);
          }}
          onConnect={onConnect}
          onInit={setReactFlowInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
        >
          <Controls />
          <MiniMap style={{ height: 100, width: 150 }} zoomable pannable />
          <Background color="#ccc" gap={16} />
        </ReactFlow>

        {/* Botón Flotante para Guardar */}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="absolute bottom-5 right-5 z-10 flex items-center gap-2 px-5 py-3 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-semibold shadow-card transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSaving ? (
            <>
              <RefreshCw size={16} className="animate-spin" />
              <span>Guardando...</span>
            </>
          ) : (
            <>
              <Save size={16} />
              <span>Guardar Flujo</span>
            </>
          )}
        </button>
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

export default function FlowBuilderPage() {
  return (
    <ReactFlowProvider>
      <FlowBuilderInner />
    </ReactFlowProvider>
  );
}
