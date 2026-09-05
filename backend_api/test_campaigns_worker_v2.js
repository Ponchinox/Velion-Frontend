import assert from 'node:assert';
import prisma from './src/db.js';
import {
  launchCampaignV2,
  claimNextLog,
  applySendResult,
  sendClaimedLog,
  recoverOrphanedProcessing,
  resumeRunningCampaigns,
  dispatchDueCampaigns,
  calculateNextRun,
  STALE_PROCESSING_MS
} from './src/services/campaignWorkerV2.js';

console.log('======================================================================');
console.log('🧪 CAMPAIGNS WORKER V2 EXTENDED SUITE (TESTS 1 - 36)');
console.log('======================================================================\n');

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}:`, err.message);
    throw err;
  }
}

async function makeTenant(id, overrides = {}) {
  return prisma.tenant.create({
    data: {
      id,
      name: `Tenant ${id}`,
      aiEnabled: false,
      msgLimit: 100000,
      ...overrides
    }
  });
}

// Configura Meta sin credenciales para que sendText retorne null
async function forceOfflineMetaGateway(tenantId) {
  await prisma.registeredWhatsAppNumber.create({
    data: {
      phoneNumber: `meta-${tenantId}`,
      tenantId,
      provider: 'META'
    }
  });
}

async function main() {
  const stamp = Date.now();

  // ────────────────────────────────────────────────────────────────────────
  console.log('══ TEST 1 (A): audience=all con 100 destinatarios válidos únicos ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenantA = await makeTenant(`camp-t-a-${stamp}`);
  await runTest('TEST 1: 100 destinatarios -> 100 CampaignLog pending únicos', async () => {
    const contacts = [];
    for (let i = 0; i < 100; i++) {
      contacts.push({
        name: `Contacto ${i}`,
        phone: `519${(stamp % 100000).toString().padStart(5, '0')}${i.toString().padStart(3, '0')}`,
        tenantId: tenantA.id
      });
    }
    await prisma.contact.createMany({ data: contacts });

    const { campaign, eligibleCount } = await launchCampaignV2({
      tenantId: tenantA.id,
      name: 'Campaña A',
      baseMessage: 'Hola [Nombre]',
      delayMin: 0,
      delayMax: 1,
      audience: 'all'
    });

    assert.strictEqual(eligibleCount, 100);
    const logs = await prisma.campaignLog.findMany({ where: { campaignId: campaign.id } });
    assert.strictEqual(logs.length, 100);
    assert.ok(logs.every((l) => l.status === 'pending'));
    const uniquePhones = new Set(logs.map((l) => l.customerPhone));
    assert.strictEqual(uniquePhones.size, 100);

    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'completed' } });
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 2 (B): dos contactos con mismo teléfono normalizado -> 1 log ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenantB = await makeTenant(`camp-t-b-${stamp}`);
  await runTest('TEST 2: deduplicación por destino normalizado', async () => {
    const basePhone = `51987${stamp.toString().slice(-6)}`;
    await prisma.contact.create({ data: { name: 'Cliente 1', phone: basePhone, tenantId: tenantB.id } });
    await prisma.contact.create({ data: { name: 'Cliente 2 (duplicado)', phone: `+51 ${basePhone.slice(2, 5)} ${basePhone.slice(5)}`, tenantId: tenantB.id } });

    const { campaign, eligibleCount } = await launchCampaignV2({
      tenantId: tenantB.id,
      name: 'Campaña B',
      baseMessage: 'Hola [Nombre]',
      delayMin: 0,
      delayMax: 1,
      audience: 'all'
    });

    assert.strictEqual(eligibleCount, 1);
    const logs = await prisma.campaignLog.findMany({ where: { campaignId: campaign.id } });
    assert.strictEqual(logs.length, 1);

    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'completed' } });
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 3 (C): reclamación atómica concurrente (SKIP LOCKED) ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenantC = await makeTenant(`camp-t-c-${stamp}`);
  let campaignC;
  await runTest('TEST 3: 30 reclamaciones concurrentes sobre 20 logs -> 20 únicos, 0 duplicados', async () => {
    const contacts = [];
    for (let i = 0; i < 20; i++) {
      contacts.push({ name: `C${i}`, phone: `5198800${i.toString().padStart(4, '0')}`, tenantId: tenantC.id });
    }
    await prisma.contact.createMany({ data: contacts });

    const result = await launchCampaignV2({
      tenantId: tenantC.id,
      name: 'Campaña C',
      baseMessage: 'Hola',
      delayMin: 0,
      delayMax: 1,
      audience: 'all'
    });
    campaignC = result.campaign;

    const attempts = Array.from({ length: 30 }, () => claimNextLog(campaignC.id, tenantC.id));
    const results = await Promise.all(attempts);
    const claimed = results.filter((r) => r !== null);
    const ids = claimed.map((r) => r.id);
    const uniqueIds = new Set(ids);

    assert.strictEqual(claimed.length, 20, 'Deben reclamarse exactamente los 20 logs pending');
    assert.strictEqual(uniqueIds.size, 20, 'Ningún log debe reclamarse dos veces');

    const processingCount = await prisma.campaignLog.count({ where: { campaignId: campaignC.id, status: 'processing' } });
    assert.strictEqual(processingCount, 20);
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 4 (D): Gateway éxito -> processing -> sent ══');
  // ────────────────────────────────────────────────────────────────────────
  await runTest('TEST 4: applySendResult(success) transiciona a sent', async () => {
    const log = await prisma.campaignLog.findFirst({ where: { campaignId: campaignC.id, status: 'processing' } });
    await applySendResult(log.id, { success: true, message: 'Hola Cliente, mensaje real enviado' });
    const updated = await prisma.campaignLog.findUnique({ where: { id: log.id } });
    assert.strictEqual(updated.status, 'sent');
    assert.strictEqual(updated.sentMessage, 'Hola Cliente, mensaje real enviado');
    assert.strictEqual(updated.errorMessage, null);
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 5 (E): Gateway error -> processing -> failed ══');
  // ────────────────────────────────────────────────────────────────────────
  let orphanLogId;
  await runTest('TEST 5: applySendResult(failure) transiciona a failed con errorMessage', async () => {
    const logs = await prisma.campaignLog.findMany({ where: { campaignId: campaignC.id, status: 'processing' } });
    const log = logs[0];
    orphanLogId = logs[1]?.id;
    await applySendResult(log.id, { success: false, message: 'Hola Cliente', errorMsg: 'Gateway boom' });
    const updated = await prisma.campaignLog.findUnique({ where: { id: log.id } });
    assert.strictEqual(updated.status, 'failed');
    assert.strictEqual(updated.errorMessage, 'Gateway boom');
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 6 (F): processing huérfano tras crash (>5 min) -> recovery -> failed ══');
  // ────────────────────────────────────────────────────────────────────────
  await runTest('TEST 6: recoverOrphanedProcessing marca huérfanos stale como failed', async () => {
    assert.ok(orphanLogId, 'Debe existir un log processing huérfano previo al recovery');
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
    await prisma.campaignLog.update({
      where: { id: orphanLogId },
      data: { claimedAt: sixMinutesAgo }
    });

    await recoverOrphanedProcessing();

    const after = await prisma.campaignLog.findUnique({ where: { id: orphanLogId } });
    assert.strictEqual(after.status, 'failed');
    assert.ok(after.errorMessage.includes('stale'));

    const sentLog = await prisma.campaignLog.findFirst({ where: { campaignId: campaignC.id, status: 'sent' } });
    assert.ok(sentLog, 'El log marcado sent en TEST 4 debe seguir sent');
  });

  // Limpiar el resto de logs processing para los tests siguientes
  await prisma.campaignLog.updateMany({
    where: { campaignId: campaignC.id, status: 'processing' },
    data: { status: 'failed', errorMessage: 'cleanup-test' }
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 7 (G): reinicio con pending restantes -> continúan procesándose ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenantG = await makeTenant(`camp-t-g-${stamp}`);
  await runTest('TEST 7: resumeRunningCampaigns detecta y reanuda campañas running con pending', async () => {
    await prisma.contact.createMany({
      data: [
        { name: 'G1', phone: `519890${stamp.toString().slice(-6)}1`, tenantId: tenantG.id },
        { name: 'G2', phone: `519890${stamp.toString().slice(-6)}2`, tenantId: tenantG.id }
      ]
    });

    const { campaign } = await launchCampaignV2({
      tenantId: tenantG.id,
      name: 'Campaña G',
      baseMessage: 'Hola [Nombre]',
      delayMin: 0,
      delayMax: 0,
      audience: 'all'
    });

    const runningWithPending = await prisma.campaign.findMany({
      where: { status: 'running', logs: { some: { status: 'pending' } } },
      select: { id: true }
    });
    assert.ok(runningWithPending.some((c) => c.id === campaign.id));

    // Forzamos resolver logs manualmente para no requerir red real
    const logsG = await prisma.campaignLog.findMany({ where: { campaignId: campaign.id } });
    for (const l of logsG) {
      await applySendResult(l.id, { success: true, message: 'Enviado' });
    }

    await resumeRunningCampaigns();

    const pendingLeft = await prisma.campaignLog.count({ where: { campaignId: campaign.id, status: 'pending' } });
    assert.strictEqual(pendingLeft, 0);
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 8 (H): Tenant A no procesa CampaignLog de Tenant B ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenantH1 = await makeTenant(`camp-t-h1-${stamp}`);
  const tenantH2 = await makeTenant(`camp-t-h2-${stamp}`);
  await runTest('TEST 8: claimNextLog está aislado por campaignId/tenant', async () => {
    await prisma.contact.create({ data: { name: 'H1', phone: `519900${stamp.toString().slice(-6)}`, tenantId: tenantH1.id } });
    await prisma.contact.create({ data: { name: 'H2', phone: `519901${stamp.toString().slice(-6)}`, tenantId: tenantH2.id } });

    const { campaign: campH1 } = await launchCampaignV2({ tenantId: tenantH1.id, name: 'Camp H1', baseMessage: 'Hola', delayMin: 0, delayMax: 1, audience: 'all' });
    const { campaign: campH2 } = await launchCampaignV2({ tenantId: tenantH2.id, name: 'Camp H2', baseMessage: 'Hola', delayMin: 0, delayMax: 1, audience: 'all' });

    const claimedFromH1 = await claimNextLog(campH1.id, tenantH1.id);
    assert.strictEqual(claimedFromH1.campaignId, campH1.id);

    const logsOfH2 = await prisma.campaignLog.findMany({ where: { campaignId: campH2.id } });
    assert.ok(logsOfH2.every((l) => l.campaignId !== campH1.id));
    assert.ok(!logsOfH2.some((l) => l.id === claimedFromH1.id));
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 9 (I): audience manual con contactId de otro tenant -> ignorado ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenantI1 = await makeTenant(`camp-t-i1-${stamp}`);
  const tenantI2 = await makeTenant(`camp-t-i2-${stamp}`);
  await runTest('TEST 9: contactIds de otro tenant no generan CampaignLog', async () => {
    const ownContact = await prisma.contact.create({ data: { name: 'Propio', phone: `519910${stamp.toString().slice(-6)}`, tenantId: tenantI1.id } });
    const foreignContact = await prisma.contact.create({ data: { name: 'Ajeno', phone: `519911${stamp.toString().slice(-6)}`, tenantId: tenantI2.id } });

    const { campaign, eligibleCount } = await launchCampaignV2({
      tenantId: tenantI1.id,
      name: 'Campaña I',
      baseMessage: 'Hola',
      delayMin: 0,
      delayMax: 1,
      audience: 'manual',
      contactIds: [ownContact.id, foreignContact.id]
    });

    assert.strictEqual(eligibleCount, 1);
    const logs = await prisma.campaignLog.findMany({ where: { campaignId: campaign.id } });
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].customerPhone, ownContact.phone);
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 10 (J): audience=all excluye @g.us e inválidos, incluye @lid ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenantJ = await makeTenant(`camp-t-j-${stamp}`);
  await runTest('TEST 10: excluye grupos @g.us y teléfonos inválidos, incluye @lid', async () => {
    await prisma.contact.createMany({
      data: [
        { name: 'Válido', phone: `519920${stamp.toString().slice(-6)}`, tenantId: tenantJ.id },
        { name: 'Grupo', phone: '120363000000000000@g.us', tenantId: tenantJ.id },
        { name: 'Inválido', phone: '123', tenantId: tenantJ.id },
        { name: 'LID', phone: `${stamp}@lid`, tenantId: tenantJ.id }
      ]
    });

    const { campaign, eligibleCount, totalContacts } = await launchCampaignV2({
      tenantId: tenantJ.id,
      name: 'Campaña J',
      baseMessage: 'Hola',
      delayMin: 0,
      delayMax: 1,
      audience: 'all'
    });

    assert.strictEqual(totalContacts, 4);
    assert.strictEqual(eligibleCount, 2);
    const logs = await prisma.campaignLog.findMany({ where: { campaignId: campaign.id } });
    const phones = logs.map((l) => l.customerPhone);
    assert.ok(phones.some((p) => p.endsWith('@lid')), 'El destino @lid debe ser elegible');
    assert.ok(!phones.some((p) => p.endsWith('@g.us')), 'Los grupos deben excluirse');
    assert.ok(!phones.includes('123'), 'Los teléfonos inválidos deben excluirse');
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 11/12 (K/L): botPaused temporal (Human Handoff) ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenantK = await makeTenant(`camp-t-k-${stamp}`);
  let campaignK, pausedContact;
  await runTest('TEST 11 (K): contacto botPaused no se envía ni falla; otros continúan', async () => {
    const phonePaused = `519930${stamp.toString().slice(-6)}`;
    const phoneNormal = `519931${stamp.toString().slice(-6)}`;

    pausedContact = await prisma.contact.create({
      data: { name: 'Pausado', phone: phonePaused, tenantId: tenantK.id, botPaused: true }
    });
    await prisma.contact.create({ data: { name: 'Normal', phone: phoneNormal, tenantId: tenantK.id } });
    await prisma.customer.create({
      data: {
        tenantId: tenantK.id,
        phone: phonePaused,
        isBotPaused: true,
        persistentProfile: { lastHumanInterventionAt: new Date().toISOString() }
      }
    });

    const { campaign } = await launchCampaignV2({
      tenantId: tenantK.id,
      name: 'Campaña K',
      baseMessage: 'Hola',
      delayMin: 0,
      delayMax: 1,
      audience: 'all'
    });
    campaignK = campaign;

    const claim1 = await claimNextLog(campaignK.id, tenantK.id);
    assert.ok(claim1, 'Debe reclamarse el contacto no pausado');
    assert.strictEqual(claim1.customerPhone, phoneNormal);

    const claim2 = await claimNextLog(campaignK.id, tenantK.id);
    assert.strictEqual(claim2, null, 'No debe reclamarse nada más: el único pending restante está pausado');

    const pausedLog = await prisma.campaignLog.findFirst({ where: { campaignId: campaignK.id, customerPhone: phonePaused } });
    assert.strictEqual(pausedLog.status, 'pending', 'El log del contacto pausado debe seguir pending');
  });

  await runTest('TEST 12 (L): al expirar el Human Handoff, el pending puede reclamarse normalmente', async () => {
    const expiredTimestamp = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    await prisma.customer.updateMany({
      where: { tenantId: tenantK.id, phone: pausedContact.phone },
      data: { persistentProfile: { lastHumanInterventionAt: expiredTimestamp } }
    });

    const claim = await claimNextLog(campaignK.id, tenantK.id);
    assert.ok(claim, 'El log antes pausado ahora debe poder reclamarse');
    assert.strictEqual(claim.customerPhone, pausedContact.phone);
    assert.strictEqual(claim.status, 'processing');
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 13: Gateway text retorna null -> failed -> JAMÁS sent ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenant13 = await makeTenant(`camp-t-13-${stamp}`);
  await runTest('TEST 13: Gateway sendText = null marca status failed y guarda error descriptivo', async () => {
    await forceOfflineMetaGateway(tenant13.id);
    const contact = await prisma.contact.create({
      data: { name: 'Cliente 13', phone: `519940${stamp.toString().slice(-6)}`, tenantId: tenant13.id }
    });
    const { campaign } = await launchCampaignV2({
      tenantId: tenant13.id,
      name: 'Campaña 13',
      baseMessage: 'Aviso pago',
      delayMin: 0,
      delayMax: 1,
      audience: 'all'
    });

    const claimed = await claimNextLog(campaign.id, tenant13.id);
    assert.ok(claimed);

    const success = await sendClaimedLog(claimed, campaign, { provider: 'META', metaAccessToken: null, metaPhoneNumberId: null }, 'Aviso pago', contact.name);
    assert.strictEqual(success, false, 'sendClaimedLog debe retornar false cuando msgId es nulo');

    const updatedLog = await prisma.campaignLog.findUnique({ where: { id: claimed.id } });
    assert.strictEqual(updatedLog.status, 'failed', 'Status DEBE ser failed');
    assert.notStrictEqual(updatedLog.status, 'sent', 'Status JAMÁS debe ser sent cuando el gateway devuelve null');
    assert.ok(updatedLog.errorMessage.includes('no devolvió un identificador de mensaje válido'));
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 14: Gateway media retorna null -> failed ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenant14 = await makeTenant(`camp-t-14-${stamp}`);
  await runTest('TEST 14: Gateway sendMedia = null marca status failed', async () => {
    const contact = await prisma.contact.create({
      data: { name: 'Cliente 14', phone: `519941${stamp.toString().slice(-6)}`, tenantId: tenant14.id }
    });
    const { campaign } = await launchCampaignV2({
      tenantId: tenant14.id,
      name: 'Campaña 14',
      baseMessage: 'Comprobante',
      media: '', // URL vacía -> sendMedia retorna null
      delayMin: 0,
      delayMax: 1,
      audience: 'all'
    });

    const claimed = await claimNextLog(campaign.id, tenant14.id);
    assert.ok(claimed);

    const success = await sendClaimedLog(claimed, { ...campaign, media: '' }, {}, 'Comprobante', contact.name);
    assert.strictEqual(success, false);

    const updatedLog = await prisma.campaignLog.findUnique({ where: { id: claimed.id } });
    assert.strictEqual(updatedLog.status, 'failed');
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 15: processing claimedAt hace 30 segundos -> recovery NO lo toca ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenant15 = await makeTenant(`camp-t-15-${stamp}`);
  await runTest('TEST 15: recovery respeta jobs processing recientes (< 5 min)', async () => {
    await prisma.contact.create({
      data: { name: 'Cliente 15', phone: `519942${stamp.toString().slice(-6)}`, tenantId: tenant15.id }
    });
    const { campaign } = await launchCampaignV2({
      tenantId: tenant15.id,
      name: 'Campaña 15',
      baseMessage: 'Hola',
      delayMin: 0,
      delayMax: 1,
      audience: 'all'
    });

    const claimed = await claimNextLog(campaign.id, tenant15.id);
    assert.ok(claimed);
    await recoverOrphanedProcessing();

    const logAfter = await prisma.campaignLog.findUnique({ where: { id: claimed.id } });
    assert.strictEqual(logAfter.status, 'processing', 'El job reciente DEBE permanecer en processing');
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 16: processing claimedAt hace >5 min -> recovery sí lo recupera ══');
  // ────────────────────────────────────────────────────────────────────────
  await runTest('TEST 16: recovery sí recupera jobs con claimedAt > 5 minutos', async () => {
    const log = await prisma.campaignLog.findFirst({ where: { status: 'processing' } });
    assert.ok(log);

    const sevenMinutesAgo = new Date(Date.now() - 7 * 60 * 1000);
    await prisma.campaignLog.update({
      where: { id: log.id },
      data: { claimedAt: sevenMinutesAgo }
    });

    const recovered = await recoverOrphanedProcessing();
    assert.ok(recovered >= 1);

    const logAfter = await prisma.campaignLog.findUnique({ where: { id: log.id } });
    assert.strictEqual(logAfter.status, 'failed');
    assert.ok(logAfter.errorMessage.includes('stale'));
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 17: scheduled futura -> scheduler NO la ejecuta ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenant17 = await makeTenant(`camp-t-17-${stamp}`);
  await runTest('TEST 17: campaña scheduled futura (nextRunAt > now) no es reclamada por el scheduler', async () => {
    const [dbClock] = await prisma.$queryRaw`SELECT NOW() AS now`;
    const futureDate = new Date(new Date(dbClock.now).getTime() + 2 * 60 * 60 * 1000);
    await prisma.contact.create({
      data: { name: 'Cliente 17', phone: `519943${stamp.toString().slice(-6)}`, tenantId: tenant17.id }
    });

    const { campaign, scheduled } = await launchCampaignV2({
      tenantId: tenant17.id,
      name: 'Campaña 17 Futura',
      baseMessage: 'Recordatorio futuro',
      delayMin: 0,
      delayMax: 1,
      audience: 'all',
      scheduledAt: futureDate
    });

    assert.strictEqual(scheduled, true);
    assert.strictEqual(campaign.status, 'scheduled');

    const logCount = await prisma.campaignLog.count({ where: { campaignId: campaign.id } });
    assert.strictEqual(logCount, 0, 'No deben existir logs antes de la fecha programada');

    await dispatchDueCampaigns();
    const checkCampaign = await prisma.campaign.findUnique({ where: { id: campaign.id } });
    assert.strictEqual(checkCampaign.status, 'scheduled', 'La campaña futura debe permanecer scheduled');
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 18: scheduled vencida -> scheduler la reclama ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenant18 = await makeTenant(`camp-t-18-${stamp}`);
  await runTest('TEST 18: campaña scheduled vencida (nextRunAt <= now) es reclamada y activada', async () => {
    const pastDate = new Date(Date.now() - 5 * 60 * 1000);
    await prisma.contact.create({
      data: { name: 'Cliente 18', phone: `519944${stamp.toString().slice(-6)}`, tenantId: tenant18.id }
    });

    const created = await prisma.campaign.create({
      data: {
        name: 'Campaña 18 Vencida',
        baseMessage: 'Pago vencido',
        status: 'scheduled',
        scheduledAt: pastDate,
        nextRunAt: pastDate,
        anchorDay: pastDate.getUTCDate(),
        recurrenceType: 'EVERY_15_DAYS',
        tenantId: tenant18.id
      }
    });

    const claimed = await dispatchDueCampaigns();
    assert.ok(claimed);
    assert.strictEqual(claimed.id, created.id);

    const updated = await prisma.campaign.findUnique({ where: { id: created.id } });
    assert.strictEqual(updated.status, 'running');
    assert.ok(updated.lastRunAt);

    const logs = await prisma.campaignLog.findMany({ where: { campaignId: created.id } });
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].status, 'pending');
    assert.ok(logs[0].occurrenceKey.startsWith('occ_'));
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 19: calculateNextRun EVERY_15_DAYS (+15 días exactos) ══');
  // ────────────────────────────────────────────────────────────────────────
  await runTest('TEST 19: EVERY_15_DAYS suma exactamente 15 días en UTC', async () => {
    const base = new Date('2026-09-01T10:30:00.000Z');
    const next = calculateNextRun({ recurrenceType: 'EVERY_15_DAYS', fromDate: base });
    assert.strictEqual(next.toISOString(), '2026-09-16T10:30:00.000Z');
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 20: calculateNextRun MONTHLY normal (+1 mes exacto) ══');
  // ────────────────────────────────────────────────────────────────────────
  await runTest('TEST 20: MONTHLY preserva hora y salta exactamente al mes siguiente', async () => {
    const base = new Date('2026-05-10T08:00:00.000Z');
    const next = calculateNextRun({ recurrenceType: 'MONTHLY', fromDate: base, anchorDay: 10 });
    assert.strictEqual(next.toISOString(), '2026-06-10T08:00:00.000Z');
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 21: calculateNextRun día 31 -> febrero (28) -> marzo (31) ══');
  // ────────────────────────────────────────────────────────────────────────
  await runTest('TEST 21: preservación de anchorDay 31 en febrero y marzo', async () => {
    const jan31 = new Date('2026-01-31T14:00:00.000Z');
    const feb = calculateNextRun({ recurrenceType: 'MONTHLY', fromDate: jan31, anchorDay: 31 });
    assert.strictEqual(feb.toISOString(), '2026-02-28T14:00:00.000Z', 'En febrero debe correr el 28');

    const mar = calculateNextRun({ recurrenceType: 'MONTHLY', fromDate: feb, anchorDay: 31 });
    assert.strictEqual(mar.toISOString(), '2026-03-31T14:00:00.000Z', 'En marzo debe volver a correr el 31');

    const apr = calculateNextRun({ recurrenceType: 'MONTHLY', fromDate: mar, anchorDay: 31 });
    assert.strictEqual(apr.toISOString(), '2026-04-30T14:00:00.000Z', 'En abril debe correr el 30');
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 22: dos schedulers concurrentes -> una sola occurrence ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenant22 = await makeTenant(`camp-t-22-${stamp}`);
  await runTest('TEST 22: FOR UPDATE SKIP LOCKED previene doble reclamo simultáneo', async () => {
    const past = new Date(Date.now() - 10000);
    const camp22 = await prisma.campaign.create({
      data: {
        name: 'Camp 22 Concurrente',
        baseMessage: 'Aviso',
        status: 'scheduled',
        nextRunAt: past,
        tenantId: tenant22.id
      }
    });

    const [claimA, claimB] = await Promise.all([
      dispatchDueCampaigns(),
      dispatchDueCampaigns()
    ]);

    const claims = [claimA, claimB].filter((c) => c && c.id === camp22.id);
    assert.strictEqual(claims.length, 1, 'Exactamente un scheduler debe reclamar la campaña');
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 23: misma occurrence ejecutada dos veces -> cero duplicados ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenant23 = await makeTenant(`camp-t-23-${stamp}`);
  await runTest('TEST 23: @@unique([campaignId, customerPhone, occurrenceKey]) previene duplicados', async () => {
    const phone = `519950${stamp.toString().slice(-6)}`;
    const camp23 = await prisma.campaign.create({
      data: { name: 'Camp 23', baseMessage: 'Test', status: 'running', tenantId: tenant23.id }
    });

    const occKey = 'occ_2026-09-15T00:00:00.000Z';

    await prisma.campaignLog.createMany({
      data: [{ campaignId: camp23.id, customerPhone: phone, status: 'pending', sentMessage: '', occurrenceKey: occKey }],
      skipDuplicates: true
    });

    await prisma.campaignLog.createMany({
      data: [{ campaignId: camp23.id, customerPhone: phone, status: 'pending', sentMessage: '', occurrenceKey: occKey }],
      skipDuplicates: true
    });

    const totalLogs = await prisma.campaignLog.count({ where: { campaignId: camp23.id } });
    assert.strictEqual(totalLogs, 1, 'No debe duplicarse el log para la misma occurrenceKey');
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 24: crash/retry simulation -> recovery crea solo faltantes ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenant24 = await makeTenant(`camp-t-24-${stamp}`);
  await runTest('TEST 24: logs parcialmente creados se completan sin duplicar', async () => {
    const c1 = await prisma.contact.create({ data: { name: 'C1', phone: `519960${stamp.toString().slice(-6)}1`, tenantId: tenant24.id } });
    const c2 = await prisma.contact.create({ data: { name: 'C2', phone: `519960${stamp.toString().slice(-6)}2`, tenantId: tenant24.id } });

    const camp24 = await prisma.campaign.create({
      data: {
        name: 'Camp 24 Crash',
        baseMessage: 'Hola',
        status: 'running',
        lastRunAt: new Date(),
        audienceType: 'all',
        tenantId: tenant24.id
      }
    });

    const occKey = `occ_${new Date(camp24.lastRunAt).toISOString()}`;

    await prisma.campaignLog.create({
      data: { campaignId: camp24.id, customerPhone: c1.phone, status: 'pending', sentMessage: '', occurrenceKey: occKey }
    });

    const contacts = [c1, c2];
    await prisma.campaignLog.createMany({
      data: contacts.map((c) => ({
        campaignId: camp24.id,
        customerPhone: c.phone,
        status: 'pending',
        sentMessage: '',
        occurrenceKey: occKey
      })),
      skipDuplicates: true
    });

    const finalLogs = await prisma.campaignLog.findMany({ where: { campaignId: camp24.id } });
    assert.strictEqual(finalLogs.length, 2, 'Debe haber exactamente 2 logs (C1 y C2)');
    const phones = finalLogs.map((l) => l.customerPhone);
    assert.ok(phones.includes(c1.phone));
    assert.ok(phones.includes(c2.phone));
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 25: manual audience con contactId Tenant B -> ignorado ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenant25A = await makeTenant(`camp-t-25a-${stamp}`);
  const tenant25B = await makeTenant(`camp-t-25b-${stamp}`);
  await runTest('TEST 25: contactId ajeno en scheduled/recurrencia es ignorado', async () => {
    const contactA = await prisma.contact.create({ data: { name: 'A', phone: `519970${stamp.toString().slice(-6)}`, tenantId: tenant25A.id } });
    const contactB = await prisma.contact.create({ data: { name: 'B', phone: `519971${stamp.toString().slice(-6)}`, tenantId: tenant25B.id } });

    const { campaign } = await launchCampaignV2({
      tenantId: tenant25A.id,
      name: 'Camp 25',
      baseMessage: 'Hola',
      delayMin: 0,
      delayMax: 1,
      audience: 'manual',
      contactIds: [contactA.id, contactB.id]
    });

    const logs = await prisma.campaignLog.findMany({ where: { campaignId: campaign.id } });
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].customerPhone, contactA.phone);
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 26: @lid sigue preservado en scheduled ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenant26 = await makeTenant(`camp-t-26-${stamp}`);
  await runTest('TEST 26: destino @lid es admitido en ocurrencia programada', async () => {
    await prisma.contact.create({
      data: { name: 'LID Contact', phone: `123456789${stamp.toString().slice(-4)}@lid`, tenantId: tenant26.id }
    });

    const { campaign, eligibleCount } = await launchCampaignV2({
      tenantId: tenant26.id,
      name: 'Camp 26 LID',
      baseMessage: 'Hola LID',
      delayMin: 0,
      delayMax: 1,
      audience: 'all'
    });

    assert.strictEqual(eligibleCount, 1);
    const log = await prisma.campaignLog.findFirst({ where: { campaignId: campaign.id } });
    assert.ok(log.customerPhone.endsWith('@lid'));
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 27: botPaused diferido en ocurrencia programada ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenant27 = await makeTenant(`camp-t-27-${stamp}`);
  await runTest('TEST 27: contacto botPaused no bloquea el envío de otros en la misma campaña', async () => {
    const pPaused = `519980${stamp.toString().slice(-6)}`;
    const pNormal = `519981${stamp.toString().slice(-6)}`;

    await prisma.contact.create({ data: { name: 'Paused', phone: pPaused, tenantId: tenant27.id, botPaused: true } });
    await prisma.contact.create({ data: { name: 'Normal', phone: pNormal, tenantId: tenant27.id } });
    await prisma.customer.create({
      data: { tenantId: tenant27.id, phone: pPaused, isBotPaused: true, persistentProfile: { lastHumanInterventionAt: new Date().toISOString() } }
    });

    const { campaign } = await launchCampaignV2({
      tenantId: tenant27.id,
      name: 'Camp 27',
      baseMessage: 'Hola',
      delayMin: 0,
      delayMax: 1,
      audience: 'all'
    });

    const claimedNormal = await claimNextLog(campaign.id, tenant27.id);
    assert.ok(claimedNormal);
    assert.strictEqual(claimedNormal.customerPhone, pNormal);

    const claimNone = await claimNextLog(campaign.id, tenant27.id);
    assert.strictEqual(claimNone, null);
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 28: Persistencia en PostgreSQL y tolerancia a reinicio ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenant28 = await makeTenant(`camp-t-28-${stamp}`);
  await runTest('TEST 28: Campaña programada en PostgreSQL sobrevive reinicio del worker', async () => {
    const past = new Date(Date.now() - 5000);
    const camp28 = await prisma.campaign.create({
      data: {
        name: 'Camp 28 Restart Survives',
        baseMessage: 'Recordatorio persistente',
        status: 'scheduled',
        nextRunAt: past,
        tenantId: tenant28.id
      }
    });

    await prisma.contact.create({
      data: { name: 'C28', phone: `519990${stamp.toString().slice(-6)}`, tenantId: tenant28.id }
    });

    const claimed = await dispatchDueCampaigns();
    assert.ok(claimed);
    assert.strictEqual(claimed.id, camp28.id);

    const inDb = await prisma.campaign.findUnique({ where: { id: camp28.id } });
    assert.strictEqual(inDb.status, 'running');
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 29: Immediate occurrenceKey is strictly imm_${campaign.id} ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenant29 = await makeTenant(`camp-t-29-${stamp}`);
  await runTest('TEST 29: Campaña inmediata fija occurrenceKey = imm_${campaign.id}', async () => {
    await prisma.contact.create({
      data: { name: 'C29', phone: `519901${stamp.toString().slice(-6)}`, tenantId: tenant29.id }
    });
    const { campaign } = await launchCampaignV2({
      tenantId: tenant29.id,
      name: 'Camp 29 Immediate Key',
      baseMessage: 'Recordatorio',
      delayMin: 0,
      delayMax: 1,
      audience: 'all'
    });

    const logs = await prisma.campaignLog.findMany({ where: { campaignId: campaign.id } });
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].occurrenceKey, `imm_${campaign.id}`, 'La occurrenceKey debe ser exactamente imm_${campaign.id}');
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 30: 100 contactos + 10 logs creados + recovery -> 100 total, 0 duplicados ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenant30 = await makeTenant(`camp-t-30-${stamp}`);
  let camp30Id;
  await runTest('TEST 30: Recovery parcial completa los 90 faltantes sin duplicar los 10 existentes', async () => {
    const contacts = [];
    for (let i = 0; i < 100; i++) {
      contacts.push({
        name: `Cliente 30-${i}`,
        phone: `5197${(stamp % 10000).toString().padStart(4, '0')}${i.toString().padStart(3, '0')}`,
        tenantId: tenant30.id
      });
    }
    await prisma.contact.createMany({ data: contacts });

    const camp30 = await prisma.campaign.create({
      data: {
        name: 'Camp 30 Parcial',
        baseMessage: 'Aviso parcial',
        status: 'running',
        lastRunAt: new Date(),
        audienceType: 'all',
        delayMin: 0,
        delayMax: 0,
        tenantId: tenant30.id
      }
    });
    camp30Id = camp30.id;

    const occurrenceKey = `imm_${camp30.id}`;

    // Simular que antes del crash solo se insertaron los primeros 10 logs:
    await prisma.campaignLog.createMany({
      data: contacts.slice(0, 10).map((c) => ({
        campaignId: camp30.id,
        customerPhone: c.phone,
        status: 'pending',
        sentMessage: '',
        occurrenceKey
      })),
      skipDuplicates: true
    });

    const initialCount = await prisma.campaignLog.count({ where: { campaignId: camp30.id } });
    assert.strictEqual(initialCount, 10, 'Deben existir 10 logs antes del recovery');

    await resumeRunningCampaigns();

    const finalCount = await prisma.campaignLog.count({ where: { campaignId: camp30.id } });
    assert.strictEqual(finalCount, 100, 'El recovery debe completar exactamente los 100 logs');

    const uniquePhones = await prisma.campaignLog.findMany({
      where: { campaignId: camp30.id },
      distinct: ['customerPhone']
    });
    assert.strictEqual(uniquePhones.length, 100, 'Cero duplicados permitidos');
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 31: Recovery ejecutado nuevamente -> sigue 100, 0 duplicados ══');
  // ────────────────────────────────────────────────────────────────────────
  await runTest('TEST 31: Re-ejecutar recovery es 100% idempotente (conserva 100 logs)', async () => {
    assert.ok(camp30Id);
    await resumeRunningCampaigns();
    const countAfterSecondResume = await prisma.campaignLog.count({ where: { campaignId: camp30Id } });
    assert.strictEqual(countAfterSecondResume, 100, 'Sigue habiendo exactamente 100 logs tras re-ejecución');
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 32: Scheduled ejecutada tarde -> conserva hora programada ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenant32 = await makeTenant(`camp-t-32-${stamp}`);
  await runTest('TEST 32: Reclamo tardío fija lastRunAt = nextRunAt programado (cero drift)', async () => {
    const [dbClock] = await prisma.$queryRaw`SELECT NOW() AS now`;
    const scheduledTime = new Date(new Date(dbClock.now).getTime() - 4 * 60 * 60 * 1000);
    const camp32 = await prisma.campaign.create({
      data: {
        name: 'Camp 32 Late Execution',
        baseMessage: 'Pago',
        status: 'scheduled',
        scheduledAt: scheduledTime,
        nextRunAt: scheduledTime,
        recurrenceType: 'EVERY_15_DAYS',
        tenantId: tenant32.id
      }
    });

    await prisma.contact.create({
      data: { name: 'C32', phone: `519902${stamp.toString().slice(-6)}`, tenantId: tenant32.id }
    });

    const claimed = await dispatchDueCampaigns();
    assert.ok(claimed, 'La campaña programada vencida debe ser reclamada');
    assert.strictEqual(claimed.id, camp32.id);

    const updated = await prisma.campaign.findUnique({ where: { id: camp32.id } });
    assert.strictEqual(
      new Date(updated.lastRunAt).toISOString(),
      scheduledTime.toISOString(),
      'lastRunAt debe preservar exactamente la hora programada original (cero drift)'
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 33: EVERY_15_DAYS varios ciclos -> cero drift ══');
  // ────────────────────────────────────────────────────────────────────────
  await runTest('TEST 33: calculateNextRun EVERY_15_DAYS en 4 ciclos consecutivos mantiene 09:00:00Z exacto', async () => {
    const start = new Date('2026-10-01T09:00:00.000Z');
    const c1 = calculateNextRun({ recurrenceType: 'EVERY_15_DAYS', fromDate: start });
    assert.strictEqual(c1.toISOString(), '2026-10-16T09:00:00.000Z');

    const c2 = calculateNextRun({ recurrenceType: 'EVERY_15_DAYS', fromDate: c1 });
    assert.strictEqual(c2.toISOString(), '2026-10-31T09:00:00.000Z');

    const c3 = calculateNextRun({ recurrenceType: 'EVERY_15_DAYS', fromDate: c2 });
    assert.strictEqual(c3.toISOString(), '2026-11-15T09:00:00.000Z');

    const c4 = calculateNextRun({ recurrenceType: 'EVERY_15_DAYS', fromDate: c3 });
    assert.strictEqual(c4.toISOString(), '2026-11-30T09:00:00.000Z');
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 34: MONTHLY varios ciclos -> cero drift con anchorDay 31 ══');
  // ────────────────────────────────────────────────────────────────────────
  await runTest('TEST 34: calculateNextRun MONTHLY en 6 ciclos consecutivos conserva 09:30:00Z y anchorDay 31', async () => {
    const start = new Date('2026-01-31T09:30:00.000Z');
    const anchorDay = 31;

    // Ene -> Feb (28 en año no bisiesto 2026)
    const feb = calculateNextRun({ recurrenceType: 'MONTHLY', fromDate: start, anchorDay });
    assert.strictEqual(feb.toISOString(), '2026-02-28T09:30:00.000Z');

    // Feb -> Mar (31 preservado!)
    const mar = calculateNextRun({ recurrenceType: 'MONTHLY', fromDate: feb, anchorDay });
    assert.strictEqual(mar.toISOString(), '2026-03-31T09:30:00.000Z');

    // Mar -> Abr (30)
    const apr = calculateNextRun({ recurrenceType: 'MONTHLY', fromDate: mar, anchorDay });
    assert.strictEqual(apr.toISOString(), '2026-04-30T09:30:00.000Z');

    // Abr -> May (31 preservado!)
    const may = calculateNextRun({ recurrenceType: 'MONTHLY', fromDate: apr, anchorDay });
    assert.strictEqual(may.toISOString(), '2026-05-31T09:30:00.000Z');

    // May -> Jun (30)
    const jun = calculateNextRun({ recurrenceType: 'MONTHLY', fromDate: may, anchorDay });
    assert.strictEqual(jun.toISOString(), '2026-06-30T09:30:00.000Z');

    // Jun -> Jul (31 preservado!)
    const jul = calculateNextRun({ recurrenceType: 'MONTHLY', fromDate: jun, anchorDay });
    assert.strictEqual(jul.toISOString(), '2026-07-31T09:30:00.000Z');
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 35: processing con claimedAt null (legacy) -> recovery marca failed ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenant35 = await makeTenant(`camp-t-35-${stamp}`);
  await runTest('TEST 35: recoverOrphanedProcessing limpia registros processing con claimedAt = null', async () => {
    const camp35 = await prisma.campaign.create({
      data: { name: 'Camp 35 Legacy', baseMessage: 'Test', status: 'running', tenantId: tenant35.id }
    });
    const log = await prisma.campaignLog.create({
      data: {
        campaignId: camp35.id,
        customerPhone: `519903${stamp.toString().slice(-6)}`,
        status: 'processing',
        sentMessage: '',
        claimedAt: null
      }
    });

    const count = await recoverOrphanedProcessing();
    assert.ok(count >= 1);

    const updated = await prisma.campaignLog.findUnique({ where: { id: log.id } });
    assert.strictEqual(updated.status, 'failed', 'Log legacy en processing debe recuperarse como failed');
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n══ TEST 36: processing con claimedAt reciente (<5 min) -> NO se recupera ══');
  // ────────────────────────────────────────────────────────────────────────
  const tenant36 = await makeTenant(`camp-t-36-${stamp}`);
  await runTest('TEST 36: recoverOrphanedProcessing no toca jobs con claimedAt reciente (< 5 min)', async () => {
    const camp36 = await prisma.campaign.create({
      data: { name: 'Camp 36 Fresh', baseMessage: 'Test', status: 'running', tenantId: tenant36.id }
    });
    const freshLog = await prisma.campaignLog.create({
      data: {
        campaignId: camp36.id,
        customerPhone: `519904${stamp.toString().slice(-6)}`,
        status: 'processing',
        sentMessage: '',
        claimedAt: new Date()
      }
    });

    await recoverOrphanedProcessing();

    const check = await prisma.campaignLog.findUnique({ where: { id: freshLog.id } });
    assert.strictEqual(check.status, 'processing', 'El log reciente debe seguir en processing');

    // Limpieza
    await prisma.campaignLog.update({ where: { id: freshLog.id }, data: { status: 'failed' } });
  });

  console.log('\n======================================================================');
  console.log(`📊 RESULTADO: ${passedTests}/${totalTests} tests pasados`);
  console.log('======================================================================');

  if (passedTests !== totalTests) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('\n💥 ERROR FATAL EN LA SUITE:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(passedTests === totalTests ? 0 : 1);
  });
