import { Page } from 'playwright';
import { getLLMManager } from './llm-manager';
import { DOMSnapshot } from './dom-snapshot';
import fs from 'fs/promises';
import path from 'path';

export interface SelectorResult {
  selector: string;
  confidence: number;
  fallbacks: string[];
}

export class AISelectorResolver {
  private maxRetries: number = 3;

  constructor() {
    // Only use LLM Manager - no direct API configuration needed
  }

  async findSelector(
    page: Page,
    label: string,
    elementType: 'input' | 'button' | 'any',
    stepNote?: string,
    failedSelectors?: string[]
  ): Promise<SelectorResult> {
    const startTime = Date.now();
    try {
      console.log(`AI selector resolution: Looking for "${label}" (type: ${elementType})`);
      
      // Debug: Check page state before DOM snapshot
      const currentUrl = page.url();
      const title = await page.title();
      console.log(`Current page URL: ${currentUrl}`);
      console.log(`Page title: "${title}"`);
      // Build prompt from CLEANED DOM only (no UI graph/inventory)
      const rawHtml = await page.content();
      // Apply shared cleaning: strip svg/style attributes and extract <body>
      const cleanedBody = DOMSnapshot.cleanHTMLForLLM(rawHtml, {
        url: currentUrl,
        title: title,
        label: label,
        elementType: elementType
      });
      
      const prompt = this.createPrompt(label, elementType, cleanedBody, stepNote, failedSelectors);

      // Save prompt for debugging
      await this.savePromptDebugFile(currentUrl, title, prompt, label, elementType);

      // Try with retry mechanism
      const content = await this.callLLMWithRetry(prompt);

      console.log(`🤖 [AI Selector] Raw LLM Response:`);
      console.log(content);
      console.log(`--- End Raw Response ---`);

      // Parse the response
      const result = this.parseAIResponse(content);
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.log(`⏱️ [AI Selector] Response Time: ${duration}ms`);
      
      return result;

    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      console.warn('AI selector resolution failed:', error);
      console.log(`⏱️ [AI Selector] Response Time (Failed): ${duration}ms`);
      // Return fallback
      return {
        selector: '',
        confidence: 0,
        fallbacks: []
      };
    }
  }

  private async callLLMWithRetry(prompt: string, retryAttempt: number = 1): Promise<string> {
    try {
      // Use central LLM Manager
      const llmManager = getLLMManager();
      const systemMessage = retryAttempt > 1
        ? "You are an expert at finding CSS selectors and XPath expressions for web elements. You analyze DOM structures and provide accurate selectors for web automation. Your previous response was invalid - ensure strict JSON format."
        : "You are an expert at finding CSS selectors and XPath expressions for web elements. You analyze DOM structures and provide accurate selectors for web automation.";

      const response = await llmManager.execute('selector_resolution', {
        prompt,
        systemPrompt: systemMessage
      });

      // Log full response details for debugging
      console.log(`🔍 [AI Selector] LLM Response Details:`, {
        model: response.model,
        provider: response.provider,
        tokens: response.tokens
      });

      const content = response.content;
      if (!content) {
        throw new Error('No response from LLM Manager');
      }

      return content;

    } catch (error) {
      console.warn(`LLM call failed on attempt ${retryAttempt}:`, error);
      
      if (retryAttempt < this.maxRetries) {
        console.log(`Retrying... (attempt ${retryAttempt + 1}/${this.maxRetries})`);
        await this.sleep(1000 * retryAttempt); // Progressive delay
        return this.callLLMWithRetry(prompt, retryAttempt + 1);
      }
      
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }


  // NOTE: UI graph filtering is no longer used in DOM+LLM mode
  private filterRelevantElements(elements: any[], label: string, elementType: string): any[] {
    const labelLower = label.toLowerCase();
    
    return elements.filter(element => {
      // Filter by element type
      if (elementType === 'input' && !['input', 'textarea'].includes(element.tag)) {
        return false;
      }
      if (elementType === 'button' && !['button', 'a'].includes(element.tag) && !element.clickable) {
        return false;
      }
      
      // Must be visible and enabled
      if (!element.visible || !element.enabled) {
        return false;
      }
      
      // Check text matches
      const hasMatchingText = 
        element.text?.toLowerCase().includes(labelLower) ||
        element.accessibleName?.toLowerCase().includes(labelLower) ||
        element.placeholder?.toLowerCase().includes(labelLower) ||
        element.label?.toLowerCase().includes(labelLower) ||
        element.title?.toLowerCase().includes(labelLower) ||
        element.nearbyText.some((text: string) => text.toLowerCase().includes(labelLower));
        
      // Check attribute matches
      const hasMatchingAttribute = 
        element.id?.toLowerCase().includes(labelLower) ||
        element.name?.toLowerCase().includes(labelLower) ||
        element.dataTestId?.toLowerCase().includes(labelLower) ||
        element.dataUnique?.toLowerCase().includes(labelLower);
      
      return hasMatchingText || hasMatchingAttribute;
    });
  }

  private createUIGraphPrompt(label: string, elementType: string, elements: any[], stepNote?: string, failedSelectors?: string[]): string {
    if (elementType === 'input') {
      return this.createUIGraphInputPrompt(label, elements, stepNote, failedSelectors);
    } else if (elementType === 'button') {
      return this.createUIGraphButtonPrompt(label, elements, stepNote, failedSelectors);
    } else {
      return this.createUIGraphGeneralPrompt(label, elements, stepNote, failedSelectors);
    }
  }

  private createPrompt(label: string, elementType: string, htmlContent: string, stepNote?: string, failedSelectors?: string[]): string {
    if (elementType === 'input') {
      return this.createInputPrompt(label, htmlContent, stepNote, failedSelectors);
    } else if (elementType === 'button') {
      return this.createButtonPrompt(label, htmlContent, stepNote, failedSelectors);
    } else {
      return this.createGeneralPrompt(label, htmlContent, stepNote, failedSelectors);
    }
  }

  private createInputPrompt(label: string, htmlContent: string, stepNote?: string, failedSelectors?: string[]): string {
    const noteContext = stepNote ? `\n\nSTEP CONTEXT: "${stepNote}"\nUse this context to choose the most appropriate element if multiple candidates exist.` : '';
    const failedContext = failedSelectors && failedSelectors.length > 0 
      ? `\n\nFAILED SELECTORS: These selectors were tried but FAILED to work:\n${failedSelectors.map(s => `- ${s}`).join('\n')}\nDO NOT return any of these failed selectors. Find DIFFERENT working alternatives.`
      : '';
    
    return `You are a CSS selector expert. Find a selector for an input field related to "${label}".
${noteContext}${failedContext}

HTML CONTENT:
${htmlContent}

TASK:
Find the best CSS selector for an input field contextually related to "${label}". Prioritize in this order:
1. STABLE SEMANTIC SELECTORS: data-testid, data-*, id attributes
2. FORM STRUCTURE: input[name="..."], form-specific attributes
3. CONTEXTUAL SELECTORS: Find inputs near labels/text containing "${label}"
4. TYPE-SPECIFIC: input[type="..."] combined with structural selectors

AVOID LABEL-BASED SELECTORS:
- DO NOT create selectors like [placeholder="${label}"] or [aria-label="${label}"]
- DO NOT rely on text content matching for the selector itself
- Instead, use the label to identify the CONTEXT where the input exists

IMPORTANT RULES:
- NEVER use text content or label values directly in selectors
- DO NOT use JSS selectors (generated CSS class names like css-abc123)
- DO NOT use :contains() pseudo-class - it's NOT valid CSS and will fail
- DO NOT use :has() with text content - use attribute selectors instead
- Prefer data-testid, id, name attributes over classes
- Use structural selectors (nth-child, form > input) when semantic attributes aren't available
- ONLY use standard CSS selectors that work in querySelectorAll()
- The selector MUST exist in the provided HTML DOM

FORBIDDEN SELECTORS (WILL CAUSE ERRORS):
- div:contains("text") ❌ (not valid CSS)
- li:has(div:contains("text")) ❌ (not valid CSS)
- [text*="content"] ❌ (not valid CSS)
- :contains() pseudo-selectors ❌ (not valid CSS)
Use instead: [data-testid="..."], #id, .class, tag[attribute="value"]
For text-based matching, use: [aria-label*="text"], [title*="text"], or attribute selectors

YOU MUST RESPOND WITH ONLY THIS JSON FORMAT. NO HTML, NO TEXT, NO EXPLANATIONS:
{
  "selector": "your-css-selector-here",
  "confidence": 0.8,
  "fallbacks": ["[data-testid='alternative']", "#alternative-id"]
}

START YOUR RESPONSE WITH { AND END WITH }. NOTHING ELSE.`;
  }

  private createButtonPrompt(label: string, htmlContent: string, stepNote?: string, failedSelectors?: string[]): string {
    const noteContext = stepNote ? `\n\nSTEP CONTEXT: "${stepNote}"\nUse this context to choose the most appropriate element if multiple candidates exist.` : '';
    const failedContext = failedSelectors && failedSelectors.length > 0 
      ? `\n\nFAILED SELECTORS: These selectors were tried but FAILED to work:\n${failedSelectors.map(s => `- ${s}`).join('\n')}\nDO NOT return any of these failed selectors. Find DIFFERENT working alternatives.`
      : '';
    
    return `You are a CSS selector expert. Find a selector for a clickable element related to "${label}".
${noteContext}${failedContext}

HTML CONTENT:
${htmlContent}

TASK:
Find the best CSS selector for a clickable element contextually related to "${label}". Prioritize in this order:
1. STABLE SEMANTIC SELECTORS: data-testid, data-*, id attributes
2. BUTTON STRUCTURE: button[type="..."], role-based attributes
3. CONTEXTUAL SELECTORS: Find clickable elements near text containing "${label}"
4. STRUCTURAL SELECTORS: nth-child, descendant selectors based on DOM structure

AVOID LABEL-BASED SELECTORS:
- DO NOT create selectors based on button text content like button:contains("${label}")
- DO NOT use text matching in selectors directly
- Instead, use the label to identify the CONTEXT where the clickable element exists

IMPORTANT RULES:
- NEVER use text content or label values directly in selectors
- DO NOT use JSS selectors (generated CSS class names like css-abc123)
- DO NOT use :contains() pseudo-class - it's NOT valid CSS and will fail
- DO NOT use :has() with text content - use attribute selectors instead
- Prefer data-testid, id, role attributes over classes
- Use structural selectors when semantic attributes aren't available
- ONLY use standard CSS selectors that work in querySelectorAll()
- The selector MUST exist in the provided HTML DOM

FORBIDDEN SELECTORS (WILL CAUSE ERRORS):
- div:contains("text") ❌ (not valid CSS)
- button:has(span:contains("text")) ❌ (not valid CSS)
- [text*="content"] ❌ (not valid CSS)
- :contains() pseudo-selectors ❌ (not valid CSS)
Use instead: [data-testid="..."], #id, .class, button[type="submit"]
For text-based matching, use: [aria-label*="text"], [title*="text"], or attribute selectors

YOU MUST RESPOND WITH ONLY THIS JSON FORMAT. NO HTML, NO TEXT, NO EXPLANATIONS:
{
  "selector": "your-css-selector-here",
  "confidence": 0.8,
  "fallbacks": ["[data-testid='alternative']", "#alternative-id"]
}

START YOUR RESPONSE WITH { AND END WITH }. NOTHING ELSE.`;
  }

  private createUIGraphInputPrompt(label: string, elements: any[], stepNote?: string, failedSelectors?: string[]): string {
    const noteContext = stepNote ? `\n\nSTEP CONTEXT: "${stepNote}"\nUse this context to choose the most appropriate element if multiple candidates exist.` : '';
    const failedContext = failedSelectors && failedSelectors.length > 0 
      ? `\n\nFAILED SELECTORS: These selectors were tried but FAILED to work:\n${failedSelectors.map(s => `- ${s}`).join('\n')}\nDO NOT return any of these failed selectors. Find DIFFERENT working alternatives.`
      : '';
    
    const elementsData = elements.map((el: any, index: number) => {
      // Filter out JSS classes for cleaner output
      const cleanClasses = el.classes.filter((cls: string) => !/^jss\d+$/.test(cls));
      
      return `ELEMENT ${index + 1}:
- Tag: ${el.tag}
- Text: ${el.text || 'N/A'}
- Placeholder: ${el.placeholder || 'N/A'}
- Accessible Name: ${el.accessibleName || 'N/A'}
- ID: ${el.id || 'N/A'}
- Classes: [${cleanClasses.join(', ')}]
- Data-TestId: ${el.dataTestId || 'N/A'}
- Data-Unique: ${el.dataUnique || 'N/A'}
- Name: ${el.name || 'N/A'}
- Available Selectors: [${el.candidateSelectors.filter((s: string) => !this.containsJSSClasses(s)).join(', ')}]
- Stability: ${el.stability}
- Nearby Text: [${el.nearbyText.slice(0, 3).join(', ')}]`;
    }).join('\n\n');
    
    return `You are a CSS selector expert. Find a selector for the input field "${label}" from the following UI elements.
${noteContext}${failedContext}

AVAILABLE ELEMENTS:
${elementsData}

TASK:
Choose the best element and selector for typing into input field "${label}". Consider:
- Exact text/placeholder/name matches
- Stability of selectors (high > medium > low)
- Semantic attributes (data-*, id, name) over classes
- Step context for disambiguation

IMPORTANT RULES:
- ONLY use selectors from the "Available Selectors" list above
- Prefer data-* attributes and IDs over class names
- Choose selectors with highest stability when possible
- The selector MUST be from the provided candidates
- DO NOT return any failed selectors listed above

YOU MUST RESPOND WITH ONLY THIS JSON FORMAT:
{
  "selector": "chosen-selector-from-candidates",
  "confidence": 0.8,
  "fallbacks": ["other-candidate-selectors"]
}

START YOUR RESPONSE WITH { AND END WITH }. NOTHING ELSE.`;
  }

  private createUIGraphButtonPrompt(label: string, elements: any[], stepNote?: string, failedSelectors?: string[]): string {
    const noteContext = stepNote ? `\n\nSTEP CONTEXT: "${stepNote}"\nUse this context to choose the most appropriate element if multiple candidates exist.` : '';
    const failedContext = failedSelectors && failedSelectors.length > 0 
      ? `\n\nFAILED SELECTORS: These selectors were tried but FAILED to work:\n${failedSelectors.map(s => `- ${s}`).join('\n')}\nDO NOT return any failed selectors. Find DIFFERENT working alternatives.`
      : '';
    
    const elementsData = elements.map((el: any, index: number) => {
      // Filter out JSS classes for cleaner output
      const cleanClasses = el.classes.filter((cls: string) => !/^jss\d+$/.test(cls));
      
      return `ELEMENT ${index + 1}:
- Tag: ${el.tag}
- Text: ${el.text || 'N/A'}
- Accessible Name: ${el.accessibleName || 'N/A'}
- ID: ${el.id || 'N/A'}
- Classes: [${cleanClasses.join(', ')}]
- Data-TestId: ${el.dataTestId || 'N/A'}
- Data-Unique: ${el.dataUnique || 'N/A'}
- HREF: ${el.href || 'N/A'}
- Is Primary: ${el.isPrimary}
- Is Submit: ${el.isSubmit}
- Available Selectors: [${el.candidateSelectors.filter((s: string) => !this.containsJSSClasses(s)).join(', ')}]
- Stability: ${el.stability}
- Nearby Text: [${el.nearbyText.slice(0, 3).join(', ')}]`;
    }).join('\n\n');
    
    return `You are a CSS selector expert. Find a selector for the clickable element "${label}" from the following UI elements.
${noteContext}${failedContext}

AVAILABLE ELEMENTS:
${elementsData}

TASK:
Choose the best element and selector for clicking on element "${label}". Consider:
- Exact text matches
- Button type (primary/submit buttons often preferred)
- Stability of selectors (high > medium > low)
- Semantic attributes (data-*, id) over classes
- Step context for disambiguation

IMPORTANT RULES:
- ONLY use selectors from the "Available Selectors" list above
- Prefer data-* attributes and IDs over class names  
- Choose selectors with highest stability when possible
- The selector MUST be from the provided candidates
- DO NOT return any failed selectors listed above

YOU MUST RESPOND WITH ONLY THIS JSON FORMAT:
{
  "selector": "chosen-selector-from-candidates",
  "confidence": 0.8,
  "fallbacks": ["other-candidate-selectors"]
}

START YOUR RESPONSE WITH { AND END WITH }. NOTHING ELSE.`;
  }

  private createUIGraphGeneralPrompt(label: string, elements: any[], stepNote?: string, failedSelectors?: string[]): string {
    const noteContext = stepNote ? `\n\nSTEP CONTEXT: "${stepNote}"\nUse this context to choose the most appropriate element if multiple candidates exist.` : '';
    const failedContext = failedSelectors && failedSelectors.length > 0 
      ? `\n\nFAILED SELECTORS: These selectors were tried but FAILED to work:\n${failedSelectors.map(s => `- ${s}`).join('\n')}\nDO NOT return any failed selectors. Find DIFFERENT working alternatives.`
      : '';
    
    const elementsData = elements.map((el, index) => {
      // Filter out JSS classes for cleaner output
      const cleanClasses = el.classes.filter((cls: string) => !/^jss\d+$/.test(cls));
      
      return `ELEMENT ${index + 1}:
- Tag: ${el.tag}
- Text: ${el.text || 'N/A'}
- Accessible Name: ${el.accessibleName || 'N/A'}
- ID: ${el.id || 'N/A'}
- Classes: [${cleanClasses.join(', ')}]
- Data-TestId: ${el.dataTestId || 'N/A'}
- Data-Unique: ${el.dataUnique || 'N/A'}
- Clickable: ${el.clickable}
- Available Selectors: [${el.candidateSelectors.filter((s: string) => !this.containsJSSClasses(s)).join(', ')}]
- Stability: ${el.stability}
- Nearby Text: [${el.nearbyText.slice(0, 3).join(', ')}]`;
    }).join('\n\n');
    
    return `You are a CSS selector expert. Find a selector for the element "${label}" from the following UI elements.
${noteContext}${failedContext}

AVAILABLE ELEMENTS:
${elementsData}

TASK:
Choose the best element and selector for element "${label}". Consider:
- Exact text/attribute matches
- Element functionality (clickable for interactions)
- Stability of selectors (high > medium > low)
- Semantic attributes (data-*, id) over classes
- Step context for disambiguation

IMPORTANT RULES:
- ONLY use selectors from the "Available Selectors" list above
- Prefer data-* attributes and IDs over class names
- Choose selectors with highest stability when possible
- The selector MUST be from the provided candidates
- DO NOT return any failed selectors listed above

YOU MUST RESPOND WITH ONLY THIS JSON FORMAT:
{
  "selector": "chosen-selector-from-candidates",
  "confidence": 0.8,
  "fallbacks": ["other-candidate-selectors"]
}

START YOUR RESPONSE WITH { AND END WITH }. NOTHING ELSE.`;
  }

  private containsJSSClasses(selector: string): boolean {
    return /\.jss\d+/.test(selector);
  }

  private createGeneralPrompt(label: string, htmlContent: string, stepNote?: string, failedSelectors?: string[]): string {
    const noteContext = stepNote ? `\n\nSTEP CONTEXT: "${stepNote}"\nUse this context to choose the most appropriate element if multiple candidates exist.` : '';
    const failedContext = failedSelectors && failedSelectors.length > 0 
      ? `\n\nFAILED SELECTORS: These selectors were tried but FAILED to work:\n${failedSelectors.map(s => `- ${s}`).join('\n')}\nDO NOT return any of these failed selectors. Find DIFFERENT working alternatives.`
      : '';
    
    return `You are a CSS selector expert. Find a selector for an element related to "${label}".
${noteContext}${failedContext}

HTML CONTENT:
${htmlContent}

TASK:
Find the best CSS selector for an element contextually related to "${label}". Prioritize in this order:
1. STABLE SEMANTIC SELECTORS: data-testid, data-*, id, role attributes
2. STRUCTURAL SELECTORS: element type with position (nth-child, form input)
3. CONTEXTUAL SELECTORS: Find elements near content containing "${label}"
4. COMPOUND SELECTORS: Combine multiple stable attributes

AVOID LABEL-BASED SELECTORS:
- DO NOT create selectors that match text content directly
- DO NOT use label values in attribute selectors unless they are semantic IDs
- Instead, use the label to identify the CONTEXT and find structural selectors

IMPORTANT RULES:
- NEVER use text content or label values directly in selectors
- DO NOT use JSS selectors (generated CSS class names like css-abc123)
- DO NOT use :contains() pseudo-class - it's NOT valid CSS and will fail
- DO NOT use :has() with text content - use attribute selectors instead
- Prefer data-testid, id, role, name attributes over classes
- Use structural relationships when semantic attributes aren't available
- ONLY use standard CSS selectors that work in querySelectorAll()
- The selector MUST exist in the provided HTML DOM

FORBIDDEN SELECTORS (WILL CAUSE ERRORS):
- div:contains("text") ❌ (not valid CSS)
- li:has(div:contains("text")) ❌ (not valid CSS)
- [text*="content"] ❌ (not valid CSS)
- :contains() pseudo-selectors ❌ (not valid CSS)
Use instead: [data-testid="..."], #id, .class, li[role="option"]
For text-based matching, use: [aria-label*="text"], [title*="text"], or attribute selectors

YOU MUST RESPOND WITH ONLY THIS JSON FORMAT. NO HTML, NO TEXT, NO EXPLANATIONS:
{
  "selector": "your-css-selector-here",
  "confidence": 0.8,
  "fallbacks": ["[data-testid='alternative']", "#alternative-id"]
}

START YOUR RESPONSE WITH { AND END WITH }. NOTHING ELSE.`;
  }

  private parseAIResponse(content: string): SelectorResult {
    try {
      // Handle case where content might not be a string
      const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
      
      // If content is already a parsed object, use it directly
      if (typeof content === 'object' && content !== null) {
        return this.validateSelectorResult(content as any);
      }
      
      // Try different JSON extraction patterns
      let jsonString = '';
      
      // Pattern 1: ```json blocks
      let jsonMatch = contentStr.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        jsonString = jsonMatch[1];
      } else {
        // Pattern 2: ``` blocks without language
        jsonMatch = contentStr.match(/```\n([\s\S]*?)\n```/);
        if (jsonMatch) {
          jsonString = jsonMatch[1];
        } else {
          // Pattern 3: Find first { to last } (greedy match for complete JSON)
          const startIndex = contentStr.indexOf('{');
          const lastIndex = contentStr.lastIndexOf('}');
          if (startIndex !== -1 && lastIndex !== -1 && lastIndex > startIndex) {
            jsonString = contentStr.substring(startIndex, lastIndex + 1);
          } else {
            console.log('AI Response content:', content);
            throw new Error('No JSON object found in AI response');
          }
        }
      }

      // Clean up the JSON string
      jsonString = jsonString.trim();
      
      // Additional cleanup - remove any trailing text after the JSON
      const lines = jsonString.split('\n');
      let jsonLines = [];
      let braceCount = 0;
      let jsonComplete = false;
      
      for (const line of lines) {
        if (jsonComplete) break;
        
        jsonLines.push(line);
        
        // Count braces to detect end of JSON
        for (const char of line) {
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
          if (braceCount === 0 && jsonLines.length > 1) {
            jsonComplete = true;
            break;
          }
        }
      }
      
      jsonString = jsonLines.join('\n');

      // Try to fix common JSON issues before parsing
      let fixedJson = jsonString;
      
      // Fix mixed quotes in property values
      fixedJson = fixedJson.replace(/,\s*'([^']*)',/g, ', "$1",');
      fixedJson = fixedJson.replace(/:\s*'([^']*)',/g, ': "$1",');
      fixedJson = fixedJson.replace(/,\s*'([^']*)"$/g, ', "$1"');
      
      // Remove repetitive text patterns that break JSON
      fixedJson = fixedJson.replace(/(\w+)'(\w+)'(\w+)'\w+/g, '$1');
      
      console.log('Original JSON:', jsonString);
      console.log('Fixed JSON:', fixedJson);
      
      const parsed = JSON.parse(fixedJson);
      
      return {
        selector: parsed.selector || '',
        confidence: parsed.confidence || 0,
        fallbacks: parsed.fallbacks || []
      };
    } catch (error) {
      console.warn('Failed to parse AI response:', error);
      console.log('Raw AI response:', content);
      return {
        selector: '',
        confidence: 0,
        fallbacks: []
      };
    }
  }

  private validateSelectorResult(obj: any): SelectorResult {
    return {
      selector: obj.selector || '',
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0,
      fallbacks: Array.isArray(obj.fallbacks) ? obj.fallbacks : []
    };
  }

  static isAvailable(): boolean {
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
    return hasOpenAI || hasAnthropic;
  }

  async analyzeSelectorPreference(testResults: {
    primarySelector: { selector: string; passed: boolean; duration?: number; error?: string };
    fallbacks: Array<{ selector: string; passed: boolean; duration?: number; error?: string }>;
    actionType: 'click' | 'type';
    elementLabel: string;
  }): Promise<{
    recommendedSelector: string;
    reasoning: string;
    ranking: Array<{ selector: string; score: number; notes: string }>;
  }> {
    try {
      const prompt = this.createSelectorAnalysisPrompt(testResults);
      
      // Use central LLM Manager
      const llmManager = getLLMManager();
      const response = await llmManager.execute('selector_resolution', {
        prompt,
        systemPrompt: "You are an expert in web automation and CSS selector optimization. You analyze selector test results to recommend the most reliable selector for automation."
      });

      const content = response.content || '';
      return this.parseSelectorAnalysisResponse(content);

    } catch (error) {
      console.warn('Selector analysis failed:', error);
      // Fallback to simple rule-based analysis
      return this.fallbackSelectorAnalysis(testResults);
    }
  }

  private createSelectorAnalysisPrompt(testResults: any): string {
    const { primarySelector, fallbacks, actionType, elementLabel } = testResults;
    
    return `Analyze these CSS selector test results for ${actionType} action on "${elementLabel}" element:

PRIMARY SELECTOR:
- Selector: ${primarySelector.selector}
- Test Result: ${primarySelector.passed ? 'PASSED' : 'FAILED'}
- Duration: ${primarySelector.duration || 'N/A'}ms
- Error: ${primarySelector.error || 'None'}

FALLBACK SELECTORS:
${fallbacks.map((fallback: any, index: number) => 
  `${index + 1}. ${fallback.selector}
   - Test Result: ${fallback.passed ? 'PASSED' : 'FAILED'}
   - Duration: ${fallback.duration || 'N/A'}ms
   - Error: ${fallback.error || 'None'}`
).join('\n')}

TASK:
Analyze these results and recommend the best selector based on:
1. Test success (passed/failed)
2. Performance (duration)
3. Selector reliability and maintainability
4. Semantic meaning and automation best practices

Consider factors like:
- data-* attributes are more stable than CSS classes
- Shorter selectors are often more reliable
- Semantic selectors are easier to maintain
- Performance differences matter for automation speed

RESPOND WITH VALID JSON ONLY:
{
  "recommendedSelector": "best-selector-here",
  "ranking": [
    { "selector": "selector1", "score": 9.0, "notes": "why this score" },
    { "selector": "selector2", "score": 7.5, "notes": "why this score" }
  ]
}`;
  }

  private parseSelectorAnalysisResponse(content: string): any {
    try {
      // Use existing JSON parsing logic from parseAIResponse
      let jsonString = '';
      
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || 
                       content.match(/```\n([\s\S]*?)\n```/);
      
      if (jsonMatch) {
        jsonString = jsonMatch[1];
      } else {
        const startIndex = content.indexOf('{');
        const lastIndex = content.lastIndexOf('}');
        if (startIndex !== -1 && lastIndex !== -1) {
          jsonString = content.substring(startIndex, lastIndex + 1);
        } else {
          throw new Error('No JSON found in response');
        }
      }

      const parsed = JSON.parse(jsonString.trim());
      
      return {
        recommendedSelector: parsed.recommendedSelector || '',
        ranking: parsed.ranking || []
      };
    } catch (error) {
      console.warn('Failed to parse selector analysis response:', error);
      return this.fallbackSelectorAnalysis({});
    }
  }

  private fallbackSelectorAnalysis(testResults: any): any {
    // Simple rule-based fallback
    const allSelectors = [testResults.primarySelector, ...testResults.fallbacks];
    const passedSelectors = allSelectors.filter((s: any) => s.passed);
    
    if (passedSelectors.length === 0) {
      return {
        recommendedSelector: testResults.primarySelector?.selector || '',
        ranking: []
      };
    }

    // Prefer data-* attributes, then shortest selector
    const best = passedSelectors.sort((a: any, b: any) => {
      const aIsData = a.selector.includes('[data-');
      const bIsData = b.selector.includes('[data-');
      
      if (aIsData && !bIsData) return -1;
      if (!aIsData && bIsData) return 1;
      
      return a.selector.length - b.selector.length;
    })[0];

    return {
      recommendedSelector: best.selector,
      ranking: passedSelectors.map((s: any, i: number) => ({
        selector: s.selector,
        score: 10 - i,
        notes: s.selector.includes('[data-') ? 'Has data attribute' : 'CSS selector'
      }))
    };
  }

  async findSelectorWithValidation(
    page: Page,
    label: string,
    elementType: 'input' | 'button' | 'any',
    stepNote?: string,
    maxRetries: number = 2
  ): Promise<SelectorResult> {
    const startTime = Date.now();
    let lastResult: SelectorResult | null = null;
    let failedSelectors: string[] = [];

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      console.log(`AI selector resolution attempt ${attempt}/${maxRetries + 1} for "${label}"`);
      
      // Get new selectors from AI
      const result = await this.findSelector(page, label, elementType, stepNote, failedSelectors);
      lastResult = result;
      
      if (!result.selector) {
        console.log(`Attempt ${attempt}: No selector returned from AI`);
        continue;
      }

      // Test all selectors (primary + fallbacks)
      const allSelectors = [result.selector, ...result.fallbacks].filter(s => s && !failedSelectors.includes(s));
      
      if (allSelectors.length === 0) {
        console.log(`Attempt ${attempt}: All selectors already failed previously`);
        continue;
      }

      console.log(`Attempt ${attempt}: Testing ${allSelectors.length} selectors...`);
      
      // Quick validation - check if elements exist
      const workingSelectors: string[] = [];
      
      for (const selector of allSelectors) {
        try {
          const element = page.locator(selector).first();
          const count = await element.count();
          if (count > 0) {
            workingSelectors.push(selector);
            console.log(`✅ Selector "${selector}" found ${count} element(s)`);
          } else {
            console.log(`❌ Selector "${selector}" found 0 elements`);
            failedSelectors.push(selector);
          }
        } catch (error) {
          console.log(`❌ Selector "${selector}" invalid: ${error}`);
          failedSelectors.push(selector);
        }
      }

      if (workingSelectors.length > 0) {
        const endTime = Date.now();
        const duration = endTime - startTime;
        console.log(`✅ Found ${workingSelectors.length} working selector(s) on attempt ${attempt}`);
        console.log(`⏱️ [AI Selector Validation] Total Time: ${duration}ms`);
        return {
          selector: workingSelectors[0],
          confidence: result.confidence,
          fallbacks: workingSelectors.slice(1)
        };
      }

      // All selectors failed - add them to failed list for next retry
      allSelectors.forEach(s => {
        if (!failedSelectors.includes(s)) {
          failedSelectors.push(s);
        }
      });

      console.log(`💔 All selectors failed on attempt ${attempt}. Failed selectors so far: ${failedSelectors.length}`);
      
      if (attempt <= maxRetries) {
        console.log(`Retrying with failed selectors context...`);
        await this.sleep(500); // Short delay before retry
      }
    }

    // All attempts failed
    const endTime = Date.now();
    const duration = endTime - startTime;
    console.warn(`All ${maxRetries + 1} attempts failed. Failed selectors: ${failedSelectors.join(', ')}`);
    console.log(`⏱️ [AI Selector Validation] Total Time (Failed): ${duration}ms`);
    return lastResult || {
      selector: '',
      confidence: 0,
      fallbacks: []
    };
  }

  static create(): AISelectorResolver | null {
    // Allow disabling LLM usage via environment flags for heuristic-only testing
    const useLLMFlag = (process.env.USE_LLM || '').toLowerCase();
    const disableLLMFlag = (process.env.DISABLE_LLM || '').toLowerCase();
    const isExplicitlyDisabled =
      useLLMFlag === 'false' || useLLMFlag === '0' ||
      disableLLMFlag === 'true' || disableLLMFlag === '1' || disableLLMFlag === 'yes';

    if (isExplicitlyDisabled) {
      console.log('LLM selector resolver disabled via environment flag (USE_LLM/DISABLE_LLM)');
      return null;
    }

    // Check if LLM Manager has required API keys
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    
    console.log('AI API Detection:');
    console.log('  OpenAI API Key:', openaiApiKey ? 'Set' : 'Not set');
    console.log('  Anthropic API Key:', anthropicApiKey ? 'Set' : 'Not set');
    
    try {
      if (openaiApiKey || anthropicApiKey) {
        console.log('Using LLM Manager for selector resolution');
        return new AISelectorResolver();
      } else {
        console.log('No AI API keys found for LLM Manager');
        return null;
      }
    } catch (error) {
      console.warn('Failed to initialize AI selector resolver:', error);
      return null;
    }
  }

  // NEW: Create instance for howto-prompt with custom configuration  
  static createForPrompt(_config?: { openai?: string; model?: string }): AISelectorResolver | null {
    // Always use LLM Manager - ignore legacy config parameters
    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    
    if (openaiKey || anthropicKey) {
      console.log('Creating AISelectorResolver for howto-prompt using LLM Manager');
      return new AISelectorResolver();
    }
    return null;
  }

  // NEW: Get LLM Manager for reuse in howto-prompt
  getLLMManager(): any {
    return getLLMManager();
  }

  // NEW: Get cleaned DOM snapshot (reuse cleaning logic)
  async getCleanedDOM(page: Page): Promise<string> {
    try {
      const domSnapshot = await page.evaluate(() => {
        return document.documentElement.outerHTML;
      });
      
      return DOMSnapshot.cleanHTMLForLLM(domSnapshot, {
        url: page.url(),
        title: await page.title(),
        label: 'getCleanedDOM',
        elementType: 'dom_snapshot'
      });
    } catch (error) {
      console.warn('Failed to get cleaned DOM:', error);
      return '';
    }
  }


  private async savePromptDebugFile(
    url: string,
    title: string,
    prompt: string,
    label: string,
    elementType: string
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const sanitizedLabel = label.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
      const baseFilename = `${timestamp}_${sanitizedLabel}_${elementType}`;
      
      // Ensure debug directory exists
      const debugDir = path.resolve('debug-output');
      await fs.mkdir(debugDir, { recursive: true });
      
      // Save prompt with metadata
      const promptWithMetadata = `# AI SELECTOR RESOLUTION PROMPT DEBUG

## Metadata
- URL: ${url}
- Title: ${title}
- Element Label: ${label}
- Element Type: ${elementType}
- Prompt Length: ${prompt.length} characters
- Timestamp: ${new Date().toISOString()}

## Full Prompt
${prompt}`;
      
      const promptPath = path.join(debugDir, `prompt-${baseFilename}.txt`);
      await fs.writeFile(promptPath, promptWithMetadata, 'utf8');
      
      console.log(`📝 Debug: Prompt saved to ${promptPath}`);
      
    } catch (error) {
      console.warn('Failed to save prompt debug file:', error);
    }
  }
}
