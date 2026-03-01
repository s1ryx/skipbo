const { GameError, ErrorCodes } = require('../../errors');

describe('GameError', () => {
  it('stores code and message', () => {
    const err = new GameError('error.notYourTurn', 'Not your turn');
    expect(err.code).toBe('error.notYourTurn');
    expect(err.message).toBe('Not your turn');
  });

  it('defaults message to code when omitted', () => {
    const err = new GameError('error.roomFull');
    expect(err.message).toBe('error.roomFull');
  });
});

describe('ErrorCodes', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(ErrorCodes)).toBe(true);
  });

  it('all values follow error.xxx naming convention', () => {
    Object.values(ErrorCodes).forEach((code) => {
      expect(code).toMatch(/^error\.\w+$/);
    });
  });

  it('has no duplicate values', () => {
    const values = Object.values(ErrorCodes);
    expect(new Set(values).size).toBe(values.length);
  });
});
