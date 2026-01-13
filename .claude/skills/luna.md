# Luna - Codebase Knowledge & Self-Learning

## Self-Learning Protocol

**IMPORTANT: When any of these occur, AUTOMATICALLY update this file:**

1. **Error Correction** - If I make a mistake and then fix it, log what went wrong
2. **User Correction** - If the user corrects me, log the correct approach
3. **Retry Success** - If something fails and I try a different approach that works, log it
4. **Build/Test Failure** - If a build or test fails due to something I did, log the fix
5. **"Remember this"** - If the user says to remember something, log it immediately

**How to self-learn:**
```
I notice I made a mistake. Let me add this to Luna for next time.
[Edit this file with the lesson]
```

**Quick-add format for the Auto-Learned section:**
```
### [Short Title]
- **Mistake:** What I did wrong
- **Correct:** What I should do instead
```

---

## Build & Rebuild Procedures

<!-- Add your project's build commands and procedures here -->

```bash
# Example:
# npm install
# npm run build
```

**Pre-build checklist:**
- [ ] Check for uncommitted changes
- [ ] Ensure dependencies are up to date

---

## Common Mistakes & Fixes

<!-- Add mistakes and their solutions as you encounter them -->

### Template Entry
**Problem:** [Describe what went wrong]
**Cause:** [Why it happened]
**Fix:** [How to solve it]
**Prevention:** [How to avoid it next time]

---

## Auto-Learned Lessons

<!-- Claude automatically adds entries here when mistakes are detected -->

### Fetch calls need credentials: 'include' for auth cookies
- **Mistake:** TerminalChat.tsx was using fetch() without `credentials: 'include'`, causing auth to fail
- **Correct:** Always include `credentials: 'include'` in fetch calls that need authentication
- **Example:**
  ```javascript
  // WRONG - cookies won't be sent
  fetch('/api/trading/chat/session', { method: 'POST' });

  // CORRECT - auth cookies will be sent
  fetch('/api/trading/chat/session', {
    method: 'POST',
    credentials: 'include'
  });
  ```
- **Note:** The main `api()` helper in api.ts already includes credentials, so use it when possible


### Auto Trading Symbol Format Normalization (2026-01-06)
- **Problem:** Multiple symbol format bugs caused:
  - SL/TP not triggering (price lookups failed)
  - Portfolio sync finding 0 orphans (BONK not matched)
  - Cooldowns not working (symbol mismatch)
  - "wrong instrument" errors when closing trades
- **Root Cause:** Three different symbol formats in use:
  - Internal/DB: `BONK_USD` (underscore, USD quote)
  - Binance/Redis: `BONKUSDT` (no separator, USDT quote)
  - Crypto.com API: `PONKE_USD` (underscore, USD quote - NOT USDT!)
- **Fix:** Always normalize to BASE asset for comparisons:
  ```typescript
  import { getBaseQuote } from './symbol-utils.js';
  const baseAsset = getBaseQuote(symbol).base.toUpperCase();
  ```
- **Prevention:** When comparing symbols across systems, extract and compare base assets, not full symbol strings

### Crypto.com Uses USD, Not USDT (2026-01-06)
- **Mistake:** Assumed Crypto.com uses USDT like Binance and converted `_USD` to `_USDT`
- **Reality:** Crypto.com API uses `USD` as quote currency (e.g., `PONKE_USD`, not `PONKE_USDT`)
- **Correct:** `toCryptoComSymbol()` should convert `_USDT` to `_USD`:
  ```typescript
  if (result.endsWith('_USDT')) {
    result = result.slice(0, -5) + '_USD';
  }
  ```
- **Impact:** Wrong quote currency causes API calls to fail silently (instrument not found)

### Auto Trading State - trades_count Bug (2026-01-06)
- **Problem:** Win rate showed 0.0% even with 1W/0L (100% should show)
- **Root Cause:** `handleTradeClose()` incremented `wins_count` but NOT `trades_count`
  - Win rate = `wins_count / trades_count` = `1 / 0` = 0.0%
- **Fix:** In `handleTradeClose()`, increment `trades_count` on both WIN and LOSS branches:
  ```sql
  ON CONFLICT (user_id, date) DO UPDATE SET
    wins_count = auto_trading_state.wins_count + 1,
    trades_count = auto_trading_state.trades_count + 1,  -- ADD THIS
    ...
  ```
- **Key Insight:** `trades_count` should be incremented on CLOSE, not on trade OPEN, for accurate win rate calculation

### System Prompt Optimization (2026-01-01)
- **Before:** ~3,800 tokens base prompt + 80-400 per mode = ~4,200 tokens total
- **After:** ~700 tokens base prompt + 30-100 per mode = ~800-1,000 tokens total
- **Savings:** ~75% reduction
- **Key optimizations:**
  - Removed 36 "CRITICAL/IMPORTANT" statements (redundant emphasis)
  - Condensed capability docs from 10+ examples each to 1-2 lines
  - Eliminated duplicated identity rules across mode variants
  - Removed verbose image/media examples (kept just the rule)
  - Made ability context sections conditional (skip empty [Calendar], [Tasks], [Email])
- **Files changed:** `src/persona/luna.persona.ts`, `src/abilities/orchestrator.ts`

---

## Project-Specific Gotchas

<!-- Document quirks, non-obvious behaviors, or things that are easy to forget -->

- **CRITICAL: WireGuard-only access**: Luna is ONLY accessible via WireGuard VPN (10.0.0.x). NOTHING should be exposed to the public internet except the Telegram webhook. Never add public domains to CORS, never create public nginx configs. The only external endpoint is `/api/triggers/telegram/webhook`.
- **Voice mode tools are separate from main chat**: Voice Luna uses `src/chat/voice-chat.service.ts` with its own tool definitions, not the main chat service. Tools added to voice mode must be defined and handled separately.
- **Voice mode uses Luna's email account**: Email tools in voice mode use luna@bitwarelabs.com (via `emailService.sendLunaEmail`, `checkLunaInbox`, etc.), not user email connections.
- **Calendar in voice mode uses Radicale only**: No Google/Outlook calendar integration in voice mode - uses internal CalDAV via `calendarService.createEvent`, `getTodayEvents`, etc.
- **System prompt token count matters**: The base prompt directly affects cost per message. Each capability should be 1-2 lines max, examples should be minimal, and mode variants should only add what's different (not repeat base rules).
- **Anthropic tool calling now supported**: Voice mode and other tool-enabled features work with Anthropic models (Haiku 4.5, Sonnet, Opus). The `openai.client.ts` routes Anthropic requests to native `anthropic.provider.ts` which converts OpenAI tool format to Anthropic's format.
- **Docker internal traffic needs HTTPS bypass**: The backend's HTTPS redirect (`src/index.ts`) must allow Docker internal IPs (172.x.x.x) in addition to WireGuard (10.0.0.x). Without this, container-to-container requests (frontend -> luna-api) get 301 redirected and fail with SSL errors.

---

## File/Folder Conventions

<!-- Document important structural patterns -->

-

---

## Dependencies & Environment

### Database Connection

Connect to PostgreSQL via Docker:
```bash
# Run SQL file
docker exec -i luna-postgres psql -U luna -d luna_chat < /path/to/migration.sql

# Interactive shell
docker exec -it luna-postgres psql -U luna -d luna_chat

# Run single query
docker exec -i luna-postgres psql -U luna -d luna_chat -c "SELECT * FROM trades LIMIT 5;"
```

**Connection details:**
- Container: `luna-postgres`
- User: `luna`
- Database: `luna_chat`
- Port: `5432` (internal)

**Note:** Database name is `luna_chat`, NOT `luna`

---

## User Preferences

<!-- How the user likes things done -->

-

