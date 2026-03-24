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
- `ceoBuildCheckin` (every 5 minutes)
- `ceoMaintenance` (daily retention cleanup)
- `ceoOrgWeeklyPlanner` (hourly, gated once/week)
- `ceoOrgDailyDepartmentCheck` (hourly, gated once/day)
- `ceoProposalExpiry` (daily, expires proposals older than 7 days)

## Proposal Protocol (March 2026)

CEO Luna now **proposes before acting**. Weekly planning and daily department checks create proposals instead of auto-executing.

- P1/P2 proposals sent to Telegram with Approve/Reject inline buttons
- Batch approve/reject available in the OrgPanel frontend
- Proposals expire after 7 days via `ceoProposalExpiry` job
- Staff chat with 5 departments (Economy/Marketing/Development/Research/Meeting)
- Meeting orchestration: pick departments -> parallel dept calls -> synthesis

API routes for proposals:

- `GET /api/ceo/proposals`, `POST /api/ceo/proposals`
- `POST /api/ceo/proposals/:id/approve`, `POST /api/ceo/proposals/:id/reject`
- `POST /api/ceo/proposals/batch/approve`
- `GET/POST /api/ceo/staff/sessions`, `GET/POST /api/ceo/staff/messages/:sessionId`

## Database migrations

CEO tables are created by multiple migrations:

- `src/db/migrations/084_ceo_monitoring_mode.sql` (base tables)
- `src/db/migrations/086_ceo_builds.sql` (build tracker)
- `src/db/migrations/101_currency_support.sql` (proposals, staff chat)
- `src/db/migrations/102_ceo_office_memos.sql` (memos)
- `src/db/migrations/103_ceo_telegram.sql` (telegram integration)

Migrations run automatically on API startup.
