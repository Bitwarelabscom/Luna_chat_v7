#!/usr/bin/env bash
# Luna Chat - Stop All Services
# Stops services in reverse order: luna -> memorycore -> searxng -> neuralsleep
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

log()   { echo -e "${GREEN}[+]${NC} $1"; }
header(){ echo -e "\n${CYAN}=== $1 ===${NC}\n"; }

LUNA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PARENT_DIR="$(dirname "$LUNA_DIR")"
MEMORYCORE_DIR="${PARENT_DIR}/memorycore"
NEURALSLEEP_DIR="${PARENT_DIR}/neuralsleep"
SEARXNG_DIR="${PARENT_DIR}/searxng"

header "Stopping Luna Ecosystem"

# Luna Chat
log "Stopping Luna Chat..."
cd "$LUNA_DIR"
docker compose down

# MemoryCore
if [ -d "$MEMORYCORE_DIR" ]; then
    log "Stopping MemoryCore..."
    cd "$MEMORYCORE_DIR"
    docker compose down
fi

# SearXNG
if [ -d "$SEARXNG_DIR" ]; then
    log "Stopping SearXNG..."
    cd "$SEARXNG_DIR"
    docker compose down
fi

# NeuralSleep
if [ -d "$NEURALSLEEP_DIR" ]; then
    log "Stopping NeuralSleep..."
    cd "$NEURALSLEEP_DIR"
    docker compose down
fi

log "All services stopped"
