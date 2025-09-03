import { gql, useApolloClient } from '@apollo/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getServerBase } from '../serverBase';

const ON_RUN = gql`
  subscription OnRun($sessionId: ID!) {
    onRunEvents(sessionId: $sessionId)
  }
`;

function getStepIcon(stepType: string): string {
  if (!stepType) return '';
  
  switch (stepType.toLowerCase()) {
    case 'click': return '👆';
    case 'type': return '⌨️';
    case 'navigate': case 'goto': return '🌐';
    case 'scroll': return '📜';
    case 'wait': return '⏱️';
    case 'hover': return '🖱️';
    case 'select': return '📋';
    case 'upload': return '📤';
    case 'press': return '⏹️';
    case 'screenshot': return '📸';
    case 'validate': return '✅';
    case 'tts_start': case 'tts_wait': case 'tts_stop': return '🔊';
    case 'video_recording_started': case 'video_recording_stopped': return '🎥';
    case 'step_started': return '▶️';
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
    case 'navigate': case 'goto':
      return url ? `navigating to ${url}` : (label ? `going to "${label}"` : 'navigating');
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
    case 'tts_start':
      return label ? `starting TTS "${label}"` : 'starting text-to-speech';
    case 'tts_wait':
      return label ? `waiting for TTS "${label}"` : 'waiting for text-to-speech';
    case 'tts_stop':
      return label ? `stopping TTS "${label}"` : 'stopping text-to-speech';
    case 'video_recording_started':
      return 'starting video recording';
    case 'video_recording_stopped':
      return 'stopping video recording';
    case 'step_started':
      return label ? `starting step "${label}"` : 'starting step';
    default:
      return label ? `${stepType} "${label}"` : stepType.replace(/_/g, ' ');
  }
}

function iconFor(ev: any): { icon: string; className: string; bgColor: string } {
  const t = ev?.type || '';
  const step = ev?.step || ev?.result?.step || {};
  
  // Check if the event type itself is a step type
  const eventTypeIcon = getStepIcon(t);
  if (eventTypeIcon !== '🔧') {
    // This is a step-type event (like tts_start, goto, etc.)
    const success = ev.result?.success;
    if (success !== undefined) {
      // This is a completed step
      return { 
        icon: success ? eventTypeIcon : '✗', 
        className: `event-icon ${success ? 'event-icon-success' : 'event-icon-error'}`,
        bgColor: success ? 'bg-green-100' : 'bg-red-100'
      };
    } else {
      // This is an executing step
      return { icon: eventTypeIcon, className: 'event-icon event-icon-executing', bgColor: 'bg-yellow-100' };
    }
  }
  
  switch (t) {
    case 'run_started': return { icon: '▶️', className: 'event-icon event-icon-planning', bgColor: 'bg-blue-100' };
    case 'step_executing': 
      const stepIcon = getStepIcon(step.type);
      return { icon: stepIcon || '⚡', className: 'event-icon event-icon-executing', bgColor: 'bg-yellow-100' };
    case 'step_executed': case 'step_completed':
      const success = ev.result?.success;
      const executedStepIcon = success ? getStepIcon(step.type) : '✗';
      return { 
        icon: executedStepIcon || (success ? '✅' : '❌'), 
        className: `event-icon ${success ? 'event-icon-success' : 'event-icon-error'}`,
        bgColor: success ? 'bg-green-100' : 'bg-red-100'
      };
    case 'step_started':
      return { icon: '▶️', className: 'event-icon event-icon-executing', bgColor: 'bg-yellow-100' };
    case 'screenshot_captured': return { icon: '📸', className: 'event-icon event-icon-success', bgColor: 'bg-green-100' };
    case 'dom_snapshot_captured': return { icon: '🕸️', className: 'event-icon event-icon-success', bgColor: 'bg-green-100' };
    case 'session_failed': case 'error': return { icon: '❌', className: 'event-icon event-icon-error', bgColor: 'bg-red-100' };
    case 'completed': return { icon: '🏁', className: 'event-icon event-icon-success', bgColor: 'bg-green-100' };
    case 'video_recording_started': return { icon: '🎥', className: 'event-icon event-icon-planning', bgColor: 'bg-blue-100' };
    default: return { icon: '📣', className: 'event-icon', bgColor: 'bg-gray-100' };
  }
}

function titleFor(ev: any): string {
  const t = ev?.type || '';
  const step = ev?.step || ev?.result?.step || {};
  const stepDescription = getStepDescription(step);
  
  // Debug: Let's add console logging to see what data we're getting
  if (t.includes('tts') || t.includes('goto')) {
    console.log('RunStream Event:', { type: t, event: ev, step, stepDescription, keys: Object.keys(ev) });
  }
  
  // First try to get description from the step data
  if (stepDescription && stepDescription !== step.type) {
    const success = ev.result?.success;
    if (success !== undefined) {
      const baseTitle = success ? 'Completed' : 'Failed';
      return `${baseTitle}: ${stepDescription}`;
    } else {
      return `Executing: ${stepDescription}`;
    }
  }
  
  // Check if this event type is itself a step type (like tts_start, goto, etc.)
  const eventAsStep = { 
    type: t, 
    label: ev?.label || ev?.message || '', 
    text: ev?.text || ev?.value || '',
    url: ev?.url || ''
  };
  const eventTypeDescription = getStepDescription(eventAsStep);
  
  if (eventTypeDescription && eventTypeDescription !== t && eventTypeDescription !== t.replace(/_/g, ' ')) {
    const success = ev.result?.success;
    if (success !== undefined) {
      // This is a completed step-type event
      const baseTitle = success ? 'Completed' : 'Failed';
      return `${baseTitle}: ${eventTypeDescription}`;
    } else {
      // This is an executing step-type event
      return `Executing: ${eventTypeDescription}`;
    }
  }
  
  // Special handling for known step types that are event types
  switch (t) {
    case 'run_started': return 'Run Started';
    case 'step_executing': return stepDescription ? `Executing: ${stepDescription}` : 'Executing Step';
    case 'step_executed': case 'step_completed':
      const success = ev.result?.success;
      const baseTitle = success ? 'Completed' : 'Failed';
      if (stepDescription) {
        return `${baseTitle}: ${stepDescription}`;
      }
      // Try to extract info from the event type or message
      const eventInfo = ev?.message || step?.type || '';
      return eventInfo ? `${baseTitle}: ${eventInfo}` : `Step ${baseTitle}`;
    case 'step_started': 
      return stepDescription ? `Starting: ${stepDescription}` : 'Starting Step';
    case 'screenshot_captured': return 'Screenshot Captured';
    case 'dom_snapshot_captured': return 'DOM Snapshot Captured';
    case 'session_failed': return 'Run Failed';
    case 'completed': return 'Run Completed';
    case 'video_recording_started': return 'Video Recording Started';
    case 'video_recording_stopped': return 'Video Recording Stopped';
    
    // Handle TTS events specifically
    case 'tts_start': {
      const label = ev?.label || ev?.message || ev?.description || ev?.name || '';
      const match = label.match(/"([^"]+)"/); // Extract text in quotes
      const ttsName = match ? match[1] : label;
      return ttsName ? `Completed: starting TTS "${ttsName}"` : 'Completed: starting TTS';
    }
    case 'tts_wait': {
      const label = ev?.label || ev?.message || ev?.description || ev?.name || '';
      const match = label.match(/"([^"]+)"/);
      const ttsName = match ? match[1] : label;
      return ttsName ? `Completed: waiting for TTS "${ttsName}"` : 'Completed: waiting for TTS';
    }
    case 'tts_stop': {
      const label = ev?.label || ev?.message || ev?.description || ev?.name || '';
      const match = label.match(/"([^"]+)"/);
      const ttsName = match ? match[1] : label;
      return ttsName ? `Completed: stopping TTS "${ttsName}"` : 'Completed: stopping TTS';
    }
    case 'goto': {
      const target = ev?.url || ev?.label || ev?.message || ev?.destination || '';
      return target ? `Completed: going to ${target}` : 'Completed: navigation';
    }
      
    default: 
      // For unknown events, try to make them more readable
      const readable = t.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
      // If we have additional info, append it
      const extraInfo = ev?.label || ev?.message || '';
      return extraInfo ? `${readable}: ${extraInfo}` : readable || 'Event';
  }
}

function getEventPhase(ev: any): 'planning' | 'executing' | 'completed' | 'error' {
  const t = ev?.type || '';
  
  // Check if it's a session-level event
  if (t === 'run_started' || t === 'video_recording_started') return 'planning';
  if (t === 'completed' || t === 'video_recording_stopped') return 'completed';
  if (['session_failed', 'error'].includes(t)) return 'error';
  
  // Check for step events
  if (['step_executing', 'step_started'].includes(t)) return 'executing';
  if (['step_executed', 'step_completed', 'screenshot_captured', 'dom_snapshot_captured'].includes(t)) {
    return ev.result?.success === false ? 'error' : 'completed';
  }
  
  // Check if the event type itself is a step type (like tts_start, goto, etc.)
  const eventTypeIcon = getStepIcon(t);
  if (eventTypeIcon !== '🔧') {
    // This is a step-type event
    const success = ev.result?.success;
    if (success !== undefined) {
      return success ? 'completed' : 'error';
    } else {
      return 'executing';
    }
  }
  
  // Default to executing for unknown events
  return 'executing';
}

interface RunEvent {
  type: string;
  message?: string;
  stepIndex?: number;
  step?: any;
  result?: {
    success: boolean;
    duration?: number;
    error?: string;
    step?: any;
  };
  screenshot?: string;
  screenshotUrl?: string;
  domSnapshotUrl?: string;
  path?: string;
  error?: string;
}

function RunStreamDialog({ events, onClose, apiBase, scriptConfig }: { events: RunEvent[]; onClose: () => void; apiBase: string; scriptConfig?: ScriptConfig }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        setAutoScroll(!autoScroll);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, autoScroll]);

  const copyEventDetails = (event: RunEvent, index: number) => {
    const details = {
      type: event.type,
      message: event.message,
      step: event.step,
      result: event.result,
      timestamp: new Date().toISOString(),
    };
    navigator.clipboard.writeText(JSON.stringify(details, null, 2));
    setCopied(index);
    setTimeout(() => setCopied(null), 1000);
  };

  const getStepProgress = (events: RunEvent[]) => {
    // Prefer total steps from 'script_loaded' event, then script config
    const totalStepsFromEvent = (() => {
      for (const e of events) {
        if (e.type === 'script_loaded' && typeof (e as any).totalSteps === 'number') {
          return (e as any).totalSteps as number;
        }
      }
      // Also try report_generated if present (read from config)
      for (const e of events) {
        if (e.type === 'report_generated') {
          const cfgSteps = (e as any)?.report?.config?.steps;
          if (Array.isArray(cfgSteps)) return cfgSteps.length;
        }
      }
      return 0;
    })();

    // Then try to read from provided script config
    const totalStepsFromScript = scriptConfig?.steps?.length || 0;
    
    // Count completed steps strictly from step_completed events
    const completedSteps = events.filter(e => (e.type === 'step_completed' || e.type === 'step_executed') && e.result?.success === true).length;
    
    // Use event total steps first, then script steps count, fallback to event-based estimation
    let totalSteps = totalStepsFromEvent || totalStepsFromScript;
    if (totalSteps === 0) {
      // Fallback: use the highest step index + 1
      events.forEach(e => {
        if (e.stepIndex !== undefined) {
          totalSteps = Math.max(totalSteps, e.stepIndex + 1);
        }
      });
      
      // If still no steps, estimate from completed steps
      if (totalSteps === 0) {
        totalSteps = Math.max(completedSteps, 1);
      }
    }
    
    const percentage = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;
    
    return {
      completed: completedSteps,
      total: totalSteps,
      percentage: Math.min(percentage, 100)
    };
  };

  return createPortal(
    <div className="fixed inset-0 event-dialog-backdrop event-details-modal flex items-center justify-center p-4">
      <div className="ios-card w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-lg">Run Events Timeline</h3>
            <div className="ios-segment">
              <div className="ios-segment-button ios-segment-button-active">Timeline</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`event-action-button ${autoScroll ? 'bg-blue-50 text-blue-600' : ''}`}
              title="Ctrl+S"
            >
              Auto-scroll {autoScroll ? 'ON' : 'OFF'}
            </button>
            <button onClick={onClose} className="event-action-button hover:bg-red-50 hover:text-red-600" title="ESC">
              ✕
            </button>
          </div>
        </div>

        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium text-gray-700">Step Progress</div>
            <div className="text-sm text-gray-500">{getStepProgress(events).completed} / {getStepProgress(events).total} steps</div>
          </div>
          <div className="timeline-progress">
            <div 
              className="timeline-progress-fill timeline-progress-glow" 
              style={{ width: `${getStepProgress(events).percentage}%` }}
            ></div>
          </div>
        </div>

        <div ref={containerRef} className="flex-1 overflow-auto event-list-container">
          <div className="p-4 space-y-4">
            {events.map((event, i) => {
              const { icon, className, bgColor } = iconFor(event);
              const explicitUrl = event?.screenshotUrl ? `${apiBase}${String(event.screenshotUrl)}` : null;
              const dataUrl = event?.screenshot && typeof event.screenshot === 'string' && event.screenshot.startsWith('data:') ? String(event.screenshot) : null;
              const imgPath = event?.path && /\.(png|jpg|jpeg|gif)$/i.test(String(event.path)) ? String(event.path) : null;
              const imgUrl = explicitUrl || dataUrl || (imgPath ? `${apiBase}/files?path=${encodeURIComponent(imgPath)}` : null);
              const domUrl = event?.domSnapshotUrl ? `${apiBase}${String(event.domSnapshotUrl)}` : null;
              const step = (event?.result?.step || event?.step || {}) as any;
              const stepIdx = typeof event?.stepIndex === 'number' ? (event.stepIndex + 1) : undefined;
              const phase = getEventPhase(event);
              const isLatest = i === events.length - 1;
              
              return (
                <div key={i} className={`event-card event-card-enter p-5 rounded-xl border transition-all duration-200 hover:shadow-md ${
                  phase === 'planning' ? 'border-blue-200 bg-blue-50/30' :
                  phase === 'executing' ? 'border-yellow-200 bg-yellow-50/30' :
                  phase === 'completed' ? 'border-green-200 bg-green-50/30' :
                  phase === 'error' ? 'border-red-200 bg-red-50/30' : 'border-gray-200 bg-gray-50/30'
                } ${isLatest && phase === 'executing' ? 'ring-2 ring-yellow-300 ring-opacity-50' : ''}`}>
                  <div className="flex items-start gap-4">
                    <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-xl ${bgColor} ${className}`}>
                      {icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-gray-900 text-base leading-tight">{titleFor(event)}</h4>
                        <div className="flex items-center gap-2">
                          {isLatest && phase === 'executing' && (
                            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 border border-blue-200">
                              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                              <span className="text-xs text-blue-700 font-medium">Live</span>
                            </div>
                          )}
                          <button
                            onClick={() => copyEventDetails(event, i)}
                            className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                              copied === i 
                                ? 'bg-green-100 text-green-700' 
                                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                            }`}
                          >
                            {copied === i ? '✅ Copied' : '📄 Copy'}
                          </button>
                        </div>
                      </div>
                      
                      {stepIdx && (
                        <div className="mb-3 p-3 bg-white/60 rounded-lg border border-gray-100">
                          <div className="text-sm text-gray-700">
                            <span className="font-medium">Step {stepIdx}</span>
                            {step?.type && (
                              <>
                                <span className="mx-2 text-gray-400">•</span>
                                <span className="text-gray-600">{getStepDescription(step) || step.type}</span>
                              </>
                            )}
                            {step?.label && !getStepDescription(step) && (
                              <>
                                <span className="mx-2 text-gray-400">•</span>
                                <span className="text-gray-600">{step.label}</span>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {event?.message && (
                        <div className="mb-3 p-3 bg-white/60 rounded-lg border border-gray-100">
                          <div className="text-sm text-gray-700 break-words">
                            {event.message}
                          </div>
                        </div>
                      )}
                      
                      {event?.result && (
                        <div className="mb-3">
                          <div className="flex items-center gap-3">
                            <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
                              event.result.success 
                                ? 'bg-green-100 text-green-800 border border-green-200' 
                                : 'bg-red-100 text-red-800 border border-red-200'
                            }`}>
                              {event.result.success ? '✅ Success' : '❌ Failed'}
                            </span>
                            {typeof event.result.duration === 'number' && (
                              <span className="text-sm text-gray-500 font-mono">
                                {event.result.duration.toFixed(1)}s
                              </span>
                            )}
                          </div>
                          {!event.result.success && event.result.error && (
                            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                              <div className="text-sm text-red-800">
                                <div className="font-medium mb-1">Error:</div>
                                <div className="break-all font-mono text-xs">{event.result.error}</div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {imgUrl && (
                        <div className="mb-3">
                          <img 
                            src={imgUrl} 
                            alt="screenshot" 
                            className="w-full max-h-80 object-contain rounded-lg border border-white/40 shadow-sm" 
                          />
                        </div>
                      )}
                      
                      {domUrl && (
                        <div className="mt-3">
                          <a 
                            href={domUrl} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors no-underline"
                          >
                            🌐 Open DOM Snapshot
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function CompactRunStream({ events, onOpenDialog }: { events: RunEvent[]; onOpenDialog: () => void }) {
  const lastEvents = events.slice(-3);
  
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-gray-700">Recent Events</h4>
        <button
          onClick={onOpenDialog}
          className="ios-button-ghost text-xs px-2 py-1"
        >
          View All ({events.length})
        </button>
      </div>
      <div className="space-y-2">
        {lastEvents.map((event, i) => {
          const { icon, className, bgColor } = iconFor(event);
          const phase = getEventPhase(event);
          const isLatest = i === lastEvents.length - 1;
          
          return (
            <div key={events.length - 3 + i} className={`compact-event-item p-3 rounded-lg border transition-colors ${
              phase === 'planning' ? 'border-blue-100 bg-blue-50/20' :
              phase === 'executing' ? 'border-yellow-100 bg-yellow-50/20' :
              phase === 'completed' ? 'border-green-100 bg-green-50/20' :
              phase === 'error' ? 'border-red-100 bg-red-50/20' : 'border-gray-100 bg-gray-50/20'
            }`}>
              <div className="flex items-start gap-3">
                <div className={`${bgColor} w-8 h-8 rounded-full flex items-center justify-center text-sm ${className}`}>
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-gray-900">{titleFor(event)}</div>
                    {isLatest && phase === 'executing' && (
                      <div className="flex items-center gap-1 ml-2 px-2 py-0.5 bg-blue-100 rounded-full">
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></div>
                        <span className="text-xs text-blue-600 font-medium">Live</span>
                      </div>
                    )}
                  </div>
                  {event?.message && (
                    <div className="text-xs text-gray-600 truncate mt-1">{event.message}</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ScriptConfig {
  steps?: any[];
  title?: string;
  baseUrl?: string;
}

export default function RunStream({ sessionId, scriptConfig }: { sessionId: string; scriptConfig?: ScriptConfig }) {
  const client = useApolloClient();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const apiBase = useMemo(() => getServerBase(), []);

  useEffect(() => {
    const sub = client.subscribe({ query: ON_RUN, variables: { sessionId } }).subscribe({
      next: (msg) => {
        const ev = (msg.data as any)?.onRunEvents;
        setEvents((prev: RunEvent[]) => [...prev, ev]);
      },
      error: (err) => {
        setEvents((prev: RunEvent[]) => [...prev, { type: 'error', error: String(err) }]);
      },
      complete: () => {
        setEvents((prev: RunEvent[]) => [...prev, { type: 'completed' }]);
      },
    });
    return () => sub.unsubscribe();
  }, [client, sessionId]);

  return (
    <>
      <CompactRunStream 
        events={events} 
        onOpenDialog={() => setShowDialog(true)}
      />
      {showDialog && (
        <RunStreamDialog
          events={events}
          onClose={() => setShowDialog(false)}
          apiBase={apiBase}
          scriptConfig={scriptConfig}
        />
      )}
    </>
  );
}
