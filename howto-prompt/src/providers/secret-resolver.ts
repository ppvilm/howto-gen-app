import { getLLMManager } from 'howto-core';

export interface SecretMappingInput {
  url: string;
  fieldLabels: string[]; // UI labels only, no values
  secretKeys: string[];  // Available secret keys, no values
  secretKeyHints?: Record<string, string | undefined>; // Optional contexts to help mapping
}

export class SecretResolver {
  constructor() {}

  static create(): SecretResolver {
    return new SecretResolver();
  }

  async resolveMapping(input: SecretMappingInput): Promise<Record<string, string>> {
    if (!input.fieldLabels || input.fieldLabels.length === 0) return {};
    if (!input.secretKeys || input.secretKeys.length === 0) return {};

    // Build hints section if provided
    const hintsEntries = Object.entries(input.secretKeyHints || {}).filter(([,v]) => !!v) as Array<[string,string]>;
    const hintsBlock = hintsEntries.length > 0
      ? `KEY HINTS:\n${hintsEntries.map(([k,v]) => `- ${k}: ${v}`).join('\n')}\n\n`
      : '';

    const prompt = `URL: ${input.url}
FIELDS: ${input.fieldLabels.join(', ')}
AVAILABLE KEYS: ${input.secretKeys.join(', ')}
${hintsBlock}
Rules:
- CRITICAL: You MUST use the EXACT key names from AVAILABLE KEYS. Never invent or modify key names.
- CRITICAL: Email/Username/Login/User fields should ONLY map to USERNAME-type keys, NEVER to PASSWORD-type keys
- CRITICAL: Password/PW/Passwort fields should ONLY map to PASSWORD-type keys, NEVER to USERNAME-type keys
- Look for exact or partial matches: if available keys include ADMIN_PASSWORD, use that for password fields (not just PASSWORD)
- If available keys include ADMIN_USERNAME, use that for username fields (not just USERNAME)  
- Prefer specific keys over generic ones (e.g., ADMIN_USERNAME over USERNAME if both exist)
- If a label mixes email/username, prefer username-type keys if available, else email-type keys
- NEVER map username fields to password keys or vice versa
- If no reasonable match exists in AVAILABLE KEYS, omit the label completely
- ONLY return keys that exist in the AVAILABLE KEYS list

Respond with JSON only.`;

    try {
      const llmManager = getLLMManager();
      const response = await llmManager.execute('secret_mapping', {
        prompt,
        systemPrompt: `You map form field labels to available secret KEYS for safe autofill.
Only choose from provided KEYS. Never invent keys. Never include any values.
Return STRICT JSON object: { "<label>": "<KEY>", ... }. Nothing else.`,
        responseFormat: 'json'
      });
      
      const match = response.content.match(/\{[\s\S]*\}/);
      const json = match ? match[0] : '{}';
      const parsed = JSON.parse(json);
      // Keep only mappings to known keys and validate logic
      const allowed = new Set(input.secretKeys.map(k => k.toLowerCase()));
      const result: Record<string,string> = {};
      Object.entries(parsed).forEach(([label, key]) => {
        if (typeof key === 'string' && allowed.has(key.toLowerCase())) {
          // Additional validation: prevent username/email fields mapping to password keys
          const isUsernameField = /email|username|login|user|mail|benutzername/i.test(label);
          const isPasswordKey = /password|pwd|pw|passwort/i.test(key);
          const isPasswordField = /password|pwd|pw|passwort/i.test(label);
          const isUsernameKey = /username|user|email|mail|login/i.test(key);
          
          if (isUsernameField && isPasswordKey) {
            console.warn(`[SecretResolver] Blocking invalid mapping: ${label} -> ${key} (username field to password key)`);
            return; // Skip this mapping
          }
          if (isPasswordField && isUsernameKey) {
            console.warn(`[SecretResolver] Blocking invalid mapping: ${label} -> ${key} (password field to username key)`);
            return; // Skip this mapping
          }
          
          result[label] = key;
        }
      });
      return result;
    } catch (e) {
      return {};
    }
  }
}
