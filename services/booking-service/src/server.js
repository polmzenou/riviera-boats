const { Pool } = require('pg');
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createRepository } = require('./repository');
const { createBoatClient } = require('./boatClient');
const { createApp } = require('./app');

const config = loadConfig();
const logger = createLogger('booking-service', config.logLevel);

async function waitForDatabase(repo, attempts = 15) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await repo.ping();
      return;
    } catch (err) {
      logger.warn('Base indisponible, nouvelle tentative', { attempt: i, err: err.message });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('Base de données injoignable');
}

async function main() {
  const pool = new Pool({ ...config.db, max: 10 });
  const repo = createRepository(pool);
  await waitForDatabase(repo);

  const boatClient = createBoatClient({ baseUrl: config.boatServiceUrl });
  const app = createApp({ repo, boatClient, config, logger });
  const server = app.listen(config.port, () => {
    logger.info('booking-service démarré', { port: config.port, env: config.appEnv });
  });

  const shutdown = (signal) => {
    logger.info('Arrêt demandé', { signal });
    server.close(() => pool.end().finally(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error('Démarrage impossible', { err: err.message });
  process.exit(1);
});
