# Deployment Instructions for example.com

## Overview

This directory contains configuration files for deploying Skip-Bo to example.com with HTTPS.

## Files

- `docker-compose.override.yml` - Overrides for HTTPS and certificate mounting
- `nginx-https.conf` - HTTPS nginx configuration with LetsEncrypt
- `deploy-to-server.sh` - Automated deployment script

## Prerequisites on Server

- Docker and Docker Compose installed
- LetsEncrypt certificate at `/etc/letsencrypt/live/example.com/`
- Ports 80 and 443 available (bare metal nginx will be stopped)

## Deployment Steps

### 1. Clone the repository

```bash
git clone https://github.com/your-org/skip-bo-game.git
cd skip-bo-game

# Copy override file to docker directory
cp deployment/production/docker-compose.override.yml deployment/docker/

# Make deploy script executable
chmod +x deployment/production/deploy-to-server.sh

# Run deployment
./deployment/production/deploy-to-server.sh
```

### 2. Manual deployment (alternative)

If you prefer manual control:

```bash
# Stop nginx
sudo systemctl stop nginx

# Navigate to deployment directory
cd deployment/docker

# Copy override file
cp ../production/docker-compose.override.yml ./

# Build and start (commit hash is shown in the game footer)
REACT_APP_COMMIT_HASH=$(git rev-parse --short HEAD) docker-compose build
docker-compose up -d

# Check status
docker-compose ps
docker-compose logs -f
```

## Testing

1. Visit https://example.com
2. Create a game room
3. Test WebSocket connection (check browser console)
4. Join from another device/browser

## Troubleshooting

**View logs:**

```bash
docker-compose logs -f nginx
docker-compose logs -f server
docker-compose logs -f client
```

**Check container health:**

```bash
docker-compose ps
```

**Test nginx config:**

```bash
docker-compose exec nginx nginx -t
```

**WebSocket not connecting:**

- Check browser console for errors
- Verify CORS_ORIGIN in docker-compose.override.yml
- Check nginx logs: `docker-compose logs nginx`

**SSL errors:**

- Verify certificate path: `ls -la /etc/letsencrypt/live/example.com/`
- Check certificate permissions
- Ensure certificate is not expired

## Rollback

To restore bare metal nginx:

```bash
docker-compose down
sudo systemctl start nginx
```

## Port Mapping

- Port 80: HTTP → HTTPS redirect
- Port 443: HTTPS traffic
  - `/` → React client
  - `/socket.io/` → WebSocket server
  - `/api/` → REST API
  - `/health` → Health check
