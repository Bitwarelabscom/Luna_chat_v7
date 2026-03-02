'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { workspaceApi, editorBridgeApi, type NoteGraphData } from '@/lib/api/workspace';
import { useWindowStore } from '@/lib/window-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CyInstance = any;

export function NotesGraphView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<CyInstance>(null);
  const [loading, setLoading] = useState(true);
  const [graphData, setGraphData] = useState<NoteGraphData | null>(null);
  const openApp = useWindowStore((s) => s.openApp);
  const setPendingEditorContext = useWindowStore((s) => s.setPendingEditorContext);

  // Load note graph data
  useEffect(() => {
    setLoading(true);
    workspaceApi.getNoteGraph()
      .then(data => setGraphData(data))
      .catch(err => console.error('Failed to load note graph:', err))
      .finally(() => setLoading(false));
  }, []);

  // Initialize Cytoscape
  useEffect(() => {
    if (!graphData || !containerRef.current) return;

    let cy: CyInstance = null;

    import('cytoscape').then((cytoscapeMod) => {
      const cytoscape = cytoscapeMod.default || cytoscapeMod;
      if (!containerRef.current) return;

      cy = cytoscape({
        container: containerRef.current,
        elements: [
          ...graphData.nodes.map(n => ({
            data: {
              id: n.filename,
              label: n.title || n.filename.split('/').pop()?.replace('.md', '') || n.filename,
              linkCount: n.linkCount,
            },
          })),
          ...graphData.edges.map((e, i) => ({
            data: {
              id: `edge-${i}`,
              source: e.source,
              target: e.target,
              label: e.linkText,
            },
          })),
        ],
        style: [
          {
            selector: 'node',
            style: {
              'background-color': '#00c8ff',
              'label': 'data(label)',
              'color': '#e2e8f0',
              'font-size': '10px',
              'text-valign': 'bottom',
              'text-margin-y': 6,
              'width': 'mapData(linkCount, 0, 10, 20, 50)',
              'height': 'mapData(linkCount, 0, 10, 20, 50)',
              'border-width': 1,
              'border-color': '#1e293b',
            } as CyInstance,
          },
          {
            selector: 'edge',
            style: {
              'width': 1.5,
              'line-color': 'rgba(0, 200, 255, 0.3)',
              'target-arrow-color': 'rgba(0, 200, 255, 0.3)',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              'arrow-scale': 0.8,
            } as CyInstance,
          },
          {
            selector: 'node:active',
            style: {
              'overlay-opacity': 0.1,
            } as CyInstance,
          },
        ],
        layout: {
          name: 'cose',
          animate: false,
          nodeRepulsion: () => 8000,
          idealEdgeLength: () => 120,
          gravity: 0.3,
          padding: 40,
        } as CyInstance,
      });

      // Click handler - open file in editor
      cy.on('tap', 'node', async (evt: CyInstance) => {
        const filename = evt.target.id();
        try {
          const mapping = await editorBridgeApi.getWorkspaceMapping(filename);
          setPendingEditorContext({
            sourceType: 'workspace',
            sourceId: filename,
            documentId: mapping.documentId,
            documentName: mapping.documentName,
            initialContent: mapping.initialContent,
          });
          openApp('editor');
        } catch (err) {
          console.error('Failed to open note from graph:', err);
        }
      });

      cyRef.current = cy;
    });

    return () => {
      cy?.destroy();
      cyRef.current = null;
    };
  }, [graphData, openApp, setPendingEditorContext]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: '#0f172a' }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--theme-accent-primary)' }} />
      </div>
    );
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center" style={{ background: '#0f172a', color: 'var(--theme-text-muted)' }}>
        <p className="text-sm">No linked notes found</p>
        <p className="text-xs mt-1 opacity-60">Create notes with [[wikilinks]] to see connections</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ background: '#0f172a' }}
    />
  );
}
