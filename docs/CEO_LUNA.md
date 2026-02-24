# CEO Luna - Business Intelligence & Operations Hub

**Version**: 7.x
**Last Updated**: February 2026

---

## Overview

CEO Luna is a dedicated business operations workspace built into Luna Chat. It gives you a real-time command center for tracking finances, managing build sessions, monitoring competitors, scheduling automated social posts, and staying in strategic conversation with an AI co-founder persona.

The workspace opens as a full 1400x860 window with a persistent KPI strip at the top, a document file tree on the left, and a tabbed panel on the right covering Chat, Dashboard, Radar, Autopost, Builds, and Log.

---

## Layout

```
+----------------------------------------------------------+
|  KPI Strip: Net P&L | Build Hours | Leads | Alerts       |
+------------+---------------------------------------------+
|            |  [ Viewer | Chat | Dashboard | Radar |      |
|  File Tree |    Autopost | Builds | Log ]                |
|            |                                             |
|  Documents |  <Tab content>                              |
|  Plans     |                                             |
|  Week      |                                             |
+------------+---------------------------------------------+
```

### KPI Strip (top, always visible)

Refreshes every 5 minutes and shows:

| KPI | Description |
|-----|-------------|
| **Net P&L** | Total income minus expenses (current month) |
| **Build Hours** | Accumulated tracked build time (current month) |
| **Leads** | Open lead count |
| **Alerts** | Count of unacknowledged CEO alerts |

### File Tree (left, 25%)

Browses workspace files stored under `ceo-luna/` in your Luna workspace. Files are grouped into folders:

- **Documents** - Strategy docs, meeting notes, research
- **Plans** - Roadmaps, sprint plans
- **Week** - Weekly reports and review files

Click any file to open it in the Viewer tab.

---

## Tabs

### Viewer

Read-only document viewer for files selected from the File Tree. Supports Markdown rendering with proper heading hierarchy and code blocks.

### Chat

Chat directly with the CEO Luna AI persona - an experienced co-founder and business advisor who knows your finances, build history, and goals.

**System context injected automatically:**
- Current financial summary (P&L, expenses, income)
- Active and recent build sessions
- Pending alerts and competitor radar signals

**Slash Commands** (typed directly in the chat input):

| Command | Description |
|---------|-------------|
| `/build start <name>` | Start a tracked build session |
| `/build pause <#>` | Pause build by number (accumulates elapsed time) |
| `/build continue <#>` | Resume a paused build |
| `/build done <#>` | Mark build complete, logs hours to dashboard |
| `/build list` | Show active and paused builds with elapsed time |
| `/cost <amount> <keyword> [note]` | Log an expense (auto-maps keyword to category) |
| `/income <amount> <source> [note]` | Log income |

Slash commands generate a system log that is automatically injected into the next message so CEO Luna can acknowledge and reference it naturally.

**Example session:**
```
> /build start MVP onboarding flow
[SYSTEM] Build #3 "MVP onboarding flow" started.

> Just finished the auth screens. Took about 2 hours.
CEO Luna: Great progress on the auth screens! Build #3 is tracking nicely.
          Want me to note that milestone in the build log?

> /build done 3
[SYSTEM] Build #3 done. Logged 2h 15m.
```

### Dashboard

Financial overview panel showing:

- Monthly income vs. expenses bar chart
- Recent transactions table (date, vendor, amount, category)
- Expense categories breakdown
- Running P&L trend

### Radar

Competitive intelligence panel. CEO Luna monitors competitors specified in your CEO config and surfaces:

- News mentions and sentiment
- Product updates detected via web research
- Signal priority (low / medium / high)
- Newsfetcher-verified article summaries

### Autopost

Schedule and manage automated social media posts across channels:

| Channel | Description |
|---------|-------------|
| **X (Twitter)** | Short-form updates |
| **LinkedIn** | Professional announcements |
| **Telegram** | Community channel posts |
| **Blog** | Long-form article drafts |
| **Reddit** | Community engagement posts |

Autopost can be driven by CEO Luna automatically (when `autopostEnabled = true`) or triggered manually.

### Builds

Full build tracker table with all sessions:

- Build name, number, start time
- Status (active / paused / completed)
- Elapsed time (live counter for active builds)
- Progress notes logged via `ceo_note_build` tool

Build check-in works automatically: every 30 minutes, CEO Luna sends you a check-in message asking how the current build is going. Your reply is saved as a progress note.

### Log (Quick Log)

Manual finance entry form for quick cost and income logging without slash commands. Useful for bulk data entry.

---

## Build Tracker

The build tracker is the core productivity feature. It lets you time-track development sessions with AI-assisted progress notes.

### How It Works

1. Start a build with `/build start <name>` or from the Builds tab
2. CEO Luna tracks elapsed time in real time
3. Every 30 minutes, an automated check-in is sent to the Chat tab
4. Your replies are saved as timestamped progress notes
5. Mark done with `/build done <#>` to log hours to the Dashboard

### Automatic Check-ins

The `ceoBuildCheckin` background job runs every 5 minutes and sends a check-in for any active build where the last check-in was more than 30 minutes ago.

Check-in format:
```
[Build Check-in] Build #N "name" - 1h 23m elapsed. How is it going?
```

CEO Luna uses the `ceo_note_build` tool to save your response as a build note.

### Elapsed Time

Elapsed time accumulates correctly across pause/continue cycles:

- Start -> pause: elapsed = now - start
- Continue -> pause: elapsed += now - resumed_at
- Done: total = all accumulated segments

---

## Finance Logging

### Expense Categories (keyword auto-mapping)

| Keyword | Category |
|---------|----------|
| server, vps, cloud, aws, gcp, azure, hosting | Infrastructure |
| domain, dns, ssl | Domain |
| api, openai, anthropic, groq | API Costs |
| tool, saas, software, subscription | Software |
| marketing, ads, ad | Marketing |
| design, figma, canva | Design |
| legal, lawyer, contract | Legal |
| salary, contractor, freelance | Personnel |
| office, hardware, equipment | Equipment |
| other (default) | Miscellaneous |

### Income Sources

Income is logged with a free-text source field (e.g., "client payment", "saas subscription", "consulting").

---

## Scheduled Reports

CEO Luna sends proactive reports and alerts via the configured notification channel (Telegram and/or in-app):

| Report | Schedule | Content |
|--------|----------|---------|
| **Morning Brief** | Daily (configurable time) | Today's priorities, open tasks, P&L snapshot |
| **Evening Review** | Daily (configurable time) | Build time logged, income/costs, tomorrow's agenda |
| **Weekly Report** | Weekly (configurable weekday) | Full weekly P&L, build hours, key decisions |
| **Biweekly Audit** | Biweekly | Burn rate analysis, vendor review, growth metrics |

---

## CEO Modes

| Mode | Description |
|------|-------------|
| **pre_revenue** | Focus on build time, experiments, and cost reduction. Alerts if no build days exceed threshold. |
| **normal** | Full business mode with revenue tracking, P&L alerts, and growth KPIs. |

---

## Alert System

CEO Luna raises alerts when configurable thresholds are exceeded:

| Alert | Trigger |
|-------|---------|
| No builds | X days without a logged build session |
| Burn spike | Monthly spend exceeds expected ratio or absolute USD threshold |
| Unexpected vendor | New vendor charge above threshold |
| No experiments | X days without a logged experiment |

Alerts appear in the KPI Strip counter and in the Chat tab as system messages.

---

## Configuration

CEO config is stored per-user and editable via Settings or the Settings tab:

| Setting | Default | Description |
|---------|---------|-------------|
| `mode` | pre_revenue | CEO operating mode |
| `timezone` | Europe/Stockholm | Timezone for scheduled reports |
| `noBuildDaysThreshold` | 3 | Alert after N days without builds |
| `noExperimentDaysThreshold` | 7 | Alert after N days without experiments |
| `burnSpikeRatio` | 2.0 | Alert if month spend is >Nx average |
| `burnSpikeAbsoluteUsd` | 500 | Alert if month spend >$N above average |
| `unexpectedNewVendorUsd` | 50 | Alert if new vendor >$N |
| `dailyMorningTime` | 08:00 | Morning brief time |
| `dailyEveningTime` | 20:00 | Evening review time |
| `weeklyReportWeekday` | 1 (Monday) | Weekly report day |
| `autopostEnabled` | false | Enable automated social posting |
| `competitors` | [] | Competitor names for radar monitoring |

---

## Backend Files

| File | Purpose |
|------|---------|
| `src/ceo/ceo.service.ts` | Finance logging, config management, alert generation |
| `src/ceo/ceo.routes.ts` | REST endpoints (builds, slash commands, finance, config) |
| `src/ceo/build-tracker.service.ts` | Build session CRUD and elapsed time tracking |
| `src/jobs/job-runner.ts` | `ceoBuildCheckin` job (every 5min) |
| `src/llm/tools/chat-tools.ts` | `ceoNoteBuildTool` - saves build progress notes |
| `src/persona/luna.persona.ts` | CEO_LUNA_MODE_PROMPT and system log injection |
| `src/db/migrations/086_ceo_active_builds.sql` | ceo_active_builds + ceo_build_notes tables |

## Frontend Files

| File | Purpose |
|------|---------|
| `frontend/src/components/os/apps/CEOLunaWindow.tsx` | Main window container |
| `frontend/src/components/ceo-luna/CEOChat.tsx` | Chat with slash command parser |
| `frontend/src/components/ceo-luna/KPIStrip.tsx` | Top KPI bar |
| `frontend/src/components/ceo-luna/FileTree.tsx` | Workspace file browser |
| `frontend/src/components/ceo-luna/DocViewer.tsx` | Document viewer |
| `frontend/src/components/ceo-luna/DashboardPanel.tsx` | Financial dashboard |
| `frontend/src/components/ceo-luna/RadarPanel.tsx` | Competitor radar |
| `frontend/src/components/ceo-luna/AutopostPanel.tsx` | Social media autopost |
| `frontend/src/components/ceo-luna/BuildsPanel.tsx` | Build tracker table |
| `frontend/src/components/ceo-luna/QuickLogPanel.tsx` | Quick finance log form |
| `frontend/src/lib/ceo-luna-store.ts` | Zustand store |
| `frontend/src/lib/api/ceo.ts` | API helpers |

---

## API Endpoints

**Base**: `GET /api/ceo/...` -- requires JWT auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ceo/config` | Get CEO config |
| PUT | `/api/ceo/config` | Update CEO config |
| GET | `/api/ceo/kpis` | KPI snapshot |
| GET | `/api/ceo/finance/logs` | Finance log entries |
| POST | `/api/ceo/finance/log` | Log income or expense |
| GET | `/api/ceo/alerts` | List active alerts |
| POST | `/api/ceo/alerts/:id/ack` | Acknowledge alert |
| POST | `/api/ceo/builds/start` | Start build session |
| GET | `/api/ceo/builds` | List builds |
| POST | `/api/ceo/builds/:num/pause` | Pause build |
| POST | `/api/ceo/builds/:num/continue` | Resume build |
| POST | `/api/ceo/builds/:num/done` | Complete build |
| POST | `/api/ceo/builds/:num/note` | Add progress note |
| POST | `/api/ceo/slash/cost` | Log cost via slash |
| POST | `/api/ceo/slash/income` | Log income via slash |

---

## Opening CEO Luna

From the desktop, click the **Communication** menu in the system bar and select **CEO Luna** (Briefcase icon). The window opens at 1400x860 and can be moved or resized like any other OS window.
