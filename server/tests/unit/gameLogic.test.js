const SkipBoGame = require('../../gameLogic');

describe('SkipBoGame', () => {
  let game;

  beforeEach(() => {
    game = new SkipBoGame('TESTROOM', 2, null);
  });

  describe('constructor', () => {
    it('initializes with correct defaults', () => {
      expect(game.roomId).toBe('TESTROOM');
      expect(game.playerCount).toBe(2);
      expect(game.players).toEqual([]);
      expect(game.deck).toEqual([]);
      expect(game.buildingPiles).toEqual([[], [], [], []]);
      expect(game.currentPlayerIndex).toBe(0);
      expect(game.gameStarted).toBe(false);
      expect(game.gameOver).toBe(false);
      expect(game.winner).toBe(null);
    });
  });

  describe('createDeck', () => {
    it('creates 162 cards total', () => {
      const deck = game.createDeck();
      expect(deck).toHaveLength(162);
    });

    it('contains 12 copies of each number 1-12', () => {
      const deck = game.createDeck();
      for (let num = 1; num <= 12; num++) {
        const count = deck.filter((c) => c === num).length;
        expect(count).toBe(12);
      }
    });

    it('contains 18 SKIP-BO cards', () => {
      const deck = game.createDeck();
      const skipBoCount = deck.filter((c) => c === 'SKIP-BO').length;
      expect(skipBoCount).toBe(18);
    });
  });

  describe('shuffleDeck', () => {
    it('returns same number of cards', () => {
      const deck = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const shuffled = game.shuffleDeck([...deck]);
      expect(shuffled).toHaveLength(deck.length);
    });

    it('contains the same cards after shuffle', () => {
      const deck = [1, 2, 3, 4, 5, 'SKIP-BO'];
      const shuffled = game.shuffleDeck([...deck]);
      expect(shuffled.sort()).toEqual(deck.sort());
    });
  });

  describe('addPlayer', () => {
    it('adds a player successfully', () => {
      const result = game.addPlayer('p1', 'Alice');
      expect(result).toBe(true);
      expect(game.players).toHaveLength(1);
      expect(game.players[0]).toEqual(expect.objectContaining({
        id: 'p1',
        name: 'Alice',
        stockpile: [],
        hand: [],
        discardPiles: [[], [], [], []],
      }));
      expect(game.players[0].publicId).toHaveLength(8);
    });

    it('rejects when room is full', () => {
      game.addPlayer('p1', 'Alice');
      game.addPlayer('p2', 'Bob');
      const result = game.addPlayer('p3', 'Charlie');
      expect(result).toBe(false);
      expect(game.players).toHaveLength(2);
    });

    it('allows up to maxPlayers', () => {
      const fourPlayerGame = new SkipBoGame('ROOM4', 4, null);
      expect(fourPlayerGame.addPlayer('p1', 'A')).toBe(true);
      expect(fourPlayerGame.addPlayer('p2', 'B')).toBe(true);
      expect(fourPlayerGame.addPlayer('p3', 'C')).toBe(true);
      expect(fourPlayerGame.addPlayer('p4', 'D')).toBe(true);
      expect(fourPlayerGame.addPlayer('p5', 'E')).toBe(false);
    });
  });

  describe('removePlayer', () => {
    it('removes an existing player', () => {
      game.addPlayer('p1', 'Alice');
      game.addPlayer('p2', 'Bob');
      const result = game.removePlayer('p1');
      expect(result).toBe(true);
      expect(game.players).toHaveLength(1);
      expect(game.players[0].id).toBe('p2');
    });

    it('returns false for unknown player', () => {
      game.addPlayer('p1', 'Alice');
      const result = game.removePlayer('unknown');
      expect(result).toBe(false);
      expect(game.players).toHaveLength(1);
    });
  });

  describe('startGame', () => {
    beforeEach(() => {
      game.addPlayer('p1', 'Alice');
      game.addPlayer('p2', 'Bob');
    });

    it('starts a game with 2 players', () => {
      const result = game.startGame();
      expect(result).toBe(true);
      expect(game.gameStarted).toBe(true);
      expect(game.currentPlayerIndex).toBe(0);
    });

    it('rejects with fewer than 2 players', () => {
      const soloGame = new SkipBoGame('SOLO', 2, null);
      soloGame.addPlayer('p1', 'Alone');
      expect(soloGame.startGame()).toBe(false);
      expect(soloGame.gameStarted).toBe(false);
    });

    it('rejects starting an already-started game', () => {
      game.startGame();
      expect(game.startGame()).toBe(false);
    });

    it('deals 30-card stockpiles for 2 players (default)', () => {
      game.startGame();
      expect(game.players[0].stockpile).toHaveLength(30);
      expect(game.players[1].stockpile).toHaveLength(30);
    });

    it('deals 5-card hands to each player', () => {
      game.startGame();
      expect(game.players[0].hand).toHaveLength(5);
      expect(game.players[1].hand).toHaveLength(5);
    });

    it('uses default 20-card stockpiles for 5+ players', () => {
      const bigGame = new SkipBoGame('BIG', 6, null);
      for (let i = 0; i < 6; i++) {
        bigGame.addPlayer(`p${i}`, `Player ${i}`);
      }
      bigGame.startGame();
      bigGame.players.forEach((p) => {
        expect(p.stockpile).toHaveLength(20);
      });
    });

    it('respects custom stockpile size', () => {
      const customGame = new SkipBoGame('CUSTOM', 2, 15);
      customGame.addPlayer('p1', 'Alice');
      customGame.addPlayer('p2', 'Bob');
      customGame.startGame();
      expect(customGame.players[0].stockpile).toHaveLength(15);
      expect(customGame.players[1].stockpile).toHaveLength(15);
    });

    it('caps stockpile size at max allowed', () => {
      const overGame = new SkipBoGame('OVER', 2, 50);
      overGame.addPlayer('p1', 'Alice');
      overGame.addPlayer('p2', 'Bob');
      overGame.startGame();
      // Max for ≤4 players is 30
      expect(overGame.players[0].stockpile).toHaveLength(30);
    });

    it('reduces deck size after dealing', () => {
      game.startGame();
      // 162 total - (2 players × 30 stockpile) - (2 players × 5 hand) = 92
      expect(game.deck).toHaveLength(92);
    });
  });

  describe('getCurrentPlayer', () => {
    it('returns the player at currentPlayerIndex', () => {
      game.addPlayer('p1', 'Alice');
      game.addPlayer('p2', 'Bob');
      game.startGame();
      expect(game.getCurrentPlayer().id).toBe('p1');
    });
  });

  describe('getNextCardValue', () => {
    it('returns 1 for empty pile', () => {
      expect(game.getNextCardValue([])).toBe(1);
    });

    it('returns next number in sequence', () => {
      expect(game.getNextCardValue([1])).toBe(2);
      expect(game.getNextCardValue([1, 2, 3])).toBe(4);
    });

    it('returns null for completed pile (ends at 12)', () => {
      const pile = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      expect(game.getNextCardValue(pile)).toBe(null);
    });

    it('resolves SKIP-BO cards in sequence', () => {
      // SKIP-BO on top of [1] counts as 2, so next is 3
      expect(game.getNextCardValue([1, 'SKIP-BO'])).toBe(3);
    });
  });

  describe('canPlayCard', () => {
    it('allows 1 on empty pile', () => {
      expect(game.canPlayCard(1, 0)).toBe(true);
    });

    it('rejects non-1 on empty pile', () => {
      expect(game.canPlayCard(5, 0)).toBe(false);
    });

    it('allows next number in sequence', () => {
      game.buildingPiles[0] = [1, 2, 3];
      expect(game.canPlayCard(4, 0)).toBe(true);
    });

    it('rejects wrong number', () => {
      game.buildingPiles[0] = [1, 2, 3];
      expect(game.canPlayCard(5, 0)).toBe(false);
    });

    it('allows SKIP-BO on any non-complete pile', () => {
      expect(game.canPlayCard('SKIP-BO', 0)).toBe(true);
      game.buildingPiles[1] = [1, 2, 3];
      expect(game.canPlayCard('SKIP-BO', 1)).toBe(true);
    });

    it('rejects on completed pile', () => {
      game.buildingPiles[0] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      expect(game.canPlayCard(1, 0)).toBe(false);
      expect(game.canPlayCard('SKIP-BO', 0)).toBe(false);
    });
  });

  describe('playCard', () => {
    beforeEach(() => {
      game.addPlayer('p1', 'Alice');
      game.addPlayer('p2', 'Bob');
      game.startGame();
    });

    it('plays a card from hand to building pile', () => {
      const player = game.players[0];
      // Force a known hand for testing
      player.hand = [1, 3, 5, 7, 9];

      const result = game.playCard('p1', 1, 'hand', 0);
      expect(result.success).toBe(true);
      expect(game.buildingPiles[0]).toEqual([1]);
      expect(player.hand).not.toContain(1);
    });

    it('rejects playing when not your turn', () => {
      game.players[1].hand = [1, 2, 3, 4, 5];
      const result = game.playCard('p2', 1, 'hand', 0);
      expect(result.success).toBe(false);
      expect(result.error).toBe('error.notYourTurn');
    });

    it('rejects invalid card placement', () => {
      const player = game.players[0];
      player.hand = [5, 6, 7, 8, 9];
      const result = game.playCard('p1', 5, 'hand', 0);
      expect(result.success).toBe(false);
      expect(result.error).toBe('error.invalidMove');
    });

    it('plays from stockpile top', () => {
      const player = game.players[0];
      player.stockpile = [3, 2, 1]; // 1 is on top
      const result = game.playCard('p1', 1, 'stockpile', 0);
      expect(result.success).toBe(true);
      expect(player.stockpile).toEqual([3, 2]);
    });

    it('rejects playing card not on top of stockpile', () => {
      const player = game.players[0];
      player.stockpile = [1, 3]; // 3 is on top, 1 is buried
      // Pile needs 1, but stockpile top is 3 — card not found
      const result = game.playCard('p1', 1, 'stockpile', 0);
      expect(result.success).toBe(false);
      expect(result.error).toBe('error.cardNotFound');
    });

    it('plays from discard pile top', () => {
      const player = game.players[0];
      player.discardPiles[2] = [5, 1]; // 1 is on top
      const result = game.playCard('p1', 1, 'discard2', 0);
      expect(result.success).toBe(true);
      expect(player.discardPiles[2]).toEqual([5]);
    });

    it('clears completed building pile and shuffles back into deck', () => {
      game.buildingPiles[0] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      const player = game.players[0];
      player.hand = [12, 3, 4, 5, 6];
      const deckBefore = game.deck.length;

      const result = game.playCard('p1', 12, 'hand', 0);
      expect(result.success).toBe(true);
      expect(game.buildingPiles[0]).toEqual([]); // Pile cleared
      expect(game.deck.length).toBe(deckBefore + 12); // 12 cards returned
    });

    it('auto-draws 5 cards when hand is empty after playing', () => {
      const player = game.players[0];
      player.hand = [1]; // Only 1 card left

      game.playCard('p1', 1, 'hand', 0);
      expect(player.hand).toHaveLength(5); // Auto-drew
    });

    it('triggers win when stockpile is emptied', () => {
      const player = game.players[0];
      player.stockpile = [1]; // Last card
      player.hand = [2, 3, 4, 5, 6];

      game.playCard('p1', 1, 'stockpile', 0);
      expect(game.gameOver).toBe(true);
      expect(game.winner).toBe(player);
    });

    it('returns error for card not found in hand', () => {
      const player = game.players[0];
      player.hand = [2, 3, 4, 5, 6];
      const result = game.playCard('p1', 1, 'hand', 0);
      expect(result.success).toBe(false);
      expect(result.error).toBe('error.cardNotFound');
    });

    it('rejects invalid source values', () => {
      const player = game.players[0];
      player.hand = [1, 2, 3, 4, 5];

      expect(game.playCard('p1', 1, 'constructor', 0).error).toBe('error.invalidSource');
      expect(game.playCard('p1', 1, '__proto__', 0).error).toBe('error.invalidSource');
      expect(game.playCard('p1', 1, '', 0).error).toBe('error.invalidSource');
      expect(game.playCard('p1', 1, null, 0).error).toBe('error.invalidSource');
      expect(game.playCard('p1', 1, 'discard5', 0).error).toBe('error.invalidSource');
    });

    it('rejects invalid buildingPileIndex values', () => {
      const player = game.players[0];
      player.hand = [1, 2, 3, 4, 5];

      expect(game.playCard('p1', 1, 'hand', -1).success).toBe(false);
      expect(game.playCard('p1', 1, 'hand', 4).success).toBe(false);
      expect(game.playCard('p1', 1, 'hand', 1.5).success).toBe(false);
      expect(game.playCard('p1', 1, 'hand', undefined).success).toBe(false);
      expect(game.playCard('p1', 1, 'hand', 'abc').success).toBe(false);
    });
  });

  describe('discardCard', () => {
    beforeEach(() => {
      game.addPlayer('p1', 'Alice');
      game.addPlayer('p2', 'Bob');
      game.startGame();
    });

    it('discards a card from hand to discard pile', () => {
      const player = game.players[0];
      player.hand = [3, 5, 7, 9, 11];

      const result = game.discardCard('p1', 5, 1);
      expect(result.success).toBe(true);
      expect(player.discardPiles[1]).toEqual([5]);
      expect(player.hand).toEqual([3, 7, 9, 11]);
    });

    it('rejects when not your turn', () => {
      game.players[1].hand = [1, 2, 3, 4, 5];
      const result = game.discardCard('p2', 1, 0);
      expect(result.success).toBe(false);
      expect(result.error).toBe('error.notYourTurn');
    });

    it('rejects invalid discard pile index', () => {
      game.players[0].hand = [1, 2, 3, 4, 5];
      expect(game.discardCard('p1', 1, -1).error).toBe('error.invalidDiscardPile');
      expect(game.discardCard('p1', 1, 4).error).toBe('error.invalidDiscardPile');
      expect(game.discardCard('p1', 1, 1.5).error).toBe('error.invalidDiscardPile');
      expect(game.discardCard('p1', 1, undefined).error).toBe('error.invalidDiscardPile');
    });

    it('rejects card not in hand', () => {
      game.players[0].hand = [2, 3, 4, 5, 6];
      const result = game.discardCard('p1', 1, 0);
      expect(result.success).toBe(false);
      expect(result.error).toBe('error.cardNotInHand');
    });
  });

  describe('drawCards', () => {
    beforeEach(() => {
      game.addPlayer('p1', 'Alice');
      game.addPlayer('p2', 'Bob');
      game.startGame();
    });

    it('fills hand to 5 cards', () => {
      const player = game.players[0];
      player.hand = [1, 2]; // Only 2 cards

      game.drawCards('p1');
      expect(player.hand).toHaveLength(5);
    });

    it('does not overdraw when hand is already full', () => {
      const player = game.players[0];
      player.hand = [1, 2, 3, 4, 5];

      game.drawCards('p1');
      expect(player.hand).toHaveLength(5);
    });

    it('handles low deck gracefully', () => {
      const player = game.players[0];
      player.hand = [];
      game.deck = [1, 2]; // Only 2 cards left

      const result = game.drawCards('p1');
      expect(result.success).toBe(true);
      expect(player.hand).toHaveLength(2);
    });

    it('returns error for unknown player', () => {
      const result = game.drawCards('unknown');
      expect(result.success).toBe(false);
      expect(result.error).toBe('error.playerNotFoundDraw');
    });
  });

  describe('endTurn', () => {
    beforeEach(() => {
      game.addPlayer('p1', 'Alice');
      game.addPlayer('p2', 'Bob');
      game.startGame();
    });

    it('advances to next player', () => {
      const result = game.endTurn('p1');
      expect(result.success).toBe(true);
      expect(result.nextPlayer).toBe('p2');
      expect(game.currentPlayerIndex).toBe(1);
    });

    it('wraps around to first player', () => {
      game.endTurn('p1'); // Now p2's turn
      const result = game.endTurn('p2');
      expect(result.success).toBe(true);
      expect(result.nextPlayer).toBe('p1');
      expect(game.currentPlayerIndex).toBe(0);
    });

    it('draws cards for next player', () => {
      // Empty p2's hand to verify draw happens
      game.players[1].hand = [];

      game.endTurn('p1');
      expect(game.players[1].hand).toHaveLength(5);
    });

    it('rejects when not your turn', () => {
      const result = game.endTurn('p2');
      expect(result.success).toBe(false);
      expect(result.error).toBe('error.notYourTurn');
    });
  });

  describe('getGameState', () => {
    it('returns the expected shape', () => {
      game.addPlayer('p1', 'Alice');
      game.addPlayer('p2', 'Bob');
      game.startGame();

      const state = game.getGameState();
      expect(state).toEqual(
        expect.objectContaining({
          roomId: 'TESTROOM',
          currentPlayerIndex: 0,
          gameStarted: true,
          gameOver: false,
          winner: null,
        })
      );
      expect(state.players).toHaveLength(2);
      expect(state.buildingPiles).toHaveLength(4);
      expect(typeof state.deckCount).toBe('number');
    });

    it('exposes stockpile count and top card but not full stockpile', () => {
      game.addPlayer('p1', 'Alice');
      game.addPlayer('p2', 'Bob');
      game.startGame();

      const state = game.getGameState();
      const playerState = state.players[0];
      expect(playerState).toHaveProperty('stockpileCount');
      expect(playerState).toHaveProperty('stockpileTop');
      expect(playerState).toHaveProperty('handCount');
      expect(playerState).not.toHaveProperty('hand');
      expect(playerState).not.toHaveProperty('stockpile');
    });

    it('includes currentPlayerId as publicId', () => {
      game.addPlayer('p1', 'Alice');
      game.addPlayer('p2', 'Bob');
      game.startGame();

      const state = game.getGameState();
      expect(state.currentPlayerId).toBe(game.players[0].publicId);
    });
  });

  describe('getPlayerState', () => {
    it('returns hand, stockpile count, and discard piles for a player', () => {
      game.addPlayer('p1', 'Alice');
      game.addPlayer('p2', 'Bob');
      game.startGame();

      const state = game.getPlayerState('p1');
      expect(state).toHaveProperty('hand');
      expect(state).toHaveProperty('stockpileCount');
      expect(state).toHaveProperty('stockpileTop');
      expect(state).toHaveProperty('discardPiles');
      expect(state).not.toHaveProperty('stockpile');
      expect(state.hand).toHaveLength(5);
      expect(state.stockpileCount).toBe(30);
      expect(state.discardPiles).toHaveLength(4);
    });

    it('returns null for unknown player', () => {
      expect(game.getPlayerState('unknown')).toBeNull();
    });
  });

  describe('updatePlayerId', () => {
    beforeEach(() => {
      game.addPlayer('p1', 'Alice');
      game.addPlayer('p2', 'Bob');
    });

    it('updates player ID and returns true', () => {
      expect(game.updatePlayerId('p1', 'p1-new')).toBe(true);
      expect(game.players[0].id).toBe('p1-new');
    });

    it('preserves other player properties', () => {
      const publicId = game.players[0].publicId;
      game.updatePlayerId('p1', 'p1-new');
      expect(game.players[0].publicId).toBe(publicId);
      expect(game.players[0].name).toBe('Alice');
    });

    it('returns false for unknown player', () => {
      expect(game.updatePlayerId('unknown', 'new')).toBe(false);
    });
  });

  describe('setSessionToken', () => {
    beforeEach(() => {
      game.addPlayer('p1', 'Alice');
    });

    it('sets token and returns true', () => {
      expect(game.setSessionToken('p1', 'token-abc')).toBe(true);
      expect(game.players[0].sessionToken).toBe('token-abc');
    });

    it('overwrites existing token', () => {
      game.setSessionToken('p1', 'old-token');
      game.setSessionToken('p1', 'new-token');
      expect(game.players[0].sessionToken).toBe('new-token');
    });

    it('returns false for unknown player', () => {
      expect(game.setSessionToken('unknown', 'token')).toBe(false);
    });
  });

  describe('setHost', () => {
    it('sets hostPublicId', () => {
      game.setHost('abc123');
      expect(game.hostPublicId).toBe('abc123');
    });

    it('overwrites previous host', () => {
      game.setHost('first');
      game.setHost('second');
      expect(game.hostPublicId).toBe('second');
    });
  });

  describe('addRematchVote', () => {
    it('adds a new vote and returns true', () => {
      expect(game.addRematchVote('p1')).toBe(true);
      expect(game.rematchVotes.size).toBe(1);
    });

    it('returns false for duplicate vote', () => {
      game.addRematchVote('p1');
      expect(game.addRematchVote('p1')).toBe(false);
      expect(game.rematchVotes.size).toBe(1);
    });

    it('tracks multiple voters independently', () => {
      game.addRematchVote('p1');
      game.addRematchVote('p2');
      expect(game.rematchVotes.size).toBe(2);
    });
  });

  describe('removeRematchVote', () => {
    it('removes an existing vote', () => {
      game.addRematchVote('p1');
      game.removeRematchVote('p1');
      expect(game.rematchVotes.size).toBe(0);
    });

    it('is a no-op for non-existent vote', () => {
      game.removeRematchVote('p1');
      expect(game.rematchVotes.size).toBe(0);
    });
  });

  describe('clearRematchVotes', () => {
    it('clears all votes', () => {
      game.addRematchVote('p1');
      game.addRematchVote('p2');
      game.clearRematchVotes();
      expect(game.rematchVotes.size).toBe(0);
    });
  });

  describe('canStartRematch', () => {
    it('returns true when votes meet threshold', () => {
      game.addRematchVote('p1');
      game.addRematchVote('p2');
      expect(game.canStartRematch(2)).toBe(true);
    });

    it('returns true when votes exceed threshold', () => {
      game.addRematchVote('p1');
      game.addRematchVote('p2');
      expect(game.canStartRematch(1)).toBe(true);
    });

    it('returns false when votes are below threshold', () => {
      game.addRematchVote('p1');
      expect(game.canStartRematch(2)).toBe(false);
    });
  });

  describe('getRematchVoterPublicIds', () => {
    beforeEach(() => {
      game.addPlayer('p1', 'Alice');
      game.addPlayer('p2', 'Bob');
    });

    it('returns public IDs of voters', () => {
      game.addRematchVote('p1');
      const ids = game.getRematchVoterPublicIds();
      expect(ids).toEqual([game.players[0].publicId]);
    });

    it('returns empty array when no votes', () => {
      expect(game.getRematchVoterPublicIds()).toEqual([]);
    });

    it('preserves player order', () => {
      game.addRematchVote('p2');
      game.addRematchVote('p1');
      const ids = game.getRematchVoterPublicIds();
      // Order follows players array, not vote order
      expect(ids).toEqual([
        game.players[0].publicId,
        game.players[1].publicId,
      ]);
    });

    it('ignores votes from removed players', () => {
      game.addRematchVote('p1');
      game.addRematchVote('p2');
      game.removePlayer('p1');
      const ids = game.getRematchVoterPublicIds();
      expect(ids).toEqual([game.players[0].publicId]); // only p2 remains
    });
  });
});
