import prisma from '../../src/db.js';
import { generateAIResponse } from '../../src/services/aiService.js';

async function run() {
  const testTenantId = 'test-tenant-' + Date.now();
  
  // Setup DB
  const user = await prisma.user.create({
    data: {
      email: testTenantId + '@test.com',
      password: '123456',
      name: 'Test',
      role: 'ADMIN',
      tenant: {
        create: { name: 'Test Tenant', aiEnabled: true }
      }
    },
    include: { tenant: true }
  });

  const tenant = user.tenant;

  await prisma.product.create({
    data: {
      name: 'AirPods 2da generación',
      description: 'Auriculares de Apple sellados.',
      category: 'audifonos',
      tags: ['inalambricos', 'bluetooth', 'tws', 'apple'],
      price: 150,
      userId: user.id,
      isAvailable: true
    }
  });

  await prisma.product.create({
    data: {
      name: 'Traje de Spider-Man',
      description: 'Disfraz rojo y azul.',
      category: 'ropa',
      price: 50,
      userId: user.id,
      isAvailable: true
    }
  });

  const tools = [{
    functionDeclarations: [
      {
        name: 'search_inventory',
        description: 'Busca productos en el catálogo.',
        parameters: {
          type: 'OBJECT',
          properties: {
            core_concept: { type: 'STRING' },
            synonyms: { type: 'ARRAY', items: { type: 'STRING' } },
            attributes: { type: 'ARRAY', items: { type: 'STRING' } }
          },
          required: ['core_concept']
        }
      }
    ]
  }];

  const toolsHandler = async (funcName, args) => {
    if (funcName === 'search_inventory') {
      const { core_concept, synonyms = [], attributes = [] } = args;
      console.log('\n🔍 [ToolsHandler] Buscando concepto="' + core_concept + '", sinónimos=[' + synonyms + '], atributos=[' + attributes + ']');
      
      const normalize = str => str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() : "";
      const normConcept = normalize(core_concept);
      const normSynonyms = synonyms.map(normalize);
      const normAttributes = attributes.map(normalize);
      
      const candidates = await prisma.product.findMany({
        where: { user: { tenantId: tenant.id } },
        select: { id: true, name: true, description: true, category: true, tags: true, price: true, isAvailable: true }
      });

      const scoredCandidates = candidates.map(p => {
        let score = 0;
        const tagsStr = Array.isArray(p.tags) ? p.tags.join(" ") : "";
        const fullText = (normalize(p.name) + " " + normalize(p.description) + " " + normalize(p.category) + " " + normalize(tagsStr)).replace(/\s+/g, " ");

        if (fullText.includes(normConcept)) score += 50;
        for (const syn of normSynonyms) {
          if (syn.length > 2 && fullText.includes(syn)) { score += 25; break; }
        }
        let matchedAttrs = 0;
        for (const attr of normAttributes) {
          if (attr.length > 2 && fullText.includes(attr)) { score += 10; matchedAttrs++; }
        }
        if (score >= 25 && matchedAttrs > 0) score += (matchedAttrs * 5);
        return { ...p, _score: score };
      });

      const validCandidates = scoredCandidates.filter(p => p._score > 0);
      validCandidates.sort((a, b) => b._score - a._score);

      if (validCandidates.length === 0) return { result: 'No hay resultados.' };
      
      const resultString = validCandidates.map(p => '- ' + p.name + ' ($' + p.price + ') [Score: ' + p._score + ']').join('\n');
      console.log('🎯 [Resultados]:\n' + resultString);
      return { result: resultString };
    }
    return { error: 'Unknown function' };
  };

  console.log('\n--- PRUEBA 1: Buscar audífonos (Debería encontrar AirPods por categoría) ---');
  const r1 = await generateAIResponse(
    'Eres un asistente de ventas. Usa search_inventory cuando el usuario busque productos.',
    [{ role: 'user', content: 'Hola, ¿tienen audífonos?' }],
    [],
    'test1',
    null,
    tools,
    toolsHandler
  );
  console.log('\n💬 Respuesta IA:', r1);

  console.log('\n--- PRUEBA 2: Buscar Traje de Spider-Man ---');
  const r2 = await generateAIResponse(
    'Eres un asistente de ventas. Usa search_inventory cuando el usuario busque productos.',
    [{ role: 'user', content: 'Busco un traje de spiderman' }],
    [],
    'test2',
    null,
    tools,
    toolsHandler
  );
  console.log('\n💬 Respuesta IA:', r2);
  
  // Cleanup
  await prisma.tenant.delete({ where: { id: tenant.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

run().catch(console.error).finally(() => process.exit(0));


