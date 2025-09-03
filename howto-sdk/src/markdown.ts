import { 
  HowtoGenerator, 
  GenerateOptions, 
  GuideResult, 
  MarkdownParser, 
  StepValidator,
  GuideConfig,
  ParsedGuide,
  WorkspaceManager,
  SessionMetadata,
  ScriptManager,
  ScriptExportJson,
  ScriptImportOptions,
  sessionManager,
  RunStreamEvent,
  SessionStatus
} from 'howto-core';

export interface MarkdownRunOptions {
  outputDir?: string;
  headful?: boolean;
  dryRun?: boolean;
  secrets?: Record<string, string>;
  variables?: Record<string, any>;
  // Workspace options
  workspacePath?: string;
  flowName?: string;
  sessionId?: string;
  useWorkspace?: boolean;
}

export interface MarkdownResult extends GuideResult {
  sessionId?: string;
  workspacePath?: string;
  flowName?: string;
}

export class Markdown {
  /**
   * Run a howto guide from a markdown file path or script UUID
   * Supports both workspace and legacy modes
   */
  static async run(markdownPathOrUuid: string, options: MarkdownRunOptions = {}): Promise<MarkdownResult> {
    const generator = new HowtoGenerator();
    let workspaceManager: WorkspaceManager | undefined;
    let actualMarkdownPath = markdownPathOrUuid;

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

      // Check if markdownPathOrUuid is a UUID/script name instead of a file path
      const path = await import('path');
      const fs = await import('fs/promises');
      
      try {
        // If it's not an absolute path and doesn't exist as a file, try to resolve as script UUID
        if (!path.isAbsolute(markdownPathOrUuid)) {
          try {
            await fs.access(markdownPathOrUuid);
            // File exists, use as is
          } catch {
            // File doesn't exist, try to resolve as script UUID
            const scriptPath = await Markdown.getScriptPath(markdownPathOrUuid, options.flowName, options.workspacePath);
            if (scriptPath) {
              actualMarkdownPath = scriptPath;
            }
          }
        }
      } catch {
        // Continue with original path
      }
    }
    
    const generateOptions: GenerateOptions = {
      outputDir: options.outputDir,
      headful: options.headful,
      dryRun: options.dryRun,
      secrets: options.secrets,
      variables: options.variables,
      workspaceManager
    };
    
    const result = await generator.generate(actualMarkdownPath, generateOptions);
    
    // Enhance result with workspace info
    const enhancedResult: MarkdownResult = {
      ...result,
      sessionId: workspaceManager?.getSessionId(),
      workspacePath: workspaceManager?.getWorkspacePath(),
      flowName: workspaceManager?.getFlowName()
    };
    
    return enhancedResult;
  }

  /**
   * Run a howto guide from markdown content string
   * Creates temp file and runs it
   */
  static async runFromContent(markdownContent: string, options: MarkdownRunOptions = {}): Promise<GuideResult> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    
    // Create temp file
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'howto-sdk-'));
    const tempPath = path.join(tempDir, 'temp-guide.md');
    
    try {
      await fs.writeFile(tempPath, markdownContent, 'utf-8');
      return await Markdown.run(tempPath, options);
    } finally {
      // Clean up
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * Parse and validate markdown file without execution
   * Thin wrapper around Parser and Validator
   */
  static async parseAndValidate(markdownPath: string): Promise<{ parsed: ParsedGuide; config: GuideConfig }> {
    const fs = await import('fs/promises');
    const markdownContent = await fs.readFile(markdownPath, 'utf-8');
    const parsed = MarkdownParser.parse(markdownContent);
    const config = StepValidator.validateConfig(parsed.frontmatter);
    
    return { parsed, config };
  }

  /**
   * List all sessions for a flow
   */
  static async listSessions(flowName?: string, workspacePath?: string): Promise<SessionMetadata[]> {
    const workspaceManager = workspacePath ? 
      new WorkspaceManager({ workspacePath, flowName: flowName || 'default' }) :
      WorkspaceManager.create(flowName);
    
    return workspaceManager.listSessions();
  }

  /**
   * Get session metadata by ID
   */
  static async getSession(sessionId: string, flowName?: string, workspacePath?: string): Promise<SessionMetadata | null> {
    const workspaceManager = workspacePath ? 
      new WorkspaceManager({ workspacePath, flowName: flowName || 'default', sessionId }) :
      WorkspaceManager.create(flowName, sessionId);
    
    return workspaceManager.loadSessionMetadata();
  }

  /**
   * Clean old sessions
   */
  static async cleanSessions(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000, flowName?: string, workspacePath?: string): Promise<number> {
    const workspaceManager = workspacePath ? 
      new WorkspaceManager({ workspacePath, flowName: flowName || 'default' }) :
      WorkspaceManager.create(flowName);
    
    return workspaceManager.cleanOldSessions(maxAgeMs);
  }

  /**
   * Initialize workspace for a flow
   */
  static async initWorkspace(flowName?: string, workspacePath?: string): Promise<{ workspacePath: string; flowName: string }> {
    const workspaceManager = workspacePath ? 
      new WorkspaceManager({ workspacePath, flowName: flowName || 'default' }) :
      WorkspaceManager.create(flowName);
    
    await workspaceManager.ensureWorkspace();
    
    return {
      workspacePath: workspaceManager.getWorkspacePath(),
      flowName: workspaceManager.getFlowName()
    };
  }

  /**
   * List all scripts in scripts folder (searches UUID directories)
   */
  static async listScripts(flowName?: string, workspacePath?: string): Promise<{ name: string; scriptId: string; path: string }[]> {
    const workspaceManager = workspacePath ? 
      new WorkspaceManager({ workspacePath, flowName: flowName || 'default' }) :
      WorkspaceManager.create(flowName);
    
    const path = await import('path');
    const scriptsPath = workspaceManager.getGeneratedScriptsPath();
    const scripts: { name: string; scriptId: string; path: string }[] = [];
    
    try {
      const fs = await import('fs/promises');
      
      // Get all directories in scripts directory (each is a script UUID)
      const dirs = await fs.readdir(scriptsPath);
      
      for (const dir of dirs) {
        const dirPath = path.join(scriptsPath, dir);
        const dirStat = await fs.stat(dirPath);
        
        if (dirStat.isDirectory()) {
          // Look for .md files in this UUID directory
          const files = await fs.readdir(dirPath);
          
          for (const file of files) {
            if (file.endsWith('.md')) {
              const filePath = path.join(dirPath, file);
              
              // Try to extract title and other info from file content
              let scriptTitle = file.replace('.md', '');
              try {
                const content = await fs.readFile(filePath, 'utf-8');
                const titleMatch = content.match(/title:\s*"([^"]+)"/);
                if (titleMatch) {
                  scriptTitle = titleMatch[1];
                }
              } catch {
                // If we can't read the file, use filename
              }
              
              scripts.push({
                name: scriptTitle,
                scriptId: dir, // The directory name is the script UUID
                path: filePath
              });
              
              // Only take the first .md file from each UUID directory
              break;
            }
          }
        }
      }
      
      return scripts.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get script path by UUID or name (searches scripts folder)
   */
  static async getScriptPath(scriptId: string, flowName?: string, workspacePath?: string): Promise<string | null> {
    const workspaceManager = workspacePath ? 
      new WorkspaceManager({ workspacePath, flowName: flowName || 'default' }) :
      WorkspaceManager.create(flowName);
    
    const path = await import('path');
    const scriptsPath = workspaceManager.getGeneratedScriptsPath();
    
    try {
      const fs = await import('fs/promises');
      
      // Try direct UUID directory lookup first
      const uuidPath = path.join(scriptsPath, scriptId);
      try {
        const dirStat = await fs.stat(uuidPath);
        if (dirStat.isDirectory()) {
          // Look for .md files in this UUID directory
          const files = await fs.readdir(uuidPath);
          for (const file of files) {
            if (file.endsWith('.md')) {
              return path.join(uuidPath, file);
            }
          }
        }
      } catch {}
      
      // Try finding by partial name in directory names or filenames
      const dirs = await fs.readdir(scriptsPath);
      for (const dir of dirs) {
        const dirPath = path.join(scriptsPath, dir);
        try {
          const dirStat = await fs.stat(dirPath);
          if (dirStat.isDirectory()) {
            // Look for .md files in this directory
            const files = await fs.readdir(dirPath);
            for (const file of files) {
              if (file.endsWith('.md') && (file.includes(scriptId) || dir.includes(scriptId))) {
                return path.join(dirPath, file);
              }
            }
          }
        } catch {}
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Export a script to JSON format by UUID or name
   */
  static async exportScriptToJson(scriptId: string, flowName?: string, workspacePath?: string): Promise<ScriptExportJson> {
    const scriptManager = ScriptManager.create(flowName, workspacePath);
    return scriptManager.exportToJson(scriptId);
  }

  /**
   * Import a script from JSON format, optionally overwriting existing script
   */
  static async importScriptFromJson(
    jsonData: ScriptExportJson | string, 
    scriptId?: string, 
    flowName?: string, 
    workspacePath?: string,
    overwrite: boolean = false
  ): Promise<{ scriptId: string; scriptPath: string }> {
    const scriptManager = ScriptManager.create(flowName, workspacePath);
    
    const options: ScriptImportOptions = {
      scriptId,
      overwrite
    };
    
    return scriptManager.importFromJson(jsonData, options);
  }

  // ===== ASYNC METHODS WITH EVENT STREAMING =====

  /**
   * Start async execution of a markdown script
   * Returns session ID immediately for subscription
   * Session ID = unique identifier for this execution instance
   */
  static async startRunAsync(
    markdownPathOrScriptId: string, 
    options: MarkdownRunOptions = {}
  ): Promise<string> {
    let actualMarkdownPath = markdownPathOrScriptId;
    let scriptId: string | undefined;
    let workspaceManager: WorkspaceManager | undefined;
    const crypto = await import('crypto');
    const sessionId = options.sessionId || crypto.randomUUID(); // Allow external sessionId for cross-process streaming

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

      // Check if markdownPathOrScriptId is a UUID/script name instead of a file path
      const path = await import('path');
      const fs = await import('fs/promises');
      
      try {
        // If it's not an absolute path and doesn't exist as a file, try to resolve as script UUID
        if (!path.isAbsolute(markdownPathOrScriptId)) {
          try {
            await fs.access(markdownPathOrScriptId);
            // File exists as path, scriptId remains undefined (executing a file path)
          } catch {
            // File doesn't exist, try to resolve as script UUID
            const scriptPath = await Markdown.getScriptPath(markdownPathOrScriptId, options.flowName, options.workspacePath);
            if (scriptPath) {
              actualMarkdownPath = scriptPath;
              scriptId = markdownPathOrScriptId; // This is the script being executed
            } else {
              throw new Error(`Script not found: ${markdownPathOrScriptId}`);
            }
          }
        }
        // For absolute paths, scriptId remains undefined (executing a file path)
      } catch (error) {
        throw new Error(`Failed to resolve script path: ${error}`);
      }
    }

    const generateOptions: GenerateOptions = {
      outputDir: options.outputDir,
      headful: options.headful,
      dryRun: options.dryRun,
      secrets: options.secrets,
      variables: options.variables,
      workspaceManager
    };
    
    // Start async execution with session ID (not script ID)
    const generator = new HowtoGenerator();
    await generator.generateAsync(sessionId, actualMarkdownPath, generateOptions);
    
    return sessionId; // Return session ID for execution monitoring
  }

  /**
   * Subscribe to events for a running script execution
   * Returns async generator of events
   */
  static async *subscribeRunAsync(sessionId: string): AsyncGenerator<RunStreamEvent, MarkdownResult> {
    const emitter = sessionManager.subscribeToSession(sessionId);
    if (!emitter) {
      throw new Error(`Session ${sessionId} not found`);
    }

    let finalResult: MarkdownResult | undefined;
    let isCompleted = false;

    try {
      while (!isCompleted) {
        const event = await new Promise<RunStreamEvent>((resolve) => {
          const handler = (event: RunStreamEvent) => {
            emitter.off('event', handler);
            resolve(event);
          };
          emitter.on('event', handler);
        });

        // Check for completion events
        if (event.type === 'session_completed' || event.type === 'session_failed') {
          isCompleted = true;
        } else if (event.type === 'report_generated') {
          finalResult = event.report;
        }

        yield event;

        // Break after yielding completion event
        if (isCompleted) {
          break;
        }
      }
    } finally {
      emitter.removeAllListeners();
    }

    return finalResult || {
      config: { title: 'Unknown', baseUrl: '', steps: [] },
      originalBody: '',
      stepResults: [],
      screenshotDir: ''
    } as MarkdownResult;
  }

  /**
   * Get status of a running or completed script execution
   */
  static async getRunStatus(sessionId: string): Promise<SessionStatus | null> {
    return sessionManager.getSessionStatus(sessionId) || null;
  }

  /**
   * Cancel a running script execution
   */
  static async cancelRun(sessionId: string): Promise<void> {
    sessionManager.cancelSession(sessionId);
  }

  /**
   * List all active running sessions
   */
  static async getActiveRuns(): Promise<SessionStatus[]> {
    return sessionManager.getActiveSessions().filter((session: SessionStatus) => session.type === 'run');
  }
}
