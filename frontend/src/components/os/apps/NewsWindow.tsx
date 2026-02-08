'use client';

import { useState, useEffect, useMemo } from 'react';
import { 
  Newspaper, Search, Filter, RefreshCw, ExternalLink, 
  CheckCircle2, AlertCircle, Clock, Tag, ChevronRight,
  Settings, Trash2, Plus
} from 'lucide-react';
import { autonomousApi, type RssArticle, type RssFeed } from '@/lib/api';
import { cn } from '@/lib/utils';

type ViewMode = 'signals' | 'all' | 'feeds';

export default function NewsWindow() {
  const [viewMode, setViewMode] = useState<ViewMode>('signals');
  const [articles, setArticles] = useState<RssArticle[]>([]);
  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch data
  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [articlesRes, feedsRes] = await Promise.all([
        autonomousApi.getArticles({ limit: 100 }),
        autonomousApi.getFeeds()
      ]);
      setArticles(articlesRes.articles);
      setFeeds(feedsRes.feeds);
    } catch (error) {
      console.error('Failed to fetch news data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchData();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Filter articles
  const filteredArticles = useMemo(() => {
    return articles.filter(article => {
      // View mode filter
      if (viewMode === 'signals' && !article.isInteresting) return false;
      
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!article.title.toLowerCase().includes(query) && 
            !article.summary?.toLowerCase().includes(query)) {
          return false;
        }
      }

      // Category filter (would need feed info joined or category on article)
      // For now we just use title/summary matching if needed

      return true;
    });
  }, [articles, viewMode, searchQuery]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Sidebar & Main Content Layout */}
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
                <AlertCircle className="w-4 h-4" />
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
                onClick={() => setViewMode('feeds')}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition",
                  viewMode === 'feeds' 
                    ? "bg-theme-accent-primary/20 text-theme-accent-primary" 
                    : "text-theme-text-secondary hover:bg-white/5"
                )}
              >
                <Settings className="w-4 h-4" />
                Feeds
              </button>
            </nav>
          </div>

          <div className="mt-auto p-4 border-t" style={{ borderColor: 'var(--theme-border)' }}>
            <div className="text-[10px] opacity-40 uppercase font-bold mb-2">My Feeds</div>
            <div className="space-y-1">
              {feeds.slice(0, 5).map(feed => (
                <div key={feed.id} className="text-[11px] truncate opacity-60 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-theme-accent-primary" />
                  {feed.title || 'Untitled Feed'}
                </div>
              ))}
              {feeds.length > 5 && <div className="text-[10px] opacity-30 px-3">+{feeds.length - 5} more</div>}
            </div>
          </div>
        </div>

        {/* Main Area */}
        <div className="flex-1 flex flex-col min-w-0">
          
          {/* Toolbar */}
          <div className="h-12 border-b flex items-center justify-between px-4 gap-4" style={{ borderColor: 'var(--theme-border)' }}>
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
            
            <div className="flex items-center gap-2">
              <button 
                onClick={handleRefresh}
                className={cn("p-2 rounded-lg hover:bg-white/5 transition", isRefreshing && "animate-spin")}
                title="Refresh news"
              >
                <RefreshCw className="w-4 h-4 opacity-60" />
              </button>
            </div>
          </div>

          {/* Article List */}
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            {isLoading ? (
              <div className="h-full flex flex-col items-center justify-center opacity-30">
                <RefreshCw className="w-8 h-8 animate-spin mb-2" />
                <p className="text-sm">Filtering the bullshit...</p>
              </div>
            ) : viewMode === 'feeds' ? (
              <FeedsList feeds={feeds} onRefresh={fetchData} />
            ) : filteredArticles.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center opacity-30">
                <Newspaper className="w-12 h-12 mb-4" />
                <p className="text-sm">No articles found in this view.</p>
              </div>
            ) : (
              <div className="space-y-4 max-w-4xl mx-auto">
                {filteredArticles.map(article => (
                  <ArticleCard key={article.id} article={article} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ArticleCard({ article }: { article: RssArticle }) {
  const isHighSignal = article.relevanceScore >= 0.8;
  
  return (
    <div 
      className={cn(
        "group p-4 rounded-xl border transition-all duration-300",
        isHighSignal 
          ? "bg-theme-accent-primary/5 border-theme-accent-primary/30 shadow-lg shadow-theme-accent-primary/5" 
          : "bg-theme-bg-secondary border-theme-border hover:border-theme-accent-primary/30"
      )}
    >
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isHighSignal && (
              <div className="px-1.5 py-0.5 rounded bg-theme-accent-primary text-[10px] font-bold text-white uppercase tracking-tighter">
                High Signal
              </div>
            )}
            <span className="text-[10px] opacity-40 uppercase font-bold flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {new Date(article.publishedAt || article.fetchedAt).toLocaleDateString()}
            </span>
          </div>
          <h3 className="text-base font-semibold text-theme-text-primary leading-tight group-hover:text-theme-accent-primary transition-colors">
            {article.title}
          </h3>
        </div>
        <a 
          href={article.url || '#'} 
          target="_blank" 
          rel="noopener noreferrer"
          className="p-2 rounded-lg bg-white/5 hover:bg-theme-accent-primary/20 text-theme-text-muted hover:text-theme-accent-primary transition"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      {article.lunaSummary ? (
        <div className="mb-3">
          <p className="text-sm text-theme-text-secondary leading-relaxed line-clamp-3">
            {article.lunaSummary}
          </p>
        </div>
      ) : article.summary ? (
        <div className="mb-3">
          <p className="text-sm text-theme-text-muted leading-relaxed line-clamp-2 italic">
            {article.summary}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-theme-border/50">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/5 text-[11px] font-medium text-theme-text-muted">
          <Tag className="w-3 h-3 opacity-50" />
          {article.relevanceReason || 'Analyzed by Luna'}
        </div>
        
        {article.tags && article.tags.map(tag => (
          <span key={tag} className="px-2 py-1 rounded-md bg-theme-accent-primary/10 text-theme-accent-primary text-[11px]">
            #{tag}
          </span>
        ))}

        <div className="ml-auto text-[10px] opacity-30 font-mono">
          Signal: {(article.relevanceScore * 100).toFixed(0)}%
        </div>
      </div>
    </div>
  );
}

function FeedsList({ feeds, onRefresh }: { feeds: RssFeed[], onRefresh: () => void }) {
  const [newUrl, setNewUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const handleAddFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl) return;
    setIsAdding(true);
    try {
      await autonomousApi.addFeed(newUrl);
      setNewUrl('');
      onRefresh();
    } catch (error) {
      console.error('Failed to add feed:', error);
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteFeed = async (id: string) => {
    if (!confirm('Delete this feed?')) return;
    try {
      await autonomousApi.deleteFeed(id);
      onRefresh();
    } catch (error) {
      console.error('Failed to delete feed:', error);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-theme-bg-secondary p-6 rounded-xl border border-theme-border">
        <h2 className="text-sm font-bold mb-4 flex items-center gap-2">
          <Plus className="w-4 h-4 text-theme-accent-primary" />
          Add New Source
        </h2>
        <form onSubmit={handleAddFeed} className="flex gap-2">
          <input
            type="url"
            placeholder="https://example.com/rss.xml"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            className="flex-1 px-4 py-2 rounded-lg text-sm bg-theme-bg-tertiary border border-theme-border focus:outline-none"
            required
          />
          <button
            type="submit"
            disabled={isAdding}
            className="px-6 py-2 rounded-lg bg-theme-accent-primary text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {isAdding ? 'Adding...' : 'Add Feed'}
          </button>
        </form>
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider opacity-50 px-2">Managed Feeds ({feeds.length})</h2>
        {feeds.map(feed => (
          <div 
            key={feed.id} 
            className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-transparent hover:border-theme-border transition group"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{feed.title || 'Untitled'}</div>
              <div className="text-xs opacity-40 truncate">{feed.url}</div>
            </div>
            <button
              onClick={() => handleDeleteFeed(feed.id)}
              className="p-2 rounded-lg hover:bg-red-500/20 text-theme-text-muted hover:text-red-400 transition opacity-0 group-hover:opacity-100"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
