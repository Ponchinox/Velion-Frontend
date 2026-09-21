# Velion Agent — Demo Tenant Deployment Checklist

**Procedimiento Técnico Paso a Paso para la Preparación del Entorno Demo**  
**Estado:** Guía de Aprovisionamiento (Lista para ejecución bajo aprobación)  
**Entorno de Destino:** Servidor de Producción con Aislamiento Estricto de Tenant  

---

## 1. Parámetros del Tenant de Demostración

| Parámetro | Valor de Configuración de Prueba |
| :--- | :--- |
| **Nombre de la Empresa Demo** | `NovaTech Electronics Demo` |
| **Giro Comercial / Sector** | E-commerce de Tecnología y Audio |
| **Correo del Usuario Demo** | `evaluacion.wallpay@veliondemo.internal` |
| **Contraseña Temporal** | Generada aleatoriamente (ej. `WallpayDemo_2026!Exp`) |
| **Rol en el Sistema** | `client` (Acceso exclusivo a su propio espacio de inquilino) |
| **Plan Asignado** | `Plan Empresarial Demo` (Todas las features activas, límite 5,000 msgs) |
| **Tiempo de Expiración** | **48 horas** a partir del momento de entrega |

---

## 2. Paso a Paso para el Aprovisionamiento

### Paso 1: Creación del Tenant y Usuario Demo en Base de Datos
Desde la consola del servidor o mediante el script seguro de inicialización (sin exponer comandos destructivos):
1. Insertar registro en la tabla `Tenant`:
   - `id`: Generado con UUID.
   - `name`: `"NovaTech Electronics Demo"`.
   - `companyName`: `"NovaTech Retail SAC"`.
   - `customPrompt`: `"Eres el asistente oficial de ventas de NovaTech Electronics. Respondes con amabilidad, precisión y brevedad sobre nuestros auriculares y altavoces. Si te piden fotos o videos, ofreces despacharlos inmediatamente."`
   - `businessHours`: `"Lunes a Sábado de 09:00 a 19:00"`.
   - `termsAndPolicies`: `"Envíos a todo el país en 24-48 horas. Garantía oficial de 12 meses."`.
   - `bankAccounts`: `null` (dejar vacío deliberadamente para que el modelo de autoridad demuestre cómo neutraliza alucinaciones de pago si el cliente intenta forzar un depósito).
   - `followUpEnabled`: `true`.
   - `followUpDecisionMode`: `"ENFORCE"`.
   - `timezone`: `"America/Lima"`.
2. Insertar registro en la tabla `User`:
   - `email`: `"evaluacion.wallpay@veliondemo.internal"`.
   - `password`: Hasheada con `bcryptjs` (cost factor 10).
   - `role`: `"client"`.
   - `tenantId`: Vinculado al UUID del paso 1.

### Paso 2: Inyección de Catálogo de Productos Sintético
Cargar 4 productos emblemáticos en la tabla `Product` vinculados al usuario demo:
1. **Audífonos Inalámbricos NovaPro X:**
   - Precio regular: S/ 189.00 | Precio promocional: S/ 149.00.
   - Categoría: `Audífonos`.
   - Imagen de portada: Foto real de catálogo en `/var/www/velion-media/tenants/<TENANT_ID>/novapro.webp`.
   - Galería: 2 imágenes adicionales de detalle.
   - Video: Clip MP4 de 10 segundos demostrativo.
2. **Altavoz Bluetooth NovaBass Pulse:**
   - Precio regular: S/ 120.00.
   - Categoría: `Altavoces`.
   - Imagen de portada: Foto real de catálogo.
3. **Auriculares Gaming NovaGamer Elite:**
   - Precio regular: S/ 210.00.
   - Categoría: `Audífonos`.
4. **Cargador Rápido GaN 65W:**
   - Precio regular: S/ 75.00.
   - Categoría: `Accesorios`.

> **Propósito Comercial:** Tener dos productos en la categoría `Audífonos` permite demostrar en vivo cómo el **Product Media Orchestrator** detecta la ambigüedad si el usuario escribe "¿tienes audífonos?", preguntando cuál prefiere en lugar de enviar fotos erróneas.

### Paso 3: Vinculación del Canal de WhatsApp para Pruebas
* **Opción Recomendada:** Conectar un número SIM prepago de prueba dedicado a través de Evolution API (escaneando el QR en `/conexiones`).
* **Protección Anti-Mensajes a Terceros:** En el panel de contactos del tenant demo, **no importar ninguna lista de contactos externa**. El bot solo interactuará con los teléfonos de los propios evaluadores de Wallpay cuando estos inicien la conversación voluntariamente.

### Paso 4: Creación de Datos Históricos Simulados para el LiveChat
Para que el evaluador no encuentre un panel vacío:
1. Crear 2 contactos de prueba (`Contacto de Prueba 1`, `Contacto de Prueba 2`).
2. Insertar 4 mensajes simulados en la tabla `Message`:
   - Un hilo completado con un pedido cerrado.
   - Un hilo con intervención humana activa (*human handoff*) para mostrar la etiqueta visual de "Bot Pausado".
3. Insertar 2 ítems en la tabla `OperationalItem`:
   - Una nota operativa: `"Cliente consultó por disponibilidad de color blanco para el viernes."`
   - Una tarea pendiente con vencimiento para el día siguiente: `"Llamar a cliente corporativo para confirmar orden de 10 unidades."`

---

## 3. Verificación de Seguridad y Aislamiento (Audit Checks)

Antes de entregar las credenciales a Wallpay, un ingeniero debe verificar:

* [ ] **Aislamiento en API:** Intentar hacer una petición con el token demo hacia `/api/admin/tenants`. Debe retornar HTTP `403 Forbidden`.
* [ ] **Aislamiento en WebSockets:** Conectarse a Socket.IO con el token demo y verificar que solo reciba eventos dirigidos a la sala `tenant:<DEMO_TENANT_ID>`.
* [ ] **Cero Fuga de Archivos:** Verificar que la carpeta `/var/www/velion-media/tenants/<DEMO_TENANT_ID>` solo contenga las imágenes de prueba y ninguna de clientes reales.
* [ ] **Limitador de Tasa Activo:** Rate limiting verificado en `/api/auth/login` (máx 20 intentos).

---

## 4. Procedimiento de Revocación y Cierre de la Demo

Transcurridas las 48 horas de evaluación o al concluir la etapa de prueba:

1. **Desactivar el Tenant:**
   ```sql
   UPDATE "Tenant" SET active = false WHERE id = '<DEMO_TENANT_ID>';
   ```
2. **Invalidar Contraseña:**
   ```sql
   UPDATE "User" SET password = '<HASH_INVALIDO_INACCESIBLE>' WHERE email = 'evaluacion.wallpay@veliondemo.internal';
   ```
3. **Desconectar la Sesión de WhatsApp:**
   Cerrar la sesión de Evolution API asociada a la instancia demo.
4. **Limpieza de Archivos de Prueba:**
   Eliminar la subcarpeta de medios `/var/www/velion-media/tenants/<DEMO_TENANT_ID>`.

---

## 5. Checklist PASS / FAIL para Despliegue de Demo

| Verificación Técnica | Criterio de Aceptación | Estado |
| :--- | :--- | :---: |
| **Login Web** | Usuario demo ingresa a `https://app.tuempresa.com/login` y carga el dashboard sin errores. | PASS / FAIL |
| **Respuesta de IA** | Al escribirle desde WhatsApp al número demo, responde en menos de 3 segundos con Gemini Flash. | PASS / FAIL |
| **Envío de Fotos** | Al pedir "fotos del NovaPro", despacha la imagen real de catálogo por WhatsApp. | PASS / FAIL |
| **Modelo de Autoridad** | Al preguntar "¿a qué cuenta te transfiero?", responde verídicamente que no tiene datos de pago registrados. | PASS / FAIL |
| **LiveChat en Tiempo Real** | El mensaje aparece en el panel web simultáneamente vía WebSockets sin recargar. | PASS / FAIL |
| **Pausa de Asesor (Handoff)** | Al pulsar "Pausar Bot", el bot guarda silencio y el operador puede chatear manualmente. | PASS / FAIL |
| **Aislamiento de Privilegios** | El usuario no puede ver la barra ni los menús de SuperAdmin (`Admin Empresas`, `Backups`, etc.). | PASS / FAIL |
