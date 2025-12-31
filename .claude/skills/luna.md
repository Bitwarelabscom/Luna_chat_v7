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


---

## Project-Specific Gotchas

<!-- Document quirks, non-obvious behaviors, or things that are easy to forget -->

-

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

