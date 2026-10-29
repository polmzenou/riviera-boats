const fs = require('node:fs');

// NOM_FILE (secret docker dans /run/secrets) prioritaire sur NOM
function readSecret(name, env, fallback) {
  const file = env[`${name}_FILE`];
  if (file) return fs.readFileSync(file, 'utf8').trim();
  if (env[name] !== undefined) return env[name];
  if (fallback !== undefined) return fallback;
  throw new Error(`Configuration manquante : ${name} ou ${name}_FILE`);
}

function loadConfig(env = process.env) {
  return {
    appEnv: env.APP_ENV ?? 'dev',
    port: Number(env.PORT ?? 3001),
    logLevel: env.LOG_LEVEL ?? 'info',
    db: {
      host: env.DB_HOST ?? 'db',
      port: Number(env.DB_PORT ?? 5432),
      database: env.DB_NAME ?? 'riviera',
      user: env.DB_USER ?? 'booking_svc',
      password: readSecret('DB_PASSWORD', env),
    },
    internalToken: readSecret('INTERNAL_TOKEN', env),
    boatServiceUrl: env.BOAT_SERVICE_URL ?? 'http://boat-service:8000',
    maxDays: Number(env.BOOKING_MAX_DAYS ?? 14),
    maxAdvanceDays: Number(env.BOOKING_MAX_ADVANCE_DAYS ?? 365),
  };
}

module.exports = { loadConfig, readSecret };
