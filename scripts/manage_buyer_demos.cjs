#!/usr/bin/env node
/**
 * GESTOR CENTRALIZADO Y SEGURO DE TENANTS DEMO PARA COMPRADORES
 *
 * Administra config/buyer_demos.json y mantiene sincronizado DEMO_TENANT_IDS.
 *
 * Comandos soportados:
 *   node scripts/manage_buyer_demos.cjs list
 *   node scripts/manage_buyer_demos.cjs add --slug <slug> --name <name> --tenantId <uuid> [--email <email>] [--hours 48]
 *   node scripts/manage_buyer_demos.cjs remove --slug <slug>
 *   node scripts/manage_buyer_demos.cjs check-expiration
 *   node scripts/manage_buyer_demos.cjs sync-env [--env-path <path>]
 *   node scripts/manage_buyer_demos.cjs get-env-string
 *
 * Cero secretos: Jamás almacena ni imprime contraseñas ni tokens.
 */

const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = path.resolve(__dirname, '../config/buyer_demos.json');
const EXAMPLE_PATH = path.resolve(__dirname, '../config/buyer_demos.example.json');

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
    if (fs.existsSync(EXAMPLE_PATH)) {
      try {
        const template = JSON.parse(fs.readFileSync(EXAMPLE_PATH, 'utf8'));
        template.updatedAt = new Date().toISOString();
        fs.writeFileSync(REGISTRY_PATH, JSON.stringify(template, null, 2), 'utf8');
        return template;
      } catch {}
    }
    const initial = {
      version: '1.0',
      description: 'Registro centralizado de inquilinos demo para compradores en proceso de evaluación o Due Diligence',
      updatedAt: new Date().toISOString(),
      buyers: []
    };
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('❌ Error leyendo buyer_demos.json:', err.message);
    process.exit(1);
  }
}

function saveRegistry(registry) {
  registry.updatedAt = new Date().toISOString();
  const tmpPath = `${REGISTRY_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2), 'utf8');
  fs.renameSync(tmpPath, REGISTRY_PATH);
}

function getActiveTenantIds(registry) {
  return (registry.buyers || [])
    .filter(b => b.status === 'ACTIVE' && b.tenantId)
    .map(b => String(b.tenantId).trim());
}

// Parse CLI args
const args = process.argv.slice(2);
const command = args[0] || 'list';

function parseFlags() {
  const flags = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const parts = arg.slice(2).split('=');
      const key = parts[0];
      const val = parts.length > 1 ? parts.slice(1).join('=') : (args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true);
      flags[key] = val;
    }
  }
  return flags;
}

const flags = parseFlags();

switch (command) {
  case 'list': {
    const registry = loadRegistry();
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('📋 REGISTRO CENTRALIZADO DE COMPRADORES DEMO');
    console.log(`   Ruta: ${REGISTRY_PATH}`);
    console.log(`   Última actualización: ${registry.updatedAt}`);
    console.log('═══════════════════════════════════════════════════════════════════\n');

    if (!registry.buyers || registry.buyers.length === 0) {
      console.log('ℹ️  No hay compradores registrados actualmente.');
      process.exit(0);
    }

    const now = new Date();
    registry.buyers.forEach((b, idx) => {
      const expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
      const isExpired = expiresAt && expiresAt < now;
      const statusBadge = isExpired ? 'EXPIRED' : b.status;
      const timeLeftHours = expiresAt ? Math.round((expiresAt - now) / (1000 * 60 * 60)) : 'N/A';

      console.log(`[${idx + 1}] ${b.name} (${b.slug})`);
      console.log(`    Tenant Name:  "${b.tenantName || b.name + ' Demo'}"`);
      console.log(`    Tenant ID:    ${b.tenantId}`);
      console.log(`    Usuario:      ${b.email}`);
      console.log(`    Estado:       ${statusBadge}`);
      console.log(`    Creado:       ${b.createdAt}`);
      console.log(`    Expiración:   ${b.expiresAt || 'Indefinida'} (${timeLeftHours > 0 ? timeLeftHours + 'h restantes' : (timeLeftHours <= 0 ? 'Vencido' : '')})`);
      console.log('───────────────────────────────────────────────────────────────────');
    });

    const activeIds = getActiveTenantIds(registry);
    console.log(`\n🔒 Tenants demo activos para DEMO_TENANT_IDS (${activeIds.length}):`);
    console.log(`   ${activeIds.join(',')}`);
    break;
  }

  case 'add': {
    const slug = flags.slug;
    const name = flags.name;
    const tenantId = flags.tenantId;
    const email = flags.email || `${slug}.demo@velion.test`;
    const hours = parseInt(flags.hours || '48', 10);

    if (!slug || !name || !tenantId) {
      console.error('❌ Argumentos requeridos: --slug <slug> --name <name> --tenantId <uuid>');
      process.exit(1);
    }

    const registry = loadRegistry();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();

    let existing = registry.buyers.find(b => b.slug === slug || b.tenantId === tenantId);
    if (existing) {
      existing.name = name;
      existing.slug = slug;
      existing.tenantName = `${name} Demo`;
      existing.tenantId = tenantId;
      existing.email = email;
      existing.status = 'ACTIVE';
      existing.validityHours = hours;
      existing.expiresAt = expiresAt;
      console.log(`ℹ️ Comprador existente actualizado en registro: "${name}" (${slug})`);
    } else {
      registry.buyers.push({
        slug,
        name,
        tenantName: `${name} Demo`,
        tenantId,
        email,
        status: 'ACTIVE',
        createdAt: now.toISOString(),
        validityHours: hours,
        expiresAt
      });
      console.log(`✅ Comprador añadido exitosamente a registro: "${name}" (${slug})`);
    }

    saveRegistry(registry);
    console.log(`   Tenant ID registrado: ${tenantId}`);
    console.log(`   Expiración configurada para: ${expiresAt} (${hours} horas)`);
    break;
  }

  case 'remove': {
    const slug = flags.slug || flags.tenantId;
    if (!slug) {
      console.error('❌ Argumento requerido: --slug <slug> o --tenantId <uuid>');
      process.exit(1);
    }

    const registry = loadRegistry();
    const item = registry.buyers.find(b => b.slug === slug || b.tenantId === slug);
    if (!item) {
      console.error(`❌ Comprador no encontrado en el registro: ${slug}`);
      process.exit(1);
    }

    item.status = 'REVOKED';
    saveRegistry(registry);
    console.log(`✅ Estado de comprador revocado: "${item.name}" (${item.slug})`);
    console.log(`   Tenant ${item.tenantId} marcado como REVOKED.`);
    break;
  }

  case 'check-expiration': {
    const registry = loadRegistry();
    const now = new Date();
    let updatedCount = 0;

    (registry.buyers || []).forEach(b => {
      if (b.status === 'ACTIVE' && b.expiresAt) {
        if (new Date(b.expiresAt) < now) {
          b.status = 'EXPIRED';
          updatedCount++;
          console.log(`⚠️ Demo expirada detectada: "${b.name}" (${b.slug}) expiró el ${b.expiresAt}`);
        }
      }
    });

    if (updatedCount > 0) {
      saveRegistry(registry);
      console.log(`✅ Registro actualizado: ${updatedCount} demo(s) marcadas como EXPIRED.`);
    } else {
      console.log('✅ Todas las demos activas se encuentran dentro de su ventana de vigencia.');
    }
    break;
  }

  case 'get-env-string': {
    const registry = loadRegistry();
    const activeIds = getActiveTenantIds(registry);
    console.log(`DEMO_TENANT_IDS=${activeIds.join(',')}`);
    break;
  }

  case 'sync-env': {
    const envPath = flags['env-path'] || path.resolve(__dirname, '../backend_api/.env');
    const registry = loadRegistry();
    const activeIds = getActiveTenantIds(registry);
    const envValue = activeIds.join(',');

    if (!fs.existsSync(envPath)) {
      console.log(`ℹ️ Archivo .env no existe en ${envPath}. Creando con DEMO_TENANT_IDS...`);
      fs.writeFileSync(envPath, `DEMO_TENANT_IDS=${envValue}\n`, 'utf8');
      console.log(`✅ .env creado con DEMO_TENANT_IDS=${envValue}`);
      process.exit(0);
    }

    let content = fs.readFileSync(envPath, 'utf8');
    if (/^DEMO_TENANT_IDS=.*/m.test(content)) {
      content = content.replace(/^DEMO_TENANT_IDS=.*/m, `DEMO_TENANT_IDS=${envValue}`);
    } else {
      content += `\nDEMO_TENANT_IDS=${envValue}\n`;
    }

    const tmpPath = `${envPath}.tmp`;
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, envPath);
    console.log(`✅ .env sincronizado de forma atómica en ${envPath}`);
    console.log(`   DEMO_TENANT_IDS=${envValue}`);
    break;
  }

  default:
    console.log(`Comando desconocido: ${command}`);
    console.log('Comandos válidos: list, add, remove, check-expiration, sync-env, get-env-string');
    process.exit(1);
}
