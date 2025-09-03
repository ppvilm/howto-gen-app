import { getLLMManager } from 'howto-core';

export interface VariableMappingInput {
  url: string;
  fieldLabels: string[];
  variableKeys: string[];
  variableKeyHints?: Record<string, string | undefined>;
}

export class VariableResolver {
  constructor() {}

  static create(): VariableResolver {
    return new VariableResolver();
  }

  async resolveMapping(input: VariableMappingInput): Promise<Record<string, string>> {
    if (!input.fieldLabels?.length || !input.variableKeys?.length) return {};
    const hintsEntries = Object.entries(input.variableKeyHints || {}).filter(([,v]) => !!v) as Array<[string,string]>;
    const hintsBlock = hintsEntries.length > 0
      ? `KEY HINTS:\n${hintsEntries.map(([k,v]) => `- ${k}: ${v}`).join('\n')}\n\n`
      : '';

    const prompt = `URL: ${input.url}
FIELDS: ${input.fieldLabels.join(', ')}
AVAILABLE VAR KEYS: ${input.variableKeys.join(', ')}
${hintsBlock}
Rules:
- Map descriptive fields (like Test Name, Project, Environment) to corresponding var keys.
- If no suitable variable matches a label, omit it (do not guess).

Respond with JSON only.`;

    try {
      const llmManager = getLLMManager();
      const response = await llmManager.execute('variable_mapping', {
        prompt,
        systemPrompt: `You map form/input labels to available VARIABLE KEYS for autofill.
Only choose from provided KEYS. Return only JSON mapping. Do not invent keys.`,
        responseFormat: 'json'
      });
      
      const json = (response.content.match(/\{[\s\S]*\}/) || [ '{}' ])[0];
      const parsed = JSON.parse(json);
      const allowed = new Set(input.variableKeys.map(k => k.toLowerCase()));
      const out: Record<string, string> = {};
      Object.entries(parsed).forEach(([label, key]) => {
        if (typeof key === 'string' && allowed.has(key.toLowerCase())) out[label] = key;
      });
      return out;
    } catch {
      return {};
    }
  }
}

