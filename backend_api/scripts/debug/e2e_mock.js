import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function runTests() {
    console.log("=== INICIANDO PRUEBAS DE INVENTARIO Y EXTRACCIÓN MULTIMEDIA ===");
    try {
        const sampleProduct = await prisma.product.findFirst({
            where: { name: { contains: "Airpods" } },
            include: { user: true }
        });
        
        if (!sampleProduct) {
            console.log("No hay productos de prueba.");
            return;
        }
        
        const tenantId = sampleProduct.user.tenantId;

        console.log(`\n======================================================`);
        console.log(`1️⃣ PRUEBA: Búsqueda Semántica "¿Tienen audífonos?"`);
        
        const core_concept = "audifonos";
        const synonyms = ["auriculares", "airpods", "tws"];
        
        console.log(`Gemini Invoca -> search_inventory: concepto="${core_concept}", sinonimos=[${synonyms.join(',')}]`);
        
        const normalize = str => str ? str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() : '';
        const normConcept    = normalize(core_concept);
        const normSynonyms   = synonyms.map(normalize).filter(s => s.length > 2);
        
        const searchTerms = [normConcept, ...normSynonyms];
        const prismaOrClauses = searchTerms.flatMap(term => [
            { name:        { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
            { category:    { contains: term, mode: 'insensitive' } },
        ]);
        
        const candidates = await prisma.product.findMany({
            where: { user: { tenantId }, isAvailable: true, OR: prismaOrClauses },
            select: { name: true, description: true, category: true, tags: true, price: true, imageUrl: true, images: true, videoUrl: true },
            take: 20,
        });
        
        console.log(`🗄️ Prisma extrajo ${candidates.length} candidatos.`);
        
        const scoredCandidates = candidates.map(p => {
            let score = 0;
            const tagsStr  = Array.isArray(p.tags) ? p.tags.join(' ') : '';
            const fullText = (normalize(p.name) + ' ' + normalize(p.description) + ' ' + normalize(p.category) + ' ' + normalize(tagsStr)).replace(/\s+/g, ' ');
            if (fullText.includes(normConcept)) score += 50;
            for (const syn of normSynonyms) {
                if (fullText.includes(syn)) { score += 25; break; }
            }
            return { ...p, _score: score };
        });
        
        const validCandidates = scoredCandidates.filter(p => p._score > 0).sort((a, b) => b._score - a._score);
        console.log(`🏆 Resultados enviados a Gemini (Ranking):`);
        validCandidates.slice(0,5).forEach(p => {
            const tienePortada = p.imageUrl ? ` | Portada: Sí` : ' | Portada: No';
            const tieneGaleria = (Array.isArray(p.images) && p.images.length > 0) ? ` | Fotos adicionales: Sí (${p.images.length})` : '';
            const tieneVideo   = p.videoUrl ? ` | Video: Sí` : '';
            console.log(`  - ${p.name}: S/. ${p.price || 0}${tienePortada}${tieneGaleria}${tieneVideo}`);
        });
        
        
        console.log(`\n======================================================`);
        console.log(`2️⃣ PRUEBA: Extracción Multimedia "Mándame fotos y video"`);
        
        // Exactamente como en whatsappController.js
        const targetProduct = validCandidates[0].name.trim();
        const geminiOutput = `Claro, aquí tienes: [SEND_IMAGE: ${targetProduct}] [SEND_VIDEO: ${targetProduct}]`;
        console.log(`🤖 Respuesta Gemini: "${geminiOutput}"`);
        
        const regexImg = /\[SEND_IMAGE:\s*(.+?)\]/g;
        const regexVid = /\[SEND_VIDEO:\s*(.+?)\]/g;
        
        let matchImg = regexImg.exec(geminiOutput);
        if (matchImg) {
            const queryStr = matchImg[1].trim(); // Igual que en whatsappController (substring + trim)
            const matchedProd = await prisma.product.findFirst({
                where: { user: { tenantId }, name: { contains: queryStr, mode: 'insensitive' } },
                select: { imageUrl: true }
            });
            if (matchedProd) {
                console.log(`✅ [BACKEND] Imagen extraída exitosamente: ${matchedProd.imageUrl || 'Producto existe sin URL'}`);
            } else {
                console.log(`❌ [BACKEND] Fallo al extraer imagen para "${queryStr}"`);
            }
        }
        
        let matchVid = regexVid.exec(geminiOutput);
        if (matchVid) {
            const queryStr = matchVid[1].trim();
            const matchedProd = await prisma.product.findFirst({
                where: { user: { tenantId }, name: { contains: queryStr, mode: 'insensitive' } },
                select: { videoUrl: true }
            });
            if (matchedProd) {
                console.log(`✅ [BACKEND] Video extraído exitosamente: ${matchedProd.videoUrl || 'Producto existe sin URL'}`);
            } else {
                console.log(`❌ [BACKEND] Fallo al extraer video para "${queryStr}"`);
            }
        }
        
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
runTests();
