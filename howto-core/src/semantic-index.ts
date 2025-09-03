import OpenAI from 'openai';
import { pipeline, env } from '@xenova/transformers';
import { LocalIndex } from 'vectra';
import { 
  SemanticIndex, 
  SectionIndex, 
  ElementIndex, 
  QuerySpec, 
  EvidenceItem, 
  EvidencePack 
} from './types';
import { UIGraph, UIElement } from './ui-graph-builder';

// Disable local models cache to avoid storage issues
env.allowLocalModels = false;
env.allowRemoteModels = true;

export interface SemanticIndexConfig {
  openaiApiKey?: string;
  useLocalEmbeddings?: boolean;
  indexPath?: string;
  embeddingModel?: string;
  dimensions?: number;
}

export class SemanticIndexBuilder {
  private openaiClient?: OpenAI;
  private localEmbedder?: any;
  private config: SemanticIndexConfig;
  private sectionIndex?: LocalIndex;
  private elementIndex?: LocalIndex;
  private embeddingCache = new Map<string, number[]>();

  constructor(config: SemanticIndexConfig = {}) {
    this.config = {
      useLocalEmbeddings: false,
      embeddingModel: 'text-embedding-3-small',
      dimensions: 1536,
      ...config
    };

    if (config.openaiApiKey && !config.useLocalEmbeddings) {
      this.openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
    }
  }

  async initialize(): Promise<void> {
    try {
      // Initialize embedding provider
      if (this.config.useLocalEmbeddings) {
        console.log('[SemanticIndex] Initializing local embeddings...');
        this.localEmbedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      }

      // Initialize vector indices with explicit dimensions
      this.sectionIndex = new LocalIndex('./temp/sections-index');
      this.elementIndex = new LocalIndex('./temp/elements-index');
      
      // Ensure indices are created
      await this.ensureVectraIndices();

      console.log('[SemanticIndex] Initialized successfully');
    } catch (error) {
      console.error('[SemanticIndex] Initialization failed:', error);
      throw error;
    }
  }

  async buildIndex(uiGraph: UIGraph): Promise<SemanticIndex> {
    const startTime = Date.now();
    console.log('[SemanticIndex] Building semantic index...');

    // Extract sections from landmarks and headings
    const sections = await this.extractSections(uiGraph);
    
    // Extract interactive elements
    const elements = await this.extractElements(uiGraph);

    // Collect all texts for deduplication and batching
    const sectionTexts = sections.map(section => ({ type: 'section', item: section, text: section.text }));
    const elementTexts = elements.map(element => ({ type: 'element', item: element, text: this.buildElementText(element) }));
    const allTexts = [...sectionTexts, ...elementTexts];

    // Generate embeddings in batches
    await this.generateEmbeddingsBatch(allTexts);

    // Index sections and elements
    const indexPromises: Promise<void>[] = [];
    
    for (const section of sections) {
      if (section.embedding) {
        indexPromises.push(this.indexSection(section));
      }
    }
    
    for (const element of elements) {
      if (element.embedding) {
        indexPromises.push(this.indexElement(element));
      }
    }

    // Wait for all indexing operations
    await Promise.all(indexPromises);

    const index: SemanticIndex = {
      sections,
      elements,
      url: uiGraph.url,
      timestamp: Date.now(),
      fingerprint: this.generateFingerprint(uiGraph)
    };

    console.log(`[SemanticIndex] Built index with ${sections.length} sections, ${elements.length} elements in ${Date.now() - startTime}ms`);
    return index;
  }

  async search(query: QuerySpec, index: SemanticIndex): Promise<EvidencePack> {
    const startTime = Date.now();
    const k = query.k || 30;
    
    // Generate query embedding
    const queryText = this.buildQueryText(query);
    const queryEmbeddings = await this.generateEmbeddingBatch([queryText]);
    const queryEmbedding = queryEmbeddings[0];

    let evidence: EvidenceItem[] = [];

    // Stage 1: Coarse section search (if we have section hints)
    if (query.filters?.sectionHint) {
      const sectionResults = await this.searchSections(queryEmbedding, Math.min(10, k));
      evidence.push(...sectionResults);
    }

    // Stage 2: Fine element search
    const elementResults = await this.searchElements(queryEmbedding, query, index, k);
    evidence.push(...elementResults);

    // Apply filters and reranking
    evidence = this.applyFilters(evidence, query);
    evidence = this.rerank(evidence, query);
    evidence = evidence.slice(0, k);

    const pack: EvidencePack = {
      items: evidence,
      query,
      totalItems: evidence.length,
      searchLatencyMs: Date.now() - startTime
    };

    return pack;
  }

  private async extractSections(uiGraph: UIGraph): Promise<SectionIndex[]> {
    const sections: SectionIndex[] = [];
    
    console.log(`[SemanticIndex] Extracting sections from ${uiGraph.landmarkStructure.length} landmarks`);
    
    // Extract from landmark structure
    for (let i = 0; i < uiGraph.landmarkStructure.length; i++) {
      const landmark = uiGraph.landmarkStructure[i];
      
      // Find elements in this section
      const sectionElements = uiGraph.elements.filter(el => 
        el.sectionTitle === landmark || 
        (el.nearbyText && el.nearbyText.some(text => text.includes(landmark)))
      );
      
      const roles = [...new Set(sectionElements.map(el => el.role).filter(Boolean))] as string[];
      const anchorSelectors = sectionElements
        .filter(el => el.candidateSelectors.length > 0)
        .map(el => el.candidateSelectors[0])
        .slice(0, 3); // Top 3 anchors per section

      sections.push({
        title: landmark,
        text: this.buildSectionText(landmark, sectionElements),
        roles,
        anchorSelectors,
        position: { start: i * 100, end: (i + 1) * 100 } // Rough positioning
      });
    }

    // If no landmarks found, create a fallback page section
    if (sections.length === 0) {
      console.log('[SemanticIndex] No landmarks found, creating fallback page section');
      const interactiveElements = uiGraph.elements.filter(el => 
        el.clickable || el.contentEditable || el.tag === 'input' || el.tag === 'textarea'
      );
      
      const roles = [...new Set(interactiveElements.map(el => el.role).filter(Boolean))] as string[];
      const anchorSelectors = interactiveElements
        .filter(el => el.candidateSelectors.length > 0)
        .map(el => el.candidateSelectors[0])
        .slice(0, 3);

      sections.push({
        title: 'Main Page Content',
        text: this.buildSectionText('Main Page Content', interactiveElements),
        roles,
        anchorSelectors,
        position: { start: 0, end: 100 }
      });
    }

    return sections;
  }

  private async extractElements(uiGraph: UIGraph): Promise<ElementIndex[]> {
    const elements: ElementIndex[] = [];

    console.log(`[SemanticIndex] Processing ${uiGraph.elements.length} UI elements`);
    let skippedNonInteractive = 0;
    let skippedNoLabel = 0;
    let hiddenFieldsProcessed = 0;

    for (const uiElement of uiGraph.elements) {
      // Only index interactive elements and hidden input fields
      const isHiddenInput = uiElement.tag === 'input' && uiElement.type === 'hidden';
      if (!uiElement.clickable && !uiElement.contentEditable && uiElement.tag !== 'input' && uiElement.tag !== 'textarea' && !isHiddenInput) {
        skippedNonInteractive++;
        continue;
      }

      const label = this.extractElementLabel(uiElement);
      if (!label || label.trim().length === 0) {
        skippedNoLabel++;
        console.log(`[SemanticIndex] Skipping element with no label: ${uiElement.tag} (clickable: ${uiElement.clickable}, role: ${uiElement.role})`);
        continue;
      }

      let interactionType: 'click' | 'type' | 'both' | 'hidden' = 'click';
      if (isHiddenInput) {
        interactionType = 'hidden';
        hiddenFieldsProcessed++;
      } else if (uiElement.tag === 'input' || uiElement.tag === 'textarea' || uiElement.contentEditable) {
        interactionType = uiElement.clickable ? 'both' : 'type';
      }

      elements.push({
        label,
        role: uiElement.role || uiElement.tag,
        selector: uiElement.candidateSelectors[0] || `${uiElement.tag}[data-unknown]`,
        candidateSelectors: uiElement.candidateSelectors,
        section: uiElement.sectionTitle,
        group: uiElement.formGroup,
        visible: uiElement.visible,
        inViewport: uiElement.inViewport,
        activeTab: uiElement.isInActiveTab,
        stability: uiElement.stability,
        interactionType
      });
    }

    console.log(`[SemanticIndex] Element extraction complete: ${elements.length} indexed, ${skippedNonInteractive} non-interactive, ${skippedNoLabel} no-label, ${hiddenFieldsProcessed} hidden fields`);
    
    // Debug: Show what elements were indexed with keyword highlighting
    if (elements.length > 0) {
      console.log('[SemanticIndex] Indexed elements:');
      elements.forEach((el, idx) => {
        const hasRegressionKeyword = el.label.toLowerCase().includes('regression') || el.label.toLowerCase().includes('test');
        const highlight = hasRegressionKeyword ? '🎯 ' : '   ';
        console.log(`${highlight}${idx + 1}. "${el.label}" (${el.role}) - selector: ${el.selector}`);
      });
      
      // Count regression-related elements
      const regressionElements = elements.filter(el => 
        el.label.toLowerCase().includes('regression') || 
        el.label.toLowerCase().includes('test')
      );
      console.log(`[SemanticIndex] Found ${regressionElements.length} regression/test-related elements out of ${elements.length} total`);
    }
    
    return elements;
  }

  private buildSectionText(title: string, elements: UIElement[]): string {
    const elementTexts = elements
      .map(el => this.extractElementLabel(el))
      .filter(Boolean)
      .slice(0, 10); // Limit to avoid very long texts

    return `${title}. ${elementTexts.join(', ')}`;
  }

  private buildElementText(element: ElementIndex): string {
    // Optimize for shorter, more focused text chunks
    const parts = [element.label];
    if (element.role && element.role !== element.label) {
      parts.push(element.role);
    }
    if (element.section && element.section !== element.label) {
      parts.push(element.section);
    }
    return parts.join(' ').substring(0, 200); // Limit to 200 chars for faster processing
  }

  private extractElementLabel(uiElement: UIElement): string {


    // Clean and validate accessible name first (most reliable)
    const accessibleName = uiElement.accessibleName?.trim();
    if (accessibleName && accessibleName.length > 0 && !this.isGenericText(accessibleName)) {
      return accessibleName;
    }

    // Try other direct label sources
    const directLabels = [
      uiElement.label?.trim(),
      uiElement.placeholder?.trim(),
      uiElement.title?.trim(),
      uiElement.text?.trim(),
      uiElement.textContent?.trim()
    ].filter(label => label && label.length > 0 && !this.isGenericText(label));

    if (directLabels.length > 0) {
      return directLabels[0]!;
    }

    // Try nearbyText first (most likely to contain actual labels)
    if (uiElement.nearbyText && uiElement.nearbyText.length > 0) {
      for (const nearbyText of uiElement.nearbyText) {
        const cleaned = nearbyText?.trim();
        if (cleaned && cleaned.length > 2 && !this.isGenericText(cleaned)) {
          return cleaned;
        }
      }
    }

    // For form elements, try enhanced label discovery
    if (this.isFormElement(uiElement)) {
      const formLabel = this.findFormElementLabel(uiElement);
      if (formLabel) {
        return formLabel;
      }
    }

    // For select/dropdown elements with data-unique, try enhanced discovery
    if (this.isSelectElement(uiElement)) {
      const selectLabel = this.findSelectElementLabel(uiElement);
      if (selectLabel) {
        return selectLabel;
      }
    }

    // For hidden fields, try to find nearest label
    if (uiElement.tag === 'input' && uiElement.type === 'hidden') {
      const nearestLabel = this.findNearestLabel(uiElement);
      if (nearestLabel) {
        return `${nearestLabel} (hidden)`;
      }
    }
    
    // Fallback: Try to generate meaningful label from selectors/attributes
    if (uiElement.candidateSelectors && uiElement.candidateSelectors.length > 0) {
      const selector = uiElement.candidateSelectors[0];
      
      // Extract meaningful parts from selectors
      if (selector.includes('username') || selector.includes('user') || selector.includes('email')) {
        return 'Username/Email Field';
      }
      if (selector.includes('password') || selector.includes('pwd')) {
        return 'Password Field';
      }
      if (selector.includes('login') || selector.includes('submit')) {
        return 'Login Button';
      }
      if (selector.includes('name=')) {
        const nameMatch = selector.match(/name=['"]([^'"]+)['"]/);
        if (nameMatch) {
          return `${nameMatch[1]} field`;
        }
      }
      if (selector.includes('id=')) {
        const idMatch = selector.match(/id=['"]([^'"]+)['"]/);
        if (idMatch) {
          return `${idMatch[1]} element`;
        }
      }
    }
    
    // Final fallback: use tag name and role
    const tagRole = uiElement.role || uiElement.tag || 'element';
    return `${tagRole} element`;
  }

  private findNearestLabel(hiddenElement: UIElement): string | null {
    // Extract name/id from the hidden field for label association
    const fieldName = hiddenElement.name || hiddenElement.id;
    if (!fieldName) return null;

    // Check nearby text for potential labels
    if (hiddenElement.nearbyText && hiddenElement.nearbyText.length > 0) {
      // Look for text that might be related to this field
      for (const text of hiddenElement.nearbyText) {
        if (text && text.trim().length > 0) {
          // Skip generic text, prefer descriptive labels
          if (![':', 'submit', 'button', 'click', 'here'].includes(text.toLowerCase().trim())) {
            return text.trim();
          }
        }
      }
    }

    // Try to extract meaningful name from field name/id
    if (fieldName) {
      // Convert camelCase or snake_case to readable format
      const readable = fieldName
        .replace(/([A-Z])/g, ' $1') // camelCase
        .replace(/_/g, ' ') // snake_case
        .replace(/-/g, ' ') // kebab-case
        .toLowerCase()
        .trim();
      
      if (readable.length > 1) {
        return readable;
      }
    }

    return null;
  }

  private isGenericText(text: string): boolean {
    // Filter out generic/useless text that shouldn't be used as labels
    const generic = [
      '​', // Zero-width space
      '\u200b', // Zero-width space
      '', // Empty
      ' ', // Just space
      '...', // Ellipsis
      'button', // Generic button text
      'element', // Generic element text
      'click', // Generic action text
      'submit', // Too generic
      'div', // Tag names
      'span',
      'input'
    ];
    
    const trimmed = text.trim().toLowerCase();
    return generic.includes(trimmed) || trimmed.length === 0;
  }

  private isFormElement(uiElement: UIElement): boolean {
    return uiElement.tag === 'input' || 
           uiElement.tag === 'textarea' || 
           uiElement.tag === 'select' ||
           Boolean(uiElement.contentEditable);
  }

  private isSelectElement(uiElement: UIElement): boolean {
    return uiElement.tag === 'select' ||
           uiElement.role === 'combobox' ||
           uiElement.role === 'listbox' ||
           Boolean(uiElement.dataUnique && (
             uiElement.dataUnique.includes('sel') ||
             uiElement.dataUnique.includes('Select') ||
             uiElement.dataUnique.includes('Dropdown')
           ));
  }

  private findFormElementLabel(uiElement: UIElement): string | null {
    // Use nearbyText to find associated labels
    if (uiElement.nearbyText && uiElement.nearbyText.length > 0) {
      // Look for meaningful nearby text that could be a label
      for (const text of uiElement.nearbyText) {
        const cleaned = text?.trim();
        if (cleaned && cleaned.length > 2 && !this.isGenericText(cleaned)) {
          // Prefer text that looks like a label (ends with colon, contains descriptive words)
          if (cleaned.endsWith(':') || cleaned.includes('Field') || cleaned.includes('Enter')) {
            return cleaned.replace(':', '').trim();
          }
        }
      }
      
      // Fallback to first meaningful nearby text
      const meaningfulText = uiElement.nearbyText.find(text => {
        const cleaned = text?.trim();
        return cleaned && cleaned.length > 2 && !this.isGenericText(cleaned);
      });
      
      if (meaningfulText) {
        return meaningfulText.trim();
      }
    }
    
    return null;
  }

  private findSelectElementLabel(uiElement: UIElement): string | null {
    // For custom select components, try multiple strategies
    
    // 1. Check data-unique for semantic info
    if (uiElement.dataUnique) {
      const dataUnique = uiElement.dataUnique;
      
      // Extract semantic parts from data-unique names like "selTestProjectRegisterChatbot"
      const semanticMatch = dataUnique.match(/sel.*?([A-Z][a-z]+(?:[A-Z][a-z]+)*)/);
      if (semanticMatch) {
        // Convert camelCase to readable: "TestProjectRegisterChatbot" -> "Test Project Register Chatbot"
        const readable = semanticMatch[1]
          .replace(/([A-Z])/g, ' $1')
          .trim()
          .toLowerCase();
        if (readable.length > 3) {
          return this.capitalizeWords(readable);
        }
      }
    }
    
    // 2. Use nearbyText for labels (most reliable for custom components)
    return this.findFormElementLabel(uiElement);
  }

  private capitalizeWords(text: string): string {
    return text.replace(/\b\w/g, l => l.toUpperCase());
  }

  private buildQueryText(query: QuerySpec): string {
    const parts = [`intent:${query.intent}`, ...query.keywords];
    if (query.filters?.sectionHint) {
      parts.push(`section:${query.filters.sectionHint}`);
    }
    return parts.join(' ');
  }

  private async generateEmbeddingsBatch(textItems: Array<{ type: string, item: any, text: string }>): Promise<void> {
    const BATCH_SIZE = 20; // OpenAI allows up to 2048 inputs per request, but smaller batches are more manageable
    console.log(`[SemanticIndex] Processing ${textItems.length} texts in batches of ${BATCH_SIZE}`);

    // Deduplicate texts to avoid redundant API calls
    const uniqueTexts = new Map<string, Array<{ type: string, item: any }>>();
    for (const textItem of textItems) {
      const text = textItem.text.trim();
      if (text.length === 0) continue;
      
      if (!uniqueTexts.has(text)) {
        uniqueTexts.set(text, []);
      }
      uniqueTexts.get(text)!.push(textItem);
    }

    console.log(`[SemanticIndex] Deduplicated ${textItems.length} texts to ${uniqueTexts.size} unique texts`);

    const uniqueTextArray = Array.from(uniqueTexts.keys());
    const batches = [];
    for (let i = 0; i < uniqueTextArray.length; i += BATCH_SIZE) {
      batches.push(uniqueTextArray.slice(i, i + BATCH_SIZE));
    }

    console.log(`[SemanticIndex] Processing ${batches.length} batches`);

    // Process batches in parallel (but limit concurrency to avoid rate limits)
    const CONCURRENT_BATCHES = 3;
    for (let i = 0; i < batches.length; i += CONCURRENT_BATCHES) {
      const concurrentBatches = batches.slice(i, i + CONCURRENT_BATCHES);
      
      await Promise.all(concurrentBatches.map(async (batch, batchIndex) => {
        try {
          const embeddings = await this.generateEmbeddingBatch(batch);
          
          // Assign embeddings back to all items with the same text
          batch.forEach((text, textIndex) => {
            if (embeddings[textIndex]) {
              this.embeddingCache.set(text, embeddings[textIndex]);
              
              // Assign to all items with this text
              const items = uniqueTexts.get(text) || [];
              items.forEach(({ item }) => {
                item.embedding = embeddings[textIndex];
              });
            }
          });
          
          console.log(`[SemanticIndex] Completed batch ${i + batchIndex + 1}/${batches.length}`);
        } catch (error) {
          console.warn(`[SemanticIndex] Failed to process batch ${i + batchIndex + 1}:`, error);
          // Continue with other batches
        }
      }));
    }
  }

  private async generateEmbeddingBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Check cache first
    const cachedResults: number[][] = [];
    const uncachedTexts: string[] = [];
    const uncachedIndices: number[] = [];

    texts.forEach((text, index) => {
      if (this.embeddingCache.has(text)) {
        cachedResults[index] = this.embeddingCache.get(text)!;
      } else {
        uncachedTexts.push(text);
        uncachedIndices.push(index);
      }
    });

    if (uncachedTexts.length === 0) {
      return cachedResults;
    }

    try {
      if (this.config.useLocalEmbeddings && this.localEmbedder) {
        const results = await Promise.all(
          uncachedTexts.map(text => this.localEmbedder(text, { pooling: 'mean', normalize: true }))
        );
        const embeddings = results.map(result => Array.from(result.data) as number[]);
        
        // Cache and assign results
        uncachedIndices.forEach((originalIndex, uncachedIndex) => {
          const embedding = embeddings[uncachedIndex];
          this.embeddingCache.set(uncachedTexts[uncachedIndex], embedding);
          cachedResults[originalIndex] = embedding;
        });
      } else if (this.openaiClient) {
        // Limit text length for faster processing
        const limitedTexts = uncachedTexts.map(text => text.substring(0, 1000));
        
        const response = await this.openaiClient.embeddings.create({
          model: this.config.embeddingModel!,
          input: limitedTexts
        });
        
        // Cache and assign results
        uncachedIndices.forEach((originalIndex, uncachedIndex) => {
          const embedding = response.data[uncachedIndex].embedding;
          this.embeddingCache.set(uncachedTexts[uncachedIndex], embedding);
          cachedResults[originalIndex] = embedding;
        });
      } else {
        throw new Error('No embedding provider configured');
      }
    } catch (error) {
      console.error('[SemanticIndex] Batch embedding generation failed:', error);
      throw error;
    }

    return cachedResults;
  }

  private async indexSection(section: SectionIndex): Promise<void> {
    if (!this.sectionIndex || !section.embedding) return;

    await this.sectionIndex.upsertItem({
      id: `section_${section.title.replace(/[^a-zA-Z0-9]/g, '_')}`,
      vector: section.embedding,
      metadata: {
        title: section.title,
        text: section.text,
        roles: section.roles,
        type: 'section'
      }
    });
  }

  private async indexElement(element: ElementIndex): Promise<void> {
    if (!this.elementIndex || !element.embedding) return;

    const itemToIndex = {
      id: `element_${element.label.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`,
      vector: element.embedding,
      metadata: {
        label: element.label,
        role: element.role,
        selector: element.selector,
        section: element.section,
        group: element.group,
        visible: element.visible,
        type: 'element'
      }
    };
    
    await this.elementIndex.upsertItem(itemToIndex);
  }

  private async searchSections(queryEmbedding: number[], k: number): Promise<EvidenceItem[]> {
    if (!this.sectionIndex) return [];

    const results = await this.sectionIndex.queryItems(queryEmbedding, k);
    
    return results.map((result: any, index: number) => ({
      id: result.item.id || `section_${index}`,
      label: result.item.metadata?.title || 'Unknown Section',
      role: 'section',
      snippet: (result.item.metadata?.text || '').substring(0, 200),
      selectorCandidates: [],
      section: result.item.metadata?.title || undefined,
      score: 1 - (result.score || 0), // Convert distance to similarity
      type: 'section' as const
    })).filter(item => item.label !== 'Unknown Section'); // Filter out items with missing metadata
  }

  private async searchElements(
    queryEmbedding: number[], 
    query: QuerySpec, 
    _index: SemanticIndex, 
    k: number
  ): Promise<EvidenceItem[]> {
    if (!this.elementIndex) {
      console.log('[SemanticIndex] No element index available for search');
      return [];
    }

    console.log(`[SemanticIndex] Searching ${k * 2} elements with query: ${JSON.stringify(query)}`);
    console.log(`[SemanticIndex] Query embedding first 5 dimensions: [${queryEmbedding.slice(0, 5).map(x => x.toFixed(3)).join(', ')}...]`);
    const results = await this.elementIndex.queryItems(queryEmbedding, k * 2); // Get more for filtering
    
    console.log(`[SemanticIndex] Raw Vectra results: ${results.length} items`);
    if (results.length > 0) {
      results.slice(0, 3).forEach((result: any, idx: number) => {
        const hasMetadata = result.item.metadata !== undefined && result.item.metadata !== null;
        const elementEmbeddingPreview = result.item.vector ? `[${result.item.vector.slice(0, 3).map((x: number) => x.toFixed(3)).join(', ')}...]` : 'none';
        console.log(`  ${idx + 1}. "${result.item.metadata?.label || 'No Label'}" (score: ${result.score?.toFixed(3)}) - role: ${result.item.metadata?.role} - embedding: ${elementEmbeddingPreview} - metadata: ${hasMetadata ? 'YES' : 'NO'}`);
        if (!hasMetadata) {
          console.error(`    Missing metadata for ID: ${result.item.id}, vector length: ${result.item.vector?.length}`);
        }
      });
    } else {
      console.warn('[SemanticIndex] No results returned from Vectra search');
    }

    const processedResults = results.map((result: any, index: number) => {
      const hasMetadata = result.item.metadata !== undefined && result.item.metadata !== null;
      if (!hasMetadata) {
        console.warn(`[SemanticIndex] Missing metadata for result ${index}:`, result);
      }
      
      const label = result.item.metadata?.label || 'Unknown Element';
      let baseScore = 1 - (result.score || 0); // Convert distance to similarity
      
      // Apply keyword-based score boosting
      const boostedScore = this.applyKeywordBoost(baseScore, label, query);
      
      return {
        id: result.item.id || `element_${index}`,
        label,
        role: result.item.metadata?.role || 'unknown',
        snippet: result.item.metadata?.label || 'No description',
        selectorCandidates: [result.item.metadata?.selector || ''],
        section: result.item.metadata?.section || undefined,
        score: boostedScore,
        type: 'element' as const
      };
    }).filter(item => item.label !== 'Unknown Element'); // Filter out items with no metadata
    
    console.log(`[SemanticIndex] Processed results: ${processedResults.length}/${results.length} with valid metadata`);
    if (processedResults.length > 0) {
      console.log(`[SemanticIndex] Sample results:`, processedResults.slice(0, 3).map(r => ({
        label: r.label,
        role: r.role,
        score: r.score.toFixed(3)
      })));
    } else {
      console.error('[SemanticIndex] No valid results after metadata filtering');
    }
    
    return processedResults;
  }

  private applyFilters(evidence: EvidenceItem[], query: QuerySpec): EvidenceItem[] {
    let filtered = evidence;

    // Apply role filters
    if (query.filters?.role && query.filters.role.length > 0) {
      filtered = filtered.filter(item => 
        query.filters!.role!.includes(item.role)
      );
    }

    // Apply visibility constraints
    if (query.constraints?.mustBeVisible) {
      // This would need to be cross-referenced with actual element state
      // For now, just prefer elements that are likely visible
      filtered = filtered.filter(item => item.type === 'section' || item.score > 0.3);
    }

    // Apply negative filters
    if (query.filters?.negative && query.filters.negative.length > 0) {
      filtered = filtered.filter(item => 
        !query.filters!.negative!.some(neg => 
          item.label.toLowerCase().includes(neg.toLowerCase()) ||
          item.role.toLowerCase().includes(neg.toLowerCase())
        )
      );
    }

    return filtered;
  }

  private rerank(evidence: EvidenceItem[], query: QuerySpec): EvidenceItem[] {
    // Simple reranking based on multiple factors
    return evidence.sort((a, b) => {
      let scoreA = a.score;
      let scoreB = b.score;

      // Boost elements that match intent
      if (query.intent === 'click' && a.type === 'element') scoreA += 0.1;
      if (query.intent === 'click' && b.type === 'element') scoreB += 0.1;
      if (query.intent === 'type' && a.role === 'textbox') scoreA += 0.1;
      if (query.intent === 'type' && b.role === 'textbox') scoreB += 0.1;

      // Boost viewport elements
      if (a.type === 'element') scoreA += 0.05;
      if (b.type === 'element') scoreB += 0.05;

      return scoreB - scoreA;
    });
  }

  private applyKeywordBoost(baseScore: number, label: string, query: QuerySpec): number {
    if (!query.keywords || query.keywords.length === 0) {
      return baseScore;
    }

    const labelLower = label.toLowerCase();
    let boost = 0;

    // Check for exact keyword matches
    for (const keyword of query.keywords) {
      const keywordLower = keyword.toLowerCase();
      
      // Exact match (case-insensitive) gets highest boost
      if (labelLower === keywordLower) {
        boost += 0.3;
      }
      // Contains keyword gets medium boost  
      else if (labelLower.includes(keywordLower)) {
        boost += 0.2;
      }
      // Starts with keyword gets high boost
      else if (labelLower.startsWith(keywordLower)) {
        boost += 0.25;
      }
    }

    // Additional boost for role matching
    if (query.filters?.role && query.filters.role.includes(label.toLowerCase())) {
      boost += 0.1;
    }

    const boostedScore = Math.min(1.0, baseScore + boost);
    
    // Log significant boosts for debugging
    if (boost > 0.1) {
      console.log(`[SemanticIndex] Keyword boost: "${label}" ${baseScore.toFixed(3)} → ${boostedScore.toFixed(3)} (boost: +${boost.toFixed(3)})`);
    }

    return boostedScore;
  }

  private generateFingerprint(uiGraph: UIGraph): string {
    // Simple fingerprint based on URL and element count
    const elementCount = uiGraph.elements.length;
    const interactiveCount = uiGraph.elements.filter(el => el.clickable || el.contentEditable).length;
    
    // Include field states to detect when form fields are filled
    const filledFieldsHash = uiGraph.elements
      .filter(el => el.type === 'input' || el.type === 'textarea')
      .map(el => `${el.name || el.id}:${el.value ? 'filled' : 'empty'}`)
      .sort()
      .join('|');
    
    // Add code version to invalidate cache when extraction logic changes
    const codeVersion = 'v2_enhanced_labels';
      
    return `${uiGraph.url}_${elementCount}_${interactiveCount}_${filledFieldsHash}_${uiGraph.timestamp}_${codeVersion}`;
  }

  private async ensureVectraIndices(): Promise<void> {
    try {
      // Delete existing indices to force recreation and fix metadata issues
      if (this.sectionIndex) {
        try {
          await this.sectionIndex.deleteIndex();
          console.log('[SemanticIndex] Deleted existing sections index');
        } catch (e) {
          // Index might not exist, which is fine
        }
        await this.sectionIndex.createIndex();
        console.log('[SemanticIndex] Created new sections index');
      }
      if (this.elementIndex) {
        try {
          await this.elementIndex.deleteIndex();
          console.log('[SemanticIndex] Deleted existing elements index');
        } catch (e) {
          // Index might not exist, which is fine
        }
        await this.elementIndex.createIndex();
        console.log('[SemanticIndex] Created new elements index');
      }
      console.log('[SemanticIndex] Vectra indices recreated successfully');
    } catch (error) {
      console.error('[SemanticIndex] Failed to recreate Vectra indices:', error);
      throw error;
    }
  }
}

export class SemanticIndexManager {
  private builder: SemanticIndexBuilder;
  private currentIndex?: SemanticIndex;
  private indexCache = new Map<string, SemanticIndex>();
  public onIndexRebuilt?: (fingerprint: string) => void;

  constructor(config: SemanticIndexConfig = {}) {
    this.builder = new SemanticIndexBuilder(config);
  }

  async initialize(): Promise<void> {
    await this.builder.initialize();
  }

  async ensureIndex(uiGraph: UIGraph): Promise<SemanticIndex> {
    const fingerprint = this.generateFingerprint(uiGraph);
    console.log(`[SemanticIndex] Generated fingerprint: ${fingerprint}`);
    
    // Check cache
    if (this.indexCache.has(fingerprint)) {
      console.log('[SemanticIndex] Using cached index');
      return this.indexCache.get(fingerprint)!;
    }

    console.log('[SemanticIndex] Cache miss - building new index');
    // Build new index
    const index = await this.builder.buildIndex(uiGraph);
    this.indexCache.set(fingerprint, index);
    this.currentIndex = index;
    
    // Signal that the index has been rebuilt (for external cache invalidation)
    this.onIndexRebuilt?.(fingerprint);

    // Cleanup old entries (keep last 3)
    if (this.indexCache.size > 3) {
      const entries = Array.from(this.indexCache.entries());
      const toDelete = entries.slice(0, entries.length - 3);
      toDelete.forEach(([key]) => this.indexCache.delete(key));
    }

    return index;
  }

  async search(query: QuerySpec): Promise<EvidencePack> {
    if (!this.currentIndex) {
      throw new Error('No semantic index available. Call ensureIndex first.');
    }

    return await this.builder.search(query, this.currentIndex);
  }

  private generateFingerprint(uiGraph: UIGraph): string {
    // Use the same fingerprint logic as SemanticIndexBuilder
    const elementCount = uiGraph.elements.length;
    const interactiveCount = uiGraph.elements.filter(el => el.clickable || el.contentEditable).length;
    
    // Include field states to detect when form fields are filled
    const filledFieldsHash = uiGraph.elements
      .filter(el => el.type === 'input' || el.type === 'textarea')
      .map(el => `${el.name || el.id}:${el.value ? 'filled' : 'empty'}`)
      .sort()
      .join('|');
    
    // Add code version to invalidate cache when extraction logic changes
    const codeVersion = 'v2_enhanced_labels';
      
    return `${uiGraph.url}_${elementCount}_${interactiveCount}_${filledFieldsHash}_${uiGraph.timestamp}_${codeVersion}`;
  }

}