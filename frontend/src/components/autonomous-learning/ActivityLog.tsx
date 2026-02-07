'use client';

import { useState, useEffect } from 'react';
import { Activity, CheckCircle, XCircle, Search, Database, Brain } from 'lucide-react';
import { autonomousLearningApi, type LearningLogEntry } from '@/lib/api';

export default function ActivityLog() {
  const [logs, setLogs] = useState<LearningLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionTypeFilter, setActionTypeFilter] = useState<string>('');

  useEffect(() => {
    loadLogs();
  }, [actionTypeFilter]);

  const loadLogs = async () => {
    try {
      setLoading(true);
      const { logs } = await autonomousLearningApi.getLearningLog(actionTypeFilter || undefined);
      setLogs(logs);
    } catch (error) {
      console.error('Failed to load activity log:', error);
    } finally {
      setLoading(false);
    }
  };

  const actionTypes = ['', 'analysis', 'research', 'verification', 'embedding', 'notification'];

  return (
    <div className="h-full flex flex-col">
      {/* Filter Bar */}
      <div className="flex-shrink-0 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-4">
          <Activity className="w-5 h-5 text-gray-500" />
          <select
            value={actionTypeFilter}
            onChange={(e) => setActionTypeFilter(e.target.value)}
            className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="">All Actions</option>
            {actionTypes.slice(1).map((type) => (
              <option key={type} value={type}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </option>
            ))}
          </select>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {logs.length} {logs.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
      </div>

      {/* Activity Log */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-purple-500 border-t-transparent mx-auto mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400">Loading activity log...</p>
            </div>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Activity className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              No Activity
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md">
              No activity logged yet. Activity will appear here as Luna learns autonomously.
            </p>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-3">
            {logs.map((log) => {
              const Icon = getActionIcon(log.actionType);
              return (
                <div
                  key={log.id}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start gap-4 p-4">
                    {/* Icon and Status */}
                    <div className="flex-shrink-0">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        log.success
                          ? 'bg-green-100 dark:bg-green-900/20'
                          : 'bg-red-100 dark:bg-red-900/20'
                      }`}>
                        {log.success ? (
                          <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                        ) : (
                          <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                        )}
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-gray-500" />
                          <span className="text-sm font-semibold text-gray-900 dark:text-white capitalize">
                            {log.actionType}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {new Date(log.timestamp).toLocaleString()}
                        </span>
                      </div>

                      {/* Details */}
                      <div className="text-sm text-gray-700 dark:text-gray-300">
                        {renderDetails(log.actionType, log.details)}
                      </div>

                      {/* Error Message */}
                      {!log.success && log.errorMessage && (
                        <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-300">
                          <span className="font-semibold">Error:</span> {log.errorMessage}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function getActionIcon(actionType: string) {
  switch (actionType) {
    case 'analysis':
      return Brain;
    case 'research':
      return Search;
    case 'verification':
      return CheckCircle;
    case 'embedding':
      return Database;
    default:
      return Activity;
  }
}

function renderDetails(actionType: string, details: Record<string, unknown>): React.ReactNode {
  switch (actionType) {
    case 'analysis':
      if (details.stage === 'complete') {
        return (
          <span>
            Analyzed {String(details.sessionsAnalyzed)} sessions, found {String(details.gapsFound)} knowledge gaps
          </span>
        );
      }
      if (details.stage === 'start') {
        return <span>Starting session analysis...</span>;
      }
      return null;

    case 'research': {
      const topic = String(details.topic || '');
      const sourcesFound = details.sourcesFound ? Number(details.sourcesFound) : 0;
      return (
        <>
          Researched topic: <span className="font-medium">{topic}</span>
          {sourcesFound > 0 && (
            <span className="ml-2 text-gray-500">({sourcesFound} sources found)</span>
          )}
        </>
      );
    }

    case 'verification': {
      const passed = Boolean(details.passed);
      const confidence = details.confidence ? Number(details.confidence) : 0;
      return (
        <>
          Verification {passed ? 'passed' : 'failed'}
          {confidence > 0 && (
            <span className="ml-2 text-gray-500">
              (confidence: {Math.round(confidence * 100)}%)
            </span>
          )}
        </>
      );
    }

    case 'embedding': {
      const topic = String(details.topic || '');
      const entities = details.entitiesExtracted !== undefined ? Number(details.entitiesExtracted) : 0;
      return (
        <>
          Embedded knowledge: <span className="font-medium">{topic}</span>
          {entities > 0 && (
            <span className="ml-2 text-gray-500">
              ({entities} entities extracted)
            </span>
          )}
        </>
      );
    }

    case 'notification':
      return <>{String(details.message || '')}</>;

    default:
      return <>{JSON.stringify(details)}</>;
  }
}
