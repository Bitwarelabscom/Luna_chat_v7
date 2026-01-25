'use client';

import { useState, useEffect, useCallback } from 'react';
import { Link2, Unlink, Mail, Cloud, RefreshCw, CheckCircle, XCircle, AlertCircle, Calendar, Volume2, Music } from 'lucide-react';
import { integrationsApi, OAuthConnection, EmailStatus, calendarApi, CalendarStatus, settingsApi, TtsSettings, OpenAIVoice, spotifyApi, SpotifyStatus } from '../../lib/api';

// Voice name mapping for display
const VOICE_NAMES: Record<OpenAIVoice, { name: string; description: string }> = {
  alloy: { name: 'Alloy', description: 'Neutral, balanced' },
  echo: { name: 'Echo', description: 'Warm, conversational' },
  fable: { name: 'Fable', description: 'British, narrative' },
  onyx: { name: 'Onyx', description: 'Deep, authoritative' },
  nova: { name: 'Nova', description: 'Friendly, upbeat' },
  shimmer: { name: 'Shimmer', description: 'Soft, gentle' },
};

export default function IntegrationsTab() {
  const [oauthConnections, setOauthConnections] = useState<OAuthConnection[]>([]);
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus | null>(null);
  const [ttsSettings, setTtsSettings] = useState<TtsSettings | null>(null);
  const [spotifyStatus, setSpotifyStatus] = useState<SpotifyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [savingTts, setSavingTts] = useState(false);
  const [connectingSpotify, setConnectingSpotify] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      const [oauthRes, emailRes, calendarRes, ttsRes, spotifyRes] = await Promise.all([
        integrationsApi.getOAuthStatus(),
        integrationsApi.getEmailStatus(),
        calendarApi.getStatus().catch(() => null),
        settingsApi.getTtsSettings().catch(() => null),
        spotifyApi.getStatus().catch(() => null),
      ]);
      setOauthConnections(oauthRes.connections || []);
      setEmailStatus(emailRes);
      setCalendarStatus(calendarRes);
      if (ttsRes) {
        setTtsSettings(ttsRes.settings);
      }
      setSpotifyStatus(spotifyRes);
    } catch (error) {
      console.error('Failed to load integration status:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleDisconnect = async (provider: string) => {
    if (!confirm(`Disconnect ${provider}? You will need to reconnect to use this integration.`)) {
      return;
    }
    try {
      setDisconnecting(provider);
      await integrationsApi.disconnectOAuth(provider);
      await loadStatus();
    } catch (error) {
      console.error('Failed to disconnect:', error);
      alert('Failed to disconnect. Please try again.');
    } finally {
      setDisconnecting(null);
    }
  };

  const handleConnect = (provider: string) => {
    // Open OAuth flow in popup
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.innerWidth - width) / 2;
    const top = window.screenY + (window.innerHeight - height) / 2;
    const popup = window.open(
      `/api/integrations/oauth/${provider}/auth`,
      `${provider}_oauth`,
      `width=${width},height=${height},left=${left},top=${top}`
    );

    // Poll for popup close and refresh status
    const checkClosed = setInterval(() => {
      if (popup?.closed) {
        clearInterval(checkClosed);
        loadStatus();
      }
    }, 500);
  };

  const handleTtsUpdate = async (updates: Partial<TtsSettings>) => {
    try {
      setSavingTts(true);
      const result = await settingsApi.updateTtsSettings(updates);
      setTtsSettings(result.settings);
    } catch (error) {
      console.error('Failed to update TTS settings:', error);
      alert('Failed to save TTS settings. Please try again.');
    } finally {
      setSavingTts(false);
    }
  };

  const handleSpotifyConnect = async () => {
    try {
      setConnectingSpotify(true);
      const { url } = await spotifyApi.getAuthUrl();

      // Open OAuth flow in popup
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.innerWidth - width) / 2;
      const top = window.screenY + (window.innerHeight - height) / 2;
      const popup = window.open(
        url,
        'spotify_oauth',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      // Poll for popup close and refresh status
      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          setConnectingSpotify(false);
          loadStatus();
        }
      }, 500);
    } catch (error) {
      console.error('Failed to start Spotify auth:', error);
      alert('Failed to connect Spotify. Please try again.');
      setConnectingSpotify(false);
    }
  };

  const handleSpotifyDisconnect = async () => {
    if (!confirm('Disconnect Spotify? You will need to reconnect to use music features.')) {
      return;
    }
    try {
      setDisconnecting('spotify');
      await spotifyApi.disconnect();
      await loadStatus();
    } catch (error) {
      console.error('Failed to disconnect Spotify:', error);
      alert('Failed to disconnect Spotify. Please try again.');
    } finally {
      setDisconnecting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-theme-accent-primary" />
      </div>
    );
  }

  const getProviderIcon = (provider: string) => {
    switch (provider.toLowerCase()) {
      case 'google':
        return (
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
        );
      case 'microsoft':
        return (
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#F25022" d="M1 1h10v10H1z"/>
            <path fill="#00A4EF" d="M1 13h10v10H1z"/>
            <path fill="#7FBA00" d="M13 1h10v10H13z"/>
            <path fill="#FFB900" d="M13 13h10v10H13z"/>
          </svg>
        );
      default:
        return <Cloud className="w-5 h-5" />;
    }
  };

  const googleConn = oauthConnections.find(c => c.provider === 'google');
  const microsoftConn = oauthConnections.find(c => c.provider === 'microsoft');

  return (
    <div className="space-y-8">
      {/* OAuth Connections */}
      <div>
        <h3 className="text-lg font-medium text-theme-text-primary mb-4 flex items-center gap-2">
          <Link2 className="w-5 h-5" />
          Connected Accounts
        </h3>
        <div className="space-y-3">
          {/* Google */}
          <div className="p-4 bg-theme-bg-tertiary rounded-lg border border-theme-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {getProviderIcon('google')}
                <div>
                  <div className="font-medium text-theme-text-primary">Google</div>
                  <div className="text-sm text-theme-text-muted">
                    {googleConn?.connected ? (
                      <span className="flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-green-500" />
                        {googleConn.email || 'Connected'}
                      </span>
                    ) : (
                      'Calendar, Gmail access'
                    )}
                  </div>
                </div>
              </div>
              {googleConn?.connected ? (
                <button
                  onClick={() => handleDisconnect('google')}
                  disabled={disconnecting === 'google'}
                  className="px-3 py-1.5 text-sm bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 transition flex items-center gap-1"
                >
                  {disconnecting === 'google' ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Unlink className="w-4 h-4" />
                  )}
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={() => handleConnect('google')}
                  className="px-3 py-1.5 text-sm bg-theme-accent-primary/10 text-theme-accent-primary rounded-lg hover:bg-theme-accent-primary/20 transition flex items-center gap-1"
                >
                  <Link2 className="w-4 h-4" />
                  Connect
                </button>
              )}
            </div>
          </div>

          {/* Microsoft */}
          <div className="p-4 bg-theme-bg-tertiary rounded-lg border border-theme-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {getProviderIcon('microsoft')}
                <div>
                  <div className="font-medium text-theme-text-primary">Microsoft</div>
                  <div className="text-sm text-theme-text-muted">
                    {microsoftConn?.connected ? (
                      <span className="flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-green-500" />
                        {microsoftConn.email || 'Connected'}
                      </span>
                    ) : (
                      'Outlook, Calendar access'
                    )}
                  </div>
                </div>
              </div>
              {microsoftConn?.connected ? (
                <button
                  onClick={() => handleDisconnect('microsoft')}
                  disabled={disconnecting === 'microsoft'}
                  className="px-3 py-1.5 text-sm bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 transition flex items-center gap-1"
                >
                  {disconnecting === 'microsoft' ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Unlink className="w-4 h-4" />
                  )}
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={() => handleConnect('microsoft')}
                  className="px-3 py-1.5 text-sm bg-theme-accent-primary/10 text-theme-accent-primary rounded-lg hover:bg-theme-accent-primary/20 transition flex items-center gap-1"
                >
                  <Link2 className="w-4 h-4" />
                  Connect
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Spotify Connection */}
      <div>
        <h3 className="text-lg font-medium text-theme-text-primary mb-4 flex items-center gap-2">
          <Music className="w-5 h-5" />
          Spotify
        </h3>
        <div className="p-4 bg-theme-bg-tertiary rounded-lg border border-theme-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6" viewBox="0 0 24 24">
                <path fill="#1DB954" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
              </svg>
              <div>
                <div className="font-medium text-theme-text-primary">Spotify</div>
                <div className="text-sm text-theme-text-muted">
                  {spotifyStatus?.isLinked ? (
                    <span className="flex items-center gap-1">
                      <CheckCircle className="w-3 h-3 text-green-500" />
                      {spotifyStatus.displayName || 'Connected'}
                    </span>
                  ) : (
                    'Control music playback'
                  )}
                </div>
              </div>
            </div>
            {spotifyStatus?.isLinked ? (
              <button
                onClick={handleSpotifyDisconnect}
                disabled={disconnecting === 'spotify'}
                className="px-3 py-1.5 text-sm bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 transition flex items-center gap-1"
              >
                {disconnecting === 'spotify' ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Unlink className="w-4 h-4" />
                )}
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleSpotifyConnect}
                disabled={connectingSpotify}
                className="px-3 py-1.5 text-sm bg-[#1DB954]/10 text-[#1DB954] rounded-lg hover:bg-[#1DB954]/20 transition flex items-center gap-1"
              >
                {connectingSpotify ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Link2 className="w-4 h-4" />
                )}
                Connect
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Email Status */}
      <div>
        <h3 className="text-lg font-medium text-theme-text-primary mb-4 flex items-center gap-2">
          <Mail className="w-5 h-5" />
          Luna&apos;s Email
        </h3>
        <div className="p-4 bg-theme-bg-tertiary rounded-lg border border-theme-border">
          {emailStatus?.enabled ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-theme-text-muted">Status</span>
                <span className="flex items-center gap-1 text-green-400">
                  <CheckCircle className="w-4 h-4" />
                  Enabled
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-theme-text-muted">Send (SMTP)</span>
                {emailStatus.smtp.connected ? (
                  <span className="flex items-center gap-1 text-green-400">
                    <CheckCircle className="w-4 h-4" />
                    Connected
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-yellow-400">
                    <AlertCircle className="w-4 h-4" />
                    Not connected
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-theme-text-muted">Receive (IMAP)</span>
                {emailStatus.imap.connected ? (
                  <span className="flex items-center gap-1 text-green-400">
                    <CheckCircle className="w-4 h-4" />
                    Connected
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-yellow-400">
                    <AlertCircle className="w-4 h-4" />
                    Not connected
                  </span>
                )}
              </div>
              {emailStatus.approvedRecipients.length > 0 && (
                <div className="pt-2 border-t border-theme-border">
                  <div className="text-sm text-theme-text-muted mb-1">Approved recipients:</div>
                  <div className="text-sm text-theme-text-primary">
                    {emailStatus.approvedRecipients.join(', ')}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-theme-text-muted">
              <XCircle className="w-5 h-5" />
              Email is not configured
            </div>
          )}
        </div>
      </div>

      {/* Local Calendar Status */}
      <div>
        <h3 className="text-lg font-medium text-theme-text-primary mb-4 flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          Local Calendar
        </h3>
        <div className="p-4 bg-theme-bg-tertiary rounded-lg border border-theme-border">
          {calendarStatus?.enabled ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-theme-text-muted">Status</span>
                <span className="flex items-center gap-1 text-green-400">
                  <CheckCircle className="w-4 h-4" />
                  Enabled
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-theme-text-muted">Server (Radicale)</span>
                {calendarStatus.connected ? (
                  <span className="flex items-center gap-1 text-green-400">
                    <CheckCircle className="w-4 h-4" />
                    Connected
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-yellow-400">
                    <AlertCircle className="w-4 h-4" />
                    Not connected
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-theme-text-muted">Events</span>
                <span className="text-theme-text-primary">
                  {calendarStatus.eventCount} event{calendarStatus.eventCount !== 1 ? 's' : ''}
                </span>
              </div>
              {calendarStatus.lastSync && (
                <div className="flex items-center justify-between">
                  <span className="text-theme-text-muted">Last sync</span>
                  <span className="text-theme-text-primary text-sm">
                    {new Date(calendarStatus.lastSync).toLocaleString('sv-SE')}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-theme-text-muted">
              <XCircle className="w-5 h-5" />
              Calendar is not configured
            </div>
          )}
        </div>
      </div>

      {/* Voice / TTS Settings */}
      <div>
        <h3 className="text-lg font-medium text-theme-text-primary mb-4 flex items-center gap-2">
          <Volume2 className="w-5 h-5" />
          Voice Settings
        </h3>
        <div className="p-4 bg-theme-bg-tertiary rounded-lg border border-theme-border space-y-4">
          {/* TTS Engine Selection */}
          <div>
            <label className="block text-sm text-theme-text-muted mb-2">
              Text-to-Speech Engine
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleTtsUpdate({ engine: 'elevenlabs' })}
                disabled={savingTts}
                className={`p-3 rounded-lg border-2 transition text-left ${
                  ttsSettings?.engine === 'elevenlabs'
                    ? 'border-theme-accent-primary bg-theme-accent-primary/10'
                    : 'border-theme-border hover:border-theme-text-muted'
                }`}
              >
                <div className="font-medium text-theme-text-primary">ElevenLabs</div>
                <div className="text-xs text-theme-text-muted">High quality, expressive</div>
              </button>
              <button
                onClick={() => handleTtsUpdate({ engine: 'openai' })}
                disabled={savingTts}
                className={`p-3 rounded-lg border-2 transition text-left ${
                  ttsSettings?.engine === 'openai'
                    ? 'border-theme-accent-primary bg-theme-accent-primary/10'
                    : 'border-theme-border hover:border-theme-text-muted'
                }`}
              >
                <div className="font-medium text-theme-text-primary">OpenAI TTS</div>
                <div className="text-xs text-theme-text-muted">Fast, reliable</div>
              </button>
            </div>
          </div>

          {/* OpenAI Voice Selection - only show when OpenAI is selected */}
          {ttsSettings?.engine === 'openai' && (
            <div>
              <label className="block text-sm text-theme-text-muted mb-2">
                Voice
              </label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {(Object.keys(VOICE_NAMES) as OpenAIVoice[]).map((voice) => (
                  <button
                    key={voice}
                    onClick={() => handleTtsUpdate({ openaiVoice: voice })}
                    disabled={savingTts}
                    className={`p-2 rounded-lg border transition text-left ${
                      ttsSettings?.openaiVoice === voice
                        ? 'border-theme-accent-primary bg-theme-accent-primary/10'
                        : 'border-theme-border hover:border-theme-text-muted'
                    }`}
                  >
                    <div className="font-medium text-sm text-theme-text-primary">
                      {VOICE_NAMES[voice].name}
                    </div>
                    <div className="text-xs text-theme-text-muted">
                      {VOICE_NAMES[voice].description}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {savingTts && (
            <div className="flex items-center gap-2 text-sm text-theme-text-muted">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Saving...
            </div>
          )}
        </div>
      </div>

      {/* Refresh Button */}
      <div className="flex justify-center">
        <button
          onClick={loadStatus}
          disabled={loading}
          className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary transition flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh Status
        </button>
      </div>
    </div>
  );
}
