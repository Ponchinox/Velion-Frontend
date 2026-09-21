import dotenv from 'dotenv';
dotenv.config();
import { getChats, getMessages } from '../src/controllers/chatController.js';
import prisma from '../src/db.js';

async function testController() {
  console.log('--- TEST DE CONTROLADORES GETCHATS & GETMESSAGES ---');
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });

  for (const t of tenants) {
    console.log(`\nProbando para Tenant: ${t.name} (${t.id})`);

    const req = {
      user: { tenantId: t.id, role: 'client' },
      headers: {}
    };

    let responseData = null;
    let statusCode = 200;

    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      }
    };

    await getChats(req, res);

    console.log(`Status Code: ${statusCode}`);
    if (statusCode !== 200) {
      console.log(`Error Response:`, responseData);
    } else {
      console.log(`Total Chats devueltos: ${responseData?.length}`);
      if (responseData && responseData.length > 0) {
        console.log(`Primer chat:`, JSON.stringify(responseData[0], null, 2));

        // Probar getMessages para el primer chat
        const firstChatId = responseData[0].id;
        const msgReq = {
          user: { tenantId: t.id, role: 'client' },
          params: { chatId: firstChatId }
        };
        let msgData = null;
        let msgStatus = 200;
        const msgRes = {
          status(code) { msgStatus = code; return this; },
          json(data) { msgData = data; return this; }
        };

        await getMessages(msgReq, msgRes);
        console.log(`getMessages Status: ${msgStatus}, Total Mensajes: ${msgData?.length}`);
        if (msgData && msgData.length > 0) {
          console.log(`Primeros 2 mensajes:`, JSON.stringify(msgData.slice(0, 2), null, 2));
        }
      }
    }
  }
}

testController()
  .then(() => process.exit(0))
  .catch(err => { console.error('Error en test:', err); process.exit(1); });
