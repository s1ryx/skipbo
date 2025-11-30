class SkipBoGame {
  constructor(roomId, playerCount) {
    this.roomId = roomId;
    this.playerCount = playerCount;
    this.players = [];
    this.deck = [];
    this.buildingPiles = [[], [], [], []]; // 4 building piles
    this.currentPlayerIndex = 0;
    this.gameStarted = false;
    this.gameOver = false;
    this.winner = null;
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
      const j = Math.floor(Math.random() * (i + 1));
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
      name: playerName,
      stockpile: [],
      hand: [],
      discardPiles: [[], [], [], []], // 4 discard piles per player
    };

    this.players.push(player);
    return true;
  }

  startGame() {
    if (this.players.length < 2) {
      return false;
    }

    this.deck = this.createDeck();

    // Determine stockpile size based on player count
    const stockpileSize = this.players.length <= 4 ? 30 : 20;

    // Deal stockpiles and hands to each player
    this.players.forEach(player => {
      // Deal stockpile (face down)
      for (let i = 0; i < stockpileSize; i++) {
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
    const lastValue = lastCard === 'SKIP-BO' ? this.getActualValue(pileCards, pileCards.length - 1) : lastCard;

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

  playCard(playerId, card, source, buildingPileIndex, discardIndex = null) {
    const player = this.players.find(p => p.id === playerId);

    if (!player || this.getCurrentPlayer().id !== playerId) {
      return { success: false, error: 'Not your turn' };
    }

    // Validate the move
    if (!this.canPlayCard(card, buildingPileIndex)) {
      return { success: false, error: 'Invalid move' };
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
      return { success: false, error: 'Card not found in source' };
    }

    // Add card to building pile
    this.buildingPiles[buildingPileIndex].push(card);

    // Check if pile is complete (reached 12)
    const pileValue = this.getActualValue(
      this.buildingPiles[buildingPileIndex],
      this.buildingPiles[buildingPileIndex].length - 1
    );

    if (pileValue === 12) {
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
    const player = this.players.find(p => p.id === playerId);

    if (!player || this.getCurrentPlayer().id !== playerId) {
      return { success: false, error: 'Not your turn' };
    }

    if (discardPileIndex < 0 || discardPileIndex > 3) {
      return { success: false, error: 'Invalid discard pile' };
    }

    const cardIndex = player.hand.indexOf(card);
    if (cardIndex === -1) {
      return { success: false, error: 'Card not in hand' };
    }

    // Remove from hand and add to discard pile
    player.hand.splice(cardIndex, 1);
    player.discardPiles[discardPileIndex].push(card);

    return { success: true };
  }

  drawCards(playerId) {
    const player = this.players.find(p => p.id === playerId);

    if (!player) {
      return { success: false, error: 'Player not found' };
    }

    // Draw cards until hand has 5 cards
    while (player.hand.length < 5 && this.deck.length > 0) {
      player.hand.push(this.deck.pop());
    }

    return { success: true, hand: player.hand };
  }

  endTurn(playerId) {
    const player = this.players.find(p => p.id === playerId);

    if (!player || this.getCurrentPlayer().id !== playerId) {
      return { success: false, error: 'Not your turn' };
    }

    // Draw cards for next turn
    this.drawCards(playerId);

    // Move to next player
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;

    return { success: true, nextPlayer: this.getCurrentPlayer().id };
  }

  getGameState() {
    return {
      roomId: this.roomId,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        stockpileCount: p.stockpile.length,
        stockpileTop: p.stockpile.length > 0 ? p.stockpile[p.stockpile.length - 1] : null,
        handCount: p.hand.length,
        discardPiles: p.discardPiles.map(pile => ({
          count: pile.length,
          top: pile.length > 0 ? pile[pile.length - 1] : null
        }))
      })),
      buildingPiles: this.buildingPiles,
      currentPlayerIndex: this.currentPlayerIndex,
      currentPlayerId: this.getCurrentPlayer()?.id,
      deckCount: this.deck.length,
      gameStarted: this.gameStarted,
      gameOver: this.gameOver,
      winner: this.winner
    };
  }

  getPlayerState(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return null;

    return {
      hand: player.hand,
      stockpile: player.stockpile,
      stockpileTop: player.stockpile.length > 0 ? player.stockpile[player.stockpile.length - 1] : null,
      discardPiles: player.discardPiles
    };
  }
}

module.exports = SkipBoGame;
