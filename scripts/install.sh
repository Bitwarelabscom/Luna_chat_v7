#!/usr/bin/env bash
# Luna Chat - Full Installation Script
# Sets up all three repos: luna-chat, memorycore, neuralsleep + searxng
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log()   { echo -e "${GREEN}[+]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[x]${NC} $1"; }
info()  { echo -e "${BLUE}[i]${NC} $1"; }
header(){ echo -e "\n${CYAN}=== $1 ===${NC}\n"; }

LUNA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PARENT_DIR="$(dirname "$LUNA_DIR")"
MEMORYCORE_DIR="${PARENT_DIR}/memorycore"
NEURALSLEEP_DIR="${PARENT_DIR}/neuralsleep"
SEARXNG_DIR="${PARENT_DIR}/searxng"

# ---------------------------------------------------------------------------
header "Luna Chat Installation"
# ---------------------------------------------------------------------------

echo "This script will set up the complete Luna ecosystem:"
echo "  - Luna Chat (main app)"
echo "  - MemoryCore (memory consolidation)"
echo "  - NeuralSleep (LNN neural networks)"
echo "  - SearXNG (privacy-respecting search)"
echo ""
echo "Expected directory layout:"
echo "  ${PARENT_DIR}/"
echo "    luna-chat/       (this repo)"
echo "    memorycore/"
echo "    neuralsleep/"
echo "    searxng/"
echo ""

# ---------------------------------------------------------------------------
header "Checking Prerequisites"
# ---------------------------------------------------------------------------

MISSING=0

# Docker
if command -v docker &>/dev/null; then
    DOCKER_VERSION=$(docker --version | grep -oP '\d+\.\d+' | head -1)
    log "Docker ${DOCKER_VERSION} found"
else
    err "Docker not found. Install from https://docs.docker.com/engine/install/"
    MISSING=1
fi

# Docker Compose v2
if docker compose version &>/dev/null; then
    COMPOSE_VERSION=$(docker compose version --short 2>/dev/null || echo "unknown")
    log "Docker Compose ${COMPOSE_VERSION} found"
else
    err "Docker Compose v2 not found. Install as Docker plugin."
    MISSING=1
fi

# Node.js
if command -v node &>/dev/null; then
    NODE_VERSION=$(node --version)
    log "Node.js ${NODE_VERSION} found"
    NODE_MAJOR=$(echo "$NODE_VERSION" | grep -oP '\d+' | head -1)
    if [ "$NODE_MAJOR" -lt 18 ]; then
        err "Node.js 18+ required (found ${NODE_VERSION})"
        MISSING=1
    fi
else
    err "Node.js not found. Install Node.js 20 LTS."
    MISSING=1
fi

# Git
if command -v git &>/dev/null; then
    log "Git $(git --version | awk '{print $3}') found"
else
    err "Git not found."
    MISSING=1
fi

# OpenSSL
if command -v openssl &>/dev/null; then
    log "OpenSSL found"
else
    err "OpenSSL not found (needed for generating secrets)."
    MISSING=1
fi

if [ "$MISSING" -eq 1 ]; then
    err "Missing prerequisites. Install them and re-run."
    exit 1
fi

# ---------------------------------------------------------------------------
header "Checking Repository Layout"
# ---------------------------------------------------------------------------

REPOS_OK=1

if [ -d "$LUNA_DIR" ]; then
    log "luna-chat found at ${LUNA_DIR}"
else
    err "luna-chat not found at ${LUNA_DIR}"
    REPOS_OK=0
fi

if [ -d "$MEMORYCORE_DIR" ]; then
    log "memorycore found at ${MEMORYCORE_DIR}"
else
    warn "memorycore not found at ${MEMORYCORE_DIR}"
    echo -n "  Clone memorycore repo? (y/N): "
    read -r CLONE_MC
    if [[ "$CLONE_MC" =~ ^[Yy]$ ]]; then
        echo -n "  Git URL for memorycore: "
        read -r MC_URL
        git clone "$MC_URL" "$MEMORYCORE_DIR"
        log "memorycore cloned"
    else
        warn "Skipping memorycore - MemoryCore features will be unavailable"
        REPOS_OK=0
    fi
fi

if [ -d "$NEURALSLEEP_DIR" ]; then
    log "neuralsleep found at ${NEURALSLEEP_DIR}"
else
    warn "neuralsleep not found at ${NEURALSLEEP_DIR}"
    echo -n "  Clone neuralsleep repo? (y/N): "
    read -r CLONE_NS
    if [[ "$CLONE_NS" =~ ^[Yy]$ ]]; then
        echo -n "  Git URL for neuralsleep: "
        read -r NS_URL
        git clone "$NS_URL" "$NEURALSLEEP_DIR"
        log "neuralsleep cloned"
    else
        warn "Skipping neuralsleep - LNN features will be unavailable"
    fi
fi

# ---------------------------------------------------------------------------
header "Generating Docker Secrets"
# ---------------------------------------------------------------------------

SECRETS_DIR="${LUNA_DIR}/secrets"
mkdir -p "$SECRETS_DIR"

generate_secret() {
    local FILE="$1"
    local DESC="$2"
    local LENGTH="${3:-32}"

    if [ -f "${SECRETS_DIR}/${FILE}" ] && [ -s "${SECRETS_DIR}/${FILE}" ]; then
        info "${DESC} already exists - keeping existing value"
    else
        openssl rand -hex "$LENGTH" | tr -d '\n' > "${SECRETS_DIR}/${FILE}"
        log "Generated ${DESC}"
    fi
}

generate_secret "postgres_password.txt" "PostgreSQL password"
generate_secret "jwt_secret.txt" "JWT secret" 32
generate_secret "redis_password.txt" "Redis password"
generate_secret "neo4j_password.txt" "Neo4j password"
generate_secret "encryption_key.txt" "Encryption key (AES-256)"

# ---------------------------------------------------------------------------
header "API Keys Configuration"
# ---------------------------------------------------------------------------

echo "Enter your API keys. Press Enter to skip optional ones."
echo "(Keys you skip can be added later to secrets/*.txt)"
echo ""

prompt_secret() {
    local FILE="$1"
    local DESC="$2"
    local REQUIRED="${3:-false}"

    if [ -f "${SECRETS_DIR}/${FILE}" ] && [ -s "${SECRETS_DIR}/${FILE}" ]; then
        info "${DESC} already configured - keeping existing value"
        return
    fi

    local LABEL="${DESC}"
    if [ "$REQUIRED" = "true" ]; then
        LABEL="${DESC} (REQUIRED)"
    else
        LABEL="${DESC} (optional)"
    fi

    echo -n "  ${LABEL}: "
    read -r VALUE
    if [ -n "$VALUE" ]; then
        printf '%s' "$VALUE" > "${SECRETS_DIR}/${FILE}"
        log "Saved ${DESC}"
    else
        touch "${SECRETS_DIR}/${FILE}"
        if [ "$REQUIRED" = "true" ]; then
            warn "Skipped ${DESC} - you'll need to add this later"
        fi
    fi
}

prompt_secret "openai_api_key.txt" "OpenAI API Key" "true"
prompt_secret "anthropic_api_key.txt" "Anthropic API Key"
prompt_secret "groq_api_key.txt" "Groq API Key"
prompt_secret "xai_api_key.txt" "xAI API Key"
prompt_secret "google_api_key.txt" "Google API Key"
prompt_secret "openrouter_api_key.txt" "OpenRouter API Key"
prompt_secret "moonshot_api_key.txt" "Moonshot API Key"
prompt_secret "elevenlabs_api_key.txt" "ElevenLabs API Key"
prompt_secret "email_password.txt" "Email Password"
prompt_secret "spotify_client_id.txt" "Spotify Client ID"
prompt_secret "spotify_client_secret.txt" "Spotify Client Secret"

# Ensure allowed_ips exists
touch "${SECRETS_DIR}/allowed_ips.txt"

# Remove any trailing newlines from all secrets
for f in "${SECRETS_DIR}"/*.txt; do
    if [ -f "$f" ]; then
        CONTENT=$(cat "$f")
        printf '%s' "$CONTENT" > "$f"
    fi
done

log "All secrets configured"

# ---------------------------------------------------------------------------
header "Creating Environment File"
# ---------------------------------------------------------------------------

NEO4J_PW=$(cat "${SECRETS_DIR}/neo4j_password.txt")
ENC_KEY=$(cat "${SECRETS_DIR}/encryption_key.txt")

if [ -f "${LUNA_DIR}/.env" ]; then
    warn ".env already exists - creating .env.new instead"
    ENV_FILE="${LUNA_DIR}/.env.new"
else
    ENV_FILE="${LUNA_DIR}/.env"
fi

cat > "$ENV_FILE" << EOF
# Luna Chat Environment Configuration
# Generated by install.sh on $(date -u +"%Y-%m-%d %H:%M:%S UTC")

# Encryption (also stored in secrets/)
ENCRYPTION_KEY=${ENC_KEY}

# Agent Engine
AGENT_ENGINE=layered_v1

# Router Architecture
ROUTER_ENABLED=true

# Neo4j
NEO4J_PASSWORD=${NEO4J_PW}
NEO4J_ENABLED=true

# LLM Providers
GROQ_ENABLED=true
ANTHROPIC_ENABLED=true
XAI_ENABLED=true
GOOGLE_ENABLED=true
MOONSHOT_ENABLED=true

# ElevenLabs TTS
ELEVENLABS_ENABLED=false

# Ollama
OLLAMA_EMBEDDING_MODEL=bge-m3

# Email (set to true and configure SMTP in docker-compose.yml to enable)
EMAIL_ENABLED=false
EMAIL_GATEKEEPER_ENABLED=false

# SearXNG
SEARXNG_ENABLED=true

# MemoryCore
MEMORYCORE_ENABLED=true

# TradeCore (disable unless you have the trading engine repo)
TRADECORE_ENABLED=false
TRADECORE_MOCK_MODE=true

# Sanhedrin A2A (requires Claude Code CLI credentials)
SANHEDRIN_ENABLED=false
EOF

log "Environment file created at ${ENV_FILE}"

# ---------------------------------------------------------------------------
header "Installing Node.js Dependencies"
# ---------------------------------------------------------------------------

log "Installing luna-chat backend dependencies..."
cd "$LUNA_DIR"
npm ci

log "Installing luna-chat frontend dependencies..."
cd "${LUNA_DIR}/frontend"
npm ci

if [ -d "${LUNA_DIR}/frontend-mobile" ]; then
    log "Installing luna-chat mobile frontend dependencies..."
    cd "${LUNA_DIR}/frontend-mobile"
    npm ci
fi

cd "$LUNA_DIR"

# ---------------------------------------------------------------------------
header "Building Applications"
# ---------------------------------------------------------------------------

log "Building luna-chat backend (TypeScript)..."
cd "$LUNA_DIR"
npm run build:prod

log "Building luna-chat frontend (Next.js)..."
cd "${LUNA_DIR}/frontend"
npm run build

cd "$LUNA_DIR"

# ---------------------------------------------------------------------------
header "Setting Up SearXNG"
# ---------------------------------------------------------------------------

if [ ! -d "$SEARXNG_DIR" ]; then
    log "Creating SearXNG directory..."
    mkdir -p "${SEARXNG_DIR}/searxng"

    cat > "${SEARXNG_DIR}/docker-compose.yaml" << 'EOF'
services:
  searxng:
    image: searxng/searxng:latest
    container_name: searxng
    ports:
      - "0.0.0.0:8888:8080"
    volumes:
      - ./searxng:/etc/searxng:rw
    environment:
      - SEARXNG_BASE_URL=http://localhost:8888/
    restart: unless-stopped
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
EOF
    log "SearXNG compose file created"
else
    log "SearXNG directory already exists"
fi

# ---------------------------------------------------------------------------
header "Setting Up Radicale (CalDAV)"
# ---------------------------------------------------------------------------

RADICALE_DIR="${LUNA_DIR}/radicale/config"
mkdir -p "$RADICALE_DIR"

if [ ! -f "${RADICALE_DIR}/config" ]; then
    cat > "${RADICALE_DIR}/config" << 'EOF'
# Radicale CalDAV/CardDAV Server Configuration

[server]
hosts = 0.0.0.0:5232
max_connections = 20
max_content_length = 100000000
timeout = 30

[auth]
type = none

[rights]
type = owner_only

[storage]
type = multifilesystem
filesystem_folder = /data

[logging]
level = info
mask_passwords = True
EOF
    log "Radicale config created"
else
    info "Radicale config already exists"
fi

# ---------------------------------------------------------------------------
header "Installation Complete"
# ---------------------------------------------------------------------------

echo ""
log "Installation finished successfully!"
echo ""
echo "Next steps:"
echo "  1. Review ${ENV_FILE}"
echo "  2. Run: ${LUNA_DIR}/scripts/start.sh"
echo "  3. Access Luna at http://localhost:3004"
echo ""
echo "Optional:"
echo "  - Add Telegram bot tokens to .env"
echo "  - Configure email SMTP settings in docker-compose.yml"
echo "  - Set up nginx reverse proxy for production"
echo ""
info "See INSTALL.md for detailed configuration options."
