'use client';

import { useState } from 'react';
import { FileText, Edit3, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useCEOLunaStore } from '@/lib/ceo-luna-store';
import { useWindowStore } from '@/lib/window-store';
import { editorBridgeApi } from '@/lib/api/workspace';

export function DocViewer() {
  const { selectedFilePath, fileContent, isLoadingFile } = useCEOLunaStore();
  const { openApp, setPendingEditorContext } = useWindowStore();
  const [isOpeningEditor, setIsOpeningEditor] = useState(false);

  const handleOpenInEditor = async () => {
    if (!selectedFilePath) return;
    setIsOpeningEditor(true);
    try {
      const mapping = await editorBridgeApi.getWorkspaceMapping(selectedFilePath);
      setPendingEditorContext({
        sourceType: 'workspace',
        sourceId: selectedFilePath,
        documentId: mapping.documentId,
        documentName: mapping.documentName,
        initialContent: mapping.initialContent,
      });
      openApp('editor');
    } catch (err) {
      console.error('Failed to open in editor:', err);
    } finally {
      setIsOpeningEditor(false);
    }
  };

  if (!selectedFilePath) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-950 text-center px-8">
        <FileText size={40} className="text-gray-700 mb-3" />
        <p className="text-gray-500 text-sm">Select a file from the tree</p>
        <p className="text-gray-700 text-xs mt-1">Documents, Plans, and Week folders</p>
      </div>
    );
  }

  if (isLoadingFile) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-950">
        <Loader2 size={24} className="text-gray-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* File header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-slate-400" />
          <span className="text-sm text-gray-300 font-medium">
            {selectedFilePath.split('/').pop()?.replace(/\.md$/, '') || selectedFilePath}
          </span>
          <span className="text-xs text-gray-600">{selectedFilePath}</span>
        </div>
        <button
          onClick={handleOpenInEditor}
          disabled={isOpeningEditor}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded transition-colors disabled:opacity-50"
        >
          {isOpeningEditor ? <Loader2 size={11} className="animate-spin" /> : <Edit3 size={11} />}
          Edit
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {fileContent ? (
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown>{fileContent}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-gray-600 text-sm italic">File is empty</p>
        )}
      </div>
    </div>
  );
}
