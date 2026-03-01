const fs = require('fs');
const path = require('path');
const os = require('os');
const { GameLogger, MoveAnalyzer } = require('../../ai/GameLogger');

// Create a minimal SkipBoGame-like object for testing
function makeGame(overrides = {}) {
  const players = overrides.players || [
    {
      internalId: 'p1', name: 'Alice', isBot: false,
      hand: [1, 2, 3, 4, 5],
      stockpile: [7],
      discardPiles: [[], [], [], []],
    },
    {
      internalId: 'p2', name: 'Bob', isBot: true,
      hand: [6, 7, 8, 9, 10],
      stockpile: [3, 5],
      discardPiles: [[4], [], [], []],
    },
  ];

  return {
    roomId: 'TEST01',
    stockpileSize: overrides.stockpileSize ?? 5,
    players,
    buildingPiles: overrides.buildingPiles || [[], [], [], []],
    deck: overrides.deck || new Array(132).fill(1),
    currentPlayerIndex: overrides.currentPlayerIndex ?? 0,
    gameOver: overrides.gameOver ?? false,
    winner: overrides.winner ?? null,
    getCurrentPlayer() {
      return this.players[this.currentPlayerIndex];
    },
    getGameState() {
      return {
        roomId: this.roomId,
        players: this.players.map((p) => ({
          id: p.internalId,
          name: p.name,
          stockpileCount: p.stockpile.length,
          stockpileTop: p.stockpile.length > 0 ? p.stockpile[p.stockpile.length - 1] : null,
          handCount: p.hand.length,
          discardPiles: p.discardPiles,
        })),
        buildingPiles: this.buildingPiles,
        currentPlayerIndex: this.currentPlayerIndex,
        currentPlayerId: this.players[this.currentPlayerIndex]?.internalId,
        deckCount: this.deck.length,
        gameStarted: true,
        gameOver: this.gameOver,
        winner: this.winner ? { id: this.winner.internalId, name: this.winner.name } : null,
      };
    },
    getPlayerState(playerId) {
      const p = this.players.find((pl) => pl.internalId === playerId);
      if (!p) return null;
      return {
        hand: p.hand,
        stockpileCount: p.stockpile.length,
        stockpileTop: p.stockpile.length > 0 ? p.stockpile[p.stockpile.length - 1] : null,
        discardPiles: p.discardPiles,
      };
    },
  };
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skipbo-log-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GameLogger', () => {
  test('startGame creates log file and writes game_start line', () => {
    const logger = new GameLogger({ outputDir: tmpDir, roomId: 'T1' });
    const game = makeGame();
    logger.startGame(game);
    logger.close();

    const files = fs.readdirSync(tmpDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^game_T1_.*\.jsonl$/);

    const lines = fs.readFileSync(path.join(tmpDir, files[0]), 'utf-8').trim().split('\n');
    expect(lines.length).toBe(1);
    const obj = JSON.parse(lines[0]);
    expect(obj.type).toBe('game_start');
    expect(obj.roomId).toBe('T1');
    expect(obj.players).toHaveLength(2);
    expect(obj.players[0].name).toBe('Alice');
    expect(obj.players[0].isBot).toBe(false);
    expect(obj.players[1].name).toBe('Bob');
    expect(obj.players[1].isBot).toBe(true);
    expect(obj.stockpileSize).toBe(5);
    expect(obj.deckCount).toBe(132);
  });

  test('logTurnStart writes state snapshot with full player hands', () => {
    const logger = new GameLogger({ outputDir: tmpDir, roomId: 'T2' });
    const game = makeGame();
    logger.startGame(game);
    logger.logTurnStart(1, game);
    logger.close();

    const lines = readLogLines(tmpDir);
    expect(lines.length).toBe(2);
    const turnStart = JSON.parse(lines[1]);
    expect(turnStart.type).toBe('turn_start');
    expect(turnStart.turn).toBe(1);
    expect(turnStart.player).toBe('Alice');
    expect(turnStart.isBot).toBe(false);
    expect(turnStart.playerIndex).toBe(0);

    // State should include full hands for ALL players
    expect(turnStart.state.players[0].hand).toEqual([1, 2, 3, 4, 5]);
    expect(turnStart.state.players[1].hand).toEqual([6, 7, 8, 9, 10]);
    expect(turnStart.state.buildingPiles).toEqual([[], [], [], []]);
    expect(turnStart.state.deckCount).toBe(132);
  });

  test('logPlay writes play event with move and state_before', () => {
    const logger = new GameLogger({ outputDir: tmpDir, roomId: 'T3' });
    const game = makeGame();
    logger.startGame(game);
    const stateBefore = logger._snapshot(game);
    logger.logPlay(1, 'Alice', false, { card: 1, source: 'hand', buildingPileIndex: 0 }, stateBefore);
    logger.close();

    const lines = readLogLines(tmpDir);
    const play = JSON.parse(lines[1]);
    expect(play.type).toBe('play');
    expect(play.turn).toBe(1);
    expect(play.player).toBe('Alice');
    expect(play.isBot).toBe(false);
    expect(play.move).toEqual({ card: 1, source: 'hand', buildingPileIndex: 0 });
    expect(play.state_before.players[0].hand).toEqual([1, 2, 3, 4, 5]);
  });

  test('logPlay includes ai_analysis when provided', () => {
    const logger = new GameLogger({ outputDir: tmpDir, roomId: 'T4' });
    const game = makeGame();
    logger.startGame(game);
    const stateBefore = logger._snapshot(game);
    const analysis = { chosenScore: 10, bestScore: 15, bestMove: { card: 2 }, agreement: false, alternatives: [] };
    logger.logPlay(1, 'Alice', false, { card: 1, source: 'hand', buildingPileIndex: 0 }, stateBefore, analysis);
    logger.close();

    const lines = readLogLines(tmpDir);
    const play = JSON.parse(lines[1]);
    expect(play.ai_analysis).toBeDefined();
    expect(play.ai_analysis.chosenScore).toBe(10);
    expect(play.ai_analysis.agreement).toBe(false);
  });

  test('logPlay omits ai_analysis when not provided', () => {
    const logger = new GameLogger({ outputDir: tmpDir, roomId: 'T5' });
    const game = makeGame();
    logger.startGame(game);
    const stateBefore = logger._snapshot(game);
    logger.logPlay(1, 'Alice', false, { card: 1, source: 'hand', buildingPileIndex: 0 }, stateBefore);
    logger.close();

    const lines = readLogLines(tmpDir);
    const play = JSON.parse(lines[1]);
    expect(play.ai_analysis).toBeUndefined();
  });

  test('logDiscard writes discard event', () => {
    const logger = new GameLogger({ outputDir: tmpDir, roomId: 'T6' });
    const game = makeGame();
    logger.startGame(game);
    const stateBefore = logger._snapshot(game);
    logger.logDiscard(1, 'Alice', false, { card: 5, discardPileIndex: 2 }, stateBefore);
    logger.close();

    const lines = readLogLines(tmpDir);
    const discard = JSON.parse(lines[1]);
    expect(discard.type).toBe('discard');
    expect(discard.move).toEqual({ card: 5, discardPileIndex: 2 });
    expect(discard.isBot).toBe(false);
  });

  test('logTurnEnd writes turn_end event', () => {
    const logger = new GameLogger({ outputDir: tmpDir, roomId: 'T7' });
    const game = makeGame();
    logger.startGame(game);
    logger.logTurnEnd(1, 'Alice', false, 3);
    logger.close();

    const lines = readLogLines(tmpDir);
    const turnEnd = JSON.parse(lines[1]);
    expect(turnEnd.type).toBe('turn_end');
    expect(turnEnd.turn).toBe(1);
    expect(turnEnd.player).toBe('Alice');
    expect(turnEnd.cardsPlayed).toBe(3);
  });

  test('endGame writes game_end with winner and final state', () => {
    const logger = new GameLogger({ outputDir: tmpDir, roomId: 'T8' });
    const game = makeGame({ gameOver: true, winner: { internalId: 'p1', name: 'Alice' } });
    logger.startGame(game);
    logger.endGame(game);
    logger.close();

    const lines = readLogLines(tmpDir);
    const gameEnd = JSON.parse(lines[1]);
    expect(gameEnd.type).toBe('game_end');
    expect(gameEnd.winner).toBe('Alice');
    expect(gameEnd.final_state.players).toHaveLength(2);
  });

  test('all lines are valid JSON (JSONL format)', () => {
    const logger = new GameLogger({ outputDir: tmpDir, roomId: 'T9' });
    const game = makeGame();
    logger.startGame(game);
    logger.logTurnStart(1, game);
    const stateBefore = logger._snapshot(game);
    logger.logPlay(1, 'Alice', false, { card: 1, source: 'hand', buildingPileIndex: 0 }, stateBefore);
    logger.logDiscard(1, 'Alice', false, { card: 5, discardPileIndex: 0 }, stateBefore);
    logger.logTurnEnd(1, 'Alice', false, 1);
    logger.endGame(game);
    logger.close();

    const lines = readLogLines(tmpDir);
    expect(lines.length).toBe(6);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  test('close prevents further writes', () => {
    const logger = new GameLogger({ outputDir: tmpDir, roomId: 'T10' });
    const game = makeGame();
    logger.startGame(game);
    logger.close();

    // Should not throw, just silently skip
    logger.logTurnStart(1, game);
    logger.endGame(game);

    const lines = readLogLines(tmpDir);
    expect(lines.length).toBe(1); // only game_start
  });

  test('_snapshot captures stockpile info correctly', () => {
    const logger = new GameLogger({ outputDir: tmpDir, roomId: 'T11' });
    const game = makeGame();
    const snap = logger._snapshot(game);

    expect(snap.players[0].stockTop).toBe(7);
    expect(snap.players[0].stockCount).toBe(1);
    expect(snap.players[1].stockTop).toBe(5);
    expect(snap.players[1].stockCount).toBe(2);
    expect(snap.players[1].discards).toEqual([[4], [], [], []]);
  });

  test('_snapshot deep copies arrays (no shared references)', () => {
    const logger = new GameLogger({ outputDir: tmpDir, roomId: 'T12' });
    const game = makeGame();
    const snap = logger._snapshot(game);

    // Modify the snapshot
    snap.buildingPiles[0].push(999);
    snap.players[0].hand.push(999);
    snap.players[1].discards[0].push(999);

    // Original game should be unaffected
    expect(game.buildingPiles[0]).toEqual([]);
    expect(game.players[0].hand).toEqual([1, 2, 3, 4, 5]);
    expect(game.players[1].discardPiles[0]).toEqual([4]);
  });
});

describe('MoveAnalyzer', () => {
  function makeAnalyzableState(overrides = {}) {
    const playerState = {
      hand: overrides.hand || [1, 2, 3, 4, 5],
      stockpileTop: overrides.stockpileTop ?? null,
      stockpileCount: overrides.stockpileCount ?? 20,
      discardPiles: overrides.discardPiles || [[], [], [], []],
    };
    const gameState = {
      buildingPiles: overrides.buildingPiles || [[], [], [], []],
      deckCount: overrides.deckCount ?? 100,
      players: [
        {
          stockpileTop: playerState.stockpileTop,
          stockpileCount: playerState.stockpileCount,
          discardPiles: playerState.discardPiles,
          handCount: playerState.hand.length,
        },
        {
          stockpileTop: overrides.oppStockTop ?? 10,
          stockpileCount: overrides.oppStockCount ?? 20,
          discardPiles: overrides.oppDiscards || [[], [], [], []],
          handCount: 5,
        },
      ],
    };
    return { playerState, gameState };
  }

  test('analyzePlay returns agreement=true when move matches best', () => {
    const analyzer = new MoveAnalyzer();
    const { playerState, gameState } = makeAnalyzableState({
      hand: [1, 2, 3, 4, 5],
      buildingPiles: [[], [], [], []],
    });

    // AI should want to play 1 (starts a pile)
    const result = analyzer.analyzePlay(playerState, gameState, {
      card: 1, source: 'hand', buildingPileIndex: 0,
    });

    expect(result.agreement).toBe(true);
    expect(result.chosenScore).toBeGreaterThan(0);
    expect(result.bestScore).toBe(result.chosenScore);
    expect(result.alternatives.length).toBeGreaterThanOrEqual(1);
  });

  test('analyzePlay returns agreement=false when move differs', () => {
    const analyzer = new MoveAnalyzer();
    const { playerState, gameState } = makeAnalyzableState({
      hand: [1, 2, 3, 4, 5],
      buildingPiles: [[], [], [], []],
    });

    // Playing 2 on an empty pile is invalid in-game, but the analyzer
    // just tries to find this move among scored chains. It won't find it.
    const result = analyzer.analyzePlay(playerState, gameState, {
      card: 2, source: 'hand', buildingPileIndex: 0,
    });

    // 2 can't be played on empty pile, so chosen score is 0
    expect(result.agreement).toBe(false);
    expect(result.bestScore).toBeGreaterThan(0);
    expect(result.chosenScore).toBe(0);
  });

  test('analyzeDiscard scores all card x pile combos', () => {
    const analyzer = new MoveAnalyzer();
    const { playerState, gameState } = makeAnalyzableState({
      hand: [5, 6, 7, 8, 9],
      buildingPiles: [[], [], [], []],
    });

    const result = analyzer.analyzeDiscard(playerState, gameState, {
      card: 9, discardPileIndex: 0,
    });

    expect(result.alternatives.length).toBeGreaterThanOrEqual(1);
    expect(result.alternatives.length).toBeLessThanOrEqual(5);
    // All alternatives should have score and move
    for (const alt of result.alternatives) {
      expect(alt.move).toBeDefined();
      expect(typeof alt.score).toBe('number');
    }
    // Alternatives should be sorted descending
    for (let i = 1; i < result.alternatives.length; i++) {
      expect(result.alternatives[i - 1].score).toBeGreaterThanOrEqual(result.alternatives[i].score);
    }
  });

  test('analyzeDiscard returns agreement when move matches best', () => {
    const analyzer = new MoveAnalyzer();
    const { playerState, gameState } = makeAnalyzableState({
      hand: [5, 6, 7, 8, 9],
      buildingPiles: [[], [], [], []],
    });

    // First get the AI's best discard
    const probe = analyzer.analyzeDiscard(playerState, gameState, { card: 5, discardPileIndex: 0 });
    const best = probe.bestMove;

    // Now analyze with the best move as actual
    const result = analyzer.analyzeDiscard(playerState, gameState, best);
    expect(result.agreement).toBe(true);
  });

  test('analyzePlay works with SKIP-BO in hand', () => {
    const analyzer = new MoveAnalyzer();
    const { playerState, gameState } = makeAnalyzableState({
      hand: ['SKIP-BO', 2, 3, 4, 5],
      buildingPiles: [[], [], [], []],
    });

    // SKIP-BO can play as 1 on empty pile
    const result = analyzer.analyzePlay(playerState, gameState, {
      card: 'SKIP-BO', source: 'hand', buildingPileIndex: 0,
    });

    expect(result.alternatives.length).toBeGreaterThanOrEqual(1);
    // Should have found chains including SKIP-BO plays
    expect(result.chosenScore).not.toBe(0);
  });
});

// Helper to read all lines from the single log file in tmpDir
function readLogLines(dir) {
  const files = fs.readdirSync(dir);
  expect(files.length).toBe(1);
  return fs.readFileSync(path.join(dir, files[0]), 'utf-8').trim().split('\n');
}
