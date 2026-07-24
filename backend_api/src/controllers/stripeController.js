import Stripe from 'stripe';
import prisma from '../db.js';

// Inicializar Stripe de forma perezosa
const getStripe = () => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY no está configurada en las variables de entorno.');
  }
  return new Stripe(secretKey);
};

/**
 * Crea una sesión de Stripe Checkout para el Tenant logueado
 */
export async function createCheckoutSession(req, res) {
  try {
    // Validaciones Previas (Fail-Fast)
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID_PRO || !process.env.FRONTEND_URL) {
      throw new Error("Faltan variables de entorno de Stripe en el servidor.");
    }

    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'El usuario no está asociado a ningún Tenant.' });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId }
    });

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant no encontrado.' });
    }

    const { priceId } = req.body;
    if (!priceId) {
      return res.status(400).json({ error: 'El identificador de precio (priceId) de Stripe es obligatorio.' });
    }

    const stripe = getStripe();
    const frontendUrl = process.env.FRONTEND_URL;

    // Crear sesión de pago de Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      client_reference_id: tenantId,
      success_url: `${frontendUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/cancel`,
      metadata: {
        tenantId: tenantId,
        tenantName: tenant.name,
      }
    });

    return res.json({ url: session.url });
  } catch (error) {
    console.error("❌ [Stripe Error]:", error);
    return res.status(500).json({ error: error.message || 'Error interno al crear sesión de Stripe' });
  }
}

/**
 * Procesa las notificaciones webhook enviadas por Stripe de forma segura
 */
export async function handleWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return res.status(400).send('Faltan firmas o secretos del webhook.');
  }

  let event;
  const stripe = getStripe();

  try {
    // req.body debe ser el body crudo (Buffer)
    event = stripe.webhooks.constructEvent(req.rawBody || req.body, sig, webhookSecret);
  } catch (err) {
    console.error(`❌ [Stripe Webhook] Error de validación de firma:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Manejar el evento de pago completado con éxito
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const tenantId = session.client_reference_id;

    if (!tenantId) {
      console.warn('⚠️ [Stripe Webhook] Sesión completada sin client_reference_id (tenantId).');
      return res.json({ received: true });
    }

    console.log(`💳 [Stripe Webhook] Pago exitoso recibido para el Tenant: ${tenantId}`);

    try {
      // Actualizar el Tenant en la base de datos de PostgreSQL
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          plan: 'Pro',
          active: true,
          msgLimit: 50000,   // Límite del plan Pro
          connLimit: 5,      // Límite de conexiones Pro
        }
      });
      console.log(`✅ [Stripe Webhook] Tenant ${tenantId} actualizado exitosamente a Plan PRO.`);
    } catch (dbErr) {
      console.error(`❌ [Stripe Webhook] Error al actualizar la base de datos para Tenant ${tenantId}:`, dbErr.message);
      return res.status(500).send('Error interno al actualizar la suscripción.');
    }
  }

  return res.json({ received: true });
}
