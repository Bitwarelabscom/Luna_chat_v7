import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';

export interface HeadingItem {
  id: string;
  text: string;
  level: number;
  pos: number;
}

export interface OutlineOptions {
  onUpdate?: (headings: HeadingItem[]) => void;
}

export const OutlineExtension = Extension.create<OutlineOptions>({
  name: 'outline',

  addOptions() {
    return {
      onUpdate: undefined,
    };
  },

  addProseMirrorPlugins() {
    const onUpdate = this.options.onUpdate;

    return [
      new Plugin({
        key: new PluginKey('outline'),
        view() {
          return {
            update(view) {
              if (!onUpdate) return;
              const headings: HeadingItem[] = [];
              let headingIndex = 0;

              view.state.doc.descendants((node, pos) => {
                if (node.type.name === 'heading') {
                  headingIndex++;
                  headings.push({
                    id: `heading-${headingIndex}`,
                    text: node.textContent,
                    level: node.attrs.level as number,
                    pos,
                  });
                }
              });

              onUpdate(headings);
            },
          };
        },
      }),
    ];
  },
});

export default OutlineExtension;
