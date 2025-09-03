// Subgoal and Subtask data structures for hierarchical task planning

export interface Subgoal {
  id: string;
  short: string;        // Kurzbeschreibung (1-2 Sätze)
  detail: string;       // Detailbeschreibung
  successCriteria: string[]; // Erfolgskriterien für das Subgoal
  hints?: string[];     // Hinweise für die Umsetzung
  risks?: string[];     // Bekannte Risiken oder Probleme
  priority?: number;    // Priorität (1 = hoch, höhere Zahlen = niedriger)
  estimatedDuration?: number; // Geschätzte Dauer in Sekunden
}

export interface Subtask {
  id: string;
  subgoalId: string;    // Referenz zum zugehörigen Subgoal
  short: string;        // Kurzbeschreibung der Subtask
  detail: string;       // Detailbeschreibung
  successCriteria: string[]; // Akzeptanzkriterien
  priority?: number;    // Priorität innerhalb des Subgoals
  dependencies?: string[]; // IDs anderer Subtasks, die vorher abgeschlossen sein müssen
  maxRetries?: number;  // Maximale Anzahl von Wiederholungen bei Fehlern
  timeout?: number;     // Timeout in Millisekunden
}

// Status-Tracking für Subgoals und Subtasks
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

export interface SubgoalProgress {
  subgoal: Subgoal;
  status: TaskStatus;
  startTime?: number;
  endTime?: number;
  subtasks: SubtaskProgress[];
  attempts: number;
  lastError?: string;
  completedCriteria: string[]; // Welche Erfolgskriterien bereits erfüllt sind
}

export interface SubtaskProgress {
  subtask: Subtask;
  status: TaskStatus;
  startTime?: number;
  endTime?: number;
  attempts: number;
  stepHistory: import('howto-core').StepAction[]; // Ausgeführte Schritte für diese Subtask
  lastError?: string;
  completedCriteria: string[]; // Welche Akzeptanzkriterien bereits erfüllt sind
  // UI inventory removed
}

// Kontext für Subgoal/Subtask-Planung
export interface SubgoalPlanningContext {
  goalIntent: string;   // Ursprünglicher Benutzer-Intent
  cleanedDOM: string;   // Bereinigtes HTML der aktuellen Seite
  currentUrl: string;
  pageTitle: string;
  visibleSections?: string[]; // Sichtbare Bereiche der Seite
  previousSubgoals?: SubgoalProgress[]; // Bereits bearbeitete Subgoals
  constraints?: {
    maxSubgoals?: number;
    maxSubtasksPerSubgoal?: number;
    timeLimit?: number; // Gesamt-Zeitlimit in Sekunden
  };
}

export interface SubtaskPlanningContext {
  subgoal: Subgoal;
  currentDOM: string;   // Aktueller DOM-Zustand (kann reduziert sein)
  currentUrl: string;
  completedSubtasks?: SubtaskProgress[]; // Bereits abgeschlossene Subtasks dieses Subgoals
  constraints?: {
    maxSubtasks?: number;
    timeLimit?: number;
  };
}

// Ergebnis der Subgoal-Planung
export interface SubgoalPlanningResult {
  subgoals: Subgoal[];
  confidence: number;
  fallbackStrategy?: string; // Was zu tun ist, wenn Subgoals fehlschlagen
}

// Ergebnis der Subtask-Planung
export interface SubtaskPlanningResult {
  subtasks: Subtask[];
  confidence: number;
  estimatedDuration?: number; // Geschätzte Gesamtdauer für alle Subtasks
}

// Combined planning result for current goal with its tasks (token efficient)
export interface GoalWithTasksResult {
  subgoal: Subgoal;
  subtasks: Subtask[];
  confidence: number;
  fallbackStrategy?: string;
  estimatedDuration?: number;
}

// Erweiterte LLM-Provider-Schnittstelle für Subgoal/Subtask-Unterstützung
export interface SubgoalLLMProvider {
  // Combined planning: Current goal + its tasks in one call (token efficient)
  planCurrentGoalWithTasks(context: SubgoalPlanningContext): Promise<GoalWithTasksResult>;
  
  
  // Re-plant Subgoal oder Subtask bei Problemen
  replanTask(
    failed: Subgoal | Subtask,
    error: string,
    context: SubgoalPlanningContext | SubtaskPlanningContext
  ): Promise<Subgoal | Subtask>;
}

// Feature-Flag-Konfiguration
export interface SubgoalConfig {
  enabled: boolean;
  maxSubgoals: number;
  maxSubtasksPerSubgoal: number;
  maxStepsPerSubtask: number;
  maxRetriesPerSubtask: number;
  enableDOMCleaning: boolean;
  enableDOMChunking: boolean;
  chunkSizeLimit: number; // Bytes
  fallbackToSteps: boolean; // Bei Nicht-Unterstützung auf Step-Modus zurückfallen
  interactive: boolean; // Bei unsicherer Planung User fragen
  confidenceThreshold: number; // Minimum confidence für automatische Ausführung
}

// Standard-Konfiguration
export const DEFAULT_SUBGOAL_CONFIG: SubgoalConfig = {
  enabled: true, // Standardmäßig aktiviert
  maxSubgoals: 5,
  maxSubtasksPerSubgoal: 8,
  maxStepsPerSubtask: 30,
  maxRetriesPerSubtask: 3,
  enableDOMCleaning: true,
  enableDOMChunking: true,
  chunkSizeLimit: 200 * 1024, // 200KB
  fallbackToSteps: true,
  interactive: false, // Standardmäßig nicht interaktiv
  confidenceThreshold: 0.6 // Bei < 60% confidence nachfragen
};

// DOM-Bereinigung und -Chunking
export interface DOMCleaningOptions {
  removeSVG: boolean;
  removeStyleAttributes: boolean;
  removeClassHashes: boolean;
  maxDepth?: number;
  preserveRoles: boolean;
  preserveAriaLabels: boolean;
  preserveFormElements: boolean;
}

export interface DOMChunk {
  id: string;
  content: string;
  selector: string; // CSS-Selektor für diesen Bereich
  description: string; // Beschreibung des Inhalts
  priority: number; // Priorität für die Verarbeitung
}

export interface DOMChunkingResult {
  chunks: DOMChunk[];
  totalSize: number;
  chunkingStrategy: 'section' | 'modal' | 'form' | 'size-based';
  mainChunkId?: string; // ID des Haupt-Chunks (falls identifiziert)
}
