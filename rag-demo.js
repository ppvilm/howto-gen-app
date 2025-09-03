// RAG System Demo - Zeigt wie das neue System aktiviert wird

const { StepPlanner, OpenAIProvider } = require('./howto-prompt/dist');
const { SemanticIndexManager } = require('./howto-core/dist');

async function demoRAGSystem() {
  console.log('🚀 RAG System Demo gestartet');
  
  // 1. LLM Provider mit RAG-Unterstützung erstellen
  const llmProvider = new OpenAIProvider(process.env.OPENAI_API_KEY || 'demo-key');
  
  // 2. RAG-System AKTIVIEREN mit Feature-Flag
  const ragOptions = {
    baseUrl: 'https://example.com',
    useRAGPlanning: true,  // ← WICHTIG: Das aktiviert RAG!
    ragConfig: {
      maxQueryRounds: 2,
      evidenceK: 30,
      diversityReranking: true,
      timeoutMs: 5000
    }
  };
  
  // 3. StepPlanner mit RAG erstellen
  const planner = new StepPlanner(llmProvider, {}, {}, ragOptions);
  
  console.log('✅ RAG System initialisiert');
  
  // 4. Mock Planning Context für Demo
  const mockContext = {
    prompt: 'Klicke auf den Login Button',
    currentUrl: 'https://example.com/login',
    visitedUrls: new Set(),
    memory: {
      elements: new Map(),
      synonyms: new Map(),
      screenFingerprints: new Set(),
      navigationPaths: new Map()
    },
    inventory: {
      fields: [
        { kind: 'field', label: 'Username', visible: true, hints: [] },
        { kind: 'field', label: 'Password', visible: true, hints: [] }
      ],
      buttons: [
        { kind: 'button', label: 'Login', visible: true, isPrimary: true, hints: [] },
        { kind: 'button', label: 'Cancel', visible: true, hints: [] }
      ],
      links: [],
      sections: ['Authentication', 'Header'],
      forms: ['loginForm'],
      url: 'https://example.com/login',
      timestamp: Date.now()
    },
    stepHistory: [],
    goalProgress: 0
  };
  
  try {
    console.log('🔍 Planning mit RAG...');
    
    // Das wird jetzt RAG verwenden!
    const result = await planner.planOneStepWithConfidence(mockContext);
    
    console.log('📊 RAG Planning Ergebnis:');
    console.log('- Step:', result.step.type, result.step.label);
    console.log('- Confidence:', result.confidence);
    
    // RAG Metriken anzeigen
    const metrics = planner.getRAGMetrics();
    console.log('📈 RAG Metriken:');
    console.log('- Enabled:', metrics.enabled);
    console.log('- Total Retrievals:', metrics.totalRetrievals);
    console.log('- Average Latency:', metrics.averageLatency + 'ms');
    console.log('- Cache Hit Rate:', Math.round(metrics.cacheHitRate * 100) + '%');
    
  } catch (error) {
    console.log('⚠️  RAG Demo Fehler (erwartet ohne echte API Keys):', error.message);
    console.log('💡 Setzen Sie OPENAI_API_KEY für vollständige Demo');
  }
  
  console.log('🏁 RAG Demo beendet');
}

// Direkter Aufruf für Demo
if (require.main === module) {
  demoRAGSystem().catch(console.error);
}

module.exports = { demoRAGSystem };