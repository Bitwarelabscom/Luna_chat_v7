'use client';

import { useState, useMemo } from 'react';
import {
  Pencil,
  Trash2,
  GitMerge,
  Link2,
  Clock,
  Zap,
  Network,
} from 'lucide-react';
import { useMemoryLabStore } from '@/lib/memory-lab-store';

export function NodeDetailPanel() {
  const {
    graphNodes, graphEdges, selectedNodeId,
    updateNode, deleteNode, mergeNodes, createEdge,
  } = useMemoryLabStore();

  const [showEditModal, setShowEditModal] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [showEdgeDialog, setShowEdgeDialog] = useState(false);

  const selectedNode = useMemo(
    () => graphNodes.find(n => n.id === selectedNodeId),
    [graphNodes, selectedNodeId]
  );

  const connectedEdges = useMemo(() => {
    if (!selectedNodeId) return [];
    return graphEdges.filter(
      e => e.sourceNodeId === selectedNodeId || e.targetNodeId === selectedNodeId
    );
  }, [graphEdges, selectedNodeId]);

  if (!selectedNode) {
    return (
      <div className="h-full flex items-center justify-center border-l" style={{ borderColor: 'var(--theme-border-default)' }}>
        <div className="text-center p-4">
          <Network className="w-8 h-8 mx-auto mb-2 opacity-20" style={{ color: 'var(--theme-text-muted)' }} />
          <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
            Select a node to view details
          </p>
          <p className="text-[10px] mt-1" style={{ color: 'var(--theme-text-muted)' }}>
            Double-click to expand neighbors
          </p>
        </div>
      </div>
    );
  }

  const handleDelete = () => {
    if (confirm(`Delete node "${selectedNode.nodeLabel}"?`)) {
      deleteNode(selectedNode.id);
    }
  };

  return (
    <div className="h-full flex flex-col border-l overflow-hidden" style={{ borderColor: 'var(--theme-border-default)' }}>
      {/* Node info */}
      <div className="p-3 border-b shrink-0" style={{ borderColor: 'var(--theme-border-default)' }}>
        <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--theme-text-primary)' }}>
          {selectedNode.nodeLabel}
        </h3>
        <div className="mt-2 space-y-1">
          <InfoRow label="Type" value={selectedNode.nodeType} />
          <InfoRow label="Origin" value={selectedNode.origin} />
          <InfoRow label="Edges" value={String(selectedNode.edgeCount)} />
          <InfoRow label="Centrality" value={selectedNode.centralityScore.toFixed(3)} />
          <InfoRow label="Activation" value={selectedNode.activationStrength.toFixed(3)} />
          <InfoRow label="Status" value={selectedNode.identityStatus} />
          {selectedNode.emotionalIntensity > 0 && (
            <InfoRow label="Emotion" value={selectedNode.emotionalIntensity.toFixed(2)} />
          )}
        </div>

        <div className="flex items-center gap-1.5 mt-1">
          <Clock className="w-3 h-3" style={{ color: 'var(--theme-text-muted)' }} />
          <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
            Last active: {selectedNode.lastActivated ? new Date(selectedNode.lastActivated).toLocaleDateString() : 'N/A'}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="px-3 py-2 border-b shrink-0 space-y-1" style={{ borderColor: 'var(--theme-border-default)' }}>
        <button
          onClick={() => setShowEditModal(true)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition hover:bg-white/5"
          style={{ color: 'var(--theme-text-secondary)' }}
        >
          <Pencil className="w-3.5 h-3.5" />
          Edit Node
        </button>
        <button
          onClick={() => setShowMergeDialog(true)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition hover:bg-white/5"
          style={{ color: 'var(--theme-text-secondary)' }}
        >
          <GitMerge className="w-3.5 h-3.5" />
          Merge Into...
        </button>
        <button
          onClick={() => setShowEdgeDialog(true)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition hover:bg-white/5"
          style={{ color: 'var(--theme-text-secondary)' }}
        >
          <Link2 className="w-3.5 h-3.5" />
          Add Edge
        </button>
        <button
          onClick={handleDelete}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition hover:bg-red-400/10"
          style={{ color: '#ef4444' }}
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete Node
        </button>
      </div>

      {/* Connected edges */}
      <div className="flex-1 overflow-auto p-2">
        <div className="text-xs font-medium mb-2" style={{ color: 'var(--theme-text-secondary)' }}>
          Connected Edges ({connectedEdges.length})
        </div>
        {connectedEdges.slice(0, 20).map(edge => {
          const otherNodeId = edge.sourceNodeId === selectedNodeId ? edge.targetNodeId : edge.sourceNodeId;
          const otherNode = graphNodes.find(n => n.id === otherNodeId);
          return (
            <div key={edge.id} className="flex items-center gap-2 py-1">
              <Zap className="w-3 h-3 shrink-0" style={{ color: 'var(--theme-text-muted)' }} />
              <div className="flex-1 min-w-0">
                <span className="text-[10px] truncate block" style={{ color: 'var(--theme-text-primary)' }}>
                  {otherNode?.nodeLabel || otherNodeId.slice(0, 8)}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
                  {edge.edgeType} ({edge.strength.toFixed(2)})
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modals */}
      {showEditModal && (
        <EditModal
          node={selectedNode}
          onSave={(label, type) => { updateNode(selectedNode.id, { label, type }); setShowEditModal(false); }}
          onClose={() => setShowEditModal(false)}
        />
      )}
      {showMergeDialog && (
        <MergeDialog
          sourceId={selectedNode.id}
          sourceLabel={selectedNode.nodeLabel}
          candidates={graphNodes.filter(n => n.id !== selectedNode.id)}
          onMerge={(targetId, reason) => { mergeNodes(selectedNode.id, targetId, reason); setShowMergeDialog(false); }}
          onClose={() => setShowMergeDialog(false)}
        />
      )}
      {showEdgeDialog && (
        <CreateEdgeDialog
          sourceId={selectedNode.id}
          sourceLabel={selectedNode.nodeLabel}
          candidates={graphNodes.filter(n => n.id !== selectedNode.id)}
          onCreateEdge={(targetId, type) => { createEdge(selectedNode.id, targetId, type); setShowEdgeDialog(false); }}
          onClose={() => setShowEdgeDialog(false)}
        />
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>{label}</span>
      <span className="text-xs font-medium" style={{ color: 'var(--theme-text-secondary)' }}>{value}</span>
    </div>
  );
}

// Inline modals
function EditModal({
  node, onSave, onClose,
}: {
  node: { nodeLabel: string; nodeType: string };
  onSave: (label: string, type: string) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(node.nodeLabel);
  const [type, setType] = useState(node.nodeType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[360px] rounded-xl p-5 shadow-2xl"
        style={{ background: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border-default)' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--theme-text-primary)' }}>Edit Node</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--theme-text-muted)' }}>Label</label>
            <input
              value={label} onChange={e => setLabel(e.target.value)}
              className="w-full px-3 py-1.5 rounded text-sm bg-transparent border outline-none"
              style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
            />
          </div>
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--theme-text-muted)' }}>Type</label>
            <input
              value={type} onChange={e => setType(e.target.value)}
              className="w-full px-3 py-1.5 rounded text-sm bg-transparent border outline-none"
              style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs" style={{ color: 'var(--theme-text-secondary)' }}>Cancel</button>
          <button
            onClick={() => onSave(label, type)}
            className="px-3 py-1.5 rounded text-xs font-medium"
            style={{ background: 'var(--theme-accent-primary)', color: 'var(--theme-bg-primary)' }}
          >Save</button>
        </div>
      </div>
    </div>
  );
}

function MergeDialog({
  sourceId: _sourceId, sourceLabel, candidates, onMerge, onClose,
}: {
  sourceId: string;
  sourceLabel: string;
  candidates: Array<{ id: string; nodeLabel: string; nodeType: string }>;
  onMerge: (targetId: string, reason?: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');

  const filtered = candidates.filter(c =>
    c.nodeLabel.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 20);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[400px] rounded-xl p-5 shadow-2xl"
        style={{ background: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border-default)' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--theme-text-primary)' }}>
          Merge "{sourceLabel}" into...
        </h3>
        <p className="text-xs mb-3" style={{ color: 'var(--theme-text-muted)' }}>
          The selected node will be absorbed by the target node.
        </p>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search target node..."
          className="w-full px-3 py-1.5 rounded text-sm bg-transparent border outline-none mb-2"
          style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
        />
        <div className="max-h-40 overflow-auto mb-3 space-y-0.5">
          {filtered.map(c => (
            <button
              key={c.id}
              onClick={() => onMerge(c.id, reason || undefined)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs hover:bg-white/5 transition"
              style={{ color: 'var(--theme-text-primary)' }}
            >
              <span className="truncate">{c.nodeLabel}</span>
              <span className="text-[10px] shrink-0" style={{ color: 'var(--theme-text-muted)' }}>
                ({c.nodeType})
              </span>
            </button>
          ))}
        </div>
        <input
          value={reason} onChange={e => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="w-full px-3 py-1.5 rounded text-sm bg-transparent border outline-none mb-3"
          style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
        />
        <div className="flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs" style={{ color: 'var(--theme-text-secondary)' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function CreateEdgeDialog({
  sourceId: _sourceId, sourceLabel, candidates, onCreateEdge, onClose,
}: {
  sourceId: string;
  sourceLabel: string;
  candidates: Array<{ id: string; nodeLabel: string; nodeType: string }>;
  onCreateEdge: (targetId: string, type: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [edgeType, setEdgeType] = useState('semantic');
  const EDGE_TYPES = ['co_occurrence', 'semantic', 'temporal', 'causal', 'same_as', 'contradicts'];

  const filtered = candidates.filter(c =>
    c.nodeLabel.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 20);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[400px] rounded-xl p-5 shadow-2xl"
        style={{ background: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border-default)' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--theme-text-primary)' }}>
          Create Edge from "{sourceLabel}"
        </h3>
        <div className="mb-2">
          <label className="text-xs block mb-1" style={{ color: 'var(--theme-text-muted)' }}>Edge Type</label>
          <select
            value={edgeType} onChange={e => setEdgeType(e.target.value)}
            className="w-full px-3 py-1.5 rounded text-sm bg-transparent border outline-none"
            style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
          >
            {EDGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search target node..."
          className="w-full px-3 py-1.5 rounded text-sm bg-transparent border outline-none mb-2"
          style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-primary)' }}
        />
        <div className="max-h-40 overflow-auto mb-3 space-y-0.5">
          {filtered.map(c => (
            <button
              key={c.id}
              onClick={() => onCreateEdge(c.id, edgeType)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs hover:bg-white/5 transition"
              style={{ color: 'var(--theme-text-primary)' }}
            >
              <span className="truncate">{c.nodeLabel}</span>
              <span className="text-[10px] shrink-0" style={{ color: 'var(--theme-text-muted)' }}>({c.nodeType})</span>
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs" style={{ color: 'var(--theme-text-secondary)' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
