// version en mémoire de src/repository.js
function createFakeRepository() {
  const users = [];
  const sessions = new Map(); // tokenHash -> { userId, expiresAt }
  let nextId = 1;

  return {
    users,
    sessions,
    failPing: false,

    async ping() {
      if (this.failPing) throw new Error('db down');
    },
    async createUser({ email, passwordHash, fullName, role }) {
      if (users.some((u) => u.email === email)) return null;
      const user = { id: nextId++, email, password_hash: passwordHash, full_name: fullName, role, created_at: new Date() };
      users.push(user);
      return user;
    },
    async findUserByEmail(email) {
      return users.find((u) => u.email === email) ?? null;
    },
    async findUserById(id) {
      return users.find((u) => u.id === id) ?? null;
    },
    async listUsers() {
      return [...users];
    },
    async deleteUser(id) {
      const i = users.findIndex((u) => u.id === id);
      if (i === -1) return 0;
      users.splice(i, 1);
      for (const [hash, s] of sessions) if (s.userId === id) sessions.delete(hash);
      return 1;
    },
    async createSession(tokenHash, userId, expiresAt) {
      sessions.set(tokenHash, { userId, expiresAt });
    },
    async findUserBySessionHash(tokenHash) {
      const s = sessions.get(tokenHash);
      if (!s || s.expiresAt <= new Date()) return null;
      return users.find((u) => u.id === s.userId) ?? null;
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
    async deleteExpiredSessions() {
      let n = 0;
      for (const [hash, s] of sessions) {
        if (s.expiresAt <= new Date()) {
          sessions.delete(hash);
          n += 1;
        }
      }
      return n;
    },
  };
}

module.exports = { createFakeRepository };
