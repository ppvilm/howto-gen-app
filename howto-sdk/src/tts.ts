import { TTSEnhancer } from 'howto-prompt';
import { Markdown } from './markdown';
import * as fsp from 'fs/promises';
import * as path from 'path';

export interface TTSEnhanceScriptOptions {
  flowName?: string;
  workspacePath?: string;
  language?: string;
  inPlace?: boolean; // default true
  outputPath?: string; // if provided, writes here instead of in-place
}

export class TTS {
  static async enhanceContent(markdown: string, prompt: string, options: { language?: string } = {}): Promise<string> {
    return TTSEnhancer.enhance(markdown, prompt, { language: options.language, ensureIntro: true });
  }

  static async enhanceScript(scriptIdOrName: string, prompt: string, options: TTSEnhanceScriptOptions = {}): Promise<{ scriptPath: string; enhanced: boolean }> {
    const scriptPath = await Markdown.getScriptPath(scriptIdOrName, options.flowName, options.workspacePath);
    if (!scriptPath) {
      throw new Error(`Script not found: ${scriptIdOrName}`);
    }

    const original = await fsp.readFile(scriptPath, 'utf-8');
    const enhanced = await TTSEnhancer.enhance(original, prompt, { language: options.language, ensureIntro: true });

    const inPlace = options.inPlace !== false && !options.outputPath;
    let outPath = scriptPath;
    if (!inPlace) {
      outPath = options.outputPath || scriptPath.replace(/\.md$/i, '.tts.md');
    }
    await fsp.writeFile(outPath, enhanced, 'utf-8');

    return { scriptPath: outPath, enhanced: true };
  }
}
