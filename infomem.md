# Letta Memory System Overview

Letta implements a **four-tier memory architecture** that mimics human memory patterns:

## 1. Core Memory (In-Context)

Persistent memory blocks always included in the agent's context window.

| Component | Description |
|-----------|-------------|
| **Structure** | `Block` objects with labels like "persona" and "human" |
| **Limit** | 20,000 characters per block |
| **Key files** | `letta/schemas/block.py:82-146`, `letta/schemas/memory.py:56-345` |

Agents edit core memory via `core_memory_append()` and `core_memory_replace()` tools.

## 2. Archival Memory (Long-term, Semantic Search)

Long-term searchable memory using **vector embeddings**.

| Component | Description |
|-----------|-------------|
| **Structure** | Passages with embeddings stored in archives |
| **Search** | Semantic (vector similarity) + full-text + tag filtering |
| **Backends** | PostgreSQL pgvector, Turbopuffer, Pinecone |
| **Key files** | `letta/orm/passage.py:75-104`, `letta/services/passage_manager.py:457-551` |

Agents use `archival_memory_search()` and `archival_memory_insert()` tools.

## 3. Recall Memory (Conversation History)

Recent messages kept in the context window.

| Component | Description |
|-----------|-------------|
| **Structure** | List of message IDs in `agent_state.message_ids` |
| **Features** | Temporal filtering, role filtering, full-text search |
| **Key files** | `letta/orm/message.py:18-80`, `letta/orm/agent.py:68` |

Agents search via `conversation_search()` tool.

## 4. File/Source Memory

Memory from attached documents.

| Component | Description |
|-----------|-------------|
| **Structure** | `FileBlock` objects that can be opened/closed |
| **Key files** | `letta/schemas/block.py:122-130`, `letta/orm/passage.py:47-72` |

---

## Memory Workflow

```
┌─────────────────────────────────────────────────────────┐
│                    SYSTEM PROMPT                        │
│  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │  Core Memory    │  │  Recent Messages (Recall)   │  │
│  │  - persona      │  │  - Last N messages          │  │
│  │  - human        │  │  - Auto-managed             │  │
│  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                 AGENT TOOLS                             │
│  archival_memory_search()  →  Vector DB (pgvector)     │
│  archival_memory_insert()  →  Embed + Store            │
│  conversation_search()     →  Messages table           │
│  core_memory_append()      →  Update blocks            │
│  core_memory_replace()     →  Update blocks            │
└─────────────────────────────────────────────────────────┘
```

---

## Key Implementation Details

1. **Memory is XML-formatted** for the LLM context (`letta/schemas/memory.py:110-169`)
2. **Embeddings padded to 4096 dimensions** for consistent pgvector storage
3. **Dual storage**: Passages written to PostgreSQL + external vector DB (Turbopuffer/Pinecone)
4. **Tag system**: Stored in both JSON column and junction table for efficient querying
5. **System message invariant**: First `message_id` always points to the system message

## Core Tool Implementations

All memory tools are in `letta/services/tool_executor/core_tool_executor.py:27-415`:

| Tool | Lines | Purpose |
|------|-------|---------|
| `archival_memory_search` | 279-306 | Semantic search in long-term memory |
| `archival_memory_insert` | 308-318 | Store new long-term memories |
| `core_memory_append` | 320-327 | Add content to core memory blocks |
| `core_memory_replace` | 329-345 | Replace content in core memory blocks |
| `conversation_search` | 82-150 | Search conversation history |

---

## Data Models

### Block (Core Memory)

```python
Block:
  - id: str
  - label: str (e.g., "persona", "human")
  - value: str (the actual memory content)
  - limit: int (character limit, default 20000)
  - description: str (metadata)
  - read_only: bool
  - tags: List[str]
  - metadata: dict
```

### Passage (Archival Memory)

```python
Passage:
  - id: str
  - text: str (the actual content)
  - embedding: List[float] (vector embedding for semantic search)
  - embedding_config: EmbeddingConfig
  - tags: List[str] (for filtering)
  - archive_id: str (which archive it belongs to)
  - created_at: datetime (for temporal filtering)
  - organization_id: str
  - metadata: dict
```

### Memory Container

```python
Memory:
  - agent_type: Optional[AgentType]
  - blocks: List[Block] (core memory blocks)
  - file_blocks: List[FileBlock] (open files)
  - prompt_template: str (deprecated)
```

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `blocks` | Core memory blocks |
| `blocks_agents` | Junction table linking blocks to agents |
| `archival_passages` | Agent-owned archival passages |
| `source_passages` | File-derived passages |
| `archives` | Archive metadata and embedding config |
| `archives_agents` | Junction table linking archives to agents |
| `messages` | Conversation messages (recall memory) |

---

## Key Files Reference

### Core Memory
- `letta/schemas/memory.py` - Memory classes and compilation (lines 56-345)
- `letta/schemas/block.py` - Block data structures (lines 82-225)
- `letta/orm/block.py` - Block ORM model

### Archival Memory
- `letta/services/passage_manager.py` - Passage lifecycle management (lines 457-551)
- `letta/services/archive_manager.py` - Archive management (lines 27-100)
- `letta/orm/passage.py` - Passage ORM models (lines 20-104)
- `letta/orm/archive.py` - Archive ORM model (lines 24-98)
- `letta/schemas/passage.py` - Passage schemas (lines 35-95)
- `letta/schemas/archive.py` - Archive schemas (lines 24-41)

### Recall Memory
- `letta/orm/message.py` - Message ORM model (lines 18-80)
- `letta/services/message_manager.py` - Message lifecycle
- `letta/orm/agent.py` - Agent with message_ids (line 68)

### System Prompt Building
- `letta/services/agent_manager.py` - System prompt rebuilding (lines 1417-1504)
- `letta/services/context_window_calculator/context_window_calculator.py` - Context calculations

### Constants
- `letta/constants.py` - Memory limits (lines 62, 91-93, 416-418)
  - `CORE_MEMORY_BLOCK_CHAR_LIMIT`: 20,000
  - `MAX_EMBEDDING_DIM`: 4,096
  - `DEFAULT_EMBEDDING_DIM`: 1,024
