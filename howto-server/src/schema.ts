import { makeSchema, objectType, queryType, mutationType, subscriptionType, stringArg, nonNull, idArg, inputObjectType, enumType, booleanArg, arg, scalarType } from 'nexus';
import path from 'path';
import fs from 'fs';
import { GraphQLJSON } from 'graphql-scalars';
import { prisma } from './prisma';
import { startGenerate, startRun, exportScript, importScript, subscribePrompt, subscribeRun } from './sdk-bridge';
import { encryptSecret } from './crypto';
import { config } from './config';
import { hashPassword, verifyPassword, signToken } from './auth';

// Scalars
const JSONScalar = scalarType({
  name: 'JSON',
  asNexusMethod: 'json',
  sourceType: 'any',
  serialize: (v) => v,
  parseValue: (v) => v,
});

export const SessionTypeEnum = enumType({
  name: 'SessionType',
  members: ['RUN', 'PROMPT'],
});

const SecretMeta = objectType({
  name: 'SecretMeta',
  definition(t) {
    t.nonNull.string('key');
    t.string('updatedAt');
    t.boolean('exists');
  },
});

const Variable = objectType({
  name: 'Variable',
  definition(t) {
    t.nonNull.string('key');
    t.nonNull.field('value', { type: JSONScalar });
    t.string('updatedAt');
  },
});

const Workspace = objectType({
  name: 'Workspace',
  definition(t) {
    t.nonNull.id('id');
    t.string('name');
    t.string('rootPath');
  },
});

const Script = objectType({
  name: 'Script',
  definition(t) {
    t.nonNull.id('id');
    t.string('name');
    t.nonNull.string('path');
    t.nonNull.id('workspaceId');
  },
});

const Session = objectType({
  name: 'Session',
  definition(t) {
    t.nonNull.id('id');
    t.nonNull.field('type', { type: 'SessionType' });
    t.string('status');
    t.string('error');
    t.string('startedAt');
    t.string('completedAt');
    t.id('scriptId');
    t.nonNull.id('workspaceId');
  },
});

const SessionArtifacts = objectType({
  name: 'SessionArtifacts',
  definition(t) {
    t.string('markdownUrl');
    t.string('videoUrl');
    t.string('guideLogUrl');
  },
});

const AuthPayload = objectType({
  name: 'AuthPayload',
  definition(t) {
    t.nonNull.string('token');
  }
});

const User = objectType({
  name: 'User',
  definition(t) {
    t.nonNull.id('id');
    t.nonNull.string('email');
    t.nonNull.string('accountId');
  }
});

const GenerateOptionsInput = inputObjectType({
  name: 'GenerateOptionsInput',
  definition(t) {
    t.string('baseUrl');
    t.string('model');
    t.boolean('headful');
    t.string('language');
    t.string('scriptId');
  },
});

const RunOptionsInput = inputObjectType({
  name: 'RunOptionsInput',
  definition(t) {
    t.boolean('headful');
    t.string('sessionId');
  },
});

export const Query = queryType({
  definition(t) {
    t.field('me', {
      type: User,
      resolve: async (_root, _args, ctx: any) => {
        if (!ctx?.auth?.user) return null as any;
        const u = ctx.auth.user;
        return { id: u.id, email: u.email, accountId: u.accountId } as any;
      },
    });
    t.list.field('workspaces', {
      type: Workspace,
      resolve: async (_root, _args, ctx: any) => {
        if (!ctx?.auth?.accountId) return [];
        return prisma.workspace.findMany({ where: { accountId: ctx.auth.accountId } });
      },
    });

    t.field('workspace', {
      type: Workspace,
      args: { id: nonNull(idArg()) },
      resolve: async (_root, { id }, ctx: any) => {
        if (!ctx?.auth?.accountId) return null as any;
        return prisma.workspace.findFirst({ where: { id, accountId: ctx.auth.accountId } });
      },
    });

    t.list.field('scripts', {
      type: Script,
      args: { workspaceId: nonNull(idArg()) },
      resolve: async (_root, { workspaceId }, ctx: any) => {
        if (!ctx?.auth?.accountId) return [];
        const ws = await prisma.workspace.findFirst({ where: { id: workspaceId, accountId: ctx.auth.accountId } });
        if (!ws) return [];
        return prisma.script.findMany({ where: { workspaceId } });
      },
    });

    t.list.field('sessions', {
      type: Session,
      args: { workspaceId: nonNull(idArg()) },
      resolve: async (_root, { workspaceId }, ctx: any) => {
        if (!ctx?.auth?.accountId) return [];
        const ws = await prisma.workspace.findFirst({ where: { id: workspaceId, accountId: ctx.auth.accountId } });
        if (!ws) return [];
        const rows = await prisma.session.findMany({ where: { workspaceId }, orderBy: { startedAt: 'desc' } });
        return rows.map((r: any) => ({
          id: r.id,
          type: r.type,
          status: r.status,
          error: r.error,
          startedAt: r.startedAt ? r.startedAt.toISOString() : null,
          completedAt: r.completedAt ? r.completedAt.toISOString() : null,
          scriptId: r.scriptId,
          workspaceId: r.workspaceId,
        })) as any;
      },
    });

    t.field('sessionArtifacts', {
      type: SessionArtifacts,
      args: { sessionId: nonNull(idArg()) },
      async resolve(_root, { sessionId }, ctx: any) {
        if (!ctx?.auth?.accountId) return null as any;
        const r = await prisma.session.findUnique({ where: { id: sessionId } });
        if (!r) return null as any;
        const { workspacePath } = await import('./sdk-bridge').then(m => m.resolveWorkspaceFs(r.workspaceId));
        const sessionDir = path.join(workspacePath, 'sessions', sessionId);
        const guideLog = path.join(sessionDir, 'guide-log.json');
        const toUrl = (p: string | null) => (p && fs.existsSync(p)) ? `/files?path=${encodeURIComponent(p)}` : null;

        // Markdown: prefer path from guide-log.json, then guides/generated-guide.md, then first .md in guides
        let markdownPath: string | null = null;
        try {
          if (fs.existsSync(guideLog)) {
            const log = JSON.parse(fs.readFileSync(guideLog, 'utf8'));
            if (log && typeof log.output === 'string') {
              markdownPath = log.output;
            }
          }
        } catch {}
        if (!markdownPath) {
          const defaultMd = path.join(sessionDir, 'guides', 'generated-guide.md');
          if (fs.existsSync(defaultMd)) markdownPath = defaultMd;
        }
        if (!markdownPath) {
          try {
            const guidesDir = path.join(sessionDir, 'guides');
            if (fs.existsSync(guidesDir)) {
              const md = fs.readdirSync(guidesDir).find(f => f.toLowerCase().endsWith('.md'));
              if (md) markdownPath = path.join(guidesDir, md);
            }
          } catch {}
        }

        // Video: check known locations/patterns
        let videoPath: string | null = null;
        const videosDir = path.join(sessionDir, 'videos');
        const candidateVideos: string[] = [];
        candidateVideos.push(path.join(videosDir, 'guide-video.mp4'));
        try {
          if (fs.existsSync(videosDir)) {
            const vids = fs.readdirSync(videosDir)
              .filter(f => /\.(mp4|webm)$/i.test(f))
              .map(f => path.join(videosDir, f));
            candidateVideos.push(...vids);
          }
        } catch {}
        // Some old runs may leave a .webm at the root
        try {
          const rootWebm = (fs.readdirSync(sessionDir).find(f => f.toLowerCase().endsWith('.webm')));
          if (rootWebm) candidateVideos.push(path.join(sessionDir, rootWebm));
        } catch {}
        videoPath = candidateVideos.find(p => fs.existsSync(p)) || null;

        return {
          markdownUrl: toUrl(markdownPath),
          videoUrl: toUrl(videoPath),
          guideLogUrl: toUrl(guideLog),
        } as any;
      }
    });

    t.list.field('workspaceVariables', {
      type: Variable,
      args: { workspaceId: nonNull(idArg()) },
      async resolve(_root, { workspaceId }, ctx: any) {
        if (!ctx?.auth?.accountId) return [];
        const ws = await prisma.workspace.findFirst({ where: { id: workspaceId, accountId: ctx.auth.accountId } });
        if (!ws) return [];
        const rows = await prisma.workspaceVariable.findMany({ where: { workspaceId } });
        return rows.map((r: any) => ({ key: r.key, value: r.valueJson as any, updatedAt: r.updatedAt.toISOString() }));
      },
    });

    t.list.field('scriptVariables', {
      type: Variable,
      args: { scriptId: nonNull(idArg()) },
      async resolve(_root, { scriptId }, ctx: any) {
        if (!ctx?.auth?.accountId) return [];
        const script = await prisma.script.findUnique({ where: { id: scriptId } });
        if (!script) return [];
        const ws = await prisma.workspace.findFirst({ where: { id: script.workspaceId, accountId: ctx.auth.accountId } });
        if (!ws) return [];
        const rows = await prisma.scriptVariable.findMany({ where: { scriptId } });
        return rows.map((r: any) => ({ key: r.key, value: r.valueJson as any, updatedAt: r.updatedAt.toISOString() }));
      },
    });

    // Secret metadata (keys only; values are never returned)
    t.list.field('workspaceSecrets', {
      type: SecretMeta,
      args: { workspaceId: nonNull(idArg()) },
      async resolve(_root, { workspaceId }, ctx: any) {
        if (!ctx?.auth?.accountId) return [];
        const ws = await prisma.workspace.findFirst({ where: { id: workspaceId, accountId: ctx.auth.accountId } });
        if (!ws) return [];
        const rows = await prisma.workspaceSecret.findMany({ where: { workspaceId } });
        return rows.map((r: any) => ({ key: r.key, updatedAt: r.updatedAt.toISOString(), exists: true }));
      },
    });

    t.list.field('scriptSecrets', {
      type: SecretMeta,
      args: { scriptId: nonNull(idArg()) },
      async resolve(_root, { scriptId }, ctx: any) {
        if (!ctx?.auth?.accountId) return [];
        const script = await prisma.script.findUnique({ where: { id: scriptId } });
        if (!script) return [];
        const ws = await prisma.workspace.findFirst({ where: { id: script.workspaceId, accountId: ctx.auth.accountId } });
        if (!ws) return [];
        const rows = await prisma.scriptSecret.findMany({ where: { scriptId } });
        return rows.map((r: any) => ({ key: r.key, updatedAt: r.updatedAt.toISOString(), exists: true }));
      },
    });
  },
});

export const Mutation = mutationType({
  definition(t) {
    // Auth
    t.nonNull.field('signUp', {
      type: AuthPayload,
      args: { email: nonNull(stringArg()), password: nonNull(stringArg()) },
      resolve: async (_root, { email, password }) => {
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) throw new Error('Email already in use');
        const account = await prisma.account.create({ data: {} });
        const passwordHash = await hashPassword(password);
        const user = await prisma.user.create({ data: { email, passwordHash, accountId: account.id } });
        const token = signToken({ sub: user.id, accountId: user.accountId });
        return { token } as any;
      },
    });

    t.nonNull.field('signIn', {
      type: AuthPayload,
      args: { email: nonNull(stringArg()), password: nonNull(stringArg()) },
      resolve: async (_root, { email, password }) => {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) throw new Error('Invalid credentials');
        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) throw new Error('Invalid credentials');
        const token = signToken({ sub: user.id, accountId: user.accountId });
        return { token } as any;
      },
    });

    // Workspace CRUD (minimal)
    t.nonNull.field('createWorkspace', {
      type: Workspace,
      args: { id: nonNull(idArg()), name: stringArg(), rootPath: stringArg() },
      resolve: async (_root, { id, name, rootPath }, ctx: any) => {
        if (!ctx?.auth?.accountId) throw new Error('Unauthorized');
        return prisma.workspace.create({ data: { id, name: name || null, rootPath: rootPath || null, accountId: ctx.auth.accountId } }) as any;
      },
    });
    // Start async generation
    t.nonNull.field('startGenerate', {
      type: 'Script',
      args: {
        workspaceId: nonNull(idArg()),
        prompt: nonNull(stringArg()),
        options: arg({ type: GenerateOptionsInput }),
      },
      async resolve(_root, { workspaceId, prompt, options }, ctx: any) {
        if (!ctx?.auth?.accountId) throw new Error('Unauthorized');
        const ws = await prisma.workspace.findFirst({ where: { id: workspaceId, accountId: ctx.auth.accountId } });
        if (!ws) throw new Error('Workspace not found');
        const opt = options ? {
          baseUrl: options.baseUrl ?? undefined,
          model: options.model ?? undefined,
          headful: options.headful ?? undefined,
          language: options.language ?? undefined,
          scriptId: options.scriptId ?? undefined,
        } : undefined;
        const scriptId = await startGenerate(workspaceId, prompt, opt);
        return prisma.script.findUniqueOrThrow({ where: { id: scriptId } });
      },
    });

    // Start async run
    t.nonNull.field('startRun', {
      type: 'Session',
      args: {
        workspaceId: nonNull(idArg()),
        scriptOrPath: nonNull(stringArg()),
        options: arg({ type: RunOptionsInput }),
      },
      async resolve(_root, { workspaceId, scriptOrPath, options }, ctx: any) {
        if (!ctx?.auth?.accountId) throw new Error('Unauthorized');
        const ws = await prisma.workspace.findFirst({ where: { id: workspaceId, accountId: ctx.auth.accountId } });
        if (!ws) throw new Error('Workspace not found');
        const opt = options ? {
          headful: options.headful ?? undefined,
          sessionId: options.sessionId ?? undefined,
        } : undefined;
        const sessionId = await startRun(workspaceId, scriptOrPath, opt);
        const r = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
        return {
          id: r.id,
          type: r.type,
          status: r.status,
          error: r.error,
          startedAt: r.startedAt ? r.startedAt.toISOString() : null,
          completedAt: r.completedAt ? r.completedAt.toISOString() : null,
          scriptId: r.scriptId,
          workspaceId: r.workspaceId,
        } as any;
      },
    });

    // Variables & Secrets CRUD (no secret values returned)
    t.nonNull.field('upsertWorkspaceVariable', {
      type: Variable,
      args: {
        workspaceId: nonNull(idArg()),
        key: nonNull(stringArg()),
        value: nonNull(arg({ type: JSONScalar })),
      },
      async resolve(_root, { workspaceId, key, value }, ctx: any) {
        if (!ctx?.auth?.accountId) throw new Error('Unauthorized');
        const ws = await prisma.workspace.findFirst({ where: { id: workspaceId, accountId: ctx.auth.accountId } });
        if (!ws) throw new Error('Workspace not found');
        const row = await prisma.workspaceVariable.upsert({
          where: { workspaceId_key: { workspaceId, key } },
          update: { valueJson: value as any },
          create: { workspaceId, key, valueJson: value as any },
        });
        return { key: row.key, value: row.valueJson as any, updatedAt: row.updatedAt.toISOString() };
      },
    });

    t.nonNull.field('upsertScriptVariable', {
      type: Variable,
      args: {
        scriptId: nonNull(idArg()),
        key: nonNull(stringArg()),
        value: nonNull(arg({ type: JSONScalar })),
      },
      async resolve(_root, { scriptId, key, value }, ctx: any) {
        if (!ctx?.auth?.accountId) throw new Error('Unauthorized');
        const script = await prisma.script.findUnique({ where: { id: scriptId } });
        if (!script) throw new Error('Script not found');
        const ws = await prisma.workspace.findFirst({ where: { id: script.workspaceId, accountId: ctx.auth.accountId } });
        if (!ws) throw new Error('Unauthorized');
        const row = await prisma.scriptVariable.upsert({
          where: { scriptId_key: { scriptId, key } },
          update: { valueJson: value as any },
          create: { scriptId, key, valueJson: value as any },
        });
        return { key: row.key, value: row.valueJson as any, updatedAt: row.updatedAt.toISOString() };
      },
    });

    t.nonNull.field('upsertWorkspaceSecret', {
      type: SecretMeta,
      args: {
        workspaceId: nonNull(idArg()),
        key: nonNull(stringArg()),
        value: nonNull(stringArg()),
      },
      async resolve(_root, { workspaceId, key, value }, ctx: any) {
        if (!ctx?.auth?.accountId) throw new Error('Unauthorized');
        const ws = await prisma.workspace.findFirst({ where: { id: workspaceId, accountId: ctx.auth.accountId } });
        if (!ws) throw new Error('Workspace not found');
        const enc = encryptSecret(value, config.jwtSecret);
        const row = await prisma.workspaceSecret.upsert({
          where: { workspaceId_key: { workspaceId, key } },
          update: { valueEnc: enc as any },
          create: { workspaceId, key, valueEnc: enc as any },
        });
        return { key: row.key, updatedAt: row.updatedAt.toISOString(), exists: true };
      },
    });

    t.nonNull.field('upsertScriptSecret', {
      type: SecretMeta,
      args: {
        scriptId: nonNull(idArg()),
        key: nonNull(stringArg()),
        value: nonNull(stringArg()),
      },
      async resolve(_root, { scriptId, key, value }, ctx: any) {
        if (!ctx?.auth?.accountId) throw new Error('Unauthorized');
        const script = await prisma.script.findUnique({ where: { id: scriptId } });
        if (!script) throw new Error('Script not found');
        const ws = await prisma.workspace.findFirst({ where: { id: script.workspaceId, accountId: ctx.auth.accountId } });
        if (!ws) throw new Error('Unauthorized');
        const enc = encryptSecret(value, config.jwtSecret);
        const row = await prisma.scriptSecret.upsert({
          where: { scriptId_key: { scriptId, key } },
          update: { valueEnc: enc as any },
          create: { scriptId, key, valueEnc: enc as any },
        });
        return { key: row.key, updatedAt: row.updatedAt.toISOString(), exists: true };
      },
    });

    t.nonNull.boolean('deleteWorkspaceVariable', {
      args: { workspaceId: nonNull(idArg()), key: nonNull(stringArg()) },
      resolve: async (_root, { workspaceId, key }, ctx: any) => {
        if (!ctx?.auth?.accountId) throw new Error('Unauthorized');
        const ws = await prisma.workspace.findFirst({ where: { id: workspaceId, accountId: ctx.auth.accountId } });
        if (!ws) throw new Error('Workspace not found');
        await prisma.workspaceVariable.delete({ where: { workspaceId_key: { workspaceId, key } } });
        return true;
      },
    });

    t.nonNull.boolean('deleteScriptVariable', {
      args: { scriptId: nonNull(idArg()), key: nonNull(stringArg()) },
      resolve: async (_root, { scriptId, key }, ctx: any) => {
        if (!ctx?.auth?.accountId) throw new Error('Unauthorized');
        const script = await prisma.script.findUnique({ where: { id: scriptId } });
        if (!script) throw new Error('Script not found');
        const ws = await prisma.workspace.findFirst({ where: { id: script.workspaceId, accountId: ctx.auth.accountId } });
        if (!ws) throw new Error('Unauthorized');
        await prisma.scriptVariable.delete({ where: { scriptId_key: { scriptId, key } } });
        return true;
      },
    });

    t.nonNull.boolean('deleteWorkspaceSecret', {
      args: { workspaceId: nonNull(idArg()), key: nonNull(stringArg()) },
      resolve: async (_root, { workspaceId, key }, ctx: any) => {
        if (!ctx?.auth?.accountId) throw new Error('Unauthorized');
        const ws = await prisma.workspace.findFirst({ where: { id: workspaceId, accountId: ctx.auth.accountId } });
        if (!ws) throw new Error('Workspace not found');
        await prisma.workspaceSecret.delete({ where: { workspaceId_key: { workspaceId, key } } });
        return true;
      },
    });

    t.nonNull.boolean('deleteScriptSecret', {
      args: { scriptId: nonNull(idArg()), key: nonNull(stringArg()) },
      resolve: async (_root, { scriptId, key }, ctx: any) => {
        if (!ctx?.auth?.accountId) throw new Error('Unauthorized');
        const script = await prisma.script.findUnique({ where: { id: scriptId } });
        if (!script) throw new Error('Script not found');
        const ws = await prisma.workspace.findFirst({ where: { id: script.workspaceId, accountId: ctx.auth.accountId } });
        if (!ws) throw new Error('Unauthorized');
        await prisma.scriptSecret.delete({ where: { scriptId_key: { scriptId, key } } });
        return true;
      },
    });

    t.nonNull.field('importScript', {
      type: Script,
      args: {
        workspaceId: nonNull(idArg()),
        json: nonNull(arg({ type: JSONScalar })),
        scriptId: stringArg(),
        overwrite: booleanArg(),
      },
      async resolve(_, { workspaceId, json, scriptId, overwrite }) {
        const { scriptId: sid } = await importScript(workspaceId, json, { scriptId: scriptId || undefined, overwrite: overwrite ?? undefined });
        return prisma.script.findUniqueOrThrow({ where: { id: sid } });
      },
    });

    t.nonNull.field('exportScript', {
      type: JSONScalar,
      args: { workspaceId: nonNull(idArg()), scriptId: nonNull(idArg()) },
      resolve: async (_root, { workspaceId, scriptId }, ctx: any) => {
        if (!ctx?.auth?.accountId) throw new Error('Unauthorized');
        const ws = await prisma.workspace.findFirst({ where: { id: workspaceId, accountId: ctx.auth.accountId } });
        if (!ws) throw new Error('Workspace not found');
        return exportScript(workspaceId, scriptId);
      },
    });
  },
});

export const Subscription = subscriptionType({
  definition(t) {
    t.field('onPromptEvents', {
      type: JSONScalar,
      args: { scriptId: nonNull(idArg()) },
      subscribe: (_root, { scriptId }) => {
        try {
          return subscribePrompt(scriptId) as any;
        } catch (e) {
          async function* fallback() { yield { type: 'error', message: 'Script not found', code: 'SCRIPT_NOT_FOUND' }; }
          return fallback();
        }
      },
      resolve: (event) => event,
    });

    t.field('onRunEvents', {
      type: JSONScalar,
      args: { sessionId: nonNull(idArg()) },
      subscribe: (_root, { sessionId }) => {
        try {
          return subscribeRun(sessionId) as any;
        } catch (e) {
          async function* fallback() { yield { type: 'error', message: 'Session not found', code: 'SESSION_NOT_FOUND' }; }
          return fallback();
        }
      },
      resolve: (event) => event,
    });
  },
});

export const schema = makeSchema({
  types: [JSONScalar, SessionTypeEnum, SecretMeta, Variable, Workspace, Script, Session, SessionArtifacts, Query, Mutation, Subscription],
  outputs: {
    schema: __dirname + '/../graphql/schema.graphql',
    typegen: __dirname + '/nexus-typegen.ts',
  },
  contextType: undefined as any,
});
