# Skip-Bo Card Game

A multiplayer Skip-Bo card game built with React and Node.js using Socket.IO for real-time communication.

## Tech Stack

### Backend

- **Node.js** - Server runtime
- **Express** - Web framework
- **Socket.IO** - Real-time bidirectional communication

### Frontend

- **React** - UI library
- **Socket.IO Client** - Real-time communication client
- **CSS3** - Styling with animations

## Game Rules

Be the first player to empty your stockpile by building sequential piles
(1–12) in the center. Players take turns drawing, playing cards from hand,
stockpile, or discard piles, and discarding a card to end their turn. Skip-Bo
cards are wild. For complete rules, see [docs/RULES.md](docs/RULES.md).

## Installation & Setup

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### 1. Install Server Dependencies

```bash
cd server
npm install
```

### 2. Install Client Dependencies

```bash
cd client
npm install
```

## Running the Game

### Local Development (Single Machine)

#### 1. Start the Server

```bash
cd server
npm start
```

The server will run on `http://localhost:3001`

For development with auto-reload:

```bash
npm run dev
```

#### 2. Start the Client

In a new terminal:

```bash
cd client
npm start
```

The client will run on `http://localhost:3000` and open automatically in your browser.

---

## Local Network Setup (Multiplayer Testing)

To play with multiple users on your local network (WiFi/LAN), follow these steps:

### Step 1: Find Your IP Address

**On Windows:**

```bash
ipconfig
```

Look for "IPv4 Address" under your active network adapter (usually starts with `192.168.x.x` or `10.0.x.x`)

**On macOS/Linux:**

```bash
hostname -I
# or
ifconfig | grep "inet "
```

Look for an address that starts with `192.168.x.x` or `10.0.x.x`

**Example:** Your IP might be `192.168.1.5`

### Step 2: Configure the Server

1. Create a `.env` file in the `server` directory:

```bash
cd server
cp .env.example .env
```

2. Edit `server/.env`:

```env
PORT=3001
HOST=0.0.0.0
CORS_ORIGIN=*
```

- `HOST=0.0.0.0` allows connections from any IP address on the network
- `CORS_ORIGIN=*` allows all origins (fine for local network testing)

### Step 3: Configure the Client

1. Create a `.env` file in the `client` directory:

```bash
cd client
cp .env.example .env
```

2. Edit `client/.env` and replace with your IP address:

```env
REACT_APP_SERVER_URL=http://192.168.1.5:3001
```

**Important:** Replace `192.168.1.5` with YOUR actual IP address from Step 1!

### Step 4: Start the Server

```bash
cd server
npm start
```

You should see:

```
Skip-Bo server running on http://0.0.0.0:3001
For local network access, use your machine's IP address instead of 0.0.0.0
```

### Step 5: Build and Serve the Client

For better performance and easier access, build the client for production:

```bash
cd client
npm run build
```

Then serve it using a simple HTTP server:

```bash
# Install serve globally (one time only)
npm install -g serve

# Serve the built app
serve -s build -l 3000
```

The client will be available at `http://YOUR_IP:3000` (e.g., `http://192.168.1.5:3000`)

### Step 6: Connect Other Players

**Other players on the same network** can now access the game by:

1. Opening their browser
2. Going to `http://YOUR_IP:3000` (replace with your actual IP)
   - Example: `http://192.168.1.5:3000`

### Firewall Configuration

If players can't connect, you may need to allow connections through your firewall:

**Windows Firewall:**

```powershell
# Run as Administrator
# First, allow script execution (required for setup scripts):
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

# Then add firewall rules:
netsh advfirewall firewall add rule name="Skip-Bo Server" dir=in action=allow protocol=TCP localport=3001
netsh advfirewall firewall add rule name="Skip-Bo Client" dir=in action=allow protocol=TCP localport=3000
```

**macOS:**

```bash
# System Preferences → Security & Privacy → Firewall → Firewall Options
# Allow incoming connections for Node
```

**Linux (ufw):**

```bash
sudo ufw allow 3001/tcp
sudo ufw allow 3000/tcp
```

### Testing the Setup

1. **On the host machine:**
   - Go to `http://localhost:3000` or `http://YOUR_IP:3000`
   - Create a room

2. **On another device (phone, laptop, etc.):**
   - Connect to the same WiFi network
   - Go to `http://HOST_IP:3000` (e.g., `http://192.168.1.5:3000`)
   - Join the room with the Room ID

3. **Start playing!**

### Troubleshooting Local Network Play

**Players can't connect:**

- ✅ Verify all devices are on the same WiFi network
- ✅ Check firewall settings (see above)
- ✅ Ensure the server is running and showing the correct IP
- ✅ Try pinging the host: `ping 192.168.1.5` (replace with your IP)
- ✅ Make sure you're using `http://` not `https://`

**Game is slow or laggy:**

- ✅ Check WiFi signal strength
- ✅ Move closer to the router
- ✅ Restart the router if needed

**Connection drops:**

- ✅ Some routers have WiFi isolation enabled - check router settings
- ✅ Ensure devices aren't going to sleep mode

---

## Docker Deployment (Recommended for Internet Play)

For production deployment or easy internet play, use Docker for containerized deployment with optimized performance and security.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

### Quick Start with Docker

1. **Clone or navigate to the project**:

```bash
cd skip-bo-game
```

2. **Build and start all services**:

```bash
cd deployment/docker
docker-compose up -d
```

This will:

- Build the client and server Docker images
- Start nginx reverse proxy on port 80
- Configure all networking and health checks automatically

3. **Access the game**:

- Local: `http://localhost`
- Network: `http://YOUR_IP_ADDRESS` (find IP with `hostname -I` or `ipconfig`)

4. **View logs**:

```bash
docker-compose logs -f
```

5. **Stop the services**:

```bash
docker-compose down
```

### Architecture

The Docker setup includes:

- **Client**: React app served by nginx (optimized production build)
- **Server**: Node.js Socket.IO server with health checks
- **Nginx Reverse Proxy**: Routes traffic and handles WebSocket connections
- **Docker Network**: Isolated bridge network for service communication

```
Internet/LAN
    ↓
nginx (port 80)
    ├── / → client (React app)
    ├── /socket.io/ → server (WebSocket)
    └── /api/ → server (REST endpoints)
```

### Configuration

#### Production Environment Variables

For production deployment, create environment files:

**Server** (`server/.env.production`):

```env
NODE_ENV=production
PORT=3001
HOST=0.0.0.0
CORS_ORIGIN=*  # Change to your domain in production
```

**Client** (`client/.env.production`):

```env
# Leave empty for same-origin Socket.IO connection (recommended)
REACT_APP_SERVER_URL=
```

#### Custom Domain Setup

To use a custom domain:

1. Point your domain's DNS A record to your server's IP
2. Update `CORS_ORIGIN` in `docker-compose.yml`:

```yaml
environment:
  - CORS_ORIGIN=https://yourdomain.com
```

3. For HTTPS, add SSL certificates to nginx configuration

### Deployment Platforms

#### Deploy to Cloud Platforms

The Docker setup works with any container platform:

**Railway.app**:

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

**Render.com**:

- Connect your GitHub repository
- Select "Docker" as environment
- Set root directory to `deployment/docker`
- Render will auto-detect `docker-compose.yml`

**Fly.io**:

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Deploy
fly launch
fly deploy
```

**DigitalOcean/AWS/GCP**:

- Deploy to any VPS with Docker installed
- Use docker-compose as shown above
- Configure firewall to allow port 80/443

### Production Best Practices

1. **HTTPS/SSL**: Use a reverse proxy like Cloudflare or Let's Encrypt certificates
2. **Environment Variables**: Never commit `.env` files with secrets
3. **CORS**: Update `CORS_ORIGIN` to your specific domain (not `*`)
4. **Monitoring**: Use `docker-compose logs` or integrate with logging services
5. **Backups**: No database needed - game state is in-memory
6. **Scaling**: For multiple instances, add a Redis adapter for Socket.IO

### Troubleshooting Docker Deployment

**Build fails:**

```bash
# Clear Docker cache and rebuild
docker-compose build --no-cache
```

**Services won't start:**

```bash
# Check logs for specific service
docker-compose logs server
docker-compose logs client
docker-compose logs nginx
```

**Can't connect:**

- ✅ Verify all containers are running: `docker-compose ps`
- ✅ Check health status: `docker-compose ps` (should show "healthy")
- ✅ Ensure port 80 is not in use: `sudo lsof -i :80`
- ✅ Check firewall allows port 80: `sudo ufw status`

**WebSocket connection fails:**

- ✅ Verify nginx is proxying correctly: `docker-compose logs nginx`
- ✅ Check browser console for connection errors
- ✅ Ensure CORS_ORIGIN is set correctly

---

## How to Play

### Starting a Game

1. **Create a Room**:
   - Enter your name
   - Select max number of players (2-6)
   - Click "Create Room"
   - Share the Room ID with other players

2. **Join a Room**:
   - Click "Join Existing Room"
   - Enter your name
   - Enter the Room ID
   - Click "Join Room"

3. **Start the Game**:
   - Once all players have joined
   - Click "Start Game"

### Playing Your Turn

1. **Select a Card**:
   - Click on a card from your hand, stockpile top, or discard pile top
   - Selected card will be highlighted

2. **Play the Card**:
   - Click on a building pile to play the card
   - Card must follow sequence (1-12)
   - Skip-Bo cards can be any number

3. **End Your Turn**:
   - Click "End Turn" button
   - Select a discard pile to discard a card
   - Your turn ends and next player goes

### Game Features

- **Real-time Updates**: See other players' moves instantly
- **Visual Feedback**: Highlighted turns, selected cards, and valid moves
- **Responsive Design**: Play on desktop or mobile
- **Multiple Rooms**: Multiple games can run simultaneously

## Project Structure

```
skip-bo/
├── server/
│   ├── server.js              # Entry point (wiring)
│   ├── createServer.js        # HTTP + Socket.IO server factory
│   ├── gameCoordinator.js     # Event handling and game lifecycle
│   ├── gameLogic.js           # Skip-Bo game rules (SkipBoGame class)
│   ├── transport/
│   │   └── SocketIOTransport.js   # Server-side transport adapter
│   └── tests/
│       ├── unit/              # Unit tests (gameLogic, gameCoordinator)
│       └── integration/       # Integration tests (lobby, session, chat, ...)
│
├── client/
│   └── src/
│       ├── App.js             # Top-level routing
│       ├── useGameConnection.js   # Hook: server state + actions
│       ├── components/        # UI components (+ co-located tests)
│       │   ├── GameBoard.js / .test.js / .css
│       │   ├── Lobby.js / .test.js / .css
│       │   ├── WaitingRoom.js / .test.js / .css
│       │   ├── Card.js / .test.js / .css
│       │   ├── PlayerHand.js / .test.js / .css
│       │   └── Chat.js / .test.js / .css
│       ├── transport/
│       │   └── SocketIOClientTransport.js / .test.js
│       └── i18n/              # Internationalization (en, de, tr)
│
├── docs/                      # Project documentation
├── deployment/                # Docker and production configs
└── scripts/                   # Development and testing scripts
```

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | Transport layer, component tree, event reference, game flow diagrams |
| [Game Rules](docs/RULES.md) | Complete Skip-Bo rules with examples |
| [Code Standards](docs/CODE_STANDARDS.md) | ESLint, Prettier, naming conventions, CI checks |
| [Commit Guidelines](docs/COMMIT_GUIDELINES.md) | Commit message format and atomic commit rules |
| [Git Workflow](docs/GIT_WORKFLOW.md) | Branching model, PR process, release flow |
| [Testing](docs/TESTING.md) | Test frameworks, organization, patterns, and what must be tested |
| [Technical Debt](docs/TECH_DEBT.md) | Known coupling issues and refactoring roadmap |
| [Design Principles](docs/DESIGN_PRINCIPLES.md) | Target architecture, abstraction layers, design patterns |

## Future Enhancements

- [ ] AI opponents for single-player mode
- [ ] Public/private lobby system with room browser
- [ ] Mobile-friendly UI with draggable cards
- [ ] Dark mode
- [ ] Sound effects and music
- [ ] Animations for card movements
- [ ] Game statistics and leaderboards
- [ ] Game replay feature
- [ ] Streamlined Docker deployment (central config, built-in HTTPS)

## Disclaimer

**This is a hobby/educational project.**

Skip-Bo® is a registered trademark of Mattel, Inc. All intellectual property rights, including game rules, mechanics, and the Skip-Bo brand, belong to their respective owners (Mattel, Inc.).

This project is an independent, non-commercial implementation created for educational and hobby purposes. The code in this repository is original work and is made available under the MIT License (see below). However, this does **not** grant any rights to the Skip-Bo trademark, brand, or game design.

**I am not affiliated with, endorsed by, or associated with Mattel, Inc. in any way.**

If you are a representative of Mattel, Inc. and have concerns about this project, please contact me directly.

## License

MIT License - Feel free to use and modify!

## Quick Reference

### Local Development

```bash
# Terminal 1 - Start server
cd server && npm start

# Terminal 2 - Start client
cd client && npm start
```

### Local Network Testing

```bash
# 1. Find your IP
hostname -I  # Linux/Mac
ipconfig     # Windows

# 2. Configure environment files
cd server && cp .env.example .env  # Edit HOST and CORS_ORIGIN
cd client && cp .env.example .env  # Edit REACT_APP_SERVER_URL

# 3. Start server
cd server && npm start

# 4. Build and serve client
cd client && npm run build
serve -s build -l 3000

# 5. Share URL with players: http://YOUR_IP:3000
```

### Essential Commands

```bash
# Install dependencies (run once)
cd server && npm install
cd client && npm install

# Development mode (auto-reload)
cd server && npm run dev

# Production build
cd client && npm run build

# Serve production build
serve -s build -l 3000

# Check your IP address
hostname -I          # Linux/Mac
ipconfig            # Windows
ip addr show        # Linux alternative
```

### Docker Deployment

```bash
# Navigate to deployment directory
cd deployment/docker

# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Rebuild after code changes
docker-compose up -d --build

# Check service health
docker-compose ps

# Access the game
# Local: http://localhost
# Network: http://YOUR_IP_ADDRESS
```

## Credits

Game based on the classic Skip-Bo card game by Mattel.
