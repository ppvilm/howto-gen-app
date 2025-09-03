// Main exports for howto-prompt package
export { HowtoPrompt } from './api/howto-prompt';

// Core types
export type {
  HowtoPromptOptions,
  HowtoPromptResult,
  NoteFormat,
  PlanningContext,
  StepExecutionResult,
  PromptEvent,
  PromptStreamEvent,
  LLMProvider
} from './core/types';

// Core components
// Memory and NoteBuilder removed in DOM+LLM-only mode

// UI graph/heuristics disabled in DOM+LLM mode

// Planning
export { StepPlanner } from './planner/step-planner';

// Execution
export { StepExecutor } from './executor/step-executor';

// Refinement
// StepRefiner removed in DOM+LLM-only mode

// Subgoal System (new)
export { SubgoalOrchestrator } from './orchestrator/subgoal-orchestrator';
export type * from './core/subgoal-types';

// Re-export relevant types from howto-core for convenience
export type { StepAction, StepResult, GuideConfig } from 'howto-core';

// TTS Enhancer (decoupled)
export { TTSEnhancer } from './tts/tts-enhancer';
