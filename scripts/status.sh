#!/usr/bin/env bash
# Luna Chat - Status Check
# Shows health status of all Luna ecosystem services
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

header(){ echo -e "\n${CYAN}=== $1 ===${NC}\n"; }

header "Luna Ecosystem Status"

# Container status
echo "Containers:"
echo ""
for CONTAINER in \
    "luna-api" "luna-frontend" "luna-mobile" "luna-postgres" "luna-redis" \
    "luna-neo4j" "luna-ollama" "luna-radicale" "luna-sandbox" "luna-sanhedrin" \
    "docker-proxy" "tradecore" \
    "memorycore-api" "memorycore-postgres" "memorycore-redis" \
    "neuralsleep-semantic" "neuralsleep-episodic" "neuralsleep-working" \
    "neuralsleep-consciousness" "neuralsleep-postgres" "neuralsleep-redis" \
    "searxng"; do

    STATUS=$(docker inspect --format='{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "not_found")
    HEALTH=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no_check{{end}}' "$CONTAINER" 2>/dev/null || echo "")

    if [ "$STATUS" = "not_found" ]; then
        printf "  ${RED}--${NC}  %-30s not deployed\n" "$CONTAINER"
    elif [ "$STATUS" = "running" ]; then
        if [ "$HEALTH" = "healthy" ]; then
            printf "  ${GREEN}OK${NC}  %-30s running (healthy)\n" "$CONTAINER"
        elif [ "$HEALTH" = "unhealthy" ]; then
            printf "  ${RED}!!${NC}  %-30s running (unhealthy)\n" "$CONTAINER"
        else
            printf "  ${GREEN}OK${NC}  %-30s running\n" "$CONTAINER"
        fi
    else
        printf "  ${YELLOW}--${NC}  %-30s %s\n" "$CONTAINER" "$STATUS"
    fi
done

# HTTP health checks
header "HTTP Health Endpoints"

for endpoint in \
    "http://127.0.0.1:3005/api/health|Luna API" \
    "http://127.0.0.1:3004/|Luna Frontend" \
    "http://127.0.0.1:3007/health|MemoryCore API" \
    "http://127.0.0.1:5000/health|NeuralSleep Semantic" \
    "http://127.0.0.1:5001/health|NeuralSleep Episodic" \
    "http://127.0.0.1:5002/health|NeuralSleep Working" \
    "http://127.0.0.1:5003/health|NeuralSleep Consciousness" \
    "http://127.0.0.1:8888/|SearXNG"; do

    URL="${endpoint%%|*}"
    NAME="${endpoint##*|}"
    HTTP_CODE=$(curl -sf --max-time 3 -o /dev/null -w '%{http_code}' "$URL" 2>/dev/null || echo "000")

    if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 400 ]; then
        printf "  ${GREEN}${HTTP_CODE}${NC}  %s\n" "$NAME"
    else
        printf "  ${RED}${HTTP_CODE}${NC}  %s\n" "$NAME"
    fi
done

# Docker resource usage
header "Resource Usage"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null | \
    grep -E "(luna-|memorycore-|neuralsleep-|searxng|tradecore|docker-proxy|NAME)" | sort
