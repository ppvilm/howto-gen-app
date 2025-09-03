import { gql, useMutation } from '@apollo/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const START_GENERATE = gql`
  mutation StartGenerate($workspaceId: ID!, $prompt: String!, $options: GenerateOptionsInput) {
    startGenerate(workspaceId: $workspaceId, prompt: $prompt, options: $options) { id name }
  }
`;

const ON_PROMPT = gql`
  subscription OnPrompt($scriptId: ID!) {
    onPromptEvents(scriptId: $scriptId)
  }
`;

import { useApolloClient } from '@apollo/client';
import { getServerBase } from '../serverBase';

function iconFor(ev: any): { icon: string; className: string; bgColor: string } {
  const t = ev?.type || '';
  const step = ev?.step || ev?.result?.step || {};
  
  switch (t) {
    case 'goal_set': return { icon: '🎯', className: 'event-icon event-icon-planning', bgColor: 'bg-blue-100' };
    case 'step_planning': return { icon: '🧭', className: 'event-icon event-icon-planning', bgColor: 'bg-blue-100' };
    case 'step_planned': return { icon: '🧠', className: 'event-icon event-icon-planning', bgColor: 'bg-blue-100' };
    case 'step_executing': 
      // Different icons based on step type
      const stepIcon = getStepIcon(step.type);
      return { icon: stepIcon || '⚡', className: 'event-icon event-icon-executing', bgColor: 'bg-yellow-100' };
    case 'step_executed': 
      const success = ev.result?.success;
      const executedStepIcon = success ? getStepIcon(step.type) : '✗';
      return { 
        icon: executedStepIcon || (success ? '✓' : '✗'), 
        className: `event-icon ${success ? 'event-icon-success' : 'event-icon-error'}`,
        bgColor: success ? 'bg-green-100' : 'bg-red-100'
      };
    case 'markdown_generated': return { icon: '📝', className: 'event-icon event-icon-success', bgColor: 'bg-green-100' };
    case 'script_saving': return { icon: '💾', className: 'event-icon event-icon-executing', bgColor: 'bg-yellow-100' };
    case 'script_saved': return { icon: '✅', className: 'event-icon event-icon-success', bgColor: 'bg-green-100' };
    case 'session_failed': case 'error': return { icon: '❌', className: 'event-icon event-icon-error', bgColor: 'bg-red-100' };
    case 'screenshot_captured': return { icon: '📸', className: 'event-icon event-icon-success', bgColor: 'bg-green-100' };
    case 'validation_performed': return { icon: '🔍', className: 'event-icon event-icon-executing', bgColor: 'bg-yellow-100' };
    default: return { icon: '📣', className: 'event-icon', bgColor: 'bg-gray-100' };
  }
}

function getStepIcon(stepType: string): string {
  if (!stepType) return '';
  
  switch (stepType.toLowerCase()) {
    case 'click': return '👆';
    case 'type': return '⌨️';
    case 'navigate': return '🌐';
    case 'scroll': return '📜';
    case 'wait': return '⏱️';
    case 'hover': return '🖱️';
    case 'select': return '📋';
    case 'upload': return '📤';
    case 'press': return '⏹️';
    case 'screenshot': return '📸';
    case 'validate': return '✅';
    default: return '🔧';
  }
}

function getStepDescription(step: any): string {
  if (!step || !step.type) return '';
  
  const stepType = step.type.toLowerCase();
  const label = step.label || '';
  const text = step.text || step.value || '';
  const url = step.url || '';
  
  switch (stepType) {
    case 'click':
      return label ? `clicking "${label}"` : 'clicking element';
    case 'type':
      if (text) {
        const displayText = text.length > 30 ? `${text.substring(0, 30)}...` : text;
        return `typing "${displayText}"`;
      }
      return label ? `typing in "${label}"` : 'typing text';
    case 'navigate':
      return url ? `navigating to ${url}` : 'navigating';
    case 'scroll':
      return 'scrolling page';
    case 'wait':
      return label ? `waiting for "${label}"` : 'waiting';
    case 'hover':
      return label ? `hovering over "${label}"` : 'hovering';
    case 'select':
      const option = step.option || text;
      if (option) {
        return label ? `selecting "${option}" from "${label}"` : `selecting "${option}"`;
      }
      return label ? `selecting from "${label}"` : 'selecting option';
    case 'upload':
      return label ? `uploading file to "${label}"` : 'uploading file';
    case 'press':
      const key = step.key || text;
      return key ? `pressing ${key}` : 'pressing key';
    case 'screenshot':
      return 'taking screenshot';
    case 'validate':
      return 'validating page';
    default:
      return label ? `${stepType} "${label}"` : stepType;
  }
}

function titleFor(ev: any): string {
  const t = ev?.type || '';
  const step = ev?.step || ev?.result?.step || {};
  const stepDescription = getStepDescription(step);
  
  switch (t) {
    case 'goal_set': return 'Goal Set';
    case 'step_planning': return stepDescription ? `Planning step: ${stepDescription}` : 'Planning Step';
    case 'step_planned': return stepDescription ? `Step planned: ${stepDescription}` : 'Step Planned';
    case 'step_executing': return stepDescription ? `Executing: ${stepDescription}` : 'Executing Step';
    case 'step_executed': 
      const baseTitle = ev.result?.success ? 'Completed' : 'Failed';
      return stepDescription ? `${baseTitle}: ${stepDescription}` : `Step ${baseTitle}`;
    case 'markdown_generated': return 'Guide Generated';
    case 'script_saving': return 'Saving Script';
    case 'script_saved': return 'Script Saved';
    case 'session_failed': return 'Generation Failed';
    case 'screenshot_captured': return 'Screenshot Captured';
    case 'validation_performed': return 'Validation Performed';
    default: return t?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Event';
  }
}

function getEventPhase(ev: any): 'planning' | 'executing' | 'completed' | 'error' {
  const t = ev?.type || '';
  if (['goal_set', 'step_planning', 'step_planned'].includes(t)) return 'planning';
  if (['step_executing', 'script_saving', 'validation_performed'].includes(t)) return 'executing';
  if (['step_executed', 'markdown_generated', 'script_saved', 'screenshot_captured'].includes(t)) {
    return ev.result?.success === false || t === 'session_failed' ? 'error' : 'completed';
  }
  if (['session_failed', 'error'].includes(t)) return 'error';
  return 'executing';
}

function calculateProgress(events: any[]): { progress: number; phase: string; completedSteps: number; totalSteps: number } {
  const totalEvents = events.length;
  if (totalEvents === 0) return { progress: 0, phase: 'Starting...', completedSteps: 0, totalSteps: 0 };
  
  const lastEvent = events[events.length - 1];
  const completedSteps = events.filter(e => e.type === 'step_executed' && e.result?.success).length;
  const totalSteps = Math.max(events.filter(e => e.type?.includes('step_')).length / 2, completedSteps);
  
  if (lastEvent.type === 'script_saved') return { progress: 100, phase: 'Completed', completedSteps, totalSteps };
  if (lastEvent.type === 'session_failed' || lastEvent.type === 'error') return { progress: 0, phase: 'Failed', completedSteps, totalSteps };
  
  if (lastEvent.type?.includes('step_')) {
    const step = lastEvent.step || lastEvent.result?.step || {};
    const stepDescription = getStepDescription(step);
    const stepNumber = completedSteps + 1;
    
    if (stepDescription) {
      return { progress: Math.min(90, (completedSteps / Math.max(totalSteps, 1)) * 100), phase: `Step ${stepNumber}: ${stepDescription}`, completedSteps, totalSteps };
    } else {
      return { progress: Math.min(90, (completedSteps / Math.max(totalSteps, 1)) * 100), phase: `Step ${stepNumber}`, completedSteps, totalSteps };
    }
  }
  
  return { progress: Math.min(95, (totalEvents / Math.max(totalEvents + 2, 1)) * 100), phase: 'Processing...', completedSteps, totalSteps };
}

function LoadingSpinner({ events }: { events: any[] }) {
  const { progress, phase, completedSteps, totalSteps } = calculateProgress(events);
  const isActive = progress > 0 && progress < 100;
  
  return (
    <div className="mb-4 p-4 ios-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {isActive && (
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
          )}
          <div className={`phase-indicator phase-${getEventPhase(events[events.length - 1])}`}>
            <div className="w-2 h-2 rounded-full bg-current"></div>
            <span>{phase}</span>
          </div>
        </div>
        <div className="text-xs text-gray-500">
          {completedSteps} / {Math.max(totalSteps, completedSteps)} steps
        </div>
      </div>
    </div>
  );
}

function Summary({ ev }: { ev: any }) {
  const t = ev?.type;
  const Row = ({ label, value }: { label: string; value: any }) => (
    <div className="text-xs text-gray-700"><span className="text-gray-500">{label}: </span><span className="break-all">{String(value)}</span></div>
  );

  try {
    if (t === 'goal_set') {
      return (
        <div className="space-y-1">
          <Row label="Prompt" value={ev.prompt} />
        </div>
      );
    }
    if (t === 'step_planning') {
      return (
        <div className="space-y-1">
          <Row label="Step" value={(ev.stepIndex ?? 0) + 1} />
          {ev.currentUrl && <Row label="URL" value={ev.currentUrl} />}
        </div>
      );
    }
    if (t === 'step_planned') {
      const step = ev.step || {};
      return (
        <div className="space-y-1">
          <Row label="Action" value={step.type} />
          {(step.label || step.url) && <Row label="Target" value={step.label || step.url} />}
          {typeof ev.confidence === 'number' && <Row label="Confidence" value={ev.confidence.toFixed(2)} />}
        </div>
      );
    }
    if (t === 'step_executing') {
      const step = ev.step || {};
      return (
        <div className="space-y-1">
          <Row label="Step" value={(ev.stepIndex ?? 0) + 1} />
          <Row label="Action" value={step.type} />
          {(step.label || step.url) && <Row label="Target" value={step.label || step.url} />}
        </div>
      );
    }
    if (t === 'step_executed') {
      const res = ev.result || {};
      const step = res.step || {};
      return (
        <div className="space-y-1">
          <Row label="Step" value={(ev.stepIndex ?? 0) + 1} />
          <Row label="Action" value={step.type} />
          {(step.label || step.url) && <Row label="Target" value={step.label || step.url} />}
          <Row label="Status" value={res.success ? 'success' : 'failed'} />
          {typeof res.duration === 'number' && <Row label="Duration" value={`${res.duration.toFixed(1)}s`} />}
          {!res.success && res.error && <Row label="Error" value={res.error} />}
        </div>
      );
    }
    if (t === 'validation_performed') {
      const fulfilled = Array.isArray(ev.fulfilled) ? ev.fulfilled.length : 0;
      const pending = Array.isArray(ev.pending) ? ev.pending.length : 0;
      return (
        <div className="space-y-1">
          <Row label="Criteria" value={`${fulfilled} ok, ${pending} pending`} />
        </div>
      );
    }
    if (t === 'markdown_generated') {
      return (
        <div className="space-y-1">
          <Row label="Steps" value={ev.stepCount} />
        </div>
      );
    }
    if (t === 'script_saved') {
      return (
        <div className="space-y-1">
          {ev.url ? <Row label="URL" value={ev.url} /> : <Row label="Path" value={ev.path} />}
        </div>
      );
    }
  } catch {}
  // Fallback: no JSON display
  return (<div className="text-[11px] text-gray-500">No summary available.</div>);
}

function EventStreamDialog({ isOpen, onClose, events, scriptId }: {
  isOpen: boolean;
  onClose: () => void;
  events: any[];
  scriptId: string;
}) {
  const apiBase = getServerBase();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsEvent, setDetailsEvent] = useState<any | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedEvent, setCopiedEvent] = useState<string | null>(null);
  // The last successfully loaded screenshot we show to the user
  const [displayedScreenshot, setDisplayedScreenshot] = useState<string | null>(null);
  // Cache-buster only for preloading retries
  const [cacheBust, setCacheBust] = useState<number>(0);
  const retryCountRef = useRef<number>(0);
  const lastPendingUrlRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Resolve latest available screenshot URL from events (once per change)
  const latestScreenshotBase = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      const explicitUrl = e?.screenshotUrl && String(e.screenshotUrl).trim() !== '' ? `${apiBase}${String(e.screenshotUrl)}` : null;
      const fromPathUrl = e?.screenshotPath && String(e.screenshotPath).trim() !== '' ? `${apiBase}/files?path=${encodeURIComponent(String(e.screenshotPath))}` : null;
      const dataUrl = e?.screenshot && typeof e.screenshot === 'string' && e.screenshot.startsWith('data:') ? String(e.screenshot) : null;
      const imgPath = e?.path && typeof e.path === 'string' && /\.(png|jpg|jpeg|gif)$/i.test(e.path) ? String(e.path) : null;
      const imgUrl = explicitUrl || fromPathUrl || dataUrl || (imgPath ? `${apiBase}/files?path=${encodeURIComponent(imgPath)}` : null);
      if (imgUrl && imgUrl !== 'undefined' && imgUrl !== 'null' && imgUrl !== `${apiBase}undefined` && imgUrl !== `${apiBase}null`) {
        return imgUrl;
      }
    }
    return null;
  }, [events, apiBase]);

  // Preload the latest screenshot; only swap when it actually loaded
  useEffect(() => {
    const pending = latestScreenshotBase;
    if (!pending) return;
    if (pending === displayedScreenshot) return; // already showing

    // If it's a data/blob URL, it's ready; swap immediately
    if (pending.startsWith('data:') || pending.startsWith('blob:')) {
      setDisplayedScreenshot(pending);
      return;
    }

    // Only start/restart retries when the pending changes
    if (lastPendingUrlRef.current !== pending) {
      lastPendingUrlRef.current = pending;
      retryCountRef.current = 0;
      setCacheBust((v) => v + 1);
    }

    let cancelled = false;
    const tryLoad = () => {
      if (cancelled) return;
      const img = new Image();
      const url = `${pending}${pending.includes('?') ? '&' : '?'}v=${Date.now()}`;
      img.onload = () => {
        if (!cancelled) {
          setDisplayedScreenshot(pending);
        }
      };
      img.onerror = () => {
        if (cancelled) return;
        if (retryCountRef.current < 3) {
          retryCountRef.current += 1;
          setTimeout(tryLoad, 350);
        }
        // else: keep showing the previous displayed screenshot
      };
      img.src = url;
    };
    tryLoad();

    return () => { cancelled = true; };
  }, [latestScreenshotBase, displayedScreenshot]);

  function openDetails(ev: any) {
    setDetailsEvent(ev);
    setDetailsOpen(true);
  }

  function closeDetails() {
    setDetailsOpen(false);
    setDetailsEvent(null);
  }
  
  async function copyEventDetails(ev: any) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(ev, null, 2));
      setCopiedEvent(ev.type + '_' + Date.now());
      setTimeout(() => setCopiedEvent(null), 2000);
    } catch (error) {
      console.warn('Failed to copy to clipboard:', error);
    }
  }

  useEffect(() => {
    if (autoScroll && isOpen && containerRef.current) {
      // Scroll to bottom of the container instead of using scrollIntoView
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [events, autoScroll, isOpen]);
  
  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;
    
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 's':
            e.preventDefault();
            setAutoScroll(!autoScroll);
            break;
        }
      }
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [autoScroll, isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 event-dialog-backdrop event-dialog-modal flex items-center justify-center">
      <div className="ios-card-elevated w-[95vw] max-w-5xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-white/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-900">AI Generation Events</h2>
            <div className="text-xs text-gray-400" title="Keyboard shortcuts: Cmd/Ctrl+S (toggle auto-scroll), ESC (close)">
              ⌘
            </div>
          </div>
          <button onClick={onClose} className="ios-button-ghost text-sm px-3 py-1">✕</button>
        </div>
        
        <div className="flex-1 overflow-hidden flex flex-col p-4">
          <LoadingSpinner events={events} />
          
          {displayedScreenshot && (
            <div className="mb-4 ios-card p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                {latestScreenshotBase && latestScreenshotBase !== displayedScreenshot ? 'Last Screenshot' : 'Latest Screenshot'}
              </h3>
              <img
                key={displayedScreenshot}
                src={displayedScreenshot}
                alt="Screenshot"
                className="w-full max-h-96 object-contain rounded-lg border border-white/40 shadow-sm"
              />
              {latestScreenshotBase && latestScreenshotBase !== displayedScreenshot && (
                <div className="mt-2 text-xs text-gray-500">Loading latest screenshot…</div>
              )}
            </div>
          )}
          
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">Event Timeline</h3>
            <button 
              onClick={() => setAutoScroll(!autoScroll)}
              className={`event-action-button ${
                autoScroll ? 'bg-blue-50 text-blue-600' : ''
              }`}
            >
              Auto-scroll {autoScroll ? '🔴' : '⚫'}
            </button>
          </div>
          
          <div ref={containerRef} className="flex-1 overflow-auto ios-card event-list-container">
            <div className="space-y-3">
              {events.map((e, i) => {
                const { icon, className, bgColor } = iconFor(e);
                const domUrl = e?.domSnapshotUrl ? `${apiBase}${String(e.domSnapshotUrl)}` : null;
                const isLatest = i === events.length - 1;
                const eventKey = e.type + '_' + Date.now();
                const isCopied = copiedEvent === eventKey;
                const phase = getEventPhase(e);
                
                return (
                  <div key={i} className={`event-card ${i === events.length - 1 ? 'event-card-enter' : ''} p-4 rounded-xl border transition-all duration-200 hover:shadow-md ${
                    phase === 'planning' ? 'border-blue-200 bg-blue-50/30' :
                    phase === 'executing' ? 'border-yellow-200 bg-yellow-50/30' :
                    phase === 'completed' ? 'border-green-200 bg-green-50/30' :
                    phase === 'error' ? 'border-red-200 bg-red-50/30' : 'border-gray-200 bg-gray-50/30'
                  } ${isLatest && phase === 'executing' ? 'ring-2 ring-yellow-300 ring-opacity-50' : ''}`}>
                    <div className="flex items-start gap-4">
                      <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg ${bgColor} ${className}`}>
                        {icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-semibold text-gray-900 text-sm leading-tight">{titleFor(e)}</h4>
                          {isLatest && phase === 'executing' && (
                            <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-blue-100 border border-blue-200">
                              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                              <span className="text-xs text-blue-700 font-medium">Live</span>
                            </div>
                          )}
                        </div>
                        {e?.message && (
                          <div className="text-sm text-gray-700 break-words mb-3 p-3 bg-white/60 rounded-lg border border-gray-100">
                            {e.message}
                          </div>
                        )}
                        {!e?.message && (
                          <div className="mb-3">
                            <Summary ev={e} />
                          </div>
                        )}
                        {domUrl && (
                          <div className="mb-3">
                            <a href={domUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium rounded-lg transition-colors no-underline">
                              🌐 Open DOM Snapshot
                            </a>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => openDetails(e)} 
                            className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-lg transition-colors"
                          >
                            📋 Details
                          </button>
                          <button 
                            onClick={() => copyEventDetails(e)}
                            className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                              isCopied 
                                ? 'bg-green-100 text-green-700' 
                                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                            }`}
                          >
                            {isCopied ? '✅ Copied' : '📄 Copy JSON'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div ref={endRef} />
          </div>
        </div>
        
        {detailsOpen && createPortal(
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm event-details-modal flex items-center justify-center">
            <div className="ios-card-elevated w-[90vw] max-w-3xl max-h-[80vh] flex flex-col">
              <div className="px-6 py-4 border-b border-white/60 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="font-semibold text-gray-900">Event Details</div>
                  {detailsEvent && (
                    <div className={`phase-indicator phase-${getEventPhase(detailsEvent)}`}>
                      <span>{detailsEvent.type}</span>
                    </div>
                  )}
                </div>
                <button onClick={closeDetails} className="ios-button-ghost text-sm px-3 py-1">✕</button>
              </div>
              <DetailsContent ev={detailsEvent} />
              <div className="px-6 py-4 border-t border-white/60 flex justify-between">
                <button 
                  onClick={() => copyEventDetails(detailsEvent)}
                  className="event-action-button"
                >
                  📋 Copy JSON
                </button>
                <button onClick={closeDetails} className="ios-button-primary text-sm">Close</button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>,
    document.body
  );
}

function PromptStream({ scriptId }: { scriptId: string }) {
  const client = useApolloClient();
  const [events, setEvents] = useState<any[]>([]);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);


  useEffect(() => {
    const sub = client.subscribe({ query: ON_PROMPT, variables: { scriptId } }).subscribe({
      next: (msg) => {
        const ev = (msg.data as any)?.onPromptEvents;
        setEvents((prev) => [...prev, ev]);
        // When script is saved, announce for editor to open
        try {
          if (ev && ev.type === 'script_saved' && ev.scriptId) {
            localStorage.setItem('howto_open_script', ev.scriptId);
          }
        } catch {}
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

  calculateProgress(events);
  const recentEvents = events.slice(-3); // Show only last 3 events

  return (
    <div className="mt-4">
      <div className="ios-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">Generation Status</h3>
          <button 
            onClick={() => setEventDialogOpen(true)}
            className="ios-button-secondary text-sm px-3 py-1"
            disabled={events.length === 0}
          >
            📊 View Events ({events.length})
          </button>
        </div>
        
        <LoadingSpinner events={events} />
        
        {events.length > 0 && (
          <div className="mt-4">
            <h4 className="text-xs font-medium text-gray-500 mb-2">Recent Activity</h4>
            <div className="space-y-2">
              {recentEvents.map((e, i) => {
                const { icon, className, bgColor } = iconFor(e);
                const isLatest = i === recentEvents.length - 1;
                const phase = getEventPhase(e);
                
                return (
                  <div key={i} className={`compact-event-item flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    phase === 'planning' ? 'border-blue-100 bg-blue-50/20' :
                    phase === 'executing' ? 'border-yellow-100 bg-yellow-50/20' :
                    phase === 'completed' ? 'border-green-100 bg-green-50/20' :
                    phase === 'error' ? 'border-red-100 bg-red-50/20' : 'border-gray-100 bg-gray-50/20'
                  }`}>
                    <div className={`${bgColor} w-8 h-8 rounded-full flex items-center justify-center text-sm ${className}`}>
                      {icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {titleFor(e)}
                        </span>
                        {isLatest && events.length > 0 && phase === 'executing' && (
                          <div className="flex items-center gap-1 ml-2 px-2 py-0.5 bg-blue-100 rounded-full">
                            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></div>
                            <span className="text-xs text-blue-600 font-medium">Live</span>
                          </div>
                        )}
                      </div>
                      {e?.message && (
                        <p className="text-xs text-gray-600 truncate mt-1">{e.message}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            
            {events.length > 3 && (
              <button 
                onClick={() => setEventDialogOpen(true)}
                className="w-full mt-3 text-xs text-blue-600 hover:text-blue-800 transition-colors"
              >
                View all {events.length} events →
              </button>
            )}
          </div>
        )}
      </div>
      
      <EventStreamDialog 
        isOpen={eventDialogOpen}
        onClose={() => setEventDialogOpen(false)}
        events={events}
        scriptId={scriptId}
      />
    </div>
  );
}

function DetailsContent({ ev }: { ev: any }) {
  const Wrap = ({ children }: { children: any }) => (
    <div className="p-3 overflow-auto text-xs space-y-1">{children}</div>
  );
  const Row = ({ label, value }: { label: string; value: any }) => (
    <div><span className="text-gray-500">{label}: </span><span className="break-all">{String(value)}</span></div>
  );

  if (!ev || typeof ev !== 'object') {
    return <Wrap>No details.</Wrap>;
  }

  const t = ev.type;
  if (t === 'goal_set') {
    return <Wrap><Row label="Prompt" value={ev.prompt} /></Wrap>;
  }
  if (t === 'step_planning') {
    return (
      <Wrap>
        <Row label="Step" value={(ev.stepIndex ?? 0) + 1} />
        {ev.currentUrl && <Row label="URL" value={ev.currentUrl} />}
      </Wrap>
    );
  }
  if (t === 'step_planned') {
    const step = ev.step || {};
    return (
      <Wrap>
        <Row label="Action" value={step.type} />
        {(step.label || step.url) && <Row label="Target" value={step.label || step.url} />}
        {typeof ev.confidence === 'number' && <Row label="Confidence" value={ev.confidence.toFixed(2)} />}
        {ev.reasoning && <Row label="Reasoning" value={ev.reasoning} />}
        {Array.isArray(ev.alternatives) && <Row label="Alternatives" value={ev.alternatives.length} />}
      </Wrap>
    );
  }
  if (t === 'step_executing') {
    const step = ev.step || {};
    return (
      <Wrap>
        <Row label="Step" value={(ev.stepIndex ?? 0) + 1} />
        <Row label="Action" value={step.type} />
        {(step.label || step.url) && <Row label="Target" value={step.label || step.url} />}
      </Wrap>
    );
  }
  if (t === 'step_executed') {
    const res = ev.result || {};
    const step = res.step || {};
    return (
      <Wrap>
        <Row label="Step" value={(ev.stepIndex ?? 0) + 1} />
        <Row label="Action" value={step.type} />
        {(step.label || step.url) && <Row label="Target" value={step.label || step.url} />}
        <Row label="Status" value={res.success ? 'success' : 'failed'} />
        {typeof res.duration === 'number' && <Row label="Duration" value={`${res.duration.toFixed(1)}s`} />}
        {!res.success && res.error && <Row label="Error" value={res.error} />}
        {res.uiChanges?.newUrl && <Row label="New URL" value={res.uiChanges.newUrl} />}
      </Wrap>
    );
  }
  if (t === 'validation_performed') {
    const fulfilled = Array.isArray(ev.fulfilled) ? ev.fulfilled.length : 0;
    const pending = Array.isArray(ev.pending) ? ev.pending.length : 0;
    return (
      <Wrap>
        <Row label="Fulfilled" value={fulfilled} />
        <Row label="Pending" value={pending} />
      </Wrap>
    );
  }
  if (t === 'markdown_generated') {
    return <Wrap><Row label="Steps" value={ev.stepCount} /></Wrap>;
  }
  if (t === 'script_saved') {
    return <Wrap><Row label={ev.url ? 'URL' : 'Path'} value={ev.url || ev.path} /></Wrap>;
  }

  return <Wrap>No additional details.</Wrap>;
}

export default function GenerateAI() {
  const workspaceId = useMemo(() => localStorage.getItem('howto_workspace'), []);
  const [prompt, setPrompt] = useState('Login to the app and open dashboard');
  const [baseUrl, setBaseUrl] = useState('https://example.com');
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [start, { loading }] = useMutation(START_GENERATE);

  const disabled = !workspaceId || !prompt.trim() || !baseUrl.trim();

  const onStart = async () => {
    if (!workspaceId) return;
    const options: any = { baseUrl };
    const res = await start({ variables: { workspaceId, prompt, options } });
    const id = res.data?.startGenerate?.id as string | undefined;
    if (id) setScriptId(id);
  };

  return (
    <section className="ios-card-elevated p-6 mb-6 border-2" style={{borderColor: 'var(--ios-blue)', boxShadow: '0 8px 25px rgba(0, 122, 255, 0.15)'}}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold">✨</div>
          <h2 className="text-xl font-semibold text-gray-900">Generate with AI</h2>
          <span className="ios-badge-primary text-xs">NEW</span>
        </div>
        <button className="ios-button-ghost text-sm px-4 py-2" onClick={() => setOpen((v) => !v)}>{open ? 'Minimize' : 'Expand'}</button>
      </div>
      {open && (
        <div className="space-y-6">
          <div className="ios-card p-4 bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200">
            <div className="flex items-start gap-3">
              <div className="text-2xl">🤖</div>
              <div className="flex-1">
                <div className="font-semibold text-gray-900 mb-1">AI-Powered Flow Generation</div>
                <div className="text-sm text-gray-600">Describe what you want to accomplish, and I'll create a complete automated flow for you with screenshots, validations, and documentation.</div>
              </div>
            </div>
          </div>
          {!workspaceId && (
            <div className="ios-card p-4 bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200">
              <div className="flex items-center gap-3">
                <div className="text-2xl">⚠️</div>
                <div>
                  <div className="font-semibold text-gray-900">Workspace Required</div>
                  <div className="text-sm text-gray-600">Please select a workspace in the sidebar first to start generating.</div>
                </div>
              </div>
            </div>
          )}
          {workspaceId && (
            <>
              <div>
                <label className="block text-sm font-semibold mb-2 text-gray-700">Base URL</label>
                <input className="ios-input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://app.example.com" />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2 text-gray-700">Prompt</label>
                <textarea className="ios-input min-h-[120px] resize-y" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the task…" />
              </div>
              <div className="flex items-center gap-3">
                <button 
                  disabled={disabled || loading} 
                  onClick={onStart} 
                  className="ios-button-primary px-6 py-3 text-base font-semibold"
                  style={{background: 'linear-gradient(135deg, var(--ios-blue), var(--ios-purple))', boxShadow: '0 4px 12px rgba(0, 122, 255, 0.3)'}}
                >
                  {loading ? '✨ Generating…' : '🚀 Generate Flow'}
                </button>
                {scriptId && <span className="ios-badge-success">Script: {scriptId}</span>}
              </div>
              {scriptId && <PromptStream scriptId={scriptId} />}
            </>
          )}
        </div>
      )}
    </section>
  );
}
