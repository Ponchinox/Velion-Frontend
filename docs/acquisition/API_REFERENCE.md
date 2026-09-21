# Velion Agent — REST API Reference Manual

**Especificación Completa de Endpoints, Autenticación y Modelos de Datos**  
**Versión de la API:** v1  
**Base URL:** `https://api.tuempresa.com/api`  
**Formato de Carga Útil:** `application/json` (o `multipart/form-data` para subida de medios)  

---

## 1. Esquema Global de Autenticación y Cabeceras

### 1.1. Autenticación Estándar (JWT)
La gran mayoría de los endpoints protegidos requieren el envío del token JWT en la cabecera estándar de autorización:
```http
Authorization: Bearer <TU_JWT_TOKEN>
```

### 1.2. Modo Soporte / Impersonación (SuperAdmin)
Cuando un usuario con rol `superadmin` necesita consultar o modificar datos en nombre de un inquilino específico (tenant), envía la cabecera de contexto:
```http
X-Tenant-Id: <UUID_DEL_TENANT>
```
El middleware [`authMiddleware.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/src/middlewares/authMiddleware.js) intercepta la cabecera, valida que el rol emisor sea `superadmin`, y sustituye dinámicamente `tenantId` y `userId` por los del administrador del cliente, permitiendo auditoría y resolución de soporte transparente.

### 1.3. Códigos de Estado HTTP Estándar
* `200 OK`: Petición procesada exitosamente.
* `201 Created`: Recurso creado exitosamente.
* `400 Bad Request`: Parámetros inválidos, campos faltantes o error de validación.
* `401 Unauthorized`: Token ausente, inválido o expirado.
* `403 Forbidden`: Acción denegada por rol insuficiente o por feature flag no incluida en el plan del Tenant (`PLAN_FEATURE_REQUIRED`).
* `404 Not Found`: Recurso no encontrado.
* `429 Too Many Requests`: Límite de tasa (*Rate Limit*) excedido.
* `500 Internal Server Error`: Excepción no controlada en el servidor.

---

## 2. Inventario de Endpoints por Módulo

### 2.1. Diagnóstico y Salud del Servidor
* **`GET /ping`**
  - **Autenticación:** Ninguna (Pública).
  - **Descripción:** Comprobación ultrarrápida de conectividad de red de Nginx hacia el proceso Express.
  - **Respuesta:** Texto plano `pong` (HTTP 200).
* **`GET /api/health`**
  - **Autenticación:** Ninguna (Pública).
  - **Descripción:** Healthcheck del sistema. Ejecuta una consulta real a PostgreSQL (`prisma.tenant.count()`).
  - **Respuesta Exitosa (200):**
    ```json
    {
      "status": "ok",
      "message": "Servidor API Operativo",
      "database": "Conectado",
      "tenants": 12
    }
    ```

---

### 2.2. Autenticación y Registro (`/api/auth`)
* **`POST /api/auth/register`**
  - **Autenticación:** Ninguna (Pública).
  - **Payload:**
    ```json
    {
      "email": "cliente@empresa.com",
      "password": "PasswordSeguro123!",
      "name": "Carlos Mendoza",
      "phone": "+51999888777",
      "companyName": "Comercializadora Mendoza"
    }
    ```
  - **Respuesta (201):**
    ```json
    {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
      "user": { "id": "uuid", "email": "cliente@empresa.com", "role": "client", "tenantId": "uuid" },
      "tenant": { "id": "uuid", "name": "Comercializadora Mendoza", "plan": "Sin Plan" }
    }
    ```
* **`POST /api/auth/login`**
  - **Autenticación:** Ninguna (Limitado a 20 intentos/15 min).
  - **Payload:** `{ "email": "usuario@empresa.com", "password": "Password123!" }`
  - **Respuesta (200):** Devuelve `token`, objeto `user` y objeto `tenant`.

---

### 2.3. Perfil de Usuario (`/api/users`)
* **`GET /api/users/me`** — Devuelve el perfil del usuario autenticado.
* **`PUT /api/users/profile`** — Actualiza nombre y teléfono del usuario.
* **`PUT /api/users/password`** — Cambia la contraseña (requiere `currentPassword` y `newPassword`).

---

### 2.4. Conexiones WhatsApp y Meta Onboarding (`/api/connections`)
* **`GET /api/connections/status`**
  - **Autenticación:** JWT.
  - **Descripción:** Retorna el estado de la conexión WhatsApp del inquilino (`CONNECTED`, `CONNECTING`, `DISCONNECTED`), proveedor (`EVOLUTION` o `META`) e identificadores de instancia.
* **`GET /api/connections/qr`**
  - **Autenticación:** JWT.
  - **Descripción:** Genera o recupera el código QR en base64 para vincular WhatsApp Web vía Evolution API.
* **`POST /api/connections/logout`**
  - **Autenticación:** JWT.
  - **Descripción:** Desvincula la sesión de WhatsApp activa.
* **`GET /api/connections/meta/onboarding/config`**
  - **Autenticación:** JWT.
  - **Descripción:** Retorna la configuración pública para inicializar el SDK de Facebook en el navegador:
    ```json
    {
      "appId": "123456789012345",
      "configId": "987654321098765",
      "graphApiVersion": "v21.0",
      "configured": true
    }
    ```
* **`POST /api/connections/meta/onboarding/callback`**
  - **Autenticación:** JWT.
  - **Payload:** `{ "code": "AQB_facebook_oauth_code", "wabaId": "112233", "phoneNumberId": "445566" }`
  - **Descripción:** Intercambia el código de autorización por un Access Token de larga duración en el servidor, suscribe la WABA a webhooks, cifra el token con AES-256-GCM y establece el estado `CONNECTED`.

---

### 2.5. Webhooks de Ingesta WhatsApp (`/api/whatsapp`)
* **`POST /api/whatsapp/webhook`**
  - **Autenticación:** Cabecera `apikey: <EVOLUTION_API_KEY>`.
  - **Descripción:** Recibe eventos de mensajes entrantes, confirmaciones de entrega y cambios de estado de conexión desde Evolution API.
* **`POST /api/whatsapp/meta/webhook`**
  - **Autenticación:** Verificación criptográfica obligatoria de firma HMAC-SHA256 en cabecera `X-Hub-Signature-256` calculada sobre `req.rawBody` con `META_APP_SECRET`.
  - **Descripción:** Ingesta oficial de eventos de WhatsApp Cloud API de Meta.
* **`GET /api/whatsapp/meta/webhook`**
  - **Autenticación:** Token de verificación (`hub.verify_token`).
  - **Descripción:** Handshake de validación inicial requerido por Meta Dashboard al registrar el endpoint.

---

### 2.6. LiveChat y Mensajería en Tiempo Real (`/api/chats`)
* **`GET /api/chats`**
  - **Autenticación:** JWT.
  - **Parámetros Query:** `search` (opcional), `page` (def 1), `limit` (def 30).
  - **Descripción:** Lista los hilos de chat del tenant ordenados por fecha del último mensaje, incluyendo datos del contacto, contador de no leídos y estado `botPaused`.
* **`GET /api/chats/:chatId/messages`**
  - **Autenticación:** JWT.
  - **Descripción:** Recupera el historial cronológico de mensajes del chat con metadatos multimedia.
* **`POST /api/chats/:chatId/messages`**
  - **Autenticación:** JWT.
  - **Payload:** `{ "text": "Hola, le atiende un asesor humano." }`
  - **Descripción:** Envía un mensaje desde la consola del LiveChat al cliente en WhatsApp a través del gateway configurado y lo emite a los demás operadores por WebSockets.
* **`POST /api/chats/:customerId/resume-bot`**
  - **Autenticación:** JWT.
  - **Descripción:** Despausa la automatización del bot y cancela la intervención humana para el cliente.
* **`GET /api/chats/media-token/:messageId`**
  - **Autenticación:** JWT.
  - **Descripción:** Emite un token de acceso multimedia de corta duración (5 minutos) firmado criptográficamente para acceder a una nota de voz o foto recibida.
* **`GET /api/chats/media/:messageId`**
  - **Autenticación:** Parámetro query `?token=<MEDIA_TOKEN>` o cabecera `Authorization: Bearer <MEDIA_TOKEN>`.
  - **Descripción:** Transmite en streaming el archivo binario del audio o foto privada desde `/var/lib/velion-inbound-media`.

---

### 2.7. Catálogo de Productos y Multimedia (`/api/products`)
* **`GET /api/products`** — Lista los productos del catálogo del tenant.
* **`POST /api/products`**
  - **Autenticación:** JWT.
  - **Guardas:** `productLimitMiddleware` (verifica que el tenant no exceda el límite de productos de su plan comercial).
  - **Content-Type:** `multipart/form-data`.
  - **Campos:** `name`, `price`, `description`, `category`, `tags`, `promotionalPrice`, `promoStartDate`, `promoEndDate`, `image` (archivo portada), `gallery` (múltiples archivos), `video` (archivo mp4).
* **`PUT /api/products/:id`** — Actualiza información o multimedia de un producto existente.
* **`DELETE /api/products/:id`** — Elimina un producto y purga sus archivos multimedia del servidor.

---

### 2.8. Módulo Operacional: Notas y Tareas (`/api/operational-items`)
* **`GET /api/operational-items`**
  - **Autenticación:** JWT.
  - **Parámetros Query:** `type` (`NOTE` o `TASK`), `status` (`PENDING`, `IN_PROGRESS`, `COMPLETED`, `CANCELED`, `ACTIVE`, `ARCHIVED`), `category`, `dueDateLocal`.
  - **Descripción:** Consulta notas internas y tareas operativas generadas por IA o por agentes.
* **`POST /api/operational-items`** — Crea manualmente una nota o tarea operacional.
* **`PATCH /api/operational-items/:id`** — Actualiza campos, títulos o vencimientos.
* **`POST /api/operational-items/:id/complete`** — Marca una tarea como completada registrando fecha y usuario ejecutor.
* **`POST /api/operational-items/:id/archive`** — Archiva una nota interna.

---

### 2.9. Motor de Seguimientos Comerciales (`/api/follow-ups`)
* **`GET /api/follow-ups`**
  - **Autenticación:** JWT.
  - **Parámetros Query:** `status` (`SCHEDULED`, `PROCESSING`, `RECOVERED`, `EXHAUSTED`, `CANCELLED`), `page`, `limit`.
  - **Descripción:** Lista las secuencias de seguimiento activas e históricas.
* **`GET /api/follow-ups/summary`**
  - **Autenticación:** JWT.
  - **Descripción:** Retorna las métricas agregadas del motor de ventas:
    ```json
    {
      "activeCount": 14,
      "recoveredCount": 38,
      "attributedSalesCount": 29,
      "attributedSalesTotal": 4850.00,
      "recoveryRatePercent": 24.5,
      "followUpEnabled": true,
      "timezone": "America/Lima"
    }
    ```
* **`PATCH /api/follow-ups/settings`**
  - **Autenticación:** JWT.
  - **Payload:** `{ "followUpEnabled": true, "followUpDecisionMode": "ENFORCE", "timezone": "America/Lima" }`
* **`PATCH /api/follow-ups/:id/cancel`** — Cancela manualmente una secuencia indicando motivo (`cancelReason`).

---

### 2.10. Campañas Masivas (`/api/campaigns`)
* **`GET /api/campaigns`** — Lista las campañas del tenant (requiere plan con feature `hasCampaigns`).
* **`POST /api/campaigns/launch`**
  - **Autenticación:** JWT (`hasCampaigns`).
  - **Payload:**
    ```json
    {
      "name": "Promoción Fin de Mes",
      "baseMessage": "Hola {{nombre}}, tenemos una oferta especial para ti.",
      "scheduledAt": "2026-09-30T10:00:00Z",
      "recurrenceType": "NONE",
      "delayMin": 5,
      "delayMax": 15,
      "audienceType": "all"
    }
    ```
* **`GET /api/campaigns/:campaignId`** — Retorna el detalle de la campaña y los logs individuales de entrega por teléfono.

---

### 2.11. CRM de Contactos (`/api/contacts`)
* **`GET /api/contacts`** — Lista los contactos registrados con paginación y búsqueda.
* **`POST /api/contacts`** — Crea un nuevo contacto en el CRM.
* **`PUT /api/contacts/:id`** — Actualiza datos, categorías y etiquetas.
* **`PUT /api/contacts/:id/toggle-bot`** — Activa o desactiva la respuesta automática de la IA para un contacto específico.

---

### 2.12. Constructor de Flujos (`/api/flows` y `/api/automation`)
* **`GET /api/flows`** — Lista flujos interactivos guardados.
* **`POST /api/flows`** — Guarda un flujo con su palabra clave disparadora (`triggerKeyword`), nodos y conexiones.
* **`GET /api/automation/flow`** — Recupera el flujo visual principal (requiere feature `hasAutomations`).
* **`POST /api/automation/flow`** — Persiste la estructura gráfica JSON de nodos y aristas de React Flow.

---

### 2.13. Ajustes de Empresa (`/api/settings`)
* **`GET /api/settings`** — Obtiene la configuración comercial del inquilino (horarios, políticas de despacho, cuentas bancarias, rol del bot, custom prompt).
* **`PUT /api/settings`** — Actualiza las directivas comerciales y prompt del bot para el inquilino.

---

### 2.14. Planes Comerciales (`/api/plans`)
* **`GET /api/plans`**
  - **Autenticación:** Pública.
  - **Descripción:** Lista los planes de suscripción activos (`price`, `features`, `connLimit`, `msgLimit`, `dailyTokenBudget`, `maxProducts`).

---

### 2.15. Panel SuperAdmin (`/api/admin`)
*Todos los endpoints de esta sección requieren autenticación JWT con rol `superadmin`.*

* **`GET /api/admin/stats`** — Métricas maestras globales de la plataforma.
* **`GET /api/admin/activity`** — Feed de eventos recientes y alertas operativas.
* **`GET /api/admin/system-health`** — Estado en vivo de conectividad con WhatsApp Gateway, PostgreSQL y Almacenamiento Local.
* **`GET /api/admin/tenants`** — Lista todas las empresas clientes con sus consumos reales de mensajes en el mes.
* **`POST /api/admin/tenants`** — Da de alta una nueva empresa cliente con sus credenciales maestras.
* **`PATCH /api/admin/tenants/:id/status`** — Suspende (`suspended`) o reactiva (`active`) un inquilino.
* **`PATCH /api/admin/tenants/:id/limits`** — Modifica límites de mensajes, conexiones permitidas y plan asignado.
* **`GET /api/admin/backups`** — Lista los respaldos locales generados en el servidor.
* **`POST /api/admin/backups/generate`** — Dispara la generación inmediata de un volcado de base de datos.
* **`GET /api/admin/backups/download/:filename`** — Descarga segura del archivo de respaldo.
* **`GET /api/admin/settings`** — Consulta los parámetros globales de la tabla `SystemConfig`.
* **`PUT /api/admin/settings`** — Guarda parámetros globales (claves API, prompts globales, servidor SMTP).

---

### 2.16. Endpoints Internos de Clúster (`/api/internal`)
* **`GET /api/internal/bot/inventory/:tenantId`**
  - **Autenticación:** Cabecera `x-bot-secret: <BOT_SECRET>`.
  - **Descripción:** Endpoint de alta velocidad para sincronización de inventario del bot conversacional.
