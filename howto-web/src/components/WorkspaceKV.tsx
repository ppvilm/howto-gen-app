import { useEffect, useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { useToast } from './ToastProvider';

// Icon components for better visual hierarchy
const CopyIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const SearchIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const TypeIcons = {
  string: () => <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-mono bg-blue-100 text-blue-700 rounded">""</span>,
  number: () => <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-mono bg-green-100 text-green-700 rounded">#</span>,
  boolean: () => <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-mono bg-purple-100 text-purple-700 rounded">T/F</span>,
  object: () => <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-mono bg-orange-100 text-orange-700 rounded">{'{}'}</span>
};

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

const DEL_W_VAR = gql`
  mutation DeleteWorkspaceVariable($workspaceId: ID!, $key: String!) {
    deleteWorkspaceVariable(workspaceId: $workspaceId, key: $key)
  }
`;

const UPSERT_W_SECRET = gql`
  mutation UpsertWorkspaceSecret($workspaceId: ID!, $key: String!, $value: String!) {
    upsertWorkspaceSecret(workspaceId: $workspaceId, key: $key, value: $value) { key updatedAt exists }
  }
`;

const DEL_W_SECRET = gql`
  mutation DeleteWorkspaceSecret($workspaceId: ID!, $key: String!) {
    deleteWorkspaceSecret(workspaceId: $workspaceId, key: $key)
  }
`;

const WORKSPACE_SECRETS = gql`
  query WorkspaceSecrets($workspaceId: ID!) {
    workspaceSecrets(workspaceId: $workspaceId) { key updatedAt }
  }
`;

type Variable = { key: string; value: any; updatedAt?: string | null };

type ValueType = 'string' | 'number' | 'boolean' | 'object';

function toPairs(obj: Record<string, any> = {}): { k: string; v: string }[] {
  return Object.entries(obj).map(([k, v]) => ({ k, v: String(v) }));
}
function fromPairs(pairs: { k: string; v: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { k, v } of pairs) if (k) out[k] = v;
  return out;
}

export default function WorkspaceKV() {
  const { show } = useToast();
  const workspaceId = useMemo(() => localStorage.getItem('howto_workspace'), []);
  const [currentWs, setCurrentWs] = useState<string | null>(workspaceId);
  useEffect(() => {
    const tick = setInterval(() => setCurrentWs(localStorage.getItem('howto_workspace')), 500);
    return () => clearInterval(tick);
  }, []);

  const { data, loading, error, refetch } = useQuery<{ workspaceVariables: Variable[] }>(WORKSPACE_VARIABLES, {
    variables: { workspaceId: currentWs as string },
    skip: !currentWs,
    fetchPolicy: 'cache-and-network',
  });
  const [upsertVar, { loading: savingVar }] = useMutation(UPSERT_W_VAR);
  const [deleteVar, { loading: deletingVar }] = useMutation(DEL_W_VAR);
  const { data: sdata, refetch: refetchSecrets } = useQuery(WORKSPACE_SECRETS, { variables: { workspaceId: currentWs as string }, skip: !currentWs, fetchPolicy: 'cache-and-network' });
  const [upsertSecret, { loading: savingSecret }] = useMutation(UPSERT_W_SECRET, { onCompleted: () => refetchSecrets() });
  const [deleteSecret, { loading: deletingSecret }] = useMutation(DEL_W_SECRET, { onCompleted: () => refetchSecrets() });

  const [vKey, setVKey] = useState('');
  const [vType, setVType] = useState<ValueType>('string');
  const [vString, setVString] = useState('');
  const [vNumber, setVNumber] = useState<number | ''>('');
  const [vBool, setVBool] = useState(false);
  const [vPairs, setVPairs] = useState<{ k: string; v: string }[]>([{ k: '', v: '' }]);
  const [sKey, setSKey] = useState('');
  const [sValue, setSValue] = useState('');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedValues, setExpandedValues] = useState<Record<string, boolean>>({});
  
  // Filter variables based on search query
  const filteredVariables = useMemo(() => {
    if (!searchQuery) return data?.workspaceVariables || [];
    return (data?.workspaceVariables || []).filter(v => 
      v.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(v.value).toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [data?.workspaceVariables, searchQuery]);

  // Copy to clipboard functionality
  const copyToClipboard = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      show(`${type} copied to clipboard`, 'success');
    } catch (err) {
      show('Failed to copy to clipboard', 'error');
    }
  };

  // Format value for display
  const formatValue = (value: any, key: string) => {
    if (typeof value === 'object') {
      const jsonStr = JSON.stringify(value, null, 2);
      const isExpanded = expandedValues[key];
      if (jsonStr.length > 100 && !isExpanded) {
        return JSON.stringify(value).slice(0, 97) + '...';
      }
      return isExpanded ? jsonStr : JSON.stringify(value);
    }
    const str = String(value);
    const isExpanded = expandedValues[key];
    if (str.length > 100 && !isExpanded) {
      return str.slice(0, 97) + '...';
    }
    return str;
  };

  // Toggle value expansion
  const toggleValueExpansion = (key: string) => {
    setExpandedValues(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const onEditFill = (item: Variable) => {
    setVKey(item.key);
    const val = item.value;
    const t = typeof val;
    if (t === 'string') { setVType('string'); setVString(val as string); }
    else if (t === 'number') { setVType('number'); setVNumber(val as number); }
    else if (t === 'boolean') { setVType('boolean'); setVBool(!!val); }
    else { setVType('object'); setVPairs(toPairs(val || {})); }
  };

  const onSaveVar = async () => {
    if (!currentWs) return;
    setErrMsg(null);
    try {
      let value: any;
      if (vType === 'string') value = vString;
      else if (vType === 'number') value = vNumber === '' ? null : Number(vNumber);
      else if (vType === 'boolean') value = vBool;
      else value = fromPairs(vPairs);
      await upsertVar({ variables: { workspaceId: currentWs, key: vKey, value }, refetchQueries: [{ query: WORKSPACE_VARIABLES, variables: { workspaceId: currentWs } }] });
      setVKey(''); setVString(''); setVNumber(''); setVBool(false); setVPairs([{ k: '', v: '' }]);
      show('Variable saved', 'success');
    } catch (e: any) {
      setErrMsg('Failed to save');
      show('Failed to save variable', 'error');
    }
  };

  const onDeleteVar = async (key: string) => {
    if (!currentWs) return;
    if (!window.confirm(`Really delete variable ${key}?`)) return;
    await deleteVar({ variables: { workspaceId: currentWs, key }, refetchQueries: [{ query: WORKSPACE_VARIABLES, variables: { workspaceId: currentWs } }] });
    show('Variable deleted', 'success');
  };

  const onSaveSecret = async () => {
    if (!currentWs) return;
    setErrMsg(null);
    try {
      await upsertSecret({ variables: { workspaceId: currentWs, key: sKey, value: sValue } });
      setSKey(''); setSValue('');
      show('Secret saved', 'success');
    } catch (e) {
      setErrMsg('Failed to save secret');
      show('Failed to save secret', 'error');
    }
  };

  const onDeleteSecret = async () => {
    if (!currentWs || !sKey) return;
    if (!window.confirm(`Really delete secret ${sKey}?`)) return;
    await deleteSecret({ variables: { workspaceId: currentWs, key: sKey } });
    setSKey(''); setSValue('');
    show('Secret deleted', 'success');
  };

  return (
    <section className="ios-card p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Workspace Variables & Secrets</h2>
        {currentWs && (
          <div className="relative">
            <SearchIcon />
            <input 
              className="ios-input pl-10 w-64" 
              placeholder="Search variables..." 
              value={searchQuery} 
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
              <SearchIcon />
            </div>
          </div>
        )}
      </div>
      {!currentWs && (
        <div className="ios-badge text-center py-6">
          <div className="text-gray-500 mb-2">No workspace selected</div>
          <div className="text-sm text-gray-400">Please select a workspace to manage variables and secrets.</div>
        </div>
      )}
      {currentWs && (
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <div className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
              Secrets
              <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-mono bg-red-100 text-red-700 rounded">🔒</span>
            </div>

            <div className="mb-6">
              <div className="text-sm font-semibold text-gray-700 mb-3">Existing Secrets</div>
              <div className="ios-list">
                {(sdata?.workspaceSecrets || []).map((s: any) => (
                  <div key={s.key} className="ios-list-item">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex items-center justify-center w-4 h-4 text-xs bg-red-100 text-red-700 rounded">🔒</span>
                          <div className="text-sm font-mono font-semibold text-gray-900 flex-1">{s.key}</div>
                          <button 
                            onClick={() => copyToClipboard(s.key, 'Secret key')}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-gray-100 rounded"
                            title="Copy secret key"
                          >
                            <CopyIcon />
                          </button>
                        </div>
                        <div className="ml-7 flex items-center justify-between mt-1">
                          <div className="text-xs text-gray-500">••••••••••••••••</div>
                          <div className="text-xs text-gray-400">
                            Updated {new Date(s.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="ml-4 flex-shrink-0">
                        <button 
                          className="ios-button-destructive text-xs px-3 py-1.5" 
                          onClick={async ()=>{ 
                            if (!window.confirm(`Really delete secret "${s.key}"?\n\nThis action cannot be undone.`)) return; 
                            await deleteSecret({ variables: { workspaceId: currentWs, key: s.key } }); 
                            await refetchSecrets(); 
                            show('Secret deleted', 'success'); 
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {sdata && sdata.workspaceSecrets.length === 0 && (
                  <div className="p-8 text-center">
                    <div className="text-gray-400 mb-2">No secrets yet</div>
                    <div className="text-sm text-gray-500">Create your first secret using the form below</div>
                  </div>
                )}
              </div>
            </div>
            
            <div className="bg-gray-50 p-4 rounded-lg space-y-4">
              <h3 className="text-sm font-semibold text-gray-900">Add/Edit Secret</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Secret Key</label>
                  <input className="ios-input" placeholder="e.g., api_key, database_password" value={sKey} onChange={(e) => setSKey(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Secret Value</label>
                  <input 
                    type="password" 
                    className="ios-input" 
                    placeholder="Enter secret value (encrypted storage)" 
                    value={sValue} 
                    onChange={(e) => setSValue(e.target.value)} 
                  />
                </div>
                <div className="ios-badge text-xs bg-yellow-50 border-yellow-200 text-yellow-800">
                  🛡️ For security reasons, secret values are encrypted and never displayed after saving.
                </div>
                <div className="flex items-center gap-3">
                  <button disabled={!sKey || !sValue || savingSecret} className="ios-button-primary flex-1" onClick={onSaveSecret}>
                    {savingSecret ? 'Saving…' : sKey && sdata?.workspaceSecrets?.some((s: any) => s.key === sKey) ? 'Update Secret' : 'Create Secret'}
                  </button>
                  <button disabled={!sKey || deletingSecret} className="ios-button-destructive" onClick={onDeleteSecret}>
                    {deletingSecret ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="text-base font-semibold text-gray-900 mb-4">Variables</div>
            {loading ? (
              <div className="text-sm text-gray-500">Loading…</div>
            ) : error ? (
              <div className="ios-badge-error">{error.message}</div>
            ) : (
              <div className="ios-list">
                {filteredVariables.map((v) => {
                  const valueStr = formatValue(v.value, v.key);
                  const canExpand = (typeof v.value === 'object' && JSON.stringify(v.value).length > 100) || String(v.value).length > 100;
                  return (
                    <div key={v.key} className="ios-list-item">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-center gap-3">
                            {TypeIcons[typeof v.value as keyof typeof TypeIcons]?.() || TypeIcons.string()}
                            <div className="font-mono text-sm font-semibold text-gray-900 flex-1 truncate">{v.key}</div>
                            <button 
                              onClick={() => copyToClipboard(v.key, 'Key')}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-gray-100 rounded"
                              title="Copy key"
                            >
                              <CopyIcon />
                            </button>
                          </div>
                          <div className="ml-8">
                            <div className={`text-xs text-gray-600 font-mono ${expandedValues[v.key] ? 'whitespace-pre-wrap' : 'truncate'}`}>
                              {valueStr}
                            </div>
                            <div className="flex items-center justify-between mt-2">
                              <div className="flex items-center gap-3">
                                {canExpand && (
                                  <button 
                                    onClick={() => toggleValueExpansion(v.key)}
                                    className="text-xs text-blue-600 hover:text-blue-800"
                                  >
                                    {expandedValues[v.key] ? 'Show less' : 'Show more'}
                                  </button>
                                )}
                                <button 
                                  onClick={() => copyToClipboard(typeof v.value === 'object' ? JSON.stringify(v.value) : String(v.value), 'Value')}
                                  className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                                >
                                  <CopyIcon /> Copy value
                                </button>
                              </div>
                              {v.updatedAt && (
                                <div className="text-xs text-gray-400">
                                  Updated {new Date(v.updatedAt).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                          <button className="ios-button-secondary text-xs px-3 py-1.5" onClick={() => onEditFill(v)}>Edit</button>
                          <button className="ios-button-destructive text-xs px-3 py-1.5" onClick={() => onDeleteVar(v.key)}>Delete</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {filteredVariables.length === 0 && searchQuery && (
                  <div className="p-8 text-center">
                    <div className="text-gray-400 mb-2">No variables found</div>
                    <div className="text-sm text-gray-500">Try adjusting your search terms</div>
                  </div>
                )}
                {data && data.workspaceVariables.length === 0 && !searchQuery && (
                  <div className="p-8 text-center">
                    <div className="text-gray-400 mb-2">No variables yet</div>
                    <div className="text-sm text-gray-500">Create your first variable using the form below</div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Add/Edit Variable</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Variable Key</label>
                    <input 
                      className="ios-input" 
                      placeholder="e.g., api_endpoint, timeout_seconds" 
                      value={vKey} 
                      onChange={(e) => setVKey(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Value Type</label>
                    <div className="flex items-center gap-2">
                      <select className="ios-input py-2 flex-1" value={vType} onChange={(e)=>setVType(e.target.value as ValueType)}>
                        <option value="string">String</option>
                        <option value="number">Number</option>
                        <option value="boolean">Boolean</option>
                        <option value="object">Object</option>
                      </select>
                      {TypeIcons[vType]?.()}
                    </div>
                  </div>
                  {vType === 'string' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">String Value</label>
                      <input className="ios-input" placeholder="Enter string value" value={vString} onChange={(e)=>setVString(e.target.value)} />
                    </div>
                  )}
                  {vType === 'number' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Number Value</label>
                      <input type="number" className="ios-input" placeholder="0" value={vNumber} onChange={(e)=>setVNumber(e.target.value === '' ? '' : Number(e.target.value))} />
                    </div>
                  )}
                  {vType === 'boolean' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Boolean Value</label>
                      <label className="flex items-center gap-3 text-sm font-medium cursor-pointer p-3 bg-white rounded border">
                        <input type="checkbox" checked={vBool} onChange={(e)=>setVBool(e.target.checked)} className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" /> 
                        <span>{vBool ? 'True' : 'False'}</span>
                      </label>
                    </div>
                  )}
                  {vType === 'object' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Object Properties</label>
                      <div className="bg-white rounded border p-3 space-y-3">
                        {vPairs.map((p, idx) => (
                          <div key={idx} className="flex gap-2 items-start">
                            <div className="flex-1">
                              <input className="ios-input text-sm" placeholder="Property key" value={p.k} onChange={(e)=>{
                                const next=[...vPairs]; next[idx]={...p,k:e.target.value}; setVPairs(next);
                              }} />
                            </div>
                            <div className="flex-1">
                              <input className="ios-input text-sm" placeholder="Property value" value={p.v} onChange={(e)=>{
                                const next=[...vPairs]; next[idx]={...p,v:e.target.value}; setVPairs(next);
                              }} />
                            </div>
                            <button 
                              className="ios-button-secondary text-xs px-2 py-2 mt-0.5" 
                              onClick={()=>setVPairs(vPairs.filter((_,i)=>i!==idx))}
                              title="Remove property"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        <button 
                          className="ios-button-secondary text-sm px-3 py-2 w-full" 
                          onClick={()=>setVPairs([...vPairs,{k:'',v:''}])}
                        >
                          + Add Property
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="pt-2">
                    <button 
                      disabled={!vKey || savingVar} 
                      className="ios-button-primary w-full" 
                      onClick={onSaveVar}
                    >
                      {savingVar ? 'Saving…' : vKey && data?.workspaceVariables?.some(v => v.key === vKey) ? 'Update Variable' : 'Create Variable'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {errMsg && <div className="ios-badge-error mt-6 p-3 rounded-xl">{errMsg}</div>}
    </section>
  );
}
