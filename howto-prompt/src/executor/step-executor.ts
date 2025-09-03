import { PlaywrightRunner, SecretsManager, VariablesManager, DOMSnapshot } from 'howto-core';
import { StepAction } from 'howto-core';
import { StepExecutionResult } from '../core/types';
import { SubgoalLLMProvider } from '../core/subgoal-types';

export class StepExecutor {
  private runner: PlaywrightRunner;
  private screenshotDir: string;
  private secretsManager: SecretsManager;
  private variablesManager: VariablesManager;
  private domSnapshotDir: string;
  private llmProvider?: SubgoalLLMProvider;
  private stepCriteria?: string[];
  private goalCriteria?: string[];

  constructor(
    runner: PlaywrightRunner, 
    screenshotDir: string = './output/screenshots', 
    domSnapshotDir: string = './output/dom-snapshots', 
    secrets?: Record<string, any>, 
    variables?: Record<string, any>,
    llmProvider?: SubgoalLLMProvider,
    stepCriteria?: string[],
    goalCriteria?: string[]
  ) {
    this.runner = runner;
    this.screenshotDir = screenshotDir;
    this.domSnapshotDir = domSnapshotDir;
    this.secretsManager = new SecretsManager(secrets);
    this.variablesManager = new VariablesManager(variables);
    this.llmProvider = llmProvider;
    this.stepCriteria = stepCriteria;
    this.goalCriteria = goalCriteria;
  }

  // Set success criteria and LLM provider for validation
  setValidationConfig(llmProvider: SubgoalLLMProvider, stepCriteria: string[], goalCriteria: string[]): void {
    this.llmProvider = llmProvider;
    this.stepCriteria = stepCriteria;
    this.goalCriteria = goalCriteria;
    console.log('[StepExecutor] Success criteria validation enabled:');
    console.log('  Step criteria:', stepCriteria);
    console.log('  Goal criteria:', goalCriteria);
  }

  // Resolve secret placeholders in a step
  private resolveSecretsAndVariables(step: StepAction): StepAction {
    if (step.type !== 'type') {
      return step;
    }

    // Normalize non-string values from upstream providers
    let value: any = step.value;
    if (value !== undefined && typeof value !== 'string') {
      if (value && typeof value === 'object') {
        if (typeof value.placeholder === 'string') value = value.placeholder;
        else if (typeof value.value === 'string') value = value.value;
      }
      if (typeof value !== 'string') {
        value = 'NEEDS_USER_INPUT';
      }
    }

    if (!value) {
      return { ...step, value } as StepAction;
    }

    // 1) Secrets
    const resolution = this.secretsManager.resolvePlaceholder(value);
    if (resolution.isSecretRef) {
      if (resolution.resolved) {
        // Replace placeholder with actual value and mark as sensitive
        return {
          ...step,
          value: resolution.resolved,
          sensitive: true
        };
      } else {
        throw new Error(`Secret key not found: ${resolution.key}`);
      }
    }

    // 2) Variables (non-sensitive)
    const vres = this.variablesManager.resolvePlaceholder(value);
    if (vres.isVarRef) {
      if (vres.resolved === undefined) throw new Error(`Variable key not found: ${vres.key}`);
      return { ...step, value: vres.resolved } as StepAction;
    }

    return { ...step, value } as StepAction;
  }

  // Execute a single step and return detailed result
  async executeStep(step: StepAction, stepIndex: number, stepReasoning?: string): Promise<StepExecutionResult> {
    const startTime = Date.now();
    
    // Resolve secret placeholders if present
    const resolvedStep = this.resolveSecretsAndVariables(step);
    
    console.log(`[STEP ${stepIndex + 1}] Executing: ${resolvedStep.type}(${resolvedStep.label || resolvedStep.url})`);
    
    try {
      // Capture URL before action to detect navigation reliably
      const pageBefore = this.getPage();
      const beforeUrl = pageBefore ? pageBefore.url() : undefined;

      // Execute step using PlaywrightRunner
      const result = await this.runner.executeStep(
        resolvedStep, 
        stepIndex, 
        { title: 'Generated Guide', baseUrl: '', steps: [] }, // Minimal config
        this.screenshotDir,
        this.domSnapshotDir
      );

      const duration = Date.now() - startTime;
      
      if (result.success) {
        // After successful actions, especially click/goto, wait for UI to settle
        if (resolvedStep.type === 'click' || resolvedStep.type === 'goto') {
          await this.waitForStabilization(3000);
          // Extra quiescence to avoid stale SPA DOM
          await this.waitForDOMQuiescence(1200, 350).catch(() => {});
          
          // Additional wait for dropdown overlays after click actions
          if (resolvedStep.type === 'click' && resolvedStep.label) {
            await this.waitForDropdownOverlay(resolvedStep.label);
          }
          // UI graph refresh removed
        }

        // Determine navigation by comparing URLs
        const pageAfter = this.getPage();
        const afterUrl = pageAfter ? pageAfter.url() : undefined;
        const navOccurred = Boolean(beforeUrl && afterUrl && beforeUrl !== afterUrl) || resolvedStep.type === 'goto';

        console.log(`[STEP ${stepIndex + 1}] ✓ Success (${duration}ms)`);
        
        return {
          step: resolvedStep,
          success: true,
          screenshot: result.screenshot,
          domSnapshot: result.domSnapshot,
          duration,
          timestamp: startTime,
          uiChanges: await this.detectUIChanges(resolvedStep, beforeUrl, afterUrl, navOccurred)
        };
      } else {
        console.log(`[STEP ${stepIndex + 1}] ✗ Failed: ${result.error} (${duration}ms)`);
        
        return {
          step: resolvedStep,
          success: false,
          error: result.error || 'Unknown error',
          errorType: this.classifyError(result.error || ''),
          screenshot: result.screenshot,
          domSnapshot: result.domSnapshot,
          duration,
          timestamp: startTime,
          uiChanges: await this.detectUIChanges(resolvedStep, beforeUrl)
        };
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      console.log(`[STEP ${stepIndex + 1}] ✗ Exception: ${errorMessage} (${duration}ms)`);
      
      return {
        step: resolvedStep,
        success: false,
        error: errorMessage,
        errorType: this.classifyError(errorMessage),
        duration,
        timestamp: startTime
      };
    }
  }



  // UI graph access removed in DOM+LLM mode

  // Detect if navigation or significant UI changes occurred
  private async detectUIChanges(
    step: StepAction,
    beforeUrl?: string,
    afterUrl?: string,
    navHint?: boolean
  ): Promise<StepExecutionResult['uiChanges']> {
    try {
      const page = this.getPage();
      if (!page) {
        return undefined;
      }

      // Always get current URL after step execution
      const currentUrl = page.url();
      
      // Determine navigation: direct URL comparison first, then heuristics
      const urlChanged = Boolean(beforeUrl && currentUrl && beforeUrl !== currentUrl);
      const navigationOccurred = Boolean(navHint) || urlChanged || step.type === 'goto' ||
                                 step.type === 'assert_page' ||
                                 (step.type === 'click' && this.mayHaveNavigated(step, currentUrl));

      // Count visible elements (simplified change detection)
      const elementCount = await page.locator('*').count();

      console.log(`[UI-Changes] Step: ${step.type}, URL: ${currentUrl}, Navigation: ${navigationOccurred}`);

      return {
        navigationOccurred,
        newUrl: navigationOccurred ? currentUrl : undefined,
        elementsAppeared: elementCount, // Simplified - would need before/after comparison
        elementsDisappeared: 0
      };

    } catch (error) {
      console.warn('Failed to detect UI changes:', error);
      return undefined;
    }
  }

  // Heuristic to detect if a click might have caused navigation
  private mayHaveNavigated(step: StepAction, currentUrl: string): boolean {
    if (step.type !== 'click' || !step.label) {
      return false;
    }

    const label = step.label.toLowerCase();
    const url = currentUrl.toLowerCase();
    
    // Common navigation triggers
    const navigationTriggers = [
      'login', 'sign in', 'anmelden', 'submit',
      'continue', 'next', 'weiter',
      'save', 'speichern', 'create', 'erstellen'
    ];
    
    const isNavTrigger = navigationTriggers.some(trigger => 
      label.includes(trigger)
    );
    
    // URL change indicators
    const hasUrlParams = url.includes('?') || url.includes('#');
    const hasForward = url.includes('forward=') || url.includes('redirect=');
    
    console.log(`[Navigation Heuristic] Label: "${label}", URL params: ${hasUrlParams}, Forward: ${hasForward}, Nav trigger: ${isNavTrigger}`);
    
    return isNavTrigger || hasUrlParams || hasForward;
  }

  // Classify error types for better refinement
  private classifyError(errorMessage: string): StepExecutionResult['errorType'] {
    const message = errorMessage.toLowerCase();

    if (message.includes('not found') || 
        message.includes('no element') ||
        message.includes('cannot find')) {
      return 'not_found';
    }

    if (message.includes('not visible') || 
        message.includes('not attached') ||
        message.includes('hidden')) {
      return 'not_visible';
    }

    if (message.includes('timeout') || 
        message.includes('waiting')) {
      return 'timeout';
    }

    if (message.includes('type') && 
        (message.includes('mismatch') || message.includes('invalid'))) {
      return 'type_mismatch';
    }

    if (message.includes('navigation') || 
        message.includes('page') ||
        message.includes('url')) {
      return 'navigation_failed';
    }

    return undefined;
  }

  // Get current page from runner
  private getPage(): any {
    return this.runner.getPage();
  }

  // Wait for page to stabilize after step execution
  async waitForStabilization(timeoutMs: number = 3000): Promise<void> {
    try {
      const page = this.getPage();
      if (page) {
        await page.waitForLoadState('networkidle', { timeout: timeoutMs });
      }
    } catch (error) {
      // Ignore timeout errors - page might be stable enough
      console.debug('Page stabilization timeout (continuing)');
    }
  }

  // Additional quiescence wait leveraging MutationObserver for SPA updates
  private async waitForDOMQuiescence(totalTimeoutMs: number = 1200, quietWindowMs: number = 350): Promise<void> {
    try {
      const page = this.getPage();
      if (!page) return;
      // Ensure DOM is at least parsed
      try { await page.waitForLoadState('domcontentloaded', { timeout: Math.min(800, totalTimeoutMs) }); } catch {}
      await page.evaluate((params: any) => {
        const win: any = (globalThis as any);
        return new Promise<void>((resolve) => {
          let timer: any = null;
          const done = () => { obs.disconnect(); resolve(); };
          const Obs = win.MutationObserver || win.WebKitMutationObserver || win.MozMutationObserver;
          const obs = new Obs(() => {
            win.clearTimeout(timer);
            timer = win.setTimeout(() => done(), params.quietWindowMs);
          });
          obs.observe(win.document, { subtree: true, childList: true, attributes: true });
          // Initial quiet window
          timer = win.setTimeout(() => done(), params.quietWindowMs);
          // Absolute timeout safety
          win.setTimeout(() => done(), params.totalTimeoutMs);
        });
      }, { quietWindowMs, totalTimeoutMs });
      // Double RAF to ensure paint
      try { await this.getPage()?.evaluate(() => new Promise<void>((r) => {
        const win: any = (globalThis as any);
        const raf = win.requestAnimationFrame.bind(win);
        raf(() => raf(() => r()));
      })); } catch {}
    } catch {}
  }

  // Wait for potential dropdown overlays after click (non-deterministic, best-effort)
  private async waitForDropdownOverlay(clickedLabel: string): Promise<void> {
    try {
      const page = this.getPage();
      if (!page) return;

      // Simple approach: just wait a bit longer for potential overlays to appear
      // Let the DOM quiescence and stabilization handle the rest
      await page.waitForTimeout(500);
      console.debug(`[Dropdown] Additional overlay wait completed for "${clickedLabel}"`);

    } catch (error) {
      // Non-critical - continue execution
      console.debug('Dropdown overlay wait completed');
    }
  }

  // Take screenshot for debugging
  async takeDebugScreenshot(label: string): Promise<string | undefined> {
    try {
      const page = this.getPage();
      if (!page) {
        return undefined;
      }

      const timestamp = Date.now();
      const filename = `debug-${label}-${timestamp}.png`;
      const filepath = `${this.screenshotDir}/${filename}`;
      
      await page.screenshot({ path: filepath, fullPage: true, animations: 'disabled' });
      return filepath;
    } catch (error) {
      console.warn('Failed to take debug screenshot:', error);
      return undefined;
    }
  }
}
