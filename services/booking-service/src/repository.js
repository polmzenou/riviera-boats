const { types } = require('pg');

// DATE gardée en chaîne AAAA-MM-JJ (sinon Date locale et décalage de fuseau)
types.setTypeParser(types.builtins.DATE, (value) => value);

// exclusion_violation
const EXCLUSION_VIOLATION = '23P01';

function createRepository(pool) {
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null;
  const many = async (sql, params) => (await pool.query(sql, params)).rows;

  return {
    ping: () => pool.query('SELECT 1'),

    listByUser: (userId) => many(
      'SELECT * FROM bookings.bookings WHERE user_id = $1 ORDER BY start_date DESC, id DESC',
      [userId],
    ),

    listAll: () => many('SELECT * FROM bookings.bookings ORDER BY start_date DESC, id DESC'),

    findById: (id) => one('SELECT * FROM bookings.bookings WHERE id = $1', [id]),

    findActiveOverlap: (boatId, startDate, endDate) => one(
      `SELECT id FROM bookings.bookings
       WHERE boat_id = $1 AND status <> 'cancelled'
         AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]')
       LIMIT 1`,
      [boatId, startDate, endDate],
    ),

    listBookedRanges: (boatId, fromDate) => many(
      `SELECT start_date, end_date FROM bookings.bookings
       WHERE boat_id = $1 AND status <> 'cancelled' AND end_date >= $2
       ORDER BY start_date`,
      [boatId, fromDate],
    ),

    // null si la contrainte EXCLUDE refuse (deux réservations simultanées)
    async create({ userId, boatId, boatName, portName, startDate, endDate, totalPrice }) {
      try {
        return await one(
          `INSERT INTO bookings.bookings (user_id, boat_id, boat_name, port_name, start_date, end_date, total_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [userId, boatId, boatName, portName, startDate, endDate, totalPrice],
        );
      } catch (err) {
        if (err.code === EXCLUSION_VIOLATION) return null;
        throw err;
      }
    },

    markPaid: (id, paymentRef, cardLast4) => one(
      `UPDATE bookings.bookings
       SET status = 'paid', payment_ref = $2, card_last4 = $3, paid_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id, paymentRef, cardLast4],
    ),

    cancel: (id) => one(
      `UPDATE bookings.bookings SET status = 'cancelled'
       WHERE id = $1 AND status <> 'cancelled'
       RETURNING *`,
      [id],
    ),

    deleteByUser: async (userId) => (await pool.query('DELETE FROM bookings.bookings WHERE user_id = $1', [userId])).rowCount,
  };
}

module.exports = { createRepository, EXCLUSION_VIOLATION };
