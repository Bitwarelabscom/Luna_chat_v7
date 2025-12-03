'use client';

import { useState, useEffect, useCallback } from 'react';
import { Link2, Unlink, Mail, Cloud, RefreshCw, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { integrationsApi, OAuthConnection, EmailStatus } from '../../lib/api';

export default function IntegrationsTab() {
  const [oauthConnections, setOauthConnections] = useState<OAuthConnection[]>([]);
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      const [oauthRes, emailRes] = await Promise.all([
        integrationsApi.getOAuthStatus(),
        integrationsApi.getEmailStatus(),
      ]);
      setOauthConnections(oauthRes.connections || []);
      setEmailStatus(emailRes);
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
      `/luna-chat/api/integrations/oauth/${provider}/auth`,
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
