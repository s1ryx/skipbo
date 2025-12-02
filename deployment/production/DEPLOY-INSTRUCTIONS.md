# Deployment Instructions for debian12test.beveb.com

## Overview
This directory contains configuration files for deploying Skip-Bo to debian12test.beveb.com with HTTPS.

## Files
- `docker-compose.override.yml` - Overrides for HTTPS and certificate mounting
- `nginx-https.conf` - HTTPS nginx configuration with LetsEncrypt
- `deploy-to-server.sh` - Automated deployment script

## Prerequisites on Server
- Docker and Docker Compose installed
- LetsEncrypt certificate at `/etc/letsencrypt/live/debian12test.beveb.com/`
- Ports 80 and 443 available (bare metal nginx will be stopped)

## Deployment Steps

### 1. Copy files to the server

From your local machine (WSL):
```bash
cd /home/maint/skip-bo-game

# Copy entire project to server
rsync -avz --exclude 'node_modules' --exclude '.git' \
  ./ root@debian12test.beveb.com:/root/skip-bo-game/
```

### 2. On the server

```bash
ssh root@debian12test.beveb.com
cd /root/skip-bo-game

# Copy override file to docker directory
cp deployment/production/docker-compose.override.yml deployment/docker/

# Make deploy script executable
chmod +x deployment/production/deploy-to-server.sh

# Run deployment
./deployment/production/deploy-to-server.sh
```

### 3. Manual deployment (alternative)

If you prefer manual control:

```bash
# Stop nginx
sudo systemctl stop nginx

# Navigate to deployment directory
cd deployment/docker

# Copy override file
cp ../production/docker-compose.override.yml ./

# Build and start
docker-compose build
docker-compose up -d

# Check status
docker-compose ps
docker-compose logs -f
```

## Testing

1. Visit https://debian12test.beveb.com
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
- Verify certificate path: `ls -la /etc/letsencrypt/live/debian12test.beveb.com/`
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
