const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function createLogger(options = {}) {
  const minLevel = LOG_LEVELS[options.level || process.env.LOG_LEVEL || 'info'] || 0;

  function log(level, msg, data) {
    if (LOG_LEVELS[level] < minLevel) return;
    const entry = { timestamp: new Date().toISOString(), level, msg };
    if (data !== undefined) entry.data = data;
    console.log(JSON.stringify(entry));
  }

  return {
    debug(msg, data) {
      log('debug', msg, data);
    },
    info(msg, data) {
      log('info', msg, data);
    },
    warn(msg, data) {
      log('warn', msg, data);
    },
    error(msg, data) {
      log('error', msg, data);
    },
  };
}

module.exports = { createLogger };
