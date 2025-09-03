import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import matter from 'gray-matter';
import { MarkdownParser } from './parser';
import { WorkspaceManager } from './workspace-manager';
import { GuideConfig, ParsedGuide } from './types';

export interface ScriptExportJson {
  scriptId: string;
  metadata: {
    title: string;
    baseUrl: string;
    generated?: string;
    totalSteps?: number;
    language?: string;
    recordVideo?: boolean;
  };
  config: GuideConfig;
  body: string;
  exportedAt: string;
}

export interface ScriptImportOptions {
  scriptId?: string;
  overwrite?: boolean;
}

export class ScriptManager {
  private workspaceManager: WorkspaceManager;

  constructor(workspaceManager: WorkspaceManager) {
    this.workspaceManager = workspaceManager;
  }

  static create(flowName?: string, workspacePath?: string): ScriptManager {
    const workspaceManager = workspacePath 
      ? new WorkspaceManager({ workspacePath, flowName: flowName || 'default' })
      : WorkspaceManager.create(flowName);
    
    return new ScriptManager(workspaceManager);
  }

  async exportToJson(scriptPathOrId: string): Promise<ScriptExportJson> {
    let actualScriptPath = scriptPathOrId;
    let scriptId: string;

    // If it looks like a UUID/path, try to resolve it
    if (!path.isAbsolute(scriptPathOrId)) {
      // Try to find script by ID first
      const resolvedPath = await this.resolveScriptPath(scriptPathOrId);
      if (resolvedPath) {
        actualScriptPath = resolvedPath.path;
        scriptId = resolvedPath.scriptId;
      } else {
        // Try as a relative path
        actualScriptPath = path.resolve(scriptPathOrId);
        scriptId = this.extractScriptIdFromPath(actualScriptPath);
      }
    } else {
      scriptId = this.extractScriptIdFromPath(actualScriptPath);
    }

    // Read and parse the markdown file
    const markdownContent = await fs.readFile(actualScriptPath, 'utf-8');
    const parsedGuide = MarkdownParser.parse(markdownContent);

    // Extract metadata from frontmatter
    const metadata = {
      title: parsedGuide.frontmatter.title,
      baseUrl: parsedGuide.frontmatter.baseUrl,
      generated: (parsedGuide.frontmatter as any).generated,
      totalSteps: (parsedGuide.frontmatter as any).totalSteps,
      language: parsedGuide.frontmatter.language,
      recordVideo: parsedGuide.frontmatter.recordVideo
    };

    return {
      scriptId,
      metadata,
      config: parsedGuide.frontmatter,
      body: parsedGuide.body,
      exportedAt: new Date().toISOString()
    };
  }

  async importFromJson(
    jsonData: ScriptExportJson | string, 
    options: ScriptImportOptions = {}
  ): Promise<{ scriptId: string; scriptPath: string }> {
    // Parse JSON if it's a string
    const scriptData: ScriptExportJson = typeof jsonData === 'string' 
      ? JSON.parse(jsonData) 
      : jsonData;

    // Determine script ID (use provided override, or from JSON, or generate new)
    const scriptId = options.scriptId || scriptData.scriptId || crypto.randomUUID();

    // Prepare the script directory
    await this.workspaceManager.ensureWorkspace();
    const scriptsPath = this.workspaceManager.getGeneratedScriptsPath();
    const scriptDir = path.join(scriptsPath, scriptId);
    await fs.mkdir(scriptDir, { recursive: true });

    // Create the markdown filename (use title if available, fallback to generic name)
    const sanitizedTitle = this.sanitizeFilename(scriptData.metadata.title || 'generated-guide');
    const scriptPath = path.join(scriptDir, `${sanitizedTitle}.md`);

    // Check if file exists and handle overwrite
    try {
      await fs.access(scriptPath);
      if (!options.overwrite) {
        throw new Error(`Script already exists at ${scriptPath}. Use overwrite option to replace.`);
      }
    } catch (error) {
      // File doesn't exist, proceed with creation
    }

    // Reconstruct the frontmatter and markdown
    const frontmatter = {
      ...scriptData.config,
      // Ensure required fields are present
      title: scriptData.metadata.title,
      baseUrl: scriptData.metadata.baseUrl
    };

    // Use gray-matter to reconstruct the markdown
    const markdownContent = matter.stringify(scriptData.body, frontmatter);

    // Write the file
    await fs.writeFile(scriptPath, markdownContent, 'utf-8');

    return {
      scriptId,
      scriptPath
    };
  }

  private async resolveScriptPath(scriptIdOrName: string): Promise<{ path: string; scriptId: string } | null> {
    const scriptsPath = this.workspaceManager.getGeneratedScriptsPath();
    
    try {
      // Try direct UUID directory lookup first
      const uuidPath = path.join(scriptsPath, scriptIdOrName);
      try {
        const dirStat = await fs.stat(uuidPath);
        if (dirStat.isDirectory()) {
          // Look for .md files in this UUID directory
          const files = await fs.readdir(uuidPath);
          for (const file of files) {
            if (file.endsWith('.md')) {
              return {
                path: path.join(uuidPath, file),
                scriptId: scriptIdOrName
              };
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
              if (file.endsWith('.md') && (file.includes(scriptIdOrName) || dir.includes(scriptIdOrName))) {
                return {
                  path: path.join(dirPath, file),
                  scriptId: dir
                };
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

  private extractScriptIdFromPath(scriptPath: string): string {
    // Try to extract UUID from path (assuming structure: .../{uuid}/file.md)
    const parts = scriptPath.split(path.sep);
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      // Check if this looks like a UUID (basic check)
      if (part.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        return part;
      }
    }
    
    // Fallback: generate a new UUID
    return crypto.randomUUID();
  }

  private sanitizeFilename(filename: string): string {
    // Remove or replace invalid characters for filenames
    return filename
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/\s+/g, '-')
      .toLowerCase()
      .substring(0, 100); // Limit length
  }
}