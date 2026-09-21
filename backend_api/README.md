# Velion Backend API — Developer & Operations Guide

API REST, WebSocket y motor de automatización para la plataforma Velion.

---

## 📂 Estructura de Directorios

```
backend_api/
├── prisma/
│   ├── schema.prisma              # Definición de modelos relacionales PostgreSQL
│   ├── baseline/                  # Snapshot SQL congelado para bootstrap inicial
│   ├── migrations/                # Historial inmutable de migraciones Prisma
│   ├── seed.js                    # Semilla idempotente de SuperAdmin inicial
│   └── seed_plans.js              # Semilla idempotente de planes comerciales
├── qa/                            # Arnés de pruebas de QA automatizado (sin costo)
├── scripts/
│   ├── bootstrap_fresh_database.js# Aprovisionamiento seguro de base de datos vacía
│   └── check_config.js            # CLI de auditoría de variables y seguridad
├── src/
│   ├── config/                    # Validadores fail-fast y configuración de red
│   ├── controllers/               # Controladores de endpoints REST
│   ├── middlewares/               # Autenticación JWT, rate limit y guardas de plan
│   ├── routes/                    # Definición y montaje de rutas Express
│   └── services/                  # Lógica de negocio, conectores IA y orquestadores
├── ecosystem.config.cjs           # Configuración PM2 para producción
├── package.json
└── server.js                      # Punto de entrada HTTP y Socket.IO
```

---

## ⚡ Comandos CLI de Desarrollo y Operaciones

| Comando | Descripción |
| :--- | :--- |
| `npm run dev` | Inicia el servidor en modo desarrollo con recarga automática (nodemon). |
| `npm run start` | Inicia el servidor en modo producción con Node.js estándar. |
| `npm run config:check` | Audita la validez de las variables de entorno sin exponer secretos. |
| `npm run qa` | Ejecuta las 51 suites de pruebas de regresión con Network Guard (S/0.00). |
| `npm run db:bootstrap` | Aplica el baseline en una base de datos 100% limpia (solo localhost). |
| `npm run seed` | Aprovisiona el SuperAdmin inicial de forma segura e idempotente. |

---

## 🔒 Reglas de Operación y Seguridad

1. **Aislamiento Multi-Tenant**:
   - Todo acceso a datos de inquilinos debe derivarse estrictamente de `req.user.tenantId` obtenido del JWT validado. Nunca aceptar `tenantId` provisto en el body o querystring.
2. **Cifrado de Credenciales**:
   - `TOKEN_ENCRYPTION_KEY`: Obligatoria en producción para el cifrado AES-256-GCM de tokens de Shopify, Meta y proveedores externos.
3. **Singleton Background Workers**:
   - Los motores de campañas, seguimientos y backups se ejecutan condicionados por `BACKGROUND_JOBS_ENABLED`. En entornos con múltiples réplicas HTTP, solo una instancia debe tener `BACKGROUND_JOBS_ENABLED=true` para evitar duplicación de mensajes salientes.
