export interface StepAction {
  type: 'goto' | 'type' | 'click' | 'assert' | 'assert_page' | 'tts_start' | 'tts_wait' | 'keypress';
  label?: string;
  url?: string;
  value?: string;
  sensitive?: boolean;
  note?: string;
  timeout?: number;
  // Optional explicit post-step wait in milliseconds (e.g., after goto)
  waitMs?: number;
  screenshot?: boolean;
  domSnapshot?: boolean;
  text?: string;
  voice?: string;
  // Optional delay in milliseconds before TTS should be considered as started (does not block the step)
  delayMs?: number;
  // Optional CSS selector for element targeting (overrides heuristic search)
  selector?: string;
  // Key to press for keypress step type (e.g., "Escape", "Enter", "Tab")
  key?: string;
}

export interface GuideConfig {
  title: string;
  baseUrl: string;
  steps: StepAction[];
  language?: string;
  outputDir?: string;
  tags?: string[];
  recordVideo?: boolean;
  timeout?: number;
  // Optional global default delay (ms) applied to tts_start when step.delayMs is not set
  ttsDefaultDelayMs?: number;
}

export interface ParsedGuide {
  frontmatter: GuideConfig;
  body: string;
}

export interface StepResult {
  step: StepAction;
  index: number;
  screenshot?: string;
  domSnapshot?: string;
  success: boolean;
  error?: string;
  timestamp?: number;
  duration?: number;
}

export interface GuideResult {
  config: GuideConfig;
  originalBody: string;
  stepResults: StepResult[];
  screenshotDir: string;
  videoPath?: string;
}

// Semantic Index Types for RAG system
export interface SectionIndex {
  title: string;
  text: string;
  roles: string[];
  anchorSelectors: string[];
  embedding?: number[];
  position: { start: number; end: number }; // DOM position hints
}

export interface ElementIndex {
  label: string;
  role: string;
  selector: string;
  candidateSelectors: string[];
  section?: string;
  group?: string;
  visible: boolean;
  inViewport: boolean;
  activeTab: boolean;
  embedding?: number[];
  stability: 'high' | 'medium' | 'low';
  interactionType: 'click' | 'type' | 'both' | 'hidden';
}

export interface SemanticIndex {
  sections: SectionIndex[];
  elements: ElementIndex[];
  url: string;
  timestamp: number;
  fingerprint: string; // for cache invalidation
}

export interface QuerySpec {
  intent: 'navigate' | 'click' | 'type' | 'assert';
  keywords: string[];
  filters?: {
    role?: string[];
    attrs?: Record<string, string>;
    sectionHint?: string;
    negative?: string[];
  };
  constraints?: {
    mustBeVisible?: boolean;
    mustBeClickable?: boolean;
    language?: string;
  };
  k?: number; // max results
  diversity?: boolean; // apply diversity reranking
}

export interface EvidenceItem {
  id: string;
  label: string;
  role: string;
  snippet: string;
  selectorCandidates: string[];
  section?: string;
  score: number;
  type: 'section' | 'element';
}

export interface EvidencePack {
  items: EvidenceItem[];
  query: QuerySpec;
  totalItems: number;
  searchLatencyMs: number;
}

// Session lifecycle events
export type SessionEvent = 
  | { type: 'session_created'; sessionId: string; scriptId?: string; timestamp: Date }
  | { type: 'session_started'; sessionId: string; scriptId?: string }
  | { type: 'session_completed'; sessionId: string; scriptId?: string; success: boolean }
  | { type: 'session_failed'; sessionId: string; scriptId?: string; error: string }
  | { type: 'session_cancelled'; sessionId: string; scriptId?: string };

// Script execution events (for run sessions)
export type RunEvent = 
  // Preparation
  | { type: 'script_loaded'; sessionId: string; scriptId: string; totalSteps: number; config: GuideConfig }
  | { type: 'config_validated'; sessionId: string; config: GuideConfig }
  
  // Execution
  | { type: 'step_started'; sessionId: string; stepIndex: number; step: StepAction }
  | { type: 'step_progress'; sessionId: string; stepIndex: number; message: string }
  | { type: 'step_completed'; sessionId: string; stepIndex: number; duration: number; result: StepResult }
  | { type: 'step_failed'; sessionId: string; stepIndex: number; error: string; canRetry: boolean }
  
  // Artifacts
  | { type: 'screenshot_captured'; sessionId: string; stepIndex: number; path: string; step: StepAction }
  | { type: 'dom_snapshot_captured'; sessionId: string; stepIndex: number; path: string; step: StepAction }
  | { type: 'video_recording_started'; sessionId: string; path: string }
  | { type: 'video_recording_stopped'; sessionId: string; path: string; duration: number }
  
  // TTS Events
  | { type: 'tts_started'; sessionId: string; stepIndex: number; text: string; voice?: string }
  | { type: 'tts_completed'; sessionId: string; stepIndex: number; audioPath?: string; duration: number }
  
  // Results
  | { type: 'report_generated'; sessionId: string; report: GuideResult };

// Combined event stream for script execution
export type RunStreamEvent = SessionEvent | RunEvent;

// Session status interface
export interface SessionStatus {
  sessionId: string;  // Session ID (unique per execution/generation)
  scriptId?: string;  // Script ID (for run sessions, this is the script being executed)
  type: 'run' | 'prompt';
  status: 'created' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0-100
  currentStep?: number;
  totalSteps?: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}
