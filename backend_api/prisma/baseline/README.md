# Velion Database Baseline (Snapshot 20260920)

Este directorio contiene el **snapshot DDL congelado** y el **manifiesto de reconciliación** para el despliegue limpio y reproducible de Velion Agent sobre bases de datos PostgreSQL nuevas.

---

## 1. ¿Por qué existe este Baseline?

Durante el desarrollo inicial del backend (julio - agosto de 2026), se incorporaron modelos estructurales directamente al catálogo mediante `prisma db push` (commit `310727f` y `1697138` para Render/cloud) sin generar archivos incrementales de migración en `prisma/migrations/`.

Posteriormente, a partir de la migración `20260815181423_add_whatsapp_gateway_fields` y siguientes, el equipo retomó el uso de `prisma migrate dev`. Esas migraciones incrementales asumían que las tablas base ya existían físicamente en la base de datos de desarrollo y producción.

Como consecuencia:
- En una base de datos existente (como producción), las migraciones se aplican normalmente.
- En una base de datos **completamente vacía**, ejecutar `prisma migrate deploy` desde cero fallaba en la migración `05` debido a la ausencia del `CREATE TABLE` inicial de dichas tablas base.

El snapshot `20260920_baseline.sql` resuelve este problema proporcionando un estado inicial congelado y autosuficiente.

---

## 2. Regla de Oro: NO editar migraciones legacy

- **NO modificar, renombrar ni eliminar** ninguna de las 17 migraciones existentes en `prisma/migrations/`.
- La base de datos de producción tiene registrados los checksums (hashes criptográficos) de estas migraciones en la tabla `_prisma_migrations`. Alterar cualquier archivo provocaría un error fatal de `checksum mismatch` en producción.

---

## 3. Dos Caminos de Despliegue Claramente Diferenciados

| Escenario | Comando a Utilizar | Explicación |
|---|---|---|
| **Base de datos NUEVA** (Clean install, CI, Docker local, nuevo comprador) | `npm run db:bootstrap` | Aplica el baseline DDL congelado y registra formalmente las migraciones 01 a 17 como representadas vía `prisma migrate resolve --applied`. |
| **Base de datos EXISTENTE** (Producción, Staging activo, entornos ya inicializados) | `npx prisma migrate deploy` | Aplica únicamente las nuevas migraciones incrementales pendientes. **NUNCA** ejecutar `db:bootstrap` en una base con datos. |

---

## 4. Estructura y Manifiesto (`20260920_baseline_manifest.json`)

El manifiesto enumera **estrictamente** las 17 migraciones representadas en este snapshot:
- `20260711011611_init_saas_schema` hasta `20260920150000_add_commerce_integrations`.

El bootstrap es **fail-closed**:
- Solo opera sobre bases de datos 100% limpias (0 tablas de negocio).
- Si detecta tablas existentes (`Tenant`, `User`, etc.), aborta inmediatamente sin mutar nada.
- Si la URL no es `localhost` o `127.0.0.1`, aborta de inmediato.

---

## 5. Ciclo de Vida para Migraciones Futuras (18, 19, 20...)

Si en el futuro se crea una nueva migración (por ejemplo `20261001000000_nueva_feature`):
1. La nueva migración se coloca en `prisma/migrations/` como siempre.
2. **NO** se agrega al manifiesto congelado `20260920_baseline_manifest.json`.
3. Al ejecutar `npm run db:bootstrap` en una base vacía:
   - Se aplica el baseline 20260920.
   - Se marcan como resueltas las migraciones 01 a 17.
   - El script ejecuta automáticamente `prisma migrate deploy`, aplicando la migración 18 normalmente.
4. En producción: `prisma migrate deploy` aplica la migración 18 de forma incremental.
