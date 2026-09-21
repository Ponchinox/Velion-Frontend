# Velion Agent — Environment Variables Specification

**Catálogo Maestro de Variables de Configuración**  
**Seguridad:** Todos los valores mostrados en este documento son **EJEMPLOS FICTICIOS Y SEGUROS**. Nunca introduzca credenciales reales en este archivo.  

---

## 1. Backend API (`backend_api/.env`)

| Variable | Servicio / Propósito | Obligatoria | Valor por Defecto | Ejemplo Seguro Falso |
| :--- | :--- | :---: | :--- | :--- |
| `PORT` | Puerto TCP donde escucha el servidor Express en localhost. | No | `3000` | `3000` |
| `HOST` | Dirección IP de enlace de red para Express. | No | `127.0.0.1` | `127.0.0.1` |
| `DATABASE_URL` | Cadena de conexión JDBC/PostgreSQL para Prisma ORM. | **Sí** | - | `postgresql://velion_admin:Secr3t_Db_Pass@localhost:5432/velion_prod?schema=public` |
| `JWT_SECRET` | Llave secreta para la firma y verificación de tokens de sesión y WebSockets. | **Sí** | - | `c8f3b2a9e1d4f6c7a0b5e8d3f1a2c4e6b7d8f9a0c1e2d3b4a5f6e7c8d9a0b1c2` |
| `TOKEN_ENCRYPTION_KEY` | Llave simétrica de 32 bytes (64 caracteres hex) para cifrar credenciales en reposo (AES-256-GCM) como tokens de Meta. | **Sí** | Fallback a JWT_SECRET | `4a9b2d8f1e3c5a7e0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e` |
| `MEDIA_TOKEN_SECRET` | Llave secreta para firmar tokens JWT de acceso efímero (5 min) a audios/fotos privadas recibidas. | No | Scoped JWT Secret | `7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a` |
| `BOT_SECRET` | Token de cabecera `x-bot-secret` para endpoints internos del sistema (`/api/internal/*`). | **Sí** | - | `internal_cluster_secret_9981a2` |
| `FRONTEND_URL` | URL base del frontend para configurar cabeceras CORS de Express y Socket.IO. | **Sí** | - | `https://app.tuempresa.com` |
| `APP_URL` | URL pública base de la API para generar enlaces canónicos de archivos multimedia públicos. | **Sí** | - | `https://api.tuempresa.com` |
| `LOCAL_MEDIA_ROOT` | Ruta física en el sistema de archivos del servidor para fotos y videos públicos de catálogo. | No | `/var/www/velion-media` | `/var/www/velion-media` |
| `PRIVATE_MEDIA_ROOT` | Ruta física fuera del webroot para almacenar audios y multimedia sensible entrante de usuarios. | No | `/var/lib/velion-inbound-media` | `/var/lib/velion-inbound-media` |
| `EVOLUTION_API_URL` | URL interna para comunicarse con el contenedor Docker de Evolution API. | **Sí** | `http://localhost:8080` | `http://127.0.0.1:8080` |
| `EVOLUTION_API_KEY` | Clave de autenticación API de Evolution API para emitir llamadas salientes y crear instancias. | **Sí** | - | `A1B2C3D4-E5F6-7A8B-9C0D-E1F2A3B4C5D6` |
| `GEMINI_API_KEY` | Clave API principal de Google Gemini (@google/genai). Admite múltiples claves separadas por coma en `SystemConfig`. | **Sí** | - | `AIzaSyFakeKeyExampleForGeminiGoogle01` |
| `GROQ_API_KEY` | Clave API de Groq Cloud para contingencia Nivel 3 (Llama 3.3 70B). | **Sí** | - | `gsk_fakeExampleKeyForGroqCloudFallback998` |
| `GROQ_MODEL` | Identificador del modelo de contingencia en Groq. | No | `llama-3.3-70b-versatile` | `llama-3.3-70b-versatile` |
| `META_APP_ID` | Identificador de la aplicación en Meta for Developers para el Embedded Signup v4. | **Sí** (Si usa Meta) | - | `123456789012345` |
| `META_APP_SECRET` | Secreto de la aplicación Meta para validar la firma HMAC-SHA256 de webhooks y token exchange. | **Sí** (Si usa Meta) | - | `a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6` |
| `META_EMBEDDED_SIGNUP_CONFIG_ID` | Configuration ID de Facebook Login for Business para el flujo guiado de WhatsApp Coexistence. | **Sí** (Si usa Meta) | - | `987654321098765` |
| `META_WEBHOOK_VERIFY_TOKEN` | Token secreto arbitrario registrado en Meta Dashboard para el handshake GET del Webhook. | **Sí** (Si usa Meta) | `velion_meta_verify_2024` | `empresa_verify_token_secure_2026` |
| `META_GRAPH_API_VERSION` | Versión de Meta Graph API utilizada para webhooks y llamadas salientes. | No | `v21.0` | `v21.0` |
| `ENABLE_BACKGROUND_JOBS` | Banderín booleano (`true`/`false`) para habilitar o deshabilitar workers de follow-ups y campañas (ideal `false` en testing). | No | `true` | `true` |

---

## 2. Evolution API (`evolution/.env`)

| Variable | Servicio / Propósito | Obligatoria | Valor por Defecto | Ejemplo Seguro Falso |
| :--- | :--- | :---: | :--- | :--- |
| `PORT` | Puerto donde expone la API el contenedor de Evolution. | No | `8080` | `8080` |
| `AUTHENTICATION_API_KEY` | Clave API maestra que requiere Evolution para recibir peticiones del backend. Debe coincidir con `EVOLUTION_API_KEY`. | **Sí** | - | `A1B2C3D4-E5F6-7A8B-9C0D-E1F2A3B4C5D6` |
| `AUTHENTICATION_TYPE` | Método de autenticación de Evolution. | No | `apikey` | `apikey` |
| `SERVER_URL` | URL base que informa Evolution en sus webhooks. | **Sí** | `http://localhost:8080` | `http://localhost:8080` |
| `POSTGRES_USER` | Usuario de PostgreSQL para el contenedor de base de datos de Evolution (`postgres_evo`). | **Sí** | - | `evo_pg_user` |
| `POSTGRES_PASSWORD` | Contraseña del usuario PostgreSQL de Evolution. | **Sí** | - | `EvoSecurePgPass_2026!` |
| `POSTGRES_DB` | Nombre de la base de datos interna de Evolution. | **Sí** | - | `evolution_instances_db` |
| `DATABASE_PROVIDER` | Motor de base de datos utilizado por Evolution API. | No | `postgresql` | `postgresql` |
| `DATABASE_CONNECTION_URI` | Cadena interna de conexión de Evolution hacia su contenedor de base de datos. | **Sí** | - | `postgresql://evo_pg_user:EvoSecurePgPass_2026!@postgres_evo:5432/evolution_instances_db?schema=public` |
| `REDIS_ENABLED` | Habilita caché externa en Redis. Recomendado `false` a menos que se despliegue cluster multi-servidor. | No | `false` | `false` |
| `CACHE_LOCAL_ENABLED` | Almacenamiento de sesiones de Baileys en memoria local y disco montado. | No | `true` | `true` |

---

## 3. Frontend Web (`.env` o `.env.production`)

| Variable | Servicio / Propósito | Obligatoria | Valor por Defecto | Ejemplo Seguro Falso |
| :--- | :--- | :---: | :--- | :--- |
| `VITE_API_URL` | URL pública base de la API a la que el navegador enviará las peticiones HTTP y WebSockets. | **Sí** | `http://localhost:3000` | `https://api.tuempresa.com` |

---

## 4. Parámetros Almacenados en Base de Datos (`SystemConfig`)

Además de las variables de entorno en disco, Velion Agent gestiona configuraciones dinámicas modificables en caliente por el SuperAdmin desde la interfaz web, almacenadas en la tabla `SystemConfig` de PostgreSQL:

| Clave en BD | Descripción | Valor por Defecto si no existe en BD |
| :--- | :--- | :--- |
| `systemPrompt` | Prompt del sistema maestro global que rige la personalidad del agente de atención. | `Eres un asistente de atención al cliente educado, eficiente y servicial.` |
| `backupFrequency` | Frecuencia del programador de respaldos (`off`, `daily`, `weekly`, `monthly`). | `off` |
| `backupCloudEnabled` | Activa la transmisión de backups a la nube (`true` / `false`). | `false` |
| `backupCloudProvider` | Proveedor de nube para backups (`gdrive`). | `gdrive` |
| `backupGdriveFolderId` | ID de la carpeta en Google Drive donde depositar los archivos `.json` / `.dump`. | Cadena vacía |
| `backupGdriveCredentials` | JSON con credenciales de la Cuenta de Servicio de Google Cloud (*Service Account*). | Cadena vacía |
| `smtpHost` | Servidor SMTP para envío de alertas y notificaciones por correo. | Cadena vacía |
| `smtpPort` | Puerto del servidor SMTP (típicamente `587` o `465`). | `587` |
| `smtpUser` | Usuario o correo de autenticación SMTP. | Cadena vacía |
| `smtpPassword` | Contraseña de aplicación para SMTP. | Cadena vacía |
| `errorWebhook` | URL de Webhook externo (ej. Slack o Discord) para reportar caídas críticas del sistema. | Cadena vacía |
| `aiStatus` | Estado operativo de los motores de IA (`OPERATIVE` o degradado). | `OPERATIVE` |
