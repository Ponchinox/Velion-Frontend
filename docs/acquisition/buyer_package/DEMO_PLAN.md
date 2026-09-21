# Velion Agent — Secure Demonstration Strategy & Plan (Wallpay)

**Plan de Evaluación Práctica para Inversionistas y Evaluadores Técnicos**  
**Objetivo:** Permitir que los directivos y el equipo técnico de Wallpay experimenten la potencia, reactividad y usabilidad de Velion Agent con **cero riesgo de seguridad, cero fuga de datos de clientes reales y máxima protección de la propiedad intelectual**.  

---

## 1. Evaluación de Modalidades de Demostración

| Modalidad Evaluada | Ventajas | Desventajas / Riesgos | Viabilidad |
| :--- | :--- | :--- | :---: |
| **Opción A: Tenant Demo en Servidor Actual** | - Inmediata (se prepara en 1 hora).<br>- Rendimiento idéntico a producción.<br>- Aprovecha la infraestructura existente. | - Requiere aislar perfectamente el tenant de demo y verificar que no pueda disparar mensajes a números reales. | **Alta** (Con controles) |
| **Opción B: Entorno de Staging Separado** | - Aislamiento de infraestructura completo. | - Demora de 2 a 3 días en aprovisionar un nuevo VPS, configurar dominios y levantar servicios para una primera reunión. | Media (Recomendable para fase 2) |
| **Opción C: Demo Guiada por Videollamada (Sin Acceso Directo)** | - Riesgo 0 de manipulación.<br>- Control total de la narrativa y el flujo. | - Menor nivel de convicción táctil para el CTO si este desea explorar la interfaz por sí mismo. | **Muy Alta** |
| **Opción D: Demo Guiada Inicial + Tenant Temporal Revocable (24h-48h)** | - **Máximo impacto:** Los socios ven el sistema en vivo en 15 minutos de videollamada y luego el CTO recibe un usuario limitado para explorar la interfaz durante 48 horas.<br>- Cero datos reales expuestos.<br>- Fácil revocación. | - Requiere cargar catálogo y conversaciones de prueba previamente. | **RECOMENDADA (ÓPTIMA)** |

### Recomendación Estratégica
Se recomienda implementar la **Opción D**:
1. **Fase 1 (Encuentro Ejecutivo - 15 a 20 minutos):** Demostración guiada en vivo compartiendo pantalla siguiendo el guión oficial (`DEMO_SCRIPT.md`).
2. **Fase 2 (Prueba Táctica por el CTO - 48 horas):** Entrega de credenciales temporales de un **Inquilino Demo Aislado** (`role: 'client'`) con datos ficticios para que el equipo técnico de Wallpay pueda interactuar con el panel a su propio ritmo.

---

## 2. Parámetros Obligatorios de Seguridad de la Demo

Para proteger la integridad del sistema y de los clientes existentes:
* **Datos 100% Sintéticos / Ficticios:** La empresa demo ("EcoTech Solutions" o "Moda Nova") tendrá productos, clientes y conversaciones totalmente inventados.
* **Cero Clientes ni Teléfonos Reales:** La base de datos del tenant de demo solo contendrá números de prueba controlados por nosotros o provistos por Wallpay para la prueba.
* **Cero Acceso a SuperAdmin:** El usuario entregado tendrá rol estrictamente `client` (acceso a su propio panel de empresa). No tendrá acceso a la ruta `/admin-*` ni a la lista de otras empresas.
* **Cero Acceso a Código, SSH o Base de Datos:** Wallpay evaluará el software como usuario final del SaaS, no desde la consola del servidor ni el repositorio de GitHub.
* **Credenciales Temporales con Expiración:** Usuario activo durante un máximo de **48 horas**, tras lo cual la contraseña se revoca y el tenant se desactiva desde el panel maestro.

---

## 3. Matriz de Configuración por Módulo para el Tenant Demo

| Módulo del Sistema | Nivel de Acceso en Demo | Comportamiento y Medidas de Seguridad |
| :--- | :---: | :--- |
| **Dashboard del Tenant** | **Acceso Normal** | Visualización de métricas de mensajes, gráficos de actividad y chats del tenant demo con datos ficticios. |
| **Catálogo de Productos** | **Acceso Normal** | 4-6 productos de prueba cargados con fotos reales, precios promocionales y videos demostrativos. Wallpay puede crear o editar un producto de prueba. |
| **LiveChat Multicanal** | **Acceso Normal** | Historial de conversaciones simuladas. Permite escribir en tiempo real, enviar notas de voz de prueba y ver estados de lectura. |
| **IA Conversacional en Chat** | **Acceso Normal** | Respuestas automáticas con Google Gemini Flash activas respondiendo sobre el catálogo del tenant demo. |
| **Human Handoff** | **Acceso Normal** | Demostración del botón de pausa del bot y reanudación de la atención humana. |
| **Motor de Seguimientos (Follow-Ups)** | **Solo Lectura** | Visualización de secuencias simuladas en timeline, métricas de recuperación y configuración de zona horaria. |
| **Notas y Tareas Operacionales** | **Acceso Normal** | Interacción con el drawer lateral; creación de tareas y notas con fecha de vencimiento local. |
| **Constructor de Flujos (FlowBuilder)** | **Acceso Normal** | Canvas interactivo de React Flow para visualizar y mover nodos de automatización. |
| **Campañas Masivas** | **Solo Lectura** | Se muestran campañas pasadas simuladas. El botón de lanzamiento real a bases externas se deshabilita para evitar envíos involuntarios. |
| **Conexiones WhatsApp** | **Controlado** | Vinculado a un número de WhatsApp de prueba dedicado exclusivo de la demo (gestionado por nosotros). Wallpay puede chatear en vivo con ese número desde sus teléfonos. |
| **Facturación y Planes** | **Solo Lectura** | Muestra el plan asignado al tenant demo y las cuotas de uso disponibles. |
| **Panel SuperAdmin** | **OCULTO / BLOQUEADO** | El middleware de autenticación bloquea cualquier acceso con error HTTP `403 Forbidden`. |

---

## 4. Arquitectura de Interacción durante la Demo

Durante la evaluación interactiva:
1. El presentador o evaluador envía un mensaje desde su propio WhatsApp personal al **número dedicado de la demo**.
2. El mensaje ingresa al backend de Velion y es atendido por la IA de forma instantánea:
   - Responde preguntas de stock y precios de forma verídica.
   - Si el evaluador pide fotos ("¿tienes fotos del producto?"), la IA despacha la imagen oficial del catálogo.
   - Si el evaluador intenta forzar una alucinación ("pásame tu cuenta bancaria personal para depositar"), el modelo de autoridad neutraliza la respuesta verídicamente.
3. El evaluador observa simultáneamente en el navegador cómo el LiveChat se actualiza en tiempo real vía WebSockets con cero recarga de página.
4. El evaluador prueba la transferencia a humano y observa la pausa automática del bot.

---

## 5. Cronograma de Preparación Técnica de la Demo

* **Paso 1 (30 min):** Ejecución del script de aprovisionamiento del tenant demo con catálogo y datos sintéticos.
* **Paso 2 (15 min):** Vinculación del número de WhatsApp de prueba (vía QR o Meta Sandbox).
* **Paso 3 (15 min):** Prueba interna de extremo a extremo (*Dry Run*) validando que las respuestas de IA y el despacho de imágenes fluyan con fluidez.
* **Tiempo Total Requerido:** **Aproximadamente 1 hora de preparación técnica**.
