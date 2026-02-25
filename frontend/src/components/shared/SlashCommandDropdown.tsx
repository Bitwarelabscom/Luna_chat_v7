'use client';

import { type DropdownItem } from '@/hooks/useSlashCommands';

interface SlashCommandDropdownProps {
  items: DropdownItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

export function SlashCommandDropdown({ items, selectedIndex, onSelect }: SlashCommandDropdownProps) {
  if (items.length === 0) return null;

  // Group items
  const groups: Map<string, DropdownItem[]> = new Map();
  const ungrouped: DropdownItem[] = [];

  items.forEach(item => {
    if (item.group) {
      if (!groups.has(item.group)) groups.set(item.group, []);
      groups.get(item.group)!.push(item);
    } else {
      ungrouped.push(item);
    }
  });

  // Flat list with indices
  const flatList: DropdownItem[] = [
    ...ungrouped,
    ...Array.from(groups.values()).flat(),
  ];

  let globalIndex = 0;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden z-50 max-h-64 overflow-y-auto">
      {/* Ungrouped items */}
      {ungrouped.map((item) => {
        const idx = globalIndex++;
        const Icon = item.icon;
        const isSelected = idx === selectedIndex;
        return (
          <button
            key={item.id}
            className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors ${
              isSelected ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-700'
            }`}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(idx);
            }}
          >
            <Icon size={14} className={isSelected ? 'text-slate-300' : 'text-gray-500'} />
            <span className="font-medium text-blue-300 w-24 shrink-0">{item.label}</span>
            <span className="text-gray-500 text-xs truncate">{item.description}</span>
          </button>
        );
      })}

      {/* Grouped items */}
      {Array.from(groups.entries()).map(([groupName, groupItems]) => (
        <div key={groupName}>
          <div className="px-3 py-1 text-xs text-gray-600 bg-gray-850 border-t border-gray-700/50 font-medium uppercase tracking-wide mt-1">
            {groupName}
          </div>
          {groupItems.map((item) => {
            const idx = globalIndex++;
            const Icon = item.icon;
            const isSelected = idx === selectedIndex;
            return (
              <button
                key={item.id}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors ${
                  isSelected ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-700'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(idx);
                }}
              >
                <Icon size={14} className={isSelected ? 'text-slate-300' : 'text-gray-500'} />
                <span className="font-medium w-32 shrink-0 truncate">{item.label}</span>
                <span className="text-gray-500 text-xs truncate">{item.description}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
