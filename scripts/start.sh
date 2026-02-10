#!/usr/bin/env bash
# Luna Chat - Start All Services
# Starts services in the correct order: neuralsleep -> searxng -> memorycore -> luna
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

wait_healthy() {
    local CONTAINER="$1"
    local TIMEOUT="${2:-120}"
    local ELAPSED=0

    echo -n "  Waiting for ${CONTAINER}..."
    while [ $ELAPSED -lt $TIMEOUT ]; do
        STATUS=$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "not_found")
        if [ "$STATUS" = "healthy" ]; then
            echo -e " ${GREEN}healthy${NC}"
            return 0
        elif [ "$STATUS" = "not_found" ]; then
            echo -e " ${RED}not found${NC}"
            return 1
        fi
        sleep 2
        ELAPSED=$((ELAPSED + 2))
        echo -n "."
    done
    echo -e " ${YELLOW}timeout (${TIMEOUT}s)${NC}"
    return 1
}

# ---------------------------------------------------------------------------
header "Starting Luna Ecosystem"
# ---------------------------------------------------------------------------

# Step 1: NeuralSleep
if [ -d "$NEURALSLEEP_DIR" ]; then
    header "Step 1/4: NeuralSleep (LNN Services)"
    cd "$NEURALSLEEP_DIR"
    docker compose up -d
    log "NeuralSleep containers started"

    # Wait for postgres and redis first
    wait_healthy "neuralsleep-postgres" 60
    wait_healthy "neuralsleep-redis" 30

    # Wait for migrations to complete
    info "Waiting for NeuralSleep migrations..."
    docker compose logs -f migrations 2>/dev/null || true

    # Wait for LNN services
    wait_healthy "neuralsleep-semantic" 120
    wait_healthy "neuralsleep-episodic" 120
    wait_healthy "neuralsleep-working" 120
    wait_healthy "neuralsleep-consciousness" 120

    log "NeuralSleep is ready"
else
    warn "NeuralSleep not found at ${NEURALSLEEP_DIR} - skipping"
fi

# Step 2: SearXNG
header "Step 2/4: SearXNG (Search Engine)"
if [ -d "$SEARXNG_DIR" ]; then
    cd "$SEARXNG_DIR"
    docker compose up -d
    log "SearXNG started"

    # SearXNG doesn't have a healthcheck, give it a moment
    sleep 3
    if docker ps --filter "name=searxng" --filter "status=running" -q | grep -q .; then
        log "SearXNG is running"
    else
        warn "SearXNG may not be running correctly"
    fi
else
    warn "SearXNG not found at ${SEARXNG_DIR} - skipping"
fi

# Step 3: MemoryCore
if [ -d "$MEMORYCORE_DIR" ]; then
    header "Step 3/4: MemoryCore (Memory Consolidation)"
    cd "$MEMORYCORE_DIR"
    docker compose up -d
    log "MemoryCore containers started"

    wait_healthy "memorycore-postgres" 60
    wait_healthy "memorycore-redis" 30

    # MemoryCore API may not have healthcheck, check if running
    sleep 5
    if docker ps --filter "name=memorycore-api" --filter "status=running" -q | grep -q .; then
        log "MemoryCore API is running"
    else
        warn "MemoryCore API may not be running correctly"
    fi
else
    warn "MemoryCore not found at ${MEMORYCORE_DIR} - skipping"
fi

# Step 4: Luna Chat
header "Step 4/4: Luna Chat (Main Application)"
cd "$LUNA_DIR"

# Build Docker images if needed
if ! docker image inspect luna-api:latest &>/dev/null 2>&1; then
    log "Building Luna Docker images (first run)..."
    docker compose build
fi

docker compose up -d
log "Luna Chat containers started"

# Wait for core infrastructure
wait_healthy "luna-postgres" 60
wait_healthy "luna-redis" 30
wait_healthy "luna-neo4j" 120
wait_healthy "luna-ollama" 60

# Wait for API
wait_healthy "luna-api" 120

# Wait for frontend
wait_healthy "luna-frontend" 60

# ---------------------------------------------------------------------------
header "Pulling Ollama Models"
# ---------------------------------------------------------------------------

# Check if bge-m3 is already pulled
if docker exec luna-ollama ollama list 2>/dev/null | grep -q "bge-m3"; then
    info "bge-m3 embedding model already available"
else
    log "Pulling bge-m3 embedding model (this may take a few minutes)..."
    docker exec luna-ollama ollama pull bge-m3
    log "bge-m3 model pulled"
fi

# ---------------------------------------------------------------------------
header "Status"
# ---------------------------------------------------------------------------

echo ""
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | sort
echo ""

# Quick health checks
echo ""
log "Service health:"
for endpoint in \
    "http://127.0.0.1:3005/api/health|Luna API" \
    "http://127.0.0.1:3004/|Luna Frontend" \
    "http://127.0.0.1:3007/health|MemoryCore" \
    "http://127.0.0.1:5000/health|NeuralSleep Semantic" \
    "http://127.0.0.1:5002/health|NeuralSleep Working"; do

    URL="${endpoint%%|*}"
    NAME="${endpoint##*|}"
    if curl -sf --max-time 5 "$URL" &>/dev/null; then
        echo -e "  ${GREEN}OK${NC}  ${NAME}"
    else
        echo -e "  ${RED}--${NC}  ${NAME} (not responding)"
    fi
done

echo ""
log "Luna Chat is ready!"
echo ""
echo "  Web UI:  http://localhost:3004"
echo "  API:     http://localhost:3005/api/health"
echo ""
info "First time? Create an account at the login page."
