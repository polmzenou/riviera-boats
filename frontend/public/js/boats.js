import { api, h, euro, frDate, todayIso, toast, boatArt } from './api.js';
import { initLayout } from './layout.js';
import { reveal } from './ui.js';

const DAY_MS = 24 * 3600 * 1000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

const filters = document.getElementById('filters');
const list = document.getElementById('boat-list');
const count = document.getElementById('count');
const dialog = document.getElementById('book-dialog');
const bookForm = document.getElementById('book-form');
const startInput = document.getElementById('b-start');
const endInput = document.getElementById('b-end');
const estimate = document.getElementById('estimate');
const bookError = bookForm.querySelector('.form-error');
let currentBoat = null;

const skeleton = () => h('div', { class: 'card skeleton', 'aria-hidden': 'true' },
  h('div', { class: 'sk sk-visual' }), h('div', { class: 'sk sk-line w40' }), h('div', { class: 'sk sk-line w80' }), h('div', { class: 'sk sk-line w60' }));
list.replaceChildren(...Array.from({ length: 6 }, skeleton));

await initLayout();

const [ports, types] = await Promise.all([api('/api/boats/ports'), api('/api/boats/types')]);
const typeLabel = Object.fromEntries(types.map((t) => [t.value, t.label]));
document.getElementById('f-port').append(...ports.map((p) => h('option', { value: p.id }, `${p.city} — ${p.name}`)));
document.getElementById('f-type').append(...types.map((t) => h('option', { value: t.value }, t.label)));

const initial = new URLSearchParams(window.location.search);
for (const [key, value] of initial) {
  if (filters.elements[key]) filters.elements[key].value = value;
}

function card(boat) {
  return h('article', { class: 'card boat-card reveal' },
    h('div', { class: `boat-visual t-${boat.type}` },
      h('span', { class: 'city' }, boat.port.city),
      h('img', { class: 'boat-art', src: boatArt(boat.type), alt: '', loading: 'lazy' })),
    h('div', { class: 'boat-body' },
      h('p', { class: 'boat-kicker' }, `${typeLabel[boat.type] ?? boat.type} · ${boat.port.name}`),
      h('h3', {}, boat.name),
      h('p', { class: 'boat-desc' }, boat.description),
      h('div', { class: 'specs' },
        h('span', { class: 'chip i-people' }, `${boat.capacity} pers.`),
        h('span', { class: 'chip i-length' }, `${boat.lengthM} m`),
        boat.licenseRequired
          ? h('span', { class: 'chip i-license warn' }, 'Permis requis')
          : h('span', { class: 'chip i-license ok' }, 'Sans permis')),
      h('div', { class: 'boat-foot' },
        h('span', { class: 'price' }, euro(boat.pricePerDay), h('small', {}, '/ jour')),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openBooking(boat) },
          'Réserver', h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→')))));
}

async function load() {
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(filters)) if (value) params.set(key, value);
  const query = params.size ? `?${params}` : '';
  window.history.replaceState(null, '', `${window.location.pathname}${query}`);
  try {
    const boats = await api(`/api/boats${query}`);
    count.textContent = `${boats.length} bateau${boats.length > 1 ? 'x' : ''} disponible${boats.length > 1 ? 's' : ''}`;
    list.replaceChildren(...(boats.length
      ? boats.map(card)
      : [h('div', { class: 'empty' }, h('strong', {}, 'Aucun bateau ne correspond'), 'Élargissez vos critères ou essayez un autre port.')]));
    reveal(list);
  } catch (err) {
    toast(err.message, 'error');
  }
}

let debounce;
filters.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(load, 250);
});
filters.addEventListener('reset', () => setTimeout(load, 0));
filters.addEventListener('submit', (e) => e.preventDefault());

function updateEstimate() {
  const { value: start } = startInput;
  const { value: end } = endInput;
  if (!currentBoat || !start || !end || end < start) {
    estimate.replaceChildren(h('span', {}, 'Choisissez vos dates de départ et de retour.'));
    return;
  }
  const days = daysBetween(start, end) + 1;
  estimate.replaceChildren(
    h('span', {}, `${days} jour${days > 1 ? 's' : ''} × ${euro(currentBoat.pricePerDay)}`),
    h('strong', {}, euro(days * currentBoat.pricePerDay)),
  );
}

async function openBooking(boat) {
  currentBoat = boat;
  const today = todayIso();
  startInput.min = today;
  endInput.min = today;
  startInput.value = addDays(today, 7);
  endInput.value = addDays(today, 9);
  bookError.textContent = '';
  document.getElementById('book-head').className = `dlg-head t-${boat.type}`;
  document.getElementById('book-art').src = boatArt(boat.type);
  document.getElementById('book-port').textContent = `${boat.port.city} · ${boat.port.name}`;
  document.getElementById('book-title').textContent = boat.name;
  document.getElementById('book-summary').replaceChildren(
    h('strong', {}, typeLabel[boat.type] ?? boat.type),
    ` · ${boat.capacity} pers. · ${boat.lengthM} m · `,
    h('strong', {}, `${euro(boat.pricePerDay)} / jour`),
  );
  updateEstimate();

  const bookedList = document.getElementById('booked-list');
  bookedList.replaceChildren(h('li', {}, 'Chargement…'));
  dialog.showModal();
  try {
    const { booked } = await api(`/api/bookings/availability/${boat.id}`);
    bookedList.replaceChildren(...(booked.length
      ? booked.map((r) => h('li', {}, `${frDate(r.startDate)} → ${frDate(r.endDate)}`))
      : [h('li', { class: 'free' }, 'Aucune date réservée : le bateau est libre')]));
  } catch {
    bookedList.replaceChildren(h('li', {}, 'Disponibilités indisponibles pour le moment.'));
  }
}

startInput.addEventListener('change', () => {
  if (endInput.value < startInput.value) endInput.value = startInput.value;
  endInput.min = startInput.value;
  updateEstimate();
});
endInput.addEventListener('change', updateEstimate);
document.getElementById('book-close').addEventListener('click', () => dialog.close());

bookForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  bookError.textContent = '';
  const button = bookForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const { booking } = await api('/api/bookings', {
      method: 'POST',
      body: { boatId: currentBoat.id, startDate: startInput.value, endDate: endInput.value },
    });
    window.location.assign(`/bookings.html?pay=${booking.id}`);
  } catch (err) {
    bookError.textContent = err.message;
    button.disabled = false;
  }
});

await load();
