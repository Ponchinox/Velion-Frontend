import { useState, useRef, useEffect } from 'react';
import {
  MagnifyingGlass,
  PaperPlaneRight,
  Paperclip,
  ArrowLeft,
  Phone,
  UserCircle,
  X,
  DotsThreeVertical,
  Circle,
  WarningCircle,
  ArrowClockwise,
  Check,
  Checks,
} from '@phosphor-icons/react';
import * as chatService from '../services/chatService';
import { io } from 'socket.io-client';
import { Play } from 'lucide-react';

/* ─── Configuración de avatares ─── */
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700',
  'bg-orange-100 text-orange-700',
  'bg-rose-100 text-rose-700',
];

function getAvatarStyle(name = '', index = 0) {
  const initials = name
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const colorCls = AVATAR_COLORS[index % AVATAR_COLORS.length];
  return { initials, colorCls };
}

/* ─── Icono de Estado de Mensaje (Ticks) ─── */
function StatusIcon({ status }) {
  if (status === 'read') {
    return <Checks size={13} className="text-sky-300 inline-block" weight="bold" title="Leído (Meta)" />;
  }
  if (status === 'delivered') {
    return <Checks size={13} className="text-white/70 inline-block" title="Entregado" />;
  }
  if (status === 'failed') {
    return <WarningCircle size={12} className="text-red-300 inline-block" weight="bold" title="Error en envío" />;
  }
  // status === 'sent' o default
  return <Check size={12} className="text-white/60 inline-block" title="Enviado" />;
}

/* ─── Renderizador Multimedia Inteligente ─── */
function renderMessageContent(text, onImageClick) {
  if (!text) return null;

  // Regex para detectar URLs de imágenes (Cloudinary o extensiones comunes)
  const imageRegex = /(https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s]*)?|https?:\/\/res\.cloudinary\.com\/[^\s]+)/gi;
  const match = text.match(imageRegex);

  if (match) {
    const imageUrl = match[0];
    // Si el texto es exactamente la URL de la imagen
    if (text.trim() === imageUrl) {
      return (
        <img
          src={imageUrl}
          alt="Media"
          className="max-w-[250px] max-h-[250px] object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
          loading="lazy"
          onClick={() => onImageClick && onImageClick(imageUrl)}
        />
      );
    }

    // Si tiene texto descriptivo adicional junto a la URL de la imagen
    const cleanText = text.replace(imageRegex, '').trim();
    return (
      <div className="space-y-2 break-words whitespace-pre-wrap">
        {cleanText && <p className="text-sm leading-relaxed">{cleanText}</p>}
        <img
          src={imageUrl}
          alt="Media"
          className="max-w-[250px] max-h-[250px] object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
          loading="lazy"
          onClick={() => onImageClick && onImageClick(imageUrl)}
        />
      </div>
    );
  }

  return <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{text}</p>;
}

/* ─── Burbuja de mensaje con estados ─── */
function Bubble({ msg, onImageClick }) {
  const isClient = msg.from === 'client';
  return (
    <div className={`flex ${isClient ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`
          max-w-[75%] sm:max-w-[60%] rounded-2xl px-4 py-2.5 shadow-card break-words
          ${isClient
            ? 'bg-app text-hi rounded-tl-sm'
            : 'bg-brand text-white rounded-tr-sm'
          }
        `}
      >
        {msg.image && (
          <img
            src={msg.image}
            alt="Imagen adjunta"
            className="rounded-lg mb-2 w-full object-cover max-h-40 cursor-pointer hover:opacity-90 transition-opacity"
            loading="lazy"
            onClick={() => onImageClick && onImageClick(msg.image)}
          />
        )}
        {msg.text && renderMessageContent(msg.text, onImageClick)}
        <div className={`text-[10px] mt-1 flex items-center justify-end gap-1 ${isClient ? 'text-muted' : 'text-white/70'}`}>
          <span>{msg.time}</span>
          {!isClient && <StatusIcon status={msg.status} />}
        </div>
      </div>
    </div>
  );
}

/* ─── Tarjeta de chat con indicador de proveedor y ventana ─── */
function ChatItem({ chat, index, isActive, onClick }) {
  const { initials, colorCls } = getAvatarStyle(chat.name, index);
  const isMetaClosed = chat.provider === 'META' && chat.isWindowOpen === false;

  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-start gap-3 px-4 py-3.5 text-left
        border-b border-line transition-all duration-fast cursor-pointer
        ${isActive ? 'bg-brand/5 border-l-2 border-l-brand' : 'hover:bg-app border-l-2 border-l-transparent'}
      `}
      aria-label={`Chat con ${chat.name}`}
      aria-pressed={isActive}
    >
      <span className={`
        inline-flex items-center justify-center w-10 h-10 rounded-full
        text-sm font-bold flex-shrink-0 ${colorCls}
      `}>
        {initials}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className={`text-sm font-semibold truncate ${isActive ? 'text-brand' : 'text-hi'}`}>
            {chat.name}
          </p>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {chat.provider === 'META' && (
              <span
                className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                  chat.isWindowOpen
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                }`}
                title={chat.isWindowOpen ? 'Ventana Meta 24h activa' : 'Ventana Meta 24h expirada'}
              >
                {chat.isWindowOpen ? '24h' : '24h exp'}
              </span>
            )}
            <span className="text-2xs text-muted">{chat.time}</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className="text-xs text-lo truncate">{chat.lastMsg}</p>
          {chat.unread > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand text-white text-2xs font-bold flex-shrink-0">
              {chat.unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}


/* ─── Panel de conversación (Área del Chat) ─── */
function ConversationPanel({ chat, index, messages, isLoadingMessages, onSendMessage, onBack, isMobile, onImageClick, onResumeBot }) {
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  const fileInputRef = useRef(null);
  const docInputRef = useRef(null);

  const { initials, colorCls } = getAvatarStyle(chat.name, index);

  /* Auto-scroll */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoadingMessages]);

  /* Auto-resize del textarea */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [input]);

  const handleSend = () => {
    if (!input.trim() && !attachment) return;
    onSendMessage(input.trim(), attachment);
    setInput('');
    setAttachment(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e, type) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setAttachment({
        file,
        base64: reader.result,
        name: file.name,
        type: type // 'image' o 'document'
      });
    };
    reader.readAsDataURL(file);
    setShowAttachMenu(false);
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-card">
      {/* Header del chat */}
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-line bg-card flex-shrink-0">
        {isMobile && (
          <button
            onClick={onBack}
            className="p-1.5 rounded-md text-lo hover:text-hi hover:bg-app transition-colors -ml-1 cursor-pointer"
            aria-label="Volver a la lista"
          >
            <ArrowLeft size={18} />
          </button>
        )}

        <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full text-sm font-bold flex-shrink-0 ${colorCls}`}>
          {initials}
        </span>

        <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-2">
          <div>
            <p className="text-sm font-semibold text-hi leading-tight">{chat.name}</p>
            <p className="text-xs text-lo font-mono">{chat.phone || 'Sin número'}</p>
          </div>

          {/* Badges de Estado */}
          <div className="flex flex-wrap items-center gap-2 mt-1 sm:mt-0 sm:ml-2">
            {chat.isBotPaused && (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                  Bot Pausado
                </span>
                <button
                  onClick={onResumeBot}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-brand/10 hover:bg-brand/20 text-brand text-[10px] font-bold transition-all border border-brand/20 cursor-pointer"
                >
                  <Play size={10} className="fill-brand text-brand" />
                  Reactivar Bot
                </button>
              </div>
            )}

            {chat.provider === 'META' && (
              <div>
                {chat.isWindowOpen ? (
                  <span
                    title={`Ventana Meta 24h activa. Expira en aprox. ${Math.ceil((chat.windowRemainingMinutes || 1440) / 60)}h`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                  >
                    <Circle size={6} weight="fill" className="text-emerald-500 animate-pulse" />
                    Meta 24h Activa (~{Math.ceil((chat.windowRemainingMinutes || 1440) / 60)}h)
                  </span>
                ) : (
                  <span
                    title="Han transcurrido más de 24h desde el último mensaje del cliente. Meta prohíbe el envío de mensajes de texto libre."
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                  >
                    <WarningCircle size={11} weight="bold" className="text-amber-600" />
                    Ventana 24h Cerrada
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-line text-xs font-medium text-mid hover:bg-app hover:border-line-strong transition-all cursor-pointer"
          >
            <UserCircle size={14} />
            Ver Ficha
          </button>
          <button className="p-1.5 rounded-md text-lo hover:text-hi hover:bg-app transition-colors cursor-pointer">
            <DotsThreeVertical size={18} />
          </button>
        </div>
      </div>

      {/* Mensajes */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 space-y-3 bg-app/40"
        role="log"
        aria-live="polite"
      >
        {isLoadingMessages ? (
          <div className="flex flex-col justify-center items-center h-full space-y-3">
            <div className="animate-spin rounded-full h-7 w-7 border-2 border-brand border-t-transparent" />
            <p className="text-xs text-lo">Cargando conversación...</p>
          </div>
        ) : (
          <>
            {messages.map(msg => <Bubble key={msg.id} msg={msg} onImageClick={onImageClick} />)}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Banner de Ventana 24h de Meta Cerrada */}
      {isMetaWindowClosed && (
        <div className="bg-amber-50 dark:bg-amber-950/50 border-t border-amber-200 dark:border-amber-800/80 px-4 py-2.5 flex items-start sm:items-center gap-2.5 text-xs text-amber-800 dark:text-amber-200 flex-shrink-0">
          <WarningCircle size={18} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5 sm:mt-0" weight="bold" />
          <div className="flex-1">
            <p className="font-bold">Ventana de 24 horas de Meta cerrada</p>
            <p className="text-[11px] opacity-90">Han transcurrido más de 24h desde el último mensaje de este cliente. Meta exige que el cliente vuelva a escribir para responderle con texto libre.</p>
          </div>
        </div>
      )}

      {/* Previsualización del archivo adjunto */}
      {attachment && (
        <div className="px-4 py-2.5 bg-app border-t border-line flex items-center justify-between gap-3 flex-shrink-0 animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            {attachment.type === 'image' ? (
              <img
                src={attachment.base64}
                alt="Previsualización"
                className="w-12 h-12 object-cover rounded-lg border border-line"
              />
            ) : (
              <div className="w-12 h-12 bg-brand/10 text-brand rounded-lg flex items-center justify-center font-bold text-xs">
                DOC
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-hi truncate max-w-[200px]">{attachment.name}</p>
              <p className="text-[10px] text-muted capitalize">{attachment.type === 'image' ? 'Imagen' : 'Documento'}</p>
            </div>
          </div>
          <button
            onClick={() => setAttachment(null)}
            className="p-1 rounded-full bg-line hover:bg-line-strong text-lo hover:text-hi transition-colors cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Input footer */}
      <div className="flex-shrink-0 border-t border-line bg-card px-4 py-3 relative">
        {/* Menú de Adjuntos (Popover) */}
        {showAttachMenu && (
          <div className="absolute bottom-16 left-4 bg-card border border-line shadow-lg rounded-xl py-1.5 min-w-[140px] z-30 animate-in slide-in-from-bottom-2 duration-fast">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-hi hover:bg-app text-left cursor-pointer"
            >
              📷 Fotos y Videos
            </button>
            <button
              onClick={() => docInputRef.current?.click()}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-hi hover:bg-app text-left cursor-pointer"
            >
              📄 Documentos
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* Inputs de archivos ocultos */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFileChange(e, 'image')}
          />
          <input
            ref={docInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
            className="hidden"
            onChange={(e) => handleFileChange(e, 'document')}
          />

          <button
            type="button"
            disabled={isMetaWindowClosed}
            onClick={() => setShowAttachMenu(!showAttachMenu)}
            className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg border border-line text-lo hover:text-hi hover:bg-app hover:border-line-strong transition-all cursor-pointer mb-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Paperclip size={17} />
          </button>

          <div className={`flex-1 rounded-xl border border-line bg-app px-3.5 py-2 focus-within:border-brand focus-within:shadow-input-focus transition-all duration-fast ${isMetaWindowClosed ? 'opacity-60 bg-muted/20' : ''}`}>
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              disabled={isMetaWindowClosed}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isMetaWindowClosed ? "Ventana 24h de Meta cerrada. Esperando que el cliente escriba..." : "Escribe un mensaje... (Enter para enviar)"}
              className={`w-full resize-none bg-transparent text-sm text-hi placeholder:text-muted focus:outline-none leading-relaxed overflow-hidden ${isMetaWindowClosed ? 'cursor-not-allowed' : ''}`}
              style={{ maxHeight: '120px' }}
            />
          </div>

          <button
            onClick={handleSend}
            disabled={isMetaWindowClosed || (!input.trim() && !attachment) || isLoadingMessages}
            className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-brand text-white hover:bg-brand-hover shadow-card transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed mb-0.5"
          >
            <PaperPlaneRight size={16} weight="bold" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Skeletons de Carga ─── */
function SidebarSkeleton() {
  return (
    <div className="divide-y divide-line">
      {[1, 2, 3, 4].map(n => (
        <div key={n} className="flex items-start gap-3 px-4 py-3.5 animate-pulse">
          <div className="w-10 h-10 rounded-full bg-line flex-shrink-0" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-3.5 bg-line rounded w-1/2" />
            <div className="h-3 bg-line rounded w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-app/10">
      <div className="w-16 h-16 rounded-2xl bg-brand/10 flex items-center justify-center mb-4">
        <Phone size={32} className="text-brand" />
      </div>
      <p className="text-base font-semibold text-hi">Bandeja de Mensajes</p>
      <p className="text-sm text-lo mt-1.5 max-w-xs">
        Selecciona una conversación de la lista para ver y responder los mensajes en tiempo real.
      </p>
    </div>
  );
}

/* ─── Componente Principal ─── */
export default function ChatPage() {
  const [chats, setChats] = useState([]);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [chatsError, setChatsError] = useState('');
  
  const [activeChatId, setActiveChatId] = useState(null);
  const [activeChatMessages, setActiveChatMessages] = useState([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const [search, setSearch] = useState('');
  const [showConversation, setShowConversation] = useState(false); // solo móvil
  const [fullscreenImage, setFullscreenImage] = useState(null);

  const activeChat = chats.find(c => c.id === activeChatId);
  const activeChatIndex = chats.findIndex(c => c.id === activeChatId);

  const loadChats = async () => {
    setIsLoadingChats(true);
    setChatsError('');
    try {
      const data = await chatService.getChats();
      setChats(data || []);
    } catch {
      setChatsError('No se pudieron cargar los chats.');
    } finally {
      setIsLoadingChats(false);
    }
  };

  const loadMessages = async (chatId) => {
    setIsLoadingMessages(true);
    try {
      const data = await chatService.getMessages(chatId);
      setActiveChatMessages(data || []);
    } catch {
      // Fallback a mensajes mock del chat local si el endpoint no responde
      const selectedMock = chats.find(c => c.id === chatId);
      if (selectedMock && selectedMock.messages) {
        setActiveChatMessages(selectedMock.messages);
      } else {
        setActiveChatMessages([]);
      }
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const activeChatIdRef = useRef(activeChatId);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    loadChats();

    // Establecer conexión Socket.IO con el backend en tiempo real
    const socket = io(API_BASE_URL);

    socket.on('connect', () => {
      console.log('🔌 [Socket.IO] Conectado al servidor de WebSocket en tiempo real.');
    });

    // ── 1. Mensajes Nuevos en Tiempo Real ──
    socket.on('new_whatsapp_message', (msg) => {
      console.log('📩 [Socket.IO] Evento de mensaje recibido:', msg);
      const isIncoming = msg.type === 'incoming';

      // Si el mensaje es de la conversación seleccionada, añadirlo al chat activo
      if (msg.chatId === activeChatIdRef.current) {
        const formattedMsg = {
          id: msg.messageId || msg.id || `socket-${Date.now()}`,
          externalId: msg.externalId || null,
          status: msg.status || (isIncoming ? 'delivered' : 'sent'),
          from: isIncoming ? 'client' : 'business',
          text: msg.mediaType === 'image' ? '' : msg.text,
          image: msg.mediaType === 'image' ? msg.text : undefined,
          time: new Date(msg.timestamp || Date.now()).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
        };

        setActiveChatMessages(prev => {
          // Evitar duplicados
          const exists = prev.some(m => (m.externalId && formattedMsg.externalId && m.externalId === formattedMsg.externalId) || (m.text === formattedMsg.text && m.from === formattedMsg.from));
          if (exists) return prev;
          return [...prev, formattedMsg];
        });
      }

      // Actualizar información, último mensaje y ventana de 24h en la barra lateral
      setChats(prev => {
        return prev.map(c => {
          if (c.id === msg.chatId) {
            return {
              ...c,
              lastMsg: msg.mediaType === 'image' ? '📸 Imagen' : msg.text,
              time: new Date(msg.timestamp || Date.now()).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
              unread: c.id === activeChatIdRef.current ? c.unread : (c.unread || 0) + 1,
              isWindowOpen: isIncoming ? true : c.isWindowOpen,
              windowRemainingMinutes: isIncoming ? 1440 : c.windowRemainingMinutes
            };
          }
          return c;
        });
      });
    });

    // ── 2. Actualización de Estados de Entrega y Lectura (Meta / Evolution statuses) ──
    socket.on('message_status_updated', (data) => {
      console.log('📊 [Socket.IO] Estado de mensaje actualizado:', data);
      setActiveChatMessages(prev =>
        prev.map(m => {
          if (m.id === data.messageId || (data.externalId && m.externalId === data.externalId)) {
            return { ...m, status: data.status };
          }
          return m;
        })
      );
    });

    return () => {
      socket.disconnect();
      console.log('🔌 [Socket.IO] Conexión WebSocket desconectada.');
    };
  }, []);

  const handleSelectChat = (chat) => {
    setActiveChatId(chat.id);
    setShowConversation(true);
    loadMessages(chat.id);
  };

  const handleSendMessage = async (text, attachment = null) => {
    if (!activeChatId) return;

    // Optimistic UI: Mensaje temporal inmediato
    const tempMsg = {
      id: `temp-${Date.now()}`,
      from: 'business',
      text: attachment && attachment.type === 'image' ? '' : text,
      image: attachment && attachment.type === 'image' ? attachment.base64 : undefined,
      time: new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
    };

    setActiveChatMessages(prev => [...prev, tempMsg]);

    // Actualizar el último mensaje en la barra lateral de forma inmediata
    setChats(prev =>
      prev.map(c =>
        c.id === activeChatId 
          ? { 
              ...c, 
              lastMsg: attachment ? (attachment.type === 'image' ? '📸 Imagen' : '📄 Documento') : text, 
              time: tempMsg.time 
            } 
          : c
      )
    );

    try {
      // Envío real de mensaje directo conectando con Evolution API y PostgreSQL
      await chatService.sendDirectMessage({
        chatId: activeChatId,
        text,
        remoteJid: activeChat?.phone,
        media: attachment ? {
          base64: attachment.base64,
          name: attachment.name,
          type: attachment.type
        } : null
      });
    } catch (error) {
      // Fallback
    }
  };

  const handleResumeBot = async (customerId) => {
    if (!customerId) return;
    try {
      await chatService.resumeBot(customerId);
      setChats(prev => prev.map(c => {
        if (c.customerId === customerId) {
          return { ...c, isBotPaused: false };
        }
        return c;
      }));
    } catch (error) {
      console.error('Error al reactivar el bot:', error);
    }
  };

  const filteredChats = chats.filter(c =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.lastMsg.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      className="flex overflow-hidden bg-card w-full h-[calc(100vh-64px)] md:h-screen"
    >
      {/* ── Columna izquierda: Lista de chats ── */}
      <div className={`
        flex flex-col border-r border-line bg-card
        w-full md:w-80 lg:w-96 flex-shrink-0
        ${showConversation ? 'hidden md:flex' : 'flex'}
      `}>
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-line flex-shrink-0">
          <p className="text-base font-bold text-hi mb-3">Mensajes</p>
          
          <div className="relative">
            <MagnifyingGlass
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar en los chats..."
              className="
                w-full pl-8 pr-8 py-2 rounded-lg border border-line bg-app
                text-sm text-hi placeholder:text-muted focus:outline-none focus:border-brand
              "
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-hi cursor-pointer"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {isLoadingChats ? (
            <SidebarSkeleton />
          ) : chatsError ? (
            /* Error en el Servidor (Failsafe) */
            <div className="flex flex-col items-center justify-center p-6 text-center space-y-3 mt-10">
              <WarningCircle size={32} className="text-danger" />
              <div>
                <p className="text-sm font-semibold text-hi">{chatsError}</p>
                <p className="text-xs text-lo mt-1">Verifica tu conexión con el backend.</p>
              </div>
              <button
                onClick={loadChats}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-2xs font-semibold bg-brand text-white hover:bg-brand-hover rounded-md shadow transition-colors cursor-pointer"
              >
                <ArrowClockwise size={12} />
                Reintentar
              </button>
            </div>
          ) : filteredChats.length > 0 ? (
            filteredChats.map((chat, i) => (
              <ChatItem
                key={chat.id}
                chat={chat}
                index={i}
                isActive={activeChatId === chat.id}
                onClick={() => handleSelectChat(chat)}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <MagnifyingGlass size={28} className="text-muted mb-2" />
              <p className="text-sm text-lo font-medium">Sin resultados para "{search}"</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Columna derecha: Conversación ── */}
      <div className={`
        flex-1 min-w-0 flex flex-col bg-app/20
        ${showConversation || !activeChat ? 'flex' : 'hidden md:flex'}
      `}>
        {activeChat ? (
          <ConversationPanel
            key={activeChat.id}
            chat={activeChat}
            index={activeChatIndex}
            messages={activeChatMessages}
            isLoadingMessages={isLoadingMessages}
            onSendMessage={handleSendMessage}
            onBack={() => setShowConversation(false)}
            isMobile={showConversation}
            onImageClick={setFullscreenImage}
            onResumeBot={() => handleResumeBot(activeChat.customerId)}
          />
        ) : (
          <EmptyState />
        )}
      </div>

      {/* Lightbox Modal para Zoom de Imagen */}
      {fullscreenImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-pointer"
          onClick={() => setFullscreenImage(null)}
        >
          <img
            src={fullscreenImage}
            className="max-w-[90vw] max-h-[90vh] object-contain shadow-2xl rounded-md scale-100 animate-in zoom-in duration-200"
            alt="Zoom"
          />
          <button className="absolute top-4 right-4 text-white text-3xl font-bold">&times;</button>
        </div>
      )}
    </div>
  );
}
