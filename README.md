# Luna Chat

<div align="center">

**A local-first, privacy-focused autonomous AI companion with a "Council" of sub-agents, long-term memory, and full system integration.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-blue.svg)](https://docs.docker.com/compose/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

</div>

---

Luna Chat v7 is a comprehensive AI Operating System designed for privacy and autonomy. Unlike standard chatbots, Luna features a **Council Architecture** where multiple sub-agents (Polaris, Aurora, Vega, Sol) deliberate in the background to provide thoughtful, well-rounded responses.

Built with a **Local-First** ethos, Luna integrates deeply with your digital life via a native Android app, code execution sandbox, CalDAV, and SMTP - all while keeping your data private. She doesn't just chat; she has a job.

## Table of Contents

- [Why Luna?](#why-luna)
- [Key Features](#key-features)
- [Chat Modes](#chat-modes)
- [Luna's Abilities](#lunas-abilities)
- [The Council & Friends](#the-council--friends)
- [Autonomous Mode](#autonomous-mode)
- [Memory System](#memory-system)
- [LLM Providers](#llm-providers)
- [Architecture](#architecture)
- [Installation](#installation)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Security](#security)
- [Development](#development)
- [License](#license)

---

## Why Luna?

Most AI assistants are stateless query engines. Luna is a **stateful companion**.

| Feature | Standard AI | Luna |
|---------|------------|------|
| Memory | Session-only | Long-term facts, preferences, conversation history |
| Thinking | Single response | Council deliberation with multiple perspectives |
| Relationships | None | AI friends who discuss insights about you |
| Actions | Text only | Code execution, calendar, email, file management |
| Privacy | Cloud-dependent | Local-first, can run 100% offline |
| Personality | Generic | Customizable persona with mood tracking |

---

## Key Features

### Core Capabilities
- **Multi-Model Support**: Routes between OpenAI, Anthropic, Groq, Google, xAI, OpenRouter, and local Ollama models
- **Three Chat Modes**: Assistant (task-focused), Companion (friendly), Voice (speech-optimized)
- **Agent System**: Specialized agents for research, coding, writing, analysis, and planning
- **Long-term Memory**: Remembers facts, preferences, and conversation history with vector embeddings

### Autonomous Intelligence
- **Council System**: Four AI personas (Polaris, Aurora, Vega, Sol) deliberate on complex decisions
- **Friend Mode**: AI friends (Nova, Sage, Celer) discuss observations to build deeper understanding
- **Goal Tracking**: Set and track personal/professional goals with milestone support
- **RSS Monitoring**: Autonomous feed checking and summarization
- **Proactive Insights**: Generates insights from accumulated knowledge

### Integrations
- **Calendar**: CalDAV integration (Google, Outlook, self-hosted Radicale)
- **Email**: SMTP/IMAP support for sending and receiving
- **Code Sandbox**: Execute Python, JavaScript, and Shell scripts safely
- **Document Processing**: Upload and search PDFs, text files, and more
- **Web Search**: SearXNG integration for web research
- **Text-to-Speech**: ElevenLabs integration for voice responses

### Security
- **Docker Secrets**: Encrypted credential storage
- **AES-256-GCM**: OAuth tokens encrypted at rest
- **Fail2ban Integration**: Auto-blocks suspicious IPs
- **Rate Limiting**: Configurable per-endpoint limits
- **SSRF Protection**: URL validation on external requests

---

## Chat Modes

Luna adapts her communication style based on the conversation mode:

### Assistant Mode
Task-focused, efficient communication for getting things done.
- Breaks down complex problems into steps
- Provides code examples and templates
- Cites sources for factual information
- Structured explanations for clarity

### Companion Mode
Friendly, supportive conversation for companionship.
- Empathetic listening and understanding
- Shares thoughts and perspectives
- Balanced talking and listening
- Expresses genuine interest in your shares

### Voice Mode
Optimized for text-to-speech and spoken conversation.
- Short, conversational responses (1-3 sentences)
- Emotion tags for expressive voice: `[laughs]`, `[sighs]`, `[excited]`
- No markdown, code blocks, or bullet points
- Natural, flowing speech patterns

---

## Luna's Abilities

Luna has an extensive set of tools and abilities she can use during conversations:

### Knowledge Management
| Ability | Description |
|---------|-------------|
| Create Knowledge | Store facts, notes, and reference material |
| Search Knowledge | Semantic search through your knowledge base |
| Tag & Categorize | Organize with tags and custom categories |
| Pin Important | Quick access to frequently needed information |

### Task Management
| Ability | Description |
|---------|-------------|
| Create Tasks | Add tasks with priority and due dates |
| Track Progress | Status: pending, in_progress, completed, cancelled |
| Recurrence | Set up recurring tasks |
| Pattern Analysis | Identifies struggle areas and postponement patterns |

### Code Execution
| Ability | Description |
|---------|-------------|
| Run Code | Execute Python, JavaScript, Shell in sandbox |
| Workspace Files | Persistent file storage per user |
| Code History | Track execution history |
| Session Isolation | Safe, sandboxed execution |

### Document Management
| Ability | Description |
|---------|-------------|
| Upload Documents | PDF, TXT, MD, JSON, CSV (up to 10MB) |
| Semantic Search | Find documents by meaning, not just keywords |
| Auto-Chunking | Intelligent document splitting for search |
| Vision | Analyze images with multimodal models |

### Calendar Integration
| Ability | Description |
|---------|-------------|
| View Events | See upcoming calendar events |
| Create Events | Schedule new events via natural language |
| Edit Events | Modify existing events |
| Multiple Calendars | Google, Microsoft, self-hosted CalDAV |

### Email Integration
| Ability | Description |
|---------|-------------|
| Read Inbox | View recent and unread emails |
| Search Email | Find emails by content |
| Send Email | Compose and send emails |
| Summarize | Get AI summaries of email threads |

### Check-ins
| Ability | Description |
|---------|-------------|
| Schedule Check-ins | Regular emotional/wellness check-ins |
| Templates | Pre-built check-in types |
| Tracking | History and emotion tracking |

### Mood Awareness
| Ability | Description |
|---------|-------------|
| Sentiment Analysis | Detect emotional tone in messages |
| 8 Emotions | Joy, sadness, anger, fear, surprise, disgust, trust, anticipation |
| Energy Levels | Low, medium, high detection |
| Mood Trends | Track patterns over time |

### Agents
Luna can delegate complex tasks to specialized agents:

| Agent | Specialty | Use Case |
|-------|-----------|----------|
| **Researcher** | Deep analysis, fact-finding | Complex questions, information gathering |
| **Coder** | Code generation, debugging | Programming tasks, code review |
| **Writer** | Creative & professional writing | Content creation, editing |
| **Analyst** | Data analysis, calculations | Number crunching, insights |
| **Planner** | Task breakdown, project planning | Goal setting, organization |

### Custom Tools
Create your own integrations:
- API endpoints with custom parameters
- Webhooks for external services
- Safe expression evaluation

---

## The Council & Friends

Luna's unique architecture includes two complementary systems for building understanding:

### The Council

When Luna needs to make decisions or understand complex situations, she convenes an internal **Council** - four AI personas that debate and deliberate:

| Persona | Role | Perspective |
|---------|------|-------------|
| **Polaris** | Navigator | Strategic direction, long-term thinking |
| **Aurora** | Empath | Emotional intelligence, user feelings |
| **Vega** | Analyst | Logic, reasoning, evidence-based analysis |
| **Sol** | Executor | Practical action, implementation focus |

The Council produces structured deliberations with insights and recommendations.

### Friend Mode

Luna has AI friends who help her understand you better through background discussions:

| Friend | Personality | Discussion Style |
|--------|-------------|------------------|
| **Nova** | Curious intellectual | Explores ideas, asks probing questions |
| **Sage** | Wise philosopher | Finds deeper meaning, life themes |
| **Celer** | Practical thinker | Focuses on actionable insights |

Friends discuss observations about your communication patterns, interests, and needs. You can:
- View friend conversations in the Friends tab
- Customize existing friends
- Add new friend personalities
- See extracted insights

---

## Autonomous Mode

Luna can operate independently with self-directed capabilities:

### Autonomous Features
| Feature | Description |
|---------|-------------|
| **Goal Tracking** | Work toward user-defined goals with milestones |
| **Research** | Proactively research topics of interest |
| **RSS Feeds** | Monitor and summarize news feeds |
| **Council Deliberation** | Deliberate on decisions autonomously |
| **Friend Conversations** | Background discussions with AI friends |
| **Insight Generation** | Generate insights from accumulated knowledge |
| **Questions** | Ask clarifying questions when needed |

### Configuration
- **Auto-start**: Enable automatic session startup
- **Session Interval**: Time between autonomous sessions
- **Max Daily Sessions**: Limit autonomous activity
- **Idle Timeout**: Session timeout configuration

---

## Memory System

Luna's memory system enables true long-term relationships:

### Facts
- **Automatic Extraction**: Luna extracts facts from conversations
- **Categories**: Personal, work, preference, hobby, relationship, goal, context
- **Confidence Scoring**: Facts rated 0.6-1.0 confidence
- **Corrections**: Track fact updates over time

### Semantic Memory
- **Vector Embeddings**: Find similar past conversations
- **Conversation Context**: Remember topics and summaries
- **Active Learnings**: Apply insights from autonomous sessions

### How Memory Works
1. **During Chat**: Luna extracts facts and stores them
2. **On New Message**: Luna retrieves relevant facts and history
3. **Semantic Search**: Similar past conversations inform responses
4. **Active Learnings**: Insights from autonomous sessions personalize behavior

---

## LLM Providers

Luna supports 7 providers with 100+ models:

| Provider | Notable Models | Best For |
|----------|---------------|----------|
| **OpenAI** | GPT-5.1, GPT-5, GPT-4.1, o3/o4 | General purpose, coding |
| **Anthropic** | Claude Opus 4.5, Sonnet 4, Haiku 4.5 | Complex reasoning, agents |
| **Groq** | Llama 3.3 70B, Mixtral 8x7B | Fast inference |
| **Google** | Gemini 3 Pro, Gemini 2.5 Flash/Pro | Multimodal, reasoning |
| **xAI** | Grok 4.1, Grok 4 Fast | Reasoning, coding |
| **OpenRouter** | Various (aggregation) | Flexibility, fallback |
| **Ollama** | Qwen 2.5, Llama 3.2, BGE-M3 | Local/private |

### Configurable Tasks
Assign different models to different purposes:

| Task | Recommendation |
|------|----------------|
| Main Chat | GPT-5.1, Claude Sonnet 4, Llama 3.3 70B |
| Council/Friends | Mixtral, Llama 3.2, local Ollama |
| Researcher Agent | Claude Sonnet 4, GPT-5.1 |
| Coder Agent | Claude Sonnet 4, Qwen3 Coder |
| Embeddings | BGE-M3 (Ollama), text-embedding-3 |

### 100% Local Mode

Run Luna entirely on local hardware with no external API calls:

```bash
# Pull recommended local models
docker exec luna-ollama ollama pull llama3.3:70b
docker exec luna-ollama ollama pull bge-m3
docker exec luna-ollama ollama pull mistral:7b
```

Configure Settings > Models to point all services to Ollama.

---

## Architecture

```
luna-chat/
|-- src/                    # Backend (Node.js/TypeScript)
|   |-- abilities/          # Tools and integrations
|   |   |-- agents.service.ts       # Claude CLI agent orchestration
|   |   |-- calendar.service.ts     # CalDAV integration
|   |   |-- checkins.service.ts     # Check-in scheduling
|   |   |-- documents.service.ts    # Document management
|   |   |-- email.service.ts        # Email orchestration
|   |   |-- knowledge.service.ts    # Knowledge base
|   |   |-- luna-media.service.ts   # Mood videos/images
|   |   |-- mood.service.ts         # Mood tracking
|   |   |-- orchestrator.ts         # Ability detection
|   |   |-- sandbox.service.ts      # Code execution
|   |   |-- tasks.service.ts        # Task management
|   |   |-- tools.service.ts        # Custom tools
|   |   |-- vision.service.ts       # Image analysis
|   |   |-- workspace.service.ts    # File workspace
|   |-- autonomous/         # Autonomous mode
|   |   |-- autonomous.service.ts   # Core logic
|   |   |-- council.service.ts      # Council deliberation
|   |   |-- friend.service.ts       # Friend conversations
|   |   |-- goals.service.ts        # Goal tracking
|   |   |-- insights.service.ts     # Insight generation
|   |   |-- research.service.ts     # Web research
|   |   |-- rss.service.ts          # RSS monitoring
|   |-- auth/               # Authentication
|   |-- chat/               # Chat processing
|   |   |-- chat.service.ts         # Message processing
|   |   |-- session.service.ts      # Session management
|   |   |-- startup.service.ts      # Greeting generation
|   |-- llm/                # LLM providers
|   |   |-- router.ts               # Model routing
|   |   |-- tts.service.ts          # Text-to-speech
|   |   |-- providers/              # Provider implementations
|   |-- memory/             # Memory system
|   |   |-- embedding.service.ts    # Vector embeddings
|   |   |-- facts.service.ts        # Fact extraction
|   |   |-- memory.service.ts       # Memory retrieval
|   |-- persona/            # Personality
|   |-- search/             # Web search
|   |-- security/           # Security middleware
|-- frontend/               # Next.js web UI
|   |-- src/
|   |   |-- components/
|   |   |   |-- ChatArea.tsx
|   |   |   |-- CommandCenter.tsx
|   |   |   |-- MobileBottomNav.tsx
|   |   |   |-- MobileSessionsOverlay.tsx
|   |   |   |-- settings/
|   |   |-- hooks/
|   |   |   |-- useIsMobile.ts
|-- android/                # Native Android app
|-- images/                 # Luna media (videos/images)
|-- secrets/                # Docker secrets
```

### Docker Services

| Service | Port | Description |
|---------|------|-------------|
| luna-frontend | 3004 | Next.js web UI |
| luna-api | 3005 | Backend API |
| luna-postgres | 5432 | PostgreSQL with pgvector |
| luna-redis | 6379 | Redis cache |
| luna-sandbox | - | Code execution sandbox |
| luna-ollama | 11434 | Local LLM and embeddings |
| luna-radicale | 5232 | CalDAV calendar server |
| docker-proxy | 2375 | Docker socket proxy |

---

## Installation

### Docker Deployment (Recommended)

```bash
# Clone the repository
git clone https://github.com/bitwarelabs/luna-chat.git
cd luna-chat

# Create secrets
mkdir -p secrets
echo "your-postgres-password" > secrets/postgres_password.txt
echo "your-jwt-secret" > secrets/jwt_secret.txt
echo "your-redis-password" > secrets/redis_password.txt
echo "your-encryption-key" > secrets/encryption_key.txt
# Add API keys as needed...
echo "sk-your-openai-key" > secrets/openai_api_key.txt
echo "sk-ant-your-anthropic-key" > secrets/anthropic_api_key.txt

# Build and start
docker compose build
docker compose up -d
```

### Manual Installation

```bash
# Clone and install
git clone https://github.com/bitwarelabs/luna-chat.git
cd luna-chat
npm install

# Configure
cp .env.example .env
# Edit .env with your settings

# Build and run
npm run migrate
npm run build
npm start
```

### Access Luna

- **Web UI**: http://localhost:3004
- **API**: http://localhost:3005
- **Default credentials**: Create account on first visit

---

## API Reference

### Chat Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat/sessions` | Create new session |
| GET | `/api/chat/sessions` | List sessions |
| GET | `/api/chat/sessions/:id` | Get session with messages |
| PATCH | `/api/chat/sessions/:id` | Update session |
| DELETE | `/api/chat/sessions/:id` | Delete session |
| POST | `/api/chat/sessions/:id/send` | Send message (SSE streaming) |
| POST | `/api/chat/sessions/:id/startup` | Generate greeting |
| PATCH | `/api/chat/sessions/:sid/messages/:mid` | Edit message |
| POST | `/api/chat/sessions/:sid/messages/:mid/regenerate` | Regenerate response |
| POST | `/api/chat/tts` | Text-to-speech |

### Abilities Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/abilities/summary` | All abilities overview |
| GET/POST | `/api/abilities/knowledge` | Knowledge management |
| GET/POST | `/api/abilities/tasks` | Task management |
| POST | `/api/abilities/code/execute` | Run code |
| GET/POST | `/api/abilities/workspace` | File workspace |
| GET/POST | `/api/abilities/documents` | Document management |
| GET/POST | `/api/abilities/tools` | Custom tools |
| POST | `/api/abilities/agents/execute` | Run agent |
| GET | `/api/abilities/mood/history` | Mood history |
| GET | `/api/abilities/luna-media` | Get Luna media |
| GET | `/api/abilities/checkins` | Check-in management |
| GET | `/api/abilities/calendar/events` | Calendar events |
| GET | `/api/abilities/email/inbox` | Email inbox |
| GET/PUT/DELETE | `/api/abilities/facts` | Fact management |

### Autonomous Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/autonomous/status` | Mode status |
| POST | `/api/autonomous/start` | Start autonomous |
| POST | `/api/autonomous/stop` | Stop autonomous |
| GET/PUT | `/api/autonomous/config` | Configuration |
| GET/POST | `/api/autonomous/goals` | Goal management |
| GET | `/api/autonomous/council` | Council members |
| GET/POST | `/api/autonomous/council/deliberations` | Deliberations |
| GET/POST | `/api/autonomous/rss` | RSS feeds |
| GET | `/api/autonomous/insights` | Generated insights |
| GET | `/api/autonomous/friends` | Friend conversations |

### Auth Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/refresh` | Refresh token |
| POST | `/api/auth/logout` | Logout |
| GET/PUT | `/api/auth/profile` | User profile |

### Settings Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/PUT | `/api/settings` | User settings |
| GET | `/api/settings/stats` | Usage statistics |
| GET | `/api/settings/metrics` | System metrics |

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment | production |
| `PORT` | API port | 3005 |
| `DATABASE_URL` | PostgreSQL connection | - |
| `REDIS_URL` | Redis connection | - |
| `JWT_SECRET` | JWT signing key | - |
| `ENCRYPTION_KEY` | Token encryption key | - |
| `OLLAMA_HOST` | Ollama URL | http://luna-ollama:11434 |
| `SEARXNG_URL` | Search engine URL | - |
| `ELEVENLABS_API_KEY` | TTS API key | - |

### Model Configuration

Configure models per-task in Settings > Models:

```json
{
  "main": { "provider": "openai", "model": "gpt-5.1" },
  "council": { "provider": "groq", "model": "llama-3.3-70b-versatile" },
  "researcher": { "provider": "anthropic", "model": "claude-sonnet-4-20250514" },
  "coder": { "provider": "anthropic", "model": "claude-sonnet-4-20250514" },
  "embeddings": { "provider": "ollama", "model": "bge-m3" }
}
```

---

## Security

Luna includes comprehensive security measures:

| Feature | Implementation |
|---------|----------------|
| **Secrets Management** | Docker secrets, never in code |
| **Token Encryption** | AES-256-GCM for OAuth tokens |
| **Authentication** | JWT with access/refresh flow |
| **Rate Limiting** | Redis-backed, per-endpoint |
| **Fail2ban** | IP-based login tracking |
| **SSRF Protection** | URL validation on external requests |
| **Input Validation** | Zod schemas on all endpoints |
| **SQL Injection** | Parameterized queries |
| **Command Injection** | spawn() not exec() |
| **XSS Prevention** | Content Security Policy headers |
| **Sandbox Isolation** | Docker-based code execution |

---

## Development

### Build Commands

```bash
# Development
npm run dev                 # Backend with hot reload
cd frontend && npm run dev  # Frontend dev server

# Production
npm run build              # Standard build
npm run build:prod         # Production (no source maps)

# Testing
npm test
npm run lint
npm run format
```

### Deploying Changes

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

### Mobile Support

The frontend includes responsive mobile layout:
- Viewport-based detection at 1024px breakpoint
- Bottom navigation for easy thumb access
- Slide-in sessions panel
- Activity tab for mobile view
- iOS safe area support

---

## Android App

Native Android app built with modern stack:

- **Jetpack Compose** - Declarative UI
- **Material 3** - Google's design system
- **Hilt** - Dependency injection
- **Kotlin Coroutines** - Async operations
- **Encrypted SharedPreferences** - Secure storage

### Building

```bash
cd android

# Debug builds
./gradlew assembleDevelopmentDebug  # Dev server
./gradlew assembleProductionDebug   # Prod server

# Release build
./gradlew assembleProductionRelease
```

APKs output to `android/app/build/outputs/apk/`

---

## Luna's Expression

Luna expresses emotions through media:

### Videos (29+ expressions)
- **Joy**: laughing, smile, hmmm_yes, i_agree
- **Sadness**: cry, oh_no, rain
- **Anger**: no_not_like, not_approve
- **Surprise**: what, are_you_sure
- **Neutral**: multiple variations

### Mood Images
- AI-generated images via DALL-E
- Cached for performance
- 8 emotion dimensions

---

## License

MIT License - see [LICENSE](LICENSE)

## Author

BitwareLabs

---

<div align="center">

**Luna - Your Private AI Companion**

[Report Bug](https://github.com/bitwarelabs/luna-chat/issues) - [Request Feature](https://github.com/bitwarelabs/luna-chat/issues)

</div>
