const request = require('supertest');
const { createApp } = require('../src/app');
const { createLogger } = require('../src/logger');
const { UpstreamError } = require('../src/boatClient');
const { createFakeRepository } = require('./fakeRepository');

const TODAY = '2026-10-29';
const config = { internalToken: 'tok-interne', maxDays: 14, maxAdvanceDays: 365 };
const BOAT = { id: 3, name: 'Croisette', pricePerDay: 1450, port: { id: 2, name: 'Vieux-Port de Cannes', city: 'Cannes' } };
const VALID_CARD = { cardNumber: '4242 4242 4242 4242', expiry: '12/30', cvc: '123', holder: 'Marie Dupont' };

function setup() {
  const repo = createFakeRepository();
  const boatClient = { getBoat: jest.fn(async (id) => (id === BOAT.id ? BOAT : null)) };
  const app = createApp({ repo, boatClient, config, logger: createLogger('test', 'silent'), today: () => TODAY });
  return { repo, boatClient, app };
}

// en-têtes posés par nginx
const as = (req, userId, role = 'user') => req.set('X-User-Id', String(userId)).set('X-User-Role', role);

function book(app, userId, body = {}) {
  return as(request(app).post('/api/bookings'), userId)
    .send({ boatId: BOAT.id, startDate: '2026-11-02', endDate: '2026-11-04', ...body });
}

describe('santé et identité', () => {
  test('GET /health', async () => {
    const { app, repo } = setup();
    await request(app).get('/health').expect(200);
    repo.failPing = true;
    await request(app).get('/health').expect(503);
  });

  test('sans X-User-Id (requête qui n\'est pas passée par Nginx) : 401', async () => {
    const { app } = setup();
    await request(app).get('/api/bookings').expect(401);
    await request(app).get('/api/bookings').set('X-User-Id', 'abc').expect(401);
  });
});

describe('création de réservation', () => {
  test('calcule le prix à partir du catalogue (3 jours x 1450 €)', async () => {
    const { app, boatClient } = setup();
    const res = await book(app, 1).set('X-Request-Id', 'req-1').expect(201);
    expect(res.headers.location).toBe(`/api/bookings/${res.body.booking.id}`);
    expect(res.body.booking).toMatchObject({
      boatName: 'Croisette', portName: 'Vieux-Port de Cannes', days: 3, totalPrice: 4350, status: 'pending', userId: 1,
    });
    expect(boatClient.getBoat).toHaveBeenCalledWith(3, 'req-1');
  });

  test('ignore un prix envoyé par le client', async () => {
    const { app } = setup();
    const res = await book(app, 1, { totalPrice: 1 }).expect(201);
    expect(res.body.booking.totalPrice).toBe(4350);
  });

  test.each([
    [{ boatId: 'x' }, /Bateau invalide/],
    [{ startDate: '02/11/2026' }, /format/],
    [{ startDate: '2026-02-30', endDate: '2026-03-01' }, /format/],
    [{ startDate: '2026-10-28', endDate: '2026-10-30' }, /passée/],
    [{ startDate: '2026-11-05', endDate: '2026-11-04' }, /suivre/],
    [{ startDate: '2026-11-01', endDate: '2026-11-20' }, /14 jours/],
    [{ startDate: '2028-01-01', endDate: '2028-01-02' }, /lointaine/],
  ])('refuse une demande invalide %#', async (body, message) => {
    const { app } = setup();
    const res = await book(app, 1, body).expect(400);
    expect(res.body.error).toMatch(message);
  });

  test('réserver aujourd\'hui même est accepté', async () => {
    const { app } = setup();
    await book(app, 1, { startDate: TODAY, endDate: TODAY }).expect(201);
  });

  test('bateau inconnu du catalogue : 404', async () => {
    const { app } = setup();
    await book(app, 1, { boatId: 99 }).expect(404);
  });

  test('catalogue indisponible : 503', async () => {
    const { app, boatClient } = setup();
    boatClient.getBoat.mockRejectedValue(new UpstreamError('Catalogue des bateaux injoignable'));
    const res = await book(app, 1).expect(503);
    expect(res.body.error).toMatch(/injoignable/);
  });

  test('chevauchement de dates : 409', async () => {
    const { app } = setup();
    await book(app, 1).expect(201);
    await book(app, 2, { startDate: '2026-11-04', endDate: '2026-11-06' }).expect(409);
    // Adjacent (le lendemain de la fin) : autorisé
    await book(app, 2, { startDate: '2026-11-05', endDate: '2026-11-06' }).expect(201);
  });

  test('contrainte EXCLUDE de la base (course entre deux requêtes) : 409', async () => {
    const { app, repo } = setup();
    repo.create = async () => null;
    await book(app, 1).expect(409);
  });

  test('une réservation annulée libère les dates', async () => {
    const { app } = setup();
    const first = await book(app, 1).expect(201);
    await as(request(app).post(`/api/bookings/${first.body.booking.id}/cancel`), 1).expect(200);
    await book(app, 2).expect(201);
  });
});

describe('consultation', () => {
  test('chacun ne voit que ses réservations ; l\'admin peut tout voir', async () => {
    const { app } = setup();
    await book(app, 1).expect(201);
    await book(app, 2, { startDate: '2026-12-01', endDate: '2026-12-02' }).expect(201);

    const mine = await as(request(app).get('/api/bookings'), 1).expect(200);
    expect(mine.body.bookings).toHaveLength(1);
    const notAll = await as(request(app).get('/api/bookings?scope=all'), 1).expect(200);
    expect(notAll.body.bookings).toHaveLength(1);
    const all = await as(request(app).get('/api/bookings?scope=all'), 9, 'admin').expect(200);
    expect(all.body.bookings).toHaveLength(2);
  });

  test('la réservation d\'un autre client est invisible (404)', async () => {
    const { app } = setup();
    const res = await book(app, 1).expect(201);
    const id = res.body.booking.id;
    await as(request(app).get(`/api/bookings/${id}`), 1).expect(200);
    await as(request(app).get(`/api/bookings/${id}`), 2).expect(404);
    await as(request(app).get(`/api/bookings/${id}`), 9, 'admin').expect(200);
    await as(request(app).get('/api/bookings/abc'), 1).expect(404);
  });

  test('disponibilités d\'un bateau sans données personnelles', async () => {
    const { app } = setup();
    await book(app, 1).expect(201);
    const res = await as(request(app).get(`/api/bookings/availability/${BOAT.id}`), 2).expect(200);
    expect(res.body).toEqual({ boatId: 3, booked: [{ startDate: '2026-11-02', endDate: '2026-11-04' }] });
    await as(request(app).get('/api/bookings/availability/x'), 2).expect(400);
  });
});

describe('paiement simulé', () => {
  async function pending(app) {
    return (await book(app, 1).expect(201)).body.booking.id;
  }

  test('paiement accepté : statut paid, référence et 4 derniers chiffres', async () => {
    const { app, repo } = setup();
    const id = await pending(app);
    const res = await as(request(app).post(`/api/bookings/${id}/pay`), 1).send(VALID_CARD).expect(200);
    expect(res.body.booking).toMatchObject({ status: 'paid', cardLast4: '4242' });
    expect(res.body.booking.paymentRef).toMatch(/^PAY-[0-9A-F]{10}$/);
    expect(JSON.stringify(repo.rows)).not.toMatch(/4242424242424242/);
  });

  test('carte de test refusée : 402', async () => {
    const { app } = setup();
    const id = await pending(app);
    await as(request(app).post(`/api/bookings/${id}/pay`), 1)
      .send({ ...VALID_CARD, cardNumber: '4000 0000 0000 0002' })
      .expect(402);
  });

  test.each([
    [{ cardNumber: '4242 4242 4242 4241' }, /Numéro/],
    [{ cardNumber: '12' }, /Numéro/],
    [{ expiry: '13/30' }, /expiration/],
    [{ expiry: '1230' }, /expiration/],
    [{ expiry: '01/20' }, /expirée/],
    [{ cvc: '12' }, /Cryptogramme/],
    [{ holder: '' }, /titulaire/],
  ])('carte invalide %# : 400', async (override, message) => {
    const { app } = setup();
    const id = await pending(app);
    const res = await as(request(app).post(`/api/bookings/${id}/pay`), 1).send({ ...VALID_CARD, ...override }).expect(400);
    expect(res.body.error).toMatch(message);
  });

  test('pas de double paiement, pas de paiement d\'une réservation annulée', async () => {
    const { app } = setup();
    const id = await pending(app);
    await as(request(app).post(`/api/bookings/${id}/pay`), 1).send(VALID_CARD).expect(200);
    const again = await as(request(app).post(`/api/bookings/${id}/pay`), 1).send(VALID_CARD).expect(409);
    expect(again.body.error).toMatch(/déjà payée/);

    const id2 = (await book(app, 1, { startDate: '2026-12-01', endDate: '2026-12-01' })).body.booking.id;
    await as(request(app).post(`/api/bookings/${id2}/cancel`), 1).expect(200);
    const res = await as(request(app).post(`/api/bookings/${id2}/pay`), 1).send(VALID_CARD).expect(409);
    expect(res.body.error).toMatch(/annulée/);
  });

  test('on ne paie que ses propres réservations (même un admin)', async () => {
    const { app } = setup();
    const id = await pending(app);
    await as(request(app).post(`/api/bookings/${id}/pay`), 2).send(VALID_CARD).expect(404);
    await as(request(app).post(`/api/bookings/${id}/pay`), 9, 'admin').send(VALID_CARD).expect(404);
  });

  test('statut modifié entre-temps : 409', async () => {
    const { app, repo } = setup();
    const id = await pending(app);
    repo.markPaid = async () => null;
    await as(request(app).post(`/api/bookings/${id}/pay`), 1).send(VALID_CARD).expect(409);
  });
});

describe('annulation', () => {
  test('annuler une réservation payée signale le remboursement', async () => {
    const { app } = setup();
    const id = (await book(app, 1)).body.booking.id;
    await as(request(app).post(`/api/bookings/${id}/pay`), 1).send(VALID_CARD).expect(200);
    const res = await as(request(app).post(`/api/bookings/${id}/cancel`), 1).expect(200);
    expect(res.body).toMatchObject({ refunded: true, booking: { status: 'cancelled' } });
    await as(request(app).post(`/api/bookings/${id}/cancel`), 1).expect(409);
  });

  test('impossible d\'annuler une location déjà commencée (sauf admin)', async () => {
    const { app } = setup();
    const id = (await book(app, 1, { startDate: TODAY, endDate: '2026-10-30' })).body.booking.id;
    await as(request(app).post(`/api/bookings/${id}/cancel`), 1).expect(409);
    await as(request(app).post(`/api/bookings/${id}/cancel`), 9, 'admin').expect(200);
  });

  test('impossible d\'annuler la réservation d\'un autre', async () => {
    const { app } = setup();
    const id = (await book(app, 1)).body.booking.id;
    await as(request(app).post(`/api/bookings/${id}/cancel`), 2).expect(404);
  });
});

describe('purge interne (suppression de compte)', () => {
  test('supprime toutes les réservations du compte avec le bon jeton', async () => {
    const { app, repo } = setup();
    await book(app, 1).expect(201);
    await book(app, 1, { startDate: '2026-12-01', endDate: '2026-12-02' }).expect(201);
    await book(app, 2, { startDate: '2027-01-01', endDate: '2027-01-02' }).expect(201);
    const res = await request(app).delete('/internal/users/1/bookings').set('X-Internal-Token', 'tok-interne').expect(200);
    expect(res.body).toEqual({ deleted: 2 });
    expect(repo.rows).toHaveLength(1);
  });

  test('refuse sans jeton ou avec un mauvais jeton', async () => {
    const { app } = setup();
    await request(app).delete('/internal/users/1/bookings').expect(401);
    await request(app).delete('/internal/users/1/bookings').set('X-Internal-Token', 'tok-interneX').expect(401);
    await request(app).delete('/internal/users/abc/bookings').set('X-Internal-Token', 'tok-interne').expect(400);
  });
});

describe('erreurs', () => {
  test('route inconnue : 404', async () => {
    const { app } = setup();
    await request(app).get('/nope').expect(404);
  });

  test('erreur inattendue : 500 générique', async () => {
    const { app, repo } = setup();
    repo.listByUser = async () => { throw new Error('boom'); };
    const res = await as(request(app).get('/api/bookings'), 1).expect(500);
    expect(res.body.error).toBe('Erreur interne');
  });
});
