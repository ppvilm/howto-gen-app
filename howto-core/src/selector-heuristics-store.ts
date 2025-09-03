import fs from 'fs/promises';
import path from 'path';
import { WorkspaceManager } from './workspace-manager';

export interface HeuristicScoreThresholds {
  direct: number;
  tryMultiple: number;
  llmFallback: number;
}

export interface HeuristicWeights {
  roleMatch: number;
  labelSimilarity: number;
  i18nNormalization: number;
  stableAttributes: number;
  contextBoost: number;
  negativeSignals: number;
}

export interface LearnedSelectorEntry {
  label: string;
  elementType: 'input' | 'button' | 'any';
  selector: string;
  confidence?: number;
  fallbacks?: string[];
  urlPattern?: string; // simple contains match for now
  source: 'llm' | 'manual';
  usedCount: number;
  lastUsedAt: string; // ISO
  reasoning?: string;
}

export interface SelectorHeuristicsFile {
  version: number;
  updatedAt: string; // ISO
  scoreThresholds: HeuristicScoreThresholds;
  weights: HeuristicWeights;
  synonyms: Record<string, string[]>;
  // Fixed, manually curated selectors loaded from config (highest priority)
  staticSelectors: LearnedSelectorEntry[];
  learnedSelectors: LearnedSelectorEntry[];
  patterns: {
    buttonTexts: string[];
    interactiveButtonQuery: string;
    interactiveInputQuery: string;
    navigationContainers: string;
    modalSelectors: string;
    landmarkQuery: string;
  };
}

const DEFAULT_CONFIG: SelectorHeuristicsFile = {
  version: 1,
  updatedAt: new Date().toISOString(),
  scoreThresholds: { direct: 0.78, tryMultiple: 0.6, llmFallback: 0.6 },
  weights: { roleMatch: 0.2, labelSimilarity: 0.3, i18nNormalization: 0.05, stableAttributes: 0.2, contextBoost: 0.15, negativeSignals: 0.3 },
  synonyms: {
    login: ['anmelden', 'sign in', 'log in', 'einloggen'],
    register: ['registrieren', 'sign up', 'anmelden', 'erstellen'],
    submit: ['absenden', 'senden', 'send', 'abschicken'],
    cancel: ['abbrechen', 'zurück', 'back', 'schließen'],
    search: ['suchen', 'suche', 'find', 'finden'],
    email: ['e-mail', 'mail', 'email'],
    password: ['passwort', 'kennwort', 'pwd'],
    username: ['benutzername', 'nutzername', 'user'],
    confirm: ['bestätigen', 'confirm', 'ok'],
    next: ['weiter', 'next', 'continue', 'fortfahren'],
    previous: ['zurück', 'back', 'prev', 'vorherige']
  },
  staticSelectors: [],
  learnedSelectors: [],
  patterns: {
    buttonTexts: ['SAVE', 'Save', 'save', 'START', 'Start', 'start', 'CANCEL', 'Cancel', 'cancel'],
    interactiveButtonQuery: 'button, [role="button"], input[type="submit"], input[type="button"], a[role="button"], a[href]',
    interactiveInputQuery: 'input, textarea, [contenteditable="true"]',
    navigationContainers: 'nav, [role="navigation"], .sidebar, .side-nav, [data-unique*="SideBar"]',
    modalSelectors: '[role="dialog"]:not([aria-hidden="true"]), .modal:not(.hidden), [data-modal], .drawer, [data-drawer]',
    landmarkQuery: 'h1, h2, h3, [role="main"], [role="navigation"], [role="banner"]'
  }
};

export class SelectorHeuristicsStore {
  private filePath: string;
  private data: SelectorHeuristicsFile = { ...DEFAULT_CONFIG };
  private workspaceManager?: WorkspaceManager;

  private constructor(filePath: string, workspaceManager?: WorkspaceManager) {
    this.filePath = filePath;
    this.workspaceManager = workspaceManager;
  }

  static async load(customPath?: string): Promise<SelectorHeuristicsStore> {
    const basePath = customPath || process.env.SELECTOR_HEURISTICS_PATH || path.join(process.cwd(), 'howto-core', 'config', 'selector-heuristics.json');
    const store = new SelectorHeuristicsStore(basePath);
    try {
      const buf = await fs.readFile(basePath, 'utf-8');
      const parsed: SelectorHeuristicsFile = JSON.parse(buf);
      // Shallow validation and merge to ensure defaults
      store.data = {
        ...DEFAULT_CONFIG,
        ...parsed,
        scoreThresholds: { ...DEFAULT_CONFIG.scoreThresholds, ...(parsed as any).scoreThresholds },
        weights: { ...DEFAULT_CONFIG.weights, ...(parsed as any).weights },
        synonyms: { ...DEFAULT_CONFIG.synonyms, ...(parsed as any).synonyms },
        staticSelectors: Array.isArray((parsed as any).staticSelectors) ? (parsed as any).staticSelectors : [],
        learnedSelectors: Array.isArray(parsed.learnedSelectors) ? parsed.learnedSelectors : [],
        patterns: { ...DEFAULT_CONFIG.patterns, ...((parsed as any).patterns || {}) }
      };
    } catch (e: any) {
      // Ensure directory exists, then write defaults
      try {
        await fs.mkdir(path.dirname(basePath), { recursive: true });
        await fs.writeFile(basePath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
        store.data = { ...DEFAULT_CONFIG };
      } catch {
        // Keep in-memory defaults if writing fails
      }
    }
    return store;
  }

  static async loadFromWorkspace(workspaceManager: WorkspaceManager): Promise<SelectorHeuristicsStore> {
    const configName = 'selector-heuristics.json';
    
    // Load merged config from workspace manager
    const mergedConfig = await workspaceManager.loadConfig<SelectorHeuristicsFile>(
      configName, 
      DEFAULT_CONFIG
    );

    // Create store with flow config path for saving
    const flowConfigPath = path.join(workspaceManager.getFlowConfigPath(), configName);
    const store = new SelectorHeuristicsStore(flowConfigPath, workspaceManager);
    store.data = mergedConfig;
    
    return store;
  }

  getConfig(): SelectorHeuristicsFile {
    return this.data;
  }

  async save(): Promise<void> {
    this.data.updatedAt = new Date().toISOString();
    
    if (this.workspaceManager) {
      // Save to flow-specific config in workspace
      await this.workspaceManager.saveConfig('selector-heuristics.json', this.data, false);
    } else {
      // Legacy: save to specified file path
      await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    }
  }

  private normalizeLabel(label: string): string {
    return label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[ä]/g, 'ae')
      .replace(/[ö]/g, 'oe')
      .replace(/[ü]/g, 'ue')
      .replace(/[ß]/g, 'ss')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  getLearnedSelectors(label: string, elementType: 'input' | 'button' | 'any', currentUrl?: string): LearnedSelectorEntry[] {
    const norm = this.normalizeLabel(label);
    const domain = currentUrl ? this.extractDomain(currentUrl) : undefined;
    const entries = this.data.learnedSelectors.filter(e => {
      const sameLabel = this.normalizeLabel(e.label) === norm;
      const typeOk = e.elementType === elementType || e.elementType === 'any' || elementType === 'any';
      const urlOk = !e.urlPattern || !domain || domain.includes(e.urlPattern) || (currentUrl || '').includes(e.urlPattern);
      return sameLabel && typeOk && urlOk;
    });
    return entries;
  }

  getStaticSelectors(label: string, elementType: 'input' | 'button' | 'any', currentUrl?: string): LearnedSelectorEntry[] {
    const norm = this.normalizeLabel(label);
    const domain = currentUrl ? this.extractDomain(currentUrl) : undefined;
    const entries = this.data.staticSelectors.filter(e => {
      const sameLabel = this.normalizeLabel(e.label) === norm;
      const typeOk = e.elementType === elementType || e.elementType === 'any' || elementType === 'any';
      const urlOk = !e.urlPattern || !domain || domain.includes(e.urlPattern) || (currentUrl || '').includes(e.urlPattern);
      return sameLabel && typeOk && urlOk;
    });
    return entries;
  }

  async addLearnedSelector(entry: Omit<LearnedSelectorEntry, 'usedCount' | 'lastUsedAt' | 'source'> & { source?: 'llm' | 'manual' }): Promise<void> {
    const norm = this.normalizeLabel(entry.label);
    const exists = this.data.learnedSelectors.find(e =>
      this.normalizeLabel(e.label) === norm &&
      e.elementType === entry.elementType &&
      e.selector === entry.selector &&
      (e.urlPattern || '') === (entry.urlPattern || '')
    );

    if (exists) {
      exists.usedCount += 1;
      exists.lastUsedAt = new Date().toISOString();
      if (typeof entry.confidence === 'number') exists.confidence = entry.confidence;
      if (Array.isArray(entry.fallbacks) && entry.fallbacks.length) {
        const set = new Set([...(exists.fallbacks || []), ...entry.fallbacks]);
        exists.fallbacks = Array.from(set);
      }
    } else {
      this.data.learnedSelectors.unshift({
        label: entry.label,
        elementType: entry.elementType,
        selector: entry.selector,
        confidence: entry.confidence,
        fallbacks: entry.fallbacks,
        urlPattern: entry.urlPattern,
        source: entry.source || 'llm',
        usedCount: 1,
        lastUsedAt: new Date().toISOString(),
        reasoning: entry.reasoning
      });
      // Cap list to avoid unbounded growth
      if (this.data.learnedSelectors.length > 500) {
        this.data.learnedSelectors.pop();
      }
    }
    await this.save();
  }

  private extractDomain(url: string): string | undefined {
    try {
      const u = new URL(url);
      return u.hostname;
    } catch {
      return undefined;
    }
  }
}
