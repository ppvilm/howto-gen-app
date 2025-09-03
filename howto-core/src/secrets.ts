export class SecretsManager {
  private secrets: Record<string, string>;
  private contexts: Record<string, string | undefined> = {};
  
  // Common patterns for heuristic matching
  private static readonly PATTERN_MAP: Record<string, string[]> = {
    'username': ['username', 'user', 'login', 'email', 'mail'],
    'password': ['password', 'pass', 'pwd', 'passphrase'],
    'email': ['email', 'mail', 'e-mail', 'address'],
    'api_token': ['api', 'token', 'key', 'auth', 'bearer'],
    'api_key': ['api_key', 'apikey', 'key', 'secret'],
    'phone': ['phone', 'tel', 'mobile', 'number']
  };

  constructor(secrets?: Record<string, any>) {
    this.secrets = {};
    this.contexts = {};

    if (secrets && typeof secrets === 'object') {
      for (const [key, val] of Object.entries(secrets)) {
        if (val == null) continue;
        if (typeof val === 'string') {
          this.secrets[key] = val;
        } else if (typeof val === 'object') {
          // Support shape: { value: string, context?: string | string[] }
          const v = (val as any).value;
          if (typeof v === 'string') {
            this.secrets[key] = v;
          }
          const ctx = (val as any).context;
          if (typeof ctx === 'string') {
            this.contexts[key] = ctx;
          } else if (Array.isArray(ctx)) {
            this.contexts[key] = ctx.filter(Boolean).join('; ');
          }
        }
      }
    }
  }

  /**
   * Resolves placeholder syntax {{secret.KEY}} to actual secret value
   */
  resolvePlaceholder(value: string): { resolved?: string; isSecretRef: boolean; key?: string } {
    if (!value) {
      return { isSecretRef: false };
    }

    // Match {{secret.KEY}} pattern
    const match = value.match(/^\{\{secret\.([^}]+)\}\}$/);
    if (!match) {
      return { isSecretRef: false };
    }

    const key = match[1];
    const resolved = this.secrets[key];

    return {
      resolved,
      isSecretRef: true,
      key
    };
  }

  /**
   * Gets secret value by key
   */
  get(key: string): string | undefined {
    return this.secrets[key];
  }

  /**
   * Get optional human-readable context for a key
   */
  getContext(key: string): string | undefined {
    return this.contexts[key];
  }

  /**
   * Returns all available secret keys
   */
  getAllKeys(): string[] {
    return Object.keys(this.secrets);
  }

  /**
   * Returns mapping of key -> context (if any)
   */
  getAllContexts(): Record<string, string | undefined> {
    // return shallow copy to avoid mutation
    const out: Record<string, string | undefined> = {};
    for (const k of Object.keys(this.secrets)) {
      out[k] = this.contexts[k];
    }
    return out;
  }

  /**
   * Suggests a secret key for a given label using heuristic patterns
   */
  suggestKeyForLabel(label: string): string | undefined {
    if (!label) return undefined;

    const normalizedLabel = label.toLowerCase().trim();
    const availableKeys = this.getAllKeys();
    const availableKeysLower = availableKeys.map(k => k.toLowerCase());
    const originalByLower = new Map<string, string>(availableKeys.map(k => [k.toLowerCase(), k]));

    // Fast-path: detect intent from label and match keys that contain anchor words
    const isPasswordLike = /password|passwort|kennwort|pwd|pass\b/.test(normalizedLabel);
    const isUserLike = /user(name)?\b|login\b/.test(normalizedLabel);
    const isEmailLike = /email|e-mail|mail\b/.test(normalizedLabel);
    const isTokenLike = /token|api\b|key\b|secret\b|bearer\b/.test(normalizedLabel);

    const pickByContains = (candidates: string[]): string | undefined => {
      const found = availableKeysLower.find(k => candidates.some(c => k.includes(c)));
      return found ? originalByLower.get(found) : undefined;
    };

    if (isPasswordLike) {
      // First try specific admin patterns, then generic patterns
      const byName = pickByContains(['admin_password', 'password', 'pwd', 'pass']) ||
                     pickByContains(['password', 'pwd', 'pass']);
      if (byName) return byName;
    }
    if (isUserLike || isEmailLike) {
      // First try specific admin patterns, then generic patterns
      const byName = pickByContains(['admin_username', 'admin_user', 'admin_email', 'username', 'email', 'user', 'mail']) ||
                     pickByContains(['username', 'email', 'user', 'mail']);
      if (byName) return byName;
    }
    if (isTokenLike) {
      const byName = pickByContains(['token', 'api_key', 'apikey', 'api', 'key', 'secret']);
      if (byName) return byName;
    }

    // Direct key match first
    if (availableKeys.includes(normalizedLabel)) {
      return normalizedLabel;
    }

    // Pattern-based matching (score-based across available keys)
    let bestKey: string | undefined;
    let bestScore = 0;
    for (const lowerKey of availableKeysLower) {
      // Get synonyms for this key if we have a pattern entry; otherwise try to reuse any pattern list this key maps to
      let synonyms = SecretsManager.PATTERN_MAP[lowerKey] || [];
      // Also map common equivalences (e.g., username/email overlap)
      if (lowerKey === 'user') synonyms = [...synonyms, 'user', 'username', 'login'];
      const baseScore = synonyms.reduce((acc, syn) => acc + (normalizedLabel.includes(syn) ? 1 : 0), 0);
      // Add substring match bonuses
      let score = baseScore;
      if (normalizedLabel.includes(lowerKey)) score += 1;
      if (lowerKey.includes('email') && normalizedLabel.includes('username')) score += 1; // email or username composite label
      if (lowerKey.includes('username') && normalizedLabel.includes('email')) score += 1;
      if (lowerKey.includes('token') && (normalizedLabel.includes('api') || normalizedLabel.includes('key'))) score += 1;
      if (lowerKey.includes('key') && (normalizedLabel.includes('api') || normalizedLabel.includes('token') || normalizedLabel.includes('secret'))) score += 1;
      if (score > bestScore) {
        bestScore = score;
        bestKey = originalByLower.get(lowerKey);
      }
    }
    if (bestKey && bestScore > 0) {
      return bestKey;
    }

    // Fallback: find any key that contains part of the label
    for (const key of availableKeys) {
      const keyLower = key.toLowerCase();
      if (normalizedLabel.includes(keyLower) || keyLower.includes(normalizedLabel)) {
        return key;
      }
    }

    return undefined;
  }

  /**
   * Checks if a value contains a secret placeholder
   */
  static isSecretPlaceholder(value?: string): boolean {
    if (!value) return false;
    return /^\{\{secret\.[^}]+\}\}$/.test(value);
  }

  /**
   * Extracts key from secret placeholder
   */
  static extractKeyFromPlaceholder(value: string): string | undefined {
    const match = value.match(/^\{\{secret\.([^}]+)\}\}$/);
    return match ? match[1] : undefined;
  }
}
