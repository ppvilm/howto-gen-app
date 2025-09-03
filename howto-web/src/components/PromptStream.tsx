import { gql, useApolloClient } from '@apollo/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getServerBase } from '../serverBase';

const ON_PROMPT = gql`
  subscription OnPrompt($scriptId: ID!) {
    onPromptEvents(scriptId: $scriptId)
  }
`;

function iconFor(ev: any): string {
  const t = ev?.type || '';
  if (t === 'goal_set') return '🎯';
  if (t === 'step_planning') return '🧭';
  if (t === 'step_planned') return '🧠';
  if (t === 'markdown_generated') return '📝';
  if (t === 'script_saving') return '💾';
  if (t === 'script_saved') return '✅';
  if (t === 'session_failed' || t === 'error') return '❌';
  if (t === 'screenshot_captured') return '📸';
  return '📣';
}

function titleFor(ev: any): string {
  const t = ev?.type || '';
  switch (t) {
    case 'goal_set': return 'Goal set';
    case 'step_planning': return 'Planning steps';
    case 'step_planned': return 'Step planned';
    case 'markdown_generated': return 'Markdown generated';
    case 'script_saving': return 'Saving script';
    case 'script_saved': return 'Script saved';
    case 'session_failed': return 'Generation failed';
    default: return t || 'Event';
  }
}

export default function PromptStream({ scriptId }: { scriptId: string }) {
  const client = useApolloClient();
  const [events, setEvents] = useState<any[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const apiBase = useMemo(() => getServerBase(), []);

  useEffect(() => {
    const sub = client.subscribe({ query: ON_PROMPT, variables: { scriptId } }).subscribe({
      next: (msg) => {
        const ev = (msg.data as any)?.onPromptEvents;
        setEvents((prev) => [...prev, ev]);
      },
      error: (err) => {
        setEvents((prev) => [...prev, { type: 'error', error: String(err) }]);
      },
      complete: () => {
        setEvents((prev) => [...prev, { type: 'completed' }]);
      },
    });
    return () => sub.unsubscribe();
  }, [client, scriptId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [events]);

  return (
    <div className="mt-3 max-h-80 overflow-auto border rounded bg-white">
      <ul className="text-sm">
        {events.map((e, i) => {
          const explicitUrl = e?.screenshotUrl ? `${apiBase}${String(e.screenshotUrl)}` : null;
          const dataUrl = e?.screenshot && typeof e.screenshot === 'string' && e.screenshot.startsWith('data:') ? String(e.screenshot) : null;
          const imgPath = e?.path && /\.(png|jpg|jpeg|gif)$/i.test(String(e.path)) ? String(e.path) : null;
          const imgUrl = explicitUrl || dataUrl || (imgPath ? `${apiBase}/files?path=${encodeURIComponent(imgPath)}` : null);
          return (
            <li key={i} className="px-3 py-2 border-b">
              <div className="flex items-start gap-2">
                <div className="text-lg leading-none">{iconFor(e)}</div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{titleFor(e)}</div>
                  {e?.message && <div className="text-xs text-gray-600 break-words">{e.message}</div>}
                  {imgUrl && (
                    <div className="mt-2">
                      <img src={imgUrl} alt="screenshot" className="max-h-48 rounded border" />
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div ref={endRef} />
    </div>
  );
}
