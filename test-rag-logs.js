// Test Script um RAG Logs zu sehen
const { StepPlanner } = require('./howto-prompt/dist/planner/step-planner');
const { OpenAIProvider } = require('./howto-prompt/dist/providers/llm-provider');

async function testRAGLogs() {
  console.log('🧪 Testing RAG System Logs...\n');
  
  // Fake LLM Provider für Demo (ohne echte API Calls)
  const mockLLMProvider = {
    async planNextStepWithConfidence() {
      return {
        step: { type: 'click', label: 'Login Button' },
        confidence: 0.8,
        reasoning: 'Traditional planning result'
      };
    },
    async generateQuery() {
      return {
        intent: 'click',
        keywords: ['login', 'button'],
        k: 30
      };
    },
    async planWithEvidence() {
      return {
        step: { type: 'click', label: 'Login Button' },
        confidence: 0.9,
        reasoning: 'RAG planning with evidence'
      };
    }
  };
  
  console.log('1️⃣ Erstelle StepPlanner mit AKTIVIERTEM RAG...');
  
  // RAG ist jetzt standardmäßig aktiviert!
  const planner = new StepPlanner(mockLLMProvider, {}, {}, {
    baseUrl: 'https://example.com'
    // useRAGPlanning wird automatisch auf true gesetzt
  });
  
  console.log('\n2️⃣ Simuliere Planning Request...');
  
  const mockUIGraph = {
    url: 'https://example.com/login',
    timestamp: Date.now(),
    elements: [
      {
        tag: 'input',
        role: 'textbox',
        label: 'Username',
        accessibleName: 'Username',
        placeholder: 'Enter username',
        candidateSelectors: ['input[name="username"]'],
        visible: true,
        inViewport: true,
        clickable: false,
        contentEditable: true,
        stability: 'stable',
        isInActiveTab: true,
        sectionTitle: 'Login Form',
        formGroup: 'credentials'
      },
      {
        tag: 'input',
        role: 'textbox',
        label: 'Password',
        accessibleName: 'Password',
        placeholder: 'Enter password',
        candidateSelectors: ['input[name="password"]'],
        visible: true,
        inViewport: true,
        clickable: false,
        contentEditable: true,
        stability: 'stable',
        isInActiveTab: true,
        sectionTitle: 'Login Form',
        formGroup: 'credentials'
      },
      {
        tag: 'button',
        role: 'button',
        label: 'Login',
        accessibleName: 'Login',
        text: 'Login',
        candidateSelectors: ['button[type="submit"]'],
        visible: true,
        inViewport: true,
        clickable: true,
        contentEditable: false,
        stability: 'stable',
        isInActiveTab: true,
        sectionTitle: 'Login Form',
        formGroup: 'credentials'
      }
    ],
    landmarkStructure: ['Login Form', 'Footer'],
    pageTitle: 'Login Page'
  };

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
        { kind: 'field', label: 'Username', visible: true, hints: [], isEmpty: true, required: true },
        { kind: 'field', label: 'Password', visible: true, hints: [], isEmpty: true, required: true }
      ],
      buttons: [{ kind: 'button', label: 'Login', visible: true, hints: [] }],
      links: [],
      sections: ['Login Form'],
      forms: [],
      url: 'https://example.com/login',
      timestamp: Date.now()
    },
    stepHistory: [],
    goalProgress: 0,
    uiGraph: mockUIGraph
  };
  
  try {
    console.log('\n3️⃣ Führe Planning aus (sollte RAG verwenden)...');
    await planner.planOneStepWithConfidence(mockContext);
  } catch (error) {
    console.log('⚠️  Erwarteter Fehler (keine echten Embeddings):', error.message);
  }
  
  console.log('\n4️⃣ RAG Metriken abrufen...');
  const metrics = planner.getRAGMetrics();
  console.log('📊 RAG Status:', metrics);
  
  console.log('\n✅ Test abgeschlossen! Sie sollten oben RAG-Initialisierungs-Logs sehen.');
}

// Führe Test aus
testRAGLogs().catch(console.error);