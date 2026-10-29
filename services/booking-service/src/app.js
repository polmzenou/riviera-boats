const crypto = require('node:crypto');
const express = require('express');
const { requestLogger } = require('./logger');
const { parseIsoDate, daysBetween, todayIso } = require('./dates');
const { validateCard, simulatePayment } = require('./payment');

const toDto = (b) => ({
  id: b.id,
  userId: b.user_id,
  boatId: b.boat_id,
  boatName: b.boat_name,
  portName: b.port_name,
  startDate: b.start_date,
  endDate: b.end_date,
  days: daysBetween(parseIsoDate(b.start_date), parseIsoDate(b.end_date)) + 1,
  totalPrice: Number(b.total_price),
  status: b.status,
  paymentRef: b.payment_ref,
  cardLast4: b.card_last4,
  createdAt: b.created_at,
  paidAt: b.paid_at,
});

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// comparaison à temps constant
function safeEqual(received, expected) {
  const a = Buffer.from(String(received ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// l'identité arrive de nginx dans X-User-Id / X-User-Role
function createApp({ repo, boatClient, config, logger, today = () => todayIso() }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use(requestLogger(logger));

  app.get('/health', async (_req, res) => {
    try {
      await repo.ping();
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'db-unavailable' });
    }
  });

  // appelée par auth-service quand un compte est supprimé
  app.delete('/internal/users/:userId/bookings', async (req, res) => {
    if (!safeEqual(req.get('x-internal-token'), config.internalToken)) {
      return res.status(401).json({ error: 'Jeton interne invalide' });
    }
    const userId = parseId(req.params.userId);
    if (!userId) return res.status(400).json({ error: 'Identifiant invalide' });
    const deleted = await repo.deleteByUser(userId);
    logger.info('Réservations purgées', { userId, deleted });
    return res.json({ deleted });
  });

  const api = express.Router();

  api.use((req, res, next) => {
    const id = parseId(req.get('x-user-id'));
    if (!id) return res.status(401).json({ error: 'Authentification requise' });
    req.user = { id, isAdmin: req.get('x-user-role') === 'admin' };
    return next();
  });

  // la réservation d'un autre client renvoie 404
  async function findVisible(req, { ownerOnly = false } = {}) {
    const id = parseId(req.params.id);
    const booking = id ? await repo.findById(id) : null;
    if (!booking) return null;
    if (booking.user_id === req.user.id) return booking;
    return req.user.isAdmin && !ownerOnly ? booking : null;
  }

  api.get('/', async (req, res) => {
    const all = req.user.isAdmin && req.query.scope === 'all';
    const rows = all ? await repo.listAll() : await repo.listByUser(req.user.id);
    res.json({ bookings: rows.map(toDto) });
  });

  api.get('/availability/:boatId', async (req, res) => {
    const boatId = parseId(req.params.boatId);
    if (!boatId) return res.status(400).json({ error: 'Bateau invalide' });
    const rows = await repo.listBookedRanges(boatId, today());
    return res.json({ boatId, booked: rows.map((r) => ({ startDate: r.start_date, endDate: r.end_date })) });
  });

  api.post('/', async (req, res) => {
    const { boatId, startDate, endDate } = req.body ?? {};
    const id = parseId(boatId);
    if (!id) return res.status(400).json({ error: 'Bateau invalide' });

    const start = parseIsoDate(startDate);
    const end = parseIsoDate(endDate);
    const now = parseIsoDate(today());
    if (!start || !end) return res.status(400).json({ error: 'Dates invalides (format AAAA-MM-JJ)' });
    if (start < now) return res.status(400).json({ error: 'La date de début est déjà passée' });
    if (end < start) return res.status(400).json({ error: 'La date de fin doit suivre la date de début' });
    const days = daysBetween(start, end) + 1;
    if (days > config.maxDays) return res.status(400).json({ error: `Durée maximale : ${config.maxDays} jours` });
    if (daysBetween(now, start) > config.maxAdvanceDays) {
      return res.status(400).json({ error: 'Réservation trop lointaine' });
    }

    const boat = await boatClient.getBoat(id, req.get('x-request-id'));
    if (!boat) return res.status(404).json({ error: 'Bateau introuvable' });

    const conflict = { error: 'Ce bateau est déjà réservé sur tout ou partie de ces dates' };
    if (await repo.findActiveOverlap(id, startDate, endDate)) return res.status(409).json(conflict);

    const booking = await repo.create({
      userId: req.user.id,
      boatId: id,
      boatName: boat.name,
      portName: boat.port.name,
      startDate,
      endDate,
      totalPrice: Math.round(days * boat.pricePerDay * 100) / 100,
    });
    if (!booking) return res.status(409).json(conflict);

    logger.info('Réservation créée', { bookingId: booking.id, userId: req.user.id, boatId: id });
    return res.status(201).location(`/api/bookings/${booking.id}`).json({ booking: toDto(booking) });
  });

  api.get('/:id', async (req, res) => {
    const booking = await findVisible(req);
    if (!booking) return res.status(404).json({ error: 'Réservation introuvable' });
    return res.json({ booking: toDto(booking) });
  });

  api.post('/:id/pay', async (req, res) => {
    const booking = await findVisible(req, { ownerOnly: true });
    if (!booking) return res.status(404).json({ error: 'Réservation introuvable' });
    if (booking.status !== 'pending') {
      return res.status(409).json({ error: booking.status === 'paid' ? 'Réservation déjà payée' : 'Réservation annulée' });
    }

    const card = validateCard(req.body ?? {});
    if (card.error) return res.status(400).json({ error: card.error });

    const payment = simulatePayment(card.digits);
    if (!payment.approved) {
      logger.info('Paiement refusé', { bookingId: booking.id });
      return res.status(402).json({ error: 'Paiement refusé par la banque' });
    }

    const paid = await repo.markPaid(booking.id, payment.reference, card.last4);
    if (!paid) return res.status(409).json({ error: 'La réservation a changé entre-temps, rechargez la page' });
    logger.info('Paiement accepté', { bookingId: booking.id, paymentRef: payment.reference });
    return res.json({ booking: toDto(paid) });
  });

  api.post('/:id/cancel', async (req, res) => {
    const booking = await findVisible(req);
    if (!booking) return res.status(404).json({ error: 'Réservation introuvable' });
    if (booking.status === 'cancelled') return res.status(409).json({ error: 'Réservation déjà annulée' });
    if (booking.start_date <= today() && !req.user.isAdmin) {
      return res.status(409).json({ error: 'Impossible d\'annuler une location déjà commencée' });
    }

    const wasPaid = booking.status === 'paid';
    const cancelled = await repo.cancel(booking.id);
    logger.info('Réservation annulée', { bookingId: booking.id, by: req.user.id, refunded: wasPaid });
    return res.json({ booking: toDto(cancelled), refunded: wasPaid });
  });

  app.use('/api/bookings', api);

  app.use((_req, res) => res.status(404).json({ error: 'Route inconnue' }));

  app.use((err, req, res, _next) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) logger.error(err.message, { requestId: req.get('x-request-id'), stack: err.stack });
    res.status(status).json({ error: err.expose ? err.message : 'Erreur interne' });
  });

  return app;
}

module.exports = { createApp, toDto };
