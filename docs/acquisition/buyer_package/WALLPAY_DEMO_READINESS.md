# Checklist de Preparación de Demo Privada — Wallpay
**Documento:** Evaluación de Seguridad y Aislamiento para la Entrega de Demo a Comprador  
**Versión:** 2.0 (Buyer Readiness Hardening)  
**Fecha:** Septiembre 2026  
**Empresa de Evaluación:** Wallpay / Potenciales Compradores Estratégicos  
**Tenant Designado:** `Velion Demo`

---

## 1. Matriz de Validación de Criterios (Checklist)

| Criterio de Seguridad y Operación | Estado | Fundamento Técnico y Evidencia en Repositorio |
| :--- | :---: | :--- |
| **REGISTRATION_BYPASSED** | **PASS** | El tenant `Velion Demo` se aprovisiona directamente en base de datos con `role = 'client'` y `hasPlan = true` (`planId` asociado a un plan activo). En `ProtectedRoute.jsx`, al contar con plan activo el sistema omite `/select-plan` y redirige directamente a `/dashboard`. Los evaluadores nunca pasan por registro ni selección obligatoria de plan. |
| **PAYMENT_PERSONAL_DATA_REMOVED** | **PASS** | Hardcoded numbers eliminados del 100% del código fuente (`PlanSelectionPage.jsx` y `BillingPage.jsx`). El sistema ahora consulta dinámicamente `/api/plans/billing-config` (reutilizando `SystemConfig`). Para el tenant demo, muestra estrictamente la pantalla de evaluación. Para tenants normales sin config comercial, aplica fallback seguro: *"Contacta al administrador para obtener instrucciones de pago."* |
| **TENANT_ISOLATION** | **PASS** | Todos los modelos relacionales de PostgreSQL (`Chat`, `Message`, `Product`, `Order`, `FollowUpSequence`, `Contact`, `Flow`, `OperationalItem`) están aislados mediante la clave foránea `tenantId`. Los controladores verifican `req.user.tenantId` inyectado desde el token JWT. Las salas de Socket.io (`tenant:${tenantId}`) se suscriben estrictamente al tenant autenticado. Cero filtración cross-tenant. |
| **SUPERADMIN_NOT_EXPOSED** | **PASS** | El usuario entregado al comprador tiene estrictamente rol `role: 'client'`. `ProtectedRoute.jsx` bloquea todas las rutas `/admin-*` (`allowedRoles={['superadmin']}`) y el backend aplica `adminMiddleware.js` que rechaza con `HTTP 403 Forbidden` cualquier solicitud administrativa. |
| **REAL_CUSTOMER_DATA_ABSENT** | **PASS** | `Velion Demo` es un tenant independiente con datos 100% sintéticos. No contiene ningún contacto, mensaje, pedido ni nota de clientes reales. El catálogo contiene exclusivamente productos sintéticos demostrativos con imágenes de alta calidad. |
| **WHATSAPP_DEMO_ISOLATED** | **PASS** | Guard server-side inquebrantable (`demoGuardService.js`) en el punto más bajo del gateway (`whatsappGateway.js` en `sendText` y `sendMedia`). Si el tenant es demo, solo se permite enviar a números configurados en `DEMO_ALLOWED_WHATSAPP_NUMBERS`. Destinatarios no autorizados se bloquean inmediatamente fail-closed, protegiendo todas las rutas: IA, LiveChat manual, Media, Follow-ups, Campañas y Flows. |
| **DESTRUCTIVE_ACTIONS_BLOCKED** | **PASS** | Un usuario con rol `client` no tiene acceso a endpoints de eliminación de base de datos, respaldos globales, eliminación de otros inquilinos ni cambio de configuraciones de servidor. |
| **SUSPENSION_ENFORCEMENT** | **PASS** | **End-to-End Real Enforcement:** Si `tenant.active === false`, se bloquea el login (403 `TENANT_SUSPENDED`), se bloquean sesiones abiertas en `authMiddleware`, se descartan mensajes entrantes de WhatsApp, se bloquea el gateway saliente, se rechazan conexiones Socket.io y los workers en segundo plano omiten el tenant. SuperAdmin mantiene control total para reactivación inmediata. |
| **MEDIA_QUARANTINE_ON_DELETE** | **PASS** | Al eliminar un tenant desde SuperAdmin, los archivos multimedia físicos en `/var/www/velion-media/tenants/<tenantId>` se trasladan a cuarentena privada fuera del webroot de Nginx (`/home/velion/quarantine/deleted-tenants/<tenantId>/<timestamp>/media`) antes del borrado en cascada en base de datos. Protegido contra Path Traversal. |
| **ACCESS_REVOCABLE** | **PASS** | La cuenta demo puede ser suspendida o su contraseña cambiada en cualquier momento desde el panel SuperAdmin o vía base de datos, revocando el acceso tras el periodo acordado de evaluación. |

---

## 2. Auditoría Específica de Suspensión de Cuentas (Post-Hardening)

| Parámetro Auditado | Resultado |
| :--- | :--- |
| **SUSPENSION_ENFORCEMENT** | **PASS (100% Operativo)** |
| **Endpoint Invocado** | `PATCH /api/admin/tenants/:id/status` (enrutado en `backend_api/src/routes/adminRoutes.js`). |
| **Controlador Responsable** | `updateTenantStatus` en `backend_api/src/controllers/adminController.js`. |
| **Campo Modificado en DB** | `prisma.tenant.update({ where: { id }, data: { active: false } })` en PostgreSQL tabla `Tenant`. |
| **Invalidación de Caché** | `invalidateTenantActiveCache(id)` en `tenantGuardService.js` para efecto inmediato en milisegundos. |
| **Enforcement en Login** | `authController.js` verifica `user.tenant.active === false` y responde HTTP 403 `TENANT_SUSPENDED`. |
| **Enforcement en Sesiones** | `authMiddleware.js` comprueba `isTenantActive` y bloquea llamadas subsiguientes con HTTP 403. |
| **Enforcement en WhatsApp** | Webhook entrante descartado en `whatsappController.js:2503`; gateway saliente bloqueado en `whatsappGateway.js:120,240`. |
| **Enforcement en Workers** | `followUpWorker.js` y `campaignWorkerV2.js` excluyen tenants con `t.active = false` en sus queries atómicas. |
| **Enforcement en Socket.io** | Handshake de conexión de Socket.io rechaza clientes de tenants suspendidos (`TENANT_SUSPENDED`). |
| **Acceso de SuperAdmin** | Preservado íntegramente. SuperAdmin puede ver, auditar e impersonar tenants suspendidos y reactivarlos con 1 clic. |

---

## 3. Plan de Aislamiento de Datos Sintéticos para Velion Demo

Para garantizar que la demo sea atractiva, profesional y 100% limpia de datos personales o comerciales reales:

### 3.1. Identidad Corporativa Ficticia
- **Empresa:** Velion Demo
- **Rubro:** Tecnología y Gadgets Electrónicos
- **Giro:** Comercio B2B / B2C en WhatsApp
- **Voz de Marca:** Asistente comercial consultivo, ágil y educado

### 3.2. Catálogo Sintético
1. **Smartwatch X1**
   - *Precio:* S/ 189.00
   - *Descripción:* Reloj inteligente con monitor cardíaco, resistencia al agua IP68 y pantalla AMOLED de 1.4 pulgadas.
   - *Multimedia:* Fotografía de producto sintética de alta resolución creada específicamente para la demo.
2. **Audífonos AirBeat Pro**
   - *Precio:* S/ 129.00
   - *Descripción:* Audífonos inalámbricos con cancelación activa de ruido (ANC), estuche de carga rápida USB-C y batería de 28 horas.
3. **Parlante SoundMini**
   - *Precio:* S/ 99.00
   - *Descripción:* Parlante portátil Bluetooth 5.3 con sonido 360°, batería para 12 horas continuas y micrófono integrado.

### 3.3. Activos Sintéticos de LiveChat y Operación
- **1 Contacto de prueba pre-cargado:** "Cliente Demo (Evaluador)"
- **1 Conversación de ejemplo:** Pregunta sobre garantía y colores disponibles del Smartwatch X1 con respuesta de la IA.
- **1 Orden de prueba:** Pedido en estado `PENDING` por 1 unidad de Audífonos AirBeat Pro (S/ 129.00).
- **1 Cadencia de seguimiento:** Follow-up activo respetando el horario comercial ficticio (09:00 - 19:00).
- **1 Tarea operativa:** "Coordinar entrega a domicilio — Cliente Demo".

---

## 4. Conclusión del Dictamen de Preparación

La demo privada para Wallpay y potenciales compradores es **100% viable, segura y endurecida**. El producto cuenta con aislamiento estricto, fail-closed en WhatsApp outbound, cero datos personales quemados en código fuente y enforcement real de suspensión multi-tenant.
