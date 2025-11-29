'use client';

import { useState, useEffect } from 'react';
import { X, MessageSquare, BarChart3, Database, Cpu, Palette } from 'lucide-react';
import AppearanceTab from './settings/AppearanceTab';
import PromptsTab from './settings/PromptsTab';
import StatsTab from './settings/StatsTab';
import DataTab from './settings/DataTab';
import ModelsTab from './settings/ModelsTab';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabId = 'appearance' | 'prompts' | 'models' | 'stats' | 'data';

const tabs: { id: TabId; label: string; icon: typeof MessageSquare }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'prompts', label: 'System Prompts', icon: MessageSquare },
  { id: 'models', label: 'Models', icon: Cpu },
  { id: 'stats', label: 'Stats', icon: BarChart3 },
  { id: 'data', label: 'Data Management', icon: Database },
];

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('appearance');

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-theme-bg-secondary rounded-xl shadow-2xl border border-theme-border flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-theme-border">
          <h2 className="text-xl font-semibold text-theme-text-primary">Settings</h2>
          <button
            onClick={onClose}
            className="p-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-theme-border overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-3 text-sm font-medium transition whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'text-theme-accent-primary border-b-2 border-theme-accent-primary -mb-px'
                    : 'text-theme-text-muted hover:text-theme-text-primary'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'appearance' && <AppearanceTab />}
          {activeTab === 'prompts' && <PromptsTab />}
          {activeTab === 'models' && <ModelsTab />}
          {activeTab === 'stats' && <StatsTab />}
          {activeTab === 'data' && <DataTab />}
        </div>
      </div>
    </div>
  );
}
