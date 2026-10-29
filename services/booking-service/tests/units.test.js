const { parseIsoDate, daysBetween, todayIso } = require('../src/dates');
const { luhnValid, validateCard } = require('../src/payment');
const { createBoatClient } = require('../src/boatClient');
const { createRepository, EXCLUSION_VIOLATION } = require('../src/repository');
const { loadConfig } = require('../src/config');

describe('dates', () => {
  test('parse et rejette les dates impossibles', () => {
    expect(parseIsoDate('2026-10-29')).toEqual(new Date('2026-10-29T00:00:00Z'));
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate(20261029)).toBeNull();
  });

  test('nombre de jours, y compris au passage à l\'heure d\'hiver', () => {
    expect(daysBetween(parseIsoDate('2026-10-24'), parseIsoDate('2026-10-26'))).toBe(2);
  });

  test('todayIso formate la date locale', () => {
    expect(todayIso(new Date(2026, 0, 5, 10))).toBe('2026-01-05');
  });
});

describe('carte bancaire', () => {
  test('algorithme de Luhn', () => {
    expect(luhnValid('4242424242424242')).toBe(true);
    expect(luhnValid('4242424242424241')).toBe(false);
  });

  test('une carte expirant ce mois-ci est encore valable', () => {
    const now = new Date(2026, 9, 29);
    const card = { cardNumber: '4242424242424242', cvc: '123', holder: 'A B' };
    expect(validateCard({ ...card, expiry: '10/26' }, now)).toMatchObject({ last4: '4242' });
    expect(validateCard({ ...card, expiry: '09/26' }, now)).toEqual({ error: 'Carte expirée' });
  });
});

describe('client boat-service', () => {
  afterEach(() => jest.restoreAllMocks());
  const client = createBoatClient({ baseUrl: 'http://boat:8000' });

  test('renvoie le bateau, null si 404', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 1 }) })
      .mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(client.getBoat(1, 'req')).resolves.toEqual({ id: 1 });
    expect(fetchMock.mock.calls[0][0]).toBe('http://boat:8000/api/boats/1');
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'X-Request-Id': 'req' });
    await expect(client.getBoat(2)).resolves.toBeNull();
  });

  test('erreur réseau ou 5xx : 503', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(client.getBoat(1)).rejects.toMatchObject({ status: 503 });
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(client.getBoat(1)).rejects.toThrow(/500/);
  });
});

describe('dépôt PostgreSQL', () => {
  test('requêtes paramétrées sur le schéma bookings', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 }) };
    const repo = createRepository(pool);
    await repo.ping();
    await repo.listByUser(1);
    await repo.listAll();
    await repo.findById(1);
    await repo.findActiveOverlap(1, '2026-11-01', '2026-11-02');
    await repo.listBookedRanges(1, '2026-11-01');
    await expect(repo.create({ userId: 1 })).resolves.toEqual({ id: 1 });
    await repo.markPaid(1, 'PAY', '4242');
    await repo.cancel(1);
    await expect(repo.deleteByUser(1)).resolves.toBe(1);
    for (const [sql] of pool.query.mock.calls.slice(1)) expect(sql).toMatch(/bookings\.bookings/);
  });

  test('create : violation de la contrainte EXCLUDE -> null, autre erreur relancée', async () => {
    const conflict = Object.assign(new Error('conflict'), { code: EXCLUSION_VIOLATION });
    const pool = { query: jest.fn().mockRejectedValueOnce(conflict).mockRejectedValueOnce(new Error('boom')) };
    const repo = createRepository(pool);
    await expect(repo.create({})).resolves.toBeNull();
    await expect(repo.create({})).rejects.toThrow('boom');
  });
});

describe('configuration', () => {
  test('valeurs par défaut', () => {
    const config = loadConfig({ DB_PASSWORD: 'pw', INTERNAL_TOKEN: 't' });
    expect(config).toMatchObject({ port: 3001, maxDays: 14, boatServiceUrl: 'http://boat-service:8000' });
    expect(() => loadConfig({})).toThrow(/DB_PASSWORD/);
  });
});
