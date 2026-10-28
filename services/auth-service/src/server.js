const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createRepository } = require('./repository');
const { createBookingClient } = require('./bookingClient');
const { createApp } = require('./app');

const config = loadConfig();
const logger = createLogger('auth-service', config.logLevel);

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

async function seedUser(repo, { email, password, fullName, role }) {
  if (await repo.findUserByEmail(email)) return;
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  await repo.createUser({ email, passwordHash, fullName, role });
  logger.info('Compte initial créé', { email, role });
}

async function main() {
  const pool = new Pool({ ...config.db, max: 10 });
  const repo = createRepository(pool);
  await waitForDatabase(repo);

  // admin initial (aucune route ne permet de devenir admin)
  if (config.admin.email && config.admin.password) {
    await seedUser(repo, { email: config.admin.email, password: config.admin.password, fullName: 'Administrateur Riviera', role: 'admin' });
  }
  // comptes de démo (test/uat)
  if (config.seedDemoUsers) {
    const demo = [
      { email: 'marie.dupont@example.com', fullName: 'Marie Dupont', role: 'user' },
      { email: 'luc.martin@example.com', fullName: 'Luc Martin', role: 'user' },
      { email: 'capitaine@rivieraboats.fr', fullName: 'Capitaine Haddock', role: 'admin' },
    ];
    for (const u of demo) await seedUser(repo, { ...u, password: config.demoPassword });
  }

  const bookingClient = createBookingClient({ baseUrl: config.bookingServiceUrl, internalToken: config.internalToken });
  const app = createApp({ repo, bookingClient, config, logger });
  const server = app.listen(config.port, () => {
    logger.info('auth-service démarré', { port: config.port, env: config.appEnv });
  });

  const cleanup = setInterval(async () => {
    try {
      const n = await repo.deleteExpiredSessions();
      if (n) logger.info('Sessions expirées supprimées', { count: n });
    } catch (err) {
      logger.warn('Nettoyage des sessions impossible', { err: err.message });
    }
  }, 3600 * 1000);
  cleanup.unref();

  const shutdown = (signal) => {
    logger.info('Arrêt demandé', { signal });
    clearInterval(cleanup);
    server.close(() => pool.end().finally(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error('Démarrage impossible', { err: err.message });
  process.exit(1);
});
