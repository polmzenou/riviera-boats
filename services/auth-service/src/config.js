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
    port: Number(env.PORT ?? 3000),
    logLevel: env.LOG_LEVEL ?? 'info',
    db: {
      host: env.DB_HOST ?? 'db',
      port: Number(env.DB_PORT ?? 5432),
      database: env.DB_NAME ?? 'riviera',
      user: env.DB_USER ?? 'auth_svc',
      password: readSecret('DB_PASSWORD', env),
    },
    cookieName: 'rb_session',
    cookieSecure: env.COOKIE_SECURE === 'true',
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 8),
    bcryptRounds: Number(env.BCRYPT_ROUNDS ?? 10),
    admin: {
      email: env.ADMIN_EMAIL ?? null,
      password: readSecret('ADMIN_PASSWORD', env, null),
    },
    seedDemoUsers: env.SEED_DEMO_USERS === 'true',
    demoPassword: env.DEMO_PASSWORD ?? 'Demo1234!',
    internalToken: readSecret('INTERNAL_TOKEN', env),
    bookingServiceUrl: env.BOOKING_SERVICE_URL ?? 'http://booking-service:3001',
  };
}

module.exports = { loadConfig, readSecret };
