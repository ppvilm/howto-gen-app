// Main SDK exports - thin wrappers around howto-core and howto-prompt
export { Markdown } from './markdown';
export { Prompt } from './prompt';
export { TTS } from './tts';

// Export new types
export type { MarkdownRunOptions, MarkdownResult } from './markdown';
export type { PromptGenerateOptions, PromptResult, PromptStreamEventCombined } from './prompt';
export type { TTSEnhanceScriptOptions } from './tts';

// Re-export types from core and prompt packages
export type { 
  StepAction, 
  GuideConfig, 
  GuideResult, 
  StepResult,
  GenerateOptions,
  SessionMetadata,
  WorkspaceConfig,
  // New async types
  SessionEvent,
  RunEvent,
  RunStreamEvent,
  SessionStatus
} from 'howto-core';

export type {
  HowtoPromptResult,
  PromptEvent,
  PromptStreamEvent,
  HowtoPromptOptions
} from 'howto-prompt';
