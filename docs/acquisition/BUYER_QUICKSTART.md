# Velion Agent — Technical Buyer Quickstart (10-Minute Brief)

**Guía Rápida de Comprensión y Ejecución para Evaluadores Técnicos**  
**Tiempo Estimado de Lectura:** 8 minutos  

---

## 1. Qué es Velion en 3 Párrafos

**Velion Agent** es una plataforma SaaS B2B multitenant de **automatización de ventas y atención al cliente por WhatsApp** impulsada por Inteligencia Artificial conversacional (Google Gemini 3.5 y Groq Llama 3.3).

El sistema se diseñó para resolver los dos mayores defectos de los chatbots del mercado: **las alucinaciones operativas** (inventar precios, cuentas bancarias o promesas falsas) y **la fragilidad en WhatsApp** (baneos, bloqueos de concurrencia y altos costos por conversación de Meta). Velion cuenta con **modelos de autoridad deterministas** que verifican cada afirmación antes de enviarla, y una **arquitectura dual** que permite operar tanto con la API Oficial de Meta como con Evolution API (QR) en paralelo.

Actualmente es un **producto funcional listo para producción** en entornos controlados, con más de 42,000 líneas de código de aplicación y 45,000 líneas de pruebas automatizadas.

---

## 2. Mapa del Código Fuente (Dónde Mirar)

Si dispone de poco tiempo para auditar el código, revise estos archivos clave para comprobar la calidad de ingeniería:

| Si desea evaluar... | Revise este archivo: | Por qué es importante: |
| :--- | :--- | :--- |
| **Resiliencia de IA y Pool de Claves** | [`backend_api/src/services/aiService.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/src/services/aiService.js) | Muestra la cascada Gemini Flash Lite -> Flash -> Groq Llama 3.3, manejo de cooldowns y compresión de contexto. |
| **Modelos de Autoridad Anti-Alucinación** | [`backend_api/src/controllers/whatsappController.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/src/controllers/whatsappController.js#L235-L455) | Funciones `enforceBusinessAuthority` y `enforceMediaAuthority` que impiden alucinaciones de pagos y medios. |
| **Orquestación Multimedia de Catálogo** | [`backend_api/src/services/productMediaOrchestrator.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/src/services/productMediaOrchestrator.js) | Lógica que desambigua consultas de categoría vs producto y rota fotos de catálogo de WhatsApp. |
| **Motor de Seguimiento de Ventas (Cadencia)** | [`backend_api/src/services/followUpDecisionService.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/src/services/followUpDecisionService.js) | Decisión semántica de reanudación con Gemini, respeto de horarios silenciosos e invariantes de compra. |
| **Pasarela Dual de WhatsApp** | [`backend_api/src/services/whatsappGateway.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/src/services/whatsappGateway.js) | Abstracción que enruta mensajes hacia Meta Cloud API (Graph v21.0) o Evolution API de forma transparente. |
| **Aislamiento Multitenant de WebSockets** | [`backend_api/server.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/server.js#L174-L235) | Autenticación estricta por JWT en Socket.IO con unión obligatoria a salas `tenant:${tenantId}`. |
| **Esquema de Base de Datos** | [`backend_api/prisma/schema.prisma`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/prisma/schema.prisma) | 16 modelos relacionales optimizados para multitenencia, pedidos, telemetría de IA y seguimiento. |
| **Batería de Pruebas Offline ($0.00)** | [`backend_api/qa/runner.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/qa/runner.js) | Runner con Network Guard que intercepta llamadas salientes para ejecutar pruebas deterministas sin costo. |

---

## 3. Cómo Ejecutar el Proyecto en Modo Desarrollo (5 Comandos)

### Requisitos Previos
* Node.js 20 LTS instalado.
* Docker y Docker Compose activos.

### Paso a Paso
```bash
# 1. Clonar el repositorio e instalar dependencias
cd Dashboard_SuperAdmin
npm install
cd backend_api && npm install && cd ..

# 2. Levantar la base de datos y Evolution API en Docker
docker compose up -d

# 3. Aplicar migraciones a la base de datos local
cd backend_api
npx prisma generate
npx prisma migrate deploy
cd ..

# 4. Iniciar el Backend API (Puerto 3000)
cd backend_api && npm run dev &

# 5. Iniciar el Frontend Vite (Puerto 5173)
npm run dev
```

Abra `http://localhost:5173` en su navegador para acceder a la aplicación.

---

## 4. Ejecutar la Batería de Pruebas (Zero-Cost QA)

Para verificar que la lógica transaccional, los modelos de autoridad y el aislamiento multitenant funcionan correctamente:

```bash
# Desde la raíz del proyecto
npm run qa
```
El **Network Guard** interceptará automáticamente cualquier intento de llamada externa a Gemini, Groq, Evolution o Stripe, ejecutando la suite completa en segundos con un costo de $0.00.

---

## 5. Próximos Pasos Recomendados tras la Adquisición

1. **Reemplazar el modal de pago manual por Stripe Checkout:** Conectar el webhook de suscripciones automáticas.
2. **Modularizar `whatsappController.js`:** Separar el archivo de 5,748 líneas en controladores desacoplados.
3. **Desplegar en su propio VPS:** Siguiendo [`DEPLOYMENT_RUNBOOK.md`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/docs/acquisition/DEPLOYMENT_RUNBOOK.md) con sus propios dominios y claves maestras.
