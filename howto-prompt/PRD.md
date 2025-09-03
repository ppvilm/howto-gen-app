# PRD: howto-prompt

## 1. Zusammenfassung
- Ziel: Aus Freitext-Prompts automatisch valide How-To Markdown-Skripte generieren, die mit `howto-core` ausgeführt und validiert werden können.
- Ansatz: Planner/Analyzer/Refiner-Schicht über `howto-core`, die UI-Kontext sammelt, Schritte vorschlägt, ausführt, validiert und bei Bedarf nachbessert.
- Besonderheit: Schritte nutzen ausschließlich Labels; Selektorfindung übernimmt `howto-core`. Das `note`-Attribut liefert kompakten Kontext zur Disambiguierung und ist verpflichtend für `type`/`click`.

## 2. Hintergrund & Kontext
- Im Repo existiert `howto-core`, das Markdown-Guides parst, ausführt, Selektoren heuristisch/LLM-basiert ermittelt und Validierung/Artefakte (Screenshots/Video/TTS) erzeugt. Das neue `howto-sdk` stellt eine einheitliche API bereit.
- Beispiel-Guide: `/example-guide-reg.md` zeigt die DSL und `note`-Felder, die bereits von `howto-core` als Kontext genutzt werden.
- `howto-prompt` abstrahiert die Erstellung solcher Guides: Prompt → Schritte mit robusten `label` + aussagekräftigem `note`.

## 3. Ziele
- Prompt → Teilziele → konkrete Steps (goto/type/click/assert_page, optional TTS) mit hochwertigen `note`-Hinweisen.
- Analyzer extrahiert UI-Inventar (Felder/Buttons/Links) inkl. Gruppen/Section-Kontext und Hints, ohne Selektoren zu generieren.
- Validator führt Steps via `howto-core` aus; bei Fehlschlag generiert Refiner gezielte Korrekturen (z.B. Label-Synonyme, alternatives Ziel im selben Kontext, Timing-Anpassung).
- Ergebnis: Stabiles MD-Skript, Steps-JSON und Validierungsreport.

## 4. Nicht-Ziele
- Keine direkte CSS/XPath-Selektor-Generierung (macht `howto-core`).
- Kein Endnutzer-Styling/Video-Authoring (bleibt in `howto-core`).
- Keine Persistenz von Geheimnissen; nur Übergabe via API.

## 5. Nutzer & Use Cases
- QA/DevRel: Schnelles Erstellen von Walkthroughs/Regression-Guides aus kurzen Prompts.
- PM/Support: Klickpfade dokumentieren, die automatisch validiert werden.
- Beispiel: „Gehe zur Login-Seite und logge dich ein; öffne Regression-Übersicht“.

## 6. Hohe Architektur
- Strikter Step-by-Step Loop (Online-Planung, kein Vorplanen des Flows):
  1) Observe: aktuellen Zustand erfassen (URL, UIGraph) – nur Wissen aus besuchter Seite.
  2) Analyze: UI-Inventar dieser Seite bilden (Felder/Buttons/Links + Kontext).
  3) Plan One: genau EINEN nächsten Step vorschlagen (horizon=0/1), basierend auf Prompt-Ziel und aktuellem Wissen.
  4) Execute: Step via `howto-core` ausführen.
  5) Validate: Ergebnis prüfen (URL/Element sichtbar/State-Change), Artefakte sammeln.
  6) Learn: Memory aktualisieren (Synonyme, Gruppen, Navigationswechsel, Erfolg/Fehler).
  7) Decide: Nächsten Step ableiten oder stoppen (Ziel erreicht/Abbruchbedingungen).

- Rollen/Module:
  - Planner-Agent: Plant immer nur den nächsten Step (kein globales Vorplanen), nutzt Prompt-Ziel + Memory + aktuelles UI-Inventar.
  - Analyzer: Erstellt UI-Inventar (Felder, Buttons, Links) inkl. Kontext (Formgroup, Section/Heading, Modal, Nearby-Text, Rolle, Placeholder). Keine Selektoren.
  - Executor/Validator: Führt Steps mit `howto-core` aus, sammelt Ergebnisse, Snapshots.
  - Refiner: Nutzt Fehlersignaturen je Step, um gezielt den EINEN Step zu reparieren (Labels/Synonyme/Timing/Alternative).
  - Memory: Hält nur Wissen aus bereits gesehenen Seiten (screen fingerprints, bekannte Felder/Buttons/Synonyme) – kein „Lookahead“.
  - Provider-Layer: LLM-Abstraktion (OpenAI/Azure/Mock), strikt JSON-I/O.

## 7. Funktionale Anforderungen
- Eingabe: `{ prompt, baseUrl, credentials?, model?, budgets?, headless?, strict? }`.
- Ausgabe: `{ md, steps[], report{ pass/fail je Step, Dauer, Artefaktepfade }, logs }`.
- Pflichtfelder je Step:
  - `goto`: `url`, optional `note`.
  - `type`: `label`, `value`, `note` (verpflichtend), optional `sensitive`.
  - `click`: `label`, `note` (verpflichtend).
  - `assert_page`: `url`, optional `timeout`, `note`.
- Generierungspfad: Prompt → Ziele → Analyzer-Kontext → Steps mit `label` + `note` → Ausführung → Refinement → Finalisierung.
- Online-Planung (wichtig):
  - System plant und validiert strikt Step-für-Step (Horizon 0/1), nutzt ausschließlich Zustand/Erkenntnisse der aktuellen/bereits besuchten Seiten.
  - Kein vollständiger Flow wird im Voraus erzeugt; das MD wächst inkrementell pro validiertem Step.
  - Nach Navigationen wird der UIGraph neu aufgebaut, bevor der nächste Step geplant wird.
  - Memory enthält nur verifizierte Erkenntnisse; keine Spekulation über unbekannte Seiten (z.B. Dashboard-Elemente vor Login).

## 8. DSL-Spezifikation (kompakt)
- Typen (wie `howto-core/src/types.ts`):
  - `goto { url, note?, screenshot?, waitMs? }`
  - `type { label, value, sensitive?, note, screenshot? }`
  - `click { label, note, screenshot? }`
  - `assert_page { url, timeout?, waitMs?, note?, screenshot? }`
  - optional TTS: `tts_start`, `tts_wait` (durchgereicht)

## 9. Note-Spezifikation (kritisch)
- Zweck: Heuristik-Context-Boost in `howto-core` und disambiguierender Kontext im LLM-Fallback.
- Formatvorgabe:
  1) Erste Zeile: Section/Form-Hinweis (SectionHint), exakt/kurz wie UI-Heading/Legend, z.B. „Login“.
  2) Zweite Zeile: kompaktes JSON (ohne Selektoren/Klassen/IDs), z.B.:
     - type: `{ "intent":"type", "field":"Email", "group":"Login form", "synonyms":["email","e-mail","username"], "placeholder":"Email", "roleHint":"textbox", "sensitive":false }`
     - click: `{ "intent":"click", "buttonText":"Login", "group":"Login form", "synonyms":["login","sign in","anmelden"], "submit":true, "priority":"primary", "roleHint":"button" }`
  3) Optional dritte Zeile: kurzer Satz (<= 80 Zeichen).
- Regeln:
  - SectionHint zuerst, 1–3 Wörter; Gesamt kurz (< ~240 Zeichen bevorzugt).
  - Synonyme DE+EN einbeziehen (email/e-mail/username; password/passwort/kennwort; login/sign in/anmelden).
  - Keine CSS-Selektoren/IDs/Klassen im note.
  - Sensitive Felder kennzeichnen (`sensitive:true`).

## 10. Analyzer (ohne Selektoren)
- Liefert UI-Inventar-Objekte:
  - Field: `{ kind:'field', label, htmlType, name?, id?, placeholder?, ariaLabel?, role?, required?, disabled?, group?, section?, visible, hints[] }`
  - Button/Link: `{ kind:'button'|'link', text, ariaLabel?, role, type?, group?, section?, visible, isPrimary?, isSubmit?, hints[] }`
- Gewinnung über `howto-core`-UIGraph (sectionTitle, formGroup, role, accessibleName, placeholder, isPrimary, isSubmit, nearbyText).
- Heuristiken: Label/AccessibleName/Placeholder/Name; Section/Group; Primary/Submit; Modal/Drawer.

## 11. Planner-Agent
- Plant immer nur den nächsten Step (kein Batch‑Plan): mapping auf UI‑Intents (navigate, fill, click, verify) mit Horizon 0/1.
- Basiert auf aktuellem UI-Inventar: wählt passende Feld-/Button-Labels, erzeugt genau EINE Step‑Empfehlung inkl. `note` gemäß Spezifikation.
- Nach erfolgreicher Ausführung aktualisiert er Memory und entscheidet über den nächsten Step. Bei Fehlschlag: Refiner statt „weiterplanen“.
- `assert_page`-Checks werden erst generiert, wenn ein Navigationsziel erreicht/verifiziert werden soll; keine Annahmen über unbekannte Seiten.

## 12. Executor/Validator/Refiner
- Nutzung `howto-core` Runner für Ausführung/Validierung.
- Fehleranalyse: nicht gefunden, nicht sichtbar, Typ-Mismatch, Overlay, URL-Assertion fehlgeschlagen.
- Refiner-Strategien (je Step): Label-Synonyme, Gruppenkontext bevorzugen, alternative Buttons im selben Form/Section, `waitMs`/Reihenfolge anpassen; setzt nur am aktuellen Step an.
- Begrenzte Iterationen, deterministisches Verhalten (niedrige Temperature, Budgets/Timeouts).

### 12.1 Ablauf je Step
```
loop until goal reached or limits:
  observe(); // URL, UIGraph
  analyze(); // UI-Inventar dieser Seite
  step = planOne(); // genau 1 Step mit note
  result = execute(step);
  if (!result.success) step = refine(step, result); retry execute;
  learn(result); // Memory updaten
  appendToMD(step); // nur bestätigte Steps persistieren
```

## 13. API-Design
- `howto(prompt, opts): Promise<{ md: string; steps: StepAction[]; report: ValidationReport }>`
- `streamHowto(prompt, opts): AsyncIterable<Event>`
  - Events: `goal`, `context`, `uiInventory`, `proposedStep`, `executed`, `failed`, `repaired`, `final`.
- Optionen: `{ baseUrl, credentials?, model?, budgets?, strict?, headless? }`.
 - Step-Grenzen: `maxSteps`, `maxRefinesPerStep`, `lookahead` (default 0/1) zur strikten Online-Planung.

## 14. Telemetrie & Reporting
- Pro Step: Dauer, Erfolg, Fehler, angewandte Synonyme/Heuristik, ob LLM-Fallback nötig war.
- Gesamt: Pass/Fail, Flakes, Anzahl Refines, Screenshots/Video-Pfade (`howto-core`).

## 15. Sicherheit & Datenschutz
- Credentials nur über `opts.credentials`/ENV; niemals in Logs oder `note` serialisieren.
- PII-Redaction im Telemetrie-Stream (optional), Masking für `sensitive` Eingaben (`howto-core`-fähig).

## 16. Leistungs-/Zuverlässigkeitsziele
- 95% der einfachen Login-Flows ohne LLM-Fallback (nur Heuristik + gutes `note`).
- < 2 Iterationen im Schnitt für Refine-Loops bei Standard-Apps.
- Zeitbudget/Tokenbudget konfigurierbar; Circuit-Breaker bei hartnäckigen Fehlschlägen.
- Bei Online-Planung: Kein Zugriff/Verweis auf Elemente nicht-besuchter Seiten (z.B. Dashboard vor Login) in Notes/Labels.

## 17. Abhängigkeiten
- `howto-core` (Runner, UIGraph, Heuristik/LLM-Selektor-Fallback, TTS/Video).
- LLM-Provider (OpenAI/Azure) optional für Planung/Refinement.

## 17a. Wiederverwendung howto-core (Integration)
Ziel: Bestehende Fähigkeiten maximal nutzen, eigene Logik nur als dünner Planning-Layer.

- Types/DSL:
  - Reuse `StepAction`, `GuideConfig`, `GuideResult` aus `howto-core/src/types.ts`.
  - Reuse `StepValidator.validateAndNormalizeSteps` zur Vorabprüfung von inkrementell erzeugten Steps.

- Ausführung/Validierung:
  - Reuse `PlaywrightRunner` direkt als langlebigen Executor im Step‑Loop:
    - `initialize(headful?, recordVideo?, videoPath?)` einmalig zu Beginn.
    - pro geplantem Step: `executeStep(step, index, config, screenshotDir, steps)` ausführen und Ergebnis auswerten.
    - Automatischer UI‑Graph Rebuild: passiert bereits in `executeClick` (bei Navigation) und `executeAssertPage` (explizit), inkl. Lookahead‑Prüfung des nächsten Steps.
    - `close()` am Ende; optional `startVideoRecording(...)` nach erster Navigation (wie in `HowtoGenerator`).

- Parser/Renderer/Artifacts:
  - Reuse `MarkdownParser` zum Parsen (falls vorhandene MD‑Vorlage genutzt wird).
  - Reuse `MarkdownRenderer.generateStepsBlock` + `injectStepsIntoMarkdown` zur finalen MD‑Erzeugung aus `StepResult[]`.
  - Reuse `ArtifactManager` für temporäre Dateien/Screenshots/Logs; denselben `outputDir` verwenden.
  - Optional: Reuse `VideoService`/`TTSService` (durchreichen), wenn TTS/Video gewünscht.

- UI‑Analyse (Inventar für Notes): Zwei Optionen
  1) Heuristik‑basiert (ohne LLM):
     - Reuse `UIGraphBuilder.buildUIGraph(page)` um Felder/Buttons/Links + Kontext (sectionTitle, formGroup, isPrimary, isSubmit, nearbyText, roles) zu bekommen.
     - Aus diesen Daten `note` generieren (SectionHint + JSON mit intent/field/buttonText/synonyms/…)
  2) DOM‑Snapshot + LLM:
     - Reuse `DOMSnapshot.capture(page)` und `DOMSnapshot.cleanForAI(...)` oder vergleichbar gesäubertes HTML, um einen schlanken DOM‑Kontext zu erzeugen.
     - LLM extrahiert UI‑Inventar/Intents; wir mappen auf `note`‑Format.

- Selektor‑Finden (nicht unsere Aufgabe):
  - Reuse `HeuristicSelector` + optional `AISelectorResolver` über `PlaywrightRunner` (already wired). `note` wird als Kontext übergeben und in Heuristik/LLM‑Fallback genutzt.

- SDK High‑Level:
  - Für „alles aus einer MD“ gibt es `HowtoSDK.run(...)`/`runFromContent(...)`.
  - In `howto-prompt` bevorzugen wir jedoch direkten `PlaywrightRunner` für einen echten Step‑by‑Step‑Online‑Loop (ein Browser‑Kontext, keine Neustarts).

### Benötigte (kleine) Erweiterungen in howto-core (empfohlen)
- Public Accessor für Page/Snapshot:
  - `PlaywrightRunner.getPage(): Page` ODER Hilfsmethode `captureSnapshot(): DOMElement` ODER `buildUIGraph(): UIGraph`.
  - Zweck: Analyzer kann ohne zweiten Browser‑Kontext UI‑Inventar bauen.
- Optionaler Hook:
  - `PlaywrightRunner.refreshUIGraph()` um außerhalb eines Click/AssertPage den UI‑Graph explizit zu aktualisieren (Observe‑Phase).

## 18. Meilensteine
- M0 – Skeleton & Types: Paketstruktur, UI-Inventar-/Note-Typen, Mock-Provider.
- M1 – Analyzer v1: Inventar aus UIGraph ableiten, Note-Builder.
- M2 – Planner v1: Login/Navigation/Form-Fill, Note gemäß Spezifikation.
- M3 – Executor/Validator/Refiner: Glue zu `howto-core`, einfacher Refinement-Loop.
- M4 – Stabilität/Telemetry: Limits, Reporting, deterministische Tests mit DOM-Fixtures.
- M5 – Docs/Beispiele: Quickstart, Beispiele (Login, Suche/Filter, Regression-Aufruf).

## 19. Akzeptanzkriterien
- Aus Prompt „Gehe zur Login-Seite und logge dich ein. Öffne Regression-Übersicht.“ entsteht ein MD-Guide, der:
  - Steps mit `label` + `note` (gemäß Format) enthält.
  - In Zielumgebung erfolgreich durch `howto-core` ausgeführt wird (Dashboard-Assertion, Navigation zur Regression-Seite).
  - Bei initialem Fehlschlag den Flow mit max. N (konfigurierbar) Refinements stabilisiert.
- Notes enthalten SectionHint als erste Zeile und ein valides JSON in Zeile 2; keine Selektoren/Klassen/IDs.
- Online-Planung belegt: Der Agent plant und bestätigt jeden Step sequenziell; es werden keine späteren Steps vorab erzeugt oder persistiert.

## 20. Risiken & Gegenmaßnahmen
- Uneinheitliche UI-Texte: Synonyme (DE/EN) + Group/Section-Hinweise mindern Ambiguität.
- Dynamische DOMs: Rebuild UIGraph, `assert_page`+Lookahead, `waitMs`.
- Over-reliance auf LLM: Heuristiken priorisieren, deterministische Prompts, strikte JSON-Ausgaben.

## 21. Offene Fragen
- Welche Login-Varianten (MFA/SSO) v1? Wie mit interaktiven MFA umgehen?
- Sollen wir `assert` auf sichtbaren Text/Elemente zusätzlich zu `assert_page` generieren?
- Output-Format: Nur MD oder MD+Frontmatter+eingebettete JSON-Blöcke für Debug?
