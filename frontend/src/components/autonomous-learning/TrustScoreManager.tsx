'use client';

import { useState, useEffect } from 'react';
import { Shield, Edit2, Save, X, Filter } from 'lucide-react';
import { autonomousLearningApi, type TrustScore } from '@/lib/api';

export default function TrustScoreManager() {
  const [scores, setScores] = useState<TrustScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editScore, setEditScore] = useState<number>(0);
  const [editReason, setEditReason] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadScores();
  }, [categoryFilter]);

  const loadScores = async () => {
    try {
      setLoading(true);
      const { scores } = await autonomousLearningApi.getTrustScores(categoryFilter || undefined);
      setScores(scores);
    } catch (error) {
      console.error('Failed to load trust scores:', error);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (score: TrustScore) => {
    setEditingId(score.id);
    setEditScore(score.trustScore);
    setEditReason('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditScore(0);
    setEditReason('');
  };

  const saveEdit = async (domain: string) => {
    if (!editReason.trim()) {
      alert('Please provide a reason for updating the trust score');
      return;
    }

    try {
      setSaving(true);
      await autonomousLearningApi.updateTrustScore(domain, editScore, editReason);
      await loadScores();
      cancelEdit();
    } catch (error) {
      console.error('Failed to update trust score:', error);
      alert('Failed to update trust score');
    } finally {
      setSaving(false);
    }
  };

  const categories = [
    '',
    'academic',
    'investigative_journalism',
    'technical',
    'political_news',
    'social',
    'blog',
    'reference',
    'tech_community',
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Filter Bar */}
      <div className="flex-shrink-0 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-4">
          <Filter className="w-5 h-5 text-gray-500" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="">All Categories</option>
            {categories.slice(1).map((cat) => (
              <option key={cat} value={cat}>
                {cat.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
              </option>
            ))}
          </select>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {scores.length} {scores.length === 1 ? 'domain' : 'domains'}
          </span>
        </div>
      </div>

      {/* Trust Scores List */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-purple-500 border-t-transparent mx-auto mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400">Loading trust scores...</p>
            </div>
          </div>
        ) : scores.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Shield className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              No Trust Scores
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md">
              No domains configured with this filter.
            </p>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Domain
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Category
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Trust Score
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Last Updated
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {scores.map((score) => {
                    const isEditing = editingId === score.id;
                    return (
                      <tr key={score.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {score.domain}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="px-2 py-1 text-xs rounded-full bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300">
                            {score.category.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {isEditing ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                max="1"
                                step="0.05"
                                value={editScore}
                                onChange={(e) => setEditScore(parseFloat(e.target.value))}
                                className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                              />
                              <span className="text-sm text-gray-500">({Math.round(editScore * 100)}%)</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="w-24 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full ${getTrustColor(score.trustScore)}`}
                                  style={{ width: `${score.trustScore * 100}%` }}
                                />
                              </div>
                              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                {(score.trustScore * 100).toFixed(0)}%
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {new Date(score.lastUpdated).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-2">
                              <input
                                type="text"
                                placeholder="Update reason..."
                                value={editReason}
                                onChange={(e) => setEditReason(e.target.value)}
                                className="w-48 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                              />
                              <button
                                onClick={() => saveEdit(score.domain)}
                                disabled={saving}
                                className="p-1 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/20 rounded transition-colors disabled:opacity-50"
                              >
                                <Save className="w-4 h-4" />
                              </button>
                              <button
                                onClick={cancelEdit}
                                disabled={saving}
                                className="p-1 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startEdit(score)}
                              className="inline-flex items-center gap-1 px-3 py-1 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/20 rounded transition-colors"
                            >
                              <Edit2 className="w-3 h-3" />
                              <span>Edit</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Info Box */}
            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-2">
                Trust Score Guidelines
              </h4>
              <ul className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
                <li>• <strong>0.95+</strong>: Academic/Technical sources (ArXiv, IEEE, Nature)</li>
                <li>• <strong>0.85</strong>: Investigative journalism (Guardian, Wired, ProPublica)</li>
                <li>• <strong>0.75-0.80</strong>: Developer communities (StackOverflow, GitHub)</li>
                <li>• <strong>0.70</strong>: Wikipedia and reference materials</li>
                <li>• <strong>0.40-0.65</strong>: Blogs and community platforms</li>
                <li>• <strong>0.10</strong>: Political news (all countries)</li>
                <li>• <strong>0.05</strong>: Social media platforms</li>
                <li>• <strong>Threshold: 0.80</strong> - Only sources ≥0.80 are used for autonomous research</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function getTrustColor(score: number): string {
  if (score >= 0.9) return 'bg-gradient-to-r from-green-500 to-emerald-600';
  if (score >= 0.8) return 'bg-gradient-to-r from-blue-500 to-cyan-600';
  if (score >= 0.6) return 'bg-gradient-to-r from-yellow-500 to-orange-500';
  if (score >= 0.4) return 'bg-gradient-to-r from-orange-500 to-red-500';
  return 'bg-gradient-to-r from-red-600 to-red-800';
}
