import { chromium, Browser, Page } from 'playwright';
import { StepAction, StepResult, GuideConfig } from './types';
import { AISelectorResolver } from './ai-selector-resolver';
import { TTSService } from './tts-service';
import { DOMSnapshot } from './dom-snapshot';
import { ContextTracker } from './context-tracker';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';
import { execSync } from 'child_process';

export class PlaywrightRunner {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private aiResolver: AISelectorResolver | null = null;
  private ttsService!: TTSService;
  private ttsRequests: Map<string, string> = new Map();
  private startTime: number = 0;
  private videoStartTime: number = 0; // Track when video recording actually starts
  private selectorCache: Map<string, { selector: string; confidence: number; fallbacks: string[] }> = new Map();
  private firstNavigation: boolean = true;
  private videoRecordingStarted: boolean = false;
  private audioDurations: Map<string, number> = new Map(); // Store audio durations by label
  private stepTimings: Map<string, { start: number; end?: number; duration?: number }> = new Map(); // Detailed step timings
  private ttsStartTimes: Map<string, number> = new Map(); // Store TTS start timestamps by label
  private ttsDelays: Map<string, number> = new Map(); // Store TTS start offsets by label (ms)
  // Cursor overlay state
  private cursorInjected: boolean = false;
  private lastCursorX: number = 20;
  private lastCursorY: number = 20;
  
  private contextTracker: ContextTracker = new ContextTracker();
  // UI graph/heuristics disabled: keep stubs for compatibility
  private currentUIGraph: null = null;

  async initialize(headful: boolean = false, recordVideo: boolean = false, videoPath?: string): Promise<void> {
    const initStartTime = Date.now();
    console.log(`[INIT] Starting browser initialization...`);
    
    this.browser = await chromium.launch({ 
      headless: !headful,
      args: [
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ]
    });
    
    const browserLaunchTime = Date.now();
    console.log(`[INIT] Browser launched in ${((browserLaunchTime - initStartTime) / 1000).toFixed(1)}s`);
    
    const contextOptions: any = {
      viewport: { width: 1280, height: 720 },
      reducedMotion: 'reduce'
    };
    
    if (recordVideo && videoPath) {
      contextOptions.recordVideo = {
        dir: path.dirname(videoPath),
        size: { width: 1280, height: 720 }
      };
    }
    
    const context = await this.browser.newContext(contextOptions);
    this.page = await context.newPage();
    
    const pageCreateTime = Date.now();
    console.log(`[INIT] Page created in ${((pageCreateTime - browserLaunchTime) / 1000).toFixed(1)}s`);
    
    // Initialize AI resolver if available
    this.aiResolver = AISelectorResolver.create();
    if (this.aiResolver) {
      console.log('AI-powered selector resolution enabled');
    } else {
      console.log('AI selector resolution not available');
      console.log('Set CLOUDFLARE_API_KEY + CLOUDFLARE_ACCOUNT_ID (preferred) or OPENAI_API_KEY to enable');
    }

    // Heuristics/UI graph disabled: no-op initialization

    // Initialize TTS service
    this.ttsService = TTSService.create();
    if (TTSService.isAvailable()) {
      console.log('ElevenLabs TTS service enabled');
    } else {
      console.log('TTS service not available (set ELEVENLABS_API_KEY to enable)');
    }
    
    // Set start time for video timing
    this.startTime = Date.now();
    
    const totalInitTime = Date.now();
    console.log(`[INIT] Complete initialization in ${((totalInitTime - initStartTime) / 1000).toFixed(1)}s`);
  }

  // NEW: Public accessor for Page (required by howto-prompt)
  getPage(): Page | null {
    return this.page;
  }

  // Compatibility stubs: UI graph is disabled
  async buildUIGraph(): Promise<null> { return null; }
  async refreshUIGraph(): Promise<void> { /* no-op */ }

  async close(): Promise<string | undefined> {
    let videoPath: string | undefined;
    
    if (this.page) {
      // Get video path before closing
      try {
        videoPath = await this.page.video()?.path();
      } catch (error) {
        console.warn('No video recording found');
      }
      await this.page.close();
    }
    if (this.browser) {
      await this.browser.close();
    }
    
    return videoPath;
  }

  async startVideoRecording(videoPath: string): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    
    console.log('Starting video recording...');
    
    // Store current URL before closing page
    const currentUrl = this.page.url();
    
    // Close current page and create new context with video recording
    await this.page.close();
    
    const contextOptions = {
      viewport: { width: 1280, height: 720 },
      recordVideo: {
        dir: path.dirname(videoPath),
        size: { width: 1280, height: 720 }
      }
    };
    
    // Create a fresh context (recording starts with the context)
    const context = await this.browser!.newContext(contextOptions);
    // Set the video base time as close as possible to actual recording start
    this.videoStartTime = Date.now();
    this.videoRecordingStarted = true;
    this.page = await context.newPage();
    // Reset cursor overlay state for the new page/context
    this.cursorInjected = false;
    this.lastCursorX = 20;
    this.lastCursorY = 20;
    
    // Navigate back to the same URL so video starts with correct page
    if (currentUrl && currentUrl !== 'about:blank') {
      console.log(`Navigating to ${currentUrl} for video recording...`);
      await this.page.goto(currentUrl);
      await this.page.waitForLoadState('networkidle', { timeout: 10000 });
    }
    
    console.log('Video recording started');
  }

  async preprocessAllTTS(steps: StepAction[], audioDir: string): Promise<void> {
    const preprocessStartTime = Date.now();
    const ttsSteps = steps.filter(step => step.type === 'tts_start');
    if (ttsSteps.length === 0) {
      console.log('No TTS steps found, skipping TTS preprocessing');
      return;
    }

    console.log(`[TTS] Preprocessing ${ttsSteps.length} TTS requests...`);
    
    for (const step of ttsSteps) {
      if (!step.text || !step.label) continue;
      
      const audioFileName = `${step.label}.mp3`;
      const audioPath = path.join(audioDir, audioFileName);
      
      // Create hash for caching
      const textHash = crypto.createHash('sha256')
        .update(`${step.text}|${step.voice || 'FTNCalFNG5bRnkkaP5Ug'}`)
        .digest('hex');
      const cachedPath = path.join(audioDir, `${step.label}-${textHash.substring(0, 8)}.mp3`);
      
      // Check if cached file exists
      try {
        await fs.access(cachedPath);
        console.log(`Using cached TTS for "${step.label}" (hash: ${textHash.substring(0, 8)})`);
        
        // Copy cached file to expected location if different
        if (cachedPath !== audioPath) {
          await fs.copyFile(cachedPath, audioPath);
        }
        
        // Store audio duration for cached file
        const actualDuration = await this.getActualAudioDuration(cachedPath);
        const duration = actualDuration > 0 ? actualDuration : this.estimateAudioDuration(step.text);
        this.audioDurations.set(step.label, duration);
        
        // Create mock request ID for cached file
        const mockRequestId = `cached-${step.label}`;
        this.ttsRequests.set(step.label, mockRequestId);
        continue;
        
      } catch (error) {
        // File doesn't exist, generate new TTS
      }
      
      console.log(`Generating TTS for "${step.label}": ${step.text.substring(0, 100)}...`);
      
      try {
        const requestId = await this.ttsService.startTTS({
          text: step.text,
          voice: step.voice,
          outputPath: cachedPath // Save to cached path
        });
        
        // Store the mapping between label and requestId for later use
        this.ttsRequests.set(step.label, requestId);
        
        // Just wait for TTS generation (not playback duration) during preprocessing
        await this.ttsService.waitForTTSGeneration(requestId);
        
        // Copy to expected location
        if (cachedPath !== audioPath) {
          await fs.copyFile(cachedPath, audioPath);
        }
        
        // Store audio duration for later use
        const actualDuration = await this.getActualAudioDuration(cachedPath);
        const duration = actualDuration > 0 ? actualDuration : this.estimateAudioDuration(step.text);
        this.audioDurations.set(step.label, duration);
        
        // Convert to cached request ID for consistency
        const cachedRequestId = `cached-${step.label}`;
        this.ttsRequests.set(step.label, cachedRequestId);
        
        console.log(`TTS file generated and cached for "${step.label}" (hash: ${textHash.substring(0, 8)})`);
        
      } catch (error) {
        console.warn(`TTS preprocessing failed for "${step.label}":`, error);
      }
    }
    
    const preprocessEndTime = Date.now();
    console.log(`[TTS] Preprocessing completed in ${((preprocessEndTime - preprocessStartTime) / 1000).toFixed(1)}s`);
  }

  private async preprocessNextSteps(currentIndex: number, allSteps: StepAction[]): Promise<void> {
    if (!this.page || !this.aiResolver) return;

    // Look ahead to find next steps that need element selection
    const stepsToPreprocess = allSteps.slice(currentIndex + 1, currentIndex + 4); // Look 3 steps ahead
    
    for (const step of stepsToPreprocess) {
      if ((step.type === 'type' || step.type === 'click' || step.type === 'assert') && step.label) {
        const cacheKey = `${step.type}:${step.label}`;
        
        // Skip if already cached
        if (this.selectorCache.has(cacheKey)) {
          continue;
        }

        try {
          console.log(`Preprocessing selector for upcoming step: ${step.type} "${step.label}"`);
          
          const elementType = step.type === 'type' ? 'input' : 
                             step.type === 'click' ? 'button' : 'any';
          
          const aiResult = await this.aiResolver.findSelector(
            this.page, 
            step.label, 
            elementType,
            step.note
          );

          if (aiResult.selector && aiResult.confidence > 0.5) {
            this.selectorCache.set(cacheKey, aiResult);
            console.log(`Cached selector for "${step.label}": ${aiResult.selector} (confidence: ${aiResult.confidence})`);
          }
        } catch (error) {
          console.warn(`Failed to preprocess selector for "${step.label}":`, error);
        }
      }
    }
  }

  private async prefetchSelectorsAfterTTS(currentIndex: number, allSteps: StepAction[]): Promise<void> {
    if (!this.page || !this.aiResolver) return;

    // Look for immediate next click/type steps after the current TTS start
    const nextSteps = allSteps.slice(currentIndex + 1, currentIndex + 3); // Check next 2 steps
    
    for (const step of nextSteps) {
      // Only prefetch for click and type steps
      if ((step.type === 'click' || step.type === 'type') && step.label) {
        const cacheKey = `${step.type}:${step.label}`;
        
        // Skip if already cached
        if (this.selectorCache.has(cacheKey)) {
          console.log(`Selector for "${step.label}" already cached, skipping prefetch`);
          continue;
        }

        try {
          console.log(`🎯 Pre-fetching selector after TTS start for: ${step.type} "${step.label}"`);
          
          const elementType = step.type === 'type' ? 'input' : 'button';
          
          const aiResult = await this.aiResolver.findSelector(
            this.page, 
            step.label, 
            elementType,
            step.note
          );

          if (aiResult.selector && aiResult.confidence > 0.5) {
            this.selectorCache.set(cacheKey, aiResult);
            console.log(`✅ Pre-fetched selector for "${step.label}": ${aiResult.selector} (confidence: ${aiResult.confidence})`);
          } else {
            console.log(`⚠️ Low confidence selector for "${step.label}": ${aiResult.selector} (confidence: ${aiResult.confidence})`);
          }
        } catch (error) {
          console.log(`❌ Failed to pre-fetch selector for "${step.label}":`, error);
        }
      }
    }
  }

  async executeStep(
    step: StepAction, 
    index: number, 
    config: GuideConfig,
    screenshotDir: string,
    domSnapshotDir: string,
    allSteps?: StepAction[]
  ): Promise<StepResult> {
    if (!this.page) {
      throw new Error('Runner not initialized. Call initialize() first.');
    }

    const stepStartTime = Date.now();
    const baseTime = this.videoRecordingStarted ? this.videoStartTime : this.startTime;
    const relativeTime = ((stepStartTime - baseTime) / 1000).toFixed(1);
    const videoPrefix = this.videoRecordingStarted ? 'V' : 'P'; // V for video time, P for process time
    
    // Store step timing
    const stepId = `step-${index + 1}-${step.type}`;
    this.stepTimings.set(stepId, { start: stepStartTime });
    
    console.log(`[${videoPrefix}${relativeTime}s] Executing step ${index + 1}: ${step.type}`, JSON.stringify(step, null, 2));
    
    const result: StepResult = {
      step,
      index,
      success: false,
      timestamp: (stepStartTime - baseTime) / 1000 // Convert to seconds
    };

    try {
      switch (step.type) {
        case 'goto':
          await this.executeGoto(step, config);
          break;
        case 'type':
          await this.executeType(step);
          break;
        case 'click':
          await this.executeClick(step);
          break;
        case 'assert':
          await this.executeAssert(step);
          break;
        case 'assert_page':
          await this.executeAssertPage(step, config, index, allSteps);
          break;
        case 'tts_start':
          await this.executeTTSStart(step, screenshotDir, index, allSteps, config);
          // Adjust the recorded timestamp to the actual TTS start moment
          if (step.label) {
            const actualStart = this.ttsStartTimes.get(step.label);
            if (actualStart) {
              result.timestamp = (actualStart - baseTime) / 1000;
            }
          }
          break;
        case 'tts_wait':
          await this.executeTTSWait(step, index, allSteps, config);
          break;
        case 'keypress':
          await this.executeKeypress(step);
          break;
      }

      // Skip additional wait for assert_page, click, type, keypress, and TTS steps
      if (!['assert_page', 'click', 'type', 'keypress', 'tts_start', 'tts_wait'].includes(step.type)) {
        await this.page.waitForLoadState('networkidle', { timeout: 5000 });
      }
      
      // Only take screenshot if enabled (default: true)
      if (step.screenshot !== false) {
        const screenshotPath = path.join(screenshotDir, `step-${String(index + 1).padStart(2, '0')}.png`);

        // For sensitive steps, apply mask (persists until navigation)
        if (step.sensitive) {
          await this.maskSensitiveElements(step);
        }

        // Small wait to prevent flicker during screenshot
        await this.page.waitForTimeout(50);

        await this.page.screenshot({ 
          path: screenshotPath,
          fullPage: false,
          animations: 'disabled'
        });

        result.screenshot = `step-${String(index + 1).padStart(2, '0')}.png`;
      }

      // Capture DOM snapshot as HTML if enabled (default: true), but skip for TTS steps to avoid delays
      if (step.domSnapshot !== false && !['tts_start', 'tts_wait'].includes(step.type)) {
        const domSnapshotPath = path.join(domSnapshotDir, `step-${String(index + 1).padStart(2, '0')}-dom.html`);
        
        try {
          await DOMSnapshot.captureAndSaveHTML(this.page, domSnapshotPath);
          result.domSnapshot = `step-${String(index + 1).padStart(2, '0')}-dom.html`;
        } catch (error) {
          console.warn(`Failed to capture DOM snapshot for step ${index + 1}:`, error);
        }
      }
      
      // Calculate step duration
      const stepEndTime = Date.now();
      result.duration = (stepEndTime - stepStartTime) / 1000; // Convert to seconds
      const endRelativeTime = ((stepEndTime - baseTime) / 1000).toFixed(1);
      
      // Update step timing
      const stepTiming = this.stepTimings.get(stepId);
      if (stepTiming) {
        stepTiming.end = stepEndTime;
        stepTiming.duration = result.duration;
      }
      
      console.log(`[${videoPrefix}${endRelativeTime}s] Step ${index + 1} completed in ${result.duration.toFixed(1)}s`);
      result.success = true;

    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      result.success = false;
      const stepEndTime = Date.now();
      result.duration = (stepEndTime - stepStartTime) / 1000;
      
      // Update step timing for failed steps
      const stepTiming = this.stepTimings.get(stepId);
      if (stepTiming) {
        stepTiming.end = stepEndTime;
        stepTiming.duration = result.duration;
      }
      
      const endRelativeTime = ((stepEndTime - baseTime) / 1000).toFixed(1);
      console.log(`[${videoPrefix}${endRelativeTime}s] Step ${index + 1} FAILED in ${result.duration.toFixed(1)}s: ${result.error}`);
    }

    return result;
  }

  /**
   * Generate a comprehensive timing report for all steps
   */
  generateTimingReport(): string {
    const report: string[] = [];
    report.push('\n=== STEP TIMING REPORT ===');
    
    if (this.stepTimings.size === 0) {
      report.push('No timing data available');
      return report.join('\n');
    }

    const baseTime = this.videoRecordingStarted ? this.videoStartTime : this.startTime;
    let totalDuration = 0;
    let successfulSteps = 0;
    let failedSteps = 0;

    // Sort steps by their start time
    const sortedSteps = Array.from(this.stepTimings.entries())
      .sort(([, a], [, b]) => a.start - b.start);

    report.push(`Base time: ${new Date(baseTime).toISOString()}`);
    report.push('');

    for (const [stepId, timing] of sortedSteps) {
      const relativeStart = ((timing.start - baseTime) / 1000).toFixed(1);
      const duration = timing.duration?.toFixed(1) || 'N/A';
      const status = timing.end ? (timing.duration ? 'COMPLETED' : 'FAILED') : 'IN_PROGRESS';
      
      report.push(`${stepId}: Start ${relativeStart}s, Duration ${duration}s, Status: ${status}`);
      
      if (timing.duration) {
        totalDuration += timing.duration;
        if (status === 'COMPLETED') successfulSteps++;
        else failedSteps++;
      }
    }

    report.push('');
    report.push('=== SUMMARY ===');
    report.push(`Total steps: ${this.stepTimings.size}`);
    report.push(`Successful: ${successfulSteps}`);
    report.push(`Failed: ${failedSteps}`);
    report.push(`Total duration: ${totalDuration.toFixed(1)}s`);
    report.push(`Average step duration: ${(totalDuration / (successfulSteps + failedSteps)).toFixed(1)}s`);
    
    if (this.videoRecordingStarted) {
      const totalVideoTime = ((Date.now() - this.videoStartTime) / 1000).toFixed(1);
      report.push(`Total video time: ${totalVideoTime}s`);
    }

    return report.join('\n');
  }


  // ==================== NEW HEURISTICS-BASED METHODS ====================

  private async executeGoto(step: StepAction, config: GuideConfig): Promise<void> {
    if (!this.page || !step.url) throw new Error('Page not initialized or URL missing');

    // Resolve relative URLs against baseUrl from config
    const resolveUrl = (raw: string): string => {
      // Absolute URL -> use as-is
      if (/^https?:\/\//i.test(raw)) return raw;
      // Support about:blank etc.
      if (/^[a-zA-Z]+:\/\//.test(raw)) return raw;
      // Relative -> require baseUrl
      if (!config.baseUrl) {
        throw new Error(`Relative URL "${raw}" requires baseUrl in config.frontmatter`);
      }
      try {
        return new URL(raw, config.baseUrl).toString();
      } catch (e) {
        throw new Error(`Failed to resolve URL. baseUrl="${config.baseUrl}", url="${raw}"`);
      }
    };

    const targetUrl = resolveUrl(step.url);
    console.log(`[Heuristic] Navigating to ${targetUrl}`);
    
    // Track navigation start
    this.contextTracker.trackStepStart(
      this.stepTimings.size,
      'goto',
      step.url
    );
    
    // Navigate to URL
    await this.page.goto(targetUrl, { 
      waitUntil: 'networkidle',
      timeout: config.timeout || 30000 
    });
    // Clear any sensitive masks on navigation (SPA or full)
    await this.clearSensitiveMasks();
    
    // UI graph disabled

    // Optional explicit wait after navigation (user-controlled stabilization)
    if (typeof step.waitMs === 'number' && step.waitMs > 0) {
      try { await this.page.waitForTimeout(step.waitMs); } catch {}
    }
    
    // Track successful navigation
    this.contextTracker.trackElementInteraction(
      { tag: 'page', visible: true, enabled: true, isInActiveTab: true, 
        classes: [], inViewport: true, zIndex: 0, focusable: false, 
        clickable: false, candidateSelectors: [], stability: 'high',
        nearbyText: [], isPrimary: false, isSubmit: false } as any,
      targetUrl,
      true
    );
  }

  // UI graph disabled

  // Enhanced findElement method using heuristics-first approach
  // Heuristic-based element finding removed; LLM-only mode is enforced

  // validateAndSelectHeuristicMatch removed in DOM+LLM mode

  // Heuristic fallback removed

  // Transform CSS selectors with :contains() to Playwright-compatible selectors
  private transformSelector(selector: string): string {
    if (!selector) return selector;
    
    // Match patterns like: div:contains("text") or element:contains('text')
    const containsRegex = /([^:]*):contains\(['"]([^'"]+)['"]\)/g;
    
    return selector.replace(containsRegex, (match, elementPart, textContent) => {
      // If there's an element part (like 'div', 'span', etc.), use :has-text()
      if (elementPart && elementPart.trim()) {
        return `${elementPart.trim()}:has-text("${textContent}")`;
      }
      // If no element part, use pure text selector
      return `text="${textContent}"`;
    });
  }

  // LLM-only selector resolution helper
  private async findElementLLMOnly(label: string, elementType?: 'input' | 'button' | 'any', stepNote?: string) {
    if (!this.page) throw new Error('Page not initialized');
    if (!this.aiResolver) throw new Error('LLM-only selector mode is enabled, but AI resolver is not available');

    // Track step start for context
    this.contextTracker.trackStepStart(
      this.stepTimings.size,
      elementType === 'input' ? 'type' : elementType === 'button' ? 'click' : 'any',
      label
    );

    console.log(`[Selector] LLM-only mode: resolving selector for "${label}" (type: ${elementType || 'any'})`);
    const aiResult = await this.aiResolver.findSelectorWithValidation(
      this.page!,
      label,
      (elementType as any) || 'any',
      stepNote,
      2
    );

    if (!aiResult.selector) {
      throw new Error(`LLM-only selector resolution failed for "${label}"`);
    }

    const transformedSelector = this.transformSelector(aiResult.selector);
    console.log(`[Selector] Transformed selector: ${aiResult.selector} → ${transformedSelector}`);
    const locator = this.page!.locator(transformedSelector).first();
    const count = await locator.count();
    if (count === 0) {
      throw new Error(`LLM-only selector returned no elements: ${transformedSelector} (original: ${aiResult.selector})`);
    }

    console.log(`[Selector] LLM-only mode: using selector ${transformedSelector} (confidence: ${aiResult.confidence})`);
    return locator;
  }

  // Update the original findElement method to use heuristics (or LLM-only if enforced)
  private async findElement(label: string, elementType?: 'input' | 'button' | 'any', stepNote?: string) {
    try {
      // Always use LLM-only flow
      return await this.findElementLLMOnly(label, elementType, stepNote);
    } catch (error) {
      console.error(`[Selector] Failed to find element "${label}":`, error);
      throw error;
    }
  }

  // Additional execute methods if missing
  private async executeType(step: StepAction): Promise<void> {
    if (!step.label || !step.value) {
      throw new Error('Type step missing label or value');
    }

    // Use provided selector if available, otherwise fall back to heuristic search
    let element;
    if (step.selector) {
      console.log(`[ExecuteType] Using provided selector: ${step.selector}`);
      element = this.page!.locator(this.transformSelector(step.selector)).first();
      
      // Verify element exists before proceeding
      const count = await element.count();
      if (count === 0) {
        const forceLLM = ['1', 'true', 'yes'].includes((process.env.FORCE_LLM_SELECTORS || '').toLowerCase());
        console.warn(`[ExecuteType] Provided selector "${this.transformSelector(step.selector)}" (original: "${step.selector}") found 0 elements, falling back to ${forceLLM ? 'LLM selector resolution' : 'heuristic search'}`);
        element = await this.findElement(step.label, 'input', step.note);
      } else {
        console.log(`[ExecuteType] Found ${count} element(s) with selector "${step.selector}"`);
      }
    } else {
      const forceLLM = ['1', 'true', 'yes'].includes((process.env.FORCE_LLM_SELECTORS || '').toLowerCase());
      console.log(`[ExecuteType] No selector provided, using ${forceLLM ? 'LLM selector resolution' : 'heuristic search'} for "${step.label}"`);
      element = await this.findElement(step.label, 'input', step.note);
    }

    // Simulate cursor movement and gentle wiggle before focusing the input
    try {
      await this.ensureCursorOverlay();
      await this.moveCursorToElement(element, { wiggle: true });
      await this.clickWithCursor(element);
    } catch (e) {
      // Non-fatal: typing can proceed without cursor animation
    }

    // Validate element is editable before clearing
    const isEditable = await element.evaluate((el: any) => {
      if (!el) return false;
      const tagName = el.tagName.toLowerCase();
      return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || 
             el.contentEditable === 'true' || el.hasAttribute('contenteditable') ||
             el.getAttribute('role') === 'textbox';
    });
    
    if (!isEditable) {
      throw new Error(`Element is not editable (${await element.evaluate((el: any) => el.tagName)} with role=${await element.getAttribute('role')})`);
    }
    
    await element.clear();
    await element.pressSequentially(step.value, { delay: 100 });
    // Post-check: value actually set
    try {
      const ok = await element.evaluate((el: any, expected: string) => {
        const anyEl = el as any;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          return anyEl.value === expected;
        }
        if ((el as HTMLElement).isContentEditable) {
          return (el as HTMLElement).innerText.trim() === String(expected);
        }
        return true;
      }, step.value);
      if (!ok) throw new Error('typed value not reflected in element');
    } catch (e) {
      throw new Error(`Post-check failed for type("${step.label}")`);
    }
  }

  private async executeClick(step: StepAction): Promise<void> {
    if (!step.label) {
      throw new Error('Click step missing label');
    }

    // Use provided selector if available, otherwise fall back to heuristic search
    const element = step.selector 
      ? this.page!.locator(this.transformSelector(step.selector)).first()
      : await this.findElement(step.label, 'button', step.note);
    const beforeUrl = await this.page!.url();
    // Simulate cursor movement with a small back-and-forth, then click
    try {
      await this.ensureCursorOverlay();
      await this.moveCursorToElement(element, { wiggle: true });
      await this.clickWithCursor(element);
    } catch (e) {
      // Fallback if overlay animation fails
      await element.click();
    }
    // Post-check: small wait for possible navigation/state change
    try {
      await this.page?.waitForLoadState('networkidle', { timeout: 2000 });
    } catch {}

    // UI graph disabled
  }

  private async executeAssert(step: StepAction): Promise<void> {
    if (!step.label) {
      throw new Error('Assert step missing label');
    }
    
    const element = await this.findElement(step.label, 'any', step.note);
    await element.waitFor({ state: 'visible', timeout: 5000 });
  }

  private async executeAssertPage(step: StepAction, config: GuideConfig, index: number, allSteps?: StepAction[]): Promise<void> {
    if (!this.page || !step.url) {
      throw new Error('Page not initialized or URL missing');
    }

    // Use per-step timeout if provided, otherwise fall back to global or default
    const timeout = (typeof step.timeout === 'number' && step.timeout > 0)
      ? step.timeout
      : (config.timeout || 10000);

    // Initial wait for potential navigation to settle
    await this.page.waitForLoadState('networkidle', { timeout });

    // Default wait for assert_page (helps with delayed redirects/SPAs)
    const defaultAssertWait = Number(process.env.HOWTO_ASSERT_WAIT_MS || process.env.DEFAULT_ASSERT_WAIT_MS) || 2000;
    const prevStep = (Array.isArray(allSteps) && typeof index === 'number' && index > 0)
      ? allSteps[index - 1]
      : undefined;
    if ((!step.waitMs || step.waitMs <= 0) && prevStep && (prevStep.type === 'click' || prevStep.type === 'goto')) {
      try {
        // Try to wait for target URL fragment to appear
        const escaped = step.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(escaped);
        await this.page.waitForURL(pattern, { timeout: defaultAssertWait });
      } catch {}
      // Small quiescence window
      try { await this.page.waitForTimeout(Math.min(500, defaultAssertWait)); } catch {}
    }

    // Optional explicit wait before asserting the URL (user-controlled stabilization)
    if (typeof step.waitMs === 'number' && step.waitMs > 0) {
      try { await this.page.waitForTimeout(step.waitMs); } catch {}
    }

    // Retry logic for URL assertion with state refresh
    const maxRetries = 3;
    const retryDelayMs = 1000;
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Check current URL
        const currentUrl = this.page.url();
        if (currentUrl.includes(step.url)) {
          console.log(`[Assert Page] URL assertion successful on attempt ${attempt}: ${currentUrl}`);
          break; // Success, exit retry loop
        }
        
        // URL assertion failed
        const error = new Error(`Expected URL to contain "${step.url}", but got "${currentUrl}"`);
        
        if (attempt === maxRetries) {
          // Final attempt, throw the error
          throw error;
        }
        
        console.log(`[Assert Page] Attempt ${attempt}/${maxRetries} failed: ${error.message}. Retrying with state refresh...`);
        lastError = error;
        
        // Refresh page state and wait for potential redirects
        try {
          await this.page.waitForLoadState('networkidle', { timeout: 2000 });
        } catch {}
        
        // Additional wait for redirect to complete
        await this.page.waitForTimeout(retryDelayMs);
        
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        lastError = error instanceof Error ? error : new Error(String(error));
        console.log(`[Assert Page] Attempt ${attempt}/${maxRetries} failed with error: ${lastError.message}. Retrying...`);
        await this.page.waitForTimeout(retryDelayMs);
      }
    }

    // Then: refresh UI to avoid stale elements and ensure SPA is painted  
    try {
      await this.clearSensitiveMasks();
      // DOM+URL+History mode - no UI graph building needed
      // Small double-RAF to ensure a fresh paint on SPA transitions
      try { await this.page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))); } catch {}
    } catch {}

    // Finally: look ahead to the next click/type step and ensure its selector is actionable
    const upcoming = (allSteps || [])
      .slice(typeof index === 'number' ? index + 1 : 0)
      .find(s => (s.type === 'click' || s.type === 'type') && !!s.label);

    if (upcoming && upcoming.label) {
      try {
        const elementType = upcoming.type === 'type' ? 'input' : 'button';
        const locator = await this.findElement(upcoming.label, elementType, upcoming.note);
        await locator.waitFor({ state: 'visible', timeout });
      } catch (e) {
        // Surface readiness issue if next selector is not available yet
        throw new Error(`assert_page: next ${upcoming.type} selector for "${upcoming.label}" not ready: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  private async executeTTSStart(step: StepAction, screenshotDir: string, index: number, allSteps?: StepAction[], config?: GuideConfig): Promise<void> {
    // Before marking start, ensure page is visually ready to avoid narration starting on a blank/newly loading page
    try {
      if (this.page) {
        // Quick settle: if a navigation/render is in-flight, wait briefly for DOM + network idle and a paint frame
        try { await this.page.waitForLoadState('domcontentloaded', { timeout: 1500 }); } catch {}
        try { await this.page.waitForLoadState('networkidle', { timeout: 1000 }); } catch {}
        try {
          await this.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        } catch {}
      }
    } catch {}

    // Mark TTS start time and optionally prefetch selectors for subsequent steps
    if (!step.label) {
      console.log('TTS Start without label; timing correlation may be limited');
    }
    if (step.label) {
      const startTs = Date.now();
      this.ttsStartTimes.set(step.label, startTs);
      const envRaw = process.env.TTS_DEFAULT_DELAY_MS;
      const envParsed = envRaw !== undefined ? parseInt(envRaw, 10) : undefined;
      const envDefault = Number.isFinite(envParsed as number) ? (envParsed as number) : undefined;
      const configuredDefault = (config && typeof config.ttsDefaultDelayMs === 'number') ? config.ttsDefaultDelayMs! : undefined;
      const baseDefault = 0; // hard default in ms (no implicit delay)
      const defaultDelay = (typeof step.delayMs === 'number')
        ? step.delayMs
        : (configuredDefault ?? envDefault ?? baseDefault);
      const delay = defaultDelay > 0 ? defaultDelay : 0;
      if (delay > 0) this.ttsDelays.set(step.label, delay);
      // Propagate the effective delay back into the step so downstream consumers (video alignment)
      // can use the same value even if it wasn't explicitly set in the input.
      if (typeof step.delayMs !== 'number' && delay > 0) {
        step.delayMs = delay;
      }
      const knownDuration = this.audioDurations.get(step.label);
      if (knownDuration) {
        console.log(`TTS Start: ${step.label} (~${knownDuration.toFixed(1)}s${delay>0?`, delay ${delay}ms`:''})`);
      } else {
        const est = step.text ? this.estimateAudioDuration(step.text) : 0;
        console.log(`TTS Start: ${step.label} (est. ${est.toFixed(1)}s${delay>0?`, delay ${delay}ms`:''})`);
        this.audioDurations.set(step.label, est);
      }
    } else {
      console.log(`TTS Start: ${step.text?.substring(0, 60) || ''}`);
    }

    // Prefetching selectors after TTS start is disabled to avoid background activity during narration
  }

  private async executeTTSWait(step: StepAction, index: number, allSteps?: StepAction[], config?: GuideConfig): Promise<void> {
    // Wait the remaining time of the TTS audio accounting for time spent in between steps
    let label = step.label || '';

    // If provided label doesn't map to a known TTS start, fallback to most recent
    const hasKnownLabel = !!label && (this.ttsStartTimes.has(label) && this.audioDurations.has(label));
    if ((!label || !hasKnownLabel) && this.ttsStartTimes.size > 0) {
      const mostRecent = Array.from(this.ttsStartTimes.entries()).sort((a, b) => b[1] - a[1])[0];
      if (mostRecent) label = mostRecent[0];
    }

    const duration = (label && this.audioDurations.get(label)) || 0;
    const startedAt = (label && this.ttsStartTimes.get(label)) || 0;
    const delayMs = (label && this.ttsDelays.get(label)) || 0;
    const now = Date.now();

    let remainingMs = 0;
    if (duration > 0 && startedAt > 0) {
      const effectiveStart = startedAt + delayMs;
      const elapsed = Math.max(0, (now - effectiveStart) / 1000); // seconds
      const rem = duration - elapsed;
      remainingMs = Math.max(0, Math.round(rem * 1000));
    } else if (step.text) {
      // Fallback: estimate if we don't have a precomputed duration/start
      remainingMs = Math.round(this.estimateAudioDuration(step.text) * 1000);
    }

    // If we still have no remaining time and an explicit waitMs was provided, honor it as a fallback
    if (remainingMs <= 0 && typeof step.waitMs === 'number' && step.waitMs > 0) {
      remainingMs = step.waitMs;
    }

    // If the time spent in between steps already exceeded the audio duration,
    // remainingMs will be 0 and we just continue without waiting.
    const remainingSec = Math.round(remainingMs / 100) / 10;
    console.log(`TTS Wait${label ? ` (${label})` : ''}: remaining ${remainingSec}s (duration=${duration.toFixed(1)}s${delayMs>0?`, delay ${delayMs}ms`:''})`);

    if (remainingMs > 0) {
      if (this.page) {
        await this.page.waitForTimeout(remainingMs);
      } else {
        await new Promise(r => setTimeout(r, remainingMs));
      }
    }
  }

  private async executeKeypress(step: StepAction): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }
    
    if (!step.key) {
      throw new Error('Keypress step missing key property');
    }

    console.log(`[ExecuteKeypress] Pressing key: ${step.key}`);
    
    try {
      // Use Playwright's keyboard API to press the specified key
      await this.page.keyboard.press(step.key);
      
      // Small wait to allow any UI changes to settle
      await this.page.waitForTimeout(100);
      
      console.log(`[ExecuteKeypress] Successfully pressed key: ${step.key}`);
    } catch (error) {
      throw new Error(`Failed to press key "${step.key}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Missing helper methods
  private estimateAudioDuration(text: string): number {
    // Estimate based on word count
    const wordCount = text.split(' ').length;
    return (wordCount / 170) * 60; // seconds, ~170 words per minute
  }

  private async getActualAudioDuration(audioPath: string): Promise<number> {
    try {
      // Use a simple heuristic or external tool to get audio duration
      // For now, fallback to estimation
      const stats = await fs.stat(audioPath);
      if (stats.size > 0) {
        // Rough estimation: ~128kbps MP3 = ~16KB per second
        return Math.max(1, stats.size / 16000);
      }
    } catch (error) {
      console.warn('Could not get actual audio duration:', error);
    }
    return 0;
  }
  
  // Ensure a masking stylesheet is present in the page
  private async ensureMaskingStylesInjected(): Promise<void> {
    if (!this.page) return;
    try {
      await this.page.addStyleTag({
        content: `
          /* injected by howto-generator: sensitive mask */
          ._ai_sensitive_mask { 
            filter: blur(12px) saturate(0.6) brightness(0.9);
            transition: filter 120ms ease;
          }
        `
      });
      // Mark presence to avoid duplicates (best-effort)
      await this.page.evaluate(() => {
        if (!document.getElementById('ai-sensitive-mask-style')) {
          const style = document.createElement('style');
          style.id = 'ai-sensitive-mask-style';
          style.textContent = '/* marker element for mask style present */';
          document.head.appendChild(style);
        }
      });
    } catch (e) {
      // Non-fatal
    }
  }

  // Clear all active sensitive masks (class/attribute and legacy overlay elements)
  private async clearSensitiveMasks(): Promise<void> {
    if (!this.page) return;
    try {
      await this.page.evaluate(() => {
        // Remove class/attribute based masks
        document.querySelectorAll('[data-ai-sensitive-mask="true"]').forEach((el) => {
          el.removeAttribute('data-ai-sensitive-mask');
          (el as HTMLElement).classList.remove('_ai_sensitive_mask');
          ((el as HTMLElement).style as any).webkitTextSecurity = '';
        });
        // Remove any legacy overlay nodes
        document.querySelectorAll('[data-sensitive-mask="true"]').forEach(m => m.remove());
      });
    } catch (error) {
      console.warn('Failed to clear sensitive masks:', error);
    }
  }

  

  private async validateElementType(selector: string, expectedType: string): Promise<boolean> {
    if (!this.page) return false;
    
    try {
      const element = this.page.locator(selector).first();
      if (!(await element.isVisible())) return false;
      
      const tagName = await element.evaluate(el => el.tagName.toLowerCase());
      
      if (expectedType === 'input') {
        return tagName === 'input' || tagName === 'textarea';
      } else if (expectedType === 'button') {
        // Be more permissive for clickable elements
        if (tagName === 'button' || tagName === 'a') return true;
        if (tagName === 'input') {
          const inputType = await element.getAttribute('type');
          return inputType === 'submit' || inputType === 'button';
        }
        const role = await element.getAttribute('role');
        if (role === 'button') return true;
        
        // Check if element is clickable (has click handlers or is naturally clickable)
        const isClickable = await element.evaluate(el => {
          // Check for onclick attribute
          if (el.hasAttribute('onclick')) return true;
          // Check for cursor pointer style
          const style = window.getComputedStyle(el);
          if (style.cursor === 'pointer') return true;
          // Check if it has click event listeners
          return false;
        });
        
        if (isClickable) return true;
        
        // For divs and spans with IDs that suggest they're clickable, be permissive
        if ((tagName === 'div' || tagName === 'span') && selector.includes('#')) {
          return true;
        }
      }
      
      return true; // For 'any' type, accept any element
    } catch (error) {
      console.warn(`Element validation failed for ${selector}:`, error);
      return false;
    }
  }

  private async isElementActionable(selector: string): Promise<boolean> {
    if (!this.page) return false;
    try {
      const locator = this.page.locator(selector).first();
      if (await locator.count() === 0) return false;
      if (!(await locator.isVisible())) return false;
      const isEnabled = await locator.isEnabled();
      if (!isEnabled) return false;
      // Obstruction check via elementFromPoint at center
      const unobscured = await locator.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const topEl = document.elementFromPoint(x, y);
        return topEl === el || (topEl && el.contains(topEl));
      });
      return !!unobscured;
    } catch (e) {
      return false;
    }
  }

  // --- Cursor overlay helpers ---

  // Inject a lightweight cursor overlay into the page (recorded in video)
  private async ensureCursorOverlay(): Promise<void> {
    if (!this.page) return;
    try {
      // Check if overlay already exists in this page
      const exists = await this.page.evaluate(() => !!document.getElementById('__ai_cursor'));
      if (exists) { this.cursorInjected = true; return; }
      await this.page.addStyleTag({
        content: `
          #__ai_cursor, #__ai_cursor_ring { position: fixed; pointer-events: none; z-index: 2147483647; }
          #__ai_cursor { width: 18px; height: 18px; border-radius: 50%;
            background: white; border: 2px solid #0a0a0a; box-shadow: 0 2px 6px rgba(0,0,0,0.2);
            transform: translate(-9px, -9px); transition: transform 40ms linear; }
          #__ai_cursor_ring { width: 28px; height: 28px; border-radius: 50%;
            border: 2px solid rgba(10,10,10,0.35); transform: translate(-14px, -14px);
            opacity: 0; transition: opacity 140ms ease, transform 140ms ease; }
          #__ai_cursor.clicking + #__ai_cursor_ring { opacity: 1; transform: translate(-14px, -14px) scale(1.3); }
        `
      });
      await this.page.evaluate((coords: {x: number; y: number}) => {
        const { x, y } = coords;
        if (!document.getElementById('__ai_cursor')) {
          const dot = document.createElement('div');
          dot.id = '__ai_cursor';
          dot.style.left = `${x}px`;
          dot.style.top = `${y}px`;
          const ring = document.createElement('div');
          ring.id = '__ai_cursor_ring';
          ring.style.left = `${x}px`;
          ring.style.top = `${y}px`;
          document.documentElement.appendChild(dot);
          document.documentElement.appendChild(ring);
        }
      }, { x: this.lastCursorX, y: this.lastCursorY });
      this.cursorInjected = true;
    } catch (e) {
      // non-fatal
    }
  }

  private async setCursorPosition(x: number, y: number): Promise<void> {
    if (!this.page) return;
    this.lastCursorX = x; this.lastCursorY = y;
    await this.page.evaluate((pos: {px: number; py: number}) => {
      const { px, py } = pos;
      const dot = document.getElementById('__ai_cursor') as HTMLElement | null;
      const ring = document.getElementById('__ai_cursor_ring') as HTMLElement | null;
      if (dot) { dot.style.left = `${px}px`; dot.style.top = `${py}px`; }
      if (ring) { ring.style.left = `${px}px`; ring.style.top = `${py}px`; }
    }, { px: x, py: y });
  }

  private async animateCursorPath(points: Array<{x:number, y:number}>, totalMs: number): Promise<void> {
    if (!this.page || points.length < 2) return;
    const steps = Math.max(8, Math.floor(totalMs / 16));
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      // Piecewise linear across provided points
      const seg = Math.min(points.length - 2, Math.floor(t * (points.length - 1)));
      const localT = (t * (points.length - 1)) - seg;
      const p0 = points[seg];
      const p1 = points[seg + 1];
      const x = p0.x + (p1.x - p0.x) * localT;
      const y = p0.y + (p1.y - p0.y) * localT;
      await this.setCursorPosition(x, y);
      await this.page.waitForTimeout(16);
    }
  }

  private async moveCursorToElement(element: any, opts?: { wiggle?: boolean }): Promise<void> {
    if (!this.page) return;
    try { await element.scrollIntoViewIfNeeded(); } catch {}
    const box = await element.boundingBox();
    if (!box) return;
    const targetX = box.x + box.width / 2;
    const targetY = box.y + box.height / 2;

    // Build a slightly curved path with an overshoot
    const midX = (this.lastCursorX + targetX) / 2 + (Math.random() * 30 - 15);
    const midY = (this.lastCursorY + targetY) / 2 + (Math.random() * 20 - 10);
    const overshootX = targetX + (Math.random() * 12 - 6);
    const overshootY = targetY + (Math.random() * 10 - 5);
    await this.animateCursorPath([
      { x: this.lastCursorX, y: this.lastCursorY },
      { x: midX, y: midY },
      { x: overshootX, y: overshootY },
      { x: targetX, y: targetY }
    ], 320);

    if (opts?.wiggle) {
      // Gentle back-and-forth wiggle around the target
      const amp = Math.max(3, Math.min(8, Math.min(box.width, box.height) / 6));
      const wiggles = 2; // back-and-forth
      const frames = 18 * wiggles;
      for (let i = 0; i <= frames; i++) {
        const phase = (i / frames) * Math.PI * wiggles;
        const dx = Math.cos(phase) * amp;
        const dy = Math.sin(phase) * (amp / 2);
        await this.setCursorPosition(targetX + dx, targetY + dy);
        await this.page.waitForTimeout(16);
      }
    }
  }

  private async clickWithCursor(element: any): Promise<void> {
    if (!this.page) return;
    // Ensure location and animate click ripple
    try { await element.scrollIntoViewIfNeeded(); } catch {}
    const box = await element.boundingBox();
    if (!box) {
      await element.click();
      return;
    }
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await this.setCursorPosition(x, y);
    await this.page.evaluate(() => {
      const dot = document.getElementById('__ai_cursor');
      if (dot) dot.classList.add('clicking');
    });
    // Also move the real mouse for completeness
    try {
      await this.page.mouse.move(x, y, { steps: 4 });
      await this.page.mouse.down();
      await this.page.waitForTimeout(60);
      await this.page.mouse.up();
    } catch {
      await element.click();
    }
    await this.page.waitForTimeout(80);
    await this.page.evaluate(() => {
      const dot = document.getElementById('__ai_cursor');
      if (dot) dot.classList.remove('clicking');
    });
  }

  private async findAssociatedInputField(labelElement: any, labelUIElement: any): Promise<{ element: any; selector: string } | null> {
    if (!this.page) return null;
    
    try {
      // Try to find associated input field using various methods
      const result = await this.page.evaluate((el) => {
        if (!(el instanceof HTMLElement)) return null;
        
        // Method 1: If this is a label with 'for' attribute
        if (el.tagName.toLowerCase() === 'label' && el.hasAttribute('for')) {
          const forId = el.getAttribute('for');
          const targetElement = document.getElementById(forId!);
          if (targetElement && ['input', 'textarea'].includes(targetElement.tagName.toLowerCase())) {
            return {
              selector: `#${forId}`,
              tagName: targetElement.tagName.toLowerCase()
            };
          }
        }
        
        // Method 2: Look for input as child or sibling
        const findNearbyInput = (element: HTMLElement): Element | null => {
          // Check children
          const inputChild = element.querySelector('input, textarea');
          if (inputChild) return inputChild;
          
          // Check next siblings
          let sibling = element.nextElementSibling;
          while (sibling && sibling !== element.parentElement?.lastElementChild) {
            if (['input', 'textarea'].includes(sibling.tagName.toLowerCase())) {
              return sibling;
            }
            const inputInSibling = sibling.querySelector('input, textarea');
            if (inputInSibling) return inputInSibling;
            sibling = sibling.nextElementSibling;
          }
          
          // Check previous siblings  
          sibling = element.previousElementSibling;
          while (sibling && sibling !== element.parentElement?.firstElementChild) {
            if (['input', 'textarea'].includes(sibling.tagName.toLowerCase())) {
              return sibling;
            }
            const inputInSibling = sibling.querySelector('input, textarea');
            if (inputInSibling) return inputInSibling;
            sibling = sibling.previousElementSibling;
          }
          
          return null;
        };
        
        const nearbyInput = findNearbyInput(el);
        if (nearbyInput) {
          let selector = '';
          
          // Try to create a stable selector
          if (nearbyInput.id) {
            selector = `#${nearbyInput.id}`;
          } else if (nearbyInput.hasAttribute('name')) {
            selector = `input[name="${nearbyInput.getAttribute('name')}"]`;
          } else if (nearbyInput.hasAttribute('data-testid')) {
            selector = `[data-testid="${nearbyInput.getAttribute('data-testid')}"]`;
          } else {
            // Fallback to xpath-like selector
            const getElementIndex = (element: Element) => {
              let index = 1;
              let sibling = element.previousElementSibling;
              while (sibling) {
                if (sibling.tagName === element.tagName) index++;
                sibling = sibling.previousElementSibling;
              }
              return index;
            };
            
            const tagName = nearbyInput.tagName.toLowerCase();
            const index = getElementIndex(nearbyInput);
            selector = index === 1 ? tagName : `${tagName}:nth-of-type(${index})`;
          }
          
          return {
            selector,
            tagName: nearbyInput.tagName.toLowerCase()
          };
        }
        
        return null;
      }, await labelElement.elementHandle());
      
      if (result && result.selector) {
        const inputElement = this.page.locator(result.selector).first();
        const count = await inputElement.count();
        
        if (count > 0 && await inputElement.isVisible()) {
          console.log(`[Heuristic] Found associated ${result.tagName} via ${result.selector}`);
          return {
            element: inputElement,
            selector: result.selector
          };
        }
      }
      
    } catch (error) {
      console.warn('Error finding associated input field:', error);
    }
    
    return null;
  }

  private async findActualInputElement(element: any): Promise<any | null> {
    if (!this.page) return null;
    
    try {
      // First check if the element itself is already an input/textarea
      const isInputField = await element.evaluate((el: any) => {
        if (!el || !(el instanceof HTMLElement)) return false;
        const tagName = el.tagName.toLowerCase();
        return tagName === 'input' || tagName === 'textarea' || 
               (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false') ||
               el.getAttribute('role') === 'textbox';
      });
      
      if (isInputField) {
        console.log('[Masking] Element is already an input field');
        return element;
      }
      
      // If not, try to find an input field within this element
      const inputInside = await element.evaluate((el: any) => {
        if (!el || !(el instanceof HTMLElement)) return null;
        
        // Look for input/textarea within this element
        const inputField = el.querySelector('input, textarea, [contenteditable="true"], [role="textbox"]');
        if (inputField) {
          // Create a selector for the found input
          if (inputField.id) return `#${inputField.id}`;
          if (inputField.getAttribute('name')) return `input[name="${inputField.getAttribute('name')}"]`;
          if (inputField.getAttribute('data-testid')) return `[data-testid="${inputField.getAttribute('data-testid')}"]`;
          if (inputField.getAttribute('data-unique')) return `[data-unique="${inputField.getAttribute('data-unique')}"]`;
          
          // Last resort: use tag name with index
          const allInputs = Array.from(el.querySelectorAll('input, textarea'));
          const index = allInputs.indexOf(inputField as any) + 1;
          return `${inputField.tagName.toLowerCase()}:nth-of-type(${index})`;
        }
        
        return null;
      });
      
      if (inputInside) {
        console.log(`[Masking] Found input field inside container: ${inputInside}`);
        return this.page.locator(inputInside).first();
      }
      
      // If still no input found, try to find nearby input (sibling)
      const inputNearby = await element.evaluate((el: any) => {
        if (!el || !(el instanceof HTMLElement)) return null;
        
        const parent = el.parentElement;
        if (!parent) return null;
        
        // Look for input in parent or siblings
        const inputField = parent.querySelector('input, textarea, [contenteditable="true"], [role="textbox"]');
        if (inputField && inputField !== el) {
          if (inputField.id) return `#${inputField.id}`;
          if (inputField.getAttribute('name')) return `input[name="${inputField.getAttribute('name')}"]`;
          if (inputField.getAttribute('data-testid')) return `[data-testid="${inputField.getAttribute('data-testid')}"]`;
          if (inputField.getAttribute('data-unique')) return `[data-unique="${inputField.getAttribute('data-unique')}"]`;
        }
        
        return null;
      });
      
      if (inputNearby) {
        console.log(`[Masking] Found nearby input field: ${inputNearby}`);
        return this.page.locator(inputNearby).first();
      }
      
      console.log('[Masking] No input field found, will mask original element');
      return element;
      
    } catch (error) {
      console.warn('Error finding actual input element:', error);
      return element;
    }
  }

  private async maskSensitiveElements(step: StepAction): Promise<void> {
    if (!this.page || !step.label) return;

    try {
      // Ensure CSS for masking is present
      await this.ensureMaskingStylesInjected();

      const element = await this.findElement(step.label, 'any', step.note);
      
      // Try to find the actual input field to mask
      const actualInputElement = await this.findActualInputElement(element);
      
      if (!actualInputElement) {
        console.warn(`[Masking] Could not find input element for: ${step.label}`);
        return;
      }
      
      // Verify we have a valid element before masking
      const elementCount = await actualInputElement.count();
      if (elementCount === 0) {
        console.warn(`[Masking] Input element not found in DOM for: ${step.label}`);
        return;
      }
      
      console.log(`[Masking] Applying mask to input element for: ${step.label}`);
      
      await this.page.evaluate((el) => {
        if (el && el instanceof HTMLElement) {
          // Attribute + class to allow persistent blur on the exact element
          el.setAttribute('data-ai-sensitive-mask', 'true');
          el.classList.add('_ai_sensitive_mask');
          // For inputs, also hide characters (best-effort)
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            (el as any).style.webkitTextSecurity = 'disc';
          }
        }
      }, await actualInputElement.elementHandle());
    } catch (error) {
      console.warn(`Could not mask sensitive element: ${step.label}`, error);
    }
  }
}
