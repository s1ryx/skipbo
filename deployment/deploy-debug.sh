#!/bin/bash

# Skip-Bo Game Debug Deployment Script
#
# Same as deploy.sh but layers docker-compose.debug.yml on top to enable:
#   - server LOG_LEVEL=debug   (also flips info-level structured traces on)
#   - client REACT_APP_DEBUG=1 (bakes the client debug logger into the bundle)
#
# Intended for staging only. Production uses deploy.sh.

set -e

echo "╔════════════════════════════════════════════════════╗"
echo "║   Skip-Bo Card Game - Docker Deployment (DEBUG)    ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed."
    exit 1
fi

COMPOSE_CMD=""
if docker compose version &> /dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
else
    echo "❌ Docker Compose is not installed."
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/docker"

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        read -p "Enter your domain name: " DOMAIN
        read -p "Enter email for LetsEncrypt (optional): " ACME_EMAIL
        {
            echo "DOMAIN=$DOMAIN"
            [ -n "$ACME_EMAIL" ] && echo "ACME_EMAIL=$ACME_EMAIL"
        } > .env
    else
        echo "❌ No .env file or .env.example found."
        exit 1
    fi
fi

source .env
echo "🌐 Domain: $DOMAIN"
echo "🐞 Debug logging: ENABLED (server LOG_LEVEL=debug, client REACT_APP_DEBUG=1)"
echo ""

export REACT_APP_COMMIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# The two -f flags merge docker-compose.debug.yml's env + build args into the
# base compose. Order matters: the override file must come second.
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.debug.yml"

echo "🏗️  Building Docker images..."
$COMPOSE_CMD $COMPOSE_FILES build

echo ""
echo "🚀 Starting services..."
$COMPOSE_CMD $COMPOSE_FILES down --remove-orphans 2>/dev/null || true
$COMPOSE_CMD $COMPOSE_FILES up -d

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 10

echo ""
echo "📊 Service status:"
$COMPOSE_CMD $COMPOSE_FILES ps
echo ""

if $COMPOSE_CMD $COMPOSE_FILES ps | grep -q "Up\|running"; then
    echo "╔════════════════════════════════════════════════════╗"
    echo "║         ✅ Debug Deployment Successful!            ║"
    echo "╚════════════════════════════════════════════════════╝"
    echo ""
    echo "🎮 Access the game at: https://$DOMAIN"
    echo ""
    echo "📊 Watching debug logs:"
    echo "   Server: $COMPOSE_CMD $COMPOSE_FILES logs -f server"
    echo "   Client: open browser devtools, filter console by '[skipbo:'"
    echo ""
else
    echo "⚠️  Services may still be starting. Check logs with:"
    echo "   $COMPOSE_CMD $COMPOSE_FILES logs -f"
fi
