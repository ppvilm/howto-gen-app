import { 
  HowtoPrompt, 
  HowtoPromptOptions,
  HowtoPromptResult,
  PromptEvent,
  PromptStreamEvent
} from 'howto-prompt';
import { WorkspaceManager, sessionManager, SessionStatus, SessionEvent } from 'howto-core';

export interface PromptGenerateOptions {
  baseUrl: string;
  model?: string;
  headful?: boolean;
  outputDir?: string;
  maxSteps?: number;
  maxRefines?: number;
  language?: string;
  interactive?: boolean;
  secrets?: Record<string, string>;
  variables?: Record<string, any>;
  // Workspace options
  workspacePath?: string;
  flowName?: string;
  sessionId?: string;
  useWorkspace?: boolean;
  // Optional: force a specific scriptId for async background generation
  scriptId?: string;
  // Optional: enhance resulting markdown with TTS
  tts?: boolean;
}

export interface PromptResult extends HowtoPromptResult {
  sessionId?: string;
  workspacePath?: string;
  flowName?: string;
  scriptPath?: string;
}

// Combined event type for prompt streaming (session events + prompt events)
export type PromptStreamEventCombined = SessionEvent | PromptEvent;

export class Prompt {
  /**
   * Generate howto guide from natural language prompt
   * Supports both workspace and legacy modes
   */
  static async generate(userPrompt: string, options: PromptGenerateOptions): Promise<PromptResult> {
    let workspaceManager: WorkspaceManager | undefined;
    let outputDir = options.outputDir || './output';
    let scriptId: string | undefined;

    // Determine if we should use workspace mode
    const useWorkspace = options.useWorkspace !== false && (!options.outputDir || options.workspacePath || options.flowName);
    
    if (useWorkspace) {
      // Create workspace manager
      const flowName = options.flowName || require('path').basename(process.cwd());
      
      if (options.workspacePath) {
        workspaceManager = new WorkspaceManager({
          workspacePath: options.workspacePath,
          flowName: flowName,
          sessionId: options.sessionId
        });
      } else {
        workspaceManager = WorkspaceManager.create(flowName, options.sessionId);
      }

      await workspaceManager.ensureWorkspace();
      // For prompt command: create UUID folder within scripts for assets
      const crypto = await import('crypto');
      const path = await import('path');
      scriptId = crypto.randomUUID();
      const scriptsPath = workspaceManager.getGeneratedScriptsPath();
      outputDir = path.join(scriptsPath, scriptId);
    }

    const promptOptions: HowtoPromptOptions = {
      baseUrl: options.baseUrl,
      model: options.model || 'gemini-2.5-flash',
      headless: !options.headful, // Note: SDK uses headful, prompt uses headless (inverted)
      outputDir,
      maxSteps: options.maxSteps || 30,
      maxRefinesPerStep: options.maxRefines || 3,
      language: options.language || 'en',
      interactive: options.interactive || false,
      secrets: options.secrets,
      variables: options.variables
    };
    
    const generator = new HowtoPrompt(promptOptions);
    const result = await generator.generate(userPrompt);

    // Save generated script to output directory
    let scriptPath: string | undefined;
    if (result.success) {
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        
        const scriptFilename = 'generated-guide.md';
        
        // In workspace mode, outputDir is already the UUID folder
        // In legacy mode, create a UUID folder
        let actualScriptId = scriptId;
        if (!scriptId) {
          const crypto = await import('crypto');
          actualScriptId = crypto.randomUUID();
          const scriptFolder = path.join(outputDir, actualScriptId);
          await fs.mkdir(scriptFolder, { recursive: true });
          scriptPath = path.join(scriptFolder, scriptFilename);
        } else {
          // outputDir is already the UUID folder
          await fs.mkdir(outputDir, { recursive: true });
          scriptPath = path.join(outputDir, scriptFilename);
        }
        
        // Optionally enhance with TTS
        let fullMarkdown = result.markdown;
        if (options.tts) {
          try {
            const { TTS } = await import('./tts');
            const kbPrompt = typeof options.variables?.['knowledge_base'] === 'string' ? String(options.variables?.['knowledge_base']).trim() : '';
            const ttsPrompt = kbPrompt || userPrompt;
            fullMarkdown = await TTS.enhanceContent(fullMarkdown, ttsPrompt, { language: options.language });
          } catch {}
        }
        
        await fs.writeFile(scriptPath, fullMarkdown, 'utf-8');
      } catch (error) {
        // If saving script fails, continue without error
        console.warn('Failed to save script to output directory:', error);
      }
    }
    
    // Enhance result with workspace info
    const enhancedResult: PromptResult = {
      ...result,
      sessionId: workspaceManager?.getSessionId(),
      workspacePath: workspaceManager?.getWorkspacePath(),
      flowName: workspaceManager?.getFlowName(),
      scriptPath
    };
    
    return enhancedResult;
  }

  /**
   * Generate howto guide from natural language prompt with streaming events
   * Supports both workspace and legacy modes
   */
  static async *generateStream(userPrompt: string, options: PromptGenerateOptions): AsyncGenerator<PromptEvent, PromptResult> {
    let workspaceManager: WorkspaceManager | undefined;
    let outputDir = options.outputDir || './output';
    let scriptId: string | undefined;

    // Determine if we should use workspace mode
    const useWorkspace = options.useWorkspace !== false && (!options.outputDir || options.workspacePath || options.flowName);
    
    if (useWorkspace) {
      // Create workspace manager
      const flowName = options.flowName || require('path').basename(process.cwd());
      
      if (options.workspacePath) {
        workspaceManager = new WorkspaceManager({
          workspacePath: options.workspacePath,
          flowName: flowName,
          sessionId: options.sessionId
        });
      } else {
        workspaceManager = WorkspaceManager.create(flowName, options.sessionId);
      }

      await workspaceManager.ensureWorkspace();
      // For prompt command: create UUID folder within scripts for assets
      const crypto = await import('crypto');
      const path = await import('path');
      scriptId = crypto.randomUUID();
      const scriptsPath = workspaceManager.getGeneratedScriptsPath();
      outputDir = path.join(scriptsPath, scriptId);
    }

    const promptOptions: HowtoPromptOptions = {
      baseUrl: options.baseUrl,
      model: options.model || 'gemini-2.5-flash',
      headless: !options.headful, // Note: SDK uses headful, prompt uses headless (inverted)
      outputDir,
      maxSteps: options.maxSteps || 30,
      maxRefinesPerStep: options.maxRefines || 3,
      language: options.language || 'en',
      interactive: options.interactive || false,
      secrets: options.secrets,
      variables: options.variables
    };
    
    const generator = new HowtoPrompt(promptOptions);
    const result = yield* generator.generateStream(userPrompt);

    // Save generated script to output directory
    let scriptPath: string | undefined;
    if (result.success) {
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        
        const scriptFilename = 'generated-guide.md';
        
        // In workspace mode, outputDir is already the UUID folder
        // In legacy mode, create a UUID folder
        let actualScriptId = scriptId;
        if (!scriptId) {
          const crypto = await import('crypto');
          actualScriptId = crypto.randomUUID();
          const scriptFolder = path.join(outputDir, actualScriptId);
          await fs.mkdir(scriptFolder, { recursive: true });
          scriptPath = path.join(scriptFolder, scriptFilename);
        } else {
          // outputDir is already the UUID folder
          await fs.mkdir(outputDir, { recursive: true });
          scriptPath = path.join(outputDir, scriptFilename);
        }
        
        // Optionally enhance with TTS
        let fullMarkdown = result.markdown;
        if (options.tts) {
          try {
            const { TTS } = await import('./tts');
            const kbPrompt = typeof options.variables?.['knowledge_base'] === 'string' ? String(options.variables?.['knowledge_base']).trim() : '';
            const ttsPrompt = kbPrompt || userPrompt;
            fullMarkdown = await TTS.enhanceContent(fullMarkdown, ttsPrompt, { language: options.language });
          } catch {}
        }
        
        await fs.writeFile(scriptPath, fullMarkdown, 'utf-8');
      } catch (error) {
        // If saving script fails, continue without error
        console.warn('Failed to save script to output directory:', error);
      }
    }
    
    // Enhance result with workspace info
    return {
      ...result,
      sessionId: workspaceManager?.getSessionId(),
      workspacePath: workspaceManager?.getWorkspacePath(),
      flowName: workspaceManager?.getFlowName(),
      scriptPath
    };
  }

  // ===== ASYNC METHODS WITH EVENT STREAMING =====

  /**
   * Generate script from natural language prompt (async, no session management)
   * Returns script ID immediately - the script will be generated in the background
   */
  static async startGenerateAsync(
    userPrompt: string, 
    options: PromptGenerateOptions
  ): Promise<string> {
    let workspaceManager: WorkspaceManager | undefined;
    let outputDir = options.outputDir || './output';
    let scriptId: string;

    // Determine if we should use workspace mode
    const useWorkspace = options.useWorkspace !== false && (!options.outputDir || options.workspacePath || options.flowName);
    
    if (useWorkspace) {
      // Create workspace manager
      const flowName = options.flowName || require('path').basename(process.cwd());
      
      if (options.workspacePath) {
        workspaceManager = new WorkspaceManager({
          workspacePath: options.workspacePath,
          flowName: flowName,
          sessionId: options.sessionId
        });
      } else {
        workspaceManager = WorkspaceManager.create(flowName, options.sessionId);
      }

      await workspaceManager.ensureWorkspace();
      // For prompt command: create UUID folder within scripts for assets
      const crypto = await import('crypto');
      const path = await import('path');
      scriptId = options.scriptId || crypto.randomUUID();
      const scriptsPath = workspaceManager.getGeneratedScriptsPath();
      outputDir = path.join(scriptsPath, scriptId);
    } else {
      // Legacy mode
      const crypto = await import('crypto');
      scriptId = options.scriptId || crypto.randomUUID();
    }

    const promptOptions: HowtoPromptOptions = {
      baseUrl: options.baseUrl,
      model: options.model || 'gemini-2.5-flash',
      headless: !options.headful, // Note: SDK uses headful, prompt uses headless (inverted)
      outputDir,
      maxSteps: options.maxSteps || 30,
      maxRefinesPerStep: options.maxRefines || 3,
      language: options.language || 'en',
      interactive: options.interactive || false,
      secrets: options.secrets,
      variables: options.variables
    };

    // Create a prompt session using scriptId as session identifier
    // Prompt pipeline: sessionId === scriptId
    const session = sessionManager.createSession(scriptId, 'prompt');
    let cancelled = false;
    sessionManager.setSessionCleanup(scriptId, () => {
      cancelled = true;
    });

    setImmediate(async () => {
      try {
        sessionManager.startSession(scriptId);

        const generator = new HowtoPrompt(promptOptions);

        // Prepare event log file for cross-process streaming
        const fsp = await import('fs/promises');
        const path = await import('path');
        await fsp.mkdir(outputDir, { recursive: true });
        const eventsPath = path.join(outputDir, 'events.ndjson');
        const appendEvent = async (evt: any) => {
          try {
            await fsp.appendFile(eventsPath, JSON.stringify(evt) + '\n', 'utf-8');
          } catch {}
        };

        // Emit session_started to file immediately
        await appendEvent({ type: 'session_started', sessionId: scriptId });

        // Stream prompt events and mirror to session + file, while capturing final result
        let resultMarkdown: string | undefined;
        let resultSteps: any[] | undefined;
        let resultSuccess: boolean | undefined;
        const iter = generator.generateStream(userPrompt);
        while (true) {
          const { value, done } = await iter.next();
          if (done) {
            const finalResult = value as HowtoPromptResult;
            if (finalResult) {
              resultMarkdown = finalResult.markdown;
              resultSteps = finalResult.steps;
              resultSuccess = finalResult.success;
            }
            break;
          }
          const evt: any = value as any;
          // Enrich events with artifact paths/URLs for UI consumption
          try {
            if (evt && typeof evt === 'object' && outputDir) {
              const pathMod = await import('path');
              if (evt.type === 'step_executed' && evt.result) {
                const shot = evt.result.screenshot as string | undefined;
                if (shot) {
                  const abs = pathMod.join(outputDir, 'screenshots', shot);
                  (evt as any).screenshotPath = abs;
                  (evt as any).screenshotUrl = `/files?path=${encodeURIComponent(abs)}`;
                }
                const dom = evt.result.domSnapshot as string | undefined;
                if (dom) {
                  const absDom = pathMod.join(outputDir, 'dom-snapshots', dom);
                  (evt as any).domSnapshotPath = absDom;
                  (evt as any).domSnapshotUrl = `/files?path=${encodeURIComponent(absDom)}`;
                }
              }
            }
          } catch {}
          if (cancelled) break;
          // Mirror event to session stream
          try { sessionManager.emitEvent(scriptId, evt); } catch {}
          // Write to events file
          await appendEvent(evt);
        }

        if (cancelled) {
          return;
        }

        // Emit markdown generated event (PromptEvent)
        try {
          const evt = {
            type: 'markdown_generated',
            scriptId,
            markdown: resultMarkdown || '',
            stepCount: (resultSteps?.length) || 0
          };
          sessionManager.emitEvent(scriptId, evt);
          await appendEvent(evt);
        } catch {}

        // Save generated script to output directory with prompt events
        try {
          const scriptFilename = 'generated-guide.md';

          const saving = { type: 'script_saving', scriptId };
          sessionManager.emitEvent(scriptId, saving);
          await appendEvent(saving);

          if (!useWorkspace) {
            const scriptFolder = path.join(outputDir, scriptId);
            await fsp.mkdir(scriptFolder, { recursive: true });
            const outPath = path.join(scriptFolder, scriptFilename);
            let toWrite = resultMarkdown || '';
            if (options.tts) {
              try {
                const { TTS } = await import('./tts');
                const kbPrompt = typeof options.variables?.['knowledge_base'] === 'string' ? String(options.variables?.['knowledge_base']).trim() : '';
                const ttsPrompt = kbPrompt || userPrompt;
                toWrite = await TTS.enhanceContent(toWrite, ttsPrompt, { language: options.language });
              } catch {}
            }
            await fsp.writeFile(outPath, toWrite, 'utf-8');
            const saved: any = { type: 'script_saved', scriptId, path: outPath };
            try { saved.url = `/files?path=${encodeURIComponent(outPath)}`; } catch {}
            sessionManager.emitEvent(scriptId, saved);
            await appendEvent(saved);
          } else {
            const outPath = path.join(outputDir, scriptFilename);
            let toWrite = resultMarkdown || '';
            if (options.tts) {
              try {
                const { TTS } = await import('./tts');
                const kbPrompt = typeof options.variables?.['knowledge_base'] === 'string' ? String(options.variables?.['knowledge_base']).trim() : '';
                const ttsPrompt = kbPrompt || userPrompt;
                toWrite = await TTS.enhanceContent(toWrite, ttsPrompt, { language: options.language });
              } catch {}
            }
            await fsp.writeFile(outPath, toWrite, 'utf-8');
            const saved: any = { type: 'script_saved', scriptId, path: outPath };
            try { saved.url = `/files?path=${encodeURIComponent(outPath)}`; } catch {}
            sessionManager.emitEvent(scriptId, saved);
            await appendEvent(saved);
          }
        } catch (error) {
          console.warn(`Failed to save script ${scriptId}:`, error);
        }

        // Emit completed
        try {
          const completed = {
            type: 'completed',
            success: resultSuccess ?? true,
            markdown: resultMarkdown || '',
            steps: resultSteps || [],
            scriptId
          };
          sessionManager.emitEvent(scriptId, completed);
          await appendEvent(completed);
        } catch {}

        sessionManager.completeSession(scriptId, resultSuccess ?? true, resultSuccess ? undefined : 'Generation failed');
        // Persist terminal session event
        const terminal = sessionManager.getSessionStatus(scriptId)?.status;
        if (terminal === 'completed') {
          await appendEvent({ type: 'session_completed', sessionId: scriptId, scriptId });
        } else if (terminal === 'failed') {
          await appendEvent({ type: 'session_failed', sessionId: scriptId, scriptId });
        }
      } catch (error) {
        if (!cancelled) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          sessionManager.completeSession(scriptId, false, errorMessage);
          try {
            const fsp = await import('fs/promises');
            const path = await import('path');
            await fsp.mkdir(outputDir, { recursive: true });
            await fsp.appendFile(path.join(outputDir, 'events.ndjson'), JSON.stringify({ type: 'session_failed', sessionId: scriptId, scriptId, error: errorMessage }) + '\n', 'utf-8');
          } catch {}
        }
      }
    });

    return scriptId;
  }

  /**
   * Check if script exists (simple file check)
   */
  static async scriptExists(scriptId: string, flowName?: string, workspacePath?: string): Promise<boolean> {
    try {
      const { WorkspaceManager } = await import('howto-core');
      const workspaceManager = workspacePath ? 
        new WorkspaceManager({ workspacePath, flowName: flowName || 'default' }) :
        WorkspaceManager.create(flowName);
      
      const path = await import('path');
      const fs = await import('fs/promises');
      const scriptsPath = workspaceManager.getGeneratedScriptsPath();
      const scriptDir = path.join(scriptsPath, scriptId);
      
      const dirStat = await fs.stat(scriptDir);
      if (dirStat.isDirectory()) {
        const files = await fs.readdir(scriptDir);
        return files.some(file => file.endsWith('.md'));
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Wait for script generation to complete (polling-based)
   */
  static async waitForScriptGeneration(scriptId: string, flowName?: string, workspacePath?: string, timeoutMs: number = 300000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      if (await this.scriptExists(scriptId, flowName, workspacePath)) {
        return true;
      }
      // Wait 1 second before next check
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return false; // Timeout reached
  }

  /**
   * Subscribe to prompt generation events by scriptId
   * Yields SessionEvents and PromptEvents until session ends
   */
  static async *subscribeGenerateAsync(scriptId: string): AsyncGenerator<PromptStreamEventCombined, PromptResult> {
    const emitter = sessionManager.subscribeToSession(scriptId);
    if (!emitter) {
      throw new Error(`Session ${scriptId} not found`);
    }

    let isCompleted = false;
    let finalResult: PromptResult | undefined;
    let scriptPath: string | undefined;
    let markdown: string | undefined;
    let steps: any[] | undefined;
    let success: boolean | undefined;
    let sessionId: string | undefined = scriptId;

    try {
      while (!isCompleted) {
        const event = await new Promise<PromptStreamEventCombined>((resolve) => {
          const handler = (e: any) => {
            emitter.off('event', handler);
            resolve(e);
          };
          emitter.on('event', handler);
        });

        // Collect info for final result
        if ((event as any).type === 'script_saved') {
          scriptPath = (event as any).path;
        }
        if ((event as any).type === 'markdown_generated') {
          markdown = (event as any).markdown;
        }
        if ((event as any).type === 'completed') {
          const ce: any = event as any;
          success = ce.success;
          markdown = ce.markdown;
          steps = ce.steps;
        }

        // Determine completion based on session events
        if ((event as any).type === 'session_completed' || (event as any).type === 'session_failed' || (event as any).type === 'session_cancelled') {
          isCompleted = true;
        }

        yield event;
      }
    } finally {
      emitter.removeAllListeners();
    }

    finalResult = {
      success: !!success,
      markdown: markdown || '',
      steps: (steps as any[]) || [],
      report: {
        totalSteps: Array.isArray(steps) ? steps.length : 0,
        successfulSteps: !!success && Array.isArray(steps) ? steps.length : 0,
        refinements: 0,
        duration: 0,
        screenshots: [],
        errors: success ? [] : ['Generation failed']
      },
      logs: [],
      sessionId,
      scriptPath
    } as PromptResult;

    return finalResult;
  }

  /** Get status for prompt generation (by scriptId) */
  static async getGenerateStatus(scriptId: string): Promise<SessionStatus | null> {
    return sessionManager.getSessionStatus(scriptId) || null;
  }

  /** Cancel prompt generation (best-effort) */
  static async cancelGenerate(scriptId: string): Promise<void> {
    sessionManager.cancelSession(scriptId);
  }
}
