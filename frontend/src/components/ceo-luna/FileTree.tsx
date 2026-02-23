'use client';

import { useState } from 'react';
import { Folder, FolderOpen, FileText, Plus, RefreshCw, Loader2 } from 'lucide-react';
import { useCEOLunaStore } from '@/lib/ceo-luna-store';

const FOLDERS = ['Documents', 'Plans', 'Week'] as const;

export function FileTree() {
  const { fileTree, isLoadingTree, selectedFilePath, selectFile, loadFileTree, createFile } = useCEOLunaStore();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['Documents', 'Plans', 'Week']));
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const toggleFolder = (folder: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const handleNewFile = async (folder: string) => {
    if (!newFileName.trim()) return;
    setIsCreating(true);
    try {
      await createFile(folder, newFileName.trim());
      setCreatingIn(null);
      setNewFileName('');
    } catch {
      // ignore
    } finally {
      setIsCreating(false);
    }
  };

  const filesForFolder = (folder: string) =>
    fileTree.filter((f) => f.folder === folder || (folder === 'Documents' && f.folder === 'Other'));

  return (
    <div className="flex flex-col h-full bg-gray-900 border-r border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Files</span>
        <button
          onClick={loadFileTree}
          disabled={isLoadingTree}
          className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
          title="Refresh"
        >
          {isLoadingTree ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {FOLDERS.map((folder) => {
          const isExpanded = expandedFolders.has(folder);
          const files = filesForFolder(folder);
          const FolderIcon = isExpanded ? FolderOpen : Folder;

          return (
            <div key={folder}>
              {/* Folder row */}
              <div className="flex items-center group">
                <button
                  onClick={() => toggleFolder(folder)}
                  className="flex-1 flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors text-left"
                >
                  <FolderIcon size={12} className="text-amber-400 shrink-0" />
                  <span className="font-medium">{folder}</span>
                  <span className="text-gray-600 ml-1">({files.length})</span>
                </button>
                <button
                  onClick={() => {
                    setCreatingIn(folder);
                    setNewFileName('');
                    if (!isExpanded) toggleFolder(folder);
                  }}
                  className="px-2 py-1.5 text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
                  title={`New file in ${folder}`}
                >
                  <Plus size={11} />
                </button>
              </div>

              {/* Files */}
              {isExpanded && (
                <div className="pl-2">
                  {files.map((file) => (
                    <button
                      key={file.path}
                      onClick={() => selectFile(file.path)}
                      className={`w-full flex items-center gap-1.5 px-3 py-1 text-xs transition-colors text-left ${
                        selectedFilePath === file.path
                          ? 'bg-slate-700 text-gray-100'
                          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                      }`}
                    >
                      <FileText size={11} className="shrink-0 text-gray-500" />
                      <span className="truncate">{file.name.replace(/\.md$/, '')}</span>
                    </button>
                  ))}

                  {/* New file input */}
                  {creatingIn === folder && (
                    <div className="px-3 py-1">
                      <input
                        autoFocus
                        value={newFileName}
                        onChange={(e) => setNewFileName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleNewFile(folder);
                          if (e.key === 'Escape') {
                            setCreatingIn(null);
                            setNewFileName('');
                          }
                        }}
                        placeholder="File name..."
                        disabled={isCreating}
                        className="w-full bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:border-slate-400 focus:outline-none placeholder-gray-500 disabled:opacity-50"
                      />
                      <div className="flex gap-1 mt-1">
                        <button
                          onClick={() => handleNewFile(folder)}
                          disabled={!newFileName.trim() || isCreating}
                          className="flex-1 text-xs py-0.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded transition-colors"
                        >
                          {isCreating ? <Loader2 size={10} className="animate-spin mx-auto" /> : 'Create'}
                        </button>
                        <button
                          onClick={() => { setCreatingIn(null); setNewFileName(''); }}
                          className="flex-1 text-xs py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {files.length === 0 && creatingIn !== folder && (
                    <div className="px-4 py-1 text-xs text-gray-600 italic">No files</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
