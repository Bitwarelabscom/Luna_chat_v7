'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { useCEOLunaStore } from '@/lib/ceo-luna-store';
import { approvePost, cancelPost } from '@/lib/api/ceo';
import type { AutopostItem } from '@/lib/api/ceo';

type StatusFilter = 'all' | 'draft' | 'approved' | 'scheduled' | 'posted' | 'failed';

const STATUS_FILTERS: StatusFilter[] = ['all', 'draft', 'approved', 'scheduled', 'posted', 'failed'];

const CHANNEL_COLORS: Record<string, string> = {
  x: 'bg-gray-700 text-gray-300',
  linkedin: 'bg-blue-900/50 text-blue-400',
  telegram: 'bg-cyan-900/50 text-cyan-400',
  blog: 'bg-amber-900/50 text-amber-400',
  reddit: 'bg-orange-900/50 text-orange-400',
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'text-gray-400',
  approved: 'text-blue-400',
  scheduled: 'text-amber-400',
  posted: 'text-emerald-400',
  failed: 'text-red-400',
  cancelled: 'text-gray-600',
};

function PostCard({ post, onAction }: { post: AutopostItem; onAction: () => void }) {
  const [loading, setLoading] = useState<'approve' | 'cancel' | null>(null);

  const handleApprove = async () => {
    setLoading('approve');
    try {
      await approvePost(post.id);
      onAction();
    } catch (err) {
      console.error('Failed to approve:', err);
    } finally {
      setLoading(null);
    }
  };

  const handleCancel = async () => {
    setLoading('cancel');
    try {
      await cancelPost(post.id);
      onAction();
    } catch (err) {
      console.error('Failed to cancel:', err);
    } finally {
      setLoading(null);
    }
  };

  const canApprove = post.status === 'draft';
  const canCancel = ['draft', 'approved', 'scheduled'].includes(post.status);
  const channelColor = CHANNEL_COLORS[post.channel] || 'bg-gray-700 text-gray-300';
  const statusColor = STATUS_COLORS[post.status] || 'text-gray-400';

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 text-xs rounded font-medium ${channelColor}`}>
            {post.channel}
          </span>
          {post.title && (
            <span className="text-sm text-gray-300 font-medium truncate max-w-[300px]">{post.title}</span>
          )}
        </div>
        <span className={`text-xs font-medium shrink-0 ${statusColor}`}>{post.status}</span>
      </div>

      {/* Content preview */}
      <p className="text-xs text-gray-500 line-clamp-3 leading-relaxed">{post.content}</p>

      {/* Footer */}
      <div className="flex items-center gap-2 pt-1">
        <span className="text-xs text-gray-700 flex-1">
          {post.scheduledAt
            ? `Scheduled: ${new Date(post.scheduledAt).toLocaleString()}`
            : post.postedAt
            ? `Posted: ${new Date(post.postedAt).toLocaleString()}`
            : new Date(post.createdAt).toLocaleDateString()}
        </span>

        {canApprove && (
          <button
            onClick={handleApprove}
            disabled={loading !== null}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-emerald-900/40 hover:bg-emerald-800/50 text-emerald-400 border border-emerald-700 rounded transition-colors disabled:opacity-50"
          >
            {loading === 'approve' ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <CheckCircle size={10} />
            )}
            Approve
          </button>
        )}

        {canCancel && (
          <button
            onClick={handleCancel}
            disabled={loading !== null}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800 rounded transition-colors disabled:opacity-50"
          >
            {loading === 'cancel' ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <XCircle size={10} />
            )}
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export function AutopostPanel() {
  const { autopostQueue, isLoadingAutopost, loadAutopostQueue } = useCEOLunaStore();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  useEffect(() => {
    loadAutopostQueue();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = statusFilter === 'all'
    ? autopostQueue
    : autopostQueue.filter((p) => p.status === statusFilter);

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-300">Autopost Queue</span>
          {isLoadingAutopost && <Loader2 size={12} className="text-gray-500 animate-spin" />}
          <span className="text-xs text-gray-600">({autopostQueue.length} total)</span>
        </div>
        <button
          onClick={() => loadAutopostQueue()}
          disabled={isLoadingAutopost}
          className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 px-4 py-2 border-b border-gray-800 overflow-x-auto">
        {STATUS_FILTERS.map((f) => {
          const count = f === 'all'
            ? autopostQueue.length
            : autopostQueue.filter((p) => p.status === f).length;
          return (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`shrink-0 px-2 py-0.5 text-xs rounded transition-colors ${
                statusFilter === f
                  ? 'bg-slate-700 text-white'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
              }`}
            >
              {f} {count > 0 && <span className="text-gray-500">({count})</span>}
            </button>
          );
        })}
      </div>

      {/* Queue */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {isLoadingAutopost && autopostQueue.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="text-gray-500 animate-spin" />
          </div>
        )}

        {!isLoadingAutopost && filtered.length === 0 && (
          <div className="text-center py-12 text-gray-600 text-sm">
            No posts with status &quot;{statusFilter}&quot;
          </div>
        )}

        {filtered.map((post) => (
          <PostCard key={post.id} post={post} onAction={() => loadAutopostQueue()} />
        ))}
      </div>
    </div>
  );
}
