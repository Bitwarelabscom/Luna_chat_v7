'use client';

import { useState, useEffect } from 'react';
import { Database, ExternalLink, CheckCircle, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { autonomousLearningApi, type ResearchSession } from '@/lib/api';

export default function ResearchSessionsList() {
  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      setLoading(true);
      const { sessions } = await autonomousLearningApi.getResearchSessions();
      setSessions(sessions);
    } catch (error) {
      console.error('Failed to load research sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-purple-500 border-t-transparent mx-auto mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400">Loading research sessions...</p>
            </div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Database className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              No Research Sessions
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md">
              No research has been conducted yet. Sessions are created when knowledge gaps are researched.
            </p>
          </div>
        ) : (
          sessions.map((session) => {
            const isExpanded = expandedId === session.id;
            const verified = session.verificationResult?.passed;

            return (
              <div
                key={session.id}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden"
              >
                {/* Header */}
                <button
                  onClick={() => toggleExpand(session.id)}
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    {isExpanded ? (
                      <ChevronDown className="w-5 h-5 text-gray-500" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-gray-500" />
                    )}
                    <div className="text-left">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        {session.topic}
                      </h3>
                      <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400 mt-1">
                        <span>{session.trustedSourcesCount} trusted sources</span>
                        <span>•</span>
                        <span>{new Date(session.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {verified !== undefined && (
                      verified ? (
                        <div className="flex items-center gap-2 px-3 py-1 bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-lg">
                          <CheckCircle className="w-4 h-4" />
                          <span className="text-sm font-medium">Verified</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 px-3 py-1 bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg">
                          <XCircle className="w-4 h-4" />
                          <span className="text-sm font-medium">Rejected</span>
                        </div>
                      )
                    )}
                  </div>
                </button>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="px-6 pb-6 space-y-6 border-t border-gray-200 dark:border-gray-700">
                    {/* Search Queries */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                        Search Queries
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {session.searchQueries.map((query, idx) => (
                          <span
                            key={idx}
                            className="px-3 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg text-sm"
                          >
                            {query}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Findings */}
                    {session.findings && (
                      <>
                        {/* Summary */}
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                            Summary
                          </h4>
                          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                            {session.findings.summary}
                          </p>
                          <div className="mt-2">
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              Confidence: {Math.round(session.findings.confidence * 100)}%
                            </span>
                          </div>
                        </div>

                        {/* Key Facts */}
                        {session.findings.keyFacts.length > 0 && (
                          <div>
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                              Key Facts
                            </h4>
                            <ul className="space-y-2">
                              {session.findings.keyFacts.map((fact, idx) => (
                                <li
                                  key={idx}
                                  className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300"
                                >
                                  <span className="text-purple-500 mt-1">•</span>
                                  <span>{fact}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Sources */}
                        {session.findings.sources.length > 0 && (
                          <div>
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                              Sources ({session.findings.sources.length})
                            </h4>
                            <div className="space-y-2">
                              {session.findings.sources.map((source, idx) => (
                                <a
                                  key={idx}
                                  href={source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group"
                                >
                                  <ExternalLink className="w-4 h-4 text-gray-400 mt-0.5 group-hover:text-purple-500" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                      {source.title}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                      {source.url}
                                    </p>
                                    {source.trustScore !== null && (
                                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                                        Trust: {(source.trustScore * 100).toFixed(0)}%
                                      </p>
                                    )}
                                  </div>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Verification Result */}
                    {session.verificationResult && (
                      <div className={`p-4 rounded-lg ${
                        session.verificationResult.passed
                          ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                          : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                      }`}>
                        <h4 className={`text-sm font-semibold mb-2 ${
                          session.verificationResult.passed
                            ? 'text-green-900 dark:text-green-300'
                            : 'text-red-900 dark:text-red-300'
                        }`}>
                          Verification Result
                        </h4>
                        <p className={`text-sm mb-3 ${
                          session.verificationResult.passed
                            ? 'text-green-700 dark:text-green-300'
                            : 'text-red-700 dark:text-red-300'
                        }`}>
                          {session.verificationResult.reasoning}
                        </p>
                        <div className="flex gap-4 text-xs">
                          <span>Internal Consistency: {session.verificationResult.internalConsistency ? '✓' : '✗'}</span>
                          <span>Plausibility: {session.verificationResult.plausibility ? '✓' : '✗'}</span>
                          <span>Source Agreement: {session.verificationResult.sourceAgreement ? '✓' : '✗'}</span>
                          <span>Confidence: {Math.round(session.verificationResult.confidence * 100)}%</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
