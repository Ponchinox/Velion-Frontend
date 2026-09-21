# Velion Agent — Comprehensive Technical Asset Inventory

**Inventario Cuantitativo y Cualitativo de Activos de Software para M&A**  
**Fecha de Corte:** Septiembre 2026  

---

## 1. Métricas Cuantitativas del Código Fuente

Las siguientes métricas fueron extraídas mediante auditoría directa sobre el sistema de archivos del proyecto:

| Categoría de Activo | Ubicación en Repositorio | Lenguajes / Tecnologías | Líneas de Código (LOC) |
| :--- | :--- | :--- | :---: |
| **Frontend SPA** | `src/` | JavaScript (ESM), JSX, CSS | **17,476** |
| **Backend Core & Servicios** | `backend_api/src/` | Node.js (ES Modules) | **24,543** |
| **Suites de Pruebas de Dominio** | `backend_api/test_*.js` | JavaScript, Node.js Assert | **39,272** |
| **QA Runner & Network Guard** | `backend_api/qa/` | JavaScript, Mocks de Red | **5,913** |
| **Herramientas de Hardening & Forense** | `scratch/` | Python 3, Node.js, Shell Bash | **14,275** |
| **TOTAL GENERAL DE LÍNEAS DE CÓDIGO:** | Toda la solución | | **101,479** |

---

## 2. Inventario de Modelos de Datos (PostgreSQL / Prisma)

El esquema relacional ([`schema.prisma`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/prisma/schema.prisma)) consta de **16 modelos de datos relacionales** estructurados con índices compuestos para alta concurrencia:

1. `Tenant`: Entidad raíz de inquilino corporativo, personalización visual, prompts y límites de tokens.
2. `User`: Usuarios del sistema con control de acceso por roles (`client` y `superadmin`).
3. `Contact`: Directorio de contactos de clientes en WhatsApp, segmentados por categorías y etiquetas.
4. `Chat`: Hilos de conversación vinculados a contactos, con control de pausas del bot.
5. `Message`: Historial unificado de mensajes con soporte para notas de voz, imágenes y lotes de medios (*albums*).
6. `AutomationFlow`: Árboles de automatización basados en nodos JSON exportados desde React Flow.
7. `Product`: Catálogo de productos con precios promocionales, control de disponibilidad y soporte multimedia.
8. `Alert`: Registro de incidencias y anomalías operativas dirigidas a los administradores.
9. `Plan`: Estructura de suscripciones comerciales con banderas de características y presupuestos de tokens.
10. `SystemConfig`: Tabla llave-valor para configuraciones globales dinámicas del clúster.
11. `Customer`: Perfil comercial persistente del cliente en WhatsApp con seguimiento de etapa de compra.
12. `Campaign`: Campañas de mensajería masiva con configuración de retardo estocástico y recurrencias.
13. `CampaignLog`: Registro transaccional del estado de despacho individual de cada mensaje de campaña.
14. `Flow`: Flujos de automatización disparados por palabras clave (*keyword triggers*).
15. `RegisteredWhatsAppNumber`: Registro de números telefónicos activos diferenciando proveedor `EVOLUTION` o `META`.
16. `Order` y `OrderItem`: Registro transaccional de pedidos comerciales generados durante la conversación.
17. `TenantAIUsage`: Telemetría granular de consumo de tokens y llamadas a herramientas por día.
18. `OperationalItem`: Tareas pendientes y observaciones operacionales vinculadas a clientes y pedidos.
19. `FollowUpSequence` y `FollowUpAttempt`: Máquina de estados de cadencia de ventas y registro de intentos de recuperación.

---

## 3. Inventario de Microservicios e Infraestructura Contenerizada

* **Contenedor Evolution API:**
  - Ubicación: `evolution/`
  - Imagen base: `evoapicloud/evolution-api:latest`
  - Parches propietarios: `patch_profile_picture.js` y actualización a Baileys `7.0.0-rc13` en `Dockerfile`.
* **Contenedor PostgreSQL de Sesiones:**
  - Base de datos relacional independiente para el almacenamiento de sesiones de WhatsApp Web de Baileys.
* **Proxy Inverso Nginx:**
  - Configuración optimizada para terminación SSL, compresión gzip, streaming de medios y upgrade de WebSockets.
* **Administrador de Procesos PM2:**
  - Configuración para ejecución en clúster con reinicio automático ante fallos de memoria.

---

## 4. Desglose de Propiedad Intelectual vs Dependencias de Terceros

| Activo | Naturaleza Legal | Situación de Transferencia |
| :--- | :--- | :--- |
| **Código del Frontend y Backend** | Propiedad Intelectual Propia | **100% transferible** al comprador bajo contrato de cesión. |
| **Modelos de Autoridad Anti-Alucinación** | Algoritmos y Heurísticas Propias | **100% transferible** (Diferenciador competitivo de alto valor). |
| **Motor de Seguimientos y Cadencia** | Arquitectura y Lógica Propietaria | **100% transferible**. |
| **Imágenes Docker y Parches de Baileys** | Código Propietario sobre Open Source | **100% transferible**. |
| **Librerías NPM (React, Express, Prisma, etc.)** | Código Abierto (MIT / Apache 2.0 / ISC) | Licencias estándar de código abierto compatibles con uso comercial. |
| **Modelos Fundacionales de IA (Gemini / Llama)** | APIs de Terceros (Google Cloud / Groq) | El comprador utiliza sus propias cuentas de facturación mediante API Keys. |
| **WhatsApp Platform (Meta Graph API)** | API de Terceros (Meta Platforms Inc.) | El comprador crea o utiliza su propio Facebook App ID. |
