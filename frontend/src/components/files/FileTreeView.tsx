'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import {
  ChevronRight, ChevronDown, Folder, FolderOpen,
  File, FileText, FileCode, Code, FileBox
} from 'lucide-react';
import { useFilesStore, type TreeNode } from '@/lib/files-store';

const INDENT_PX = 16;
const LUNA_MIME_TYPE = 'application/x-luna-files';

function getFileIcon(name: string, mimeType?: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (mimeType?.includes('python') || ext === 'py') return <FileCode className="w-4 h-4 text-yellow-400 flex-shrink-0" />;
  if (['js', 'ts', 'sh'].includes(ext || '')) return <Code className="w-4 h-4 text-blue-400 flex-shrink-0" />;
  if (['txt', 'md', 'markdown', 'mdown', 'mkdn', 'json', 'csv'].includes(ext || '')) return <FileText className="w-4 h-4 text-green-400 flex-shrink-0" />;
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'pptx'].includes(ext || '')) return <FileBox className="w-4 h-4 text-red-400 flex-shrink-0" />;
  return <File className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--theme-text-muted)' }} />;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

interface TreeRowProps {
  node: TreeNode;
  onDoubleClick: (node: TreeNode) => void;
  onRenameSubmit: (oldPath: string, newName: string) => void;
  onNewFolderSubmit: (parentPath: string, name: string) => void;
}

function TreeRow({ node, onDoubleClick, onRenameSubmit, onNewFolderSubmit }: TreeRowProps) {
  const {
    selectedPaths, selectPath, expandedPaths, toggleExpand,
    openContextMenu, renameTarget, setRenameTarget,
    newFolderParent, setNewFolderParent,
    dragSource, setDragSource, dropTarget, setDropTarget,
  } = useFilesStore();

  const [renameValue, setRenameValue] = useState(node.name);
  const [newFolderValue, setNewFolderValue] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);
  const newFolderRef = useRef<HTMLInputElement>(null);
  const isSelected = selectedPaths.has(node.path);
  const isExpanded = expandedPaths.has(node.path);
  const isDropTarget = dropTarget === node.path;
  const isRenaming = renameTarget === node.path;
  const isNewFolderParent = newFolderParent === node.path;

  useEffect(() => {
    if (isRenaming && renameRef.current) {
      renameRef.current.focus();
      // Select name without extension for files
      if (!node.isDirectory) {
        const dotIdx = node.name.lastIndexOf('.');
        renameRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : node.name.length);
      } else {
        renameRef.current.select();
      }
    }
  }, [isRenaming, node.isDirectory, node.name]);

  useEffect(() => {
    if (isNewFolderParent && newFolderRef.current) {
      newFolderRef.current.focus();
    }
  }, [isNewFolderParent]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.isDirectory) {
      toggleExpand(node.path);
    }
    selectPath(node.path, e.ctrlKey || e.metaKey, e.shiftKey);
  }, [node.path, node.isDirectory, selectPath, toggleExpand]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDoubleClick(node);
  }, [node, onDoubleClick]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedPaths.has(node.path)) {
      selectPath(node.path, false, false);
    }
    openContextMenu(e.clientX, e.clientY, node);
  }, [node, selectedPaths, selectPath, openContextMenu]);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    const paths = selectedPaths.has(node.path)
      ? Array.from(selectedPaths)
      : [node.path];
    e.dataTransfer.setData(LUNA_MIME_TYPE, JSON.stringify(paths));
    e.dataTransfer.effectAllowed = 'move';
    setDragSource(paths);
  }, [node.path, selectedPaths, setDragSource]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!node.isDirectory) return;
    if (dragSource?.includes(node.path)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(node.path);
  }, [node.isDirectory, node.path, dragSource, setDropTarget]);

  const handleDragLeave = useCallback(() => {
    if (dropTarget === node.path) setDropTarget(null);
  }, [node.path, dropTarget, setDropTarget]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDropTarget(null);
    // External drops handled by parent container
  }, [setDropTarget]);

  const handleDragEnd = useCallback(() => {
    setDragSource(null);
    setDropTarget(null);
  }, [setDragSource, setDropTarget]);

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (renameValue.trim() && renameValue !== node.name) {
        onRenameSubmit(node.path, renameValue.trim());
      }
      setRenameTarget(null);
    } else if (e.key === 'Escape') {
      setRenameTarget(null);
      setRenameValue(node.name);
    }
  };

  const handleNewFolderKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (newFolderValue.trim()) {
        onNewFolderSubmit(node.path, newFolderValue.trim());
      }
      setNewFolderParent(null);
      setNewFolderValue('');
    } else if (e.key === 'Escape') {
      setNewFolderParent(null);
      setNewFolderValue('');
    }
  };

  return (
    <>
      <div
        className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer select-none transition-colors ${
          isSelected ? 'bg-[var(--theme-accent-primary)]/20' : 'hover:bg-[var(--theme-bg-tertiary)]'
        } ${isDropTarget ? 'ring-1 ring-[var(--theme-accent-primary)]' : ''}`}
        style={{ paddingLeft: `${node.depth * INDENT_PX + 4}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        draggable={!isRenaming}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
      >
        {/* Chevron for directories */}
        {node.isDirectory ? (
          <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--theme-text-muted)' }} />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--theme-text-muted)' }} />
            )}
          </span>
        ) : (
          <span className="w-4 h-4 flex-shrink-0" />
        )}

        {/* Icon */}
        {node.isDirectory ? (
          isExpanded ? (
            <FolderOpen className="w-4 h-4 text-blue-400 flex-shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-blue-400 flex-shrink-0" />
          )
        ) : (
          getFileIcon(node.name, node.file?.mimeType)
        )}

        {/* Name (or rename input) */}
        {isRenaming ? (
          <input
            ref={renameRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={() => { setRenameTarget(null); setRenameValue(node.name); }}
            className="flex-1 min-w-0 text-sm bg-[var(--theme-bg-tertiary)] border border-[var(--theme-accent-primary)] rounded px-1 py-0 outline-none"
            style={{ color: 'var(--theme-text-primary)' }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 min-w-0 text-sm truncate" style={{ color: 'var(--theme-text-primary)' }}>
            {node.name}
          </span>
        )}

        {/* File metadata */}
        {!node.isDirectory && node.file && !isRenaming && (
          <span className="text-xs flex-shrink-0 ml-auto pl-2" style={{ color: 'var(--theme-text-muted)' }}>
            {formatSize(node.file.size)} {formatDate(node.file.updatedAt)}
          </span>
        )}
      </div>

      {/* Inline new-folder input when this directory is the target */}
      {isNewFolderParent && isExpanded && (
        <div
          className="flex items-center gap-1.5 px-2 py-1"
          style={{ paddingLeft: `${(node.depth + 1) * INDENT_PX + 4}px` }}
        >
          <span className="w-4 h-4 flex-shrink-0" />
          <Folder className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <input
            ref={newFolderRef}
            value={newFolderValue}
            onChange={(e) => setNewFolderValue(e.target.value)}
            onKeyDown={handleNewFolderKeyDown}
            onBlur={() => { setNewFolderParent(null); setNewFolderValue(''); }}
            placeholder="New folder name..."
            className="flex-1 min-w-0 text-sm bg-[var(--theme-bg-tertiary)] border border-[var(--theme-accent-primary)] rounded px-1 py-0 outline-none"
            style={{ color: 'var(--theme-text-primary)' }}
          />
        </div>
      )}
    </>
  );
}

interface FileTreeViewProps {
  onDoubleClick: (node: TreeNode) => void;
  onRenameSubmit: (oldPath: string, newName: string) => void;
  onNewFolderSubmit: (parentPath: string, name: string) => void;
  onNewFolderRoot: (name: string) => void;
}

export default function FileTreeView({ onDoubleClick, onRenameSubmit, onNewFolderSubmit, onNewFolderRoot }: FileTreeViewProps) {
  const { tree, expandedPaths, openContextMenu, clearSelection, newFolderParent } = useFilesStore();
  const [rootNewFolder, setRootNewFolder] = useState('');
  const rootNewFolderRef = useRef<HTMLInputElement>(null);
  const isRootNewFolder = newFolderParent === '__root__';

  useEffect(() => {
    if (isRootNewFolder && rootNewFolderRef.current) {
      rootNewFolderRef.current.focus();
    }
  }, [isRootNewFolder]);

  const handleBackgroundClick = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  const handleBackgroundContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    clearSelection();
    openContextMenu(e.clientX, e.clientY, null);
  }, [clearSelection, openContextMenu]);

  const handleRootNewFolderKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && rootNewFolder.trim()) {
      onNewFolderRoot(rootNewFolder.trim());
      setRootNewFolder('');
      useFilesStore.getState().setNewFolderParent(null);
    } else if (e.key === 'Escape') {
      setRootNewFolder('');
      useFilesStore.getState().setNewFolderParent(null);
    }
  };

  function renderNodes(nodes: TreeNode[]) {
    return nodes.map(node => (
      <div key={node.path}>
        <TreeRow
          node={node}
          onDoubleClick={onDoubleClick}
          onRenameSubmit={onRenameSubmit}
          onNewFolderSubmit={onNewFolderSubmit}
        />
        {node.isDirectory && expandedPaths.has(node.path) && node.children.length > 0 && (
          renderNodes(node.children)
        )}
      </div>
    ));
  }

  return (
    <div
      className="flex-1 overflow-auto p-1"
      onClick={handleBackgroundClick}
      onContextMenu={handleBackgroundContextMenu}
    >
      {tree.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--theme-text-muted)' }}>
          <Folder className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm mb-1">No files</p>
          <p className="text-xs opacity-70">Drop files here or use the toolbar</p>
        </div>
      ) : (
        renderNodes(tree)
      )}

      {/* Root-level new folder input */}
      {isRootNewFolder && (
        <div className="flex items-center gap-1.5 px-2 py-1" style={{ paddingLeft: '4px' }}>
          <span className="w-4 h-4 flex-shrink-0" />
          <Folder className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <input
            ref={rootNewFolderRef}
            value={rootNewFolder}
            onChange={(e) => setRootNewFolder(e.target.value)}
            onKeyDown={handleRootNewFolderKeyDown}
            onBlur={() => { useFilesStore.getState().setNewFolderParent(null); setRootNewFolder(''); }}
            placeholder="New folder name..."
            className="flex-1 min-w-0 text-sm bg-[var(--theme-bg-tertiary)] border border-[var(--theme-accent-primary)] rounded px-1 py-0 outline-none"
            style={{ color: 'var(--theme-text-primary)' }}
          />
        </div>
      )}
    </div>
  );
}
