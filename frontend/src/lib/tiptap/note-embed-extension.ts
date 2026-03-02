import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface NoteEmbedOptions {
  onOpenOriginal?: (filename: string) => void;
  HTMLAttributes: Record<string, unknown>;
}

// Regex to match ![[filename]] embed syntax in text
const NOTE_EMBED_REGEX = /!\[\[([^\]]+?)\]\]/g;

export const NoteEmbedExtension = Node.create<NoteEmbedOptions>({
  name: 'noteEmbed',
  group: 'block',
  atom: true,

  addOptions() {
    return {
      onOpenOriginal: undefined,
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      filename: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-embed-file'),
        renderHTML: (attributes) => ({
          'data-embed-file': attributes.filename,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-note-embed]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-note-embed': '',
        class: 'note-embed-block',
      }),
      ['div', { class: 'note-embed-header' },
        ['span', { class: 'note-embed-filename' }, HTMLAttributes['data-embed-file'] || ''],
      ],
      ['div', { class: 'note-embed-content' }, 'Loading...'],
    ];
  },

  addProseMirrorPlugins() {
    return [
      // Decoration plugin to highlight ![[...]] in plain text
      new Plugin({
        key: new PluginKey('noteEmbedDecorations'),
        state: {
          init(_, state) {
            return buildEmbedDecorations(state.doc);
          },
          apply(tr, oldSet) {
            if (tr.docChanged) {
              return buildEmbedDecorations(tr.doc);
            }
            return oldSet;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

function buildEmbedDecorations(doc: Parameters<typeof DecorationSet.create>[0]): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;

    NOTE_EMBED_REGEX.lastIndex = 0;
    let match;
    while ((match = NOTE_EMBED_REGEX.exec(node.text)) !== null) {
      const start = pos + match.index;
      const end = start + match[0].length;
      decorations.push(
        Decoration.inline(start, end, {
          class: 'note-embed-inline',
          'data-embed-file': match[1].trim(),
        })
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

export default NoteEmbedExtension;
