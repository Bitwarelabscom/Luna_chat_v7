# CEO Luna Continuous Monitoring Mode

This repository now includes a full backend implementation of continuous CEO monitoring with:

- Pre-revenue and normal finance modes
- Daily/weekly/bi-weekly monitoring loops
- Alerting with P1/P2/P3 severities
- Weekly CEO Brief + bi-weekly efficiency audit
- Market radar ingestion from Newsfetcher
- Autopost queue with approval/auto modes
- Telegram command intake for manual logging

## Telegram commands

Run these in a linked Luna Telegram chat:

- `ceo status`
- `ceo daily`
- `ceo brief`
- `ceo audit`
- `ceo config mode=pre_revenue timezone=Europe/Stockholm no_build_days=2 no_experiment_days=3`

Logging commands:

- `expense 2026-02-22 google_pro_ai 20 usd tool monthly`
- `income 2026-02-22 stripe 120 usd subscription monthly`
- `build luna-chat 4h auth refactor stage=build impact=high`
- `experiment x_thread channel=x cost=0 leads=3 outcome=pending`
- `lead inbound source=x status=new`
- `project luna-chat stage=build revenue=2500 hours=40 win=0.4 leverage=1.2 risk=2 confidence=0.7`

Autopost commands:

- `autopost list`
- `autopost show <id>`
- `autopost channels`
- `autopost draft x Shipping today: ...`
- `autopost approve <id>`
- `autopost cancel <id>`
- `autopost run`

## API routes

Mounted at `/api/ceo`:

- `GET /config`, `PUT /config`
- `GET /dashboard?days=30`
- `POST /log/expense`, `/log/income`, `/log/build`, `/log/experiment`, `/log/lead`, `/log/project`
- `GET /autopost/queue`, `GET /autopost/channels`, `PUT /autopost/channels/:channel`
- `POST /autopost/drafts`, `POST /autopost/:id/approve`, `POST /autopost/:id/cancel`
- `POST /run/daily`, `/run/weekly`, `/run/biweekly`, `/run/autopost`, `/run/cycle`

## Scheduler hooks

Job runner now includes:

- `ceoMonitoring` (every minute, timezone slot aware)
- `ceoAutopostWorker` (every 5 minutes)
- `ceoMaintenance` (daily retention cleanup)

## Database migration

Run migrations to create CEO tables:

- `src/db/migrations/084_ceo_monitoring_mode.sql`

Use:

```bash
npm run migrate
```
