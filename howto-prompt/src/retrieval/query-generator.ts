import { QuerySpec, getLLMManager } from 'howto-core';

export interface QueryGenerationContext {
  goal?: string;
  subgoal?: any;
  currentUrl: string;
  prompt?: string;
  intent?: 'click' | 'type' | 'navigate';
  previousResults?: any;
  availableElements?: string[]; // Available UI element labels from current page
}

export class LLMQueryGenerator {
  constructor() {}

  async generateQuery(context: QueryGenerationContext, retryCount: number = 0): Promise<QuerySpec> {
    const { goal, subgoal, currentUrl, prompt, intent, previousResults, availableElements } = context;
    
    // Determine the main search target
    const searchTarget = subgoal?.short || goal || prompt || 'general interaction';
    const searchDetail = subgoal?.detail || goal || prompt || '';
    
    console.log(`[QueryGenerator] Generating query for: "${searchTarget}"`);
    console.log(`[QueryGenerator] Detail: "${searchDetail}"`);
    console.log(`[QueryGenerator] URL: ${currentUrl}`);
    console.log(`[QueryGenerator] Available elements: ${availableElements?.join(', ') || 'Not provided'}`);

    const promptText = `ZIEL: ${searchTarget}
DETAIL: ${searchDetail}
CURRENT_URL: ${currentUrl}
${intent ? `INTENT: ${intent}` : ''}
${availableElements && availableElements.length > 0 ? `VERFÜGBARE_UI_ELEMENTE: ${availableElements.join(', ')}` : ''}
${previousResults ? `PREVIOUS_RESULTS: ${JSON.stringify(previousResults, null, 2)}` : ''}

Generiere eine optimale RAG-Query für die semantische Suche nach UI-Elementen, die für dieses Ziel relevant sind.

BEISPIELE FÜR GUTE QUERIES:
1. Login/Anmeldung:
   {"intent": "type", "keywords": ["username", "password", "login", "email", "input"], "filters": {"role": ["textbox", "input", "button"]}, "constraints": {"mustBeVisible": true}, "k": 12, "diversity": false}

2. Regression Test Button:
   {"intent": "click", "keywords": ["regression", "test", "testing", "automated", "cypress"], "filters": {"role": ["button"]}, "constraints": {"mustBeVisible": true}, "k": 10, "diversity": false}

3. Formular ausfüllen:
   {"intent": "type", "keywords": ["input", "field", "form", "enter", "text"], "filters": {"role": ["textbox", "input", "textarea"]}, "constraints": {"mustBeVisible": true}, "k": 10, "diversity": false}

4. Button klicken:
   {"intent": "click", "keywords": ["submit", "save", "create", "button", "click"], "filters": {"role": ["button"]}, "constraints": {"mustBeVisible": true}, "k": 8, "diversity": false}

5. Dropdown/Select:
   {"intent": "click", "keywords": ["select", "dropdown", "choose", "option"], "filters": {"role": ["combobox", "listbox", "button"]}, "constraints": {"mustBeVisible": true}, "k": 10, "diversity": false}

WICHTIGE REGELN:
- ERSTE PRIORITÄT: Nutze die VERFÜGBARE_UI_ELEMENTE Liste! Generiere Keywords basierend auf tatsächlich verfügbaren Elementen
- Falls verfügbare Elemente gegeben sind: priorisiere exakte Matches mit den verfügbaren Element-Labels
- Verwende englische Keywords für bessere UI-Element-Matching
- Wähle passende Roles basierend auf der gewünschten Interaktion
- intent sollte "click", "type" oder "navigate" sein  
- k zwischen 8-20 je nach Komplexität
- diversity: true für Navigation/Suche, false für spezifische Actions
- Antworte NUR mit einem validen JSON-Objekt, nichts anderes

BEISPIEL MIT VERFÜGBAREN ELEMENTEN:
Ziel: "erstelle regressiontest", Verfügbare Elemente: ["Regression", "Login", "Dashboard"]
→ keywords: ["regression"] (exakter Match mit verfügbarem Element)

BEISPIEL OHNE VERFÜGBARE ELEMENTE:
Ziel: "erstelle regressiontest", Keine verfügbaren Elemente
→ keywords: ["test", "regression", "create"] (generische Suche)

JSON-Antwort:`;

    const maxRetries = 3;
    
    try {
      const llmManager = getLLMManager();
      const response = await llmManager.execute('rag_query_generation', {
        prompt: promptText,
        systemPrompt: `Du bist ein Experte für semantische Suche in Web-UIs. Generiere optimale RAG-Queries für UI-Element-Suche. 
            WICHTIG: Antworte nur mit validem JSON, keine Erklärungen oder Markdown.${retryCount > 0 ? ' (Dies ist Retry ' + retryCount + ', bitte achte auf korrektes JSON Format!)' : ''}`,
        responseFormat: 'json'
      });

      const content = response.content?.trim();
      if (!content) {
        throw new Error('Empty response from LLM Manager');
      }

      console.log(`[QueryGenerator] Raw LLM response: ${content}`);

      // Try to parse JSON, handling potential markdown wrapping
      let jsonContent = content;
      if (content.startsWith('```json')) {
        jsonContent = content.replace(/```json\s*/, '').replace(/\s*```$/, '');
      } else if (content.startsWith('```')) {
        jsonContent = content.replace(/```\s*/, '').replace(/\s*```$/, '');
      }

      try {
        const query = JSON.parse(jsonContent) as QuerySpec;
        
        // Validate and sanitize the query
        const sanitizedQuery = this.validateAndSanitizeQuery(query);
        console.log(`[QueryGenerator] Generated valid query: ${JSON.stringify(sanitizedQuery)}`);
        
        return sanitizedQuery;
      } catch (parseError) {
        console.error(`[QueryGenerator] JSON parse error:`, parseError);
        console.error(`[QueryGenerator] Attempted to parse: ${jsonContent}`);
        
        if (retryCount < maxRetries) {
          console.log(`[QueryGenerator] Retrying query generation (attempt ${retryCount + 1}/${maxRetries})`);
          return this.generateQuery(context, retryCount + 1);
        }
        
        throw new Error(`Failed to parse JSON response after ${maxRetries} retries: ${parseError}`);
      }
    } catch (error) {
      console.error('[QueryGenerator] Query generation failed:', error);
      
      if (retryCount < maxRetries) {
        console.log(`[QueryGenerator] Retrying due to error (attempt ${retryCount + 1}/${maxRetries})`);
        return this.generateQuery(context, retryCount + 1);
      }
      
      // Fallback to a basic query
      console.log('[QueryGenerator] Using fallback query due to repeated failures');
      return this.createFallbackQuery(context);
    }
  }

  private validateAndSanitizeQuery(query: any): QuerySpec {
    // Ensure required fields
    const sanitized: QuerySpec = {
      intent: query.intent || 'click',
      keywords: Array.isArray(query.keywords) ? query.keywords : ['button', 'click'],
      k: Math.max(5, Math.min(30, query.k || 10)), // Clamp between 5-30
      diversity: Boolean(query.diversity),
      filters: query.filters || {},
      constraints: query.constraints || {}
    };

    // Validate intent
    if (!['click', 'type', 'navigate'].includes(sanitized.intent)) {
      sanitized.intent = 'click';
    }

    // Ensure keywords is array of strings
    if (!Array.isArray(sanitized.keywords) || sanitized.keywords.length === 0) {
      sanitized.keywords = ['button', 'click'];
    }

    // Ensure constraints.mustBeVisible exists
    if (!sanitized.constraints) {
      sanitized.constraints = {};
    }
    if (!sanitized.constraints.mustBeVisible) {
      sanitized.constraints.mustBeVisible = true;
    }

    return sanitized;
  }

  private createFallbackQuery(context: QueryGenerationContext): QuerySpec {
    const { intent, subgoal, goal, prompt } = context;
    
    // Try to infer intent from the goal/prompt
    let inferredIntent: 'click' | 'type' | 'navigate' = intent || 'click';
    let keywords = ['button', 'click'];
    let roles = ['button'];

    const target = (subgoal?.short || goal || prompt || '').toLowerCase();
    
    if (target.includes('login') || target.includes('anmeld') || target.includes('password') || target.includes('username')) {
      inferredIntent = 'type';
      keywords = ['username', 'password', 'login', 'email', 'input'];
      roles = ['textbox', 'input', 'button'];
    } else if (target.includes('test') || target.includes('regression') || target.includes('qa')) {
      inferredIntent = 'click';  // Changed from 'navigate' to 'click' for test actions
      keywords = ['regression', 'test', 'testing', 'qa', 'cypress', 'automated'];  // Prioritize 'regression' first
      roles = ['button', 'link', 'tab', 'menuitem'];
    } else if (target.includes('type') || target.includes('input') || target.includes('field')) {
      inferredIntent = 'type';
      keywords = ['input', 'field', 'text'];
      roles = ['textbox', 'input', 'textarea'];
    }

    return {
      intent: inferredIntent,
      keywords,
      filters: { role: roles },
      constraints: { mustBeVisible: true },
      k: 12,
      diversity: inferredIntent === 'navigate'
    };
  }
}