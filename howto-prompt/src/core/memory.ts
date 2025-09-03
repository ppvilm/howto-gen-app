import { MemoryStore, UIElementMemory } from './types';

type SimpleItem = {
  label: string;
  kind?: string;
  group?: string;
  section?: string;
  role?: string;
  placeholder?: string;
  isSubmit?: boolean;
  isPrimary?: boolean;
};

export class Memory {
  private store: MemoryStore;

  constructor() {
    this.store = {
      elements: new Map(),
      synonyms: new Map(),
      screenFingerprints: new Set(),
      navigationPaths: new Map()
    };
  }

  // Learn from successful UI interactions
  learnElement(item: SimpleItem, context: string[] = []): void {
    const key = this.generateElementKey(item);
    const existing = this.store.elements.get(key);
    
    const memory: UIElementMemory = {
      label: item.label,
      synonyms: existing?.synonyms || this.generateSynonyms(item),
      group: item.group,
      section: item.section,
      lastSeen: Date.now(),
      confidence: existing ? Math.min(existing.confidence + 0.1, 1.0) : 0.7,
      context: [...(existing?.context || []), ...context].slice(-5) // Keep last 5 contexts
    };

    this.store.elements.set(key, memory);
    
    // Update synonyms map
    memory.synonyms.forEach(synonym => {
      const existing = this.store.synonyms.get(synonym.toLowerCase()) || [];
      if (!existing.includes(item.label)) {
        existing.push(item.label);
        this.store.synonyms.set(synonym.toLowerCase(), existing);
      }
    });
  }

  // Generate synonyms based on field type and common patterns
  private generateSynonyms(item: SimpleItem): string[] {
    const synonyms = [item.label.toLowerCase()];
    const label = item.label.toLowerCase();

    // Common field synonyms (DE/EN)
    const fieldSynonyms: Record<string, string[]> = {
      'email': ['e-mail', 'username', 'user', 'login', 'mail'],
      'password': ['passwort', 'kennwort', 'pwd', 'pass'],
      'login': ['sign in', 'anmelden', 'einloggen', 'submit'],
      'search': ['suche', 'suchen', 'find', 'finden'],
      'save': ['speichern', 'submit', 'confirm', 'bestätigen'],
      'cancel': ['abbrechen', 'close', 'schließen'],
      'delete': ['löschen', 'remove', 'entfernen'],
      'edit': ['bearbeiten', 'modify', 'ändern'],
      'create': ['erstellen', 'new', 'neu', 'add', 'hinzufügen'],
      'name': ['vorname', 'nachname', 'first name', 'last name'],
      'phone': ['telefon', 'mobile', 'handy'],
      'address': ['adresse', 'street', 'straße']
    };

    // Add role-based synonyms
    if (item.role === 'textbox' || item.kind === 'field') {
      if (item.placeholder) {
        synonyms.push(item.placeholder.toLowerCase());
      }
      
      // Match against known patterns
      Object.entries(fieldSynonyms).forEach(([key, syns]) => {
        if (label.includes(key) || syns.some(syn => label.includes(syn))) {
          synonyms.push(...syns);
        }
      });
    }

    if (item.kind === 'button') {
      if (item.isSubmit) {
        synonyms.push('submit', 'send', 'senden', 'bestätigen');
      }
      if (item.isPrimary) {
        synonyms.push('primary', 'main', 'hauptaktion');
      }
    }

    // Remove duplicates and return
    return [...new Set(synonyms)];
  }

  // Find elements by label or synonym
  findElementsByLabel(searchLabel: string): UIElementMemory[] {
    const matches: UIElementMemory[] = [];
    const searchTerm = searchLabel.toLowerCase();

    // Direct match
    this.store.elements.forEach((memory, key) => {
      if (memory.label.toLowerCase() === searchTerm ||
          memory.synonyms.some(syn => syn.toLowerCase() === searchTerm)) {
        matches.push(memory);
      }
    });

    // Fuzzy match for partial labels
    if (matches.length === 0) {
      this.store.elements.forEach((memory, key) => {
        if (memory.label.toLowerCase().includes(searchTerm) ||
            memory.synonyms.some(syn => syn.toLowerCase().includes(searchTerm))) {
          matches.push(memory);
        }
      });
    }

    // Sort by confidence and recency
    return matches.sort((a, b) => {
      const confidenceScore = b.confidence - a.confidence;
      if (Math.abs(confidenceScore) < 0.1) {
        return b.lastSeen - a.lastSeen; // More recent first if confidence is similar
      }
      return confidenceScore;
    });
  }

  // Learn navigation patterns
  learnNavigation(fromUrl: string, toUrl: string, trigger?: string): void {
    const path = this.store.navigationPaths.get(fromUrl) || [];
    
    const entry = trigger ? `${toUrl}:${trigger}` : toUrl;
    if (!path.includes(entry)) {
      path.push(entry);
      // Keep only last 10 navigation patterns per URL
      if (path.length > 10) {
        path.shift();
      }
      this.store.navigationPaths.set(fromUrl, path);
    }
  }

  // Get likely navigation targets from current URL
  getNavigationSuggestions(currentUrl: string): Array<{url: string, trigger?: string}> {
    const suggestions = this.store.navigationPaths.get(currentUrl) || [];
    return suggestions.map(entry => {
      const [url, trigger] = entry.split(':');
      return { url, trigger };
    });
  }

  // Track screen fingerprints to detect page changes
  addScreenFingerprint(fingerprint: string): boolean {
    const isNew = !this.store.screenFingerprints.has(fingerprint);
    this.store.screenFingerprints.add(fingerprint);
    
    // Clean old fingerprints (keep last 100)
    if (this.store.screenFingerprints.size > 100) {
      const fingerprints = Array.from(this.store.screenFingerprints);
      fingerprints.slice(0, fingerprints.length - 100).forEach(fp => {
        this.store.screenFingerprints.delete(fp);
      });
    }
    
    return isNew;
  }

  // Get memory statistics
  getStats(): {
    elements: number;
    synonyms: number;
    screenFingerprints: number;
    navigationPaths: number;
  } {
    return {
      elements: this.store.elements.size,
      synonyms: this.store.synonyms.size,
      screenFingerprints: this.store.screenFingerprints.size,
      navigationPaths: this.store.navigationPaths.size
    };
  }

  // Get current knowledge for planning context
  getKnowledge(): MemoryStore {
    return {
      elements: new Map(this.store.elements),
      synonyms: new Map(this.store.synonyms),
      screenFingerprints: new Set(this.store.screenFingerprints),
      navigationPaths: new Map(this.store.navigationPaths)
    };
  }

  // Generate unique key for UI elements
  private generateElementKey(item: SimpleItem): string {
    const parts = [
      item.kind,
      item.label.toLowerCase(),
      item.group || 'no-group',
      item.section || 'no-section'
    ];
    return parts.join('::');
  }

  // Clear memory (for testing or reset)
  clear(): void {
    this.store.elements.clear();
    this.store.synonyms.clear();
    this.store.screenFingerprints.clear();
    this.store.navigationPaths.clear();
  }
}
