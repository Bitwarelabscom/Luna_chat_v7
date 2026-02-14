'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FolderOpen, Upload, File, FileText, Trash2, RefreshCw,
  Eye, X, Plus, Code, FileCode, Edit3, Save
} from 'lucide-react';
import { workspaceApi, documentsApi, uploadWorkspaceFile, WorkspaceFile, Document } from '../../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const API_PREFIX = '';

export default function WorkspaceTab() {
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [viewingFile, setViewingFile] = useState<{ name: string; content: string } | null>(null);
  const [editingFile, setEditingFile] = useState<{ name: string; content: string } | null>(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<'workspace' | 'documents'>('workspace');
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
      alert('Failed to load file');
    }
  };

  const handleDeleteWorkspaceFile = async (filename: string) => {
    if (!confirm(`Delete ${filename}?`)) return;
    try {
      await workspaceApi.deleteFile(filename);
      await loadFiles();
    } catch (error) {
      console.error('Failed to delete file:', error);
      alert('Failed to delete file');
    }
  };

  const handleDeleteDocument = async (id: string, filename: string) => {
    if (!confirm(`Delete ${filename}?`)) return;
    try {
      await documentsApi.delete(id);
      await loadFiles();
    } catch (error) {
      console.error('Failed to delete document:', error);
      alert('Failed to delete document');
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
      alert('Failed to create file');
    }
  };

  const handleUploadWorkspaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      await uploadWorkspaceFile(file);
      await loadFiles();
    } catch (error) {
      console.error('Failed to upload file:', error);
      alert('Failed to upload file');
    } finally {
      setUploading(false);
      if (wsInputRef.current) {
        wsInputRef.current.value = '';
      }
    }
  };

  const handleEditFile = async (filename: string) => {
    try {
      const res = await workspaceApi.getFile(filename);
      setEditingFile({ name: filename, content: res.content });
      setEditContent(res.content);
    } catch (error) {
      console.error('Failed to load file for editing:', error);
      alert('Failed to load file');
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
      alert('Failed to save file');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadDocument = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_URL}${API_PREFIX}/api/abilities/documents`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(errorData.error || 'Upload failed');
      }

      await loadFiles();
    } catch (error) {
      console.error('Failed to upload document:', error);
      alert('Failed to upload document');
    } finally {
      setUploading(false);
      if (docInputRef.current) {
        docInputRef.current.value = '';
      }
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
    if (['txt', 'md', 'markdown', 'mdown', 'mkdn', 'json', 'csv'].includes(ext || '')) return <FileText className="w-5 h-5 text-green-400" />;
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'pptx'].includes(ext || '')) return <File className="w-5 h-5 text-theme-accent-primary" />;
    return <File className="w-5 h-5 text-theme-text-muted" />;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-theme-accent-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section Tabs */}
      <div className="flex gap-2 border-b border-theme-border">
        <button
          onClick={() => setActiveSection('workspace')}
          className={`px-4 py-2 text-sm font-medium transition -mb-px ${
            activeSection === 'workspace'
              ? 'text-theme-accent-primary border-b-2 border-theme-accent-primary'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <FolderOpen className="w-4 h-4 inline mr-2" />
          Workspace Files
        </button>
        <button
          onClick={() => setActiveSection('documents')}
          className={`px-4 py-2 text-sm font-medium transition -mb-px ${
            activeSection === 'documents'
              ? 'text-theme-accent-primary border-b-2 border-theme-accent-primary'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <File className="w-4 h-4 inline mr-2" />
          Documents
        </button>
      </div>

      {/* Workspace Files Section */}
      {activeSection === 'workspace' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-theme-text-primary">
              Workspace Files
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => wsInputRef.current?.click()}
                disabled={uploading}
                className="px-3 py-1.5 text-sm bg-theme-accent-primary/10 text-theme-accent-primary rounded-lg hover:bg-theme-accent-primary/20 transition flex items-center gap-1"
              >
                {uploading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                Upload
              </button>
              <button
                onClick={handleCreateTextFile}
                className="px-3 py-1.5 text-sm bg-theme-accent-primary/10 text-theme-accent-primary rounded-lg hover:bg-theme-accent-primary/20 transition flex items-center gap-1"
              >
                <Plus className="w-4 h-4" />
                New
              </button>
              <input
                ref={wsInputRef}
                type="file"
                onChange={handleUploadWorkspaceFile}
                accept=".py,.js,.ts,.json,.txt,.md,.markdown,.mdown,.mkdn,.csv,.xml,.yaml,.yml,.html,.css,.sql,.sh,.r,.ipynb,.pdf,.doc,.docx,.xls,.xlsx,.pptx"
                className="hidden"
              />
            </div>
          </div>
          <p className="text-sm text-theme-text-muted mb-4">
            Files Luna can read, write, and execute (scripts, data, notes)
          </p>

          {workspaceFiles.length === 0 ? (
            <div className="text-center py-8 text-theme-text-muted">
              <FolderOpen className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No workspace files yet</p>
              <p className="text-sm">Ask Luna to create files or create one above</p>
            </div>
          ) : (
            <div className="space-y-2">
              {workspaceFiles.map((file) => (
                <div
                  key={file.name}
                  className="flex items-center justify-between p-3 bg-theme-bg-tertiary rounded-lg border border-theme-border"
                >
                  <div className="flex items-center gap-3">
                    {getFileIcon(file.name, file.mimeType)}
                    <div>
                      <div className="font-medium text-theme-text-primary">{file.name}</div>
                      <div className="text-xs text-theme-text-muted">
                        {formatSize(file.size)} - {formatDate(file.updatedAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleViewFile(file.name)}
                      className="p-2 text-theme-text-muted hover:text-theme-accent-primary transition"
                      title="View"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleEditFile(file.name)}
                      className="p-2 text-theme-text-muted hover:text-theme-accent-primary transition"
                      title="Edit"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteWorkspaceFile(file.name)}
                      className="p-2 text-theme-text-muted hover:text-red-400 transition"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Documents Section */}
      {activeSection === 'documents' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-theme-text-primary">
              Uploaded Documents
            </h3>
            <button
              onClick={() => docInputRef.current?.click()}
              disabled={uploading}
              className="px-3 py-1.5 text-sm bg-theme-accent-primary/10 text-theme-accent-primary rounded-lg hover:bg-theme-accent-primary/20 transition flex items-center gap-1"
            >
              {uploading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              Upload
            </button>
            <input
              ref={docInputRef}
              type="file"
              onChange={handleUploadDocument}
              accept=".pdf,.txt,.md,.markdown,.mdown,.mkdn,.doc,.docx,.xls,.xlsx,.pptx"
              className="hidden"
            />
          </div>
          <p className="text-sm text-theme-text-muted mb-4">
            PDFs and documents for Luna to search and reference
          </p>

          {documents.length === 0 ? (
            <div className="text-center py-8 text-theme-text-muted">
              <File className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No documents uploaded</p>
              <p className="text-sm">Upload PDFs or documents for Luna to reference</p>
            </div>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-3 bg-theme-bg-tertiary rounded-lg border border-theme-border"
                >
                  <div className="flex items-center gap-3">
                    <File className="w-5 h-5 text-theme-accent-primary" />
                    <div>
                      <div className="font-medium text-theme-text-primary">{doc.filename}</div>
                      <div className="text-xs text-theme-text-muted">
                        {formatSize(doc.size)} - {doc.chunksCount} chunks - {formatDate(doc.uploadedAt)}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteDocument(doc.id, doc.filename)}
                    className="p-2 text-theme-text-muted hover:text-red-400 transition"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Refresh Button */}
      <div className="flex justify-center pt-4">
        <button
          onClick={loadFiles}
          disabled={loading}
          className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary transition flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* File Viewer Modal */}
      {viewingFile && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setViewingFile(null)}
          />
          <div className="relative w-full max-w-3xl max-h-[80vh] bg-theme-bg-secondary rounded-xl shadow-2xl border border-theme-border flex flex-col m-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-theme-border">
              <h3 className="font-medium text-theme-text-primary flex items-center gap-2">
                {getFileIcon(viewingFile.name)}
                {viewingFile.name}
              </h3>
              <button
                onClick={() => setViewingFile(null)}
                className="p-1.5 text-theme-text-muted hover:text-theme-text-primary transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-sm text-theme-text-primary whitespace-pre-wrap font-mono bg-theme-bg-tertiary p-4 rounded-lg">
                {viewingFile.content || '(empty file)'}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* File Editor Modal */}
      {editingFile && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => !saving && setEditingFile(null)}
          />
          <div className="relative w-full max-w-4xl max-h-[85vh] bg-theme-bg-secondary rounded-xl shadow-2xl border border-theme-border flex flex-col m-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-theme-border">
              <h3 className="font-medium text-theme-text-primary flex items-center gap-2">
                <Edit3 className="w-5 h-5" />
                Editing: {editingFile.name}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveFile}
                  disabled={saving}
                  className="px-3 py-1.5 text-sm bg-theme-accent-primary text-white rounded-lg hover:bg-theme-accent-primary/90 transition flex items-center gap-1 disabled:opacity-50"
                >
                  {saving ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save
                </button>
                <button
                  onClick={() => setEditingFile(null)}
                  disabled={saving}
                  className="p-1.5 text-theme-text-muted hover:text-theme-text-primary transition disabled:opacity-50"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden p-4">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full h-full min-h-[400px] text-sm text-theme-text-primary font-mono bg-theme-bg-tertiary p-4 rounded-lg border border-theme-border focus:border-theme-accent-primary focus:outline-none resize-none"
                spellCheck={false}
                disabled={saving}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
