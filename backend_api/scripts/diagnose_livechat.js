import dotenv from 'dotenv';
dotenv.config();
import prisma from '../src/db.js';

function maskPhone(phone) {
  if (!phone) return 'N/A';
  const str = String(phone);
  if (str.length <= 4) return '****';
  return str.slice(0, 3) + '****' + str.slice(-3);
}

async function diagnose() {
  console.log('--- INICIO DE AUDITORÍA DE DATOS DE LIVE CHAT (SOLO LECTURA) ---');
  try {
    const tenants = await prisma.tenant.findMany({
      select: { id: true, name: true, createdAt: true }
    });
    console.log(`Total Tenants: ${tenants.length}`);

    for (const t of tenants) {
      console.log(`\n==================================================`);
      console.log(`TENANT: ${t.name} (ID: ${t.id})`);
      console.log(`==================================================`);

      const contactCount = await prisma.contact.count({ where: { tenantId: t.id } });
      const customerCount = await prisma.customer.count({ where: { tenantId: t.id } });
      const chatCount = await prisma.chat.count({ where: { tenantId: t.id } });
      const messageCount = await prisma.message.count({ where: { tenantId: t.id } });

      console.log(`- Contactos: ${contactCount}`);
      console.log(`- Customers: ${customerCount}`);
      console.log(`- Chats: ${chatCount}`);
      console.log(`- Mensajes: ${messageCount}`);

      // Check orphan chats (Chats without Contact)
      const chats = await prisma.chat.findMany({
        where: { tenantId: t.id },
        include: {
          contact: true,
          messages: { orderBy: { createdAt: 'desc' }, take: 1 }
        },
        orderBy: { updatedAt: 'desc' },
        take: 20
      });

      let orphanChatsCount = 0;
      chats.forEach(c => {
        if (!c.contact) {
          orphanChatsCount++;
        }
      });
      console.log(`- Chats huérfanos (sin contact): ${orphanChatsCount}`);

      // Check Contacts without Chat
      const contactsWithoutChat = await prisma.contact.findMany({
        where: {
          tenantId: t.id,
          chats: { none: {} }
        },
        take: 10
      });
      console.log(`- Contactos sin Chat: ${contactsWithoutChat.length}`);

      console.log(`\nÚLTIMOS 10 CHATS:`);
      chats.slice(0, 10).forEach((c, idx) => {
        console.log(`  [${idx + 1}] ChatID: ${c.id.slice(0, 8)}... | ContactID: ${c.contactId?.slice(0, 8)}... | ContactName: ${c.contact?.name || 'NULL'} | ContactPhone: ${maskPhone(c.contact?.phone)} | Status: ${c.status} | botPaused: ${c.botPaused} | LastMsg: "${c.messages[0]?.content?.slice(0, 30) || 'SIN MENSAJES'}" | UpdatedAt: ${c.updatedAt}`);
      });

      console.log(`\nÚLTIMOS 10 MENSAJES:`);
      const recentMessages = await prisma.message.findMany({
        where: { tenantId: t.id },
        orderBy: { createdAt: 'desc' },
        take: 10
      });

      recentMessages.forEach((m, idx) => {
        console.log(`  [${idx + 1}] MsgID: ${m.id.slice(0, 8)}... | ChatID: ${m.chatId.slice(0, 8)}... | Role: ${m.senderRole} | Status: ${m.status} | Text: "${m.content.slice(0, 40)}" | CreatedAt: ${m.createdAt}`);
      });
    }
  } catch (err) {
    console.error('Error durante diagnóstico de BD:', err);
  } finally {
    await prisma.$disconnect();
    console.log('\n--- FIN DE AUDITORÍA DE DATOS ---');
  }
}

diagnose();
