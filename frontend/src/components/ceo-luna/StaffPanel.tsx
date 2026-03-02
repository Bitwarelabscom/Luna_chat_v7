'use client';

import { useCEOLunaStore } from '@/lib/ceo-luna-store';
import { StaffDeptChat } from './StaffDeptChat';
import { MeetingChat } from './MeetingChat';

const STAFF_TABS = [
  { id: 'economy' as const, label: 'Economy', color: 'text-emerald-400' },
  { id: 'marketing' as const, label: 'Marketing', color: 'text-purple-400' },
  { id: 'development' as const, label: 'Development', color: 'text-blue-400' },
  { id: 'research' as const, label: 'Research', color: 'text-amber-400' },
  { id: 'meeting' as const, label: 'Meeting', color: 'text-white' },
] as const;

export function StaffPanel() {
  const { staffActiveTab, setStaffActiveTab } = useCEOLunaStore();

  return (
    <div className="flex flex-col h-full bg-gray-950 overflow-hidden">
      {/* Sub-tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-700 bg-gray-900 shrink-0">
        {STAFF_TABS.map(({ id, label, color }) => (
          <button
            key={id}
            onClick={() => setStaffActiveTab(id)}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              staffActiveTab === id
                ? `bg-slate-700 ${color}`
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {staffActiveTab === 'meeting' ? (
          <MeetingChat />
        ) : (
          <StaffDeptChat dept={staffActiveTab} />
        )}
      </div>
    </div>
  );
}
