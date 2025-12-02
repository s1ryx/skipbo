#!/bin/bash

# Skip-Bo Network Game Startup Script
# This script builds the client and starts the server

set -e

echo "========================================="
echo "Skip-Bo Network Game Setup"
echo "========================================="
echo ""

# Get WSL IP
WSL_IP=$(hostname -I | awk '{print $1}')
echo "WSL IP Address: $WSL_IP"
echo "Windows Host IP: 192.168.1.184"
echo ""

# Check if .env files exist
if [ ! -f server/.env ]; then
    echo "ERROR: server/.env not found!"
    exit 1
fi

if [ ! -f client/.env ]; then
    echo "ERROR: client/.env not found!"
    exit 1
fi

echo "✓ Environment files configured"
echo ""

# Check if node_modules exist
if [ ! -d "server/node_modules" ]; then
    echo "Installing server dependencies..."
    cd server && npm install && cd ..
fi

if [ ! -d "client/node_modules" ]; then
    echo "Installing client dependencies..."
    cd client && npm install && cd ..
fi

echo "✓ Dependencies installed"
echo ""

# Build client
echo "Building client for production..."
cd client
npm run build
cd ..

echo "✓ Client built successfully"
echo ""

# Check if serve is installed
if ! command -v serve &> /dev/null; then
    echo "Installing serve globally..."
    npm install -g serve
fi

echo "========================================="
echo "Setup Complete!"
echo "========================================="
echo ""
echo "NEXT STEPS:"
echo ""
echo "1. On Windows (as Administrator), run:"
echo "   cd $(pwd | sed 's|/mnt/c|C:|' | sed 's|/|\\|g')"
echo "   powershell -ExecutionPolicy Bypass -File setup-wsl-portforward.ps1"
echo ""
echo "2. Then start the server (in this terminal):"
echo "   cd server && npm start"
echo ""
echo "3. In another terminal, serve the client:"
echo "   cd client && serve -s build -l 3000"
echo ""
echo "4. Access the game at:"
echo "   http://192.168.1.184:3000"
echo ""
echo "========================================="
