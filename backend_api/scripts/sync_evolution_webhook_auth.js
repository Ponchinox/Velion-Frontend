/**
 * sync_evolution_webhook_auth.js
 * ===============================
 * Updates the stored webhook auth headers for all active Evolution instances
 * to use the current authoritative EVOLUTION_API_KEY from process.env.
 *
 * This ensures webhook callbacks use the current key, not a stale one.
 * Preserves existing URL, events, and enabled state.
 *
 * Usage (on VPS): node scripts/sync_evolution_webhook_auth.js
 *
 * Safety:
 * - Never prints secrets
 * - Verifies before and after
 * - Dry-run mode with DRY_RUN=1
 */

import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { createHash } from 'node:crypto';

function safeHash(value) {
  if (!value || typeof value !== 'string') return null;
  return createHash('sha256').update(value.trim()).digest('hex').slice(0, 16);
}

async function main() {
  const apiKey = (process.env.EVOLUTION_API_KEY || '').trim().replace(/^["']|["']$/g, '');
  const evoUrl = process.env.EVOLUTION_API_URL || 'http://127.0.0.1:8080';
  const isDryRun = process.env.DRY_RUN === '1';

  if (!apiKey) {
    console.error('❌ EVOLUTION_API_KEY not defined in environment. Aborting.');
    process.exit(1);
  }

  const headers = { headers: { apikey: apiKey, 'Content-Type': 'application/json' } };
  const keyHash = safeHash(apiKey);

  console.log('======================================================================');
  console.log(`🔄 EVOLUTION WEBHOOK AUTH SYNC ${isDryRun ? '(DRY RUN)' : ''}`);
  console.log('======================================================================\n');

  // 1. Fetch all instances
  let instances;
  try {
    const res = await axios.get(`${evoUrl}/instance/fetchInstances`, headers);
    instances = res.data || [];
    console.log(`  Found ${instances.length} instance(s)\n`);
  } catch (e) {
    console.error('❌ Cannot fetch instances:', e.response?.status || e.message);
    process.exit(1);
  }

  let synced = 0;
  let alreadyOk = 0;
  let errors = 0;

  for (const inst of instances) {
    const name = inst?.name || inst?.instance?.instanceName || inst?.instanceName;
    if (!name) continue;

    try {
      // 2. Get current webhook config
      const whRes = await axios.get(`${evoUrl}/webhook/find/${name}`, headers);
      const wh = whRes.data;

      const storedKeyHash = safeHash(wh?.headers?.apikey);
      const isKeyMatch = storedKeyHash === keyHash;
      const hasAllEvents = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'MESSAGES_UPDATE'].every(ev => wh?.events?.includes(ev));

      if (isKeyMatch && hasAllEvents) {
        console.log(`  ✅ ${name}: key & events MATCH — no update needed`);
        alreadyOk++;
        continue;
      }

      console.log(`  🔧 ${name}: key/events need sync — ${isDryRun ? 'would update' : 'updating'}...`);

      const mergedEvents = Array.from(new Set([...(wh.events || []), 'MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'MESSAGES_UPDATE']));

      if (!isDryRun) {
        // 3. Update webhook preserving URL, events, enabled state
        await axios.post(`${evoUrl}/webhook/set/${name}`, {
          webhook: {
            url: wh.url,
            enabled: wh.enabled !== false,
            headers: { ...wh.headers, apikey: apiKey },
            byEvents: wh.byEvents || false,
            webhookByEvents: wh.webhookByEvents || false,
            events: mergedEvents
          }
        }, headers);

        // 4. Verify
        const verifyRes = await axios.get(`${evoUrl}/webhook/find/${name}`, headers);
        const verifiedHash = safeHash(verifyRes.data?.headers?.apikey);
        const verifiedEvents = verifyRes.data?.events || [];
        const verifiedHasEvents = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'MESSAGES_UPDATE'].every(ev => verifiedEvents.includes(ev));
        if (verifiedHash === keyHash && verifiedHasEvents) {
          console.log(`     ✅ Verified: key and events now MATCH`);
          synced++;
        } else {
          console.log(`     ❌ Verification failed: still MISMATCH`);
          errors++;
        }
      } else {
        synced++;
      }
    } catch (e) {
      console.error(`  ❌ ${name}: error — ${e.response?.status || e.message}`);
      errors++;
    }
  }

  console.log(`\n======================================================================`);
  console.log(`🏁 SYNC RESULT: ${alreadyOk} OK, ${synced} synced, ${errors} errors`);
  console.log(`======================================================================\n`);

  process.exit(errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
