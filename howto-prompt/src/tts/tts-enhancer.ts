import { MarkdownParser, getLLMManager } from 'howto-core';
import type { StepAction } from 'howto-core';

export interface TTSEnhanceOptions {
  language?: string;
  // When true, ensure an intro tts pair after first goto even if LLM fails
  ensureIntro?: boolean;
}

/**
 * TTSEnhancer: decoupled TTS enhancement for generated markdown scripts.
 * - Parses steps from markdown frontmatter
 * - Calls LLM manager for TTS hints
 * - Merges tts_start/tts_wait into steps and regenerates markdown
 */
export class TTSEnhancer {
  static async enhance(markdown: string, prompt: string, options: TTSEnhanceOptions = {}): Promise<string> {
    const parsed = MarkdownParser.parse(markdown);
    const steps: StepAction[] = (parsed.frontmatter as any).steps || [];
    const language = options.language || (parsed.frontmatter as any).language || 'en';

    try {
      const llmManager = getLLMManager();
      const responseText = await llmManager.executeTTSEnhancement(steps, prompt, language);
      const enhanced = await this.applyTTSSuggestions(markdown, responseText, steps, prompt, language);
      return enhanced;
    } catch (err) {
      // Fallback: optionally inject intro pair only
      if (options.ensureIntro) {
        try {
          let stepsWithIntro = await this.insertIntroAfterFirstGoto(steps, prompt, language);
          stepsWithIntro = await this.insertOutroAtEnd(stepsWithIntro, prompt, language);
          const enhanced = this.generateMarkdownWithSteps(parsed.frontmatter.title, parsed.frontmatter.baseUrl, language, stepsWithIntro);
          return enhanced;
        } catch {}
      }
      return markdown;
    }
  }

  private static async applyTTSSuggestions(markdown: string, llmResponse: string, originalSteps: StepAction[], prompt: string, language: string): Promise<string> {
    const parsed = MarkdownParser.parse(markdown);
    const baseUrl = parsed.frontmatter.baseUrl;

    const ttsSteps = this.parseTTSSteps(llmResponse);
    if (!ttsSteps.length) {
      return markdown;
    }

    let merged = this.mergeTTSSteps(originalSteps, ttsSteps);
    merged = this.enforceTTSPairs(merged);
    merged = this.suppressNavigationTTS(merged);
    merged = await this.insertIntroAfterFirstGoto(merged, prompt, language);
    merged = await this.insertOutroAtEnd(merged, prompt, language);

    return this.generateMarkdownWithSteps(parsed.frontmatter.title, baseUrl, language, merged);
  }

  // Parse TTS steps from LLM response
  private static parseTTSSteps(response: string): Array<{position: 'before' | 'after', stepIndex: number, type: 'tts_start' | 'tts_wait', content?: string, waitMs?: number, label?: string}> {
    const ttsSteps: Array<{position: 'before' | 'after', stepIndex: number, type: 'tts_start' | 'tts_wait', content?: string, waitMs?: number, label?: string}> = [];
    const lines = response.split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      const beforeMatch = line.match(/^-?\s*Before step (\d+):\s*tts_start(?:\s+label=([A-Za-z0-9._-]+))?\s*"([^"]+)"/);
      if (beforeMatch) {
        const stepIndex = parseInt(beforeMatch[1]) - 1;
        const label = beforeMatch[2];
        const content = beforeMatch[3];
        ttsSteps.push({ position: 'before', stepIndex, type: 'tts_start', content, label });
        continue;
      }
      const afterStartMatch = line.match(/^-?\s*After step (\d+):\s*tts_start(?:\s+label=([A-Za-z0-9._-]+))?\s*"([^"]+)"/);
      if (afterStartMatch) {
        const stepIndex = parseInt(afterStartMatch[1]) - 1;
        const label = afterStartMatch[2];
        const content = afterStartMatch[3];
        ttsSteps.push({ position: 'after', stepIndex, type: 'tts_start', content, label });
        continue;
      }
      const waitMatch = line.match(/^-?\s*After step (\d+):\s*tts_wait(?:\s+label=([A-Za-z0-9._-]+))?\s*(\d+)/);
      if (waitMatch) {
        const stepIndex = parseInt(waitMatch[1]) - 1;
        const label = waitMatch[2];
        const waitMs = parseInt(waitMatch[3]);
        ttsSteps.push({ position: 'after', stepIndex, type: 'tts_wait', waitMs, label });
        continue;
      }
    }
    return ttsSteps;
  }

  private static mergeTTSSteps(originalSteps: StepAction[], ttsSteps: Array<{position: 'before' | 'after', stepIndex: number, type: 'tts_start' | 'tts_wait', content?: string, waitMs?: number, label?: string}>): StepAction[] {
    const merged: StepAction[] = [];
    for (let i = 0; i < originalSteps.length; i++) {
      const before = ttsSteps.filter(t => t.position === 'before' && t.stepIndex === i);
      for (const t of before) {
        if (t.type === 'tts_start' && t.content) {
          merged.push({ type: 'tts_start', label: t.label, text: t.content, screenshot: false } as StepAction);
        } else if (t.type === 'tts_wait' && t.waitMs) {
          merged.push({ type: 'tts_wait', label: t.label, waitMs: t.waitMs, screenshot: false } as StepAction);
        }
      }
      merged.push(originalSteps[i]);
      const after = ttsSteps.filter(t => t.position === 'after' && t.stepIndex === i);
      for (const t of after) {
        if (t.type === 'tts_start' && t.content) {
          merged.push({ type: 'tts_start', label: t.label, text: t.content, screenshot: false } as StepAction);
        } else if (t.type === 'tts_wait' && t.waitMs) {
          merged.push({ type: 'tts_wait', label: t.label, waitMs: t.waitMs, screenshot: false } as StepAction);
        }
      }
    }
    return merged;
  }

  // Ensure every tts_start(label) has a subsequent tts_wait(label)
  private static enforceTTSPairs(steps: StepAction[]): StepAction[] {
    const result = [...steps];
    const startIndexByLabel = new Map<string, number>();
    const hasWaitAfterByLabel = new Map<string, boolean>();
    for (let i = 0; i < result.length; i++) {
      const s = result[i] as any;
      if (s.type === 'tts_start' && s.label) {
        startIndexByLabel.set(s.label, i);
        hasWaitAfterByLabel.set(s.label, false);
      } else if (s.type === 'tts_wait' && s.label) {
        const startIdx = startIndexByLabel.get(s.label);
        if (startIdx !== undefined && i > startIdx) {
          hasWaitAfterByLabel.set(s.label, true);
        }
      }
    }
    const insertions: Array<{ index: number; step: StepAction }> = [];
    for (const [label, startIdx] of startIndexByLabel.entries()) {
      if (hasWaitAfterByLabel.get(label)) continue;
      let insertAfter = startIdx;
      for (let j = startIdx + 1; j < result.length; j++) {
        const t = result[j] as any;
        if (t.type !== 'tts_start' && t.type !== 'tts_wait') {
          insertAfter = j;
          break;
        }
      }
      insertions.push({ index: insertAfter + 1, step: { type: 'tts_wait', label, screenshot: false } as StepAction });
    }
    insertions.sort((a, b) => a.index - b.index);
    let offset = 0;
    for (const ins of insertions) {
      result.splice(ins.index + offset, 0, ins.step);
      offset++;
    }
    return result;
  }

  // Remove narration around initial navigation (no navigate TTS)
  private static suppressNavigationTTS(steps: StepAction[]): StepAction[] {
    const result = [...steps];
    const dropLabels = new Set<string>();
    for (let i = 0; i < result.length; i++) {
      const s: any = result[i];
      if (s.type === 'tts_start' && s.label && s.label !== 'intro_auto') {
        // find next non-tts step
        let j = i + 1;
        while (j < result.length && (result[j] as any).type && ((result[j] as any).type === 'tts_start' || (result[j] as any).type === 'tts_wait')) {
          j++;
        }
        if (j < result.length && (result[j] as any).type === 'goto') {
          dropLabels.add(s.label);
        }
      }
    }
    if (dropLabels.size === 0) return result;
    return result.filter((s: any) => {
      if ((s.type === 'tts_start' || s.type === 'tts_wait') && s.label && dropLabels.has(s.label)) {
        return false;
      }
      return true;
    });
  }

  // Ensure intro comes after the first goto (goto first, then intro)
  private static async insertIntroAfterFirstGoto(steps: StepAction[], prompt: string, language: string): Promise<StepAction[]> {
    const result = [...steps];
    const introLabel = 'intro_auto';
    const gotoIdx = result.findIndex((s: any) => s.type === 'goto');
    // Gather or create intro pair
    let introStartStep: any | undefined;
    let introWaitStep: any | undefined;
    const idxStart = result.findIndex((s: any) => s.type === 'tts_start' && s.label && s.label.startsWith(introLabel));
    if (idxStart >= 0) {
      introStartStep = result.splice(idxStart, 1)[0];
      const idxWait = result.findIndex((s: any) => s.type === 'tts_wait' && s.label === introStartStep.label);
      if (idxWait >= 0) {
        introWaitStep = result.splice(idxWait > idxStart ? idxWait - 1 : idxWait, 1)[0];
      }
    } else {
      const introText = await this.buildIntroText(prompt, language);
      introStartStep = { type: 'tts_start', label: introLabel, text: introText, screenshot: false } as StepAction;
      introWaitStep = { type: 'tts_wait', label: introLabel, screenshot: false } as StepAction;
    }
    if (gotoIdx >= 0) {
      const insertAt = gotoIdx + 1;
      result.splice(insertAt, 0, introStartStep);
      result.splice(insertAt + 1, 0, introWaitStep);
      return result;
    }
    // No goto: prepend intro; builder will put goto at index 0 later
    return [introStartStep, introWaitStep, ...result];
  }

  private static async buildIntroText(prompt: string, language: string): Promise<string> {
    const clean = (prompt || '').trim();
    try {
      if (clean) {
        try {
          const llmManager = getLLMManager();
          const response = await llmManager.execute('tts_enhancement', {
            prompt: `Create a friendly, concise intro text for a tutorial video about: "${clean}". Keep it under 20 words, welcoming tone, present tense. Start with "Welcome". Respond in ${language}.`,
            systemPrompt: 'You are a friendly tutorial narrator. Respond with only the intro line.',
            maxTokens: 100
          });
          const text = (response as any).content?.trim();
          if (text) return text;
        } catch {}
      }
    } catch {}
    const compact = clean.replace(/\s+/g, ' ').replace(/[\.#:]+$/, '');
    return this.getFallbackIntroText(compact, language);
  }

  // Ensure there is an outro narration at the end of the flow
  private static async insertOutroAtEnd(steps: StepAction[], prompt: string, language: string): Promise<StepAction[]> {
    const result = [...steps];
    const outroLabel = 'outro_auto';
    if (result.some((s: any) => s.type === 'tts_start' && s.label && s.label.startsWith(outroLabel))) {
      return result;
    }
    const outroText = await this.buildOutroText(prompt, language);
    const outroStart: StepAction = { type: 'tts_start', label: outroLabel, text: outroText, screenshot: false } as StepAction;
    const outroWait: StepAction = { type: 'tts_wait', label: outroLabel, screenshot: false } as StepAction;

    // Insert after the last non-TTS step
    let lastActionIdx = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      const t: any = result[i];
      if (t.type !== 'tts_start' && t.type !== 'tts_wait') { lastActionIdx = i; break; }
    }
    if (lastActionIdx >= 0) {
      result.splice(lastActionIdx + 1, 0, outroStart, outroWait);
      return result;
    }
    // If nothing but TTS exists, just append
    return [...result, outroStart, outroWait];
  }

  private static async buildOutroText(prompt: string, language: string): Promise<string> {
    const clean = (prompt || '').trim();
    try {
      if (clean) {
        try {
          const llmManager = getLLMManager();
          const response = await llmManager.execute('tts_enhancement', {
            prompt: `Create a concise success outro for a tutorial that accomplished: "${clean}". One short sentence, friendly tone, present tense. Use first-person plural (we). Start with a positive cue and include "we" (e.g., "Great, we ..."). Respond in ${language}.`,
            systemPrompt: 'You are a friendly tutorial narrator. Use first-person plural (we). Output only the one-line outro, nothing else.',
            maxTokens: 60
          });
          const text = (response as any).content?.trim();
          if (text) return text;
        } catch {}
      }
    } catch {}
    const compact = clean.replace(/\s+/g, ' ').replace(/[\.#:]+$/, '');
    return this.getFallbackOutroText(compact, language);
  }

  private static getFallbackOutroText(compact: string, lang: string): string {
    const translations: any = {
      en: { withPrompt: (p: string) => `Great! We’ve completed ${p}.`, generic: 'Great! We’ve successfully completed this task.' },
      de: { withPrompt: (p: string) => `Super! Wir haben ${p} abgeschlossen.`, generic: 'Super! Wir haben diese Aufgabe erfolgreich abgeschlossen.' },
      fr: { withPrompt: (p: string) => `Génial ! Nous avons terminé ${p}.`, generic: 'Génial ! Nous avons terminé cette tâche avec succès.' },
      es: { withPrompt: (p: string) => `¡Genial! Hemos completado ${p}.`, generic: '¡Genial! Hemos completado esta tarea con éxito.' }
    };
    const t = translations[lang] || translations.en;
    return compact ? t.withPrompt(compact) : t.generic;
  }

  private static getFallbackIntroText(compact: string, lang: string): string {
    const translations: any = {
      en: { withPrompt: (p: string) => `Welcome! In this tutorial, I'll show you how to "${p}" step by step.`, withoutPrompt: 'Welcome! In this tutorial, I will show you step by step how to complete this task efficiently.' },
      de: { withPrompt: (p: string) => `Willkommen! In diesem Tutorial zeige ich dir, wie du "${p}" Schritt für Schritt umsetzt.`, withoutPrompt: 'Willkommen! In diesem Tutorial zeige ich dir Schritt für Schritt, wie du diese Aufgabe effizient erledigst.' },
      fr: { withPrompt: (p: string) => `Bienvenue ! Dans ce tutoriel, je vais vous montrer comment "${p}" étape par étape.`, withoutPrompt: 'Bienvenue ! Dans ce tutoriel, je vais vous montrer étape par étape comment accomplir cette tâche efficacement.' },
      es: { withPrompt: (p: string) => `¡Bienvenido! En este tutorial, te mostraré cómo "${p}" paso a paso.`, withoutPrompt: '¡Bienvenido! En este tutorial, te mostraré paso a paso cómo completar esta tarea de manera eficiente.' }
    };
    const t = translations[lang] || translations.en;
    return compact ? t.withPrompt(compact) : t.withoutPrompt;
  }

  private static generateMarkdownWithSteps(title: string, baseUrl: string, language: string, steps: StepAction[]): string {
    const timestamp = new Date().toISOString();
    const escapeYaml = (s: string) => s.replace(/\\/g, "\\\\").replace(/\"/g, '\\"').replace(/\n|\r/g, ' ').trim();
    const blockScalar = (s: string) => {
      const normalized = s.replace(/\r\n?/g, '\n');
      const indent = '      ';
      return ['|', ...normalized.split('\n').map(line => `${indent}${line}`)].join('\n');
    };
    // Ensure navigation is present without duplicating when TTS appears first
    const firstNonTTS = steps.findIndex((s: any) => s.type !== 'tts_start' && s.type !== 'tts_wait');
    const needsPrependGoto =
      firstNonTTS === -1
      || (firstNonTTS >= 0 && (steps[firstNonTTS] as any).type !== 'goto');
    const stepsForFrontmatter: StepAction[] = needsPrependGoto
      ? ([{ type: 'goto', url: baseUrl, note: 'Navigate to base URL', screenshot: true } as StepAction, ...steps])
      : steps;

    const lines: string[] = [
      '---',
      `title: "${escapeYaml(title)}"`,
      `baseUrl: "${escapeYaml(baseUrl)}"`,
      `generated: ${timestamp}`,
      `totalSteps: ${stepsForFrontmatter.length}`,
      'recordVideo: true',
      'steps:',
      ...stepsForFrontmatter.map((step: any) => {
        const stepLines = [`  - type: ${step.type}`];
        if (step.label) stepLines.push(`    label: "${escapeYaml(step.label)}"`);
        if (step.value) stepLines.push(`    value: "${escapeYaml(step.value)}"`);
        if (step.url) stepLines.push(`    url: "${escapeYaml(step.url)}"`);
        if (step.sensitive) stepLines.push(`    sensitive: ${step.sensitive}`);
        if (step.waitMs) stepLines.push(`    waitMs: ${step.waitMs}`);
        if (step.text) stepLines.push(`    text: "${escapeYaml(step.text)}"`);
        if (step.key) stepLines.push(`    key: "${escapeYaml(step.key)}"`);
        stepLines.push(`    screenshot: ${step.screenshot !== false}`);
        if (step.note) stepLines.push(`    note: ${blockScalar(step.note)}`);
        return stepLines.join('\n');
      }),
      `language: "${escapeYaml(language)}"`,
      `outputDir: "generated-guides"`,
      '---',
      '',
      `# ${title}`,
      '',
      '## Overview',
      '',
      `This guide was automatically generated from the prompt: "${title.replace('Generated Guide: ', '')}"`,
      '',
      '## Steps',
      '',
      '<!-- STEPS:AUTOGENERATED -->',
      ''
    ];
    return lines.join('\n');
  }
}
