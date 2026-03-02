import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface WikilinkOptions {
  onLinkClick?: (filename: string) => void;
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikilink: {
      insertWikilink: (filename: string) => ReturnType;
    };
  }
}

// Regex to match [[target]] and [[target|alias]] in text
const WIKILINK_REGEX = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

export const WikilinkExtension = Node.create<WikilinkOptions>({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,

  addOptions() {
    return {
      onLinkClick: undefined,
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      target: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-target'),
        renderHTML: (attributes) => ({
          'data-target': attributes.target,
        }),
      },
      alias: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-alias'),
        renderHTML: (attributes) => ({
          'data-alias': attributes.alias,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-wikilink]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-wikilink': '',
        class: 'wikilink-chip',
      }),
      HTMLAttributes['data-alias'] || HTMLAttributes['data-target'] || '',
    ];
  },

  addCommands() {
    return {
      insertWikilink:
        (filename: string) =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: this.name,
              attrs: { target: filename, alias: null },
            })
            .run();
        },
    };
  },

  addProseMirrorPlugins() {
    const onLinkClick = this.options.onLinkClick;

    return [
      // Click handler for wikilink nodes
      new Plugin({
        key: new PluginKey('wikilinkClick'),
        props: {
          handleClick(view, _pos, event) {
            const target = (event.target as HTMLElement).closest('.wikilink-chip');
            if (target && onLinkClick) {
              const filename = target.getAttribute('data-target');
              if (filename) {
                onLinkClick(filename);
                return true;
              }
            }
            return false;
          },
        },
      }),
      // Decoration plugin to highlight [[...]] in plain text
      new Plugin({
        key: new PluginKey('wikilinkDecorations'),
        state: {
          init(_, state) {
            return buildDecorations(state.doc);
          },
          apply(tr, oldSet) {
            if (tr.docChanged) {
              return buildDecorations(tr.doc);
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

function buildDecorations(doc: Parameters<typeof DecorationSet.create>[0]): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;

    WIKILINK_REGEX.lastIndex = 0;
    let match;
    while ((match = WIKILINK_REGEX.exec(node.text)) !== null) {
      const start = pos + match.index;
      const end = start + match[0].length;
      decorations.push(
        Decoration.inline(start, end, {
          class: 'wikilink-inline',
          'data-target': match[1].trim(),
        })
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

export default WikilinkExtension;
