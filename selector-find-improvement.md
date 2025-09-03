Ansatz Überblick

- Element‑Corpus: Baue pro DOM‑Element eine textuelle Beschreibung (role, tag, accessibleName, text, placeholder, title/tooltip, section/nearbyText, id/data‑*, href).
- Retrieval (Vektoren): Embeddings der Element‑Beschreibungen → Top‑k Kandidaten zur Query (“label” + optionaler Kontext).
- Re‑Rank (ML, nicht deterministisch): Ein kleines Modell (LogReg/XGBoost oder Cross‑Encoder) bewertet Kandidaten mit Features aus Text‑Semantik + UI‑Merkmalen; gibt
Wahrscheinlichkeiten p(selector|query).
- Synthesis: Aus dem Top‑Kandidaten generiere robuste Selektoren (id/data‑*/role+aria/kurze text‑Selektoren); optional LLM‑Rerank nur on‑tie/low‑confidence.
- Validate + Learn: DOM‑Validierung (sichtbar, actionable). Erfolg/Fehlschlag fließt als Label in das Modell/Memory (online‑Lernen, Replay).

Pipeline (probabilistisch)

- Retrieve: KNN(q, {e_i}) → C = {i1..ik} mit cos‑Scores.
- Re‑Rank: Für jedes c∈C: x_c = [cos, text‑features, a11y‑flags, stabilitätsflags, dom‑tiefe, duplikat‑dichte, kontext‑matches]. p_c = model(x_c).
- Decision: Wähle argmax p_c (oder top‑p sampling), erzeuge Selector‑Set S_c, ordne prior p_c.
- Execute: Teste S_c bis Erfolg; logge Outcome, update Memory/Model.

Learning‑Loop

- Daten: Aus euren Runs “(query, DOM‑snapshot) → gewähltes Element/Selector, Erfolg/Fail, Latenzen”.
- Negatives: Sibling‑Kandidaten, nahe Text‑Duplikate als Hard Negatives.
- Training: Start leicht (LogReg/XGBoost); später Cross‑Encoder (tiny) für besseres Reranking.
- Online‑Update: Inkrementelles Nachtrainieren/Weighing, Confidence‑Thresholds adaptiv.

Unsicherheit & Backoffs

- Confidence < τ_low: Mehr Kandidaten prüfen oder LLM‑Rerank (nur Top‑k Metadaten, kein Full‑DOM).
- Abstain: Wenn p_best zu niedrig → Nutzerhinweis/Fallback auf persistierte “learnedSelectors”.
- Exploration: ε‑greedy in sicheren Umgebungen, um neue stabile Selektoren zu entdecken.

Integration (eure Codebase)

- Neu: SemanticIndex (in‑memory, pro screenFingerprint).
    - API: build(uiGraph|dom), query(label, context, k) -> {elementId, cos}.
- Neu: ModelSelector
    - API: rank(query, candidates, features) -> [{element, p, reasons}].
    - Speist sich aus UIGraphBuilder/DOMSnapshot‑Feldern (ihr habt alles Relevante bereits).
- runner.ts:
    - Ersetze HeuristicSelector.findBestMatches durch: index.query → model.rank → selector synthesize → validate.
    - Behalte SelectorHeuristicsStore als Memory (Persistenz erfolgreicher Selektoren + Fallbacks).
- Optional: AISelectorResolver nur on‑tie/low‑conf; Input ist Top‑k‑Kandidaten, nicht Full‑HTML.

Model/Index Empfehlungen

- Embeddings: lokal, multilingual (bge-small, e5-small) oder zunächst TF‑IDF/char‑ngram für POC.
- Index: FAISS/in‑memory cosine; rebuild bei Navigation/DOM‑Diff.
- Reranker: XGBoost mit 20–40 Features; später kleiner Cross‑Encoder (tiny‑bert).

Selector‑Synthesis (robust)

- Priorisiere: [data-testid] > [data-unique] > #id (nicht generisch) > name (inputs) > [role][aria-label] > a[href] > button:has-text("...") (kurz).
- Generiere 3–5 Varianten; ordne mit p_c.

Wenn du willst, bereite ich ein POC‑Gerüst vor:

- semantic-index.ts (Elementbeschreibung + cosine‑Retrieval),
- model-selector.ts (LogReg/XGBoost‑Stub, Feature‑Extraktor),
- Anpassungen in runner.ts hinter Feature‑Flag,
- Logging für p‑Scores/Confidences, um schnell zu iterieren.