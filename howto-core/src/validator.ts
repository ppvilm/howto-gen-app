import { StepAction, GuideConfig } from './types';

export class StepValidator {
  static validateAndNormalizeSteps(steps: StepAction[]): StepAction[] {
    return steps.map((step, index) => {
      if (!step.type) {
        throw new Error(`Step ${index + 1}: Missing required field 'type'`);
      }

      if (!['goto', 'type', 'click', 'assert', 'assert_page', 'tts_start', 'tts_wait', 'keypress'].includes(step.type)) {
        throw new Error(`Step ${index + 1}: Invalid step type '${step.type}'. Must be one of: goto, type, click, assert, assert_page, tts_start, tts_wait, keypress`);
      }

      switch (step.type) {
        case 'goto':
          if (!step.url && !step.label) {
            throw new Error(`Step ${index + 1}: 'goto' step requires either 'url' or 'label'`);
          }
          // Default explicit wait after navigation to 1s if not provided
          if (step.waitMs === undefined) {
            (step as any).waitMs = 1000;
          }
          break;
        case 'type':
          if (!step.label) {
            throw new Error(`Step ${index + 1}: 'type' step requires 'label' to identify the input field`);
          }
          if (!step.value) {
            throw new Error(`Step ${index + 1}: 'type' step requires 'value' to specify what to type`);
          }
          break;
        case 'click':
          if (!step.label) {
            throw new Error(`Step ${index + 1}: 'click' step requires 'label' to identify the element to click`);
          }
          break;
        case 'assert':
          if (!step.label) {
            throw new Error(`Step ${index + 1}: 'assert' step requires 'label' to specify what to assert`);
          }
          break;
        case 'assert_page':
          if (!step.url && !step.label) {
            throw new Error(`Step ${index + 1}: 'assert_page' step requires either 'url' or 'label' to specify the expected page`);
          }
          break;
        case 'tts_start':
          if (!step.text) {
            throw new Error(`Step ${index + 1}: 'tts_start' step requires 'text' to specify what to speak`);
          }
          break;
        case 'tts_wait':
          // Enforce label for pairing with tts_start
          if (!step.label) {
            throw new Error(`Step ${index + 1}: 'tts_wait' step requires 'label' to pair with a 'tts_start'`);
          }
          break;
        case 'keypress':
          if (!step.key) {
            throw new Error(`Step ${index + 1}: 'keypress' step requires 'key' to specify which key to press`);
          }
          break;
      }

      return {
        ...step,
        sensitive: step.sensitive || false,
        timeout: step.timeout, // Preserve timeout value
        waitMs: step.waitMs, // Preserve (or defaulted) post-step wait
        screenshot: step.screenshot !== false, // Default to true unless explicitly false
        text: step.text, // Preserve TTS text
        voice: step.voice, // Preserve TTS voice
        key: step.key // Preserve keypress key
      };
    });
  }

  static validateConfig(config: GuideConfig): GuideConfig {
    const normalizedSteps = this.validateAndNormalizeSteps(config.steps);
    // Additional cross-step validation for TTS pairing
    this.validateTTSPairing(normalizedSteps);
    
    return {
      ...config,
      steps: normalizedSteps,
      language: config.language || 'en',
      outputDir: config.outputDir || 'dist',
      tags: config.tags || []
    };
  }

  private static validateTTSPairing(steps: StepAction[]): void {
    const errors: string[] = [];
    const startIndexByLabel = new Map<string, number>();
    const waitIndicesByLabel = new Map<string, number[]>();

    steps.forEach((step, index) => {
      if (step.type === 'tts_start') {
        if (!step.label) {
          errors.push(`Step ${index + 1}: 'tts_start' must include a 'label' to pair with 'tts_wait'`);
          return;
        }
        if (startIndexByLabel.has(step.label)) {
          errors.push(`Step ${index + 1}: duplicate 'tts_start' label "${step.label}" (already used at step ${startIndexByLabel.get(step.label)! + 1})`);
        } else {
          startIndexByLabel.set(step.label, index);
        }
      } else if (step.type === 'tts_wait') {
        if (!step.label) {
          errors.push(`Step ${index + 1}: 'tts_wait' must include a 'label' that matches a prior 'tts_start'`);
          return;
        }
        const arr = waitIndicesByLabel.get(step.label) || [];
        arr.push(index);
        waitIndicesByLabel.set(step.label, arr);
      }
    });

    // Ensure each tts_start has a later tts_wait with same label
    for (const [label, startIdx] of startIndexByLabel.entries()) {
      const waits = waitIndicesByLabel.get(label) || [];
      const hasLaterWait = waits.some(w => w > startIdx);
      if (!hasLaterWait) {
        errors.push(`Step ${startIdx + 1}: missing matching 'tts_wait' for label "${label}"`);
      }
    }

    // Ensure each tts_wait refers to a prior tts_start
    for (const [label, indices] of waitIndicesByLabel.entries()) {
      const startIdx = startIndexByLabel.get(label);
      if (startIdx === undefined) {
        for (const i of indices) {
          errors.push(`Step ${i + 1}: 'tts_wait' for label "${label}" has no preceding 'tts_start'`);
        }
        continue;
      }
      for (const i of indices) {
        if (i <= startIdx) {
          errors.push(`Step ${i + 1}: 'tts_wait' for label "${label}" occurs before its 'tts_start' (step ${startIdx + 1})`);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(`TTS pairing validation failed:\n - ${errors.join('\n - ')}`);
    }
  }
}
