'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Image, Upload, Wand2, Trash2, Check, RotateCcw, Loader2, X, RefreshCw } from 'lucide-react';
import { useBackgroundStore, type Background } from '@/lib/background-store';
import { backgroundApi, uploadBackgroundImage, getMediaUrl, type GeneratedImageOption } from '@/lib/api';

const STYLE_OPTIONS = [
  { id: 'abstract', name: 'Abstract', description: 'Flowing gradients and geometric shapes' },
  { id: 'nature', name: 'Nature', description: 'Serene landscapes and natural scenery' },
  { id: 'artistic', name: 'Artistic', description: 'Creative illustrations and designs' },
  { id: 'custom', name: 'Custom', description: 'Describe exactly what you want' },
];

export default function BackgroundTab() {
  const {
    activeBackground,
    backgrounds,
    isGenerating,
    isUploading,
    setActiveBackground,
    setBackgrounds,
    addBackground,
    removeBackground,
    setIsGenerating,
    setIsUploading,
  } = useBackgroundStore();

  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('abstract');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImageOption[]>([]);
  const [importingFilename, setImportingFilename] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Refresh function - can be called manually or from events
  const refreshBackgrounds = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [bgResult, activeResult, generatedResult] = await Promise.all([
        backgroundApi.getBackgrounds(),
        backgroundApi.getActiveBackground(),
        backgroundApi.getGeneratedImages(),
      ]);
      setBackgrounds(bgResult.backgrounds);
      setActiveBackground(activeResult.background);
      setGeneratedImages(generatedResult.images);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch backgrounds:', err);
      setError('Failed to load backgrounds');
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  }, [setBackgrounds, setActiveBackground]);

  // Fetch backgrounds on mount
  useEffect(() => {
    refreshBackgrounds();
  }, [refreshBackgrounds]);

  // Listen for background refresh events (triggered by Luna chat)
  useEffect(() => {
    const handleBackgroundRefresh = () => {
      refreshBackgrounds();
    };
    window.addEventListener('luna:background-refresh', handleBackgroundRefresh);
    return () => {
      window.removeEventListener('luna:background-refresh', handleBackgroundRefresh);
    };
  }, [refreshBackgrounds]);

  // Handle generate
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      setError('Please enter a description for your background');
      return;
    }

    setError(null);
    setIsGenerating(true);

    try {
      const result = await backgroundApi.generate(prompt.trim(), style, false);
      addBackground(result.background);
      setPrompt('');
    } catch (err) {
      setError((err as Error).message || 'Failed to generate background');
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, style, setIsGenerating, addBackground]);

  const handleUseGeneratedImage = useCallback(async (image: GeneratedImageOption) => {
    setError(null);
    setImportingFilename(image.filename);

    try {
      const result = await backgroundApi.createFromGenerated(image.filename, true);
      addBackground(result.background);
      setActiveBackground(result.background);
    } catch (err) {
      setError((err as Error).message || 'Failed to apply generated image');
    } finally {
      setImportingFilename(null);
    }
  }, [addBackground, setActiveBackground]);

  // Handle file upload
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type client-side
    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setError('Only PNG, JPG, GIF, and WebP images are allowed');
      return;
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be less than 10MB');
      return;
    }

    setError(null);
    setIsUploading(true);

    try {
      const background = await uploadBackgroundImage(file);
      addBackground(background);
    } catch (err) {
      setError((err as Error).message || 'Failed to upload background');
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [setIsUploading, addBackground]);

  // Handle activate background
  const handleActivate = useCallback(async (background: Background) => {
    try {
      await backgroundApi.activate(background.id);
      setActiveBackground(background);
    } catch (err) {
      setError((err as Error).message || 'Failed to set background');
    }
  }, [setActiveBackground]);

  // Handle reset to default
  const handleReset = useCallback(async () => {
    try {
      await backgroundApi.reset();
      setActiveBackground(null);
    } catch (err) {
      setError((err as Error).message || 'Failed to reset background');
    }
  }, [setActiveBackground]);

  // Handle delete background
  const handleDelete = useCallback(async (id: string) => {
    try {
      await backgroundApi.delete(id);
      removeBackground(id);
    } catch (err) {
      setError((err as Error).message || 'Failed to delete background');
    }
  }, [removeBackground]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-theme-accent-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Error Message */}
      {error && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center justify-between">
          <span className="text-red-400">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Current Background */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-theme-text-muted uppercase tracking-wider flex items-center gap-2">
            <Image className="w-4 h-4" />
            Current Background
          </h3>
          <button
            onClick={refreshBackgrounds}
            disabled={isRefreshing}
            className="p-2 rounded-lg text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary transition disabled:opacity-50"
            title="Refresh backgrounds"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="p-4 rounded-lg border border-theme-border bg-theme-bg-tertiary">
          {activeBackground ? (
            <div className="flex items-center gap-4">
              <div
                className="w-32 h-20 rounded-lg bg-cover bg-center border border-theme-border"
                style={{ backgroundImage: `url(${getMediaUrl(activeBackground.imageUrl)})` }}
              />
              <div className="flex-1">
                <p className="font-medium text-theme-text-primary">{activeBackground.name}</p>
                <p className="text-sm text-theme-text-muted capitalize">
                  {activeBackground.backgroundType} - {activeBackground.style || 'custom'}
                </p>
              </div>
              <button
                onClick={handleReset}
                className="px-4 py-2 rounded-lg bg-theme-bg-secondary border border-theme-border text-theme-text-secondary hover:text-theme-text-primary hover:border-theme-text-muted transition flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Reset to Default
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-theme-text-muted">Using default gradient background</p>
            </div>
          )}
        </div>
      </div>

      {/* Generated Images Section */}
      <div>
        <h3 className="text-sm font-medium text-theme-text-muted uppercase tracking-wider mb-4 flex items-center gap-2">
          <Image className="w-4 h-4" />
          Pick from Generated Images
        </h3>
        {generatedImages.length === 0 ? (
          <div className="p-4 rounded-lg border border-theme-border bg-theme-bg-tertiary">
            <p className="text-sm text-theme-text-muted">
              No generated chat images found yet. Ask Luna to generate an image first.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {generatedImages.map((image) => {
              const isApplying = importingFilename === image.filename;
              return (
                <div
                  key={image.filename}
                  className="rounded-lg border border-theme-border overflow-hidden bg-theme-bg-tertiary"
                >
                  <div
                    className="aspect-video bg-cover bg-center"
                    style={{ backgroundImage: `url(${getMediaUrl(image.imageUrl)})` }}
                  />
                  <div className="p-2 space-y-2">
                    <p className="text-xs text-theme-text-muted">
                      {new Date(image.createdAt).toLocaleString()}
                    </p>
                    <button
                      onClick={() => handleUseGeneratedImage(image)}
                      disabled={!!importingFilename}
                      className="w-full px-2 py-1.5 rounded bg-theme-accent-primary text-white text-xs font-medium hover:bg-theme-accent-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5"
                    >
                      {isApplying ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Applying...
                        </>
                      ) : (
                        <>
                          <Check className="w-3 h-3" />
                          Use as Background
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Generate Section */}
      <div>
        <h3 className="text-sm font-medium text-theme-text-muted uppercase tracking-wider mb-4 flex items-center gap-2">
          <Wand2 className="w-4 h-4" />
          Generate New Background
        </h3>
        <div className="p-4 rounded-lg border border-theme-border space-y-4">
          {/* Style Selection */}
          <div>
            <label className="block text-sm text-theme-text-secondary mb-2">Style</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {STYLE_OPTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStyle(s.id)}
                  className={`p-3 rounded-lg border text-left transition ${
                    style === s.id
                      ? 'border-theme-accent-primary bg-theme-accent-primary/10'
                      : 'border-theme-border hover:border-theme-text-muted'
                  }`}
                >
                  <span className={`font-medium text-sm ${style === s.id ? 'text-theme-accent-primary' : 'text-theme-text-primary'}`}>
                    {s.name}
                  </span>
                  <p className="text-xs text-theme-text-muted mt-1">{s.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Prompt Input */}
          <div>
            <label className="block text-sm text-theme-text-secondary mb-2">Description</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                style === 'abstract'
                  ? 'e.g., Purple and blue cosmic swirls with stars...'
                  : style === 'nature'
                  ? 'e.g., Misty mountains at sunrise with a lake...'
                  : style === 'artistic'
                  ? 'e.g., Minimalist geometric pattern in warm colors...'
                  : 'Describe your ideal background...'
              }
              className="w-full px-4 py-3 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-theme-accent-primary resize-none"
              rows={3}
            />
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
            className="w-full px-4 py-3 rounded-lg bg-theme-accent-primary text-white font-medium hover:bg-theme-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Wand2 className="w-5 h-5" />
                Generate Background
              </>
            )}
          </button>
        </div>
      </div>

      {/* Upload Section */}
      <div>
        <h3 className="text-sm font-medium text-theme-text-muted uppercase tracking-wider mb-4 flex items-center gap-2">
          <Upload className="w-4 h-4" />
          Upload Custom Background
        </h3>
        <div
          onClick={() => fileInputRef.current?.click()}
          className={`p-8 rounded-lg border-2 border-dashed border-theme-border hover:border-theme-accent-primary cursor-pointer transition text-center ${
            isUploading ? 'opacity-50 pointer-events-none' : ''
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={handleFileSelect}
            className="hidden"
          />
          {isUploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-8 h-8 animate-spin text-theme-accent-primary" />
              <span className="text-theme-text-muted">Uploading...</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="w-8 h-8 text-theme-text-muted" />
              <span className="text-theme-text-primary font-medium">Click to upload</span>
              <span className="text-sm text-theme-text-muted">PNG, JPG, GIF, or WebP (max 10MB)</span>
            </div>
          )}
        </div>
      </div>

      {/* Background Gallery */}
      {backgrounds.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-theme-text-muted uppercase tracking-wider mb-4 flex items-center gap-2">
            <Image className="w-4 h-4" />
            Your Backgrounds ({backgrounds.length})
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {backgrounds.map((bg) => (
              <div
                key={bg.id}
                className={`relative group rounded-lg border-2 overflow-hidden transition ${
                  bg.isActive
                    ? 'border-theme-accent-primary'
                    : 'border-theme-border hover:border-theme-text-muted'
                }`}
              >
                {/* Background Image */}
                <div
                  className="aspect-video bg-cover bg-center"
                  style={{ backgroundImage: `url(${getMediaUrl(bg.imageUrl)})` }}
                />

                {/* Active Badge */}
                {bg.isActive && (
                  <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-theme-accent-primary flex items-center justify-center">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                )}

                {/* Hover Overlay */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
                  {!bg.isActive && (
                    <button
                      onClick={() => handleActivate(bg)}
                      className="p-2 rounded-lg bg-theme-accent-primary text-white hover:bg-theme-accent-primary/80 transition"
                      title="Set as background"
                    >
                      <Check className="w-5 h-5" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(bg.id)}
                    className="p-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition"
                    title="Delete"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

                {/* Name */}
                <div className="p-2 bg-theme-bg-tertiary">
                  <p className="text-sm text-theme-text-primary truncate">{bg.name}</p>
                  <p className="text-xs text-theme-text-muted capitalize">
                    {bg.backgroundType}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
