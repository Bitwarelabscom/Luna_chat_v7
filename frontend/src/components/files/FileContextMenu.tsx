'use client';

import { useEffect, useRef, useCallback } from 'react';
import {
  Eye, Edit3, Pencil, Trash2, Copy, Download, FolderPlus,
  FilePlus, RefreshCw, Shield, Info, ChevronDown, ChevronRight
} from 'lucide-react';
import { useFilesStore } from '@/lib/files-store';

interface FileContextMenuProps {
  onView: (path: string) => void;
  onOpenInEditor: (path: string) => void;
  onRename: (path: string) => void;
  onDelete: (paths: string[]) => void;
  onCopyPath: (path: string) => void;
  onDownload: (path: string) => void;
  onNewFile: (parentPath: string | null) => void;
  onNewFolder: (parentPath: string | null) => void;
  onRefresh: () => void;
  onPermissions: (path: string) => void;
  onProperties: (path: string) => void;
  onExpandCollapse: (path: string) => void;
}

export default function FileContextMenu({
  onView, onOpenInEditor, onRename, onDelete, onCopyPath,
  onDownload, onNewFile, onNewFolder, onRefresh,
  onPermissions, onProperties, onExpandCollapse,
}: FileContextMenuProps) {
  const { contextMenu, closeContextMenu, selectedPaths, expandedPaths } = useFilesStore();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu();
    };
    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenu, closeContextMenu]);

  // Adjust position to stay within viewport
  useEffect(() => {
    if (contextMenu && menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const el = menuRef.current;
      if (rect.right > window.innerWidth) {
        el.style.left = `${contextMenu.x - rect.width}px`;
      }
      if (rect.bottom > window.innerHeight) {
        el.style.top = `${contextMenu.y - rect.height}px`;
      }
    }
  }, [contextMenu]);

  const item = useCallback((
    label: string,
    icon: React.ReactNode,
    action: () => void,
    danger = false
  ) => (
    <button
      key={label}
      onClick={() => { action(); closeContextMenu(); }}
      className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left rounded transition-colors ${
        danger ? 'hover:bg-red-500/20 text-red-400' : 'hover:bg-[var(--theme-bg-tertiary)]'
      }`}
      style={danger ? undefined : { color: 'var(--theme-text-primary)' }}
    >
      {icon}
      {label}
    </button>
  ), [closeContextMenu]);

  const separator = <div className="border-t my-1" style={{ borderColor: 'var(--theme-border-default)' }} />;

  if (!contextMenu) return null;

  const { target, isMulti } = contextMenu;

  // Build menu items based on context
  const items: React.ReactNode[] = [];

  if (!target) {
    // Background context menu
    items.push(item('New File', <FilePlus className="w-4 h-4" />, () => onNewFile(null)));
    items.push(item('New Folder', <FolderPlus className="w-4 h-4" />, () => onNewFolder(null)));
    items.push(separator);
    items.push(item('Refresh', <RefreshCw className="w-4 h-4" />, onRefresh));
  } else if (isMulti) {
    // Multi-selection menu
    items.push(item(`Delete ${selectedPaths.size} items`, <Trash2 className="w-4 h-4" />, () => onDelete(Array.from(selectedPaths)), true));
  } else if (target.isDirectory) {
    // Directory context menu
    const isExpanded = expandedPaths.has(target.path);
    items.push(item(
      isExpanded ? 'Collapse' : 'Expand',
      isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />,
      () => onExpandCollapse(target.path)
    ));
    items.push(separator);
    items.push(item('New File', <FilePlus className="w-4 h-4" />, () => onNewFile(target.path)));
    items.push(item('New Folder', <FolderPlus className="w-4 h-4" />, () => onNewFolder(target.path)));
    items.push(separator);
    items.push(item('Rename', <Pencil className="w-4 h-4" />, () => onRename(target.path)));
    items.push(item('Copy Path', <Copy className="w-4 h-4" />, () => onCopyPath(target.path)));
    items.push(separator);
    items.push(item('Properties', <Info className="w-4 h-4" />, () => onProperties(target.path)));
    items.push(item('Delete', <Trash2 className="w-4 h-4" />, () => onDelete([target.path]), true));
  } else {
    // File context menu
    items.push(item('View', <Eye className="w-4 h-4" />, () => onView(target.path)));
    items.push(item('Open in Editor', <Edit3 className="w-4 h-4" />, () => onOpenInEditor(target.path)));
    items.push(separator);
    items.push(item('Rename', <Pencil className="w-4 h-4" />, () => onRename(target.path)));
    items.push(item('Copy Path', <Copy className="w-4 h-4" />, () => onCopyPath(target.path)));
    items.push(item('Download', <Download className="w-4 h-4" />, () => onDownload(target.path)));
    items.push(separator);
    items.push(item('Permissions', <Shield className="w-4 h-4" />, () => onPermissions(target.path)));
    items.push(item('Properties', <Info className="w-4 h-4" />, () => onProperties(target.path)));
    items.push(separator);
    items.push(item('Delete', <Trash2 className="w-4 h-4" />, () => onDelete([target.path]), true));
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[180px] py-1 rounded-lg shadow-xl border"
      style={{
        left: contextMenu.x,
        top: contextMenu.y,
        background: 'var(--theme-bg-secondary)',
        borderColor: 'var(--theme-border-default)',
      }}
    >
      {items}
    </div>
  );
}
