import { UIElement, UIGraph } from './ui-graph-builder';
import { SelectorMatch } from './heuristic-selector';

export interface StepContext {
  stepIndex: number;
  stepType: 'goto' | 'type' | 'click' | 'wait' | 'screenshot' | 'keypress';
  label?: string;
  timestamp: number;
  element?: UIElement;
  selector?: string;
  success: boolean;
  formGroup?: string;
  modal?: string;
  url?: string;
}

export interface SessionState {
  currentUrl: string;
  currentFormGroup?: string;
  activeModal?: string;
  recentElements: UIElement[];
  recentSteps: StepContext[];
  screenCache: Map<string, UIGraph>;
  selectorCache: Map<string, { selector: string; confidence: number; timestamp: number }>;
  failedSelectors: Set<string>;
  temporalProximity: Map<string, number>; // element signature -> last interaction timestamp
}

export interface FlowContext {
  flowType?: 'login' | 'registration' | 'checkout' | 'search' | 'form' | 'navigation';
  expectedSequence: string[];
  currentPosition: number;
  confidence: number;
}

export class ContextTracker {
  private sessionState: SessionState;
  private flowContext: FlowContext | null = null;
  private readonly maxRecentElements = 10;
  private readonly maxRecentSteps = 20;
  private readonly cacheExpirationMs = 5 * 60 * 1000; // 5 minutes
  
  constructor() {
    this.sessionState = {
      currentUrl: '',
      recentElements: [],
      recentSteps: [],
      screenCache: new Map(),
      selectorCache: new Map(),
      failedSelectors: new Set(),
      temporalProximity: new Map()
    };
  }
  
  updateNavigation(url: string, uiGraph: UIGraph): void {
    console.log(`[Context] Navigation to ${url}`);
    
    const urlChanged = this.sessionState.currentUrl !== url;
    this.sessionState.currentUrl = url;
    
    // Cache the UI graph for this screen
    this.sessionState.screenCache.set(uiGraph.screenFingerprint, uiGraph);
    
    // Update active modal
    this.sessionState.activeModal = uiGraph.activeModal;
    
    // Reset form group if URL changed (different page)
    if (urlChanged) {
      this.sessionState.currentFormGroup = undefined;
      console.log(`[Context] URL changed, reset form group`);
    }
    
    // Detect flow context
    this.detectFlowContext(url, uiGraph);
    
    // Clean expired cache
    this.cleanExpiredCache();
  }
  
  trackStepStart(stepIndex: number, stepType: string, label?: string): void {
    const timestamp = Date.now();
    
    const stepContext: StepContext = {
      stepIndex,
      stepType: stepType as any,
      label,
      timestamp,
      success: false // Will be updated on completion
    };
    
    this.sessionState.recentSteps.push(stepContext);
    
    // Keep only recent steps
    if (this.sessionState.recentSteps.length > this.maxRecentSteps) {
      this.sessionState.recentSteps.shift();
    }
    
    console.log(`[Context] Step ${stepIndex} started: ${stepType} "${label}"`);
  }
  
  trackElementInteraction(element: UIElement, selector: string, success: boolean): void {
    const timestamp = Date.now();
    
    // Update current step
    const currentStep = this.sessionState.recentSteps[this.sessionState.recentSteps.length - 1];
    if (currentStep) {
      currentStep.element = element;
      currentStep.selector = selector;
      currentStep.success = success;
      currentStep.formGroup = element.formGroup;
      currentStep.modal = element.parentModalOrDrawer;
      currentStep.url = this.sessionState.currentUrl;
    }
    
    if (success) {
      // Track successful element
      this.sessionState.recentElements.push(element);
      
      // Keep only recent elements
      if (this.sessionState.recentElements.length > this.maxRecentElements) {
        this.sessionState.recentElements.shift();
      }
      
      // Update form group context
      if (element.formGroup) {
        this.sessionState.currentFormGroup = element.formGroup;
        console.log(`[Context] Current form group: ${element.formGroup}`);
      }
      
      // Cache successful selector
      const cacheKey = this.createSelectorCacheKey(element, currentStep?.stepType || 'any');
      this.sessionState.selectorCache.set(cacheKey, {
        selector,
        confidence: 1.0,
        timestamp
      });
      
      // Update temporal proximity
      const elementSignature = this.getElementSignature(element);
      this.sessionState.temporalProximity.set(elementSignature, timestamp);
      
      console.log(`[Context] Successful interaction with ${element.tag}[${selector}]`);
    } else {
      // Track failed selector
      this.sessionState.failedSelectors.add(selector);
      console.log(`[Context] Failed selector: ${selector}`);
    }
  }
  
  getSessionContext(): {
    recentElements: UIElement[];
    currentFormGroup?: string;
    activeModal?: string;
    flowContext?: FlowContext;
    recentlyFailedSelectors: string[];
  } {
    return {
      recentElements: [...this.sessionState.recentElements],
      currentFormGroup: this.sessionState.currentFormGroup,
      activeModal: this.sessionState.activeModal,
      flowContext: this.flowContext || undefined,
      recentlyFailedSelectors: Array.from(this.sessionState.failedSelectors)
    };
  }
  
  getCachedSelector(element: UIElement, stepType: string): { selector: string; confidence: number } | null {
    const cacheKey = this.createSelectorCacheKey(element, stepType);
    const cached = this.sessionState.selectorCache.get(cacheKey);
    
    if (!cached) return null;
    
    // Check if cache is still valid
    const age = Date.now() - cached.timestamp;
    if (age > this.cacheExpirationMs) {
      this.sessionState.selectorCache.delete(cacheKey);
      return null;
    }
    
    console.log(`[Context] Using cached selector for ${cacheKey}: ${cached.selector}`);
    return {
      selector: cached.selector,
      confidence: cached.confidence
    };
  }
  
  getCachedScreen(fingerprint: string): UIGraph | null {
    return this.sessionState.screenCache.get(fingerprint) || null;
  }
  
  getTemporalProximityBoost(element: UIElement): number {
    const signature = this.getElementSignature(element);
    const lastInteraction = this.sessionState.temporalProximity.get(signature);
    
    if (!lastInteraction) return 0;
    
    const timeSinceInteraction = Date.now() - lastInteraction;
    const proximityWindow = 30 * 1000; // 30 seconds
    
    if (timeSinceInteraction > proximityWindow) return 0;
    
    // Linear decay from 1.0 to 0 over proximity window
    const boost = 1.0 - (timeSinceInteraction / proximityWindow);
    return Math.max(0, boost);
  }
  
  getFormGroupContext(): {
    currentFormGroup?: string;
    recentFormElements: UIElement[];
    expectedNextFields: string[];
  } {
    const recentFormElements = this.sessionState.recentElements.filter(el => 
      el.formGroup === this.sessionState.currentFormGroup
    );
    
    // Predict next fields based on common form patterns
    const expectedNextFields = this.predictNextFormFields(recentFormElements);
    
    return {
      currentFormGroup: this.sessionState.currentFormGroup,
      recentFormElements,
      expectedNextFields
    };
  }
  
  getFlowContext(): FlowContext | null {
    return this.flowContext;
  }
  
  private detectFlowContext(url: string, uiGraph: UIGraph): void {
    const urlPath = url.toLowerCase();
    const pageTitle = uiGraph.title.toLowerCase();
    const landmarks = uiGraph.landmarkStructure.map(l => l.toLowerCase());
    
    // Login flow detection
    if (urlPath.includes('login') || urlPath.includes('signin') || 
        pageTitle.includes('login') || pageTitle.includes('sign in') ||
        landmarks.some(l => l.includes('login') || l.includes('anmelden'))) {
      
      this.flowContext = {
        flowType: 'login',
        expectedSequence: ['email', 'password', 'submit'],
        currentPosition: 0,
        confidence: 0.9
      };
      console.log('[Context] Detected login flow');
      return;
    }
    
    // Registration flow detection
    if (urlPath.includes('register') || urlPath.includes('signup') ||
        pageTitle.includes('register') || pageTitle.includes('sign up') ||
        landmarks.some(l => l.includes('register') || l.includes('registr'))) {
      
      this.flowContext = {
        flowType: 'registration',
        expectedSequence: ['email', 'password', 'confirm-password', 'submit'],
        currentPosition: 0,
        confidence: 0.9
      };
      console.log('[Context] Detected registration flow');
      return;
    }
    
    // Checkout flow detection
    if (urlPath.includes('checkout') || urlPath.includes('payment') ||
        pageTitle.includes('checkout') || pageTitle.includes('payment')) {
      
      this.flowContext = {
        flowType: 'checkout',
        expectedSequence: ['address', 'payment', 'confirm', 'submit'],
        currentPosition: 0,
        confidence: 0.8
      };
      console.log('[Context] Detected checkout flow');
      return;
    }
    
    // Generic form detection
    if (uiGraph.activeForms.length > 0) {
      this.flowContext = {
        flowType: 'form',
        expectedSequence: ['field1', 'field2', 'submit'],
        currentPosition: 0,
        confidence: 0.6
      };
      console.log('[Context] Detected form flow');
      return;
    }
    
    // Keep existing flow context if no new pattern detected
    if (!this.flowContext) {
      this.flowContext = {
        flowType: 'navigation',
        expectedSequence: [],
        currentPosition: 0,
        confidence: 0.3
      };
    }
  }
  
  private predictNextFormFields(recentFormElements: UIElement[]): string[] {
    const recentFieldTypes = recentFormElements
      .filter(el => el.type || el.name)
      .map(el => el.type || el.name || '');
    
    // Common form field sequences
    const commonSequences: Record<string, string[]> = {
      'email': ['password'],
      'password': ['confirm-password', 'submit'],
      'firstname': ['lastname', 'email'],
      'lastname': ['email', 'phone'],
      'address': ['city', 'zip', 'country'],
      'city': ['zip', 'country'],
      'zip': ['country'],
      'phone': ['submit'],
      'card-number': ['expiry', 'cvv'],
      'expiry': ['cvv', 'name'],
      'cvv': ['name', 'submit']
    };
    
    const predictions: string[] = [];
    
    for (const fieldType of recentFieldTypes) {
      const nextFields = commonSequences[fieldType];
      if (nextFields) {
        predictions.push(...nextFields);
      }
    }
    
    return [...new Set(predictions)]; // Remove duplicates
  }
  
  private createSelectorCacheKey(element: UIElement, stepType: string): string {
    // Create a stable key based on element characteristics
    const parts = [
      stepType,
      element.tag,
      element.dataTestId || '',
      element.id || '',
      element.name || '',
      element.accessibleName || '',
      element.formGroup || '',
      element.sectionTitle || ''
    ];
    
    return parts.join(':');
  }
  
  private getElementSignature(element: UIElement): string {
    // Create a signature that identifies similar elements across page reloads
    return [
      element.tag,
      element.dataTestId || '',
      element.id || '',
      element.name || '',
      (element.accessibleName || '').substring(0, 20),
      element.formGroup || ''
    ].join('|');
  }
  
  private cleanExpiredCache(): void {
    const now = Date.now();
    
    // Clean selector cache
    for (const [key, cached] of this.sessionState.selectorCache.entries()) {
      if (now - cached.timestamp > this.cacheExpirationMs) {
        this.sessionState.selectorCache.delete(key);
      }
    }
    
    // Clean temporal proximity (keep only last hour)
    const proximityExpirationMs = 60 * 60 * 1000; // 1 hour
    for (const [signature, timestamp] of this.sessionState.temporalProximity.entries()) {
      if (now - timestamp > proximityExpirationMs) {
        this.sessionState.temporalProximity.delete(signature);
      }
    }
    
    // Clean failed selectors (reset every 10 minutes)
    const failedSelectorsAge = 10 * 60 * 1000; // 10 minutes
    const oldestRecentStep = this.sessionState.recentSteps[0];
    if (oldestRecentStep && now - oldestRecentStep.timestamp > failedSelectorsAge) {
      this.sessionState.failedSelectors.clear();
    }
    
    console.log(`[Context] Cache cleanup: ${this.sessionState.selectorCache.size} cached selectors, ${this.sessionState.temporalProximity.size} proximity entries`);
  }
  
  // Method to boost scores based on context
  enhanceMatches(matches: SelectorMatch[]): SelectorMatch[] {
    const sessionContext = this.getSessionContext();
    const flowContext = this.getFlowContext();
    
    return matches.map(match => {
      let bonusScore = 0;
      const additionalReasoning: string[] = [];
      
      // Temporal proximity boost
      const proximityBoost = this.getTemporalProximityBoost(match.element);
      if (proximityBoost > 0) {
        bonusScore += proximityBoost * 0.1; // Up to 0.1 bonus
        additionalReasoning.push(`temporal(+${proximityBoost.toFixed(2)})`);
      }
      
      // Form sequence boost
      if (sessionContext.currentFormGroup === match.element.formGroup) {
        bonusScore += 0.15;
        additionalReasoning.push('same-form');
      }
      
      // Flow context boost
      if (flowContext && this.isExpectedInFlow(match.element, flowContext)) {
        bonusScore += 0.1;
        additionalReasoning.push('flow-expected');
      }
      
      return {
        ...match,
        score: match.score + bonusScore,
        reasoning: [...match.reasoning, ...additionalReasoning]
      };
    });
  }
  
  private isExpectedInFlow(element: UIElement, flow: FlowContext): boolean {
    if (!flow.expectedSequence || flow.currentPosition >= flow.expectedSequence.length) {
      return false;
    }
    
    const expectedField = flow.expectedSequence[flow.currentPosition];
    const elementName = element.name || element.dataTestId || element.accessibleName || '';
    
    return elementName.toLowerCase().includes(expectedField.toLowerCase());
  }
  
  // Reset context (useful for new sessions or major navigation changes)
  reset(): void {
    this.sessionState = {
      currentUrl: '',
      recentElements: [],
      recentSteps: [],
      screenCache: new Map(),
      selectorCache: new Map(),
      failedSelectors: new Set(),
      temporalProximity: new Map()
    };
    this.flowContext = null;
    console.log('[Context] Context tracker reset');
  }
}