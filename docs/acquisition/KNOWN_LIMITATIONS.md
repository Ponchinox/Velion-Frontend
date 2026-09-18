# Velion Agent — Known Limitations & Technical Debt Disclosure

**Informe de Transparencia Técnica para Procesos de Adquisición (Due Diligence)**  
**Objetivo:** Proporcionar al equipo técnico comprador un informe verídico, honesto y sustentado en el código sobre las limitaciones reales actuales, deudas de desarrollo y oportunidades de mejora del software.

---

## RESUMEN DE CLASIFICACIÓN TÉCNICA

- **`FIXED`**: Limitaciones o deudas técnicas resueltas durante el ciclo de endurecimiento previo a la entrega.
- **`KNOWN_LIMITATION`**: Comportamientos conocidos derivados de la arquitectura actual que no impiden la operación.
- **`ROADMAP`**: Mejoras futuras de escala o funcionalidades de autoservicio para etapas posteriores.
- **`NOT_REQUIRED_FOR_CURRENT_OPERATION`**: Aspectos no críticos para la operación actual en single-node.

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

## 4. Controlador Monolítico de WhatsApp (`whatsappController.js`)
- **CLASIFICACIÓN**: `KNOWN_LIMITATION` / `NOT_REQUIRED_FOR_CURRENT_OPERATION`.
- **Estado Real**: El archivo `backend_api/src/controllers/whatsappController.js` tiene 5,750 líneas de código y concentra lógica de webhooks, deduplicación, inferencia IA, function calling y guardas de autoridad.
- **Impacto**: Funciona con alta estabilidad y cuenta con 48 suites de pruebas que cubren todos los escenarios de carrera y contingencia. No obstante, incrementa la curva de aprendizaje para ingenieros nuevos.
- **Roadmap Sugerido**: Modularizar en 4 servicios: `whatsappWebhookParser.js`, `whatsappAuthorityGuard.js`, `whatsappToolHandlers.js` y `whatsappSalesPipeline.js`.

---

## 5. Onboarding y Aprovisionamiento No Completamente Autónomo
- **CLASIFICACIÓN**: `ROADMAP`.
- **Estado Real**: Un usuario puede registrarse mediante `/register`, pero la asignación de cuotas comerciales de producción y planes superiores usualmente es validada o activada por el SuperAdmin desde `/admin-empresas`.
- **Roadmap Sugerido**: Diseñar un Wizard de autoservicio de 3 pasos (Escaneo de QR / Conexión Meta -> Datos de Negocio -> Plan de prueba auto-activado).

---

## 6. Arquitectura de Despliegue en Nodo Único (Single-Node VPS)
- **CLASIFICACIÓN**: `KNOWN_LIMITATION` / `NOT_REQUIRED_FOR_CURRENT_OPERATION`.
- **Estado Real**: La plataforma opera en un único servidor Linux VPS con PM2, PostgreSQL local y almacenamiento en disco (`/var/www/velion-media`).
- **Impacto**: Arquitectura actualmente desplegada en un único nodo VPS; el escalamiento horizontal y la replicación permanecen como mejoras previstas para cargas mayores. No escala horizontalmente a múltiples servidores sin antes migrar los archivos a S3/Cloudflare R2 y los eventos de Socket.io a Redis Adapter.
- **Roadmap Sugerido**: Mantener arquitectura actual; evaluar almacenamiento en S3/R2 y Redis Adapter cuando se requiera expansión horizontal multi-nodo.

---

## 7. Dependencias Residuales de Firebase
- **CLASIFICACIÓN**: `NOT_REQUIRED_FOR_CURRENT_OPERATION`.
- **Estado Real**: `firebase` y `firebase-admin` figuran en `package.json` pero no tienen importaciones activas en el código fuente de producción (el sistema utiliza PostgreSQL vía Prisma exclusivamente).
- **Acción Sugerida**: Desinstalar limpiamente en un mantenimiento futuro (`npm uninstall firebase firebase-admin`).

---

## 8. Cobertura de Pruebas Concentrada en Backend
- **CLASIFICACIÓN**: `KNOWN_LIMITATION`.
- **Estado Real**: El backend cuenta con un runner de QA automatizado sin costo (S/0.00) con Network Guard y más de 45,000 líneas de tests. El frontend se verifica mediante pruebas visuales y manuales.
- **Roadmap Sugerido**: Incorporar Vitest y React Testing Library para componentes interactivos del frontend (`FlowBuilderPage`, `ChatPage`).

---
*Documento actualizado en Septiembre 2026 como parte del Buyer Readiness Hardening.*
