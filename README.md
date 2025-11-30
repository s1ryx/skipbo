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

### Objective
Be the first player to play all cards from your stockpile.

### Setup
- 2-6 players
- Each player receives a stockpile (30 cards for 2-4 players, 20 cards for 5-6 players)
- Each player gets 5 cards in hand
- 4 building piles in the center (shared by all players)
- Each player has 4 discard piles

### Gameplay
1. **Building Piles**: Must be built sequentially from 1 to 12
2. **Skip-Bo Cards**: Wild cards that can represent any number
3. **Playing Cards**: Can play from hand, stockpile top, or discard pile tops
4. **Auto-draw**: When your hand becomes empty, you automatically draw 5 more cards
5. **Turn End**: Must discard one card from hand to a discard pile to end turn
6. **Quick Discard**: Select a card from hand and click any discard pile to end your turn immediately
7. **Winning**: First player to empty their stockpile wins!

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
skip-bo-game/
├── server/
│   ├── server.js          # Socket.IO server and event handlers
│   ├── gameLogic.js       # Skip-Bo game rules and state management
│   └── package.json       # Server dependencies
│
└── client/
    ├── public/
    │   └── index.html     # HTML template
    ├── src/
    │   ├── components/
    │   │   ├── Lobby.js           # Room creation/joining
    │   │   ├── GameBoard.js       # Main game interface
    │   │   ├── Card.js            # Card component
    │   │   ├── PlayerHand.js      # Player's hand display
    │   │   └── *.css              # Component styles
    │   ├── App.js         # Main app component
    │   ├── index.js       # React entry point
    │   └── *.css          # Global styles
    └── package.json       # Client dependencies
```

## Game Architecture

### Server-Side
- **Game State Management**: All game logic runs on server
- **Room System**: Multiple concurrent games in different rooms
- **Event Handling**: Validates moves and broadcasts updates

### Client-Side
- **Socket.IO Connection**: Communicates with server
- **React State**: Manages local UI state
- **Component-Based**: Modular, reusable components

## Socket.IO Events

### Client → Server
- `createRoom` - Create a new game room
- `joinRoom` - Join an existing room
- `startGame` - Start the game
- `playCard` - Play a card to building pile
- `discardCard` - Discard a card
- `endTurn` - End current turn

### Server → Client
- `roomCreated` - Room successfully created
- `playerJoined` - New player joined
- `gameStarted` - Game has started
- `gameStateUpdate` - Game state changed
- `turnChanged` - Turn moved to next player
- `gameOver` - Game finished
- `error` - Error message

## Customization

### Changing Server Port
Edit `server/server.js`:
```javascript
const PORT = process.env.PORT || 3001;
```

### Changing Socket URL
Edit `client/src/App.js`:
```javascript
const SOCKET_SERVER_URL = 'http://localhost:3001';
```

## Future Enhancements

- [ ] AI players for single-player mode
- [ ] Game statistics and leaderboards
- [ ] Sound effects and music
- [ ] Animations for card movements
- [ ] Chat system
- [ ] Game replay feature
- [ ] Mobile app version

## Troubleshooting

### Connection Issues
- Ensure server is running before starting client
- Check that ports 3000 and 3001 are available
- Verify firewall settings for local connections

### Game Not Starting
- Need at least 2 players to start
- Ensure all players are connected

### Cards Not Playing
- Verify it's your turn
- Check card follows sequence rules
- Ensure building pile isn't complete (hasn't reached 12)

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

## Credits

Game based on the classic Skip-Bo card game by Mattel.
