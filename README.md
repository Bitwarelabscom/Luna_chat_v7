# Luna Chat

Luna is an AI-powered personal assistant and conversation companion with multi-agent capabilities, memory, and extensible abilities.

## Features

- **Multi-Model Support**: Routes between OpenAI, Anthropic, and other LLM providers
- **Agent System**: Specialized agents powered by Claude CLI for focused tasks
- **Long-term Memory**: Remembers facts, preferences, and conversation history
- **Persona System**: Customizable personality and mood tracking
- **Abilities**: Calendar, email, documents, code execution, and more
- **Search Integration**: Web search capabilities
- **Knowledge Base**: Personal knowledge management

## Architecture

```
src/
├── abilities/       # Agent system, tools, and integrations
├── auth/            # Authentication and JWT handling
├── chat/            # Core chat functionality
├── config/          # Configuration management
├── db/              # Database migrations and connection
├── llm/             # LLM routing and model configuration
├── memory/          # Long-term memory and facts
├── persona/         # Personality and mood system
├── search/          # Web search integration
├── settings/        # User settings and preferences
├── types/           # TypeScript type definitions
└── utils/           # Logging and utilities
```

## Agents

Luna includes specialized agents that leverage Claude CLI for focused tasks:

| Agent | Purpose | Use Case |
|-------|---------|----------|
| **researcher** | Deep research and fact-finding | Complex questions, information gathering |
| **coder** | Code writing and debugging | Programming tasks, code review |
| **writer** | Creative and professional writing | Content creation, editing |
| **analyst** | Data analysis and calculations | Number crunching, insights |
| **planner** | Task breakdown and planning | Project planning, goal setting |

Agents are invoked via Claude CLI (`/home/luna/.local/bin/claude -p`) and return results to Luna for synthesis.

## Prerequisites

- Node.js >= 18.0.0
- PostgreSQL with pgvector extension
- Claude CLI (authorized for the service user)

### CLI Tools (Optional)

For full agent capabilities, install and authorize:

```bash
# As the service user (luna)
npm install --prefix ~/.local @anthropic-ai/claude-code
npm install --prefix ~/.local @openai/codex
npm install --prefix ~/.local @google/gemini-cli

# Add to PATH
export PATH=$HOME/.local/bin:$PATH

# Authorize each CLI
claude    # Follow prompts
codex     # Follow prompts
gemini    # Follow prompts
```

## Installation

```bash
# Clone the repository
git clone https://github.com/bitwarelabs/luna-chat.git
cd luna-chat

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
npm run migrate

# Build
npm run build

# Start
npm start
```

## Environment Variables

```env
# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=luna
POSTGRES_PASSWORD=your_password
POSTGRES_DB=luna_chat

# LLM Providers
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Server
PORT=3003
NODE_ENV=production
```

## Development

```bash
# Run in development mode with hot reload
npm run dev

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint
npm run lint

# Format
npm run format
```

## API Endpoints

### Chat
- `POST /api/chat/sessions` - Create new session
- `POST /api/chat/sessions/:id/send` - Send message
- `GET /api/chat/sessions/:id/messages` - Get messages

### Agents
- `GET /api/abilities/agents` - List available agents
- `POST /api/abilities/agents/execute` - Execute agent task
- `POST /api/abilities/agents/orchestrate` - Multi-agent orchestration

### Settings
- `GET /api/settings` - Get user settings
- `PUT /api/settings` - Update settings

## Agent Usage

To use an agent in conversation, ask Luna to delegate:

> "Use the coder agent to write a Python function that calculates fibonacci numbers"

> "Have the researcher agent find information about quantum computing"

> "Ask the writer agent to create a haiku about rain"

Luna will invoke the appropriate agent and synthesize the response.

## License

Proprietary - All rights reserved.

## Author

BitwareLabs
