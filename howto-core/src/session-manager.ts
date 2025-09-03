import { EventEmitter } from 'events';

export interface SessionStatus {
  sessionId: string;  // Changed from scriptId to sessionId
  scriptId?: string;  // Optional: the script being executed (if applicable)
  type: 'run' | 'prompt';
  status: 'created' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0-100
  currentStep?: number;
  totalSteps?: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface SessionInfo extends SessionStatus {
  emitter: EventEmitter;
  cleanup?: () => void;
}

/**
 * Manages active sessions and their event streams
 * Provides centralized event distribution to multiple subscribers
 */
export class SessionManager {
  private static instance: SessionManager;
  private sessions = new Map<string, SessionInfo>();

  private constructor() {}

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  /**
   * Create a new session
   * For 'prompt': sessionId = scriptId (the script being generated)
   * For 'run': sessionId = unique session UUID, scriptId = script being executed
   */
  createSession(sessionId: string, type: 'run' | 'prompt', scriptId?: string, totalSteps?: number): SessionInfo {
    if (this.sessions.has(sessionId)) {
      const existing = this.sessions.get(sessionId)!;
      if (existing.status === 'running') {
        throw new Error(`Session ${sessionId} is already running`);
      }
      // Clean up existing session if it's not running
      this.cleanupSession(sessionId);
    }

    const session: SessionInfo = {
      sessionId,
      scriptId, // For 'prompt' this is undefined initially, for 'run' this is the script being executed
      type,
      status: 'created',
      progress: 0,
      totalSteps,
      createdAt: new Date(),
      emitter: new EventEmitter()
    };

    this.sessions.set(sessionId, session);

    // Emit session created event
    session.emitter.emit('event', {
      type: 'session_created',
      sessionId,
      scriptId,
      timestamp: session.createdAt
    });

    return session;
  }

  /**
   * Get session by session ID
   */
  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get session status
   */
  getSessionStatus(sessionId: string): SessionStatus | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    const { emitter, cleanup, ...status } = session;
    return status;
  }

  /**
   * Start a session
   */
  startSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.status = 'running';
    session.startedAt = new Date();

    session.emitter.emit('event', {
      type: 'session_started',
      sessionId,
      scriptId: session.scriptId
    });
  }

  /**
   * Update session progress
   */
  updateSessionProgress(sessionId: string, progress: number, currentStep?: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.progress = Math.min(100, Math.max(0, progress));
    if (currentStep !== undefined) {
      session.currentStep = currentStep;
    }
  }

  /**
   * Complete a session
   */
  completeSession(sessionId: string, success: boolean, error?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = success ? 'completed' : 'failed';
    session.completedAt = new Date();
    session.progress = 100;
    if (error) {
      session.error = error;
    }

    session.emitter.emit('event', {
      type: success ? 'session_completed' : 'session_failed',
      sessionId,
      scriptId: session.scriptId,
      ...(error ? { error } : { success })
    });

    // Auto-cleanup after 5 minutes
    setTimeout(() => {
      this.cleanupSession(sessionId);
    }, 5 * 60 * 1000);
  }

  /**
   * Cancel a session
   */
  cancelSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'cancelled';
    session.completedAt = new Date();

    session.emitter.emit('event', {
      type: 'session_cancelled',
      sessionId,
      scriptId: session.scriptId
    });

    // Call cleanup function if provided
    if (session.cleanup) {
      try {
        session.cleanup();
      } catch (error) {
        console.warn(`Error during session cleanup for ${sessionId}:`, error);
      }
    }

    // Clean up immediately for cancelled sessions
    setTimeout(() => {
      this.cleanupSession(sessionId);
    }, 1000);
  }

  /**
   * Emit an event for a session
   */
  emitEvent(sessionId: string, event: any): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.emitter.emit('event', event);
  }

  /**
   * Subscribe to events for a session
   */
  subscribeToSession(sessionId: string): EventEmitter | undefined {
    const session = this.sessions.get(sessionId);
    return session?.emitter;
  }

  /**
   * Set cleanup function for a session
   */
  setSessionCleanup(sessionId: string, cleanup: () => void): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.cleanup = cleanup;
    }
  }

  /**
   * List all active sessions
   */
  getActiveSessions(): SessionStatus[] {
    return Array.from(this.sessions.values())
      .filter(session => session.status === 'running')
      .map(session => {
        const { emitter, cleanup, ...status } = session;
        return status;
      });
  }

  /**
   * Clean up a session
   */
  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Remove all listeners
    session.emitter.removeAllListeners();
    
    // Delete from sessions map
    this.sessions.delete(sessionId);
  }

  /**
   * Clean up old completed sessions
   */
  cleanupOldSessions(maxAgeMs: number = 60 * 60 * 1000): number {
    let cleaned = 0;
    const now = Date.now();

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.status !== 'running' && session.completedAt) {
        const age = now - session.completedAt.getTime();
        if (age > maxAgeMs) {
          this.cleanupSession(sessionId);
          cleaned++;
        }
      }
    }

    return cleaned;
  }
}

// Export singleton instance
export const sessionManager = SessionManager.getInstance();