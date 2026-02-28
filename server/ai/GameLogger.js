/**
 * GameLogger — JSONL game logging for replay, ML training, and analysis.
 *
 * Writes one JSON object per line to a .jsonl file. Each event captures the
 * complete game state (all hands, piles, stockpiles) so any position can be
 * reconstructed or used as ML training data.
 *
 * MoveAnalyzer — optional companion that runs the AI evaluator on each position
 * and returns scored alternatives for comparison with the actual move.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_OUTPUT_DIR = path.join(__dirname, '..', '..', 'logs');

class GameLogger {
  /**
   * @param {Object} options
   * @param {string} [options.outputDir] - directory for log files (default: PROJECT/logs/)
   * @param {string} [options.mode='server'] - 'server' or 'direct' (for filename)
   * @param {string} [options.roomId='game'] - room ID for filename uniqueness
   */
  constructor(options = {}) {
    this.outputDir = options.outputDir || DEFAULT_OUTPUT_DIR;
    this.mode = options.mode || 'server';
    this.roomId = options.roomId || 'game';
    this._fd = null;
    this._filePath = null;
    this._closed = false;
  }

  /**
   * Log game start. Opens the log file and writes the header event.
   * @param {Object} gameObj - SkipBoGame instance
   */
  startGame(gameObj) {
    // Ensure output directory exists
    fs.mkdirSync(this.outputDir, { recursive: true });

    // Generate filename
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `game_${this.roomId}_${ts}.jsonl`;
    this._filePath = path.join(this.outputDir, filename);

    // Open file for appending
    this._fd = fs.openSync(this._filePath, 'a');

    const state = this._snapshot(gameObj);
    this._write({
      type: 'game_start',
      timestamp: now.toISOString(),
      roomId: this.roomId,
      mode: this.mode,
      players: state.players.map((p) => ({
        name: p.name,
        isBot: p.isBot,
        stockCount: p.stockCount,
      })),
      stockpileSize: gameObj.stockpileSize,
      deckCount: state.deckCount,
    });
  }

  /**
   * Log turn start with full state snapshot.
   * @param {number} turn - turn number (1-indexed)
   * @param {Object} gameObj - SkipBoGame instance
   */
  logTurnStart(turn, gameObj) {
    const current = gameObj.getCurrentPlayer();
    this._write({
      type: 'turn_start',
      turn,
      player: current.name,
      isBot: !!current.isBot,
      playerIndex: gameObj.currentPlayerIndex,
      state: this._snapshot(gameObj),
    });
  }

  /**
   * Log a play (card to building pile).
   * @param {number} turn
   * @param {string} playerName
   * @param {boolean} isBot
   * @param {Object} move - { card, source, buildingPileIndex }
   * @param {Object} stateBefore - snapshot taken before the play
   * @param {Object} [aiAnalysis] - optional MoveAnalyzer result
   */
  logPlay(turn, playerName, isBot, move, stateBefore, aiAnalysis) {
    const entry = {
      type: 'play',
      turn,
      player: playerName,
      isBot: !!isBot,
      move: {
        card: move.card,
        source: move.source,
        buildingPileIndex: move.buildingPileIndex,
      },
      state_before: stateBefore,
    };
    if (aiAnalysis) entry.ai_analysis = aiAnalysis;
    this._write(entry);
  }

  /**
   * Log a discard (card to discard pile).
   * @param {number} turn
   * @param {string} playerName
   * @param {boolean} isBot
   * @param {Object} move - { card, discardPileIndex }
   * @param {Object} stateBefore - snapshot taken before the discard
   * @param {Object} [aiAnalysis] - optional MoveAnalyzer result
   */
  logDiscard(turn, playerName, isBot, move, stateBefore, aiAnalysis) {
    const entry = {
      type: 'discard',
      turn,
      player: playerName,
      isBot: !!isBot,
      move: {
        card: move.card,
        discardPileIndex: move.discardPileIndex,
      },
      state_before: stateBefore,
    };
    if (aiAnalysis) entry.ai_analysis = aiAnalysis;
    this._write(entry);
  }

  /**
   * Log end of a player's turn.
   */
  logTurnEnd(turn, playerName, isBot, cardsPlayed) {
    this._write({
      type: 'turn_end',
      turn,
      player: playerName,
      isBot: !!isBot,
      cardsPlayed,
    });
  }

  /**
   * Log game end with final state.
   * @param {Object} gameObj - SkipBoGame instance
   */
  endGame(gameObj) {
    const gs = gameObj.getGameState();
    this._write({
      type: 'game_end',
      timestamp: new Date().toISOString(),
      winner: gs.winner ? gs.winner.name : null,
      final_state: this._snapshot(gameObj),
    });
  }

  /**
   * Build a complete state snapshot from a SkipBoGame instance.
   * Includes all players' hands (server has full access).
   *
   * @param {Object} gameObj - SkipBoGame instance
   * @returns {Object} compact state snapshot
   */
  _snapshot(gameObj) {
    const gs = gameObj.getGameState();
    const players = gameObj.players.map((p) => {
      const ps = gameObj.getPlayerState(p.id);
      return {
        name: p.name,
        isBot: !!p.isBot,
        stockTop: ps.stockpileTop,
        stockCount: ps.stockpileCount,
        hand: [...ps.hand],
        discards: ps.discardPiles.map((dp) => [...dp]),
      };
    });

    return {
      buildingPiles: gs.buildingPiles.map((bp) => [...bp]),
      deckCount: gs.deckCount,
      currentPlayerIndex: gs.currentPlayerIndex,
      players,
    };
  }

  /**
   * Append a JSON line to the log file.
   * @param {Object} obj
   */
  _write(obj) {
    if (this._closed || this._fd == null) return;
    const line = JSON.stringify(obj) + '\n';
    fs.writeSync(this._fd, line);
  }

  /**
   * Close the log file.
   */
  close() {
    if (this._fd != null && !this._closed) {
      fs.closeSync(this._fd);
      this._closed = true;
    }
  }

  /**
   * Get the path of the log file.
   */
  get filePath() {
    return this._filePath;
  }
}

// ── MoveAnalyzer ──────────────────────────────────────────────────────

const { CardCounter } = require('./CardCounter');
const { ChainDetector } = require('./ChainDetector');
const { StateEvaluator, detectRunway } = require('./StateEvaluator');

const MAX_ALTERNATIVES = 5;

class MoveAnalyzer {
  constructor() {
    this.cardCounter = new CardCounter();
    this.chainDetector = new ChainDetector();
    this.evaluator = new StateEvaluator(this.cardCounter, this.chainDetector);
  }

  /**
   * Analyze a play decision: score all possible chains and compare with actual move.
   *
   * @param {Object} playerState - state BEFORE the play
   * @param {Object} gameState - state BEFORE the play
   * @param {Object} actualMove - { card, source, buildingPileIndex }
   * @returns {Object} ai_analysis object
   */
  analyzePlay(playerState, gameState, actualMove) {
    this.cardCounter.update(playerState, gameState);
    const chains = this.chainDetector.findChains(playerState, gameState, { maxChains: 200 });

    if (chains.length === 0) {
      return { chosenScore: 0, bestScore: 0, bestMove: null, agreement: true, alternatives: [] };
    }

    // Score each chain
    const scored = chains.map((chain) => {
      const score = this.evaluator.scoreChain(chain, playerState, gameState);
      const firstPlay = chain.plays[0];
      return {
        move: {
          card: firstPlay.card,
          source: firstPlay.source,
          buildingPileIndex: firstPlay.pileIndex,
        },
        score,
        chainLength: chain.totalPlays,
      };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Deduplicate by first move (keep highest score for each unique first move)
    const seen = new Set();
    const unique = [];
    for (const s of scored) {
      const key = `${s.move.card}|${s.move.source}|${s.move.buildingPileIndex}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(s);
      }
    }

    const best = unique[0];

    // Find the score of the actual move
    const actualKey = `${actualMove.card}|${actualMove.source}|${actualMove.buildingPileIndex}`;
    const chosenEntry = unique.find((s) => {
      const key = `${s.move.card}|${s.move.source}|${s.move.buildingPileIndex}`;
      return key === actualKey;
    });
    const chosenScore = chosenEntry ? chosenEntry.score : 0;

    const agreement = best && chosenEntry
      && best.move.card === actualMove.card
      && best.move.source === actualMove.source
      && best.move.buildingPileIndex === actualMove.buildingPileIndex;

    return {
      chosenScore,
      bestScore: best ? best.score : 0,
      bestMove: best ? best.move : null,
      agreement: !!agreement,
      alternatives: unique.slice(0, MAX_ALTERNATIVES).map((s) => ({
        move: s.move,
        score: s.score,
        chainLength: s.chainLength,
      })),
    };
  }

  /**
   * Analyze a discard decision: score all (card, pile) combos and compare.
   *
   * @param {Object} playerState - state BEFORE the discard
   * @param {Object} gameState - state BEFORE the discard
   * @param {Object} actualMove - { card, discardPileIndex }
   * @returns {Object} ai_analysis object
   */
  analyzeDiscard(playerState, gameState, actualMove) {
    this.cardCounter.update(playerState, gameState);
    const runway = detectRunway(playerState, gameState);

    const hand = playerState.hand;
    const scored = [];

    for (let ci = 0; ci < hand.length; ci++) {
      const card = hand[ci];
      if (card === 'SKIP-BO') continue;

      for (let pi = 0; pi < 4; pi++) {
        const score = this.evaluator.scoreDiscard(card, pi, playerState, gameState, runway);
        scored.push({ move: { card, discardPileIndex: pi }, score });
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Deduplicate: same card value + same pile → keep highest score
    const seen = new Set();
    const unique = [];
    for (const s of scored) {
      const key = `${s.move.card}|${s.move.discardPileIndex}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(s);
      }
    }

    const best = unique[0];

    // Find the score of the actual move
    const chosenEntry = unique.find((s) =>
      s.move.card === actualMove.card && s.move.discardPileIndex === actualMove.discardPileIndex
    );
    const chosenScore = chosenEntry ? chosenEntry.score : 0;

    const agreement = best
      && best.move.card === actualMove.card
      && best.move.discardPileIndex === actualMove.discardPileIndex;

    return {
      chosenScore,
      bestScore: best ? best.score : 0,
      bestMove: best ? best.move : null,
      agreement: !!agreement,
      alternatives: unique.slice(0, MAX_ALTERNATIVES).map((s) => ({
        move: s.move,
        score: s.score,
      })),
    };
  }
}

module.exports = { GameLogger, MoveAnalyzer };
