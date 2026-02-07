'use client';

import {
  MessageSquare,
  Mic,
  Folder,
  Terminal,
  Globe,
  CheckSquare,
  Calendar,
  Mail,
  Users,
  Music,
  Settings,
  TrendingUp,
  Activity,
  FileText,
  FolderCode,
  Brain,
  GitBranch,
  type LucideIcon,
} from 'lucide-react';

export type AppId =
  | 'chat'
  | 'voice'
  | 'files'
  | 'terminal'
  | 'browser'
  | 'editor'
  | 'projects'
  | 'planner'
  | 'todo'
  | 'calendar'
  | 'email'
  | 'friends'
  | 'music'
  | 'trading'
  | 'settings'
  | 'activity'
  | 'consciousness'
  | 'autonomous-learning';

export interface AppConfig {
  id: AppId;
  title: string;
  icon: LucideIcon;
  color: string;
  defaultSize: { width: number; height: number };
  keepAlive?: boolean; // Don't destroy on close, just hide
  showInDock?: boolean;
}

export const appConfig: Record<AppId, AppConfig> = {
  chat: {
    id: 'chat',
    title: 'Chat',
    icon: MessageSquare,
    color: 'from-cyan-400 to-blue-500',
    defaultSize: { width: 700, height: 500 },
    keepAlive: true,
    showInDock: true,
  },
  voice: {
    id: 'voice',
    title: 'Voice Chat',
    icon: Mic,
    color: 'from-violet-400 to-purple-500',
    defaultSize: { width: 500, height: 650 },
    keepAlive: true,
    showInDock: true,
  },
  files: {
    id: 'files',
    title: 'Files',
    icon: Folder,
    color: 'from-blue-400 to-indigo-500',
    defaultSize: { width: 800, height: 600 },
    showInDock: true,
  },
  terminal: {
    id: 'terminal',
    title: 'Terminal',
    icon: Terminal,
    color: 'from-gray-600 to-gray-800',
    defaultSize: { width: 700, height: 450 },
    showInDock: true,
  },
  browser: {
    id: 'browser',
    title: 'Browser',
    icon: Globe,
    color: 'from-green-400 to-emerald-500',
    defaultSize: { width: 1024, height: 768 },
    showInDock: true,
  },
  editor: {
    id: 'editor',
    title: 'Editor',
    icon: FileText,
    color: 'from-amber-400 to-orange-500',
    defaultSize: { width: 900, height: 700 },
    showInDock: true,
  },
  projects: {
    id: 'projects',
    title: 'Projects',
    icon: FolderCode,
    color: 'from-violet-400 to-purple-500',
    defaultSize: { width: 800, height: 600 },
    showInDock: true,
  },
  planner: {
    id: 'planner',
    title: 'Project Planner',
    icon: GitBranch,
    color: 'from-indigo-400 to-violet-500',
    defaultSize: { width: 1200, height: 800 },
    showInDock: true,
  },
  todo: {
    id: 'todo',
    title: 'Tasks',
    icon: CheckSquare,
    color: 'from-orange-400 to-red-500',
    defaultSize: { width: 400, height: 500 },
    showInDock: true,
  },
  calendar: {
    id: 'calendar',
    title: 'Calendar',
    icon: Calendar,
    color: 'from-red-400 to-pink-500',
    defaultSize: { width: 800, height: 600 },
    showInDock: true,
  },
  email: {
    id: 'email',
    title: 'Email',
    icon: Mail,
    color: 'from-blue-500 to-cyan-500',
    defaultSize: { width: 900, height: 600 },
    showInDock: true,
  },
  friends: {
    id: 'friends',
    title: 'Friends',
    icon: Users,
    color: 'from-pink-400 to-rose-500',
    defaultSize: { width: 400, height: 500 },
    showInDock: true,
  },
  music: {
    id: 'music',
    title: 'Music',
    icon: Music,
    color: 'from-green-500 to-emerald-400',
    defaultSize: { width: 400, height: 500 },
    showInDock: true,
  },
  trading: {
    id: 'trading',
    title: 'Trading',
    icon: TrendingUp,
    color: 'from-emerald-400 to-teal-500',
    defaultSize: { width: 1200, height: 800 },
    showInDock: true,
  },
  settings: {
    id: 'settings',
    title: 'Settings',
    icon: Settings,
    color: 'from-gray-400 to-gray-600',
    defaultSize: { width: 700, height: 500 },
    showInDock: false, // Access via SystemBar
  },
  activity: {
    id: 'activity',
    title: 'Activity',
    icon: Activity,
    color: 'from-purple-400 to-indigo-500',
    defaultSize: { width: 400, height: 500 },
    showInDock: true,
  },
  consciousness: {
    id: 'consciousness',
    title: 'Consciousness',
    icon: Brain,
    color: 'from-cyan-400 to-purple-500',
    defaultSize: { width: 900, height: 700 },
    showInDock: true,
  },
  'autonomous-learning': {
    id: 'autonomous-learning',
    title: 'Autonomous Learning',
    icon: Brain,
    color: 'from-purple-500 to-indigo-600',
    defaultSize: { width: 1000, height: 750 },
    showInDock: true,
  },
};

// Apps to show in the dock (in order)
export const dockApps: AppId[] = [
  'chat',
  'voice',
  'files',
  'projects',
  'planner',
  'terminal',
  'browser',
  'editor',
  'todo',
  'calendar',
  'email',
  'friends',
  'music',
  'trading',
  'activity',
  'consciousness',
  'autonomous-learning',
];

export default appConfig;
