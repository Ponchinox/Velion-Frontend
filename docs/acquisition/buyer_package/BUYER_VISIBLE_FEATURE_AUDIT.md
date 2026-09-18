# AUDITORÍA DE FUNCIONES BUYER-VISIBLE — VELION AGENT
**Documento Técnico Confidencial para Due Diligence y Evaluación de Compradores Estratégicos**
*Versión: 1.0.0 — Buyer Readiness Hardening*

---

## 1. RESUMEN EJECUTIVO DE AUDITORÍA

Esta auditoría técnica clasifica el estado operativo real de todas las funcionalidades visibles para un comprador o usuario final de **Velion Agent**. Cada módulo fue verificado contra la persistencia en PostgreSQL, la ejecución en controladores de backend y los efectos colaterales en tiempo real.

### Criterios de Clasificación:
- **`FULLY_WORKING`**: La acción en UI desencadena la operación completa en backend, persiste en base de datos y aplica su efecto en todo el ciclo de vida del sistema.
- **`WORKING_WITH_LIMITATIONS`**: La función está completamente operativa dentro de la arquitectura actual (single-node VPS), pero presenta restricciones arquitectónicas o dependencias operativas explícitas (ej. QR de Evolution API requiere sesión activa; pagos automáticos por Stripe en roadmap).
- **`UI_ONLY_OR_NOOP`**: La interfaz aparenta realizar una acción pero el backend no la procesa ni persiste. *(0 funciones en esta categoría tras el hardening)*.
- **`BROKEN`**: La acción falla con errores o excepciones no controladas. *(0 funciones en esta categoría)*.
- **`SECURITY_SENSITIVE`**: Operaciones que requieren especial atención por involucrar credenciales, tokens o aislamiento multi-tenant.

---

## 2. MATRIZ DE AUDITORÍA POR MÓDULO

### 1. Panel de Control (Dashboard)
- **FEATURE**: Métricas operativas en tiempo real (Ventas del mes, Chats activos, Contactos totales, Consumo de tokens).
- **UI ACTION**: Carga inicial del panel de control de tenant.
- **BACKEND ACTION**: `GET /api/tenant/dashboard/summary` consulta de forma agregada las tablas `Order`, `Chat`, `Contact` y `TenantAIUsage` en PostgreSQL.
- **REAL EFFECT**: Las tarjetas reflejan datos reales de la base de datos sin datos falsos ni simulaciones.
- **STATUS**: `FULLY_WORKING`
- **RISK**: Ninguno detectado.
- **RECOMMENDATION**: Mantener índices en `Order(tenantId, createdAt)` y `Message(tenantId, createdAt)`.

---

### 2. Inventario y Catálogo de Productos
- **FEATURE**: Gestión de productos (Creación, edición, carga de imágenes/videos, stock, precios, exportación Excel).
- **UI ACTION**: Botones "Nuevo Producto", edición en línea, subida de archivos multimedia, eliminación.
- **BACKEND ACTION**: Endpoints `POST /api/products`, `PUT /api/products/:id`, `DELETE /api/products/:id`, `POST /api/products/upload-image`.
- **REAL EFFECT**: Persiste en `prisma.product`, comprime y almacena imágenes localmente en `/media/tenants/<tenantId>`, e invalida/actualiza el índice compacto de catálogo en `catalogCacheService.js` para consumo inmediato por la IA.
- **STATUS**: `FULLY_WORKING`
- **RISK**: Carga de archivos pesados en conexiones lentas.
- **RECOMMENDATION**: Ya mitigado con límites de tamaño por Multer y validación de tipos MIME.

---

### 3. Gestión de Pedidos y Ventas (Orders)
- **FEATURE**: Registro, seguimiento comercial y actualización de estado de órdenes de compra.
- **UI ACTION**: Cambio de estado de pedido (PENDING -> PAID / CANCELLED), creación manual de orden.
- **BACKEND ACTION**: `PUT /api/internal/orders/:id/status` y `syncCommercialOrder` en `orderCommercialService.js`.
- **REAL EFFECT**: Ejecución en transacción atómica (`prisma.$transaction`), emisión de alertas para asesores humanos en LiveChat y actualización de métricas del dashboard.
- **STATUS**: `FULLY_WORKING`
- **RISK**: Ninguno. Operaciones idempotentes y verificadas mediante test suites dedicadas.
- **RECOMMENDATION**: Conservar la invariante de creación atómica de órdenes.

---

### 4. LiveChat Multicanal y Entrega Humana (Human Handoff)
- **FEATURE**: Bandeja de entrada en tiempo real, mensajes manuales, silenciamiento automático del bot y retorno a atención IA.
- **UI ACTION**: Enviar mensaje manual, botón "Pausar Bot / Handoff", botón "Reanudar Bot".
- **BACKEND ACTION**: `POST /api/whatsapp/send`, `POST /api/chats/:id/pause-bot`, `POST /api/chats/:id/release-handoff`.
- **REAL EFFECT**: El asesor envía mensajes salientes que silencian al bot de inmediato (`Customer.isBotPaused = true` y caché en memoria). El cliente puede chatear con un humano sin interferencia de la IA hasta que el operador libere el chat.
- **STATUS**: `FULLY_WORKING`
- **RISK**: Latencias de red en WebSocket.
- **RECOMMENDATION**: Socket.io implementa reconexión automática y sincronización de mensajes al reconectar.

---

### 5. Notas Operativas
- **FEATURE**: Anotaciones privadas de asesores sobre un cliente o pedido.
- **UI ACTION**: Crear nota en la barra lateral del LiveChat.
- **BACKEND ACTION**: `POST /api/operational-items` con `type: 'NOTE'`.
- **REAL EFFECT**: Persiste en la tabla `OperationalItem` vinculada a `tenantId`, `contactId` y `chatId`. Emite evento por Socket.io a los asesores conectados.
- **STATUS**: `FULLY_WORKING`
- **RISK**: Ninguno.
- **RECOMMENDATION**: Funcionalidad lista para producción.

---

### 6. Tareas de Gestión (Operational Tasks)
- **FEATURE**: Tareas pendientes generadas por la IA (ej. "Coordinar delivery urgente") o creadas manualmente.
- **UI ACTION**: Marcar tarea como completada (TODO -> DONE), crear nueva tarea.
- **BACKEND ACTION**: `PATCH /api/operational-items/:id/status`.
- **REAL EFFECT**: Actualización atómica en base de datos y emisión en tiempo real a los operadores del tenant.
- **STATUS**: `FULLY_WORKING`
- **RISK**: Ninguno.
- **RECOMMENDATION**: Mantener filtros por tenant para aislamiento multi-tenant.

---

### 7. Motor de Follow-Ups Automatizados
- **FEATURE**: Seguimiento automático a clientes con carritos abandonados o cotizaciones abiertas.
- **UI ACTION**: Activar/desactivar seguimientos, configurar horario de silencio y modo de decisión.
- **BACKEND ACTION**: `PUT /api/follow-ups/settings`, reclamación periódica en `followUpWorker.js`.
- **REAL EFFECT**: Worker persistente en PostgreSQL con `FOR UPDATE SKIP LOCKED`. Evalúa horario de atención, opt-outs de clientes, handoff activo y estado del tenant (`t.active = true`). Si el tenant está suspendido, omite la reclamación y no envía mensajes.
- **STATUS**: `FULLY_WORKING`
- **RISK**: Horarios de silencio en zonas horarias inválidas.
- **RECOMMENDATION**: Timezone fail-closed implementado (rechaza IANA inválido sin asumir UTC ciegamente).

---

### 8. Campañas Masivas de WhatsApp
- **FEATURE**: Envío programado y recurrente de mensajes a listas de clientes.
- **UI ACTION**: Crear campaña, seleccionar audiencia, programar fecha/hora o inicio inmediato, cancelar.
- **BACKEND ACTION**: `POST /api/campaigns`, loop en `campaignWorkerV2.js`.
- **REAL EFFECT**: Pre-crea `CampaignLog` con idempotencia, reclama registros uno a uno con `SKIP LOCKED`, calcula recurrencias (`EVERY_15_DAYS`, `MONTHLY`) preservando `anchorDay` sin drift horario, y valida `tenant.active = true` antes de cualquier envío.
- **STATUS**: `FULLY_WORKING`
- **RISK**: Riesgo de bloqueo en WhatsApp si el usuario envía spam no autorizado.
- **RECOMMENDATION**: Incluir advertencias en UI sobre políticas de uso de WhatsApp (ya presentes).

---

### 9. FlowBuilder Visual de Automatizaciones
- **FEATURE**: Diseñador de flujos tipo árbol para respuestas interactivas basadas en palabras clave o menús.
- **UI ACTION**: Drag-and-drop de nodos, guardado del flujo, activación.
- **BACKEND ACTION**: `POST /api/flows`, `flowService.js`.
- **REAL EFFECT**: Los nodos se normalizan defensivamente (coordenadas, tipos y transiciones). Al recibir un mensaje que coincide con el disparador, el backend ejecuta el flujo determinísticamente antes de derivar a la IA generativa.
- **STATUS**: `FULLY_WORKING`
- **RISK**: Diagramas malformados o circulares creados por el usuario.
- **RECOMMENDATION**: Prevención de ciclos y ErrorBoundary en frontend ya implementados.

---

### 10. Conexiones WhatsApp (Evolution API & Meta Cloud API)
- **FEATURE**: Conexión de número de WhatsApp mediante escaneo de código QR o credenciales oficiales de Meta.
- **UI ACTION**: "Conectar con QR", "Conectar con Meta Cloud API".
- **BACKEND ACTION**: `POST /api/whatsapp/connect`, `POST /api/settings/meta-credentials`.
- **REAL EFFECT**: Valida unicidad de número contra fraude (`antiFraudService.js`), verifica y re-aplica el webhook en el proveedor antes de marcar READY, y persiste en `RegisteredWhatsAppNumber`.
- **STATUS**: `WORKING_WITH_LIMITATIONS`
- **RISK**: Dependencia de la estabilidad de sesión de WhatsApp Web en el caso de Evolution API; necesidad de Business Verification en Meta Cloud API.
- **RECOMMENDATION**: Documentar ambas opciones para el comprador técnico como alternativa QR de bajo costo vs. API oficial de grado empresarial.

---

### 11. Ajustes del Negocio y Cerebro de IA
- **FEATURE**: Personalización de datos de la empresa, prompt del bot, horario comercial y switch general de IA.
- **UI ACTION**: Formulario de configuración en "Ajustes", botón "Guardar Cambios".
- **BACKEND ACTION**: `PUT /api/settings` en `settingsRoutes.js`.
- **REAL EFFECT**: Persiste en el registro `Tenant`. El prompt del sistema se actualiza inmediatamente para las siguientes inferencias de Gemini/Groq.
- **STATUS**: `FULLY_WORKING`
- **RISK**: Ninguno.
- **RECOMMENDATION**: Validar longitud máxima del prompt (ya controlado a 4,000 caracteres).

---

### 12. Planes y Facturación (Billing)
- **FEATURE**: Visualización de planes comerciales, precios y canal de activación/pago.
- **UI ACTION**: Seleccionar plan, modal con instrucciones de pago, copia de cuenta/número.
- **BACKEND ACTION**: `GET /api/plans`, `GET /api/plans/billing-config` (reutiliza tabla `SystemConfig`).
- **REAL EFFECT**: Obtiene los datos comerciales centralizados del backend. Si no hay configuración activa, muestra mensaje defensivo *"Contacta al administrador para obtener instrucciones de pago."* sin exponer datos personales ni fallar.
- **STATUS**: `WORKING_WITH_LIMITATIONS`
- **RISK**: Activación manual por soporte (no hay cobro automático recurrente por tarjeta).
- **RECOMMENDATION**: Arquitectura lista para conectar Stripe Checkout o Mercado Pago en roadmap post-adquisición.

---

### 13. Gestión de Usuarios y Equipo
- **FEATURE**: Creación y gestión de cuentas de colaboradores para atención en LiveChat.
- **UI ACTION**: "Agregar Usuario", edición de perfil, cambio de contraseña.
- **BACKEND ACTION**: `POST /api/users`, `PUT /api/users/profile`, `PUT /api/users/change-password`.
- **REAL EFFECT**: Persiste en `prisma.user` con hash seguro bcrypt (cost 10). Aislamiento estricto por `tenantId`.
- **STATUS**: `FULLY_WORKING`
- **RISK**: Ninguno.
- **RECOMMENDATION**: Mantener validación de contraseña mínima de 6 caracteres.

---

### 14. SuperAdmin: Gestión y Suspensión de Empresas
- **FEATURE**: Panel centralizado para auditar tenants, modificar cuotas (`msgLimit`, `connLimit`), suspender y reactivar cuentas.
- **UI ACTION**: Botón "Suspender Empresa" / "Reactivar Empresa", edición de límites.
- **BACKEND ACTION**: `PATCH /api/admin/tenants/:id/status`.
- **REAL EFFECT**: 
  - Login bloqueado con HTTP 403 `TENANT_SUSPENDED`.
  - Sesiones existentes bloqueadas de inmediato en `authMiddleware`.
  - Mensajes entrantes de WhatsApp ignorados de forma segura en el gateway.
  - Mensajes salientes bloqueados en `sendText` y `sendMedia`.
  - Workers de Follow-Up y Campañas omiten automáticamente el tenant.
  - Conexiones de Socket.io rechazadas para el tenant suspendido.
  - SuperAdmin mantiene acceso completo para inspección y reactivación instantánea.
- **STATUS**: `FULLY_WORKING`
- **RISK**: Ninguno tras la implementación completa de Fase 1.
- **RECOMMENDATION**: Mantener la invalidación de caché en memoria en cada cambio de estado.

---

### 15. SuperAdmin: Eliminación Segura de Tenants
- **FEATURE**: Eliminación definitiva de un inquilino de la plataforma.
- **UI ACTION**: Botón "Eliminar Empresa" con modal de confirmación.
- **BACKEND ACTION**: `DELETE /api/admin/tenants/:id`.
- **REAL EFFECT**: 
  - Valida rol `superadmin` y formato canónico del identificador (bloqueo estricto de Path Traversal).
  - Aísla físicamente los archivos multimedia del webroot público `/var/www/velion-media/tenants/<tenantId>` y los traslada a `/home/velion/quarantine/deleted-tenants/<tenantId>/<timestamp>/media`.
  - Ejecuta la eliminación en cascada en PostgreSQL dentro de una transacción.
  - Si el filesystem falla, la eliminación de la base de datos se aborta por seguridad para no dejar estados huérfanos.
- **STATUS**: `FULLY_WORKING`
- **RISK**: Ninguno. Nginx no puede volver a servir archivos de empresas eliminadas.
- **RECOMMENDATION**: Ejecutar scripts de purga periódica sobre el directorio de cuarentena según políticas de retención.

---

### 16. SuperAdmin: Copias de Seguridad (Backups)
- **FEATURE**: Creación manual de volcados de base de datos y descarga de archivos `.sql`.
- **UI ACTION**: Botón "Generar Respaldo Ahora", botón de descarga de backup.
- **BACKEND ACTION**: `POST /api/admin/backups/generate`, `GET /api/admin/backups`, `GET /api/admin/backups/:filename`.
- **REAL EFFECT**: Ejecuta `pg_dump` sobre la base de datos de PostgreSQL y guarda el archivo comprimido en el directorio de backups local.
- **STATUS**: `WORKING_WITH_LIMITATIONS`
- **RISK**: En entornos Windows de desarrollo requiere tener `pg_dump` en el PATH del sistema operativo (en el VPS Linux de producción funciona de forma nativa).
- **RECOMMENDATION**: Sincronización a Google Drive documentada como opcional en `SystemConfig`.

---

### 17. SuperAdmin: Alertas Globales del Sistema
- **FEATURE**: Monitoreo de alertas operativas (caídas de conexión, solicitudes de asesor humano, anomalías).
- **UI ACTION**: Bandeja de alertas con botón "Marcar como resuelta".
- **BACKEND ACTION**: `GET /api/admin/alerts`, `PUT /api/admin/alerts/:id/resolve`.
- **REAL EFFECT**: Actualiza `resolved = true` en `prisma.alert` con registro de timestamp.
- **STATUS**: `FULLY_WORKING`
- **RISK**: Ninguno.
- **RECOMMENDATION**: Funcionalidad completa y lista para auditoría de compradores.

---

### 18. Modo Soporte / Impersonación Segura
- **FEATURE**: Acceso de soporte técnico desde SuperAdmin hacia cualquier tenant para asistir al cliente.
- **UI ACTION**: Botón "Acceder como cliente" en el listado de empresas.
- **BACKEND ACTION**: Envío de cabecera `X-Tenant-Id` firmada con token de rol `superadmin`.
- **REAL EFFECT**: `authMiddleware.js` valida que el emisor sea estrictamente `superadmin`, sustituye el contexto de ejecución por el del administrador del tenant y permite operar sin necesidad de conocer la contraseña del cliente.
- **STATUS**: `FULLY_WORKING`
- **RISK**: `SECURITY_SENSITIVE`. El mecanismo debe impedir que clientes normales inyecten la cabecera `X-Tenant-Id`.
- **RECOMMENDATION**: La cabecera es ignorada salvo que el JWT contenga `role: 'superadmin'`. Testeado y garantizado.

---

### 19. Presupuesto de Tokens y Protección de Cuotas de IA
- **FEATURE**: Control de costos de LLM por tenant (límites diario y mensual de tokens).
- **UI ACTION**: Visualización de consumo en el dashboard del tenant y límites configurables en SuperAdmin.
- **BACKEND ACTION**: `evaluateAiBudgetGuard` en `aiBudgetGuardService.js`.
- **REAL EFFECT**: Computa tokens acumulados en `TenantAIUsage`. Si se supera el límite diario o mensual, el guard bloquea la generación automática y activa notificación de cuota excedida.
- **STATUS**: `FULLY_WORKING`
- **RISK**: Ninguno. Evita facturas inesperadas de proveedores de IA.
- **RECOMMENDATION**: Totalmente operativo.

---

## 3. RESUMEN DE CLASIFICACIÓN DE FUNCIONALIDADES

| Categoría | Total | Funciones |
| :--- | :---: | :--- |
| **`FULLY_WORKING`** | 16 | Dashboard, Catálogo/Productos, Pedidos/Ventas, LiveChat, Notas, Tareas, Follow-Ups, Campañas, FlowBuilder, Ajustes de Negocio, Usuarios, SuperAdmin Empresas, Suspensión Real, Eliminación/Cuarentena, Alertas, Impersonación, Presupuesto IA |
| **`WORKING_WITH_LIMITATIONS`** | 3 | Conexiones WhatsApp (Evolution QR / Meta Cloud), Facturación (manual con config centralizada), Backups (nativo en Linux VPS) |
| **`UI_ONLY_OR_NOOP`** | 0 | Ninguna. Todas las acciones de UI están conectadas y persisten en backend. |
| **`BROKEN`** | 0 | Ninguna función con errores o crash. |
| **`SECURITY_SENSITIVE`** | 3 | Suspensión Real, Eliminación con Cuarentena, Impersonación de SuperAdmin. |

---
*Fin del documento de auditoría técnica.*
