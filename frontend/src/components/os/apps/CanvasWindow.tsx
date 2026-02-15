'use client';

import React, { useEffect, useState } from 'react';
import { useWindowStore } from '@/lib/window-store';
import { useCanvasStore } from '@/lib/canvas-store';
import { useChatStore } from '@/lib/store';
import { CodeRenderer } from '@/components/canvas/CodeRenderer';
import { TextRenderer } from '@/components/canvas/TextRenderer';
import { QuickActionsToolbar } from '@/components/canvas/QuickActionsToolbar';
import { SelectionOverlay } from '@/components/canvas/SelectionOverlay';
import { Archive, ChevronLeft, ChevronRight, Code2, Download, FileText, History, ImagePlus, Save } from 'lucide-react';
import {
  canvasApi,
  canvasArtifactAssetBaseUrl,
  type CanvasArtifactFile,
  type CanvasSnapshot,
  downloadApiFile,
  streamMessage,
} from '@/lib/api';

export function CanvasWindow() {
  const { pendingCanvasData, setPendingCanvasData } = useWindowStore();
  const {
    currentSession,
    isSending,
    addUserMessage,
    addAssistantMessage,
    setIsSending,
    setStreamingContent,
    appendStreamingContent,
    setReasoningContent,
    appendReasoningContent,
    setStatusMessage,
    setCanvasAction,
  } = useChatStore();
  const {
    artifact,
    setArtifact,
    selectedBlocks,
    setSelectedBlocks,
    navigateToVersion,
    loadArtifact,
  } = useCanvasStore();

  const [localContent, setLocalContent] = useState('');
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [viewMode, setViewMode] = useState<'code' | 'split' | 'preview'>('code');
  const [files, setFiles] = useState<CanvasArtifactFile[]>([]);
  const [snapshots, setSnapshots] = useState<CanvasSnapshot[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageFilename, setImageFilename] = useState('');
  const [imageAutoInsert, setImageAutoInsert] = useState(true);

  const loadFiles = async (artifactId: string, index?: number) => {
    const loadedFiles = await canvasApi.listFiles(artifactId, index);
    setFiles(loadedFiles);

    if (loadedFiles.length === 0) {
      setSelectedFilePath('');
      return;
    }

    const stillSelected = selectedFilePath && loadedFiles.some((f) => f.path === selectedFilePath);
    const activeFile = stillSelected
      ? loadedFiles.find((f) => f.path === selectedFilePath)
      : loadedFiles.find((f) => f.path === 'index.html') || loadedFiles[0];

    if (activeFile) {
      setSelectedFilePath(activeFile.path);
      setLocalContent(activeFile.content || '');
    }
  };

  const loadSnapshots = async (artifactId: string) => {
    const data = await canvasApi.listSnapshots(artifactId);
    setSnapshots(data);
  };

  // Watch for pending canvas updates from chat, including while window is already open
  useEffect(() => {
    if (!pendingCanvasData) {
      return;
    }
    (async () => {
      const pendingData = pendingCanvasData;
      try {
        await loadArtifact(pendingData.artifactId);
        await loadSnapshots(pendingData.artifactId);
        await loadFiles(pendingData.artifactId, pendingData.content.index);
      } catch {
        // Fallback merge with de-duplication by index
        if (artifact) {
          const existing = artifact.contents.find((c) => c.index === pendingData.content.index);
          const updatedArtifact = {
            ...artifact,
            currentIndex: pendingData.content.index,
            contents: existing ? artifact.contents : [...artifact.contents, pendingData.content],
            updatedAt: new Date(),
          };
          setArtifact(updatedArtifact);
        } else {
          const newArtifact = {
            id: pendingData.artifactId,
            userId: '',
            sessionId: currentSession?.id || null,
            currentIndex: pendingData.content.index,
            contents: [pendingData.content],
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          setArtifact(newArtifact);
        }
      } finally {
        setLocalContent(pendingData.content.content);
        setPendingCanvasData(null);
      }
    })();
  }, [pendingCanvasData, artifact, setArtifact, loadArtifact, currentSession, setPendingCanvasData]);

  // Keep file list in sync with currently loaded artifact/version
  useEffect(() => {
    if (artifact?.id) {
      loadFiles(artifact.id, artifact.currentIndex).catch(() => {});
      loadSnapshots(artifact.id).catch(() => {});
    }
  }, [artifact?.id, artifact?.currentIndex]);

  // Send prompt to chat (for quick actions and selection editing)
  const sendPromptToChat = async (prompt: string, userVisiblePrompt?: string) => {
    if (!currentSession || isSending) return;

    // Add user message to chat
    addUserMessage(userVisiblePrompt || prompt);
    setIsSending(true);
    setStreamingContent('');
    setReasoningContent('');
    setStatusMessage('');

    try {
      let accumulatedContent = '';

      for await (const chunk of streamMessage(currentSession.id, prompt)) {
        if (chunk.type === 'status' && chunk.status) {
          setStatusMessage(chunk.status);
        } else if (chunk.type === 'reasoning' && chunk.content) {
          appendReasoningContent(String(chunk.content));
        } else if (chunk.type === 'content' && chunk.content) {
          const contentChunk = String(chunk.content);
          setStatusMessage('');
          accumulatedContent += contentChunk;
          appendStreamingContent(contentChunk);
        } else if (chunk.type === 'canvas_artifact' && chunk.artifactId && chunk.content) {
          // Route through shared desktop action so Canvas window updates consistently
          setCanvasAction({ type: 'complete', artifactId: chunk.artifactId, content: chunk.content });
          // Sync from backend so version list reflects source of truth
          await loadArtifact(chunk.artifactId);
          await loadSnapshots(chunk.artifactId);
          await loadFiles(chunk.artifactId, chunk.content.index);
        } else if (chunk.type === 'done' && chunk.messageId) {
          addAssistantMessage(accumulatedContent, chunk.messageId, chunk.metrics);
          setStreamingContent('');
          setStatusMessage('');
        }
      }
    } catch (error) {
      console.error('Failed to edit artifact via chat stream:', error);
      addAssistantMessage(
        'Sorry, I encountered an error while editing the artifact. Please try again.',
        `error-${Date.now()}`
      );
      setStreamingContent('');
      setStatusMessage('');
    } finally {
      setIsSending(false);
    }
  };

  const handleQuickAction = (prompt: string) => {
    if (!artifact) return;
    const current = artifact.contents.find((c) => c.index === artifact.currentIndex);
    if (!current) return;

    // Force explicit rewrite with correct artifact ID and full content
    const fullPrompt = [
      `You are editing an existing canvas artifact.`,
      `You MUST call rewrite_artifact.`,
      `artifactId: ${artifact.id}`,
      `Current title: ${current.title}`,
      `Current language: ${current.language || 'text'}`,
      `Current file path: ${selectedFilePath || 'index.html'}`,
      `Edit instruction: ${prompt}`,
      `Return ONLY a rewrite_artifact tool call with full updated content.`,
      `Current content:`,
      localContent || current.content,
    ].join('\n\n');
    sendPromptToChat(fullPrompt, prompt);
  };

  const handleSelectionEdit = (action: string) => {
    if (!artifact || !selectedBlocks) return;

    const currentContent = artifact.contents.find((c) => c.index === artifact.currentIndex);
    if (!currentContent) return;

    // Force precise patch via update_highlighted with explicit range
    const fullPrompt = [
      `You are editing a selected portion of an existing canvas artifact.`,
      `You MUST call update_highlighted.`,
      `artifactId: ${artifact.id}`,
      `startIndex: ${selectedBlocks.startIndex}`,
      `endIndex: ${selectedBlocks.endIndex}`,
      `Action: ${action}`,
      `Selected text:`,
      selectedBlocks.selectedText,
      `Return ONLY an update_highlighted tool call.`,
    ].join('\n\n');
    sendPromptToChat(fullPrompt, `${action}: "${selectedBlocks.selectedText}"`);

    // Clear selection after action
    setSelectedBlocks(null);
  };

  const currentContent = artifact?.contents.find((c) => c.index === artifact.currentIndex) || null;
  const selectedFile = files.find((f) => f.path === selectedFilePath) || null;
  const effectiveLanguage = selectedFile?.language || currentContent?.language;
  const isCodeFile = (selectedFile?.fileType || currentContent?.type) === 'code';
  const isImageFile = selectedFile?.fileType === 'image' || selectedFile?.mimeType?.startsWith('image/');
  const isHtmlPreviewAvailable =
    isCodeFile &&
    effectiveLanguage?.toLowerCase() === 'html';
  const maxVersionIndex = Math.max(
    artifact?.currentIndex || 0,
    artifact?.contents.length || 0,
    snapshots.length
  );

  // Keep mode valid when switching to non-HTML artifacts
  useEffect(() => {
    if (!isHtmlPreviewAvailable && viewMode !== 'code') {
      setViewMode('code');
    }
  }, [isHtmlPreviewAvailable, viewMode]);

  if (!artifact) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900 text-gray-400">
        <div className="text-center">
          <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p>No artifact loaded</p>
          <p className="text-sm mt-2">Generate code or text from chat to get started</p>
        </div>
      </div>
    );
  }

  if (!currentContent) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900 text-red-400">
        <p>Error: Current version not found</p>
      </div>
    );
  }
  const editorContent = localContent || selectedFile?.content || currentContent.content;

  const canGoPrevious = artifact.currentIndex > 1;
  const canGoNext = artifact.currentIndex < maxVersionIndex;

  const handlePrevious = async () => {
    if (canGoPrevious) {
      const targetIndex = artifact.currentIndex - 1;
      await navigateToVersion(targetIndex);
      await loadArtifact(artifact.id);
      await loadFiles(artifact.id, targetIndex);
      await loadSnapshots(artifact.id);
    }
  };

  const handleNext = async () => {
    if (canGoNext) {
      const targetIndex = artifact.currentIndex + 1;
      await navigateToVersion(targetIndex);
      await loadArtifact(artifact.id);
      await loadFiles(artifact.id, targetIndex);
      await loadSnapshots(artifact.id);
    }
  };

  const handleContentChange = (newContent: string) => {
    setLocalContent(newContent);
  };

  const handleSelectionChange = (start: number, end: number, text: string) => {
    if (text.trim()) {
      setSelectedBlocks({
        startIndex: start,
        endIndex: end,
        selectedText: text,
      });
    } else {
      setSelectedBlocks(null);
    }
  };

  const handleVersionJump = async (index: number) => {
    await navigateToVersion(index);
    await loadArtifact(artifact.id);
    await loadFiles(artifact.id, index);
    await loadSnapshots(artifact.id);
    setShowVersionHistory(false);
  };

  const handleSaveFile = async () => {
    if (!artifact || !selectedFilePath || (selectedFile && selectedFile.storage !== 'db')) return;
    setIsSavingFile(true);
    try {
      await canvasApi.saveFile(artifact.id, selectedFilePath, editorContent, effectiveLanguage);
      await loadArtifact(artifact.id);
      await loadFiles(artifact.id);
      await loadSnapshots(artifact.id);
      setStatusMessage('Saved new snapshot version');
    } catch (error) {
      console.error('Failed to save artifact file:', error);
      setStatusMessage('Failed to save file');
    } finally {
      setIsSavingFile(false);
    }
  };

  const handleDownload = async () => {
    if (!artifact || !currentContent) return;
    try {
      const { blob, filename } = await downloadApiFile(
        `/api/canvas/artifacts/${artifact.id}/download?index=${currentContent.index}`
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download artifact:', error);
    }
  };

  const handleDownloadProjectZip = async () => {
    if (!artifact) return;
    try {
      const { blob, filename } = await canvasApi.downloadProjectZip(artifact.id, artifact.currentIndex);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download project zip:', error);
      setStatusMessage('Failed to download project ZIP');
    }
  };

  const handleGenerateImage = async (prompt: string, filename?: string, autoInsert?: boolean) => {
    if (!artifact) return;
    if (!prompt || !prompt.trim()) return;

    setIsGeneratingImage(true);
    setStatusMessage('Generating image...');
    try {
      await canvasApi.generateImage(artifact.id, prompt.trim(), {
        filename: filename?.trim() || undefined,
        autoInsert: autoInsert !== false,
      });
      await loadArtifact(artifact.id);
      await loadFiles(artifact.id);
      await loadSnapshots(artifact.id);
      setStatusMessage('Image generated and version updated');
      setShowImageModal(false);
      setImagePrompt('');
      setImageFilename('');
      setImageAutoInsert(true);
    } catch (error) {
      console.error('Failed to generate artifact image:', error);
      setStatusMessage('Failed to generate image');
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const versionHistory = Array.from(
    new Set(
      (snapshots.length > 0
        ? snapshots.map((snapshot) => snapshot.versionIndex)
        : artifact.contents.map((content) => content.index))
    )
  ).sort((a, b) => b - a);

  const renderEditor = () =>
    isCodeFile ? (
      <CodeRenderer
        content={editorContent}
        language={effectiveLanguage}
        onChange={handleContentChange}
        onSelectionChange={handleSelectionChange}
      />
    ) : (
      <TextRenderer
        content={editorContent}
        onChange={handleContentChange}
        onSelectionChange={handleSelectionChange}
      />
    );

  const getAssetUrl = (artifactId: string, filePath: string) =>
    `${canvasArtifactAssetBaseUrl(artifactId)}${filePath.split('/').map(encodeURIComponent).join('/')}`;

  const buildPreviewDocument = (html: string) => {
    if (!artifact) return html;
    const baseHref = canvasArtifactAssetBaseUrl(artifact.id);
    if (/<base\s/i.test(html)) return html;
    if (/<head[^>]*>/i.test(html)) {
      return html.replace(/<head([^>]*)>/i, `<head$1><base href="${baseHref}">`);
    }
    if (/<html[^>]*>/i.test(html)) {
      return html.replace(/<html([^>]*)>/i, `<html$1><head><base href="${baseHref}"></head>`);
    }
    return `<!doctype html><html><head><base href="${baseHref}"></head><body>${html}</body></html>`;
  };

  const renderHtmlPreview = () => (
    <iframe
      title={`${selectedFilePath || currentContent.title} preview`}
      srcDoc={buildPreviewDocument(editorContent)}
      sandbox="allow-scripts allow-same-origin"
      className="w-full h-full bg-white border-0"
    />
  );

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-3">
          {currentContent.type === 'code' ? (
            <Code2 className="w-5 h-5 text-blue-400" />
          ) : (
            <FileText className="w-5 h-5 text-green-400" />
          )}
          <div>
            <h2 className="font-semibold text-sm">{selectedFilePath || currentContent.title}</h2>
            {effectiveLanguage && (
              <p className="text-xs text-gray-400">{effectiveLanguage}</p>
            )}
          </div>
        </div>

        {/* Version Navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownload}
            className="p-1.5 rounded hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
            title="Download current version"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={handleDownloadProjectZip}
            className="p-1.5 rounded hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
            title="Download project ZIP"
          >
            <Archive className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowImageModal(true)}
            disabled={isGeneratingImage}
            className="p-1.5 rounded hover:bg-gray-700 text-gray-300 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Generate image and add to artifact"
          >
            <ImagePlus className="w-4 h-4" />
          </button>
          <button
            onClick={handleSaveFile}
            disabled={isSavingFile || !selectedFilePath || (selectedFile ? selectedFile.storage !== 'db' : false)}
            className="p-1.5 rounded hover:bg-gray-700 text-gray-300 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Save file and create new snapshot version"
          >
            <Save className="w-4 h-4" />
          </button>
          {isHtmlPreviewAvailable && (
            <div className="flex items-center gap-1 mr-2 rounded bg-gray-700/50 p-0.5">
              <button
                onClick={() => setViewMode('code')}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  viewMode === 'code' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
                }`}
                title="Code only"
              >
                Code
              </button>
              <button
                onClick={() => setViewMode('split')}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  viewMode === 'split' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
                }`}
                title="Split code and preview"
              >
                Split
              </button>
              <button
                onClick={() => setViewMode('preview')}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  viewMode === 'preview' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
                }`}
                title="Preview only"
              >
                Preview
              </button>
            </div>
          )}
          <button
            onClick={() => setShowVersionHistory(!showVersionHistory)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
            title="Version history"
          >
            <History className="w-3.5 h-3.5" />
            Version {artifact.currentIndex} of {maxVersionIndex}
          </button>
          <button
            onClick={handlePrevious}
            disabled={!canGoPrevious}
            className={`p-1 rounded ${
              canGoPrevious
                ? 'hover:bg-gray-700 text-white'
                : 'text-gray-600 cursor-not-allowed'
            }`}
            title="Previous version"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={handleNext}
            disabled={!canGoNext}
            className={`p-1 rounded ${
              canGoNext
                ? 'hover:bg-gray-700 text-white'
                : 'text-gray-600 cursor-not-allowed'
            }`}
            title="Next version"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Quick Actions Toolbar */}
      <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-700">
        <QuickActionsToolbar
          artifactId={artifact.id}
          selectedText={selectedBlocks?.selectedText}
          onActionExecute={handleQuickAction}
        />
      </div>

      {/* Version History Dropdown */}
      {showVersionHistory && (
        <div className="absolute top-14 right-4 bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-2 z-40 max-h-64 overflow-y-auto">
          <div className="text-xs font-semibold text-gray-400 px-2 py-1 mb-1">
            Version History
          </div>
          {versionHistory.map((index) => (
            <button
              key={index}
              onClick={() => handleVersionJump(index)}
              className={`w-full text-left px-3 py-2 rounded text-sm hover:bg-gray-700 transition-colors ${
                index === artifact.currentIndex
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300'
              }`}
            >
              <div className="font-medium">Version {index}</div>
            </button>
          ))}
        </div>
      )}

      {showImageModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-lg shadow-2xl">
            <div className="px-4 py-3 border-b border-gray-700">
              <h3 className="text-sm font-semibold">Generate Artifact Image</h3>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-xs text-gray-300 mb-2">Prompt</label>
                <textarea
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  className="w-full h-28 px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Describe the image to generate..."
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-gray-300 mb-2">Filename (optional)</label>
                <input
                  value={imageFilename}
                  onChange={(e) => setImageFilename(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="hero.png"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={imageAutoInsert}
                  onChange={(e) => setImageAutoInsert(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
                />
                Auto-insert image into HTML
              </label>
            </div>
            <div className="px-4 py-3 border-t border-gray-700 flex justify-end gap-2">
              <button
                onClick={() => {
                  if (isGeneratingImage) return;
                  setShowImageModal(false);
                }}
                className="px-3 py-1.5 text-sm rounded bg-gray-700 hover:bg-gray-600 text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => handleGenerateImage(imagePrompt, imageFilename, imageAutoInsert)}
                disabled={isGeneratingImage || !imagePrompt.trim()}
                className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGeneratingImage ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-hidden relative flex">
        <div className="w-56 border-r border-gray-700 bg-gray-900/60 overflow-auto">
          <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-700">Files</div>
          {files.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-500">No files</div>
          ) : (
            files.map((file) => (
              <button
                key={file.path}
                onClick={() => {
                  setSelectedFilePath(file.path);
                  setLocalContent(file.content || '');
                }}
                className={`w-full text-left px-3 py-2 text-xs border-b border-gray-800 hover:bg-gray-800/70 ${
                  selectedFilePath === file.path ? 'bg-gray-800 text-white' : 'text-gray-300'
                }`}
                title={file.path}
              >
                <div className="truncate">{file.path}</div>
              </button>
            ))
          )}
        </div>
        <div className="flex-1 overflow-hidden relative">
          {isImageFile && selectedFile ? (
            <div className="h-full bg-gray-950 flex items-center justify-center">
              <img
                src={getAssetUrl(artifact.id, selectedFile.path)}
                alt={selectedFile.path}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          ) : isHtmlPreviewAvailable && viewMode === 'split' ? (
            <div className="h-full flex">
              <div className="w-1/2 h-full border-r border-gray-700">
                {renderEditor()}
              </div>
              <div className="w-1/2 h-full bg-white">
                {renderHtmlPreview()}
              </div>
            </div>
          ) : isHtmlPreviewAvailable && viewMode === 'preview' ? (
            <div className="h-full bg-white">
              {renderHtmlPreview()}
            </div>
          ) : (
            renderEditor()
          )}

          {/* Enhanced Selection Overlay */}
          {!isImageFile && (!isHtmlPreviewAvailable || viewMode !== 'preview') && selectedBlocks && selectedBlocks.selectedText.trim() && (
            <SelectionOverlay
              selectedText={selectedBlocks.selectedText}
              characterCount={selectedBlocks.selectedText.length}
              onEdit={() => handleSelectionEdit('modify this code')}
              onAddComments={() => handleSelectionEdit('add detailed comments to explain this code')}
              onFixBugs={() => handleSelectionEdit('review and fix any bugs in this code')}
              onImprove={() => handleSelectionEdit('improve the quality and performance of this code')}
              onClose={() => setSelectedBlocks(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
