import React, { useState, useRef, useEffect } from 'react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomOneDark, atomOneLight } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import markdown from 'react-syntax-highlighter/dist/esm/languages/hljs/markdown';

// Register markdown language
SyntaxHighlighter.registerLanguage('markdown', markdown);

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
  maxHeight?: string;
  readOnly?: boolean;
}

export default function MarkdownEditor({
  value,
  onChange,
  placeholder = 'Enter markdown...',
  className = '',
  minHeight = '200px',
  maxHeight = '60vh',
  readOnly = false
}: MarkdownEditorProps) {
  const [isEditing, setIsEditing] = useState(true);
  const [isDarkMode] = useState(false); // Could be from theme context
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [textareaHeight, setTextareaHeight] = useState<string>(minHeight);

  useEffect(() => {
    if (textareaRef.current && isEditing) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(cursorPosition, cursorPosition);
    }
  }, [isEditing, cursorPosition]);

  // Sync scroll between textarea and syntax highlighting
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = target.scrollTop;
      highlightRef.current.scrollLeft = target.scrollLeft;
    }
  };

  // Auto-resize textarea based on content
  const autoResizeTextarea = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset height to auto to get the actual scrollHeight
      textarea.style.height = 'auto';
      const scrollHeight = textarea.scrollHeight;
      const minHeightPx = parseInt(minHeight);
      
      // Calculate max height in pixels
      let maxHeightPx: number;
      if (maxHeight.includes('vh')) {
        const vhValue = parseInt(maxHeight);
        maxHeightPx = (window.innerHeight * vhValue) / 100;
      } else {
        maxHeightPx = parseInt(maxHeight);
      }
      
      // Determine final height with min/max constraints
      const idealHeight = Math.max(scrollHeight, minHeightPx);
      const finalHeight = Math.min(idealHeight, maxHeightPx);
      const shouldScroll = scrollHeight > maxHeightPx;
      
      const newHeightPx = `${finalHeight}px`;
      textarea.style.height = newHeightPx;
      textarea.style.overflow = shouldScroll ? 'auto' : 'hidden';
      setTextareaHeight(newHeightPx);
      
      // Also update the highlight layer
      if (highlightRef.current) {
        highlightRef.current.style.height = newHeightPx;
        highlightRef.current.style.overflow = shouldScroll ? 'hidden' : 'hidden';
      }
    }
  };

  // Ensure initial scroll sync and resize
  useEffect(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
      // Auto-resize when content or mode changes
      autoResizeTextarea();
    }
  }, [value, isEditing, minHeight, maxHeight]);

  // Auto-resize on mount and when minHeight changes
  useEffect(() => {
    autoResizeTextarea();
  }, []);

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setCursorPosition(e.target.selectionStart);
    onChange(newValue);
    // Auto-resize after content change
    setTimeout(() => autoResizeTextarea(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const { selectionStart, selectionEnd, value: textValue } = textarea;

    // Handle Tab key for indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      const newValue = textValue.substring(0, selectionStart) + '  ' + textValue.substring(selectionEnd);
      onChange(newValue);
      setTimeout(() => {
        textarea.setSelectionRange(selectionStart + 2, selectionStart + 2);
      }, 0);
    }

    // Handle Enter key for auto-indentation and list continuation
    if (e.key === 'Enter') {
      const lineStart = textValue.lastIndexOf('\n', selectionStart - 1) + 1;
      const lineEnd = textValue.indexOf('\n', selectionStart);
      const currentLine = textValue.substring(lineStart, lineEnd === -1 ? textValue.length : lineEnd);
      
      // Check for list patterns
      const listMatch = currentLine.match(/^(\s*)([-*+]|\d+\.)\s/);
      const indentMatch = currentLine.match(/^(\s+)/);
      
      if (listMatch) {
        e.preventDefault();
        const indent = listMatch[1];
        const marker = listMatch[2];
        let newMarker = marker;
        
        // If it's a numbered list, increment the number
        if (/\d+/.test(marker)) {
          const num = parseInt(marker) + 1;
          newMarker = `${num}.`;
        }
        
        const newValue = textValue.substring(0, selectionStart) + '\n' + indent + newMarker + ' ' + textValue.substring(selectionEnd);
        onChange(newValue);
        setTimeout(() => {
          const newPos = selectionStart + indent.length + newMarker.length + 2;
          textarea.setSelectionRange(newPos, newPos);
        }, 0);
      } else if (indentMatch) {
        e.preventDefault();
        const indent = indentMatch[1];
        const newValue = textValue.substring(0, selectionStart) + '\n' + indent + textValue.substring(selectionEnd);
        onChange(newValue);
        setTimeout(() => {
          const newPos = selectionStart + indent.length + 1;
          textarea.setSelectionRange(newPos, newPos);
        }, 0);
      }
    }
  };

  const toggleMode = () => {
    if (isEditing && textareaRef.current) {
      setCursorPosition(textareaRef.current.selectionStart);
    }
    setIsEditing(!isEditing);
  };

  return (
    <div className={`ios-card overflow-hidden ${className}`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/60 bg-gray-50/50">
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span className="font-mono">markdown</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleMode}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              isEditing 
                ? 'bg-blue-100 text-blue-700' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={toggleMode}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              !isEditing 
                ? 'bg-blue-100 text-blue-700' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Preview
          </button>
        </div>
      </div>
      
      <div className="relative">
        {isEditing ? (
          <div className="relative overflow-hidden">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              onScroll={handleScroll}
              placeholder={placeholder}
              readOnly={readOnly}
              className="w-full p-4 font-mono text-sm bg-transparent border-0 outline-none resize-none text-transparent caret-gray-900 relative z-10"
              style={{ 
                height: textareaHeight,
                minHeight,
                maxHeight,
                fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(0,0,0,0.2) transparent'
              }}
            />
            {/* Syntax highlighting background layer */}
            <div 
              ref={highlightRef}
              className="absolute inset-0 p-4 pointer-events-none overflow-hidden z-0"
              style={{
                height: textareaHeight,
                minHeight,
                fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none'
              }}
            >
              <SyntaxHighlighter
                language="markdown"
                style={isDarkMode ? atomOneDark : atomOneLight}
                customStyle={{
                  background: 'transparent',
                  padding: 0,
                  margin: 0,
                  fontSize: '0.875rem',
                  lineHeight: '1.25rem',
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
                  overflow: 'visible'
                }}
                codeTagProps={{
                  style: {
                    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace'
                  }
                }}
              >
                {value || ' '}
              </SyntaxHighlighter>
            </div>
            {/* Placeholder overlay when empty */}
            {!value && (
              <div className="absolute inset-0 p-4 pointer-events-none text-gray-400 text-sm font-mono z-5">
                {placeholder}
              </div>
            )}
          </div>
        ) : (
          <div className="p-4" style={{ minHeight }}>
            {value ? (
              <SyntaxHighlighter
                language="markdown"
                style={isDarkMode ? atomOneDark : atomOneLight}
                customStyle={{
                  background: 'transparent',
                  padding: 0,
                  margin: 0,
                  fontSize: '0.875rem',
                  lineHeight: '1.25rem',
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace'
                }}
                wrapLongLines
              >
                {value}
              </SyntaxHighlighter>
            ) : (
              <div className="text-gray-400 text-sm font-mono">{placeholder}</div>
            )}
          </div>
        )}
      </div>
      
      {isEditing && (
        <div className="px-3 py-2 border-t border-white/60 bg-gray-50/30 text-xs text-gray-500">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span>Lines: {value.split('\n').length}</span>
              <span>Characters: {value.length}</span>
            </div>
            <div className="flex items-center gap-3">
              <kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">Tab</kbd>
              <span>indent</span>
              <kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">⌘/Ctrl+S</kbd>
              <span>save</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}