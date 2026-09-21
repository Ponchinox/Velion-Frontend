# Matriz de Demostración SuperAdmin — Evaluación Wallpay

**Clasificación:** Guía Operativa Interna para Pantalla Compartida / Demo Guiada  
**Versión:** 1.0  
**Fecha:** Septiembre 2026  
**Regla de Oro:** Wallpay **NO** recibirá credenciales con rol `superadmin`. El acceso a las pantallas del SuperAdmin se realizará exclusivamente mediante sesión guiada por pantalla compartida.

---

## 1. Resumen de Clasificación Operativa

| Sección / Pantalla SuperAdmin | Clasificación de Demostración | Estado Técnico Real en Repositorio | Recomendación para la Demo con Wallpay |
| :--- | :---: | :--- | :--- |
| **Métricas Globales y Salud (`DashboardPage`)** | `SAFE_AND_WORKING` | Lee estadísticas reales de PostgreSQL (tenants, chats, productos, mensajes) y estado de salud de PM2 / PostgreSQL. | **Mostrar libremente.** Demuestra volumen, monitoreo de infraestructura y métricas de clúster. |
| **Gestión de Planes (`AdminPlanesPage`)** | `SAFE_AND_WORKING` | CRUD completo en DB con sincronización de límites de mensajes, conexiones y presupuestos diarios/mensuales de tokens. | **Mostrar libremente.** Excelente para enseñar el modelo SaaS, control de márgenes y asignación de cuotas. |
| **Configuración Global (`AdminConfiguracionPage`)** | `SAFE_AND_WORKING` | Permite editar el Prompt Maestro de IA y webhook de alertas. No expone credenciales ni API keys en el frontend. | **Mostrar libremente.** Enseña la arquitectura de prompt maestro sobre la que se basan los tenants. |
| **Centro de Alertas (`AdminAlertsPage`)** | `SAFE_AND_WORKING` | Consulta tabla `SystemAlert` y permite resolver incidentes con actualización en base de datos. | **Mostrar.** Buena evidencia de monitoreo de fallos y resiliencia operativa. |
| **Gestión de Empresas — Datos y Límites (`AdminEmpresasPage`)** | `SAFE_AND_WORKING` | Creación de tenant, edición de límites de mensajes/conexiones y presupuesto de tokens. | **Mostrar con tenant ficticio.** Demostrar sobre `NovaTech Demo`. No mostrar empresas reales. |
| **Soporte / Impersonación (`AdminEmpresasPage`)** | `WORKING_WITH_LIMITATIONS` | Inyecta cabecera `X-Tenant-Id` para actuar como el cliente. Funciona en frontend/backend. | **Demostrar ÚNICAMENTE entrando a NovaTech Demo.** Si se entra a una empresa real, se exponen datos de clientes reales. |
| **Suspensión de Cuentas (`AdminEmpresasPage`)** | `NOT_READY_FOR_BUYER_DEMO` | Modifica `tenant.active` en PostgreSQL. El estado se persiste y es respetado por `followUpWorker`, pero `authMiddleware`, login y WhatsApp inbound NO lo comprueban. | **NO MOSTRAR COMO CONTROL DE ACCESO FUNCIONAL.** Si el comprador pregunta, declarar con transparencia que es una función de estado visual y de cadencias en fase de endurecimiento. |
| **Respaldos de Base de Datos (`AdminBackupsPage`)** | `SECURITY_SENSITIVE` | Ejecuta `pg_dump` y descarga archivos `.sql.gz` reales de la base de datos de producción. | **NO EJECUTAR EN VIVO.** Mostrar la interfaz estática para ilustrar la funcionalidad, pero NO presionar "Generar Respaldo" ni descargar archivos durante la demo. |
| **Eliminar Empresa Permanentemente (`AdminEmpresasPage`)** | `SECURITY_SENSITIVE` | Eliminación en cascada en PostgreSQL (tenants, chats, mensajes, órdenes, usuarios). | **ACCIÓN PROHIBIDA EN DEMO.** Acción destructiva irreversible. Bloqueada durante cualquier presentación. |

---

## 2. Detalle de Funciones por Nivel de Riesgo

### A. Pantallas Seguras de Mostrar (`SAFE_AND_WORKING`)

1. **Dashboard General (`/dashboard`)**:
   - Métricas de empresas activas, usuarios, productos y volumen mensual de mensajes.
   - Diagnóstico en vivo de conexión con Base de Datos y APIs.
   - *Precaución:* Verificar previamente que en la lista de "Actividad Reciente" no aparezcan números telefónicos o nombres de clientes reales antes de compartir pantalla.

2. **Administración de Planes (`/admin-planes`)**:
   - Creación y edición de planes comerciales (Básico, Pro, Enterprise).
   - Configuración de límites: conexiones de WhatsApp, cupo de mensajes al mes, productos máximos.
   - Presupuestos de tokens de IA (ej. 130,000 diarios / 2,000,000 mensuales): demostrar cómo el dueño del SaaS protege su margen comercial.

3. **Configuración del Servidor (`/admin-config`)**:
   - Prompt de Sistema Global Maestro: directrices de comportamiento ético y seguridad compartidas para todos los bots.
   - Configuración de webhook para alertas críticas de infraestructura.

4. **Centro de Alertas (`/admin-alertas`)**:
   - Bandeja de incidentes del sistema con botón de resolución.

---

### B. Pantallas con Limitaciones Operativas (`WORKING_WITH_LIMITATIONS`)

1. **Modo Soporte / Impersonación en `/admin-empresas`**:
   - *Cómo funciona:* El botón "Soporte" navega al dashboard del cliente simulando su sesión con permisos de administrador de tenant.
   - *Riesgo:* Si el presentador hace clic en una empresa cliente real, la pantalla compartida mostrará sus chats y contactos reales en vivo.
   - *Protocolo de Demo:* Hacer clic en "Soporte" **exclusivamente** sobre la fila de `NovaTech Demo`.

---

### C. Funciones No Listas para Demostración (`NOT_READY_FOR_BUYER_DEMO`)

1. **Botón "Suspender Cuenta" (`/admin-empresas`)**:
   - *Diagnóstico Técnico:* Llama a `PATCH /api/admin/tenants/:id/status` y establece `active: false` en la tabla `Tenant`.
   - *Comportamiento Actual:*
     - El badge visual cambia a "Suspendida" (rojo) y el botón pasa a "Activar".
     - El worker de seguimiento (`followUpWorker.js`) frena las cadencias automáticas (`seq.tenant.active === false`).
     - **Sin embargo**, el usuario del tenant suspendido puede seguir iniciando sesión (`authController.js` no valida `active`), puede seguir navegando sus datos y el bot de WhatsApp sigue respondiendo mensajes entrantes.
   - *Regla para la Demo:* **NO presentar el botón como un mecanismo de bloqueo o baneo operativo.** Si el equipo de Wallpay consulta sobre la suspensión de cuentas, se debe responder con transparencia:
     > *"El modelo de datos y el panel ya incorporan el estado de suspensión en base de datos (desactivando las cadencias asíncronas), y la interceptación completa en el middleware de autenticación forma parte del backlog de cierre pre-lanzamiento."*

---

### D. Acciones Críticas / Destructivas Prohibidas (`SECURITY_SENSITIVE`)

1. **Eliminar Empresa (`Eliminar permanentemente`)**:
   - *Peligro:* Ejecuta `prisma.tenant.delete` con borrado en cascada.
   - *Regla:* Prohibido hacer clic bajo cualquier circunstancia.

2. **Generar y Descargar Respaldo (`/admin-backups`)**:
   - *Peligro:* El botón "Generar Respaldo" ejecuta `pg_dump` sobre el servidor de base de datos en tiempo real y genera un volcado descargable que contiene datos reales.
   - *Regla:* Mostrar la pantalla como capacidad de disaster recovery, pero no presionar "Generar Respaldo" ni hacer descargas.

3. **Resetear Contraseña de Tenant (`Actualizar Contraseña`)**:
   - *Peligro:* Modificaría las credenciales de acceso de un cliente real si se ejecuta sobre una empresa existente.
   - *Regla:* Usar únicamente si se requiere cambiar la clave de `NovaTech Demo`.

---

## 3. Protocolo de Presentación para Socios de Wallpay

1. **Iniciar la llamada en `/dashboard`** mostrando métricas agregadas del clúster.
2. **Navegar a `/admin-planes`** para explicar la lógica comercial, cuotas y límites de consumo de IA.
3. **Ir a `/admin-empresas`** y focalizar la explicación en la empresa `NovaTech Demo`.
4. **Hacer clic en "Soporte" sobre `NovaTech Demo`** para transicionar fluidamente desde la vista de SuperAdmin hacia la vista que verá el cliente corporativo (LiveChat, Catálogo, FlowBuilder).
