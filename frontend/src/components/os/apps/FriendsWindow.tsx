'use client';

import FriendsTab from '@/components/settings/FriendsTab';

export function FriendsWindow() {
  return (
    <div className="h-full w-full overflow-auto p-4" style={{ background: 'var(--theme-bg-primary)' }}>
      <FriendsTab />
    </div>
  );
}

export default FriendsWindow;
