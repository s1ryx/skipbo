const { createLogger } = require('../../logger');

describe('createLogger', () => {
  let spy;

  beforeEach(() => {
    spy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it('logs info messages as JSON', () => {
    const logger = createLogger();
    logger.info('test message');
    expect(spy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(spy.mock.calls[0][0]);
    expect(output.level).toBe('info');
    expect(output.msg).toBe('test message');
    expect(output.timestamp).toBeDefined();
  });

  it('includes data when provided', () => {
    const logger = createLogger();
    logger.info('room created', { roomId: 'ABC' });
    const output = JSON.parse(spy.mock.calls[0][0]);
    expect(output.data).toEqual({ roomId: 'ABC' });
  });

  it('omits data key when not provided', () => {
    const logger = createLogger();
    logger.info('simple message');
    const output = JSON.parse(spy.mock.calls[0][0]);
    expect(output).not.toHaveProperty('data');
  });

  it('respects log level filtering', () => {
    const logger = createLogger({ level: 'warn' });
    logger.debug('debug msg');
    logger.info('info msg');
    logger.warn('warn msg');
    logger.error('error msg');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(spy.mock.calls[0][0]).level).toBe('warn');
    expect(JSON.parse(spy.mock.calls[1][0]).level).toBe('error');
  });

  it('supports all four log levels', () => {
    const logger = createLogger({ level: 'debug' });
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(spy).toHaveBeenCalledTimes(4);
    const levels = spy.mock.calls.map((c) => JSON.parse(c[0]).level);
    expect(levels).toEqual(['debug', 'info', 'warn', 'error']);
  });
});
