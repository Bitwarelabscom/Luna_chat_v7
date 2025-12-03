'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Play, Square, RefreshCw, Plus, Target, Rss, BookOpen,
  Sparkles, Eye, Settings, Trash2, Check, User, MessageCircle, X, Send
} from 'lucide-react';
import { autonomousApi } from '../../lib/api';
import type {
  AutonomousConfig, AutonomousStatus, Goal, Achievement, RssFeed, ProactiveInsight, AutonomousQuestion
} from '../../lib/api';
import TheaterMode from '../TheaterMode';

type TabSection = 'control' | 'goals' | 'journal' | 'rss' | 'insights';

const goalTypeConfig = {
  user_focused: { color: 'text-blue-400', bg: 'bg-blue-400/10', label: 'User Focused' },
  self_improvement: { color: 'text-purple-400', bg: 'bg-purple-400/10', label: 'Self Improvement' },
  relationship: { color: 'text-pink-400', bg: 'bg-pink-400/10', label: 'Relationship' },
  research: { color: 'text-green-400', bg: 'bg-green-400/10', label: 'Research' },
};

export default function AutonomousTab() {
  const [activeSection, setActiveSection] = useState<TabSection>('control');
  const [status, setStatus] = useState<AutonomousStatus | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_config, setConfig] = useState<AutonomousConfig | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [insights, setInsights] = useState<ProactiveInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTheater, setShowTheater] = useState(false);
  const [showNewGoal, setShowNewGoal] = useState(false);
  const [showNewFeed, setShowNewFeed] = useState(false);
  const [newGoal, setNewGoal] = useState({ goalType: 'self_improvement', title: '', description: '', priority: 5 });
  const [newFeed, setNewFeed] = useState({ url: '', category: 'tech' });
  const [userAvailable, setUserAvailable] = useState(false);
  const [pendingQuestions, setPendingQuestions] = useState<AutonomousQuestion[]>([]);
  const [answeringQuestion, setAnsweringQuestion] = useState<string | null>(null);
  const [questionResponse, setQuestionResponse] = useState('');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [statusRes, configRes, goalsRes, achievementsRes, feedsRes, insightsRes, availabilityRes, questionsRes] = await Promise.all([
        autonomousApi.getStatus(),
        autonomousApi.getConfig(),
        autonomousApi.getGoals(),
        autonomousApi.getAchievements(),
        autonomousApi.getFeeds(),
        autonomousApi.getInsights({ unshared: true }),
        autonomousApi.getAvailability().catch(() => ({ available: false })),
        autonomousApi.getPendingQuestions().catch(() => ({ questions: [] })),
      ]);

      setStatus(statusRes);
      setConfig(configRes.config);
      setGoals(goalsRes.goals || []);
      setAchievements(achievementsRes.achievements || []);
      setFeeds(feedsRes.feeds || []);
      setInsights(insightsRes.insights || []);
      setUserAvailable(availabilityRes.available);
      setPendingQuestions(questionsRes.questions || []);
    } catch (error) {
      console.error('Failed to load autonomous data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleStart = async () => {
    try {
      await autonomousApi.start();
      await loadData();
      setShowTheater(true);
    } catch (error) {
      console.error('Failed to start:', error);
      alert(error instanceof Error ? error.message : 'Failed to start autonomous mode');
    }
  };

  const handleStop = async () => {
    try {
      await autonomousApi.stop();
      setShowTheater(false);
      await loadData();
    } catch (error) {
      console.error('Failed to stop:', error);
    }
  };

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGoal.title.trim()) return;

    try {
      await autonomousApi.createGoal({
        goalType: newGoal.goalType as Goal['goalType'],
        title: newGoal.title,
        description: newGoal.description || null,
        priority: newGoal.priority,
      });
      setNewGoal({ goalType: 'self_improvement', title: '', description: '', priority: 5 });
      setShowNewGoal(false);
      await loadData();
    } catch (error) {
      console.error('Failed to create goal:', error);
    }
  };

  const handleCompleteGoal = async (goalId: string) => {
    try {
      await autonomousApi.updateGoal(goalId, { status: 'completed' });
      await loadData();
    } catch (error) {
      console.error('Failed to complete goal:', error);
    }
  };

  const handleDeleteGoal = async (goalId: string) => {
    if (!confirm('Delete this goal?')) return;
    try {
      await autonomousApi.deleteGoal(goalId);
      await loadData();
    } catch (error) {
      console.error('Failed to delete goal:', error);
    }
  };

  const handleAddFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFeed.url.trim()) return;

    try {
      await autonomousApi.addFeed(newFeed.url, newFeed.category);
      setNewFeed({ url: '', category: 'tech' });
      setShowNewFeed(false);
      await loadData();
    } catch (error) {
      console.error('Failed to add feed:', error);
    }
  };

  const handleAddDefaultFeeds = async () => {
    try {
      await autonomousApi.addDefaultFeeds();
      await loadData();
    } catch (error) {
      console.error('Failed to add default feeds:', error);
    }
  };

  const handleDeleteFeed = async (feedId: string) => {
    if (!confirm('Remove this feed?')) return;
    try {
      await autonomousApi.deleteFeed(feedId);
      await loadData();
    } catch (error) {
      console.error('Failed to delete feed:', error);
    }
  };

  const handleFetchFeeds = async () => {
    try {
      const result = await autonomousApi.fetchFeeds();
      alert(`Fetched ${result.articlesAdded} new articles`);
      await loadData();
    } catch (error) {
      console.error('Failed to fetch feeds:', error);
    }
  };

  const handleDismissInsight = async (insightId: string) => {
    try {
      await autonomousApi.dismissInsight(insightId);
      await loadData();
    } catch (error) {
      console.error('Failed to dismiss insight:', error);
    }
  };

  const handleToggleAvailability = async () => {
    try {
      const result = await autonomousApi.setAvailability(!userAvailable);
      setUserAvailable(result.available);
    } catch (error) {
      console.error('Failed to toggle availability:', error);
    }
  };

  const handleAnswerQuestion = async (questionId: string) => {
    if (!questionResponse.trim()) return;
    try {
      await autonomousApi.answerQuestion(questionId, questionResponse);
      setQuestionResponse('');
      setAnsweringQuestion(null);
      await loadData();
    } catch (error) {
      console.error('Failed to answer question:', error);
    }
  };

  const handleDismissQuestion = async (questionId: string) => {
    try {
      await autonomousApi.dismissQuestion(questionId);
      await loadData();
    } catch (error) {
      console.error('Failed to dismiss question:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-theme-accent-primary" />
      </div>
    );
  }

  const isActive = status?.status === 'active';

  return (
    <div className="space-y-6">
      {/* Theater Mode Overlay */}
      {showTheater && status?.currentSession && (
        <TheaterMode
          sessionId={status.currentSession.id}
          onClose={() => setShowTheater(false)}
        />
      )}

      {/* Section Tabs */}
      <div className="flex gap-2 border-b border-theme-border pb-2 overflow-x-auto">
        {[
          { id: 'control', icon: Settings, label: 'Control' },
          { id: 'goals', icon: Target, label: 'Goals' },
          { id: 'journal', icon: BookOpen, label: 'Journal' },
          { id: 'rss', icon: Rss, label: 'RSS Feeds' },
          { id: 'insights', icon: Sparkles, label: 'Insights' },
        ].map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setActiveSection(id as TabSection)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
              activeSection === id
                ? 'bg-theme-accent-primary/20 text-theme-accent-primary'
                : 'text-theme-text-secondary hover:bg-theme-bg-tertiary'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
            {id === 'insights' && insights.length > 0 && (
              <span className="bg-theme-accent-primary text-white text-xs px-1.5 py-0.5 rounded-full">
                {insights.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Control Section */}
      {activeSection === 'control' && (
        <div className="space-y-6">
          {/* User Availability Toggle - Prominent at top */}
          <div className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-lg p-4 border border-purple-500/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <User className={`w-5 h-5 ${userAvailable ? 'text-green-400' : 'text-gray-500'}`} />
                <div>
                  <div className="font-medium">User Availability</div>
                  <div className="text-xs text-theme-text-muted">
                    {userAvailable
                      ? 'Luna can ask you questions during autonomous sessions'
                      : 'Luna will work independently without interrupting you'}
                  </div>
                </div>
              </div>
              <button
                onClick={handleToggleAvailability}
                className={`relative w-14 h-7 rounded-full transition-colors ${
                  userAvailable ? 'bg-green-500' : 'bg-gray-600'
                }`}
              >
                <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${
                  userAvailable ? 'left-8' : 'left-1'
                }`} />
              </button>
            </div>
          </div>

          {/* Pending Questions from Luna */}
          {pendingQuestions.length > 0 && (
            <div className="bg-theme-bg-tertiary rounded-lg p-4 border-l-4 border-yellow-400">
              <div className="flex items-center gap-2 mb-3">
                <MessageCircle className="w-5 h-5 text-yellow-400" />
                <span className="font-medium">Luna has questions for you</span>
                <span className="bg-yellow-400 text-black text-xs px-2 py-0.5 rounded-full">
                  {pendingQuestions.length}
                </span>
              </div>
              <div className="space-y-3">
                {pendingQuestions.map((question) => (
                  <div key={question.id} className="bg-theme-bg-secondary rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        {question.priority >= 8 && (
                          <span className="text-xs px-2 py-0.5 rounded bg-red-400/10 text-red-400 mb-1 inline-block">
                            Urgent
                          </span>
                        )}
                        <p className="text-sm">{question.question}</p>
                        {question.context && (
                          <p className="text-xs text-theme-text-muted mt-1">{question.context}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleDismissQuestion(question.id)}
                        className="p-1 text-theme-text-muted hover:text-red-400"
                        title="Dismiss"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    {answeringQuestion === question.id ? (
                      <div className="mt-3 flex gap-2">
                        <input
                          type="text"
                          value={questionResponse}
                          onChange={(e) => setQuestionResponse(e.target.value)}
                          placeholder="Type your response..."
                          className="flex-1 px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-sm"
                          onKeyDown={(e) => e.key === 'Enter' && handleAnswerQuestion(question.id)}
                          autoFocus
                        />
                        <button
                          onClick={() => handleAnswerQuestion(question.id)}
                          className="px-3 py-2 bg-theme-accent-primary text-white rounded-lg hover:bg-theme-accent-primary/80"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => { setAnsweringQuestion(null); setQuestionResponse(''); }}
                          className="px-3 py-2 bg-theme-bg-tertiary rounded-lg hover:bg-theme-bg-secondary"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAnsweringQuestion(question.id)}
                        className="mt-2 text-sm text-theme-accent-primary hover:underline"
                      >
                        Reply to Luna
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Status Card */}
          <div className="bg-theme-bg-tertiary rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
                <span className="text-lg font-medium">
                  {isActive ? 'Autonomous Mode Active' : 'Autonomous Mode Inactive'}
                </span>
              </div>
              <button
                onClick={isActive ? handleStop : handleStart}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  isActive
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                    : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                }`}
              >
                {isActive ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {isActive ? 'Stop' : 'Start'}
              </button>
            </div>

            {isActive && status?.currentSession && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-theme-text-secondary">Current Phase:</span>
                  <span className="text-theme-accent-primary capitalize">
                    {status.currentSession.currentPhase || 'Initializing'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-theme-text-secondary">Loop Count:</span>
                  <span>{status.currentSession.loopCount}</span>
                </div>
                <button
                  onClick={() => setShowTheater(true)}
                  className="w-full flex items-center justify-center gap-2 mt-4 px-4 py-2 bg-theme-accent-primary/20 text-theme-accent-primary rounded-lg hover:bg-theme-accent-primary/30"
                >
                  <Eye className="w-4 h-4" />
                  Watch Council Deliberation
                </button>
              </div>
            )}

            {!isActive && (
              <p className="text-theme-text-secondary text-sm">
                Start autonomous mode to let Luna consult her council, set goals, and discover insights.
              </p>
            )}
          </div>

          {/* Council Members */}
          <div>
            <h3 className="text-sm font-medium text-theme-text-secondary mb-3">Luna's Council</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { name: 'Polaris', emoji: '?', role: 'The Anchor', color: '#4A90D9' },
                { name: 'Aurora', emoji: '?', role: 'The Intuitive', color: '#9B59B6' },
                { name: 'Vega', emoji: '?', role: 'The Skeptic', color: '#E74C3C' },
                { name: 'Sol', emoji: '?', role: 'The Driver', color: '#F39C12' },
              ].map((member) => (
                <div
                  key={member.name}
                  className="bg-theme-bg-tertiary rounded-lg p-3 border-l-2"
                  style={{ borderLeftColor: member.color }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{member.emoji}</span>
                    <div>
                      <div className="font-medium text-sm">{member.name}</div>
                      <div className="text-xs text-theme-text-muted">{member.role}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-theme-bg-tertiary rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-theme-accent-primary">
                {status?.todaySessionCount || 0}
              </div>
              <div className="text-xs text-theme-text-muted">Sessions Today</div>
            </div>
            <div className="bg-theme-bg-tertiary rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-400">
                {goals.filter(g => g.status === 'active').length}
              </div>
              <div className="text-xs text-theme-text-muted">Active Goals</div>
            </div>
            <div className="bg-theme-bg-tertiary rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-purple-400">
                {achievements.length}
              </div>
              <div className="text-xs text-theme-text-muted">Achievements</div>
            </div>
          </div>
        </div>
      )}

      {/* Goals Section */}
      {activeSection === 'goals' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">Goals</h3>
            <button
              onClick={() => setShowNewGoal(!showNewGoal)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-theme-accent-primary/20 text-theme-accent-primary rounded-lg hover:bg-theme-accent-primary/30"
            >
              <Plus className="w-4 h-4" />
              New Goal
            </button>
          </div>

          {showNewGoal && (
            <form onSubmit={handleCreateGoal} className="bg-theme-bg-tertiary rounded-lg p-4 space-y-3">
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Type</label>
                <select
                  value={newGoal.goalType}
                  onChange={(e) => setNewGoal({ ...newGoal, goalType: e.target.value })}
                  className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-sm"
                >
                  <option value="user_focused">User Focused</option>
                  <option value="self_improvement">Self Improvement</option>
                  <option value="relationship">Relationship</option>
                  <option value="research">Research</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Title</label>
                <input
                  type="text"
                  value={newGoal.title}
                  onChange={(e) => setNewGoal({ ...newGoal, title: e.target.value })}
                  placeholder="What do you want to achieve?"
                  className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Description (optional)</label>
                <textarea
                  value={newGoal.description}
                  onChange={(e) => setNewGoal({ ...newGoal, description: e.target.value })}
                  placeholder="Add more details..."
                  rows={2}
                  className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-sm resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 px-3 py-2 bg-theme-accent-primary text-white rounded-lg text-sm hover:bg-theme-accent-primary/80"
                >
                  Create Goal
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewGoal(false)}
                  className="px-3 py-2 bg-theme-bg-secondary rounded-lg text-sm hover:bg-theme-bg-tertiary"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="space-y-2">
            {goals.length === 0 ? (
              <div className="text-center py-8 text-theme-text-muted">
                <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No goals yet. Create one to get started!</p>
              </div>
            ) : (
              goals.map((goal) => {
                const typeConfig = goalTypeConfig[goal.goalType];
                return (
                  <div
                    key={goal.id}
                    className={`bg-theme-bg-tertiary rounded-lg p-4 ${
                      goal.status === 'completed' ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs px-2 py-0.5 rounded ${typeConfig.bg} ${typeConfig.color}`}>
                            {typeConfig.label}
                          </span>
                          {goal.status === 'completed' && (
                            <span className="text-xs px-2 py-0.5 rounded bg-green-400/10 text-green-400">
                              Completed
                            </span>
                          )}
                        </div>
                        <h4 className="font-medium">{goal.title}</h4>
                        {goal.description && (
                          <p className="text-sm text-theme-text-secondary mt-1">{goal.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {goal.status === 'active' && (
                          <button
                            onClick={() => handleCompleteGoal(goal.id)}
                            className="p-1.5 text-green-400 hover:bg-green-400/10 rounded"
                            title="Mark complete"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteGoal(goal.id)}
                          className="p-1.5 text-red-400 hover:bg-red-400/10 rounded"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Journal Section */}
      {activeSection === 'journal' && (
        <div className="space-y-4">
          <h3 className="font-medium">Achievement Journal</h3>
          {achievements.length === 0 ? (
            <div className="text-center py-8 text-theme-text-muted">
              <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No achievements yet. Complete goals to earn them!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {achievements.map((achievement) => (
                <div key={achievement.id} className="bg-theme-bg-tertiary rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">
                      {achievement.achievementType === 'goal_completed' ? '?' :
                       achievement.achievementType === 'milestone' ? '?' :
                       achievement.achievementType === 'discovery' ? '?' :
                       achievement.achievementType === 'insight' ? '?' : '?'}
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium">{achievement.title}</h4>
                      {achievement.journalEntry && (
                        <p className="text-sm text-theme-text-secondary mt-1 italic">
                          "{achievement.journalEntry}"
                        </p>
                      )}
                      <div className="text-xs text-theme-text-muted mt-2">
                        {new Date(achievement.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* RSS Section */}
      {activeSection === 'rss' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">RSS Feeds</h3>
            <div className="flex gap-2">
              <button
                onClick={handleFetchFeeds}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-theme-bg-tertiary rounded-lg hover:bg-theme-bg-secondary"
              >
                <RefreshCw className="w-4 h-4" />
                Fetch
              </button>
              <button
                onClick={() => setShowNewFeed(!showNewFeed)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-theme-accent-primary/20 text-theme-accent-primary rounded-lg hover:bg-theme-accent-primary/30"
              >
                <Plus className="w-4 h-4" />
                Add Feed
              </button>
            </div>
          </div>

          {showNewFeed && (
            <form onSubmit={handleAddFeed} className="bg-theme-bg-tertiary rounded-lg p-4 space-y-3">
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Feed URL</label>
                <input
                  type="url"
                  value={newFeed.url}
                  onChange={(e) => setNewFeed({ ...newFeed, url: e.target.value })}
                  placeholder="https://example.com/rss"
                  className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Category</label>
                <select
                  value={newFeed.category}
                  onChange={(e) => setNewFeed({ ...newFeed, category: e.target.value })}
                  className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-sm"
                >
                  <option value="tech">Technology</option>
                  <option value="science">Science</option>
                  <option value="news">News</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 px-3 py-2 bg-theme-accent-primary text-white rounded-lg text-sm hover:bg-theme-accent-primary/80"
                >
                  Add Feed
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewFeed(false)}
                  className="px-3 py-2 bg-theme-bg-secondary rounded-lg text-sm hover:bg-theme-bg-tertiary"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {feeds.length === 0 ? (
            <div className="text-center py-8 text-theme-text-muted">
              <Rss className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="mb-3">No RSS feeds configured.</p>
              <button
                onClick={handleAddDefaultFeeds}
                className="px-4 py-2 bg-theme-accent-primary/20 text-theme-accent-primary rounded-lg text-sm hover:bg-theme-accent-primary/30"
              >
                Add Default Tech & Science Feeds
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {feeds.map((feed) => (
                <div key={feed.id} className="bg-theme-bg-tertiary rounded-lg p-3 flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{feed.title || feed.url}</div>
                    <div className="text-xs text-theme-text-muted truncate">{feed.url}</div>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      feed.category === 'tech' ? 'bg-blue-400/10 text-blue-400' :
                      feed.category === 'science' ? 'bg-green-400/10 text-green-400' :
                      'bg-gray-400/10 text-gray-400'
                    }`}>
                      {feed.category || 'custom'}
                    </span>
                    <button
                      onClick={() => handleDeleteFeed(feed.id)}
                      className="p-1.5 text-red-400 hover:bg-red-400/10 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Insights Section */}
      {activeSection === 'insights' && (
        <div className="space-y-4">
          <h3 className="font-medium">Pending Insights</h3>
          {insights.length === 0 ? (
            <div className="text-center py-8 text-theme-text-muted">
              <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No pending insights. Luna will share discoveries here!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {insights.map((insight) => (
                <div key={insight.id} className="bg-theme-bg-tertiary rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          insight.sourceType === 'council_deliberation' ? 'bg-purple-400/10 text-purple-400' :
                          insight.sourceType === 'rss_article' ? 'bg-blue-400/10 text-blue-400' :
                          insight.sourceType === 'goal_progress' ? 'bg-green-400/10 text-green-400' :
                          'bg-yellow-400/10 text-yellow-400'
                        }`}>
                          {insight.sourceType.replace('_', ' ')}
                        </span>
                        {insight.priority >= 7 && (
                          <span className="text-xs px-2 py-0.5 rounded bg-red-400/10 text-red-400">
                            High Priority
                          </span>
                        )}
                      </div>
                      <h4 className="font-medium">{insight.insightTitle}</h4>
                      <p className="text-sm text-theme-text-secondary mt-1">{insight.insightContent}</p>
                    </div>
                    <button
                      onClick={() => handleDismissInsight(insight.id)}
                      className="p-1.5 text-theme-text-muted hover:text-theme-text-secondary hover:bg-theme-bg-secondary rounded"
                      title="Dismiss"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
