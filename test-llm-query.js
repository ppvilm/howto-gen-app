#!/usr/bin/env node

// Test LLM-based RAG query generation
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateRAGQuery(subgoal, currentUrl) {
  const prompt = `SUBGOAL: ${subgoal.short}
DETAIL: ${subgoal.detail}
CURRENT_URL: ${currentUrl}

Generiere eine optimale RAG-Query für die semantische Suche nach UI-Elementen, die für dieses Subgoal relevant sind.

BEISPIELE FÜR GUTE QUERIES:
1. Navigation zu Tests:
   - intent: "navigate", keywords: ["test", "regression", "testing", "qa"], filters: {role: ["button", "link", "tab", "menuitem"]}

2. Formular ausfüllen:
   - intent: "type", keywords: ["username", "email", "input"], filters: {role: ["textbox", "input"]}

3. Button klicken:
   - intent: "click", keywords: ["submit", "login", "save"], filters: {role: ["button"]}

WICHTIGE REGELN:
- Verwende englische Keywords für bessere UI-Element-Matching
- Wähle passende Roles basierend auf der gewünschten Interaktion
- intent sollte "click", "type" oder "navigate" sein
- Für deutsche Subgoals: übersetze Kernbegriffe ins Englische
- k zwischen 8-15 je nach Komplexität
- diversity: true für Navigation, false für spezifische Actions

Antworte nur mit JSON:`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Du bist ein Experte für semantische Suche in Web-UIs. Generiere optimale RAG-Queries.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_completion_tokens: 200
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('Empty response from LLM');
    }

    console.log('Raw LLM Response:');
    console.log(content);
    console.log('\n---\n');

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`No JSON found in response: ${content}`);
    }

    const query = JSON.parse(jsonMatch[0]);
    return query;

  } catch (error) {
    console.error('LLM query generation failed:', error);
    throw error;
  }
}

async function main() {
  console.log('🧪 Testing LLM-based RAG query generation\n');

  // Test case 1: Navigation to regression test options
  const testSubgoal1 = {
    short: "Navigiere zu den Regressionstest-Optionen",
    detail: "Suche und navigiere zu den Optionen für Regressionstests im Dashboard"
  };

  console.log('🎯 Test 1: Navigation to regression tests');
  console.log(`Subgoal: ${testSubgoal1.short}`);
  console.log(`Detail: ${testSubgoal1.detail}\n`);

  try {
    const query1 = await generateRAGQuery(testSubgoal1, 'https://smoketest.live-a.botium.cyaraportal.eu/dashboard');
    console.log('Generated Query:');
    console.log(JSON.stringify(query1, null, 2));
    console.log('\n' + '='.repeat(60) + '\n');
  } catch (error) {
    console.error('Test 1 failed:', error);
  }

  // Test case 2: Create new regression test
  const testSubgoal2 = {
    short: "Erstelle einen neuen Regressionstest",
    detail: "Erstelle einen neuen Regressionstest mit den erforderlichen Parametern"
  };

  console.log('🎯 Test 2: Create new regression test');
  console.log(`Subgoal: ${testSubgoal2.short}`);
  console.log(`Detail: ${testSubgoal2.detail}\n`);

  try {
    const query2 = await generateRAGQuery(testSubgoal2, 'https://smoketest.live-a.botium.cyaraportal.eu/tests');
    console.log('Generated Query:');
    console.log(JSON.stringify(query2, null, 2));
  } catch (error) {
    console.error('Test 2 failed:', error);
  }
}

main().catch(console.error);