/**
 * DEMO UTILS (Frontend)
 * Determina si el usuario o tenant actual corresponde a un entorno demo aislado.
 */

export function isDemoUser(user) {
  if (!user) return false;

  // 1. Flag explícito devuelto por backend en auth / me
  if (user.isDemo === true || user.tenant?.isDemo === true) {
    return true;
  }

  // 2. Tenant name reservado para demo
  if (user.tenantName === 'NovaTech Demo' || user.tenant?.name === 'NovaTech Demo') {
    return true;
  }

  // 3. Email sintético de demo
  if (user.email && (user.email === 'demo.wallpay@novatech.com' || user.email.startsWith('demo.wallpay@'))) {
    return true;
  }

  // 4. Variable de entorno Vite para demo tenant ID
  const viteDemoTenantId = typeof import.meta !== 'undefined' && import.meta.env?.VITE_DEMO_TENANT_ID;
  if (viteDemoTenantId && user.tenantId && String(user.tenantId) === String(viteDemoTenantId)) {
    return true;
  }

  return false;
}
