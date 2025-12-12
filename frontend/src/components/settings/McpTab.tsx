'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plug,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
  Wrench,
  Globe,
  Zap,
  Terminal,
} from 'lucide-react';
import { mcpApi } from '@/lib/api';
import type { McpServerWithTools, McpTool, McpPreset } from '@/lib/api';

export default function McpTab() {
  const [servers, setServers] = useState<McpServerWithTools[]>([]);
  const [presets, setPresets] = useState<McpPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addingPreset, setAddingPreset] = useState(false);
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState<string | null>(null);

  // Add form state
  const [newServer, setNewServer] = useState({
    name: '',
    description: '',
    transportType: 'http' as 'http' | 'stdio',
    // HTTP
    url: '',
    // Stdio
    commandPath: '',
    commandArgs: '',
    envVars: '',
    workingDirectory: '',
  });
  const [testResult, setTestResult] = useState<{ success: boolean; toolCount?: number; error?: string } | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [serversRes, presetsRes] = await Promise.all([
        mcpApi.getServers(),
        mcpApi.getPresets(),
      ]);
      setServers(serversRes.servers || []);
      setPresets(presetsRes.presets || []);
    } catch (error) {
      console.error('Failed to load MCP data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddPreset = async (presetId: string) => {
    try {
      setAddingPreset(true);
      await mcpApi.addPreset(presetId);
      await loadData();
    } catch (error) {
      console.error('Failed to add preset:', error);
      alert('Failed to add preset. It may already exist.');
    } finally {
      setAddingPreset(false);
    }
  };

  const handleTestConnection = async () => {
    const isHttp = newServer.transportType === 'http';
    if (isHttp && !newServer.url) return;
    if (!isHttp && !newServer.commandPath) return;

    try {
      setTesting(true);
      setTestResult(null);
      const result = await mcpApi.testConnection({
        transportType: newServer.transportType,
        url: isHttp ? newServer.url : undefined,
        commandPath: !isHttp ? newServer.commandPath : undefined,
        commandArgs: !isHttp && newServer.commandArgs
          ? newServer.commandArgs.split(/\s+/).filter(Boolean)
          : undefined,
        envVars: !isHttp && newServer.envVars
          ? Object.fromEntries(
              newServer.envVars.split('\n').filter(Boolean).map(line => {
                const [key, ...rest] = line.split('=');
                return [key.trim(), rest.join('=').trim()];
              })
            )
          : undefined,
        workingDirectory: !isHttp && newServer.workingDirectory ? newServer.workingDirectory : undefined,
      });
      setTestResult(result);
    } catch (error) {
      setTestResult({ success: false, error: (error as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const handleAddServer = async () => {
    const isHttp = newServer.transportType === 'http';
    if (!newServer.name) return;
    if (isHttp && !newServer.url) return;
    if (!isHttp && !newServer.commandPath) return;

    try {
      await mcpApi.createServer({
        name: newServer.name,
        description: newServer.description || undefined,
        transportType: newServer.transportType,
        // HTTP
        url: isHttp ? newServer.url : undefined,
        // Stdio
        commandPath: !isHttp ? newServer.commandPath : undefined,
        commandArgs: !isHttp && newServer.commandArgs
          ? newServer.commandArgs.split(/\s+/).filter(Boolean)
          : undefined,
        envVars: !isHttp && newServer.envVars
          ? Object.fromEntries(
              newServer.envVars.split('\n').filter(Boolean).map(line => {
                const [key, ...rest] = line.split('=');
                return [key.trim(), rest.join('=').trim()];
              })
            )
          : undefined,
        workingDirectory: !isHttp && newServer.workingDirectory ? newServer.workingDirectory : undefined,
      });
      setNewServer({
        name: '',
        description: '',
        transportType: 'http',
        url: '',
        commandPath: '',
        commandArgs: '',
        envVars: '',
        workingDirectory: '',
      });
      setTestResult(null);
      setShowAddForm(false);
      await loadData();
    } catch (error) {
      console.error('Failed to add server:', error);
      alert('Failed to add server. Please check the configuration and try again.');
    }
  };

  const handleDeleteServer = async (serverId: string) => {
    if (!confirm('Delete this MCP server? All its tools will be removed.')) return;
    try {
      await mcpApi.deleteServer(serverId);
      await loadData();
    } catch (error) {
      console.error('Failed to delete server:', error);
    }
  };

  const handleToggleServer = async (server: McpServerWithTools) => {
    try {
      await mcpApi.updateServer(server.id, { isEnabled: !server.isEnabled });
      await loadData();
    } catch (error) {
      console.error('Failed to toggle server:', error);
    }
  };

  const handleDiscoverTools = async (serverId: string) => {
    try {
      setDiscovering(serverId);
      await mcpApi.discoverTools(serverId);
      await loadData();
    } catch (error) {
      console.error('Failed to discover tools:', error);
      alert('Failed to discover tools. Check the server connection.');
    } finally {
      setDiscovering(null);
    }
  };

  const handleToggleTool = async (tool: McpTool) => {
    try {
      await mcpApi.updateTool(tool.id, { isEnabled: !tool.isEnabled });
      await loadData();
    } catch (error) {
      console.error('Failed to toggle tool:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-theme-accent-primary" />
      </div>
    );
  }

  // Filter out presets that are already added
  const availablePresets = presets.filter(
    preset => !servers.some(server => server.url === preset.url)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
          <Plug className="w-5 h-5 text-theme-accent-primary" />
          MCP Servers
        </h3>
        <p className="text-sm text-theme-text-muted mt-1">
          Connect to Model Context Protocol servers for additional AI tools and capabilities.
        </p>
      </div>

      {/* Quick Add Presets */}
      {availablePresets.length > 0 && (
        <div className="bg-theme-bg-secondary rounded-lg p-4 border border-theme-border">
          <h4 className="text-sm font-medium text-theme-text-primary mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-500" />
            Quick Add
          </h4>
          <div className="flex flex-wrap gap-2">
            {availablePresets.map(preset => (
              <button
                key={preset.id}
                onClick={() => handleAddPreset(preset.id)}
                disabled={addingPreset}
                className="px-3 py-2 bg-theme-bg-tertiary hover:bg-theme-bg-hover rounded-lg text-sm text-theme-text-primary border border-theme-border transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <Globe className="w-4 h-4 text-theme-accent-primary" />
                {preset.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Server List */}
      <div className="space-y-3">
        {servers.map(server => (
          <div
            key={server.id}
            className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden"
          >
            {/* Server Header */}
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <button
                  onClick={() => setExpandedServer(expandedServer === server.id ? null : server.id)}
                  className="p-1 hover:bg-theme-bg-hover rounded"
                >
                  {expandedServer === server.id ? (
                    <ChevronDown className="w-4 h-4 text-theme-text-muted" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-theme-text-muted" />
                  )}
                </button>

                {/* Status indicator */}
                {server.isConnected ? (
                  <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                ) : server.lastError ? (
                  <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                )}

                <div className="min-w-0">
                  <div className="font-medium text-theme-text-primary truncate flex items-center gap-2">
                    {server.name}
                    <span className="text-xs px-1.5 py-0.5 rounded bg-theme-bg-tertiary text-theme-text-muted">
                      {server.transportType === 'stdio' ? 'stdio' : 'http'}
                    </span>
                  </div>
                  <div className="text-xs text-theme-text-muted truncate">
                    {server.transportType === 'stdio'
                      ? server.commandPath
                      : server.url}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-theme-text-muted bg-theme-bg-tertiary px-2 py-1 rounded">
                  {server.tools?.length || 0} tools
                </span>

                <button
                  onClick={() => handleDiscoverTools(server.id)}
                  disabled={discovering === server.id}
                  className="p-2 hover:bg-theme-bg-hover rounded text-theme-text-muted hover:text-theme-text-primary"
                  title="Refresh tools"
                >
                  <RefreshCw className={`w-4 h-4 ${discovering === server.id ? 'animate-spin' : ''}`} />
                </button>

                <button
                  onClick={() => handleToggleServer(server)}
                  className="p-2 hover:bg-theme-bg-hover rounded"
                  title={server.isEnabled ? 'Disable server' : 'Enable server'}
                >
                  {server.isEnabled ? (
                    <ToggleRight className="w-5 h-5 text-green-500" />
                  ) : (
                    <ToggleLeft className="w-5 h-5 text-theme-text-muted" />
                  )}
                </button>

                <button
                  onClick={() => handleDeleteServer(server.id)}
                  className="p-2 hover:bg-theme-bg-hover rounded text-red-400 hover:text-red-300"
                  title="Delete server"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Error message */}
            {server.lastError && (
              <div className="px-4 pb-3">
                <div className="text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded">
                  {server.lastError}
                </div>
              </div>
            )}

            {/* Expanded Tools */}
            {expandedServer === server.id && server.tools && server.tools.length > 0 && (
              <div className="border-t border-theme-border bg-theme-bg-tertiary p-4">
                <div className="text-xs font-medium text-theme-text-muted uppercase mb-3 flex items-center gap-2">
                  <Wrench className="w-3 h-3" />
                  Available Tools
                </div>
                <div className="space-y-2">
                  {server.tools.map(tool => (
                    <div
                      key={tool.id}
                      className="flex items-center justify-between p-3 bg-theme-bg-secondary rounded-lg"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm text-theme-text-primary">
                          {tool.title || tool.name}
                        </div>
                        <div className="text-xs text-theme-text-muted mt-0.5 line-clamp-2">
                          {tool.description}
                        </div>
                        {tool.usageCount > 0 && (
                          <div className="text-xs text-theme-text-muted mt-1">
                            Used {tool.usageCount} times
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleToggleTool(tool)}
                        className="ml-3 flex-shrink-0"
                        title={tool.isEnabled ? 'Disable tool' : 'Enable tool'}
                      >
                        {tool.isEnabled ? (
                          <ToggleRight className="w-5 h-5 text-green-500" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-theme-text-muted" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No tools message */}
            {expandedServer === server.id && (!server.tools || server.tools.length === 0) && (
              <div className="border-t border-theme-border bg-theme-bg-tertiary p-4">
                <div className="text-sm text-theme-text-muted text-center py-4">
                  No tools discovered. Try refreshing the tools list.
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Empty state */}
        {servers.length === 0 && !showAddForm && (
          <div className="text-center py-8 text-theme-text-muted">
            <Plug className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No MCP servers connected</p>
            <p className="text-sm mt-1">Add a preset above or add a custom server below</p>
          </div>
        )}
      </div>

      {/* Add Custom Server */}
      {showAddForm ? (
        <div className="bg-theme-bg-secondary rounded-lg p-4 border border-theme-border space-y-4">
          <h4 className="font-medium text-theme-text-primary">Add Custom MCP Server</h4>

          <div>
            <label className="block text-sm text-theme-text-muted mb-1">Name</label>
            <input
              type="text"
              value={newServer.name}
              onChange={e => setNewServer({ ...newServer, name: e.target.value })}
              placeholder="My MCP Server"
              className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-theme-accent-primary/50"
            />
          </div>

          {/* Transport Type Selector */}
          <div>
            <label className="block text-sm text-theme-text-muted mb-2">Transport Type</label>
            <div className="flex gap-2">
              <button
                onClick={() => setNewServer({ ...newServer, transportType: 'http' })}
                className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                  newServer.transportType === 'http'
                    ? 'border-theme-accent-primary bg-theme-accent-primary/10 text-theme-accent-primary'
                    : 'border-theme-border bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                }`}
              >
                <Globe className="w-4 h-4" />
                HTTP
              </button>
              <button
                onClick={() => setNewServer({ ...newServer, transportType: 'stdio' })}
                className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                  newServer.transportType === 'stdio'
                    ? 'border-theme-accent-primary bg-theme-accent-primary/10 text-theme-accent-primary'
                    : 'border-theme-border bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                }`}
              >
                <Terminal className="w-4 h-4" />
                Stdio (Command)
              </button>
            </div>
          </div>

          {/* HTTP Fields */}
          {newServer.transportType === 'http' && (
            <div>
              <label className="block text-sm text-theme-text-muted mb-1">URL</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={newServer.url}
                  onChange={e => setNewServer({ ...newServer, url: e.target.value })}
                  placeholder="https://example.com/mcp"
                  className="flex-1 px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-theme-accent-primary/50"
                />
                <button
                  onClick={handleTestConnection}
                  disabled={!newServer.url || testing}
                  className="px-3 py-2 bg-theme-bg-tertiary hover:bg-theme-bg-hover border border-theme-border rounded-lg text-sm text-theme-text-primary disabled:opacity-50"
                >
                  {testing ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    'Test'
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Stdio Fields */}
          {newServer.transportType === 'stdio' && (
            <>
              <div>
                <label className="block text-sm text-theme-text-muted mb-1">Command Path</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newServer.commandPath}
                    onChange={e => setNewServer({ ...newServer, commandPath: e.target.value })}
                    placeholder="/path/to/mcp-server"
                    className="flex-1 px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-theme-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-theme-accent-primary/50"
                  />
                  <button
                    onClick={handleTestConnection}
                    disabled={!newServer.commandPath || testing}
                    className="px-3 py-2 bg-theme-bg-tertiary hover:bg-theme-bg-hover border border-theme-border rounded-lg text-sm text-theme-text-primary disabled:opacity-50"
                  >
                    {testing ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      'Test'
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm text-theme-text-muted mb-1">Command Arguments (optional)</label>
                <input
                  type="text"
                  value={newServer.commandArgs}
                  onChange={e => setNewServer({ ...newServer, commandArgs: e.target.value })}
                  placeholder="--port 8080 --debug"
                  className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-theme-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-theme-accent-primary/50"
                />
                <p className="text-xs text-theme-text-muted mt-1">Space-separated arguments</p>
              </div>

              <div>
                <label className="block text-sm text-theme-text-muted mb-1">Environment Variables (optional)</label>
                <textarea
                  value={newServer.envVars}
                  onChange={e => setNewServer({ ...newServer, envVars: e.target.value })}
                  placeholder="KEY=value&#10;ANOTHER_KEY=another_value"
                  rows={3}
                  className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-theme-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-theme-accent-primary/50"
                />
                <p className="text-xs text-theme-text-muted mt-1">One per line: KEY=value</p>
              </div>

              <div>
                <label className="block text-sm text-theme-text-muted mb-1">Working Directory (optional)</label>
                <input
                  type="text"
                  value={newServer.workingDirectory}
                  onChange={e => setNewServer({ ...newServer, workingDirectory: e.target.value })}
                  placeholder="/path/to/working/directory"
                  className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-theme-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-theme-accent-primary/50"
                />
              </div>
            </>
          )}

          {/* Test Result */}
          {testResult && (
            <div className={`text-sm ${testResult.success ? 'text-green-500' : 'text-red-400'}`}>
              {testResult.success
                ? `Connected! Found ${testResult.toolCount || 0} tools.`
                : `Failed: ${testResult.error}`}
            </div>
          )}

          <div>
            <label className="block text-sm text-theme-text-muted mb-1">Description (optional)</label>
            <input
              type="text"
              value={newServer.description}
              onChange={e => setNewServer({ ...newServer, description: e.target.value })}
              placeholder="What this server provides"
              className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-theme-accent-primary/50"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setShowAddForm(false);
                setNewServer({
                  name: '',
                  description: '',
                  transportType: 'http',
                  url: '',
                  commandPath: '',
                  commandArgs: '',
                  envVars: '',
                  workingDirectory: '',
                });
                setTestResult(null);
              }}
              className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary"
            >
              Cancel
            </button>
            <button
              onClick={handleAddServer}
              disabled={
                !newServer.name ||
                (newServer.transportType === 'http' && !newServer.url) ||
                (newServer.transportType === 'stdio' && !newServer.commandPath)
              }
              className="px-4 py-2 bg-theme-accent-primary hover:bg-theme-accent-primary/90 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              Add Server
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full py-3 border-2 border-dashed border-theme-border hover:border-theme-accent-primary/50 rounded-lg text-sm text-theme-text-muted hover:text-theme-text-primary transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Custom MCP Server
        </button>
      )}

      {/* Info */}
      <div className="text-xs text-theme-text-muted bg-theme-bg-tertiary rounded-lg p-3">
        <strong>What is MCP?</strong> Model Context Protocol allows Luna to connect to external services and use their tools.
        Supports both HTTP servers and local stdio-based command-line tools.
        Tools from enabled servers will be available to Luna during conversations.
      </div>
    </div>
  );
}
