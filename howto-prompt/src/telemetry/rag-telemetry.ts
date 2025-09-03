// Telemetry and Performance Tracking for RAG System

export interface RAGTelemetryEvent {
  timestamp: number;
  type: 'query_generation' | 'semantic_search' | 'evidence_retrieval' | 'planning_with_evidence' | 'fallback' | 'cache_hit' | 'cache_miss';
  data: any;
  latencyMs?: number;
  success: boolean;
  error?: string;
}

export interface RAGSessionMetrics {
  sessionId: string;
  startTime: number;
  endTime?: number;
  totalSteps: number;
  ragSteps: number;
  fallbackSteps: number;
  
  // Latency metrics
  averageQueryGenerationMs: number;
  averageSemanticSearchMs: number;
  averageEvidenceRetrievalMs: number;
  averagePlanningMs: number;
  
  // Quality metrics
  averageEvidenceItems: number;
  averageEvidenceScore: number;
  averageConfidence: number;
  
  // Efficiency metrics
  cacheHitRate: number;
  tokensSaved: number; // Estimated tokens saved vs full DOM
  
  // Error metrics
  queryGenerationErrors: number;
  searchErrors: number;
  planningErrors: number;
  fallbackRate: number;
}

export interface RAGPerformanceSnapshot {
  timestamp: number;
  url: string;
  ragEnabled: boolean;
  
  // Current step metrics
  step: {
    index: number;
    type: string;
    confidence: number;
    evidenceItems: number;
    maxEvidenceScore: number;
    queryRounds: number;
    totalLatencyMs: number;
  };
  
  // Cumulative session metrics
  session: {
    totalSteps: number;
    ragSteps: number;
    averageLatency: number;
    averageConfidence: number;
    cacheHitRate: number;
  };
  
  // System health
  system: {
    indexSize: number;
    cacheSize: number;
    memoryUsageMB: number;
  };
}

export class RAGTelemetryCollector {
  private events: RAGTelemetryEvent[] = [];
  private sessionMetrics: RAGSessionMetrics;
  private maxEvents: number = 1000;
  private currentStepIndex: number = 0;

  constructor(sessionId: string = `rag_${Date.now()}`) {
    this.sessionMetrics = {
      sessionId,
      startTime: Date.now(),
      totalSteps: 0,
      ragSteps: 0,
      fallbackSteps: 0,
      averageQueryGenerationMs: 0,
      averageSemanticSearchMs: 0,
      averageEvidenceRetrievalMs: 0,
      averagePlanningMs: 0,
      averageEvidenceItems: 0,
      averageEvidenceScore: 0,
      averageConfidence: 0,
      cacheHitRate: 0,
      tokensSaved: 0,
      queryGenerationErrors: 0,
      searchErrors: 0,
      planningErrors: 0,
      fallbackRate: 0
    };
  }

  // Record telemetry events
  recordEvent(event: Omit<RAGTelemetryEvent, 'timestamp'>): void {
    const fullEvent: RAGTelemetryEvent = {
      ...event,
      timestamp: Date.now()
    };

    this.events.push(fullEvent);
    
    // Cleanup old events to prevent memory leaks
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Update metrics based on event
    this.updateMetrics(fullEvent);
  }

  // Record query generation
  recordQueryGeneration(success: boolean, latencyMs: number, query?: any, error?: string): void {
    this.recordEvent({
      type: 'query_generation',
      data: { query, keywords: query?.keywords?.length || 0 },
      latencyMs,
      success,
      error
    });
  }

  // Record semantic search
  recordSemanticSearch(success: boolean, latencyMs: number, results?: any, error?: string): void {
    this.recordEvent({
      type: 'semantic_search',
      data: { 
        resultCount: results?.items?.length || 0,
        maxScore: results?.items?.[0]?.score || 0,
        searchLatencyMs: results?.searchLatencyMs || 0
      },
      latencyMs,
      success,
      error
    });
  }

  // Record evidence retrieval
  recordEvidenceRetrieval(success: boolean, latencyMs: number, evidence?: any, error?: string): void {
    this.recordEvent({
      type: 'evidence_retrieval',
      data: { 
        evidenceItems: evidence?.items?.length || 0,
        totalItems: evidence?.totalItems || 0,
        queryRounds: evidence?.queryRounds || 1,
        averageScore: evidence?.items?.length > 0 
          ? evidence.items.reduce((sum: number, item: any) => sum + item.score, 0) / evidence.items.length 
          : 0
      },
      latencyMs,
      success,
      error
    });
  }

  // Record planning with evidence
  recordPlanningWithEvidence(success: boolean, latencyMs: number, result?: any, error?: string): void {
    this.recordEvent({
      type: 'planning_with_evidence',
      data: { 
        confidence: result?.confidence || 0,
        stepType: result?.step?.type,
        matchesGoal: result?.matchesGoal,
        alternatives: result?.alternatives?.length || 0
      },
      latencyMs,
      success,
      error
    });
  }

  // Record fallback to traditional planning
  recordFallback(reason: string, latencyMs: number): void {
    this.recordEvent({
      type: 'fallback',
      data: { reason },
      latencyMs,
      success: true
    });
  }

  // Record cache operations
  recordCacheHit(query: any): void {
    this.recordEvent({
      type: 'cache_hit',
      data: { queryType: query?.intent, keywords: query?.keywords?.length || 0 },
      success: true
    });
  }

  recordCacheMiss(query: any): void {
    this.recordEvent({
      type: 'cache_miss',
      data: { queryType: query?.intent, keywords: query?.keywords?.length || 0 },
      success: true
    });
  }

  // Update session metrics based on events
  private updateMetrics(event: RAGTelemetryEvent): void {
    switch (event.type) {
      case 'query_generation':
        if (event.success && event.latencyMs) {
          this.updateAverage('averageQueryGenerationMs', event.latencyMs);
        } else if (!event.success) {
          this.sessionMetrics.queryGenerationErrors++;
        }
        break;

      case 'semantic_search':
        if (event.success && event.latencyMs) {
          this.updateAverage('averageSemanticSearchMs', event.latencyMs);
        } else if (!event.success) {
          this.sessionMetrics.searchErrors++;
        }
        break;

      case 'evidence_retrieval':
        if (event.success) {
          this.sessionMetrics.ragSteps++;
          if (event.latencyMs) {
            this.updateAverage('averageEvidenceRetrievalMs', event.latencyMs);
          }
          if (event.data.evidenceItems) {
            this.updateAverage('averageEvidenceItems', event.data.evidenceItems);
          }
          if (event.data.averageScore) {
            this.updateAverage('averageEvidenceScore', event.data.averageScore);
          }
        }
        break;

      case 'planning_with_evidence':
        if (event.success && event.latencyMs) {
          this.updateAverage('averagePlanningMs', event.latencyMs);
          if (event.data.confidence) {
            this.updateAverage('averageConfidence', event.data.confidence);
          }
        } else if (!event.success) {
          this.sessionMetrics.planningErrors++;
        }
        break;

      case 'fallback':
        this.sessionMetrics.fallbackSteps++;
        break;

      case 'cache_hit':
      case 'cache_miss':
        this.updateCacheHitRate(event.type === 'cache_hit');
        break;
    }

    // Update total steps
    if (['planning_with_evidence', 'fallback'].includes(event.type)) {
      this.sessionMetrics.totalSteps++;
      this.currentStepIndex++;
    }

    // Update fallback rate
    if (this.sessionMetrics.totalSteps > 0) {
      this.sessionMetrics.fallbackRate = this.sessionMetrics.fallbackSteps / this.sessionMetrics.totalSteps;
    }
  }

  private updateAverage(metric: keyof RAGSessionMetrics, newValue: number): void {
    const currentValue = this.sessionMetrics[metric] as number;
    const count = this.getMetricCount(metric);
    (this.sessionMetrics[metric] as any) = ((currentValue * (count - 1)) + newValue) / count;
  }

  private updateCacheHitRate(isHit: boolean): void {
    const cacheEvents = this.events.filter(e => e.type === 'cache_hit' || e.type === 'cache_miss');
    const hits = cacheEvents.filter(e => e.type === 'cache_hit').length;
    this.sessionMetrics.cacheHitRate = cacheEvents.length > 0 ? hits / cacheEvents.length : 0;
  }

  private getMetricCount(metric: string): number {
    // Rough approximation based on event types
    switch (metric) {
      case 'averageQueryGenerationMs':
        return this.events.filter(e => e.type === 'query_generation' && e.success).length;
      case 'averageSemanticSearchMs':
        return this.events.filter(e => e.type === 'semantic_search' && e.success).length;
      case 'averageEvidenceRetrievalMs':
      case 'averageEvidenceItems':
      case 'averageEvidenceScore':
        return this.events.filter(e => e.type === 'evidence_retrieval' && e.success).length;
      case 'averagePlanningMs':
      case 'averageConfidence':
        return this.events.filter(e => e.type === 'planning_with_evidence' && e.success).length;
      default:
        return Math.max(1, this.sessionMetrics.totalSteps);
    }
  }

  // Get current session metrics
  getSessionMetrics(): RAGSessionMetrics {
    return { ...this.sessionMetrics };
  }

  // Get performance snapshot
  getPerformanceSnapshot(url: string, ragEnabled: boolean, systemStats?: any): RAGPerformanceSnapshot {
    const recentEvents = this.events.slice(-10); // Last 10 events
    const lastStep = recentEvents.find(e => e.type === 'evidence_retrieval' || e.type === 'fallback');
    
    return {
      timestamp: Date.now(),
      url,
      ragEnabled,
      step: {
        index: this.currentStepIndex,
        type: lastStep?.data?.stepType || 'unknown',
        confidence: lastStep?.data?.confidence || 0,
        evidenceItems: lastStep?.data?.evidenceItems || 0,
        maxEvidenceScore: lastStep?.data?.averageScore || 0,
        queryRounds: lastStep?.data?.queryRounds || 1,
        totalLatencyMs: lastStep?.latencyMs || 0
      },
      session: {
        totalSteps: this.sessionMetrics.totalSteps,
        ragSteps: this.sessionMetrics.ragSteps,
        averageLatency: this.sessionMetrics.averageEvidenceRetrievalMs,
        averageConfidence: this.sessionMetrics.averageConfidence,
        cacheHitRate: this.sessionMetrics.cacheHitRate
      },
      system: {
        indexSize: systemStats?.indexSize || 0,
        cacheSize: systemStats?.cacheSize || 0,
        memoryUsageMB: systemStats?.memoryUsageMB || 0
      }
    };
  }

  // Get recent events
  getRecentEvents(limit: number = 50): RAGTelemetryEvent[] {
    return this.events.slice(-limit);
  }

  // Get events by type
  getEventsByType(type: RAGTelemetryEvent['type']): RAGTelemetryEvent[] {
    return this.events.filter(e => e.type === type);
  }

  // Calculate token savings (estimation)
  estimateTokenSavings(fullDOMTokens: number, evidenceTokens: number): number {
    const saved = Math.max(0, fullDOMTokens - evidenceTokens);
    this.sessionMetrics.tokensSaved += saved;
    return saved;
  }

  // Generate performance report
  generateReport(): {
    summary: any;
    breakdown: any;
    recommendations: string[];
  } {
    const metrics = this.sessionMetrics;
    const totalEvents = this.events.length;
    const errorRate = totalEvents > 0 ? 
      (metrics.queryGenerationErrors + metrics.searchErrors + metrics.planningErrors) / totalEvents : 0;

    const summary = {
      sessionId: metrics.sessionId,
      duration: Date.now() - metrics.startTime,
      totalSteps: metrics.totalSteps,
      ragAdoptionRate: metrics.totalSteps > 0 ? metrics.ragSteps / metrics.totalSteps : 0,
      fallbackRate: metrics.fallbackRate,
      averageLatency: metrics.averageEvidenceRetrievalMs,
      averageConfidence: metrics.averageConfidence,
      errorRate,
      cacheHitRate: metrics.cacheHitRate,
      tokensSaved: metrics.tokensSaved
    };

    const breakdown = {
      latencies: {
        queryGeneration: metrics.averageQueryGenerationMs,
        semanticSearch: metrics.averageSemanticSearchMs,
        evidenceRetrieval: metrics.averageEvidenceRetrievalMs,
        planning: metrics.averagePlanningMs
      },
      quality: {
        averageEvidenceItems: metrics.averageEvidenceItems,
        averageEvidenceScore: metrics.averageEvidenceScore,
        averageConfidence: metrics.averageConfidence
      },
      errors: {
        queryGeneration: metrics.queryGenerationErrors,
        search: metrics.searchErrors,
        planning: metrics.planningErrors
      }
    };

    const recommendations: string[] = [];

    // Performance recommendations
    if (metrics.averageEvidenceRetrievalMs > 3000) {
      recommendations.push('Consider reducing evidenceK or enabling more aggressive caching');
    }
    if (metrics.cacheHitRate < 0.3) {
      recommendations.push('Cache hit rate is low, consider adjusting query generation strategy');
    }
    if (metrics.fallbackRate > 0.3) {
      recommendations.push('High fallback rate detected, review evidence quality thresholds');
    }
    if (metrics.averageConfidence < 0.6) {
      recommendations.push('Low average confidence, consider improving query generation or evidence scoring');
    }
    if (errorRate > 0.1) {
      recommendations.push('Error rate is elevated, review system logs for issues');
    }
    if (metrics.averageEvidenceItems < 5) {
      recommendations.push('Low evidence items count, consider increasing evidenceK parameter');
    }

    return { summary, breakdown, recommendations };
  }

  // End session
  endSession(): void {
    this.sessionMetrics.endTime = Date.now();
  }

  // Clear telemetry data
  clear(): void {
    this.events = [];
    this.currentStepIndex = 0;
  }
}

// Global telemetry instance
let globalTelemetry: RAGTelemetryCollector | null = null;

export function getRAGTelemetry(): RAGTelemetryCollector {
  if (!globalTelemetry) {
    globalTelemetry = new RAGTelemetryCollector();
  }
  return globalTelemetry;
}

export function setRAGTelemetry(telemetry: RAGTelemetryCollector): void {
  globalTelemetry = telemetry;
}

export function createNewSession(sessionId?: string): RAGTelemetryCollector {
  globalTelemetry = new RAGTelemetryCollector(sessionId);
  return globalTelemetry;
}