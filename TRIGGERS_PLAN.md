# Luna Proactive Triggers System - Implementation Plan

## Overview

Enable Luna to proactively message users when events happen, using multiple trigger sources and delivery methods.

## Current State

Luna already has foundational infrastructure:

| Component | Status | Gap |
|-----------|--------|-----|
| Check-in schedules | Schema exists | No job to execute triggers |
| Proactive insights | Working | Not connected to chat |
| Job scheduler | 9 jobs running | No trigger processor job |
| SSE broadcasting | Working | Only for autonomous mode |
| Push notifications | Not implemented | Needs Web Push API |
| Webhook receiver | Not implemented | Needs new endpoint |
| Frontend trigger UI | Not implemented | Needs new settings tab |

---

## Architecture

```
TRIGGER SOURCES                    TRIGGER ENGINE                    DELIVERY
--------------                     --------------                    --------

[Cron Schedule]  ----+                                        +----> [In-App Chat]
[Pattern Match]  ----+----> [Trigger Processor Job] ---+      |
[System Event]   ----+         (runs every minute)     |      +----> [Push Notification]
[Webhook]        ----+                                 |      |
[External API]   ----+              |                  +------+----> [SSE Broadcast]
                                    |                         |
                                    v                         +----> [Email Digest]
                            [Trigger Queue]                         (future)
                            (pending_triggers table)
```

---

## Phase 1: Core Trigger Engine

### 1.1 Database Schema Updates

```sql
-- Extend trigger types
ALTER TYPE trigger_type ADD VALUE 'webhook';
ALTER TYPE trigger_type ADD VALUE 'external';

-- Pending triggers queue
CREATE TABLE pending_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  schedule_id UUID REFERENCES checkin_schedules(id),
  trigger_source TEXT NOT NULL,  -- 'schedule', 'webhook', 'event', 'pattern'
  payload JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending',  -- pending, processing, delivered, failed
  delivery_method TEXT NOT NULL,  -- 'chat', 'push', 'sse'
  session_id UUID REFERENCES sessions(id),  -- target session (optional)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  error_message TEXT
);

-- Push notification subscriptions (Web Push)
CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 1.2 Trigger Processor Job

New background job in `job-runner.ts`:

```typescript
{
  name: 'triggerProcessor',
  interval: 60000, // Every minute
  async run() {
    // 1. Check time-based triggers (cron schedules)
    const pendingCheckins = await checkinsService.getPendingCheckins();
    for (const checkin of pendingCheckins) {
      await enqueueTrigger(checkin);
    }

    // 2. Check pattern-based triggers
    await evaluatePatternTriggers();

    // 3. Process pending trigger queue
    await processTriggerQueue();
  }
}
```

### 1.3 Trigger Delivery Service

New service: `src/triggers/delivery.service.ts`

```typescript
async function deliverTrigger(trigger: PendingTrigger): Promise<void> {
  const message = await renderTriggerMessage(trigger);

  switch (trigger.deliveryMethod) {
    case 'chat':
      await deliverToChat(trigger.userId, trigger.sessionId, message);
      break;
    case 'push':
      await deliverPushNotification(trigger.userId, message);
      break;
    case 'sse':
      await broadcastToUser(trigger.userId, message);
      break;
  }
}
```

---

## Phase 2: Delivery Methods

### 2.1 In-App Chat Delivery

- Create new session or use existing "Luna Updates" session
- Add message with `role: 'assistant'`
- Optionally mark as "proactive" for UI badge

```typescript
async function deliverToChat(userId: string, sessionId: string | null, message: string) {
  // Get or create "Luna Updates" session
  const session = sessionId
    ? await sessionService.getSession(sessionId)
    : await getOrCreateUpdatesSession(userId);

  // Add Luna's proactive message
  await sessionService.addMessage(session.id, {
    role: 'assistant',
    content: message,
    metadata: { proactive: true }
  });

  // Notify frontend via SSE
  await broadcastToUser(userId, {
    type: 'new_message',
    sessionId: session.id,
    message
  });
}
```

### 2.2 Push Notifications (Web Push API)

New service: `src/triggers/push.service.ts`

```typescript
import webpush from 'web-push';

// Configure VAPID keys (generate once, store in secrets)
webpush.setVapidDetails(
  'mailto:luna@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function sendPushNotification(userId: string, payload: PushPayload) {
  const subscriptions = await getPushSubscriptions(userId);

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
    } catch (error) {
      if (error.statusCode === 410) {
        // Subscription expired, remove it
        await removePushSubscription(sub.id);
      }
    }
  }
}
```

Frontend service worker for receiving push:

```typescript
// public/sw.js
self.addEventListener('push', (event) => {
  const data = event.data.json();
  self.registration.showNotification('Luna', {
    body: data.message,
    icon: '/luna-icon.png',
    data: { sessionId: data.sessionId }
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  clients.openWindow(`/chat/${event.notification.data.sessionId}`);
});
```

### 2.3 SSE User Broadcast

Extend existing SSE infrastructure:

```typescript
// New endpoint: GET /api/triggers/live
router.get('/live', authenticate, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const userId = req.user.id;
  addUserSubscriber(userId, (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  });

  req.on('close', () => removeUserSubscriber(userId));
});
```

---

## Phase 3: Trigger Sources

### 3.1 Time-Based Triggers (Enhanced)

- Already implemented in `checkins.service.ts`
- Add proper cron parsing with `cron-parser` library
- Support timezone-aware scheduling

### 3.2 Pattern-Based Triggers

Detect user patterns and trigger accordingly:

```typescript
const PATTERN_DETECTORS = {
  'mood_low': async (userId) => {
    const recentMood = await moodService.getRecentMood(userId, 3);
    return recentMood.every(m => m.sentiment < -0.3);
  },

  'long_absence': async (userId) => {
    const lastActivity = await getLastUserActivity(userId);
    const daysSince = daysBetween(lastActivity, new Date());
    return daysSince >= 3;
  },

  'high_productivity': async (userId) => {
    const tasksCompleted = await getTasksCompletedToday(userId);
    return tasksCompleted >= 5;
  },

  'energy_dip': async (userId) => {
    const energyPattern = await energyService.getCurrentPattern(userId);
    return energyPattern.isLowEnergy;
  }
};
```

### 3.3 Event-Based Triggers

Subscribe to internal events:

```typescript
// Event emitter pattern
eventBus.on('task.completed', async (event) => {
  await evaluateEventTriggers('task_completed', event);
});

eventBus.on('goal.progress', async (event) => {
  if (event.milestone) {
    await enqueueTrigger({
      userId: event.userId,
      source: 'event',
      type: 'goal_milestone',
      payload: event
    });
  }
});
```

### 3.4 Webhook Receiver (External Integrations)

New endpoint: `POST /api/triggers/webhook/:hookId`

```typescript
router.post('/webhook/:hookId', async (req, res) => {
  const hook = await getWebhook(req.params.hookId);
  if (!hook) return res.status(404).json({ error: 'Unknown webhook' });

  // Validate signature if configured
  if (hook.secret && !validateSignature(req, hook.secret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  await enqueueTrigger({
    userId: hook.userId,
    source: 'webhook',
    type: hook.name,
    payload: req.body,
    deliveryMethod: hook.deliveryMethod
  });

  res.json({ status: 'queued' });
});
```

### 3.5 External API Polling

Job for polling external APIs (email, calendar):

```typescript
{
  name: 'externalApiPoller',
  interval: 300000, // Every 5 minutes
  async run() {
    const integrations = await getActiveIntegrations();

    for (const integration of integrations) {
      switch (integration.type) {
        case 'gmail':
          await checkGmailForNewEmails(integration);
          break;
        case 'google_calendar':
          await checkUpcomingEvents(integration);
          break;
      }
    }
  }
}
```

---

## Phase 4: Frontend Integration

### 4.1 Settings Tab for Triggers

New component: `frontend/src/components/settings/TriggersTab.tsx`

- Enable/disable trigger types
- Configure delivery preferences
- Create custom triggers (cron, patterns)
- Manage webhooks
- View trigger history

### 4.2 Push Notification Permission

```typescript
async function subscribeToPush() {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: VAPID_PUBLIC_KEY
  });

  await api.post('/api/triggers/push/subscribe', subscription);
}
```

### 4.3 SSE Connection for Live Updates

```typescript
// In ChatArea or App component
useEffect(() => {
  const eventSource = new EventSource('/api/triggers/live');

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'new_message') {
      // Show notification or update chat
      showNotification(data);
    }
  };

  return () => eventSource.close();
}, []);
```

### 4.4 Notification Badge

Show badge when Luna has proactive messages:

```typescript
// Use existing proactive_insights or new pending_triggers
const { data: pendingCount } = useQuery('pendingTriggers',
  () => api.get('/api/triggers/pending/count')
);

return (
  <Badge count={pendingCount}>
    <ChatIcon />
  </Badge>
);
```

---

## Phase 5: Use Case Implementations

### 5.1 Reminders

```typescript
// User creates reminder via chat: "Remind me to call mom at 5pm"
await createCheckinSchedule(userId, {
  name: 'Call mom',
  triggerType: 'time',
  triggerConfig: { cron: '0 17 * * *', timezone: 'America/New_York' },
  promptTemplate: 'Hey! Just a reminder: Call mom',
  isEnabled: true
});
```

### 5.2 Proactive Insights

```typescript
// RSS relevance analyzer creates insight
await createInsight(userId, {
  sourceType: 'rss_article',
  insightTitle: 'Article you might like',
  insightContent: 'Based on your interests, I found this article...',
  priority: 6
});

// Trigger processor picks it up and delivers
```

### 5.3 Companion Check-ins

Enable built-in check-ins:

- Morning check-in (9am)
- Weekly goals review (Monday)
- Long absence support (after 3 days)
- Low mood support (detected pattern)

### 5.4 External Integration Example (Gmail)

```typescript
// When new email arrives (via webhook or polling)
await enqueueTrigger({
  userId,
  source: 'external',
  type: 'new_email',
  payload: {
    from: email.from,
    subject: email.subject,
    preview: email.snippet
  },
  promptTemplate: 'You received an email from {from}: "{subject}"'
});
```

---

## Implementation Order

1. **Phase 1.2** - Trigger processor job (critical path)
2. **Phase 2.1** - In-app chat delivery
3. **Phase 4.1** - Settings UI for triggers
4. **Phase 2.3** - SSE user broadcast
5. **Phase 3.1-3.3** - Enhance trigger sources
6. **Phase 2.2** - Push notifications
7. **Phase 3.4-3.5** - Webhooks and external APIs

---

## Files to Create/Modify

### New Files
- `src/triggers/trigger.service.ts` - Core trigger engine
- `src/triggers/delivery.service.ts` - Delivery methods
- `src/triggers/push.service.ts` - Web Push implementation
- `src/triggers/webhook.routes.ts` - Webhook endpoints
- `src/triggers/events.ts` - Internal event bus
- `frontend/src/components/settings/TriggersTab.tsx`
- `frontend/public/sw.js` - Service worker

### Modified Files
- `src/jobs/job-runner.ts` - Add trigger processor job
- `src/db/migrations/` - New migration for schema
- `src/routes/index.ts` - Register trigger routes
- `frontend/src/app/layout.tsx` - SSE connection
- `frontend/src/components/settings/SettingsModal.tsx` - Add triggers tab

---

## Questions Resolved

- **Trigger sources**: All (time, pattern, event, webhook, external)
- **Delivery methods**: In-app chat + Push notifications
- **Use cases**: Reminders, insights, check-ins, integrations
