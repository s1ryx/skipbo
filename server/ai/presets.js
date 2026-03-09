/**
 * AI difficulty presets.
 *
 * Each preset is a set of feature flags that toggle specific scoring
 * behaviors in StateEvaluator and AIPlayer. Instead of duplicating
 * entire files for each difficulty, a single codebase branches on
 * these flags at the relevant decision points.
 */

const DIFFICULTY_PRESETS = {
  baseline: {
    reachabilityScoring: false,
    runwayDetection: false,
    qualityAwareScoring: false,
    advancedOpponentPenalty: false,
    stockpileOrderingPenalty: false,
  },
  improved: {
    reachabilityScoring: true,
    runwayDetection: true,
    qualityAwareScoring: true,
    advancedOpponentPenalty: true,
    stockpileOrderingPenalty: false,
  },
  advanced: {
    reachabilityScoring: true,
    runwayDetection: true,
    qualityAwareScoring: true,
    advancedOpponentPenalty: true,
    stockpileOrderingPenalty: true,
    scarceCardScoring: true,
  },
};

const DEFAULT_DIFFICULTY = 'improved';

module.exports = { DIFFICULTY_PRESETS, DEFAULT_DIFFICULTY };
