'use client';

import { useEffect, useCallback, useRef } from 'react';
import {
  Upload, RefreshCw, Plus, FolderPlus, X, Edit3, FileBox
} from 'lucide-react';
import { workspaceApi, documentsApi, uploadWorkspaceFile, editorBridgeApi, type Document } from '@/lib/api';
import { useFilesStore, type FileTab, type TreeNode } from '@/lib/files-store';
import { useWindowStore } from '@/lib/window-store';
import FileTreeView from '@/components/files/FileTreeView';
import FileContextMenu from '@/components/files/FileContextMenu';
import FileProperties from '@/components/files/FileProperties';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const API_PREFIX = '';

const TABS: { id: FileTab; label: string }[] = [
  { id: 'all', label: 'All Files' },
  { id: 'dj-luna', label: 'DJ Luna' },
  { id: 'ceo-luna', label: 'CEO Luna' },
  { id: 'projects', label: 'Projects' },
  { id: 'documents', label: 'Documents' },
];

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function FilesWindow() {
  const store = useFilesStore();
  const openApp = useWindowStore((s) => s.openApp);
  const setPendingEditorContext = useWindowStore((s) => s.setPendingEditorContext);
  const wsInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const dragCountRef = useRef(0);
  const uploadingRef = useRef(false);

  useEffect(() => {
    store.loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- Handlers --

  const handleViewFile = useCallback(async (filename: string) => {
    try {
      const res = await workspaceApi.getFile(filename);
      store.setViewingFile({ name: filename, content: res.content });
    } catch (err) {
      console.error('Failed to load file:', err);
    }
  }, [store]);

  const handleOpenInEditor = useCallback(async (filename: string) => {
    try {
      const result = await editorBridgeApi.getWorkspaceMapping(filename);
      setPendingEditorContext({
        sourceType: 'workspace',
        sourceId: filename,
        documentId: result.documentId,
        documentName: result.documentName,
        initialContent: result.initialContent,
      });
      openApp('editor');
    } catch (err) {
      console.error('Failed to open in editor:', err);
    }
  }, [openApp, setPendingEditorContext]);

  const handleDownloadFile = useCallback(async (filename: string) => {
    try {
      const res = await workspaceApi.getFile(filename);
      const blob = new Blob([res.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.split('/').pop() || filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download:', err);
    }
  }, []);

  const handleDoubleClick = useCallback((node: TreeNode) => {
    if (node.isDirectory) {
      store.toggleExpand(node.path);
    } else {
      handleViewFile(node.path);
    }
  }, [store, handleViewFile]);

  const handleRenameSubmit = useCallback(async (oldPath: string, newName: string) => {
    try {
      const parts = oldPath.split('/');
      parts[parts.length - 1] = newName;
      const newPath = parts.join('/');

      // Check if it's a directory
      const node = store.getFlatVisibleNodes().find(n => n.path === oldPath);
      if (node?.isDirectory) {
        await workspaceApi.renameDirectory(oldPath, newPath);
      } else {
        await workspaceApi.renameFile(oldPath, newPath);
      }
      await store.loadFiles();
    } catch (err) {
      console.error('Failed to rename:', err);
      alert((err as Error).message);
    }
  }, [store]);

  const handleNewFolderSubmit = useCallback(async (parentPath: string, name: string) => {
    try {
      const fullPath = parentPath ? `${parentPath}/${name}` : name;
      await workspaceApi.createDirectory(fullPath);
      // Expand the parent
      if (parentPath && !store.expandedPaths.has(parentPath)) {
        store.toggleExpand(parentPath);
      }
      await store.loadFiles();
    } catch (err) {
      console.error('Failed to create folder:', err);
      alert((err as Error).message);
    }
  }, [store]);

  const handleNewFolderRoot = useCallback(async (name: string) => {
    try {
      await workspaceApi.createDirectory(name);
      await store.loadFiles();
    } catch (err) {
      console.error('Failed to create folder:', err);
      alert((err as Error).message);
    }
  }, [store]);

  const handleDelete = useCallback(async (paths: string[]) => {
    const count = paths.length;
    if (!confirm(`Delete ${count} item${count > 1 ? 's' : ''}?`)) return;
    try {
      for (const p of paths) {
        const node = store.getFlatVisibleNodes().find(n => n.path === p);
        if (node?.isDirectory) {
          await workspaceApi.deleteDirectory(p);
        } else {
          await workspaceApi.deleteFile(p);
        }
      }
      store.clearSelection();
      await store.loadFiles();
    } catch (err) {
      console.error('Failed to delete:', err);
      alert((err as Error).message);
    }
  }, [store]);

  const handleNewFile = useCallback(async (parentPath: string | null) => {
    const filename = prompt('Enter filename (e.g., notes.txt):');
    if (!filename) return;
    const fullPath = parentPath ? `${parentPath}/${filename}` : filename;
    try {
      await workspaceApi.createFile(fullPath, '');
      if (parentPath && !store.expandedPaths.has(parentPath)) {
        store.toggleExpand(parentPath);
      }
      await store.loadFiles();
    } catch (err) {
      console.error('Failed to create file:', err);
      alert((err as Error).message);
    }
  }, [store]);

  const handleNewFolder = useCallback((parentPath: string | null) => {
    if (parentPath) {
      // Expand parent first
      if (!store.expandedPaths.has(parentPath)) {
        store.toggleExpand(parentPath);
      }
      store.setNewFolderParent(parentPath);
    } else {
      store.setNewFolderParent('__root__');
    }
  }, [store]);

  const handleCopyPath = useCallback((filePath: string) => {
    navigator.clipboard.writeText(filePath).catch(() => {});
  }, []);

  const handlePermissions = useCallback((filePath: string) => {
    store.setPropertiesTarget(filePath);
  }, [store]);

  const handleProperties = useCallback((filePath: string) => {
    store.setPropertiesTarget(filePath);
  }, [store]);

  const handleExpandCollapse = useCallback((dirPath: string) => {
    store.toggleExpand(dirPath);
  }, [store]);

  // Upload via hidden input
  const handleUploadFile = useCallback(async (file: File, targetDir?: string) => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    try {
      if (store.activeTab === 'documents') {
        const formData = new FormData();
        formData.append('file', file);
        await fetch(`${API_URL}${API_PREFIX}/api/abilities/documents`, {
          method: 'POST',
          credentials: 'include',
          body: formData,
        });
      } else {
        // For workspace uploads with a target directory, we rename after upload
        await uploadWorkspaceFile(file);
      }
      await store.loadFiles();
    } catch (err) {
      console.error('Failed to upload:', err);
      alert((err as Error).message);
    } finally {
      uploadingRef.current = false;
      if (wsInputRef.current) wsInputRef.current.value = '';
      if (docInputRef.current) docInputRef.current.value = '';
    }
  }, [store]);

  // External drag-and-drop
  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleContainerDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current++;
  }, []);

  const handleContainerDragLeave = useCallback(() => {
    dragCountRef.current--;
  }, []);

  const handleContainerDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current = 0;

    // Check for internal move (luna-files)
    const lunaData = e.dataTransfer.getData('application/x-luna-files');
    if (lunaData) {
      try {
        const paths: string[] = JSON.parse(lunaData);
        const target = store.dropTarget;
        if (!target) return;
        for (const srcPath of paths) {
          if (srcPath.startsWith(target + '/') || srcPath === target) continue;
          const fileName = srcPath.split('/').pop()!;
          const newPath = `${target}/${fileName}`;
          const node = store.getFlatVisibleNodes().find(n => n.path === srcPath);
          if (node?.isDirectory) {
            await workspaceApi.renameDirectory(srcPath, newPath);
          } else {
            await workspaceApi.renameFile(srcPath, newPath);
          }
        }
        store.setDragSource(null);
        store.setDropTarget(null);
        await store.loadFiles();
      } catch (err) {
        console.error('Failed to move files:', err);
      }
      return;
    }

    // External file drop
    const file = e.dataTransfer.files[0];
    if (file) {
      await handleUploadFile(file);
    }
  }, [store, handleUploadFile]);

  // Delete document
  const handleDeleteDocument = useCallback(async (id: string, filename: string) => {
    if (!confirm(`Delete ${filename}?`)) return;
    try {
      await documentsApi.delete(id);
      await store.loadFiles();
    } catch (err) {
      console.error('Failed to delete document:', err);
    }
  }, [store]);

  const totalSize = store.workspaceFiles.reduce((sum, f) => sum + f.size, 0);

  return (
    <div
      className="h-full flex flex-col"
      style={{ background: 'var(--theme-bg-primary)' }}
      onDragOver={handleContainerDragOver}
      onDragEnter={handleContainerDragEnter}
      onDragLeave={handleContainerDragLeave}
      onDrop={handleContainerDrop}
    >
      {/* Tab bar */}
      <div
        className="flex items-center gap-1 px-3 py-1.5 border-b overflow-x-auto"
        style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
      >
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => store.setActiveTab(tab.id)}
            className={`px-3 py-1 rounded text-xs font-medium whitespace-nowrap transition ${
              store.activeTab === tab.id
                ? 'bg-[var(--theme-accent-primary)]/20 text-[var(--theme-accent-primary)]'
                : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)]'
            }`}
          >
            {tab.label}
          </button>
        ))}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Stats */}
        <span className="text-xs whitespace-nowrap" style={{ color: 'var(--theme-text-muted)' }}>
          {store.workspaceFiles.length} files - {formatSize(totalSize)}
        </span>
      </div>

      {/* Toolbar */}
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 border-b"
        style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
      >
        {store.activeTab !== 'documents' && (
          <>
            <button
              onClick={() => handleNewFile(null)}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-[var(--theme-bg-tertiary)] transition"
              style={{ color: 'var(--theme-text-muted)' }}
            >
              <Plus className="w-3.5 h-3.5" />
              File
            </button>
            <button
              onClick={() => handleNewFolder(null)}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-[var(--theme-bg-tertiary)] transition"
              style={{ color: 'var(--theme-text-muted)' }}
            >
              <FolderPlus className="w-3.5 h-3.5" />
              Folder
            </button>
          </>
        )}
        <button
          onClick={() => store.activeTab === 'documents' ? docInputRef.current?.click() : wsInputRef.current?.click()}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-[var(--theme-bg-tertiary)] transition"
          style={{ color: 'var(--theme-accent-primary)' }}
        >
          <Upload className="w-3.5 h-3.5" />
          Upload
        </button>
        <button
          onClick={() => store.loadFiles()}
          disabled={store.loading}
          className="p-1 rounded hover:bg-[var(--theme-bg-tertiary)] transition"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${store.loading ? 'animate-spin' : ''}`} />
        </button>

        {/* Hidden file inputs */}
        <input
          ref={wsInputRef}
          type="file"
          onChange={(e) => e.target.files?.[0] && handleUploadFile(e.target.files[0])}
          accept=".py,.js,.ts,.json,.txt,.md,.markdown,.mdown,.mkdn,.csv,.xml,.yaml,.yml,.html,.css,.sql,.sh,.r,.ipynb,.pdf,.doc,.docx,.xls,.xlsx,.pptx"
          className="hidden"
        />
        <input
          ref={docInputRef}
          type="file"
          onChange={(e) => e.target.files?.[0] && handleUploadFile(e.target.files[0])}
          accept=".pdf,.txt,.md,.markdown,.mdown,.mkdn,.doc,.docx,.xls,.xlsx,.pptx"
          className="hidden"
        />
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden relative">
        {store.loading ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--theme-accent-primary)' }} />
          </div>
        ) : store.activeTab === 'documents' ? (
          // Documents tab - flat list
          <div className="h-full overflow-auto p-2">
            {store.documents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--theme-text-muted)' }}>
                <FileBox className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm mb-1">No documents</p>
                <p className="text-xs opacity-70">Upload PDFs or documents for Luna to reference</p>
              </div>
            ) : (
              <div className="grid gap-1">
                {store.documents.map(doc => (
                  <DocumentRow
                    key={doc.id}
                    doc={doc}
                    onDelete={() => handleDeleteDocument(doc.id, doc.filename)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          // Workspace tabs - tree view
          <FileTreeView
            onDoubleClick={handleDoubleClick}
            onRenameSubmit={handleRenameSubmit}
            onNewFolderSubmit={handleNewFolderSubmit}
            onNewFolderRoot={handleNewFolderRoot}
          />
        )}

        {/* File viewer overlay */}
        {store.viewingFile && (
          <div
            className="absolute inset-0 flex flex-col"
            style={{ background: 'var(--theme-bg-primary)' }}
          >
            <div
              className="flex items-center justify-between px-4 py-2 border-b"
              style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
            >
              <span className="text-sm font-medium truncate" style={{ color: 'var(--theme-text-primary)' }}>
                {store.viewingFile.name}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleOpenInEditor(store.viewingFile!.name)}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded"
                  style={{ color: 'var(--theme-accent-primary)' }}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Open in Editor
                </button>
                <button
                  onClick={() => store.setViewingFile(null)}
                  className="p-1 rounded"
                  style={{ color: 'var(--theme-text-muted)' }}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <pre
              className="flex-1 overflow-auto p-4 text-sm font-mono whitespace-pre-wrap"
              style={{ color: 'var(--theme-text-primary)', background: 'var(--theme-bg-tertiary)' }}
            >
              {store.viewingFile.content || '(empty file)'}
            </pre>
          </div>
        )}
      </div>

      {/* Context menu portal */}
      <FileContextMenu
        onView={handleViewFile}
        onOpenInEditor={handleOpenInEditor}
        onRename={(path) => store.setRenameTarget(path)}
        onDelete={handleDelete}
        onCopyPath={handleCopyPath}
        onDownload={handleDownloadFile}
        onNewFile={handleNewFile}
        onNewFolder={handleNewFolder}
        onRefresh={() => store.loadFiles()}
        onPermissions={handlePermissions}
        onProperties={handleProperties}
        onExpandCollapse={handleExpandCollapse}
      />

      {/* Properties dialog */}
      <FileProperties />
    </div>
  );
}

// Document row sub-component
function DocumentRow({ doc, onDelete }: { doc: Document; onDelete: () => void }) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded cursor-pointer transition hover:bg-[var(--theme-bg-tertiary)]"
    >
      <FileBox className="w-4 h-4 text-red-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate" style={{ color: 'var(--theme-text-primary)' }}>{doc.filename}</div>
        <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
          {formatSize(doc.size)} - {doc.chunksCount} chunks - {formatDate(doc.uploadedAt)}
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="p-1.5 rounded hover:bg-red-500/20"
        style={{ color: 'var(--theme-text-muted)' }}
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
    </div>
  );
}
