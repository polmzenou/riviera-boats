import { api, h, euro, frDate, todayIso, toast, STATUS_LABEL } from './api.js';
import { initLayout } from './layout.js';

await initLayout();

const list = document.getElementById('booking-list');
const dialog = document.getElementById('pay-dialog');
const payForm = document.getElementById('pay-form');
const payError = payForm.querySelector('.form-error');
let bookings = [];
let paying = null;

function bookingCard(b) {
  const canCancel = b.status !== 'cancelled' && b.startDate > todayIso();
  return h('article', { class: 'card booking' },
    h('div', {},
      h('h3', {}, b.boatName, ' ', h('span', { class: `status status-${b.status}` }, STATUS_LABEL[b.status])),
      h('p', { class: 'meta' }, `${b.portName} · du ${frDate(b.startDate)} au ${frDate(b.endDate)} · ${b.days} jour${b.days > 1 ? 's' : ''}`),
      h('p', { class: 'meta' },
        h('strong', {}, euro(b.totalPrice)),
        b.paymentRef ? ` · réglé par carte •••• ${b.cardLast4} · réf. ${b.paymentRef}` : '')),
    h('div', { class: 'actions-cell' },
      b.status === 'pending' ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openPayment(b) }, 'Payer') : null,
      canCancel ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => cancel(b) }, 'Annuler') : null));
}

async function load() {
  try {
    ({ bookings } = await api('/api/bookings'));
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  list.replaceChildren(...(bookings.length
    ? bookings.map(bookingCard)
    : [h('div', { class: 'card empty' }, 'Aucune réservation pour le moment. ', h('a', { href: '/boats.html' }, 'Découvrir la flotte'))]));
}

async function cancel(b) {
  if (!window.confirm(`Annuler la réservation de « ${b.boatName} » du ${frDate(b.startDate)} ?`)) return;
  try {
    const { refunded } = await api(`/api/bookings/${b.id}/cancel`, { method: 'POST' });
    toast(refunded ? 'Réservation annulée — remboursement effectué.' : 'Réservation annulée.', 'success');
    await load();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openPayment(b) {
  paying = b;
  payForm.reset();
  payError.textContent = '';
  document.getElementById('pay-summary').replaceChildren(
    h('strong', {}, b.boatName), ` — du ${frDate(b.startDate)} au ${frDate(b.endDate)} · `, h('strong', {}, euro(b.totalPrice)),
  );
  dialog.showModal();
}

// 4242424242424242 -> 4242 4242 4242 4242, 1230 -> 12/30
const numberInput = document.getElementById('p-number');
numberInput.addEventListener('input', () => {
  numberInput.value = numberInput.value.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
});
const expiryInput = document.getElementById('p-expiry');
expiryInput.addEventListener('input', () => {
  const digits = expiryInput.value.replace(/\D/g, '').slice(0, 4);
  expiryInput.value = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
});

document.getElementById('pay-close').addEventListener('click', () => dialog.close());

payForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  payError.textContent = '';
  const button = payForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const { booking } = await api(`/api/bookings/${paying.id}/pay`, { method: 'POST', body: Object.fromEntries(new FormData(payForm)) });
    dialog.close();
    toast(`Paiement accepté — référence ${booking.paymentRef}`, 'success');
    await load();
  } catch (err) {
    payError.textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

await load();

// ?pay=ID : ouverture directe du paiement
const toPay = Number(new URLSearchParams(window.location.search).get('pay'));
if (toPay) {
  window.history.replaceState(null, '', window.location.pathname);
  const target = bookings.find((b) => b.id === toPay && b.status === 'pending');
  if (target) openPayment(target);
}
