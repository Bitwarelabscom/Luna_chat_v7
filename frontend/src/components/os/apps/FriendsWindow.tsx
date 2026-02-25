'use client';

import { useState } from 'react';
import FriendsTab from '@/components/settings/FriendsTab';
import GossipQueuePanel from '@/components/friends/GossipQueuePanel';
import { FriendPersonality } from '@/lib/api';

export function FriendsWindow() {
  const [friends, setFriends] = useState<FriendPersonality[]>([]);
  const [pendingDiscussion, setPendingDiscussion] = useState<{ topic: string; friendId?: string } | null>(null);

  const handleStartTheater = (topic: string, friendId?: string) => {
    setPendingDiscussion({ topic, friendId });
  };

  return (
    <div className="h-full w-full flex" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Left: Gossip Queue - 320px fixed */}
      <div className="w-[320px] flex-shrink-0 border-r border-gray-700 overflow-y-auto">
        <GossipQueuePanel
          friends={friends}
          onStartTheater={handleStartTheater}
        />
      </div>

      {/* Right: Friends + Theater panel */}
      <div className="flex-1 overflow-auto p-4">
        <FriendsTab
          onFriendsLoaded={setFriends}
          pendingDiscussion={pendingDiscussion}
          onPendingConsumed={() => setPendingDiscussion(null)}
        />
      </div>
    </div>
  );
}

export default FriendsWindow;
