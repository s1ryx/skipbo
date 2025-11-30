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
- Each player has 3 discard piles

### Gameplay
1. **Building Piles**: Must be built sequentially from 1 to 12
2. **Skip-Bo Cards**: Wild cards that can represent any number
3. **Playing Cards**: Can play from hand, stockpile top, or discard pile tops
4. **Turn End**: Must discard one card to a discard pile to end turn
5. **Winning**: First player to empty their stockpile wins!

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

### 1. Start the Server

```bash
cd server
npm start
```

The server will run on `http://localhost:3001`

For development with auto-reload:
```bash
npm run dev
```

### 2. Start the Client

In a new terminal:

```bash
cd client
npm start
```

The client will run on `http://localhost:3000` and open automatically in your browser.

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

## Credits

Game based on the classic Skip-Bo card game by Mattel.
