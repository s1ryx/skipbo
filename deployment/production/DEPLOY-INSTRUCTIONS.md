# Production Deployment Instructions

## Overview

Deploy Skip-Bo with automatic HTTPS using Docker and Caddy. Caddy handles LetsEncrypt certificate provisioning and renewal automatically.

## Prerequisites

- A server with Docker and Docker Compose installed
- A domain name with DNS A record pointing to the server's IP
- Ports 80 and 443 open (required for LetsEncrypt HTTP challenge)

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/your-org/skip-bo-game.git
cd skip-bo-game

# Option A: Run the deploy script (prompts for domain and email)
chmod +x deployment/deploy.sh
./deployment/deploy.sh

# Option B: Manual setup
cd deployment/docker
cp .env.example .env
# Edit .env with your domain and email
REACT_APP_COMMIT_HASH=$(git rev-parse --short HEAD) docker compose build
docker compose up -d
```

That's it. Caddy will automatically obtain a LetsEncrypt certificate on the first request.

### 2. Verify

```bash
# Check service status
docker compose ps

# View logs
docker compose logs -f

# Test HTTPS
curl -I https://your-domain.com/health
```

## Configuration

The only file you need to edit is `deployment/docker/.env`:

```env
DOMAIN=skipbo.example.com
ACME_EMAIL=admin@example.com
```

## Architecture

```
Port 80  → Caddy → HTTP to HTTPS redirect
Port 443 → Caddy → /              → client:80 (React app)
                  → /socket.io/   → server:3001 (WebSocket)
                  → /api/*        → server:3001 (REST API, /api/ prefix stripped)
                  → /health       → 200 OK
```

## Troubleshooting

**View logs:**

```bash
docker compose logs -f caddy
docker compose logs -f server
docker compose logs -f client
```

**Certificate issues:**

Caddy obtains certificates automatically. If it fails:

- Verify DNS A record points to this server: `dig your-domain.com`
- Ensure ports 80 and 443 are open and not used by another process
- Check Caddy logs: `docker compose logs caddy`
- Caddy retries automatically with backoff if the first attempt fails

**WebSocket not connecting:**

- Check browser console for errors
- Verify CORS_ORIGIN matches your domain in `docker compose config`
- Check Caddy logs for proxy errors

**Stale build after code changes:**

Docker layer caching correctly invalidates when source files change,
so a normal `docker compose build` is sufficient after `git pull`.
If you suspect a stale cache, force a clean rebuild:

```bash
docker compose build --no-cache
```

## Useful Commands

```bash
docker compose ps          # Service status
docker compose logs -f     # Follow all logs
docker compose restart     # Restart services
docker compose down        # Stop all services
docker compose up -d       # Start services
docker compose build       # Rebuild images
```

## Updating

```bash
cd /path/to/skip-bo-game
git pull
cd deployment/docker
REACT_APP_COMMIT_HASH=$(git rev-parse --short HEAD) docker compose build
docker compose up -d
```
