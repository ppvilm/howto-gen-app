import { UIElement, UIGraph } from './ui-graph-builder';
import { SelectorHeuristicsStore } from './selector-heuristics-store';

export interface SelectorMatch {
  element: UIElement;
  selector: string;
  score: number;
  confidence: number;
  reasoning: string[];
  context: string;
}

export interface HeuristicConfig {
  scoreThresholds: {
    direct: number;          // >= 0.78: take directly
    tryMultiple: number;     // 0.6-0.77: try top 2
    llmFallback: number;     // < 0.6: use LLM
  };
  weights: {
    roleMatch: number;       // 0.2
    labelSimilarity: number; // 0.3
    i18nNormalization: number; // 0.05
    stableAttributes: number; // 0.2
    contextBoost: number;    // 0.15
    negativeSignals: number; // up to -0.3
  };
  synonyms: Record<string, string[]>;
}

export class HeuristicSelector {
  private config: HeuristicConfig;
  private store?: SelectorHeuristicsStore;
  
  constructor(config?: Partial<HeuristicConfig>, store?: SelectorHeuristicsStore) {
    // If a store is provided and contains config, merge it as defaults
    const fromStore = store?.getConfig();
    this.store = store;
    this.config = {
      scoreThresholds: {
        direct: fromStore?.scoreThresholds?.direct ?? 0.78,     // >= 0.78: take directly
        tryMultiple: fromStore?.scoreThresholds?.tryMultiple ?? 0.6, // 0.6-0.77: try top 2
        llmFallback: fromStore?.scoreThresholds?.llmFallback ?? 0.6  // < 0.6: use LLM (if enabled)
      },
      weights: {
        roleMatch: fromStore?.weights?.roleMatch ?? 0.2,
        labelSimilarity: fromStore?.weights?.labelSimilarity ?? 0.3,
        i18nNormalization: fromStore?.weights?.i18nNormalization ?? 0.05,
        stableAttributes: fromStore?.weights?.stableAttributes ?? 0.2,
        contextBoost: fromStore?.weights?.contextBoost ?? 0.15,
        negativeSignals: fromStore?.weights?.negativeSignals ?? 0.3
      },
      synonyms: fromStore?.synonyms || {
        'login': ['anmelden', 'sign in', 'log in', 'einloggen'],
        'register': ['registrieren', 'sign up', 'anmelden', 'erstellen'],
        'submit': ['absenden', 'senden', 'send', 'abschicken'],
        'cancel': ['abbrechen', 'zurück', 'back', 'schließen'],
        'search': ['suchen', 'suche', 'find', 'finden'],
        'email': ['e-mail', 'mail', 'email'],
        'password': ['passwort', 'kennwort', 'pwd'],
        'username': ['benutzername', 'nutzername', 'user'],
        'confirm': ['bestätigen', 'confirm', 'ok'],
        'next': ['weiter', 'next', 'continue', 'fortfahren'],
        'previous': ['zurück', 'back', 'prev', 'vorherige']
      },
      ...config
    };
  }
  
  async findBestMatches(
    uiGraph: UIGraph,
    stepIntent: {
      action: 'click' | 'type' | 'any';
      label: string;
      roleHint?: string;
      context?: string;
    },
    sessionContext?: {
      recentElements: UIElement[];
      currentFormGroup?: string;
      activeModal?: string;
    }
  ): Promise<SelectorMatch[]> {
    console.log(`[Heuristic] Finding matches for "${stepIntent.label}" (action: ${stepIntent.action})`);
    
    // Filter candidates by action type
    const candidates = this.filterCandidatesByAction(uiGraph, stepIntent.action, stepIntent.roleHint);
    console.log(`[Heuristic] Found ${candidates.length} candidates after action filtering`);
    
    // Score each candidate
    const scoredMatches: SelectorMatch[] = [];
    
    for (const element of candidates) {
      const score = this.scoreElement(element, stepIntent, uiGraph, sessionContext);
      
      if (score.totalScore > 0) {
        const match: SelectorMatch = {
          element,
          selector: element.candidateSelectors[0] || this.buildFallbackSelector(element),
          score: score.totalScore,
          confidence: Math.min(score.totalScore, 1.0),
          reasoning: score.reasoning,
          context: this.buildElementContext(element, uiGraph)
        };
        
        scoredMatches.push(match);
      }
    }
    
    // Sort by score (highest first)
    scoredMatches.sort((a, b) => b.score - a.score);
    
    console.log(`[Heuristic] Top 3 matches:`)
    for (let i = 0; i < Math.min(3, scoredMatches.length); i++) {
      const match = scoredMatches[i];
      console.log(`  ${i + 1}. Score ${match.score.toFixed(3)}: ${match.selector}`);
    }
    
    return scoredMatches;
  }
  
  private filterCandidatesByAction(uiGraph: UIGraph, action: string, roleHint?: string): UIElement[] {
    const candidates = uiGraph.elements.filter(element => {
      // Must be visible, enabled and in active tab
      if (!element.visible || !element.enabled || !element.isInActiveTab) {
        return false;
      }
      
      // Filter by action type
      switch (action) {
        case 'type':
          // Primary candidates: actual input elements
          if (['input', 'textarea'].includes(element.tag) || 
              element.role === 'textbox' ||
              element.contentEditable === true) {
            return true;
          }
          
          // Extended search: Also include elements that might be associated with inputs
          // This includes labels, legend elements, or elements with text that might label an input
          if (['label', 'legend', 'span', 'div', 'p'].includes(element.tag) && element.text) {
            return true;
          }
          
          return false;
        
        case 'click':
          return element.clickable || 
                 ['button', 'a'].includes(element.tag) ||
                 element.role === 'button' ||
                 element.role === 'link';
        
        case 'any':
        default:
          return true;
      }
    });

    console.log(`[Heuristic] Action '${action}' found ${candidates.length} candidates (including labels/text elements)`);
    
    return candidates;
  }
  
  private scoreElement(
    element: UIElement,
    stepIntent: { action: string; label: string; roleHint?: string; context?: string },
    uiGraph: UIGraph,
    sessionContext?: { recentElements: UIElement[]; currentFormGroup?: string; activeModal?: string }
  ): { totalScore: number; reasoning: string[] } {
    const reasoning: string[] = [];
    let totalScore = 0;
    
    // 1. Role Match (0-0.2)
    const roleScore = this.scoreRoleMatch(element, stepIntent.action, stepIntent.roleHint);
    totalScore += roleScore * this.config.weights.roleMatch;
    if (roleScore > 0) {
      reasoning.push(`role-match(${roleScore.toFixed(2)})`);
    }
    
    // 2. Label Similarity (0-0.3)
    const labelScore = this.scoreLabelSimilarity(element, stepIntent.label);
    totalScore += labelScore * this.config.weights.labelSimilarity;
    if (labelScore > 0) {
      reasoning.push(`label-sim(${labelScore.toFixed(2)})`);
    }
    
    // 3. i18n Normalization (0-0.05)
    const i18nScore = this.scoreI18nSimilarity(element, stepIntent.label);
    totalScore += i18nScore * this.config.weights.i18nNormalization;
    if (i18nScore > 0) {
      reasoning.push(`i18n(${i18nScore.toFixed(2)})`);
    }
    
    // 4. Stable Attributes (0-0.2)
    const stabilityScore = this.scoreStableAttributes(element);
    totalScore += stabilityScore * this.config.weights.stableAttributes;
    if (stabilityScore > 0) {
      reasoning.push(`stable(${stabilityScore.toFixed(2)})`);
    }
    
    // 5. Context Boost (0-0.15)
    const contextScore = this.scoreContextBoost(element, stepIntent, sessionContext);
    totalScore += contextScore * this.config.weights.contextBoost;
    if (contextScore > 0) {
      reasoning.push(`context(${contextScore.toFixed(2)})`);
    }
    
    // 6. Negative Signals (up to -0.3)
    const negativeScore = this.scoreNegativeSignals(element, uiGraph);
    totalScore += negativeScore; // Already negative
    if (negativeScore < 0) {
      reasoning.push(`negative(${negativeScore.toFixed(2)})`);
    }
    
    return { totalScore: Math.max(0, totalScore), reasoning };
  }
  
  private scoreRoleMatch(element: UIElement, action: string, roleHint?: string): number {
    // Exact role hint match
    if (roleHint && element.role === roleHint) {
      return 1.0;
    }
    
    // Action type matching
    switch (action) {
      case 'click':
        if (['button', 'link'].includes(element.role || '')) return 0.9;
        if (['button', 'a'].includes(element.tag)) return 0.8;
        if (element.clickable) return 0.6;
        break;
      
      case 'type':
        if (element.role === 'textbox') return 0.9;
        if (['input', 'textarea'].includes(element.tag)) return 0.8;
        break;
    }
    
    return 0;
  }
  
  private scoreLabelSimilarity(element: UIElement, targetLabel: string): number {
    const target = this.normalizeText(targetLabel);
    
    // Check various text sources
    const candidates = [
      element.accessibleName,
      element.title,
      element.tooltipTitle,
      element.label,
      element.placeholder,
      element.text,
      element.name,
      element.dataTestId,
      element.dataUnique,
      // Also consider href path segments as labels (e.g., /regression)
      element.href ? element.href.split(/[\/#?&]+/).filter(Boolean).join(' ') : undefined
    ].filter(Boolean).map(text => this.normalizeText(text!));
    
    let bestScore = 0;
    
    for (const candidate of candidates) {
      const lev = this.fuzzyStringMatch(target, candidate);
      const cos = this.tokenCosine(target, candidate);
      const similarity = Math.max(lev, cos);
      bestScore = Math.max(bestScore, similarity);
    }
    
    return bestScore;
  }
  
  private scoreI18nSimilarity(element: UIElement, targetLabel: string): number {
    const normalizedTarget = this.normalizeText(targetLabel);
    
    // Build candidate synonym set only when sufficiently similar
    let synonyms: string[] = [];
    for (const [key, syns] of Object.entries(this.config.synonyms)) {
      const all = [key, ...syns];
      if (all.some(s => this.fuzzyStringMatch(this.normalizeText(s), normalizedTarget) > 0.85)) {
        synonyms = [...synonyms, ...all];
      }
    }
    if (synonyms.length === 0) return 0;
    
    const candidates = [
      element.accessibleName,
      element.label,
      element.placeholder,
      element.text
    ].filter(Boolean).map(text => this.normalizeText(text!));
    
    let bestScore = 0;
    for (const candidate of candidates) {
      for (const synonym of synonyms) {
        const similarity = this.fuzzyStringMatch(candidate, this.normalizeText(synonym));
        bestScore = Math.max(bestScore, similarity);
      }
    }
    return bestScore;
  }
  
  private scoreStableAttributes(element: UIElement): number {
    let score = 0;
    
    // data-testid is most stable
    if (element.dataTestId) {
      score += 0.8;
    }
    // data-unique (often custom, stable)
    if (element.dataUnique) {
      score += 0.8;
    }
    
    // Semantic IDs (not generated)
    if (element.id && !/^[a-z]+-[0-9a-f]{6,}$/i.test(element.id)) {
      score += 0.6;
    }
    
    // Form input names
    if (element.name && ['input', 'textarea', 'select'].includes(element.tag)) {
      score += 0.5;
    }
    
    // Stable high stability selectors
    if (element.stability === 'high') {
      score += 0.4;
    } else if (element.stability === 'medium') {
      score += 0.2;
    }
    
    // Href presence (anchors) lends some stability, but low weight
    if (element.href) {
      score += 0.2;
    }
    
    return Math.min(score, 1.0);
  }
  
  private scoreContextBoost(
    element: UIElement, 
    stepIntent: { action: string; label: string; context?: string },
    sessionContext?: { recentElements: UIElement[]; currentFormGroup?: string; activeModal?: string }
  ): number {
    let boost = 0;
    
    // Same form group as recent elements
    if (sessionContext?.currentFormGroup && element.formGroup === sessionContext.currentFormGroup) {
      boost += 0.6;
    }
    
    // Inside active modal
    if (sessionContext?.activeModal && element.parentModalOrDrawer === sessionContext.activeModal) {
      boost += 0.4;
    }
    
    // Under relevant section heading
    if (stepIntent.context && element.sectionTitle?.toLowerCase().includes(stepIntent.context.toLowerCase())) {
      boost += 0.3;
    }
    
    // Sidebar / navigation hint in context
    if (stepIntent.context) {
      const c = stepIntent.context.toLowerCase();
      const sidebarHint = c.includes('sidebar') || c.includes('navigation') || c.includes('nav');
      if (sidebarHint && (element.inNavigation || (element as any).dataUnique?.toLowerCase().includes('sidebar'))) {
        boost += 0.6;
      }
    }
    
    // Primary button boost for submission actions
    if (element.isPrimary && ['submit', 'send', 'save', 'login'].some(term => 
        stepIntent.label.toLowerCase().includes(term))) {
      boost += 0.5;
    }
    
    return Math.min(boost, 1.0);
  }
  
  private scoreNegativeSignals(element: UIElement, uiGraph: UIGraph): number {
    let penalty = 0;
    
    // Offscreen elements
    if (!element.inViewport) {
      penalty -= 0.3;
    }
    
    // Disabled elements (should be filtered earlier, but double-check)
    if (!element.enabled) {
      penalty -= 0.5;
    }
    
    // Hidden tabs
    if (!element.isInActiveTab) {
      penalty -= 0.4;
    }
    
    // Demo/footer content (avoid penalizing sidebar globally)
    const demoKeywords = ['demo', 'footer', 'advertisement', 'banner'];
    if (element.classes.some(cls => demoKeywords.some(keyword => cls.toLowerCase().includes(keyword)))) {
      penalty -= 0.2;
    }
    
    // Duplicate elements (same text content in same section)
    const duplicates = uiGraph.elements.filter(other => 
      other !== element &&
      other.text === element.text &&
      other.sectionTitle === element.sectionTitle &&
      other.text // Must have text to be considered duplicate
    );
    
    if (duplicates.length > 0) {
      penalty -= 0.15 * duplicates.length;
    }
    
    return Math.max(penalty, -0.3); // Cap at -0.3
  }
  
  private fuzzyStringMatch(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (str1.includes(str2) || str2.includes(str1)) return 0.8;
    
    // Levenshtein distance
    const len1 = str1.length;
    const len2 = str2.length;
    
    if (len1 === 0) return len2 === 0 ? 1 : 0;
    if (len2 === 0) return 0;
    
    const matrix = Array(len2 + 1).fill(null).map(() => Array(len1 + 1).fill(null));
    
    for (let i = 0; i <= len1; i++) matrix[0][i] = i;
    for (let j = 0; j <= len2; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= len2; j++) {
      for (let i = 1; i <= len1; i++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,     // deletion
          matrix[j - 1][i] + 1,     // insertion
          matrix[j - 1][i - 1] + cost // substitution
        );
      }
    }
    
    const distance = matrix[len2][len1];
    const maxLen = Math.max(len1, len2);
    return 1 - (distance / maxLen);
  }
  
  private normalizeText(text: string): string {
    return text.toLowerCase()
      .replace(/[äöüß]/g, char => {
        const map: Record<string, string> = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' };
        return map[char] || char;
      })
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private tokenCosine(a: string, b: string): number {
    if (a === b) return 1.0;
    const toTokens = (s: string) => s.split(/\s+/).filter(Boolean);
    const ta = toTokens(a);
    const tb = toTokens(b);
    if (ta.length === 0 || tb.length === 0) return 0;
    const set = new Set([...ta, ...tb]);
    const va: Record<string, number> = {};
    const vb: Record<string, number> = {};
    for (const t of ta) va[t] = (va[t] || 0) + 1;
    for (const t of tb) vb[t] = (vb[t] || 0) + 1;
    let dot = 0, na = 0, nb = 0;
    for (const t of set) {
      const x = va[t] || 0;
      const y = vb[t] || 0;
      dot += x * y;
      na += x * x;
      nb += y * y;
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }
  
  private buildElementContext(element: UIElement, uiGraph: UIGraph): string {
    const context: string[] = [];
    
    if (element.sectionTitle) {
      context.push(`Section: ${element.sectionTitle}`);
    }
    
    if (element.formGroup) {
      context.push(`Form: ${element.formGroup}`);
    }
    
    if (element.parentModalOrDrawer) {
      context.push(`Modal: ${element.parentModalOrDrawer}`);
    }
    
    if (element.nearbyText.length > 0) {
      context.push(`Nearby: ${element.nearbyText.slice(0, 2).join(', ')}`);
    }
    
    return context.join(' | ');
  }
  
  private buildFallbackSelector(element: UIElement): string {
    if (element.dataTestId) return `[data-testid="${element.dataTestId}"]`;
    if ((element as any).dataUnique) return `[data-unique="${(element as any).dataUnique}"]`;
    if (element.id) return `#${element.id}`;
    if (element.name && ['input','textarea','select'].includes(element.tag)) return `${element.tag}[name="${element.name}"]`;
    if (element.role && element.accessibleName) return `[role="${element.role}"][aria-label="${element.accessibleName}"]`;
    if (element.tag === 'button' && element.text && element.text.length <= 30) return `button:has-text("${element.text}")`;
    if (element.href && element.tag === 'a') return `a[href="${element.href}"]`;
    if (element.classes && element.classes.length > 0) return `.${element.classes.slice(0,2).join('.')}`;
    return element.tag;
  }

  shouldUseLLM(matches: SelectorMatch[]): { useLLM: boolean; reason: string; topCandidates?: SelectorMatch[] } {
    if (matches.length === 0) {
      return { useLLM: true, reason: 'No matches found' };
    }
    
    const bestScore = matches[0].score;
    
    if (bestScore >= this.config.scoreThresholds.direct) {
      return { useLLM: false, reason: `High confidence match (${bestScore.toFixed(3)})` };
    }
    
    if (bestScore >= this.config.scoreThresholds.tryMultiple) {
      const topTwo = matches.slice(0, 2);
      return { 
        useLLM: false, 
        reason: `Medium confidence, trying top candidates (${bestScore.toFixed(3)})`,
        topCandidates: topTwo
      };
    }
    
    const topCandidates = matches.slice(0, Math.min(8, matches.length));
    return { 
      useLLM: true, 
      reason: `Low confidence (${bestScore.toFixed(3)}), need LLM`,
      topCandidates
    };
  }
  
  // Helper method to extract a prioritized list of selectors from matches,
  // optionally augmented with learned selectors from the store
  getSelectorsToTry(
    matches: SelectorMatch[],
    context?: { label?: string; elementType?: 'input' | 'button' | 'any'; currentUrl?: string }
  ): string[] {
    const collected: string[] = [];

    // 0) Inject static (hardcoded) selectors first, then learned selectors (if any)
    if (this.store && context?.label && context?.elementType) {
      try {
        const statics = this.store.getStaticSelectors(context.label, context.elementType, context.currentUrl);
        for (const entry of statics) {
          if (entry.selector) collected.push(entry.selector);
          if (Array.isArray(entry.fallbacks)) collected.push(...entry.fallbacks);
        }
        if (statics.length > 0) {
          console.log(`[Heuristic] Injected ${statics.length} static selector(s) for "${context.label}"`);
        }

        const learned = this.store.getLearnedSelectors(context.label, context.elementType, context.currentUrl);
        // Push learned primary selector first, then its fallbacks
        for (const entry of learned) {
          if (entry.selector) collected.push(entry.selector);
          if (Array.isArray(entry.fallbacks)) {
            collected.push(...entry.fallbacks);
          }
        }
        if (learned.length > 0) {
          console.log(`[Heuristic] Injected ${learned.length} learned selector(s) for "${context.label}"`);
        }
      } catch {}
    }

    // 1) Collect from heuristic matches (primary + candidates)
    for (const match of matches) {
      // primary selector or a constructed fallback
      collected.push(match.selector || this.buildFallbackSelector(match.element));
      // include additional candidate selectors for resilience
      if (match.element.candidateSelectors && match.element.candidateSelectors.length > 0) {
        collected.push(...match.element.candidateSelectors);
      }
    }
    // 2) de-duplicate while preserving order
    const seen = new Set<string>();
    const unique = collected.filter(sel => {
      if (!sel || seen.has(sel)) return false;
      seen.add(sel);
      return true;
    });
    return unique.slice(0, 16); // allow a few more when learned selectors are present
  }
  
  // Method to create LLM context from top candidates
  createLLMContext(matches: SelectorMatch[]): string {
    if (matches.length === 0) return 'No candidates found by heuristics.';
    
    const candidateDescriptions = matches.map((match, index) => {
      return `${index + 1}. Selector: ${match.selector}
   - Score: ${match.score.toFixed(3)}
   - Element: ${match.element.tag} with ${match.element.accessibleName || match.element.text || 'no text'}
   - Context: ${match.context}`;
    }).join('\n\n');
    
    return `Heuristic analysis found ${matches.length} candidates:\n\n${candidateDescriptions}`;
  }
}
