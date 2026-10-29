class UpstreamError extends Error {
  constructor(message) {
    super(message);
    this.status = 503;
    this.expose = true;
  }
}

function createBoatClient({ baseUrl, timeoutMs = 3000 }) {
  return {
    async getBoat(boatId, requestId) {
      let res;
      try {
        res = await fetch(`${baseUrl}/api/boats/${boatId}`, {
          headers: requestId ? { 'X-Request-Id': requestId } : {},
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new UpstreamError('Catalogue des bateaux injoignable, réessayez plus tard');
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new UpstreamError(`Catalogue des bateaux en erreur (HTTP ${res.status})`);
      return res.json();
    },
  };
}

module.exports = { createBoatClient, UpstreamError };
