# Velion Agent — Multi-Tenant AI Agent & WhatsApp Commerce Platform

Velion es una plataforma SaaS B2B empresarial de automatización comercial, atención inteligente al cliente e integración omnicanal. Diseñada para comercios y empresas de alto volumen, unifica la mensajería de **WhatsApp (Meta Cloud API oficial y Evolution API / Baileys)**, un **Cerebro de Inteligencia Artificial híbrido (Google Gemini + Groq Llama)**, gestión de inventario y pedidos nativos, y sincronización profunda con **Shopify**.

---

## 🏛️ Arquitectura General

```
                          [ Clientes Finales ]
                                   │  (WhatsApp)
                                   ▼
             ┌───────────────────────────────────────────┐
             │    Meta Cloud API  /  Evolution API       │
             └─────────────────────┬─────────────────────┘
                                   │  Webhooks / REST
                                   ▼
             ┌───────────────────────────────────────────┐
             │            Nginx Reverse Proxy            │
             │   (TLS 1.3, Rate Limiting, Static Assets) │
             └──────────────┬──────────────────┬─────────┘
                            │                  │
               /api, /socket.io                / (SPA Bundle)
                            ▼                  ▼
             ┌───────────────────────┐   ┌───────────────┐
             │   Velion Backend API  │   │   Frontend    │
             │ (Node.js 20 LTS, PM2) │   │ (React + Vite)│
             └──────────────┬────────┘   └───────────────┘
                            │
               Prisma ORM   │  AES-256-GCM
                            ▼
             ┌───────────────────────────────────────────┐
             │           PostgreSQL 15 (ACID)            │
             │ Multi-Tenant Isolation (req.user.tenantId)│
             └───────────────────────────────────────────┘
```

---

## 📦 Módulos Principales

1. **Dashboard Empresarial & RBAC**:
   - Vistas segregadas para **SuperAdmin** (control global de empresas, métricas, planes y backups) y **Merchant Tenants** (operaciones comerciales, métricas de ventas y configuración de tienda).
2. **Centro de Mensajes & Live Chat**:
   - Bandeja de entrada en tiempo real (WebSockets / Socket.IO) con soporte de handoff humano, bloqueo y reanudación de bot, y visor multimedia.
3. **Cerebro de IA & Fallback de Alta Disponibilidad**:
   - Orquestador de IA multimodelo con primary en **Google Gemini** y fallback de circuito cerrado en **Groq (Llama 3.3)** con control estricto de cuota (Zero-Cost Network Guard).
4. **Motor de Campañas y Difusiones (V2)**:
   - Envío masivo programado, recurrente y segmentado con rate limiting anti-bloqueo y deduplicación a nivel de base de datos.
5. **Secuencias de Seguimiento Automatizado (V1)**:
   - Motor de reactivación y nurturing post-venta con cancelación automática ante pagos o desinterés del cliente.
6. **Hub de Integraciones**:
   - **Shopify**: Flujo oficial OAuth, sincronización bidireccional de catálogo, resolución comercial híbrida (`VELION_ONLY`, `SHOPIFY_ONLY`, `COMBINED`) y pedidos externos.
   - **WhatsApp Meta Cloud API**: Integración oficial directa con soporte de Embedded Signup.
   - **Evolution API**: Instancias locales mediante código QR para líneas comerciales estándar.
7. **Gestión de Pedidos & Checkout**:
   - Registro unificado de órdenes de compra, items y variantes con pasarela a checkout seguro de Shopify.

---

## 🛠️ Stack Tecnológico

| Capa | Tecnologías |
| :--- | :--- |
| **Frontend** | React 18, Vite, Tailwind CSS, Phosphor Icons |
| **Backend** | Node.js 20 LTS (ES Modules), Express, Socket.IO |
| **Persistencia** | PostgreSQL 15, Prisma ORM 5.22 |
| **Seguridad** | Cifrado AES-256-GCM, BCrypt, JWT, UFW, Helmet, Rate-Limit |
| **Contenedores** | Docker, Docker Compose (Evolution API & PostgreSQL) |
| **Gestor de Procesos** | PM2 (Singleton worker architecture) |

---

## 🚀 Arranque y Desarrollo Local

### 1. Requisitos Previos
- **Node.js**: v20 LTS o superior
- **PostgreSQL**: v15 o superior (local o vía Docker)
- **Git**

### 2. Configuración del Backend
```bash
cd backend_api

# 1. Copiar archivo de entorno base
cp .env.example .env

# 2. Instalar dependencias
npm install

# 3. Generar cliente de base de datos
npx prisma generate

# 4. Inicializar base de datos:
# Si es una base de datos nueva/vacía:
npm run db:bootstrap

# Si es una base de datos con migraciones existentes:
npx prisma migrate deploy

# 5. Sembrar planes y usuario SuperAdmin inicial:
npm run seed
node prisma/seed_plans.js

# 6. Validar que la configuración esté completa y segura:
npm run config:check

# 7. Iniciar el servidor backend en desarrollo:
npm run dev
```

### 3. Configuración del Frontend
```bash
# Desde la raíz del proyecto
npm install

# Iniciar servidor de desarrollo de Vite (http://localhost:5173)
npm run dev
```

---

## 🛡️ Verificación y Pruebas Automatizadas

El proyecto cuenta con un arnés de pruebas automatizadas que opera con cero costo de API (S/0.00) mediante aislamiento seguro de red:

```bash
# Ejecutar suite completa de QA del backend (51 suites, 0 costos de API)
cd backend_api
npm run qa

# Compilar bundle estático de producción del frontend
cd ..
npm run build
```

---

## 🚢 Despliegue en Producción

El modelo de producción de Velion está optimizado para un **servidor Linux VPS (Ubuntu 22.04/24.04 LTS)** utilizando **Nginx** como proxy inverso y terminador TLS, y **PM2** como orquestador de procesos Node.js.

- Configuración PM2 lista para producción: `backend_api/ecosystem.config.cjs`
- Procedimiento paso a paso detallado: [DEPLOYMENT_RUNBOOK.md](docs/acquisition/DEPLOYMENT_RUNBOOK.md)

---

## 📚 Documentación para Adquisición y Transferencia

Para el equipo de ingeniería y due diligence del comprador, la documentación técnica exhaustiva se encuentra organizada en `docs/acquisition/`:

| Documento | Descripción |
| :--- | :--- |
| 📖 [EXECUTIVE_OVERVIEW.md](docs/acquisition/EXECUTIVE_OVERVIEW.md) | Resumen ejecutivo del software y propuesta de valor comercial. |
| 🏗️ [ARCHITECTURE.md](docs/acquisition/ARCHITECTURE.md) | Diagramas de flujo, diseño de base de datos y patrones de seguridad. |
| 🚀 [DEPLOYMENT_RUNBOOK.md](docs/acquisition/DEPLOYMENT_RUNBOOK.md) | Guía completa de instalación y aprovisionamiento en servidor virgen. |
| 🔌 [API_REFERENCE.md](docs/acquisition/API_REFERENCE.md) | Referencia exhaustiva de endpoints REST y especificación OpenAPI. |
| ⚙️ [ENVIRONMENT_VARIABLES.md](docs/acquisition/ENVIRONMENT_VARIABLES.md) | Diccionario de todas las variables de entorno soportadas y sus defaults. |
| 🔒 [SECURITY_OVERVIEW.md](docs/acquisition/SECURITY_OVERVIEW.md) | Modelo de aislamiento multi-tenant, sanitización y cifrado de datos. |
| 📋 [TRANSFER_CHECKLIST.md](docs/acquisition/TRANSFER_CHECKLIST.md) | Lista de verificación para el traspaso de credenciales y ownership. |
| ⚠️ [KNOWN_LIMITATIONS.md](docs/acquisition/KNOWN_LIMITATIONS.md) | Divulgación transparente de deudas técnicas resueltas y roadmap. |
