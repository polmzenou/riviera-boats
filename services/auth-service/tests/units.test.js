const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, readSecret } = require('../src/config');
const { createBookingClient } = require('../src/bookingClient');
const { createRepository } = require('../src/repository');

describe('configuration', () => {
  test('lit un secret depuis un fichier *_FILE (convention Docker secrets)', () => {
    const file = path.join(os.tmpdir(), `secret-${process.pid}.txt`);
    fs.writeFileSync(file, 's3cr3t\r\n');
    expect(readSecret('DB_PASSWORD', { DB_PASSWORD_FILE: file })).toBe('s3cr3t');
    fs.unlinkSync(file);
  });

  test('se rabat sur la variable, puis sur la valeur par défaut, sinon échoue', () => {
    expect(readSecret('X', { X: 'direct' })).toBe('direct');
    expect(readSecret('X', {}, null)).toBeNull();
    expect(() => readSecret('X', {})).toThrow(/X_FILE/);
  });

  test('valeurs par défaut', () => {
    const config = loadConfig({ DB_PASSWORD: 'pw', INTERNAL_TOKEN: 'tok', COOKIE_SECURE: 'true' });
    expect(config.port).toBe(3000);
    expect(config.cookieSecure).toBe(true);
    expect(config.db.user).toBe('auth_svc');
    expect(config.admin.password).toBeNull();
  });
});

describe('client booking-service', () => {
  afterEach(() => jest.restoreAllMocks());

  test('appelle la route interne avec le jeton partagé', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ deleted: 3 }) });
    const client = createBookingClient({ baseUrl: 'http://booking:3001', internalToken: 'tok' });
    await expect(client.purgeUserBookings(7, 'req-1')).resolves.toEqual({ deleted: 3 });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://booking:3001/internal/users/7/bookings');
    expect(opts.method).toBe('DELETE');
    expect(opts.headers).toEqual({ 'X-Internal-Token': 'tok', 'X-Request-Id': 'req-1' });
  });

  test('erreur réseau ou HTTP -> UpstreamError (503)', async () => {
    const client = createBookingClient({ baseUrl: 'http://booking:3001', internalToken: 'tok' });
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(client.purgeUserBookings(7)).rejects.toMatchObject({ status: 503 });
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(client.purgeUserBookings(7)).rejects.toThrow(/401/);
  });
});

describe('dépôt PostgreSQL', () => {
  test('requêtes paramétrées, qualifiées par le schéma auth', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 }) };
    const repo = createRepository(pool);
    await expect(repo.findUserByEmail('a@b.fr')).resolves.toEqual({ id: 1 });
    await expect(repo.deleteUser(1)).resolves.toBe(1);
    await repo.createUser({ email: 'a@b.fr', passwordHash: 'h', fullName: 'A', role: 'user' });
    await repo.findUserById(1);
    await repo.listUsers();
    await repo.createSession('hash', 1, new Date());
    await repo.findUserBySessionHash('hash');
    await repo.deleteSession('hash');
    await repo.deleteExpiredSessions();
    await repo.ping();
    for (const [sql, params] of pool.query.mock.calls) {
      if (sql.includes('$1')) expect(params).toBeDefined();
      expect(sql).not.toMatch(/a@b\.fr|hash'/);
      if (sql !== 'SELECT 1') expect(sql).toMatch(/auth\./);
    }
  });

  test('createUser renvoie null en cas de conflit sur l\'email', async () => {
    const repo = createRepository({ query: jest.fn().mockResolvedValue({ rows: [] }) });
    await expect(repo.createUser({ email: 'a@b.fr' })).resolves.toBeNull();
  });
});
