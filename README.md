# Luna Chat

**A local-first, privacy-focused autonomous AI agent with a "Council" of sub-agents, long-term memory, and full system integration (Android, Email, CalDAV).**

Luna Chat v7 is a comprehensive AI Operating System designed for privacy and autonomy. Unlike standard chatbots, Luna features a "Council Architecture" where multiple sub-agents (Sage, Nova, Vega) debate your psychology and needs in the background to build a dynamic user profile.

Built with a "Local-First" ethos, Luna integrates deeply with your digital life via a native Android app, local file execution, CalDAV, and SMTP - all while keeping your data private. She doesn't just chat; she has a job.

## Why Luna?

Most AI assistants are stateless query engines. Luna is a **stateful companion**.

- **She Thinks When You Don't**: A background "Council" of agents analyzes your conversations to update her understanding of you.
- **She Has Hands**: Luna can write/execute code, manage your calendar, and send emails - safely scoped to your permissions.
- **She is Private**: Built to run on local hardware (Ollama) with no data mining.

## Features

- **Multi-Model Support**: Routes between OpenAI, Anthropic, Groq, Google, xAI, OpenRouter, and local Ollama models
- **Agent System**: Specialized agents powered by Claude CLI for focused tasks
- **Autonomous Mode**: Self-directed operation with goals, research, RSS feeds, and AI council
- **Long-term Memory**: Remembers facts, preferences, and conversation history with vector embeddings
- **Persona System**: Customizable personality with mood tracking and awareness
- **Abilities**: Calendar (CalDAV), email (SMTP/IMAP), documents, code sandbox, vision, and more
- **Search Integration**: Web search via SearXNG
- **Security**: Fail2ban, IP whitelisting, rate limiting, Docker secrets
- **Native Android App**: Jetpack Compose app with Material 3 design

## Architecture

```
src/
├── abilities/       # Agent system, tools, and integrations
│   ├── agents.service.ts      # Claude CLI agent orchestration
│   ├── calendar.service.ts    # CalDAV calendar integration
│   ├── documents.service.ts   # Document management
│   ├── email.service.ts       # Email orchestration
│   ├── mood.service.ts        # Mood tracking
│   ├── mood-awareness.service.ts  # Contextual mood awareness
│   ├── orchestrator.ts        # Tool/ability orchestration
│   ├── sandbox.service.ts     # Code execution sandbox
│   ├── tasks.service.ts       # Task management
│   ├── task-patterns.service.ts   # Task pattern learning
│   ├── vision.service.ts      # Image analysis
│   └── workspace.service.ts   # Shared workspace
├── auth/            # Authentication and JWT handling
├── autonomous/      # Autonomous mode services
│   ├── autonomous.service.ts  # Core autonomous logic
│   ├── council.service.ts     # AI council deliberation
│   ├── friend.service.ts      # Friend AI conversations
│   ├── goals.service.ts       # Goal tracking
│   ├── insights.service.ts    # Insight generation
│   ├── questions.service.ts   # Question asking
│   ├── research.service.ts    # Web research
│   ├── rss.service.ts         # RSS feed monitoring
│   └── session-workspace.service.ts
├── chat/            # Core chat functionality
├── config/          # Configuration management
├── db/              # Database migrations and connection
├── integrations/    # External integrations
│   ├── local-email.service.ts # SMTP/IMAP email
│   └── oauth.service.ts       # OAuth connections
├── jobs/            # Background job processing
├── llm/             # LLM routing and providers
│   ├── router.ts              # Model routing logic
│   ├── model-config.service.ts
│   ├── tts.service.ts         # Text-to-speech
│   └── providers/
│       ├── anthropic.provider.ts
│       ├── google.provider.ts
│       ├── groq.provider.ts
│       ├── ollama.provider.ts
│       ├── openai.provider.ts
│       ├── openrouter.provider.ts
│       └── xai.provider.ts
├── memory/          # Long-term memory and facts
│   ├── embedding.service.ts   # Vector embeddings (Ollama)
│   ├── facts.service.ts       # Fact extraction/storage
│   ├── memory.service.ts      # Memory retrieval
│   └── preferences.service.ts # User preferences
├── persona/         # Personality and mood system
├── search/          # Web search integration
├── security/        # Security middleware
│   ├── fail2ban.service.ts    # Login attempt tracking
│   └── ip-whitelist.middleware.ts
├── settings/        # User settings and preferences
├── types/           # TypeScript type definitions
└── utils/           # Logging and utilities

frontend/            # Next.js web frontend
├── src/
│   ├── app/         # Next.js app router
│   ├── components/  # React components
│   │   ├── ChatArea.tsx
│   │   ├── CommandCenter.tsx
│   │   ├── MessageActions.tsx
│   │   ├── QuestionNotification.tsx
│   │   ├── SettingsModal.tsx
│   │   ├── Sidebar.tsx
│   │   ├── TheaterMode.tsx
│   │   └── settings/
│   │       ├── AppearanceTab.tsx
│   │       ├── AutonomousTab.tsx
│   │       ├── DataTab.tsx
│   │       ├── FriendsTab.tsx
│   │       ├── IntegrationsTab.tsx
│   │       ├── MemoryTab.tsx
│   │       ├── ModelsTab.tsx
│   │       ├── PromptsTab.tsx
│   │       ├── StatsTab.tsx
│   │       ├── TasksTab.tsx
│   │       └── WorkspaceTab.tsx
│   └── lib/         # API client and state

android/             # Native Android app
├── app/src/main/java/com/bitwarelabs/luna/
│   ├── data/        # Repository implementations, API, local storage
│   ├── di/          # Hilt dependency injection modules
│   ├── domain/      # Domain models and repository interfaces
│   └── presentation/
│       ├── navigation/  # Navigation routes
│       ├── screens/     # Login, Chat, Settings, Abilities
│       └── theme/       # Material 3 theming with CRT effects
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

## Autonomous Mode

Luna can operate autonomously with several self-directed capabilities:

- **Goals**: Track and work toward user-defined goals
- **Research**: Proactively research topics of interest
- **RSS Feeds**: Monitor and summarize news feeds
- **AI Council**: Deliberate on decisions with simulated perspectives
- **Friend Conversations**: Chat with configured AI friends
- **Insights**: Generate insights from accumulated knowledge
- **Questions**: Ask users clarifying questions when needed

## LLM Providers

| Provider | Models | Use Case |
|----------|--------|----------|
| **OpenAI** | GPT-5.1, GPT-5, GPT-4.1, o1/o3 reasoning | General purpose, coding |
| **Anthropic** | Claude Opus 4.5, Claude Sonnet 4, Haiku 4.5 | Complex reasoning, agents |
| **Groq** | Llama 3.3 70B, Mixtral 8x7B, Gemma 2 | Fast inference |
| **Google** | Gemini 3 Pro, Gemini 2.5 Flash/Pro | Multimodal, reasoning |
| **xAI** | Grok 4.1, Grok 4 Fast, Grok 4 Heavy | Reasoning, coding |
| **OpenRouter** | Various (model aggregation) | Flexibility, fallback |
| **Ollama** | Local models, BGE-M3 embeddings | Local/private, embeddings |

## Prerequisites

- Node.js >= 18.0.0
- Docker and Docker Compose
- PostgreSQL with pgvector extension (provided via Docker)
- Redis (provided via Docker)
- Ollama (provided via Docker, for embeddings)

### External Services (Optional)

- SearXNG for web search
- MemoryCore for extended memory
- Claude CLI for agent capabilities

## Installation

### Docker Deployment (Recommended)

```bash
# Clone the repository
git clone https://github.com/bitwarelabs/luna-chat.git
cd luna-chat

# Create secrets directory and add your secrets
mkdir -p secrets
echo "your-postgres-password" > secrets/postgres_password.txt
echo "your-jwt-secret" > secrets/jwt_secret.txt
echo "your-redis-password" > secrets/redis_password.txt
echo "sk-your-openai-key" > secrets/openai_api_key.txt
echo "sk-ant-your-anthropic-key" > secrets/anthropic_api_key.txt
echo "gsk_your-groq-key" > secrets/groq_api_key.txt
echo "your-encryption-key" > secrets/encryption_key.txt
# Add other API keys as needed...

# Build and start
docker compose build
docker compose up -d
```

### Manual Installation

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

## Docker Services

| Service | Port | Description |
|---------|------|-------------|
| luna-frontend | 3004 | Next.js web UI |
| luna-api | 3005 | Backend API |
| luna-postgres | 5432 | PostgreSQL with pgvector |
| luna-redis | 6379 | Redis cache |
| luna-sandbox | - | Python code execution sandbox |
| luna-ollama | 11434 | Local LLM and embeddings |
| luna-radicale | 5232 | CalDAV calendar server |
| docker-proxy | 2375 | Docker socket proxy |

## Development

```bash
# Run backend in development mode with hot reload
npm run dev

# Build for production (no source maps)
npm run build:prod

# Run frontend development
cd frontend && npm run dev

# Run tests
npm test

# Lint
npm run lint

# Format
npm run format
```

### Deploying Changes

Both backend and frontend run as built Docker images:

```bash
# Backend changes
npm run build:prod
docker compose build luna-api
docker compose up -d luna-api

# Frontend changes
cd frontend && npm run build
cd .. && docker compose build luna-frontend
docker compose up -d luna-frontend

# Full rebuild
npm run build:prod
cd frontend && npm run build && cd ..
docker compose build
docker compose up -d
```

## API Endpoints

### Chat
- `POST /api/chat/sessions` - Create new session
- `POST /api/chat/sessions/:id/send` - Send message (SSE streaming)
- `GET /api/chat/sessions/:id/messages` - Get messages
- `DELETE /api/chat/sessions/:id` - Delete session

### Abilities
- `GET /api/abilities/agents` - List available agents
- `POST /api/abilities/agents/execute` - Execute agent task
- `GET /api/abilities/tasks` - List tasks
- `GET /api/abilities/calendar/events` - Get calendar events
- `GET /api/abilities/documents` - List documents

### Autonomous Mode
- `GET /api/autonomous/status` - Get autonomous mode status
- `POST /api/autonomous/goals` - Create goal
- `GET /api/autonomous/insights` - Get generated insights
- `GET /api/autonomous/friends` - List AI friends

### Settings
- `GET /api/settings` - Get user settings
- `PUT /api/settings` - Update settings
- `GET /api/settings/stats` - Get usage statistics

### Integrations
- `GET /api/integrations/oauth/status` - OAuth connection status
- `GET /api/email/inbox` - Get email inbox

## Android App

The native Android app is built with:

- **Jetpack Compose** - Modern declarative UI
- **Material 3** - Google's latest design system
- **Hilt** - Dependency injection
- **Kotlin Coroutines** - Async operations
- **Retrofit + OkHttp** - Networking with SSE support
- **Encrypted SharedPreferences** - Secure token storage

### Building the Android App

```bash
cd android

# Debug build (development server)
./gradlew assembleDevelopmentDebug

# Debug build (production server)
./gradlew assembleProductionDebug

# Release build (requires signing config)
./gradlew assembleProductionRelease
```

APKs are output to `android/app/build/outputs/apk/`

## Security

Luna includes several security features:

- **Docker Secrets**: All sensitive credentials stored as Docker secrets
- **AES-256-GCM Encryption**: OAuth tokens encrypted at rest
- **Fail2ban**: Tracks failed login attempts, auto-blocks IPs
- **IP Whitelisting**: Optional IP-based access control
- **Rate Limiting**: Redis-backed rate limiting on auth endpoints
- **Helmet**: Security headers (CSP, HSTS)
- **SSRF Protection**: URL validation on external requests
- **Container Hardening**: no-new-privileges, capability drops, read-only filesystems

## License

MIT License

## Author

BitwareLabs
