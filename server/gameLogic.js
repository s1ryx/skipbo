const crypto = require('crypto');

const VALID_SOURCES = new Set(['hand', 'stockpile', 'discard0', 'discard1', 'discard2', 'discard3']);

class SkipBoGame {
  constructor(roomId, playerCount, stockpileSize) {
    this.roomId = roomId;
    this.playerCount = playerCount;
    this.stockpileSize = stockpileSize; // Custom stockpile size
    this.players = [];
    this.deck = [];
    this.buildingPiles = [[], [], [], []]; // 4 building piles
    this.currentPlayerIndex = 0;
    this.gameStarted = false;
    this.gameOver = false;
    this.winner = null;
    this.rematchVotes = new Set();
  }

  // Create and shuffle the deck
  createDeck() {
    const deck = [];
    // 12 cards of each number (1-12), plus 18 Skip-Bo cards
    for (let i = 1; i <= 12; i++) {
      for (let j = 0; j < 12; j++) {
        deck.push(i);
      }
    }
    // Add 18 Skip-Bo (wild) cards
    for (let i = 0; i < 18; i++) {
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
      discardPiles: [[], [], [], []], // 4 discard piles per player
    };

    this.players.push(player);
    return true;
  }

  getPublicId(connectionId) {
    const player = this.players.find((p) => p.id === connectionId);
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

  startGame() {
    if (this.players.length < 2) {
      return false;
    }

    // Prevent starting an already-started game
    if (this.gameStarted) {
      return false;
    }

    this.deck = this.createDeck();

    // Use custom stockpile size if provided, otherwise use default based on player count
    const stockpileSize = this.stockpileSize || (this.players.length <= 4 ? 30 : 20);

    // Validate stockpile size against game rules
    const maxAllowed = this.players.length <= 4 ? 30 : 20;
    const actualStockpileSize = Math.min(stockpileSize, maxAllowed);

    // Deal stockpiles and hands to each player
    this.players.forEach((player) => {
      // Deal stockpile (face down)
      for (let i = 0; i < actualStockpileSize; i++) {
        player.stockpile.push(this.deck.pop());
      }

      // Deal hand (5 cards)
      for (let i = 0; i < 5; i++) {
        player.hand.push(this.deck.pop());
      }
    });

    this.gameStarted = true;
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

    if (lastValue === 12) {
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
    if (!Number.isInteger(buildingPileIndex) || buildingPileIndex < 0 || buildingPileIndex > 3) {
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

    if (pileValue === 12) {
      // Shuffle completed pile back into deck
      const completedPile = this.buildingPiles[buildingPileIndex];
      this.deck = this.deck.concat(completedPile);
      this.deck = this.shuffleDeck(this.deck);

      // Clear the completed pile
      this.buildingPiles[buildingPileIndex] = [];
    }

    // If hand is empty after playing, automatically draw 5 more cards
    if (player.hand.length === 0 && this.deck.length > 0) {
      this.drawCards(playerId);
    }

    // Check if player won
    if (player.stockpile.length === 0) {
      this.gameOver = true;
      this.winner = player;
    }

    return { success: true };
  }

  discardCard(playerId, card, discardPileIndex) {
    const player = this.players.find((p) => p.id === playerId);

    if (!player || this.getCurrentPlayer().id !== playerId) {
      return { success: false, error: 'error.notYourTurn' };
    }

    if (!Number.isInteger(discardPileIndex) || discardPileIndex < 0 || discardPileIndex > 3) {
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

    // Draw cards until hand has 5 cards
    while (player.hand.length < 5 && this.deck.length > 0) {
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

  resetForRematch(stockpileSize) {
    this.gameStarted = false;
    this.gameOver = false;
    this.winner = null;
    this.deck = [];
    this.buildingPiles = [[], [], [], []];
    this.currentPlayerIndex = 0;
    this.rematchVotes = new Set();

    if (stockpileSize) {
      this.stockpileSize = stockpileSize;
    }

    this.players.forEach((player) => {
      player.stockpile = [];
      player.hand = [];
      player.discardPiles = [[], [], [], []];
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
      })),
      buildingPiles: this.buildingPiles,
      currentPlayerIndex: this.currentPlayerIndex,
      currentPlayerId: this.getCurrentPlayer()?.publicId,
      deckCount: this.deck.length,
      hostPlayerId: this.hostPublicId || null,
      gameStarted: this.gameStarted,
      gameOver: this.gameOver,
      winner: this.winner ? { id: this.winner.publicId, name: this.winner.name } : null,
      stockpileSize: this.stockpileSize || (this.players.length <= 4 ? 30 : 20),
      rematchVotes: [...this.rematchVotes],
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
