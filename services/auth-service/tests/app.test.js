const request = require('supertest');
const bcrypt = require('bcryptjs');
const { createApp, hashToken } = require('../src/app');
const { createLogger } = require('../src/logger');
const { UpstreamError } = require('../src/bookingClient');
const { createFakeRepository } = require('./fakeRepository');

const config = {
  cookieName: 'rb_session',
  cookieSecure: false,
  sessionTtlHours: 1,
  bcryptRounds: 4, // rapide en test
};

function setup() {
  const repo = createFakeRepository();
  const bookingClient = { purgeUserBookings: jest.fn().mockResolvedValue({ deleted: 2 }) };
  const app = createApp({ repo, bookingClient, config, logger: createLogger('test', 'silent') });
  return { repo, bookingClient, app };
}

async function addUser(repo, { email, password = 'Secret123!', role = 'user' }) {
  return repo.createUser({ email, passwordHash: bcrypt.hashSync(password, 4), fullName: 'Test User', role });
}

// l'agent garde les cookies entre les requêtes
async function loginAgent(app, email, password = 'Secret123!') {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password }).expect(200);
  return agent;
}

describe('santé', () => {
  test('GET /health répond ok quand la base répond', async () => {
    const { app } = setup();
    await request(app).get('/health').expect(200, { status: 'ok' });
  });

  test('GET /health répond 503 si la base est indisponible', async () => {
    const { app, repo } = setup();
    repo.failPing = true;
    await request(app).get('/health').expect(503);
  });
});

describe('inscription', () => {
  test('crée un compte standard et ouvre une session HttpOnly', async () => {
    const { app, repo } = setup();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: '  Marie@Example.com ', password: 'Secret123!', fullName: 'Marie' })
      .expect(201);

    expect(res.body.user).toMatchObject({ email: 'marie@example.com', role: 'user', fullName: 'Marie' });
    expect(res.body.user.password_hash).toBeUndefined();
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^rb_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(repo.sessions.size).toBe(1);
  });

  test('ne permet jamais de choisir le rôle admin', async () => {
    const { app } = setup();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'pirate@example.com', password: 'Secret123!', fullName: 'Pirate', role: 'admin' })
      .expect(201);
    expect(res.body.user.role).toBe('user');
  });

  test.each([
    [{ email: 'pas-un-email', password: 'Secret123!', fullName: 'Bob' }, /Email/],
    [{ email: 'bob@example.com', password: 'court', fullName: 'Bob' }, /8 caractères/],
    [{ email: 'bob@example.com', password: 'x'.repeat(80), fullName: 'Bob' }, /72/],
    [{ email: 'bob@example.com', password: 'Secret123!', fullName: 'B' }, /nom/],
    [{}, /Email/],
  ])('refuse une saisie invalide %#', async (body, message) => {
    const { app } = setup();
    const res = await request(app).post('/api/auth/register').send(body).expect(400);
    expect(res.body.error).toMatch(message);
  });

  test('refuse un email déjà utilisé (409)', async () => {
    const { app, repo } = setup();
    await addUser(repo, { email: 'marie@example.com' });
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'marie@example.com', password: 'Secret123!', fullName: 'Marie' })
      .expect(409);
  });

  test('renvoie 400 sur un JSON mal formé', async () => {
    const { app } = setup();
    await request(app)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);
  });
});

describe('connexion / déconnexion', () => {
  test('connexion réussie puis /me', async () => {
    const { app, repo } = setup();
    await addUser(repo, { email: 'luc@example.com' });
    const agent = await loginAgent(app, 'luc@example.com');
    const res = await agent.get('/api/auth/me').expect(200);
    expect(res.body.user.email).toBe('luc@example.com');
  });

  test('mauvais mot de passe ou email inconnu : 401 avec le même message', async () => {
    const { app, repo } = setup();
    await addUser(repo, { email: 'luc@example.com' });
    const bad = await request(app).post('/api/auth/login').send({ email: 'luc@example.com', password: 'nope' }).expect(401);
    const unknown = await request(app).post('/api/auth/login').send({ email: 'x@example.com', password: 'nope' }).expect(401);
    expect(bad.body.error).toBe(unknown.body.error);
  });

  test('connexion sans champs : 400', async () => {
    const { app } = setup();
    await request(app).post('/api/auth/login').send({}).expect(400);
  });

  test('la déconnexion supprime la session côté serveur', async () => {
    const { app, repo } = setup();
    await addUser(repo, { email: 'luc@example.com' });
    const agent = await loginAgent(app, 'luc@example.com');
    await agent.post('/api/auth/logout').expect(204);
    expect(repo.sessions.size).toBe(0);
    await agent.get('/api/auth/me').expect(401);
  });

  test('déconnexion sans cookie : 204 quand même', async () => {
    const { app } = setup();
    await request(app).post('/api/auth/logout').expect(204);
  });

  test('une session expirée est refusée', async () => {
    const { app, repo } = setup();
    const user = await addUser(repo, { email: 'luc@example.com' });
    await repo.createSession(hashToken('vieux-jeton'), user.id, new Date(Date.now() - 1000));
    await request(app).get('/api/auth/me').set('Cookie', 'rb_session=vieux-jeton').expect(401);
    expect(await repo.deleteExpiredSessions()).toBe(1);
  });

  test('/me sans cookie : 401', async () => {
    const { app } = setup();
    await request(app).get('/api/auth/me').expect(401);
  });
});

describe('/internal/verify (auth_request Nginx)', () => {
  test('401 sans session', async () => {
    const { app } = setup();
    await request(app).get('/internal/verify').expect(401);
  });

  test('204 avec les en-têtes d\'identité pour un utilisateur connecté', async () => {
    const { app, repo } = setup();
    const user = await addUser(repo, { email: 'luc@example.com' });
    const agent = await loginAgent(app, 'luc@example.com');
    const res = await agent.get('/internal/verify').expect(204);
    expect(res.headers['x-user-id']).toBe(String(user.id));
    expect(res.headers['x-user-role']).toBe('user');
  });

  test('403 pour un utilisateur standard sur une zone admin', async () => {
    const { app, repo } = setup();
    await addUser(repo, { email: 'luc@example.com' });
    const agent = await loginAgent(app, 'luc@example.com');
    await agent.get('/internal/verify?role=admin').expect(403);
  });

  test('204 pour un admin sur une zone admin', async () => {
    const { app, repo } = setup();
    await addUser(repo, { email: 'admin@example.com', role: 'admin' });
    const agent = await loginAgent(app, 'admin@example.com');
    const res = await agent.get('/internal/verify?role=admin').expect(204);
    expect(res.headers['x-user-role']).toBe('admin');
  });
});

describe('suppression de son propre compte', () => {
  test('purge les réservations puis supprime le compte', async () => {
    const { app, repo, bookingClient } = setup();
    const user = await addUser(repo, { email: 'luc@example.com' });
    const agent = await loginAgent(app, 'luc@example.com');
    await agent.delete('/api/auth/me').expect(204);
    expect(bookingClient.purgeUserBookings).toHaveBeenCalledWith(user.id, undefined);
    expect(await repo.findUserById(user.id)).toBeNull();
    expect(repo.sessions.size).toBe(0);
  });

  test('booking-service indisponible : 503 et le compte est conservé', async () => {
    const { app, repo, bookingClient } = setup();
    const user = await addUser(repo, { email: 'luc@example.com' });
    bookingClient.purgeUserBookings.mockRejectedValue(new UpstreamError('Service de réservation injoignable'));
    const agent = await loginAgent(app, 'luc@example.com');
    const res = await agent.delete('/api/auth/me').expect(503);
    expect(res.body.error).toMatch(/injoignable/);
    expect(await repo.findUserById(user.id)).not.toBeNull();
  });

  test('un admin ne peut pas supprimer son propre compte', async () => {
    const { app, repo } = setup();
    await addUser(repo, { email: 'admin@example.com', role: 'admin' });
    const agent = await loginAgent(app, 'admin@example.com');
    await agent.delete('/api/auth/me').expect(403);
  });
});

describe('administration des comptes', () => {
  test('un utilisateur standard n\'a pas accès à la liste des comptes', async () => {
    const { app, repo } = setup();
    await addUser(repo, { email: 'luc@example.com' });
    const agent = await loginAgent(app, 'luc@example.com');
    await agent.get('/api/auth/users').expect(403);
  });

  test('un admin liste les comptes sans les hash de mot de passe', async () => {
    const { app, repo } = setup();
    await addUser(repo, { email: 'admin@example.com', role: 'admin' });
    await addUser(repo, { email: 'luc@example.com' });
    const agent = await loginAgent(app, 'admin@example.com');
    const res = await agent.get('/api/auth/users').expect(200);
    expect(res.body.users).toHaveLength(2);
    expect(JSON.stringify(res.body)).not.toMatch(/password/);
  });

  test('un admin supprime un compte standard (et ses réservations)', async () => {
    const { app, repo, bookingClient } = setup();
    await addUser(repo, { email: 'admin@example.com', role: 'admin' });
    const luc = await addUser(repo, { email: 'luc@example.com' });
    const agent = await loginAgent(app, 'admin@example.com');
    await agent.delete(`/api/auth/users/${luc.id}`).set('X-Request-Id', 'req-42').expect(204);
    expect(bookingClient.purgeUserBookings).toHaveBeenCalledWith(luc.id, 'req-42');
    expect(await repo.findUserById(luc.id)).toBeNull();
  });

  test('un admin ne peut pas supprimer un autre admin (403)', async () => {
    const { app, repo, bookingClient } = setup();
    await addUser(repo, { email: 'admin@example.com', role: 'admin' });
    const other = await addUser(repo, { email: 'admin2@example.com', role: 'admin' });
    const agent = await loginAgent(app, 'admin@example.com');
    await agent.delete(`/api/auth/users/${other.id}`).expect(403);
    expect(bookingClient.purgeUserBookings).not.toHaveBeenCalled();
    expect(await repo.findUserById(other.id)).not.toBeNull();
  });

  test('404 sur un compte inexistant, 400 sur un identifiant invalide', async () => {
    const { app, repo } = setup();
    await addUser(repo, { email: 'admin@example.com', role: 'admin' });
    const agent = await loginAgent(app, 'admin@example.com');
    await agent.delete('/api/auth/users/999').expect(404);
    await agent.delete('/api/auth/users/abc').expect(400);
  });
});

describe('divers', () => {
  test('route inconnue : 404 JSON', async () => {
    const { app } = setup();
    const res = await request(app).get('/nope').expect(404);
    expect(res.body.error).toBeDefined();
  });

  test('erreur inattendue : 500 sans fuite de détail', async () => {
    const { app, repo } = setup();
    repo.findUserByEmail = async () => { throw new Error('connexion perdue'); };
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.fr', password: 'x' }).expect(500);
    expect(res.body.error).toBe('Erreur interne');
  });

  test('pas d\'en-tête X-Powered-By', async () => {
    const { app } = setup();
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
