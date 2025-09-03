# HowTo SDK

Das HowTo SDK ist die zentrale API für HowTo Guide-Generierung und bietet einheitliche Zugriffe für Markdown-Ausführung und KI-unterstützte Guide-Generierung.

## Installation

```bash
npm install howto-sdk
```

## Grundlegende Verwendung

### Markdown API
```typescript
import { Markdown } from 'howto-sdk';

// Äquivalent zu: howto run guide.md
const result = await Markdown.run('./guide.md');
```

### Prompt API
```typescript
import { Prompt } from 'howto-sdk';

// Äquivalent zu: howto prompt "Login to the app" --base-url https://app.com
const result = await Prompt.generate('Login to the app', {
  baseUrl: 'https://app.com'
});
```

## API Referenz

### Markdown API

#### `Markdown.run(markdownPath: string, options?: MarkdownRunOptions): Promise<GuideResult>`
Generiert einen kompletten How-To Guide aus einer Markdown-Datei.

**Optionen:**
- `outputDir?: string` - Ausgabeverzeichnis (überschreibt Markdown-Konfiguration)
- `headful?: boolean` - Browser im sichtbaren Modus ausführen
- `dryRun?: boolean` - Nur parsen und validieren, ohne Browser-Schritte auszuführen
- `secrets?: Record<string, string>` - Secrets für Platzhalter-Auflösung
- `variables?: Record<string, any>` - Variablen für Platzhalter-Auflösung

**CLI-Äquivalent:**
```bash
howto run <markdown-file> [--out <dir>] [--headful] [--dry-run] [--secrets <file>] [--vars <file>]
```

#### `Markdown.runFromContent(content: string, options?: MarkdownRunOptions): Promise<GuideResult>`
Generiert einen Guide aus einem Markdown-Content-String.

#### `Markdown.parseAndValidate(markdownPath: string): Promise<{parsed: ParsedGuide, config: GuideConfig}>`
Parst und validiert eine Markdown-Datei ohne Ausführung.

### Prompt API

#### `Prompt.generate(userPrompt: string, options: PromptGenerateOptions): Promise<HowtoPromptResult>`
Generiert einen HowTo-Guide aus natürlichsprachlichem Prompt.

**Optionen:**
- `baseUrl: string` - Basis-URL der Anwendung (erforderlich)
- `model?: string` - LLM-Modell (Standard: 'gpt-4')
- `headful?: boolean` - Browser im sichtbaren Modus (Standard: false)
- `outputDir?: string` - Ausgabeverzeichnis (Standard: './output')
- `maxSteps?: number` - Maximale Schrittanzahl (Standard: 20)
- `maxRefines?: number` - Maximale Verfeinerungsversuche pro Schritt (Standard: 3)
- `language?: string` - Sprache für generierten Guide (Standard: 'en')
- `interactive?: boolean` - Interaktiver Modus (Standard: false)
- `secrets?: Record<string, string>` - Secrets für Platzhalter-Auflösung
- `variables?: Record<string, any>` - Variablen für Platzhalter-Auflösung

**CLI-Äquivalent:**
```bash
howto prompt "<user-prompt>" --base-url <url> [--model <model>] [--headful] [--out <dir>] [weitere Optionen]
```

#### `Prompt.generateStream(userPrompt: string, options: PromptGenerateOptions): AsyncGenerator<PromptEvent, HowtoPromptResult>`
Wie `generate()`, aber mit Streaming-Events für Live-Updates.

## Beispiele

### Markdown-Guide ausführen
```typescript
import { Markdown } from 'howto-sdk';

async function runGuide() {
  try {
    const result = await Markdown.run('./example-guide.md', {
      headful: true,  // Sichtbarer Browser
      outputDir: './meine-ausgabe'
    });
    
    console.log('Guide erfolgreich generiert!');
    console.log(`Screenshots: ${result.screenshotDir}`);
    console.log(`Video: ${result.videoPath}`);
  } catch (error) {
    console.error('Fehler beim Generieren:', error);
  }
}
```

### Mit Secrets und Variables
```typescript
const secrets = {
  username: 'user@example.com',
  password: 'mySecretPassword'
};

const variables = {
  environment: 'staging',
  timeout: 5000
};

const result = await Markdown.run('./guide.md', {
  secrets,
  variables,
  outputDir: './secure-guides'
});

// Markdown Guide kann dann Platzhalter verwenden:
// value: "{{secret.username}}" für Secrets
// value: "{{var.environment}}" für Variablen
```

### Aus String-Content generieren
```typescript
const markdownContent = `---
title: "Login Test"
baseUrl: "https://example.com"
steps:
  - type: goto
    url: "/login"
    screenshot: true
  - type: type
    label: "username"
    value: "{{var.user}}"
  - type: click
    label: "Login"
---

# Login Guide
Dieser Guide zeigt den Login-Prozess.`;

const result = await Markdown.runFromContent(markdownContent, {
  variables: { user: 'testuser' },
  outputDir: './generierte-guides'
});
```

### KI-basierte Guide-Generierung
```typescript
import { Prompt } from 'howto-sdk';

async function generateWithAI() {
  const result = await Prompt.generate(
    'Login to the application and create a new project',
    {
      baseUrl: 'https://myapp.com',
      model: 'gpt-4',
      headful: true,
      language: 'de',
      maxSteps: 15
    }
  );
  
  console.log(`Erfolgreich: ${result.success}`);
  console.log(`Schritte generiert: ${result.report.totalSteps}`);
}
```

### Streaming mit Live-Updates
```typescript
async function generateWithStreaming() {
  console.log('🤖 Starte KI-gestützte Guide-Generierung...\n');
  
  for await (const event of Prompt.generateStream('Login and check dashboard', {
    baseUrl: 'https://app.example.com',
    headful: false
  })) {
    switch (event.type) {
      case 'goal_set':
        console.log(`📋 Ziel gesetzt: ${event.prompt}`);
        break;
      case 'page_analyzed':
        console.log(`🔍 Seite analysiert: ${event.url}`);
        console.log(`   Gefunden: ${event.inventory.fields.length} Felder, ${event.inventory.buttons.length} Buttons`);
        break;
      case 'step_planned':
        console.log(`📝 Geplant: ${event.step.type}(${event.step.label || event.step.url})`);
        break;
      case 'step_executed':
        console.log(`✅ Schritt erfolgreich ausgeführt`);
        break;
      case 'completed':
        console.log(`\n🎉 Generierung abgeschlossen!`);
        console.log(`📄 ${event.steps.length} Schritte generiert`);
        break;
    }
  }
}
```

### Nur parsen und validieren
```typescript
const { parsed, config } = await Markdown.parseAndValidate('./guide.md');

console.log(`Guide Titel: ${config.title}`);
console.log(`Anzahl Schritte: ${config.steps.length}`);

config.steps.forEach((step, index) => {
  console.log(`Schritt ${index + 1}: ${step.type} - ${step.label || step.url}`);
});
```

## CLI vs SDK Vergleich

### Markdown Commands
| CLI Kommando | SDK Methode |
|-------------|-------------|
| `howto run guide.md` | `Markdown.run('./guide.md')` |
| `howto run guide.md --out ./output` | `Markdown.run('./guide.md', {outputDir: './output'})` |
| `howto run guide.md --headful` | `Markdown.run('./guide.md', {headful: true})` |
| `howto run guide.md --dry-run` | `Markdown.run('./guide.md', {dryRun: true})` |
| `howto run guide.md --secrets secrets.json` | `Markdown.run('./guide.md', {secrets: {...}})` |

### Prompt Commands
| CLI Kommando | SDK Methode |
|-------------|-------------|
| `howto prompt "Login" --base-url https://app.com` | `Prompt.generate('Login', {baseUrl: 'https://app.com'})` |
| `howto prompt "Login" --base-url https://app.com --headful` | `Prompt.generate('Login', {baseUrl: 'https://app.com', headful: true})` |
| `howto prompt "Login" --base-url https://app.com --model gpt-3.5-turbo` | `Prompt.generate('Login', {baseUrl: 'https://app.com', model: 'gpt-3.5-turbo'})` |

## Typen

Alle TypeScript-Typen sind aus dem Paket exportiert:

```typescript
import { 
  // Classes
  Markdown,
  Prompt,
  
  // Types from howto-core
  StepAction, 
  GuideConfig, 
  GuideResult, 
  StepResult,
  GenerateOptions,
  
  // Types from howto-prompt
  HowtoPromptResult,
  PromptEvent,
  HowtoPromptOptions
} from 'howto-sdk';
```

## Fehlerbehandlung

```typescript
try {
  const result = await Markdown.run('./guide.md');
} catch (error) {
  if (error instanceof Error) {
    console.error('SDK Fehler:', error.message);
  } else {
    console.error('Unbekannter Fehler:', error);
  }
}
```

## Wichtige Unterschiede zur alten SDK

- **Namespace-basiert**: Verwende `Markdown.run()` und `Prompt.generate()` anstatt `new HowtoSDK()`
- **Einheitliche Options**: `headful` wird überall verwendet (nicht mehr `headless: !headful`)
- **Direkte Re-Exports**: Alle Types kommen direkt aus core/prompt packages
- **Streaming Support**: `Prompt.generateStream()` für Live-Updates
- **Variables Support**: Zusätzlich zu Secrets auch Variables unterstützt

Das neue SDK bietet eine saubere, typsichere API für beide Hauptfunktionalitäten: Markdown-Guide-Ausführung und KI-basierte Guide-Generierung.