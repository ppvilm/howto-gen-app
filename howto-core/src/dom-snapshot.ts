import { Page } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

export interface DOMElement {
  tag: string;
  attributes: Record<string, string>;
  text?: string;
  children?: DOMElement[];
  xpath?: string;
  selector?: string;
}

export class DOMSnapshot {
  static async capture(page: Page): Promise<DOMElement> {
    return await page.evaluate(() => {
      function getXPath(element: Element): string {
        if (element.id) {
          return `//*[@id="${element.id}"]`;
        }
        
        const parts: string[] = [];
        let current: Element | null = element;
        
        while (current && current.nodeType === Node.ELEMENT_NODE) {
          let index = 1;
          let sibling = current.previousElementSibling;
          
          while (sibling) {
            if (sibling.tagName === current.tagName) {
              index++;
            }
            sibling = sibling.previousElementSibling;
          }
          
          const tagName = current.tagName.toLowerCase();
          const part = index > 1 ? `${tagName}[${index}]` : tagName;
          parts.unshift(part);
          
          current = current.parentElement;
        }
        
        return parts.length ? '/' + parts.join('/') : '';
      }


      function generateSelector(element: Element): string {
        try {
          // Try ID first
          if (element.id) {
            return `#${element.id}`;
          }
          
          // Try unique class combinations
          if (element.className) {
            try {
              let className: string = '';
              const cn = element.className as any;
              if (typeof cn === 'string') {
                className = cn;
              } else if (cn && typeof cn.baseVal === 'string') {
                className = cn.baseVal;
              } else if (cn && typeof cn.toString === 'function') {
                className = cn.toString();
              }
              
              if (className && typeof className === 'string') {
                const classes = className.split(' ').filter(c => c.trim());
                if (classes.length > 0) {
                  const classSelector = '.' + classes.join('.');
                  if (document.querySelectorAll(classSelector).length === 1) {
                    return classSelector;
                  }
                }
              }
            } catch (e) {
              // Skip if className handling fails
            }
          }
          
          // Try data attributes
          try {
            for (const attr of element.attributes) {
              if (attr.name.startsWith('data-') && attr.value) {
                const selector = `[${attr.name}="${attr.value}"]`;
                if (document.querySelectorAll(selector).length === 1) {
                  return selector;
                }
              }
            }
          } catch (e) {
            // Skip if attributes iteration fails
          }
          
          // Fall back to xpath-like selector
          return getXPath(element);
        } catch (e) {
          // Ultimate fallback
          return element.tagName.toLowerCase();
        }
      }

      function elementToObject(element: Element): DOMElement {
        const attributes: Record<string, string> = {};
        
        for (const attr of element.attributes) {
          // Skip style attributes for LLM processing
          if (attr.name === 'style') {
            continue;
          }
          attributes[attr.name] = attr.value;
        }

        // Inject live form control state (handles typed values not reflected in attributes)
        try {
          const tag = element.tagName.toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select') {
            // Safely read the current value from the DOM property
            const anyEl: any = element as any;
            const currentValue: string = typeof anyEl.value === 'string' ? anyEl.value : '';

            // If it's an input[type=password], avoid leaking the value but expose presence/length
            const typeAttr = (element as HTMLInputElement).type?.toLowerCase?.() || '';
            if (tag === 'input' && typeAttr === 'password') {
              if (currentValue && currentValue.length > 0) {
                attributes['data-has-value'] = 'true';
                attributes['data-value-length'] = String(currentValue.length);
              } else {
                attributes['data-has-value'] = 'false';
              }
            } else {
              // For non-password fields, include the actual value so checks can see it
              if (currentValue && currentValue.length > 0) {
                attributes['value'] = currentValue;
                attributes['data-has-value'] = 'true';
              } else {
                // Explicitly mark empty to avoid stale "empty" heuristics
                attributes['data-has-value'] = 'false';
              }
            }
          }
        } catch (_) {
          // If any error occurs while reading live values, ignore and proceed
        }
        
        const textContent = element.textContent?.trim() || '';
        const directText = Array.from(element.childNodes)
          .filter(node => node.nodeType === Node.TEXT_NODE)
          .map(node => node.textContent?.trim())
          .filter(text => text)
          .join(' ');

        const obj: DOMElement = {
          tag: element.tagName.toLowerCase(),
          attributes,
          xpath: getXPath(element),
          selector: generateSelector(element)
        };

        if (directText) {
          obj.text = directText;
        } else if (textContent && textContent.length < 100) {
          obj.text = textContent;
        }

        // Include all elements except SVG elements
        if (element.children.length > 0) {
          const children: DOMElement[] = [];
          
          for (const child of element.children) {
            // Skip SVG elements and their children for LLM processing
            if (child.tagName.toLowerCase() === 'svg') {
              continue;
            }
            const childObj = elementToObject(child);
            children.push(childObj);
          }
          
          if (children.length > 0) {
            obj.children = children;
          }
        }

        return obj;
      }

      return elementToObject(document.body);
    });
  }

  static cleanForAI(domElement: DOMElement): any {
    function cleanElement(element: DOMElement): any {
      const cleaned: any = {
        tag: element.tag,
        attributes: { ...element.attributes },
        text: element.text,
        selector: element.selector
      };

      // Remove style attributes for LLM processing
      if (cleaned.attributes.style) {
        delete cleaned.attributes.style;
      }

      // Only clean JSS class names, keep everything else
      if (element.attributes.class) {
        const cleanClasses = element.attributes.class
          .split(' ')
          .filter(cls => {
            // Remove JSS patterns like: jss123, css-abc123, makeStyles-root-456, etc.
            if (/^jss\d+$/.test(cls)) return false;
            if (/^css-[a-z0-9]+$/i.test(cls)) return false;
            if (/^makeStyles-\w+-\d+$/.test(cls)) return false;
            if (/^[a-z]{3,}-[a-z0-9]{6,}$/i.test(cls)) return false; // emotion/styled-components
            if (/^[a-z]+_[a-z0-9]{5,}$/i.test(cls)) return false; // CSS modules with hash
            // Keep all other class names
            return cls.length > 0;
          })
          .join(' ');
        
        if (cleanClasses) {
          cleaned.attributes.class = cleanClasses;
        } else {
          // Remove empty class attribute
          delete cleaned.attributes.class;
        }
      }

      // Recursively clean children
      if (element.children && element.children.length > 0) {
        cleaned.children = element.children.map(child => cleanElement(child));
      }

      return cleaned;
    }

    return cleanElement(domElement);
  }

  static compactForLLM(domElement: DOMElement): any {
    function compactElement(element: DOMElement, depth: number = 0): any {
      // Limit depth to avoid very deep nesting
      if (depth > 6) return null;

      const compact: any = {
        t: element.tag // shortened 'tag'
      };

      // Only include important attributes
      const importantAttrs: any = {};
      if (element.attributes.id) importantAttrs.i = element.attributes.id;
      if (element.attributes.class) {
        const cleanClasses = element.attributes.class
          .split(' ')
          .filter(cls => {
            // Keep semantic class names, remove generated ones
            if (/^jss\d+$/.test(cls)) return false;
            if (/^css-[a-z0-9]+$/i.test(cls)) return false;
            if (/^makeStyles-\w+-\d+$/.test(cls)) return false;
            if (/^[a-z]{3,}-[a-z0-9]{6,}$/i.test(cls)) return false;
            if (/^[a-z]+_[a-z0-9]{5,}$/i.test(cls)) return false;
            return cls.length > 0 && cls.length < 30; // Skip very long class names
          })
          .slice(0, 3) // Max 3 classes
          .join(' ');
        if (cleanClasses) importantAttrs.c = cleanClasses;
      }
      if (element.attributes.type) importantAttrs.type = element.attributes.type;
      if (element.attributes.placeholder) importantAttrs.ph = element.attributes.placeholder;
      if (element.attributes.value) importantAttrs.v = element.attributes.value;
      if (element.attributes['data-has-value']) importantAttrs.hv = element.attributes['data-has-value'];
      if (element.attributes['data-value-length']) importantAttrs.vl = element.attributes['data-value-length'];
      if (element.attributes.href) importantAttrs.h = element.attributes.href;
      if (element.attributes.role) importantAttrs.r = element.attributes.role;
      if (element.attributes['data-testid']) importantAttrs.tid = element.attributes['data-testid'];
      if (element.attributes['aria-label']) importantAttrs.al = element.attributes['aria-label'];

      if (Object.keys(importantAttrs).length > 0) {
        compact.a = importantAttrs;
      }

      // Only include text if it's short and meaningful
      if (element.text && element.text.length > 0 && element.text.length < 100) {
        const trimmedText = element.text.trim();
        if (trimmedText && !trimmedText.match(/^[\s\n\r]*$/)) {
          compact.x = trimmedText; // shortened 'text'
        }
      }

      // Only include first-level selector if it's concise
      if (element.selector && element.selector.length < 50) {
        compact.s = element.selector; // shortened 'selector'
      }

      // Recursively process children but be selective
      if (element.children && element.children.length > 0) {
        const compactChildren = element.children
          .map(child => compactElement(child, depth + 1))
          .filter(child => child !== null)
          .slice(0, 10); // Max 10 children per level
        
        if (compactChildren.length > 0) {
          compact.ch = compactChildren; // shortened 'children'
        }
      }

      return compact;
    }

    return compactElement(domElement);
  }

  static async captureAndSave(page: Page, filePath: string, clean: boolean = true): Promise<DOMElement> {
    const snapshot = await DOMSnapshot.capture(page);
    const dataToSave = clean ? DOMSnapshot.cleanForAI(snapshot) : snapshot;
    
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(dataToSave, null, 2), 'utf8');
    
    return snapshot;
  }

  static async captureAndSaveHTML(page: Page, filePath: string): Promise<string> {
    const htmlContent = await page.content();
    
    // Clean HTML for LLM processing: remove SVG content and style attributes
    const cleanedHTML = DOMSnapshot.cleanHTMLForLLM(htmlContent, {
      url: page.url(),
      title: await page.title(),
      label: 'captureAndSaveHTML',
      elementType: 'html_capture'
    });
    
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, cleanedHTML, 'utf8');
    
    return cleanedHTML;
  }

  static cleanHTMLForLLM(htmlContent: string, debugInfo?: {
    url?: string;
    title?: string;
    label?: string;
    elementType?: string;
  }): string {
    console.log(`Original HTML length: ${htmlContent.length}`);
    
    // Remove all SVG elements and their content
    let cleaned = htmlContent.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '');
    
    // Remove style attributes from all elements
    cleaned = cleaned.replace(/\s+style\s*=\s*"[^"]*"/gi, '');
    cleaned = cleaned.replace(/\s+style\s*=\s*'[^']*'/gi, '');
    
    // Clean JSS and generated class names from class attributes
    cleaned = cleaned.replace(/(class|className)\s*=\s*"([^"]*)"/gi, (match, attr, classes) => {
      const cleanedClasses = classes
        .split(/\s+/)
        .filter((cls: string) => {
          // Remove JSS classes: jss123, jss456, etc.
          if (/^jss\d+$/.test(cls)) return false;
          // Remove CSS-in-JS: css-abc123, makeStyles-root-456
          if (/^css-[a-zA-Z0-9]+$/.test(cls)) return false;
          if (/^makeStyles-\w+-\d+$/.test(cls)) return false;
          // Remove emotion/styled-components: abc_123def, emotion-abc123
          if (/^[a-z]{3,}-[a-zA-Z0-9]{6,}$/i.test(cls)) return false;
          if (/^[a-z]+_[a-zA-Z0-9]{5,}$/i.test(cls)) return false;
          return cls.length > 0;
        })
        .join(' ');
      
      // Return cleaned class attribute or remove if empty
      return cleanedClasses ? `${attr}="${cleanedClasses}"` : '';
    });

    // Also handle single quotes
    cleaned = cleaned.replace(/(class|className)\s*=\s*'([^']*)'/gi, (match, attr, classes) => {
      const cleanedClasses = classes
        .split(/\s+/)
        .filter((cls: string) => {
          if (/^jss\d+$/.test(cls)) return false;
          if (/^css-[a-zA-Z0-9]+$/.test(cls)) return false;
          if (/^makeStyles-\w+-\d+$/.test(cls)) return false;
          if (/^[a-z]{3,}-[a-zA-Z0-9]{6,}$/i.test(cls)) return false;
          if (/^[a-z]+_[a-zA-Z0-9]{5,}$/i.test(cls)) return false;
          return cls.length > 0;
        })
        .join(' ');
      
      return cleanedClasses ? `${attr}='${cleanedClasses}'` : '';
    });
    
    // Remove style tags and their content
    cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    
    // Remove script tags and their content (JavaScript is not needed for selector resolution)
    cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    
    // Remove base64 images from src attributes (they can be very large)
    cleaned = cleaned.replace(/src\s*=\s*["']data:image\/[^;]+;base64,[^"']*["']/gi, 'src=""');
    
    // Remove base64 images from style attributes
    cleaned = cleaned.replace(/background-image\s*:\s*url\(["']?data:image\/[^)]+\)/gi, 'background-image: none');
    
    // Extract only the body content with multiline matching
    const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    let result = '';
    if (bodyMatch) {
      const bodyContent = bodyMatch[1].trim();
      console.log(`Extracted body content length: ${bodyContent.length}`);
      result = bodyContent;
    } else {
      console.log('No body tag found, returning cleaned HTML');
      result = cleaned;
    }
    
    // Save debug file if debug info provided
    if (debugInfo) {
      this.saveCleanedDOMDebugFile(htmlContent, result, debugInfo).catch(error => {
        console.warn('Failed to save cleaned DOM debug file:', error);
      });
    }
    
    return result;
  }

  private static async saveCleanedDOMDebugFile(
    originalHtml: string,
    cleanedBody: string,
    debugInfo: {
      url?: string;
      title?: string;
      label?: string;
      elementType?: string;
    }
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const sanitizedLabel = debugInfo.label?.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20) || 'unknown';
      const baseFilename = `${timestamp}_${sanitizedLabel}_${debugInfo.elementType || 'element'}`;
      
      // Ensure debug directory exists
      const debugDir = path.resolve('debug-output');
      await fs.mkdir(debugDir, { recursive: true });
      
      // Save cleaned DOM with metadata
      const cleanedDomWithMetadata = `<!-- DEBUG INFO:
URL: ${debugInfo.url || 'N/A'}
Title: ${debugInfo.title || 'N/A'}
Element Label: ${debugInfo.label || 'N/A'}
Element Type: ${debugInfo.elementType || 'N/A'}
Original HTML Length: ${originalHtml.length}
Cleaned Body Length: ${cleanedBody.length}
Timestamp: ${new Date().toISOString()}
-->

${cleanedBody}`;
      
      const cleanedDomPath = path.join(debugDir, `cleaned-dom-${baseFilename}.html`);
      await fs.writeFile(cleanedDomPath, cleanedDomWithMetadata, 'utf8');
      
      console.log(`🔍 Debug: Cleaned DOM saved to ${cleanedDomPath}`);
      
    } catch (error) {
      console.warn('Failed to save cleaned DOM debug file:', error);
    }
  }

  static async saveSnapshot(snapshot: DOMElement, filePath: string, clean: boolean = true): Promise<void> {
    const dataToSave = clean ? DOMSnapshot.cleanForAI(snapshot) : snapshot;
    
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(dataToSave, null, 2), 'utf8');
  }
}
