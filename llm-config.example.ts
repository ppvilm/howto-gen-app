import { LLMTaskConfig } from 'howto-core';

// Example LLM Configuration
// Copy this file to llm-config.ts and customize for your needs

export const customLLMConfig: LLMTaskConfig = {
  // Use Claude 3.5 Sonnet for all tasks (high performance)
  rag_query_generation: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 300
  },

  step_planning: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 500,
    temperature: 0.1
  },

  evidence_planning: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 300,
    temperature: 0.1
  },

  step_refinement: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 200,
    temperature: 0.2
  },

  goal_analysis: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 150,
    temperature: 0.1
  },

  subgoal_planning: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 1000,
    temperature: 0.1
  },

  selector_resolution: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 2000,
    temperature: 0.0
  },

  success_criteria_check: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 400,
    temperature: 0.1
  },

  task_replanning: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 600,
    temperature: 0.3
  },

  secret_mapping: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 400,
    temperature: 0.0
  },

  variable_mapping: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 400,
    temperature: 0.0
  }
};

// Alternative configuration for cost optimization
export const costOptimizedConfig: LLMTaskConfig = {
  // Use Llama for simple tasks, Sonnet for complex ones
  rag_query_generation: {
    provider: 'cloudflare',
    model: '@cf/meta/llama-3.1-70b-instruct',
    maxTokens: 300
  },

  step_planning: {
    provider: 'cloudflare',
    model: '@cf/meta/llama-3.1-70b-instruct',
    maxTokens: 500
  },

  evidence_planning: {
    provider: 'cloudflare',
    model: '@cf/meta/llama-3.1-70b-instruct',
    maxTokens: 300
  },

  // Use Claude 3.5 Sonnet for the most complex tasks
  subgoal_planning: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 1000,
    temperature: 0.1
  },

  selector_resolution: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 2000,
    temperature: 0.0
  }
};

// Alternative configuration for maximum performance
export const performanceConfig: LLMTaskConfig = {
  // Use Claude 3.5 Sonnet for everything (best results)
  rag_query_generation: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 300,
    temperature: 0.1
  },

  step_planning: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 500,
    temperature: 0.1
  },

  subgoal_planning: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 1000,
    temperature: 0.1
  },

  selector_resolution: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 2000,
    temperature: 0.0
  }
};