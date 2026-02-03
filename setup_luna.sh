#!/bin/bash

# Luna Chat Setup Script (Portable Version)
# This script automates the setup process for Luna Chat on any machine.

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[Luna Setup]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[Luna Setup]${NC} $1"
}

error() {
    echo -e "${RED}[Luna Setup]${NC} $1"
}

# 1. Check Prerequisites
log "Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    error "Docker is not installed. Please install Docker first."
    exit 1
fi

# 2. Setup Secrets
log "Setting up secrets..."
mkdir -p secrets

generate_secret() {
    local file="secrets/$1.txt"
    if [ ! -f "$file" ]; then
        log "Generating $1..."
        openssl rand -base64 32 > "$file"
    else
        warn "$1 already exists. Skipping generation."
    fi
}

create_placeholder_secret() {
    local file="secrets/$1.txt"
    if [ ! -f "$file" ]; then
        log "Creating placeholder for $1..."
        echo "CHANGE_ME" > "$file"
    fi
}

# Generate internal secrets
generate_secret "postgres_password"
generate_secret "jwt_secret"
generate_secret "redis_password"
generate_secret "encryption_key"
generate_secret "email_password"

# Create placeholders for API keys
create_placeholder_secret "openai_api_key"
create_placeholder_secret "groq_api_key"
create_placeholder_secret "anthropic_api_key"
create_placeholder_secret "xai_api_key"
create_placeholder_secret "openrouter_api_key"
create_placeholder_secret "google_api_key"
create_placeholder_secret "elevenlabs_api_key"
create_placeholder_secret "spotify_client_id"
create_placeholder_secret "spotify_client_secret"

if [ ! -f "secrets/claude_credentials.json" ]; then
    log "Creating placeholder for claude_credentials.json..."
    echo '{ "note": "Replace this with your actual Claude Code credentials" }' > secrets/claude_credentials.json
fi

if [ ! -f "secrets/allowed_ips.txt" ]; then
    log "Creating secrets/allowed_ips.txt..."
    echo "127.0.0.1" > secrets/allowed_ips.txt
    echo "10.0.0.0/8" >> secrets/allowed_ips.txt
fi

# 3. Environment Configuration
log "Configuring environment..."
if [ ! -f ".env" ]; then
    cp .env.example .env
fi

# 4. Build and Start
log "Setup complete."
log "Next steps:"
log "1. Update API keys in the 'secrets/' directory."
log "2. Run the following command to build and start:"
echo ""
echo -e "    ${GREEN}docker compose -f docker-compose.portable.yml build && docker compose -f docker-compose.portable.yml up -d${NC}"
echo ""