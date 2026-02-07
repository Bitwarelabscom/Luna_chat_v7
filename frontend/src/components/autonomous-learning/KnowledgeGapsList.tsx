'use client';

import { useState, useEffect } from 'react';
import { Brain, Search, Filter, ExternalLink } from 'lucide-react';
import { autonomousLearningApi, type KnowledgeGap } from '@/lib/api';

export default function KnowledgeGapsList() {
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');

  useEffect(() => {
    loadGaps();
  }, [statusFilter]);

  const loadGaps = async () => {
    try {
      setLoading(true);
      const { gaps } = await autonomousLearningApi.getKnowledgeGaps(statusFilter || undefined);
      setGaps(gaps);
    } catch (error) {
      console.error('Failed to load knowledge gaps:', error);
    } finally {
      setLoading(false);
    }
  };

  const statuses = ['', 'pending', 'researching', 'verified', 'embedded', 'rejected', 'failed'];

  return (
    <div className="h-full flex flex-col">
      {/* Filter Bar */}
      <div className="flex-shrink-0 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-4">
          <Filter className="w-5 h-5 text-gray-500" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="">All Statuses</option>
            {statuses.slice(1).map((status) => (
              <option key={status} value={status}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </option>
            ))}
          </select>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {gaps.length} {gaps.length === 1 ? 'gap' : 'gaps'} found
          </span>
        </div>
      </div>

      {/* Gaps List */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-purple-500 border-t-transparent mx-auto mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400">Loading knowledge gaps...</p>
            </div>
          </div>
        ) : gaps.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Brain className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              No Knowledge Gaps
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md">
              Luna hasn't identified any knowledge gaps yet. Knowledge gaps are identified daily through session analysis.
            </p>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-4">
            {gaps.map((gap) => (
              <div
                key={gap.id}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden hover:shadow-xl transition-shadow"
              >
                <div className="flex items-start gap-4 p-6">
                  {/* Priority Indicator */}
                  <div className="flex-shrink-0">
                    <div
                      className={`w-16 h-16 rounded-lg flex items-center justify-center ${getPriorityColor(
                        gap.priority
                      )}`}
                    >
                      <span className="text-2xl font-bold text-white">
                        {Math.round(gap.priority * 100)}
                      </span>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        {gap.gapDescription}
                      </h3>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusBadge(
                          gap.status
                        )}`}
                      >
                        {gap.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400 mb-3">
                      <span className="capitalize">{gap.category}</span>
                      <span>•</span>
                      <span>Identified {new Date(gap.identifiedAt).toLocaleDateString()}</span>
                    </div>

                    {/* Suggested Queries */}
                    {gap.suggestedQueries && gap.suggestedQueries.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                          Suggested Queries
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {gap.suggestedQueries.map((query, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-2 px-3 py-1 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 rounded-lg text-sm"
                            >
                              <Search className="w-3 h-3" />
                              <span>{query}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Research Session Link */}
                    {gap.researchSessionId && (
                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                        <a
                          href={`#research-${gap.researchSessionId}`}
                          className="inline-flex items-center gap-2 text-sm text-purple-600 dark:text-purple-400 hover:underline"
                        >
                          <ExternalLink className="w-4 h-4" />
                          View Research Session
                        </a>
                      </div>
                    )}

                    {/* Failure Reason */}
                    {gap.failureReason && (
                      <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                        <p className="text-sm text-red-700 dark:text-red-300">
                          <span className="font-semibold">Failed:</span> {gap.failureReason}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function getPriorityColor(priority: number): string {
  if (priority >= 0.8) return 'bg-gradient-to-br from-red-500 to-pink-600';
  if (priority >= 0.6) return 'bg-gradient-to-br from-orange-500 to-yellow-600';
  if (priority >= 0.4) return 'bg-gradient-to-br from-blue-500 to-cyan-600';
  return 'bg-gradient-to-br from-gray-400 to-gray-600';
}

function getStatusBadge(status: string): string {
  switch (status) {
    case 'pending':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300';
    case 'researching':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300';
    case 'verified':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300';
    case 'embedded':
      return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300';
    case 'rejected':
      return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300';
    case 'failed':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300';
  }
}
