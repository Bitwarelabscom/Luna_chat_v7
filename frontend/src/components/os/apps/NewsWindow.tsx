'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Newspaper, Search, RefreshCw, ExternalLink,
  Clock, Shield, Settings, X, ChevronDown
} from 'lucide-react';
import { autonomousApi, type NewsArticle, type NewsClaim, type NewsCategoryInfo, type AlertThreshold } from '@/lib/api';
import { cn } from '@/lib/utils';

type ViewMode = 'articles' | 'claims';

const CATEGORY_COLORS: Record<string, string> = {
  conflicts: '#ef4444',
  tech: '#3b82f6',
  good_news: '#22c55e',
  politics: '#a855f7',
  science: '#06b6d4',
  finance: '#eab308',
  health: '#ec4899',
  environment: '#10b981',
  security: '#f97316',
  other: '#6b7280',
};

const CATEGORY_LABELS: Record<string, string> = {
  conflicts: 'Conflicts',
  tech: 'Tech',
  good_news: 'Good News',
  politics: 'Politics',
  science: 'Science',
  finance: 'Finance',
  health: 'Health',
  environment: 'Environment',
  security: 'Security',
  other: 'Other',
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  P1: { bg: 'bg-red-500/20', text: 'text-red-400' },
  P2: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  P3: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  P4: { bg: 'bg-white/10', text: 'text-white/50' },
};

const VERIFICATION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Verified': { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  'Likely': { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30' },
  'Unconfirmed': { bg: 'bg-yellow-500/15', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  'Conflicted': { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/30' },
  'False/Retraction': { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30' },
};

export default function NewsWindow() {
  const [viewMode, setViewMode] = useState<ViewMode>('articles');
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [claims, setClaims] = useState<NewsClaim[]>([]);
  const [categories, setCategories] = useState<NewsCategoryInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [thresholds, setThresholds] = useState<AlertThreshold[]>([]);

  const fetchArticles = useCallback(async () => {
    try {
      const res = await autonomousApi.getNewsArticles({
        q: searchQuery || undefined,
        category: categoryFilter !== 'all' ? categoryFilter : undefined,
        priority: priorityFilter !== 'all' ? priorityFilter : undefined,
        limit: 100,
      });
      // API returns array directly now
      const list = Array.isArray(res) ? res : (res as any).articles || [];
      setArticles(list);
    } catch (error) {
      console.error('Failed to fetch articles:', error);
    }
  }, [searchQuery, categoryFilter, priorityFilter]);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await autonomousApi.getNewsCategories();
      const list = Array.isArray(res) ? res : [];
      setCategories(list);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  }, []);

  const fetchClaims = useCallback(async () => {
    try {
      const res = await autonomousApi.getNewsClaims({ limit: 100 });
      setClaims(res.claims || []);
    } catch (error) {
      console.error('Failed to fetch claims:', error);
    }
  }, []);

  const fetchThresholds = useCallback(async () => {
    try {
      const res = await autonomousApi.getAlertThresholds();
      const list = Array.isArray(res) ? res : [];
      setThresholds(list);
    } catch (error) {
      console.error('Failed to fetch thresholds:', error);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      await Promise.all([fetchArticles(), fetchCategories(), fetchClaims()]);
    } finally {
      setIsLoading(false);
    }
  }, [fetchArticles, fetchCategories, fetchClaims]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchArticles();
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, categoryFilter, priorityFilter, fetchArticles]);

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncStatus('Syncing...');
    try {
      const res = await autonomousApi.syncNews();
      setSyncStatus(`Synced ${res.synced}, enriched ${res.enriched}, ${res.alerts} alerts`);
      await Promise.all([fetchArticles(), fetchCategories()]);
      setTimeout(() => setSyncStatus(null), 4000);
    } catch {
      setSyncStatus('Sync failed');
      setTimeout(() => setSyncStatus(null), 3000);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSaveThresholds = async (updated: AlertThreshold[]) => {
    try {
      await autonomousApi.setAlertThresholds(updated);
      setThresholds(updated);
    } catch (error) {
      console.error('Failed to save thresholds:', error);
    }
  };

  const totalArticles = categories.reduce((sum, c) => sum + c.count, 0);

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Category tab bar */}
      <div
        className="flex items-center gap-1 px-3 py-2 border-b overflow-x-auto custom-scrollbar"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        {/* View mode toggle */}
        <div className="flex items-center gap-1 mr-2 pr-2 border-r" style={{ borderColor: 'var(--theme-border)' }}>
          <button
            onClick={() => setViewMode('articles')}
            className={cn(
              "px-2 py-1 rounded text-[11px] font-medium transition",
              viewMode === 'articles' ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"
            )}
          >
            Articles
          </button>
          <button
            onClick={() => setViewMode('claims')}
            className={cn(
              "px-2 py-1 rounded text-[11px] font-medium transition",
              viewMode === 'claims' ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"
            )}
          >
            Claims
          </button>
        </div>

        {viewMode === 'articles' && (
          <>
            {/* All tab */}
            <button
              onClick={() => setCategoryFilter('all')}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition whitespace-nowrap",
                categoryFilter === 'all'
                  ? "bg-white/15 text-white"
                  : "text-white/40 hover:text-white/70 hover:bg-white/5"
              )}
            >
              All
              <span className="text-[10px] opacity-60 font-mono">{totalArticles}</span>
            </button>

            {/* Category tabs */}
            {categories.filter(c => c.count > 0).map(cat => (
              <button
                key={cat.id}
                onClick={() => setCategoryFilter(cat.id)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition whitespace-nowrap",
                  categoryFilter === cat.id
                    ? "text-white"
                    : "text-white/40 hover:text-white/70 hover:bg-white/5"
                )}
                style={categoryFilter === cat.id ? {
                  backgroundColor: `${CATEGORY_COLORS[cat.id]}30`,
                  color: CATEGORY_COLORS[cat.id],
                } : undefined}
              >
                {cat.label}
                <span className="text-[10px] opacity-60 font-mono">{cat.count}</span>
              </button>
            ))}
          </>
        )}
      </div>

      {/* Sub-toolbar */}
      <div className="h-10 border-b flex items-center px-3 gap-2" style={{ borderColor: 'var(--theme-border)' }}>
        {viewMode === 'articles' && (
          <>
            <div className="flex-1 relative max-w-sm">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 opacity-30" />
              <input
                type="text"
                placeholder="Search articles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-7 pr-3 py-1 rounded text-[12px] bg-white/5 border border-white/10 focus:outline-none focus:border-white/20"
                style={{ color: 'var(--theme-text-primary)' }}
              />
            </div>

            {/* Priority filter */}
            <div className="relative">
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="appearance-none pl-2 pr-6 py-1 rounded text-[11px] bg-white/5 border border-white/10 focus:outline-none cursor-pointer"
                style={{ color: 'var(--theme-text-secondary)' }}
              >
                <option value="all">All Priorities</option>
                <option value="P1">P1 - Breaking</option>
                <option value="P2">P2 - Important</option>
                <option value="P3">P3 - Noteworthy</option>
                <option value="P4">P4 - Background</option>
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 opacity-30 pointer-events-none" />
            </div>
          </>
        )}
        {viewMode === 'claims' && <div className="flex-1" />}

        <div className="ml-auto flex items-center gap-2">
          {syncStatus && (
            <span className="text-[10px] text-emerald-400 font-medium">{syncStatus}</span>
          )}

          <button
            onClick={handleSync}
            disabled={isSyncing}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition",
              isSyncing
                ? "bg-blue-500/20 text-blue-400"
                : "hover:bg-white/5 text-white/40 hover:text-white/70"
            )}
            title="Sync, enrich, and check alerts"
          >
            <RefreshCw className={cn("w-3 h-3", isSyncing && "animate-spin")} />
            Sync
          </button>

          <button
            onClick={() => { setShowSettings(true); fetchThresholds(); }}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium hover:bg-white/5 text-white/40 hover:text-white/70 transition"
            title="Alert settings"
          >
            <Settings className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {isLoading ? (
          <div className="h-full flex flex-col items-center justify-center opacity-30">
            <RefreshCw className="w-8 h-8 animate-spin mb-2" />
            <p className="text-sm">Loading news...</p>
          </div>
        ) : viewMode === 'claims' ? (
          claims.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-30">
              <Shield className="w-12 h-12 mb-4" />
              <p className="text-sm">No claims found.</p>
            </div>
          ) : (
            <div className="space-y-3 max-w-4xl mx-auto">
              {claims.map(claim => (
                <ClaimCard key={claim.id} claim={claim} />
              ))}
            </div>
          )
        ) : articles.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-30">
            <Newspaper className="w-12 h-12 mb-4" />
            <p className="text-sm">No articles found.</p>
            <p className="text-xs mt-1">Click Sync to fetch and classify articles.</p>
          </div>
        ) : (
          <div className="space-y-2 max-w-4xl mx-auto">
            {articles.map(article => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        )}
      </div>

      {/* Settings slide-out */}
      {showSettings && (
        <AlertSettingsPanel
          thresholds={thresholds}
          onSave={handleSaveThresholds}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function ArticleCard({ article }: { article: NewsArticle }) {
  const categoryColor = article.category ? CATEGORY_COLORS[article.category] : '#6b7280';
  const categoryLabel = article.category ? CATEGORY_LABELS[article.category] : null;
  const priorityStyle = article.priority ? PRIORITY_STYLES[article.priority] : null;

  return (
    <div
      className="group p-3 rounded-lg border transition-all duration-200 bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Badges row */}
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            {/* Priority badge */}
            {priorityStyle && article.priority && (
              <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold tracking-tight", priorityStyle.bg, priorityStyle.text)}>
                {article.priority}
              </span>
            )}
            {/* Category badge */}
            {categoryLabel && (
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight"
                style={{
                  backgroundColor: `${categoryColor}20`,
                  color: categoryColor,
                }}
              >
                {categoryLabel}
              </span>
            )}
            {/* Source */}
            <span className="text-[10px] opacity-35 font-medium">{article.sourceName}</span>
            {/* Date */}
            <span className="text-[10px] opacity-25 flex items-center gap-0.5 ml-auto">
              <Clock className="w-3 h-3" />
              {article.publishedAt
                ? new Date(article.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : 'Unknown'
              }
            </span>
          </div>

          {/* Title */}
          <h3 className="text-[13px] font-semibold leading-tight group-hover:text-blue-400 transition-colors" style={{ color: 'var(--theme-text-primary)' }}>
            {article.title}
          </h3>

          {/* Reason */}
          {article.priorityReason && (
            <p className="text-[11px] opacity-45 mt-1 leading-relaxed">{article.priorityReason}</p>
          )}
        </div>

        {article.url && (
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-white/30 hover:text-white/70 transition flex-shrink-0 mt-1"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

function ClaimCard({ claim }: { claim: NewsClaim }) {
  const vColors = VERIFICATION_COLORS[claim.verificationStatus] || VERIFICATION_COLORS['Unconfirmed'];
  const bd = claim.scoreBreakdown;

  return (
    <div className="p-4 rounded-xl border bg-white/[0.02] border-white/[0.06]">
      <div className="flex items-start gap-3 mb-3">
        <Shield className={cn("w-5 h-5 mt-0.5 flex-shrink-0", vColors.text)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-tighter border", vColors.bg, vColors.text, vColors.border)}>
              {claim.verificationStatus}
            </span>
            <span className="text-[10px] font-mono opacity-40">{claim.confidenceScore}%</span>
          </div>
          <p className="text-sm leading-snug" style={{ color: 'var(--theme-text-primary)' }}>
            {claim.claimText}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2 mb-3">
        {[
          { label: 'Independence', value: bd.independencePoints, max: 30 },
          { label: 'Primary', value: bd.primaryPoints, max: 20 },
          { label: 'Recency', value: bd.recencyPoints, max: 15 },
          { label: 'Consistency', value: bd.consistencyPoints, max: 20 },
          { label: 'Trust', value: bd.trustPoints, max: 15 },
        ].map(({ label, value, max }) => (
          <div key={label} className="text-center">
            <div className="text-[10px] opacity-40 mb-1">{label}</div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500/70 transition-all"
                style={{ width: `${Math.min((value / max) * 100, 100)}%` }}
              />
            </div>
            <div className="text-[10px] font-mono opacity-50 mt-0.5">{value}/{max}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[11px] text-white/40">
        <div className="flex items-center gap-3">
          <span>{bd.independentSources} source{bd.independentSources !== 1 ? 's' : ''}</span>
          <span>{bd.primaryEvidenceCount} primary evidence</span>
        </div>
        <div className="flex items-center gap-2">
          {claim.publishedAt && (
            <span className="opacity-40">
              {new Date(claim.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
          {claim.articleUrl && (
            <a
              href={claim.articleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline truncate max-w-[200px]"
            >
              {claim.articleTitle}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

const ALL_CATEGORIES = [
  { id: 'conflicts', label: 'Conflicts/War' },
  { id: 'tech', label: 'Tech' },
  { id: 'good_news', label: 'Good News' },
  { id: 'politics', label: 'Politics' },
  { id: 'science', label: 'Science' },
  { id: 'finance', label: 'Finance' },
  { id: 'health', label: 'Health' },
  { id: 'environment', label: 'Environment' },
  { id: 'security', label: 'Security/Cyber' },
  { id: 'other', label: 'Other' },
];

function AlertSettingsPanel({
  thresholds,
  onSave,
  onClose,
}: {
  thresholds: AlertThreshold[];
  onSave: (t: AlertThreshold[]) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState<Record<string, { minPriority: string; deliveryMethod: string }>>({});

  useEffect(() => {
    const map: Record<string, { minPriority: string; deliveryMethod: string }> = {};
    for (const cat of ALL_CATEGORIES) {
      const existing = thresholds.find(t => t.category === cat.id);
      map[cat.id] = {
        minPriority: existing?.minPriority || 'P1',
        deliveryMethod: existing?.deliveryMethod || 'telegram',
      };
    }
    setLocal(map);
  }, [thresholds]);

  const handleSave = () => {
    const updated = Object.entries(local).map(([category, val]) => ({
      category,
      minPriority: val.minPriority,
      deliveryMethod: val.deliveryMethod,
    }));
    onSave(updated);
    onClose();
  };

  const applyPreset = (priority: string) => {
    const updated: Record<string, { minPriority: string; deliveryMethod: string }> = {};
    for (const cat of ALL_CATEGORIES) {
      updated[cat.id] = {
        minPriority: priority,
        deliveryMethod: local[cat.id]?.deliveryMethod || 'telegram',
      };
    }
    setLocal(updated);
  };

  return (
    <div className="absolute inset-y-0 right-0 w-80 border-l flex flex-col z-50" style={{ background: 'var(--theme-bg-secondary)', borderColor: 'var(--theme-border)' }}>
      <div className="flex items-center justify-between p-3 border-b" style={{ borderColor: 'var(--theme-border)' }}>
        <h3 className="text-sm font-bold" style={{ color: 'var(--theme-text-primary)' }}>Alert Settings</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/40">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Presets */}
      <div className="p-3 border-b flex gap-2" style={{ borderColor: 'var(--theme-border)' }}>
        <button onClick={() => applyPreset('P1')} className="flex-1 px-2 py-1 rounded text-[10px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition">
          Critical Only
        </button>
        <button onClick={() => applyPreset('P2')} className="flex-1 px-2 py-1 rounded text-[10px] font-medium bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition">
          Important
        </button>
        <button onClick={() => applyPreset('P4')} className="flex-1 px-2 py-1 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition">
          Everything
        </button>
      </div>

      {/* Per-category settings */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
        {ALL_CATEGORIES.map(cat => {
          const val = local[cat.id];
          if (!val) return null;
          const catColor = CATEGORY_COLORS[cat.id];

          return (
            <div key={cat.id} className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: catColor }}
              />
              <span className="text-[11px] font-medium flex-1 min-w-0 truncate" style={{ color: 'var(--theme-text-secondary)' }}>
                {cat.label}
              </span>
              <select
                value={val.minPriority}
                onChange={(e) => setLocal(prev => ({ ...prev, [cat.id]: { ...prev[cat.id], minPriority: e.target.value } }))}
                className="appearance-none px-1.5 py-0.5 rounded text-[10px] bg-white/5 border border-white/10 focus:outline-none w-16"
                style={{ color: 'var(--theme-text-secondary)' }}
              >
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
                <option value="P4">P4</option>
                <option value="off">Off</option>
              </select>
              <select
                value={val.deliveryMethod}
                onChange={(e) => setLocal(prev => ({ ...prev, [cat.id]: { ...prev[cat.id], deliveryMethod: e.target.value } }))}
                className="appearance-none px-1.5 py-0.5 rounded text-[10px] bg-white/5 border border-white/10 focus:outline-none w-20"
                style={{ color: 'var(--theme-text-secondary)' }}
              >
                <option value="telegram">Telegram</option>
                <option value="sse">SSE</option>
                <option value="chat">Chat</option>
              </select>
            </div>
          );
        })}
      </div>

      {/* Save */}
      <div className="p-3 border-t" style={{ borderColor: 'var(--theme-border)' }}>
        <button
          onClick={handleSave}
          className="w-full py-1.5 rounded text-[12px] font-medium bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition"
        >
          Save Thresholds
        </button>
      </div>
    </div>
  );
}
