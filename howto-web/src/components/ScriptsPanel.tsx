import { useEffect, useMemo, useState } from 'react';
import { gql, useLazyQuery, useMutation, useQuery } from '@apollo/client';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import StepBuilder from './StepBuilder';
import MarkdownEditor from './MarkdownEditor';
import ScriptKV from './ScriptKV';
import RunStream from './RunStream';
import { useToast } from './ToastProvider';

const SCRIPTS = gql`
  query Scripts($workspaceId: ID!) {
    scripts(workspaceId: $workspaceId) { id name path workspaceId }
  }
`;

const EXPORT_SCRIPT = gql`
  mutation ExportScript($workspaceId: ID!, $scriptId: ID!) {
    exportScript(workspaceId: $workspaceId, scriptId: $scriptId)
  }
`;

const IMPORT_SCRIPT = gql`
  mutation ImportScript($workspaceId: ID!, $json: JSON!, $scriptId: String, $overwrite: Boolean) {
    importScript(workspaceId: $workspaceId, json: $json, scriptId: $scriptId, overwrite: $overwrite) { id path name }
  }
`;

type Script = { id: string; name?: string | null; path: string; workspaceId: string };
type StepAction = {
  type: 'goto' | 'type' | 'click' | 'assert' | 'assert_page' | 'tts_start' | 'tts_wait' | 'keypress';
  label?: string;
  url?: string;
  value?: string;
  sensitive?: boolean;
  note?: string;
  timeout?: number;
  waitMs?: number;
  screenshot?: boolean;
  domSnapshot?: boolean;
  text?: string;
  voice?: string;
  delayMs?: number;
  selector?: string;
  key?: string;
};
type GuideConfig = {
  title: string;
  baseUrl: string;
  steps: StepAction[];
  language?: string;
  outputDir?: string;
  tags?: string[];
  recordVideo?: boolean;
  timeout?: number;
  ttsDefaultDelayMs?: number;
};

const START_RUN = gql`
  mutation StartRun($workspaceId: ID!, $scriptOrPath: String!, $options: RunOptionsInput) {
    startRun(workspaceId: $workspaceId, scriptOrPath: $scriptOrPath, options: $options) { id type status scriptId workspaceId }
  }
`;

function basename(p?: string | null): string | null {
  if (!p) return null;
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || null;
}

export default function ScriptsPanel({ onOpenScript }: { onOpenScript: (scriptId: string) => void }) {
  const { show } = useToast();
  function buildMarkdown(cfg: GuideConfig, body: string): string {
    const fm = yamlStringify(cfg).trimEnd();
    return `---\n${fm}\n---\n\n${body}`;
    }

  function parseMarkdown(raw: string): { config: any; body: string } {
    const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (!m) throw new Error('No frontmatter found');
    const yaml = m[1];
    const body = m[2] || '';
    const cfg = yamlParse(yaml);
    return { config: cfg, body };
  }

  const workspaceId = useMemo(() => localStorage.getItem('howto_workspace'), []);
  const [currentWs, setCurrentWs] = useState<string | null>(workspaceId);
  // Track workspace changes from other components
  useEffect(() => {
    const onStorage = () => setCurrentWs(localStorage.getItem('howto_workspace'));
    window.addEventListener('storage', onStorage);
    const id = setInterval(onStorage, 500);
    return () => { window.removeEventListener('storage', onStorage); clearInterval(id); };
  }, []);

  const { data, loading, error, refetch } = useQuery<{ scripts: Script[] }>(SCRIPTS, {
    variables: { workspaceId: currentWs as string },
    skip: !currentWs,
    fetchPolicy: 'cache-and-network',
  });

  const [exportScript] = useMutation<{ exportScript: any }>(EXPORT_SCRIPT);
  const [importScript, { loading: saving }] = useMutation(IMPORT_SCRIPT);
  const [startRun, { loading: running }] = useMutation(START_RUN);

  const [editing, setEditing] = useState<null | {
    scriptId?: string;
    mode: 'form' | 'markdown';
    body: string;
    config: GuideConfig;
    rawMarkdown?: string; // full markdown with frontmatter
  }>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [runSessionId, setRunSessionId] = useState<string | null>(null);
  const [headful, setHeadful] = useState<boolean>(false);

  const onNew = () => {
    setErrMsg(null);
    const config: GuideConfig = {
      title: 'New HowTo Guide',
      baseUrl: 'https://example.com',
      steps: [],
    };
    const body = `# Steps\n\n1. Example step\n2. Second step\n`;
    const rawMarkdown = buildMarkdown(config, body);
    setEditing({ mode: 'form', config, body, rawMarkdown });
  };

  const onEdit = async (scriptId: string) => { onOpenScript(scriptId); };

  // Auto-open a script requested by other components (e.g., GenerateAI)
  useEffect(() => {
    const t = setInterval(() => {
      const want = localStorage.getItem('howto_open_script');
      if (want && currentWs) {
        onEdit(want).finally(() => {
          localStorage.removeItem('howto_open_script');
        });
      }
    }, 500);
    return () => clearInterval(t);
  }, [currentWs]);

  const onSave = async () => {
    if (!currentWs || !editing) return;
    setErrMsg(null);
    let config: GuideConfig = editing.config;
    let body = editing.body;
    if (editing.mode === 'markdown') {
      try {
        const parsed = parseMarkdown(editing.rawMarkdown || '');
        config = parsed.config as GuideConfig;
        body = parsed.body || '';
      } catch (err) {
        setErrMsg('Could not parse markdown/frontmatter');
        return;
      }
      if (!config?.title || !config?.baseUrl || !Array.isArray(config?.steps)) {
        setErrMsg('Frontmatter must include at least title, baseUrl and steps');
        return;
      }
    }
    const payload = {
      scriptId: editing.scriptId || '',
      metadata: { title: config.title, baseUrl: config.baseUrl },
      config,
      body,
      exportedAt: new Date().toISOString(),
    };
    try {
      const res = await importScript({
        variables: {
          workspaceId: currentWs,
          json: payload,
          scriptId: editing.scriptId || null,
          overwrite: !!editing.scriptId,
        },
        refetchQueries: [{ query: SCRIPTS, variables: { workspaceId: currentWs } }],
      });
      const sid = res.data?.importScript?.id as string | undefined;
      if (!editing.scriptId && sid) {
        // If created new, immediately open it for editing
        await onEdit(sid);
      }
      show('Saved', 'success');
    } catch (e: any) {
      setErrMsg(e.message || 'Failed to save');
      show('Failed to save', 'error');
    }
  };

  if (editing) {
    return (
      <section className="ios-card p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">{editing.scriptId ? 'Edit Script' : 'New Script'}</h3>
          <div className="flex items-center gap-3">
            <div className="ios-segment">
              <button
                type="button"
                className={`ios-segment-button ${editing.mode==='form' ? 'ios-segment-button-active' : ''}`}
                onClick={() => setEditing({ ...editing, mode: 'form' })}
              >Form</button>
              <button
                type="button"
                className={`ios-segment-button ${editing.mode==='markdown' ? 'ios-segment-button-active' : ''}`}
                onClick={() => setEditing({ ...editing, mode: 'markdown', rawMarkdown: buildMarkdown(editing.config, editing.body) })}
              >Markdown</button>
            </div>
          </div>
        </div>

        {editing.mode === 'form' ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">Title</label>
                <input
                  className="ios-input"
                  value={editing.config.title}
                  onChange={(e) => setEditing({ ...editing, config: { ...editing.config, title: e.target.value } })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700">Base URL</label>
                <input
                  className="ios-input"
                  value={editing.config.baseUrl}
                  onChange={(e) => setEditing({ ...editing, config: { ...editing.config, baseUrl: e.target.value } })}
                  placeholder="https://app.example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700">Language</label>
                <input
                  className="ios-input"
                  value={editing.config.language || ''}
                  onChange={(e) => setEditing({ ...editing, config: { ...editing.config, language: e.target.value || undefined } })}
                />
              </div>
              <div className="flex items-center gap-2 mt-6">
                <input
                  id="recordVideo"
                  type="checkbox"
                  className="h-4 w-4"
                  checked={!!editing.config.recordVideo}
                  onChange={(e) => setEditing({ ...editing, config: { ...editing.config, recordVideo: e.target.checked || undefined } })}
                />
                <label htmlFor="recordVideo" className="text-sm text-gray-700">Record video</label>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700">Timeout (ms)</label>
                <input
                  type="number"
                  className="ios-input"
                  value={editing.config.timeout ?? ''}
                  onChange={(e) => setEditing({ ...editing, config: { ...editing.config, timeout: e.target.value ? Number(e.target.value) : undefined } })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700">TTS Default Delay (ms)</label>
                <input
                  type="number"
                  className="ios-input"
                  value={editing.config.ttsDefaultDelayMs ?? ''}
                  onChange={(e) => setEditing({ ...editing, config: { ...editing.config, ttsDefaultDelayMs: e.target.value ? Number(e.target.value) : undefined } })}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1 text-gray-700">Tags (comma-separated)</label>
                <input
                  className="ios-input"
                  value={(editing.config.tags || []).join(', ')}
                  onChange={(e) => setEditing({ ...editing, config: { ...editing.config, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })}
                />
              </div>
            </div>
            <StepBuilder
              steps={editing.config.steps || []}
              onChange={(steps) => {
                setErrMsg(null);
                setEditing({ ...editing, config: { ...editing.config, steps } });
              }}
            />
            <div className="mt-3">
              <label className="block text-sm font-medium mb-1 text-gray-700">Markdown Body</label>
              <MarkdownEditor 
                value={editing.body}
                onChange={(value) => setEditing({ ...editing, body: value })}
                placeholder="Write your guide content in markdown..."
                minHeight="200px"
              />
            </div>
          </>
        ) : (
          <div className="mt-3">
            <label className="block text-sm font-medium mb-1 text-gray-700">Markdown incl. frontmatter</label>
            <MarkdownEditor 
              value={editing.rawMarkdown || ''}
              onChange={(value) => setEditing({ ...editing, rawMarkdown: value })}
              placeholder="---\ntitle: My Guide\nbaseUrl: https://example.com\nsteps: []\n---\n\n# My Guide\n\nContent here..."
              minHeight="360px"
            />
            <div className="text-[11px] text-gray-500 mt-1">YAML frontmatter between --- and --- at the top.</div>
          </div>
        )}
        {errMsg && <div className="text-sm text-red-600 mt-2">{errMsg}</div>}
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="ios-button-primary"
          >{saving ? 'Saving…' : 'Save'}</button>
          <button
            type="button"
            onClick={() => setEditing(null)}
            className="ios-button-secondary"
          >Cancel</button>
          {editing.scriptId && (
            <>
              <label className="ml-4 text-sm text-gray-700 flex items-center gap-2">
                <input type="checkbox" checked={headful} onChange={(e)=>setHeadful(e.target.checked)} /> Headful
              </label>
              <button
                type="button"
                onClick={async () => {
                  if (!currentWs || !editing?.scriptId) return;
                  setErrMsg(null);
                  setRunSessionId(null);
                  try {
                    const res = await startRun({ variables: { workspaceId: currentWs, scriptOrPath: editing.scriptId, options: headful ? { headful: true } : {} } });
                    const sid = res.data?.startRun?.id as string | undefined;
                    if (sid) { setRunSessionId(sid); show('Run started', 'success'); }
                  } catch (e: any) {
                    setErrMsg(e.message || 'Run failed');
                    show('Run failed', 'error');
                  }
                }}
                disabled={running}
                className="ios-button-primary"
              >{running ? 'Starting…' : 'Run'}</button>
            </>
          )}
        </div>

        {/* Script-level Variables & Secrets */}
        {editing.scriptId && (
          <div className="mt-8">
            <ScriptKV scriptId={editing.scriptId} />
          </div>
        )}
        {runSessionId && (
          <div className="mt-6">
            <div className="text-sm text-gray-700">Run Events (Session {runSessionId})</div>
            <RunStream sessionId={runSessionId} scriptConfig={editing.config} />
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="ios-card p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Flows</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => currentWs && refetch()}
            className="ios-button-secondary"
          >Refresh</button>
          <button
            type="button"
            onClick={onNew}
            className="ios-button-primary"
          >New</button>
        </div>
      </div>

      {!currentWs && (
        <div className="ios-badge text-sm">Please select a workspace first.</div>
      )}

      {currentWs && (
        <div>
          {loading ? (
            <div className="text-sm text-gray-500">Loading scripts…</div>
          ) : error ? (
            <div className="ios-badge-error">{error.message}</div>
          ) : (
            <div className="ios-list">
              {(data?.scripts || []).map((s) => (
                <div key={s.id} className="ios-list-item flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-gray-900 truncate">{s.name || basename(s.path) || s.id}</div>
                    <div className="text-xs text-gray-500 truncate mt-1">{s.path || s.id}</div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <button
                      type="button"
                      onClick={() => onEdit(s.id)}
                      className="ios-button-secondary text-xs px-3 py-1.5"
                    >Edit</button>
                  </div>
                </div>
              ))}
              {data && data.scripts.length === 0 && (
                <div className="py-12 text-center text-sm text-gray-500">No scripts yet. Create a new one.</div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
