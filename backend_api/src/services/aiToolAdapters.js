/**
 * aiToolAdapters.js — Adaptador puro de definiciones de herramientas
 *
 * Convierte declaraciones de herramientas de Google Gemini al estándar
 * compatible con OpenAI / Groq (JSON Schema estándar con tipos en minúsculas).
 *
 * Características:
 * - Función pura, inmutable (no muta las definiciones originales)
 * - Normalización recursiva de tipos (OBJECT -> object, STRING -> string, etc.)
 * - Preserva properties, required, enum, description, items y objetos anidados
 */

/**
 * Normaliza un tipo de dato de schema de Gemini a JSON Schema estándar (OpenAI/Groq).
 * @param {string} type - Tipo en mayúsculas o minúsculas (ej. 'OBJECT', 'STRING')
 * @returns {string} Tipo normalizado en minúsculas
 */
export function normalizeSchemaType(type) {
  if (typeof type !== 'string') return type;
  const upper = type.toUpperCase();
  switch (upper) {
    case 'OBJECT':  return 'object';
    case 'STRING':  return 'string';
    case 'INTEGER': return 'integer';
    case 'BOOLEAN': return 'boolean';
    case 'ARRAY':   return 'array';
    case 'NUMBER':  return 'number';
    default:        return type.toLowerCase();
  }
}

/**
 * Normaliza recursivamente un objeto JSON Schema sin mutar el original.
 * @param {object} schema - Schema original de Gemini
 * @returns {object} Schema clonado y normalizado para OpenAI/Groq
 */
export function normalizeJsonSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) {
    return schema.map(normalizeJsonSchema);
  }

  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'type') {
      result.type = normalizeSchemaType(value);
    } else if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      result.properties = {};
      for (const [propKey, propVal] of Object.entries(value)) {
        result.properties[propKey] = normalizeJsonSchema(propVal);
      }
    } else if (key === 'items' && value && typeof value === 'object') {
      result.items = normalizeJsonSchema(value);
    } else if (key === 'enum' && Array.isArray(value)) {
      result.enum = [...value];
    } else if (key === 'required' && Array.isArray(value)) {
      result.required = [...value];
    } else if (typeof value === 'object' && value !== null) {
      result[key] = normalizeJsonSchema(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Convierte un array de herramientas en formato Gemini al formato OpenAI/Groq.
 *
 * Formato entrada Gemini:
 *   [{ functionDeclarations: [ { name, description, parameters } ] }]
 *   o array directo de declaraciones [ { name, description, parameters } ]
 *
 * Formato salida OpenAI/Groq:
 *   [ { type: "function", function: { name, description, parameters } } ]
 *
 * @param {Array} geminiTools - Array de herramientas en formato Gemini
 * @returns {Array} Array de herramientas en formato OpenAI-compatible
 */
export function convertGeminiToolsToOpenAI(geminiTools) {
  if (!geminiTools || !Array.isArray(geminiTools) || geminiTools.length === 0) {
    return [];
  }

  const openAiTools = [];

  for (const toolGroup of geminiTools) {
    if (!toolGroup) continue;

    // Caso 1: Envoltorio oficial Gemini { functionDeclarations: [...] }
    if (Array.isArray(toolGroup.functionDeclarations)) {
      for (const decl of toolGroup.functionDeclarations) {
        if (!decl || !decl.name) continue;
        openAiTools.push({
          type: 'function',
          function: {
            name: decl.name,
            description: decl.description || '',
            parameters: decl.parameters
              ? normalizeJsonSchema(decl.parameters)
              : { type: 'object', properties: {} }
          }
        });
      }
      continue;
    }

    // Caso 2: Objeto que ya tiene formato OpenAI { type: 'function', function: { ... } }
    if (toolGroup.type === 'function' && toolGroup.function?.name) {
      openAiTools.push({
        type: 'function',
        function: {
          name: toolGroup.function.name,
          description: toolGroup.function.description || '',
          parameters: toolGroup.function.parameters
            ? normalizeJsonSchema(toolGroup.function.parameters)
            : { type: 'object', properties: {} }
        }
      });
      continue;
    }

    // Caso 3: Declaración directa individual { name, description, parameters }
    if (toolGroup.name && typeof toolGroup.name === 'string') {
      openAiTools.push({
        type: 'function',
        function: {
          name: toolGroup.name,
          description: toolGroup.description || '',
          parameters: toolGroup.parameters
            ? normalizeJsonSchema(toolGroup.parameters)
            : { type: 'object', properties: {} }
        }
      });
    }
  }

  return openAiTools;
}
