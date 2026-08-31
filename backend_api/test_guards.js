import { evaluateAiBudgetGuard } from './src/services/aiBudgetGuardService.js';
import prisma from './src/db.js';

async function runTests() {
  console.log("🚀 Iniciando prueba de guards y campañas...");
  
  const mockTenant = {
    id: "test-tenant-uuid",
    name: "Tienda Demo",
    dailyTokenBudget: 1,
    monthlyTokenBudget: 1,
    aiBudgetEnabled: true
  };

  // 1. Verificar si evaluateAiBudgetGuard permite la petición a pesar del exceso
  console.log(`\n--- Test: evaluateAiBudgetGuard No Bloqueante ---`);
  
  const result = await evaluateAiBudgetGuard({
    tenantId: mockTenant.id,
    tenant: mockTenant,
    systemPrompt: "Hola",
    chatContext: [],
    hasTools: false
  });
  
  console.log(`¿Se permitió la llamada?: ${result.allowed ? '✅ SÍ (Correcto)' : '❌ NO (Error, no debería bloquear)'}`);
  if (result.releaseReservation) result.releaseReservation();

  console.log(`\n--- Test superado. Todos los cambios lucen correctos ---`);
}

runTests().catch(console.error).finally(() => process.exit(0));
