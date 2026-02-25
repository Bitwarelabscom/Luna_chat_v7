'use client';

import { useState } from 'react';
import {
  Settings, Palette, MessageSquare, Cpu, Link, Server, FolderOpen, Image,
  CheckSquare, Brain, Zap, Bell, BarChart3, Database, Users, Bookmark
} from 'lucide-react';
import AppearanceTab from '@/components/settings/AppearanceTab';
import BackgroundTab from '@/components/settings/BackgroundTab';
import PromptsTab from '@/components/settings/PromptsTab';
import ModelsTab from '@/components/settings/ModelsTab';
import IntegrationsTab from '@/components/settings/IntegrationsTab';
import McpTab from '@/components/settings/McpTab';
import WorkspaceTab from '@/components/settings/WorkspaceTab';
import TasksTab from '@/components/settings/TasksTab';
import MemoryTab from '@/components/settings/MemoryTab';
import AutonomousTab from '@/components/settings/AutonomousTab';
import TriggersTab from '@/components/settings/TriggersTab';
import StatsTab from '@/components/settings/StatsTab';
import DataTab from '@/components/settings/DataTab';
import FriendsTab from '@/components/settings/FriendsTab';
import BackgroundModelsTab from '@/components/settings/BackgroundModelsTab';
import PresetsTab from '@/components/settings/PresetsTab';

type SettingsTab =
  | 'appearance'
  | 'background'
  | 'prompts'
  | 'models'
  | 'presets'
  | 'backgroundai'
  | 'integrations'
  | 'mcp'
  | 'workspace'
  | 'tasks'
  | 'memory'
  | 'autonomous'
  | 'friends'
  | 'triggers'
  | 'stats'
  | 'data';

interface TabConfig {
  id: SettingsTab;
  label: string;
  icon: typeof Settings;
  description: string;
}

interface TabSection {
  header: string;
  tabs: TabConfig[];
}

const sections: TabSection[] = [
  {
    header: 'General',
    tabs: [
      { id: 'appearance', label: 'Appearance', icon: Palette, description: 'Theme and visual settings' },
      { id: 'background', label: 'Background', icon: Image, description: 'Desktop background images' },
      { id: 'prompts', label: 'Prompts', icon: MessageSquare, description: 'System prompts and personas' },
    ],
  },
  {
    header: 'AI Configuration',
    tabs: [
      { id: 'models', label: 'Models', icon: Cpu, description: 'AI model configuration' },
      { id: 'presets', label: 'Presets', icon: Bookmark, description: 'Quick-switch model presets' },
      { id: 'backgroundai', label: 'Background AI', icon: Cpu, description: 'Background AI model selectors' },
    ],
  },
  {
    header: 'Connections',
    tabs: [
      { id: 'integrations', label: 'Integrations', icon: Link, description: 'OAuth and external services' },
      { id: 'mcp', label: 'MCP Servers', icon: Server, description: 'Model Context Protocol' },
    ],
  },
  {
    header: 'Workspace',
    tabs: [
      { id: 'workspace', label: 'Workspace', icon: FolderOpen, description: 'Files and documents' },
      { id: 'tasks', label: 'Tasks', icon: CheckSquare, description: 'Task management' },
      { id: 'memory', label: 'Memory', icon: Brain, description: 'Facts and knowledge' },
    ],
  },
  {
    header: 'Automation',
    tabs: [
      { id: 'autonomous', label: 'Autonomous', icon: Zap, description: 'Autonomous mode settings' },
      { id: 'friends', label: 'Friends', icon: Users, description: 'AI companions' },
      { id: 'triggers', label: 'Triggers', icon: Bell, description: 'Notifications and schedules' },
    ],
  },
  {
    header: 'System',
    tabs: [
      { id: 'stats', label: 'Stats', icon: BarChart3, description: 'Usage statistics' },
      { id: 'data', label: 'Data', icon: Database, description: 'Backup and restore' },
    ],
  },
];

// Flat list for tab lookup
const allTabs = sections.flatMap(s => s.tabs);

export default function SettingsWindow() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');

  const renderTabContent = () => {
    switch (activeTab) {
      case 'appearance':
        return <AppearanceTab />;
      case 'background':
        return <BackgroundTab />;
      case 'prompts':
        return <PromptsTab />;
      case 'models':
        return <ModelsTab />;
      case 'presets':
        return <PresetsTab />;
      case 'backgroundai':
        return <BackgroundModelsTab />;
      case 'integrations':
        return <IntegrationsTab />;
      case 'mcp':
        return <McpTab />;
      case 'workspace':
        return <WorkspaceTab />;
      case 'tasks':
        return <TasksTab />;
      case 'memory':
        return <MemoryTab />;
      case 'autonomous':
        return <AutonomousTab />;
      case 'friends':
        return <FriendsTab />;
      case 'triggers':
        return <TriggersTab />;
      case 'stats':
        return <StatsTab />;
      case 'data':
        return <DataTab />;
      default:
        return null;
    }
  };

  const currentTab = allTabs.find(t => t.id === activeTab);

  return (
    <div className="h-full flex" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Sidebar */}
      <div
        className="w-56 flex-shrink-0 border-r overflow-y-auto"
        style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
      >
        <div className="p-3">
          <div className="flex items-center gap-2 px-3 py-2 mb-2">
            <Settings className="w-5 h-5" style={{ color: 'var(--theme-accent-primary)' }} />
            <span className="font-medium" style={{ color: 'var(--theme-text-primary)' }}>Settings</span>
          </div>
          <nav className="space-y-0.5">
            {sections.map((section, sectionIdx) => (
              <div key={section.header}>
                {sectionIdx > 0 && <div className="my-2" />}
                <div
                  className="px-3 py-1 text-[10px] uppercase tracking-wider font-medium"
                  style={{ color: 'var(--theme-text-muted)' }}
                >
                  {section.header}
                </div>
                {section.tabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm transition ${
                        isActive
                          ? 'bg-[var(--theme-accent-primary)]/20 text-[var(--theme-accent-primary)]'
                          : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)]'
                      }`}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Content Header */}
        <div
          className="px-6 py-4 border-b flex-shrink-0"
          style={{ borderColor: 'var(--theme-border-default)' }}
        >
          <h2 className="text-lg font-medium" style={{ color: 'var(--theme-text-primary)' }}>
            {currentTab?.label}
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--theme-text-muted)' }}>
            {currentTab?.description}
          </p>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-auto p-6">
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
}
