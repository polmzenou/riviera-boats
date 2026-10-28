function createRepository(pool) {
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null;

  return {
    ping: () => pool.query('SELECT 1'),

    // null si l'email existe déjà
    createUser: ({ email, passwordHash, fullName, role }) => one(
      `INSERT INTO auth.users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING *`,
      [email, passwordHash, fullName, role],
    ),

    findUserByEmail: (email) => one('SELECT * FROM auth.users WHERE email = $1', [email]),

    findUserById: (id) => one('SELECT * FROM auth.users WHERE id = $1', [id]),

    listUsers: async () => (await pool.query('SELECT * FROM auth.users ORDER BY id')).rows,

    deleteUser: async (id) => (await pool.query('DELETE FROM auth.users WHERE id = $1', [id])).rowCount,

    createSession: (tokenHash, userId, expiresAt) => pool.query(
      'INSERT INTO auth.sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [tokenHash, userId, expiresAt],
    ),

    findUserBySessionHash: (tokenHash) => one(
      `SELECT u.* FROM auth.sessions s
       JOIN auth.users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash],
    ),

    deleteSession: (tokenHash) => pool.query('DELETE FROM auth.sessions WHERE token_hash = $1', [tokenHash]),

    deleteExpiredSessions: async () => (await pool.query('DELETE FROM auth.sessions WHERE expires_at <= now()')).rowCount,
  };
}

module.exports = { createRepository };
