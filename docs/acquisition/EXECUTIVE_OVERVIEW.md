# Velion Agent — Executive Overview

**Documento de Evaluación de Producto para Procesos de Adquisición / Due Diligence**  
**Versión del Software:** 1.0.0-prod  
**Fecha de Publicación:** Septiembre 2026  
**Confidencialidad:** Material Técnico para Compradores de Software  

---

## 1. Qué es Velion Agent

**Velion Agent** es una plataforma de software como servicio (SaaS B2B multitenant) diseñada para la **automatización integral de ventas, atención al cliente y operaciones comerciales a través de WhatsApp**, impulsada por modelos de Inteligencia Artificial Generativa de última generación.

A diferencia de los "wrappers" convencionales de chatbots que se limitan a conectar un modelo de lenguaje a una API básica, Velion Agent implementa una **arquitectura de software empresarial battle-tested**:
1. **Modelos de Autoridad Deterministas (*Anti-Hallucination Engine*):** Reglas estrictas a nivel de backend que impiden que el modelo invente cuentas bancarias, prometa tiempos falsos de entrega o afirme haber enviado contenido inexistente.
2. **Conectividad Dual Híbrida de WhatsApp:** Coexistencia nativa entre la **API Oficial de Meta (WhatsApp Cloud API)** mediante *Embedded Signup v4* y la **API No Oficial vía QR (Evolution API)** con un motor Baileys parcheado para alta concurrencia.
3. **Orquestación Multimedia Factual:** Envío de imágenes y videos reales del catálogo de productos con rotación de galerías, deduplicación de álbumes y desambiguación de categorías.
4. **Motor Semántico de Seguimientos Comerciales (*Sales Cadence Engine*):** Automatización de cadencias de recuperación de prospectos que analiza la intención del cliente, respeta horarios silenciosos por zona horaria y cancela secuencias en tiempo real ante compras o desinterés explícito.
5. **Aislamiento Multitenant Criptográfico:** Cada empresa cuenta con sus propios datos, catálogos, configuraciones, límites de mensajes y salas de WebSocket aisladas mediante JWT.

---

## 2. El Problema que Resuelve

### A. Para Empresas y Negocios en WhatsApp
* **Cuello de Botella Humano:** Las empresas pierden hasta un 40% de sus oportunidades de venta por demoras en responder consultas básicas de catálogo, stock o precios fuera de horario comercial.
* **Alucinaciones Financieras y Operativas de Bots Genéricos:** Un chatbot sin modelos de autoridad promete descuentos inexistentes, proporciona números de cuenta equivocados o asegura envíos a zonas sin cobertura.
* **Costos Elevados de Conversación Oficial:** Utilizar exclusivamente la Cloud API de Meta para prospección fría o campañas masivas genera altos costos por conversación iniciada por el negocio. Velion permite enrutar campañas y prospección por Evolution API (costo $0 por mensaje de Meta) y reservar Meta Cloud API para atención institucional.
* **Abandono de Conversaciones:** Los clientes consultan y luego dejan de responder. Velion ejecuta cadencias de seguimiento semánticas que recuperan ventas sin parecer spam robótico.

### B. Para el Proveedor del SaaS (Dueño del Software)
* **Control Estricto de Costos de IA:** Sistema de presupuestos diarios y mensuales de tokens por cliente inquilino (*Tenant*), evitando que un cliente sature las cuotas de API de Gemini o Groq.
* **Resiliencia Operativa:** Si el proveedor principal de IA (Google Gemini) experimenta latencia o límites de cuota (HTTP 429), el sistema conmuta en milisegundos a un modelo secundario y, si es necesario, a un tercer proveedor (Groq / Llama 3.3).

---

## 3. Arquitectura General del Sistema

El sistema opera bajo un modelo distribuido y desacoplado:

* **Capa de Presentación (Frontend):** Single Page Application (SPA) en React 19 + Vite 8 + Tailwind CSS. Incluye panel para inquilinos comerciales y panel exclusivo para el SuperAdmin.
* **Capa de Negocio y API (Backend):** Servidor en Node.js 20 (ES Modules) sobre Express y Socket.IO para eventos bidireccionales en tiempo real.
* **Capa de Datos:** PostgreSQL 15 gestionado mediante Prisma ORM con 16 modelos relacionales que cubren inquilinos, usuarios, contactos, chats, mensajes, catálogo de productos, pedidos, secuencias de seguimiento y telemetría de IA.
* **Capa de Conectividad WhatsApp:**
  * *Meta Cloud API (Oficial):* Graph API v21.0 con Webhooks autenticados por HMAC-SHA256.
  * *Evolution API (QR):* Microservicio Dockerizado en Node.js/TypeScript basado en Baileys con parches de concurrencia.
* **Capa de Inteligencia Artificial:**
  * *Google Gemini (Primario):* `gemini-3.5-flash-lite` y `gemini-3.5-flash` con *ThinkingLevel.MINIMAL* y pool de rotación de API keys.
  * *Groq / Llama (Fallback):* `llama-3.3-70b-versatile` para contingencia inmediata.
* **Capa de Infraestructura:** Servidor Linux (Ubuntu/Debian) con Nginx como proxy inverso y terminador SSL, PM2 como administrador de procesos Node.js y Docker Compose para servicios auxiliares.

---

## 4. Módulos Principales del Producto

1. **LiveChat Multicanal en Tiempo Real:** Interfaz de mensajería con soporte de audio, imágenes, badges de estado de mensaje, búsqueda de chats, filtros de contactos y drawer de notas/tareas operativas.
2. **Human Handoff (Transferencia a Asesor):** Pausa programada del bot (ventana de 30 minutos) con detección inteligente de reclamos o solicitud explícita de atención humana.
3. **Catálogo y E-Commerce Conversacional:** Gestión de productos con múltiples imágenes, videos, precios canónicos y promocionales. Carrito conversacional con creación atómica de órdenes (`Order` y `OrderItem`).
4. **Motor de Decisiones de Seguimiento (*Follow-Up Cadence*):** Motor de 3 etapas (`OFF`, `SHADOW`, `ENFORCE`) con evaluación de confianza semántica con Gemini para reactivar clientes inactivos.
5. **Campañas Masivas de Mensajería:** Programación de envíos con intervalos aleatorios (*delays*) anti-bloqueo y recurrencias quincenales/mensuales automáticas.
6. **Constructor Visual de Flujos (*FlowBuilder*):** Canvas interactivo (React Flow) para diseñar árboles de decisión, asignación de etiquetas y transferencias condicionales.
7. **Notas y Tareas Operacionales:** Herramienta interna donde la IA o los agentes humanos crean compromisos, observaciones de servicio y tareas con fecha de vencimiento local calculada según la zona horaria del cliente.
8. **Panel de Control SuperAdmin:** Monitorización global de tenants, cuotas de mensajes, presupuestos de tokens, orquestador de respaldos de base de datos y visor de salud del sistema.

---

## 5. Estado Actual del Producto

* **Clasificación:** **Producto Funcional Avanzado / Listo para Producción en Entorno Controlado**.
* **Madurez del Core:** Los flujos conversacionales, la orquestación multimedia, el aislamiento multitenant y los mecanismos de resiliencia están ampliamente probados en entornos reales y validados con más de 45,000 líneas de tests automatizados.
* **Áreas para Evolución Comercial:**
  * La facturación actual utiliza un modelo híbrido donde el plan se asigna en el panel y el cobro se canaliza manualmente (vía Yape/WhatsApp en Perú), a pesar de que las librerías de Stripe están listas en el backend.
  * El controlador principal de WhatsApp ([`whatsappController.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/src/controllers/whatsappController.js)) se beneficiará de una modularización para facilitar el trabajo de equipos grandes.
