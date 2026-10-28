class UpstreamError extends Error {
  constructor(message) {
    super(message);
    this.status = 503;
    this.expose = true;
  }
}

function createBookingClient({ baseUrl, internalToken, timeoutMs = 3000 }) {
  return {
    async purgeUserBookings(userId, requestId) {
      let res;
      try {
        res = await fetch(`${baseUrl}/internal/users/${userId}/bookings`, {
          method: 'DELETE',
          headers: {
            'X-Internal-Token': internalToken,
            ...(requestId && { 'X-Request-Id': requestId }),
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new UpstreamError('Service de réservation injoignable, réessayez plus tard');
      }
      if (!res.ok) {
        throw new UpstreamError(`Purge des réservations refusée (HTTP ${res.status})`);
      }
      return res.json();
    },
  };
}

module.exports = { createBookingClient, UpstreamError };
