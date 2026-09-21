# Velion Agent — Information Security & Threat Mitigation Specification

**Documento de Evaluación de Seguridad de la Información y Arquitectura Defensiva**  
**Estándar de Referencia:** OWASP Top 10 & Mejores Prácticas de Ciberseguridad en SaaS B2B  

---

## 1. Autenticación y Control de Acceso Basado en Roles (RBAC)

Velion Agent implementa un esquema de autenticación centralizado basado en **JSON Web Tokens (JWT)**:

### 1.1. Estructura y Validación del Token
* **Algoritmo:** HMAC-SHA256 (`HS256`).
* **Carga Útil (*Payload*):** Identificador de usuario (`userId`), correo electrónico (`email`), rol (`role`: `'client'` o `'superadmin'`) e identificador de empresa inquilina (`tenantId`).
* **Validación Obligatoria:** El middleware [`authMiddleware.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/src/middlewares/authMiddleware.js) intercepta todas las rutas protegidas, verificando la firma con `JWT_SECRET` y descartando peticiones expiradas o alteradas.

### 1.2. Modo Soporte Seguro (Impersonación de Inquilinos)
Para tareas de soporte técnico a clientes, la plataforma no utiliza contraseñas compartidas ni puertas traseras:
* Un usuario con rol `superadmin` puede enviar la cabecera `X-Tenant-Id: <ID_DEL_TENANT>`.
* El backend valida que el emisor sea un SuperAdmin verificado y reasigna el contexto de ejecución al cliente impersonado.
* Si un usuario normal (`client`) intenta enviar la cabecera `X-Tenant-Id`, el middleware la ignora completamente, garantizando que nadie pueda acceder a datos de otro inquilino.

---

## 2. Aislamiento Multitenant en WebSockets y Base de Datos

### 2.1. Aislamiento Criptográfico en Socket.IO
En [`server.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/server.js) (líneas 174-239), la conexión a WebSockets cuenta con un guardia estricto:
1. El cliente debe enviar un JWT válido en el handshake (`auth.token` o cabecera `Authorization`).
2. Conexión sin token o con token expirado -> **Rechazo inmediato** (`next(new Error('Authentication error'))`).
3. El socket se une exclusivamente a la sala correspondiente a su inquilino:
   ```javascript
   const roomName = `tenant:${socket.tenantId}`;
   socket.join(roomName);
   ```
4. El servidor emite eventos (mensajes entrantes, notas, estados) únicamente hacia `io.to('tenant:' + tenantId)`. Ningún cliente puede escuchar tráfico de otra empresa.

### 2.2. Aislamiento en la Capa de Datos
Todas las consultas de lectura, escritura y borrado en Prisma ORM incluyen obligatoriamente el filtro `where: { tenantId }`, previniendo vulnerabilidades de referencia directa insegura de objetos (IDOR).

---

## 3. Cifrado de Credenciales en Reposo (AES-256-GCM)

Las credenciales sensibles de terceros (como el `metaAccessToken` de WhatsApp Cloud API) no se guardan en texto plano en la base de datos:

* **Módulo:** [`backend_api/src/utils/cryptoUtils.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/src/utils/cryptoUtils.js).
* **Algoritmo:** Cifrado autenticado **AES-256-GCM** (Galois/Counter Mode).
* **Estructura Cifrada:** `iv:authTag:encryptedData` (codificado en hexadecimal).
* **Derivación de Llave:** Clave de 32 bytes (256 bits) derivada criptográficamente mediante SHA-256 a partir de `TOKEN_ENCRYPTION_KEY`.
* **Integridad Garantizada:** El `authTag` de 16 bytes previene ataques de manipulación o corrupción de datos cifrados.

---

## 4. Verificación Criptográfica de Webhooks de Meta (HMAC-SHA256)

Los webhooks públicos de Meta reciben tráfico externo masivo y son un vector habitual de inyección si no se validan:

* **Módulo:** [`backend_api/src/middlewares/metaWebhookAuth.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/src/middlewares/metaWebhookAuth.js).
* **Mecanismo:** Meta envía la cabecera `X-Hub-Signature-256: sha256=<hash>`.
* **Protección contra Ataques de Temporización (*Timing Attacks*):** El middleware recalcula el HMAC-SHA256 sobre el búfer crudo del cuerpo (`req.rawBody`) utilizando `META_APP_SECRET` y compara los búferes mediante:
  ```javascript
  crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  ```
* **Principio Fail-Closed:** Si falta el cuerpo crudo, si falta el secreto en `.env`, o si la firma no coincide, la petición es rechazada de inmediato con código HTTP `401 Unauthorized` sin procesar el contenido.

---

## 5. Aislamiento de Medios Privados y Tokens Efímeros

A diferencia de los archivos públicos de catálogo, los audios de voz y las imágenes enviadas por los usuarios a través de WhatsApp contienen información personal protegida:

1. **Ubicación Física Segura:** Los archivos se almacenan en `/var/lib/velion-inbound-media`, directorio ubicado **completamente fuera de la raíz web de Nginx** (`/var/www/`). Es imposible acceder a ellos por URL directa o adivinanza de nombres.
2. **Tokens de Acceso de Corta Duración:** Para reproducir un audio en el LiveChat:
   - El frontend solicita un token específico: `GET /api/chats/media-token/:messageId`.
   - El backend emite un token JWT con vigencia estricta de **5 minutos**, acotado exclusivamente al `messageId` y al `tenantId` solicitante (`purpose: 'chat_media'`).
   - El streaming (`GET /api/chats/media/:messageId`) valida la firma del token antes de entregar los bytes del archivo ([`mediaAuthMiddleware.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/src/middlewares/mediaAuthMiddleware.js)).

---

## 6. Prevención de Salto de Directorio (*Path Traversal*)

En la subida de archivos multimedia de catálogo ([`uploadMiddleware.js`](file:///c:/Users/UserHp/Documents/Dashboard_SuperAdmin/backend_api/src/middlewares/uploadMiddleware.js)), la función `ensurePublicMediaDir`:
* Resuelve la ruta canónica absoluta (`path.resolve`).
* Verifica deterministamente que la ruta de destino resida dentro de `MEDIA_ROOT`.
* Si detecta secuencias `../` o rutas fuera de la raíz permitida, interrumpe el proceso lanzando una excepción de seguridad.
* Fija permisos estrictos (`mode: 0o2755`) con `umask 0027`, garantizando que ningún usuario no autorizado pueda escribir en el directorio.

---

## 7. Anonimización y Redacción de Datos Financieros

Para prevenir fugas de información hacia los proveedores de Inteligencia Artificial (Google o Groq), el sistema cuenta con patrones de redacción preventiva en el texto del usuario:
* Detección y censura de números de tarjetas de crédito y variantes de códigos de seguridad CVV/CVC antes de construir los prompts enviados a los modelos de lenguaje.

---

## 8. Políticas de Limitación de Tasa (*Rate Limiting*)

* **Endpoint de Autenticación (`/api/auth`):** Máximo 20 intentos por IP cada 15 minutos, mitigando ataques de fuerza bruta contra credenciales de usuarios.
* **API General (`/api/*`):** Máximo 300 peticiones por IP cada 15 minutos.
* **Exclusión Segura:** Los webhooks de mensajería (`/webhook`) y las rutas internas de clúster (`/api/internal`) están exentos del limitador para impedir que ráfagas legítimas de WhatsApp sean descartadas.

---

## 9. Riesgos Residuales y Plan de Rotación Post-Adquisición

| Riesgo Detectado | Nivel de Riesgo | Acción Obligatoria en la Adquisición |
| :--- | :---: | :--- |
| **Credenciales en `.env` local del repositorio** | Alto | El comprador debe generar nuevos secretos maestros (`JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, contraseñas de BD) y eliminar los archivos locales heredados. |
| **Ausencia de MFA en SuperAdmin** | Medio | Programar en el roadmap la inclusión de TOTP / autenticación en dos pasos para cuentas con privilegios de SuperAdmin. |
| **Validaciones Manuales en Controladores** | Bajo / Medio | Introducir esquemas tipados con Zod para el saneamiento formal de los cuerpos de petición HTTP. |
