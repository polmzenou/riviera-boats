import { api, frDate, toast } from './api.js';
import { initLayout } from './layout.js';

const user = await initLayout();

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
  if (!window.confirm('Supprimer définitivement votre compte et toutes vos réservations ?')) return;
  button.disabled = true;
  try {
    await api('/api/auth/me', { method: 'DELETE' });
    window.location.assign('/');
  } catch (err) {
    toast(err.message, 'error');
    button.disabled = false;
  }
});
