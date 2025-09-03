# HowTo SDK

Das HowTo SDK stellt programmatischen Zugriff auf alle CLI-Funktionalitäten bereit. Alles was über die CLI möglich ist, kann auch über das SDK verwendet werden.

## Installation

```bash
npm install howto-core
```

## Grundlegende Verwendung

```typescript
import { HowtoSDK } from 'howto-core';

const sdk = new HowtoSDK();

// Äquivalent zu: howto run guide.md
const result = await sdk.run('./guide.md');
```

## API Referenz

### Hauptmethoden

#### `run(markdownPath: string, options?: SDKOptions): Promise<GuideResult>`
Generiert einen kompletten How-To Guide aus einer Markdown-Datei.

**Optionen:**
- `outputDir?: string` - Ausgabeverzeichnis (überschreibt Markdown-Konfiguration)
- `headful?: boolean` - Browser im sichtbaren Modus ausführen
- `dryRun?: boolean` - Nur parsen und validieren, ohne Browser-Schritte auszuführen
- `secrets?: Record<string, string>` - Secrets für Platzhalter-Auflösung

**CLI-Äquivalent:**
```bash
howto run <markdown-file> [--out <dir>] [--headful] [--dry-run]
```

#### `runFromContent(content: string, options?: SDKOptions): Promise<GuideResult>`
Generiert einen Guide aus einem Markdown-Content-String.

#### `parseAndValidate(markdownPath: string): Promise<{parsed: ParsedGuide, config: GuideConfig}>`
Parst und validiert eine Markdown-Datei ohne Ausführung.

#### `dryRun(markdownPath: string, options?): Promise<GuideResult>`
Führt nur die Parse- und Validierungsphase aus.

**CLI-Äquivalent:**
```bash
howto run guide.md --dry-run
```

#### `runHeadful(markdownPath: string, options?): Promise<GuideResult>`
Führt den Guide mit sichtbarem Browser aus.

**CLI-Äquivalent:**
```bash
howto run guide.md --headful
```

#### `runWithOutput(markdownPath: string, outputDir: string, options?): Promise<GuideResult>`
Führt den Guide mit benutzerdefiniertem Ausgabeverzeichnis aus.

**CLI-Äquivalent:**
```bash
howto run guide.md --out <outputDir>
```

### Hilfsmethoden

#### `getStepTypes(): Array<{type: string, description: string}>`
Gibt verfügbare Schritt-Typen und deren Beschreibungen zurück.

#### `validateConfig(config: any): GuideConfig`
Validiert eine Guide-Konfiguration ohne Ausführung.

## Beispiele

### Grundlegendes Beispiel
```typescript
import { HowtoSDK } from 'howto-core';

async function generateGuide() {
  const sdk = new HowtoSDK();
  
  try {
    const result = await sdk.run('./example-guide.md');
    console.log('Guide erfolgreich generiert!');
    console.log(`Screenshots: ${result.screenshotDir}`);
    console.log(`Video: ${result.videoPath}`);
  } catch (error) {
    console.error('Fehler beim Generieren:', error);
  }
}
```

### Mit Optionen
```typescript
const result = await sdk.run('./guide.md', {
  outputDir: './meine-ausgabe',
  headful: true,  // Sichtbarer Browser
  dryRun: false
});
```

### Mit Secrets
```typescript
// Secrets für sensible Daten wie Passwörter
const secrets = {
  username: 'user@example.com',
  password: 'mySecretPassword',
  api_token: 'sk-abc123xyz789'
};

const result = await sdk.run('./guide.md', {
  secrets,
  outputDir: './secure-guides'
});

// Markdown Guide kann dann Platzhalter verwenden:
// value: "{{secret.username}}"
// value: "{{secret.password}}"
```

**CLI-Äquivalent:**
```bash
howto run guide.md --secrets secrets.json
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
    value: "testuser"
  - type: click
    label: "Login"
---

# Login Guide
Dieser Guide zeigt den Login-Prozess.`;

const result = await sdk.runFromContent(markdownContent, {
  outputDir: './generierte-guides'
});
```

### Nur parsen und validieren
```typescript
const { parsed, config } = await sdk.parseAndValidate('./guide.md');

console.log(`Guide Titel: ${config.title}`);
console.log(`Anzahl Schritte: ${config.steps.length}`);

config.steps.forEach((step, index) => {
  console.log(`Schritt ${index + 1}: ${step.type} - ${step.label || step.url}`);
});
```

### Ergebnisse verarbeiten
```typescript
const result = await sdk.run('./guide.md');

// Fehlgeschlagene Schritte finden
const failedSteps = result.stepResults.filter(step => !step.success);
if (failedSteps.length > 0) {
  console.log(`${failedSteps.length} Schritte fehlgeschlagen:`);
  failedSteps.forEach(step => {
    console.log(`  Schritt ${step.index + 1}: ${step.error}`);
  });
}

// Screenshots zählen
const screenshots = result.stepResults
  .filter(step => step.success && step.screenshot)
  .map(step => step.screenshot);
  
console.log(`${screenshots.length} Screenshots generiert`);
```

## CLI vs SDK Vergleich

| CLI Kommando | SDK Methode |
|-------------|-------------|
| `howto run guide.md` | `sdk.run('./guide.md')` |
| `howto run guide.md --out ./output` | `sdk.runWithOutput('./guide.md', './output')` |
| `howto run guide.md --headful` | `sdk.runHeadful('./guide.md')` |
| `howto run guide.md --dry-run` | `sdk.dryRun('./guide.md')` |
| `howto run guide.md --secrets secrets.json` | `sdk.run('./guide.md', {secrets: {...}})` |
| `howto run guide.md --out ./out --headful --dry-run` | `sdk.run('./guide.md', {outputDir: './out', headful: true, dryRun: true})` |

## Typen

Alle TypeScript-Typen sind aus dem Paket exportiert:

```typescript
import { 
  HowtoSDK,
  GuideResult, 
  GuideConfig, 
  StepResult, 
  StepAction,
  ParsedGuide,
  SDKOptions 
} from 'howto-core';
```

## Fehlerbehandlung

```typescript
try {
  const result = await sdk.run('./guide.md');
} catch (error) {
  if (error instanceof Error) {
    console.error('SDK Fehler:', error.message);
  } else {
    console.error('Unbekannter Fehler:', error);
  }
}
```

Das SDK bietet vollständigen programmatischen Zugriff auf alle CLI-Funktionalitäten und darüber hinaus zusätzliche Convenience-Methoden für die Integration in Node.js-Anwendungen.