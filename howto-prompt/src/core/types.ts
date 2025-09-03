import { StepAction } from 'howto-core';

// Core Options for howto-prompt
export interface HowtoPromptOptions {
  baseUrl: string;
  credentials?: Record<string, string>;
  secrets?: Record<string, string>;
  variables?: Record<string, any>;
  model?: string;
  maxSteps?: number;
  maxRefinesPerStep?: number;
  headless?: boolean;
  outputDir?: string;
  timeout?: number;
  strict?: boolean;
  language?: string;
  interactive?: boolean;
  onUserPrompt?: (question: string, options?: string[]) => Promise<string>;
  
  // Subgoal/Subtask-Konfiguration
  useSubgoals?: boolean; // Feature-Flag für Subgoal-System (standardmäßig deaktiviert für RAG-Demo)
  subgoalConfig?: {
    maxSubgoals?: number;
    maxSubtasksPerSubgoal?: number;
    maxStepsPerSubtask?: number;
    maxRetriesPerSubtask?: number;
    fallbackToSteps?: boolean;
  };
  
}

// UI Inventory removed in DOM+LLM-only mode

// Note Format according to PRD specification
export interface NoteFormat {
  sectionHint: string;  // Line 1: 1-3 words
  contextJson: {        // Line 2: compact JSON
    intent: 'type' | 'click' | 'navigate' | 'verify';
    field?: string;
    buttonText?: string;
    group?: string;
    synonyms?: string[];
    placeholder?: string;
    roleHint?: string;
    sensitive?: boolean;
    submit?: boolean;
    priority?: 'primary' | 'secondary';
  };
  description?: string; // Line 3: optional sentence (<= 80 chars)
}

// Memory for known UI elements and synonyms
export interface UIElementMemory {
  label: string;
  synonyms: string[];
  group?: string;
  section?: string;
  lastSeen: number;
  confidence: number;
  context: string[];
}

export interface MemoryStore {
  elements: Map<string, UIElementMemory>;
  synonyms: Map<string, string[]>;
  screenFingerprints: Set<string>;
  navigationPaths: Map<string, string[]>;
}

// Step planning context
export interface PlanningContext {
  prompt: string;
  currentUrl: string;
  visitedUrls: Set<string>;
  memory: MemoryStore;
  // DOM+LLM only
  cleanedDOM: string;
  stepHistory: StepAction[];
  goalProgress: number; // 0-1
  secretsKeys?: string[];
  varsKeys?: string[];
  // uiGraph removed
  // Full page screenshot data
  screenshot?: string; // base64 encoded image or file path
  
  // Enhanced DOM Context for better planning
  pageContext?: {
    viewport: { width: number; height: number };
    scrollPosition: { x: number; y: number };
    isScrollable: boolean;
    hasHorizontalScroll: boolean;
    hasVerticalScroll: boolean;
  };
  
  semanticHierarchy?: {
    main?: string;
    nav?: string[];
    aside?: string[];
    sections?: Array<{ title: string; role: string; elementCount: number }>;
    breadcrumbs?: string[];
  };
  
  workflowState?: {
    currentStep?: number;
    totalSteps?: number;
    completedSteps?: number[];
    activeWizard?: string;
    formValidationErrors: number;
    requiredFieldsEmpty: number;
    progressIndicators?: Array<{ label: string; progress: number; total: number }>;
  };
  
  dynamicContent?: {
    loadingElements: number;
    errorMessages: string[];
    successMessages: string[];
    expandedSections: string[];
    collapsedSections: string[];
    activeTabs: string[];
    modalStack: string[];
    hasAnimations: boolean;
    lastContentUpdate?: number;
  };
  
  interactionHistory?: {
    recentlyFocused?: string[];
    recentlyClicked?: string[];
    lastInteractionTime?: number;
    userInputValues?: Record<string, { timestamp: number; hasValue: boolean }>;
  };
  
  // Previous step validation context for confidence adjustment
  previousStepReasoning?: string;
  
  // Success criteria validation context (for combined planning+validation)
  goalCriteria?: string[];
  previousState?: {
    dom: string;
    url: string;
    stepHistory?: any[];
    navigationOccurred?: boolean;
    previousSummary?: string;
    screenshot?: string;
    screenshotBase64?: string;
    screenshotMime?: string;
  };
}

// Execution result with validation
export interface StepExecutionResult {
  step: StepAction;
  success: boolean;
  error?: string;
  errorType?: 'not_found' | 'not_visible' | 'timeout' | 'type_mismatch' | 'navigation_failed';
  screenshot?: string;
  domSnapshot?: string;
  duration: number;
  timestamp: number;
  uiChanges?: {
    navigationOccurred: boolean;
    newUrl?: string;
    elementsAppeared: number;
    elementsDisappeared: number;
  };
  successCriteriaCheck?: {
    fulfilled: string[];
    pending: string[];
    validationPerformed: boolean;
    validationError?: string;
    stepValidation?: {
      success: boolean;
      reasoning?: string;
    };
    goalValidation?: {
      isComplete: boolean;
      reasoning: string;
    };
  };
}

// Refinement strategies for failed steps
export interface RefinementStrategy {
  type: 'synonym' | 'timing' | 'alternative' | 'context';
  description: string;
  modifications: Partial<StepAction>;
}

export interface RefinementResult {
  originalStep: StepAction;
  refinedStep: StepAction;
  strategy: RefinementStrategy;
  confidence: number;
}

// Planning result with confidence
export interface PlanningResult {
  step: StepAction;
  confidence: number;
  alternatives?: StepAction[];
  matchesGoal: boolean; // Whether the planned step matches the current goal/sub-goal
  stepReasoning?: string; // Reasoning/justification for why this step is necessary
  previousStepValidation?: { // Validation results of previous step criteria
    fulfilled: string[];
    pending: string[];
    confidenceAdjustment?: number; // How much the confidence was adjusted based on validation
  };
  // Combined success criteria validation results (when validation context is provided)
  stepValidation?: {
    success: boolean;
    reasoning?: string;
  };
  goalValidation?: {
    isComplete: boolean;
    reasoning: string;
  };
}


// LLM Provider abstraction
export interface LLMProvider {
  planNextStep(context: PlanningContext): Promise<StepAction>;
  planNextStepWithConfidence(context: PlanningContext): Promise<PlanningResult>;
  refineStep(
    failedStep: StepAction,
    error: StepExecutionResult
  ): Promise<RefinementResult>;
  analyzeGoalProgress(
    prompt: string,
    stepHistory: StepAction[],
    currentUrl: string
  ): Promise<{ completed: boolean; progress: number; nextObjective?: string }>;
}

// Event streaming for live updates
export type PromptEvent = 
  // Planning Phase
  | { type: 'planning_started'; prompt: string }
  | { type: 'goal_analyzed'; objectives: string[]; confidence: number }
  | { type: 'step_planning'; stepIndex: number; context: string; currentUrl?: string }
  | { type: 'step_planned'; step: StepAction; reasoning?: string; confidence: number; alternatives?: StepAction[] }
  
  // Execution Phase
  | { type: 'step_executing'; stepIndex: number; step: StepAction }
  | { type: 'step_executed'; stepIndex: number; result: StepExecutionResult }
  
  // Refinement Phase
  | { type: 'step_refinement_started'; stepIndex: number; reason: string; attempts: number }
  | { type: 'step_refined'; stepIndex: number; strategy: RefinementStrategy; newStep: StepAction }
  | { type: 'step_refinement_failed'; stepIndex: number; attempts: number; maxAttemptsReached: boolean }
  
  // Progress Tracking
  | { type: 'goal_progress'; progress: number; nextObjective?: string; completedObjectives?: string[] }
  | { type: 'validation_performed'; fulfilled: string[]; pending: string[]; validationSuccess: boolean }
  
  // Page Analysis (DOM+URL+History mode)
  | { type: 'page_analyzed'; url: string; elementCount: number; navigationDetected?: boolean }
  | { type: 'dom_processed'; cleanedDomLength: number; elementsExtracted: number }
  
  // Completion
  | { type: 'markdown_generating'; scriptId: string; totalSteps: number }
  | { type: 'markdown_generated'; scriptId: string; markdown: string; stepCount: number }
  | { type: 'script_saving'; scriptId: string }
  | { type: 'script_saved'; scriptId: string; path: string }
  | { type: 'completed'; success: boolean; markdown: string; steps: StepAction[]; scriptId: string };

// Combined event stream for prompt generation (includes session events from howto-core)
export type PromptStreamEvent = PromptEvent;

// Main API result
export interface HowtoPromptResult {
  success: boolean;
  markdown: string;
  steps: StepAction[];
  report: {
    totalSteps: number;
    successfulSteps: number;
    refinements: number;
    duration: number;
    screenshots: string[];
    videoPath?: string;
    errors: string[];
  };
  logs: string[];
}
