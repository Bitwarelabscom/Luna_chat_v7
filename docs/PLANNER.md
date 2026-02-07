# Project Execution Graph (Planner)

The Project Planner is a sophisticated execution engine designed to handle complex, multi-step tasks using a Directed Acyclic Graph (DAG) architecture. It allows Luna to plan, execute, and monitor long-running projects with dependencies and human-in-the-loop approval gates.

## Core Concepts

### 1. The Execution Graph (DAG)
Every project is represented as a series of **Execution Steps** connected by **Dependencies**.
- **Nodes**: Individual tasks (steps).
- **Edges**: "Blocks" relationships (Step A must complete before Step B starts).
- **Topological Order**: The engine automatically determines the valid execution sequence.

### 2. PlannerOrchestrator
The main execution engine that manages the project lifecycle:
- **Loop**: Uses an `AsyncGenerator`-based loop for non-blocking execution.
- **State Management**: Persists progress to the database and uses Redis for pause/resume signals.
- **SSE Streaming**: Provides real-time updates to the UI (step starts, completions, logs, artifacts).

### 3. Step Lifecycle
Each step follows a standard lifecycle:
1. **Pending**: Waiting for dependencies.
2. **Ready**: Dependencies met, ready for execution.
3. **Running**: Logic being executed.
4. **Validating**: Verifying the outcome of the action.
5. **Completed**: Finished successfully.
6. **Failed**: Encountered an error (may trigger retry).
7. **Paused**: Waiting for user approval (Approval Gate).

## Risk Classification & Approvals

The `ApprovalClassifier` analyzes steps to determine if they require manual intervention.

### Risk Levels
- **Low**: Trivial changes, non-destructive (e.g., reading a file).
- **Medium**: Incremental changes, easily reversible (e.g., adding a test).
- **High**: Significant structural changes (e.g., refactoring a core service).
- **Critical**: Irreversible or sensitive actions (e.g., deleting data, external API calls with cost).

### Classification Logic
- **Structural**: New files or major refactors -> Likely requires approval.
- **Iterative**: Bug fixes, parameter tuning -> Often auto-approved for trusted agents.
- **Irreversible**: Deletions, permanent state changes -> Always requires approval.

## Step Types

| Type | Description | Example |
|------|-------------|---------|
| `research` | Information gathering via web/knowledge base | "Research OAuth2 flow" |
| `coding` | Writing or modifying code | "Implement login route" |
| `test` | Running test suites | "Run unit tests for auth" |
| `command` | Executing shell commands | "Install dependencies" |
| `approval` | Explicit wait for user sign-off | "Confirm deployment to prod" |

## Database Schema

### `execution_projects`
Main project container tracking overall status and metadata.

### `execution_steps`
Individual nodes in the graph.
- `action_type`: coding, research, etc.
- `input_data`: parameters for the action.
- `status`: current state.
- `retry_count`: track attempts against `max_retries`.

### `step_dependencies`
Defines the edges of the DAG.

### `execution_artifacts`
Stores outputs from steps (e.g., generated files, research summaries).

## API Integration

### Streaming Execution
Execution is started via a POST request that returns an SSE stream:
`POST /api/planner/projects/:id/execute`

Events include:
- `step_started`: Metadata about the current step.
- `step_log`: Real-time stdout/stderr from the execution.
- `step_completed`: Results and artifacts.
- `approval_required`: Signal to pause and wait for user.

### Approval Flow
1. Engine reaches a "High Risk" step.
2. Step status moves to `paused`.
3. `approval_required` event sent to UI.
4. User responds via `/api/planner/approvals/:id/{approve,reject}`.
5. Engine resumes execution.

## UI Components

### PlannerWindow
A dedicated OS-style app in the Luna Desktop:
- **Sidebar**: Project list and status.
- **Center**: Real-time log stream.
- **Right**: DAG visualization and step details.

### ApprovalMessage
Integration in the main chat:
- Risk badges (Low/Medium/High/Critical).
- "Why" explanation from the `ApprovalClassifier`.
- Action buttons for quick approval/rejection.
