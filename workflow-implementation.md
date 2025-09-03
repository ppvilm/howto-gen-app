 │ Workspace Folder Implementation Plan                                                                                                                                        │ │
│ │                                                                                                                                                                             │ │
│ │ 1. Create WorkspaceManager Class (howto-core/src/workspace-manager.ts)                                                                                                      │ │
│ │                                                                                                                                                                             │ │
│ │ - Centralized management of all file operations                                                                                                                             │ │
│ │ - Default workspace: ~/.howto/ (or custom via env var HOWTO_WORKSPACE)                                                                                                      │ │
│ │ - Methods:                                                                                                                                                                  │ │
│ │   - getWorkspacePath(): Returns workspace root                                                                                                                              │ │
│ │   - getFlowConfigPath(flowName): Returns flow-specific config path                                                                                                          │ │
│ │   - getSessionPath(flowName, sessionId): Returns session-specific path                                                                                                      │ │
│ │   - generateSessionId(): Creates UUID for new session                                                                                                                       │ │
│ │   - mergeConfigurations(): Merges global and flow-specific configs                                                                                                          │ │
│ │   - ensureWorkspace(): Creates workspace structure if not exists                                                                                                            │ │
│ │                                                                                                                                                                             │ │
│ │ 2. Workspace Structure                                                                                                                                                      │ │
│ │                                                                                                                                                                             │ │
│ │ ~/.howto/                          # Default workspace root                                                                                                                 │ │
│ │ ├── config/                        # Global configuration (shared across all flows)                                                                                         │ │
│ │ │   ├── selector-heuristics.json  # Global learned selectors                                                                                                                │ │
│ │ │   ├── defaults.json             # Global default settings                                                                                                                 │ │
│ │ │   ├── .env                      # Global API keys and env vars                                                                                                            │ │
│ │ │   ├── secrets.json              # Global secrets                                                                                                                          │ │
│ │ │   └── variables.json            # Global variables                                                                                                                        │ │
│ │ ├── flow-configs/                  # Per-flow configuration                                                                                                                 │ │
│ │ │   └── {flow-name}/              # Flow-specific folder                                                                                                                    │ │
│ │ │       ├── config/               # Flow-specific overrides                                                                                                                 │ │
│ │ │       │   ├── selector-heuristics.json  # Flow-specific selectors (merged with global)                                                                                    │ │
│ │ │       │   ├── defaults.json     # Flow-specific settings (merged with global)                                                                                             │ │
│ │ │       │   ├── .env              # Flow-specific env vars (merged with global)                                                                                             │ │
│ │ │       │   ├── secrets.json      # Flow-specific secrets (merged with global)                                                                                              │ │
│ │ │       │   └── variables.json   # Flow-specific variables (merged with global)                                                                                             │ │
│ │ │       ├── sessions/             # All sessions for this flow                                                                                                              │ │
│ │ │       │   └── {uuid}/           # Individual session (e.g., a3f4d5e6-7b8c-9d0e)                                                                                           │ │
│ │ │       │       ├── screenshots/                                                                                                                                            │ │
│ │ │       │       ├── audio/                                                                                                                                                  │ │
│ │ │       │       ├── videos/                                                                                                                                                 │ │
│ │ │       │       ├── guides/                                                                                                                                                 │ │
│ │ │       │       └── metadata.json # Session metadata                                                                                                                        │ │
│ │ │       └── cache/                # Temporary files                                                                                                                         │ │
│ │ └── logs/                         # Application logs                                                                                                                        │ │
│ │                                                                                                                                                                             │ │
│ │ 3. Configuration Merging Strategy                                                                                                                                           │ │
│ │                                                                                                                                                                             │ │
│ │ - Load global config from ~/.howto/config/                                                                                                                                  │ │
│ │ - Load flow-specific config from ~/.howto/flow-configs/{flow}/config/                                                                                                       │ │
│ │ - Merge configurations with precedence:                                                                                                                                     │ │
│ │   - For JSON files: Deep merge with flow-specific values overriding global                                                                                                  │ │
│ │   - For .env files: Flow-specific variables override global ones                                                                                                            │ │
│ │   - For selector-heuristics: Combine learned selectors from both levels                                                                                                     │ │
│ │                                                                                                                                                                             │ │
│ │ 4. Update CLI (howto-cli/src/cli.ts)                                                                                                                                        │ │
│ │                                                                                                                                                                             │ │
│ │ - Add --workspace flag to override default workspace location                                                                                                               │ │
│ │ - Add --flow flag to specify flow name (default: current directory name)                                                                                                    │ │
│ │ - Auto-detect flow from current directory                                                                                                                                   │ │
│ │ - Generate session UUID using crypto.randomUUID()                                                                                                                           │ │
│ │ - Load and merge configs (global + flow-specific)                                                                                                                           │ │
│ │ - Add --session flag to resume/continue existing session                                                                                                                    │ │
│ │                                                                                                                                                                             │ │
│ │ 5. Update SDK (howto-sdk/src/)                                                                                                                                              │ │
│ │                                                                                                                                                                             │ │
│ │ - Add workspace configuration to SDK options                                                                                                                                │ │
│ │ - Update Markdown.run() and Prompt.generate() to use workspace                                                                                                              │ │
│ │ - Implement config merging logic                                                                                                                                            │ │
│ │ - Auto-create new session with UUID for each run                                                                                                                            │ │
│ │ - Return session ID in result for reference                                                                                                                                 │ │
│ │                                                                                                                                                                             │ │
│ │ 6. Configuration Loading Priority                                                                                                                                           │ │
│ │                                                                                                                                                                             │ │
│ │ 1. Command-line arguments (highest priority)                                                                                                                                │ │
│ │ 2. Session-specific overrides                                                                                                                                               │ │
│ │ 3. Flow-specific config (~/.howto/flow-configs/{flow}/config/)                                                                                                              │ │
│ │ 4. Global config (~/.howto/config/)                                                                                                                                         │ │
│ │ 5. System environment variables                                                                                                                                             │ │
│ │ 6. Default values (lowest priority)                                                                                                                                         │ │
│ │                                                                                                                                                                             │ │
│ │ 7. Selector Heuristics Management                                                                                                                                           │ │
│ │                                                                                                                                                                             │ │
│ │ Global selector-heuristics.json (~/.howto/config/)                                                                                                                          │ │
│ │                                                                                                                                                                             │ │
│ │ {                                                                                                                                                                           │ │
│ │   "version": 1,                                                                                                                                                             │ │
│ │   "scoreThresholds": { "direct": 0.78, "tryMultiple": 0.6, "llmFallback": 0.6 },                                                                                            │ │
│ │   "weights": { ... },                                                                                                                                                       │ │
│ │   "synonyms": {                                                                                                                                                             │ │
│ │     "login": ["sign in", "log in"],                                                                                                                                         │ │
│ │     "submit": ["send", "ok"]                                                                                                                                                │ │
│ │   },                                                                                                                                                                        │ │
│ │   "staticSelectors": [                                                                                                                                                      │ │
│ │     {                                                                                                                                                                       │ │
│ │       "label": "login",                                                                                                                                                     │ │
│ │       "elementType": "button",                                                                                                                                              │ │
│ │       "selector": "button[type='submit']",                                                                                                                                  │ │
│ │       "urlPattern": null  // applies everywhere                                                                                                                             │ │
│ │     }                                                                                                                                                                       │ │
│ │   ],                                                                                                                                                                        │ │
│ │   "learnedSelectors": [                                                                                                                                                     │ │
│ │     // Selectors learned across all flows                                                                                                                                   │ │
│ │   ]                                                                                                                                                                         │ │
│ │ }                                                                                                                                                                           │ │
│ │                                                                                                                                                                             │ │
│ │ Flow-specific selector-heuristics.json (~/.howto/flow-configs/my-app/config/)                                                                                               │ │
│ │                                                                                                                                                                             │ │
│ │ {                                                                                                                                                                           │ │
│ │   "staticSelectors": [                                                                                                                                                      │ │
│ │     {                                                                                                                                                                       │ │
│ │       "label": "login",                                                                                                                                                     │ │
│ │       "elementType": "button",                                                                                                                                              │ │
│ │       "selector": "#custom-login-btn",                                                                                                                                      │ │
│ │       "urlPattern": "myapp.com"  // flow-specific override                                                                                                                  │ │
│ │     }                                                                                                                                                                       │ │
│ │   ],                                                                                                                                                                        │ │
│ │   "learnedSelectors": [                                                                                                                                                     │ │
│ │     // Selectors learned only for this flow                                                                                                                                 │ │
│ │   ],                                                                                                                                                                        │ │
│ │   "synonyms": {                                                                                                                                                             │ │
│ │     "login": ["anmelden"]  // adds German synonym for this flow                                                                                                             │ │
│ │   }                                                                                                                                                                         │ │
│ │ }                                                                                                                                                                           │ │
│ │                                                                                                                                                                             │ │
│ │ Merged Result (used at runtime)                                                                                                                                             │ │
│ │                                                                                                                                                                             │ │
│ │ - staticSelectors: Flow-specific selectors take precedence over global ones with same label                                                                                 │ │
│ │ - learnedSelectors: Combined list from both, flow-specific first                                                                                                            │ │
│ │ - synonyms: Deep merged, flow adds to global                                                                                                                                │ │
│ │ - scoreThresholds/weights: Flow can override global values                                                                                                                  │ │
│ │                                                                                                                                                                             │ │
│ │ 8. Session Management                                                                                                                                                       │ │
│ │                                                                                                                                                                             │ │
│ │ - Each run creates a new session folder with UUID                                                                                                                           │ │
│ │ - Session metadata includes all details                                                                                                                                     │ │
│ │ - Commands for session management                                                                                                                                           │ │
│ │                                                                                                                                                                             │ │
│ │ 9. Migration Strategy                                                                                                                                                       │ │
│ │                                                                                                                                                                             │ │
│ │ - Check for existing output folders and offer to migrate                                                                                                                    │ │
│ │ - When migrating selector-heuristics.json:                                                                                                                                  │ │
│ │   - Generic selectors (no urlPattern) → global config                                                                                                                       │ │
│ │   - Domain-specific selectors → appropriate flow config                                                                                                                     │ │
│ │ - Preserve backward compatibility                                                                                                                                           │ │
│ │                                                                                                                                                                             │ │
│ │ 10. Implementation Steps                                                                                                                                                    │ │
│ │                                                                                                                                                                             │ │
│ │ 1. Create WorkspaceManager class with config merging logic                                                                                                                  │ │
│ │ 2. Update SelectorHeuristicsStore to support two-level loading:                                                                                                             │ │
│ │ static async load(flowName?: string): Promise<SelectorHeuristicsStore> {                                                                                                    │ │
│ │   const globalPath = path.join(workspace, 'config', 'selector-heuristics.json');                                                                                            │ │
│ │   const flowPath = flowName ?                                                                                                                                               │ │
│ │     path.join(workspace, 'flow-configs', flowName, 'config', 'selector-heuristics.json') : null;                                                                            │ │
│ │                                                                                                                                                                             │ │
│ │   // Load and merge both configs                                                                                                                                            │ │
│ │   const globalConfig = await loadConfig(globalPath);                                                                                                                        │ │
│ │   const flowConfig = flowPath ? await loadConfig(flowPath) : {};                                                                                                            │ │
│ │   const merged = mergeConfigs(globalConfig, flowConfig);                                                                                                                    │ │
│ │                                                                                                                                                                             │ │
│ │   return new SelectorHeuristicsStore(merged, flowPath || globalPath);                                                                                                       │ │
│ │ }                                                                                                                                                                           │ │
│ │ 3. Implement deep merge functionality for all JSON configs                                                                                                                  │ │
│ │ 4. Update all file operations to use WorkspaceManager                                                                                                                       │ │
│ │ 5. Implement session UUID generation                                                                                                                                        │ │
│ │ 6. Update CLI/SDK with new options                                                                                                                                          │ │
│ │ 7. Add session management commands                                                                                                                                          │ │
│ │ 8. Add initialization and migration commands                                                                                                                                │ │
│ │ 9. Update documentation                                                                                                                                                     │ │
│ │                                                                                                                                                                             │ │
│ │ 11. Benefits                                                                                                                                                                │ │
│ │                                                                                                                                                                             │ │
│ │ - Common selectors shared globally (login, submit, etc.)                                                                                                                    │ │
│ │ - Flow-specific selectors override when needed                                                                                                                              │ │
│ │ - Learning happens at appropriate level                                                                                                                                     │ │
│ │ - No duplication of common patterns                                                                                                                                         │ │
│ │ - Clear separation of concerns       