# Luna Proactive Communication Capabilities

This document describes my ability to initiate conversations with users proactively, rather than waiting for them to message me first.

## Overview

I have a trigger system that allows me to reach out to users based on schedules, detected patterns, system events, external webhooks, and proactive insights. Triggers are processed every minute by a background job and delivered through multiple channels.

## Trigger Sources

### 1. Time-Based Triggers (Schedule)

Cron-scheduled messages that fire at specific times.

**Status: IMPLEMENTED**

| Built-in Schedule | Cron | Default State | Purpose |
|-------------------|------|---------------|---------|
| Morning Check-in | `0 9 * * *` | Disabled | Daily morning wellness check |
| Weekly Goals Review | `0 10 * * 1` | Disabled | Monday goal-setting prompt |
| Task Reminder | Event-based | Enabled | Remind about upcoming tasks |
| Long Absence | Pattern-based | Disabled | Reconnect after 3+ days |
| Low Mood Support | Pattern-based | Disabled | Support during difficult times |

Users can create custom schedules with their own cron expressions and message templates.

### 2. Pattern-Based Triggers

I detect behavioral patterns and can reach out when conditions are met.

**Status: IMPLEMENTED**

| Pattern | Detection Logic | Cooldown |
|---------|-----------------|----------|
| `mood_low` | Average sentiment below -0.3 across last 2-3 mood entries in 24 hours | 4 hours |
| `long_absence` | No messages for 3+ days | 4 hours |
| `high_productivity` | 5+ tasks completed in 24 hours | 4 hours |

Pattern triggers evaluate conditions periodically and only fire when the pattern is detected AND the cooldown period has elapsed.

### 3. Event-Based Triggers

System events that can trigger immediate outreach.

**Status: IMPLEMENTED**

| Event Type | When It Fires | Use Case |
|------------|---------------|----------|
| `task_due` | Task deadline approaching | Remind user about pending work |
| `direct_message` | Programmatically initiated | Internal system notifications |

Events are fired by other services when significant actions occur. Users can create custom event-based schedules tied to specific event types.

### 4. Insight-Based Triggers

High-priority proactive insights trigger notifications.

**Status: IMPLEMENTED**

Insights with priority >= 7 that are:
- Not yet shared with the user
- Not dismissed
- Not expired

These are processed and queued for delivery automatically.

### 5. Webhook Triggers

External services can trigger my outreach via HTTP webhooks.

**Status: PLANNED**

Webhooks will allow:
- External calendar integrations
- Third-party notification forwarding
- Custom automation triggers

### 6. External API Polling

Periodic checks of connected services.

**Status: PLANNED**

Will support:
- Gmail new email detection
- Google Calendar upcoming events
- Other OAuth-connected services

## Delivery Methods

### 1. In-App Chat (Default)

**Status: IMPLEMENTED**

- Messages delivered to a dedicated "Luna Updates" session
- Full conversation history preserved
- User can respond directly
- SSE broadcast notifies frontend if user is online

### 2. SSE (Server-Sent Events)

**Status: IMPLEMENTED**

- Real-time browser notifications
- Falls back to chat delivery if user is offline
- Requires active frontend connection

### 3. Push Notifications (Web Push)

**Status: PARTIALLY IMPLEMENTED**

- Infrastructure exists for push subscriptions
- Requires VAPID keys configuration
- Falls back to chat if no subscriptions

### 4. Telegram

**Status: IMPLEMENTED**

- Full bidirectional chat support
- Users link via code from Settings > Triggers > Telegram
- Commands: /start, /status, /unlink, /help
- Messages can be persisted to chat history (configurable)

## User Notification Preferences

Users control my proactive behavior through notification preferences:

| Preference | Default | Description |
|------------|---------|-------------|
| `enableChatNotifications` | true | Allow in-app messages |
| `enablePushNotifications` | false | Allow browser push |
| `enableTelegram` | false | Allow Telegram delivery |
| `persistTelegramToChat` | true | Copy Telegram messages to chat |
| `quietHoursEnabled` | false | Respect quiet hours |
| `quietHoursStart` | 22:00 | Start of quiet period |
| `quietHoursEnd` | 08:00 | End of quiet period |
| `timezone` | UTC | User's timezone |
| `enableReminders` | true | Allow task reminders |
| `enableCheckins` | true | Allow scheduled check-ins |
| `enableInsights` | true | Allow insight notifications |
| `enableAchievements` | true | Allow achievement notifications |

During quiet hours, I will NOT send any proactive messages.

## Trigger Priority System

Triggers have priority levels (1-10) that determine processing order:

| Priority | Typical Use |
|----------|-------------|
| 8+ | Urgent events, time-sensitive reminders |
| 7 | Pattern detections (mood, absence) |
| 6 | Scheduled check-ins |
| 5 | Standard notifications, insights |
| 1-4 | Low priority, batched delivery |

Higher priority triggers are processed first.

## Trigger Processing Flow

1. **triggerProcessor** job runs every 60 seconds
2. Checks for pending time-based triggers (cron schedules)
3. Evaluates pattern-based triggers
4. Processes insight-based triggers
5. Enqueues all triggered items to pending_triggers queue
6. Delivery service processes queue by priority
7. Each trigger attempts delivery via configured method
8. On failure, retries up to max_attempts (default: 3)
9. History recorded for analytics

## Message Templates

Trigger messages support template variables:

```
Template: "Reminder: {task_title} is due {due_date}"
Data: { task_title: "Review proposal", due_date: "tomorrow" }
Result: "Reminder: Review proposal is due tomorrow"
```

Variables are replaced using `{key}` or `{nested.key}` syntax.

## What I Can Discuss With Users

When users ask about my proactive capabilities, I can:

1. Explain that I can reach out on schedules, patterns, or events
2. Help them configure check-in schedules
3. Explain the available delivery methods
4. Help set up Telegram integration
5. Configure quiet hours and notification preferences
6. Create custom reminders ("remind me to X at Y time")
7. Explain pattern detection (mood tracking, absence detection)

## Limitations

1. Push notifications require browser permission and VAPID configuration
2. Telegram requires bot token setup by admin
3. Email digest delivery is planned but not yet implemented
4. External API polling (Gmail, Calendar) is planned but not yet implemented
5. Quiet hours use simple time comparison - timezone handling is basic
6. Pattern detection requires sufficient historical data

## Technical Reference

- Trigger service: `src/triggers/trigger.service.ts`
- Delivery service: `src/triggers/delivery.service.ts`
- Telegram service: `src/triggers/telegram.service.ts`
- Check-in schedules: `src/abilities/checkins.service.ts`
- Job runner: `src/jobs/job-runner.ts` (triggerProcessor job)
- Database tables: `pending_triggers`, `trigger_history`, `checkin_schedules`, `notification_preferences`, `telegram_connections`
