'use client';

import { useState, useEffect } from 'react';
import { X, Shield, File, Folder } from 'lucide-react';
import { workspaceApi, type FileInfo } from '@/lib/api';
import { useFilesStore } from '@/lib/files-store';

function permOctalToRwx(octal: string): string {
  const map: Record<string, string> = {
    '0': '---', '1': '--x', '2': '-w-', '3': '-wx',
    '4': 'r--', '5': 'r-x', '6': 'rw-', '7': 'rwx',
  };
  return octal.padStart(3, '0').split('').map(d => map[d] || '---').join('');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function FileProperties() {
  const { propertiesTarget, setPropertiesTarget, loadFiles } = useFilesStore();
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [settingPerms, setSettingPerms] = useState(false);

  useEffect(() => {
    if (!propertiesTarget) {
      setInfo(null);
      return;
    }
    setLoading(true);
    workspaceApi.getFileInfo(propertiesTarget)
      .then(setInfo)
      .catch(err => {
        console.error('Failed to load file info:', err);
        setInfo(null);
      })
      .finally(() => setLoading(false));
  }, [propertiesTarget]);

  if (!propertiesTarget) return null;

  const handleToggleExecutable = async () => {
    if (!info) return;
    setSettingPerms(true);
    try {
      const currentMode = parseInt(info.permissions, 8);
      const newMode = info.isExecutable
        ? (currentMode & ~0o111) // Remove execute bits
        : (currentMode | 0o111); // Add execute bits
      // Map to nearest allowed mode
      const allowed = [0o755, 0o750, 0o700, 0o644, 0o640, 0o600];
      const closest = allowed.reduce((prev, curr) =>
        Math.abs(curr - newMode) < Math.abs(prev - newMode) ? curr : prev
      );
      const updated = await workspaceApi.setPermissions(info.path, closest.toString(8));
      setInfo(updated);
      await loadFiles();
    } catch (err) {
      console.error('Failed to set permissions:', err);
    } finally {
      setSettingPerms(false);
    }
  };

  const handleSetMode = async (mode: string) => {
    if (!info) return;
    setSettingPerms(true);
    try {
      const updated = await workspaceApi.setPermissions(info.path, mode);
      setInfo(updated);
      await loadFiles();
    } catch (err) {
      console.error('Failed to set permissions:', err);
    } finally {
      setSettingPerms(false);
    }
  };

  const row = (label: string, value: string) => (
    <div className="flex justify-between py-1.5 border-b" style={{ borderColor: 'var(--theme-border-default)' }}>
      <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>{label}</span>
      <span className="text-xs font-mono" style={{ color: 'var(--theme-text-primary)' }}>{value}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50">
      <div
        className="w-[380px] rounded-lg shadow-2xl border"
        style={{ background: 'var(--theme-bg-primary)', borderColor: 'var(--theme-border-default)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--theme-border-default)' }}>
          <div className="flex items-center gap-2">
            {info?.isDirectory ? (
              <Folder className="w-5 h-5 text-blue-400" />
            ) : (
              <File className="w-5 h-5" style={{ color: 'var(--theme-text-muted)' }} />
            )}
            <span className="text-sm font-medium truncate max-w-[280px]" style={{ color: 'var(--theme-text-primary)' }}>
              {info?.name || propertiesTarget.split('/').pop()}
            </span>
          </div>
          <button
            onClick={() => setPropertiesTarget(null)}
            className="p-1 rounded hover:bg-[var(--theme-bg-tertiary)]"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-4 py-3">
          {loading ? (
            <div className="text-center py-4 text-sm" style={{ color: 'var(--theme-text-muted)' }}>Loading...</div>
          ) : info ? (
            <>
              {row('Path', info.path)}
              {row('Size', formatBytes(info.size))}
              {row('Type', info.mimeType)}
              {row('Created', formatFullDate(info.createdAt))}
              {row('Modified', formatFullDate(info.modifiedAt))}
              {row('Accessed', formatFullDate(info.accessedAt))}

              {/* Permissions section */}
              <div className="mt-3 pt-2 border-t" style={{ borderColor: 'var(--theme-border-default)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4" style={{ color: 'var(--theme-text-muted)' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--theme-text-primary)' }}>Permissions</span>
                </div>

                <div className="flex items-center justify-between py-1.5">
                  <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>Mode</span>
                  <span className="text-xs font-mono" style={{ color: 'var(--theme-text-primary)' }}>
                    {info.permissions} ({permOctalToRwx(info.permissions)})
                  </span>
                </div>

                {!info.isDirectory && (
                  <>
                    <div className="flex items-center justify-between py-1.5">
                      <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>Executable</span>
                      <button
                        onClick={handleToggleExecutable}
                        disabled={settingPerms}
                        className={`px-2 py-0.5 text-xs rounded transition ${
                          info.isExecutable
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-[var(--theme-bg-tertiary)]'
                        }`}
                        style={info.isExecutable ? undefined : { color: 'var(--theme-text-muted)' }}
                      >
                        {info.isExecutable ? 'Yes' : 'No'}
                      </button>
                    </div>

                    <div className="flex gap-1.5 mt-2">
                      {['644', '640', '755', '750', '700', '600'].map(mode => (
                        <button
                          key={mode}
                          onClick={() => handleSetMode(mode)}
                          disabled={settingPerms}
                          className={`px-2 py-0.5 text-xs rounded font-mono transition ${
                            info.permissions === mode
                              ? 'bg-[var(--theme-accent-primary)]/20 text-[var(--theme-accent-primary)]'
                              : 'bg-[var(--theme-bg-tertiary)] hover:bg-[var(--theme-bg-tertiary)]/80'
                          }`}
                          style={info.permissions === mode ? undefined : { color: 'var(--theme-text-muted)' }}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-4 text-sm" style={{ color: 'var(--theme-text-muted)' }}>
              Could not load file info
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
