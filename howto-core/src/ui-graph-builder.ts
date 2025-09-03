import { Page } from 'playwright';

export interface UIElement {
  // Core properties
  tag: string;
  role?: string;
  accessibleName?: string;
  title?: string;
  tooltipTitle?: string;
  label?: string;
  placeholder?: string;
  value?: string;
  type?: string;
  
  // Identifiers
  id?: string;
  classes: string[];
  dataTestId?: string;
  dataUnique?: string;
  name?: string;
  href?: string;
  
  // Location & visibility
  boundingBox?: { x: number; y: number; width: number; height: number };
  inViewport: boolean;
  visible: boolean;
  zIndex: number;
  
  // Interactivity
  enabled: boolean;
  focusable: boolean;
  clickable: boolean;
  contentEditable?: boolean;
  
  // Text content
  text?: string;
  textContent?: string;
  
  // Context
  formGroup?: string;
  sectionTitle?: string;
  nearbyText: string[];
  parentModalOrDrawer?: string;
  isInActiveTab: boolean;
  inNavigation?: boolean;
  
  // State
  isPrimary: boolean;
  isSubmit: boolean;
  validationState?: 'valid' | 'invalid' | 'pending';
  ariaCurrent?: string;
  
  // Selectors
  candidateSelectors: string[];
  stability: 'high' | 'medium' | 'low';
  
  // Enhanced Context - Layout & Position
  layoutContext?: {
    parentLayout?: 'flex' | 'grid' | 'table' | 'float' | 'absolute';
    positionType?: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
    isOverlay?: boolean;
    layerLevel?: number;
  };
  
  // Enhanced Context - Workflow State
  workflowContext?: {
    isRequired?: boolean;
    isEmpty?: boolean;
    hasValidationError?: boolean;
    isInProgress?: boolean;
    isCompleted?: boolean;
    progressValue?: number;
  };
  
  // Enhanced Context - Interaction State
  interactionContext?: {
    isHovered?: boolean;
    isFocused?: boolean;
    wasRecentlyInteracted?: boolean;
    lastInteractionTime?: number;
    hasAnimation?: boolean;
    isLoading?: boolean;
  };
  
  // Enhanced Context - Form Context
  formContext?: {
    formId?: string;
    fieldSetGroup?: string;
    isMultiStep?: boolean;
    currentStep?: number;
    totalSteps?: number;
    isDirty?: boolean;
    hasUnsavedChanges?: boolean;
  };
  
  // Event Listeners - Critical for understanding interactivity
  eventListeners?: {
    hasClickListener?: boolean;
    hasMouseListener?: boolean;
    hasKeyboardListener?: boolean;
    hasFocusListener?: boolean;
    hasFormListener?: boolean;
    hasCustomListener?: boolean;
    eventTypes?: string[];
    listenerCount?: number;
  };

  // Widget Type - For composite widgets like dropdowns, date pickers, etc.
  widgetType?: 'dropdown' | 'date-picker' | 'autocomplete' | 'multi-select' | 'simple-input' | 'custom';
  
  // Widget Context - Additional context for composite widgets
  widgetContext?: {
    isCustomDropdown?: boolean;
    hasMenuItems?: boolean;
    menuSelector?: string;
    requiresMultiStep?: boolean;
    openTrigger?: string; // selector for element that opens the widget
    itemSelector?: string; // selector pattern for selectable items
  };
}

export interface UIGraph {
  elements: UIElement[];
  screenFingerprint: string;
  timestamp: number;
  url: string;
  title: string;
  activeModal?: string;
  activeForms: string[];
  landmarkStructure: string[];
  
  // Enhanced Context Data
  pageContext?: {
    viewport: { width: number; height: number };
    scrollPosition: { x: number; y: number };
    isScrollable: boolean;
    hasHorizontalScroll: boolean;
    hasVerticalScroll: boolean;
  };
  
  semanticHierarchy?: {
    main?: string;
    nav?: string[];
    aside?: string[];
    sections?: Array<{ title: string; role: string; elementCount: number }>;
    breadcrumbs?: string[];
  };
  
  workflowState?: {
    currentStep?: number;
    totalSteps?: number;
    completedSteps?: number[];
    activeWizard?: string;
    formValidationErrors: number;
    requiredFieldsEmpty: number;
    progressIndicators?: Array<{ label: string; progress: number; total: number }>;
  };
  
  dynamicContent?: {
    loadingElements: number;
    errorMessages: string[];
    successMessages: string[];
    expandedSections: string[];
    collapsedSections: string[];
    activeTabs: string[];
    modalStack: string[];
    hasAnimations: boolean;
    lastContentUpdate?: number;
  };
  
  interactionHistory?: {
    recentlyFocused?: string[];
    recentlyClicked?: string[];
    lastInteractionTime?: number;
    userInputValues?: Record<string, { timestamp: number; hasValue: boolean }>;
  };
  
  performanceContext?: {
    buildTime: number;
    elementsProcessed: number;
    visibleElements: number;
    interactiveElements: number;
    renderComplete: boolean;
  };
}

export interface UIGraphPatterns {
  buttonTexts: string[];
  interactiveButtonQuery: string;
  interactiveInputQuery: string;
  navigationContainers: string;
  modalSelectors: string;
  landmarkQuery: string;
}

export class UIGraphBuilder {
  private patterns: UIGraphPatterns;

  constructor(patterns?: Partial<UIGraphPatterns>) {
    // Defaults mirror previous hardcoded values
    this.patterns = {
      buttonTexts: ['SAVE', 'Save', 'save', 'START', 'Start', 'start', 'CANCEL', 'Cancel', 'cancel'],
      interactiveButtonQuery: 'button, [role="button"], input[type="submit"], input[type="button"], a[role="button"], a[href]',
      interactiveInputQuery: 'input, textarea, [contenteditable="true"]',
      navigationContainers: 'nav, [role="navigation"], .sidebar, .side-nav, [data-unique*="SideBar"]',
      modalSelectors: '[role="dialog"]:not([aria-hidden="true"]), .modal:not(.hidden), [data-modal], .drawer, [data-drawer]',
      landmarkQuery: 'h1, h2, h3, [role="main"], [role="navigation"], [role="banner"]',
      ...patterns
    } as UIGraphPatterns;
  }

  async buildUIGraph(page: Page): Promise<UIGraph> {
    const startTime = Date.now();
    console.log('[UI-Graph] Building enhanced UI model with context...');
    
    const url = page.url();
    const title = await page.title();
    
    // Execute all analysis in browser context for efficiency
    const patterns = this.patterns;
    const analysisResult = await page.evaluate((patterns) => {
      const elements: UIElement[] = [];
      
      // Enhanced Context Extraction Functions
      function extractPageContext() {
        return {
          viewport: { 
            width: window.innerWidth, 
            height: window.innerHeight 
          },
          scrollPosition: { 
            x: window.pageXOffset || document.documentElement.scrollLeft, 
            y: window.pageYOffset || document.documentElement.scrollTop 
          },
          isScrollable: document.documentElement.scrollHeight > window.innerHeight || 
                       document.documentElement.scrollWidth > window.innerWidth,
          hasHorizontalScroll: document.documentElement.scrollWidth > window.innerWidth,
          hasVerticalScroll: document.documentElement.scrollHeight > window.innerHeight
        };
      }
      
      function extractSemanticHierarchy() {
        const main = document.querySelector('main')?.textContent?.trim()?.substring(0, 100);
        const nav = Array.from(document.querySelectorAll('nav')).map(n => 
          n.getAttribute('aria-label') || n.textContent?.trim()?.substring(0, 50) || 'Navigation'
        ).filter(Boolean) as string[];
        const aside = Array.from(document.querySelectorAll('aside')).map(a => 
          a.getAttribute('aria-label') || a.textContent?.trim()?.substring(0, 50) || 'Sidebar'
        ).filter(Boolean) as string[];
        
        const sections = Array.from(document.querySelectorAll('section, article, [role=\"main\"], [role=\"region\"]')).map(s => ({
          title: s.querySelector('h1, h2, h3')?.textContent?.trim()?.substring(0, 50) || 
                 s.getAttribute('aria-label') || 'Unnamed Section',
          role: s.getAttribute('role') || s.tagName.toLowerCase(),
          elementCount: s.querySelectorAll('button, input, a, select').length
        }));
        
        const breadcrumbs = Array.from(document.querySelectorAll('[role=\"breadcrumb\"], .breadcrumb, .breadcrumbs')).flatMap(bc =>
          Array.from(bc.querySelectorAll('a, span')).map(item => item.textContent?.trim() || 'Breadcrumb').filter(Boolean)
        ) as string[];
        
        return { main, nav, aside, sections, breadcrumbs };
      }
      
      function extractWorkflowState() {
        const wizardSteps = document.querySelectorAll('.step, .wizard-step, [data-step]');
        const currentStepEl = document.querySelector('.step.active, .wizard-step.current, [data-step].active');
        
        const progressBars = Array.from(document.querySelectorAll('progress, [role=\"progressbar\"], .progress-bar')).map(p => {
          const label = p.getAttribute('aria-label') || p.textContent?.trim() || 'Progress';
          const value = parseFloat(p.getAttribute('aria-valuenow') || p.getAttribute('value') || '0');
          const max = parseFloat(p.getAttribute('aria-valuemax') || p.getAttribute('max') || '100');
          return { label, progress: value, total: max };
        });
        
        const formErrors = document.querySelectorAll('.error, .invalid, [aria-invalid=\"true\"], .field-error').length;
        const requiredEmpty = Array.from(document.querySelectorAll('input[required], select[required], textarea[required]')).filter(el => {
          const input = el as HTMLInputElement;
          return !input.value || input.value.trim() === '';
        }).length;
        
        return {
          currentStep: currentStepEl ? Array.from(wizardSteps).indexOf(currentStepEl) + 1 : undefined,
          totalSteps: wizardSteps.length || undefined,
          completedSteps: Array.from(document.querySelectorAll('.step.completed, .wizard-step.done')).map((el, idx) => idx + 1),
          activeWizard: document.querySelector('.wizard, .multi-step-form')?.id || undefined,
          formValidationErrors: formErrors,
          requiredFieldsEmpty: requiredEmpty,
          progressIndicators: progressBars
        };
      }
      
      function extractDynamicContent() {
        const loadingEls = document.querySelectorAll('.loading, .spinner, [aria-busy=\"true\"], .loading-overlay').length;
        const errorMsgs = Array.from(document.querySelectorAll('.error-message, .alert-error, [role=\"alert\"]')).map(el => 
          el.textContent?.trim() || 'Error'
        ).filter(Boolean) as string[];
        const successMsgs = Array.from(document.querySelectorAll('.success-message, .alert-success, .notification-success')).map(el => 
          el.textContent?.trim() || 'Success'
        ).filter(Boolean) as string[];
        
        const expandedSections = Array.from(document.querySelectorAll('[aria-expanded=\"true\"]')).map(el => 
          el.id || el.getAttribute('aria-label') || el.textContent?.trim()?.substring(0, 30) || 'Expanded Section'
        ).filter(Boolean) as string[];
        const collapsedSections = Array.from(document.querySelectorAll('[aria-expanded=\"false\"]')).map(el => 
          el.id || el.getAttribute('aria-label') || el.textContent?.trim()?.substring(0, 30) || 'Collapsed Section'
        ).filter(Boolean) as string[];
        
        const activeTabs = Array.from(document.querySelectorAll('[role=\"tab\"][aria-selected=\"true\"]')).map(el => 
          el.textContent?.trim() || el.getAttribute('aria-label') || 'Active Tab'
        ).filter(Boolean) as string[];
        
        const modals = Array.from(document.querySelectorAll('[role=\"dialog\"]:not([aria-hidden=\"true\"])')).map(el => 
          el.id || el.getAttribute('aria-label') || 'modal'
        ) as string[];
        
        const hasAnimations = !!(document.querySelector('[style*=\"transition\"], [style*=\"animation\"], .animate, .transition') || 
          getComputedStyle(document.body).animationName !== 'none');
        
        return {
          loadingElements: loadingEls,
          errorMessages: errorMsgs,
          successMessages: successMsgs,
          expandedSections,
          collapsedSections,
          activeTabs,
          modalStack: modals,
          hasAnimations,
          lastContentUpdate: Date.now()
        };
      }
      
      function extractInteractionHistory() {
        const focusedEl = document.activeElement;
        const recentlyFocused = focusedEl ? [focusedEl.id || focusedEl.getAttribute('aria-label') || focusedEl.tagName.toLowerCase()] as string[] : [] as string[];
        
        const userInputs: Record<string, { timestamp: number; hasValue: boolean }> = {};
        document.querySelectorAll('input, textarea, select').forEach(el => {
          const input = el as HTMLInputElement;
          const key = input.id || input.name || input.getAttribute('aria-label') || `${input.tagName.toLowerCase()}-${Array.from(input.parentElement?.children || []).indexOf(input)}`;
          userInputs[key] = {
            timestamp: Date.now(),
            hasValue: !!(input.value && input.value.trim())
          };
        });
        
        return {
          recentlyFocused,
          recentlyClicked: [], // Would need event tracking
          lastInteractionTime: Date.now(),
          userInputValues: userInputs
        };
      }
      
      function getLayoutContext(element: Element) {
        const style = window.getComputedStyle(element);
        const parent = element.parentElement;
        const parentStyle = parent ? window.getComputedStyle(parent) : null;
        
        return {
          parentLayout: parentStyle?.display === 'flex' ? 'flex' as const :
                       parentStyle?.display === 'grid' ? 'grid' as const :
                       parentStyle?.display?.includes('table') ? 'table' as const :
                       style.float !== 'none' ? 'float' as const :
                       style.position === 'absolute' ? 'absolute' as const : undefined,
          positionType: style.position as any,
          isOverlay: parseInt(style.zIndex) > 100,
          layerLevel: parseInt(style.zIndex) || 0
        };
      }
      
      function getWorkflowContext(element: Element) {
        const tag = element.tagName.toLowerCase();
        const isInput = tag === 'input' || tag === 'textarea' || tag === 'select';

        // Try to derive value from the element or its descendants (for composite widgets)
        let currentValue = '';
        if (isInput) {
          const input = element as HTMLInputElement;
          currentValue = typeof (input as any).value === 'string' ? (input as any).value : '';
        } else {
          const descendant = element.querySelector('input, textarea, select') as (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null);
          if (descendant && typeof (descendant as any).value === 'string') {
            currentValue = (descendant as any).value || '';
          }
        }

        const isEmpty = currentValue.trim() === '';

        // Debug logging for inputs and composite widgets
        if (isInput || element.querySelector('[aria-haspopup="true"]')) {
          const input = element as HTMLInputElement;
          const logType = isInput ? (input.type || 'none') : 'composite';
          console.log(`[UI-Graph] Input field debug: tag=${element.tagName}, type=${logType}, id=${(element as any).id || 'none'}, name=${(element as any).name || 'none'}, data-unique=${element.getAttribute('data-unique') || 'none'}, value="${currentValue}", isEmpty=${isEmpty}`);
        }

        return {
          isRequired: element.hasAttribute('required'),
          isEmpty,
          hasValidationError: element.hasAttribute('aria-invalid') && element.getAttribute('aria-invalid') === 'true',
          isInProgress: element.hasAttribute('aria-busy') && element.getAttribute('aria-busy') === 'true',
          isCompleted: element.classList.contains('completed') || element.classList.contains('done'),
          progressValue: element.hasAttribute('aria-valuenow') ? parseFloat(element.getAttribute('aria-valuenow') || '0') : undefined
        };
      }
      
      function getInteractionContext(element: Element) {
        const style = window.getComputedStyle(element);
        return {
          isHovered: element.matches(':hover'),
          isFocused: element === document.activeElement,
          wasRecentlyInteracted: false, // Would need tracking
          lastInteractionTime: undefined,
          hasAnimation: style.animationName !== 'none' || style.transitionDuration !== '0s',
          isLoading: element.hasAttribute('aria-busy') && element.getAttribute('aria-busy') === 'true'
        };
      }
      
      function getFormContext(element: Element) {
        const form = element.closest('form');
        const fieldset = element.closest('fieldset');
        const wizard = element.closest('.wizard, .multi-step-form, [data-wizard]');
        
        return {
          formId: form?.id || form?.getAttribute('name') || undefined,
          fieldSetGroup: fieldset?.querySelector('legend')?.textContent?.trim() || undefined,
          isMultiStep: !!wizard,
          currentStep: wizard ? parseInt(wizard.getAttribute('data-current-step') || '1') : undefined,
          totalSteps: wizard ? wizard.querySelectorAll('.step, [data-step]').length || undefined : undefined,
          isDirty: element.hasAttribute('data-dirty') || element.classList.contains('dirty'),
          hasUnsavedChanges: form?.querySelector('[data-dirty], .dirty, .modified') !== null
        };
      }
      
      function getEventListeners(element: Element) {
        try {
          // Get event listeners using getEventListeners (Chrome DevTools API)
          // Note: This only works in DevTools context or with special permissions
          let eventTypes: string[] = [];
          let listenerCount = 0;
          
          // Try Chrome DevTools API (if available)
          if (typeof (window as any).getEventListeners === 'function') {
            try {
              const listeners = (window as any).getEventListeners(element);
              eventTypes = Object.keys(listeners);
              listenerCount = eventTypes.reduce((total, type) => total + listeners[type].length, 0);
            } catch (e) {
              // Fallback to heuristic detection
            }
          }
          
          // Heuristic detection based on element properties and attributes
          if (eventTypes.length === 0) {
            const heuristicTypes = detectEventListenersHeuristic(element);
            eventTypes = heuristicTypes.eventTypes || [];
            listenerCount = heuristicTypes.listenerCount || 0;
          }
          
          // Analyze event types
          const hasClickListener = eventTypes.some(type => 
            ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'].includes(type)
          );
          const hasMouseListener = eventTypes.some(type => 
            type.startsWith('mouse') || type.startsWith('pointer')
          );
          const hasKeyboardListener = eventTypes.some(type => 
            ['keydown', 'keyup', 'keypress'].includes(type)
          );
          const hasFocusListener = eventTypes.some(type => 
            ['focus', 'blur', 'focusin', 'focusout'].includes(type)
          );
          const hasFormListener = eventTypes.some(type => 
            ['submit', 'change', 'input', 'invalid'].includes(type)
          );
          const hasCustomListener = eventTypes.some(type => 
            !['click', 'mousedown', 'mouseup', 'mouseover', 'mouseout', 'mousemove', 
              'keydown', 'keyup', 'keypress', 'focus', 'blur', 'focusin', 'focusout',
              'submit', 'change', 'input', 'invalid', 'load', 'resize'].includes(type)
          );
          
          return {
            hasClickListener,
            hasMouseListener,
            hasKeyboardListener,
            hasFocusListener,
            hasFormListener,
            hasCustomListener,
            eventTypes: eventTypes.length > 0 ? eventTypes : undefined,
            listenerCount: listenerCount > 0 ? listenerCount : undefined
          };
          
        } catch (error) {
          // Fallback: Basic heuristic detection
          return detectEventListenersHeuristic(element);
        }
      }
      
      function detectEventListenersHeuristic(element: Element) {
        const eventTypes: string[] = [];
        let listenerCount = 0;
        
        // Check for obvious interactive elements
        const tagName = element.tagName.toLowerCase();
        const type = element.getAttribute('type');
        const role = element.getAttribute('role');
        const classes = element.className;
        
        // Form elements typically have change/input listeners
        if (['input', 'textarea', 'select'].includes(tagName)) {
          eventTypes.push('change', 'input');
          listenerCount += 2;
          
          if (type === 'submit') {
            eventTypes.push('click');
            listenerCount += 1;
          }
        }
        
        // Buttons and links typically have click listeners
        if (['button', 'a'].includes(tagName) || role === 'button' || role === 'link') {
          eventTypes.push('click');
          listenerCount += 1;
        }
        
        // Custom dropdown elements with aria-haspopup
        if (element.hasAttribute('aria-haspopup') || role === 'combobox') {
          eventTypes.push('click', 'keydown', 'focus');
          listenerCount += 3;
          
          // Check for specific dropdown patterns
          if (element.hasAttribute('aria-haspopup') && element.getAttribute('aria-haspopup') === 'listbox') {
            eventTypes.push('mousedown');
            listenerCount += 1;
          }
        }
        
        // Material-UI and Ant Design specific patterns
        if (classes.includes('MuiSelect-select') || classes.includes('MuiButton-root') ||
            classes.includes('ant-select') || classes.includes('ant-btn')) {
          eventTypes.push('click', 'mousedown', 'focus');
          listenerCount += 3;
        }
        
        // Elements with role="option" (dropdown items)
        if (role === 'option' || role === 'menuitem') {
          eventTypes.push('click', 'mouseenter');
          listenerCount += 2;
        }
        
        // Forms have submit listeners
        if (tagName === 'form') {
          eventTypes.push('submit');
          listenerCount += 1;
        }
        
        // Elements with onclick attribute
        if (element.hasAttribute('onclick')) {
          eventTypes.push('click');
          listenerCount += 1;
        }
        
        // Elements with other event attributes
        const eventAttrs = ['onmouseover', 'onmouseout', 'onfocus', 'onblur', 'onchange', 'oninput', 'onkeydown', 'onmousedown', 'onmouseup'];
        eventAttrs.forEach(attr => {
          if (element.hasAttribute(attr)) {
            const eventType = attr.substring(2); // Remove 'on' prefix
            eventTypes.push(eventType);
            listenerCount += 1;
          }
        });
        
        // Check for framework-specific event indicators
        const hasFrameworkListeners = 
          classes.includes('ng-click') || // Angular
          classes.includes('v-on:') || // Vue
          element.hasAttribute('@click') || // Vue
          element.hasAttribute('(click)') || // Angular
          element.hasAttribute('onClick'); // React (though this is usually compiled away)
        
        if (hasFrameworkListeners) {
          eventTypes.push('click');
          listenerCount += 1;
        }
        
        // Elements with tabindex are likely interactive
        if (element.hasAttribute('tabindex') && element.getAttribute('tabindex') !== '-1') {
          eventTypes.push('focus', 'blur');
          listenerCount += 2;
        }
        
        // Remove duplicates
        const uniqueEventTypes = [...new Set(eventTypes)];
        
        return {
          hasClickListener: uniqueEventTypes.includes('click'),
          hasMouseListener: uniqueEventTypes.some(type => type.startsWith('mouse')),
          hasKeyboardListener: uniqueEventTypes.some(type => ['keydown', 'keyup', 'keypress'].includes(type)),
          hasFocusListener: uniqueEventTypes.some(type => ['focus', 'blur'].includes(type)),
          hasFormListener: uniqueEventTypes.some(type => ['submit', 'change', 'input'].includes(type)),
          hasCustomListener: false, // Can't detect with heuristics
          eventTypes: uniqueEventTypes.length > 0 ? uniqueEventTypes : undefined,
          listenerCount: listenerCount > 0 ? listenerCount : undefined
        };
      }
      
      // Helper functions
      function getAccessibleName(element: Element): string {
        // aria-label takes precedence
        if (element.hasAttribute('aria-label')) {
          return element.getAttribute('aria-label') || '';
        }
        
        // aria-labelledby
        if (element.hasAttribute('aria-labelledby')) {
          const ids = element.getAttribute('aria-labelledby')?.split(/\s+/) || [];
          const labels = ids.map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
          if (labels.length > 0) return labels.join(' ');
        }
        
        // For inputs, check associated label
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          // Try for attribute
          if (element.id) {
            const label = document.querySelector(`label[for="${element.id}"]`);
            if (label) return label.textContent?.trim() || '';
          }
          // Try wrapping label
          const parentLabel = element.closest('label');
          if (parentLabel) {
            return parentLabel.textContent?.replace(element.value || '', '').trim() || '';
          }
        }
        
        // Generic label search for form elements (input, textarea, select)
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
          // Look for labels within the parent container hierarchy
          let currentParent = element.parentElement;
          let searchDepth = 0;
          while (currentParent && searchDepth < 3) {
            const label = currentParent.querySelector('label');
            if (label && label.textContent?.trim()) {
              return label.textContent.trim();
            }
            currentParent = currentParent.parentElement;
            searchDepth++;
          }
          
          // Look for preceding label siblings
          let sibling = element.previousElementSibling;
          while (sibling) {
            if (sibling.tagName?.toLowerCase() === 'label') {
              return sibling.textContent?.trim() || '';
            }
            sibling = sibling.previousElementSibling;
          }
        }
        
        // For buttons, use text content
        if (element instanceof HTMLButtonElement) {
          return element.textContent?.trim() || '';
        }

        // Title attribute as fallback
        if ((element as HTMLElement).title) {
          return (element as HTMLElement).title.trim();
        }

        // Tooltip wrappers: nearest ancestor with data-tooltip-title or title
        const tooltipEl = element.closest('[data-tooltip-title], [title]');
        if (tooltipEl) {
          const tt = tooltipEl.getAttribute('data-tooltip-title') || (tooltipEl as HTMLElement).title;
          if (tt && tt.trim().length > 0) return tt.trim();
        }

        // Fallback to text content
        return element.textContent?.trim() || '';
      }
      
      function getBoundingBox(element: Element) {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        };
      }
      
      function isInViewport(element: Element): boolean {
        const rect = element.getBoundingClientRect();
        // Consider partially visible elements actionable
        return (
          rect.bottom >= 0 &&
          rect.right >= 0 &&
          rect.top <= window.innerHeight &&
          rect.left <= window.innerWidth
        );
      }
      
      function isVisible(element: Element): boolean {
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && 
               style.visibility !== 'hidden' && 
               style.opacity !== '0' &&
               (element as HTMLElement).offsetWidth > 0 && 
               (element as HTMLElement).offsetHeight > 0;
      }
      
      function isClickable(element: Element): boolean {
        const style = window.getComputedStyle(element);
        if (style.pointerEvents === 'none') return false;
        if (style.cursor === 'pointer') return true;
        
        const tag = element.tagName.toLowerCase();
        if (['button', 'a', 'select'].includes(tag)) return true;
        if (tag === 'input' && element.getAttribute('type') !== 'hidden') return true;
        if (element.hasAttribute('onclick')) return true;
        if (element.getAttribute('role') === 'button') return true;
        
        // Custom dropdown elements are clickable
        if (element.hasAttribute('aria-haspopup')) return true;
        if (element.getAttribute('role') === 'combobox') return true;
        
        return false;
      }
      
      function getFormGroup(element: Element): string | undefined {
        const form = element.closest('form');
        if (form) {
          // Try to find form name or id
          return form.id || form.getAttribute('name') || form.getAttribute('data-testid') || 'unnamed-form';
        }
        
        const fieldset = element.closest('fieldset');
        if (fieldset) {
          const legend = fieldset.querySelector('legend');
          return legend?.textContent?.trim() || 'unnamed-fieldset';
        }
        
        return undefined;
      }
      
      function getSectionTitle(element: Element): string | undefined {
        // Walk up the DOM to find nearest heading
        let current = element.parentElement;
        while (current && current !== document.body) {
          const headings = current.querySelectorAll('h1, h2, h3, h4, h5, h6');
          for (const heading of headings) {
            if (heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) {
              return heading.textContent?.trim();
            }
          }
          current = current.parentElement;
        }
        
        // Look for aria-labelledby pointing to headings
        if (element.hasAttribute('aria-labelledby')) {
          const id = element.getAttribute('aria-labelledby');
          const labelElement = id ? document.getElementById(id) : null;
          if (labelElement && /^h[1-6]$/i.test(labelElement.tagName)) {
            return labelElement.textContent?.trim();
          }
        }
        
        return undefined;
      }
      
      function getNearbyText(element: Element): string[] {
        const nearby: string[] = [];
        
        // Up to ±2 siblings
        let prev: Element | null = element.previousElementSibling;
        let next: Element | null = element.nextElementSibling;
        for (let i = 0; i < 2; i++) {
          if (prev && prev.textContent?.trim()) nearby.push(prev.textContent.trim().substring(0, 50));
          if (next && next.textContent?.trim()) nearby.push(next.textContent.trim().substring(0, 50));
          prev = prev?.previousElementSibling || null;
          next = next?.nextElementSibling || null;
        }
        
        // Parent's text (excluding this element's text)
        const parent = element.parentElement;
        if (parent) {
          const parentText = Array.from(parent.childNodes)
            .filter(node => node.nodeType === Node.TEXT_NODE && node !== element)
            .map(node => node.textContent?.trim())
            .filter(text => text && text.length > 3)
            .join(' ');
          if (parentText) {
            nearby.push(parentText.substring(0, 50));
          }
        }
        
        return nearby;
      }
      
      function getModalOrDrawer(element: Element): string | undefined {
        // Look for common modal/drawer containers
        const modal = element.closest('[role="dialog"], [role="alertdialog"], .modal, .drawer, [data-modal], [data-drawer]');
        if (modal) {
          return modal.id || modal.getAttribute('aria-label') || modal.className || 'unnamed-modal';
        }
        return undefined;
      }
      
      function isInActiveTab(element: Element): boolean {
        const tabpanel = element.closest('[role="tabpanel"]');
        if (tabpanel) {
          const ariaHidden = tabpanel.getAttribute('aria-hidden');
          return ariaHidden !== 'true';
        }
        
        // Check for common tab implementations
        const tabContent = element.closest('.tab-content, .tab-pane, [data-tab-content]');
        if (tabContent) {
          const style = window.getComputedStyle(tabContent);
          return style.display !== 'none';
        }
        
        return true; // Default to true if no tab context
      }
      
      function generateStableSelectors(element: Element): { selectors: string[], stability: 'high' | 'medium' | 'low' } {
        const selectors: string[] = [];
        let maxStability: 'high' | 'medium' | 'low' = 'low';
        
        // High stability: data-testid, semantic attributes
        if (element.hasAttribute('data-testid')) {
          selectors.push(`[data-testid="${element.getAttribute('data-testid')}"]`);
          maxStability = 'high';
        }

        // High stability: data-unique (commonly used as testid)
        if (element.hasAttribute('data-unique')) {
          selectors.push(`[data-unique="${element.getAttribute('data-unique')}"]`);
          maxStability = 'high';
        }
        
        if (element.id && !/^[a-z]+-[0-9a-f]{6,}$/i.test(element.id)) {
          selectors.push(`#${element.id}`);
          maxStability = 'high';
        }
        
        if (element instanceof HTMLInputElement && element.name) {
          selectors.push(`input[name="${element.name}"]`);
          maxStability = 'high';
        }
        
        // Medium stability: semantic selectors
        const role = element.getAttribute('role');
        if (role && element.hasAttribute('aria-label')) {
          selectors.push(`[role="${role}"][aria-label="${element.getAttribute('aria-label')}"]`);
          if (maxStability === 'low') maxStability = 'medium';
        }
        
        if (element instanceof HTMLButtonElement && element.textContent?.trim()) {
          const text = element.textContent.trim();
          if (text.length < 30) {
            selectors.push(`button:has-text("${text}")`);
            if (maxStability === 'low') maxStability = 'medium';
          }
        }

        // Medium stability: anchor href selectors
        if (element instanceof HTMLAnchorElement) {
          const href = element.getAttribute('href');
          if (href && href.length > 0 && href.length < 100) {
            // precise
            selectors.push(`a[href="${href}"]`);
            // prefix match (robust to query or fragments)
            const base = href.split(/[?#]/)[0];
            if (base && base !== href) {
              selectors.push(`a[href^="${base}"]`);
            }
            if (maxStability === 'low') maxStability = 'medium';
          }
        }
        
        // Low stability: class-based (filtered for semantic classes)
        if (element.className) {
          const semanticClasses = element.className.split(' ').filter(cls => {
            // Keep semantic classes, remove generated ones
            if (/^jss\d+$/.test(cls)) return false;
            if (/^css-[a-z0-9]+$/i.test(cls)) return false;
            if (/^makeStyles-\w+-\d+$/.test(cls)) return false;
            if (/^[a-z]{3,}-[a-z0-9]{6,}$/i.test(cls)) return false;
            if (/^[a-z]+_[a-z0-9]{5,}$/i.test(cls)) return false;
            return cls.length > 0 && cls.length < 30;
          });
          
          if (semanticClasses.length > 0) {
            selectors.push(`.${semanticClasses.join('.')}`);
          }
        }
        
        return { selectors, stability: maxStability };
      }
      
      function isPrimaryButton(element: Element): boolean {
        if (!(element instanceof HTMLButtonElement)) return false;
        
        const classes = element.className.toLowerCase();
        const type = element.type;
        
        return type === 'submit' ||
               classes.includes('primary') ||
               classes.includes('btn-primary') ||
               classes.includes('submit') ||
               element.hasAttribute('data-primary');
      }
      
      function getValidationState(element: Element): 'valid' | 'invalid' | 'pending' | undefined {
        if (element.hasAttribute('aria-invalid')) {
          return element.getAttribute('aria-invalid') === 'true' ? 'invalid' : 'valid';
        }
        
        if (element instanceof HTMLInputElement) {
          if (element.validity.valid === false) return 'invalid';
          if (element.checkValidity && !element.checkValidity()) return 'invalid';
        }
        
        const classes = element.className.toLowerCase();
        if (classes.includes('invalid') || classes.includes('error')) return 'invalid';
        if (classes.includes('valid') || classes.includes('success')) return 'valid';
        if (classes.includes('pending') || classes.includes('loading')) return 'pending';
        
        return undefined;
      }
      
      // Detect composite widgets where interactive element is nested inside container
      function detectCompositeWidget(element: Element): Element | null {
        // Enhanced dropdown detection - traverse up to 3 levels to find container
        if (element.hasAttribute('aria-haspopup') || element.hasAttribute('role') || 
            element.classList.contains('MuiSelect-select') || element.classList.contains('ant-select')) {
          
          let current = element.parentElement;
          let level = 0;
          
          while (current && level < 3) {
            // Look for identifying attributes on container
            if (current.hasAttribute('data-unique') || current.hasAttribute('data-testid') || 
                current.id || current.hasAttribute('data-loading-state') || 
                current.hasAttribute('title')) {
              // Verify it's actually a composite widget container
              const hasInteractiveChild = current.querySelector('[aria-haspopup], [role="button"], [role="combobox"], input, select, textarea');
              const hasWidgetPattern = current.querySelector('.MuiSelect-root, .ant-select, [aria-expanded], [aria-haspopup="listbox"]');
              
              if (hasInteractiveChild || hasWidgetPattern) {
                return current;
              }
            }
            current = current.parentElement;
            level++;
          }
          
          // Fallback: direct parent with some identification
          const parent = element.parentElement;
          if (parent && (parent.hasAttribute('data-unique') || parent.hasAttribute('data-testid') || parent.id)) {
            return parent;
          }
        }
        
        // If this is a container that contains interactive or form elements
        if (element.hasAttribute('data-unique') || element.hasAttribute('data-testid') || element.id ||
            element.hasAttribute('data-loading-state') || element.hasAttribute('title')) {
          const hasHiddenInput = element.querySelector('input[type="hidden"]');
          const hasInteractive = element.querySelector('[aria-haspopup], [role="button"], [role="combobox"], input, select, textarea');
          const hasWidgetPattern = element.querySelector('.MuiSelect-root, .ant-select, [aria-expanded]');
          
          if (hasHiddenInput || hasInteractive || hasWidgetPattern) {
            return element; // This is the composite widget container
          }
        }
        
        return null;
      }
      
      // Detect widget type and context for composite widgets
      function detectWidgetType(element: Element): {
        widgetType?: 'dropdown' | 'date-picker' | 'autocomplete' | 'multi-select' | 'simple-input' | 'custom';
        widgetContext?: {
          isCustomDropdown?: boolean;
          hasMenuItems?: boolean;
          menuSelector?: string;
          requiresMultiStep?: boolean;
          openTrigger?: string;
          itemSelector?: string;
        };
      } {
        const result: any = {};
        
        // Check for dropdown patterns
        const hasDropdownAttrs = element.hasAttribute('aria-haspopup') || 
                                 element.querySelector('[aria-haspopup]') ||
                                 element.getAttribute('role') === 'combobox' ||
                                 element.querySelector('[role="combobox"]');
        
        const hasDropdownClasses = element.classList.contains('MuiSelect-root') ||
                                   element.classList.contains('ant-select') ||
                                   element.querySelector('.MuiSelect-root, .ant-select, .dropdown, .select');
        
        const hasHiddenSelect = element.querySelector('input[type="hidden"][name]') ||
                               element.querySelector('select[style*="display: none"], select[style*="visibility: hidden"]');
        
        if (hasDropdownAttrs || hasDropdownClasses || hasHiddenSelect) {
          result.widgetType = 'dropdown';
          
          // Determine if it's a custom dropdown requiring multi-step
          const isCustom = !element.querySelector('select:not([style*="display: none"]):not([style*="visibility: hidden"])') &&
                          (hasDropdownAttrs || hasDropdownClasses || hasHiddenSelect);
          
          if (isCustom) {
            result.widgetContext = {
              isCustomDropdown: true,
              requiresMultiStep: true,
              hasMenuItems: true,
              // Generate potential selectors for menu items
              menuSelector: '[role="option"], [role="menuitem"], .MuiMenuItem-root, .ant-select-item, [data-value]',
              openTrigger: element.hasAttribute('data-unique') ? 
                          `[data-unique="${element.getAttribute('data-unique')}"]` :
                          element.hasAttribute('data-testid') ?
                          `[data-testid="${element.getAttribute('data-testid')}"]` :
                          element.id ? `#${element.id}` : undefined,
              itemSelector: '[role="option"], .MuiMenuItem-root, .ant-select-item'
            };
          }
        }
        // Check for date picker patterns
        else if (element.hasAttribute('type') && element.getAttribute('type') === 'date' ||
                element.classList.contains('DatePicker') ||
                element.querySelector('.DatePicker, [type="date"]')) {
          result.widgetType = 'date-picker';
        }
        // Check for autocomplete patterns
        else if (element.hasAttribute('role') && element.getAttribute('role') === 'combobox' ||
                element.hasAttribute('aria-autocomplete') ||
                element.classList.contains('autocomplete') ||
                element.querySelector('[role="combobox"], [aria-autocomplete]')) {
          result.widgetType = 'autocomplete';
        }
        // Check for multi-select patterns
        else if (element.querySelector('select[multiple]') ||
                element.hasAttribute('aria-multiselectable') ||
                element.classList.contains('multi-select')) {
          result.widgetType = 'multi-select';
        }
        // Simple input (default)
        else if (element.tagName.toLowerCase() === 'input' || 
                element.querySelector('input:not([type="hidden"])')) {
          result.widgetType = 'simple-input';
        }
        
        return result;
      }
      
      // Find interactive and labeling elements - scan entire document including footers
      const candidates = document.querySelectorAll(`
        input, button, select, textarea, a[href],
        [role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="listbox"],
        [aria-haspopup], [aria-expanded],
        [data-testid], [data-unique], [id],
        div[data-testid], div[data-unique], div[id],
        [tabindex]:not([tabindex="-1"]),
        [onclick], .btn, .button,
        [contenteditable="true"],
        label, legend, .form-label
      `);
      
      console.log(`[UI-Graph] Processing ${candidates.length} candidates`);
      
      for (const element of candidates) {
        if (!isVisible(element)) {
          // Debug: Log skipped input elements
          if (element.tagName.toLowerCase() === 'input') {
            console.log(`[UI-Graph] Skipping invisible input: id=${element.id || 'none'}, type=${(element as HTMLInputElement).type || 'none'}`);
          }
          continue;
        }
        
        // Check for composite widgets - elements with aria-haspopup that need special handling
        const compositeWidget = detectCompositeWidget(element);
        const actualElement = compositeWidget ? compositeWidget : element;
        
        // Debug logging for specific elements
        const debugDataUnique = actualElement.getAttribute('data-unique');
        if (debugDataUnique && debugDataUnique.includes('sel')) {
          console.log(`[UI-Graph] Processing custom dropdown: ${debugDataUnique}`);
        }
        
        const boundingBox = getBoundingBox(actualElement);
        const accessibleName = getAccessibleName(actualElement);
        const formGroup = getFormGroup(actualElement);
        const sectionTitle = getSectionTitle(actualElement);
        const nearbyText = getNearbyText(actualElement);
        const modalOrDrawer = getModalOrDrawer(actualElement);
        const { selectors, stability } = generateStableSelectors(actualElement);

        // Composite widget enrichment (e.g., custom selects with hidden inputs)
        let compositeRole: string | undefined = undefined;
        let compositeType: string | undefined = undefined;
        let derivedValue: string | undefined = undefined;
        let derivedLabel: string | undefined = undefined;

        try {
          const innerInteractive = actualElement.querySelector('[aria-haspopup="true"]');
          const hiddenInput = actualElement.querySelector('input[type="hidden"][name]') as HTMLInputElement | null;
          const anyDescendantInput = actualElement.querySelector('input, textarea, select') as (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null);

          if (innerInteractive) {
            compositeRole = 'combobox';
            compositeType = 'select';
          }

          if (hiddenInput) {
            // Use hidden input's value to represent selection
            derivedValue = hiddenInput.value || undefined;
            // Try to find associated label via for= attribute
            if (hiddenInput.id) {
              const assoc = document.querySelector(`label[for="${hiddenInput.id}"]`);
              const assocText = assoc?.textContent?.trim();
              if (assocText) derivedLabel = assocText;
            }
          } else if (anyDescendantInput && typeof (anyDescendantInput as any).value === 'string') {
            derivedValue = (anyDescendantInput as any).value || undefined;
            if ((anyDescendantInput as any).id) {
              const assoc = document.querySelector(`label[for="${(anyDescendantInput as any).id}"]`);
              const assocText = assoc?.textContent?.trim();
              if (assocText) derivedLabel = assocText;
            }
          }
        } catch { /* ignore enrichment errors */ }
        
        // Additional metadata
        const titleAttr = (actualElement as HTMLElement).title || undefined;
        const tooltipEl = actualElement.closest('[data-tooltip-title], [title]');
        const tooltipTitle = tooltipEl ? (tooltipEl.getAttribute('data-tooltip-title') || (tooltipEl as HTMLElement).title || undefined) : undefined;
        const dataUnique = actualElement.getAttribute('data-unique') || undefined;
        const href = actualElement instanceof HTMLAnchorElement ? (actualElement.getAttribute('href') || undefined) : undefined;
        const inNavigation = !!actualElement.closest(patterns.navigationContainers);
        
        // Extract enhanced context for this element
        const layoutContext = getLayoutContext(actualElement);
        const workflowContext = getWorkflowContext(actualElement);
        const interactionContext = getInteractionContext(actualElement);
        const formContext = getFormContext(actualElement);
        const eventListeners = getEventListeners(actualElement);
        
        // Detect widget type and context for composite widgets
        const { widgetType, widgetContext } = detectWidgetType(actualElement);

        const uiElement: UIElement = {
          tag: actualElement.tagName.toLowerCase(),
          role: compositeRole || actualElement.getAttribute('role') || undefined,
          accessibleName: accessibleName || undefined,
          title: titleAttr,
          tooltipTitle: tooltipTitle,
          label: derivedLabel || actualElement.getAttribute('aria-label') || undefined,
          placeholder: actualElement.getAttribute('placeholder') || undefined,
          value: derivedValue || (actualElement as any).value || undefined,
          type: compositeType || actualElement.getAttribute('type') || undefined,
          
          id: actualElement.id || undefined,
          classes: actualElement.className ? actualElement.className.split(' ').filter(Boolean) : [],
          dataTestId: actualElement.getAttribute('data-testid') || undefined,
          dataUnique: dataUnique,
          name: actualElement.getAttribute('name') || undefined,
          href: href,
          
          boundingBox,
          inViewport: isInViewport(actualElement),
          visible: isVisible(actualElement),
          zIndex: parseInt(window.getComputedStyle(actualElement).zIndex) || 0,
          
          enabled: !(actualElement as any).disabled && actualElement.getAttribute('aria-disabled') !== 'true',
          focusable: (actualElement as HTMLElement).tabIndex >= 0 || ['input', 'button', 'select', 'textarea', 'a'].includes(actualElement.tagName.toLowerCase()),
          clickable: isClickable(actualElement),
          contentEditable: (actualElement as HTMLElement).isContentEditable || actualElement.getAttribute('contenteditable') === 'true',
          
          text: (actualElement.textContent?.trim() || undefined),
          textContent: (actualElement.textContent?.trim() || undefined),
          
          formGroup,
          sectionTitle,
          nearbyText,
          parentModalOrDrawer: modalOrDrawer,
          isInActiveTab: isInActiveTab(element),
          inNavigation,
          
          isPrimary: isPrimaryButton(element),
          isSubmit: element.getAttribute('type') === 'submit' || element.tagName.toLowerCase() === 'button' && (element as HTMLButtonElement).type === 'submit',
          validationState: getValidationState(element),
          ariaCurrent: element.getAttribute('aria-current') || undefined,
          
          candidateSelectors: selectors,
          stability,
          
          // Enhanced Context Data
          layoutContext,
          workflowContext,
          interactionContext,
          formContext,
          eventListeners,
          
          // Widget Type Information
          widgetType,
          widgetContext
        };
        
        elements.push(uiElement);
      }
      
      // Additional scan for Save/Start/Cancel buttons by text content (configurable)
      const buttonTexts = patterns.buttonTexts || [];
      console.log(`[UI-Graph] Scanning for buttons with text: ${buttonTexts.join(', ')}`);
      
      buttonTexts.forEach(text => {
        const buttons = Array.from(document.querySelectorAll(patterns.interactiveButtonQuery))
          .filter(btn => btn.textContent?.includes(text) && isVisible(btn));
        
        if (buttons.length > 0) {
          console.log(`[UI-Graph] Found ${buttons.length} buttons with text "${text}"`);
        }
        
        buttons.forEach(button => {
          // Check if this button was already processed
          const alreadyProcessed = elements.some(el => 
            el.candidateSelectors.some(sel => {
              try {
                return document.querySelector(sel) === button;
              } catch {
                return false;
              }
            })
          );
          
          if (!alreadyProcessed) {
            const boundingBox = getBoundingBox(button);
            const accessibleName = getAccessibleName(button);
            const { selectors, stability } = generateStableSelectors(button);
            
            const buttonElement: UIElement = {
              tag: button.tagName.toLowerCase(),
              role: button.getAttribute('role') || undefined,
              accessibleName: accessibleName || undefined,
              text: button.textContent?.trim() || undefined,
              textContent: button.textContent?.trim() || undefined,
              
              id: button.id || undefined,
              classes: button.className ? button.className.split(' ').filter(Boolean) : [],
              dataTestId: button.getAttribute('data-testid') || undefined,
              dataUnique: button.getAttribute('data-unique') || undefined,
              
              boundingBox,
              inViewport: isInViewport(button),
              visible: isVisible(button),
              zIndex: parseInt(window.getComputedStyle(button).zIndex) || 0,
              
              enabled: !(button as any).disabled && button.getAttribute('aria-disabled') !== 'true',
              focusable: true,
              clickable: true,
              
              formGroup: getFormGroup(button),
              sectionTitle: getSectionTitle(button),
              nearbyText: getNearbyText(button),
              parentModalOrDrawer: getModalOrDrawer(button),
              isInActiveTab: true,
              inNavigation: !!button.closest(patterns.navigationContainers),
              
              isPrimary: button.classList.contains('primary') || button.classList.contains('btn-primary'),
              isSubmit: button.getAttribute('type') === 'submit' || 
                       button.textContent?.toLowerCase().includes('save') ||
                       button.textContent?.toLowerCase().includes('submit'),
              
              candidateSelectors: selectors,
              stability
            };
            
            elements.push(buttonElement);
          }
        });
      });
      
      // Additional page-level analysis
      const activeModal = document.querySelector(patterns.modalSelectors)?.id || 
                          document.querySelector(patterns.modalSelectors)?.getAttribute('aria-label') || 
                          undefined;
      
      const activeForms = Array.from(document.querySelectorAll('form')).map(form => 
        form.id || form.getAttribute('name') || form.getAttribute('data-testid') || 'unnamed-form'
      );
      
      const landmarkStructure = Array.from(document.querySelectorAll(patterns.landmarkQuery))
        .map(el => el.textContent?.trim() || el.tagName.toLowerCase())
        .filter(Boolean);
      
      // Extract all enhanced context data
      const pageContext = extractPageContext();
      const semanticHierarchy = extractSemanticHierarchy();
      const workflowState = extractWorkflowState();
      const dynamicContent = extractDynamicContent();
      const interactionHistory = extractInteractionHistory();
      
      return {
        elements,
        activeModal,
        activeForms,
        landmarkStructure,
        pageContext,
        semanticHierarchy,
        workflowState,
        dynamicContent,
        interactionHistory
      };
    }, patterns);
    
    // Create screen fingerprint with full URL for better navigation detection
    const mainHeading = analysisResult.landmarkStructure[0] || '';
    const landmarks = analysisResult.landmarkStructure.slice(0, 3).join('|');
    const bodyHash = this.createBodyHash(analysisResult.elements);
    const screenFingerprint = `${url}:${bodyHash}:${mainHeading}:${landmarks}`;
    
    const buildTime = Date.now() - startTime;
    const visibleElements = analysisResult.elements.filter(el => el.visible).length;
    const interactiveElements = analysisResult.elements.filter(el => el.clickable || el.focusable).length;
    
    const performanceContext = {
      buildTime,
      elementsProcessed: analysisResult.elements.length,
      visibleElements,
      interactiveElements,
      renderComplete: true // Could be enhanced with actual render detection
    };

    const uiGraph: UIGraph = {
      ...analysisResult,
      screenFingerprint,
      timestamp: Date.now(),
      url,
      title,
      performanceContext
    };
    
    console.log(`[UI-Graph] Built enhanced UI model with ${uiGraph.elements.length} elements in ${buildTime}ms`);
    console.log(`[UI-Graph] Element breakdown: ${uiGraph.elements.filter(e => e.tag === 'input').length} inputs, ${uiGraph.elements.filter(e => e.tag === 'button').length} buttons, ${uiGraph.elements.filter(e => e.tag === 'a').length} links`);
    console.log(`[UI-Graph] Visible: ${visibleElements}, Interactive: ${interactiveElements}`);
    console.log(`[UI-Graph] Context: Workflow steps: ${uiGraph.workflowState?.totalSteps || 0}, Errors: ${uiGraph.workflowState?.formValidationErrors || 0}`);
    console.log(`[UI-Graph] Screen fingerprint: ${screenFingerprint}`);
    
    return uiGraph;
  }

  // Create hash from visible elements for better fingerprinting
  private createBodyHash(elements: UIElement[]): string {
    const visibleText = elements
      .filter(el => el.visible && (el.textContent || el.accessibleName || el.placeholder))
      .map(el => (el.textContent || el.accessibleName || el.placeholder || '').trim())
      .filter(text => text.length > 0 && text.length < 50)
      .sort()
      .join('|')
      .slice(0, 100); // Limit length
    
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < visibleText.length; i++) {
      const char = visibleText.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return Math.abs(hash).toString(36);
  }
  
  findElementsByLabel(uiGraph: UIGraph, label: string, elementType?: 'input' | 'button' | 'any'): UIElement[] {
    const candidates = uiGraph.elements.filter(element => {
      // Type filtering
      if (elementType === 'input' && !['input', 'textarea'].includes(element.tag)) {
        return false;
      }
      if (elementType === 'button' && element.tag !== 'button' && element.role !== 'button' && !element.clickable) {
        return false;
      }
      
      // Must be visible and enabled
      if (!element.visible || !element.enabled || !element.isInActiveTab) {
        return false;
      }
      
      // Label matching (simple)
      const labelLower = label.toLowerCase();
      const accessibleName = (element.accessibleName || '').toLowerCase();
      const placeholder = (element.placeholder || '').toLowerCase();
      const text = (element.text || '').toLowerCase();
      
      return accessibleName.includes(labelLower) ||
             placeholder.includes(labelLower) ||
             text.includes(labelLower) ||
             element.dataTestId?.toLowerCase().includes(labelLower) ||
             element.name?.toLowerCase().includes(labelLower);
    });
    
    return candidates;
  }
  
  getElementContext(element: UIElement, uiGraph: UIGraph): string {
    const context: string[] = [];
    
    if (element.sectionTitle) {
      context.push(`Section: ${element.sectionTitle}`);
    }
    
    if (element.formGroup) {
      context.push(`Form: ${element.formGroup}`);
    }
    
    if (element.parentModalOrDrawer) {
      context.push(`Modal: ${element.parentModalOrDrawer}`);
    }
    
    if (element.nearbyText.length > 0) {
      context.push(`Nearby: ${element.nearbyText.join(', ')}`);
    }
    
    return context.join(' | ');
  }
}
