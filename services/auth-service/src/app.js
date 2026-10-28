const crypto = require('node:crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { requestLogger } = require('./logger');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// seul le hash du jeton est stocké en base
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  fullName: u.full_name,
  role: u.role,
  createdAt: u.created_at,
});

function validateRegistration({ email, password, fullName }) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) return 'Email invalide';
  if (typeof password !== 'string' || password.length < 8) return 'Le mot de passe doit faire au moins 8 caractères';
  // bcrypt tronque au-delà de 72 octets
  if (Buffer.byteLength(password) > 72) return 'Mot de passe trop long (72 octets max)';
  if (typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.trim().length > 80) {
    return 'Le nom doit faire entre 2 et 80 caractères';
  }
  return null;
}

function createApp({ repo, bookingClient, config, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());
  app.use(requestLogger(logger));

  const sessionMs = config.sessionTtlHours * 3600 * 1000;
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/' };
  // un email inconnu doit prendre autant de temps qu'un mauvais mot de passe
  const dummyHash = bcrypt.hashSync('timing-attack-guard', config.bcryptRounds);

  async function openSession(res, user) {
    const token = crypto.randomBytes(32).toString('base64url');
    await repo.createSession(hashToken(token), user.id, new Date(Date.now() + sessionMs));
    res.cookie(config.cookieName, token, { ...cookieOptions, maxAge: sessionMs });
  }

  async function currentUser(req) {
    const token = req.cookies?.[config.cookieName];
    if (!token) return null;
    return repo.findUserBySessionHash(hashToken(token));
  }

  async function requireUser(req, res, next) {
    req.user = await currentUser(req);
    if (!req.user) return res.status(401).json({ error: 'Authentification requise' });
    return next();
  }

  function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs' });
    return next();
  }

  // réservations d'abord : si booking-service ne répond pas, on ne supprime rien
  async function deleteAccount(userId, req) {
    await bookingClient.purgeUserBookings(userId, req.get('x-request-id'));
    await repo.deleteUser(userId);
  }

  app.get('/health', async (_req, res) => {
    try {
      await repo.ping();
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'db-unavailable' });
    }
  });

  app.post('/api/auth/register', async (req, res) => {
    const body = req.body ?? {};
    const error = validateRegistration(body);
    if (error) return res.status(400).json({ error });

    const user = await repo.createUser({
      email: body.email.trim().toLowerCase(),
      passwordHash: await bcrypt.hash(body.password, config.bcryptRounds),
      fullName: body.fullName.trim(),
      role: 'user',
    });
    if (!user) return res.status(409).json({ error: 'Un compte existe déjà avec cet email' });

    logger.info('Compte créé', { userId: user.id });
    await openSession(res, user);
    return res.status(201).json({ user: publicUser(user) });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }
    const user = await repo.findUserByEmail(email.trim().toLowerCase());
    const ok = await bcrypt.compare(password, user ? user.password_hash : dummyHash);
    if (!user || !ok) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    await openSession(res, user);
    return res.json({ user: publicUser(user) });
  });

  app.post('/api/auth/logout', async (req, res) => {
    const token = req.cookies?.[config.cookieName];
    if (token) await repo.deleteSession(hashToken(token));
    res.clearCookie(config.cookieName, cookieOptions);
    res.status(204).end();
  });

  app.get('/api/auth/me', requireUser, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  app.delete('/api/auth/me', requireUser, async (req, res) => {
    if (req.user.role === 'admin') {
      return res.status(403).json({ error: 'Un compte administrateur ne peut pas être supprimé depuis l\'application' });
    }
    await deleteAccount(req.user.id, req);
    logger.info('Compte supprimé par son propriétaire', { userId: req.user.id });
    res.clearCookie(config.cookieName, cookieOptions);
    return res.status(204).end();
  });

  app.get('/api/auth/users', requireUser, requireAdmin, async (_req, res) => {
    const users = await repo.listUsers();
    res.json({ users: users.map(publicUser) });
  });

  app.delete('/api/auth/users/:id', requireUser, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Identifiant invalide' });

    const target = await repo.findUserById(id);
    if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
    if (target.role === 'admin') {
      return res.status(403).json({ error: 'Impossible de supprimer un compte administrateur' });
    }
    await deleteAccount(id, req);
    logger.info('Compte supprimé par un administrateur', { adminId: req.user.id, userId: id });
    return res.status(204).end();
  });

  // appelée par nginx (auth_request), pas exposée à l'extérieur
  app.get('/internal/verify', async (req, res) => {
    const user = await currentUser(req);
    if (!user) return res.status(401).end();
    if (req.query.role === 'admin' && user.role !== 'admin') return res.status(403).end();
    res.set({ 'X-User-Id': String(user.id), 'X-User-Role': user.role });
    return res.status(204).end();
  });

  app.use((_req, res) => res.status(404).json({ error: 'Route inconnue' }));

  app.use((err, req, res, _next) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) logger.error(err.message, { requestId: req.get('x-request-id'), stack: err.stack });
    res.status(status).json({ error: err.expose ? err.message : 'Erreur interne' });
  });

  return app;
}

module.exports = { createApp, hashToken, publicUser };
