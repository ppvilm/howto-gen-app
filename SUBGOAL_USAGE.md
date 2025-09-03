# Subgoal/Subtask System - Nutzungsanleitung

Das neue Subgoal/Subtask-System ermöglicht hierarchische Aufgabenplanung mit echtem DOM-Zugang für bessere Automatisierung.

## Features

- **Hierarchische Planung**: LLM plant Subgoals basierend auf echtem DOM, dann Subtasks für jedes Subgoal
- **Erfolgskriterien-Verifikation**: Automatische Überprüfung von Erfolgskriterien auf verschiedenen Ebenen
- **Rückwärtskompatibilität**: Feature-Flag-gesteuert, standardmäßig deaktiviert
- **Fallback-Mechanismus**: Automatischer Rückfall zu traditionellem Step-by-Step bei Problemen
- **Re-Planning**: Intelligente Neuplanung bei fehlgeschlagenen Aufgaben

## Aktivierung

```typescript
import { HowtoPrompt } from 'howto-prompt';

const howto = new HowtoPrompt({
  baseUrl: 'https://example.com',
  useSubgoals: true, // Feature-Flag aktivieren
  subgoalConfig: {
    maxSubgoals: 3,
    maxSubtasksPerSubgoal: 5,
    maxStepsPerSubtask: 8,
    maxRetriesPerSubtask: 2,
    fallbackToSteps: true
  }
});

const result = await howto.generate('Erstelle einen neuen Benutzer und logge dich ein');
```

## Architektur-Flow

### Phase A: Initialisierung
- Browser-Start + DOM-Erfassung
- Navigation zur Start-URL

### Phase B: Subgoal-Planung 
- LLM erhält bereinigten, echten DOM (nicht nur UI-Graph)
- Plant 1-3 Subgoals mit Kurz-/Detailbeschreibung
- Definiert Erfolgskriterien für jedes Subgoal

### Phase C: Subtask-Planung
- Für jedes Subgoal: LLM plant 2-5 Subtasks
- Basiert auf aktuellem DOM + UI-Inventory als Kontext
- Definiert Akzeptanzkriterien für jede Subtask

### Phase D: Subtask-Execution
- Schrittweise Ausführung mit bestehendem StepPlanner
- UIInventory aus UIGraph für Element-Erkennung
- Erfolgskriterien-Prüfung nach jedem Schritt

### Phase E: Re-Planning bei Fehlern
- Subtask-Level: Retry mit verbesserter Strategie
- Subgoal-Level: Komplette Neuplanung bei kritischen Fehlern
- Fallback zu traditionellem Step-Modus als letzte Option

## Erfolgskriterien-Arten

### Subgoal-Ebene
- `url_contains:/dashboard` - URL enthält bestimmten Text
- `element_visible:Willkommen` - Element ist sichtbar
- `text_present:Erfolgreich angemeldet` - Text auf Seite vorhanden
- `form_submitted` - Formular wurde abgeschickt
- `page_title:Dashboard` - Seitentitel entspricht Erwartung

### Subtask-Ebene
- `field_filled:username` - Feld wurde ausgefüllt
- `button_clicked:Login` - Button wurde geklickt
- `navigation_occurred` - Navigation fand statt
- `validation_passed` - Keine Validierungsfehler
- `modal_appeared:Bestätigung` - Modal/Dialog erschienen

## Beispiel-Subgoal-Struktur

```json
{
  "subgoals": [
    {
      "id": "subgoal_1",
      "short": "Benutzerregistrierung durchführen",
      "detail": "Navigiere zur Registrierungsseite und erstelle einen neuen Benutzeraccount",
      "successCriteria": [
        "url_contains:/register",
        "form_submitted",
        "text_present:Registrierung erfolgreich"
      ],
      "hints": ["Nutze Registrierungs-Link", "Fülle alle Pflichtfelder aus"],
      "risks": ["Email-Validation", "Captcha möglich"]
    },
    {
      "id": "subgoal_2", 
      "short": "Login mit neuem Account",
      "detail": "Melde dich mit den erstellten Anmeldedaten an",
      "successCriteria": [
        "url_contains:/dashboard",
        "element_visible:Willkommen"
      ]
    }
  ]
}
```

## Beispiel-Subtask-Struktur

```json
{
  "subtasks": [
    {
      "id": "subtask_1",
      "subgoalId": "subgoal_1",
      "short": "Email eingeben",
      "detail": "Gebe eine gültige Email-Adresse in das Email-Feld ein",
      "successCriteria": ["field_filled:email", "validation_passed"],
      "timeout": 10000
    },
    {
      "id": "subtask_2",
      "subgoalId": "subgoal_1", 
      "short": "Registrierung abschicken",
      "detail": "Klicke auf den Registrierungs-Button",
      "successCriteria": ["button_clicked:Register", "navigation_occurred"],
      
      "timeout": 15000
    }
  ]
}
```

## Konfiguration

### Standard-Konfiguration
```typescript
{
  enabled: false, // Standardmäßig deaktiviert
  maxSubgoals: 5,
  maxSubtasksPerSubgoal: 8, 
  maxStepsPerSubtask: 10,
  maxRetriesPerSubtask: 3,
  fallbackToSteps: true
}
```

### Umgebungsvariablen
- `OPENAI_API_KEY` - Erforderlich für LLM-Integration
- Alle bestehenden howto-prompt Umgebungsvariablen bleiben gültig

## Migration

### Bestehende Projekte
Das Subgoal-System ist vollständig rückwärtskompatibel:

```typescript
// ALT - funktioniert weiterhin unverändert
const howto = new HowtoPrompt({ baseUrl: 'https://example.com' });

// NEU - mit Subgoal-System
const howto = new HowtoPrompt({ 
  baseUrl: 'https://example.com',
  useSubgoals: true 
});
```

### Schrittweise Einführung
1. Aktiviere Feature-Flag: `useSubgoals: true`
2. Teste mit einfachen Flows
3. Passe `subgoalConfig` nach Bedarf an
4. Überwache Logs für Fallback-Aktivierungen

## Debugging

### Logs
- `[Orchestrator]` - Subgoal/Subtask-Management
- `[Init]` - System-Initialisierung  
- `[Heuristic]` - Element-Erkennung (wie bisher)

### Häufige Probleme
1. **LLM Provider nicht verfügbar**: Automatischer Fallback zu Step-Modus
2. **Niedrige Confidence**: Warnung in Logs, aber Fortsetzung
3. **Fehlgeschlagene Erfolgskriterien**: Automatic retry oder re-planning
4. **DOM zu groß**: Bestehende Chunking-Strategien werden angewendet

## Limitations

- Erfordert OpenAI API Key für LLM-Funktionen
- Subgoal-Planung kann bei sehr komplexen DOMs mehr Zeit benötigen
- Erfolgskriterien-Prüfung ist konservativ (false negatives möglich)
- Maximal 5 Subgoals pro Intent (konfigurierbar)

## Next Steps

Das System ist erweiterbar für:
- Weitere LLM-Provider (Anthropic, etc.)
- Erweiterte DOM-Analyse-Strategien
- Machine Learning-basierte Erfolgskriterien-Verifikation
- UI-Element-Vorhersage basierend auf Subgoal-Kontext
