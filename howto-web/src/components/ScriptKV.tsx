import { useMutation, useQuery, gql } from '@apollo/client';
import { useState, useMemo } from 'react';
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
  string: () => <span className="inline-flex items-center justify-center w-4 h-4 text-xs font-mono bg-blue-100  text-blue-700  rounded">""</span>,
  number: () => <span className="inline-flex items-center justify-center w-4 h-4 text-xs font-mono bg-green-100  text-green-700  rounded">#</span>,
  boolean: () => <span className="inline-flex items-center justify-center w-4 h-4 text-xs font-mono bg-purple-100  text-purple-700  rounded">T/F</span>,
  object: () => <span className="inline-flex items-center justify-center w-4 h-4 text-xs font-mono bg-orange-100  text-orange-700  rounded">{'{}'}</span>
};

const SCRIPT_VARIABLES = gql`
  query ScriptVariables($scriptId: ID!) {
    scriptVariables(scriptId: $scriptId) { key value updatedAt }
  }
`;

const UPSERT_S_VAR = gql`
  mutation UpsertScriptVariable($scriptId: ID!, $key: String!, $value: JSON!) {
    upsertScriptVariable(scriptId: $scriptId, key: $key, value: $value) { key value updatedAt }
  }
`;

const DEL_S_VAR = gql`
  mutation DeleteScriptVariable($scriptId: ID!, $key: String!) {
    deleteScriptVariable(scriptId: $scriptId, key: $key)
  }
`;

const UPSERT_S_SECRET = gql`
  mutation UpsertScriptSecret($scriptId: ID!, $key: String!, $value: String!) {
    upsertScriptSecret(scriptId: $scriptId, key: $key, value: $value) { key updatedAt exists }
  }
`;

const DEL_S_SECRET = gql`
  mutation DeleteScriptSecret($scriptId: ID!, $key: String!) {
    deleteScriptSecret(scriptId: $scriptId, key: $key)
  }
`;

const SCRIPT_SECRETS = gql`
  query ScriptSecrets($scriptId: ID!) { scriptSecrets(scriptId: $scriptId) { key updatedAt } }
`;

export default function ScriptKV({ scriptId }: { scriptId: string }) {
  const { show } = useToast();
  const { data, loading, error } = useQuery(SCRIPT_VARIABLES, { variables: { scriptId }, fetchPolicy: 'cache-and-network' });
  const [upVar, { loading: savingVar }] = useMutation(UPSERT_S_VAR, { refetchQueries: [{ query: SCRIPT_VARIABLES, variables: { scriptId } }] });
  const [delVar] = useMutation(DEL_S_VAR, { refetchQueries: [{ query: SCRIPT_VARIABLES, variables: { scriptId } }] });
  const [upSec, { loading: savingSec }] = useMutation(UPSERT_S_SECRET);
  const [delSec, { loading: deletingSec }] = useMutation(DEL_S_SECRET);

  const { data: sdata, refetch: refetchSecrets } = useQuery(SCRIPT_SECRETS, { variables: { scriptId }, fetchPolicy: 'cache-and-network' });

  type ValueType = 'string' | 'number' | 'boolean' | 'object';
  const [vk, setVk] = useState('');
  const [vType, setVType] = useState<ValueType>('string');
  const [vString, setVString] = useState('');
  const [vNumber, setVNumber] = useState<number | ''>('');
  const [vBool, setVBool] = useState(false);
  const [vPairs, setVPairs] = useState<{ k: string; v: string }[]>([{ k: '', v: '' }]);
  const [sk, setSk] = useState('');
  const [sv, setSv] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedValues, setExpandedValues] = useState<Record<string, boolean>>({});
  
  // Filter variables based on search query
  const filteredVariables = useMemo(() => {
    if (!searchQuery) return data?.scriptVariables || [];
    return (data?.scriptVariables || []).filter((v: any) => 
      v.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(v.value).toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [data?.scriptVariables, searchQuery]);

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

  const onFill = (k: string, v: any) => {
    setVk(k);
    const t = typeof v;
    if (t === 'string') { setVType('string'); setVString(v as string); }
    else if (t === 'number') { setVType('number'); setVNumber(v as number); }
    else if (t === 'boolean') { setVType('boolean'); setVBool(!!v); }
    else { setVType('object'); setVPairs(Object.entries(v || {}).map(([kk, vv]) => ({ k: kk, v: String(vv) }))); }
  };

  const saveVar = async () => {
    setErr(null);
    try {
      let value: any;
      if (vType === 'string') value = vString;
      else if (vType === 'number') value = vNumber === '' ? null : Number(vNumber);
      else if (vType === 'boolean') value = vBool;
      else {
        const out: Record<string, string> = {};
        vPairs.forEach(p => { if (p.k) out[p.k] = p.v; });
        value = out;
      }
      await upVar({ variables: { scriptId, key: vk, value } });
      setVk(''); setVString(''); setVNumber(''); setVBool(false); setVPairs([{ k: '', v: '' }]);
      show('Variable saved', 'success');
    } catch { setErr('Failed to save'); show('Failed to save variable', 'error'); }
  };
  const deleteVar = async (k: string) => { if (!window.confirm(`Really delete variable ${k}?`)) return; await delVar({ variables: { scriptId, key: k } }); show('Variable deleted', 'success'); };
  const saveSec = async () => { await upSec({ variables: { scriptId, key: sk, value: sv } }); setSk(''); setSv(''); await refetchSecrets(); show('Secret saved', 'success'); };
  const deleteSec = async () => { if (sk && window.confirm(`Really delete secret ${sk}?`)) { await delSec({ variables: { scriptId, key: sk } }); } setSk(''); setSv(''); await refetchSecrets(); show('Secret deleted', 'success'); };

  return (
    <section className="ios-card p-4">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold text-gray-900">Script Variables & Secrets</h4>
        <div className="relative">
          <input 
            className="ios-input pl-8 text-sm w-48" 
            placeholder="Search..." 
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400">
            <SearchIcon />
          </div>
        </div>
      </div>
      {loading ? <div className="text-sm text-gray-500">Loading…</div> : error ? <div className="text-sm text-red-600">{String(error)}</div> : (
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="font-semibold mb-4 text-gray-900">Variables</div>
            <div className="ios-list">
              {filteredVariables.map((r: any) => {
                const valueStr = formatValue(r.value, r.key);
                const canExpand = (typeof r.value === 'object' && JSON.stringify(r.value).length > 100) || String(r.value).length > 100;
                return (
                  <div key={r.key} className="ios-list-item group">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        {TypeIcons[typeof r.value as keyof typeof TypeIcons]?.() || TypeIcons.string()}
                        <div className="font-mono text-sm font-semibold text-gray-900 flex-1">{r.key}</div>
                        <button 
                          onClick={() => copyToClipboard(r.key, 'Key')}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-gray-100 rounded"
                          title="Copy key"
                        >
                          <CopyIcon />
                        </button>
                      </div>
                      <div className="ml-7">
                        <div className={`text-xs text-gray-600 font-mono ${expandedValues[r.key] ? 'whitespace-pre-wrap' : 'truncate'}`}>
                          {valueStr}
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center gap-3">
                            {canExpand && (
                              <button 
                                onClick={() => toggleValueExpansion(r.key)}
                                className="text-xs text-blue-600 hover:text-blue-800"
                              >
                                {expandedValues[r.key] ? 'Show less' : 'Show more'}
                              </button>
                            )}
                            <button 
                              onClick={() => copyToClipboard(typeof r.value === 'object' ? JSON.stringify(r.value) : String(r.value), 'Value')}
                              className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                            >
                              <CopyIcon /> Copy value
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <button className="ios-button-secondary text-xs px-3 py-1" onClick={() => onFill(r.key, r.value)}>Edit</button>
                            <button className="ios-button-destructive text-xs px-3 py-1" onClick={() => deleteVar(r.key)}>Delete</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filteredVariables.length === 0 && searchQuery && (
                <div className="p-6 text-center">
                  <div className="text-gray-400 mb-2">No variables found</div>
                  <div className="text-sm text-gray-500">Try adjusting your search terms</div>
                </div>
              )}
              {data && data.scriptVariables.length === 0 && !searchQuery && (
                <div className="p-6 text-center">
                  <div className="text-gray-400 mb-2">No variables yet</div>
                  <div className="text-sm text-gray-500">Create your first variable below</div>
                </div>
              )}
            </div>

            <div className="mt-4 ios-card p-4 space-y-4">
              <h3 className="text-sm font-semibold text-gray-900">Add/Edit Variable</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Variable Key</label>
                  <input className="ios-input text-sm" placeholder="e.g., retry_count, endpoint_url" value={vk} onChange={(e)=>setVk(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Value Type</label>
                  <div className="flex items-center gap-2">
                    <select className="ios-input text-sm flex-1" value={vType} onChange={(e)=>setVType(e.target.value as ValueType)}>
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
                    <input className="ios-input text-sm" placeholder="Enter string value" value={vString} onChange={(e)=>setVString(e.target.value)} />
                  </div>
                )}
                {vType === 'number' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Number Value</label>
                    <input type="number" className="ios-input text-sm" placeholder="0" value={vNumber} onChange={(e)=>setVNumber(e.target.value === '' ? '' : Number(e.target.value))} />
                  </div>
                )}
                {vType === 'boolean' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Boolean Value</label>
                    <label className="flex items-center gap-3 text-sm font-medium cursor-pointer p-3 bg-white rounded border">
                      <input type="checkbox" checked={vBool} onChange={(e)=>setVBool(e.target.checked)} className="w-4 h-4 text-blue-600 rounded" /> 
                      <span>{vBool ? 'True' : 'False'}</span>
                    </label>
                  </div>
                )}
                {vType === 'object' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Object Properties</label>
                    <div className="bg-white rounded border p-3 space-y-2">
                      {vPairs.map((p, idx) => (
                        <div key={idx} className="flex gap-2 items-start">
                          <input className="flex-1 border rounded px-2 py-1.5 text-sm" placeholder="Property key" value={p.k} onChange={(e)=>{
                            const next=[...vPairs]; next[idx]={...p,k:e.target.value}; setVPairs(next);
                          }} />
                          <input className="flex-1 border rounded px-2 py-1.5 text-sm" placeholder="Property value" value={p.v} onChange={(e)=>{
                            const next=[...vPairs]; next[idx]={...p,v:e.target.value}; setVPairs(next);
                          }} />
                          <button 
                            className="px-2 py-1.5 text-xs bg-gray-100 rounded hover:bg-gray-200" 
                            onClick={()=>setVPairs(vPairs.filter((_,i)=>i!==idx))}
                            title="Remove property"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button 
                        className="w-full px-3 py-2 text-sm bg-gray-100 rounded hover:bg-gray-200" 
                        onClick={()=>setVPairs([...vPairs,{k:'',v:''}])}
                      >
                        + Add Property
                      </button>
                    </div>
                  </div>
                )}
                <button disabled={!vk || savingVar} className="w-full ios-button-primary" onClick={saveVar}>
                  {savingVar ? 'Saving…' : vk && data?.scriptVariables?.some((v: any) => v.key === vk) ? 'Update Variable' : 'Create Variable'}
                </button>
              </div>
            </div>
          </div>

          <div>
            <div className="font-semibold mb-4 flex items-center gap-2 text-gray-900">
              Secrets
              <span className="inline-flex items-center justify-center w-4 h-4 text-xs bg-red-100 text-red-700 rounded">🔒</span>
            </div>
            
            <div className="ios-card p-4 space-y-4">
              <h3 className="text-sm font-semibold text-gray-900">Add/Edit Secret</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Secret Key</label>
                  <input className="ios-input text-sm" placeholder="e.g., api_token, db_password" value={sk} onChange={(e)=>setSk(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Secret Value</label>
                  <input 
                    type="password" 
                    className="ios-input text-sm" 
                    placeholder="Enter secret value (encrypted storage)" 
                    value={sv} 
                    onChange={(e)=>setSv(e.target.value)} 
                  />
                </div>
                <div className="text-xs bg-yellow-50 border border-yellow-200 text-yellow-800 p-2 rounded">
                  🛡️ Secret values are encrypted and never displayed after saving.
                </div>
                <div className="flex items-center gap-2">
                  <button disabled={!sk || !sv || savingSec} className="flex-1 ios-button-primary text-sm" onClick={saveSec}>
                    {savingSec ? 'Saving…' : sk && sdata?.scriptSecrets?.some((s: any) => s.key === sk) ? 'Update Secret' : 'Create Secret'}
                  </button>
                  <button disabled={!sk || deletingSec} className="ios-button-destructive text-sm" onClick={deleteSec}>
                    {deletingSec ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="text-sm font-semibold text-gray-700 mb-2">Existing Secrets</div>
              <div className="ios-list">
                {(sdata?.scriptSecrets || []).map((s: any) => (
                  <div key={s.key} className="ios-list-item group">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex items-center justify-center w-4 h-4 text-xs bg-red-100 text-red-700 rounded">🔒</span>
                          <div className="text-sm font-mono font-semibold text-gray-900">{s.key}</div>
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
                      <button 
                        className="ios-button-destructive text-xs px-3 py-1 ml-3" 
                        onClick={async ()=>{ 
                          if (!window.confirm(`Really delete secret "${s.key}"?\n\nThis action cannot be undone.`)) return; 
                          await delSec({ variables: { scriptId, key: s.key } }); 
                          await refetchSecrets(); 
                          show('Secret deleted', 'success'); 
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                {sdata && sdata.scriptSecrets.length === 0 && (
                  <div className="p-6 text-center">
                    <div className="text-gray-400 mb-2">No secrets yet</div>
                    <div className="text-sm text-gray-500">Create your first secret above</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {err && <div className="ios-badge-error mt-4 p-3 rounded">{err}</div>}
    </section>
  );
}