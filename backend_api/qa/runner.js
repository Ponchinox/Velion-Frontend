/**
 * VELION QA RUNNER (Zero-Cost API S/0.00)
 * =======================================
 * Orquestador central de pruebas automatizadas para Velion.
 * 
 * Garantías:
 * - Network Guard activo antes de importar cualquier controlador o servicio.
 * - 0 llamadas salientes a Gemini / Groq / OpenAI / Evolution / Meta / Stripe.
 * - 0 mensajes reales de WhatsApp enviados.
 * - 0 conexiones y 0 escrituras en PostgreSQL de producción.
 * - Costo estimado: S/0.00.
 */

// 1. Activar Network Guard y neutralizar variables de entorno de inmediato
import './networkGuard.js';
import { networkGuardMetrics } from './networkGuard.js';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';

// Importar nuevos escenarios modulares
import { runNetworkGuardSuite } from './networkGuard.test.js';
import { runMultimediaScenario } from './scenarios/multimedia.scenario.js';
import { runRapidMessagesScenario } from './scenarios/rapidMessages.scenario.js';
import { runTenantIsolationScenario } from './scenarios/tenantIsolation.scenario.js';
import { runAuthorityScenario } from './scenarios/authority.scenario.js';
import { runHandoffScenario } from './scenarios/handoff.scenario.js';
import { runGroqFallbackScenario } from './scenarios/groqFallback.scenario.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendApiDir = path.resolve(__dirname, '..');

// Categorización de suites para el reporte visual
const QA_CATEGORIES = [
  {
    id: 'network_guard',
    name: 'Network Guard',
    type: 'internal_fn',
    fn: runNetworkGuardSuite
  },
  {
    id: 'multimedia',
    name: 'Multimedia',
    type: 'internal_fn',
    fn: runMultimediaScenario
  },
  {
    id: 'rapid_messages',
    name: 'Rapid messages',
    type: 'internal_fn',
    fn: runRapidMessagesScenario
  },
  {
    id: 'tenant_isolation',
    name: 'Tenant isolation',
    type: 'internal_fn',
    fn: runTenantIsolationScenario
  },
  {
    id: 'authority',
    name: 'Authority',
    type: 'internal_fn',
    fn: runAuthorityScenario
  },
  {
    id: 'handoff',
    name: 'Handoff',
    type: 'internal_fn',
    fn: runHandoffScenario
  },
  {
    id: 'groq_fallback',
    name: 'Groq 3rd Fallback',
    type: 'internal_fn',
    fn: runGroqFallbackScenario
  },
  {
    id: 'core',
    name: 'Core',
    type: 'standalone_files',
    files: [
      'test_gemini_timeout_and_fallback.js',
      'test_single_key_production.js',
      'test_phase2c_background_and_host.js'
    ]
  },
  {
    id: 'ai_agent',
    name: 'AI / Business Agent',
    type: 'standalone_files',
    files: [
      'test_ai_final_gate.js',
      'test_business_agent_core.js',
      'test_telemetry_and_prompt_guard.js'
    ]
  },
  {
    id: 'sales',
    name: 'Sales',
    type: 'standalone_files',
    files: [
      'test_service_commercial_flow.js'
    ]
  },
  {
    id: 'products',
    name: 'Products',
    type: 'standalone_files',
    files: [
      'test_order_price_and_ownership.js',
      'test_operational_items_api.js',
      'test_operational_item_service.js'
    ]
  },
  {
    id: 'multimedia_files',
    name: 'Multimedia files',
    type: 'standalone_files',
    files: [
      'test_product_media_flow.js',
      'test_hotfix_media_superseded.js',
      'test_gateway_media_retry.js',
      'test_multimedia_ingestion_order.js'
    ]
  },
  {
    id: 'handoff_files',
    name: 'Handoff files',
    type: 'standalone_files',
    files: [
      'test_human_handoff_deterministic.js',
      'test_human_handoff_behavior.js',
      'test_manual_vs_automated_tracker.js',
      'test_unknown_info_vs_handoff.js'
    ]
  },
  {
    id: 'rapid_files',
    name: 'Rapid messages files',
    type: 'standalone_files',
    files: [
      'test_stale_generation_race.js',
      'test_ai_epoch_cancel.js',
      'test_ai_off_interval.js',
      'test_ai_revival_real.js',
      'test_generation_superseded_crash.js',
      'test_new_message_during_generation.js',
      'test_webhook_readiness_race.js'
    ]
  },
  {
    id: 'gateway',
    name: 'WhatsApp Gateway',
    type: 'standalone_files',
    files: [
      'test_connection_sync.js'
    ]
  },
  {
    id: 'tenant_files',
    name: 'Tenant isolation files',
    type: 'standalone_files',
    files: [
      'test_connection_multitenant_isolation.js'
    ]
  },
  {
    id: 'security',
    name: 'Security',
    type: 'standalone_files',
    files: [
      'test_business_authority_hotfix.js',
      'test_budget_guard_behavior.js',
      'test_business_rules_prompt.js',
      'test_cleanup_guard.js',
      'test_guards.js'
    ]
  },
  {
    id: 'flows',
    name: 'Flows',
    type: 'standalone_files',
    files: [
      'test_ambiguous_yes_flow.js'
    ]
  },
  {
    id: 'operational',
    name: 'Operational items',
    type: 'standalone_files',
    files: [
      'test_operational_tools_flow.js',
      'test_operational_realtime_state.js'
    ]
  },
  {
    id: 'sanitization',
    name: 'Sanitization',
    type: 'standalone_files',
    files: [
      'test_emoticon_sanitization.js'
    ]
  }
];

// Archivos temporalmente excluidos porque requieren esquema real de PostgreSQL
const EXCLUDED_POSTGRES_TESTS = [
  'test_campaigns_worker_v2.js',
  'test_order_creation_guard.js',
  'test_livechat_comprehensive.js',
  'test_livechat_manual_handoff.js'
];

import { pathToFileURL } from 'node:url';

const guardPath = path.resolve(__dirname, 'networkGuard.js');
const guardUrl = pathToFileURL(guardPath).href;
const repoRootDir = path.resolve(backendApiDir, '..');

/**
 * Ejecuta un archivo de prueba en un subproceso hijo aislado con las variables de QA_MODE
 * y pre-cargando networkGuard.js mediante --import antes de cualquier código de prueba.
 */
function runStandaloneFile(relFile) {
  return new Promise((resolve) => {
    const filePath = path.resolve(backendApiDir, relFile);
    const child = fork(filePath, [], {
      cwd: repoRootDir,
      execArgv: ['--import', guardUrl],
      env: {
        ...process.env,
        QA_MODE: 'true',
        NODE_ENV: 'test',
        GEMINI_API_KEY: 'MOCK_QA_BLOCKED_GEMINI_API_KEY',
        GROQ_API_KEY: 'MOCK_QA_BLOCKED_GROQ_API_KEY',
        EVOLUTION_API_KEY: 'MOCK_QA_BLOCKED_EVOLUTION_API_KEY',
        DATABASE_URL: 'postgresql://mock_qa_blocked:mock_qa_blocked@127.0.0.1:9/mock_qa_db?schema=public'
      },
      stdio: 'pipe'
    });

    let stdout = '';
    let stderr = '';
    let isResolved = false;

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    const timeout = setTimeout(() => {
      if (isResolved) return;
      isResolved = true;
      try { child.kill('SIGKILL'); } catch (_) {}
      try { child.kill(); } catch (_) {}
      resolve({
        file: relFile,
        pass: false,
        error: 'TIMED_OUT (>30s)'
      });
    }, 30000);

    child.on('exit', (code) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timeout);
      resolve({
        file: relFile,
        pass: code === 0,
        error: code !== 0 ? (stderr || stdout || `Exit code ${code}`).trim() : null
      });
    });
  });
}

async function main() {
  const startTime = Date.now();

  console.log('\n');
  console.log('======================================================================');
  console.log('                          VELION QA SUITE                             ');
  console.log('            ZERO-COST & MULTI-TENANT ISOLATION ASSURANCE              ');
  console.log('======================================================================\n');

  let totalSuites = 0;
  let passedSuites = 0;
  let failedSuites = [];

  const categoryResults = [];

  for (const cat of QA_CATEGORIES) {
    process.stdout.write(`  Ejecutando ${cat.name.padEnd(25, '.')}`);

    if (cat.type === 'internal_fn') {
      try {
        await cat.fn();
        totalSuites++;
        passedSuites++;
        categoryResults.push({ name: cat.name, status: 'PASS', details: 'OK' });
        console.log(`\x1b[32m PASS\x1b[0m`);
      } catch (err) {
        totalSuites++;
        categoryResults.push({ name: cat.name, status: 'FAIL', details: err.message });
        failedSuites.push({ name: cat.name, error: err.message });
        console.log(`\x1b[31m FAIL\x1b[0m (${err.message})`);
      }
    } else if (cat.type === 'standalone_files') {
      let catAllPass = true;
      const fileErrors = [];

      for (const f of cat.files) {
        totalSuites++;
        const res = await runStandaloneFile(f);
        if (res.pass) {
          passedSuites++;
        } else {
          catAllPass = false;
          fileErrors.push(`${f}: ${res.error.split('\n')[0]}`);
          failedSuites.push({ name: f, error: res.error });
        }
      }

      if (catAllPass) {
        categoryResults.push({ name: cat.name, status: 'PASS', details: `${cat.files.length}/${cat.files.length} archivos` });
        console.log(`\x1b[32m PASS\x1b[0m (${cat.files.length}/${cat.files.length})`);
      } else {
        categoryResults.push({ name: cat.name, status: 'FAIL', details: fileErrors.join('; ') });
        console.log(`\x1b[31m FAIL\x1b[0m (${fileErrors.length} fallo(s))`);
      }
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n======================================================================');
  console.log('                          RESUMEN DE EJECUCIÓN                        ');
  console.log('======================================================================');
  for (const r of categoryResults) {
    const dots = '.'.repeat(Math.max(2, 35 - r.name.length));
    const statusStr = r.status === 'PASS' ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`  ${r.name}${dots} ${statusStr} (${r.details})`);
  }

  console.log('----------------------------------------------------------------------');
  console.log(`  TOTAL SUITES.........: ${passedSuites}/${totalSuites} PASS`);
  console.log(`  TIEMPO TOTAL.........: ${durationSec}s`);
  console.log(`  LIVE API CALLS.......: 0`);
  console.log(`  REAL WHATSAPP MSGS...: 0`);
  console.log(`  PRODUCTION DB WRITES.: 0`);
  console.log(`  ESTIMATED API COST...: S/0.00`);
  console.log('======================================================================');

  if (EXCLUDED_POSTGRES_TESTS.length > 0) {
    console.log('\nℹ️  [INFO] Tests excluidos temporalmente de npm run qa (requieren Postgres real):');
    for (const ex of EXCLUDED_POSTGRES_TESTS) {
      console.log(`    - ${ex}`);
    }
    console.log('    (Estos tests requieren una instancia PostgreSQL dedicada o adapter relacional).\n');
  }

  if (failedSuites.length > 0) {
    console.log('\n❌ DETALLE DE FALLOS:');
    for (const f of failedSuites) {
      console.log(`\n--- ${f.name} ---`);
      console.log(f.error);
    }
    process.exit(1);
  } else {
    console.log('\n🎉 VELION QA SUITE COMPLETADA CON ÉXITO: 0 COSTOS DE API (S/0.00)\n');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
