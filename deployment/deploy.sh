#!/bin/bash

# Skip-Bo Game Deployment Script
# This script helps you deploy the Skip-Bo game using Docker

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

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first:"
    echo "   https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✅ Docker is installed"
echo "✅ Docker Compose is installed"
echo ""

# Detect IP address
echo "🔍 Detecting your IP address..."
if command -v hostname &> /dev/null; then
    IP_ADDRESS=$(hostname -I 2>/dev/null | awk '{print $1}')
elif command -v ip &> /dev/null; then
    IP_ADDRESS=$(ip addr show | grep "inet " | grep -v "127.0.0.1" | awk '{print $2}' | cut -d/ -f1 | head -n1)
else
    IP_ADDRESS="localhost"
fi

echo "📍 Your IP address: $IP_ADDRESS"
echo ""

# Navigate to docker directory
cd "$(dirname "$0")/docker"

# Embed git commit hash in the client build (shown in footer)
export REACT_APP_COMMIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Build and start services
echo "🏗️  Building Docker images (this may take a few minutes)..."
docker-compose build

echo ""
echo "🚀 Starting services..."
docker-compose up -d

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 5

# Check if services are running
if docker-compose ps | grep -q "Up"; then
    echo ""
    echo "╔════════════════════════════════════════════════════╗"
    echo "║              ✅ Deployment Successful!             ║"
    echo "╚════════════════════════════════════════════════════╝"
    echo ""
    echo "🎮 Access the game at:"
    echo "   Local:   http://localhost"
    echo "   Network: http://$IP_ADDRESS"
    echo ""
    echo "📊 View logs:           docker-compose logs -f"
    echo "🔄 Restart services:    docker-compose restart"
    echo "🛑 Stop services:       docker-compose down"
    echo "📋 Check status:        docker-compose ps"
    echo ""
    echo "🎉 Happy gaming!"
else
    echo ""
    echo "❌ Something went wrong. Check logs with:"
    echo "   docker-compose logs"
    exit 1
fi
