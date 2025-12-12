'use client';

import TasksTab from '@/components/settings/TasksTab';

export function TasksWindow() {
  return (
    <div className="h-full w-full overflow-auto p-4" style={{ background: 'var(--theme-bg-primary)' }}>
      <TasksTab />
    </div>
  );
}

export default TasksWindow;
