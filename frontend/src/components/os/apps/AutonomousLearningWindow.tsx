'use client';

import { useState, useEffect } from 'react';
import { Brain, Database, Settings, Activity, BarChart3 } from 'lucide-react';
import { autonomousLearningApi, type LearningStats } from '@/lib/api';
import ActivityLog from '@/components/autonomous-learning/ActivityLog';
import KnowledgeGapsList from '@/components/autonomous-learning/KnowledgeGapsList';
import ResearchSessionsList from '@/components/autonomous-learning/ResearchSessionsList';
import TrustScoreManager from '@/components/autonomous-learning/TrustScoreManager';
import StatsDashboard from '@/components/autonomous-learning/StatsDashboard';

type Tab = 'dashboard' | 'gaps' | 'research' | 'activity' | 'trust';

export default function AutonomousLearningWindow() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const { stats } = await autonomousLearningApi.getStats();
      setStats(stats);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: 'dashboard' as Tab, label: 'Dashboard', icon: BarChart3 },
    { id: 'gaps' as Tab, label: 'Knowledge Gaps', icon: Brain },
    { id: 'research' as Tab, label: 'Research Sessions', icon: Database },
    { id: 'activity' as Tab, label: 'Activity Log', icon: Activity },
    { id: 'trust' as Tab, label: 'Trust Scores', icon: Settings },
  ];

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-purple-50 via-white to-indigo-50 dark:from-gray-900 dark:via-gray-800 dark:to-purple-900/20">
      {/* Header */}
      <div className="flex-shrink-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-b border-purple-200 dark:border-purple-800">
        <div className="px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
                Autonomous Learning
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Luna's knowledge evolution system
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pb-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all
                  ${
                    activeTab === tab.id
                      ? 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white shadow-lg'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-purple-100 dark:hover:bg-purple-900/30'
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-purple-500 border-t-transparent mx-auto mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400">Loading...</p>
            </div>
          </div>
        ) : (
          <>
            {activeTab === 'dashboard' && stats && (
              <StatsDashboard stats={stats} onRefresh={loadStats} />
            )}
            {activeTab === 'gaps' && <KnowledgeGapsList />}
            {activeTab === 'research' && <ResearchSessionsList />}
            {activeTab === 'activity' && <ActivityLog />}
            {activeTab === 'trust' && <TrustScoreManager />}
          </>
        )}
      </div>
    </div>
  );
}
