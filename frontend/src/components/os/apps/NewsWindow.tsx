'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Newspaper, Search, RefreshCw, ExternalLink,
  Clock, Tag, Shield, Zap, BarChart3, Download, Sparkles
} from 'lucide-react';
import { autonomousApi, type NewsArticle, type NewsClaim } from '@/lib/api';
import { cn } from '@/lib/utils';

type ViewMode = 'signals' | 'all' | 'claims';

const VERIFICATION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Verified': { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  'Likely': { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30' },
  'Unconfirmed': { bg: 'bg-yellow-500/15', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  'Conflicted': { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/30' },
  'False/Retraction': { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30' },
};

const SIGNAL_COLORS: Record<string, string> = {
  high: 'bg-emerald-500 text-white',
  medium: 'bg-blue-500/80 text-white',
  low: 'bg-white/10 text-white/50',
};

export default function NewsWindow() {
  const [viewMode, setViewMode] = useState<ViewMode>('signals');
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [claims, setClaims] = useState<NewsClaim[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [isIngesting, setIsIngesting] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<string | null>(null);

  const fetchArticles = useCallback(async () => {
    try {
      const res = await autonomousApi.getNewsArticles({
        q: searchQuery || undefined,
        status: statusFilter || undefined,
        limit: 100,
      });
      setArticles(res.articles);
    } catch (error) {
      console.error('Failed to fetch articles:', error);
    }
  }, [searchQuery, statusFilter]);

  const fetchClaims = useCallback(async () => {
    try {
      const res = await autonomousApi.getNewsClaims({ limit: 100 });
      setClaims(res.claims);
    } catch (error) {
      console.error('Failed to fetch claims:', error);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      await Promise.all([fetchArticles(), fetchClaims()]);
    } finally {
      setIsLoading(false);
    }
  }, [fetchArticles, fetchClaims]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Debounced search - refetch when search/filter changes
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchArticles();
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, statusFilter, fetchArticles]);

  const handleIngest = async () => {
    setIsIngesting(true);
    try {
      await autonomousApi.triggerIngestion();
      await fetchArticles();
      await fetchClaims();
    } finally {
      setIsIngesting(false);
    }
  };

  const handleBatchEnrich = async () => {
    setIsEnriching(true);
    setEnrichProgress('Starting...');
    try {
      const res = await autonomousApi.batchEnrich(25);
      setEnrichProgress(`Done - ${res.enrichedCount} analyzed`);
      await fetchArticles();
      setTimeout(() => setEnrichProgress(null), 3000);
    } catch {
      setEnrichProgress('Failed');
      setTimeout(() => setEnrichProgress(null), 3000);
    } finally {
      setIsEnriching(false);
    }
  };

  const handleEnrich = async (id: number) => {
    try {
      const res = await autonomousApi.enrichArticle(id);
      setArticles(prev => prev.map(a => a.id === id ? res.article : a));
    } catch (error) {
      console.error('Failed to enrich article:', error);
    }
  };

  // Filter articles for signals view (client-side)
  const filteredArticles = useMemo(() => {
    if (viewMode === 'signals') {
      return articles.filter(a =>
        a.signal === 'high' || a.signal === 'medium' ||
        a.verificationStatus === 'Verified' || a.verificationStatus === 'Likely' ||
        a.confidenceScore >= 70
      );
    }
    return articles;
  }, [articles, viewMode]);

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--theme-bg-primary)' }}>
      <div className="flex-1 flex overflow-hidden">

        {/* Sidebar */}
        <div
          className="w-48 flex-shrink-0 border-r flex flex-col"
          style={{ background: 'var(--theme-bg-secondary)', borderColor: 'var(--theme-border)' }}
        >
          <div className="p-4">
            <h1 className="text-xs font-bold uppercase tracking-wider opacity-50 mb-4">News Center</h1>

            <nav className="space-y-1">
              <button
                onClick={() => setViewMode('signals')}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition",
                  viewMode === 'signals'
                    ? "bg-theme-accent-primary/20 text-theme-accent-primary"
                    : "text-theme-text-secondary hover:bg-white/5"
                )}
              >
                <Zap className="w-4 h-4" />
                Signals
              </button>
              <button
                onClick={() => setViewMode('all')}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition",
                  viewMode === 'all'
                    ? "bg-theme-accent-primary/20 text-theme-accent-primary"
                    : "text-theme-text-secondary hover:bg-white/5"
                )}
              >
                <Newspaper className="w-4 h-4" />
                All News
              </button>
              <button
                onClick={() => setViewMode('claims')}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition",
                  viewMode === 'claims'
                    ? "bg-theme-accent-primary/20 text-theme-accent-primary"
                    : "text-theme-text-secondary hover:bg-white/5"
                )}
              >
                <Shield className="w-4 h-4" />
                Claims
              </button>
            </nav>
          </div>

          <div className="mt-auto p-4 border-t" style={{ borderColor: 'var(--theme-border)' }}>
            <div className="text-[10px] opacity-40 uppercase font-bold mb-2">Stats</div>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between opacity-60">
                <span>Articles</span>
                <span className="font-mono">{articles.length}</span>
              </div>
              <div className="flex justify-between opacity-60">
                <span>Claims</span>
                <span className="font-mono">{claims.length}</span>
              </div>
              <div className="flex justify-between opacity-60">
                <span>Enriched</span>
                <span className="font-mono">{articles.filter(a => a.signal !== null).length}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Main Area */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Toolbar */}
          <div className="h-12 border-b flex items-center justify-between px-4 gap-3" style={{ borderColor: 'var(--theme-border)' }}>
            {viewMode !== 'claims' && (
              <>
                <div className="flex-1 relative max-w-md">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 opacity-30" />
                  <input
                    type="text"
                    placeholder="Search articles..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-1.5 rounded-lg text-sm bg-theme-bg-tertiary border border-theme-border focus:outline-none focus:ring-1 focus:ring-theme-accent-primary"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg text-sm bg-theme-bg-tertiary border border-theme-border focus:outline-none"
                >
                  <option value="">All Statuses</option>
                  <option value="Verified">Verified</option>
                  <option value="Likely">Likely</option>
                  <option value="Unconfirmed">Unconfirmed</option>
                  <option value="Conflicted">Conflicted</option>
                  <option value="False/Retraction">False/Retraction</option>
                </select>
              </>
            )}
            {viewMode === 'claims' && <div className="flex-1" />}

            {enrichProgress && (
              <span className="text-[11px] text-theme-accent-primary font-medium">{enrichProgress}</span>
            )}

            <button
              onClick={handleBatchEnrich}
              disabled={isEnriching}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition",
                isEnriching
                  ? "bg-theme-accent-primary/20 text-theme-accent-primary"
                  : "hover:bg-white/5 text-theme-text-muted hover:text-theme-accent-primary"
              )}
              title="Run AI analysis on un-enriched articles"
            >
              <Sparkles className={cn("w-3.5 h-3.5", isEnriching && "animate-pulse")} />
              Enrich
            </button>

            <button
              onClick={handleIngest}
              disabled={isIngesting}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition",
                isIngesting
                  ? "bg-theme-accent-primary/20 text-theme-accent-primary"
                  : "hover:bg-white/5 text-theme-text-muted hover:text-theme-accent-primary"
              )}
              title="Fetch new articles from all sources"
            >
              <Download className={cn("w-3.5 h-3.5", isIngesting && "animate-bounce")} />
              Update
            </button>
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
            ) : filteredArticles.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center opacity-30">
                <Newspaper className="w-12 h-12 mb-4" />
                <p className="text-sm">No articles found.</p>
              </div>
            ) : (
              <div className="space-y-3 max-w-4xl mx-auto">
                {filteredArticles.map(article => (
                  <ArticleCard key={article.id} article={article} onEnrich={handleEnrich} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ArticleCard({ article, onEnrich }: { article: NewsArticle; onEnrich: (id: number) => void }) {
  const vColors = VERIFICATION_COLORS[article.verificationStatus] || VERIFICATION_COLORS['Unconfirmed'];
  const hasEnrichment = article.signal !== null;

  return (
    <div
      className={cn(
        "group p-4 rounded-xl border transition-all duration-300",
        "bg-theme-bg-secondary border-theme-border hover:border-theme-accent-primary/30"
      )}
    >
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            {/* Verification badge */}
            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-tighter border", vColors.bg, vColors.text, vColors.border)}>
              {article.verificationStatus}
            </span>
            {/* Signal badge */}
            {hasEnrichment && article.signal && (
              <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-tighter", SIGNAL_COLORS[article.signal])}>
                {article.signal} signal
              </span>
            )}
            {/* Source */}
            <span className="text-[10px] opacity-40 font-medium">
              {article.sourceName}
            </span>
            {/* Date */}
            <span className="text-[10px] opacity-30 flex items-center gap-1 ml-auto">
              <Clock className="w-3 h-3" />
              {article.publishedAt ? new Date(article.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown'}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-theme-text-primary leading-tight group-hover:text-theme-accent-primary transition-colors">
            {article.title}
          </h3>
        </div>
        <a
          href={article.url || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 rounded-lg bg-white/5 hover:bg-theme-accent-primary/20 text-theme-text-muted hover:text-theme-accent-primary transition flex-shrink-0"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      {/* Enrichment details */}
      {hasEnrichment && article.signalReason && (
        <p className="text-xs text-theme-text-secondary leading-relaxed mb-2 pl-1">
          {article.signalReason}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-theme-border/50">
        {/* Confidence score */}
        <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 text-[11px] font-mono text-theme-text-muted">
          <BarChart3 className="w-3 h-3 opacity-50" />
          {article.confidenceScore}%
        </div>

        {/* Topics */}
        {article.topics && article.topics.map(topic => (
          <span key={topic} className="px-2 py-0.5 rounded bg-theme-accent-primary/10 text-theme-accent-primary text-[11px]">
            <Tag className="w-3 h-3 inline mr-0.5" />
            {topic}
          </span>
        ))}

        {/* Analyze button if no enrichment */}
        {!hasEnrichment && (
          <button
            onClick={() => onEnrich(article.id)}
            className="ml-auto px-2.5 py-1 rounded-md bg-theme-accent-primary/10 text-theme-accent-primary text-[11px] font-medium hover:bg-theme-accent-primary/20 transition"
          >
            Analyze
          </button>
        )}
      </div>
    </div>
  );
}

function ClaimCard({ claim }: { claim: NewsClaim }) {
  const vColors = VERIFICATION_COLORS[claim.verificationStatus] || VERIFICATION_COLORS['Unconfirmed'];
  const bd = claim.scoreBreakdown;

  return (
    <div className="p-4 rounded-xl border bg-theme-bg-secondary border-theme-border">
      <div className="flex items-start gap-3 mb-3">
        <Shield className={cn("w-5 h-5 mt-0.5 flex-shrink-0", vColors.text)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-tighter border", vColors.bg, vColors.text, vColors.border)}>
              {claim.verificationStatus}
            </span>
            <span className="text-[10px] font-mono opacity-40">{claim.confidenceScore}%</span>
          </div>
          <p className="text-sm text-theme-text-primary leading-snug">
            {claim.claimText}
          </p>
        </div>
      </div>

      {/* Score breakdown */}
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
                className="h-full rounded-full bg-theme-accent-primary/70 transition-all"
                style={{ width: `${Math.min((value / max) * 100, 100)}%` }}
              />
            </div>
            <div className="text-[10px] font-mono opacity-50 mt-0.5">{value}/{max}</div>
          </div>
        ))}
      </div>

      {/* Source details */}
      <div className="flex items-center justify-between pt-2 border-t border-theme-border/50 text-[11px] text-theme-text-muted">
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
              className="text-theme-accent-primary hover:underline truncate max-w-[200px]"
            >
              {claim.articleTitle}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
