// version en mémoire de src/repository.js (dates ISO comparées comme chaînes)
function createFakeRepository() {
  const rows = [];
  let nextId = 1;
  const overlaps = (b, start, end) => b.status !== 'cancelled' && b.start_date <= end && b.end_date >= start;

  return {
    rows,
    failPing: false,
    async ping() {
      if (this.failPing) throw new Error('db down');
    },
    async listByUser(userId) {
      return rows.filter((b) => b.user_id === userId);
    },
    async listAll() {
      return [...rows];
    },
    async findById(id) {
      return rows.find((b) => b.id === id) ?? null;
    },
    async findActiveOverlap(boatId, start, end) {
      return rows.find((b) => b.boat_id === boatId && overlaps(b, start, end)) ?? null;
    },
    async listBookedRanges(boatId, from) {
      return rows.filter((b) => b.boat_id === boatId && b.status !== 'cancelled' && b.end_date >= from);
    },
    async create({ userId, boatId, boatName, portName, startDate, endDate, totalPrice }) {
      const row = {
        id: nextId++, user_id: userId, boat_id: boatId, boat_name: boatName, port_name: portName,
        start_date: startDate, end_date: endDate, total_price: String(totalPrice), status: 'pending',
        payment_ref: null, card_last4: null, created_at: new Date(), paid_at: null,
      };
      rows.push(row);
      return row;
    },
    async markPaid(id, ref, last4) {
      const b = rows.find((r) => r.id === id && r.status === 'pending');
      if (!b) return null;
      Object.assign(b, { status: 'paid', payment_ref: ref, card_last4: last4, paid_at: new Date() });
      return b;
    },
    async cancel(id) {
      const b = rows.find((r) => r.id === id && r.status !== 'cancelled');
      if (!b) return null;
      b.status = 'cancelled';
      return b;
    },
    async deleteByUser(userId) {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].user_id === userId) rows.splice(i, 1);
      return before - rows.length;
    },
  };
}

module.exports = { createFakeRepository };
