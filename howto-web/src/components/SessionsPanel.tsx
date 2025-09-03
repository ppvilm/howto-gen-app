import { gql, useQuery } from '@apollo/client';
import { useEffect, useMemo, useState } from 'react';
import RunStream from './RunStream';
import PromptStream from './PromptStream';
import { getServerBase } from '../serverBase';

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

export default function SessionsPanel({ filterType }: { filterType?: 'PROMPT' | 'RUN' }) {
  const workspaceId = useMemo(() => localStorage.getItem('howto_workspace'), []);
  const [currentWs, setCurrentWs] = useState<string | null>(workspaceId);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const onStorage = () => setCurrentWs(localStorage.getItem('howto_workspace'));
    window.addEventListener('storage', onStorage);
    const id = setInterval(onStorage, 500);
    return () => { window.removeEventListener('storage', onStorage); clearInterval(id); };
  }, []);

  const { data, loading, error, refetch } = useQuery(SESSIONS, {
    variables: { workspaceId: currentWs as string },
    skip: !currentWs,
    fetchPolicy: 'cache-and-network',
  });
  const sessions = (data?.sessions || []).filter((s: any) => !filterType || s.type === filterType);
  const [mdText, setMdText] = useState<string | null>(null);
  const apiBase = useMemo(() => getServerBase(), []);
  const token = useMemo(() => localStorage.getItem('howto_token') || '', []);

  const { data: art, refetch: refetchArt } = useQuery(SESSION_ARTIFACTS, {
    variables: { sessionId: selected as string },
    skip: !selected || filterType !== 'RUN',
    fetchPolicy: 'cache-and-network',
  });

  useEffect(() => {
    setMdText(null);
    const url = art?.sessionArtifacts?.markdownUrl as string | undefined;
    if (!url) return;
    // Append token param for /files auth
    const full = `${apiBase}${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
    fetch(full).then(r => r.text()).then(setMdText).catch(() => setMdText(null));
  }, [art?.sessionArtifacts?.markdownUrl, apiBase, token]);

  return (
    <section className="ios-card p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Sessions</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={()=> currentWs && refetch()} className="ios-button-secondary text-sm">Refresh</button>
        </div>
      </div>

      {!currentWs && (
        <div className="text-sm text-gray-600 mt-3">Please select a workspace first.</div>
      )}

      {currentWs && (
        <div className="mt-3 grid md:grid-cols-2 gap-4">
          <div className="ios-list">
            {loading ? (
              <div className="text-sm text-gray-500 p-3">Loading sessions…</div>
            ) : error ? (
              <div className="text-sm text-red-600 p-3">{String(error.message)}</div>
            ) : (
              <ul className="divide-y">
                {sessions.map((s: any) => (
                  <li key={s.id} className={`ios-list-item cursor-pointer ${selected===s.id ? 'ios-list-item-active' : ''}`} onClick={()=>setSelected(s.id)}>
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{s.type} • {s.status || 'started'}</div>
                        <div className="text-xs text-gray-600 truncate">{s.id}</div>
                      </div>
                      {s.completedAt && <div className="text-xs text-gray-500">done</div>}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {s.startedAt && <span>Start: {s.startedAt}</span>}
                      {s.completedAt && <span> • End: {s.completedAt}</span>}
                      {s.scriptId && <span> • Script: {s.scriptId}</span>}
                    </div>
                    {s.error && <div className="text-xs text-red-600 break-words mt-1">{s.error}</div>}
                  </li>
                ))}
                {data && sessions.length === 0 && (
                  <li className="p-6 text-center text-sm text-gray-500">No sessions yet.</li>
                )}
              </ul>
            )}
          </div>
          <div className="ios-card-elevated p-4">
            {!selected && <div className="text-sm text-gray-500">Select a session on the left to see events.</div>}
            {selected && (
              <div>
                <div className="text-sm text-gray-700 mb-2">Session Events: {selected}</div>
                {(() => {
                  if (!filterType || filterType === 'RUN') {
                    return <RunStream sessionId={selected} />;
                  }
                  const selectedSession = sessions.find((s: any) => s.id === selected);
                  const scriptId = selectedSession?.scriptId as string | undefined;
                  if (!scriptId) return <div className="text-sm text-gray-500">No script ID found for this session.</div>;
                  return <PromptStream scriptId={scriptId} />;
                })()}
                {filterType === 'RUN' && (
                  <div className="mt-4 space-y-3">
                    <div>
                      <div className="text-sm font-medium">Generated Markdown</div>
                      {!art?.sessionArtifacts?.markdownUrl && <div className="text-xs text-gray-500">No markdown file found.</div>}
                      {art?.sessionArtifacts?.markdownUrl && (
                        <div className="border rounded bg-white">
                          <div className="px-3 py-2 border-b text-xs text-gray-600 flex items-center justify-between">
                            <span>Preview</span>
                            <a className="text-blue-600 hover:underline" href={`${apiBase}${art.sessionArtifacts.markdownUrl}${art.sessionArtifacts.markdownUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`} target="_blank" rel="noreferrer">Open</a>
                          </div>
                          <pre className="p-3 overflow-auto text-xs whitespace-pre-wrap text-gray-900">{mdText || 'Loading…'}</pre>
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-medium">Video</div>
                      {!art?.sessionArtifacts?.videoUrl && <div className="text-xs text-gray-500">No video found.</div>}
                      {art?.sessionArtifacts?.videoUrl && (
                        <video className="w-full max-w-xl mt-1 border rounded" controls src={`${apiBase}${art.sessionArtifacts.videoUrl}${art.sessionArtifacts.videoUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`}></video>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
