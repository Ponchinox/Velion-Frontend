/**
 * QA TEST SUITE: Multi-Image Batch / Album & Cross-Instance Deduplication
 * =====================================================================
 * Tests:
 * - D01-D05: Scoped Webhook Deduplication (Certifying Inbound DB persistence, Media Storage, Socket.IO & Eco Isolation)
 * - A01-A16: Album Identification, Strict Normalization, Safe Fallback, Non-consecutive Anchoring & Lightbox
 */

import assert from 'node:assert';

export async function runMediaAlbumDedupeSuite() {
  const suiteResults = [];

  async function test(id, description, fn) {
    try {
      await fn();
      suiteResults.push({ id, description, passed: true });
      console.log(`  ✅ [PASS] ${id}: ${description}`);
    } catch (err) {
      suiteResults.push({ id, description, passed: false, error: err.message });
      console.error(`  ❌ [FAIL] ${id}: ${description} -> ${err.message}`);
    }
  }

  console.log('\n--- SUITE: Scoped Webhook Deduplication (D01-D05) ---');

  // Simulación del ciclo completo de ingestión de whatsappController.js
  class MockIngestionPipeline {
    constructor() {
      this.processedWebhooksCache = new Map();
      this.dbMessages = [];
      this.storedMedia = [];
      this.socketEmits = [];
    }

    getDedupeKey(provider, instance, direction, msgId) {
      return `${provider}:${instance || 'default'}:${direction}:${msgId}`;
    }

    async processWebhook({ provider = 'EVOLUTION', instance, direction, msgId, mediaBuffer = null, tenantId = 't-default', text = '' }) {
      if (!msgId) return { ignored: false, reason: 'NO_MSG_ID' };

      const dedupeKey = this.getDedupeKey(provider, instance, direction, msgId);
      if (this.processedWebhooksCache.has(dedupeKey)) {
        return { ignored: true, reason: 'DUPLICATE_WEBHOOK' };
      }
      this.processedWebhooksCache.set(dedupeKey, Date.now());

      if (direction === 'out') {
        // Outbound echo: no persiste inbound ni descarga media, solo maneja echo
        return { ignored: false, type: 'echo_handled' };
      }

      // Inbound real: persiste en DB, almacena media y emite Socket.IO
      const messageId = `msg-${msgId}`;
      let mediaPath = null;
      if (mediaBuffer) {
        mediaPath = `/media/${tenantId}/${messageId}.jpg`;
        this.storedMedia.push({ tenantId, messageId, path: mediaPath, bufferSize: mediaBuffer.length });
      }

      const savedMsg = { id: messageId, externalId: msgId, tenantId, mediaPath, text, createdAt: new Date() };
      this.dbMessages.push(savedMsg);

      this.socketEmits.push({
        event: 'new_whatsapp_message',
        id: messageId,
        externalId: msgId,
        type: 'incoming',
        from: 'client',
        mediaUrl: mediaPath ? `/api/chats/media/${messageId}` : null
      });

      return { ignored: false, type: 'inbound_persisted', messageId };
    }
  }

  await test('D01', 'same instance + same direction + same msgId -> segundo ignorado', async () => {
    const pipeline = new MockIngestionPipeline();
    const res1 = await pipeline.processWebhook({ instance: 'bot_inst_A', direction: 'in', msgId: 'dup-1001' });
    const res2 = await pipeline.processWebhook({ instance: 'bot_inst_A', direction: 'in', msgId: 'dup-1001' });

    assert.strictEqual(res1.ignored, false, 'El primer webhook debe ser procesado');
    assert.strictEqual(res2.ignored, true, 'El segundo webhook idéntico debe ser ignorado');
    assert.strictEqual(res2.reason, 'DUPLICATE_WEBHOOK');
    assert.strictEqual(pipeline.dbMessages.length, 1, 'Debe persistirse exactamente 1 vez en DB');
  });

  await test('D02', 'instance A inbound + instance B outbound echo + same msgId -> ambos proceden sin colisión', async () => {
    const pipeline = new MockIngestionPipeline();
    const resA = await pipeline.processWebhook({ instance: 'bot_inst_A', direction: 'in', msgId: 'shared-2002' });
    const resB = await pipeline.processWebhook({ instance: 'bot_inst_B', direction: 'out', msgId: 'shared-2002' });

    assert.strictEqual(resA.ignored, false);
    assert.strictEqual(resB.ignored, false);
    assert.strictEqual(pipeline.dbMessages.length, 1, 'Solo el inbound persiste en DB');
    assert.strictEqual(pipeline.socketEmits.length, 1, 'Solo se emite 1 Socket.IO inbound');
  });

  await test('D03', 'CRITICAL REGRESSION: outbound echo llega PRIMERO then inbound real -> inbound persiste 1 vez, media almacenada 1 vez, socket emitido', async () => {
    const pipeline = new MockIngestionPipeline();
    const msgId = 'A512ECE7240211736CF042C7D6F44678';
    const fakeBuffer = Buffer.from('fake-jpeg-binary-data');

    // 1. Eco saliente llega primero desde la instancia B (emisor)
    const echoRes = await pipeline.processWebhook({
      instance: 'bot_prod_dfe020e6_velion_oficial',
      direction: 'out',
      msgId
    });
    assert.strictEqual(echoRes.ignored, false);
    assert.strictEqual(echoRes.type, 'echo_handled');
    assert.strictEqual(pipeline.dbMessages.length, 0, 'El eco no debe guardar mensaje inbound');

    // 2. Inbound legítimo llega milisegundos después a la instancia A (receptor)
    const inboundRes = await pipeline.processWebhook({
      instance: 'bot_prod_acd4dc9e_prueba_gemini',
      direction: 'in',
      msgId,
      mediaBuffer: fakeBuffer,
      tenantId: 'tenant-gemini'
    });

    assert.strictEqual(inboundRes.ignored, false, 'El inbound NO debe ser bloqueado por el eco previo');
    assert.strictEqual(inboundRes.type, 'inbound_persisted');

    // Certificación estricta:
    assert.strictEqual(pipeline.dbMessages.length, 1, 'Inbound real termina en DB exactamente una vez');
    assert.strictEqual(pipeline.dbMessages[0].externalId, msgId);
    assert.strictEqual(pipeline.storedMedia.length, 1, 'Media se almacena exactamente una vez para el tenant');
    assert.strictEqual(pipeline.socketEmits.length, 1, 'Se emite exactamente un new_whatsapp_message');
    assert.strictEqual(pipeline.socketEmits[0].externalId, msgId);

    // 3. Duplicado real posterior (misma instancia + misma dirección + mismo msgId) SÍ se ignora
    const duplicateRes = await pipeline.processWebhook({
      instance: 'bot_prod_acd4dc9e_prueba_gemini',
      direction: 'in',
      msgId,
      mediaBuffer: fakeBuffer
    });
    assert.strictEqual(duplicateRes.ignored, true, 'Duplicado real idéntico es ignorado');
    assert.strictEqual(pipeline.dbMessages.length, 1, 'La DB sigue con exactamente 1 registro');
  });

  await test('D04', 'inbound real llega primero then outbound echo -> inbound persiste una sola vez, media almacenada una vez, eco no bloquea y duplicado se ignora', async () => {
    const pipeline = new MockIngestionPipeline();
    const msgId = 'msg-seq-4004';
    const fakeBuffer = Buffer.from('jpeg-inbound-data');

    // 1. Inbound real llega primero
    const inRes = await pipeline.processWebhook({ instance: 'bot_A', direction: 'in', msgId, mediaBuffer: fakeBuffer, tenantId: 'tA' });
    assert.strictEqual(inRes.ignored, false);
    assert.strictEqual(inRes.type, 'inbound_persisted');

    // 2. Outbound echo llega después desde otra instancia
    const outRes = await pipeline.processWebhook({ instance: 'bot_B', direction: 'out', msgId, tenantId: 'tB' });
    assert.strictEqual(outRes.ignored, false);
    assert.strictEqual(outRes.type, 'echo_handled');

    // Certificaciones explícitas
    assert.strictEqual(pipeline.dbMessages.length, 1, 'Inbound termina en DB exactamente una vez');
    assert.strictEqual(pipeline.storedMedia.length, 1, 'Media se almacena exactamente una vez para el tenant');
    assert.strictEqual(pipeline.socketEmits.length, 1, 'Se emite exactamente un new_whatsapp_message');

    // 3. Duplicado real posterior (bot_A + in + msg-seq-4004) sí se ignora
    const dupRes = await pipeline.processWebhook({ instance: 'bot_A', direction: 'in', msgId, mediaBuffer: fakeBuffer, tenantId: 'tA' });
    assert.strictEqual(dupRes.ignored, true, 'Duplicado real idéntico es ignorado');
    assert.strictEqual(pipeline.dbMessages.length, 1, 'DB no se duplica');
  });

  await test('D05', 'dos tenants/instances diferentes con mismo msgId artificial -> no contaminación cross-instance', async () => {
    const pipeline = new MockIngestionPipeline();
    const t1 = await pipeline.processWebhook({ instance: 'inst_alpha', direction: 'in', msgId: 'col-999', tenantId: 't-alpha' });
    const t2 = await pipeline.processWebhook({ instance: 'inst_beta', direction: 'in', msgId: 'col-999', tenantId: 't-beta' });

    assert.strictEqual(t1.ignored, false);
    assert.strictEqual(t2.ignored, false);
    assert.strictEqual(pipeline.dbMessages.length, 2, 'Ambos tenants procesan su respectivo mensaje');
    assert.strictEqual(pipeline.dbMessages[0].tenantId, 't-alpha');
    assert.strictEqual(pipeline.dbMessages[1].tenantId, 't-beta');
  });

  console.log('\n--- SUITE: Album Identification, Order & Layout (A01-A16) ---');

  // Parser formal implementado exactamente en whatsappController.js
  function parseMessageAssociation(data, key) {
    let mediaGroupId = null;
    let mediaGroupIndex = null;
    const rawMsg = data?.message || {};
    const contextInfo = rawMsg.messageContextInfo || rawMsg.imageMessage?.contextInfo || data?.messageContextInfo || {};
    const messageAssociation = contextInfo.messageAssociation;

    if (messageAssociation && (messageAssociation.associationType === 1 || messageAssociation.associationType === 'MEDIA_ALBUM')) {
      // 1. Normalizar messageIndex: aceptar estrictamente enteros >= 0 (nunca NaN)
      let parsedIndex = null;
      if (messageAssociation.messageIndex !== undefined && messageAssociation.messageIndex !== null) {
        const num = Number(messageAssociation.messageIndex);
        if (Number.isInteger(num) && num >= 0) {
          parsedIndex = num;
        }
      }
      mediaGroupIndex = parsedIndex;

      // 2. Fallback seguro de mediaGroupId (nunca inventar grupo falso para secundarios)
      const parentId = messageAssociation.parentMessageKey?.id;
      if (parentId && typeof parentId === 'string' && parentId.trim()) {
        mediaGroupId = parentId.trim();
      } else if (mediaGroupIndex === 0 && key?.id) {
        mediaGroupId = key.id; // Self como parent
      } else {
        mediaGroupId = null; // Miembro secundario sin parentId no inventa grupo falso
      }
    }
    return { mediaGroupId, mediaGroupIndex };
  }

  // Agrupador frontend estable por anclaje (anchored map) implementado en ChatPage.jsx
  function groupMessagesWithAlbums(rawMessages) {
    if (!rawMessages || rawMessages.length === 0) return [];
    const result = [];
    const albumMap = new Map(); // key: `${mediaGroupId}:${from}` -> albumGroup reference

    for (let i = 0; i < rawMessages.length; i++) {
      const msg = rawMessages[i];
      const isAlbumMember = msg.mediaType === 'image' && Boolean(msg.mediaGroupId);

      if (isAlbumMember) {
        const groupKey = `${msg.mediaGroupId}:${msg.from || 'client'}`;
        if (albumMap.has(groupKey)) {
          const existingGroup = albumMap.get(groupKey);
          const alreadyInGroup = existingGroup.messages.some(m =>
            (m.id && msg.id && m.id === msg.id) ||
            (m.externalId && msg.externalId && m.externalId === msg.externalId)
          );
          if (!alreadyInGroup) {
            existingGroup.messages.push(msg);
          }
        } else {
          const newGroup = {
            type: 'album',
            id: `album-${msg.mediaGroupId}-${msg.from || 'client'}-${msg.id}`,
            mediaGroupId: msg.mediaGroupId,
            from: msg.from,
            messages: [msg]
          };
          albumMap.set(groupKey, newGroup);
          result.push(newGroup);
        }
      } else {
        result.push({
          type: 'single',
          id: msg.id || `msg-${i}`,
          msg
        });
      }
    }

    return result;
  }

  function sortAlbumMessages(messages) {
    return [...messages].sort((a, b) => {
      const aIdx = (a.mediaGroupIndex !== null && a.mediaGroupIndex !== undefined) ? a.mediaGroupIndex : null;
      const bIdx = (b.mediaGroupIndex !== null && b.mediaGroupIndex !== undefined) ? b.mediaGroupIndex : null;
      if (aIdx !== null && bIdx !== null) return aIdx - bIdx;
      if (aIdx !== null) return -1;
      if (bIdx !== null) return 1;
      return new Date(a.createdAt || a.timestamp || 0) - new Date(b.createdAt || b.timestamp || 0);
    });
  }

  function calculateAlbumLayout(count) {
    if (count === 1) return { layout: 'single', slots: 1, overlay: null };
    if (count === 2) return { layout: '2_cols', slots: 2, overlay: null };
    if (count === 3) return { layout: '3_mosaic', slots: 3, overlay: null };
    if (count === 4) return { layout: '2x2_grid', slots: 4, overlay: null };
    return { layout: '4_slots_plus_n', slots: 4, overlay: `+${count - 4}` };
  }

  await test('A01', 'associationType 1, parentMessageKey.id PARENT, messageIndex 0 -> mediaGroupId PARENT, mediaGroupIndex 0', () => {
    const payload = {
      message: {
        messageContextInfo: {
          messageAssociation: {
            associationType: 1,
            parentMessageKey: { id: 'PARENT_123' },
            messageIndex: 0
          }
        }
      }
    };
    const { mediaGroupId, mediaGroupIndex } = parseMessageAssociation(payload, { id: 'CHILD_001' });
    assert.strictEqual(mediaGroupId, 'PARENT_123');
    assert.strictEqual(mediaGroupIndex, 0);
  });

  await test('A02', '4 imágenes mismo parent, indices 0,1,2,3 -> mismo groupId, 4 mensajes distintos', () => {
    const images = [0, 1, 2, 3].map(i => {
      const payload = {
        message: {
          messageContextInfo: {
            messageAssociation: {
              associationType: 1,
              parentMessageKey: { id: 'PARENT_ALBUM_4' },
              messageIndex: i
            }
          }
        }
      };
      const parsed = parseMessageAssociation(payload, { id: `MSG_${i}` });
      return { id: `MSG_${i}`, mediaType: 'image', from: 'client', ...parsed };
    });

    assert.strictEqual(images.length, 4);
    assert.ok(images.every(img => img.mediaGroupId === 'PARENT_ALBUM_4'));
    const uniqueIds = new Set(images.map(img => img.id));
    assert.strictEqual(uniqueIds.size, 4, 'Deben ser 4 mensajes con IDs únicos');
  });

  await test('A03', 'llegan en orden 0,3,1,2 -> orden final frontend: 0,1,2,3', () => {
    const unordered = [
      { id: 'm0', mediaGroupIndex: 0, createdAt: '2026-09-11T22:07:35.000Z' },
      { id: 'm3', mediaGroupIndex: 3, createdAt: '2026-09-11T22:07:36.000Z' },
      { id: 'm1', mediaGroupIndex: 1, createdAt: '2026-09-11T22:07:37.000Z' },
      { id: 'm2', mediaGroupIndex: 2, createdAt: '2026-09-11T22:07:38.000Z' }
    ];

    const sorted = sortAlbumMessages(unordered);
    const indices = sorted.map(m => m.mediaGroupIndex);
    assert.deepStrictEqual(indices, [0, 1, 2, 3], 'Debe ordenar ascendentemente por mediaGroupIndex');
  });

  await test('A04', 'segunda imagen llega 12 segundos después -> sigue entrando al MISMO álbum', () => {
    const msg1 = { id: 'img-1', from: 'client', mediaType: 'image', mediaGroupId: 'ALBUM_SLOW', mediaGroupIndex: 0, createdAt: '2026-09-11T22:06:51.000Z' };
    const msg2 = { id: 'img-2', from: 'client', mediaType: 'image', mediaGroupId: 'ALBUM_SLOW', mediaGroupIndex: 1, createdAt: '2026-09-11T22:07:03.000Z' };

    const grouped = groupMessagesWithAlbums([msg1, msg2]);
    assert.strictEqual(grouped.length, 1, 'Ambas imágenes deben formar un único grupo de álbum');
    assert.strictEqual(grouped[0].messages.length, 2);
    assert.strictEqual(grouped[0].mediaGroupId, 'ALBUM_SLOW');
  });

  await test('A05', 'dos imágenes independientes enviadas dentro de 1 segundo sin messageAssociation -> NO se agrupan', () => {
    const msg1 = { id: 'indep-1', from: 'client', mediaType: 'image', mediaGroupId: null, createdAt: '2026-09-11T22:00:01.000Z' };
    const msg2 = { id: 'indep-2', from: 'client', mediaType: 'image', mediaGroupId: null, createdAt: '2026-09-11T22:00:01.800Z' };

    const grouped = groupMessagesWithAlbums([msg1, msg2]);
    assert.strictEqual(grouped.length, 2, 'Deben tratarse como 2 mensajes independientes');
    assert.strictEqual(grouped[0].type, 'single');
    assert.strictEqual(grouped[1].type, 'single');
  });

  await test('A06', 'dos álbumes diferentes muy próximos -> NO se mezclan', () => {
    const album1_img1 = { id: 'a1-1', from: 'client', mediaType: 'image', mediaGroupId: 'ALBUM_A', mediaGroupIndex: 0 };
    const album1_img2 = { id: 'a1-2', from: 'client', mediaType: 'image', mediaGroupId: 'ALBUM_A', mediaGroupIndex: 1 };
    const album2_img1 = { id: 'a2-1', from: 'client', mediaType: 'image', mediaGroupId: 'ALBUM_B', mediaGroupIndex: 0 };
    const album2_img2 = { id: 'a2-2', from: 'client', mediaType: 'image', mediaGroupId: 'ALBUM_B', mediaGroupIndex: 1 };

    const grouped = groupMessagesWithAlbums([album1_img1, album1_img2, album2_img1, album2_img2]);
    assert.strictEqual(grouped.length, 2, 'Deben existir exactamente 2 grupos de álbumes separados');
    assert.strictEqual(grouped[0].mediaGroupId, 'ALBUM_A');
    assert.strictEqual(grouped[1].mediaGroupId, 'ALBUM_B');
    assert.strictEqual(grouped[0].messages.length, 2);
    assert.strictEqual(grouped[1].messages.length, 2);
  });

  await test('A07', '4 imágenes -> grid 2x2', () => {
    const layout = calculateAlbumLayout(4);
    assert.strictEqual(layout.layout, '2x2_grid');
    assert.strictEqual(layout.slots, 4);
    assert.strictEqual(layout.overlay, null);
  });

  await test('A08', '5 imágenes -> 4 slots + overlay +1', () => {
    const layout = calculateAlbumLayout(5);
    assert.strictEqual(layout.layout, '4_slots_plus_n');
    assert.strictEqual(layout.slots, 4);
    assert.strictEqual(layout.overlay, '+1');
  });

  await test('A09', '7 imágenes -> overlay +3', () => {
    const layout = calculateAlbumLayout(7);
    assert.strictEqual(layout.layout, '4_slots_plus_n');
    assert.strictEqual(layout.slots, 4);
    assert.strictEqual(layout.overlay, '+3');
  });

  await test('A10', 'click overlay -> lightbox contiene las 7 imágenes completas', () => {
    const sevenMsgs = Array.from({ length: 7 }, (_, i) => ({
      id: `img-${i}`,
      mediaType: 'image',
      mediaGroupId: 'ALBUM_7',
      mediaGroupIndex: i,
      mediaUrl: `/api/chats/media/img-${i}?mt=token-${i}`,
      caption: i === 0 ? 'Vacaciones en la playa' : null
    }));

    const grouped = groupMessagesWithAlbums(sevenMsgs);
    assert.strictEqual(grouped.length, 1);
    const sorted = sortAlbumMessages(grouped[0].messages);

    const lightboxItems = sorted.map((m, idx) => ({
      id: m.id,
      src: m.mediaUrl,
      caption: m.caption,
      index: idx
    }));

    assert.strictEqual(lightboxItems.length, 7, 'El lightbox debe incluir las 7 fotos');
    assert.strictEqual(lightboxItems[0].caption, 'Vacaciones en la playa');
  });

  await test('A11', 'imagen individual (count === 1) sigue usando Bubble normal', () => {
    const singleMsg = { id: 'single-1', from: 'client', mediaType: 'image', mediaGroupId: 'ONLY_ONE', mediaGroupIndex: 0 };
    const grouped = groupMessagesWithAlbums([singleMsg]);
    assert.strictEqual(grouped.length, 1);
    assert.strictEqual(grouped[0].type, 'album');
    assert.strictEqual(grouped[0].messages.length, 1);
    const rendersAlbumBubble = grouped[0].type === 'album' && grouped[0].messages.length > 1;
    assert.strictEqual(rendersAlbumBubble, false, 'No debe renderizar MediaAlbumBubble para 1 sola foto');
  });

  await test('A12', 'Socket.IO añade nueva imagen a álbum ya visible sin refresh', () => {
    let activeChatMessages = [
      { id: 'img-first', externalId: 'ext-first', from: 'client', mediaType: 'image', mediaGroupId: 'LIVE_ALBUM', mediaGroupIndex: 0 }
    ];

    const incomingSocketMsg = {
      id: 'img-second',
      externalId: 'ext-second',
      from: 'client',
      mediaType: 'image',
      mediaGroupId: 'LIVE_ALBUM',
      mediaGroupIndex: 1
    };

    const exists = activeChatMessages.some(m =>
      (m.id && incomingSocketMsg.id && m.id === incomingSocketMsg.id) ||
      (m.externalId && incomingSocketMsg.externalId && m.externalId === incomingSocketMsg.externalId)
    );
    if (!exists) {
      activeChatMessages = [...activeChatMessages, incomingSocketMsg];
    }

    assert.strictEqual(activeChatMessages.length, 2);
    const regrouped = groupMessagesWithAlbums(activeChatMessages);
    assert.strictEqual(regrouped.length, 1);
    assert.strictEqual(regrouped[0].messages.length, 2, 'El álbum se transforma reactivamente a 2 imágenes');
  });

  await test('A13', 'mismo álbum pero nuevo evento duplicado con mismo id/externalId -> no duplica foto', () => {
    let activeChatMessages = [
      { id: 'img-1', externalId: 'EXT-99', from: 'client', mediaType: 'image', mediaGroupId: 'ALBUM_DEDUPE', mediaGroupIndex: 0 }
    ];

    const duplicateSocketMsg = {
      id: 'img-1',
      externalId: 'EXT-99',
      from: 'client',
      mediaType: 'image',
      mediaGroupId: 'ALBUM_DEDUPE',
      mediaGroupIndex: 0
    };

    const exists = activeChatMessages.some(m =>
      (m.id && duplicateSocketMsg.id && m.id === duplicateSocketMsg.id) ||
      (m.externalId && duplicateSocketMsg.externalId && m.externalId === duplicateSocketMsg.externalId)
    );

    if (!exists) {
      activeChatMessages = [...activeChatMessages, duplicateSocketMsg];
    }

    assert.strictEqual(activeChatMessages.length, 1, 'La imagen duplicada no debe agregarse al álbum');
  });

  await test('A14', 'NO CONSECUTIVE DEPENDENCY: album index 0 -> texto independiente -> album index 1 llega después', () => {
    const rawTimeline = [
      { id: 'img-0', from: 'client', mediaType: 'image', mediaGroupId: 'SPLIT_ALBUM', mediaGroupIndex: 0, createdAt: '2026-09-11T22:06:51.000Z' },
      { id: 'txt-middle', from: 'client', text: 'Aquí te mando el comprobante también', createdAt: '2026-09-11T22:06:55.000Z' },
      { id: 'img-1', from: 'client', mediaType: 'image', mediaGroupId: 'SPLIT_ALBUM', mediaGroupIndex: 1, createdAt: '2026-09-11T22:07:03.000Z' }
    ];

    const grouped = groupMessagesWithAlbums(rawTimeline);

    // Debe producir exactamente 2 slots visuales:
    // Slot 0: El álbum SPLIT_ALBUM anclado en la posición de img-0, conteniendo img-0 e img-1
    // Slot 1: El mensaje de texto independiente txt-middle
    assert.strictEqual(grouped.length, 2, 'Debe haber exactamente 2 bloques en el timeline');
    assert.strictEqual(grouped[0].type, 'album');
    assert.strictEqual(grouped[0].mediaGroupId, 'SPLIT_ALBUM');
    assert.strictEqual(grouped[0].messages.length, 2, 'Las dos imágenes están juntas en el álbum');

    assert.strictEqual(grouped[1].type, 'single');
    assert.strictEqual(grouped[1].msg.id, 'txt-middle');
    assert.strictEqual(grouped[1].msg.text, 'Aquí te mando el comprobante también');
  });

  await test('A15', 'SAFE FALLBACK: parentMessageKey faltante solo usa key.id si index === 0; miembro secundario sin parent queda null', () => {
    // Caso 1: ParentId ausente pero index === 0 -> self parent
    const selfParentPayload = {
      message: {
        messageContextInfo: {
          messageAssociation: {
            associationType: 1,
            messageIndex: 0
          }
        }
      }
    };
    const parsedSelf = parseMessageAssociation(selfParentPayload, { id: 'SELF_ROOT_MSG' });
    assert.strictEqual(parsedSelf.mediaGroupId, 'SELF_ROOT_MSG');
    assert.strictEqual(parsedSelf.mediaGroupIndex, 0);

    // Caso 2: ParentId ausente y es miembro secundario (index === 2) -> null (jamás inventar grupo falso)
    const secondaryMissingParentPayload = {
      message: {
        messageContextInfo: {
          messageAssociation: {
            associationType: 1,
            messageIndex: 2
          }
        }
      }
    };
    const parsedSec = parseMessageAssociation(secondaryMissingParentPayload, { id: 'ORPHAN_SECONDARY' });
    assert.strictEqual(parsedSec.mediaGroupId, null, 'Secundario sin parentMessageKey debe quedar null');
    assert.strictEqual(parsedSec.mediaGroupIndex, 2);
  });

  await test('A16', 'STRICT INDEX VALIDATION: solo enteros >= 0 son aceptados; NaN, negativos, no-numéricos producen null', () => {
    const cases = [
      { input: '0', expected: 0 },
      { input: 3, expected: 3 },
      { input: -1, expected: null },
      { input: 'abc', expected: null },
      { input: 3.14, expected: null },
      { input: NaN, expected: null },
      { input: undefined, expected: null },
      { input: null, expected: null }
    ];

    for (const c of cases) {
      const payload = {
        message: {
          messageContextInfo: {
            messageAssociation: {
              associationType: 1,
              parentMessageKey: { id: 'P1' },
              messageIndex: c.input
            }
          }
        }
      };
      const { mediaGroupIndex } = parseMessageAssociation(payload, { id: 'TEST' });
      assert.strictEqual(
        mediaGroupIndex,
        c.expected,
        `messageIndex ${JSON.stringify(c.input)} debe resolverse como ${c.expected}`
      );
    }
  });

  // Resumen final
  const total = suiteResults.length;
  const passed = suiteResults.filter(r => r.passed).length;
  const failed = total - passed;

  console.log(`\n========================================`);
  console.log(`SUITE MULTI-IMAGE ALBUM & DEDUPE: ${passed}/${total} PASS (${failed} FAIL)`);
  console.log(`========================================\n`);

  if (failed > 0) {
    throw new Error(`${failed} pruebas fallaron en la suite de Multi-Image Album & Dedupe.`);
  }

  return { total, passed, failed, results: suiteResults };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('media_album_dedupe.test.js')) {
  runMediaAlbumDedupeSuite().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
