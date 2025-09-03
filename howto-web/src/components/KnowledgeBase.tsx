import { useEffect, useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { useToast } from './ToastProvider';
import MarkdownEditor from './MarkdownEditor';

const WORKSPACE_VARIABLES = gql`
  query WorkspaceVariables($workspaceId: ID!) {
    workspaceVariables(workspaceId: $workspaceId) { key value updatedAt }
  }
`;

const UPSERT_W_VAR = gql`
  mutation UpsertWorkspaceVariable($workspaceId: ID!, $key: String!, $value: JSON!) {
    upsertWorkspaceVariable(workspaceId: $workspaceId, key: $key, value: $value) { key value updatedAt }
  }
`;

const KB_KEY = 'knowledge_base';

export default function KnowledgeBase() {
  const { show } = useToast();
  const initialWs = useMemo(() => localStorage.getItem('howto_workspace'), []);
  const [currentWs, setCurrentWs] = useState<string | null>(initialWs);
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const tick = setInterval(() => setCurrentWs(localStorage.getItem('howto_workspace')), 500);
    return () => clearInterval(tick);
  }, []);

  const { data, loading, refetch } = useQuery(WORKSPACE_VARIABLES, {
    variables: { workspaceId: currentWs as string },
    skip: !currentWs,
    fetchPolicy: 'cache-and-network',
    onCompleted: (d: any) => {
      const kb = (d?.workspaceVariables || []).find((v: any) => v.key === KB_KEY);
      setText(typeof kb?.value === 'string' ? kb.value : '');
      setDirty(false);
    }
  });

  const [upsertVar, { loading: saving }] = useMutation(UPSERT_W_VAR);

  const onSave = async () => {
    if (!currentWs) return;
    await upsertVar({
      variables: { workspaceId: currentWs, key: KB_KEY, value: text },
      refetchQueries: [{ query: WORKSPACE_VARIABLES, variables: { workspaceId: currentWs } }]
    });
    setDirty(false);
    show('Knowledge Base saved', 'success');
  };

  return (
    <section className="ios-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Knowledge Base</h2>
        {currentWs && (
          <div className="text-xs text-gray-500">Workspace: <span className="font-mono">{currentWs}</span></div>
        )}
      </div>

      {!currentWs && (
        <div className="ios-badge text-center py-6">
          <div className="text-gray-500 mb-2">No workspace selected</div>
          <div className="text-sm text-gray-400">Please select a workspace in the sidebar first.</div>
        </div>
      )}

      {currentWs && (
        <>
          <div className="text-sm text-gray-600 mb-2">Store notes, context, or instructions for this workspace. Saved as variable key "{KB_KEY}". Supports markdown formatting.</div>
          <MarkdownEditor 
            value={text}
            onChange={(value) => { setText(value); setDirty(true); }}
            placeholder="# Knowledge Base\n\n## Context\nAdd important context about this workspace...\n\n## Instructions\n- Step-by-step procedures\n- Important URLs or credentials\n- Common troubleshooting steps\n\n## Notes\nAny additional information..."
            minHeight="400px"
            maxHeight="70vh"
          />
          <div className="flex items-center gap-3">
            <button className="ios-button-primary px-4 py-2" onClick={onSave} disabled={!dirty || saving}>
              {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </button>
            {loading && <div className="text-xs text-gray-500">Loading…</div>}
          </div>
        </>
      )}
    </section>
  );
}
