'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Folder, FolderOpen, Upload, File, FileText, Trash2, RefreshCw,
  Eye, X, Plus, Code, FileCode, Edit3, Save, Download, FileBox
} from 'lucide-react';
import { workspaceApi, documentsApi, uploadWorkspaceFile, WorkspaceFile, Document } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const API_PREFIX = '';

export default function FilesWindow() {
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [viewingFile, setViewingFile] = useState<{ name: string; content: string } | null>(null);
  const [editingFile, setEditingFile] = useState<{ name: string; content: string } | null>(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<'workspace' | 'documents'>('workspace');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const docInputRef = useRef<HTMLInputElement>(null);
  const wsInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    try {
      setLoading(true);
      const [wsFiles, docRes] = await Promise.all([
        workspaceApi.listFiles(),
        documentsApi.list(),
      ]);
      setWorkspaceFiles(wsFiles || []);
      setDocuments(docRes.documents || []);
    } catch (error) {
      console.error('Failed to load files:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleViewFile = async (filename: string) => {
    try {
      const res = await workspaceApi.getFile(filename);
      setViewingFile({ name: filename, content: res.content });
    } catch (error) {
      console.error('Failed to load file:', error);
    }
  };

  const handleDeleteWorkspaceFile = async (filename: string) => {
    if (!confirm(`Delete ${filename}?`)) return;
    try {
      await workspaceApi.deleteFile(filename);
      setSelectedFile(null);
      await loadFiles();
    } catch (error) {
      console.error('Failed to delete file:', error);
    }
  };

  const handleDeleteDocument = async (id: string, filename: string) => {
    if (!confirm(`Delete ${filename}?`)) return;
    try {
      await documentsApi.delete(id);
      setSelectedFile(null);
      await loadFiles();
    } catch (error) {
      console.error('Failed to delete document:', error);
    }
  };

  const handleCreateTextFile = async () => {
    const filename = prompt('Enter filename (e.g., notes.txt):');
    if (!filename) return;
    try {
      await workspaceApi.createFile(filename, '');
      await loadFiles();
    } catch (error) {
      console.error('Failed to create file:', error);
    }
  };

  const handleUploadWorkspaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
  };

  const uploadFile = async (file: File) => {
    try {
      setUploading(true);
      if (activeSection === 'workspace') {
        await uploadWorkspaceFile(file);
      } else {
        const formData = new FormData();
        formData.append('file', file);
        await fetch(`${API_URL}${API_PREFIX}/api/abilities/documents`, {
          method: 'POST',
          credentials: 'include',
          body: formData,
        });
      }
      await loadFiles();
    } catch (error) {
      console.error('Failed to upload file:', error);
    } finally {
      setUploading(false);
      if (wsInputRef.current) wsInputRef.current.value = '';
      if (docInputRef.current) docInputRef.current.value = '';
    }
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) await uploadFile(file);
  }, [activeSection]);

  const handleEditFile = async (filename: string) => {
    try {
      const res = await workspaceApi.getFile(filename);
      setEditingFile({ name: filename, content: res.content });
      setEditContent(res.content);
      setViewingFile(null);
    } catch (error) {
      console.error('Failed to load file for editing:', error);
    }
  };

  const handleSaveFile = async () => {
    if (!editingFile) return;
    try {
      setSaving(true);
      await workspaceApi.updateFile(editingFile.name, editContent);
      setEditingFile(null);
      await loadFiles();
    } catch (error) {
      console.error('Failed to save file:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadFile = async (filename: string) => {
    try {
      const res = await workspaceApi.getFile(filename);
      const blob = new Blob([res.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download file:', error);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getFileIcon = (filename: string, mimeType?: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (mimeType?.includes('python') || ext === 'py') return <FileCode className="w-5 h-5 text-yellow-400" />;
    if (['js', 'ts', 'sh'].includes(ext || '')) return <Code className="w-5 h-5 text-blue-400" />;
    if (['txt', 'md', 'json', 'csv'].includes(ext || '')) return <FileText className="w-5 h-5 text-green-400" />;
    if (['pdf'].includes(ext || '')) return <FileBox className="w-5 h-5 text-red-400" />;
    return <File className="w-5 h-5" style={{ color: 'var(--theme-text-muted)' }} />;
  };

  return (
    <div
      className="h-full flex flex-col"
      style={{ background: 'var(--theme-bg-primary)' }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSection('workspace')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition ${
              activeSection === 'workspace'
                ? 'bg-[var(--theme-accent-primary)]/20 text-[var(--theme-accent-primary)]'
                : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]'
            }`}
          >
            <FolderOpen className="w-4 h-4" />
            Workspace
          </button>
          <button
            onClick={() => setActiveSection('documents')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition ${
              activeSection === 'documents'
                ? 'bg-[var(--theme-accent-primary)]/20 text-[var(--theme-accent-primary)]'
                : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]'
            }`}
          >
            <FileBox className="w-4 h-4" />
            Documents
          </button>
        </div>
        <div className="flex items-center gap-2">
          {activeSection === 'workspace' && (
            <button
              onClick={handleCreateTextFile}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded transition"
              style={{ color: 'var(--theme-text-muted)' }}
            >
              <Plus className="w-4 h-4" />
              New
            </button>
          )}
          <button
            onClick={() => activeSection === 'workspace' ? wsInputRef.current?.click() : docInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded transition"
            style={{ color: 'var(--theme-accent-primary)' }}
          >
            {uploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Upload
          </button>
          <button
            onClick={loadFiles}
            disabled={loading}
            className="p-1.5 rounded transition"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <input
            ref={wsInputRef}
            type="file"
            onChange={handleUploadWorkspaceFile}
            accept=".py,.js,.ts,.json,.txt,.md,.csv,.xml,.yaml,.yml,.html,.css,.sql,.sh,.r,.ipynb"
            className="hidden"
          />
          <input
            ref={docInputRef}
            type="file"
            onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
            accept=".pdf,.txt,.md,.doc,.docx"
            className="hidden"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* File List */}
        <div
          className={`flex-1 overflow-auto p-2 ${dragOver ? 'ring-2 ring-inset ring-[var(--theme-accent-primary)]' : ''}`}
        >
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--theme-accent-primary)' }} />
            </div>
          ) : activeSection === 'workspace' ? (
            workspaceFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--theme-text-muted)' }}>
                <Folder className="w-16 h-16 mb-4 opacity-30" />
                <p className="text-sm mb-1">No workspace files</p>
                <p className="text-xs opacity-70">Drop files here or click Upload</p>
              </div>
            ) : (
              <div className="grid gap-1">
                {workspaceFiles.map((file) => (
                  <div
                    key={file.name}
                    onClick={() => setSelectedFile(file.name)}
                    onDoubleClick={() => handleViewFile(file.name)}
                    className={`flex items-center gap-3 px-3 py-2 rounded cursor-pointer transition ${
                      selectedFile === file.name
                        ? 'bg-[var(--theme-accent-primary)]/20'
                        : 'hover:bg-[var(--theme-bg-tertiary)]'
                    }`}
                  >
                    {getFileIcon(file.name, file.mimeType)}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate" style={{ color: 'var(--theme-text-primary)' }}>{file.name}</div>
                      <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                        {formatSize(file.size)} - {formatDate(file.updatedAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleViewFile(file.name); }}
                        className="p-1.5 rounded hover:bg-[var(--theme-bg-tertiary)]"
                        style={{ color: 'var(--theme-text-muted)' }}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEditFile(file.name); }}
                        className="p-1.5 rounded hover:bg-[var(--theme-bg-tertiary)]"
                        style={{ color: 'var(--theme-text-muted)' }}
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownloadFile(file.name); }}
                        className="p-1.5 rounded hover:bg-[var(--theme-bg-tertiary)]"
                        style={{ color: 'var(--theme-text-muted)' }}
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteWorkspaceFile(file.name); }}
                        className="p-1.5 rounded hover:bg-red-500/20"
                        style={{ color: 'var(--theme-text-muted)' }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            documents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--theme-text-muted)' }}>
                <FileBox className="w-16 h-16 mb-4 opacity-30" />
                <p className="text-sm mb-1">No documents</p>
                <p className="text-xs opacity-70">Upload PDFs or documents for Luna to reference</p>
              </div>
            ) : (
              <div className="grid gap-1">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    onClick={() => setSelectedFile(doc.id)}
                    className={`flex items-center gap-3 px-3 py-2 rounded cursor-pointer transition ${
                      selectedFile === doc.id
                        ? 'bg-[var(--theme-accent-primary)]/20'
                        : 'hover:bg-[var(--theme-bg-tertiary)]'
                    }`}
                  >
                    {getFileIcon(doc.filename)}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate" style={{ color: 'var(--theme-text-primary)' }}>{doc.filename}</div>
                      <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                        {formatSize(doc.size)} - {doc.chunksCount} chunks - {formatDate(doc.uploadedAt)}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteDocument(doc.id, doc.filename); }}
                      className="p-1.5 rounded hover:bg-red-500/20"
                      style={{ color: 'var(--theme-text-muted)' }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {/* File Viewer Panel */}
      {viewingFile && (
        <div
          className="absolute inset-0 flex flex-col"
          style={{ background: 'var(--theme-bg-primary)' }}
        >
          <div
            className="flex items-center justify-between px-4 py-2 border-b"
            style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
          >
            <div className="flex items-center gap-2">
              {getFileIcon(viewingFile.name)}
              <span className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
                {viewingFile.name}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleEditFile(viewingFile.name)}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded"
                style={{ color: 'var(--theme-accent-primary)' }}
              >
                <Edit3 className="w-3.5 h-3.5" />
                Edit
              </button>
              <button
                onClick={() => setViewingFile(null)}
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
            {viewingFile.content || '(empty file)'}
          </pre>
        </div>
      )}

      {/* File Editor Panel */}
      {editingFile && (
        <div
          className="absolute inset-0 flex flex-col"
          style={{ background: 'var(--theme-bg-primary)' }}
        >
          <div
            className="flex items-center justify-between px-4 py-2 border-b"
            style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
          >
            <div className="flex items-center gap-2">
              <Edit3 className="w-4 h-4" style={{ color: 'var(--theme-accent-primary)' }} />
              <span className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
                Editing: {editingFile.name}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveFile}
                disabled={saving}
                className="flex items-center gap-1 px-3 py-1 text-xs rounded"
                style={{ background: 'var(--theme-accent-primary)', color: 'white' }}
              >
                {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save
              </button>
              <button
                onClick={() => setEditingFile(null)}
                disabled={saving}
                className="p-1 rounded"
                style={{ color: 'var(--theme-text-muted)' }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="flex-1 p-4 text-sm font-mono resize-none focus:outline-none"
            style={{
              color: 'var(--theme-text-primary)',
              background: 'var(--theme-bg-tertiary)',
              border: 'none'
            }}
            spellCheck={false}
            disabled={saving}
          />
        </div>
      )}
    </div>
  );
}
