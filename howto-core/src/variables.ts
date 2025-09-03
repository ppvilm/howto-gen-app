export class VariablesManager {
  private vars: Record<string, string>;
  private contexts: Record<string, string | undefined> = {};

  constructor(variables?: Record<string, any>) {
    this.vars = {};
    this.contexts = {};

    if (variables && typeof variables === 'object') {
      for (const [key, val] of Object.entries(variables)) {
        if (val == null) continue;
        if (typeof val === 'string') {
          this.vars[key] = val;
        } else if (typeof val === 'object') {
          const v = (val as any).value;
          if (typeof v === 'string') this.vars[key] = v;
          const ctx = (val as any).context;
          if (typeof ctx === 'string') this.contexts[key] = ctx;
          else if (Array.isArray(ctx)) this.contexts[key] = ctx.filter(Boolean).join('; ');
        }
      }
    }
  }

  resolvePlaceholder(value: string): { resolved?: string; isVarRef: boolean; key?: string } {
    if (!value) return { isVarRef: false };
    const match = value.match(/^\{\{var\.([^}]+)\}\}$/);
    if (!match) return { isVarRef: false };
    const key = match[1];
    const resolved = this.vars[key];
    return { resolved, isVarRef: true, key };
  }

  get(key: string): string | undefined { return this.vars[key]; }
  getAllKeys(): string[] { return Object.keys(this.vars); }
  getContext(key: string): string | undefined { return this.contexts[key]; }
  getAllContexts(): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {};
    for (const k of Object.keys(this.vars)) out[k] = this.contexts[k];
    return out;
  }

  static isVarPlaceholder(value?: string): boolean {
    if (!value) return false;
    return /^\{\{var\.[^}]+\}\}$/.test(value);
  }
}

