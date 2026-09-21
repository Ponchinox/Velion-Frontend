# Velion Agent — Asset Transfer & Handover Protocol

**Lista de Verificación y Procedimiento de Independización Técnica (M&A)**  
**Objetivo:** Garantizar que la empresa compradora asuma el control operativo de Velion Agent sin retener dependencias operativas, financieras o técnicas con el vendedor.  

---

## 1. Clasificación de Activos en el Proceso de Transferencia

### A. Activos Transferibles Directamente (Propiedad Intelectual y Código)
* Repositorio de código fuente completo (Frontend en React + Vite y Backend en Node.js 20 LTS).
* Esquema relacional de base de datos (`schema.prisma`) con baseline congelado y migraciones inmutables.
* Código fuente de Dockerfiles e infraestructura contenerizada de Evolution API / Baileys.
* Suite de pruebas automatizadas y QA Runner con Network Guard (51 suites, 0 costos de API).
* Manuales de arquitectura, diagramas, especificaciones OpenAPI y runbooks de despliegue.

### B. Activos que Requieren Migración o Creación de Cuentas por el Comprador
Los siguientes servicios están vinculados a cuentas de terceros o credenciales del propietario anterior y deben ser dados de alta por el comprador:
* **Infraestructura VPS:** Servidor Linux nuevo en el proveedor del comprador (Hetzner, DigitalOcean, AWS, OVH o Linode).
* **Nombres de Dominio:** Gestión DNS de los dominios corporativos (`app.tuempresa.com` y `api.tuempresa.com`).
* **Meta for Developers:** Cuenta de Meta Business Suite y Facebook App ID para WhatsApp Cloud API.
* **Shopify Partners:** Cuenta de desarrollador en `partners.shopify.com` y registro de la aplicación Shopify.
* **Proveedores de IA:** Cuentas de facturación en Google Cloud (Gemini) y Groq Cloud (Llama 3.3).
* **Pasarela de Pagos:** Cuenta corporativa en Stripe (opcional para suscripciones automatizadas).
* **Organización en GitHub:** Repositorio privado en la cuenta del comprador.

---

## 2. Gestión de Llaves Criptográficas y Cifrado (Encryption Keys)

La seguridad de las credenciales de inquilinos y copias de seguridad depende de dos llaves criptográficas críticas:

### Distinción Clave de Traspaso:
1. **Venta de Código Nuevo (Greenfield / Instalación Limpia)**:
   - El comprador genera una nueva `TOKEN_ENCRYPTION_KEY` y una nueva `BACKUP_ENCRYPTION_KEY`.
   - Ningún dato histórico requiere descifrado.
2. **Transferencia de Instalación Existente (Con Datos Reales de Clientes / Base de Datos)**:
   - **`TOKEN_ENCRYPTION_KEY`**: Es la llave AES-256-GCM utilizada para cifrar tokens de Shopify y Meta en la tabla `Integration`. Debe transferirse exclusivamente por un canal seguro fuera de banda (ej: 1Password, Bitwarden o clave PGP). Si la llave se pierde o regenera, todos los tenants existentes deberán reconectar manualmente sus integraciones OAuth.
   - **`BACKUP_ENCRYPTION_KEY`**: Necesaria para descifrar copias de seguridad históricas generadas por el programador de backups.
   - **REGLA ABSOLUTA**: Nunca almacenar ni transmitir llaves de cifrado en repositorios Git, correos electrónicos en texto plano ni documentación pública.

---

## 3. Inventario Crítico de Secretos que DEBEN Regenerarse

Por estrictas razones de seguridad y cumplimiento (Compliance), el comprador **NUNCA debe reutilizar los secretos de infraestructura del vendedor**:

| Secreto / Variable | Motivo de Regeneración | Cómo Generarlo en Linux |
| :--- | :--- | :--- |
| `JWT_SECRET` | Invalida todas las sesiones anteriores activas. | `openssl rand -hex 32` |
| `TOKEN_ENCRYPTION_KEY` | Llave AES-256-GCM para tokens de integración en BD. | `openssl rand -hex 32` |
| `BACKUP_ENCRYPTION_KEY`| Llave de cifrado para respaldos de base de datos. | `openssl rand -hex 32` |
| `MEDIA_TOKEN_SECRET` | Firma HMAC para streaming de audios/fotos privadas. | `openssl rand -hex 32` |
| `BOT_SECRET` | Llave interna entre microservicios y bot. | `openssl rand -hex 16` |
| `EVOLUTION_API_KEY` | Clave API de comunicación con Evolution API. | `uuidgen` |
| `DATABASE_PASSWORD` | Contraseña del usuario PostgreSQL de producción. | `openssl rand -base64 24` |
| `SUPERADMIN_PASSWORD` | Contraseña de acceso inicial al panel maestro. | Generada por el comprador |

---

## 4. Protocolo de Transferencia Paso a Paso (Zero-Dependency)

### Paso 1: Traspaso del Repositorio de Código (GitHub)
1. El comprador crea una organización o repositorio privado en GitHub (ej. `github.com/CompradorCorp/velion-platform`).
2. El vendedor transfiere la propiedad del repositorio o el comprador clona un *mirror* limpio:
   ```bash
   git clone --bare <URL_ORIGINAL_DEL_REPOSITORIO>
   cd Velion-Frontend.git
   git push --mirror https://github.com/CompradorCorp/velion-platform.git
   ```
3. El vendedor revoca todos los colaboradores y claves SSH asociadas a su cuenta personal.

### Paso 2: Aprovisionamiento del Nuevo Servidor VPS
1. El comprador contrata un VPS (Ubuntu 22.04 LTS o 24.04 LTS) con mínimo 2 vCPU y 4 GB de RAM (recomendado: 4 vCPU / 8 GB RAM).
2. Apunta los registros DNS de sus dominios a la nueva IP pública:
   - `A app.tuempresa.com -> IP_DEL_NUEVO_VPS`
   - `A api.tuempresa.com -> IP_DEL_NUEVO_VPS`
3. Ejecuta el runbook de instalación ([`DEPLOYMENT_RUNBOOK.md`](DEPLOYMENT_RUNBOOK.md)).

### Paso 3: Migración Segura de Base de Datos y Medios
1. En el servidor del vendedor, se genera un volcado binario comprimido de PostgreSQL:
   ```bash
   sudo -u postgres pg_dump -Fc velion_db > velion_migration.dump
   ```
2. Transferir el archivo vía canal cifrado seguro (`scp` / `sftp`):
   ```bash
   scp velion_migration.dump usuario@api.tuempresa.com:/tmp/
   ```
3. En el servidor nuevo, restaurar la base de datos de manera limpia:
   ```bash
   sudo -u postgres pg_restore -d velion_db --clean --if-exists /tmp/velion_migration.dump
   ```
4. Transferir los directorios persistentes de medios y restaurar permisos:
   - `/var/www/velion-media` (Catálogo público): `chown -R www-data:www-data`, `chmod 2755`
   - `/var/lib/velion-inbound-media` (Audios/Fotos privadas de WhatsApp): `chown -R www-data:www-data`, `chmod 2750`

### Paso 4: Configuración de Integración con Shopify
1. El comprador crea o ingresa a su cuenta en [Shopify Partners](https://partners.shopify.com).
2. Crea una aplicación Shopify para conectar con Velion.
3. Configura la URL de callback oficial en Shopify Partners:
   `https://api.tuempresa.com/api/integrations/shopify/callback`
4. Inyecta `SHOPIFY_CLIENT_ID` y `SHOPIFY_CLIENT_SECRET` en el archivo `.env` del backend.
5. **Estado de Capacidades Comerciales Shopify**:
   - *Catálogo y Sincronización*: Completamente operativos en desarrollo y producción.
   - *Shopify PCD (Protected Customer Data)*: Pendiente de solicitud por el comprador ante Shopify Partners si desea crear Draft Orders con datos de clientes en vivo.
   - *Shopify Distribution*: Pendiente de selección por el comprador (Custom Distribution vs Public App Store).

### Paso 5: Configuración de Meta WhatsApp Cloud API
1. El comprador ingresa a su propio Meta Business Manager y crea una Facebook App de tipo Business.
2. Configura el Webhook apuntando a `https://api.tuempresa.com/api/whatsapp/meta/webhook`.
3. Inyecta `META_APP_ID`, `META_APP_SECRET`, `META_EMBEDDED_SIGNUP_CONFIG_ID` y `META_WEBHOOK_VERIFY_TOKEN` en su archivo `.env`.

### Paso 6: Configuración Comercial y Cobros
1. No existen datos personales quemados en el código. Las instrucciones de pago (cuentas bancarias, Yape, Plin) se configuran de forma dinámica y centralizada desde la pantalla de Configuración del SuperAdmin (`/admin-config`).
2. Opcionalmente, para cobros automatizados con tarjeta de crédito, configurar `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` en `.env`.

### Paso 7: Validación de Configuración (Config Check)
Antes de iniciar servicios en producción, ejecutar la auditoría de variables:
```bash
cd /var/www/velion-platform/backend_api
npm run config:check
```
Debe verificar que las variables requeridas están en estado `OK` sin arrojar errores críticos.

### Paso 8: Prueba Final de Transferibilidad (Sign-Off Test)
Para verificar que la transferencia ha concluido satisfactoriamente:
1. Apagar el servidor VPS antiguo del vendedor durante 48 horas.
2. Verificar que:
   - El frontend responde en `https://app.tuempresa.com`.
   - `/ping` y `/api/health` devuelven status `200 OK`.
   - Los webhooks de Meta y Evolution se procesan sin errores en `https://api.tuempresa.com`.
   - La IA responde fluidamente utilizando las claves de Gemini y Groq del comprador.
   - El arnés de QA ejecuta limpiamente: `npm run qa` (51/51 PASS).
3. Firma del acta formal de entrega técnica de software.
