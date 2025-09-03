import { useEffect, useState } from 'react';
import { useQuery, gql } from '@apollo/client';
import LoginForm from './components/LoginForm';
import WorkspaceSwitcher from './components/WorkspaceSwitcher';
import ScriptsPanel from './components/ScriptsPanel';
import Sidebar from './components/Sidebar';
import WorkspaceKV from './components/WorkspaceKV';
import KnowledgeBase from './components/KnowledgeBase';
import GenerateAI from './components/GenerateAI';
import FlowView from './components/FlowView';
import { router } from './router';

const ME_QUERY = gql`
  query Me {
    me { id email accountId }
  }
`;

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('howto_token'));
  const [active, setActive] = useState<'flows' | 'workspace-kv' | 'knowledge-base' | 'flow'>('flows');
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [flowTab, setFlowTab] = useState<'edit' | 'sessions'>('edit');
  const { data, refetch } = useQuery<{ me: { id: string; email: string; accountId: string } | null }>(ME_QUERY, {
    fetchPolicy: 'cache-and-network',
    skip: !token,
  });

  useEffect(() => {
    if (token) refetch();
  }, [token, refetch]);

  useEffect(() => {
    if (token) {
      router.addRoute('/', () => {
        setActive('flows');
        setSelectedScriptId(null);
      });
      
      router.addRoute('/flows', () => {
        setActive('flows');
        setSelectedScriptId(null);
      });
      
      router.addRoute('/workspace-kv', () => {
        setActive('workspace-kv');
        setSelectedScriptId(null);
      });
      
      router.addRoute('/knowledge-base', () => {
        setActive('knowledge-base');
        setSelectedScriptId(null);
      });
      
      router.addRoute('/flow/:scriptId', (params) => {
        setActive('flow');
        setSelectedScriptId(params.scriptId);
        setFlowTab('edit');
      });
      
      router.addRoute('/flow/:scriptId/edit', (params) => {
        setActive('flow');
        setSelectedScriptId(params.scriptId);
        setFlowTab('edit');
      });
      
      router.addRoute('/flow/:scriptId/results', (params) => {
        setActive('flow');
        setSelectedScriptId(params.scriptId);
        setFlowTab('sessions');
      });
      
      router.start();
    }
  }, [token]);

  // Auto-open a script requested by other components (e.g., GenerateAI)
  useEffect(() => {
    const tick = setInterval(() => {
      const want = localStorage.getItem('howto_open_script');
      if (want) {
        router.navigate(`/flow/${want}`);
        localStorage.removeItem('howto_open_script');
      }
    }, 500);
    return () => clearInterval(tick);
  }, []);

  const onLogout = () => {
    localStorage.removeItem('howto_token');
    localStorage.removeItem('howto_workspace');
    setToken(null);
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-semibold mb-4 text-center">Sign in to HowTo</h1>
          <LoginForm onSuccess={(t) => { localStorage.setItem('howto_token', t); setToken(t); }} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen h-full flex">
      <Sidebar
        items={[
          { key: 'flows', label: 'Flows' },
          { key: 'knowledge-base', label: 'Knowledge Base' },
          { key: 'workspace-kv', label: 'Variables & Secrets' },
        ]}
        active={active === 'flow' ? 'flows' : active}
        onSelect={(k) => {
          if (k === 'flows') { router.navigate('/flows'); }
          else if (k === 'knowledge-base') { router.navigate('/knowledge-base'); }
          else if (k === 'workspace-kv') { router.navigate('/workspace-kv'); }
        }}
      >
        <WorkspaceSwitcher compact />
      </Sidebar>
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="ios-nav flex items-center justify-between">
          <div className="text-base font-semibold">
            {active === 'flows' && 'Flows'}
            {active === 'flow' && (selectedScriptId ? `Flow • ${selectedScriptId}` : 'Flow')}
            {active === 'workspace-kv' && 'Workspace Variables & Secrets'}
            {active === 'knowledge-base' && 'Knowledge Base'}
          </div>
          {data?.me?.email && (
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <div className="truncate">{data.me.email}</div>
              <button onClick={onLogout} className="ios-button-ghost text-sm px-3 py-1">Logout</button>
            </div>
          )}
        </header>
        <main className="p-6 overflow-auto flex-1">
          {active === 'flows' && (
            <div className="space-y-6 max-w-5xl">
              <GenerateAI />
              <ScriptsPanel onOpenScript={(id) => { router.navigate(`/flow/${id}`); }} />
            </div>
          )}
          {active === 'flow' && selectedScriptId && (
            <div className="space-y-6 max-w-6xl">
              <FlowView 
                scriptId={selectedScriptId} 
                tab={flowTab}
                onBack={() => { router.navigate('/flows'); }}
                onTabChange={(tab) => {
                  setFlowTab(tab);
                  router.navigate(`/flow/${selectedScriptId}/${tab === 'edit' ? 'edit' : 'results'}`);
                }}
              />
            </div>
          )}
          {active === 'workspace-kv' && (
            <div className="space-y-6 max-w-5xl">
              <WorkspaceKV />
            </div>
          )}
          {active === 'knowledge-base' && (
            <div className="space-y-6 max-w-5xl">
              <KnowledgeBase />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
