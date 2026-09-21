# Velion Agent — Operations & Incident Response Runbook

**Manual de Mantenimiento, Monitoreo y Solución de Incidentes (SRE)**  
**Público Objetivo:** Operadores de Infraestructura, Sysadmins y Soporte Nivel 2/3  

---

## 1. Gestión de Procesos con PM2

El backend de Velion Agent se ejecuta bajo el administrador de procesos **PM2** en el servidor VPS.

### 1.1. Comandos Operativos Esenciales
```bash
# Ver estado de procesos y consumo de memoria/CPU
pm2 status

# Monitoreo interactivo en tiempo real (CPU, RAM, Event Loop)
pm2 monit

# Ver logs consolidados en tiempo real
pm2 logs velion-backend

# Ver últimas 200 líneas de logs sin seguir
pm2 logs velion-backend --lines 200 --nostream

# Reiniciar el backend con recarga suave (Zero-Downtime Reload)
pm2 reload velion-backend

# Reinicio forzado del proceso
pm2 restart velion-backend

# Detener el proceso
pm2 stop velion-backend
```

### 1.2. Rotación de Logs de PM2
Para evitar que los archivos de logs de PM2 saturen el disco, instale el módulo oficial de rotación:
```bash
sudo pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

---

## 2. Administración y Respaldos de PostgreSQL

### 2.1. Generación de Respaldo Manual desde Consola
```bash
# 1. Crear directorio de backups si no existe
mkdir -p /var/backups/velion

# 2. Exportar dump comprimido de la base de datos completa
sudo -u postgres pg_dump -Fc velion_db > /var/backups/velion/velion_backup_$(date +%Y%m%d_%H%M%S).dump

# 3. Exportar dump en texto plano SQL (útil para auditorías de datos)
sudo -u postgres pg_dump velion_db | gzip > /var/backups/velion/velion_backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

### 2.2. Restauración de Base de Datos
Para restaurar la base de datos a partir de un volcado binario (`.dump`):
```bash
# 1. Detener temporalmente el backend para evitar escrituras concurrentes
pm2 stop velion-backend

# 2. Restaurar utilizando pg_restore con limpieza de tablas existentes
sudo -u postgres pg_restore -d velion_db --clean --if-exists /var/backups/velion/velion_backup_TARGET.dump

# 3. Reiniciar el backend
pm2 start velion-backend
```

### 2.3. Mantenimiento y Rendimiento de Base de Datos
Si el volumen de mensajes supera los 100,000 registros al mes:
```bash
# Ejecutar optimización y limpieza de espacio en disco de PostgreSQL
sudo -u postgres vacuumdb -d velion_db -z -v
```

---

## 3. Diagnóstico y Recuperación de Evolution API (WhatsApp QR)

### 3.1. Síntoma: Dispositivo Desconectado o Estado `DISCONNECTED`
Si el número de WhatsApp de un cliente se desvincula por inactividad o cierre de sesión en el teléfono:

1. **Inspeccionar estado en Evolution:**
   ```bash
   curl -s -H "apikey: <TU_EVOLUTION_API_KEY>" http://127.0.0.1:8080/instance/connectionState/bot_prod_<TENANT_ID> | jq
   ```
2. **Generar un nuevo código QR:**
   El operador puede ingresar a la pantalla de **Conexiones** en el frontend de Velion y pulsar "Reconectar", o puede dispararse por terminal:
   ```bash
   curl -s -H "apikey: <TU_EVOLUTION_API_KEY>" http://127.0.0.1:8080/instance/connect/bot_prod_<TENANT_ID> | jq
   ```
3. **Reinicio del Contenedor de Evolution API:**
   Si el contenedor no responde al puerto 8080:
   ```bash
   cd /var/www/velion-platform/evolution
   docker compose restart evolution_api
   docker compose logs --tail=100 evolution_api
   ```

---

## 4. Rotación de Claves API de IA sin Caída de Servicio

### 4.1. Google Gemini
Velion implementa un pool multi-key en caliente. Para rotar o agregar claves:
* **Método 1 (Vía Base de Datos / Panel SuperAdmin):**
  Ingrese al panel `/admin-config` y actualice el campo `geminiKey` con la nueva clave o múltiples claves separadas por coma. El cambio surte efecto inmediato sin reiniciar PM2.
* **Método 2 (Vía Variables de Entorno):**
  Actualice `backend_api/.env` con la nueva `GEMINI_API_KEY` y ejecute:
  ```bash
  pm2 reload velion-backend
  ```

### 4.2. Groq (Fallback Llama 3.3)
Actualice `GROQ_API_KEY` en `backend_api/.env` y ejecute:
```bash
pm2 reload velion-backend
```

---

## 5. Diagnóstico de Webhooks y Conectividad

### 5.1. Diagnóstico de Meta Cloud API
* **Error `401 Unauthorized: signature mismatch`:**
  - Causa: La cabecera `X-Hub-Signature-256` no coincide con el hash calculado sobre el payload.
  - Solución: Verifique que `META_APP_SECRET` en `backend_api/.env` sea exactamente el mismo que figura en el App Dashboard de Meta.
  - Verifique que Nginx no esté modificando ni bufferizando el cuerpo de la petición (`proxy_buffering off;`).
* **Verificación de llegada de eventos desde Meta:**
  ```bash
  sudo tail -f /var/log/nginx/access.log | grep "/api/whatsapp/meta/webhook"
  ```
  Debe retornar códigos HTTP `200` periódicamente.

### 5.2. Diagnóstico de Evolution API
* **Verificar reenvío de webhooks:**
  ```bash
  docker compose -f /var/www/velion-platform/evolution/docker-compose.yml logs -f evolution_api | grep "webhook"
  ```

---

## 6. Mantenimiento del Almacenamiento Multimedia

### 6.1. Monitorización de Espacio en Disco
```bash
# Espacio de imágenes públicas de catálogo
du -sh /var/www/velion-media

# Espacio de audios y fotos privadas de usuarios
du -sh /var/lib/velion-inbound-media

# Espacio global de disco
df -h /
```

### 6.2. Reparación de Permisos de Directorios Públicos
Si las imágenes de catálogo dan error `403 Forbidden` en Nginx:
```bash
# Restablecer permisos seguros (02755 directorios, 0640 archivos)
sudo chown -R www-data:www-data /var/www/velion-media
sudo find /var/www/velion-media -type d -exec chmod 2755 {} +
sudo find /var/www/velion-media -type f -exec chmod 0644 {} +
```

---

## 7. Matriz de Endpoints de Monitoreo (*Healthchecks*)

| Endpoint | Propósito | Frecuencia Sugerida | Acción si Responde != 200 |
| :--- | :--- | :---: | :--- |
| `GET https://api.tuempresa.com/ping` | Verificación de vida de Nginx y Node.js | Cada 30 seg | Reiniciar PM2 / Nginx |
| `GET https://api.tuempresa.com/api/health` | Conectividad viva con PostgreSQL | Cada 1 min | Verificar servicio `postgresql` |
| `GET http://127.0.0.1:8080/` | Salud de Evolution API | Cada 2 min | Reiniciar contenedor Docker |
| `GET https://api.tuempresa.com/api/admin/system-health` | Chequeo integral del SuperAdmin | Diario / En dashboard | Revisar alertas en panel |
