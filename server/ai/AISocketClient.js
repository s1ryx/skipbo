/**
 * AISocketClient — reusable Socket.IO AI client for Skip-Bo.
 *
 * Connects to a game server, joins/creates a room, and plays automatically
 * using AIPlayer (new) or gameAI (old heuristic). Prints detailed decision
 * reasoning to the console.
 *
 * Designed for reuse: this module can be imported by scripts (play-vs-ai.js)
 * or later integrated into the server-side coordinator for built-in bot support.
 */

const path = require('path');
const { AIPlayer } = require('./AIPlayer');
const { ChainDetector, getNextCardValue } = require('./ChainDetector');
const gameAI = require(path.join(__dirname, '..', 'tests', 'integration', 'helpers', 'gameAI'));

const BOX_TOP    = '\x1b[36m╔══ AI Turn %TURN% (%NAME%) ══════════════════════════════════════╗\x1b[0m';
const BOX_BOTTOM = '\x1b[36m╚═══════════════════════════════════════════════════════════════╝\x1b[0m';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class AISocketClient {
  /**
   * @param {Object} io - socket.io-client `io` function
   * @param {Object} options
   * @param {string} options.serverUrl - e.g. 'http://localhost:3001'
   * @param {string} [options.name='AI Bot'] - display name
   * @param {'new'|'old'} [options.aiType='new'] - which AI to use
   * @param {number} [options.delay=800] - ms delay between moves (for human readability)
   * @param {boolean} [options.verbose=true] - print detailed reasoning
   * @param {number} [options.stockpileSize=30] - stockpile size for room creation
   */
  constructor(io, options = {}) {
    this.io = io;
    this.serverUrl = options.serverUrl || 'http://localhost:3001';
    this.name = options.name || 'AI Bot';
    this.aiType = options.aiType || 'new';
    this.delay = options.delay ?? 800;
    this.verbose = options.verbose ?? true;
    this.stockpileSize = options.stockpileSize || 30;

    this.socket = null;
    this.playerId = null;
    this.roomId = null;
    this.playerState = null;
    this.gameState = null;
    this.turnNumber = 0;

    this.ai = new AIPlayer();
    this._gameEndResolve = null;
    this._gameEndPromise = new Promise((resolve) => { this._gameEndResolve = resolve; });
    this._playing = false;
  }

  // ── Connection ──────────────────────────────────────────────────────

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = this.io(this.serverUrl, { forceNew: true, transports: ['websocket'] });
      const timeout = setTimeout(() => reject(new Error('Connect timeout')), 5000);
      this.socket.on('connect', () => {
        clearTimeout(timeout);
        this._setupListeners();
        resolve();
      });
      this.socket.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Create a room and return the roomId for a human to join.
   */
  async createRoom() {
    await this.connect();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Room creation timeout')), 5000);
      this.socket.once('roomCreated', (data) => {
        clearTimeout(timeout);
        this.roomId = data.roomId;
        this.playerId = data.playerId;
        resolve(data.roomId);
      });
      this.socket.emit('createRoom', {
        playerName: this.name,
        maxPlayers: 2,
        stockpileSize: this.stockpileSize,
        isBot: true,
      });
    });
  }

  /**
   * Join an existing room by code.
   */
  async joinRoom(roomId) {
    await this.connect();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Join timeout')), 5000);
      this.socket.once('sessionToken', (data) => {
        clearTimeout(timeout);
        this.roomId = roomId;
        this.playerId = data.playerId;
        resolve();
      });
      this.socket.once('error', (data) => {
        clearTimeout(timeout);
        reject(new Error(data.message));
      });
      this.socket.emit('joinRoom', { roomId, playerName: this.name, isBot: true });
    });
  }

  /**
   * Start the game (only works if AI is the host).
   */
  startGame() {
    this.socket.emit('startGame');
  }

  /**
   * Returns a promise that resolves when the game ends.
   */
  waitForGameEnd() {
    return this._gameEndPromise;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // ── Event listeners ─────────────────────────────────────────────────

  _setupListeners() {
    this.socket.on('gameStarted', (data) => {
      this.gameState = data.gameState;
      this.playerState = data.playerState;
      this.turnNumber = 0;
      console.log('\x1b[32m>>> Game started!\x1b[0m');
      this._checkMyTurn();
    });

    this.socket.on('gameStateUpdate', (data) => {
      this.gameState = data.gameState;
      this.playerState = data.playerState;
      if (!this._playing) {
        this._checkMyTurn();
      }
    });

    this.socket.on('gameOver', (data) => {
      const winner = data.winner || data.gameState?.winner;
      console.log(`\n\x1b[33m>>> Game Over! Winner: ${winner?.name || 'unknown'}\x1b[0m`);
      console.log('Remaining stockpiles:');
      for (const p of (data.gameState || this.gameState).players) {
        console.log(`  ${p.name}: ${p.stockpileCount} cards`);
      }
      if (this._gameEndResolve) {
        this._gameEndResolve({ winner, gameState: data.gameState || this.gameState });
      }
    });

    this.socket.on('error', (data) => {
      console.error(`\x1b[31m[AI Error] ${data.message}\x1b[0m`);
    });

    this.socket.on('playerJoined', (data) => {
      console.log(`\x1b[32m>>> ${data.playerName} joined the room\x1b[0m`);
    });
  }

  // ── Turn logic ──────────────────────────────────────────────────────

  async _checkMyTurn() {
    if (!this.gameState || this.gameState.gameOver) return;
    if (this.gameState.currentPlayerId !== this.playerId) return;
    if (this._playing) return;

    this._playing = true;
    this.turnNumber++;

    try {
      await this._playTurn();
    } catch (err) {
      console.error(`\x1b[31m[AI Turn Error] ${err.message}\x1b[0m`);
    } finally {
      this._playing = false;
      // Re-check: events may have arrived while _playing was true
      // (e.g. opponent played and discarded quickly during our turn)
      setImmediate(() => this._checkMyTurn());
    }
  }

  async _playTurn() {
    const header = BOX_TOP
      .replace('%TURN%', this.turnNumber)
      .replace('%NAME%', this.name);
    console.log('\n' + header);

    this._logState();

    // Play phase — loop until no more plays
    let playCount = 0;
    let move = this._findPlay();

    while (move && !this.gameState.gameOver) {
      this._logPlay(move, playCount);
      await this._emitPlay(move);
      await sleep(this.delay);

      if (this.gameState.gameOver) break;

      playCount++;
      move = this._findPlay();
    }

    if (this.gameState.gameOver) {
      console.log(BOX_BOTTOM);
      return;
    }

    if (playCount === 0) {
      console.log('  \x1b[90m-- No plays available\x1b[0m');
    } else {
      console.log(`  \x1b[90m-- No more plays (${playCount} cards played)\x1b[0m`);
    }

    // Discard phase
    const discard = this._findDiscard();
    if (discard) {
      this._logDiscard(discard);
      await this._emitDiscard(discard);
      await sleep(this.delay);
    }

    console.log(BOX_BOTTOM);
  }

  // ── AI decision wrappers ────────────────────────────────────────────

  _findPlay() {
    if (this.aiType === 'old') {
      return gameAI.findPlayableCard(this.playerState, this.gameState, this.verbose ? (m) => console.log(`  ${m}`) : () => {});
    }

    const log = this.verbose
      ? (m) => console.log(`  \x1b[90m${m}\x1b[0m`)
      : () => {};

    return this.ai.findPlayableCard(this.playerState, this.gameState, log);
  }

  _findDiscard() {
    if (this.aiType === 'old') {
      return gameAI.chooseDiscard(this.playerState, this.turnNumber, this.verbose ? (m) => console.log(`  ${m}`) : () => {});
    }

    const log = this.verbose
      ? (m) => console.log(`  \x1b[90m${m}\x1b[0m`)
      : () => {};

    return this.ai.chooseDiscard(this.playerState, this.gameState, log);
  }

  // ── Socket.IO helpers ───────────────────────────────────────────────

  _emitPlay(move) {
    return new Promise((resolve) => {
      this.socket.once('gameStateUpdate', (data) => {
        this.gameState = data.gameState;
        this.playerState = data.playerState;
        resolve();
      });
      this.socket.emit('playCard', {
        card: move.card,
        source: move.source,
        buildingPileIndex: move.buildingPileIndex,
      });
    });
  }

  _emitDiscard(discard) {
    return new Promise((resolve) => {
      this.socket.once('gameStateUpdate', (data) => {
        this.gameState = data.gameState;
        this.playerState = data.playerState;
        resolve();
      });
      this.socket.emit('discardCard', {
        card: discard.card,
        discardPileIndex: discard.discardPileIndex,
      });
    });
  }

  // ── Console logging ─────────────────────────────────────────────────

  _logState() {
    const ps = this.playerState;
    const gs = this.gameState;
    const pileNeeds = gs.buildingPiles.map((p) => getNextCardValue(p));

    console.log(`  Hand: [${ps.hand.join(', ')}]`);
    console.log(`  Stock: ${ps.stockpileTop ?? 'empty'} (${ps.stockpileCount} remaining)`);
    console.log(`  Building piles need: [${pileNeeds.map((v) => v ?? 'done').join(', ')}]`);

    // Show discard tops
    const dTops = ps.discardPiles.map((p, i) =>
      p.length > 0 ? `d${i}:${p[p.length - 1]}` : `d${i}:--`
    );
    console.log(`  Discards: [${dTops.join(', ')}]`);

    // Show opponent info
    for (const p of gs.players) {
      if (p.id === this.playerId) continue;
      const oppDTops = p.discardPiles.map((dp, i) =>
        dp.length > 0 ? `${dp[dp.length - 1]}` : '--'
      );
      console.log(`  Opponent ${p.name}: stock=${p.stockpileTop ?? '?'}(${p.stockpileCount}), hand=${p.handCount}, discards=[${oppDTops.join(',')}]`);
    }
    console.log('');
  }

  _logPlay(move) {
    const cardStr = move.card === 'SKIP-BO' ? '\x1b[35mSKIP-BO\x1b[0m' : `\x1b[33m${move.card}\x1b[0m`;
    console.log(`  \x1b[32m>> PLAY:\x1b[0m ${cardStr} from ${move.source} → pile ${move.buildingPileIndex}`);
  }

  _logDiscard(discard) {
    if (!this.verbose) {
      console.log(`  \x1b[34m>> DISCARD:\x1b[0m ${discard.card} → pile ${discard.discardPileIndex}`);
      return;
    }

    // Show all discard options with scores
    const ps = this.playerState;
    const gs = this.gameState;
    const options = [];

    for (const card of ps.hand) {
      if (card === 'SKIP-BO') continue;
      for (let pi = 0; pi < 4; pi++) {
        const score = this.ai.evaluator.scoreDiscard(card, pi, ps, gs);
        options.push({ card, pile: pi, score });
      }
    }

    // Show top 5 options
    options.sort((a, b) => b.score - a.score);
    const top = options.slice(0, 5);
    console.log('  Discard options (top 5):');
    for (const opt of top) {
      const marker = opt.card === discard.card && opt.pile === discard.discardPileIndex ? ' <<<' : '';
      console.log(`    ${opt.card}→pile${opt.pile}: score ${opt.score.toFixed(1)}${marker}`);
    }
    console.log(`  \x1b[34m>> DISCARD:\x1b[0m ${discard.card} → pile ${discard.discardPileIndex}`);
  }
}

module.exports = { AISocketClient };
