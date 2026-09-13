process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import {
  formatRelativeTime,
  formatShortDateTime,
  formatCustomerDisplay,
  formatCancelReason,
  buildFollowUpTimeline,
  STATUS_BADGES,
  CANCEL_REASON_LABELS
} from '../src/utils/followUpFormatters.js';

console.log('======================================================================');
console.log('🧪 FOLLOW-UPS PRODUCT UX TEST SUITE (PURE FRONTEND LOGIC)');
console.log('======================================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}:`, err.message);
    throw err;
  }
}

// 1. Relative time tests
runTest('TC-UX-01: formatRelativeTime handles minutes, hours, and days in the future', () => {
  const base = new Date('2026-09-13T12:00:00.000Z');

  // +45 mins
  const t45m = new Date('2026-09-13T12:45:00.000Z');
  assert.strictEqual(formatRelativeTime(t45m, base), 'En 45 min');

  // +2h 14m
  const t2h14m = new Date('2026-09-13T14:14:00.000Z');
  assert.strictEqual(formatRelativeTime(t2h14m, base), 'En 2 h 14 min');

  // +1 day
  const t1d = new Date('2026-09-14T12:00:00.000Z');
  assert.strictEqual(formatRelativeTime(t1d, base), 'En 1 día');

  // +2 days
  const t2d = new Date('2026-09-15T12:00:00.000Z');
  assert.strictEqual(formatRelativeTime(t2d, base), 'En 2 días');
});

runTest('TC-UX-02: formatRelativeTime handles past timestamps and immediate future', () => {
  const base = new Date('2026-09-13T12:00:00.000Z');

  // Less than 1 min future
  const t30s = new Date('2026-09-13T12:00:30.000Z');
  assert.strictEqual(formatRelativeTime(t30s, base), 'En menos de 1 min');

  // Past 10 min
  const p10m = new Date('2026-09-13T11:50:00.000Z');
  assert.strictEqual(formatRelativeTime(p10m, base), 'Hace 10 min');

  // Past 3 hours
  const p3h = new Date('2026-09-13T09:00:00.000Z');
  assert.strictEqual(formatRelativeTime(p3h, base), 'Hace 3 h');
});

// 2. Short date formatting tests
runTest('TC-UX-03: formatShortDateTime produces friendly Spanish date/time without technical ISO strings', () => {
  // We format with America/Lima timezone
  const dateStr = '2026-09-13T19:35:00.000Z'; // 14:35 Lima
  const formatted = formatShortDateTime(dateStr, 'America/Lima');
  assert(formatted.includes('p. m.') || formatted.includes('PM') || formatted.includes('14:35') || formatted.includes('2:35'));
  assert(!formatted.includes('T') && !formatted.includes('Z'), 'Must not display ISO technical separators');
});

// 3. No technical identifiers visible in Customer Display
runTest('TC-UX-04: formatCustomerDisplay cleans raw WhatsApp JIDs and formats Peru phones', () => {
  const rawJidCustomer = {
    name: 'Maria Torres',
    phone: '51987654321@s.whatsapp.net'
  };
  const res = formatCustomerDisplay(rawJidCustomer);
  assert.strictEqual(res.displayName, 'Maria Torres');
  assert.strictEqual(res.displayPhone, '+51 987 654 321');
  assert(!res.displayPhone.includes('@s.whatsapp.net'), 'Raw domain must be stripped');
  assert.strictEqual(res.initials, 'MT');
  // Underlying customer must be immutable
  assert.strictEqual(rawJidCustomer.phone, '51987654321@s.whatsapp.net');
});

runTest('TC-UX-05: formatCustomerDisplay handles phone-only customer with clean initials and fallback', () => {
  const phoneOnly = {
    name: null,
    phone: '51912345678@c.us'
  };
  const res = formatCustomerDisplay(phoneOnly);
  assert.strictEqual(res.displayName, '+51 912 345 678');
  assert.strictEqual(res.displayPhone, '+51 912 345 678');
  assert(!res.displayPhone.includes('@c.us'));
});

// 4. Status badges in commercial language
runTest('TC-UX-06: STATUS_BADGES uses commercial terms (Preparando seguimiento, Esperando respuesta)', () => {
  assert.strictEqual(STATUS_BADGES.PROCESSING.label, 'Preparando seguimiento');
  assert.strictEqual(STATUS_BADGES.WAITING_NEXT.label, 'Esperando respuesta');
  assert.strictEqual(STATUS_BADGES.SCHEDULED.label, 'Programado');
  assert.strictEqual(STATUS_BADGES.RECOVERED.label, 'Recuperado');
});

// 5. Cancel Reason formatting
runTest('TC-UX-07: formatCancelReason maps internal reason codes to clear Spanish labels', () => {
  assert.strictEqual(formatCancelReason('HUMAN_HANDOFF'), 'Atención humana transferida');
  assert.strictEqual(formatCancelReason('MANUAL_CANCEL'), 'Cancelado manualmente');
  assert.strictEqual(formatCancelReason('USER_REQUEST'), 'Solicitud del cliente');
  assert.strictEqual(formatCancelReason('OUT_OF_STOCK'), 'Producto sin stock');
  assert.strictEqual(formatCancelReason('MAX_ATTEMPTS_REACHED'), 'No respondió después de 3 intentos');
});

// 6. Timeline Generation from Real Fields
runTest('TC-UX-08: buildFollowUpTimeline generates clean chronological timeline only from real fields', () => {
  const mockSequence = {
    id: 'seq_test_123',
    status: 'RECOVERED',
    stageAtCreation: 'PRODUCT_SELECTED',
    productName: 'JBL Go 4',
    anchorAt: '2026-09-13T17:22:56.000Z',
    createdAt: '2026-09-13T17:23:05.000Z',
    recoveredAt: '2026-09-13T17:49:30.000Z',
    attempts: [
      {
        id: 'att_1',
        attemptNumber: 1,
        status: 'SENT',
        sentAt: '2026-09-13T17:26:43.000Z',
        deliveredAt: '2026-09-13T17:26:44.000Z',
        readAt: '2026-09-13T17:26:45.000Z',
        sentMessage: '¡Hola! ¿Aún te gustaría llevar el JBL Go 4?'
      }
    ]
  };

  const timeline = buildFollowUpTimeline(mockSequence, 'America/Lima');

  assert.strictEqual(timeline.length, 6, 'Should generate 6 distinct events: anchor, created, sent, delivered, read, recovered');

  // Verify chronology
  for (let i = 0; i < timeline.length - 1; i++) {
    assert(timeline[i].time.getTime() <= timeline[i + 1].time.getTime(), 'Timeline must be strictly ascending in time');
  }

  assert.strictEqual(timeline[0].title, 'Cliente mostró intención');
  assert.strictEqual(timeline[1].title, 'Seguimiento programado');
  assert.strictEqual(timeline[2].title, 'Seguimiento #1 enviado');
  assert.strictEqual(timeline[2].description, '¡Hola! ¿Aún te gustaría llevar el JBL Go 4?');
  assert.strictEqual(timeline[3].title, 'Intento #1 entregado');
  assert.strictEqual(timeline[4].title, 'Intento #1 leído');
  assert(timeline[5].title.includes('Recuperado'), 'Final event must be recovery');
});

runTest('TC-UX-09: buildFollowUpTimeline does NOT fabricate unconfirmed delivery or read events', () => {
  const mockSequence = {
    id: 'seq_test_partial',
    status: 'WAITING_NEXT',
    anchorAt: '2026-09-13T10:00:00.000Z',
    createdAt: '2026-09-13T10:01:00.000Z',
    attempts: [
      {
        id: 'att_1',
        attemptNumber: 1,
        status: 'SENT',
        sentAt: '2026-09-13T16:00:00.000Z',
        deliveredAt: null, // NOT delivered yet
        readAt: null // NOT read yet
      }
    ]
  };

  const timeline = buildFollowUpTimeline(mockSequence, 'America/Lima');

  const titles = timeline.map(t => t.title);
  assert(titles.includes('Cliente mostró intención'));
  assert(titles.includes('Seguimiento programado'));
  assert(titles.includes('Seguimiento #1 enviado'));
  assert(!titles.includes('Intento #1 entregado'), 'Must NOT fabricate delivered event when deliveredAt is null');
  assert(!titles.includes('Intento #1 leído'), 'Must NOT fabricate read event when readAt is null');
});

runTest('TC-UX-10: buildFollowUpTimeline handles cancelled sequence with human reason', () => {
  const mockCancelledSequence = {
    id: 'seq_test_cancelled',
    status: 'CANCELLED',
    cancelReason: 'HUMAN_HANDOFF',
    anchorAt: '2026-09-13T10:00:00.000Z',
    createdAt: '2026-09-13T10:01:00.000Z',
    updatedAt: '2026-09-13T11:30:00.000Z',
    attempts: []
  };

  const timeline = buildFollowUpTimeline(mockCancelledSequence, 'America/Lima');
  const cancelEvent = timeline.find(t => t.title === 'Seguimiento detenido');
  assert(cancelEvent !== undefined, 'Cancelled event must be present');
  assert.strictEqual(cancelEvent.description, 'Atención humana transferida');
});

console.log('\n======================================================================');
console.log(`🏁 PRODUCT UX SUITE COMPLETE: ${passedTests}/${totalTests} PASSED (100%)`);
console.log('======================================================================\n');
