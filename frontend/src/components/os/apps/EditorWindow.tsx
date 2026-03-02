'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  Quote,
  Undo,
  Redo,
  FileText,
  Users,
  Save,
  Loader2,
  ArrowUpFromLine,
  Link2,
  ListTree,
} from 'lucide-react';
import { useWindowStore, type EditorFileContext } from '@/lib/window-store';
import { editorBridgeApi } from '@/lib/api';
import { workspaceApi, type BacklinkResult, type ForwardLinkResult } from '@/lib/api/workspace';
import { WikilinkExtension } from '@/lib/tiptap/wikilink-extension';
import { NoteEmbedExtension } from '@/lib/tiptap/note-embed-extension';
import { OutlineExtension, type HeadingItem } from '@/lib/tiptap/outline-extension';

interface EditorWindowProps {
  documentId?: string;
  documentName?: string;
}

export function EditorWindow({
  documentId: propDocumentId = 'default-document',
  documentName: propDocumentName = 'Untitled Document',
}: EditorWindowProps) {
  const consumePendingEditorContext = useWindowStore((state) => state.consumePendingEditorContext);
  const pendingEditorContext = useWindowStore((state) => state.pendingEditorContext);

  // Consume pending context once on mount or when it changes
  const fileContext = useRef<EditorFileContext | null>(null);
  if (fileContext.current === null && pendingEditorContext) {
    fileContext.current = consumePendingEditorContext();
  }

  const documentId = fileContext.current?.documentId || propDocumentId;
  const documentName = fileContext.current?.documentName || propDocumentName;

  const [isSynced, setIsSynced] = useState(false);
  const [users, setUsers] = useState<{ name: string; color: string }[]>([]);
  const [title, setTitle] = useState(documentName);
  const [syncing, setSyncing] = useState(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Panel state
  const [showBacklinks, setShowBacklinks] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [backlinks, setBacklinks] = useState<BacklinkResult[]>([]);
  const [forwardLinks, setForwardLinks] = useState<ForwardLinkResult[]>([]);
  const [headings, setHeadings] = useState<HeadingItem[]>([]);

  // Stable ref for the outline onUpdate callback to avoid useMemo dependency churn
  const headingsCallbackRef = useRef<(h: HeadingItem[]) => void>((h) => setHeadings(h));

  // Create Y.js document
  const ydoc = useMemo(() => new Y.Doc(), []);

  // Create Hocuspocus provider with proper auth token
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function connectProvider() {
      // Fetch a short-lived WS token
      let wsToken = 'cookie-auth';
      try {
        const tokenRes = await fetch('/api/auth/ws-token', {
          method: 'POST',
          credentials: 'include',
        });
        if (tokenRes.ok) {
          const data = await tokenRes.json();
          wsToken = data.token;
        }
      } catch {
        // Fall back to cookie-auth for same-origin connections
      }

      if (cancelled) return;

      const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      let wsUrl: string;
      if (apiUrl) {
        const apiWsUrl = apiUrl.replace(/^http/, 'ws');
        wsUrl = `${apiWsUrl}/ws/editor`;
      } else {
        const host = typeof window !== 'undefined' ? window.location.host : 'localhost:3005';
        wsUrl = `${protocol}//${host}/ws/editor`;
      }

      const newProvider = new HocuspocusProvider({
        url: wsUrl,
        name: documentId,
        document: ydoc,
        token: wsToken,
        onSynced() {
          setIsSynced(true);
        },
        onAwarenessUpdate({ states }) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const statesArray = Array.from(states.values()) as any[];
          const otherUsers = statesArray
            .filter((state) => state?.user?.name && state?.user?.color)
            .map((state) => ({
              name: state.user.name as string,
              color: state.user.color as string,
            }));
          setUsers(otherUsers);
        },
      });

      if (!cancelled) {
        setProvider(newProvider);
      } else {
        newProvider.disconnect();
      }
    }

    connectProvider();

    return () => {
      cancelled = true;
    };
  }, [documentId, ydoc]);

  // Cleanup provider on unmount or change
  useEffect(() => {
    return () => {
      provider?.disconnect();
    };
  }, [provider]);

  // Load backlinks and forward links when a file-backed document syncs
  useEffect(() => {
    if (!fileContext.current?.sourceId) return;
    const filename = fileContext.current.sourceId.includes(':')
      ? fileContext.current.sourceId.split(':').pop()!
      : fileContext.current.sourceId;

    Promise.all([
      workspaceApi.getBacklinks(filename).catch(() => []),
      workspaceApi.getForwardLinks(filename).catch(() => []),
    ]).then(([bl, fl]) => {
      setBacklinks(bl);
      setForwardLinks(fl);
    });
  }, [isSynced]);

  // Build extensions - CollaborationCursor needs provider
  const extensions = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exts: any[] = [
      StarterKit.configure({
        history: false, // Disable history as Y.js handles undo/redo
      }),
      Placeholder.configure({
        placeholder: 'Start writing...',
      }),
      WikilinkExtension.configure({
        onLinkClick: (filename: string) => {
          const { setPendingEditorContext, openApp } = useWindowStore.getState();
          import('@/lib/api/workspace').then(({ editorBridgeApi: bridgeApi }) => {
            bridgeApi.getWorkspaceMapping(filename).then(mapping => {
              setPendingEditorContext({
                documentId: mapping.documentId,
                documentName: mapping.documentName,
                sourceType: 'workspace',
                sourceId: `workspace:${filename}`,
                initialContent: mapping.initialContent,
              });
              openApp('editor');
            }).catch(console.error);
          });
        },
      }),
      NoteEmbedExtension.configure({}),
      OutlineExtension.configure({
        onUpdate: (h: HeadingItem[]) => headingsCallbackRef.current(h),
      }),
      Collaboration.configure({
        document: ydoc,
      }),
    ];
    if (provider) {
      exts.push(
        CollaborationCursor.configure({
          provider,
          user: {
            name: 'User',
            color: '#00ff9f',
          },
        })
      );
    }
    return exts;
  }, [ydoc, provider]);

  // Create TipTap editor
  const editor = useEditor({
    extensions,
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-full p-4',
      },
    },
  }, [extensions]);

  // Load initial file content into editor once synced (for new file-backed docs)
  const initialContentLoaded = useRef(false);
  useEffect(() => {
    if (!fileContext.current?.initialContent || !editor || !isSynced || initialContentLoaded.current) return;
    initialContentLoaded.current = true;
    const content = fileContext.current.initialContent;
    // Escape HTML so file content is treated as text, not markup
    const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const paragraphs = content.split('\n').map(line => `<p>${escapeHtml(line) || '<br>'}</p>`).join('');
    // Small delay to ensure Y.js collaboration is fully ready
    setTimeout(() => {
      editor.commands.setContent(paragraphs);
    }, 200);
  }, [editor, isSynced]);

  // Auto-sync back to file when content changes (debounced)
  useEffect(() => {
    if (!fileContext.current || !editor) return;

    const handleUpdate = () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
      syncTimeoutRef.current = setTimeout(async () => {
        try {
          setSyncing(true);
          await editorBridgeApi.syncToFile(documentId);
        } catch (error) {
          console.error('Failed to sync editor to file:', error);
        } finally {
          setSyncing(false);
        }
      }, 2000);
    };

    editor.on('update', handleUpdate);

    return () => {
      editor.off('update', handleUpdate);
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [editor, documentId]);

  // Manual sync handler
  const handleManualSync = async () => {
    if (!fileContext.current) return;
    try {
      setSyncing(true);
      await editorBridgeApi.syncToFile(documentId);
    } catch (error) {
      console.error('Failed to sync editor to file:', error);
    } finally {
      setSyncing(false);
    }
  };

  // Toolbar button component
  const ToolbarButton = useCallback(
    ({
      onClick,
      active,
      disabled,
      title,
      children,
    }: {
      onClick: () => void;
      active?: boolean;
      disabled?: boolean;
      title: string;
      children: React.ReactNode;
    }) => (
      <button
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={`p-1.5 rounded transition-colors ${
          active
            ? 'bg-white/20'
            : 'hover:bg-white/10'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        style={{ color: 'var(--theme-text-secondary)' }}
      >
        {children}
      </button>
    ),
    []
  );

  if (!editor) {
    return (
      <div
        className="h-full flex items-center justify-center"
        style={{ background: 'var(--theme-bg-primary)' }}
      >
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--theme-accent-primary)' }} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Toolbar */}
      <div
        className="flex items-center gap-1 px-3 py-2 border-b"
        style={{
          background: 'var(--theme-bg-secondary)',
          borderColor: 'var(--theme-border)',
        }}
      >
        {/* Document Title */}
        <div className="flex items-center gap-2 mr-4">
          <FileText className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
          {fileContext.current ? (
            <span className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
              {fileContext.current.sourceId.includes(':')
                ? fileContext.current.sourceId.split(':').pop()
                : fileContext.current.sourceId}
            </span>
          ) : (
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-transparent text-sm font-medium focus:outline-none"
              style={{ color: 'var(--theme-text-primary)' }}
              placeholder="Document title..."
            />
          )}
          {fileContext.current && (
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{ background: 'var(--theme-accent-primary)', color: '#000', opacity: 0.8 }}
            >
              {fileContext.current.sourceType}
            </span>
          )}
        </div>

        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Text Formatting */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          title="Bold"
        >
          <Bold className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          title="Italic"
        >
          <Italic className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive('strike')}
          title="Strikethrough"
        >
          <Strikethrough className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive('code')}
          title="Code"
        >
          <Code className="w-4 h-4" />
        </ToolbarButton>

        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Lists */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          title="Bullet List"
        >
          <List className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          title="Numbered List"
        >
          <ListOrdered className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive('blockquote')}
          title="Quote"
        >
          <Quote className="w-4 h-4" />
        </ToolbarButton>

        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Undo/Redo */}
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo"
        >
          <Undo className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo"
        >
          <Redo className="w-4 h-4" />
        </ToolbarButton>

        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Outline toggle */}
        <ToolbarButton
          onClick={() => setShowOutline(!showOutline)}
          active={showOutline}
          title="Table of Contents"
        >
          <ListTree className="w-4 h-4" />
        </ToolbarButton>

        {/* Backlinks toggle - only for file-backed documents */}
        {fileContext.current && (
          <ToolbarButton
            onClick={() => setShowBacklinks(!showBacklinks)}
            active={showBacklinks}
            title="Backlinks"
          >
            <Link2 className="w-4 h-4" />
          </ToolbarButton>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Collaborators */}
        {users.length > 0 && (
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
            <div className="flex -space-x-2">
              {users.slice(0, 5).map((user, index) => (
                <div
                  key={index}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium border-2"
                  style={{
                    background: user.color,
                    borderColor: 'var(--theme-bg-secondary)',
                    color: '#000',
                  }}
                  title={user.name}
                >
                  {user.name.charAt(0).toUpperCase()}
                </div>
              ))}
              {users.length > 5 && (
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium border-2"
                  style={{
                    background: 'var(--theme-bg-tertiary)',
                    borderColor: 'var(--theme-bg-secondary)',
                    color: 'var(--theme-text-secondary)',
                  }}
                >
                  +{users.length - 5}
                </div>
              )}
            </div>
          </div>
        )}

        {/* File sync button for file-backed documents */}
        {fileContext.current && (
          <button
            onClick={handleManualSync}
            disabled={syncing}
            title="Sync to file"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs transition hover:bg-white/10"
            style={{ color: 'var(--theme-text-secondary)' }}
          >
            {syncing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ArrowUpFromLine className="w-3.5 h-3.5" />
            )}
            Save to File
          </button>
        )}

        {/* Sync Status */}
        <div className="flex items-center gap-1.5 ml-3">
          {isSynced ? (
            <>
              <Save className="w-4 h-4" style={{ color: 'var(--theme-accent-primary)' }} />
              <span className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>
                Synced
              </span>
            </>
          ) : (
            <>
              <Loader2
                className="w-4 h-4 animate-spin"
                style={{ color: 'var(--theme-text-secondary)' }}
              />
              <span className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>
                Syncing...
              </span>
            </>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Outline sidebar */}
        {showOutline && (
          <div
            className="w-48 border-r overflow-auto shrink-0"
            style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-bg-secondary)' }}
          >
            <div className="p-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--theme-text-muted)' }}>
                Outline
              </p>
              {headings.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>No headings</p>
              ) : (
                <div className="space-y-0.5">
                  {headings.map(h => (
                    <button
                      key={h.id}
                      onClick={() => {
                        if (editor) {
                          editor.chain().focus().setTextSelection(h.pos).run();
                          // Scroll to position
                          const element = editor.view.domAtPos(h.pos);
                          if (element.node instanceof HTMLElement) {
                            element.node.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }
                        }
                      }}
                      className="block w-full text-left text-xs py-0.5 px-1 rounded truncate hover:bg-white/5 transition"
                      style={{
                        color: 'var(--theme-text-secondary)',
                        paddingLeft: `${(h.level - 1) * 12 + 4}px`,
                      }}
                    >
                      {h.text}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Editor */}
        <div className="flex-1 overflow-auto" style={{ background: 'var(--theme-bg-primary)' }}>
          <EditorContent editor={editor} className="h-full" />
        </div>

        {/* Backlinks sidebar */}
        {showBacklinks && fileContext.current && (
          <div
            className="w-64 border-l overflow-auto shrink-0"
            style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-bg-secondary)' }}
          >
            <div className="p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--theme-text-muted)' }}>
                Backlinks ({backlinks.length})
              </p>
              {backlinks.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>No backlinks</p>
              ) : (
                <div className="space-y-2">
                  {backlinks.map((bl, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        const { setPendingEditorContext, openApp } = useWindowStore.getState();
                        import('@/lib/api/workspace').then(({ editorBridgeApi: bridgeApi }) => {
                          bridgeApi.getWorkspaceMapping(bl.sourceFile).then(mapping => {
                            setPendingEditorContext({
                              documentId: mapping.documentId,
                              documentName: mapping.documentName,
                              sourceType: 'workspace',
                              sourceId: `workspace:${bl.sourceFile}`,
                              initialContent: mapping.initialContent,
                            });
                            openApp('editor');
                          }).catch(console.error);
                        });
                      }}
                      className="block w-full text-left p-2 rounded hover:bg-white/5 transition"
                    >
                      <span className="text-xs font-medium block truncate" style={{ color: 'var(--theme-accent-primary)' }}>
                        {bl.sourceFile}
                      </span>
                      <span className="text-[10px] block mt-0.5 line-clamp-2" style={{ color: 'var(--theme-text-muted)' }}>
                        {bl.snippet}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <p className="text-[10px] font-semibold uppercase tracking-wide mt-4 mb-2" style={{ color: 'var(--theme-text-muted)' }}>
                Forward Links ({forwardLinks.length})
              </p>
              {forwardLinks.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>No forward links</p>
              ) : (
                <div className="space-y-1">
                  {forwardLinks.map((fl, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        const { setPendingEditorContext, openApp } = useWindowStore.getState();
                        import('@/lib/api/workspace').then(({ editorBridgeApi: bridgeApi }) => {
                          bridgeApi.getWorkspaceMapping(fl.targetFile).then(mapping => {
                            setPendingEditorContext({
                              documentId: mapping.documentId,
                              documentName: mapping.documentName,
                              sourceType: 'workspace',
                              sourceId: `workspace:${fl.targetFile}`,
                              initialContent: mapping.initialContent,
                            });
                            openApp('editor');
                          }).catch(console.error);
                        });
                      }}
                      className="block w-full text-left px-2 py-1 rounded text-xs truncate hover:bg-white/5 transition"
                      style={{ color: 'var(--theme-text-secondary)' }}
                    >
                      {fl.targetFile}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Editor Styles */}
      <style jsx global>{`
        .ProseMirror {
          min-height: 100%;
          padding: 1rem;
        }

        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: var(--theme-text-secondary);
          opacity: 0.5;
          pointer-events: none;
          height: 0;
        }

        .ProseMirror:focus {
          outline: none;
        }

        .ProseMirror h1 {
          font-size: 2em;
          font-weight: bold;
          margin-bottom: 0.5em;
        }

        .ProseMirror h2 {
          font-size: 1.5em;
          font-weight: bold;
          margin-bottom: 0.5em;
        }

        .ProseMirror h3 {
          font-size: 1.25em;
          font-weight: bold;
          margin-bottom: 0.5em;
        }

        .ProseMirror p {
          margin-bottom: 0.5em;
          color: var(--theme-text-primary);
        }

        .ProseMirror ul,
        .ProseMirror ol {
          padding-left: 1.5em;
          margin-bottom: 0.5em;
        }

        .ProseMirror blockquote {
          border-left: 3px solid var(--theme-accent-primary);
          padding-left: 1em;
          margin-left: 0;
          color: var(--theme-text-secondary);
        }

        .ProseMirror code {
          background: var(--theme-bg-tertiary);
          padding: 0.2em 0.4em;
          border-radius: 3px;
          font-family: monospace;
        }

        .ProseMirror pre {
          background: var(--theme-bg-tertiary);
          padding: 0.75em 1em;
          border-radius: 6px;
          overflow-x: auto;
        }

        /* Collaboration cursor */
        .collaboration-cursor__caret {
          position: relative;
          margin-left: -1px;
          margin-right: -1px;
          border-left: 1px solid;
          border-right: 1px solid;
          word-break: normal;
          pointer-events: none;
        }

        .collaboration-cursor__label {
          position: absolute;
          top: -1.4em;
          left: -1px;
          font-size: 12px;
          font-style: normal;
          font-weight: 600;
          line-height: normal;
          user-select: none;
          color: #000;
          padding: 0.1rem 0.3rem;
          border-radius: 3px 3px 3px 0;
          white-space: nowrap;
        }

        /* Wikilink styles */
        .wikilink-chip {
          display: inline;
          padding: 1px 6px;
          border-radius: 4px;
          background: rgba(0, 200, 255, 0.15);
          color: var(--theme-accent-primary);
          cursor: pointer;
          font-size: 0.9em;
        }
        .wikilink-chip:hover {
          background: rgba(0, 200, 255, 0.25);
        }
        .wikilink-inline {
          color: var(--theme-accent-primary);
          text-decoration: underline;
          text-decoration-style: dotted;
          cursor: pointer;
        }

        /* Note embed styles */
        .note-embed-inline {
          background: rgba(0, 200, 255, 0.08);
          border-left: 2px solid var(--theme-accent-primary);
          padding: 0 4px;
        }
        .note-embed-block {
          border: 1px solid var(--theme-border);
          border-radius: 6px;
          padding: 8px 12px;
          margin: 8px 0;
          background: var(--theme-bg-secondary);
        }
      `}</style>
    </div>
  );
}

export default EditorWindow;
