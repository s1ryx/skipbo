#!/bin/bash

# Skip-Bo Game Deployment Script
# Deploys the game with automatic HTTPS via Caddy + LetsEncrypt

set -e

echo "╔════════════════════════════════════════════════════╗"
echo "║       Skip-Bo Card Game - Docker Deployment        ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first:"
    echo "   https://docs.docker.com/get-docker/"
    exit 1
fi

# Determine compose command
COMPOSE_CMD=""
if docker compose version &> /dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
else
    echo "❌ Docker Compose is not installed. Please install Docker Compose first:"
    echo "   https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✅ Docker is installed"
echo "✅ Docker Compose is installed ($COMPOSE_CMD)"
echo ""

# Navigate to docker directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/docker"

# Check for .env file
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        echo "📝 No .env file found. Let's create one."
        echo ""

        read -p "Enter your domain name (e.g. skipbo.example.com): " DOMAIN
        read -p "Enter email for LetsEncrypt notifications (optional, press Enter to skip): " ACME_EMAIL

        {
            echo "DOMAIN=$DOMAIN"
            [ -n "$ACME_EMAIL" ] && echo "ACME_EMAIL=$ACME_EMAIL"
        } > .env
        echo ""
        echo "✅ Created .env with domain: $DOMAIN"
    else
        echo "❌ No .env file or .env.example found."
        exit 1
    fi
fi

# Source .env to display domain
source .env
echo "🌐 Domain: $DOMAIN"
echo ""

# Embed git commit hash in the client build (shown in footer)
export REACT_APP_COMMIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Build and start services
echo "🏗️  Building Docker images (this may take a few minutes)..."
$COMPOSE_CMD build

echo ""
echo "🚀 Starting services..."
$COMPOSE_CMD down --remove-orphans 2>/dev/null || true
$COMPOSE_CMD up -d

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Check if services are running
echo ""
echo "📊 Service status:"
$COMPOSE_CMD ps
echo ""

if $COMPOSE_CMD ps | grep -q "Up\|running"; then
    echo "╔════════════════════════════════════════════════════╗"
    echo "║              ✅ Deployment Successful!             ║"
    echo "╚════════════════════════════════════════════════════╝"
    echo ""
    echo "🎮 Access the game at:"
    echo "   https://$DOMAIN"
    echo ""
    echo "   Caddy will automatically obtain a LetsEncrypt"
    echo "   certificate on first request. This may take a"
    echo "   few seconds on the very first visit."
    echo ""
    echo "📊 Useful commands:"
    echo "   View logs:       $COMPOSE_CMD logs -f"
    echo "   Restart:         $COMPOSE_CMD restart"
    echo "   Stop:            $COMPOSE_CMD down"
    echo "   Status:          $COMPOSE_CMD ps"
    echo ""
else
    echo "⚠️  Services may still be starting. Check logs with:"
    echo "   $COMPOSE_CMD logs -f"
fi
