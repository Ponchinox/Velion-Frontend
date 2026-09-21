# Velion Agent — Meta WhatsApp Cloud API Integration Guide

**Guía de Aprovisionamiento Oficial de Meta Cloud API & Embedded Signup v4**  
**Público Objetivo:** Ingenieros de Integración y Administradores de Cuentas del Equipo Comprador  

---

## 1. Visión General del Flujo Oficial de Meta

Velion Agent soporta la **API Oficial de WhatsApp Cloud API** mediante el mecanismo moderno de **Embedded Signup v4** con soporte para **WhatsApp Business App Coexistence**.

### Beneficios para el Cliente
* El cliente no pierde su aplicación móvil de WhatsApp Business.
* Conexión oficial autorizada por Meta en 2 minutos sin configuraciones técnicas manuales.
* Token permanente gestionado por el backend con cifrado AES-256-GCM.

---

## 2. Requisitos Previos en Meta for Developers

El equipo comprador debe disponer de una cuenta de **Meta for Developers** vinculada a un **Meta Business Manager** (Portafolio Empresarial) verificado.

### 2.1. Creación de la Aplicación en Meta
1. Ingrese a [Meta for Developers](https://developers.facebook.com/).
2. Haga clic en **Mis Apps** -> **Crear App**.
3. Seleccione el tipo de aplicación: **Empresa** (*Business*).
4. Asigne un nombre comercial a la aplicación (ej. `Velion Agent Core`) y vincúlela a su Portafolio Empresarial.

### 2.2. Agregar el Producto WhatsApp
1. En el panel de control de la app recién creada, localice la tarjeta **WhatsApp** y haga clic en **Configurar**.
2. Acepte los términos de servicio de WhatsApp Business Platform.

### 2.3. Configurar Facebook Login for Business (Embedded Signup)
1. En el menú lateral izquierdo, agregue el producto **Inicio de sesión de Facebook con Facebook Login for Business**.
2. Ingrese a **Facebook Login for Business** -> **Configuraciones**.
3. Cree una **Nueva Configuración de Inicio de Sesión** (*Login Configuration*):
   - **Nombre de configuración:** `Velion WhatsApp Onboarding`.
   - **Permisos requeridos:** Marque obligatoriamente:
     * `whatsapp_business_management`
     * `whatsapp_business_messaging`
   - **Feature Type:** Asegúrese de activar `whatsapp_business_app_onboarding` (Coexistencia).
4. Guarde los cambios y copie el **Configuration ID** generado (numérico, ej. `987654321098765`).

---

## 3. Configuración de Webhooks en Meta Dashboard

Para que los mensajes entrantes de WhatsApp lleguen a Velion:

1. En el menú lateral de la app en Meta, navegue a **WhatsApp** -> **Configuración**.
2. En la sección **Webhook**, haga clic en **Editar**:
   - **URL de devolución de llamada (*Callback URL*):**
     ```
     https://api.tuempresa.com/api/whatsapp/meta/webhook
     ```
   - **Token de verificación (*Verify Token*):**
     Ingrese el mismo valor arbitrario configurado en la variable `META_WEBHOOK_VERIFY_TOKEN` (ej. `empresa_verify_token_secure_2026`).
3. Haga clic en **Verificar y guardar**. Meta emitirá una petición GET al backend de Velion; si el token coincide, confirmará la suscripción con éxito.
4. En la tabla **Campos del Webhook**, suscríbase obligatoriamente al campo:
   - `messages` (Recibe mensajes entrantes, confirmaciones de entrega y estados de lectura).

---

## 4. Obtención de Credenciales Maestras para el Servidor

Desde el App Dashboard de Meta, copie los siguientes valores y colóquelos en el archivo `.env` del backend de Velion:

1. **App ID:** Localizado en la barra superior del panel de la aplicación.
   ```env
   META_APP_ID="123456789012345"
   ```
2. **App Secret:** Navegue a **Configuración de la app** -> **Básica**. Haga clic en "Mostrar" junto a *Clave secreta de la app*.
   ```env
   META_APP_SECRET="a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
   ```
3. **Configuration ID:** El ID copiado en el paso 2.3.
   ```env
   META_EMBEDDED_SIGNUP_CONFIG_ID="987654321098765"
   ```
4. **Verify Token:** El token definido en el paso 3.
   ```env
   META_WEBHOOK_VERIFY_TOKEN="empresa_verify_token_secure_2026"
   META_GRAPH_API_VERSION="v21.0"
   ```

---

## 5. Funcionamiento del Flujo de Vinculación para Clientes

Una vez configurado el servidor, el flujo para un cliente dentro de Velion es 100% automático:

1. El cliente entra a **Conexiones** en la interfaz web de Velion.
2. Selecciona **Vincular con WhatsApp Cloud API Oficial**.
3. El frontend inicializa el SDK oficial de Facebook (`FB.login`) utilizando el `META_APP_ID` y `META_EMBEDDED_SIGNUP_CONFIG_ID`.
4. Se abre una ventana modal emergente oficial de Meta donde el cliente:
   - Inicia sesión con su cuenta de Facebook.
   - Selecciona su cuenta de WhatsApp Business y su número telefónico.
5. Meta devuelve un código de autorización efímero (`code`) al navegador.
6. El frontend envía el `code` a `POST /api/connections/meta/onboarding/callback`.
7. El backend de Velion ejecuta server-side:
   - Intercambio de `code` por Access Token permanente.
   - Suscripción de la WABA del cliente a los webhooks de Velion (`POST /{wabaId}/subscribed_apps`).
   - Cifrado del token con AES-256-GCM y almacenamiento en la tabla `RegisteredWhatsAppNumber`.
8. La conexión pasa a estado `CONNECTED` de inmediato.

---

## 6. Checklist de Verificación de Salud de Meta

* [ ] La app en Meta for Developers está en modo **Activa** (*Live*) o tiene a los usuarios de prueba debidamente asignados.
* [ ] La firma HMAC (`X-Hub-Signature-256`) se valida sin errores en los logs del backend.
* [ ] Al enviar un mensaje de prueba al número oficial, aparece instantáneamente en el LiveChat de Velion.
