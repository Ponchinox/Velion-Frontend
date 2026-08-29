const fs = require('fs');
const file = 'src/controllers/connectionController.js';
let content = fs.readFileSync(file, 'utf8');

const injection = 
    // 1.5. Configurar el webhook en Evolution API explicitamente (Respaldo)
    try {
      console.log(\🔌 [Evolution API] Sobrescribiendo webhook en: \ para la instancia: \\);
      await axios.post(
        \\/webhook/set/\\,
        {
          webhook: {
            enabled: true,
            url: webhookUrl,
            headers: {
              apikey: cleanApiKey
            },
            byEvents: false,
            webhookByEvents: false,
            events: [
              "MESSAGES_UPSERT",
              "CONNECTION_UPDATE"
            ]
          }
        },
        getEvoHeaders()
      );
      console.log('✅ [Evolution API] Webhook sobrescrito y actualizado con éxito.');
    } catch (webhookError) {
      console.error('❌ Error configurando el Webhook en Evolution:', webhookError?.response?.data || webhookError.message);
    }
;

const targetStr = "    // 2. Solicitar el código QR de conexión";
if (content.includes(targetStr)) {
  content = content.replace(targetStr, injection + '\n' + targetStr);
  fs.writeFileSync(file, content, 'utf8');
  console.log('Injected successfully');
} else {
  console.log('Target string not found!');
}
