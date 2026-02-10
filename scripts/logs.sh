#!/usr/bin/env bash
# Luna Chat - View Logs
# Quick access to service logs
set -euo pipefail

usage() {
    echo "Usage: $0 <service> [docker-logs-args...]"
    echo ""
    echo "Services:"
    echo "  api, backend     luna-api"
    echo "  frontend, web    luna-frontend"
    echo "  postgres, db     luna-postgres"
    echo "  redis            luna-redis"
    echo "  neo4j            luna-neo4j"
    echo "  ollama           luna-ollama"
    echo "  sandbox          luna-sandbox"
    echo "  memorycore, mc   memorycore-api"
    echo "  semantic         neuralsleep-semantic"
    echo "  episodic         neuralsleep-episodic"
    echo "  working          neuralsleep-working"
    echo "  consciousness    neuralsleep-consciousness"
    echo "  searxng          searxng"
    echo "  all              all luna containers"
    echo ""
    echo "Examples:"
    echo "  $0 api                # Last logs from luna-api"
    echo "  $0 api -f             # Follow luna-api logs"
    echo "  $0 api --tail 100     # Last 100 lines"
    echo "  $0 all -f --tail 20   # Follow all luna services"
}

if [ $# -eq 0 ]; then
    usage
    exit 1
fi

SERVICE="$1"
shift

case "$SERVICE" in
    api|backend)      CONTAINER="luna-api" ;;
    frontend|web)     CONTAINER="luna-frontend" ;;
    postgres|db)      CONTAINER="luna-postgres" ;;
    redis)            CONTAINER="luna-redis" ;;
    neo4j)            CONTAINER="luna-neo4j" ;;
    ollama)           CONTAINER="luna-ollama" ;;
    sandbox)          CONTAINER="luna-sandbox" ;;
    radicale)         CONTAINER="luna-radicale" ;;
    sanhedrin)        CONTAINER="luna-sanhedrin" ;;
    tradecore)        CONTAINER="tradecore" ;;
    memorycore|mc)    CONTAINER="memorycore-api" ;;
    mc-postgres)      CONTAINER="memorycore-postgres" ;;
    mc-redis)         CONTAINER="memorycore-redis" ;;
    semantic)         CONTAINER="neuralsleep-semantic" ;;
    episodic)         CONTAINER="neuralsleep-episodic" ;;
    working)          CONTAINER="neuralsleep-working" ;;
    consciousness)    CONTAINER="neuralsleep-consciousness" ;;
    ns-postgres)      CONTAINER="neuralsleep-postgres" ;;
    searxng)          CONTAINER="searxng" ;;
    all)
        docker logs luna-api "$@" 2>&1 &
        docker logs luna-frontend "$@" 2>&1 &
        docker logs memorycore-api "$@" 2>&1 &
        wait
        exit 0
        ;;
    -h|--help|help)
        usage
        exit 0
        ;;
    *)
        # Try as literal container name
        CONTAINER="$SERVICE"
        ;;
esac

docker logs "$CONTAINER" "$@"
