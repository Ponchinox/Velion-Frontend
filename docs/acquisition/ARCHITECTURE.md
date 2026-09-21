# Velion Agent — Technical Architecture Specification

**Documento de Arquitectura de Sistemas y Flujo de Datos**  
**Versión de Especificación:** 1.0.0  
**Fecha:** Septiembre 2026  

---

## 1. Visión General de la Arquitectura

Velion Agent utiliza un patrón arquitectónico de **Microservicios Modulares y Monolito Central Desacoplado**, diseñado para alta disponibilidad en comunicaciones en tiempo real, baja latencia en procesamiento de lenguaje natural y aislamiento estricto de datos en entornos B2B multitenant.

```mermaid
flowchart TB
    subgraph WhatsAppNetwork["Red de WhatsApp"]
        ClientUser["Usuario Final en WhatsApp"]
    end

    subgraph PerímetroVPS["Perímetro de Red (Linux VPS)"]
        Nginx["Nginx Reverse Proxy (Puertos 80 / 443)\nSSL Let's Encrypt / Gzip"]
        PublicMedia["/var/www/velion-media\n(Fotos de Catálogo - Público)"]
        PrivateMedia["/var/lib/velion-inbound-media\n(Audios y Fotos Recibidas - Privado)"]
    end

    subgraph FrontendModule["Frontend SPA (React 19 + Vite 8)"]
        BrowserUI["Interfaz Web SPA (Tailwind CSS)\nReact Router v7 / Contexts"]
        LiveChatUI["LiveChat en Tiempo Real"]
        FlowBuilderUI["FlowBuilder (React Flow)"]
        AdminUI["Panel SuperAdmin & Tenants"]
    end

    subgraph BackendAPI["Backend API & Motor de Eventos (Node.js 20 / PM2)"]
        ExpressApp["Servidor Express REST (/api/*)"]
        SocketServer["Servidor Socket.IO (/socket.io/*)\nAislamiento de Salas por Tenant"]
        RateLimiter["Rate Limiters (Auth: 20/15m, General: 300/15m)"]
        AuthSecurity["JWT Auth + Meta HMAC-SHA256 Guard"]

        subgraph CoreServices["Servicios Especializados de Negocio"]
            GatewayHub["whatsappGateway.js\n(Resolución de Proveedor BD)"]
            AIEngine["aiService.js\n(Cascada de Resiliencia Gemini / Groq)"]
            AuthorityEngine["enforceBusinessAuthority & enforceMediaAuthority\n(Modelos Anti-Alucinación)"]
            MediaOrchestrator["productMediaOrchestrator.js\n(Detección Ambigüedad y Rotación de Fotos)"]
            OrderCommercial["orderCommercialService.js\n(Cálculo Canónico de Precios e Idempotencia)"]
            OperationalService["operationalItemService.js\n(Notas y Tareas con Zona Horaria)"]
        end

        subgraph BackgroundWorkers["Procesos Asíncronos / Workers"]
            FollowUpWorker["followUpWorker.js\n(Cadencias de Ventas e Invariantes)"]
            CampaignWorker["campaignWorkerV2.js\n(Campañas Masivas y Delays Anti-Ban)"]
            BackupWorker["backupScheduler.js\n(Respaldos JSON/Dump a Google Drive)"]
        end
    end

    subgraph DataLayer["Capa de Persistencia"]
        PostgreSQL[(PostgreSQL 15 Relacional\nPrisma ORM 5.22)]
    end

    subgraph WhatsAppProviders["Pasarelas de Conectividad WhatsApp"]
        EvoContainer["Evolution API Container\n(Baileys 7.0.0-rc13 Parcheado)"]
        MetaCloudAPI["Meta WhatsApp Cloud API v21.0\n(Graph API Oficial)"]
    end

    subgraph AIProviders["Proveedores de IA Externa"]
        GeminiPool["Google Gemini 3.5 Flash Lite / Flash\n(Pool Multi-Key Round-Robin)"]
        GroqAPI["Groq Cloud API\n(Llama 3.3 70B Versatile)"]
    end

    ClientUser <-->|Mensajes QR| EvoContainer
    ClientUser <-->|Mensajes Oficiales| MetaCloudAPI

    EvoContainer -->|HTTP Webhooks| ExpressApp
    MetaCloudAPI -->|HMAC-SHA256 Webhooks| ExpressApp

    BrowserUI <-->|HTTPS REST| Nginx
    LiveChatUI <-->|WebSockets| Nginx
    Nginx -->|Proxy HTTP /api/| ExpressApp
    Nginx -->|Upgrade /socket.io/| SocketServer
    Nginx -->|/media/| PublicMedia

    ExpressApp --> RateLimiter --> AuthSecurity --> CoreServices
    CoreServices <--> PostgreSQL
    SocketServer <--> CoreServices

    CoreServices --> AIEngine
    AIEngine --> GeminiPool
    GeminiPool -.->|Fallback de Cuota / Timeout| GroqAPI

    CoreServices --> GatewayHub
    GatewayHub --> EvoContainer
    GatewayHub --> MetaCloudAPI

    CoreServices --> PrivateMedia
    CoreServices --> PublicMedia

    FollowUpWorker <--> PostgreSQL
    FollowUpWorker --> AIEngine
    FollowUpWorker --> GatewayHub

    CampaignWorker <--> PostgreSQL
    CampaignWorker --> GatewayHub

    BackupWorker <--> PostgreSQL
```

---

## 2. Componentes Técnicos Detallados

### 2.1. Frontend SPA
* **Stack:** React 19.2.7, Vite 8.1.1, Tailwind CSS 3.4.19, React Router DOM 7.18.1.
* **Componentes Visuales:**
  * Iconografía: Phosphor Icons (`@phosphor-icons/react`) y Lucide React (`lucide-react`).
  * Tipografía: Plus Jakarta Sans (`@fontsource/plus-jakarta-sans`).
  * Canvas de Automatizaciones: React Flow 11.11.4 para diseño de flujos mediante nodos y aristas interactivos.
* **Manejo de Estado y Contextos:**
  * `AuthContext`: Administra token JWT, usuario autenticado, impersonación de inquilino (`impersonatedTenantId`) y redirección según rol (`client` vs `superadmin`).
  * `UnsavedChangesContext`: Previene pérdida de datos en formularios complejos de configuración y catálogo al navegar accidentalmente.
* **Servicio API Centralizado ([`src/services/api.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/src/services/api.js)):** Cliente fetch nativo con inyección automática de cabeceras `Authorization: Bearer <token>`, `X-Tenant-Id` e interceptores globales para errores 401.

### 2.2. Backend API & Realtime
* **Runtime:** Node.js 20 LTS (modo nativo ES Modules `"type": "module"`).
* **Framework Web:** Express 4.19.2.
* **Seguridad y Perímetro:**
  * `helmet`: Configuración de cabeceras HTTP seguras.
  * `cors`: Lista blanca estricta configurable por variable de entorno `FRONTEND_URL`.
  * `express-rate-limit`: Limitadores diferenciados (20 peticiones/15 min para endpoints de login; 300 peticiones/15 min para API general, excluyendo webhooks de WhatsApp para evitar pérdidas de mensajes).
* **WebSockets Bidireccionales (Socket.IO 4.8.3):**
  * Handshake autenticado estrictamente mediante JWT en `server.js`.
  * Aislamiento por inquilino: `socket.join('tenant:' + socket.tenantId)`. Los operadores de una empresa jamás reciben eventos ni mensajes de otra empresa.
  * Soporte de impersonación para usuarios con rol `superadmin` mediante validación en el apretón de manos (*handshake*).

### 2.3. Capa de Base de Datos y Persistencia
* **Motor:** PostgreSQL 15.
* **ORM:** Prisma Client 5.22.0.
* **Modelos Principales ([`schema.prisma`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/prisma/schema.prisma)):**
  1. `Tenant`: Datos de la empresa, logo, configuración comercial (prompts, horario de atención, cuentas bancarias, políticas de entrega), modo de mensajería múltiple y límites de tokens de IA.
  2. `User`: Cuentas con roles (`superadmin`, `client`), contraseña hasheada en bcrypt y vinculación a Tenant.
  3. `Contact`: Libreta de direcciones de WhatsApp, categorías de prospección, etiquetas y conmutador `botPaused`.
  4. `Chat`: Hilos de conversación vinculados a contactos, con estados de atención y control de pausas.
  5. `Message`: Mensajes entrantes y salientes, metadatos multimedia (`mediaType`, `mediaPath`, `mediaSize`, `mediaGroupId` para álbumes) y estado de entrega.
  6. `Product`: Catálogo comercial con precio base, precio promocional con fechas de vigencia, stock, imágenes múltiples y videos demostrativos.
  7. `Order` y `OrderItem`: Registro transaccional de pedidos con cálculo canónico de precios, dirección de despacho y estados de pago.
  8. `FollowUpSequence` y `FollowUpAttempt`: Máquina de estados para cadencias de ventas, registro de intentos, hora ancla y tokens de idempotencia.
  9. `OperationalItem`: Notas internas y tareas programadas generadas por IA o usuarios, con cálculo de vencimiento en hora local del cliente.
  10. `TenantAIUsage`: Telemetría diaria de tokens consumidos (input, output, total, tool calls, reintentos).
  11. `Campaign` y `CampaignLog`: Campañas masivas, destinatarios, recurrencia y estados de despacho.
  12. `RegisteredWhatsAppNumber`: Conexiones activas de WhatsApp, identificando si operan por `EVOLUTION` o `META`.
  13. `AutomationFlow` y `Flow`: Almacenamiento JSON de nodos y aristas de automatizaciones de React Flow.
  14. `Plan`: Definición de niveles de suscripción B2B con banderas de características (`hasCampaigns`, `hasAutomations`, `hasAdvancedMarketing`, presupuestos de tokens y límites de productos).
  15. `SystemConfig`: Parámetros globales del sistema llave-valor (credenciales globales, prompts maestros).
  16. `Alert`: Notificaciones y anomalías operativas para el SuperAdmin.

### 2.4. Motor de Inteligencia Artificial y Resiliencia
* **SDK Primario:** `@google/genai` v2.19.0 (SDK oficial actual de Google).
* **Modelos:**
  * Primario: `gemini-3.5-flash-lite` (latencia ultrabaja).
  * Secundario: `gemini-3.5-flash` (mayor capacidad de razonamiento).
  * Parámetros optimizados: `thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL }`, tokens máximos de salida acotados a 800 para evitar dispersión conversacional.
* **Pool Multi-Key de Gemini:**
  * Rotación balanceada (*round-robin*) entre múltiples claves API de Google.
  * Aislamiento de estado por clave: detección semántica de errores (`RATE_LIMIT`, `AUTH`, `CONTEXT_TOO_LARGE`) y aplicación de tiempos de enfriamiento (*cooldowns*) por clave.
* **Fallback Nivel 3 (Groq):**
  * Si los modelos de Gemini fallan tras reintentos y rotación de claves, el sistema conmuta instantáneamente a Groq mediante el SDK de OpenAI apuntando a `llama-3.3-70b-versatile` o `qwen/qwen3.6-27b`, traduciendo las declaraciones de herramientas (*tool adapters*) automáticamente.

### 2.5. Modelos de Autoridad Deterministas (*Anti-Hallucination*)
El archivo [`whatsappController.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/src/controllers/whatsappController.js) contiene filtros de post-procesamiento deterministas que impiden que el LLM alucine:
* `enforceMediaAuthority`: Si la IA afirma en su texto "aquí te envío la foto" pero no existe un recurso multimedia canónico resuelto en el turno, la frase es reemplazada por una indicación verídica y neutral.
* `enforceBusinessAuthority`:
  * Si el tenant no tiene cuentas bancarias configuradas, se prohíbe ofrecer datos de pago o prometer números de cuenta.
  * Si el tenant no tiene políticas de despacho configuradas, se eliminan afirmaciones de cobertura a ciudades específicas.
  * Sanitización de tiempos: Se eliminan promesas de atención inmediata o tiempos exactos ("un asesor te responderá en 5 minutos").
  * Turno exploratorio: Si el usuario solo está consultando opciones ("¿qué modelos tienes?"), se impide forzar el avance al checkout o solicitar dirección de entrega prematuramente.

### 2.6. Conectividad WhatsApp Híbrida (Dual Gateway)
El servicio [`whatsappGateway.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/src/services/whatsappGateway.js) resuelve en tiempo de ejecución cómo enviar cada mensaje:
1. **Ruta Evolution API (No Oficial / QR):**
   * Se comunica vía HTTP con el contenedor Docker de Evolution API (`http://localhost:8080`).
   * Nombre de instancia parametrizado por tenant: `bot_prod_${tenantId}`.
   * Utiliza la librería Baileys con parche causal para eliminar el timeout de 60 segundos en la descarga de avatares.
2. **Ruta Meta Cloud API (Oficial):**
   * Se comunica con los servidores de Meta mediante Graph API v21.0.
   * `metaAccessToken` se almacena cifrado en base de datos con AES-256-GCM.
   * Descarga multimedia entrante mediante token efímero y envío de mensajes salientes firmado por WABA ID y Phone Number ID.

---

## 3. Flujo de Vida Completo de un Mensaje (End-to-End)

El siguiente diagrama detalla la secuencia exacta que sigue un mensaje desde que es emitido por un usuario en WhatsApp hasta la respuesta automatizada de la plataforma:

```mermaid
sequenceDiagram
    autonumber
    actor Usuario as Cliente (WhatsApp)
    participant Gateway as Pasarela (Meta / Evolution)
    participant Nginx as Nginx Reverse Proxy
    participant Server as Backend (whatsappController)
    participant Security as Auth & HMAC Guard
    participant DB as PostgreSQL (Prisma)
    participant AI as aiService (Gemini / Groq)
    participant Authority as Modelos de Autoridad
    participant Sockets as Socket.IO (LiveChat)

    Usuario->>Gateway: Envía mensaje de texto o audio
    Gateway->>Nginx: Dispara Webhook HTTP POST (/api/whatsapp/*)
    Nginx->>Server: Reenvía petición con rawBody preservado

    rect rgb(240, 248, 255)
        Note over Server,Security: 1. Verificación Criptográfica
        Server->>Security: Verifica firma HMAC-SHA256 (Meta) o API Key (Evolution)
        alt Firma Inválida
            Security-->>Server: Error 401 Unauthorized
            Server-->>Gateway: Rechazo inmediato (Fail-closed)
        else Firma Válida
            Security-->>Server: Payload seguro
        end
    end

    rect rgb(255, 250, 240)
        Note over Server,DB: 2. Ingesta, Deduplicación y Contexto
        Server->>DB: Busca o crea Contact y Customer (aislado por tenantId)
        Server->>DB: Guarda Message entrante (rol 'user')
        Server->>Sockets: Emite 'new_whatsapp_message' a la sala 'tenant:{tenantId}'
        Server->>DB: Verifica bandera 'botPaused' y ventana de 'humanHandoff'
    end

    alt Bot Pausado / En Atención Humana
        Server-->>Gateway: HTTP 200 OK (Silencio, no procesa IA)
    else Bot Activo
        rect rgb(245, 255, 245)
            Note over Server,AI: 3. Razonamiento e Invocación de IA
            Server->>DB: Carga catálogo de productos compacto, prompt del tenant y contexto comercial
            Server->>AI: Solicita generación con Function Calling (Tools: media, handoff, notas, tareas)
            alt Gemini Primario OK
                AI-->>Server: Texto generado + Tool Call opcional
            else Gemini Saturado / Timeout
                AI->>AI: Conmuta a Gemini Secundario o Groq (Llama 3.3)
                AI-->>Server: Respuesta de contingencia
            end
        end

        rect rgb(255, 245, 245)
            Note over Server,Authority: 4. Ejecución de Tools y Filtro de Autoridad
            opt Si la IA invocó 'send_product_media'
                Server->>DB: Resuelve imagen canónica del producto y actualiza rotación
            end
            opt Si la IA invocó 'request_human_handoff'
                Server->>DB: Activa pausa de 30 min y alerta a operadores humanos
            end
            opt Si la IA invocó 'create_operational_task'
                Server->>DB: Registra tarea con dueDateLocal según zona horaria del cliente
            end
            Server->>Authority: Aplica 'enforceBusinessAuthority' y 'enforceMediaAuthority'
            Authority-->>Server: Texto final verificado (sin alucinaciones)
        end

        rect rgb(240, 255, 255)
            Note over Server,Gateway: 5. Despacho Saliente y Sincronización
            Server->>DB: Guarda Message saliente (rol 'agent')
            Server->>Gateway: gatewaySendText / gatewaySendMedia (vía Meta o Evolution)
            Gateway->>Usuario: Entrega mensaje en el WhatsApp del cliente
            Server->>Sockets: Emite mensaje saliente a la sala de LiveChat
            Server-->>Gateway: HTTP 200 OK
        end
    end
```

---

## 4. Background Workers (Trabajadores en Segundo Plano)

El backend incorpora 3 trabajadores autónomos que se inicializan automáticamente al levantar el servidor con PM2 ([`serverConfig.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/src/config/serverConfig.js)):

1. **Follow-Up Cadence Worker ([`followUpWorker.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/src/services/followUpWorker.js)):**
   - Ejecuta un bucle periódico cada 60 segundos buscando secuencias con estado `SCHEDULED` y `nextRunAt <= now`.
   - Utiliza bloqueo atómico a nivel de base de datos (`claimedAt`) para evitar despachos duplicados en caso de reinicios.
   - En modo `ENFORCE`, consulta a [`followUpDecisionService.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/src/services/followUpDecisionService.js) (interpretación semántica con Gemini) para validar si corresponde reanudar la venta, aplazarla (*defer*) o transferirla a un humano.
   - Respeta estrictamente los horarios silenciosos (*quiet hours*: no enviar mensajes de madrugada según la zona horaria del tenant).
2. **Campaign Worker V2 ([`campaignWorkerV2.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/src/services/campaignWorkerV2.js)):**
   - Procesa campañas de difusión masiva programadas.
   - Introduce un retardo estocástico aleatorio (`delayMin` a `delayMax`, típicamente de 5 a 15 segundos) entre cada contacto para prevenir la activación de algoritmos de detección de spam de WhatsApp.
   - Maneja la recurrencia automática quincenal y mensual calculando la fecha del siguiente ciclo (`nextRunAt`).
3. **Backup Scheduler ([`backupScheduler.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/src/services/backupScheduler.js)):**
   - Orquesta respaldos de PostgreSQL según la frecuencia configurada por el SuperAdmin (`daily`, `weekly`, `monthly`).
   - Genera volcados en formato JSON y DUMP y, si está habilitado, los transmite a Google Drive mediante una cuenta de servicio autorizada.
