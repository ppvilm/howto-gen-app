import { Markdown, Prompt } from 'howto-sdk';
import crypto from 'crypto';
import { prisma } from './prisma';
import { config } from './config';
import { decryptSecret } from './crypto';
import path from 'path';

export async function resolveWorkspaceFs(workspaceId: string) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws) throw new Error('Workspace not found');

  // Build storage path: storage/<accountId>/<workspaceId>
  // Priority: explicit ws.rootPath -> storageRoot/account/workspace
  const workspacePath = ws.rootPath || path.join(config.storageRoot, ws.accountId, ws.id);

  const flowName = ws.id; // use id as flow name
  return { workspacePath, flowName, ws };
}

export async function getEffectiveKV(workspaceId: string, scriptId?: string): Promise<{ secrets: Record<string, string>; variables: Record<string, any> }> {
  const [wSecrets, wVars] = await Promise.all([
    prisma.workspaceSecret.findMany({ where: { workspaceId } }),
    prisma.workspaceVariable.findMany({ where: { workspaceId } })
  ]);
  const secrets: Record<string, string> = {};
  const variables: Record<string, any> = {};
  for (const s of wSecrets) {
    try { secrets[s.key] = decryptSecret(s.valueEnc as any, config.jwtSecret); } catch { /* ignore bad secret */ }
  }
  for (const v of wVars) variables[v.key] = v.valueJson as any;

  if (scriptId) {
    const [sSecrets, sVars] = await Promise.all([
      prisma.scriptSecret.findMany({ where: { scriptId } }),
      prisma.scriptVariable.findMany({ where: { scriptId } })
    ]);
    for (const v of sVars) variables[v.key] = v.valueJson as any;
    // Script-level secrets override workspace-level
    for (const s of sSecrets) {
      try { secrets[s.key] = decryptSecret(s.valueEnc as any, config.jwtSecret); } catch { /* ignore */ }
    }
  }
  return { secrets, variables };
}

export async function startGenerate(workspaceId: string, prompt: string, options?: Partial<{ baseUrl: string; model: string; headful: boolean; language: string; scriptId: string }>) {
  const { workspacePath, flowName } = await resolveWorkspaceFs(workspaceId);
  const { secrets, variables } = await getEffectiveKV(workspaceId, options?.scriptId);
  // Enable TTS enhancement automatically when a Knowledge Base exists
  const kb = typeof variables['knowledge_base'] === 'string' ? String(variables['knowledge_base']).trim() : '';
  const enableTTS = kb.length > 0;
  const scriptId = await Prompt.startGenerateAsync(prompt, {
    baseUrl: options?.baseUrl || '',
    model: options?.model,
    headful: options?.headful,
    language: options?.language,
    workspacePath,
    flowName,
    scriptId: options?.scriptId,
    secrets,
    variables,
    tts: enableTTS
  });
  // ensure script row exists (path is resolved after saving by consumer if needed)
  await prisma.script.upsert({
    where: { id: scriptId },
    update: { workspaceId },
    create: { id: scriptId, path: '', workspaceId }
  });
  await prisma.session.upsert({
    where: { id: scriptId },
    update: { type: 'PROMPT', status: 'started', workspaceId, scriptId },
    create: { id: scriptId, type: 'PROMPT', status: 'started', workspaceId, scriptId }
  });

  // Background: subscribe to prompt events to capture saved path and title
  // and persist them so the UI can show the script title in listings.
  (async () => {
    try {
      const iter = Prompt.subscribeGenerateAsync(scriptId);
      let latestMarkdown: string | undefined;
      let savedPath: string | undefined;

      // Consume stream and capture interesting payloads
      while (true) {
        const { value, done } = await iter.next();
        if (done) {
          const finalResult: any = value;
          if (finalResult) {
            latestMarkdown = latestMarkdown || finalResult.markdown;
            savedPath = savedPath || finalResult.scriptPath;
          }
          break;
        }
        const ev: any = value as any;
        if (ev?.type === 'markdown_generated' && typeof ev.markdown === 'string') {
          latestMarkdown = ev.markdown;
        }
        if (ev?.type === 'script_saved' && typeof ev.path === 'string') {
          savedPath = ev.path;
        }
        // When script is saved we can already persist path and name
        if (ev?.type === 'script_saved') {
          try {
            let title: string | null = null;
            if (latestMarkdown && typeof latestMarkdown === 'string') {
              // Try YAML frontmatter first
              const fmMatch = latestMarkdown.match(/^---\s*\n([\s\S]*?)\n---/);
              if (fmMatch) {
                const yaml = fmMatch[1];
                const m = yaml.match(/\btitle\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\n\r#]+))/i);
                const t = (m?.[1] || m?.[2] || m?.[3] || '').trim();
                title = t ? t : null;
              } else {
                // Fallback: simple key search in content
                const m = latestMarkdown.match(/\btitle\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\n\r#]+))/i);
                const t = (m?.[1] || m?.[2] || m?.[3] || '').trim();
                title = t ? t : null;
              }
            }
            await prisma.script.update({
              where: { id: scriptId },
              data: { path: savedPath || '', name: title },
            });
          } catch {
            // Non-fatal if update fails; final update occurs after completion
          }
        }
      }

      // Final persist to ensure both path and name are set
      try {
        let title: string | null = null;
        if (latestMarkdown && typeof latestMarkdown === 'string') {
          const fmMatch = latestMarkdown.match(/^---\s*\n([\s\S]*?)\n---/);
          if (fmMatch) {
            const yaml = fmMatch[1];
            const m = yaml.match(/\btitle\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\n\r#]+))/i);
            const t = (m?.[1] || m?.[2] || m?.[3] || '').trim();
            title = t ? t : null;
          } else {
            const m = latestMarkdown.match(/\btitle\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\n\r#]+))/i);
            const t = (m?.[1] || m?.[2] || m?.[3] || '').trim();
            title = t ? t : null;
          }
        }
        await prisma.script.update({
          where: { id: scriptId },
          data: { path: savedPath || '', name: title },
        });
      } catch {}
    } catch {
      // Ignore background subscription errors
    }
  })();
  return scriptId;
}

export async function startRun(workspaceId: string, scriptOrPath: string, options?: Partial<{ headful: boolean; sessionId: string }>) {
  const { workspacePath, flowName } = await resolveWorkspaceFs(workspaceId);
  // If input looks like UUID, treat as script
  const isUuid = /[0-9a-fA-F-]{36}/.test(scriptOrPath);
  const scriptId = isUuid ? scriptOrPath : undefined;
  const { secrets, variables } = await getEffectiveKV(workspaceId, scriptId);
  // Ensure a single, consistent sessionId is used for both event streaming and workspace artifacts
  const forcedSessionId = options?.sessionId || crypto.randomUUID();
  const sessionId = await Markdown.startRunAsync(scriptOrPath, {
    headful: options?.headful,
    sessionId: forcedSessionId,
    workspacePath,
    flowName,
    secrets,
    variables
  });
  await prisma.session.upsert({
    where: { id: sessionId },
    update: { type: 'RUN', status: 'started', workspaceId, scriptId },
    create: { id: sessionId, type: 'RUN', status: 'started', workspaceId, scriptId }
  });
  return sessionId;
}

export function subscribePrompt(scriptId: string) {
  return Prompt.subscribeGenerateAsync(scriptId);
}

export function subscribeRun(sessionId: string) {
  return Markdown.subscribeRunAsync(sessionId);
}

export async function exportScript(workspaceId: string, scriptId: string) {
  const { workspacePath, flowName } = await resolveWorkspaceFs(workspaceId);
  return Markdown.exportScriptToJson(scriptId, flowName, workspacePath);
}

export async function importScript(workspaceId: string, json: any, override?: { scriptId?: string; overwrite?: boolean; }) {
  const { workspacePath, flowName } = await resolveWorkspaceFs(workspaceId);
  const { scriptId, scriptPath } = await Markdown.importScriptFromJson(json, override?.scriptId, flowName, workspacePath, !!override?.overwrite);
  await prisma.script.upsert({
    where: { id: scriptId },
    update: { path: scriptPath, workspaceId },
    create: { id: scriptId, path: scriptPath, workspaceId }
  });
  return { scriptId, scriptPath };
}
