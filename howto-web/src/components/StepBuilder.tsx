import React, { useState } from 'react';

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

export default function StepBuilder({ steps, onChange }: { steps: StepAction[]; onChange: (s: StepAction[]) => void }) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

  const toggleStep = (index: number) => {
    const next = new Set(expandedSteps);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setExpandedSteps(next);
  };

  const update = (index: number, patch: Partial<StepAction>) => {
    const next = [...steps];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  const remove = (index: number) => {
    const next = steps.slice(0, index).concat(steps.slice(index + 1));
    onChange(next);
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  };

  const add = (type: StepAction['type'] = 'goto') => {
    const defaults: StepAction = { type } as StepAction;
    if (type === 'goto') defaults.url = '/';
    if (type === 'type') defaults.value = '';
    if (type === 'tts_start') defaults.text = '';
    if (type === 'keypress') defaults.key = 'Enter';
    onChange([...(steps || []), defaults]);
  };

  const types: StepAction['type'][] = ['goto', 'click', 'type', 'assert', 'assert_page', 'keypress', 'tts_start', 'tts_wait'];

  const getStepDisplayName = (type: StepAction['type']): string => {
    const displayNames = {
      'goto': 'Go to page',
      'click': 'Click element',
      'type': 'Type text',
      'assert': 'Check text',
      'assert_page': 'Check page',
      'keypress': 'Press key',
      'tts_start': 'Start speech',
      'tts_wait': 'Wait for speech'
    };
    return displayNames[type] || type;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium">Steps</label>
        <div className="flex items-center gap-2">
          <select id="addType" className="ios-input text-sm px-2 py-1">
            {types.map((t) => (
              <option key={t} value={t}>{getStepDisplayName(t)}</option>
            ))}
          </select>
          <button
            type="button"
            className="ios-button-primary text-sm px-3 py-1.5"
            onClick={() => {
              const select = document.getElementById('addType') as HTMLSelectElement | null;
              const t = (select?.value as StepAction['type']) || 'goto';
              add(t);
            }}
          >Add step</button>
        </div>
      </div>

      {(steps || []).length === 0 && (
        <div className="text-sm text-gray-500">No steps yet. Add the first step.</div>
      )}

      <div className="ios-list">
        {(steps || []).map((s, i) => {
          const isExpanded = expandedSteps.has(i);
          return (
            <div key={i} className="ios-card p-0 mb-3 overflow-hidden border-2 border-solid">
              <div 
                className="ios-list-item cursor-pointer"
                onClick={() => toggleStep(i)}
              >
                <div className="flex items-center gap-3 w-full">
                  <span className="ios-badge text-xs font-mono">#{i + 1}</span>
                  <span className="font-semibold text-sm">{getStepDisplayName(s.type)}</span>
                  {s.label && <span className="text-sm text-gray-600">- {s.label}</span>}
                  <div className="ml-auto flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <button 
                        type="button" 
                        className="ios-button-ghost text-xs px-2 py-1"
                        onClick={(e) => { e.stopPropagation(); move(i, -1); }}
                        disabled={i === 0}
                      >
                        ↑
                      </button>
                      <button 
                        type="button" 
                        className="ios-button-ghost text-xs px-2 py-1"
                        onClick={(e) => { e.stopPropagation(); move(i, 1); }}
                        disabled={i === steps.length - 1}
                      >
                        ↓
                      </button>
                      <button 
                        type="button" 
                        className="ios-button-destructive text-xs px-2 py-1"
                        onClick={(e) => { e.stopPropagation(); remove(i); }}
                      >
                        Delete
                      </button>
                    </div>
                    <span className="text-gray-400 text-sm">
                      {isExpanded ? '▼' : '▶'}
                    </span>
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="p-4 border-t" style={{backgroundColor: 'rgba(248, 250, 252, 0.6)'}}>
                  <div className="grid gap-3 md:grid-cols-2 mb-4">
                    <div>
                      <label className="block text-xs font-semibold mb-2 text-gray-700">Type</label>
                      <select
                        className="ios-input w-full text-sm"
                        value={s.type}
                        onChange={(e) => update(i, { type: e.target.value as StepAction['type'] })}
                      >
                        {types.map((t) => (
                          <option key={t} value={t}>{getStepDisplayName(t)}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-2 text-gray-700">Label</label>
                      <input
                        className="ios-input w-full text-sm"
                        placeholder="Optional"
                        value={s.label || ''}
                        onChange={(e) => update(i, { label: e.target.value || undefined })}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3 mb-4">
                    {(s.type === 'goto' || s.type === 'assert_page') && (
                      <div>
                        <label className="block text-xs font-semibold mb-2 text-gray-700">URL</label>
                        <input className="ios-input w-full" value={s.url || ''} onChange={(e) => update(i, { url: e.target.value || undefined })} />
                      </div>
                    )}
                    {(s.type === 'type' || s.type === 'assert') && (
                      <div>
                        <label className="block text-xs font-semibold mb-2 text-gray-700">Value</label>
                        <input className="ios-input w-full" value={s.value || ''} onChange={(e) => update(i, { value: e.target.value || undefined })} />
                      </div>
                    )}
                    {s.type === 'tts_start' && (
                      <div className="md:col-span-2">
                        <label className="block text-xs font-semibold mb-2 text-gray-700">TTS Text</label>
                        <input className="ios-input w-full" value={s.text || ''} onChange={(e) => update(i, { text: e.target.value || undefined })} />
                      </div>
                    )}
                    {s.type === 'keypress' && (
                      <div>
                        <label className="block text-xs font-semibold mb-2 text-gray-700">Key</label>
                        <input className="ios-input w-full" value={s.key || ''} onChange={(e) => update(i, { key: e.target.value || undefined })} />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-semibold mb-2 text-gray-700">Selector</label>
                      <input className="ios-input w-full" placeholder="Optional" value={s.selector || ''} onChange={(e) => update(i, { selector: e.target.value || undefined })} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-2 text-gray-700">Timeout (ms)</label>
                      <input type="number" className="ios-input w-full" value={s.timeout ?? ''} onChange={(e) => update(i, { timeout: e.target.value ? Number(e.target.value) : undefined })} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-2 text-gray-700">Wait (ms)</label>
                      <input type="number" className="ios-input w-full" value={s.waitMs ?? ''} onChange={(e) => update(i, { waitMs: e.target.value ? Number(e.target.value) : undefined })} />
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="block text-xs font-semibold mb-2 text-gray-700">Note</label>
                    <input className="ios-input w-full" placeholder="Optional" value={s.note || ''} onChange={(e) => update(i, { note: e.target.value || undefined })} />
                  </div>

                  <div className="flex flex-wrap gap-4 mt-4">
                    <label className="flex items-center gap-2 text-sm font-medium cursor-pointer text-gray-700">
                      <input id={`ss-${i}`} type="checkbox" className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" checked={!!s.screenshot} onChange={(e) => update(i, { screenshot: e.target.checked || undefined })} />
                      <span>Screenshot</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm font-medium cursor-pointer text-gray-700">
                      <input id={`dom-${i}`} type="checkbox" className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" checked={!!s.domSnapshot} onChange={(e) => update(i, { domSnapshot: e.target.checked || undefined })} />
                      <span>DOM Snapshot</span>
                    </label>
                    {(s.type === 'type' || s.type === 'click') && (
                      <label className="flex items-center gap-2 text-sm font-medium cursor-pointer text-gray-700">
                        <input id={`sens-${i}`} type="checkbox" className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" checked={!!s.sensitive} onChange={(e) => update(i, { sensitive: e.target.checked || undefined })} />
                        <span>Sensitive</span>
                      </label>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
