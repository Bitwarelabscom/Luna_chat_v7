'use client';

import { CheckCircle, Database, AlertCircle, RefreshCw } from 'lucide-react';
import type { LearningStats } from '@/lib/api';

interface StatsDashboardProps {
  stats: LearningStats;
  onRefresh: () => void;
}

export default function StatsDashboard({ stats, onRefresh }: StatsDashboardProps) {
  const statCards = [
    {
      label: 'Total Research Sessions',
      value: stats.totalResearchSessions,
      icon: Database,
      color: 'from-blue-500 to-cyan-600',
    },
    {
      label: 'Knowledge Embedded',
      value: stats.knowledgeEmbedded,
      icon: CheckCircle,
      color: 'from-green-500 to-emerald-600',
    },
    {
      label: 'Pending Gaps',
      value: stats.gapsByStatus.pending || 0,
      icon: AlertCircle,
      color: 'from-yellow-500 to-orange-600',
    },
    {
      label: 'Researching',
      value: stats.gapsByStatus.researching || 0,
      icon: Database,
      color: 'from-purple-500 to-indigo-600',
    },
  ];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header with Refresh */}
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Learning Statistics
          </h2>
          <button
            onClick={onRefresh}
            className="flex items-center gap-2 px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Refresh</span>
          </button>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden"
              >
                <div className={`h-2 bg-gradient-to-r ${stat.color}`} />
                <div className="p-6">
                  <div className="flex items-center justify-between mb-3">
                    <Icon className={`w-8 h-8 bg-gradient-to-r ${stat.color} bg-clip-text text-transparent`} />
                    <span className="text-3xl font-bold text-gray-900 dark:text-white">
                      {stat.value}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{stat.label}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Gaps by Status */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Knowledge Gaps by Status
          </h3>
          <div className="space-y-3">
            {Object.entries(stats.gapsByStatus).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${getStatusColor(status)}`} />
                  <span className="text-sm capitalize text-gray-700 dark:text-gray-300">
                    {status.replace('_', ' ')}
                  </span>
                </div>
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Recent Activity (Last 7 Days)
          </h3>
          {stats.recentActivity.length > 0 ? (
            <div className="space-y-2">
              {stats.recentActivity.map((activity) => (
                <div
                  key={activity.date}
                  className="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-700 last:border-0"
                >
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {new Date(activity.date).toLocaleDateString()}
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-gradient-to-r from-purple-500 to-indigo-600 h-2 rounded-full"
                        style={{ width: `${Math.min((activity.count / 10) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white w-8 text-right">
                      {activity.count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              No recent activity
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'pending':
      return 'bg-yellow-500';
    case 'researching':
      return 'bg-blue-500';
    case 'verified':
      return 'bg-purple-500';
    case 'embedded':
      return 'bg-green-500';
    case 'rejected':
      return 'bg-red-500';
    case 'failed':
      return 'bg-orange-500';
    default:
      return 'bg-gray-500';
  }
}
