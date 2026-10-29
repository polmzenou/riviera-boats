import { api, euro, frDate, todayIso, toast } from './api.js';
import { initLayout } from './layout.js';
import { confirmDialog, countUp, initials } from './ui.js';

const user = await initLayout();

document.getElementById('p-avatar').textContent = initials(user.fullName);
document.getElementById('p-name').textContent = user.fullName;
document.getElementById('p-email').textContent = user.email;
document.getElementById('p-role').textContent = user.role === 'admin' ? 'Administrateur' : 'Client';
document.getElementById('p-since').textContent = frDate(user.createdAt);

const button = document.getElementById('delete-account');
if (user.role === 'admin') {
  button.disabled = true;
  document.getElementById('admin-note').classList.remove('hidden');
}

button.addEventListener('click', async () => {
  const confirmed = await confirmDialog({
    title: 'Supprimer votre compte ?',
    message: 'Votre compte, vos sessions et toutes vos réservations seront définitivement effacés.',
    confirmLabel: 'Supprimer définitivement',
    danger: true,
  });
  if (!confirmed) return;
  button.disabled = true;
  try {
    await api('/api/auth/me', { method: 'DELETE' });
    window.location.assign('/');
  } catch (err) {
    toast(err.message, 'error');
    button.disabled = false;
  }
});

try {
  const { bookings } = await api('/api/bookings');
  const active = bookings.filter((b) => b.status !== 'cancelled');
  countUp(document.getElementById('st-total'), active.length);
  countUp(document.getElementById('st-upcoming'), active.filter((b) => b.endDate >= todayIso()).length);
  countUp(document.getElementById('st-paid'), bookings.filter((b) => b.status === 'paid').reduce((sum, b) => sum + b.totalPrice, 0), (n) => euro(Math.round(n)));
} catch {
  document.getElementById('account-stats').classList.add('hidden');
}
