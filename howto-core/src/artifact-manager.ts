import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export class ArtifactManager {
  static async ensureOutputDir(outputDir: string): Promise<void> {
    try {
      await fs.access(outputDir);
    } catch {
      await fs.mkdir(outputDir, { recursive: true });
    }
  }

  static async ensureScreenshotDir(outputDir: string): Promise<string> {
    const screenshotDir = path.join(outputDir, 'screenshots');
    try {
      await fs.access(screenshotDir);
    } catch {
      await fs.mkdir(screenshotDir, { recursive: true });
    }
    return screenshotDir;
  }

  static async ensureDOMSnapshotDir(outputDir: string): Promise<string> {
    const domSnapshotDir = path.join(outputDir, 'dom-snapshots');
    try {
      await fs.access(domSnapshotDir);
    } catch {
      await fs.mkdir(domSnapshotDir, { recursive: true });
    }
    return domSnapshotDir;
  }

  static async writeFile(filePath: string, content: string): Promise<void> {
    await fs.writeFile(filePath, content, 'utf8');
  }

  static async readFile(filePath: string): Promise<string> {
    return await fs.readFile(filePath, 'utf8');
  }

  static async writeJson(filePath: string, data: any): Promise<void> {
    const jsonContent = JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, jsonContent, 'utf8');
  }

  static getScreenshotRelativePath(screenshotFileName: string): string {
    return `screenshots/${screenshotFileName}`;
  }

  static async createTempFile(content: string, extension: string = ''): Promise<string> {
    const tempDir = os.tmpdir();
    const tempFileName = `howto-${Date.now()}-${Math.random().toString(36).substring(2)}${extension}`;
    const tempPath = path.join(tempDir, tempFileName);
    
    await fs.writeFile(tempPath, content, 'utf8');
    return tempPath;
  }

  static async deleteFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore if file doesn't exist
    }
  }
}