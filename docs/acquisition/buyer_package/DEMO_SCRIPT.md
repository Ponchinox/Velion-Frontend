# Velion Agent — Comprehensive Buyer Demonstration Script (15–20 Minutes)

**Guión Técnico y Comercial para Presentación a Equipo Comprador / Due Diligence**  
**Duración Estimada:** 15 a 20 minutos  
**Ambiente:** Entorno de Demostración Local o Staging con Datos Sintéticos (**NUNCA Producción**).

---

## 🎯 Resumen del Recorrido (13 Estaciones)

| Minuto | Estación / Módulo | Rol | Enfoque de Demostración | Datos Requeridos |
| :---: | :--- | :---: | :--- | :--- |
| **0:00 - 1:30** | **1. Login & RBAC** | Ambos | Control de acceso por roles, JWT y redirección contextual. | 1 SuperAdmin + 1 Merchant demo |
| **1:30 - 3:00** | **2. Dashboard Empresarial** | Merchant | KPIs de ventas, mensajes, embudo de conversión y actividad. | Métricas sintéticas pre-sembradas |
| **3:00 - 5:00** | **3. Mensajes (LiveChat & IA)** | Merchant | WebSockets en tiempo real, streaming, pausa de bot y handoff. | Conversaciones demo + WhatsApp sandbox |
| **5:00 - 6:00** | **4. Contactos (CRM)** | Merchant | Perfil 360°, etiquetas de segmentación y preferencias. | 5-10 contactos sintéticos |
| **6:00 - 7:30** | **5. Productos & Inventario** | Merchant | Precios canónicos, stock, galerías de fotos y videos. | 4-6 productos demo con fotos |
| **7:30 - 9:00** | **6. Pedidos (Orders)** | Merchant | Tabla de pedidos, filtros, modal de items y link de checkout. | 3-5 órdenes (Velion y Shopify) |
| **9:00 - 10:30**| **7. Hub de Integraciones** | Merchant | Vista consolidada: Shopify, Meta WhatsApp Cloud y Evolution API.| Estado de integraciones mock |
| **10:30 - 12:00**| **8. Shopify Commerce** | Merchant | Flujo OAuth, sincronización de catálogo, modos comercial/precio.| Tienda dev conectada o fixture |
| **12:00 - 13:30**| **9. Campañas Masivas (V2)** | Merchant | Programador de difusiones, rate limiting y logs de auditoría. | 1 campaña programada |
| **13:30 - 15:00**| **10. Seguimientos Post-Venta**| Merchant | Motor automatizado de reactivación y timeline de cadencia. | 2 secuencias en progreso |
| **15:00 - 16:30**| **11. Flow Builder** | Merchant | Canvas visual con React Flow, nodos interactivos y disparadores. | 1 flujo preconfigurado |
| **16:30 - 17:30**| **12. Configuración Tenant** | Merchant | Perfil comercial, horarios de atención, prompt y políticas. | Datos empresariales demo |
| **17:30 - 20:00**| **13. SuperAdmin Global** | SuperAdmin | Gestión multi-empresa, suspensión, planes, secretos sanitizados.| 2-3 empresas demo |

---

## 📋 Detalle Paso a Paso de la Demostración

### 1. Login & RBAC (0:00 – 1:30)
* **Pantalla:** `/login`
* **Acción:** Iniciar sesión con la cuenta de comercio demo (`demo@velion.pe`).
* **Puntos a Destacar:**
  - Autenticación JWT con rotación segura de tokens en `localStorage` (`sa_token`).
  - Redireccionamiento contextual: el rol `client` aterriza directamente en el Dashboard del inquilino, sin exponer rutas de administración global.

### 2. Dashboard Empresarial (1:30 – 3:00)
* **Pantalla:** `/dashboard`
* **Acción:** Recorrer las métricas de resumen: mensajes totales procesados, pedidos confirmados, tasa de atención automática de la IA y desglose de conversaciones activas.
* **Puntos a Destacar:**
  - Aislamiento multi-tenant total: cada consulta a la API está encapsulada bajo `req.user.tenantId`.
  - Métricas calculadas en tiempo real directamente sobre PostgreSQL.

### 3. Mensajes: LiveChat & IA (3:00 – 5:00)
* **Pantalla:** `/mensajes`
* **Acción:**
  1. Mostrar el hilo de mensajes interactivo con un cliente demo.
  2. Demostrar el botón **"Pausar Bot / Transferir a Asesor"** (`Human Handoff`).
  3. Enviar un mensaje manual desde la consola y observar la reactividad vía WebSockets (Socket.IO).
* **Puntos a Destacar:**
  - Modelo de autoridad anti-alucinación: la IA solo comunica datos factuales del negocio.
  - Streaming seguro de audios privados mediante tokens HMAC efímeros (`MEDIA_TOKEN_SECRET`).

### 4. Contactos (5:00 – 6:00)
* **Pantalla:** `/contactos`
* **Acción:** Abrir un contacto, mostrar sus notas de compra, historial de chat y etiquetas de segmentación (`VIP`, `Mayorista`, `Pendiente de Pago`).
* **Puntos a Destacar:**
  - CRM unificado integrado nativamente con WhatsApp.

### 5. Productos & Inventario (6:00 – 7:30)
* **Pantalla:** `/productos`
* **Acción:** Mostrar la lista de productos, variantes y galería multimedia (fotos y videos).
* **Puntos a Destacar:**
  - Cálculo de precios canónico (el LLM no inventa precios ni descuentos).
  - Almacenamiento segregado en `/var/www/velion-media` con prevención estricta de Path Traversal.

### 6. Pedidos (7:30 – 9:00)
* **Pantalla:** `/pedidos`
* **Acción:**
  1. Explorar la tabla paginada con filtros por estado (`Pendiente`, `Confirmado`) y origen (`Velion` vs `Shopify`).
  2. Abrir el modal de detalle de un pedido: mostrar desglose de items, variantes, subtotal y total.
  3. Mostrar el botón **"Ver checkout Shopify"** para pedidos sincronizados con link activo.
* **Puntos a Destacar:**
  - Aislamiento estricto (404 inmediato si un tenant consulta un pedido foráneo).
  - Manejo elegante de checkouts externos sin botones rotos ni fugas de stack traces.

### 7. Hub de Integraciones (9:00 – 10:30)
* **Pantalla:** `/integraciones`
* **Acción:** Mostrar la vista centralizada de canales con tarjetas amplias para **Shopify**, **Meta WhatsApp Cloud API** y **Evolution API**.
* **Puntos a Destacar:**
  - Hub unificado sin duplicación de lógica: las tarjetas de WhatsApp enlazan limpiamente a `/conexiones`.
  - Cero campos de API keys o credenciales privadas en la UI.

### 8. Configuración Comercial de Shopify (10:30 – 12:00)
* **Pantalla:** `/integraciones` (Tarjeta Shopify Conectada)
* **Acción:**
  1. Mostrar tienda conectada (`*.myshopify.com`), moneda base y fecha de última sincronización.
  2. Pulsar **"Sincronizar ahora"**: observar spinner de carga y toast de éxito con productos/variantes sincronizadas.
  3. Modificar selectores de **Configuración de Catálogo**: `catalogMode` (`COMBINED`), `priceSource` y `stockSource`. Guardar cambios.
* **Puntos a Destacar:**
  - Backend con whitelist estricta: `PATCH /api/integrations/shopify/settings` rechaza campos no autorizados y valida enums.
  - Modal de desconexión clara explicando que revoca credenciales locales sin desinstalar la app de Shopify.

### 9. Campañas Masivas V2 (12:00 – 13:30)
* **Pantalla:** `/campanas`
* **Acción:** Revisar una campaña programada, parámetros de delay anti-bloqueo (5-15s) y registros de auditoría (`CampaignLog`).
* **Puntos a Destacar:**
  - Motor de ejecución en segundo plano con deduplicación y tolerancia a fallos.

### 10. Seguimientos Post-Venta V1 (13:30 – 15:00)
* **Pantalla:** `/seguimientos`
* **Acción:** Mostrar el funnel de reactivación de clientes, el timeline de cadencia (24h/48h) y reglas de horario comercial.
* **Puntos a Destacar:**
  - Cancelación automática e instantánea si el cliente efectúa una compra o rechaza la oferta.

### 11. Flow Builder (15:00 – 16:30)
* **Pantalla:** `/automatizacion`
* **Acción:** Navegar por el canvas interactivo de React Flow mostrando nodos de bienvenida, preguntas con opciones y derivación a asesor.
* **Puntos a Destacar:**
  - Automatización visual intuitiva sin necesidad de código.

### 12. Configuración de Tenant (16:30 – 17:30)
* **Pantalla:** `/settings`
* **Acción:** Revisar configuración de horarios de atención, teléfonos de notificación y datos de la empresa.
* **Puntos a Destacar:**
  - Personalización completa por inquilino.

### 13. SuperAdmin Global (17:30 – 20:00)
* **Pantalla:** Iniciar sesión como SuperAdmin (`admin@velion.pe`) -> `/admin-empresas` y `/admin-config`.
* **Acción:**
  1. Mostrar listado de todas las empresas y switch de **Suspensión de Inquilino**.
  2. Abrir `/admin-config`: demostrar la sanitización de secretos donde todas las API Keys críticas se muestran enmascaradas (`••••••••`) y no se pueden filtrar al navegador.
  3. Mostrar `/admin-backups` con respaldos automáticos y opción de exportación manual.
* **Puntos a Destacar:**
  - Capacidad de supervisión SaaS lista para venta comercial.
  - Cumplimiento estricto de seguridad verificado con 23 pruebas automatizadas de sanitización.

---

## 🔒 Reglas Operativas de la Demostración
- **Cero Producción**: Se realiza en base de datos local o staging de prueba.
- **Datos Sintéticos**: Productos de ejemplo (moda, tecnología) y números de prueba.
- **Sin Ejecución de Draft Orders Live**: La demostración de órdenes Shopify se realiza mediante los pedidos sincronizados y el contrato visual implementado en Fase 6C.
