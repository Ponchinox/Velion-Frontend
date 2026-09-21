# Velion Agent — Executive One-Pager

**Resumen Ejecutivo para Socios, Directivos y Comités de Inversión**  
**Tiempo Estimado de Lectura:** 2 minutos  

---

## 1. Qué es Velion Agent
**Velion Agent** es una plataforma SaaS B2B que permite a empresas **automatizar sus ventas, atención al cliente y seguimiento de prospectos en WhatsApp** mediante Inteligencia Artificial Generativa. Funciona como un equipo comercial y de soporte 24/7 capaz de responder consultas de catálogo, enviar fotos y videos de productos, tomar pedidos y recuperar clientes que dejaron de responder.

---

## 2. El Problema Comercial que Resuelve
* **Pérdida de Ventas por Demora:** Las empresas pierden clientes porque tardan horas en responder preguntas frecuentes o enviar catálogos fuera de horario comercial.
* **Miedo a las "Alucinaciones" de la IA:** La mayoría de bots genéricos inventan precios, números de cuenta bancaria o prometen tiempos falsos de entrega. Velion incorpora **modelos de autoridad a nivel de software** que impiden que el bot prometa algo que la empresa no puede cumplir.
* **Adaptabilidad de Conectividad:** Velion soporta conectividad mediante Meta Cloud API y, adicionalmente, una integración basada en sesión QR mediante Evolution API, permitiendo adaptar el canal de conexión a distintos escenarios operativos.

---

## 3. Módulos Clave Incluidos
1. **Atención y Ventas con IA (Gemini & Groq):** Respuestas contextuales instantáneas con voz de marca personalizada.
2. **Catálogo y Despacho Multimedia:** Envío de fotos y videos reales de productos directamente al chat de WhatsApp.
3. **Carrito y Pedidos en Conversación:** Toma de pedidos registrando dirección, producto y monto exacto sin intervención humana.
4. **LiveChat y Transferencia a Humanos (*Human Handoff*):** Si el cliente pide hablar con una persona o tiene un reclamo complejo, el bot se pausa automáticamente y alerta a los operadores.
5. **Motor de Recuperación de Ventas (*Follow-Up Cadence*):** Hace seguimiento inteligente a prospectos inactivos, respetando horarios comerciales y deteniéndose de inmediato si el cliente ya compró.
6. **Campañas Masivas y Constructor de Flujos (*FlowBuilder*):** Envíos programados con cadencia configurable de envíos, control de frecuencia y diseño visual de respuestas automatizadas.
7. **Panel de Control SuperAdmin:** Gestión de empresas clientes, límites de uso y presupuestos de consumo de IA.

---

## 4. Diferenciadores Competitivos Frente al Mercado
* **No es un "ChatGPT básico":** Es un sistema transaccional con reglas deterministas que garantizan veracidad en precios y pagos.
* **Conectividad Dual:** La empresa no depende exclusivamente de las políticas de Meta ni queda atada a una sola tecnología.
* **Alta Resiliencia:** Si el proveedor principal de IA (Google) sufre una interrupción, el sistema conmuta automáticamente a un segundo proveedor sin que el cliente note la caída.
* **Control de Costos para el Dueño del SaaS:** Límites y presupuestos automáticos de tokens por cliente para proteger el margen del negocio.

---

## 5. Nivel de Madurez y Estado del Producto
* **Clasificación:** **Producto Funcional Avanzado / Operativo en Entorno de Producción Controlado**.
* **Realidad del Código:** Cuenta con más de 42,000 líneas de código de aplicación y 45,000 líneas de pruebas automatizadas. La suite automatizada aporta evidencia extensa de robustez funcional, cobertura de casos de borde, condiciones de carrera e idempotencia.
* **Estado:** Actualmente desplegado y operativo.

---

## 6. Qué Recibe el Comprador
* **Código Fuente y Activos Preparados para Cesión:** Código fuente del panel web (React 19) y del backend (Node.js 20), sujetos al acuerdo contractual de adquisición y a la revisión de licencias/dependencias de terceros.
* **Estructura de Base de Datos Completa:** Esquema relacional en PostgreSQL optimizado para multitenencia.
* **Infraestructura Contenerizada y Documentada:** Configuraciones de Docker y Nginx con documentación de despliegue para aprovisionar el sistema en un servidor limpio.
* **Manuales Técnicos y de Operación:** Guías de instalación, documentación de API y procedimientos de mantenimiento.

---

## 7. Qué Partes Requieren Atención Inmediata
* **Automatización del Cobro Recurrente:** Actualmente la asignación de planes se gestiona en el panel y el cobro se realiza manualmente. La integración de Stripe Checkout o Mercado Pago para cobros 100% automáticos con tarjeta es el siguiente paso natural para escalar a autoservicio masivo.
* **Onboarding Guiado:** Incorporar un asistente de bienvenida de autoservicio (*wizard*) para que un nuevo cliente pueda registrarse y vincular su WhatsApp sin asistencia del administrador.
