# Velion Agent — Deployment & Installation Runbook

**Guía de Instalación y Puesta en Marcha en Servidor Limpio**  
**Público Objetivo:** Ingenieros DevOps / Administradores de Sistemas del Equipo Comprador  
**Sistema Operativo Recomendado:** Ubuntu 22.04 LTS o 24.04 LTS x86_64  

---

## 1. Requisitos Mínimos de Infraestructura

| Recurso | Mínimo Recomendado (Producción Inicial) | Óptimo (Hasta 50 Tenants Activos) |
| :--- | :--- | :--- |
| **CPU** | 2 vCPU (Arquitectura x86_64) | 4 vCPU dedicadas |
| **Memoria RAM** | 4 GB | 8 GB a 16 GB |
| **Almacenamiento** | 40 GB SSD / NVMe | 100 GB NVMe |
| **Red** | IP Pública Estática IPv4 | IP Pública Estática IPv4 + IPv6 |
| **Puertos Abiertos** | 80 (HTTP), 443 (HTTPS), 22 (SSH) | 80, 443, 22 |

> **Nota de Arquitectura:** El puerto `3000` (Backend API) y el puerto `8080` (Evolution API) deben permanecer enlazados exclusivamente a `127.0.0.1` (localhost). Solo Nginx expone los puertos públicos 80 y 443.

---

## 2. Preparación Inicial del Sistema Operativo

Conéctese vía SSH al servidor virgen como usuario `root` o con privilegios `sudo`:

```bash
# 1. Actualizar repositorios y paquetes
sudo apt-get update && sudo apt-get upgrade -y

# 2. Instalar herramientas base
sudo apt-get install -y curl wget git build-essential ufw software-properties-common apt-transport-https ca-certificates gnupg lsb-release

# 3. Configurar zona horaria del servidor
sudo timedatectl set-timezone UTC

# 4. Configurar cortafuegos básico (UFW)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

---

## 3. Instalación de Dependencias del Sistema

### 3.1. Node.js 20 LTS
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Instalar PM2 globalmente
sudo npm install -g pm2
```

### 3.2. Docker y Docker Compose
```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Iniciar y habilitar servicio Docker
sudo systemctl enable --now docker
```

### 3.3. PostgreSQL 15 y Cliente
```bash
sudo apt-get install -y postgresql postgresql-contrib

# Iniciar y habilitar PostgreSQL
sudo systemctl enable --now postgresql
```

### 3.4. Nginx y Certbot
```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo systemctl enable --now nginx
```

---

## 4. Configuración de Base de Datos PostgreSQL

Acceda al intérprete interactivo de PostgreSQL y configure la base de datos de producción:

```bash
sudo -u postgres psql
```

Ejecute las siguientes sentencias SQL (sustituya `<PASSWORD_SEGURO>` por una contraseña aleatoria de 32 caracteres):

```sql
CREATE USER velion_user WITH PASSWORD '<PASSWORD_SEGURO>';
CREATE DATABASE velion_db OWNER velion_user;
GRANT ALL PRIVILEGES ON DATABASE velion_db TO velion_user;

-- Permitir extensiones necesarias
\c velion_db
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\q
```

---

## 5. Configuración de Directorios de Medios y Permisos

Velion maneja dos rutas de almacenamiento segregadas por seguridad:
1. `/var/www/velion-media`: Almacenamiento público para imágenes y videos de catálogo.
2. `/var/lib/velion-inbound-media`: Almacenamiento privado para audios y fotos recibidas de clientes en WhatsApp.

```bash
# 1. Crear directorios
sudo mkdir -p /var/www/velion-media
sudo mkdir -p /var/lib/velion-inbound-media
sudo mkdir -p /var/www/velion-frontend/current

# 2. Configurar permisos con setgid para herencia estricta
# El usuario que ejecuta PM2 (ej. ubuntu o velion) debe ser dueño o pertenecer al grupo
sudo chown -R www-data:www-data /var/www/velion-media
sudo chmod 2755 /var/www/velion-media

sudo chown -R www-data:www-data /var/lib/velion-inbound-media
sudo chmod 2750 /var/lib/velion-inbound-media
```

---

## 6. Clonación del Repositorio y Configuración

Clone el repositorio en el directorio de aplicaciones (ej. `/var/www/velion-platform`):

```bash
sudo mkdir -p /var/www/velion-platform
sudo chown -R $USER:$USER /var/www/velion-platform
cd /var/www/velion-platform

# Clonar código fuente
git clone <URL_DEL_REPOSITORIO> .
```

---

## 7. Despliegue de WhatsApp Evolution API (Docker)

La carpeta `evolution/` contiene la configuración contenerizada de Evolution API con PostgreSQL dedicado para Baileys:

```bash
cd /var/www/velion-platform/evolution

# 1. Crear archivo .env de Evolution API
cat <<EOF > .env
PORT=8080
POSTGRES_USER=evo_user
POSTGRES_PASSWORD=evo_secure_password_123
POSTGRES_DB=evolution_db
AUTHENTICATION_API_KEY=GENERA_UNA_API_KEY_ALEATORIA_UUID
SERVER_URL=http://localhost:8080
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://evo_user:evo_secure_password_123@postgres_evo:5432/evolution_db?schema=public
CACHE_LOCAL_ENABLED=true
REDIS_ENABLED=false
EOF

# 2. Construir la imagen con el parche determinista de Baileys
docker compose build --no-cache

# 3. Levantar los contenedores en segundo plano
docker compose up -d

# 4. Verificar salud del contenedor
docker compose ps
curl -s http://127.0.0.1:8080/
```

---

## 8. Despliegue y Migración del Backend API

```bash
cd /var/www/velion-platform/backend_api

# 1. Instalar dependencias de producción
npm ci --omit=dev

# 2. Configurar variables de entorno
cat <<EOF > .env
PORT=3000
HOST=127.0.0.1
DATABASE_URL="postgresql://velion_user:<PASSWORD_SEGURO>@localhost:5432/velion_db?schema=public"
JWT_SECRET="GENERA_UN_SECRETO_JWT_HEX_DE_64_CARACTERES"
TOKEN_ENCRYPTION_KEY="GENERA_UN_HASH_SHA256_HEX_DE_64_CARACTERES"
MEDIA_TOKEN_SECRET="GENERA_UN_SECRETO_HEX_DE_64_CARACTERES"
BOT_SECRET="GENERA_SECRETO_BOT_INTERNO"
EVOLUTION_API_URL="http://127.0.0.1:8080"
EVOLUTION_API_KEY="MISMA_API_KEY_CONFIGURADA_EN_EVOLUTION"
LOCAL_MEDIA_ROOT="/var/www/velion-media"
PRIVATE_MEDIA_ROOT="/var/lib/velion-inbound-media"
FRONTEND_URL="https://app.tuempresa.com"
APP_URL="https://api.tuempresa.com"
GEMINI_API_KEY="TU_CLAVE_MAESTRA_GOOGLE_GEMINI"
GROQ_API_KEY="TU_CLAVE_GROQ_LLAMA"
EOF

# 3. Generar cliente Prisma y ejecutar migraciones en la base de datos
npx prisma generate
npx prisma migrate deploy

# 4. Sembrar planes comerciales iniciales
node prisma/seed_plans.js

# 5. Iniciar el Backend con PM2 en modo demonio
pm2 start server.js --name "velion-backend" --time
pm2 save
pm2 startup
```

---

## 9. Construcción y Publicación del Frontend

```bash
cd /var/www/velion-platform

# 1. Instalar dependencias del frontend
npm ci

# 2. Configurar variables de compilación de Vite
cat <<EOF > .env.production
VITE_API_URL="https://api.tuempresa.com"
EOF

# 3. Compilar el bundle estático de producción
npm run build

# 4. Mover el bundle compilado al directorio de Nginx
sudo rm -rf /var/www/velion-frontend/current/*
sudo cp -r dist/* /var/www/velion-frontend/current/
sudo chown -R www-data:www-data /var/www/velion-frontend/current
```

---

## 10. Configuración de Nginx y Certificados SSL

Cree el archivo de configuración del sitio en Nginx:

```bash
sudo nano /etc/nginx/sites-available/velion.conf
```

Copie y pegue la configuración optimizada (sustituyendo `app.tuempresa.com` y `api.tuempresa.com` por sus dominios reales):

```nginx
# Map para WebSockets Upgrade
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

# Servidor API & WebSockets & Media
server {
    listen 80;
    server_name api.tuempresa.com app.tuempresa.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.tuempresa.com;

    client_max_body_size 50M;

    # Rutas multimedia públicas
    location /media/ {
        alias /var/www/velion-media/;
        expires 30d;
        add_header Cache-Control "public, no-transform";
        try_files $uri =404;
    }

    # Proxy hacia Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }

    # Proxy hacia WebSockets (Socket.IO)
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    location = /ping {
        proxy_pass http://127.0.0.1:3000/ping;
    }
}

# Servidor Frontend SPA
server {
    listen 443 ssl http2;
    server_name app.tuempresa.com;

    root /var/www/velion-frontend/current;
    index index.html;

    client_max_body_size 10M;

    # Cache inmutable para assets hasheados por Vite
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
        access_log off;
        try_files $uri =404;
    }

    # index.html sin cache para refresco instantáneo de versiones
    location = /index.html {
        expires -1;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # SPA Fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Habilite el sitio y emita los certificados SSL con Certbot:

```bash
sudo ln -sf /etc/nginx/sites-available/velion.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

# Obtener certificados SSL gratuitos de Let's Encrypt
sudo certbot --nginx -d app.tuempresa.com -d api.tuempresa.com --non-interactive --agree-tos -m devops@tuempresa.com
```

---

## 11. Verificación de Funcionamiento (Smoke Tests)

Una vez completado el despliegue, verifique cada capa del sistema:

1. **Ping del Servidor HTTP:**
   ```bash
   curl -I https://api.tuempresa.com/ping
   # Respuesta esperada: HTTP/2 200 OK con texto "pong"
   ```
2. **Healthcheck de Base de Datos y Sistema:**
   ```bash
   curl -s https://api.tuempresa.com/api/health | jq
   # Respuesta esperada: { "status": "ok", "message": "Servidor API Operativo", "database": "Conectado" }
   ```
3. **Estado de Contenedores Docker:**
   ```bash
   docker compose -f /var/www/velion-platform/evolution/docker-compose.yml ps
   # Los servicios evolution_api y postgres_evo deben mostrar estado "Up"
   ```
4. **Estado de Procesos PM2:**
   ```bash
   pm2 status
   # velion-backend debe figurar con status "online" y 0 restarts anómalos
   ```
5. **Carga en el Navegador:**
   Abra `https://app.tuempresa.com` en su navegador. Debe cargar la pantalla de inicio de sesión de Velion Agent con diseño moderno y sin errores de consola JavaScript.
