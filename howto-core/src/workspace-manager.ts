import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export interface WorkspaceConfig {
  workspacePath: string;
  flowName: string;
  sessionId?: string;
}

export interface SessionMetadata {
  sessionId: string;
  flowName: string;
  createdAt: string;
  completedAt?: string;
  inputFile?: string;
  inputPrompt?: string;
  configuration: Record<string, any>;
  success?: boolean;
  stepCount?: number;
  errorLogs?: string[];
  duration?: number;
}

export class WorkspaceManager {
  private workspacePath: string;
  private flowName: string;
  private sessionId: string;

  constructor(config: WorkspaceConfig) {
    this.workspacePath = config.workspacePath;
    this.flowName = config.flowName;
    this.sessionId = config.sessionId || this.generateSessionId();
  }

  static getDefaultWorkspacePath(): string {
    return process.env.HOWTO_WORKSPACE || path.join(os.homedir(), '.howto');
  }

  static create(flowName?: string, sessionId?: string): WorkspaceManager {
    const workspacePath = WorkspaceManager.getDefaultWorkspacePath();
    const defaultFlowName = flowName || path.basename(process.cwd());
    
    return new WorkspaceManager({
      workspacePath,
      flowName: defaultFlowName,
      sessionId
    });
  }

  generateSessionId(): string {
    return crypto.randomUUID();
  }

  getWorkspacePath(): string {
    return this.workspacePath;
  }

  getFlowName(): string {
    return this.flowName;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getGlobalConfigPath(): string {
    return path.join(this.workspacePath, 'config');
  }

  getFlowConfigPath(): string {
    return path.join(this.workspacePath, 'flows', this.flowName, 'config');
  }

  getSessionPath(): string {
    return path.join(this.workspacePath, 'sessions', this.sessionId);
  }

  getSessionOutputPath(): string {
    return this.getSessionPath();
  }

  getSessionScreenshotsPath(): string {
    return path.join(this.getSessionPath(), 'screenshots');
  }

  getSessionDOMSnapshotsPath(): string {
    return path.join(this.getSessionPath(), 'dom-snapshots');
  }

  getSessionAudioPath(): string {
    return path.join(this.getSessionPath(), 'audio');
  }

  getSessionVideosPath(): string {
    return path.join(this.getSessionPath(), 'videos');
  }

  getSessionGuidesPath(): string {
    return path.join(this.getSessionPath(), 'guides');
  }

  getGeneratedScriptsPath(): string {
    return path.join(this.workspacePath, 'scripts');
  }

  getCachePath(): string {
    return path.join(this.workspacePath, 'flows', this.flowName, 'cache');
  }

  getLogsPath(): string {
    return path.join(this.workspacePath, 'logs');
  }

  async ensureWorkspace(): Promise<void> {
    // Create main workspace structure
    await fs.mkdir(this.workspacePath, { recursive: true });
    await fs.mkdir(this.getGlobalConfigPath(), { recursive: true });
    await fs.mkdir(this.getLogsPath(), { recursive: true });

    // Create new top-level directories
    await fs.mkdir(path.join(this.workspacePath, 'flows'), { recursive: true });
    await fs.mkdir(path.join(this.workspacePath, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(this.workspacePath, 'sessions'), { recursive: true });

    // Create flow-specific structure
    await fs.mkdir(this.getFlowConfigPath(), { recursive: true });
    await fs.mkdir(this.getCachePath(), { recursive: true });

    // Create session-specific structure
    await fs.mkdir(this.getSessionPath(), { recursive: true });
    await fs.mkdir(this.getSessionScreenshotsPath(), { recursive: true });
    await fs.mkdir(this.getSessionDOMSnapshotsPath(), { recursive: true });
    await fs.mkdir(this.getSessionAudioPath(), { recursive: true });
    await fs.mkdir(this.getSessionVideosPath(), { recursive: true });
    await fs.mkdir(this.getSessionGuidesPath(), { recursive: true });
  }

  async loadConfig<T>(configName: string, defaultConfig?: T): Promise<T> {
    const globalPath = path.join(this.getGlobalConfigPath(), configName);
    const flowPath = path.join(this.getFlowConfigPath(), configName);

    let globalConfig: T | undefined;
    let flowConfig: Partial<T> | undefined;

    // Load global config
    try {
      const globalContent = await fs.readFile(globalPath, 'utf-8');
      globalConfig = JSON.parse(globalContent);
    } catch (error) {
      globalConfig = defaultConfig;
    }

    // Load flow-specific config
    try {
      const flowContent = await fs.readFile(flowPath, 'utf-8');
      flowConfig = JSON.parse(flowContent);
    } catch (error) {
      flowConfig = {};
    }

    // Merge configs (flow overrides global)
    return this.deepMerge(globalConfig || {} as T, flowConfig || {});
  }

  async saveConfig<T>(configName: string, config: T, isGlobal: boolean = false): Promise<void> {
    const configPath = isGlobal ? 
      path.join(this.getGlobalConfigPath(), configName) :
      path.join(this.getFlowConfigPath(), configName);

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  async saveSessionMetadata(metadata: SessionMetadata): Promise<void> {
    const metadataPath = path.join(this.getSessionPath(), 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  async loadSessionMetadata(): Promise<SessionMetadata | null> {
    try {
      const metadataPath = path.join(this.getSessionPath(), 'metadata.json');
      const content = await fs.readFile(metadataPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  async listSessions(): Promise<SessionMetadata[]> {
    const sessionsDir = path.join(this.workspacePath, 'sessions');
    
    try {
      const sessionDirs = await fs.readdir(sessionsDir);
      const sessions: SessionMetadata[] = [];

      for (const sessionDir of sessionDirs) {
        try {
          const metadataPath = path.join(sessionsDir, sessionDir, 'metadata.json');
          const content = await fs.readFile(metadataPath, 'utf-8');
          const metadata = JSON.parse(content);
          // Filter by flow name if specified
          if (!this.flowName || metadata.flowName === this.flowName) {
            sessions.push(metadata);
          }
        } catch (error) {
          // Skip sessions without valid metadata
        }
      }

      // Sort by creation time (newest first)
      return sessions.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } catch (error) {
      return [];
    }
  }

  async cleanOldSessions(maxAge: number = 30 * 24 * 60 * 60 * 1000): Promise<number> {
    const sessions = await this.listSessions();
    const now = Date.now();
    let cleaned = 0;

    for (const session of sessions) {
      const sessionAge = now - new Date(session.createdAt).getTime();
      if (sessionAge > maxAge) {
        try {
          const sessionPath = path.join(
            this.workspacePath, 
            'sessions', 
            session.sessionId
          );
          await fs.rm(sessionPath, { recursive: true, force: true });
          cleaned++;
        } catch (error) {
          // Continue with other sessions if one fails
        }
      }
    }

    return cleaned;
  }

  private deepMerge<T>(target: T, source: Partial<T>): T {
    const result = { ...target };

    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        const sourceValue = source[key];
        const targetValue = result[key];

        if (this.isObject(targetValue) && this.isObject(sourceValue)) {
          result[key] = this.deepMerge(targetValue, sourceValue as any);
        } else if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
          // For arrays, combine and deduplicate
          result[key] = [...targetValue, ...sourceValue] as any;
        } else if (sourceValue !== undefined) {
          result[key] = sourceValue as any;
        }
      }
    }

    return result;
  }

  private isObject(value: any): boolean {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  // Helper methods for backward compatibility
  static async ensureOutputDir(outputDir: string): Promise<string> {
    await fs.mkdir(outputDir, { recursive: true });
    return outputDir;
  }

  static async ensureScreenshotDir(outputDir: string): Promise<string> {
    const screenshotDir = path.join(outputDir, 'screenshots');
    await fs.mkdir(screenshotDir, { recursive: true });
    return screenshotDir;
  }
}