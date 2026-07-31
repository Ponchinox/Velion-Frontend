import prisma from '../db.js';

/**
 * Middleware de verificación de features de Plan.
 * Carga el Plan activo del Tenant y verifica si tiene el campo habilitado.
 * 
 * @param {string} featureFlag - Nombre del campo booleano en el modelo Plan
 * @returns Express middleware que responde 403 si el plan no tiene la feature
 * 
 * Uso: router.use(planFeatureMiddleware('hasCampaigns'));
 */
export function planFeatureMiddleware(featureFlag) {
  return async (req, res, next) => {
    try {
      const tenantId = req.user?.tenantId;

      // SuperAdmin siempre tiene acceso completo
      if (req.user?.role === 'superadmin') {
        return next();
      }

      if (!tenantId) {
        return res.status(403).json({
          error: 'Acceso denegado. El usuario no está asociado a un Tenant.',
          code: 'NO_TENANT',
        });
      }

      // Obtener el Tenant con su planId para luego cargar el Plan
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { planId: true, plan: true },
      });

      let plan = null;
      if (tenant?.planId) {
        plan = await prisma.plan.findUnique({
          where: { id: tenant.planId },
        });
      } else if (tenant?.plan && tenant.plan !== 'Sin Plan') {
        plan = await prisma.plan.findFirst({
          where: { name: tenant.plan },
        });
      }

      if (!plan) {
        return res.status(403).json({
          error: 'Tu cuenta no tiene un plan activo o el plan no existe. Por favor adquiere un plan para acceder a esta función.',
          code: 'NO_ACTIVE_PLAN',
        });
      }

      // Verificar que el campo requerido exista y sea true
      if (plan[featureFlag] !== true) {
        const featureLabels = {
          hasCampaigns: 'Campañas Masivas',
          hasAutomations: 'Automatizaciones',
          hasAdvancedMarketing: 'Modo Vendedor Persuasivo',
        };

        const featureName = featureLabels[featureFlag] || featureFlag;

        return res.status(403).json({
          error: `Tu plan "${plan.name}" no incluye acceso a ${featureName}. Mejora tu plan para usar esta función.`,
          code: 'PLAN_FEATURE_REQUIRED',
          requiredFeature: featureFlag,
          currentPlan: plan.name,
        });
      }

      // Inyectar el plan en req para uso en controladores
      req.plan = plan;
      next();
    } catch (error) {
      console.error(`[planFeatureMiddleware:${featureFlag}] Error:`, error);
      return res.status(500).json({ error: 'Error interno al verificar permisos del plan.' });
    }
  };
}

/**
 * Middleware para verificar el límite de productos del plan.
 * Bloquea la creación si el tenant ya alcanzó su maxProducts.
 */
export async function productLimitMiddleware(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;

    // SuperAdmin siempre tiene acceso completo
    if (req.user?.role === 'superadmin') {
      return next();
    }

    if (!tenantId) {
      return res.status(403).json({
        error: 'Acceso denegado. El usuario no está asociado a un Tenant.',
        code: 'NO_TENANT',
      });
    }

    // Obtener el planId y plan del Tenant
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { planId: true, plan: true },
    });

    let plan = null;
    if (tenant?.planId) {
      plan = await prisma.plan.findUnique({
        where: { id: tenant.planId },
        select: { maxProducts: true, name: true },
      });
    } else if (tenant?.plan && tenant.plan !== 'Sin Plan') {
      plan = await prisma.plan.findFirst({
        where: { name: tenant.plan },
        select: { maxProducts: true, name: true },
      });
    }

    if (!plan) {
      return res.status(403).json({
        error: 'Tu cuenta no tiene un plan activo. Por favor adquiere un plan para agregar productos.',
        code: 'NO_ACTIVE_PLAN',
      });
    }

    // Contar productos actuales del usuario
    const userId = req.user?.userId || req.user?.id;
    const currentProductCount = await prisma.product.count({
      where: { userId },
    });

    if (currentProductCount >= plan.maxProducts) {
      return res.status(403).json({
        error: `Has alcanzado el límite de ${plan.maxProducts} productos de tu plan "${plan.name}". Mejora tu plan para agregar más productos.`,
        code: 'PRODUCT_LIMIT_REACHED',
        limit: plan.maxProducts,
        current: currentProductCount,
        currentPlan: plan.name,
      });
    }

    // Inyectar info del plan
    req.plan = plan;
    next();
  } catch (error) {
    console.error('[productLimitMiddleware] Error:', error);
    return res.status(500).json({ error: 'Error interno al verificar límites del plan.' });
  }
}
