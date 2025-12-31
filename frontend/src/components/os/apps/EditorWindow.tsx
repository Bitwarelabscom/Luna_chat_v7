'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
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
} from 'lucide-react';

interface EditorWindowProps {
  documentId?: string;
  documentName?: string;
}

export function EditorWindow({
  documentId = 'default-document',
  documentName = 'Untitled Document',
}: EditorWindowProps) {
  const [isSynced, setIsSynced] = useState(false);
  const [users, setUsers] = useState<{ name: string; color: string }[]>([]);
  const [title, setTitle] = useState(documentName);

  // Create Y.js document
  const ydoc = useMemo(() => new Y.Doc(), []);

  // Create Hocuspocus provider
  // Note: Auth is handled via HTTP-only cookies - Hocuspocus will read from cookie header
  const provider = useMemo(() => {
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = typeof window !== 'undefined' ? window.location.host : 'localhost:3005';
    const wsUrl = `${protocol}//${host}/ws/editor`;

    return new HocuspocusProvider({
      url: wsUrl,
      name: documentId,
      document: ydoc,
      // Token will be extracted from cookies server-side
      token: 'cookie-auth',
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
  }, [documentId, ydoc]);

  // Cleanup provider on unmount
  useEffect(() => {
    return () => {
      provider.disconnect();
    };
  }, [provider]);

  // Create TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        history: false, // Disable history as Y.js handles undo/redo
      }),
      Placeholder.configure({
        placeholder: 'Start writing...',
      }),
      Collaboration.configure({
        document: ydoc,
      }),
      CollaborationCursor.configure({
        provider,
        user: {
          name: 'User',
          color: '#00ff9f',
        },
      }),
    ],
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-full p-4',
      },
    },
  });

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
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="bg-transparent text-sm font-medium focus:outline-none"
            style={{ color: 'var(--theme-text-primary)' }}
            placeholder="Document title..."
          />
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

      {/* Editor Content */}
      <div
        className="flex-1 overflow-auto"
        style={{ background: 'var(--theme-bg-primary)' }}
      >
        <EditorContent
          editor={editor}
          className="h-full"
        />
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
      `}</style>
    </div>
  );
}

export default EditorWindow;
