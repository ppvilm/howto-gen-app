// Test script to demonstrate keypress functionality for dropdown dismissal
const example = {
  "title": "Test Keypress for Dropdown Dismissal",
  "baseUrl": "https://example.com",
  "steps": [
    {
      "type": "goto",
      "url": "https://example.com"
    },
    {
      "type": "click",
      "label": "Country dropdown",
      "note": "Open the country selection dropdown"
    },
    {
      "type": "click",
      "label": "Germany",
      "note": "Select Germany from dropdown options"
    },
    {
      "type": "keypress", 
      "key": "Escape",
      "note": "Close dropdown overlay if it remains open after selection"
    }
  ]
};

const llmExample = {
  "type": "keypress",
  "key": "Escape", 
  "reasoning": "Close dropdown overlay that is still visible after option selection",
  "confidence": 0.9,
  "matchesGoal": true,
  "alternatives": []
};

console.log("=== Keypress Step Configuration Example ===");
console.log(JSON.stringify(example, null, 2));
console.log("\n=== LLM Output Example for Keypress ===");
console.log(JSON.stringify(llmExample, null, 2));
console.log("\n=== Supported Keys ===");
console.log("- 'Escape' - Close overlays/modals");
console.log("- 'Enter' - Confirm actions");
console.log("- 'Tab' - Navigate between elements");
console.log("- 'Space' - Select options");
console.log("- 'ArrowUp', 'ArrowDown' - Navigate dropdown options");
console.log("- Any other Playwright-supported key names");