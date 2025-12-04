'use client';

import { useState, useEffect, useRef } from 'react';
import { friendsApi, streamFriendDiscussion, FriendPersonality, FriendConversation, FriendDiscussionEvent } from '@/lib/api';
import { Users, MessageCircle, Plus, Edit2, Trash2, ChevronDown, ChevronUp, Sparkles, X, Theater, Loader2 } from 'lucide-react';

export default function FriendsTab() {
  const [friends, setFriends] = useState<FriendPersonality[]>([]);
  const [discussions, setDiscussions] = useState<FriendConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'friends' | 'discussions'>('friends');
  const [expandedDiscussion, setExpandedDiscussion] = useState<string | null>(null);
  const [editingFriend, setEditingFriend] = useState<FriendPersonality | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    personality: '',
    systemPrompt: '',
    avatarEmoji: '',
    color: '#808080',
  });

  // Theater mode state
  const [theaterMode, setTheaterMode] = useState(false);
  const [theaterMessages, setTheaterMessages] = useState<Array<{ speaker: string; message: string; timestamp: string }>>([]);
  const [theaterFriend, setTheaterFriend] = useState<{ name: string; avatarEmoji: string; color: string } | null>(null);
  const [theaterTopic, setTheaterTopic] = useState('');
  const [theaterStatus, setTheaterStatus] = useState<string>('');
  const [theaterRound, setTheaterRound] = useState(0);
  const [theaterTotalRounds, setTheaterTotalRounds] = useState(5);
  const [theaterSummary, setTheaterSummary] = useState<string | null>(null);
  const [theaterFacts, setTheaterFacts] = useState<string[]>([]);
  const [theaterComplete, setTheaterComplete] = useState(false);
  const theaterEndRef = useRef<HTMLDivElement>(null);

  // Topic input state
  const [discussionTopic, setDiscussionTopic] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (theaterEndRef.current) {
      theaterEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [theaterMessages, theaterStatus]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [friendsRes, discussionsRes] = await Promise.all([
        friendsApi.getFriends(),
        friendsApi.getDiscussions(20),
      ]);
      setFriends(friendsRes.friends);
      setDiscussions(discussionsRes.discussions);
    } catch (err) {
      console.error('Failed to load friends data:', err);
      setError('Failed to load friends data');
    } finally {
      setLoading(false);
    }
  };

  const startTheaterDiscussion = async (friendId?: string) => {
    const topic = discussionTopic.trim() || undefined;

    // Reset theater state
    setTheaterMode(true);
    setTheaterMessages([]);
    setTheaterFriend(null);
    setTheaterTopic('');
    setTheaterStatus(topic ? 'Starting discussion...' : 'Finding an interesting topic...');
    setTheaterRound(0);
    setTheaterTotalRounds(5);
    setTheaterSummary(null);
    setTheaterFacts([]);
    setTheaterComplete(false);
    setError(null);
    setDiscussionTopic('');

    try {
      for await (const event of streamFriendDiscussion({ friendId, topic })) {
        handleTheaterEvent(event);
      }
    } catch (err) {
      console.error('Theater discussion error:', err);
      setError(err instanceof Error ? err.message : 'Discussion failed');
      setTheaterStatus('Error occurred');
    }
  };

  const handleTheaterEvent = (event: FriendDiscussionEvent) => {
    switch (event.type) {
      case 'start':
        setTheaterFriend(event.friend || null);
        setTheaterTopic(event.topic || '');
        setTheaterTotalRounds(event.totalRounds || 5);
        setTheaterStatus(`Starting discussion with ${event.friend?.name}...`);
        break;
      case 'message':
        if (event.message) {
          setTheaterMessages(prev => [...prev, event.message!]);
          setTheaterStatus(`Round ${event.round || 0} of ${event.totalRounds || 5}`);
        }
        break;
      case 'round_complete':
        setTheaterRound(event.round || 0);
        break;
      case 'generating_summary':
        setTheaterStatus('Generating summary...');
        break;
      case 'summary':
        setTheaterSummary(event.summary || null);
        break;
      case 'extracting_facts':
        setTheaterStatus('Extracting insights...');
        break;
      case 'facts':
        setTheaterFacts(event.facts || []);
        break;
      case 'complete':
        setTheaterStatus('Complete!');
        setTheaterComplete(true);
        // Reload discussions to include the new one
        loadData();
        break;
      case 'error':
        setError(event.error || 'Unknown error');
        setTheaterStatus('Error');
        break;
    }
  };

  const handleDeleteDiscussion = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this discussion?')) return;
    try {
      await friendsApi.deleteDiscussion(id);
      setDiscussions(prev => prev.filter(d => d.id !== id));
      if (expandedDiscussion === id) setExpandedDiscussion(null);
    } catch (err) {
      console.error('Failed to delete discussion:', err);
      setError('Failed to delete discussion');
    }
  };

  const handleCreateFriend = async () => {
    if (!formData.name || !formData.personality || !formData.systemPrompt) {
      setError('Name, personality, and system prompt are required');
      return;
    }
    try {
      const result = await friendsApi.createFriend(formData);
      setFriends(prev => [...prev, result.friend]);
      setShowCreateForm(false);
      setFormData({ name: '', personality: '', systemPrompt: '', avatarEmoji: '', color: '#808080' });
    } catch (err) {
      console.error('Failed to create friend:', err);
      setError('Failed to create friend');
    }
  };

  const handleUpdateFriend = async () => {
    if (!editingFriend) return;
    try {
      const result = await friendsApi.updateFriend(editingFriend.id, formData);
      setFriends(prev => prev.map(f => f.id === editingFriend.id ? result.friend : f));
      setEditingFriend(null);
      setFormData({ name: '', personality: '', systemPrompt: '', avatarEmoji: '', color: '#808080' });
    } catch (err) {
      console.error('Failed to update friend:', err);
      setError('Failed to update friend');
    }
  };

  const handleDeleteFriend = async (id: string) => {
    if (!confirm('Delete this friend?')) return;
    try {
      await friendsApi.deleteFriend(id);
      setFriends(prev => prev.filter(f => f.id !== id));
    } catch (err) {
      console.error('Failed to delete friend:', err);
      setError('Failed to delete friend (cannot delete default friends)');
    }
  };

  const startEditing = (friend: FriendPersonality) => {
    setEditingFriend(friend);
    setFormData({
      name: friend.name,
      personality: friend.personality,
      systemPrompt: friend.systemPrompt,
      avatarEmoji: friend.avatarEmoji,
      color: friend.color,
    });
  };

  const getFriendById = (id: string) => friends.find(f => f.id === id);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-theme-accent-primary"></div>
      </div>
    );
  }

  // Theater Mode UI
  if (theaterMode) {
    return (
      <div className="fixed inset-0 bg-black/95 z-50 flex flex-col">
        {/* Theater Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <Theater className="w-6 h-6 text-purple-400" />
            <div>
              <h2 className="text-lg font-semibold text-white">Friend Discussion</h2>
              {theaterTopic && <p className="text-sm text-gray-400">{theaterTopic}</p>}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-400">
              {theaterStatus}
              {!theaterComplete && <Loader2 className="w-4 h-4 inline ml-2 animate-spin" />}
            </div>
            <button
              onClick={() => setTheaterMode(false)}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="h-1 bg-gray-800">
          <div
            className="h-full bg-purple-500 transition-all duration-500"
            style={{ width: `${(theaterRound / theaterTotalRounds) * 100}%` }}
          />
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {theaterMessages.map((msg, i) => {
            const isLuna = msg.speaker === 'luna';
            return (
              <div
                key={i}
                className={`flex gap-4 ${isLuna ? '' : 'flex-row-reverse'} animate-fadeIn`}
              >
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-2xl flex-shrink-0 shadow-lg"
                  style={{
                    backgroundColor: isLuna ? '#9333ea30' : `${theaterFriend?.color || '#808080'}30`,
                    border: `2px solid ${isLuna ? '#9333ea' : theaterFriend?.color || '#808080'}`,
                  }}
                >
                  {isLuna ? '🌙' : theaterFriend?.avatarEmoji || '🤖'}
                </div>
                <div className={`max-w-2xl ${isLuna ? '' : 'text-right'}`}>
                  <div className={`text-sm font-medium mb-1 ${isLuna ? 'text-purple-400' : 'text-gray-300'}`}>
                    {isLuna ? 'Luna' : theaterFriend?.name || 'Friend'}
                  </div>
                  <div
                    className={`p-4 rounded-2xl ${
                      isLuna
                        ? 'bg-purple-900/40 border border-purple-500/30 text-purple-100'
                        : 'bg-gray-800 border border-gray-700 text-gray-100'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.message}</p>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Summary & Facts */}
          {theaterComplete && (
            <div className="space-y-4 mt-8 animate-fadeIn">
              {theaterSummary && (
                <div className="bg-purple-900/20 border border-purple-500/30 rounded-xl p-6">
                  <h3 className="text-lg font-semibold text-purple-400 mb-3">Summary</h3>
                  <p className="text-gray-200">{theaterSummary}</p>
                </div>
              )}

              {theaterFacts.length > 0 && (
                <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-6">
                  <h3 className="text-lg font-semibold text-green-400 mb-3">Insights Extracted</h3>
                  <ul className="space-y-2">
                    {theaterFacts.map((fact, i) => (
                      <li key={i} className="flex items-start gap-2 text-gray-200">
                        <Sparkles className="w-4 h-4 text-green-400 mt-1 flex-shrink-0" />
                        {fact}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="text-center pt-4">
                <button
                  onClick={() => setTheaterMode(false)}
                  className="px-6 py-3 bg-purple-600 hover:bg-purple-500 rounded-xl font-medium text-white transition"
                >
                  Close Theater Mode
                </button>
              </div>
            </div>
          )}

          <div ref={theaterEndRef} />
        </div>

        <style jsx>{`
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .animate-fadeIn {
            animation: fadeIn 0.5s ease-out;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-theme-accent-primary" />
          <h2 className="text-lg font-semibold text-theme-text-primary">Luna&apos;s Friends</h2>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={discussionTopic}
            onChange={(e) => setDiscussionTopic(e.target.value)}
            placeholder="Topic (optional)..."
            className="px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-sm text-theme-text-primary placeholder:text-theme-text-muted w-48"
            onKeyDown={(e) => e.key === 'Enter' && startTheaterDiscussion()}
          />
          <button
            onClick={() => startTheaterDiscussion()}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium text-white transition"
          >
            <Theater className="w-4 h-4" />
            Start Discussion
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 rounded-lg text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-300 hover:text-red-200">
            <X className="w-4 h-4 inline" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-theme-border pb-2">
        <button
          onClick={() => setActiveView('friends')}
          className={`px-4 py-2 rounded-t-lg text-sm font-medium transition ${
            activeView === 'friends'
              ? 'bg-theme-accent-primary/20 text-theme-accent-primary border-b-2 border-theme-accent-primary'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <Users className="w-4 h-4 inline mr-2" />
          Friends ({friends.length})
        </button>
        <button
          onClick={() => setActiveView('discussions')}
          className={`px-4 py-2 rounded-t-lg text-sm font-medium transition ${
            activeView === 'discussions'
              ? 'bg-theme-accent-primary/20 text-theme-accent-primary border-b-2 border-theme-accent-primary'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <MessageCircle className="w-4 h-4 inline mr-2" />
          Discussions ({discussions.length})
        </button>
      </div>

      {/* Friends View */}
      {activeView === 'friends' && (
        <div className="space-y-4">
          {/* Create Friend Button */}
          {!showCreateForm && !editingFriend && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="w-full py-3 border-2 border-dashed border-theme-border rounded-lg text-theme-text-muted hover:border-theme-accent-primary hover:text-theme-accent-primary transition flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Create Custom Friend
            </button>
          )}

          {/* Create/Edit Form */}
          {(showCreateForm || editingFriend) && (
            <div className="bg-theme-bg-secondary rounded-lg p-4 space-y-4 border border-theme-border">
              <div className="flex justify-between items-center">
                <h3 className="font-medium text-theme-text-primary">
                  {editingFriend ? 'Edit Friend' : 'Create New Friend'}
                </h3>
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setEditingFriend(null);
                    setFormData({ name: '', personality: '', systemPrompt: '', avatarEmoji: '', color: '#808080' });
                  }}
                  className="text-theme-text-muted hover:text-theme-text-primary"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-theme-text-muted mb-1">Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-theme-text-primary text-sm"
                    placeholder="Friend name"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-sm text-theme-text-muted mb-1">Emoji</label>
                    <input
                      type="text"
                      value={formData.avatarEmoji}
                      onChange={e => setFormData(prev => ({ ...prev, avatarEmoji: e.target.value }))}
                      className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-theme-text-primary text-sm"
                      placeholder="Emoji"
                      maxLength={4}
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-theme-text-muted mb-1">Color</label>
                    <input
                      type="color"
                      value={formData.color}
                      onChange={e => setFormData(prev => ({ ...prev, color: e.target.value }))}
                      className="w-12 h-10 rounded border border-theme-border cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm text-theme-text-muted mb-1">Personality (short description)</label>
                <input
                  type="text"
                  value={formData.personality}
                  onChange={e => setFormData(prev => ({ ...prev, personality: e.target.value }))}
                  className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-theme-text-primary text-sm"
                  placeholder="e.g., Curious intellectual who loves exploring ideas"
                />
              </div>

              <div>
                <label className="block text-sm text-theme-text-muted mb-1">System Prompt</label>
                <textarea
                  value={formData.systemPrompt}
                  onChange={e => setFormData(prev => ({ ...prev, systemPrompt: e.target.value }))}
                  className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-theme-text-primary text-sm h-32 resize-none"
                  placeholder="Instructions for how this friend should behave and respond..."
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setEditingFriend(null);
                    setFormData({ name: '', personality: '', systemPrompt: '', avatarEmoji: '', color: '#808080' });
                  }}
                  className="px-4 py-2 text-theme-text-muted hover:text-theme-text-primary text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={editingFriend ? handleUpdateFriend : handleCreateFriend}
                  className="px-4 py-2 bg-theme-accent-primary hover:bg-theme-accent-hover rounded-lg text-sm font-medium"
                >
                  {editingFriend ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          )}

          {/* Friends List */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {friends.map(friend => (
              <div
                key={friend.id}
                className="bg-theme-bg-secondary rounded-lg p-4 border border-theme-border hover:border-theme-accent-primary/50 transition"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-2xl"
                      style={{ backgroundColor: `${friend.color}20`, border: `2px solid ${friend.color}` }}
                    >
                      {friend.avatarEmoji || '🤖'}
                    </div>
                    <div>
                      <h3 className="font-medium text-theme-text-primary flex items-center gap-2">
                        {friend.name}
                        {friend.isDefault && (
                          <span className="text-xs px-2 py-0.5 bg-theme-accent-primary/20 text-theme-accent-primary rounded">
                            Default
                          </span>
                        )}
                      </h3>
                      <p className="text-sm text-theme-text-muted">{friend.personality}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => startTheaterDiscussion(friend.id)}
                      className="p-2 text-theme-text-muted hover:text-purple-400 hover:bg-purple-400/10 rounded transition"
                      title="Start theater discussion with this friend"
                    >
                      <Theater className="w-4 h-4" />
                    </button>
                    {!friend.isDefault && (
                      <>
                        <button
                          onClick={() => startEditing(friend)}
                          className="p-2 text-theme-text-muted hover:text-theme-accent-primary hover:bg-theme-accent-primary/10 rounded transition"
                          title="Edit friend"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteFriend(friend.id)}
                          className="p-2 text-theme-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition"
                          title="Delete friend"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Show system prompt preview */}
                <div className="mt-3 p-2 bg-theme-bg-primary rounded text-xs text-theme-text-muted max-h-20 overflow-hidden">
                  {friend.systemPrompt.substring(0, 150)}...
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Discussions View */}
      {activeView === 'discussions' && (
        <div className="space-y-4">
          {discussions.length === 0 ? (
            <div className="text-center py-12 text-theme-text-muted">
              <MessageCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No discussions yet</p>
              <p className="text-sm mt-2">Start a discussion to see Luna chat with her friends!</p>
            </div>
          ) : (
            discussions.map(discussion => {
              const friend = getFriendById(discussion.friendId);
              const isExpanded = expandedDiscussion === discussion.id;

              return (
                <div
                  key={discussion.id}
                  className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden"
                >
                  {/* Discussion Header */}
                  <button
                    onClick={() => setExpandedDiscussion(isExpanded ? null : discussion.id)}
                    className="w-full p-4 flex items-center justify-between hover:bg-theme-bg-primary/50 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-xl"
                        style={{
                          backgroundColor: friend ? `${friend.color}20` : '#80808020',
                          border: `2px solid ${friend?.color || '#808080'}`,
                        }}
                      >
                        {friend?.avatarEmoji || '🤖'}
                      </div>
                      <div className="text-left">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-theme-text-primary">
                            Luna & {friend?.name || 'Friend'}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            discussion.triggerType === 'pattern' ? 'bg-purple-400/20 text-purple-400' :
                            discussion.triggerType === 'interest' ? 'bg-blue-400/20 text-blue-400' :
                            discussion.triggerType === 'fact' ? 'bg-green-400/20 text-green-400' :
                            'bg-gray-400/20 text-gray-400'
                          }`}>
                            {discussion.triggerType}
                          </span>
                        </div>
                        <p className="text-sm text-theme-text-muted truncate max-w-md">
                          {discussion.topic}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <button
                        onClick={(e) => handleDeleteDiscussion(discussion.id, e)}
                        className="p-2 text-theme-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition"
                        title="Delete discussion"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <span className="text-xs text-theme-text-muted">
                        {discussion.roundCount} rounds
                      </span>
                      <span className="text-xs text-theme-text-muted">
                        {new Date(discussion.createdAt).toLocaleDateString()}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-theme-text-muted" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-theme-text-muted" />
                      )}
                    </div>
                  </button>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div className="border-t border-theme-border">
                      {/* Summary */}
                      {discussion.summary && (
                        <div className="p-4 bg-theme-accent-primary/5 border-b border-theme-border">
                          <h4 className="text-sm font-medium text-theme-accent-primary mb-1">Summary</h4>
                          <p className="text-sm text-theme-text-primary">{discussion.summary}</p>
                        </div>
                      )}

                      {/* Facts Extracted */}
                      {discussion.factsExtracted.length > 0 && (
                        <div className="p-4 bg-green-400/5 border-b border-theme-border">
                          <h4 className="text-sm font-medium text-green-400 mb-2">Insights Extracted</h4>
                          <ul className="space-y-1">
                            {discussion.factsExtracted.map((fact, i) => (
                              <li key={i} className="text-sm text-theme-text-primary flex items-start gap-2">
                                <Sparkles className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                                {fact}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Conversation */}
                      <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
                        {discussion.messages.map((msg, i) => {
                          const isLuna = msg.speaker === 'luna';
                          return (
                            <div
                              key={i}
                              className={`flex gap-3 ${isLuna ? '' : 'flex-row-reverse'}`}
                            >
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0"
                                style={{
                                  backgroundColor: isLuna ? '#9333ea20' : `${friend?.color || '#808080'}20`,
                                  border: `2px solid ${isLuna ? '#9333ea' : friend?.color || '#808080'}`,
                                }}
                              >
                                {isLuna ? '🌙' : friend?.avatarEmoji || '🤖'}
                              </div>
                              <div
                                className={`flex-1 p-3 rounded-lg ${
                                  isLuna
                                    ? 'bg-purple-500/10 border border-purple-500/30'
                                    : 'bg-theme-bg-primary border border-theme-border'
                                }`}
                              >
                                <div className="text-xs text-theme-text-muted mb-1">
                                  {isLuna ? 'Luna' : friend?.name || 'Friend'}
                                </div>
                                <p className="text-sm text-theme-text-primary whitespace-pre-wrap">
                                  {msg.message}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
