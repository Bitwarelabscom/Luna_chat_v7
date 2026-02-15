'use client';

import React, { useState, useEffect } from 'react';

interface TextRendererProps {
  content: string;
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
  onSelectionChange?: (start: number, end: number, selectedText: string) => void;
}

export function TextRenderer({
  content,
  onChange,
  readOnly = false,
  onSelectionChange,
}: TextRendererProps) {
  const [localContent, setLocalContent] = useState(content);

  useEffect(() => {
    setLocalContent(content);
  }, [content]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setLocalContent(newContent);
    if (onChange) {
      onChange(newContent);
    }
  };

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    if (!onSelectionChange || readOnly) return;

    const target = e.target as HTMLTextAreaElement;
    const start = target.selectionStart;
    const end = target.selectionEnd;

    if (start !== end) {
      const selectedText = localContent.substring(start, end);
      onSelectionChange(start, end, selectedText);
    }
  };

  return (
    <div className="h-full w-full overflow-auto bg-gray-900 p-4">
      <textarea
        value={localContent}
        onChange={handleChange}
        onSelect={handleSelect}
        readOnly={readOnly}
        className="w-full h-full bg-transparent text-white font-mono text-sm resize-none outline-none"
        placeholder="Start writing..."
        spellCheck={false}
      />
    </div>
  );
}
