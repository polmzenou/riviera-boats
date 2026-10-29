const crypto = require('node:crypto');

// paiement simulé, cette carte de test est toujours refusée
const DECLINED_CARD = '4000000000000002';

// clé de Luhn
function luhnValid(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function validateCard({ cardNumber, expiry, cvc, holder }, now = new Date()) {
  const digits = String(cardNumber ?? '').replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits) || !luhnValid(digits)) return { error: 'Numéro de carte invalide' };

  const match = /^(\d{2})\/(\d{2})$/.exec(String(expiry ?? '').trim());
  const month = match ? Number(match[1]) : 0;
  if (!match || month < 1 || month > 12) return { error: 'Date d\'expiration invalide (MM/AA)' };
  const year = 2000 + Number(match[2]);
  // valable jusqu'à la fin du mois d'expiration
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
    return { error: 'Carte expirée' };
  }

  if (!/^\d{3,4}$/.test(String(cvc ?? ''))) return { error: 'Cryptogramme invalide' };
  if (typeof holder !== 'string' || holder.trim().length < 2) return { error: 'Nom du titulaire requis' };

  return { digits, last4: digits.slice(-4) };
}

function simulatePayment(digits) {
  if (digits === DECLINED_CARD) return { approved: false };
  return { approved: true, reference: `PAY-${crypto.randomBytes(5).toString('hex').toUpperCase()}` };
}

module.exports = { luhnValid, validateCard, simulatePayment, DECLINED_CARD };
