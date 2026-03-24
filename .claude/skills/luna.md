# Luna - Codebase Knowledge & Self-Learning

## Self-Learning Protocol

When any of these occur, update this file immediately:
1. **Error then fix** -- log what went wrong and the correct approach
2. **User correction** -- log the correct approach
3. **Retry success** -- log what failed and what worked
4. **Build/test failure** -- log the fix
5. **"Remember this"** -- log it

Quick-add format:
```
### [Short Title] (YYYY-MM-DD)
- **Mistake:** What I did wrong
- **Correct:** What I should do instead
```

**Pruning:** Entries older than 90 days without reconfirmation can be moved to `luna-archive.md`. If an old lesson gets reconfirmed, update its date.

---

## Project Gotchas

- **WireGuard-only access**: Luna is ONLY accessible via VPN (10.0.0.x). Only `/api/triggers/telegram/webhook` is public.
- **Unified tool execution**: All code paths (processMessage, streamMessage/agent-loop, voice-chat) use `executeTool()` from `src/agentic/tool-executor.ts`. Add new tools once there.
- **Voice mode email**: Uses luna@bitwarelabs.com (not user email connections)
- **Voice mode calendar**: Radicale CalDAV only (no Google/Outlook)
- **Shared helpers**: `src/agentic/shared-helpers.ts` has `convertLocalTimeToUTC` etc. Don't duplicate.
- **System prompt tokens matter**: Base prompt is ~700 tokens after optimization. Keep capability descriptions to 1-2 lines max.
- **Anthropic tool calling**: Voice mode and tool features work with Anthropic models. `openai.client.ts` routes to native `anthropic.provider.ts` which converts formats.
- **Docker HTTPS bypass**: Backend HTTPS redirect must allow Docker IPs (172.x.x.x) alongside WireGuard (10.0.0.x).
- **Memory context**: 16 sources via `buildMemoryContext()`, each with independent try-catch + 2s timeout. `sourcesResponded: "N/16"`.
- **Cognitive features**: Affect state, meta-cognition, self-modification, routine learning. Config: `LUNA_AFFECT_ENABLED=true`.
- **Migrations**: Currently at 119. Always `ls src/db/migrations/ | tail -5` before creating new ones.
- **LLM providers**: 10 providers in `src/llm/providers/` (anthropic, google, groq, moonshot, ollama, ollama-micro, ollama-secondary, ollama-tertiary, openrouter, xai).

---

## Learned Lessons

### CEO config table is plural: ceo_configs (2026-02-25)
- **Mistake:** Used `FROM ceo_config` (singular)
- **Correct:** Table name is `ceo_configs` (plural). Verify with `\dt ceo*` before writing queries.

### Fetch calls need credentials: 'include' for auth cookies (2026-01-15)
- **Mistake:** fetch() without `credentials: 'include'` causes auth to fail
- **Correct:** Always include `credentials: 'include'`, or use the `api()` helper which does it automatically.

### Auto Trading Symbol Format Normalization (2026-01-06)
- **Problem:** SL/TP not triggering, portfolio sync broken, cooldowns failing, "wrong instrument" errors
- **Root Cause:** Three symbol formats: Internal `BONK_USD`, Binance `BONKUSDT`, Crypto.com `PONKE_USD`
- **Fix:** Always normalize via `getBaseQuote(symbol).base.toUpperCase()` for cross-exchange comparison

### Crypto.com Uses USD, Not USDT (2026-01-06)
- **Mistake:** Assumed Crypto.com uses USDT like Binance
- **Correct:** Crypto.com API uses USD (e.g., `PONKE_USD`). Converting to USDT breaks API calls silently.

### trades_count Must Increment on Close (2026-01-06)
- **Problem:** Win rate showed 0.0% with 1W/0L
- **Root Cause:** `handleTradeClose()` incremented wins_count but not trades_count
- **Fix:** Increment `trades_count` on BOTH win and loss branches in the ON CONFLICT upsert

### System Prompt Optimization (2026-01-01)
- **Before:** ~3,800 tokens base + 80-400 per mode
- **After:** ~700 tokens base + 30-100 per mode (~75% reduction)
- **Key:** Removed 36 redundant CRITICAL/IMPORTANT statements, condensed capability docs, made ability sections conditional

### MemoryCore noise filter must respect entity types (2026-02-27)
- **Mistake:** `purgeNoiseNodes` filtered ALL nodes matching stopwords regardless of type
- **Correct:** song, album, artist, person, place, brand, product, organization, project, game, movie, show, book are exempt from stopword purging

### Anti-centrality threshold must be graduated (2026-02-27)
- **Mistake:** Flat `edge_count > 20` threshold (Luna has 1,182 edges, Piano has 318)
- **Correct:** Graduated: 50+ light, 100+ moderate, 200+ heavy. Exempt person/place/artist entirely.

### Merge candidate label length guard (2026-02-27)
- **Mistake:** No minimum label length allowed "Pi" to match "Piano"
- **Correct:** Both labels must be >= 4 characters for substring-based merge candidate detection
