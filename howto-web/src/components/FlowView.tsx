import { useEffect, useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import StepBuilder from './StepBuilder';
import MarkdownEditor from './MarkdownEditor';
import ScriptKV from './ScriptKV';
import RunStream from './RunStream';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { getServerBase } from '../serverBase';
import { useToast } from './ToastProvider';

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

const START_RUN = gql`
  mutation StartRun($workspaceId: ID!, $scriptOrPath: String!, $options: RunOptionsInput) {
    startRun(workspaceId: $workspaceId, scriptOrPath: $scriptOrPath, options: $options) { id type status scriptId workspaceId }
  }
`;

const SESSIONS = gql`
  query Sessions($workspaceId: ID!) {
    sessions(workspaceId: $workspaceId) { id type status error startedAt completedAt scriptId workspaceId }
  }
`;

const SESSION_ARTIFACTS = gql`
  query SessionArtifacts($sessionId: ID!) {
    sessionArtifacts(sessionId: $sessionId) { markdownUrl videoUrl guideLogUrl }
  }
`;

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

export default function FlowView({ 
  scriptId, 
  tab: propTab, 
  onBack, 
  onTabChange 
}: { 
  scriptId: string; 
  tab?: 'edit' | 'sessions';
  onBack: () => void; 
  onTabChange?: (tab: 'edit' | 'sessions') => void;
}) {
  const { show } = useToast();
  const workspaceId = useMemo(() => localStorage.getItem('howto_workspace') || '', []);
  const tab = propTab || 'edit';
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [runSessionId, setRunSessionId] = useState<string | null>(null);

  const [state, setState] = useState<{
    mode: 'form' | 'markdown';
    body: string;
    config: GuideConfig;
    rawMarkdown?: string;
  } | null>(null);

  const [exportScript] = useMutation(EXPORT_SCRIPT);
  const [importScript, { loading: saving }] = useMutation(IMPORT_SCRIPT);
  const [startRun, { loading: running }] = useMutation(START_RUN);

  // Load script
  useEffect(() => {
    setErrMsg(null);
    exportScript({ variables: { workspaceId, scriptId } })
      .then((res) => {
        const json = (res.data as any)?.exportScript as any;
        if (!json) throw new Error('Failed to load');
        const cfg: GuideConfig = json?.config || {
          title: json?.metadata?.title || 'Untitled',
          baseUrl: json?.metadata?.baseUrl || '',
          steps: [],
        };
        const body = json?.body || '';
        setState({ mode: 'form', config: cfg, body, rawMarkdown: buildMarkdown(cfg, body) });
      })
      .catch((e) => setErrMsg(e.message || 'Failed to load'));
  }, [exportScript, workspaceId, scriptId]);

  const onSave = async () => {
    if (!state) return;
    setErrMsg(null);
    let config = state.config;
    let body = state.body;
    if (state.mode === 'markdown') {
      try {
        const parsed = parseMarkdown(state.rawMarkdown || '');
        config = parsed.config as GuideConfig;
        body = parsed.body || '';
      } catch (e) {
        setErrMsg('Could not parse markdown/frontmatter');
        return;
      }
      if (!config?.title || !config?.baseUrl || !Array.isArray(config?.steps)) {
        setErrMsg('Frontmatter must include at least title, baseUrl and steps');
        return;
      }
    }
    const payload = { scriptId, metadata: { title: config.title, baseUrl: config.baseUrl }, config, body, exportedAt: new Date().toISOString() };
    try {
      await importScript({ variables: { workspaceId, json: payload, scriptId, overwrite: true } });
      show('Saved', 'success');
    } catch (e: any) {
      setErrMsg(e.message || 'Failed to save');
      show('Failed to save', 'error');
    }
  };

  // Sessions for this script
  const { data: sessionsData, loading: sessionsLoading, error: sessionsError, refetch: refetchSessions } = useQuery(SESSIONS, {
    variables: { workspaceId },
    skip: !workspaceId,
    fetchPolicy: 'cache-and-network',
  });
  const sessions = (sessionsData?.sessions || []).filter((s: any) => s.type === 'RUN' && s.scriptId === scriptId);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const { data: art, refetch: refetchArt } = useQuery(SESSION_ARTIFACTS, {
    variables: { sessionId: selectedSession as string },
    skip: !selectedSession,
    fetchPolicy: 'cache-and-network',
  });
  const apiBase = getServerBase();
  const token = useMemo(() => localStorage.getItem('howto_token') || '', []);
  const [mdText, setMdText] = useState<string | null>(null);
  useEffect(() => {
    setMdText(null);
    const url = art?.sessionArtifacts?.markdownUrl as string | undefined;
    if (!url) return;
    const full = `${apiBase}${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
    fetch(full).then(r => r.text()).then(setMdText).catch(() => setMdText(null));
  }, [art?.sessionArtifacts?.markdownUrl, apiBase, token]);

  return (
    <section className="ios-card p-0">
      <div className="ios-nav px-6">
        <div className="flex items-center gap-4">
          <button className="ios-button-secondary" onClick={onBack}>Back</button>
          <h2 className="text-lg font-semibold text-gray-900">Flow</h2>
        </div>
        <div className="ml-auto ios-segment">
          <button 
            className={`ios-segment-button ${tab==='edit' ? 'ios-segment-button-active' : ''}`} 
            onClick={() => onTabChange?.('edit')}
          >
            Edit
          </button>
          <button 
            className={`ios-segment-button ${tab==='sessions' ? 'ios-segment-button-active' : ''}`} 
            onClick={() => onTabChange?.('sessions')}
          >
            Results
          </button>
        </div>
      </div>

      {tab === 'edit' && (
        <div className="p-6 space-y-6">
          {!state && <div className="text-sm text-gray-500">Loading…</div>}
          {state && (
            <>
              <div className="flex items-center justify-between">
                <div className="ios-segment">
                  <button type="button" className={`ios-segment-button ${state.mode==='form' ? 'ios-segment-button-active' : ''}`} onClick={()=>setState({ ...state, mode: 'form' })}>Form</button>
                  <button type="button" className={`ios-segment-button ${state.mode==='markdown' ? 'ios-segment-button-active' : ''}`} onClick={()=>setState({ ...state, mode: 'markdown', rawMarkdown: buildMarkdown(state.config, state.body) })}>Markdown</button>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="ios-button-primary"
                    disabled={running}
                    onClick={async ()=>{
                      setErrMsg(null); setRunSessionId(null);
                      try {
                        const res = await startRun({ variables: { workspaceId, scriptOrPath: scriptId, options: {} } });
                        const sid = (res.data as any)?.startRun?.id as string | undefined;
                        if (sid) { setRunSessionId(sid); show('Run started', 'success'); onTabChange?.('sessions'); setSelectedSession(sid); }
                      } catch (e: any) { setErrMsg(e.message || 'Run failed'); show('Run failed', 'error'); }
                    }}
                  >{running ? 'Starting…' : 'Run'}</button>
                  <button type="button" className="ios-button-primary" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</button>
                </div>
              </div>

              {state.mode === 'form' ? (
                <div className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Title</label>
                      <input className="ios-input" value={state.config.title} onChange={(e)=>setState({ ...state, config: { ...state.config, title: e.target.value } })} />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Base URL</label>
                      <input className="ios-input" value={state.config.baseUrl} onChange={(e)=>setState({ ...state, config: { ...state.config, baseUrl: e.target.value } })} placeholder="https://app.example.com" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Language</label>
                      <input className="ios-input" value={state.config.language || ''} onChange={(e)=>setState({ ...state, config: { ...state.config, language: e.target.value || undefined } })} />
                    </div>
                    <label className="flex items-center gap-3 mt-6 text-sm font-medium cursor-pointer text-gray-700">
                      <input id="recordVideo" type="checkbox" className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" checked={!!state.config.recordVideo} onChange={(e)=>setState({ ...state, config: { ...state.config, recordVideo: e.target.checked || undefined } })} />
                      <span>Record video</span>
                    </label>
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Timeout (ms)</label>
                      <input type="number" className="ios-input" value={state.config.timeout ?? ''} onChange={(e)=>setState({ ...state, config: { ...state.config, timeout: e.target.value ? Number(e.target.value) : undefined } })} />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">TTS Default Delay (ms)</label>
                      <input type="number" className="ios-input" value={state.config.ttsDefaultDelayMs ?? ''} onChange={(e)=>setState({ ...state, config: { ...state.config, ttsDefaultDelayMs: e.target.value ? Number(e.target.value) : undefined } })} />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Tags (comma-separated)</label>
                      <input className="ios-input" value={(state.config.tags || []).join(', ')} onChange={(e)=>setState({ ...state, config: { ...state.config, tags: e.target.value.split(',').map(s=>s.trim()).filter(Boolean) } })} />
                    </div>
                  </div>
                  <StepBuilder steps={state.config.steps || []} onChange={(steps)=>setState({ ...state, config: { ...state.config, steps } })} />
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-gray-700">Markdown Body</label>
                    <MarkdownEditor 
                      value={state.body} 
                      onChange={(value) => setState({ ...state, body: value })} 
                      placeholder="Write your guide content in markdown..."
                      minHeight="200px"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-semibold mb-2 text-gray-700">Markdown incl. frontmatter</label>
                  <MarkdownEditor 
                    value={state.rawMarkdown || ''} 
                    onChange={(value) => setState({ ...state, rawMarkdown: value })} 
                    placeholder="---\ntitle: My Guide\nbaseUrl: https://example.com\nsteps: []\n---\n\n# My Guide\n\nContent here..."
                    minHeight="360px"
                  />
                  <div className="text-xs text-gray-500 mt-2">YAML frontmatter between --- and --- at the top.</div>
                </div>
              )}
              {errMsg && <div className="ios-badge-error p-3">{errMsg}</div>}
              <div className="pt-2">
                <ScriptKV scriptId={scriptId} />
              </div>
              {runSessionId && (
                <div className="mt-8">
                  <div className="text-sm font-semibold text-gray-700 mb-3">Run Events (Session {runSessionId})</div>
                  <RunStream sessionId={runSessionId} scriptConfig={state.config} />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'sessions' && (
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-900">Session Results</h3>
            <button className="ios-button-secondary" onClick={()=>refetchSessions()}>Refresh</button>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="ios-card p-0">
              {sessionsLoading ? (
                <div className="p-4 text-sm text-gray-500">Loading sessions…</div>
              ) : sessionsError ? (
                <div className="p-4 ios-badge-error">{String(sessionsError.message)}</div>
              ) : (
                <div className="ios-list">
                  {sessions.map((s: any) => (
                    <div key={s.id} className={`ios-list-item cursor-pointer ${selectedSession===s.id ? 'ios-list-item-active' : ''}`} onClick={()=>setSelectedSession(s.id)}>
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold truncate">{s.status || 'started'}</div>
                          <div className="text-xs text-gray-500 truncate mt-1">{s.id}</div>
                        </div>
                        {s.completedAt && <div className="ios-badge-success text-xs">done</div>}
                      </div>
                      <div className="text-xs text-gray-500 mt-2">
                        {s.startedAt && <span>Start: {s.startedAt}</span>}
                        {s.completedAt && <span> • End: {s.completedAt}</span>}
                      </div>
                      {s.error && <div className="text-xs ios-badge-error mt-2 break-words">{s.error}</div>}
                    </div>
                  ))}
                  {sessionsData && sessions.length === 0 && (
                    <div className="p-8 text-center text-sm text-gray-500">No sessions yet.</div>
                  )}
                </div>
              )}
            </div>
            <div className="ios-card-elevated p-4">
              {!selectedSession && <div className="text-sm text-gray-500">Select a session to see events and artifacts.</div>}
              {selectedSession && (
                <div>
                  <div className="text-sm font-semibold text-gray-700 mb-3">Session Events: {selectedSession}</div>
                  <RunStream sessionId={selectedSession} />
                  <div className="mt-6 space-y-4">
                    <div>
                      <div className="text-sm font-semibold text-gray-700 mb-2">Generated Markdown</div>
                      {!art?.sessionArtifacts?.markdownUrl && <div className="ios-badge text-xs">No markdown file found.</div>}
                      {art?.sessionArtifacts?.markdownUrl && (
                        <div className="ios-card-elevated p-0">
                          <div className="px-4 py-3 border-b border-white/60 text-xs text-gray-600 flex items-center justify-between">
                            <span>Preview</span>
                            <a className="ios-badge-primary text-white no-underline" href={`${apiBase}${art.sessionArtifacts.markdownUrl}${art.sessionArtifacts.markdownUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`} target="_blank" rel="noreferrer">Open</a>
                          </div>
                          <pre className="p-4 overflow-auto text-xs whitespace-pre-wrap font-mono text-gray-900">{mdText || 'Loading…'}</pre>
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gray-700 mb-2">Video</div>
                      {!art?.sessionArtifacts?.videoUrl && <div className="ios-badge text-xs">No video found.</div>}
                      {art?.sessionArtifacts?.videoUrl && (<video className="w-full max-w-xl ios-card" style={{padding: '4px'}} controls src={`${apiBase}${art.sessionArtifacts.videoUrl}${art.sessionArtifacts.videoUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`}></video>)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
