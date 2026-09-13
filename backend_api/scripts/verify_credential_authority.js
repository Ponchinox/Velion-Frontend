/**
 * verify_credential_authority.js
 * ==============================
 * Verifies that the Evolution API key is consistent across all authority boundaries:
 *   1. backend_api/.env file
 *   2. effective process.env (what PM2 sees)
 *   3. Evolution API authentication key
 *   4. Stored webhook auth header
 *
 * Reports MATCH/MISMATCH only — never prints secrets, prefixes, or suffixes.
 *
 * Usage (on VPS): node verify_credential_authority.js
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import axios from 'axios';

// Safe hash for comparison — never reveals the key
function safeHash(value) {
  if (!value || typeof value !== 'string') return null;
  return createHash('sha256').update(value.trim()).digest('hex').slice(0, 16);
}

async function main() {
  console.log('======================================================================');
  console.log('🔐 CREDENTIAL AUTHORITY VERIFICATION');
  console.log('======================================================================\n');

  let passed = 0;
  let total = 0;

  // 1. Read .env file directly
  const envPath = resolve(process.cwd(), '.env');
  let envFileKey = null;
  try {
    const envContent = readFileSync(envPath, 'utf8');
    const match = envContent.match(/^EVOLUTION_API_KEY=(.+)$/m);
    envFileKey = match?.[1]?.trim()?.replace(/^["']|["']$/g, '') || null;
  } catch (e) {
    console.error('  ❌ Cannot read .env file:', e.message);
  }

  // 2. Effective process.env (fallback to PM2 environment if running standalone)
  let processEnvKey = (process.env.EVOLUTION_API_KEY || '').trim().replace(/^["']|["']$/g, '') || null;
  if (!processEnvKey) {
    try {
      const { execSync } = await import('node:child_process');
      const jlist = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8' }));
      const proc = jlist.find(p => p.name === 'velion-backend');
      processEnvKey = (proc?.pm2_env?.EVOLUTION_API_KEY || '').trim().replace(/^["']|["']$/g, '') || null;
    } catch (e) {
      // Fallback
    }
  }

  // 3. Evolution API auth (test a simple endpoint)
  const evoUrl = process.env.EVOLUTION_API_URL || 'http://127.0.0.1:8080';
  let evoAcceptsKey = false;
  try {
    const res = await axios.get(`${evoUrl}/instance/fetchInstances`, {
      headers: { apikey: processEnvKey }
    });
    evoAcceptsKey = res.status === 200;
  } catch (e) {
    evoAcceptsKey = false;
  }

  // 4. Stored webhook auth header (pick first instance)
  let webhookStoredKeyHash = null;
  try {
    const res = await axios.get(`${evoUrl}/instance/fetchInstances`, {
      headers: { apikey: processEnvKey }
    });
    const instances = res.data || [];
    if (instances.length > 0) {
      const firstInstance = instances[0]?.name || instances[0]?.instance?.instanceName || instances[0]?.instanceName;
      if (firstInstance) {
        const whRes = await axios.get(`${evoUrl}/webhook/find/${firstInstance}`, {
          headers: { apikey: processEnvKey }
        });
        const storedKey = (whRes.data?.headers?.apikey || '').trim().replace(/^["']|["']$/g, '');
        webhookStoredKeyHash = safeHash(storedKey);
      }
    }
  } catch (e) {
    console.warn('  ⚠️ Could not read webhook stored key:', e.message);
  }

  const envFileHash = safeHash(envFileKey);
  const processHash = safeHash(processEnvKey);

  // Checks
  total++;
  if (envFileKey) {
    console.log(`  ✅ CHECK 1: .env file — DEFINED`);
    passed++;
  } else {
    console.log(`  ❌ CHECK 1: .env file — NOT DEFINED`);
  }

  total++;
  if (processEnvKey) {
    console.log(`  ✅ CHECK 2: process.env — DEFINED`);
    passed++;
  } else {
    console.log(`  ❌ CHECK 2: process.env — NOT DEFINED`);
  }

  total++;
  if (envFileHash && processHash && envFileHash === processHash) {
    console.log(`  ✅ CHECK 3: .env file == process.env — MATCH`);
    passed++;
  } else if (envFileHash && processHash) {
    console.log(`  ❌ CHECK 3: .env file == process.env — MISMATCH (PM2 stale dump?)`);
  } else {
    console.log(`  ❌ CHECK 3: .env file == process.env — CANNOT COMPARE (missing value)`);
  }

  total++;
  if (evoAcceptsKey) {
    console.log(`  ✅ CHECK 4: Evolution API accepts process.env key — PASS`);
    passed++;
  } else {
    console.log(`  ❌ CHECK 4: Evolution API accepts process.env key — FAIL (401)`);
  }

  total++;
  const webhookMatches = Boolean(webhookStoredKeyHash && processHash && webhookStoredKeyHash === processHash);
  if (webhookMatches) {
    console.log(`  ✅ CHECK 5: Webhook stored key == process.env — MATCH`);
    passed++;
  } else if (webhookStoredKeyHash && processHash) {
    console.log(`  ❌ CHECK 5: Webhook stored key == process.env — MISMATCH`);
  } else {
    console.log(`  ⚠️ CHECK 5: Webhook stored key == process.env — CANNOT COMPARE`);
  }

  console.log(`\n======================================================================`);
  console.log(`🏁 CREDENTIAL AUTHORITY: ${passed}/${total} PASS`);
  console.log(`======================================================================`);
  console.log(`ENV_FILE_DEFINED = ${envFileKey ? 'PASS' : 'FAIL'}`);
  console.log(`NODE_EFFECTIVE_DEFINED = ${processEnvKey ? 'PASS' : 'FAIL'}`);
  console.log(`EVOLUTION_AUTH_MATCH = ${evoAcceptsKey ? 'PASS' : 'FAIL'}`);
  console.log(`WEBHOOK_AUTH_MATCH = ${webhookMatches ? 'PASS' : 'FAIL'}`);
  console.log(`OVERALL = ${passed === total ? 'PASS' : 'FAIL'}\n`);

  if (passed < total) {
    console.log('⚠️ REMEDIATION:');
    if (envFileHash !== processHash) {
      console.log('  1. pm2 restart velion-backend --update-env');
    }
    if (!evoAcceptsKey) {
      console.log('  2. Verify EVOLUTION_API_KEY in .env matches Evolution API global config');
    }
    if (webhookStoredKeyHash !== processHash) {
      console.log('  3. Run webhook auth sync: node scripts/sync_evolution_webhook_auth.js');
    }
  }

  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
