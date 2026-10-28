const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function createLogger(service, level = 'info') {
  const min = LEVELS[level] ?? LEVELS.info;
  const write = (lvl) => (msg, extra = {}) => {
    if (LEVELS[lvl] < min) return;
    const line = JSON.stringify({ time: new Date().toISOString(), level: lvl, service, msg, ...extra });
    (LEVELS[lvl] >= LEVELS.warn ? process.stderr : process.stdout).write(`${line}\n`);
  };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}

function requestLogger(logger) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info('request', {
        requestId: req.get('x-request-id'),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Math.round(ms),
      });
    });
    next();
  };
}

module.exports = { createLogger, requestLogger };
