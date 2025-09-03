import { useEffect, useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';

const WORKSPACES = gql`
  query Workspaces {
    workspaces { id name rootPath }
  }
`;

const CREATE_WORKSPACE = gql`
  mutation CreateWorkspace($id: ID!, $name: String) {
    createWorkspace(id: $id, name: $name) { id name }
  }
`;

type Workspace = { id: string; name?: string | null; rootPath?: string | null };

export default function WorkspaceSwitcher({ compact = false }: { compact?: boolean } = {}) {
  const { data, loading, error, refetch } = useQuery<{ workspaces: Workspace[] }>(WORKSPACES, { fetchPolicy: 'cache-and-network' });
  const [createWorkspace, { loading: creating }] = useMutation<{ createWorkspace: Workspace }>(CREATE_WORKSPACE);

  const workspaces = data?.workspaces ?? [];

  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem('howto_workspace'));
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [customId, setCustomId] = useState('');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!selected && workspaces.length > 0) {
      // default to first workspace
      const first = workspaces[0].id;
      setSelected(first);
      localStorage.setItem('howto_workspace', first);
    }
  }, [selected, workspaces]);

  const onSelect = (id: string) => {
    setSelected(id);
    localStorage.setItem('howto_workspace', id);
  };

  const genId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return 'ws_' + Math.random().toString(36).slice(2, 10);
  };

  const suggestedId = useMemo(() => {
    const base = name.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '') || 'workspace';
    return `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }, [name]);

  const onCreate = async () => {
    setErrMsg(null);
    const id = (customId || suggestedId || genId()).trim();
    if (!id) return;
    try {
      const res = await createWorkspace({ variables: { id, name: name || null }, refetchQueries: ['Workspaces'] });
      const newId = res.data?.createWorkspace.id || id;
      onSelect(newId);
      setShowCreate(false);
      setName('');
      setCustomId('');
      await refetch();
    } catch (e: any) {
      setErrMsg(e.message || 'Failed to create workspace');
    }
  };

  const SelectEl = (
    loading ? (
      <div className={`text-gray-500 ${compact ? 'text-xs' : 'text-sm'}`}>Loading workspaces…</div>
    ) : error ? (
      <div className={`ios-badge-error ${compact ? 'text-xs' : 'text-sm'}`}>{error.message}</div>
    ) : (
      <select
        className={`ios-input ${compact ? 'py-2 text-sm flex-1 min-w-0' : 'min-w-[180px] text-sm'}`}
        value={selected ?? ''}
        onChange={(e) => onSelect(e.target.value)}
      >
        {workspaces.length === 0 && <option value="">No workspaces</option>}
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name || w.id}
          </option>
        ))}
      </select>
    )
  );

  if (compact) {
    return (
      <div className="space-y-3">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Workspace</div>
        <div className="flex gap-1.5 items-center">
          {SelectEl}
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center ios-button-primary text-sm font-medium active:scale-95"
            onClick={() => setShowCreate((v) => !v)}
            title={showCreate ? 'Cancel' : 'New workspace'}
          >
            {showCreate ? '×' : '+'}
          </button>
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center ios-button-secondary text-sm active:scale-95"
            onClick={() => refetch()}
            title="Refresh workspaces"
          >↻</button>
        </div>
        {showCreate && (
          <div className="space-y-3 p-3 ios-card">
            <input
              className="ios-input text-sm"
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="flex gap-2">
              <input
                className="flex-1 ios-input text-sm"
                placeholder={suggestedId}
                value={customId}
                onChange={(e) => setCustomId(e.target.value)}
              />
              <button
                type="button"
                onClick={onCreate}
                disabled={creating}
                className="px-3 py-2 ios-button-primary text-xs font-medium active:scale-95"
              >
                {creating ? '…' : 'Create'}
              </button>
            </div>
            {errMsg && <div className="ios-badge-error p-2 rounded-xl text-xs">{errMsg}</div>}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="ios-card p-6">
      <div className="mb-6">
        <div className="text-sm font-semibold text-gray-700 mb-2">Current workspace</div>
        <div className="flex items-center gap-2">
          {SelectEl}
          <button
            type="button"
            className="ios-button-primary px-3 py-2 text-sm"
            onClick={() => setShowCreate((v) => !v)}
            title={showCreate ? 'Cancel' : 'Create workspace'}
          >
            {showCreate ? '✕' : '+'}
          </button>
          <button
            type="button"
            className="ios-button-secondary px-3 py-2 text-sm"
            onClick={() => refetch()}
            title="Refresh workspaces"
          >
            ↻
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="space-y-6 pt-6 border-t border-white/60">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-1">
              <label className="block text-sm font-semibold mb-2 text-gray-700">Name (optional)</label>
              <input
                className="ios-input"
                placeholder="Team Alpha"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="md:col-span-1">
              <label className="block text-sm font-semibold mb-2 text-gray-700">ID</label>
              <input
                className="ios-input"
                placeholder={suggestedId}
                value={customId}
                onChange={(e) => setCustomId(e.target.value)}
              />
              <div className="text-xs text-gray-500 mt-2">Leave empty to use suggestion: <code className="ios-badge text-xs">{suggestedId}</code></div>
            </div>
            <div className="md:col-span-1 flex items-end">
              <button
                type="button"
                onClick={onCreate}
                disabled={creating}
                className="w-full md:w-auto ios-button-primary"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
          {errMsg && (
            <div className="ios-badge-error p-3 rounded-xl">{errMsg}</div>
          )}
        </div>
      )}

      {selected && (
        <div className="mt-6 pt-4 border-t border-white/60">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Selected:</span>
            <span className="ios-badge font-mono text-xs">{selected}</span>
          </div>
        </div>
      )}
    </section>
  );
}
