# Week 4 Phase 4: Automatic Reflection Generation

## Goal

Automatically detect coding patterns from user edits and extract style rules to personalize future artifact generation.

## Features to Implement

### 1. Edit Pattern Detection
- Analyze version history to detect consistent changes
- Compare consecutive versions to identify patterns
- Track common transformations (e.g., adding types, error handling, comments)

### 2. Style Rule Extraction
- Detect repeated patterns across multiple artifacts
- Generate natural language style rules
- Examples:
  - User always adds `try-catch` → "Add error handling to functions"
  - User always adds types → "Use explicit TypeScript types"
  - User always adds JSDoc → "Add comprehensive documentation"

### 3. Pattern Categories
- **Type Safety**: Adding types, interfaces, generics
- **Error Handling**: try-catch blocks, error boundaries
- **Documentation**: Comments, JSDoc, inline docs
- **Code Style**: Naming conventions, formatting preferences
- **Best Practices**: Async/await usage, functional patterns

### 4. Confidence Scoring
- Track pattern frequency across artifacts
- Require minimum occurrences (e.g., 3 times)
- Calculate confidence score (0.0-1.0)
- Only auto-generate rules with confidence > 0.7

## Implementation Approach

### Pattern Detection Function
```typescript
interface EditPattern {
  type: 'type_addition' | 'error_handling' | 'documentation' | 'formatting' | 'best_practice';
  description: string;
  occurrences: number;
  confidence: number;
  examples: string[];
}

async function analyzeArtifactHistory(userId: string, artifactId: string): Promise<EditPattern[]>
```

### Pattern Matching Algorithms

1. **Diff Analysis**: Compare consecutive versions character-by-character
2. **AST Parsing**: For code, parse into AST and detect structural changes
3. **Keyword Detection**: Look for specific patterns (try-catch, type annotations, comments)
4. **Similarity Scoring**: Calculate edit distance and similarity metrics

### Integration Points

1. **After rewrite_artifact**: Analyze the diff between old and new versions
2. **After update_highlighted**: Track selection-specific changes
3. **Background Job**: Periodic analysis of all user artifacts
4. **Threshold Trigger**: Auto-generate rule after 3+ similar patterns

## Implementation Plan

### Step 1: Create Pattern Analyzer (canvas.service.ts)
- `analyzeVersionDiff()`: Compare two artifact versions
- `detectPatternType()`: Classify the type of change
- `extractStyleRule()`: Generate natural language rule from pattern

### Step 2: Create Pattern Tracker (Database)
- Store detected patterns temporarily
- Track occurrence count per user per pattern type
- Auto-promote to style rule when threshold met

### Step 3: Integration into Tool Handlers
- Call pattern analyzer after artifact modifications
- Update pattern counts in database
- Auto-generate style rules when confidence threshold reached

### Step 4: User Feedback Loop
- Notify user when new style rule auto-generated
- Allow user to accept/reject/modify
- Track acceptance rate to improve detection

## Database Extension

```sql
-- Track detected patterns before promotion to style rules
CREATE TABLE pattern_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  pattern_type VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  occurrences INTEGER DEFAULT 1,
  confidence FLOAT DEFAULT 0.0,
  examples JSONB,
  promoted_to_rule BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pattern_detections_user ON pattern_detections(user_id, pattern_type);
```

## Example Scenarios

### Scenario 1: Type Safety Pattern
```typescript
// Version 1 (original)
function processData(data) {
  return data.map(item => item.value);
}

// Version 2 (user edit)
function processData(data: DataItem[]): number[] {
  return data.map((item: DataItem) => item.value);
}

// Pattern detected: "type_addition"
// Description: "User adds TypeScript types to function parameters and return values"
// After 3 occurrences → Auto-generate rule: "Add explicit TypeScript types to all functions"
```

### Scenario 2: Error Handling Pattern
```typescript
// Version 1
const result = await fetchData();

// Version 2
try {
  const result = await fetchData();
} catch (error) {
  console.error('Failed to fetch:', error);
}

// Pattern detected: "error_handling"
// Description: "User wraps async calls in try-catch blocks"
// After 3 occurrences → Auto-generate rule: "Add error handling to async operations"
```

### Scenario 3: Documentation Pattern
```typescript
// Version 1
function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}

// Version 2
/**
 * Calculate total price of all items
 * @param items - Array of items with price property
 * @returns Total sum of all item prices
 */
function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}

// Pattern detected: "documentation"
// Description: "User adds JSDoc comments to functions"
// After 3 occurrences → Auto-generate rule: "Add JSDoc documentation to all functions"
```

## Success Criteria

- [ ] Pattern detection works for at least 3 pattern types
- [ ] Confidence scoring accurately reflects pattern reliability
- [ ] Auto-generated style rules are natural and useful
- [ ] No false positives (avoid detecting noise as patterns)
- [ ] User can review and approve auto-generated rules
- [ ] Integration doesn't slow down artifact operations

## Performance Considerations

- Pattern analysis runs async (non-blocking)
- Cache recent patterns in Redis
- Limit analysis to last 10 versions per artifact
- Background job for comprehensive analysis (daily)
- Skip pattern detection for trivial edits (< 10 chars changed)
