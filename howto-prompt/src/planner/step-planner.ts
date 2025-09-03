import { StepAction, SecretsManager, VariablesManager } from 'howto-core';
import { 
  PlanningContext, 
  LLMProvider, 
  PlanningResult,
  HowtoPromptOptions
} from '../core/types';
import {
  Subgoal,
  Subtask,
  SubgoalPlanningContext,
  SubtaskPlanningContext,
  SubgoalPlanningResult,
  SubtaskPlanningResult,
  GoalWithTasksResult,
  SubgoalLLMProvider
} from '../core/subgoal-types';
import { SecretResolver } from '../providers/secret-resolver';
import { VariableResolver } from '../providers/variable-resolver';

export class StepPlanner implements SubgoalLLMProvider {
  private secretsManager?: SecretsManager;
  private secretResolver?: SecretResolver | null;
  private secretMapCache: Map<string, Record<string, string>> = new Map();
  private variablesManager?: VariablesManager;
  private variableResolver?: VariableResolver | null;
  private varMapCache: Map<string, Record<string, string>> = new Map();

  constructor(
    llmProvider: LLMProvider, 
    secrets?: Record<string, any>, 
    variables?: Record<string, any>,
    options?: Partial<HowtoPromptOptions>
  ) {
    this.secretsManager = secrets ? new SecretsManager(secrets) : undefined;
    this.variablesManager = variables ? new VariablesManager(variables) : undefined;
    
    const strategy = (process.env.SECRETS_STRATEGY || 'hybrid').toLowerCase();
    if (strategy !== 'heuristic') {
      this.secretResolver = SecretResolver.create();
      this.variableResolver = VariableResolver.create();
    } else {
      this.secretResolver = null;
      this.variableResolver = null;
    }

    console.log('[StepPlanner] Using DOM+URL+History Planning');
  }

  // Compress base64 image data to reduce LLM token usage
  private async compressBase64Image(base64Data: string, mediaType: string, quality: number = 0.6): Promise<string> {
    try {
      // Always compress images for API compatibility - even small images can exceed API limits
      console.log(`📸 [StepPlanner] Compressing image (${base64Data.length} chars)`);
      
      // Skip compression only for very tiny images that are definitely safe
      if (base64Data.length < 1000) {
        console.log(`📸 [StepPlanner] Image extremely small (${base64Data.length} chars), using original`);
        return base64Data;
      }

      // Try to import and use Sharp for compression
      const sharp = await import('sharp').catch(() => null);
      if (!sharp) {
        console.warn('📸 [StepPlanner] Sharp not available, using fallback compression');
        return this.compressImageFallback(base64Data);
      }

      const buffer = Buffer.from(base64Data, 'base64');
      
      // Get configuration from environment or use defaults
      const targetWidth = parseInt(process.env.LLM_IMAGE_MAX_WIDTH || '800');
      const targetHeight = parseInt(process.env.LLM_IMAGE_MAX_HEIGHT || '600');
      const configQuality = parseFloat(process.env.LLM_IMAGE_QUALITY || '0.6');
      const jpegQuality = Math.round(configQuality * 100);
      
      // Adaptive quality based on original size - lower quality for larger images
      const originalSizeKB = Math.round(base64Data.length * 0.75 / 1024);
      let adaptiveQuality = jpegQuality;
      if (originalSizeKB > 500) {
        adaptiveQuality = Math.max(40, jpegQuality - 20); // Reduce quality for very large images
      } else if (originalSizeKB > 200) {
        adaptiveQuality = Math.max(50, jpegQuality - 10); // Slightly reduce quality for large images
      }
      
      let compressedBuffer: Buffer;
      if (mediaType === 'image/jpeg') {
        compressedBuffer = await sharp.default(buffer)
          .jpeg({ quality: adaptiveQuality, progressive: true, mozjpeg: true })
          .resize(targetWidth, targetHeight, { fit: 'inside', withoutEnlargement: true })
          .toBuffer();
      } else {
        // Convert PNG to JPEG for better compression (loses transparency but much smaller)
        compressedBuffer = await sharp.default(buffer)
          .jpeg({ quality: adaptiveQuality, progressive: true, mozjpeg: true })
          .resize(targetWidth, targetHeight, { fit: 'inside', withoutEnlargement: true })
          .toBuffer();
      }
      
      const compressedBase64 = compressedBuffer.toString('base64');
      const originalSize = Math.round(base64Data.length * 0.75 / 1024); // Approximate KB
      const compressedSize = Math.round(compressedBase64.length * 0.75 / 1024); // Approximate KB
      const compressionRatio = (1 - compressedBase64.length / base64Data.length) * 100;
      
      console.log(`📸 [StepPlanner] Image compressed: ${originalSize}KB → ${compressedSize}KB (${compressionRatio.toFixed(1)}% reduction, quality: ${adaptiveQuality}%)`);
      
      return compressedBase64;
    } catch (error) {
      console.warn('📸 [StepPlanner] Sharp compression failed, using fallback:', error);
      return this.compressImageFallback(base64Data);
    }
  }

  // Fallback compression without Sharp (basic resizing using Canvas)
  private async compressImageFallback(base64Data: string): Promise<string> {
    try {
      // In Node.js environment, we can't use Canvas API directly
      // Just apply basic optimizations without image processing
      const originalSize = Math.round(base64Data.length * 0.75 / 1024);
      console.log(`📸 [StepPlanner] Fallback compression - no resizing applied (${originalSize}KB)`);
      
      // Remove any whitespace/newlines to minimize size
      const cleanedData = base64Data.replace(/\s+/g, '');
      const cleanedSize = Math.round(cleanedData.length * 0.75 / 1024);
      
      if (cleanedSize < originalSize) {
        console.log(`📸 [StepPlanner] Cleaned base64 data: ${originalSize}KB → ${cleanedSize}KB`);
        return cleanedData;
      }
      
      return base64Data;
    } catch (error) {
      console.warn('📸 [StepPlanner] Fallback compression failed:', error);
      return base64Data;
    }
  }

  // Robustly extract base64 image data + media type from various inputs
  // Accepts: data URLs (with extra params/whitespace), file paths, or raw base64 strings
  private async extractImageAttachment(input: string): Promise<{ data: string; mediaType: string } | null> {
    try {
      if (!input || typeof input !== 'string') return null;

      let mediaType = 'image/png';
      let data: string | undefined;

      // Case 1: data URL (tolerant parsing)
      if (input.startsWith('data:')) {
        // data:[<mediatype>][;base64],<data>
        const commaIdx = input.indexOf(',');
        if (commaIdx > 0) {
          const meta = input.substring(5, commaIdx); // after 'data:'
          const payload = input.substring(commaIdx + 1);

          // media type is before first ';' if present
          const semiIdx = meta.indexOf(';');
          const mime = semiIdx >= 0 ? meta.substring(0, semiIdx) : meta;
          if (mime) mediaType = mime.trim();

          // If it's marked as base64 OR looks like base64, accept it
          const isB64 = /;?base64/i.test(meta) || /^[A-Za-z0-9+/=\r\n]+$/.test(payload);
          data = isB64 ? payload.replace(/\s+/g, '') : undefined;
        }

        if (data) {
          const compressedData = await this.compressBase64Image(data, mediaType);
          return { data: compressedData, mediaType: mediaType === 'image/png' ? 'image/jpeg' : mediaType };
        }
        console.warn('Invalid data URL format for screenshot, attempting recovery by extracting after base64,');
        const base64Match = input.match(/base64,([A-Za-z0-9+/=\r\n]+)/i);
        if (base64Match) {
          const data = base64Match[1].replace(/\s+/g, '');
          const compressedData = await this.compressBase64Image(data, mediaType);
          return { data: compressedData, mediaType: mediaType === 'image/png' ? 'image/jpeg' : mediaType };
        }
        return null;
      }

      // Case 2: looks like a file path
      if (input.includes('/') || input.includes('\\')) {
        try {
          const fs = await import('fs/promises');
          const buf = await fs.readFile(input);
          data = buf.toString('base64');
          const lower = input.toLowerCase();
          if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mediaType = 'image/jpeg';
          else if (lower.endsWith('.png')) mediaType = 'image/png';
          const compressedData = await this.compressBase64Image(data, mediaType);
          return { data: compressedData, mediaType: mediaType === 'image/png' ? 'image/jpeg' : mediaType };
        } catch (e) {
          console.warn('Failed to read screenshot file, treating as base64 string:', e);
          // fall through to treat as raw base64
        }
      }

      // Case 3: assume raw base64 image data
      data = input.replace(/\s+/g, '');
      // rudimentary base64 validation, but still pass through to allow provider-side validation
      if (/^[A-Za-z0-9+/=]+$/.test(data)) {
        const compressedData = await this.compressBase64Image(data, mediaType);
        return { data: compressedData, mediaType: mediaType === 'image/png' ? 'image/jpeg' : mediaType };
      }
      return null;
    } catch (e) {
      console.warn('extractImageAttachment failed:', e);
      return null;
    }
  }

  // Plan exactly ONE next step based on current context
  async planOneStep(context: PlanningContext): Promise<StepAction> {
    const result = await this.planOneStepWithConfidence(context);
    return result.step;
  }

  // Plan exactly ONE next step with confidence score
  async planOneStepWithConfidence(context: PlanningContext): Promise<PlanningResult> {
    const startTime = Date.now();
    console.log('🔍 [StepPlanner] planOneStepWithConfidence (DOM+URL+History only)');
    
    // EXPLICIT SCREENSHOT LOGGING - SHOULD ALWAYS APPEAR
    console.log('=================== SCREENSHOT CHECK ===================');
    console.log('📸 [StepPlanner] Screenshot in context:', !!context.screenshot);
    console.log('📸 [StepPlanner] Context keys:', Object.keys(context));
    if (context.screenshot) {
      console.log('📸 [StepPlanner] Screenshot data type:', typeof context.screenshot);
      console.log('📸 [StepPlanner] Screenshot data length:', context.screenshot.length);
      const isDataUrl = context.screenshot.startsWith('data:');
      const isFilePath = context.screenshot.includes('/') || context.screenshot.includes('\\');
      const format = isDataUrl ? 'data URL' : isFilePath ? 'file path' : 'raw base64';
      console.log('📸 [StepPlanner] Screenshot format detected:', format);
      console.log('📸 [StepPlanner] First 100 chars:', context.screenshot.substring(0, 100));
    } else {
      console.log('📸 [StepPlanner] ❌ NO SCREENSHOT AVAILABLE FOR PLANNING');
    }
    console.log('==================================================');
    
    // Log previous step reasoning if available (no validation needed since checkSuccess now determines this)
    if (context.previousStepReasoning) {
      console.log('🔍 [StepPlanner] Previous step reasoning:', context.previousStepReasoning);
    }
    
    await this.ensureSecretMapping(context);
    await this.ensureVariableMapping(context);

    const enrichedContext: any = {
      ...context,
      secretsKeys: this.secretsManager ? this.secretsManager.getAllKeys() : [],
      varsKeys: this.variablesManager ? this.variablesManager.getAllKeys() : []
    };

    console.log('🎯 [StepPlanner] DOM-only planning');
    console.log(`📍 URL: ${context.currentUrl}`);
    
    const prompt = this.buildStepPlanningPrompt({
      prompt: context.prompt,
      currentUrl: context.currentUrl,
      cleanedDOM: context.cleanedDOM,
      stepHistory: context.stepHistory,
      secretsKeys: this.secretsManager ? this.secretsManager.getAllKeys() : [],
      varsKeys: this.variablesManager ? this.variablesManager.getAllKeys() : []
    });
    
    console.log('🔤 [StepPlanner] Prompt from planOneStepWithConfidence:');
    console.log(prompt);
    
    const { getLLMManager } = await import('howto-core');
    const llmManager = getLLMManager();
    
    // Build LLM request with optional screenshot
    const llmRequest: any = { 
      prompt,
      systemPrompt: "You are a web automation expert. Respond with ONLY valid JSON. No explanations, no reasoning, no additional text. Your entire response must be only the requested JSON object."
    };
    
    // Include screenshot if available
    if (context.screenshot) {
      console.log('📸 [StepPlanner] Processing screenshot for LLM request...');
      const attachment = await this.extractImageAttachment(context.screenshot);
      if (attachment) {
        llmRequest.images = [{ data: attachment.data, mediaType: attachment.mediaType }];
        console.log(`📸 [StepPlanner] ✅ Screenshot WILL BE SENT to LLM:`);
        console.log(`📸 [StepPlanner]   - Media type: ${attachment.mediaType}`);
        console.log(`📸 [StepPlanner]   - Data size: ${attachment.data.length} characters`);
        console.log(`📸 [StepPlanner]   - Estimated size: ~${Math.round(attachment.data.length * 0.75 / 1024)} KB`);
      } else {
        console.warn('📸 [StepPlanner] ⚠️ Screenshot extraction FAILED - continuing without image');
        console.warn('📸 [StepPlanner] No image will be sent to LLM');
      }
    } else {
      console.log('📸 [StepPlanner] No screenshot in context - LLM request will be text-only');
    }
    
    const response = await llmManager.execute('step_planning', llmRequest);
    
    console.log('🤖 [StepPlanner] LLM Response:', {
      content: response.content,
      model: response.model,
      provider: response.provider,
      tokens: response.tokens
    });
    
    const planningResult = this.parseStepPlanningResult(response.content);
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log('📋 [StepPlanner] Parsed Result:', planningResult);
    console.log(`⏱️ [StepPlanner] Response Time: ${duration}ms`);

    const enhancedStep = this.autoInjectSecrets(planningResult.step, context);
    const injectedStep = this.autoInjectVariables(enhancedStep, context);

    const note = `Planned from DOM at ${context.currentUrl}`;
    return { 
      ...planningResult, 
      step: { ...injectedStep, note }
    };
  }

  // SubgoalLLMProvider Interface Implementation - Only Combined Planning
  async planCurrentGoalWithTasks(context: SubgoalPlanningContext): Promise<GoalWithTasksResult> {
    const enrichedContext = {
      ...context,
      secretsKeys: this.secretsManager ? this.secretsManager.getAllKeys() : [],
      varsKeys: this.variablesManager ? this.variablesManager.getAllKeys() : []
    };

    const { getLLMManager } = await import('howto-core');
    const llmManager = getLLMManager();

    const prompt = this.buildCombinedGoalWithTasksPrompt({
      goalIntent: enrichedContext.goalIntent,
      currentUrl: enrichedContext.currentUrl,
      cleanedDOM: enrichedContext.cleanedDOM,
      secretsKeys: this.secretsManager ? this.secretsManager.getAllKeys() : [],
      varsKeys: this.variablesManager ? this.variablesManager.getAllKeys() : [],
      previousSubgoals: enrichedContext.previousSubgoals
    });
    
    const response = await llmManager.execute('combined_planning', { prompt });
    return this.parseCombinedGoalWithTasksResult(response.content);
  }


  async replanTask(
    failed: Subgoal | Subtask,
    error: string,
    context: SubgoalPlanningContext | SubtaskPlanningContext
  ): Promise<Subgoal | Subtask> {
    const prompt = this.buildReplanTaskPrompt(failed, error, context);
    const { getLLMManager } = await import('howto-core');
    const llmManager = getLLMManager();
    const response = await llmManager.execute('task_replanning', { prompt });
    return this.parseReplanTaskResult(response.content, failed);
  }

  // Auto-inject secret references for type steps that need them
  private autoInjectSecrets(step: StepAction, context: PlanningContext): StepAction {
    if (step.type !== 'type' || !this.secretsManager) {
      return step;
    }

    if (step.value && SecretsManager.isSecretPlaceholder(step.value)) {
      return step;
    }

    const needsValue = (typeof step.value !== 'string') ||
                      step.value === 'NEEDS_USER_INPUT' ||
                      step.value.trim() === '';

    if (needsValue && step.label) {
      const url = context.currentUrl;
      const map = this.secretMapCache.get(url);
      let mappedKey: string | undefined;
      if (map) {
        mappedKey = map[step.label];
        if (!mappedKey) {
          const entry = Object.entries(map).find(([label]) => label.toLowerCase() === step.label!.toLowerCase());
          mappedKey = entry?.[1];
        }
      }

      if (mappedKey) {
        console.log(`[AUTO-INJECT] Injecting {{secret.${mappedKey}}} for field "${step.label}"`);
        return {
          ...step,
          value: `{{secret.${mappedKey}}}`,
          sensitive: true
        };
      }
    }

    return step;
  }

  // Build secret mapping for current URL using LLM
  private async ensureSecretMapping(context: PlanningContext): Promise<void> {
    if (!this.secretsManager || !this.secretResolver) return;
    const url = context.currentUrl;
    if (this.secretMapCache.has(url)) return;

    try {
      const keys = this.secretsManager.getAllKeys();
      if (keys.length === 0) return;

      const labels: string[] = [];
      let hints: Record<string, string | undefined> = {};
      const anyMgr: any = this.secretsManager as any;
      if (typeof anyMgr.getAllContexts === 'function') {
        hints = anyMgr.getAllContexts();
      } else {
        for (const k of keys) hints[k] = undefined;
      }

      if (labels.length === 0) return;

      const mapping = await this.secretResolver.resolveMapping({
        url,
        fieldLabels: labels,
        secretKeys: keys,
        secretKeyHints: hints
      });

      if (Object.keys(mapping).length > 0) {
        this.secretMapCache.set(url, mapping);
        console.log(`[SecretResolver] LLM mapping applied for ${url}: ${JSON.stringify(mapping)}`);
      } else {
        this.secretMapCache.set(url, {});
      }
    } catch (e) {
      this.secretMapCache.set(url, {});
    }
  }

  // Auto-inject variables for remaining type steps
  private autoInjectVariables(step: StepAction, context: PlanningContext): StepAction {
    if (step.type !== 'type' || !this.variablesManager) return step;
    if (typeof step.value === 'string' && step.value && step.value !== 'NEEDS_USER_INPUT') {
      if (!step.value.startsWith('{{var.')) return step;
      return step;
    }
    if (!step.label) return step;

    const url = context.currentUrl;
    const map = this.varMapCache.get(url);
    let mappedKey: string | undefined;
    if (map) {
      mappedKey = map[step.label] || Object.entries(map).find(([l]) => l.toLowerCase() === step.label!.toLowerCase())?.[1];
    }
    
    if (mappedKey) {
      console.log(`[AUTO-INJECT] Injecting {{var.${mappedKey}}} for field "${step.label}"`);
      return { ...step, value: `{{var.${mappedKey}}}` };
    }
    return step;
  }

  // Build variable mapping for current URL using LLM
  private async ensureVariableMapping(context: PlanningContext): Promise<void> {
    if (!this.variablesManager || !this.variableResolver) return;
    const url = context.currentUrl;
    if (this.varMapCache.has(url)) return;

    try {
      const labels: string[] = [];
      const keys = this.variablesManager.getAllKeys();
      if (!labels.length || !keys.length) { 
        this.varMapCache.set(url, {}); 
        return; 
      }
      const hints = (this.variablesManager as any).getAllContexts ? (this.variablesManager as any).getAllContexts() : {};
      const mapping = await this.variableResolver.resolveMapping({ 
        url, fieldLabels: labels, variableKeys: keys, variableKeyHints: hints 
      });
      this.varMapCache.set(url, mapping || {});
      if (mapping && Object.keys(mapping).length > 0) {
        console.log(`[VariableResolver] LLM mapping applied for ${url}: ${JSON.stringify(mapping)}`);
      }
    } catch {
      this.varMapCache.set(url, {});
    }
  }

  // Detect uncertainty based on planning context and result
  detectUncertainty(context: PlanningContext, planningResult: PlanningResult): boolean {
    // Basic uncertainty detection for DOM-based planning
    if (planningResult.confidence < 0.7) {
      return true;
    }

    if (planningResult.step.type === 'type' && 
        (planningResult.step.value === 'NEEDS_USER_INPUT' || 
         !planningResult.step.value || 
         planningResult.step.value.trim() === '')) {
      return true;
    }

    if (!planningResult.matchesGoal) {
      return true;
    }

    return false;
  }

  // Check if we should continue planning more steps
  shouldContinue(context: PlanningContext): boolean {
    const { stepHistory, goalProgress } = context;
    
    if (goalProgress >= 0.95) {
      return false;
    }
    
    if (stepHistory.length >= 50) {
      return false;
    }
    
    if (this.isStuckInLoop(stepHistory)) {
      return false;
    }
    
    return true;
  }

  // Detect if we're stuck in repetitive steps
  private isStuckInLoop(stepHistory: StepAction[]): boolean {
    if (stepHistory.length < 6) {
      return false;
    }

    const recent = stepHistory.slice(-6);
    const lastThree = recent.slice(-3);
    const previousThree = recent.slice(-6, -3);
    
    const isSamePattern = lastThree.every((step, index) => {
      const prevStep = previousThree[index];
      return step.type === prevStep.type && 
             step.label === prevStep.label &&
             step.url === prevStep.url;
    });

    if (isSamePattern) {
      console.warn('Detected step repetition pattern - stopping to avoid infinite loop');
      return true;
    }

    return false;
  }

  // Build step planning prompt with DOM+URL+History and optional validation
  private buildStepPlanningPrompt(context: any): string {
    const secretsInfo = context.secretsKeys?.length > 0 
      ? `\nAvailable Secrets: ${context.secretsKeys.join(', ')}`
      : '';
    
    const variablesInfo = context.varsKeys?.length > 0 
      ? `\nAvailable Variables: ${context.varsKeys.join(', ')}`
      : '';

    // Include validation context if available
    const validationContext = context.goalCriteria && context.previousState && context.previousStepReasoning ? `

PREVIOUS STEP VALIDATION:
Previous Step Reasoning: ${context.previousStepReasoning}

Goal-Level Success Criteria (overall objective progress):
${context.goalCriteria.map((criterion: string, index: number) => `G${index + 1}. ${criterion}`).join('\n')}

Previous State for Validation:
URL: ${context.previousState.url}
DOM Context: ${context.previousState.dom ? 'Available' : 'Not available'}
Screenshot: ${context.previousState.screenshot ? 'Available' : 'Not available'}

VALIDATION REQUIREMENTS:
- Analyze if the previous step accomplished its intended purpose based on the reasoning
- Determine if the goal criteria have been fulfilled based on the current page state
- Include validation results in your response alongside the next step planning
` : '';

    return `You are a web automation expert. Plan the next action to achieve the user's goal.${validationContext ? ' Additionally, validate the success of the previous step and overall goal progress.' : ''}

User Goal: ${context.prompt}
Current URL: ${context.currentUrl}

${secretsInfo}${variablesInfo}${validationContext}

Current DOM Context:
${context.cleanedDOM || 'No DOM content available'}

Visual Context:
I have also provided a full-page screenshot of the current page state. Use this visual information alongside the DOM to better understand the page layout, element positions, and current state.

${context.stepHistory?.length > 0 ? `
Previous Steps (All):
${context.stepHistory.map((step: any, i: number) => `${i + 1}. ${step.type}: ${step.label || step.value || step.key || 'N/A'}`).join('\n')}
` : ''}

IMPORTANT: For type actions that require user input, use appropriate placeholders:
- For secrets: Use "{{secret.KEY_NAME}}" (e.g., "{{secret.ADMIN_PASSWORD}}")
- For variables: Use "{{var.KEY_NAME}}" (e.g., "{{var.USERNAME}}")

VALIDATION & ENABLEMENT (CRITICAL):
- Do NOT click submit/save if form validation might fail; ensure required fields are filled first.
- Do NOT click disabled buttons; instead, plan the steps that would enable them.
- Analyze the DOM to understand the current page state and available actions.

FORM FIELD REQUIREMENTS ANALYSIS:
- Form fields may have explicit required hints (*, "required", aria-required="true", required attribute)
- Form fields may have explicit optional hints ("optional", "(optional)", "not required")
- Form fields may have neither required nor optional hints
- Form fields may have both required and optional hints (conflicting signals)
- Prioritize filling required fields before attempting form submission
- When encountering conflicting hints, treat the field as required to be safe

CRITICAL RULE FOR DROPDOWN/PICKER FIELDS:
- Für Felder mit Auswahlliste, Pickern oder Combobox-ähnlichem Verhalten: verwende Klick-Schritte, nicht Type-Schritte.
- Plane die Interaktion mehrschrittig: Öffnen, gewünschte Option auswählen, anschließend Zustand prüfen.

DROPDOWN OVERLAY HANDLING:
- Wenn die Auswahlliste/der Popover weiterhin sichtbar ist, als nächsten Schritt einen Keypress mit Taste "Escape" planen, um zu schließen.

KEYPRESS ACTION:
- Use keypress action for keyboard interactions, especially for closing overlays/modals.
- Common keys: "Escape" (close overlays), "Enter" (confirm), "Tab" (navigate), "Space" (select)
- Example: {"type": "keypress", "key": "Escape"}

STEP PLANNING STRATEGY:
- Plan only ONE next step that moves toward the goal
- The next step does NOT need to immediately achieve the main goal
- Future steps will be planned after this step is executed
- Focus on logical progression: what is the most appropriate next action given the current state
- Break complex goals into smaller, manageable steps

CONTRADICTION DETECTION:
Analyze potential contradictions between the subtask and current state:
- Subtask wants: "${context.prompt}"
- Current URL: ${context.currentUrl}
- Available DOM context can help determine current page state

CRITICAL OUTPUT REQUIREMENTS - READ CAREFULLY:
⚠️ RESPOND WITH ONLY THE JSON OBJECT BELOW. NO EXPLANATIONS. NO REASONING. NO ADDITIONAL TEXT.
⚠️ DO NOT include markdown code blocks, comments, or any text before/after the JSON.
⚠️ Your entire response must be ONLY the JSON object - nothing else.

- For click steps: Provide "type" and "label". Do not include a "value".
- For type steps: Provide "type", "label" and "value" using placeholders when appropriate.
- For goto steps: Provide "type": "goto" and "url".
- For assert_page steps: Provide "type": "assert_page" and "url".
- For keypress steps: Provide "type": "keypress" and "key" (e.g., "Escape", "Enter", "Tab"). No label/value.

STEP REASONING:
- Include "stepReasoning" string explaining why this step is necessary and what it accomplishes
- Provide clear justification for this specific action in context of the overall goal
- Example: "This step is necessary because the login form requires a username to be entered before the submit button becomes enabled, progressing toward the goal of logging into the application"

YOUR ENTIRE RESPONSE MUST BE EXACTLY THIS JSON FORMAT AND NOTHING ELSE:
${validationContext ? `{
  "step": {
    "type": "click" | "type" | "goto" | "assert_page" | "keypress",
    "label": "element label or text (for click/type actions)",
    "value": "text to type (only for type actions)",
    "url": "full URL (only for goto/assert_page actions)",
    "key": "key to press (only for keypress actions, e.g. 'Escape', 'Enter', 'Tab')"
  },
  "confidence": 0.8,
  "matchesGoal": true,
  "stepReasoning": "Clear explanation of why this step is necessary and what it accomplishes toward the goal",
  "stepValidation": {
    "success": true/false,
    "reasoning": "Brief explanation of whether the previous step achieved its intended purpose"
  },
  "goalValidation": {
    "isComplete": true/false,
    "reasoning": "Brief explanation of whether the main goal has been completed"
  }
}` : `{
  "step": {
    "type": "click" | "type" | "goto" | "assert_page" | "keypress",
    "label": "element label or text (for click/type actions)",
    "value": "text to type (only for type actions)",
    "url": "full URL (only for goto/assert_page actions)",
    "key": "key to press (only for keypress actions, e.g. 'Escape', 'Enter', 'Tab')"
  },
  "confidence": 0.8,
  "matchesGoal": true,
  "stepReasoning": "Clear explanation of why this step is necessary and what it accomplishes toward the goal"
}`}`;
  }

  private parseStepPlanningResult(result: string): PlanningResult {
    try {
      const jsonStr = this.extractAndFixJson(result);
      const parsed = JSON.parse(jsonStr);
      return {
        step: parsed.step || { type: 'click', label: 'Unknown' },
        confidence: parsed.confidence || 0.5,
        matchesGoal: parsed.matchesGoal !== false,
        alternatives: parsed.alternatives,
        stepReasoning: typeof parsed.stepReasoning === 'string' ? parsed.stepReasoning : undefined,
        // Include validation results if present
        stepValidation: parsed.stepValidation ? {
          success: typeof parsed.stepValidation.success === 'boolean' ? parsed.stepValidation.success : false,
          reasoning: parsed.stepValidation.reasoning || undefined
        } : undefined,
        goalValidation: parsed.goalValidation ? {
          isComplete: typeof parsed.goalValidation.isComplete === 'boolean' ? parsed.goalValidation.isComplete : false,
          reasoning: parsed.goalValidation.reasoning || 'No reasoning provided'
        } : undefined
      };
    } catch (error) {
      console.error('[StepPlanner] Failed to parse step planning result:', error);
      return {
        step: { type: 'click', label: 'Parse Error' },
        confidence: 0.1,
        matchesGoal: false
      };
    }
  }

  // Basic JSON extraction and fixing
  public extractAndFixJson(result: string): string {
    try {
      // Handle case where result might not be a string
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      const startIdx = resultStr.indexOf('{');
      if (startIdx === -1) {
        throw new Error('No JSON start found');
      }

      let braceCount = 0;
      let endIdx = startIdx;
      let inString = false;
      let escape = false;

      for (let i = startIdx; i < resultStr.length; i++) {
        const char = resultStr[i];
        
        if (escape) {
          escape = false;
          continue;
        }
        
        if (char === '\\') {
          escape = true;
          continue;
        }
        
        if (char === '"' && !escape) {
          inString = !inString;
          continue;
        }
        
        if (!inString) {
          if (char === '{') {
            braceCount++;
          } else if (char === '}') {
            braceCount--;
            if (braceCount === 0) {
              endIdx = i;
              break;
            }
          }
        }
      }

      if (braceCount === 0 && endIdx > startIdx) {
        let jsonStr = resultStr.substring(startIdx, endIdx + 1);
        
        // Clean up common issues
        jsonStr = jsonStr
          .replace(/,(\s*[}\]])/g, '$1')
          .replace(/,,+/g, ',');
        
        JSON.parse(jsonStr);
        return jsonStr;
      }
      
      throw new Error('Unable to extract valid JSON');
    } catch (error) {
      console.error('[JSON Parser] Failed:', error);
      throw new Error('Unable to extract valid JSON from response');
    }
  }

  // Stub methods for compatibility
  private buildCombinedGoalWithTasksPrompt(context: any): string {
    return `Plan combined goal with tasks. Context: ${JSON.stringify(context)}`;
  }

  private parseCombinedGoalWithTasksResult(result: string): GoalWithTasksResult {
    return {
      subgoal: { id: 'stub', short: 'Stub', detail: 'Stub', successCriteria: [] },
      subtasks: [],
      confidence: 0.5
    };
  }


  private buildReplanTaskPrompt(failed: Subgoal | Subtask, error: string, context: any): string {
    return `Replan failed task: ${JSON.stringify(failed)}. Error: ${error}`;
  }

  private parseReplanTaskResult(result: string, original: Subgoal | Subtask): Subgoal | Subtask {
    return original;
  }
}
