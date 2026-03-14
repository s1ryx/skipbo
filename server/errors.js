class GameError {
  constructor(code, message) {
    this.code = code;
    this.message = message || code;
  }
}

const ErrorCodes = Object.freeze({
  // Room lifecycle
  ROOM_NOT_FOUND: 'error.roomNotFound',
  ROOM_FULL: 'error.roomFull',
  ROOM_NO_LONGER_EXISTS: 'error.roomNoLongerExists',
  SERVER_FULL: 'error.serverFull',
  GAME_ALREADY_STARTED: 'error.gameAlreadyStarted',

  // Player validation
  INVALID_PLAYER_NAME: 'error.invalidPlayerName',
  INVALID_SESSION: 'error.invalidSession',
  PLAYER_NOT_FOUND: 'error.playerNotFound',

  // Game start
  ONLY_HOST_CAN_START: 'error.onlyHostCanStart',
  NEED_MORE_PLAYERS: 'error.needMorePlayers',
  PLAYERS_DISCONNECTED: 'error.playersDisconnected',

  // Turn / move validation
  NOT_YOUR_TURN: 'error.notYourTurn',
  INVALID_SOURCE: 'error.invalidSource',
  INVALID_MOVE: 'error.invalidMove',
  CARD_NOT_FOUND: 'error.cardNotFound',
  INVALID_DISCARD_PILE: 'error.invalidDiscardPile',
  CARD_NOT_IN_HAND: 'error.cardNotInHand',
  PLAYER_NOT_FOUND_DRAW: 'error.playerNotFoundDraw',
  CANNOT_PASS: 'error.cannotPass',

  // Bot management
  ONLY_HOST_CAN_ADD_BOT: 'error.onlyHostCanAddBot',
  ONLY_HOST_CAN_REMOVE_BOT: 'error.onlyHostCanRemoveBot',
  NOT_A_BOT: 'error.notABot',
  CANNOT_ADD_BOT_DURING_GAME: 'error.cannotAddBotDuringGame',
});

module.exports = { GameError, ErrorCodes };
