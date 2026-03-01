const crypto = require('crypto');
const {
  HAND_SIZE,
  MAX_CARD_VALUE,
  BUILDING_PILES,
  DISCARD_PILES,
  CARDS_PER_VALUE,
  SKIPBO_WILDS,
  DEFAULT_STOCKPILE_LARGE,
  DEFAULT_STOCKPILE_SMALL,
  LARGE_GAME_THRESHOLD,
  MIN_PLAYERS,
  Phase,
} = require('./config');

const VALID_SOURCES = new Set(['hand', 'stockpile', 'discard0', 'discard1', 'discard2', 'discard3']);

class SkipBoGame {
  constructor(roomId, playerCount, stockpileSize) {
    this.roomId = roomId;
    this.playerCount = playerCount;
    this.stockpileSize = stockpileSize; // Custom stockpile size
    this.players = [];
    this.deck = [];
    this.buildingPiles = Array.from({ length: BUILDING_PILES }, () => []);
    this.currentPlayerIndex = 0;
    this.phase = Phase.LOBBY;
    this.winner = null;
    this.rematchVotes = new Set();
  }

  get gameStarted() {
    return this.phase !== Phase.LOBBY;
  }

  get gameOver() {
    return this.phase === Phase.FINISHED;
  }
  createDeck() {
    const deck = [];
    for (let i = 1; i <= MAX_CARD_VALUE; i++) {
      for (let j = 0; j < CARDS_PER_VALUE; j++) {
        deck.push(i);
      }
    }
    for (let i = 0; i < SKIPBO_WILDS; i++) {
      deck.push('SKIP-BO');
    }
    return this.shuffleDeck(deck);
  }

  shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  addPlayer(playerId, playerName) {
    if (this.players.length >= this.playerCount) {
      return false;
    }

    const player = {
      id: playerId,
      publicId: crypto.randomUUID().slice(0, 8),
      name: playerName,
      stockpile: [],
      hand: [],
      discardPiles: Array.from({ length: DISCARD_PILES }, () => []),
    };

    this.players.push(player);
    return true;
  }

  getPublicId(playerId) {
    const player = this.players.find((p) => p.id === playerId);
    return player ? player.publicId : null;
  }

  removePlayer(playerId) {
    const index = this.players.findIndex((p) => p.id === playerId);
    if (index === -1) {
      return false;
    }
    this.players.splice(index, 1);
    return true;
  }

  updatePlayerId(oldId, newId) {
    const player = this.players.find((p) => p.id === oldId);
    if (!player) return false;
    player.id = newId;
    return true;
  }

  setSessionToken(playerId, token) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return false;
    player.sessionToken = token;
    return true;
  }

  setHost(publicId) {
    this.hostPublicId = publicId;
  }

  startGame() {
    if (this.players.length < MIN_PLAYERS) {
      return false;
    }

    if (this.phase !== Phase.LOBBY) {
      return false;
    }

    this.deck = this.createDeck();

    const defaultSize =
      this.players.length <= LARGE_GAME_THRESHOLD
        ? DEFAULT_STOCKPILE_LARGE
        : DEFAULT_STOCKPILE_SMALL;
    const stockpileSize = this.stockpileSize || defaultSize;

    const maxAllowed =
      this.players.length <= LARGE_GAME_THRESHOLD
        ? DEFAULT_STOCKPILE_LARGE
        : DEFAULT_STOCKPILE_SMALL;
    const actualStockpileSize = Math.min(stockpileSize, maxAllowed);

    // Deal stockpiles and hands to each player
    this.players.forEach((player) => {
      // Deal stockpile (face down)
      for (let i = 0; i < actualStockpileSize; i++) {
        player.stockpile.push(this.deck.pop());
      }

      for (let i = 0; i < HAND_SIZE; i++) {
        player.hand.push(this.deck.pop());
      }
    });

    this.phase = Phase.PLAYING;
    this.currentPlayerIndex = 0;
    return true;
  }

  getCurrentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  getNextCardValue(pileCards) {
    if (pileCards.length === 0) {
      return 1; // Must start with 1
    }

    const lastCard = pileCards[pileCards.length - 1];
    const lastValue =
      lastCard === 'SKIP-BO' ? this.getActualValue(pileCards, pileCards.length - 1) : lastCard;

    if (lastValue === MAX_CARD_VALUE) {
      return null; // Pile is complete
    }

    return lastValue + 1;
  }

  // Get the actual numeric value at a position (resolving SKIP-BO cards)
  getActualValue(pileCards, index) {
    let value = 0;
    for (let i = 0; i <= index; i++) {
      if (pileCards[i] !== 'SKIP-BO') {
        value = pileCards[i];
      } else {
        value++; // SKIP-BO takes the next value in sequence
      }
    }
    return value;
  }

  canPlayCard(card, buildingPileIndex) {
    if (
      !Number.isInteger(buildingPileIndex) ||
      buildingPileIndex < 0 ||
      buildingPileIndex >= BUILDING_PILES
    ) {
      return false;
    }

    const pile = this.buildingPiles[buildingPileIndex];
    const nextValue = this.getNextCardValue(pile);

    if (nextValue === null) {
      return false; // Pile is complete
    }

    if (card === 'SKIP-BO') {
      return true; // Wild card can always be played if pile isn't complete
    }

    return card === nextValue;
  }

  playCard(playerId, card, source, buildingPileIndex, _discardIndex = null) {
    const player = this.players.find((p) => p.id === playerId);

    if (!player || this.getCurrentPlayer().id !== playerId) {
      return { success: false, error: 'error.notYourTurn' };
    }

    if (!VALID_SOURCES.has(source)) {
      return { success: false, error: 'error.invalidSource' };
    }

    // Validate the move
    if (!this.canPlayCard(card, buildingPileIndex)) {
      return { success: false, error: 'error.invalidMove' };
    }

    // Remove card from source
    let cardRemoved = false;
    if (source === 'hand') {
      const index = player.hand.indexOf(card);
      if (index > -1) {
        player.hand.splice(index, 1);
        cardRemoved = true;
      }
    } else if (source === 'stockpile') {
      if (player.stockpile.length > 0 && player.stockpile[player.stockpile.length - 1] === card) {
        player.stockpile.pop();
        cardRemoved = true;
      }
    } else if (source.startsWith('discard')) {
      const pileIndex = parseInt(source.replace('discard', ''));
      const pile = player.discardPiles[pileIndex];
      if (pile.length > 0 && pile[pile.length - 1] === card) {
        pile.pop();
        cardRemoved = true;
      }
    }

    if (!cardRemoved) {
      return { success: false, error: 'error.cardNotFound' };
    }

    // Add card to building pile
    this.buildingPiles[buildingPileIndex].push(card);

    // Check if pile is complete (reached 12)
    const pileValue = this.getActualValue(
      this.buildingPiles[buildingPileIndex],
      this.buildingPiles[buildingPileIndex].length - 1
    );

    if (pileValue === MAX_CARD_VALUE) {
      // Shuffle completed pile back into deck
      const completedPile = this.buildingPiles[buildingPileIndex];
      this.deck = this.deck.concat(completedPile);
      this.deck = this.shuffleDeck(this.deck);

      // Clear the completed pile
      this.buildingPiles[buildingPileIndex] = [];
    }

    if (player.hand.length === 0 && this.deck.length > 0) {
      this.drawCards(playerId);
    }

    // Check if player won
    if (player.stockpile.length === 0) {
      this.phase = Phase.FINISHED;
      this.winner = player;
    }

    return { success: true };
  }

  discardCard(playerId, card, discardPileIndex) {
    const player = this.players.find((p) => p.id === playerId);

    if (!player || this.getCurrentPlayer().id !== playerId) {
      return { success: false, error: 'error.notYourTurn' };
    }

    if (
      !Number.isInteger(discardPileIndex) ||
      discardPileIndex < 0 ||
      discardPileIndex >= DISCARD_PILES
    ) {
      return { success: false, error: 'error.invalidDiscardPile' };
    }

    const cardIndex = player.hand.indexOf(card);
    if (cardIndex === -1) {
      return { success: false, error: 'error.cardNotInHand' };
    }

    // Remove from hand and add to discard pile
    player.hand.splice(cardIndex, 1);
    player.discardPiles[discardPileIndex].push(card);

    return { success: true };
  }

  drawCards(playerId) {
    const player = this.players.find((p) => p.id === playerId);

    if (!player) {
      return { success: false, error: 'error.playerNotFoundDraw' };
    }

    while (player.hand.length < HAND_SIZE && this.deck.length > 0) {
      player.hand.push(this.deck.pop());
    }

    return { success: true, hand: player.hand };
  }

  endTurn(playerId) {
    const player = this.players.find((p) => p.id === playerId);

    if (!player || this.getCurrentPlayer().id !== playerId) {
      return { success: false, error: 'error.notYourTurn' };
    }

    // Move to next player
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;

    // Draw cards at the START of the new player's turn
    const nextPlayer = this.getCurrentPlayer();
    this.drawCards(nextPlayer.id);

    return { success: true, nextPlayer: nextPlayer.id };
  }

  addRematchVote(playerId) {
    if (this.rematchVotes.has(playerId)) return false;
    this.rematchVotes.add(playerId);
    return true;
  }

  removeRematchVote(playerId) {
    this.rematchVotes.delete(playerId);
  }

  clearRematchVotes() {
    this.rematchVotes.clear();
  }

  canStartRematch(humanPlayerCount) {
    return this.rematchVotes.size >= humanPlayerCount;
  }

  getRematchVoterPublicIds() {
    return this.players
      .filter((p) => this.rematchVotes.has(p.id))
      .map((p) => p.publicId);
  }

  resetForRematch(stockpileSize) {
    this.phase = Phase.LOBBY;
    this.winner = null;
    this.deck = [];
    this.buildingPiles = Array.from({ length: BUILDING_PILES }, () => []);
    this.currentPlayerIndex = 0;
    this.rematchVotes = new Set();

    if (stockpileSize) {
      this.stockpileSize = stockpileSize;
    }

    this.players.forEach((player) => {
      player.stockpile = [];
      player.hand = [];
      player.discardPiles = Array.from({ length: DISCARD_PILES }, () => []);
    });
  }

  getGameState() {
    return {
      roomId: this.roomId,
      players: this.players.map((p) => ({
        id: p.publicId,
        name: p.name,
        stockpileCount: p.stockpile.length,
        stockpileTop: p.stockpile.length > 0 ? p.stockpile[p.stockpile.length - 1] : null,
        handCount: p.hand.length,
        discardPiles: p.discardPiles,
        isBot: !!p.isBot,
        aiType: p.aiType || null,
      })),
      maxPlayers: this.playerCount,
      buildingPiles: this.buildingPiles,
      currentPlayerIndex: this.currentPlayerIndex,
      currentPlayerId: this.getCurrentPlayer()?.publicId,
      deckCount: this.deck.length,
      hostPlayerId: this.hostPublicId || null,
      phase: this.phase,
      gameStarted: this.gameStarted,
      gameOver: this.gameOver,
      winner: this.winner ? { id: this.winner.publicId, name: this.winner.name } : null,
      stockpileSize:
        this.stockpileSize ||
        (this.players.length <= LARGE_GAME_THRESHOLD
          ? DEFAULT_STOCKPILE_LARGE
          : DEFAULT_STOCKPILE_SMALL),
      rematchVotes: this.getRematchVoterPublicIds(),
    };
  }

  getPlayerState(playerId) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return null;

    return {
      hand: player.hand,
      stockpileCount: player.stockpile.length,
      stockpileTop:
        player.stockpile.length > 0 ? player.stockpile[player.stockpile.length - 1] : null,
      discardPiles: player.discardPiles,
    };
  }
}

module.exports = SkipBoGame;
