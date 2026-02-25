'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { LucideIcon, Zap, BookOpen, BarChart2, HelpCircle, Terminal } from 'lucide-react';
import { BUILTIN_SKILLS, fetchUserSkills, getSkillByName, type Skill } from '@/lib/skills';
import { settingsApi } from '@/lib/api/settings';

export interface DropdownItem {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  action: () => void | Promise<void>;
  // For sub-menus (model list, skill list)
  group?: string;
}

export interface ActiveSkill {
  name: string;
  content: string;
}

interface UseSlashCommandsOptions {
  addSystemBubble: (text: string) => void;
  sessionId: string | null;
  mode?: string;
}

export function useSlashCommands({ addSystemBubble, sessionId, mode }: UseSlashCommandsOptions) {
  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownItems, setDropdownItems] = useState<DropdownItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeSkill, setActiveSkill] = useState<ActiveSkill | null>(null);
  const [activeModelLabel, setActiveModelLabel] = useState<string | null>(null);

  const userSkillsRef = useRef<Skill[]>([]);
  const loadedUserSkillsRef = useRef(false);

  // Clear state when session changes
  useEffect(() => {
    setActiveSkill(null);
  }, [sessionId]);

  // Lazy-load user skills
  const ensureUserSkills = useCallback(async () => {
    if (!loadedUserSkillsRef.current) {
      loadedUserSkillsRef.current = true;
      userSkillsRef.current = await fetchUserSkills();
    }
  }, []);

  // Build base commands list
  const buildBaseCommands = useCallback((): DropdownItem[] => {
    return [
      {
        id: 'usage',
        label: '/usage',
        description: 'Show token usage summary',
        icon: BarChart2,
        action: async () => {
          setInputValue('');
          setShowDropdown(false);
          try {
            const stats = await settingsApi.getDailyTokens();
            const total = stats.totalTokens.toLocaleString();
            const cost = stats.estimatedCost > 0 ? `~$${stats.estimatedCost.toFixed(2)}` : 'free';
            const models = Object.entries(stats.byModel || {});
            const modelLine = models.length > 0
              ? models.map(([m, s]) => `${m}: ${s.total.toLocaleString()}`).join(', ')
              : 'no model data';
            addSystemBubble(
              `---- Usage ----\nToday:   ${total} tokens (${cost})\nModel:   ${modelLine}\n---- /usage ----`
            );
          } catch {
            addSystemBubble('Failed to load usage stats.');
          }
        },
      },
      {
        id: 'model',
        label: '/model',
        description: 'Switch AI model',
        icon: Zap,
        action: () => {
          setInputValue('/model ');
          buildModelSubcommands('');
        },
      },
      {
        id: 'skill',
        label: '/skill',
        description: 'Load a skill into context',
        icon: BookOpen,
        action: () => {
          setInputValue('/skill ');
          buildSkillSubcommands('');
        },
      },
      {
        id: 'help',
        label: '/help',
        description: 'Show all available commands',
        icon: HelpCircle,
        action: () => {
          setInputValue('');
          setShowDropdown(false);
          addSystemBubble(
            `---- Commands ----\n/usage         Show token usage summary\n/model         Switch AI model\n/skill <name>  Load a skill into context\n/skill list    List available skills\n/skill off     Remove active skill\n/help          Show this help\n---- /help ----`
          );
        },
      },
    ];
  }, [addSystemBubble]);

  const buildModelSubcommands = useCallback(async (query: string) => {
    try {
      const result = await settingsApi.getAvailableModels();
      const presets: Array<{ name: string; provider: string; model: string; label?: string }> =
        typeof window !== 'undefined'
          ? JSON.parse(localStorage.getItem('luna-model-presets') || '[]')
          : [];

      const items: DropdownItem[] = [];

      // Presets first
      presets.forEach((preset) => {
        const label = preset.label || preset.model;
        if (query && !label.toLowerCase().includes(query.toLowerCase()) && !preset.name.toLowerCase().includes(query.toLowerCase())) return;
        items.push({
          id: `preset-${preset.name}`,
          label: preset.name,
          description: `${label} (preset)`,
          icon: Zap,
          group: 'Presets',
          action: async () => {
            setInputValue('');
            setShowDropdown(false);
            try {
              await settingsApi.setModelConfig('main_chat', preset.provider, preset.model);
              setActiveModelLabel(preset.label || preset.model);
              addSystemBubble(`Model switched to ${preset.label || preset.model}`);
            } catch {
              addSystemBubble('Failed to switch model.');
            }
          },
        });
      });

      // All models from providers
      (result.providers || []).forEach((provider) => {
        (provider.models || []).forEach((model) => {
          if (query && !model.name.toLowerCase().includes(query.toLowerCase()) && !model.id.toLowerCase().includes(query.toLowerCase())) return;
          items.push({
            id: `model-${provider.id}-${model.id}`,
            label: model.id,
            description: model.name,
            icon: Terminal,
            group: provider.name,
            action: async () => {
              setInputValue('');
              setShowDropdown(false);
              try {
                await settingsApi.setModelConfig('main_chat', provider.id, model.id);
                setActiveModelLabel(model.name);
                addSystemBubble(`Model switched to ${model.name}`);
              } catch {
                addSystemBubble('Failed to switch model.');
              }
            },
          });
        });
      });

      setDropdownItems(items.slice(0, 20));
      setSelectedIndex(0);
      setShowDropdown(items.length > 0);
    } catch {
      setShowDropdown(false);
    }
  }, [addSystemBubble]);

  const buildSkillSubcommands = useCallback(async (query: string) => {
    await ensureUserSkills();
    const allSkills = [...BUILTIN_SKILLS, ...userSkillsRef.current];

    const items: DropdownItem[] = [];

    // Special commands
    if (!query || 'list'.startsWith(query.toLowerCase())) {
      items.push({
        id: 'skill-list',
        label: 'list',
        description: 'Show all available skills',
        icon: BookOpen,
        action: async () => {
          await ensureUserSkills();
          const all = [...BUILTIN_SKILLS, ...userSkillsRef.current];
          const builtins = all.filter(s => s.source === 'builtin').map(s => `  ${s.name} - ${s.description}`).join('\n');
          const workspace = all.filter(s => s.source === 'workspace').map(s => `  ${s.name}`).join('\n');
          let text = `---- Skills ----\nBuilt-in:\n${builtins}`;
          if (workspace) text += `\nWorkspace:\n${workspace}`;
          text += '\n---- /skill ----';
          addSystemBubble(text);
          setInputValue('');
          setShowDropdown(false);
        },
      });
    }

    if (!query || 'off'.startsWith(query.toLowerCase())) {
      items.push({
        id: 'skill-off',
        label: 'off',
        description: 'Remove active skill',
        icon: Terminal,
        action: () => {
          setActiveSkill(null);
          addSystemBubble('Skill removed.');
          setInputValue('');
          setShowDropdown(false);
        },
      });
    }

    // Matching skills
    allSkills.forEach((skill) => {
      if (query && !skill.name.toLowerCase().includes(query.toLowerCase())) return;
      items.push({
        id: `skill-${skill.name}`,
        label: skill.name,
        description: skill.description,
        icon: BookOpen,
        group: skill.source === 'builtin' ? 'Built-in' : 'Workspace',
        action: () => {
          setActiveSkill({ name: skill.name, content: skill.content });
          addSystemBubble(`Skill loaded: ${skill.name}`);
          setInputValue('');
          setShowDropdown(false);
        },
      });
    });

    setDropdownItems(items);
    setSelectedIndex(0);
    setShowDropdown(items.length > 0);
  }, [ensureUserSkills, addSystemBubble]);

  const handleInputChange = useCallback(async (value: string) => {
    setInputValue(value);

    if (!value.startsWith('/')) {
      setShowDropdown(false);
      return;
    }

    const withoutSlash = value.slice(1);

    // Detect sub-commands
    if (withoutSlash.startsWith('model ') || withoutSlash === 'model') {
      const query = withoutSlash.startsWith('model ') ? withoutSlash.slice(6) : '';
      buildModelSubcommands(query);
      return;
    }

    if (withoutSlash.startsWith('skill ') || withoutSlash === 'skill') {
      const query = withoutSlash.startsWith('skill ') ? withoutSlash.slice(6) : '';
      buildSkillSubcommands(query);
      return;
    }

    // Base command list
    const base = buildBaseCommands();
    const filtered = withoutSlash
      ? base.filter(cmd => cmd.label.toLowerCase().includes(withoutSlash.toLowerCase()) || cmd.description.toLowerCase().includes(withoutSlash.toLowerCase()))
      : base;

    setDropdownItems(filtered);
    setSelectedIndex(0);
    setShowDropdown(filtered.length > 0);
  }, [buildBaseCommands, buildModelSubcommands, buildSkillSubcommands]);

  // Returns true if a slash command was executed (caller should not send the message)
  const handleSubmit = useCallback(async (): Promise<boolean> => {
    const trimmed = inputValue.trim();
    if (!trimmed.startsWith('/')) return false;

    // Handle direct skill shorthand: /skill <name>
    const skillMatch = trimmed.match(/^\/skill\s+(\S+)$/i);
    if (skillMatch) {
      const skillName = skillMatch[1];
      if (skillName === 'off') {
        setActiveSkill(null);
        addSystemBubble('Skill removed.');
        setInputValue('');
        setShowDropdown(false);
        return true;
      }
      if (skillName === 'list') {
        await buildSkillSubcommands('list');
        // Trigger list action
        const listItem = dropdownItems.find(i => i.id === 'skill-list');
        if (listItem) await listItem.action();
        else {
          await ensureUserSkills();
          const all = [...BUILTIN_SKILLS, ...userSkillsRef.current];
          addSystemBubble(`Skills: ${all.map(s => s.name).join(', ')}`);
        }
        setInputValue('');
        setShowDropdown(false);
        return true;
      }
      const skill = getSkillByName(skillName, userSkillsRef.current);
      if (skill) {
        setActiveSkill({ name: skill.name, content: skill.content });
        addSystemBubble(`Skill loaded: ${skill.name}`);
        setInputValue('');
        setShowDropdown(false);
        return true;
      }
      addSystemBubble(`Skill not found: "${skillName}". Type /skill list to see available skills.`);
      setInputValue('');
      setShowDropdown(false);
      return true;
    }

    // If dropdown is showing with exactly one item selected, run it
    if (showDropdown && dropdownItems.length > 0) {
      const item = dropdownItems[selectedIndex] || dropdownItems[0];
      await item.action();
      return true;
    }

    // Try exact match
    if (trimmed === '/usage' || trimmed === '/help') {
      const base = buildBaseCommands();
      const cmd = base.find(c => c.label === trimmed);
      if (cmd) {
        await cmd.action();
        return true;
      }
    }

    return false;
  }, [inputValue, showDropdown, dropdownItems, selectedIndex, addSystemBubble, buildSkillSubcommands, buildBaseCommands, ensureUserSkills]);

  const handleKeyDown = useCallback(async (e: React.KeyboardEvent): Promise<boolean> => {
    if (!showDropdown) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, dropdownItems.length - 1));
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setShowDropdown(false);
      return true;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (dropdownItems.length > 0) {
        e.preventDefault();
        const item = dropdownItems[selectedIndex];
        if (item) await item.action();
        return true;
      }
    }
    if (e.key === 'Tab') {
      if (dropdownItems.length > 0) {
        e.preventDefault();
        const item = dropdownItems[selectedIndex];
        if (item) await item.action();
        return true;
      }
    }
    return false;
  }, [showDropdown, dropdownItems, selectedIndex]);

  const handleSelect = useCallback(async (index: number) => {
    const item = dropdownItems[index];
    if (item) await item.action();
  }, [dropdownItems]);

  // Badge label: "skill-name" or null
  const activeBadgeLabel = activeSkill ? activeSkill.name : null;

  const clearActiveSkill = useCallback(() => {
    setActiveSkill(null);
  }, []);

  return {
    inputValue,
    setInputValue,
    showDropdown,
    setShowDropdown,
    dropdownItems,
    selectedIndex,
    handleInputChange,
    handleSubmit,
    handleKeyDown,
    handleSelect,
    activeSkill,
    activeModelLabel,
    activeBadgeLabel,
    clearActiveSkill,
    mode,
  };
}
