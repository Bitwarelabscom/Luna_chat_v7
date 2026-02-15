'use client';

import React from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { sql } from '@codemirror/lang-sql';
import { rust } from '@codemirror/lang-rust';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { EditorView } from '@codemirror/view';

interface CodeRendererProps {
  content: string;
  language?: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  onSelectionChange?: (start: number, end: number, selectedText: string) => void;
}

const getLanguageExtension = (language?: string) => {
  switch (language?.toLowerCase()) {
    case 'javascript':
    case 'js':
      return javascript({ jsx: true });
    case 'typescript':
    case 'ts':
      return javascript({ jsx: true, typescript: true });
    case 'python':
    case 'py':
      return python();
    case 'html':
      return html();
    case 'css':
      return css();
    case 'sql':
      return sql();
    case 'rust':
    case 'rs':
      return rust();
    case 'cpp':
    case 'c++':
      return cpp();
    case 'java':
      return java();
    default:
      return javascript();
  }
};

export function CodeRenderer({
  content,
  language,
  onChange,
  readOnly = false,
  onSelectionChange,
}: CodeRendererProps) {
  const extensions = [
    getLanguageExtension(language),
    EditorView.lineWrapping,
  ];

  // Handle selection changes
  const handleUpdate = (value: string, viewUpdate: any) => {
    if (onChange) {
      onChange(value);
    }

    // Track text selection for contextual editing
    if (onSelectionChange && viewUpdate.state) {
      const selection = viewUpdate.state.selection.main;
      if (selection.from !== selection.to) {
        const selectedText = viewUpdate.state.doc.sliceString(selection.from, selection.to);
        onSelectionChange(selection.from, selection.to, selectedText);
      }
    }
  };

  return (
    <div className="h-full w-full overflow-auto">
      <CodeMirror
        value={content}
        height="100%"
        extensions={extensions}
        onChange={handleUpdate}
        editable={!readOnly}
        theme="dark"
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightSpecialChars: true,
          foldGutter: true,
          drawSelection: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          syntaxHighlighting: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          rectangularSelection: true,
          crosshairCursor: true,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          closeBracketsKeymap: true,
          searchKeymap: true,
          foldKeymap: true,
          completionKeymap: true,
          lintKeymap: true,
        }}
        className="text-sm font-mono"
      />
    </div>
  );
}
