/**
 * Adversarial Messages & Edge Cases Library (Zero-Cost Fixtures)
 * ==============================================================
 * Entradas complejas, ambiguas, typos y ráfagas para verificar
 * robustez conversacional sin necesidad de llamar a Gemini.
 */

export const ADVERSARIAL_FIXTURES = {
  // 1. Monosílabos y frases ultra-cortas
  monosyllables: [
    { text: 'aver', expectedIntent: 'media_or_catalog' },
    { text: 'ese', expectedIntent: 'contextual_selection' },
    { text: 'el otro', expectedIntent: 'contextual_switch' },
    { text: 'sí', expectedIntent: 'affirmation' },
    { text: 'no ese no', expectedIntent: 'rejection' },
    { text: 'video', expectedIntent: 'video_request' },
    { text: 'foto', expectedIntent: 'image_request' },
    { text: 'cuánto', expectedIntent: 'price_inquiry' },
    { text: 'tienes?', expectedIntent: 'stock_inquiry' },
    { text: 'ya pagué', expectedIntent: 'payment_claim' },
    { text: 'mándamelo', expectedIntent: 'order_intent' },
    { text: 'mejor el otro', expectedIntent: 'product_switch' },
    { text: 'quiero 2', expectedIntent: 'quantity_change' },
    { text: 'olvida eso', expectedIntent: 'cancellation' }
  ],

  // 2. Errores ortográficos (Typos) y jergas
  typos: [
    { input: 'presio del parlante', target: 'precio', canonicalQuery: 'precio jbl' },
    { input: 'vedio del reloj', target: 'video', canonicalQuery: 'video smartwatch' },
    { input: 'fotito ps', target: 'foto', canonicalQuery: 'foto' },
    { input: 'jbll go4', target: 'JBL Go 4', canonicalQuery: 'jbl go 4' },
    { input: 'avber que colores tienes', target: 'a ver', canonicalQuery: 'colores' },
    { input: 'disponivle hoy?', target: 'disponible', canonicalQuery: 'stock' }
  ],

  // 3. Mensajes multilínea con información fragmentada
  multilineMessages: [
    {
      raw: "Hola buenas tardes\nquisiera saber el precio\ndel jbl\ny si tienen video",
      parsedLines: 4,
      targetProduct: 'JBL Go 4 A1',
      demandsVideo: true
    },
    {
      raw: "Buenas\nestoy interesada en el vestido\npero quiero saber si hacen envios a arequipa\ny cual es el medio de pago",
      parsedLines: 4,
      targetProduct: 'Vestido Seda Italiana',
      demandsPolicies: true
    }
  ],

  // 4. Mensajes con contradicción inmediata
  contradictoryMessages: [
    {
      text: "Quiero el jbl... no espera, mejor el reloj... bueno déjame ver el video del jbl primero",
      finalMediaRequested: 'video',
      finalProductResolved: 'JBL Go 4 A1'
    },
    {
      text: "Dame 3 unidades... ah no solo 1",
      resolvedQuantity: 1
    }
  ],

  // 5. Ráfagas de mensajes rápidos (Simulación temporal en milisegundos)
  rapidBursts: [
    {
      sequence: [
        { text: 'Quiero el JBL go 4', delayMs: 0 },
        { text: 'Video', delayMs: 40 },
        { text: 'Y en qué colores hay', delayMs: 80 },
        { text: 'Disponible', delayMs: 120 }
      ],
      expectedResolvedProduct: 'JBL Go 4 A1',
      expectedMediaRequested: 'video',
      expectedTotalVideosSent: 1,
      forbiddenMarkers: ['[Video enviado al cliente]', '[Imagen enviada al cliente]'],
      forbiddenUrlPatterns: ['/media/tenants/', '/products/videos/', 'res.cloudinary.com']
    }
  ]
};
