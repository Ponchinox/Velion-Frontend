# Velion Agent — Known Limitations & Technical Debt Disclosure

**Informe de Transparencia Técnica para Procesos de Adquisición (Due Diligence)**  
**Objetivo:** Proporcionar al equipo técnico comprador un informe verídico, honesto y sustentado en el código sobre las limitaciones reales actuales, deudas de desarrollo resueltas y oportunidades de mejora del software.

---

## RESUMEN DE CLASIFICACIÓN TÉCNICA

- **`FIXED`**: Limitaciones o deudas técnicas resueltas durante el ciclo de endurecimiento previo a la entrega.
- **`KNOWN_LIMITATION`**: Comportamientos conocidos derivados de la arquitectura actual que no impiden la operación.
- **`ROADMAP`**: Mejoras futuras de escala o funcionalidades de autoservicio para etapas posteriores.
- **`NOT_REQUIRED_FOR_CURRENT_OPERATION`**: Aspectos no críticos para la operación actual en single-node.
- **`PENDING_BUYER_DECISION`**: Decisiones comerciales o de registro reservadas al comprador del software.

---

## 1. Facturación y Cobro de Suscripciones Manual
- **CLASIFICACIÓN**: `FIXED` (en cuanto a datos personales en código) / `ROADMAP` (en cuanto a cobro automatizado recurrente por tarjeta).
- **Estado Anterior**: Teléfonos personales quemados en el código de `BillingPage.jsx` y `PlanSelectionPage.jsx`.
- **Estado Actual**: Datos personales completamente erradicados del frontend. El backend sirve la configuración comercial centralizada desde `SystemConfig` (`GET /api/plans/billing-config`). Si no existe configuración, aplica fallback seguro: *"Contacta al administrador para obtener instrucciones de pago."*
- **Oportunidad / Roadmap**: Integrar Stripe Checkout o suscripciones de Mercado Pago conectando el webhook para mutar `prisma.tenant.update({ where: { id: tenantId }, data: { planId } })` de manera 100% autónoma.

---

## 2. Suspensión Real de Inquilinos (Tenant Suspension)
- **CLASIFICACIÓN**: `FIXED`.
- **Estado Anterior**: SuperAdmin modificaba `tenant.active = false`, pero el enforcement era parcial (usuarios podían iniciar sesión, sesiones abiertas seguían funcionando y el bot respondía mensajes entrantes).
- **Estado Actual**: Enforcement total implementado:
  - Login bloqueado (HTTP 403 `TENANT_SUSPENDED`).
  - Sesiones existentes bloqueadas de inmediato en `authMiddleware`.
  - Inbound de WhatsApp ignorado en webhook.
  - Outbound de WhatsApp bloqueado en `sendText` y `sendMedia`.
  - Conexiones de Socket.io rechazadas.
  - Workers en segundo plano (Follow-Ups y Campañas) omiten inquilinos suspendidos.
  - SuperAdmin mantiene acceso total para reactivación inmediata.

---

## 3. Ciclo de Vida y Cuarentena de Archivos al Eliminar Inquilinos
- **CLASIFICACIÓN**: `FIXED`.
- **Estado Anterior**: Al borrar un tenant en PostgreSQL, sus archivos en `/var/www/velion-media/tenants/<tenantId>` quedaban huérfanos y Nginx continuaba sirviéndolos públicamente.
- **Estado Actual**: Servicio `tenantMediaLifecycleService.js` valida estrictamente contra Path Traversal y traslada físicamente la carpeta a `/home/velion/quarantine/deleted-tenants/<tenantId>/<timestamp>/media` antes de proceder con el borrado en cascada en la base de datos. Si el filesystem falla, la base de datos no se elimina y se reporta el error.

---

## 4. Dependencias Residuales de Firebase
- **CLASIFICACIÓN**: `FIXED`.
- **Estado Anterior**: `firebase` y `firebase-admin` figuraban en `package.json` sin uso activo.
- **Estado Actual**: Ambas dependencias fueron desinstaladas limpiamente en Fase 6B. Cero referencias a Firebase en el código fuente.

---

## 5. Arquitectura de Despliegue en Nodo Único y Workers Singleton
- **CLASIFICACIÓN**: `KNOWN_LIMITATION` / `NOT_REQUIRED_FOR_CURRENT_OPERATION`.
- **Estado Real**: La plataforma opera en un único servidor Linux VPS con PM2 (`instances: 1`), PostgreSQL local y almacenamiento en disco (`/var/www/velion-media`).
- **Limitación de Escalamiento**:
  - Los motores de segundo plano (`CampaignWorkerV2`, `FollowUpWorker`, `BackupScheduler`) operan como singletons sin Redis lock distribuido. Si se configuran múltiples réplicas de PM2 en paralelo (`instances: max`), las réplicas secundarias DEBEN ejecutarse con `BACKGROUND_JOBS_ENABLED=false` para prevenir duplicación de envíos de WhatsApp.
  - El escalamiento multi-nodo requerirá migrar el almacenamiento de medios a S3/Cloudflare R2 y los eventos de Socket.io a Redis Adapter.

---

## 6. Controlador Monolítico de WhatsApp (`whatsappController.js`)
- **CLASIFICACIÓN**: `KNOWN_LIMITATION` / `NOT_REQUIRED_FOR_CURRENT_OPERATION`.
- **Estado Real**: El archivo `backend_api/src/controllers/whatsappController.js` tiene 5,750 líneas de código y concentra lógica de webhooks, deduplicación, inferencia IA, function calling y guardas de autoridad.
- **Impacto**: Funciona con alta estabilidad y cuenta con 51 suites de pruebas que cubren todos los escenarios de carrera y contingencia. No obstante, incrementa la curva de aprendizaje para ingenieros nuevos.
- **Roadmap Sugerido**: Modularizar en 4 servicios: `whatsappWebhookParser.js`, `whatsappAuthorityGuard.js`, `whatsappToolHandlers.js` y `whatsappSalesPipeline.js`.

---

## 7. Integración Shopify Draft Orders & Estado PCD
- **CLASIFICACIÓN**: `IMPLEMENTED + OFFLINE VALIDATED` / `PENDING_BUYER_DECISION`.
- **Estado Actual**: El flujo completo de sincronización de catálogo, resolución comercial híbrida (`VELION_ONLY`, `SHOPIFY_ONLY`, `COMBINED`), cálculo de precios/stock y máquina de estados atómica con PostgreSQL Advisory Lock para Draft Orders está completamente implementado y validado en tests offline (41/41 PASS).
- **Limitación en Vivo**: La creación de Draft Orders en vivo (`draftOrderCreate`) contra tiendas Shopify en producción requiere que la aplicación del comprador en Shopify Partners cuente con la aprobación de **Protected Customer Data (PCD)** otorgada por Shopify al propietario de la aplicación. En tiendas de desarrollo o sin PCD, la creación directa de órdenes con datos de clientes devuelve `ACCESS_DENIED`. La UI de Velion maneja este estado de forma amigable ("Función no disponible actualmente") sin exponer stack traces.

---

## 8. Modalidad de Distribución de Aplicación Shopify
- **CLASIFICACIÓN**: `PENDING_BUYER_DECISION`.
- **Estado Real**: La arquitectura OAuth y los endpoints están preparados para cualquier modalidad de distribución de Shopify. La selección entre **Custom Distribution** (enlace directo para comercios privados) o **Public Distribution** (publicación en Shopify App Store) debe ser determinada por el comprador según su modelo de negocio.

---

## 9. Cobertura de Pruebas Frontend E2E
- **CLASIFICACIÓN**: `NOT_IMPLEMENTED` / `ROADMAP`.
- **Estado Real**: El backend cuenta con más de 45,000 líneas de tests automatizados sin costo de API (S/0.00). El frontend se valida mediante `npm run build` (cero errores de compilación) y pruebas manuales reactivas. No se cuenta con una suite E2E automatizada basada en Cypress o Playwright en esta versión.

---

## 10. Onboarding y Aprovisionamiento Semi-Asistido
- **CLASIFICACIÓN**: `ROADMAP`.
- **Estado Real**: Un usuario puede registrarse mediante `/register`, pero la asignación de cuotas comerciales de producción y planes superiores usualmente es validada o activada por el SuperAdmin desde `/admin-empresas`.
- **Roadmap Sugerido**: Diseñar un Wizard de autoservicio de 3 pasos (Escaneo de QR / Conexión Meta -> Datos de Negocio -> Plan de prueba auto-activado).

---
*Documento actualizado en Septiembre 2026 como parte del cierre de Fase 6D.*
