import { create } from 'zustand';
import { workspaceApi, documentsApi, type WorkspaceFile, type Document } from './api';

export type FileTab = 'all' | 'dj-luna' | 'ceo-luna' | 'projects' | 'documents';

export interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNode[];
  file?: WorkspaceFile;
  depth: number;
}

export interface ContextMenuState {
  x: number;
  y: number;
  target: TreeNode | null;
  isMulti: boolean;
}

interface FilesState {
  // Data
  workspaceFiles: WorkspaceFile[];
  documents: Document[];
  directories: string[];
  tree: TreeNode[];
  loading: boolean;

  // Tab
  activeTab: FileTab;
  setActiveTab: (tab: FileTab) => void;

  // Selection
  selectedPaths: Set<string>;
  lastSelectedPath: string | null;
  selectPath: (path: string, multi: boolean, range: boolean) => void;
  clearSelection: () => void;

  // Expand/collapse
  expandedPaths: Set<string>;
  toggleExpand: (path: string) => void;
  expandAll: () => void;
  collapseAll: () => void;

  // Context menu
  contextMenu: ContextMenuState | null;
  openContextMenu: (x: number, y: number, target: TreeNode | null) => void;
  closeContextMenu: () => void;

  // Dialogs
  renameTarget: string | null;
  setRenameTarget: (path: string | null) => void;
  newFolderParent: string | null;
  setNewFolderParent: (path: string | null) => void;
  propertiesTarget: string | null;
  setPropertiesTarget: (path: string | null) => void;

  // Drag and drop
  dragSource: string[] | null;
  setDragSource: (paths: string[] | null) => void;
  dropTarget: string | null;
  setDropTarget: (path: string | null) => void;

  // File viewer
  viewingFile: { name: string; content: string } | null;
  setViewingFile: (file: { name: string; content: string } | null) => void;

  // Actions
  loadFiles: () => Promise<void>;
  buildTree: () => void;
  getFlatVisibleNodes: () => TreeNode[];
}

const TAB_PREFIXES: Record<string, string> = {
  'dj-luna': 'dj-luna/',
  'ceo-luna': 'ceo-luna/',
  'projects': 'projects/',
};

function buildTreeFromFiles(
  files: WorkspaceFile[],
  directories: string[],
  activeTab: FileTab,
  expandedPaths: Set<string>
): TreeNode[] {
  // Filter files by tab
  let filteredFiles = files;
  const prefix = TAB_PREFIXES[activeTab];
  if (prefix) {
    filteredFiles = files.filter(f => f.path.startsWith(prefix));
  }

  // Build directory map
  const dirMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  function getOrCreateDir(dirPath: string, depth: number): TreeNode {
    if (dirMap.has(dirPath)) return dirMap.get(dirPath)!;
    const parts = dirPath.split('/');
    const node: TreeNode = {
      name: parts[parts.length - 1],
      path: dirPath,
      isDirectory: true,
      children: [],
      depth,
    };
    dirMap.set(dirPath, node);
    return node;
  }

  // Add explicit directories (including empty ones)
  for (const dir of directories) {
    if (prefix && !dir.startsWith(prefix.slice(0, -1))) continue;
    const parts = dir.split('/');
    for (let i = 0; i < parts.length; i++) {
      const subPath = parts.slice(0, i + 1).join('/');
      getOrCreateDir(subPath, i);
    }
  }

  // Add directories from file paths
  for (const file of filteredFiles) {
    const parts = file.path.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join('/');
      getOrCreateDir(dirPath, i);
    }
  }

  // Add files to their parent directories
  for (const file of filteredFiles) {
    const parts = file.path.split('/');
    const fileNode: TreeNode = {
      name: parts[parts.length - 1],
      path: file.path,
      isDirectory: false,
      children: [],
      file,
      depth: parts.length - 1,
    };

    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join('/');
      const parent = dirMap.get(parentPath);
      if (parent) {
        parent.children.push(fileNode);
      } else {
        roots.push(fileNode);
      }
    } else {
      roots.push(fileNode);
    }
  }

  // Build parent-child relationships for directories
  const allDirPaths = Array.from(dirMap.keys()).sort();
  for (const dirPath of allDirPaths) {
    const parts = dirPath.split('/');
    const node = dirMap.get(dirPath)!;
    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join('/');
      const parent = dirMap.get(parentPath);
      if (parent) {
        if (!parent.children.includes(node)) {
          parent.children.push(node);
        }
      } else {
        if (!roots.includes(node)) roots.push(node);
      }
    } else {
      if (!roots.includes(node)) roots.push(node);
    }
  }

  // Sort: directories first, then alphabetical
  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children.length > 0) sortNodes(node.children);
    }
  }
  sortNodes(roots);

  return roots;
}

function flattenVisible(nodes: TreeNode[], expandedPaths: Set<string>): TreeNode[] {
  const result: TreeNode[] = [];
  function walk(nodeList: TreeNode[]) {
    for (const node of nodeList) {
      result.push(node);
      if (node.isDirectory && expandedPaths.has(node.path)) {
        walk(node.children);
      }
    }
  }
  walk(nodes);
  return result;
}

export const useFilesStore = create<FilesState>((set, get) => ({
  workspaceFiles: [],
  documents: [],
  directories: [],
  tree: [],
  loading: false,

  activeTab: 'all',
  setActiveTab: (tab) => {
    set({ activeTab: tab });
    get().buildTree();
  },

  selectedPaths: new Set(),
  lastSelectedPath: null,
  selectPath: (path, multi, range) => {
    const state = get();
    const newSelected = new Set(multi ? state.selectedPaths : []);

    if (range && state.lastSelectedPath) {
      const visible = state.getFlatVisibleNodes();
      const lastIdx = visible.findIndex(n => n.path === state.lastSelectedPath);
      const currIdx = visible.findIndex(n => n.path === path);
      if (lastIdx >= 0 && currIdx >= 0) {
        const [from, to] = lastIdx < currIdx ? [lastIdx, currIdx] : [currIdx, lastIdx];
        for (let i = from; i <= to; i++) {
          newSelected.add(visible[i].path);
        }
      }
    } else if (multi) {
      if (newSelected.has(path)) {
        newSelected.delete(path);
      } else {
        newSelected.add(path);
      }
    } else {
      newSelected.clear();
      newSelected.add(path);
    }

    set({ selectedPaths: newSelected, lastSelectedPath: path });
  },
  clearSelection: () => set({ selectedPaths: new Set(), lastSelectedPath: null }),

  expandedPaths: new Set(),
  toggleExpand: (path) => {
    const expanded = new Set(get().expandedPaths);
    if (expanded.has(path)) {
      expanded.delete(path);
    } else {
      expanded.add(path);
    }
    set({ expandedPaths: expanded });
  },
  expandAll: () => {
    const dirs = get().directories;
    set({ expandedPaths: new Set(dirs) });
  },
  collapseAll: () => set({ expandedPaths: new Set() }),

  contextMenu: null,
  openContextMenu: (x, y, target) => {
    const state = get();
    const isMulti = state.selectedPaths.size > 1;
    set({ contextMenu: { x, y, target, isMulti } });
  },
  closeContextMenu: () => set({ contextMenu: null }),

  renameTarget: null,
  setRenameTarget: (path) => set({ renameTarget: path }),
  newFolderParent: null,
  setNewFolderParent: (path) => set({ newFolderParent: path }),
  propertiesTarget: null,
  setPropertiesTarget: (path) => set({ propertiesTarget: path }),

  dragSource: null,
  setDragSource: (paths) => set({ dragSource: paths }),
  dropTarget: null,
  setDropTarget: (path) => set({ dropTarget: path }),

  viewingFile: null,
  setViewingFile: (file) => set({ viewingFile: file }),

  loadFiles: async () => {
    set({ loading: true });
    try {
      const [wsFiles, docRes, dirs] = await Promise.all([
        workspaceApi.listFiles(),
        documentsApi.list(),
        workspaceApi.listDirectories(),
      ]);
      set({
        workspaceFiles: wsFiles || [],
        documents: docRes.documents || [],
        directories: dirs || [],
      });
      get().buildTree();
    } catch (error) {
      console.error('Failed to load files:', error);
    } finally {
      set({ loading: false });
    }
  },

  buildTree: () => {
    const state = get();
    const tree = buildTreeFromFiles(
      state.workspaceFiles,
      state.directories,
      state.activeTab,
      state.expandedPaths
    );
    set({ tree });
  },

  getFlatVisibleNodes: () => {
    const state = get();
    return flattenVisible(state.tree, state.expandedPaths);
  },
}));
