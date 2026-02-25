'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, X, Star, Trash2, RefreshCw, Clock } from 'lucide-react';
import { friendsApi, GossipTopic, FriendPersonality } from '@/lib/api';

const INTERVAL_OPTIONS = [
  { label: '5 min', value: 5 },
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '60 min', value: 60 },
] as const;

interface GossipQueuePanelProps {
  friends: FriendPersonality[];
  onStartTheater: (topic: string, friendId?: string) => void;
}

export default function GossipQueuePanel({ friends, onStartTheater }: GossipQueuePanelProps) {
  const [topics, setTopics] = useState<GossipTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoEnabled, setAutoEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('gossip-auto-enabled') === 'true';
  });
  const [interval, setInterval_] = useState<5 | 15 | 30 | 60>(() => {
    if (typeof window === 'undefined') return 15;
    return (parseInt(localStorage.getItem('gossip-interval') || '15') || 15) as 5 | 15 | 30 | 60;
  });
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({
    topicText: '',
    motivation: '',
    importance: 3,
    suggestedFriendId: '',
  });
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof globalThis.setInterval> | null>(null);

  const loadTopics = useCallback(async () => {
    try {
      setLoading(true);
      const res = await friendsApi.getGossipQueue(50);
      setTopics(res.topics);
    } catch (err) {
      console.error('Failed to load gossip queue:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  // Persist auto-gossip settings
  useEffect(() => {
    localStorage.setItem('gossip-auto-enabled', String(autoEnabled));
  }, [autoEnabled]);

  useEffect(() => {
    localStorage.setItem('gossip-interval', String(interval));
  }, [interval]);

  // Auto-gossip timer
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!autoEnabled) return;

    timerRef.current = setInterval(async () => {
      // Reload topics to get fresh state
      let fresh: GossipTopic[] = topics;
      try {
        const res = await friendsApi.getGossipQueue(50);
        fresh = res.topics;
        setTopics(fresh);
      } catch {
        // use cached
      }

      const next = fresh.find(t => t.status === 'pending' || t.status === 'approved');
      if (!next) {
        // All consumed - stop timer
        setAutoEnabled(false);
        return;
      }

      // Mark consumed, then start theater
      try {
        await friendsApi.updateTopic(next.id, { status: 'consumed' });
        setTopics(prev => prev.map(t => t.id === next.id ? { ...t, status: 'consumed' } : t));
        onStartTheater(next.topicText, next.suggestedFriendId || undefined);
      } catch (err) {
        console.error('Auto-gossip error:', err);
      }
    }, interval * 60_000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEnabled, interval]);

  const handleCheck = async (topic: GossipTopic) => {
    const newStatus = topic.status === 'consumed' ? 'approved' : 'consumed';
    try {
      await friendsApi.updateTopic(topic.id, { status: newStatus });
      setTopics(prev => prev.map(t => t.id === topic.id ? { ...t, status: newStatus as GossipTopic['status'] } : t));
    } catch (err) {
      console.error('Failed to update topic status:', err);
    }
  };

  const handleStarClick = async (topic: GossipTopic, star: number) => {
    try {
      await friendsApi.updateTopic(topic.id, { importance: star });
      setTopics(prev => prev.map(t => t.id === topic.id ? { ...t, importance: star } : t));
    } catch (err) {
      console.error('Failed to update importance:', err);
    }
  };

  const handleDelete = async (topicId: string) => {
    try {
      await friendsApi.deleteTopic(topicId);
      setTopics(prev => prev.filter(t => t.id !== topicId));
    } catch (err) {
      console.error('Failed to delete topic:', err);
    }
  };

  const handleAddSubmit = async () => {
    if (!addForm.topicText.trim()) return;
    setSaving(true);
    try {
      const res = await friendsApi.addTopic({
        topicText: addForm.topicText.trim(),
        motivation: addForm.motivation.trim() || undefined,
        importance: addForm.importance,
        suggestedFriendId: addForm.suggestedFriendId || undefined,
      });
      setTopics(prev => [res.topic, ...prev]);
      setAddForm({ topicText: '', motivation: '', importance: 3, suggestedFriendId: '' });
      setShowAddForm(false);
    } catch (err) {
      console.error('Failed to add topic:', err);
    } finally {
      setSaving(false);
    }
  };

  const pendingCount = topics.filter(t => t.status === 'pending' || t.status === 'approved').length;
  const doneCount = topics.filter(t => t.status === 'consumed').length;

  return (
    <div className="flex flex-col h-full text-sm">
      {/* Header */}
      <div className="p-3 border-b border-gray-700">
        <h3 className="font-semibold text-gray-100 mb-2 flex items-center gap-1.5">
          <Clock size={14} className="text-pink-400" />
          Gossip Queue
        </h3>

        {/* Auto-gossip controls */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-gray-400 text-xs">Auto:</span>
          <button
            onClick={() => setAutoEnabled(v => !v)}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              autoEnabled
                ? 'bg-pink-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
          >
            {autoEnabled ? 'ON' : 'OFF'}
          </button>
          <select
            value={interval}
            onChange={e => setInterval_(parseInt(e.target.value) as 5 | 15 | 30 | 60)}
            className="bg-gray-700 border border-gray-600 rounded text-xs text-gray-300 px-1 py-0.5"
          >
            {INTERVAL_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Topic count + refresh */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {pendingCount} pending{doneCount > 0 ? `, ${doneCount} done` : ''}
          </span>
          <div className="flex gap-1">
            <button
              onClick={loadTopics}
              className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={12} />
            </button>
            <button
              onClick={() => setShowAddForm(v => !v)}
              className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
              title="Add topic"
            >
              <Plus size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Add topic form */}
      {showAddForm && (
        <div className="p-3 border-b border-gray-700 bg-gray-800/60">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-300">Add topic</span>
            <button onClick={() => setShowAddForm(false)} className="text-gray-500 hover:text-gray-300">
              <X size={12} />
            </button>
          </div>
          <textarea
            value={addForm.topicText}
            onChange={e => setAddForm(f => ({ ...f, topicText: e.target.value }))}
            placeholder="Topic to discuss..."
            rows={2}
            className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-500 resize-none mb-1.5"
          />
          <input
            type="text"
            value={addForm.motivation}
            onChange={e => setAddForm(f => ({ ...f, motivation: e.target.value }))}
            placeholder="Why discuss this? (optional)"
            className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-500 mb-1.5"
          />
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs text-gray-400">Importance:</span>
            <StarPicker value={addForm.importance} onChange={v => setAddForm(f => ({ ...f, importance: v }))} />
          </div>
          {friends.length > 0 && (
            <select
              value={addForm.suggestedFriendId}
              onChange={e => setAddForm(f => ({ ...f, suggestedFriendId: e.target.value }))}
              className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 mb-1.5"
            >
              <option value="">Any friend</option>
              {friends.map(f => (
                <option key={f.id} value={f.id}>{f.avatarEmoji} {f.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={handleAddSubmit}
            disabled={!addForm.topicText.trim() || saving}
            className="w-full py-1 rounded bg-pink-700 hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
          >
            {saving ? 'Saving...' : 'Add'}
          </button>
        </div>
      )}

      {/* Topics list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-xs text-gray-500">Loading...</div>
        ) : topics.length === 0 ? (
          <div className="p-4 text-center text-xs text-gray-500">
            No topics yet. Luna mines topics from your conversations automatically, or add one manually.
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {topics.map(topic => (
              <TopicRow
                key={topic.id}
                topic={topic}
                onCheck={handleCheck}
                onStarClick={handleStarClick}
                onDelete={handleDelete}
                onStartTheater={onStartTheater}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Star picker sub-component
function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`transition-colors ${n <= value ? 'text-amber-400' : 'text-gray-600 hover:text-amber-300'}`}
        >
          <Star size={11} fill={n <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
}

// Individual topic row
interface TopicRowProps {
  topic: GossipTopic;
  onCheck: (t: GossipTopic) => void;
  onStarClick: (t: GossipTopic, star: number) => void;
  onDelete: (id: string) => void;
  onStartTheater: (topic: string, friendId?: string) => void;
}

function TopicRow({ topic, onCheck, onStarClick, onDelete, onStartTheater }: TopicRowProps) {
  const isDone = topic.status === 'consumed';

  return (
    <div className={`p-2.5 group hover:bg-gray-800/40 transition-colors ${isDone ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-2">
        {/* Checkbox */}
        <button
          onClick={() => onCheck(topic)}
          className={`mt-0.5 flex-shrink-0 w-3.5 h-3.5 rounded border transition-colors ${
            isDone
              ? 'bg-pink-600 border-pink-500 text-white'
              : 'border-gray-600 hover:border-pink-500'
          } flex items-center justify-center`}
          title={isDone ? 'Mark as pending' : 'Mark as done'}
        >
          {isDone && <span className="text-[8px] leading-none">✓</span>}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1">
            <span
              className={`text-xs leading-snug ${isDone ? 'line-through text-gray-500' : 'text-gray-200'}`}
            >
              {topic.topicText}
            </span>
            {/* Star importance */}
            <div className="flex-shrink-0">
              <StarPicker value={topic.importance} onChange={v => onStarClick(topic, v)} />
            </div>
          </div>

          {topic.motivation && (
            <p className="text-[10px] text-gray-500 mt-0.5 leading-snug">{topic.motivation}</p>
          )}

          <div className="flex items-center gap-2 mt-1">
            {topic.suggestedFriendName && (
              <span className="text-[10px] text-gray-500">
                {topic.suggestedFriendEmoji} {topic.suggestedFriendName}
              </span>
            )}
            {topic.sourceType === 'manual' && (
              <span className="text-[9px] bg-gray-700 text-gray-400 px-1 rounded">manual</span>
            )}

            {/* Quick start theater button */}
            {!isDone && (
              <button
                onClick={() => onStartTheater(topic.topicText, topic.suggestedFriendId || undefined)}
                className="text-[10px] text-pink-500 hover:text-pink-400 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                Discuss now
              </button>
            )}

            {/* Delete */}
            <button
              onClick={() => onDelete(topic.id)}
              className="ml-auto text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 size={10} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
