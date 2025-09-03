import { PlaywrightRunner } from 'howto-core';
import { StepAction } from 'howto-core';
import { 
  HowtoPromptOptions, 
  HowtoPromptResult,
  PlanningContext,
  StepExecutionResult,
  PromptEvent,
  PlanningResult
} from '../core/types';
import * as readlineSync from 'readline-sync';
import * as path from 'path';

import { StepPlanner } from '../planner/step-planner';
import { StepExecutor } from '../executor/step-executor';
// Deleted provider imports - using StepPlanner directly
import { SubgoalOrchestrator } from '../orchestrator/subgoal-orchestrator';
import { MarkdownRenderer, getLLMManager } from 'howto-core';

export class HowtoPrompt {
  private options: HowtoPromptOptions;
  private runner: PlaywrightRunner | null = null;
  // Memory removed in DOM+LLM-only mode
  // UI graph/heuristics disabled
  private planner: StepPlanner | null = null;
  private executor: StepExecutor | null = null;
  private refiner: null = null;
  private subgoalOrchestrator: SubgoalOrchestrator | null = null;
  private eventCallbacks: Map<string, Function[]> = new Map();
  // Ensure verify-before-next-action behavior
  private pendingAssertUrl?: string;
  // Queue for user-defined step sequences
  private userDefinedSteps: StepAction[] = [];

  constructor(options: HowtoPromptOptions) {
    this.options = {
      maxSteps: 30,
      maxRefinesPerStep: 3,
      headless: true,
      outputDir: './output',
      timeout: 60000,
      strict: false,
      model: 'gemini-2.5-flash',
      language: 'en',
      interactive: false,
      onUserPrompt: this.defaultUserPrompt.bind(this),
      useSubgoals: true, // Standardmäßig aktiviert
      subgoalConfig: {
        maxSubgoals: 5,
        maxSubtasksPerSubgoal: 8,
        maxStepsPerSubtask: 30,
        maxRetriesPerSubtask: 3,
        fallbackToSteps: true
      },
      ...options
    };

    // No memory in DOM+LLM-only mode
    // UI graph/heuristics disabled
  }

  // Main goal (final goal, never changes)
  private mainGoal: string = '';
  // Current sub-goal (can be updated during execution)
  private currentSubGoal: string | null = null;

  // Get the effective goal for planning (sub-goal if active, otherwise main goal)
  private getEffectiveGoal(): string {
    if (this.currentSubGoal) {
      return `${this.currentSubGoal} (in order to achieve: ${this.mainGoal})`;
    }
    return this.mainGoal;
  }

  // Main generation method
  async generate(prompt: string): Promise<HowtoPromptResult> {
    this.mainGoal = prompt; // Set the final goal
    this.currentSubGoal = null; // No sub-goal initially
    const startTime = Date.now();
    const steps: StepAction[] = [];
    const logs: string[] = [];
    const errors: string[] = [];
    let screenshots: string[] = [];
    let videoPath: string | undefined;

    // Success criteria will be derived dynamically for each step

    try {
      // Initialize components
      await this.initialize();
      
      logs.push(`Starting howto-prompt generation for: "${prompt}"`);
      this.emit('goal_set', { prompt, objectives: [prompt] });

      // Navigate to base URL
      await this.navigateToBase();

      // Verwende nur noch das Subgoal-System
      if (!this.subgoalOrchestrator) {
        throw new Error('Subgoal orchestrator not initialized');
      }
      
      logs.push('Using subgoal-based execution');
      const result = await this.subgoalOrchestrator.execute(prompt);
      
      // Generate markdown after subgoal execution completes
      let markdown = '';
      if (result.success && result.steps.length > 0) {
        try {
          logs.push('Generating markdown guide with TTS enhancement...');
          markdown = await this.generateMarkdown(prompt, result.steps);
          logs.push('Markdown generation completed successfully');
        } catch (error) {
          logs.push(`Markdown generation failed, using simple fallback: ${error}`);
          // Fall back to simple markdown generation
          try {
            markdown = this.generateSimpleMarkdown(`Generated Guide: ${prompt}`, result.steps);
          } catch (fallbackError) {
            logs.push(`Simple markdown generation also failed: ${fallbackError}`);
            markdown = ''; // Last resort: empty markdown
          }
        }
      }
      
      return {
        success: result.success,
        markdown: markdown,
        steps: result.steps,
        report: {
          totalSteps: result.steps.length,
          successfulSteps: result.success ? result.steps.length : 0,
          refinements: 0,
          duration: Date.now() - startTime,
          screenshots: [],
          errors: []
        },
        logs: logs
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logs.push(`Fatal error: ${errorMessage}`);
      errors.push(errorMessage);

      return {
        success: false,
        markdown: '',
        steps,
        report: {
          totalSteps: 0,
          successfulSteps: 0,
          refinements: 0,
          duration: Date.now() - startTime,
          screenshots: [],
          errors
        },
        logs
      };
    } finally {
      await this.cleanup();
    }
  }

  // Initialize all components
  private async initialize(): Promise<void> {
    // Create a placeholder LLM provider for StepPlanner (it uses LLM Manager directly now)
    const llmProvider = {
      planNextStep: async () => { throw new Error('Use StepPlanner methods directly'); },
      planNextStepWithConfidence: async () => { throw new Error('Use StepPlanner methods directly'); },
      refineStep: async () => { throw new Error('Use StepPlanner methods directly'); },
      analyzeGoalProgress: async () => { throw new Error('Use StepPlanner methods directly'); }
    };

    // Initialize PlaywrightRunner
    this.runner = new PlaywrightRunner();
    await this.runner.initialize(
      !this.options.headless,
      false, // Video recording will be handled separately if needed
      path.join(this.options.outputDir!, 'video.mp4')
    );
    
    // Ensure AI resolver is available for LLM fallback
    const hasAIResolver = (this.runner as any).aiResolver;
    console.log(`[Init] AI Resolver available: ${!!hasAIResolver}`);
    if (!hasAIResolver) {
      console.warn('[Init] AI Resolver not available - LLM fallback will be disabled');
      console.warn('[Init] Set OPENAI_API_KEY or CLOUDFLARE_API_KEY to enable LLM fallback');
    } else {
      console.log('[Init] LLM fallback enabled for element finding');
    }

    // Initialize other components
    this.planner = new StepPlanner(llmProvider, this.options.secrets, this.options.variables, this.options);
    this.executor = new StepExecutor(this.runner, path.join(this.options.outputDir!, 'screenshots'), path.join(this.options.outputDir!, 'dom-snapshots'), this.options.secrets, this.options.variables, this.planner);
    // StepRefiner removed in DOM+LLM-only mode

    // Initialize Subgoal system if enabled
    if (this.options.useSubgoals) {
      if (this.planner && this.executor) {
        this.subgoalOrchestrator = new SubgoalOrchestrator(
          this.runner,
          this.planner,
          this.executor,
          (type: string, data: any) => {
            try { this.emit(type, data); } catch {}
          }
        );
        console.log('[Init] Subgoal orchestrator initialized');
      } else {
        console.warn('[Init] Subgoal system requested but could not be initialized, falling back to traditional mode');
        this.options.useSubgoals = false;
      }
    }
  }

  // Navigate to base URL
  private async navigateToBase(): Promise<void> {
    if (!this.runner) {
      throw new Error('Runner not initialized');
    }

    const gotoStep: StepAction = {
      type: 'goto',
      url: this.options.baseUrl,
      note: 'Navigate to base URL'
    };

    await this.runner.executeStep(gotoStep, 0, 
      { title: 'Initial Navigation', baseUrl: this.options.baseUrl, steps: [] },
      path.join(this.options.outputDir!, 'screenshots'),
      path.join(this.options.outputDir!, 'dom-snapshots')
    );
  }

  // DOM+URL+History mode - no inventory learning needed

  // Generate incremental markdown for live updates
  private async generateIncrementalMarkdown(prompt: string, steps: StepAction[]): Promise<string> {
    // For incremental updates, just return simple markdown without TTS processing
    const title = `Generated Guide: ${prompt}`;
    return this.generateSimpleMarkdown(title, steps);
  }

  // Generate final markdown guide (decoupled: no TTS enhancement here)
  private async generateMarkdown(prompt: string, steps: StepAction[]): Promise<string> {
    const title = `Generated Guide: ${prompt}`;
    // Return simple markdown only; external TTS enhancer may post-process
    return this.generateSimpleMarkdown(title, steps);
  }

  // Save markdown file to disk
  private async saveMarkdownFile(markdown: string): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const outputPath = path.join(this.options.outputDir!, 'generated-guide.md');
      
      // Ensure output directory exists
      await fs.mkdir(this.options.outputDir!, { recursive: true });
      
      // Write markdown file
      await fs.writeFile(outputPath, markdown, 'utf8');
      
    } catch (error) {
      console.warn('Failed to save markdown file:', error);
      throw error;
    }
  }

  // Simple markdown fallback with proper frontmatter
  private generateSimpleMarkdown(title: string, steps: StepAction[]): string {
    const timestamp = new Date().toISOString();
    const escapeYaml = (s: string) => s
      .replace(/\\/g, "\\\\")
      .replace(/\"/g, '\\"')
      .replace(/\n|\r/g, ' ')
      .trim();
    // Render YAML block scalar indented 2 spaces beyond step property indentation (total 6 spaces)
    const blockScalar = (s: string) => {
      const normalized = s.replace(/\r\n?/g, '\n');
      const indent = '      '; // 6 spaces to align under "    note: |"
      return ['|', ...normalized.split('\n').map(line => `${indent}${line}`)].join('\n');
    };
    const safeTitle = title.replace(/\s+/g, ' ').trim();
    // Ensure first step navigates to a page (howto-cli starts from about:blank)
    const stepsForFrontmatter: StepAction[] =
      steps.length > 0 && steps[0].type === 'goto'
        ? steps
        : ([{ type: 'goto', url: this.options.baseUrl, note: 'Navigate to base URL', screenshot: true } as StepAction, ...steps]);

    const lines = [
      '---',
      `title: "${escapeYaml(safeTitle)}"`,
      `baseUrl: "${this.options.baseUrl}"`,
      `generated: ${timestamp}`,
      `totalSteps: ${stepsForFrontmatter.length}`,
      'recordVideo: true',
      'steps:',
      ...stepsForFrontmatter.map((step) => {
        const stepLines = [`  - type: ${step.type}`];
        if (step.label) stepLines.push(`    label: "${escapeYaml(step.label)}"`);
        if (step.value) stepLines.push(`    value: "${escapeYaml(step.value)}"`);
        if (step.url) stepLines.push(`    url: "${escapeYaml(step.url)}"`);
        if (step.sensitive) stepLines.push(`    sensitive: ${step.sensitive}`);
        if (step.waitMs) stepLines.push(`    waitMs: ${step.waitMs}`);
        if ((step as any).text) stepLines.push(`    text: "${escapeYaml((step as any).text)}"`);
        if ((step as any).key) stepLines.push(`    key: "${escapeYaml((step as any).key)}"`);
        stepLines.push(`    screenshot: true`);
        if (step.note) {
          stepLines.push(`    note: ${blockScalar(step.note)}`);
        }
        return stepLines.join('\n');
      }),
      `language: "${this.options.language}"`,
      `outputDir: "generated-guides"`,
      '---',
      '',
      `# ${title}`,
      '',
      '## Overview',
      '',
      `This guide was automatically generated from the prompt: "${title.replace('Generated Guide: ', '')}"`,
      '',
      '## Steps',
      '',
      '<!-- STEPS:AUTOGENERATED -->',
      ''
    ];

    steps.forEach((step, index) => {
      lines.push(`### Step ${index + 1}: ${this.getStepDescription(step)}`);
      lines.push('');
      if (step.note) {
        lines.push('**Context:**');
        step.note.split('\n').forEach(line => {
          lines.push(line ? `> ${line}` : '>');
        });
        lines.push('');
      }
      lines.push(`- **Action:** \`${step.type}\``);
      if (step.label) lines.push(`- **Target:** "${step.label}"`);
      if (step.value && !step.sensitive) lines.push(`- **Value:** "${step.value}"`);
      if (step.value && step.sensitive) lines.push(`- **Value:** [HIDDEN - sensitive data]`);
      if (step.url) lines.push(`- **URL:** ${step.url}`);
      if (step.waitMs) lines.push(`- **Wait:** ${step.waitMs}ms`);
      if ((step as any).key) lines.push(`- **Key:** "${(step as any).key}"`);
      lines.push('');
    });

    lines.push('## Summary');
    lines.push('');
    lines.push(`Generated ${steps.length} steps successfully.`);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('🤖 *Generated with [howto-prompt](https://github.com/your-org/howto-prompt)*');

    return lines.join('\n');
  }

  // Enhance markdown with TTS steps using LLM Manager
  private async enhanceWithTTSSteps(markdown: string, steps: StepAction[], prompt?: string): Promise<string> {
    try {
      console.log('[TTS Enhancement] Starting TTS enhancement process...');
      
      // Use LLM Manager for TTS enhancement
      const llmManager = getLLMManager();
      
      console.log('[TTS Enhancement] LLM Manager available, calling TTS enhancement...');
      
      const responseText = await llmManager.executeTTSEnhancement(steps, prompt, this.options.language);
      console.log('[TTS Enhancement] LLM response received:', responseText.substring(0, 200) + '...');
      
      // Parse LLM response and enhance the original markdown
      const enhancedMarkdown = await this.applyTTSSuggestions(markdown, responseText, steps, prompt);
      console.log('[TTS Enhancement] Enhancement completed successfully');
      return enhancedMarkdown;
    } catch (error) {
      console.log('[TTS Enhancement] LLM provider not available or generateText method missing');
      console.warn('Failed to enhance with TTS steps:', error);
      
      // Try to at least inject intro TTS
      try {
        const title = this.extractTitleFromMarkdown(markdown);
        const stepsWithIntro = await this.insertIntroTTSAfterFirstGoto(steps, prompt);
        const introInjected = this.generateSimpleMarkdownWithSteps(title, stepsWithIntro);
        return introInjected;
      } catch {
        return markdown; // Return original markdown on error
      }
    }
  }

  // Apply TTS suggestions to the markdown
  private async applyTTSSuggestions(markdown: string, llmResponse: string, originalSteps: StepAction[], prompt?: string): Promise<string> {
    try {
      console.log('[TTS Enhancement] Parsing LLM response...');
      // Parse the LLM response to extract TTS suggestions
      const ttsSteps = this.parseTTSSteps(llmResponse);
      console.log('[TTS Enhancement] Parsed TTS steps:', ttsSteps);
      
      if (ttsSteps.length === 0) {
        console.log('[TTS Enhancement] No TTS steps found, returning original markdown');
        return markdown;
      }

      // Merge original steps with TTS steps based on position hints
      let mergedSteps = this.mergeTTSSteps(originalSteps, ttsSteps);
      // Ensure each tts_start has a matching tts_wait with the same label
      mergedSteps = this.enforceTTSPairs(mergedSteps);
      // Ensure an intro narration appears after the first goto
      mergedSteps = await this.insertIntroTTSAfterFirstGoto(mergedSteps, prompt);
      console.log('[TTS Enhancement] Merged steps count:', mergedSteps.length);
      
      // Regenerate the markdown with the merged steps
      const title = this.extractTitleFromMarkdown(markdown);
      const enhancedMarkdown = this.generateSimpleMarkdownWithSteps(title, mergedSteps);
      
      console.log('[TTS Enhancement] Generated enhanced markdown with TTS steps');
      return enhancedMarkdown;
    } catch (error) {
      console.warn('Failed to apply TTS suggestions:', error);
      return markdown;
    }
  }

  // Ensure intro TTS is placed after the first goto (goto first)
  private async insertIntroTTSAfterFirstGoto(steps: StepAction[], prompt?: string): Promise<StepAction[]> {
    const result = [...steps];
    const introLabelBase = 'intro_auto';
    const gotoIdx = result.findIndex(s => s.type === 'goto');
    // Gather/relocate existing intro
    let introStartStep: any | undefined;
    let introWaitStep: any | undefined;
    const idxStart = result.findIndex(s => s.type === 'tts_start' && s.label && s.label.startsWith(introLabelBase));
    if (idxStart >= 0) {
      introStartStep = result.splice(idxStart, 1)[0];
      const idxWait = result.findIndex((s, idx) => idx > idxStart && s.type === 'tts_wait' && s.label === (introStartStep as any).label);
      if (idxWait > -1) {
        const adj = idxWait > idxStart ? idxWait - 1 : idxWait;
        introWaitStep = result.splice(adj, 1)[0];
      }
    } else {
      const introText = await this.buildIntroText(prompt || '');
      introStartStep = { type: 'tts_start', label: `${introLabelBase}`, text: introText, screenshot: false } as StepAction;
      introWaitStep = { type: 'tts_wait', label: `${introLabelBase}`, screenshot: false } as StepAction;
    }
    if (gotoIdx >= 0) {
      result.splice(gotoIdx + 1, 0, introStartStep);
      result.splice(gotoIdx + 2, 0, introWaitStep);
      return result;
    }
    // No goto yet; prepend intro; builder will add goto as first step later
    return [introStartStep, introWaitStep, ...result];
  }

  // Generate intro text using LLM Manager based on the user's prompt
  private async buildIntroText(prompt: string): Promise<string> {
    try {
      const clean = (prompt || '').trim();
      if (!clean) {
        return 'Welcome! In this tutorial, I will show you step by step how to complete this task efficiently.';
      }

      // Use LLM Manager to generate intro text
      try {
        const llmManager = getLLMManager();
        const response = await llmManager.execute('tts_enhancement', {
          prompt: `Create a friendly, concise intro text for a tutorial video about: "${clean}". 
          Keep it under 20 words, welcoming tone, and mention what the tutorial will show. 
          Start with "Welcome" and use present tense. 
          Respond in ${this.options.language} language.`,
          systemPrompt: 'You are a friendly tutorial narrator. Create a welcoming intro for a tutorial video. Respond with just the intro text, no other content.',
          maxTokens: 100
        });
        
        const generatedIntro = response.content?.trim();
        if (generatedIntro) {
          return generatedIntro;
        }
      } catch (llmError) {
        console.warn('Failed to generate intro text with LLM Manager:', llmError);
      }
      
      // Fallback if LLM is not available
      const compact = clean.replace(/\s+/g, ' ').replace(/[\.#:]+$/,'');
      return this.getFallbackIntroText(compact);
    } catch (error) {
      console.warn('Failed to generate intro text:', error);
      // Fallback to simple intro
      const compact = (prompt || '').trim().replace(/\s+/g, ' ').replace(/[\.#:]+$/,'');
      return this.getFallbackIntroText(compact);
    }
  }

  // Generate fallback intro text based on language
  private getFallbackIntroText(compact: string): string {
    const lang = this.options.language || 'en';
    
    const translations = {
      en: {
        withPrompt: (prompt: string) => `Welcome! In this tutorial, I'll show you how to "${prompt}" step by step.`,
        withoutPrompt: 'Welcome! In this tutorial, I will show you step by step how to complete this task efficiently.'
      },
      de: {
        withPrompt: (prompt: string) => `Willkommen! In diesem Tutorial zeige ich dir, wie du "${prompt}" Schritt für Schritt umsetzt.`,
        withoutPrompt: 'Willkommen! In diesem Tutorial zeige ich dir Schritt für Schritt, wie du diese Aufgabe effizient erledigst.'
      },
      fr: {
        withPrompt: (prompt: string) => `Bienvenue ! Dans ce tutoriel, je vais vous montrer comment "${prompt}" étape par étape.`,
        withoutPrompt: 'Bienvenue ! Dans ce tutoriel, je vais vous montrer étape par étape comment accomplir cette tâche efficacement.'
      },
      es: {
        withPrompt: (prompt: string) => `¡Bienvenido! En este tutorial, te mostraré cómo "${prompt}" paso a paso.`,
        withoutPrompt: '¡Bienvenido! En este tutorial, te mostraré paso a paso cómo completar esta tarea de manera eficiente.'
      }
    };

    const translation = translations[lang as keyof typeof translations] || translations.en;
    
    return compact ? 
      translation.withPrompt(compact) : 
      translation.withoutPrompt;
  }

  // Ensure every tts_start(label) has a matching tts_wait(label) that occurs after it
  private enforceTTSPairs(steps: StepAction[]): StepAction[] {
    const result: StepAction[] = [...steps];
    const startIndexByLabel = new Map<string, number>();
    const hasWaitAfterByLabel = new Map<string, boolean>();

    // Scan indexes
    for (let i = 0; i < result.length; i++) {
      const s = result[i];
      if (s.type === 'tts_start' && s.label) {
        startIndexByLabel.set(s.label, i);
        hasWaitAfterByLabel.set(s.label, false);
      } else if (s.type === 'tts_wait' && s.label) {
        const startIdx = startIndexByLabel.get(s.label);
        if (startIdx !== undefined && i > startIdx) {
          hasWaitAfterByLabel.set(s.label, true);
        }
      }
    }

    // Build insertions for missing waits
    const insertions: Array<{ index: number; step: StepAction }> = [];
    for (const [label, startIdx] of startIndexByLabel.entries()) {
      if (hasWaitAfterByLabel.get(label)) continue; // already paired

      // Find the next non-TTS step after start to place the wait after
      let insertAfter = startIdx;
      for (let j = startIdx + 1; j < result.length; j++) {
        if (result[j].type !== 'tts_start' && result[j].type !== 'tts_wait') {
          insertAfter = j; // place after this actionable step
          break;
        }
      }

      insertions.push({
        index: insertAfter + 1,
        step: { type: 'tts_wait', label, screenshot: false } as StepAction
      });
    }

    // Apply insertions in order
    insertions.sort((a, b) => a.index - b.index);
    let offset = 0;
    for (const ins of insertions) {
      result.splice(ins.index + offset, 0, ins.step);
      offset++;
    }

    return result;
  }

  // Parse TTS steps from LLM response
  private parseTTSSteps(response: string): Array<{position: 'before' | 'after', stepIndex: number, type: 'tts_start' | 'tts_wait', content?: string, waitMs?: number, label?: string}> {
    const ttsSteps: Array<{position: 'before' | 'after', stepIndex: number, type: 'tts_start' | 'tts_wait', content?: string, waitMs?: number, label?: string}> = [];
    const lines = response.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Parse "Before step X: tts_start label=<id> "text"" (label optional for backward compatibility)
      const beforeMatch = trimmed.match(/^-?\s*Before step (\d+):\s*tts_start(?:\s+label=([A-Za-z0-9._-]+))?\s*"([^"]+)"/);
      if (beforeMatch) {
        const stepIndex = parseInt(beforeMatch[1]) - 1; // Convert to 0-based
        const label = beforeMatch[2];
        const content = beforeMatch[3];
        ttsSteps.push({position: 'before', stepIndex, type: 'tts_start', content, label});
        continue;
      }
      
      // Parse "After step X: tts_start label=<id> "text""
      const afterStartMatch = trimmed.match(/^-?\s*After step (\d+):\s*tts_start(?:\s+label=([A-Za-z0-9._-]+))?\s*"([^"]+)"/);
      if (afterStartMatch) {
        const stepIndex = parseInt(afterStartMatch[1]) - 1; // Convert to 0-based
        const label = afterStartMatch[2];
        const content = afterStartMatch[3];
        ttsSteps.push({position: 'after', stepIndex, type: 'tts_start', content, label});
        continue;
      }
      
      // Parse "After step X: tts_wait label=<id> 2000" (label optional for backward compatibility)
      const waitMatch = trimmed.match(/^-?\s*After step (\d+):\s*tts_wait(?:\s+label=([A-Za-z0-9._-]+))?\s*(\d+)/);
      if (waitMatch) {
        const stepIndex = parseInt(waitMatch[1]) - 1; // Convert to 0-based
        const label = waitMatch[2];
        const waitMs = parseInt(waitMatch[3]);
        ttsSteps.push({position: 'after', stepIndex, type: 'tts_wait', waitMs, label});
        continue;
      }
    }
    
    return ttsSteps;
  }

  // Merge original steps with TTS steps
  private mergeTTSSteps(originalSteps: StepAction[], ttsSteps: Array<{position: 'before' | 'after', stepIndex: number, type: 'tts_start' | 'tts_wait', content?: string, waitMs?: number, label?: string}>): StepAction[] {
    const mergedSteps: StepAction[] = [];

    for (let i = 0; i < originalSteps.length; i++) {
      // Add TTS steps that should come BEFORE this step
      const beforeSteps = ttsSteps.filter(tts => tts.position === 'before' && tts.stepIndex === i);
      for (const ttsStep of beforeSteps) {
        if (ttsStep.type === 'tts_start' && ttsStep.content) {
          mergedSteps.push({
            type: 'tts_start',
            label: ttsStep.label, // preserve label from prompt
            text: ttsStep.content,
            screenshot: false
          } as StepAction);
        } else if (ttsStep.type === 'tts_wait' && ttsStep.waitMs) {
          mergedSteps.push({
            type: 'tts_wait',
            label: ttsStep.label, // preserve label from prompt
            waitMs: ttsStep.waitMs,
            screenshot: false
          } as StepAction);
        }
      }

      // Add the original step
      mergedSteps.push(originalSteps[i]);

      // Add TTS steps that should come AFTER this step
      const afterSteps = ttsSteps.filter(tts => tts.position === 'after' && tts.stepIndex === i);
      for (const ttsStep of afterSteps) {
        if (ttsStep.type === 'tts_start' && ttsStep.content) {
          mergedSteps.push({
            type: 'tts_start',
            label: ttsStep.label, // preserve label from prompt
            text: ttsStep.content,
            screenshot: false
          } as StepAction);
        } else if (ttsStep.type === 'tts_wait' && ttsStep.waitMs) {
          mergedSteps.push({
            type: 'tts_wait',
            label: ttsStep.label, // preserve label from prompt
            waitMs: ttsStep.waitMs,
            screenshot: false
          } as StepAction);
        }
      }
    }

    return mergedSteps;
  }

  // Extract title from existing markdown
  private extractTitleFromMarkdown(markdown: string): string {
    const titleMatch = markdown.match(/^title:\s*"([^"]+)"/m);
    return titleMatch ? titleMatch[1] : 'Generated Guide';
  }

  // Generate markdown with provided steps (instead of using this.options)
  private generateSimpleMarkdownWithSteps(title: string, steps: StepAction[]): string {
    const timestamp = new Date().toISOString();
    const escapeYaml = (s: string) => s
      .replace(/\\/g, "\\\\")
      .replace(/\"/g, '\\"')
      .replace(/\n|\r/g, ' ')
      .trim();
    
    const blockScalar = (s: string) => {
      const normalized = s.replace(/\r\n?/g, '\n');
      const indent = '      '; // 6 spaces to align under "    note: |"
      return ['|', ...normalized.split('\n').map(line => `${indent}${line}`)].join('\n');
    };
    
    const safeTitle = title.replace(/\s+/g, ' ').trim();
    
    // Ensure navigation is present without duplicating when TTS appears first
    const firstNonTTS = steps.findIndex((s: any) => s.type !== 'tts_start' && s.type !== 'tts_wait');
    const needsPrependGoto =
      firstNonTTS === -1 // no actionable steps
      || (firstNonTTS >= 0 && steps[firstNonTTS].type !== 'goto');
    const stepsForFrontmatter: StepAction[] = needsPrependGoto
      ? ([{ type: 'goto', url: this.options.baseUrl, note: 'Navigate to base URL', screenshot: true } as StepAction, ...steps])
      : steps;

    const lines = [
      '---',
      `title: "${escapeYaml(safeTitle)}"`,
      `baseUrl: "${this.options.baseUrl}"`,
      `generated: ${timestamp}`,
      `totalSteps: ${stepsForFrontmatter.length}`,
      'recordVideo: true',
      'steps:',
      ...stepsForFrontmatter.map((step) => {
        const stepLines = [`  - type: ${step.type}`];
        if (step.label) stepLines.push(`    label: "${escapeYaml(step.label)}"`);
        if (step.value) stepLines.push(`    value: "${escapeYaml(step.value)}"`);
        if (step.url) stepLines.push(`    url: "${escapeYaml(step.url)}"`);
        if (step.sensitive) stepLines.push(`    sensitive: ${step.sensitive}`);
        if (step.waitMs) stepLines.push(`    waitMs: ${step.waitMs}`);
        if ((step as any).text) stepLines.push(`    text: "${escapeYaml((step as any).text)}"`);
        if ((step as any).key) stepLines.push(`    key: "${escapeYaml((step as any).key)}"`);
        stepLines.push(`    screenshot: ${step.screenshot !== false}`);
        if (step.note) {
          stepLines.push(`    note: ${blockScalar(step.note)}`);
        }
        return stepLines.join('\n');
      }),
      `language: "${this.options.language}"`,
      `outputDir: "generated-guides"`,
      '---',
      '',
      `# ${title}`,
      '',
      '## Overview',
      '',
      `This guide was automatically generated from the prompt: "${title.replace('Generated Guide: ', '')}"`,
      '',
      '## Steps',
      '',
      '<!-- STEPS:AUTOGENERATED -->',
      ''
    ];

    // Generate step descriptions for body content
    let stepCounter = 0;
    steps.forEach((step) => {
      if (step.type === 'tts_start' || step.type === 'tts_wait') {
        // Skip TTS steps in the body content
        return;
      }
      
      stepCounter++;
      lines.push(`### Step ${stepCounter}: ${this.getStepDescription(step)}`);
      lines.push('');
      
      if (step.note) {
        lines.push('**Context:**');
        step.note.split('\n').forEach(line => {
          lines.push(line ? `> ${line}` : '>');
        });
        lines.push('');
      }
      
      lines.push(`- **Action:** \`${step.type}\``);
      if (step.label) lines.push(`- **Target:** "${step.label}"`);
      if (step.value && !step.sensitive) lines.push(`- **Value:** "${step.value}"`);
      if (step.value && step.sensitive) lines.push(`- **Value:** [HIDDEN - sensitive data]`);
      if (step.url) lines.push(`- **URL:** ${step.url}`);
      if (step.waitMs) lines.push(`- **Wait:** ${step.waitMs}ms`);
      if ((step as any).key) lines.push(`- **Key:** "${(step as any).key}"`);
      lines.push('');
    });

    lines.push('## Summary');
    lines.push('');
    lines.push(`Generated ${stepCounter} steps successfully.`);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('🤖 *Generated with [howto-prompt](https://github.com/your-org/howto-prompt)*');

    return lines.join('\n');
  }

  // Get human-readable step description
  private getStepDescription(step: StepAction): string {
    switch (step.type) {
      case 'goto':
        return `Navigate to ${step.url}`;
      case 'type':
        return `Enter ${step.sensitive ? 'sensitive data' : `"${step.value}"`} in ${step.label}`;
      case 'click':
        return `Click ${step.label}`;
      case 'assert_page':
        return `Verify page is ${step.url}`;
      default:
        return step.type;
    }
  }

  // Count refinement attempts from logs
  private countRefinements(logs: string[]): number {
    return logs.filter(log => log.includes('Refining with strategy')).length;
  }

  // Event emitter functionality
  on(event: string, callback: Function): void {
    if (!this.eventCallbacks.has(event)) {
      this.eventCallbacks.set(event, []);
    }
    this.eventCallbacks.get(event)!.push(callback);
  }

  private emit(event: string, data: any): void {
    const callbacks = this.eventCallbacks.get(event) || [];
    callbacks.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.warn(`Error in event callback for ${event}:`, error);
      }
    });
  }

  // Cleanup resources
  private async cleanup(): Promise<void> {
    if (this.runner) {
      await this.runner.close();
    }
  }

  // Stream version for real-time updates
  async *generateStream(prompt: string): AsyncGenerator<PromptEvent, HowtoPromptResult> {
    const events: PromptEvent[] = [];
    
    // Capture events
    this.on('goal_set', (data: any) => events.push({ type: 'goal_set', ...data }));
    this.on('step_planning', (data: any) => events.push({ type: 'step_planning', ...data }));
    this.on('step_planned', (data: any) => events.push({ type: 'step_planned', ...data }));
    this.on('step_executing', (data: any) => events.push({ type: 'step_executing', ...data }));
    this.on('step_executed', (data: any) => events.push({ type: 'step_executed', ...data }));
    this.on('step_failed', (data: any) => events.push({ type: 'step_failed', ...data }));
    this.on('step_refinement_started', (data: any) => events.push({ type: 'step_refinement_started', ...data }));
    this.on('step_refined', (data: any) => events.push({ type: 'step_refined', ...data }));
    this.on('validation_performed', (data: any) => events.push({ type: 'validation_performed', ...data }));
    this.on('goal_progress', (data: any) => events.push({ type: 'goal_progress', ...data }));
    this.on('completed', (data: any) => events.push({ type: 'completed', ...data }));

    // Start generation in background
    const resultPromise = this.generate(prompt);
    
    // Yield events as they occur
    let lastEventIndex = 0;
    while (true) {
      // Yield any new events
      while (lastEventIndex < events.length) {
        yield events[lastEventIndex++];
      }
      
      // Check if generation is complete
      if (await this.isPromiseResolved(resultPromise)) {
        break;
      }
      
      // Brief pause before checking for new events
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Return final result
    return await resultPromise;
  }

  // Helper to check if promise is resolved
  private async isPromiseResolved(promise: Promise<any>): Promise<boolean> {
    try {
      await Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject('timeout'), 0))
      ]);
      return true;
    } catch {
      return false;
    }
  }

  // DOM+URL+History mode - inventory system completely removed

  // Default user prompt implementation using readline-sync
  private async defaultUserPrompt(question: string, options?: string[]): Promise<string> {
    console.log('\n🤔 ' + question);
    
    if (options && options.length > 0) {
      console.log('\nAvailable options:');
      options.forEach((option, index) => {
        console.log(`  ${index + 1}. ${option}`);
      });
      console.log(`  ${options.length + 1}. Custom input`);
      
      const choice = readlineSync.questionInt('\nSelect an option (number): ', {
        min: 1,
        max: options.length + 1
      });
      
      if (choice <= options.length) {
        return options[choice - 1];
      } else {
        return readlineSync.question('Enter custom input: ');
      }
    } else {
      return readlineSync.question('Your answer: ');
    }
  }

  // DOM+URL+History mode - interactive step handling removed
  private async handleInteractiveStep(context: PlanningContext, planningResult: PlanningResult): Promise<StepAction> {
    // Interactive mode requires inventory system which has been removed
    // Return the suggested step directly
    return planningResult.step;
  }

  // DOM+URL+History mode - interactive helper methods removed (inventory system no longer available)

}
