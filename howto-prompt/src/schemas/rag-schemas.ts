// JSON Schemas for RAG System Components
// These schemas are used for validation and documentation

export const QuerySpecSchema = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["navigate", "click", "type", "assert"],
      description: "The intended action type for this query"
    },
    keywords: {
      type: "array",
      items: {
        type: "string",
        minLength: 1
      },
      minItems: 1,
      maxItems: 10,
      description: "Keywords that describe what we're looking for"
    },
    filters: {
      type: "object",
      properties: {
        role: {
          type: "array",
          items: {
            type: "string",
            enum: ["button", "textbox", "link", "combobox", "checkbox", "radio", "tab", "menuitem", "heading", "text", "article", "main"]
          },
          description: "UI roles to include in search"
        },
        attrs: {
          type: "object",
          patternProperties: {
            "^[a-zA-Z-]+$": {
              type: "string"
            }
          },
          description: "HTML attributes to match"
        },
        sectionHint: {
          type: "string",
          maxLength: 50,
          description: "Hint about which page section to focus on"
        },
        negative: {
          type: "array",
          items: {
            type: "string",
            minLength: 1
          },
          description: "Terms to exclude from results"
        }
      },
      additionalProperties: false
    },
    constraints: {
      type: "object",
      properties: {
        mustBeVisible: {
          type: "boolean",
          description: "Whether element must be visible"
        },
        mustBeClickable: {
          type: "boolean",
          description: "Whether element must be clickable"
        },
        language: {
          type: "string",
          pattern: "^[a-z]{2}$",
          description: "UI language preference (ISO 639-1)"
        }
      },
      additionalProperties: false
    },
    k: {
      type: "integer",
      minimum: 1,
      maximum: 100,
      default: 30,
      description: "Maximum number of results to return"
    },
    diversity: {
      type: "boolean",
      default: true,
      description: "Whether to apply diversity reranking"
    }
  },
  required: ["intent", "keywords"],
  additionalProperties: false
};

export const EvidenceItemSchema = {
  type: "object",
  properties: {
    id: {
      type: "string",
      minLength: 1,
      description: "Unique identifier for this evidence item"
    },
    label: {
      type: "string",
      minLength: 1,
      description: "The label or text of the UI element"
    },
    role: {
      type: "string",
      minLength: 1,
      description: "The semantic role of the UI element"
    },
    snippet: {
      type: "string",
      maxLength: 500,
      description: "Brief text snippet or description"
    },
    selectorCandidates: {
      type: "array",
      items: {
        type: "string",
        minLength: 1
      },
      minItems: 0,
      description: "CSS selectors that can target this element"
    },
    section: {
      type: "string",
      description: "Page section this element belongs to"
    },
    score: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Relevance score (0-1, higher is more relevant)"
    },
    type: {
      type: "string",
      enum: ["section", "element"],
      description: "Whether this is a page section or UI element"
    }
  },
  required: ["id", "label", "role", "snippet", "selectorCandidates", "score", "type"],
  additionalProperties: false
};

export const EvidencePackSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: EvidenceItemSchema,
      description: "Array of evidence items found"
    },
    query: QuerySpecSchema,
    totalItems: {
      type: "integer",
      minimum: 0,
      description: "Total number of items in this pack"
    },
    searchLatencyMs: {
      type: "number",
      minimum: 0,
      description: "Time taken to generate this evidence pack"
    }
  },
  required: ["items", "query", "totalItems", "searchLatencyMs"],
  additionalProperties: false
};

export const SemanticIndexSchema = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            minLength: 1
          },
          text: {
            type: "string"
          },
          roles: {
            type: "array",
            items: {
              type: "string"
            }
          },
          anchorSelectors: {
            type: "array",
            items: {
              type: "string"
            }
          },
          embedding: {
            type: "array",
            items: {
              type: "number"
            }
          },
          position: {
            type: "object",
            properties: {
              start: { type: "number" },
              end: { type: "number" }
            },
            required: ["start", "end"]
          }
        },
        required: ["title", "text", "roles", "anchorSelectors", "position"]
      }
    },
    elements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", minLength: 1 },
          role: { type: "string", minLength: 1 },
          selector: { type: "string", minLength: 1 },
          candidateSelectors: {
            type: "array",
            items: { type: "string" }
          },
          section: { type: "string" },
          group: { type: "string" },
          visible: { type: "boolean" },
          inViewport: { type: "boolean" },
          activeTab: { type: "boolean" },
          embedding: {
            type: "array",
            items: { type: "number" }
          },
          stability: {
            type: "string",
            enum: ["high", "medium", "low"]
          },
          interactionType: {
            type: "string",
            enum: ["click", "type", "both"]
          }
        },
        required: ["label", "role", "selector", "candidateSelectors", "visible", "inViewport", "activeTab", "stability", "interactionType"]
      }
    },
    url: {
      type: "string",
      format: "uri"
    },
    timestamp: {
      type: "number",
      minimum: 0
    },
    fingerprint: {
      type: "string",
      minLength: 1
    }
  },
  required: ["sections", "elements", "url", "timestamp", "fingerprint"],
  additionalProperties: false
};

// Validation functions
export function validateQuerySpec(query: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!query || typeof query !== 'object') {
    return { valid: false, errors: ['Query must be an object'] };
  }

  // Check required fields
  if (!query.intent || !['navigate', 'click', 'type', 'assert'].includes(query.intent)) {
    errors.push('Intent must be one of: navigate, click, type, assert');
  }

  if (!Array.isArray(query.keywords) || query.keywords.length === 0) {
    errors.push('Keywords must be a non-empty array');
  }

  // Check optional fields
  if (query.k !== undefined && (typeof query.k !== 'number' || query.k < 1 || query.k > 100)) {
    errors.push('k must be a number between 1 and 100');
  }

  if (query.filters?.role && !Array.isArray(query.filters.role)) {
    errors.push('filters.role must be an array');
  }

  return { valid: errors.length === 0, errors };
}

export function validateEvidencePack(pack: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!pack || typeof pack !== 'object') {
    return { valid: false, errors: ['Evidence pack must be an object'] };
  }

  if (!Array.isArray(pack.items)) {
    errors.push('items must be an array');
  }

  if (typeof pack.totalItems !== 'number' || pack.totalItems < 0) {
    errors.push('totalItems must be a non-negative number');
  }

  if (typeof pack.searchLatencyMs !== 'number' || pack.searchLatencyMs < 0) {
    errors.push('searchLatencyMs must be a non-negative number');
  }

  // Validate query
  if (pack.query) {
    const queryValidation = validateQuerySpec(pack.query);
    if (!queryValidation.valid) {
      errors.push(...queryValidation.errors.map(err => `query.${err}`));
    }
  } else {
    errors.push('query is required');
  }

  // Validate evidence items
  if (Array.isArray(pack.items)) {
    pack.items.forEach((item: any, index: number) => {
      if (!item.id || typeof item.id !== 'string') {
        errors.push(`items[${index}].id must be a string`);
      }
      if (!item.label || typeof item.label !== 'string') {
        errors.push(`items[${index}].label must be a string`);
      }
      if (typeof item.score !== 'number' || item.score < 0 || item.score > 1) {
        errors.push(`items[${index}].score must be a number between 0 and 1`);
      }
      if (!['section', 'element'].includes(item.type)) {
        errors.push(`items[${index}].type must be 'section' or 'element'`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

// Helper functions for schema generation
export function getQuerySpecExamples(): any[] {
  return [
    {
      intent: "click",
      keywords: ["login", "sign in", "submit"],
      filters: {
        role: ["button"],
        sectionHint: "authentication"
      },
      constraints: {
        mustBeVisible: true,
        mustBeClickable: true
      },
      k: 10,
      diversity: true
    },
    {
      intent: "type",
      keywords: ["username", "email", "login"],
      filters: {
        role: ["textbox"],
        negative: ["password"]
      },
      constraints: {
        mustBeVisible: true
      },
      k: 5,
      diversity: false
    },
    {
      intent: "navigate",
      keywords: ["settings", "profile", "account"],
      filters: {
        role: ["link", "tab", "menuitem"],
        sectionHint: "navigation"
      },
      k: 15,
      diversity: true
    }
  ];
}

export function getEvidencePackExample(): any {
  return {
    items: [
      {
        id: "element_login_button_1692301234",
        label: "Login",
        role: "button",
        snippet: "Login button in authentication form",
        selectorCandidates: ["#login-btn", "button[data-test='login']"],
        section: "Authentication",
        score: 0.95,
        type: "element"
      },
      {
        id: "element_username_field_1692301235",
        label: "Username",
        role: "textbox",
        snippet: "Username input field",
        selectorCandidates: ["#username", "input[name='username']"],
        section: "Authentication",
        score: 0.88,
        type: "element"
      }
    ],
    query: {
      intent: "click",
      keywords: ["login", "submit"],
      filters: {
        role: ["button"],
        sectionHint: "authentication"
      },
      k: 10,
      diversity: true
    },
    totalItems: 2,
    searchLatencyMs: 127.5
  };
}