import { api, h, euro, frDate, dateParts, todayIso, toast, STATUS_LABEL } from './api.js';
import { initLayout } from './layout.js';
import { confirmDialog, countUp, reveal } from './ui.js';

await initLayout();

const list = document.getElementById('booking-list');
const dialog = document.getElementById('pay-dialog');
const payForm = document.getElementById('pay-form');
const payError = payForm.querySelector('.form-error');
let bookings = [];
let paying = null;

function bookingCard(b) {
  const canCancel = b.status !== 'cancelled' && b.startDate > todayIso();
  const { day, month } = dateParts(b.startDate);
  return h('article', { class: `card booking is-${b.status} reveal` },
    h('div', { class: 'date-tile', 'aria-hidden': 'true' }, h('span', { class: 'd' }, day), h('span', { class: 'm' }, month)),
    h('div', {},
      h('h3', {}, b.boatName, h('span', { class: `status status-${b.status}` }, STATUS_LABEL[b.status])),
      h('p', { class: 'meta' }, `${b.portName} · du ${frDate(b.startDate)} au ${frDate(b.endDate)} · ${b.days} jour${b.days > 1 ? 's' : ''}`),
      h('p', { class: 'meta' },
        h('span', { class: 'total' }, euro(b.totalPrice)),
        b.paymentRef ? ` · carte •••• ${b.cardLast4} · réf. ${b.paymentRef}` : '')),
    h('div', { class: 'actions-cell' },
      b.status === 'pending' ? h('button', { class: 'btn btn-gold btn-sm', type: 'button', onclick: () => openPayment(b) }, 'Payer') : null,
      canCancel ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => cancel(b) }, 'Annuler') : null));
}

function renderStats() {
  const active = bookings.filter((b) => b.status !== 'cancelled');
  const values = {
    'st-upcoming': [active.filter((b) => b.endDate >= todayIso()).length],
    'st-pending': [bookings.filter((b) => b.status === 'pending').length],
    'st-paid': [bookings.filter((b) => b.status === 'paid').reduce((sum, b) => sum + b.totalPrice, 0), (n) => euro(Math.round(n))],
  };
  for (const [id, [value, format]] of Object.entries(values)) countUp(document.getElementById(id), value, format);
}

async function load() {
  try {
    ({ bookings } = await api('/api/bookings'));
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  renderStats();
  list.replaceChildren(...(bookings.length
    ? bookings.map(bookingCard)
    : [h('div', { class: 'empty' }, h('strong', {}, 'Aucune réservation pour le moment'), 'Votre prochaine sortie en mer commence ici. ', h('a', { href: '/boats.html' }, 'Découvrir la flotte'))]));
  reveal(list);
}

async function cancel(b) {
  const confirmed = await confirmDialog({
    title: 'Annuler cette réservation ?',
    message: `« ${b.boatName} », du ${frDate(b.startDate)} au ${frDate(b.endDate)}.${b.status === 'paid' ? ' Le montant vous sera remboursé.' : ''}`,
    confirmLabel: 'Annuler la réservation',
    danger: true,
  });
  if (!confirmed) return;
  try {
    const { refunded } = await api(`/api/bookings/${b.id}/cancel`, { method: 'POST' });
    toast(refunded ? 'Réservation annulée, remboursement effectué.' : 'Réservation annulée.', 'success');
    await load();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// aperçu de la carte bancaire mis à jour pendant la saisie
const numberInput = document.getElementById('p-number');
const holderInput = document.getElementById('p-holder');
const expiryInput = document.getElementById('p-expiry');
const cvcInput = document.getElementById('p-cvc');
const card = document.getElementById('cc');
const scene = document.getElementById('cc-scene');

function renderCard() {
  const digits = numberInput.value.replace(/\D/g, '');
  document.getElementById('cc-number').textContent = (digits + '•'.repeat(Math.max(16 - digits.length, 0))).replace(/(.{4})(?=.)/g, '$1 ');
  document.getElementById('cc-holder').textContent = holderInput.value.trim() || 'Votre nom';
  document.getElementById('cc-expiry').textContent = expiryInput.value || 'MM/AA';
  document.getElementById('cc-cvc').textContent = cvcInput.value || '•••';
}

// 4242424242424242 -> 4242 4242 4242 4242, 1230 -> 12/30
numberInput.addEventListener('input', () => {
  numberInput.value = numberInput.value.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
});
expiryInput.addEventListener('input', () => {
  const digits = expiryInput.value.replace(/\D/g, '').slice(0, 4);
  expiryInput.value = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
});
payForm.addEventListener('input', renderCard);
cvcInput.addEventListener('focus', () => card.classList.add('is-flipped'));
cvcInput.addEventListener('blur', () => card.classList.remove('is-flipped'));

function openPayment(b) {
  paying = b;
  payForm.reset();
  renderCard();
  payError.textContent = '';
  dialog.classList.remove('is-success');
  document.getElementById('pay-summary').replaceChildren(
    h('strong', {}, b.boatName), ` · ${frDate(b.startDate)} → ${frDate(b.endDate)} · `, h('strong', {}, euro(b.totalPrice)),
  );
  dialog.showModal();
}

document.getElementById('pay-close').addEventListener('click', () => dialog.close());

payForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  payError.textContent = '';
  const button = payForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const { booking } = await api(`/api/bookings/${paying.id}/pay`, { method: 'POST', body: Object.fromEntries(new FormData(payForm)) });
    document.getElementById('pay-ref').textContent = `Référence ${booking.paymentRef} · ${euro(booking.totalPrice)}`;
    dialog.classList.add('is-success');
    await load();
    setTimeout(() => dialog.close(), 1800);
  } catch (err) {
    payError.textContent = err.message;
    scene.classList.remove('shake');
    void scene.offsetWidth;
    scene.classList.add('shake');
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
