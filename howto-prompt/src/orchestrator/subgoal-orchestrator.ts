import { Page } from 'playwright';
import { PlaywrightRunner, DOMSnapshot } from 'howto-core';
import { StepAction } from 'howto-core';
import { 
  TaskStatus
} from '../core/subgoal-types';
import { 
  PlanningContext, 
  StepExecutionResult 
} from '../core/types';
import { StepPlanner } from '../planner/step-planner';
import { StepExecutor } from '../executor/step-executor';

/**
 * Subgoal Orchestrator - simplified version for DOM+URL+History mode
 * Removed inventory dependencies, focusing on core orchestration logic
 */
export class SubgoalOrchestrator {
  private runner: PlaywrightRunner | null = null;
  private stepPlanner: StepPlanner | null = null;
  private stepExecutor: StepExecutor | null = null;
  private onEvent?: (type: string, data: any) => void;
  private retryCounts: Map<string, number> = new Map();
  
  private state = {
    subgoalProgress: [],
    currentSubgoalIndex: 0,
    totalSubgoals: 0
  };

  constructor(
    runner: PlaywrightRunner,
    stepPlanner: StepPlanner,
    stepExecutor: StepExecutor,
    onEvent?: (type: string, data: any) => void
  ) {
    this.runner = runner;
    this.stepPlanner = stepPlanner;
    this.stepExecutor = stepExecutor;
    this.onEvent = onEvent;
  }

  // Execute goal using subgoal orchestration
  async execute(prompt: string): Promise<{ success: boolean; steps: StepAction[] }> {
    console.log(`[Orchestrator] Starting DOM+URL+History mode execution: "${prompt}"`);
    
    try {
      // Simple execution without complex orchestration for now
      // The main step planner will handle DOM analysis directly
      const page = (this.runner as any)?.page;
      if (!page) {
        throw new Error('No page available');
      }

      const allSteps: StepAction[] = [];
      let maxSteps = 30; // Simple limit
      let lastPlanningResult: any = null; // Track previous planning result for step criteria
      let previousStepState: any = null; // Track previous state for validation
      let lastPlannedKey: string | null = null;
      
      // Define main goal success criteria based on the prompt
      const goalSuccessCriteria = [`The main goal "${prompt}" has been successfully completed`];
      
      for (let i = 0; i < maxSteps; i++) {
        // Get current DOM content and clean it for LLM
        const rawDOM = await page.content();
        const dom = DOMSnapshot.cleanHTMLForLLM(rawDOM, {
          url: page.url(),
          title: await page.title(),
          label: prompt,
          elementType: 'step_planning'
        });
        const currentUrl = page.url();
        
        // Capture fresh full-page screenshot for planning context
        let screenshot: string | undefined;
        try {
          console.log('📸 [SubgoalOrchestrator] Capturing fresh full-page screenshot for planning');
          screenshot = await page.screenshot({ 
            fullPage: true, 
            type: 'png',
            encoding: 'base64',
            animations: 'disabled'
          });
          // Convert Buffer to string if needed
          if (Buffer.isBuffer(screenshot)) {
            screenshot = screenshot.toString('base64');
          }
          const preview = screenshot ? screenshot.substring(0, 12) : 'none';
          console.log(`📸 [SubgoalOrchestrator] Screenshot captured (base64 length: ${screenshot ? screenshot.length : 0}, preview: ${preview})`);
        } catch (error) {
          console.warn('[SubgoalOrchestrator] Failed to capture screenshot for planning:', error);
        }
        
        // Build planning context for DOM+URL+History mode
        const context: PlanningContext = {
          prompt,
          currentUrl,
          visitedUrls: new Set([currentUrl]),
          memory: { 
            elements: new Map(), 
            synonyms: new Map(), 
            screenFingerprints: new Set(), 
            navigationPaths: new Map() 
          },
          cleanedDOM: dom,
          stepHistory: allSteps,
          goalProgress: i / maxSteps,
          secretsKeys: [],
          varsKeys: [],
          // Include screenshot for visual planning context
          screenshot: screenshot ? `data:image/png;base64,${screenshot}` : undefined,
          // Include previous step criteria for validation and confidence adjustment
          previousStepReasoning: lastPlanningResult?.stepReasoning,
          // Include validation context for combined planning+validation
          goalCriteria: (i > 0 && lastPlanningResult?.stepReasoning && previousStepState) ? goalSuccessCriteria : undefined,
          previousState: previousStepState
        };

        // Plan next step using DOM analysis
        if (!this.stepPlanner) {
          throw new Error('Step planner not available');
        }
        // Emit planning start (include planning screenshot for UI preview)
        this.onEvent?.('step_planning', { 
          stepIndex: i, 
          context: 'dom+url', 
          currentUrl,
          screenshot: screenshot ? `data:image/png;base64,${screenshot}` : undefined,
          screenshotMime: screenshot ? 'image/png' : undefined
        });
        const planningResult = await this.stepPlanner.planOneStepWithConfidence(context);
        const step = planningResult.step;
        // Emit planned (echo planning screenshot for event log continuity)
        this.onEvent?.('step_planned', { 
          step, 
          reasoning: planningResult.stepReasoning, 
          confidence: planningResult.confidence || 0, 
          alternatives: planningResult.alternatives || [],
          screenshot: screenshot ? `data:image/png;base64,${screenshot}` : undefined,
          screenshotMime: screenshot ? 'image/png' : undefined
        });
        
        // Store this planning result for the next iteration's validation
        lastPlanningResult = planningResult;
        
        console.log(`[Orchestrator] Step ${i + 1}: ${step.type}(${step.label || step.url})`);
        
        // Log previous step validation results if available
        if (planningResult.previousStepValidation) {
          const validation = planningResult.previousStepValidation;
          console.log(`[Orchestrator] Previous step validation: ${validation.fulfilled.length}/${validation.fulfilled.length + validation.pending.length} criteria fulfilled`);
          if (validation.confidenceAdjustment) {
            console.log(`[Orchestrator] Confidence adjusted by factor: ${validation.confidenceAdjustment.toFixed(2)}`);
          }
          // Emit validation event
          try {
            const fulfilled = Array.isArray(validation.fulfilled) ? validation.fulfilled : [];
            const pending = Array.isArray(validation.pending) ? validation.pending : [];
            this.onEvent?.('validation_performed', { 
              fulfilled, 
              pending, 
              validationSuccess: pending.length === 0,
              screenshot: (previousStepState && previousStepState.screenshot) ? previousStepState.screenshot : undefined,
              screenshotMime: (previousStepState && previousStepState.screenshot) ? 'image/png' : undefined
            });
          } catch {}
        }

        // Detect repeated step (retry/refinement behavior)
        const key = `${step.type}:${(step as any).label || (step as any).url || (step as any).key || ''}`;
        if (lastPlannedKey && key === lastPlannedKey) {
          const attempts = (this.retryCounts.get(key) || 1) + 1;
          this.retryCounts.set(key, attempts);
          this.onEvent?.('step_refinement_started', { stepIndex: i, reason: 'previous validation pending or ineffective', attempts });
        } else {
          this.retryCounts.set(key, 1);
        }
        lastPlannedKey = key;

        // Execute the step
        if (!this.stepExecutor) {
          throw new Error('Step executor not available');
        }

        this.onEvent?.('step_executing', { stepIndex: i, step });
        const executionResult = await this.stepExecutor.executeStep(
          step, 
          i, 
          planningResult.stepReasoning // Pass step reasoning (no longer passing goal criteria separately)
        );
        allSteps.push(step);
        this.onEvent?.('step_executed', { stepIndex: i, result: executionResult });

        if (!executionResult.success) {
          console.log(`[Orchestrator] Step failed: ${executionResult.error}`);
          break;
        }

        // Capture current state for validation in next iteration
        const currentPageUrl = page.url();
        const currentPageDOM = DOMSnapshot.cleanHTMLForLLM(await page.content(), {
          url: currentPageUrl,
          title: await page.title(),
          label: prompt,
          elementType: 'step_validation'
        });
        
        // Capture screenshot for validation context
        let currentScreenshot: string | undefined;
        try {
          currentScreenshot = await page.screenshot({ 
            fullPage: true, 
            type: 'png',
            encoding: 'base64',
            animations: 'disabled'
          });
          if (Buffer.isBuffer(currentScreenshot)) {
            currentScreenshot = currentScreenshot.toString('base64');
          }
        } catch (error) {
          console.warn('[SubgoalOrchestrator] Failed to capture screenshot for validation:', error);
        }

        previousStepState = {
          dom: currentPageDOM,
          url: currentPageUrl,
          stepHistory: [...allSteps],
          navigationOccurred: executionResult.uiChanges?.navigationOccurred || false,
          screenshot: currentScreenshot ? `data:image/png;base64,${currentScreenshot}` : undefined,
          screenshotBase64: currentScreenshot,
          screenshotMime: 'image/png'
        };

        // Check validation results from combined planning response
        if (planningResult.stepValidation || planningResult.goalValidation) {
          const stepValidation = planningResult.stepValidation;
          const goalValidation = planningResult.goalValidation;
          
          console.log(`[Orchestrator] Combined validation results from planning:`);
          console.log(`  Step validation:`, stepValidation);
          console.log(`  Goal validation:`, goalValidation);
          
          // Check if goal is complete
          const allGoalsFulfilled = goalValidation && goalValidation.isComplete;
          
          if (allGoalsFulfilled) {
            console.log(`[Orchestrator] Goal completed according to combined validation!`);
            break;
          }
        }

        // Fallback completion check based on step type for backward compatibility
        if (step.type === 'assert_page' && executionResult.success) {
          console.log(`[Orchestrator] Goal completed successfully (fallback check)`);
          break;
        }

        // Progress update
        this.onEvent?.('goal_progress', { progress: (i + 1) / maxSteps });
        // Avoid infinite loops
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      return { success: true, steps: allSteps };

    } catch (error) {
      console.error(`[Orchestrator] Execution failed: ${error}`);
      return { success: false, steps: [] };
    }
  }

  // Get current orchestrator state
  getCurrentState() {
    return this.state;
  }

  // Simple helper methods
  private getSecretsKeys(): string[] {
    return [];
  }

  private getVarsKeys(): string[] {
    return [];
  }

  private getStatusIcon(status: TaskStatus): string {
    switch (status) {
      case 'pending': return '⏳';
      case 'in_progress': return '🔄';
      case 'completed': return '✅';
      case 'failed': return '❌';
      case 'skipped': return '⏭️';
      default: return '❓';
    }
  }
}
