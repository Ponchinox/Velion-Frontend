import { Brain, Sparkle } from '@phosphor-icons/react';

export default function AiBrainPage() {
  return (
    <section aria-labelledby="ai-heading">
      <p className="text-sm text-lo mb-6">
        Configura los modelos generativos y el procesamiento inteligente para tu negocio.
      </p>

      {/* Grid boxes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Model config box */}
        <div className="bg-card border border-line rounded-lg shadow-card p-6 flex flex-col items-start gap-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-purple-50 text-purple-600">
            <Brain size={22} weight="regular" />
          </div>
          <div>
            <h3 className="text-base font-bold text-hi">Modelos de IA Conectados</h3>
            <p className="text-xs text-lo mt-1">Selecciona el motor de procesamiento preferido para las recomendaciones.</p>
          </div>
          <select className="
            w-full p-2.5 text-sm bg-app border border-line rounded-md text-hi
            focus:outline-none focus:border-brand
          ">
            <option>Gemini 1.5 Flash (Recomendado)</option>
            <option>Gemini 1.5 Pro</option>
            <option>GPT-4o mini</option>
          </select>
        </div>

        {/* AI agent simulation */}
        <div className="bg-card border border-line rounded-lg shadow-card p-6 flex flex-col items-start gap-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-pink-50 text-pink-600">
            <Sparkle size={22} weight="regular" />
          </div>
          <div>
            <h3 className="text-base font-bold text-hi">Agente de Soporte Automático</h3>
            <p className="text-xs text-lo mt-1">El agente está activo resolviendo tickets de tus clientes de manera autónoma.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-brand rounded-full animate-ping" />
            <span className="text-xs font-semibold text-brand">Activo e interactuando</span>
          </div>
        </div>
      </div>
    </section>
  );
}
