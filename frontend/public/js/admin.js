import { api, h, euro, frDate, toast, STATUS_LABEL } from './api.js';
import { initLayout } from './layout.js';

const me = await initLayout();

const tabs = document.querySelectorAll('.admin-tabs [role="tab"]');
for (const tab of tabs) {
  tab.addEventListener('click', () => {
    for (const t of tabs) {
      t.setAttribute('aria-selected', String(t === tab));
      document.getElementById(t.dataset.panel).classList.toggle('hidden', t !== tab);
    }
  });
}

let users = [];

async function loadUsers() {
  ({ users } = await api('/api/auth/users'));
  document.getElementById('users-body').replaceChildren(...users.map((u) => h('tr', {},
    h('td', {}, u.id),
    h('td', {}, u.fullName),
    h('td', {}, u.email),
    h('td', {}, u.role === 'admin' ? h('span', { class: 'badge-admin' }, 'admin') : 'client'),
    h('td', {}, frDate(u.createdAt)),
    h('td', {}, u.id === me.id
      ? h('span', { class: 'hint' }, 'vous')
      // pour un admin, c'est le serveur qui refuse (403)
      : h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: () => deleteUser(u) }, 'Supprimer')))));
}

async function deleteUser(u) {
  if (!window.confirm(`Supprimer le compte de ${u.fullName} (${u.email}) et ses réservations ?`)) return;
  try {
    await api(`/api/auth/users/${u.id}`, { method: 'DELETE' });
    toast(`Compte de ${u.fullName} supprimé.`, 'success');
    await Promise.all([loadUsers(), loadBookings()]);
  } catch (err) {
    toast(`${err.message} (HTTP ${err.status})`, 'error');
  }
}

const [ports, types] = await Promise.all([api('/api/boats/ports'), api('/api/boats/types')]);
const typeLabel = Object.fromEntries(types.map((t) => [t.value, t.label]));
document.getElementById('n-type').append(...types.map((t) => h('option', { value: t.value }, t.label)));
document.getElementById('n-port').append(...ports.map((p) => h('option', { value: p.id }, `${p.city} — ${p.name}`)));

async function loadBoats() {
  const boats = await api('/api/boats');
  document.getElementById('boats-body').replaceChildren(...boats.map((b) => h('tr', {},
    h('td', {}, b.id),
    h('td', {}, b.name),
    h('td', {}, typeLabel[b.type] ?? b.type),
    h('td', {}, b.port.city),
    h('td', {}, b.capacity),
    h('td', {}, euro(b.pricePerDay)),
    h('td', {}, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => deleteBoat(b) }, 'Retirer')))));
}

async function deleteBoat(b) {
  if (!window.confirm(`Retirer « ${b.name} » du catalogue ?`)) return;
  try {
    await api(`/api/boats/${b.id}`, { method: 'DELETE' });
    toast(`« ${b.name} » retiré du catalogue.`, 'success');
    await loadBoats();
  } catch (err) {
    toast(err.message, 'error');
  }
}

const boatForm = document.getElementById('boat-form');
boatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = boatForm.querySelector('.form-error');
  error.textContent = '';
  const data = Object.fromEntries(new FormData(boatForm));
  const body = {
    ...data,
    portId: Number(data.portId),
    capacity: Number(data.capacity),
    lengthM: Number(data.lengthM),
    pricePerDay: Number(data.pricePerDay),
    licenseRequired: data.licenseRequired === 'true',
  };
  try {
    const boat = await api('/api/boats', { method: 'POST', body });
    toast(`« ${boat.name} » ajouté à la flotte de ${boat.port.city}.`, 'success');
    boatForm.reset();
    await loadBoats();
  } catch (err) {
    error.textContent = err.details ? `${err.message} : ${err.details}` : err.message;
  }
});

async function loadBookings() {
  const { bookings } = await api('/api/bookings?scope=all');
  const emailOf = Object.fromEntries(users.map((u) => [u.id, u.email]));
  document.getElementById('bookings-body').replaceChildren(...bookings.map((b) => h('tr', {},
    h('td', {}, b.id),
    h('td', {}, emailOf[b.userId] ?? `#${b.userId}`),
    h('td', {}, `${b.boatName} (${b.portName})`),
    h('td', {}, `${frDate(b.startDate)} → ${frDate(b.endDate)}`),
    h('td', {}, euro(b.totalPrice)),
    h('td', {}, h('span', { class: `status status-${b.status}` }, STATUS_LABEL[b.status])))));
}

try {
  await loadUsers();
  await Promise.all([loadBoats(), loadBookings()]);
} catch (err) {
  toast(err.message, 'error');
}
