#!/usr/bin/env bash
# Luna Chat - Rebuild and Restart
# Rebuilds code and Docker images, then restarts affected services
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log()   { echo -e "${GREEN}[+]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
info()  { echo -e "${BLUE}[i]${NC} $1"; }
header(){ echo -e "\n${CYAN}=== $1 ===${NC}\n"; }

LUNA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PARENT_DIR="$(dirname "$LUNA_DIR")"
MEMORYCORE_DIR="${PARENT_DIR}/memorycore"
NEURALSLEEP_DIR="${PARENT_DIR}/neuralsleep"

usage() {
    echo "Usage: $0 [component]"
    echo ""
    echo "Components:"
    echo "  all          Rebuild everything (default)"
    echo "  backend      Rebuild Luna API only"
    echo "  frontend     Rebuild Luna Frontend only"
    echo "  memorycore   Rebuild MemoryCore only"
    echo "  neuralsleep  Rebuild NeuralSleep only"
    echo ""
    echo "Examples:"
    echo "  $0              # Rebuild all"
    echo "  $0 backend      # Rebuild just the backend"
    echo "  $0 frontend     # Rebuild just the frontend"
}

COMPONENT="${1:-all}"

rebuild_backend() {
    header "Rebuilding Luna Backend"
    cd "$LUNA_DIR"
    log "Compiling TypeScript..."
    npm run build:prod
    log "Building Docker image..."
    docker compose build luna-api
    log "Restarting luna-api..."
    docker compose up -d luna-api
    log "Backend rebuild complete"
}

rebuild_frontend() {
    header "Rebuilding Luna Frontend"
    cd "${LUNA_DIR}/frontend"
    log "Building Next.js..."
    npm run build
    cd "$LUNA_DIR"
    log "Building Docker image..."
    docker compose build luna-frontend
    log "Restarting luna-frontend..."
    docker compose up -d luna-frontend
    log "Frontend rebuild complete"
}

rebuild_memorycore() {
    if [ ! -d "$MEMORYCORE_DIR" ]; then
        warn "MemoryCore not found at ${MEMORYCORE_DIR}"
        return
    fi
    header "Rebuilding MemoryCore"
    cd "$MEMORYCORE_DIR"
    log "Building Docker image..."
    docker compose build api
    log "Restarting memorycore-api..."
    docker compose up -d api
    log "MemoryCore rebuild complete"
}

rebuild_neuralsleep() {
    if [ ! -d "$NEURALSLEEP_DIR" ]; then
        warn "NeuralSleep not found at ${NEURALSLEEP_DIR}"
        return
    fi
    header "Rebuilding NeuralSleep"
    cd "$NEURALSLEEP_DIR"
    log "Building Docker images..."
    docker compose build
    log "Restarting NeuralSleep services..."
    docker compose up -d
    log "NeuralSleep rebuild complete"
}

case "$COMPONENT" in
    all)
        rebuild_backend
        rebuild_frontend
        rebuild_memorycore
        rebuild_neuralsleep
        ;;
    backend|api)
        rebuild_backend
        ;;
    frontend|web)
        rebuild_frontend
        ;;
    memorycore|mc)
        rebuild_memorycore
        ;;
    neuralsleep|ns)
        rebuild_neuralsleep
        ;;
    -h|--help|help)
        usage
        exit 0
        ;;
    *)
        echo "Unknown component: $COMPONENT"
        usage
        exit 1
        ;;
esac

echo ""
log "Rebuild complete!"
